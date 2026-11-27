"""Board and engine checks the coach (LLM) can run to verify what it says before saying it.

Two layers:
- pure board helpers (material, static exchange, hanging pieces, the material outcome of a line),
  also used to add precomputed facts to the prompts;
- CoachToolkit: the tools offered to the model through function calling, backed by one Stockfish
  process per answer, with a call budget.

Every move in a result is written in numbered SAN ("7. exf6", "7... gxf6"), the notation the coach
must use in its text, so it can quote the results as they are.
"""

import json
import logging
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import chess
import chess.engine

from services.engine_service import cp_to_win_percent, find_stockfish

logger = logging.getLogger(__name__)

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
# Large enough that a king is always the last piece considered to recapture.
KING_ORDER = 100

# Engine settings for tool calls: lighter than the depth-20 analyses of the game itself, since a
# single answer may run several of them.
TOOL_DEPTH = 16
TOOL_TIME_LIMIT = 2.0
MAX_LINE_PLIES = 10

# Calls one answer may make: a move explanation needs a few, a report covers several moments.
MOVE_EVALUATION_TOOL_CALLS = 8
REPORT_TOOL_CALLS = 12

# Tool evaluations are shallower than the game's analysis, so their numbers can differ a little.
QUICK_CHECK_NOTE = (
    f"Quick engine check (depth {TOOL_DEPTH}); its numbers may differ slightly from the game analysis in the "
    "data: quote evaluations from the data, use this for what moves and lines do."
)


# --- pure board helpers ---

def color_name(color: chess.Color) -> str:
    return "White" if color == chess.WHITE else "Black"


def piece_label(board: chess.Board, square: chess.Square) -> str:
    """'White knight on f3'."""
    piece = board.piece_at(square)
    if not piece:
        return f"empty square {chess.square_name(square)}"
    return f"{color_name(piece.color)} {chess.piece_name(piece.piece_type)} on {chess.square_name(square)}"


def numbered(board: chess.Board, move: chess.Move) -> str:
    """The move in numbered SAN from this position: '7. exf6' or '7... gxf6'."""
    return f"{board.fullmove_number}{'.' if board.turn == chess.WHITE else '...'} {board.san(move)}"


def line_san(board: chess.Board, moves: List[chess.Move]) -> str:
    return board.variation_san(moves) if moves else ""


def material(board: chess.Board, color: chess.Color) -> int:
    return sum(PIECE_VALUES[p.piece_type] for p in board.piece_map().values() if p.color == color)


def material_summary(board: chess.Board) -> Dict[str, Any]:
    def pieces(color: chess.Color) -> str:
        parts = []
        for piece_type in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN):
            count = len(board.pieces(piece_type, color))
            if count:
                parts.append(f"{count} {chess.piece_name(piece_type)}{'s' if count > 1 else ''}")
        return ", ".join(parts) or "only the king"

    balance = material(board, chess.WHITE) - material(board, chess.BLACK)
    return {
        "white": pieces(chess.WHITE),
        "black": pieces(chess.BLACK),
        "balance": describe_balance(balance),
    }


def describe_balance(balance_for_white: int) -> str:
    if balance_for_white == 0:
        return "material is level"
    leader = "White" if balance_for_white > 0 else "Black"
    return f"{leader} is up {abs(balance_for_white)} point{'s' if abs(balance_for_white) != 1 else ''} of material"


def moved_value(board: chess.Board, move: chess.Move) -> int:
    """Value of the piece standing on the target square after the move (a promotion counts as its new piece)."""
    if move.promotion:
        return PIECE_VALUES[move.promotion]
    piece = board.piece_at(move.from_square)
    return PIECE_VALUES[piece.piece_type] if piece else 0


def captured_value(board: chess.Board, move: chess.Move) -> int:
    if board.is_en_passant(move):
        return PIECE_VALUES[chess.PAWN]
    victim = board.piece_at(move.to_square)
    return PIECE_VALUES[victim.piece_type] if victim and board.is_capture(move) else 0


