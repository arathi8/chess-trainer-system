import math
import chess
import chess.engine
from typing import Optional, Tuple


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


def classify_target_move(
    board: chess.Board,
    user_move: chess.Move,
    engine: chess.engine.SimpleEngine,
    depth: int = 18
) -> Tuple[Optional[str], float]:
    """
    Evaluates a played move and returns its qualitative label (or None) and win percentage loss.
    
    Criteria:
      - Great Move (!): Exactly the best engine move in a critical position where 
                        the runner-up move drops win probability by >= 15%.
      - Best Move (★): Exactly the top engine move OR matches the best move's 
                       evaluation perfectly (delta_win <= 0.05% tolerance for float noise).
      - [Unclassified / None]: Solid/normal playable moves with minor loss (0.05% < delta_win <= 5.0%).
      - Inaccuracy (?!): Noticeable inaccuracy (5.0% < delta_win <= 12.0%).
      - Mistake (?): Moderate loss (12.0% < delta_win <= 25.0%).
      - Blunder (??): Severe loss (delta_win > 25.0%).
    """
    mover_color = board.turn

    # 1. Analyze position before user move (multipv=2 to check uniqueness)
    multipv_analysis = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=2)
    
    line1 = multipv_analysis[0]
    best_move_engine = line1["pv"][0]
    cp_best = extract_cp(line1["score"], mover_color)
    win_best = cp_to_win_percent(cp_best)

    cp_second_best = None
    if len(multipv_analysis) > 1:
        cp_second_best = extract_cp(multipv_analysis[1]["score"], mover_color)

    # 2. Analyze position after user move
    board_after = board.copy()
    board_after.push(user_move)
    after_analysis = engine.analyse(board_after, chess.engine.Limit(depth=depth))
    cp_after = extract_cp(after_analysis["score"], mover_color)
    win_after = cp_to_win_percent(cp_after)

    delta_win = max(0.0, win_best - win_after)

    # Strict check: matches the best move or incurs true zero loss (within float precision)
    is_exact_best = (user_move == best_move_engine) or (delta_win <= 0.05)

    # -------------------------------------------------------------------------
    # STEP 3: Classification Rules
    # -------------------------------------------------------------------------

    # Condition 1: Great Move (!)
    if user_move == best_move_engine and delta_win <= 0.05 and cp_second_best is not None:
        win_second = cp_to_win_percent(cp_second_best)
        if (win_best - win_second) >= 15.0:
            return "Great Move (!)", delta_win

    # Condition 2: Best Move (★)
    if is_exact_best:
        return "Best Move", delta_win

    # Condition 3: Flawed moves
    if delta_win > 25.0:
        return "Blunder", delta_win
    elif delta_win > 12.0:
        return "Mistake", delta_win
    elif delta_win > 5.0:
        return "Inaccuracy", delta_win

    # Condition 4: Solid/normal moves (0.05% < delta_win <= 5.0%)
    # These moves are neither the absolute best nor real inaccuracies; they receive no badge.
    return None, delta_win