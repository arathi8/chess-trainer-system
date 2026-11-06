"""Post-game report for training games: deterministic stats plus an LLM prompt grounded on them."""

import math
import re
from collections import Counter
from typing import Any, Dict, List, Optional

import chess

ERROR_CLASSIFICATIONS = ("Inaccuracy", "Mistake", "Blunder")
SERIOUS_CLASSIFICATIONS = ("Mistake", "Blunder")
CLASSIFICATION_ORDER = ("Best Move", "Good Move", "Inaccuracy", "Mistake", "Blunder")

OPENING_LAST_FULLMOVE = 10
ENDGAME_MAX_MATERIAL = 26  # total non-pawn material on the board, both sides
PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}

KEY_MOMENTS = 3

TAG_DESCRIPTIONS = {
    "hung_piece": "left a piece attacked and undefended",
    "missed_capture": "the best move was a capture that was missed",
    "missed_check": "the best move was a check that was missed",
    "missed_mate": "missed a forced mate",
    "allowed_mate": "allowed the opponent a forced mate",
    "walked_into_tactic": "allowed an opponent capture/check that wins material",
}


# --- per-move metrics ---

def move_accuracy(win_percent_loss: float) -> float:
    """Lichess accuracy formula applied to the win% lost by a move."""
    raw = 103.1668 * math.exp(-0.04354 * max(0.0, win_percent_loss)) - 3.1669
    return max(0.0, min(100.0, raw))


def non_pawn_material(board: chess.Board) -> int:
    return sum(
        PIECE_VALUES[piece_type] * len(board.pieces(piece_type, color))
        for piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
        for color in chess.COLORS
    )


def game_phase(board: chess.Board) -> str:
    if non_pawn_material(board) <= ENDGAME_MAX_MATERIAL:
        return "endgame"
    if board.fullmove_number <= OPENING_LAST_FULLMOVE:
        return "opening"
    return "middlegame"


def parse_uci_prefix(text: str) -> Optional[str]:
    """Analysis dicts store the best move as 'e2e4 (e4)'; returns the UCI part."""
    match = re.match(r"\s*([a-h][1-8][a-h][1-8][qrbn]?)", text or "")
    return match.group(1) if match else None


def is_mate_for(evaluation: str, color: chess.Color) -> bool:
    """Evaluation strings are White-POV, e.g. 'Mate in -3 moves' means Black mates."""
    match = re.match(r"Mate in (-?\d+)", evaluation or "")
    if not match:
        return False
    mate = int(match.group(1))
    return mate > 0 if color == chess.WHITE else mate < 0


def material_gain(board: chess.Board, move: chess.Move) -> int:
    """Value of the piece a move captures (0 for non-captures)."""
    if board.is_en_passant(move):
        return PIECE_VALUES[chess.PAWN]
    captured = board.piece_at(move.to_square)
    return PIECE_VALUES.get(captured.piece_type, 0) if captured else 0


def hanging_pieces(board: chess.Board, color: chess.Color) -> List[str]:
    """Non-king pieces of `color` that are attacked and not defended."""
    hanging = []
    for square, piece in board.piece_map().items():
        if piece.color != color or piece.piece_type in (chess.KING, chess.PAWN):
            continue
        if board.is_attacked_by(not color, square) and not board.is_attacked_by(color, square):
            hanging.append(f"{piece.symbol().upper()}{chess.square_name(square)}")
    return hanging


def error_tags(move_data: Dict[str, Any]) -> List[str]:
    """Concrete tactical themes behind a bad move, computed from the position."""
    before = move_data["before_move_analysis"]
    after = move_data["after_move_analysis"]
    board = chess.Board(before["fen"])
    color = board.turn
    tags: List[str] = []

    best_uci = parse_uci_prefix(before.get("best_move", ""))
    best_move = chess.Move.from_uci(best_uci) if best_uci else None
    if best_move and best_move in board.legal_moves:
        if is_mate_for(before.get("evaluation", ""), color):
            tags.append("missed_mate")
        elif board.is_capture(best_move) and material_gain(board, best_move) >= 3:
            tags.append("missed_capture")
        elif board.gives_check(best_move):
            tags.append("missed_check")

    played_board = chess.Board(after["fen"])  # position after the user's move, opponent to move
    if hanging_pieces(played_board, color):
        tags.append("hung_piece")

    if is_mate_for(after.get("evaluation", ""), not color):
        tags.append("allowed_mate")
    else:
        reply_uci = parse_uci_prefix(after.get("best_move", ""))
        reply = chess.Move.from_uci(reply_uci) if reply_uci else None
        if reply and reply in played_board.legal_moves:
            if material_gain(played_board, reply) >= 2 or (
                played_board.gives_check(reply) and move_data.get("move_delta", 0) >= 12
            ):
                tags.append("walked_into_tactic")

    return tags


