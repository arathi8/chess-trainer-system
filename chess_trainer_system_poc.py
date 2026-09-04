import argparse
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import chess
import chess.engine
import pyperclip


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


def read_input_file(file_path: str) -> str:
    """Read one POC input parameter from a UTF-8 text file."""
    return Path(file_path).read_text(encoding="utf-8").strip()


def write_output_file(file_path: str, content: str) -> None:
    """Write the analysis result to a UTF-8 text file."""
    output_path = Path(file_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")


def list_input_files(input_dir: Path, parameter: str) -> list[Path]:
    """List files for one parameter in deterministic alphanumeric order."""
    parameter_dir = input_dir / parameter
    files = sorted(
        (path for path in parameter_dir.iterdir() if path.is_file()),
        key=lambda path: path.name.casefold(),
    ) if parameter_dir.is_dir() else []
    if not files:
        raise FileNotFoundError(f"No input files found in {parameter_dir}")
    return files


def build_file_runs(input_dir: Path) -> list[tuple[Path, Path, Path]]:
    """Build one synchronized run for each FEN, move, and prompt file."""
    fen_files = list_input_files(input_dir, "fen")
    move_files = list_input_files(input_dir, "move")
    prompt_files = list_input_files(input_dir, "prompt")
    counts = (len(fen_files), len(move_files), len(prompt_files))

    if not (len(fen_files) == len(move_files) == len(prompt_files)):
        raise ValueError(
            "The number of files in fen, move, and prompt folders must be equal. "
            f"Found counts: fen={counts[0]}, move={counts[1]}, prompt={counts[2]}"
        )

    return [
        (fen_files[index], move_files[index], prompt_files[index])
        for index in range(len(fen_files))
    ]


def numbered_output_path(output_file: Path, index: int, total: int) -> Path:
    """Add an execution number when a files-mode run has multiple outputs."""
    if total == 1:
        return output_file
    return output_file.with_name(f"{output_file.stem}_{index:03d}{output_file.suffix}")


def generate_prompt(
    fen: str,
    move: str,
    prompt: str = "",
    min_depth: int = 20,
    time_limit: Optional[float] = None,
    output_file: Optional[str] = None,
):
    """Analyze a chess position before and after the user's move."""
    stockfish_path = find_stockfish()
    board = parse_board(fen)
    user_move = parse_move(board, move)

    try:
        with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
            limit_kwargs = {"depth": min_depth}
            if time_limit is not None:
                limit_kwargs["time"] = time_limit
            search_limit = chess.engine.Limit(**limit_kwargs)

            before_eval = engine.analyse(board, search_limit)
            before_summary = format_analysis_summary(board, before_eval, label="BEFORE USER MOVE")
            prompt += "\n" + format_analysis_block(before_summary)

            board.push(user_move)
            after_eval = engine.analyse(board, search_limit)
            after_summary = format_analysis_summary(board, after_eval, label="AFTER USER MOVE")
            prompt += "\n" + format_analysis_block(after_summary)

            if output_file:
                write_output_file(output_file, prompt)
            pyperclip.copy(prompt)
            print(prompt)
    except FileNotFoundError:
        print("Error: Stockfish engine binary not found.", file=sys.stderr)
        return None
    except Exception as err:
        print(f"Engine execution failure: {err}", file=sys.stderr)
        return None


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


def format_analysis_summary(
    board: chess.Board,
    engine_result: chess.engine.InfoDict,
    label: str,
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
            score_str = f"Mate in {score.mate()} plies"
        else:
            cp = score.score()
            if cp is not None:
                score_str = f"{cp / 100.0:+.2f} pawns"

    displayed_moves = pv_moves[:max_moves_to_display * 2]
    pv_line = board.variation_san(displayed_moves) if displayed_moves else "[]"
    return {
        "label": label,
        "fen": board.fen(),
        "best_move": best_move_str,
        "evaluation": score_str,
        "depth": engine_result.get("depth", "N/A"),
        "line": pv_line,
    }


def format_analysis_block(summary: Dict[str, Any]) -> str:
    """Format one analysis summary as text."""
    return (
        f"\n--- {summary['label']} ---\n"
        f"FEN: {summary['fen']}\n"
        f"Suggested best move: {summary['best_move']}\n"
        f"Position evaluation for White: {summary['evaluation']}\n"
        f"Depth reached: {summary['depth']} plies\n"
        f"Line: {summary['line']}\n"
        f"---------------------------\n"
    )


def read_interactive_inputs() -> tuple[str, str, str]:
    """Read the analysis parameters directly from the user."""
    fen = input("FEN: ").strip()
    move = input("Lance UCI: ").strip()
    prompt = input("Prompt trainer: ").strip()
    return fen, move, prompt


if __name__ == "__main__":
    input_dir = Path(__file__).resolve().parent / "input"
    output_dir = Path(__file__).resolve().parent / "output"
    parser = argparse.ArgumentParser(description="Analyze a chess move with Stockfish.")
    parser.add_argument(
        "--mode",
        choices=("interactive", "files"),
        default="interactive",
        help="Read parameters from the terminal or use input/output files.",
    )
    parser.add_argument("--once", action="store_true", help="Run only the first files-mode analysis.")
    parser.add_argument("--output-file", default=output_dir / "analysis.txt", help="File for the analysis result.")
    args = parser.parse_args()

    if args.mode == "interactive":
        while True:
            fen, move, prompt = read_interactive_inputs()
            generate_prompt(fen, move, prompt)
            if args.once or input("\nExecutar novamente? [s/N]: ").strip().lower() != "s":
                break
    else:
        try:
            runs = build_file_runs(input_dir)
            for index, (fen_file, move_file, prompt_file) in enumerate(runs, start=1):
                fen = read_input_file(str(fen_file))
                move = read_input_file(str(move_file))
                prompt = read_input_file(str(prompt_file))
                output_file = numbered_output_path(Path(args.output_file), index, len(runs))
                print(f"Running analysis {index}/{len(runs)}")
                generate_prompt(fen, move, prompt, output_file=str(output_file))
                if args.once:
                    break
        except (OSError, ValueError) as err:
            print(f"Error preparing input files: {err}", file=sys.stderr)
            sys.exit(1)