def least_valuable_capture(board: chess.Board, square: chess.Square) -> Optional[chess.Move]:
    """The legal capture on `square` with the cheapest piece (promotions prefer the queen)."""
    captures = [m for m in board.legal_moves if m.to_square == square and board.is_capture(m)]
    if not captures:
        return None

    def order(move: chess.Move) -> Tuple[int, int]:
        piece_type = board.piece_type_at(move.from_square)
        cost = KING_ORDER if piece_type == chess.KING else PIECE_VALUES[piece_type]
        return cost, -(PIECE_VALUES[move.promotion] if move.promotion else 0)

    return min(captures, key=order)


def static_exchange(board: chess.Board, move: chess.Move) -> int:
    """Material the side to move nets by playing the capture `move`, then both sides recapturing on that
    square with their cheapest piece for as long as it pays. Played on a copy with legal moves only, so
    pins and pieces lined up behind each other (x-rays) are taken into account."""
    work = board.copy(stack=False)
    gains = [captured_value(work, move) + (PIECE_VALUES[move.promotion] - 1 if move.promotion else 0)]
    on_square = moved_value(work, move)
    work.push(move)
    while True:
        recapture = least_valuable_capture(work, move.to_square)
        if recapture is None:
            break
        gains.append(on_square - gains[-1])
        on_square = moved_value(work, recapture)
        work.push(recapture)
    # Either side may stop capturing when going on would lose material.
    for i in range(len(gains) - 1, 0, -1):
        gains[i - 1] = -max(-gains[i - 1], gains[i])
    return gains[0]


def as_if_to_move(board: chess.Board, color: chess.Color) -> chess.Board:
    """A copy where `color` is to move (a pass, if it was the other side's turn)."""
    work = board.copy(stack=False)
    if work.turn != color:
        work.push(chess.Move.null())
    return work


def winning_captures(board: chess.Board, color: chess.Color) -> List[Dict[str, Any]]:
    """Captures `color` could make that win material (static exchange > 0), best first."""
    work = as_if_to_move(board, color)
    found: Dict[chess.Square, Dict[str, Any]] = {}
    for move in work.legal_moves:
        if not work.is_capture(move):
            continue
        gain = static_exchange(work, move)
        if gain > 0 and gain > found.get(move.to_square, {}).get("gain", 0):
            found[move.to_square] = {"square": move.to_square, "move": move, "gain": gain}
    return sorted(found.values(), key=lambda item: -item["gain"])


def hanging_pieces(board: chess.Board, color: chess.Color) -> Dict[chess.Square, int]:
    """Pieces of `color` the opponent could win by capturing them, with the material it would net."""
    return {item["square"]: item["gain"] for item in winning_captures(board, not color)}


def pieces_under_attack(board: chess.Board) -> Dict[str, Any]:
    """Pieces of each side the other could win by capturing them, saying who is to move: the side to move
    can still save its own pieces, while the other side's are there for the taking."""
    side = board.turn
    return {
        "note": f"{color_name(side)} is to move: its pieces listed here are attacked but can still be saved; "
        f"{color_name(not side)}'s pieces listed here can be taken now",
        color_name(side).lower(): describe_hanging(board, side, hanging_pieces(board, side)) or ["none"],
        color_name(not side).lower(): describe_hanging(board, not side, hanging_pieces(board, not side)) or ["none"],
    }


def describe_hanging(board: chess.Board, color: chess.Color, hanging: Dict[chess.Square, int]) -> List[str]:
    lines = []
    for square, gain in sorted(hanging.items(), key=lambda item: -item[1]):
        attackers = [
            f"{chess.piece_name(board.piece_type_at(a))} {chess.square_name(a)}"
            for a in board.attackers(not color, square)
        ]
        lines.append(
            f"{piece_label(board, square)}: attacked by {', '.join(attackers)}; "
            f"capturing it nets {color_name(not color)} {gain} point{'s' if gain != 1 else ''}"
        )
    return lines


