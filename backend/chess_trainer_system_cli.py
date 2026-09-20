import argparse
import sys
import time
import subprocess
import json
from pathlib import Path
import requests

API_BASE_URL = "http://localhost:8000/api"
SERVER_BASE_URL = "http://localhost:8000"

def ensure_server_running():
    """Checks if the server is online. If not, starts the Uvicorn process."""
    try:
        requests.get(f"{SERVER_BASE_URL}/docs", timeout=1)
    except requests.exceptions.ConnectionError:
        print("⚠️  Server offline. Starting the FastAPI server in the background...")
        try:
            subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "chess_trainer_system_server:app", "--port", "8000"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            for i in range(10):
                time.sleep(1)
                try:
                    requests.get(f"{SERVER_BASE_URL}/docs", timeout=1)
                    print("🚀 Server started successfully!\n")
                    return
                except requests.exceptions.ConnectionError:
                    pass
            
            print("❌ Error: The server did not respond after 10 seconds. Check for backend errors.", file=sys.stderr)
            sys.exit(1)
            
        except FileNotFoundError:
            print("❌ Error: Command 'uvicorn' not found in the current environment.", file=sys.stderr)
            sys.exit(1)


def write_output_file(file_path: str, content: str) -> None:
    """Write the analysis result to a UTF-8 text file."""
    output_path = Path(file_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")


def parse_json_input(file_path: Path) -> tuple[str, str]:
    """
    Parses a JSON file in the following format:
    {
      "fen": "...",
      "move": "...",
    }
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        fen = data.get("fen")
        move = data.get("move")
        
        if not fen or not move:
            raise ValueError(f"Keys 'fen' and 'move' are required in the file {file_path.name}.")
            
        return fen, move
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON format in file {file_path.name}: {e}")


def read_interactive_inputs() -> tuple[str, str]:
    """Read the analysis parameters directly from the user."""
    fen = input("FEN: ").strip()
    move = input("UCI move: ").strip()
    return fen, move


def numbered_output_path(base_path: Path, index: int, total: int) -> Path:
    """Generates numbered filenames for batch executions."""
    if total == 1:
        return base_path
    return base_path.with_name(f"{base_path.stem}_{index}{base_path.suffix}")


def run_analysis_via_api(fen: str, move: str, output_file: str = None) -> None:
    """Consumes the server API to generate the move analysis."""
    try:
        print("⏳ Querying the API for evaluation with Stockfish...")
        engine_resp = requests.post(
            f"{API_BASE_URL}/engine-analysis",
            json={"fen": fen, "move": move}
        )
        engine_resp.raise_for_status()
        engine_data = engine_resp.json()

        print("🧠 Generating the trainer prompt...")
        semantic_payload = {
            "before_move_analysis": engine_data["before_move_analysis"],
            "after_move_analysis": engine_data["after_move_analysis"],
            "move_classification": engine_data.get("move_classification"),
            "move_delta": engine_data.get("move_delta", 0.0)
        }
        
        semantic_resp = requests.post(
            f"{API_BASE_URL}/semantic-evaluation",
            json=semantic_payload
        )
        semantic_resp.raise_for_status()
        semantic_data = semantic_resp.json()

        print("\n✅ Completed!\n")
        print(semantic_data)

        if output_file:
            write_output_file(output_file, str(semantic_data))
            print(f"📁 Saved to: {output_file}\n")

    except requests.exceptions.RequestException as e:
        print(f"\n❌ FastAPI Server communication error: {e}", file=sys.stderr)
        if e.response is not None:
            print(f"Details: {e.response.text}", file=sys.stderr)


if __name__ == "__main__":
    inputs_dir = Path(__file__).resolve().parent / "inputs"
    output_dir = Path(__file__).resolve().parent / "output"
    
    parser = argparse.ArgumentParser(description="Analyze a chess move via FastAPI Server.")
    parser.add_argument(
        "--mode",
        choices=("interactive", "files"),
        default="interactive",
        help="Read parameters from the terminal or use input/output files.",
    )
    parser.add_argument("--once", action="store_true", help="Run only the first files-mode analysis.")
    parser.add_argument("--output-file", default=output_dir / "analysis.txt", help="File for the analysis result.")
    args = parser.parse_args()

    ensure_server_running()

    if args.mode == "interactive":
        while True:
            fen, move = read_interactive_inputs()
            run_analysis_via_api(fen, move)
            if args.once or input("\nRun again? [y/N]: ").strip().lower() != "y":
                break
    else:
        try:
            inputs_dir.mkdir(parents=True, exist_ok=True)            
            input_files = sorted(
                (path for path in inputs_dir.iterdir() if path.is_file() and path.suffix == ".json"),
                key=lambda path: path.name.casefold()
            )
            
            if not input_files:
                print(f"⚠️  No .json files found in directory: {inputs_dir}", file=sys.stderr)
                print("Create a JSON file with the keys 'fen' and 'move' to use this mode.", file=sys.stderr)
                sys.exit(1)

            for index, file_path in enumerate(input_files, start=1):
                fen, move = parse_json_input(file_path)  
                output_file_path = numbered_output_path(Path(args.output_file), index, len(input_files))
                
                print(f"--- Running analysis {index}/{len(input_files)} (File: {file_path.name}) ---")
                run_analysis_via_api(fen, move, output_file=str(output_file_path))
                
                if args.once:
                    break

        except (OSError, ValueError) as err:
            print(f"Error preparing input files: {err}", file=sys.stderr)
            sys.exit(1)

