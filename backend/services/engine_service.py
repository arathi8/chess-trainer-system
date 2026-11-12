import math
import os
import random
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import chess
import chess.engine

# Training games: during the first GRACE_FULLMOVES the engine avoids moves that push its
# win probability above GRACE_WIN_CAP, so early mistakes are not punished at once.
GRACE_FULLMOVES = 12
GRACE_WIN_CAP = 70.0
# Lenient alternatives must still keep the engine at least this well off (it never gives the game away).
GRACE_WIN_FLOOR = 50.0

# Training games: to avoid repeating the same line every game, the engine picks at random among
# candidates whose win% (its own POV) is within this margin of the best move. The margin is wider
# in the opening, where several moves are about equally good, and narrow afterwards.
VARIETY_OPENING_FULLMOVES = 10
VARIETY_WIN_MARGIN_OPENING = 3.0
VARIETY_WIN_MARGIN = 1.5

# Candidate moves searched per training move. 3 at depth 20 costs about the same as a plain
# engine.play at depth 20 (~2s); 5 candidates took 8-10s.
TRAINING_MULTIPV = 3

def find_stockfish() -> str:
    """Find the Stockfish executable bundled with the project or on PATH."""
    configured_path = os.environ.get("STOCKFISH_PATH")
    if configured_path:
        engine_path = Path(configured_path).expanduser()
        if engine_path.is_file():
            return str(engine_path)
        raise FileNotFoundError(f"STOCKFISH_PATH does not point to a file: {engine_path}")

    project_dir = Path(__file__).resolve().parent
    bundled_candidates = (
        project_dir / "stockfish" / "stockfish-windows-x86-64-avx2.exe",
        project_dir / "stockfish" / "stockfish",
        project_dir / "stockfish.exe",
        Path("/usr/games/stockfish"),
    )
    for engine_path in bundled_candidates:
        if engine_path.is_file():
            return str(engine_path)

    path_engine = shutil.which("stockfish")
    if path_engine:
        return path_engine

    raise FileNotFoundError(
        "Stockfish executable not found. Set STOCKFISH_PATH or place it in the stockfish folder."
    )


def parse_board(fen: str) -> Optional[chess.Board]:
    """Validate and parse a FEN string."""
    try:
        return chess.Board(fen)
    except ValueError as err:
        print(f"Invalid FEN string: {err}", file=sys.stderr)
        return None


def parse_move(board: chess.Board, user_move_uci: str) -> Optional[chess.Move]:
    """Validate UCI syntax and check whether the move is legal."""
    try:
        user_move = chess.Move.from_uci(user_move_uci)
    except ValueError:
        print(f"Invalid UCI move string: '{user_move_uci}'", file=sys.stderr)
        return None

    if user_move not in board.legal_moves:
        print(f"Illegal move: '{user_move_uci}' is not valid in position: {board.fen()}", file=sys.stderr)
        return None

    return user_move


def stringfy_engine_analysis(
    board: chess.Board,
    engine_result: chess.engine.InfoDict,
    max_moves_to_display: int = 15,
) -> Dict[str, Any]:
    """Format the evaluation and principal variation from engine results."""
    pv_moves: list[chess.Move] = engine_result.get("pv", [])
    best_move: Optional[chess.Move] = pv_moves[0] if pv_moves else None
    best_move_str = f"{best_move.uci()} ({board.san(best_move)})" if best_move else "None"

    score_str = "N/A"
    if "score" in engine_result:
        score = engine_result["score"].white()
        if score.is_mate():
            score_str = f"Mate in {score.mate()} moves"
        else:
            cp = score.score()
            if cp is not None:
                score_str = f"{cp / 100.0:+.2f} pawns"

    displayed_moves = pv_moves[:max_moves_to_display * 2]
    pv_line = board.variation_san(displayed_moves) if displayed_moves else "[]"
    return {
        "fen": board.fen(),
        "best_move": best_move_str,
        "evaluation": score_str,
        "depth": engine_result.get("depth", "N/A"),
        "line": pv_line,
    }


# --- classifier ---

def cp_to_win_percent(cp: float) -> float:
    """
    Converts a centipawn evaluation into a winning probability percentage [0.0% to 100.0%].
    Sigmoid formula: Win% = 50 + 50 * (2 / (1 + exp(-k * cp)) - 1)
    """
    k = 0.00368208
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-k * cp)) - 1.0)


def extract_cp(score: chess.engine.Score, pov: chess.Color) -> float:
    """Extracts centipawns normalized to the perspective (POV) of the mover."""
    relative = score.pov(pov)
    if relative.is_mate():
        m = relative.mate()
        return 10000.0 if (m and m > 0) else -10000.0
    val = relative.score()
    return float(val) if val is not None else 0.0


def get_move_classification(
    user_move: chess.Move,
    user_color: chess.Color,
    before_move_analysis: chess.engine.InfoDict,
    after_move_analysis: chess.engine.InfoDict

) -> Tuple[str, float]:
    """
    Pure mathematical evaluation comparing win probabilities before and after the move.
    """

    engine_move = before_move_analysis["pv"][0]

    cp_best = extract_cp(before_move_analysis["score"], user_color)
    cp_after = extract_cp(after_move_analysis["score"], user_color)

    win_best = cp_to_win_percent(cp_best)
    win_after = cp_to_win_percent(cp_after)
    delta_win = max(0.0, win_best - win_after)

    if user_move == engine_move:
        return "Best Move", round(delta_win, 2)

    if delta_win > 25.0:
        return "Blunder", round(delta_win, 2)
    elif delta_win > 12.0:
        return "Mistake", round(delta_win, 2)
    elif delta_win > 5.0:
        return "Inaccuracy", round(delta_win, 2)

    return "Good Move", round(delta_win, 2)