def parse_moves(board: chess.Board, text: Any) -> Tuple[List[chess.Move], Optional[Dict[str, Any]]]:
    """Parses moves given as a list or as PGN text ('7. exf6 gxf6 8. Bd3'), in SAN or UCI.
    Returns the legal moves and, if one is not legal, where and why the parsing stopped."""
    # A list item may itself hold a numbered move ("6... Nb8"), as the coach is told to write them.
    tokens = " ".join(map(str, text)).split() if isinstance(text, list) else str(text).split()
    work = board.copy(stack=False)
    moves: List[chess.Move] = []
    for raw in tokens:
        token = re.sub(r"^\d+\.(\.\.)?", "", raw).strip().rstrip("!?")
        if not token or token in {"...", "…"} or re.fullmatch(r"\d+\.*", token):
            continue
        try:
            move = work.parse_san(token)
        except ValueError:
            try:
                move = chess.Move.from_uci(token)
                if move not in work.legal_moves:
                    raise ValueError
            except ValueError:
                legal = ", ".join(sorted(work.san(m) for m in work.legal_moves)[:40])
                return moves, {
                    "illegal_move": token,
                    "after": line_san(board, moves) or "(start position)",
                    "side_to_move": color_name(work.turn),
                    "legal_moves": legal,
                }
        moves.append(move)
        work.push(move)
    return moves, None


def is_forcing(board: chess.Board, move: chess.Move) -> bool:
    """Captures, promotions, checks and replies to check: moves inside a tactical sequence."""
    return board.is_capture(move) or bool(move.promotion) or board.gives_check(move) or board.is_check()


def line_outcome(board: chess.Board, moves: List[chess.Move], pov: chess.Color) -> Dict[str, Any]:
    """What a line does to the material, from `pov`'s point of view.

    The exchanges count together: the material is read where the line calms down (the first two
    consecutive quiet moves after a capture), so a recaptured piece reads as a trade, not as a loss.
    Quiet moves before the first capture (a pawn attacking a piece, say) do not end the reading."""
    work = board.copy(stack=False)
    start = material(work, pov) - material(work, not pov)
    captures: List[str] = []
    settled_after: Optional[int] = None
    quiet_run = 0
    captured = False
    balance_after: List[int] = []
    for index, move in enumerate(moves):
        quiet = not is_forcing(work, move)
        if work.is_capture(move):
            captured = True
            victim_square = move.to_square
            if work.is_en_passant(move):
                victim_square = chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square))
            captures.append(f"{numbered(work, move)} takes the {piece_label(work, victim_square)}")
        work.push(move)
        balance_after.append(material(work, pov) - material(work, not pov) - start)
        quiet_run = quiet_run + 1 if quiet and captured else 0
        if quiet_run == 2 and settled_after is None:
            settled_after = index - 1  # material before the two quiet moves
    if settled_after is None:
        settled_after = len(moves)

    def describe(change: int) -> str:
        if change == 0:
            return f"no material change for {color_name(pov)}"
        verb = "wins" if change > 0 else "loses"
        return f"{color_name(pov)} {verb} {abs(change)} point{'s' if abs(change) != 1 else ''} of material"

    settled_change = balance_after[settled_after - 1] if settled_after > 0 else 0
    final_change = balance_after[-1] if balance_after else 0
    result = {
        "captures": captures or ["no captures"],
        "after_the_exchanges": describe(settled_change),
    }
    if settled_after < len(moves):
        result["exchanges_end_after"] = line_san(board, moves[:settled_after]) or "(no exchanges)"
    if final_change != settled_change:
        result["at_the_end_of_the_line"] = describe(final_change)
    return result