# --- game stats ---

def move_number_label(fen: str) -> str:
    board = chess.Board(fen)
    return f"{board.fullmove_number}{'.' if board.turn == chess.WHITE else '...'}"


def compute_game_stats(moves: List[Dict[str, Any]], user_color: str, total_user_moves: Optional[int] = None) -> Dict[str, Any]:
    counts = Counter({name: 0 for name in CLASSIFICATION_ORDER})
    phases: Dict[str, Dict[str, Any]] = {}
    accuracies: List[float] = []
    tag_counter: Counter = Counter()
    enriched: List[Dict[str, Any]] = []

    for move in moves:
        delta = float(move.get("move_delta") or 0.0)
        accuracy = move_accuracy(delta)
        classification = move.get("move_classification", "")
        phase = game_phase(chess.Board(move["before_move_analysis"]["fen"]))

        counts[classification] += 1
        accuracies.append(accuracy)

        bucket = phases.setdefault(phase, {"moves": 0, "accuracy_sum": 0.0, "errors": Counter()})
        bucket["moves"] += 1
        bucket["accuracy_sum"] += accuracy
        if classification in ERROR_CLASSIFICATIONS:
            bucket["errors"][classification] += 1

        tags = error_tags(move) if classification in ERROR_CLASSIFICATIONS else []
        if classification in SERIOUS_CLASSIFICATIONS:
            tag_counter.update(tags)

        enriched.append({**move, "accuracy": accuracy, "phase": phase, "tags": tags})

    phase_stats = {
        name: {
            "moves": bucket["moves"],
            "accuracy": round(bucket["accuracy_sum"] / bucket["moves"], 1),
            "inaccuracies": bucket["errors"]["Inaccuracy"],
            "mistakes": bucket["errors"]["Mistake"],
            "blunders": bucket["errors"]["Blunder"],
        }
        for name in ("opening", "middlegame", "endgame")
        if (bucket := phases.get(name))
    }

    errors = [m for m in enriched if m.get("move_classification") in ERROR_CLASSIFICATIONS]
    errors.sort(key=lambda m: m.get("move_delta") or 0.0, reverse=True)
    key_moments = [
        {
            "ply": m.get("ply"),
            "move_number": move_number_label(m["before_move_analysis"]["fen"]),
            "san": m.get("san"),
            "fen": m["before_move_analysis"]["fen"],
            "fen_after": m["after_move_analysis"]["fen"],
            "classification": m.get("move_classification"),
            "win_percent_loss": m.get("move_delta"),
            "phase": m["phase"],
            "best_move": m["before_move_analysis"].get("best_move"),
            "eval_before": m["before_move_analysis"].get("evaluation"),
            "eval_after": m["after_move_analysis"].get("evaluation"),
            "best_line": m["before_move_analysis"].get("line"),
            "refutation_line": m["after_move_analysis"].get("line"),
            "tags": m["tags"],
        }
        for m in errors[:KEY_MOMENTS]
    ]

    return {
        "user_color": user_color,
        "analysed_moves": len(moves),
        "total_user_moves": total_user_moves if total_user_moves is not None else len(moves),
        "accuracy": round(sum(accuracies) / len(accuracies), 1) if accuracies else None,
        "classification_counts": dict(counts),
        "phases": phase_stats,
        "key_moments": key_moments,
        "error_tags": dict(tag_counter.most_common()),
    }


# --- LLM prompt ---

def format_san_line(sans: List[str], first_ply: int = 0) -> str:
    """['e4', 'e5', 'Nf3'] -> '1. e4 e5 2. Nf3'."""
    parts = []
    for i, san in enumerate(sans):
        ply = first_ply + i
        if ply % 2 == 0:
            parts.append(f"{ply // 2 + 1}. {san}")
        elif i == 0:
            parts.append(f"{ply // 2 + 1}... {san}")
        else:
            parts.append(san)
    return " ".join(parts)