# --- orchestator calls ---

def choose_lenient_move(board: chess.Board, candidates: list[chess.engine.InfoDict]) -> Tuple[chess.Move, bool]:
    """
    Picks the strongest candidate whose win% (engine's POV) stays within [GRACE_WIN_FLOOR, GRACE_WIN_CAP].
    Candidates are sorted best-first. When the best move is already at or under the cap, it is played
    (full strength). Otherwise the engine takes the first sound candidate under the cap, or, if every
    sound candidate exceeds it, the lowest-scoring sound one.
    Returns the move and whether it differs from the engine's best move.
    """
    scored = [
        (info["pv"][0], cp_to_win_percent(extract_cp(info["score"], board.turn)))
        for info in candidates
        if info.get("pv") and "score" in info
    ]
    if not scored:
        raise ValueError("Engine returned no candidate moves")

    best_move, best_win = scored[0]
    if best_win <= GRACE_WIN_CAP:
        return best_move, False

    sound = [(move, win) for move, win in scored if win >= GRACE_WIN_FLOOR]
    chosen = next((move for move, win in sound if win <= GRACE_WIN_CAP), sound[-1][0])
    return chosen, chosen != best_move


def choose_varied_move(
    board: chess.Board,
    candidates: list[chess.engine.InfoDict],
    rng: random.Random | None = None,
) -> chess.Move:
    """
    Picks at random among the candidates that are nearly as good as the best one (see VARIETY_*).
    A forced mate for the engine is always played.
    """
    rng = rng or random
    scored = [
        (info["pv"][0], info["score"].pov(board.turn), cp_to_win_percent(extract_cp(info["score"], board.turn)))
        for info in candidates
        if info.get("pv") and "score" in info
    ]
    if not scored:
        raise ValueError("Engine returned no candidate moves")

    best_move, best_score, best_win = scored[0]
    if best_score.is_mate() and (best_score.mate() or 0) > 0:
        return best_move

    margin = VARIETY_WIN_MARGIN_OPENING if board.fullmove_number <= VARIETY_OPENING_FULLMOVES else VARIETY_WIN_MARGIN
    near_best = [move for move, _, win in scored if win >= best_win - margin]
    return rng.choice(near_best)


def get_engine_move(fen: str, min_depth: int = 20, training: bool = False) -> Tuple[str, bool]:
    """
    Calculate the engine's move for the given position.
    In training mode the engine is lenient during the opening (see GRACE_* constants) and varies
    its choice among near-equal moves (see VARIETY_* constants).
    Returns (move_uci, grace_applied). Raises ValueError on an invalid or finished position.
    """
    board = parse_board(fen)
    if board is None:
        raise ValueError(f"Invalid FEN: {fen}")
    if board.is_game_over():
        raise ValueError("The game is already over in this position")

    stockfish_path = find_stockfish()
    limit = chess.engine.Limit(depth=min_depth)
    with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
        if training:
            candidates = engine.analyse(board, limit, multipv=TRAINING_MULTIPV)

            if board.fullmove_number <= GRACE_FULLMOVES:
                move, grace_applied = choose_lenient_move(board, candidates)
                if grace_applied:
                    return move.uci(), True

            return choose_varied_move(board, candidates).uci(), False

        result = engine.play(board, limit)
        if result.move is None:
            raise ValueError("Engine returned no move")
        return result.move.uci(), False


def get_position_analysis(fen: str, min_depth: int = 20) -> Optional[Dict[str, Any]]:
    """Stockfish's evaluation of a single position, in the same format as get_move_analysis's halves."""
    board = parse_board(fen)
    if not board:
        return None
    try:
        with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
            info = engine.analyse(board, chess.engine.Limit(depth=min_depth))
            return stringfy_engine_analysis(board, info)
    except FileNotFoundError:
        print("Error: Stockfish engine binary not found.", file=sys.stderr)
        return None
    except Exception as err:
        print(f"Engine execution failure on position analysis: {err}", file=sys.stderr)
        return None


def get_move_analysis(
    fen: str,
    move: str,
    min_depth: int = 20,
    time_limit: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """
    Analyze a chess position before and after the user's move,
    extracting move classification without running extra engine analyses.
    """
    stockfish_path = find_stockfish()
    board = parse_board(fen)
    if not board:
        return None

    user_move = parse_move(board, move)
    if not user_move:
        return None
    user_color = board.turn

    try:
        with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
            limit_kwargs = {"depth": min_depth}
            if time_limit is not None:
                limit_kwargs["time"] = time_limit
            search_limit = chess.engine.Limit(**limit_kwargs)

            analysis_before_move = engine.analyse(board, search_limit)
            formated_before_move_analysis = stringfy_engine_analysis(board, analysis_before_move)
            board.push(user_move)
            analysis_after_move = engine.analyse(board, search_limit)
            formated_after_move_analysis = stringfy_engine_analysis(board, analysis_after_move)

            move_classification, move_delta = get_move_classification(user_move, user_color, analysis_before_move, analysis_after_move)

            return {
                "before_move_analysis": formated_before_move_analysis,
                "after_move_analysis": formated_after_move_analysis,
                "move_classification": move_classification,
                "move_delta": move_delta
            }

    except FileNotFoundError:
        print("Error: Stockfish engine binary not found.", file=sys.stderr)
        return None
    except Exception as err:
        print(f"Engine execution failure on move analysis: {err}", file=sys.stderr)
        return None