def line_outcome_text(fen: str, line: str, pov: Optional[chess.Color] = None) -> Optional[str]:
    """One-line material outcome of an engine line given as text, for the prompts; None if it cannot be read."""
    try:
        board = chess.Board(fen)
    except ValueError:
        return None
    moves, error = parse_moves(board, line)
    if not moves or error:
        return None
    pov = board.turn if pov is None else pov
    outcome = line_outcome(board, moves[:MAX_LINE_PLIES], pov)
    text = f"{outcome['after_the_exchanges']} ({'; '.join(outcome['captures'])})"
    if "at_the_end_of_the_line" in outcome:
        text += f"; by the end of the line: {outcome['at_the_end_of_the_line']}"
    return text


def pawn_structure(board: chess.Board, color: chess.Color) -> Dict[str, List[str]]:
    pawns = board.pieces(chess.PAWN, color)
    enemy = board.pieces(chess.PAWN, not color)
    files = [chess.square_file(s) for s in pawns]
    ahead = (lambda r, rank: r > rank) if color == chess.WHITE else (lambda r, rank: r < rank)

    def passed(square: chess.Square) -> bool:
        file, rank = chess.square_file(square), chess.square_rank(square)
        return not any(
            abs(chess.square_file(e) - file) <= 1 and ahead(chess.square_rank(e), rank) for e in enemy
        )

    names = lambda squares: [chess.square_name(s) for s in sorted(squares)]
    facts = {
        "passed": names(s for s in pawns if passed(s)),
        "isolated": names(s for s in pawns if not any(f in files for f in (chess.square_file(s) - 1, chess.square_file(s) + 1))),
        "doubled": names(s for s in pawns if files.count(chess.square_file(s)) > 1),
    }
    return {kind: squares for kind, squares in facts.items() if squares}


def king_status(board: chess.Board, color: chess.Color) -> str:
    king = board.king(color)
    if king is None:
        return "no king"
    square = chess.square_name(king)
    castled = (color == chess.WHITE and square in ("g1", "c1", "b1", "h1")) or (
        color == chess.BLACK and square in ("g8", "c8", "b8", "h8")
    )
    rights = [side for side, has in (
        ("kingside", board.has_kingside_castling_rights(color)),
        ("queenside", board.has_queenside_castling_rights(color)),
    ) if has]
    if castled:
        status = f"king on {square}, castled"
    elif rights:
        status = f"king on {square}, not castled yet (can still castle {' and '.join(rights)})"
    else:
        status = f"king on {square}, can no longer castle"
    if board.is_check() and board.turn == color:
        status += ", in check"
    return status


def undeveloped_minor_pieces(board: chess.Board, color: chess.Color) -> List[str]:
    home = ("b1", "c1", "f1", "g1") if color == chess.WHITE else ("b8", "c8", "f8", "g8")
    return [
        piece_label(board, chess.parse_square(s))
        for s in home
        if (p := board.piece_at(chess.parse_square(s))) and p.color == color and p.piece_type in (chess.KNIGHT, chess.BISHOP)
    ]


def position_features(board: chess.Board) -> Dict[str, Any]:
    """Structural facts a coach might mention, so it states them from the board, not from memory."""
    features: Dict[str, Any] = {}
    for color in (chess.WHITE, chess.BLACK):
        facts: Dict[str, Any] = {"king": king_status(board, color)}
        pawns = pawn_structure(board, color)
        if pawns:
            facts["pawns"] = pawns
        if board.fullmove_number <= 15:
            undeveloped = undeveloped_minor_pieces(board, color)
            if undeveloped:
                facts["minor_pieces_still_at_home"] = undeveloped
        features[color_name(color).lower()] = facts
    return features


# --- engine ---