def opening_lines(opening: Optional[Dict[str, Any]]) -> List[str]:
    if not opening:
        return [
            "Not identified by the database (non-standard start or unusual first moves). Name the opening from the "
            "PGN only if you are confident; otherwise describe it as an irregular opening. Do not claim that "
            "or where the game left theory, since that could not be determined."
        ]

    lines = [
        f"Opening: {opening['eco']} {opening['name']}",
        f"Reference line for this name: {opening['reference_line']}",
        f"Moves played within theory: {format_san_line(opening['book_moves']) or '(none)'}",
    ]
    deviation = opening.get("deviation")
    if deviation is None:
        lines.append("The game never left the database's theory.")
    elif deviation["kind"] == "end_of_theory":
        lines.append(
            f"The known theory ran out at move {deviation['move_number']} {deviation['san']} "
            f"(played by the {deviation['by']}); from there on the game was out of book."
        )
    else:
        lines.append(
            f"Left theory at move {deviation['move_number']} {deviation['san']}, played by the {deviation['by']}. "
            f"Theoretical moves at that point: {', '.join(deviation['theory_moves'])}."
        )
    return lines


def generate_report_prompt(
    stats: Dict[str, Any],
    result: str,
    termination: str,
    pgn: str = "",
    lenient_plies: Optional[List[int]] = None,
) -> str:
    lines = [
        "You are reviewing a training game the user just played against Stockfish. "
        "The game was a test to gauge the user's skill. Write a post-game report in English, using Markdown, "
        "with exactly these sections:",
        "1. **Overall assessment**: a rough skill band (beginner / intermediate / advanced) justified by the numbers below. Do not claim an Elo rating.",
        "2. **Opening & theory**: comment on the opening and the theoretical line played: whether the user followed theory, "
        "where the game left it, who left it and whether that was a good decision (use the opening-phase stats and key moments), "
        "and the main ideas and typical plans of this opening for the user's side. End with 2 to 3 concrete study "
        "recommendations for this opening (e.g. the theoretical move to learn at the point where the user left theory, "
        "the main line or variation to study next, typical pawn structures and plans).",
        "3. **Strengths**: what the user did well, based on the data.",
        "4. **Areas for improvement**: ranked by importance; each one must cite move numbers from the data.",
        "5. **Specific guidance**: 2 to 4 concrete, actionable training suggestions tied to the error themes below.",
        "6. **Key moments**: one short explanation per key moment, comparing the played move with the best move.",
        "Base every claim on the data below. Only mention moves that appear in it. For opening theory, do not invent "
        "move sequences beyond the reference line and theoretical moves given, and name variations only when confident. "
        "Be encouraging but honest and concise.",
        "",
        "--- GAME ---",
        f"User played: {stats['user_color']}",
        f"Result: {result} ({termination})",
        f"Moves analysed: {stats['analysed_moves']} of {stats['total_user_moves']} user moves",
        "",
        "--- OVERALL STATS ---",
        f"Average accuracy: {stats['accuracy']}%",
        "Move classifications: " + ", ".join(f"{name}: {count}" for name, count in stats["classification_counts"].items()),
        "",
        "--- BY GAME PHASE ---",
    ]
    for phase, data in stats["phases"].items():
        lines.append(
            f"{phase}: {data['moves']} moves, accuracy {data['accuracy']}%, "
            f"inaccuracies {data['inaccuracies']}, mistakes {data['mistakes']}, blunders {data['blunders']}"
        )

    lines += ["", "--- OPENING (from the Lichess opening database) ---", *opening_lines(stats.get("opening"))]

    lines += ["", "--- RECURRING ERROR THEMES (mistakes and blunders) ---"]
    if stats["error_tags"]:
        for tag, count in stats["error_tags"].items():
            lines.append(f"{TAG_DESCRIPTIONS.get(tag, tag)}: {count}x")
    else:
        lines.append("No mistakes or blunders.")

    lines += ["", "--- KEY MOMENTS (largest win% losses) ---"]
    if not stats["key_moments"]:
        lines.append("None: the user made no inaccuracies, mistakes or blunders.")
    for i, km in enumerate(stats["key_moments"], 1):
        themes = ", ".join(TAG_DESCRIPTIONS.get(t, t) for t in km["tags"]) or "positional"
        lines += [
            f"[{i}] Move {km['move_number']} {km['san']} ({km['classification']}, -{km['win_percent_loss']}% win chance, {km['phase']})",
            f"    FEN before: {km['fen']}",
            f"    Best move: {km['best_move']} | eval before: {km['eval_before']} | best line: {km['best_line']}",
            f"    Eval after played move: {km['eval_after']} | opponent's best continuation: {km['refutation_line']}",
            f"    Themes: {themes}",
        ]

    if lenient_plies:
        labels = ", ".join(str(p // 2 + 1) for p in sorted(lenient_plies))
        lines += [
            "",
            f"Note: on move{'s' if len(lenient_plies) > 1 else ''} {labels} the engine deliberately did not punish the user's error (training leniency). "
            "Treat those errors as real; the user should not conclude they were safe.",
        ]

    if pgn:
        lines += ["", "--- PGN ---", pgn]

    return "\n".join(lines)
