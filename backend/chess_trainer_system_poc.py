import os
import sys
from typing import Optional, Dict, Any
import chess
import chess.engine
import pyperclip

def generate_prompt(
    fen: str,
    move: str,
    prompt: str = "",
    min_depth: int = 20,
    time_limit: Optional[float] = None,
):
    """
    Analyzes a chess position before and after a user's move,
    ensuring a deep evaluation line, and returns formatted LLM prompts.
    """
    stockfish_path = "/usr/games/stockfish"
    if not os.path.exists(stockfish_path):
        stockfish_path = "stockfish"

    board = parse_board(fen)
    user_move = parse_move(board, move)

    try:
        with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
            # Set search limit: prioritize depth for long PV lines, with optional time limit
            limit_kwargs = {"depth": min_depth}
            if time_limit is not None:
                limit_kwargs["time"] = time_limit
            search_limit = chess.engine.Limit(**limit_kwargs)

            # 1. Analyze BEFORE user move
            before_eval = engine.analyse(board, search_limit)
            before_summary = format_analysis_summary(board, before_eval, label="BEFORE USER MOVE")
            prompt += "\n" + format_analysis_block(before_summary)

            # 2. Analyze AFTER user move
            board.push(user_move)
            after_eval = engine.analyse(board, search_limit)
            after_summary = format_analysis_summary(board, after_eval, label="AFTER USER MOVE")
            prompt += "\n" + format_analysis_block(after_summary)

            pyperclip.copy(prompt)
            print(prompt)


    except FileNotFoundError:
        print("❌ Error: Stockfish engine binary not found.", file=sys.stderr)
        return None
    except Exception as err:
        print(f"❌ Engine execution failure: {err}", file=sys.stderr)
        return None


def parse_board(fen: str) -> Optional[chess.Board]:
    """
    Validates and parses a FEN string into a chess.Board instance.
    """
    try:
        return chess.Board(fen)
    except ValueError as err:
        print(f"❌ Invalid FEN string: {err}", file=sys.stderr)
        return None

def parse_move(board: chess.Board, user_move_uci: str) -> Optional[chess.Move]:
    """
    Validates move UCI syntax and checks whether it is a legal move on the given board.
    """
    try:
        user_move = chess.Move.from_uci(user_move_uci)
    except ValueError:
        print(f"❌ Invalid UCI move string: '{user_move_uci}'", file=sys.stderr)
        return None

    if user_move not in board.legal_moves:
        print(f"❌ Illegal move: '{user_move_uci}' is not valid in position: {board.fen()}", file=sys.stderr)
        return None

    return user_move

def format_analysis_summary(
    board: chess.Board,
    engine_result: chess.engine.InfoDict,
    label: str,
    max_moves_to_display: int = 15
) -> Dict[str, Any]:
    """
    Formats the evaluation and algebraic move line from engine results.
    """
    pv_moves: list[chess.Move] = engine_result.get("pv", [])
    best_move: Optional[chess.Move] = pv_moves[0] if pv_moves else None

    best_move_str = (
        f"{best_move.uci()} ({board.san(best_move)})"
        if best_move else "None"
    )

    score_str = "N/A"
    if "score" in engine_result:
        score = engine_result["score"].white()
        if score.is_mate():
            score_str = f"Mate in {score.mate()} plies"
        else:
            cp = score.score()
            if cp is not None:
                score_str = f"{cp / 100.0:+.2f} pawns"

    # Slice the PV line to display the required depth of full moves
    displayed_moves = pv_moves[:max_moves_to_display * 2]
    pv_line = board.variation_san(displayed_moves) if displayed_moves else "[]"

    return {
        "label": label,
        "fen": board.fen(),
        "best_move": best_move_str,
        "evaluation": score_str,
        "depth": engine_result.get("depth", "N/A"),
        "line": pv_line
    }

def format_analysis_block(summary: Dict[str, Any]) -> str:
    """
    Formats the analysis summary dictionary into a standardized text block.
    """
    return (
        f"\n📊 --- {summary['label']} ---\n"
        f"[] FEN:{summary['fen']}\n"
        f"👉 Suggested best move: {summary['best_move']}\n"
        f"📈 Position evaluation for White: {summary['evaluation']}\n"
        f"🔬 Depth reached: {summary['depth']} plies\n"
        f"♟️  Line: {summary['line']}\n"
        f"---------------------------\n"
    )

if __name__ == "__main__":

    sample_fen = ""
    sample_move = ""

    prompt="The user wants to know why the engine's move is better than theirs. Explain it like a chess coach."

    generate_prompt(sample_fen, sample_move, prompt)
    