def describe_score(score: chess.engine.PovScore, turn: chess.Color) -> Dict[str, Any]:
    """An engine score for White and for the side to move, with the latter's winning chances."""
    white = score.white()
    if white.is_mate():
        mate = white.mate()
        for_white = f"mate in {abs(mate)} for {'White' if mate > 0 else 'Black'}"
    else:
        for_white = f"{white.score() / 100:+.2f} pawns for White"
    relative = score.pov(turn)
    cp = 10000 if relative.is_mate() and relative.mate() > 0 else -10000 if relative.is_mate() else relative.score()
    return {
        "evaluation": for_white,
        f"winning_chances_for_{color_name(turn).lower()}": f"{cp_to_win_percent(cp):.0f}%",
    }


def win_chance(score: chess.engine.PovScore, color: chess.Color) -> float:
    relative = score.pov(color)
    if relative.is_mate():
        return 100.0 if relative.mate() > 0 else 0.0
    return cp_to_win_percent(relative.score())


class EngineSession:
    """One Stockfish process for all the checks of an answer, opened on first use; results are cached."""

    def __init__(self, depth: int = TOOL_DEPTH, time_limit: float = TOOL_TIME_LIMIT):
        self.limit = chess.engine.Limit(depth=depth, time=time_limit)
        self.engine: Optional[chess.engine.SimpleEngine] = None
        self.cache: Dict[Tuple[str, int], List[chess.engine.InfoDict]] = {}

    def analyse(self, board: chess.Board, lines: int = 1) -> List[chess.engine.InfoDict]:
        key = (board.fen(), lines)
        if key not in self.cache:
            if self.engine is None:
                self.engine = chess.engine.SimpleEngine.popen_uci(find_stockfish())
            infos = self.engine.analyse(board, self.limit, multipv=lines)
            self.cache[key] = [info for info in infos if info.get("pv")]
        return self.cache[key]

    def close(self) -> None:
        if self.engine is not None:
            try:
                self.engine.quit()
            except chess.engine.EngineError:
                pass
            self.engine = None


# --- tools ---

def read_board(fen: str) -> chess.Board:
    try:
        board = chess.Board(fen)
    except (ValueError, TypeError):
        raise ToolInputError(f"invalid FEN: {fen!r}")
    if not board.is_valid():
        raise ToolInputError(f"impossible position: {fen!r}")
    return board


class ToolInputError(ValueError):
    """A tool argument the model got wrong; reported back to it so it can correct the call."""


def game_over(board: chess.Board) -> Optional[str]:
    if board.is_checkmate():
        return f"checkmate: {color_name(not board.turn)} has won"
    if board.is_stalemate():
        return "stalemate: draw"
    if board.is_insufficient_material():
        return "draw by insufficient material"
    return None


def evaluate_position(engine: EngineSession, fen: str, lines: int = 3) -> Dict[str, Any]:
    board = read_board(fen)
    result: Dict[str, Any] = {"side_to_move": color_name(board.turn), "material": material_summary(board)}
    if board.is_check():
        result["in_check"] = True
    over = game_over(board)
    if over:
        result["game_over"] = over
        return result

    infos = engine.analyse(board, max(1, min(int(lines), 5)))
    result.update(describe_score(infos[0]["score"], board.turn))
    result["best_moves"] = [
        {
            "move": numbered(board, info["pv"][0]),
            **describe_score(info["score"], board.turn),
            "line": line_san(board, info["pv"][:MAX_LINE_PLIES]),
        }
        for info in infos
    ]
    result["pieces_under_attack"] = pieces_under_attack(board)
    result["structure"] = position_features(board)
    result["note"] = QUICK_CHECK_NOTE
    return result


def analyze_move(engine: EngineSession, fen: str, move: str) -> Dict[str, Any]:
    board = read_board(fen)
    moves, error = parse_moves(board, str(move))
    if error or not moves:
        return {"error": f"{move!r} is not a legal move here", **(error or {})}
    played = moves[0]
    mover = board.turn
    result: Dict[str, Any] = {"move": numbered(board, played), "played_by": color_name(mover)}
    if board.is_capture(played):
        victim = played.to_square
        if board.is_en_passant(played):
            victim = chess.square(chess.square_file(played.to_square), chess.square_rank(played.from_square))
        result["captures"] = piece_label(board, victim)
        result["exchange_on_that_square"] = (
            f"{color_name(mover)} nets {static_exchange(board, played)} point(s) if both sides keep recapturing on "
            f"{chess.square_name(played.to_square)}"
        )
    if board.gives_check(played):
        result["gives_check"] = True

    best = engine.analyse(board)[0]
    after = board.copy(stack=False)
    after.push(played)
    over = game_over(after)
    if over:
        result["result"] = over
        return result
    reply = engine.analyse(after)[0]

    best_move = best["pv"][0]
    lost = max(0.0, win_chance(best["score"], mover) - win_chance(reply["score"], mover))
    result["evaluation_before"] = describe_score(best["score"], mover)["evaluation"]
    result["evaluation_after"] = describe_score(reply["score"], after.turn)["evaluation"]
    result[f"winning_chances_lost_by_{color_name(mover).lower()}"] = f"{lost:.0f} percentage points"
    if best_move == played:
        result["engine_verdict"] = "this is the engine's best move"
    else:
        result["engine_best_move_instead"] = numbered(board, best_move)
        result["engine_best_line_instead"] = line_san(board, best["pv"][:MAX_LINE_PLIES])

    refutation = reply["pv"][:MAX_LINE_PLIES]
    result["opponent_best_reply"] = numbered(after, refutation[0])
    result["opponent_best_line"] = line_san(after, refutation)
    # The material outcome counts the move itself, so a capture that gets recaptured reads as a trade.
    result["material_outcome_for_" + color_name(mover).lower()] = line_outcome(board, [played, *refutation], mover)

    before_hanging = hanging_pieces(board, mover)
    after_hanging = hanging_pieces(after, mover)
    newly = {sq: gain for sq, gain in after_hanging.items() if sq not in before_hanging}
    still = {sq: gain for sq, gain in after_hanging.items() if sq in before_hanging}
    result["pieces_left_hanging_by_the_move"] = describe_hanging(after, mover, newly) or ["none"]
    result["threats_the_move_ignored"] = describe_hanging(after, mover, still) or ["none"]
    targets = winning_captures(after, mover)
    if targets:
        result["material_the_move_attacks"] = [
            f"{piece_label(after, t['square'])} ({color_name(mover)} would net {t['gain']} by taking it)" for t in targets
        ]
    result["note"] = QUICK_CHECK_NOTE
    return result


def play_line(engine: EngineSession, fen: str, moves: Any) -> Dict[str, Any]:
    board = read_board(fen)
    parsed, error = parse_moves(board, moves)
    result: Dict[str, Any] = {}
    if error:
        result["error"] = "the line has an illegal move; only the legal part was played"
        result.update(error)
    if not parsed:
        return result
    pov = board.turn
    result["line"] = line_san(board, parsed)
    result["material_outcome_for_" + color_name(pov).lower()] = line_outcome(board, parsed, pov)
    end = board.copy(stack=False)
    for move in parsed:
        end.push(move)
    result["final_fen"] = end.fen()
    over = game_over(end)
    if over:
        result["result"] = over
        return result
    info = engine.analyse(end)[0]
    result["final_position"] = {
        "side_to_move": color_name(end.turn),
        **describe_score(info["score"], end.turn),
        "best_continuation": line_san(end, info["pv"][:MAX_LINE_PLIES]),
        "pieces_under_attack": pieces_under_attack(end),
    }
    # The line may stop in the middle of an exchange: its outcome with the engine's best play after it.
    continuation = info["pv"][:6]
    with_best_play = line_outcome(board, [*parsed, *continuation], pov)["after_the_exchanges"]
    result["material_outcome_with_best_play_after_it"] = with_best_play
    if with_best_play != result["material_outcome_for_" + color_name(pov).lower()]["after_the_exchanges"]:
        result["warning"] = (
            f"The line stops in the middle of an exchange: counting the best replies after it, {with_best_play}."
        )
    result["note"] = QUICK_CHECK_NOTE
    return result


def square_info(engine: EngineSession, fen: str, square: str) -> Dict[str, Any]:
    board = read_board(fen)
    try:
        target = chess.parse_square(str(square).strip().lower())
    except ValueError:
        raise ToolInputError(f"invalid square: {square!r}")

    def listing(color: chess.Color) -> List[str]:
        return [
            f"{chess.piece_name(board.piece_type_at(s))} {chess.square_name(s)}" for s in board.attackers(color, target)
        ] or ["none"]

    result: Dict[str, Any] = {
        "square": chess.square_name(target),
        "occupant": piece_label(board, target),
        "attacked_by_white": listing(chess.WHITE),
        "attacked_by_black": listing(chess.BLACK),
    }
    piece = board.piece_at(target)
    if piece:
        if piece.piece_type != chess.KING and board.is_pinned(piece.color, target):
            result["pinned"] = f"pinned to the {color_name(piece.color)} king"
        hanging = hanging_pieces(board, piece.color).get(target)
        result["can_be_won"] = (
            f"yes: capturing it nets {color_name(not piece.color)} {hanging} point(s)"
            if hanging
            else "no: capturing it does not win material"
        )
    return result


def find_threats(engine: EngineSession, fen: str) -> Dict[str, Any]:
    board = read_board(fen)
    side, other = board.turn, not board.turn
    result: Dict[str, Any] = {
        "side_to_move": color_name(side),
        f"{color_name(side).lower()}_pieces_that_can_be_won": describe_hanging(board, side, hanging_pieces(board, side)) or ["none"],
        f"material_{color_name(side).lower()}_can_win_now": [
            f"{numbered(board, t['move'])} takes the {piece_label(board, t['square'])}, netting {t['gain']}"
            for t in winning_captures(board, side)
        ] or ["none"],
        "checks_available": [numbered(board, m) for m in board.legal_moves if board.gives_check(m)][:8] or ["none"],
    }
    # The opponent's threat: what it would play if the side to move passed.
    if not board.is_check():
        # Rebuilt from the FEN: the engine is not sent a history with a null move in it.
        passed = chess.Board(as_if_to_move(board, other).fen())
        if not game_over(passed) and any(passed.legal_moves):
            info = engine.analyse(passed)[0]
            threat_line = info["pv"][:MAX_LINE_PLIES]
            result[f"{color_name(other).lower()}_threat_if_{color_name(side).lower()}_passed"] = {
                "threat": numbered(passed, threat_line[0]),
                "line": line_san(passed, threat_line),
                "material_outcome": line_outcome(passed, threat_line, other)["after_the_exchanges"],
            }
    return result


FEN_PARAMETER = {"type": "string", "description": "Position in FEN, e.g. the FEN given in the data."}

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "evaluate_position",
            "description": (
                "Stockfish evaluation of a position: who is better, the best moves with their lines, the "
                "material, the pieces each side has hanging and structural facts (kings, castling, passed, "
                "isolated and doubled pawns, undeveloped minor pieces). Use it to describe a position or a plan."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fen": FEN_PARAMETER,
                    "lines": {"type": "integer", "description": "How many best moves to list (1 to 5, default 3)."},
                },
                "required": ["fen"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_move",
            "description": (
                "Checks one move in a position: how much it changes the evaluation, the engine's better move, the "
                "opponent's best reply and line, the NET material outcome after the exchanges, which pieces the move "
                "leaves hanging and which existing threats it ignores. Use it before saying what a move wins, loses "
                "or allows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fen": FEN_PARAMETER,
                    "move": {"type": "string", "description": "The move in SAN (e.g. Nxe5) or UCI (e.g. g1f3)."},
                },
                "required": ["fen", "move"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "play_line",
            "description": (
                "Plays a sequence of moves from a position and reports whether it is legal, the captures, the net "
                "material outcome and the evaluation at the end. Use it before claiming what a line achieves."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fen": FEN_PARAMETER,
                    "moves": {"type": "string", "description": 'The moves in PGN or SAN, e.g. "7. exf6 gxf6 8. Bd3".'},
                },
                "required": ["fen", "moves"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "square_info",
            "description": (
                "Who attacks and defends a square, the piece on it, whether it is pinned to its king and whether "
                "it can be won by captures on that square. Use it before saying a piece is attacked, defended, "
                "hanging or pinned. It is a static count: a piece won through a check, a double attack or a pin "
                "first is not seen here, so check tactics with analyze_move or play_line."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fen": FEN_PARAMETER,
                    "square": {"type": "string", "description": "A square, e.g. f6."},
                },
                "required": ["fen", "square"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_threats",
            "description": (
                "Threats in a position: the side to move's pieces that can be won, the material it can win now, its "
                "checks, and what the opponent threatens (its best move if the side to move passed)."
            ),
            "parameters": {"type": "object", "properties": {"fen": FEN_PARAMETER}, "required": ["fen"]},
        },
    },
]

TOOLS: Dict[str, Callable[..., Dict[str, Any]]] = {
    "evaluate_position": evaluate_position,
    "analyze_move": analyze_move,
    "play_line": play_line,
    "square_info": square_info,
    "find_threats": find_threats,
}


class CoachToolkit:
    """The tools of one answer: their definitions for the model, their execution and a call budget."""

    def __init__(self, max_calls: int = MOVE_EVALUATION_TOOL_CALLS):
        self.max_calls = max_calls
        self.calls: List[str] = []
        self.engine = EngineSession()

    definitions = TOOL_DEFINITIONS

    @property
    def exhausted(self) -> bool:
        return len(self.calls) >= self.max_calls

    def call(self, name: str, arguments: str) -> str:
        """Runs a tool call from the model and returns its result as JSON text (errors included)."""
        if self.exhausted:
            return json.dumps({"error": "No more checks available: write the answer with what you have verified."})
        tool = TOOLS.get(name)
        if tool is None:
            return json.dumps({"error": f"unknown tool {name!r}; available: {', '.join(TOOLS)}"})
        try:
            args = json.loads(arguments or "{}")
            if not isinstance(args, dict):
                raise ValueError
        except ValueError:
            return json.dumps({"error": "arguments must be a JSON object"})

        self.calls.append(describe_call(name, args))
        started = time.monotonic()
        try:
            result = tool(self.engine, **args)
        except TypeError as e:
            result = {"error": f"bad arguments for {name}: {e}"}
        except ToolInputError as e:
            result = {"error": str(e)}
        except (chess.engine.EngineError, chess.engine.EngineTerminatedError, FileNotFoundError) as e:
            logger.warning("coach tool %s: engine unavailable: %s", name, e)
            result = {"error": "the engine is unavailable; do not claim anything that needs it"}
        logger.info("coach tool %s(%s) in %.2fs", name, args, time.monotonic() - started)
        return json.dumps(result, ensure_ascii=False)

    def close(self) -> None:
        self.engine.close()

    def __enter__(self) -> "CoachToolkit":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def describe_call(name: str, args: Dict[str, Any]) -> str:
    """A short, human-readable record of a check, shown to the user."""
    detail = args.get("move") or args.get("moves") or args.get("square") or ""
    labels = {
        "evaluate_position": "avaliou a posição",
        "analyze_move": "analisou o lance",
        "play_line": "conferiu a linha",
        "square_info": "verificou a casa",
        "find_threats": "procurou ameaças",
    }
    return f"{labels.get(name, name)} {detail}".strip()
