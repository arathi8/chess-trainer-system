"""Opening identification from the Lichess chess-openings dataset (CC0, backend/data/openings.tsv)."""

import csv
import io
import threading
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import chess
import chess.pgn

OPENINGS_FILE = Path(__file__).resolve().parent.parent / "data" / "openings.tsv"
MAX_THEORY_MOVES = 6

Named = Dict[str, Tuple[str, str, str]]


def position_key(board: chess.Board) -> str:
    """Position identity without move counters, so transpositions match."""
    return board.epd()


_openings: Optional[Tuple[Named, Counter]] = None
_openings_lock = threading.Lock()


def load_openings() -> Tuple[Named, Counter]:
    """
    Indexes the dataset once and caches it. Indexing takes a few seconds, so the server preloads it
    at startup; a caller arriving mid-build waits for it instead of building a second copy.
    """
    global _openings
    with _openings_lock:
        if _openings is None:
            _openings = build_openings_index()
        return _openings


def build_openings_index() -> Tuple[Named, Counter]:
    """
    Returns (named, book):
    - named: final position of each dataset line -> (eco, name, pgn of the line)
    - book: every position along any dataset line (i.e. theory) -> how many lines pass through it,
      a rough proxy for how mainstream the position is
    """
    named: Named = {}
    book: Counter = Counter({position_key(chess.Board()): 1})
    with OPENINGS_FILE.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            board = chess.Board()
            try:
                for token in row["pgn"].split():
                    if token[0].isdigit():  # move numbers like "1." or "12..."
                        continue
                    board.push_san(token)
                    book[position_key(board)] += 1
            except ValueError:
                continue
            named[position_key(board)] = (row["eco"], row["name"], row["pgn"])
    return named, book


def ply_label(ply: int) -> str:
    """0-based ply -> '3.' (White) or '3...' (Black)."""
    return f"{ply // 2 + 1}{'.' if ply % 2 == 0 else '...'}"


def book_moves_from(board: chess.Board, book: Counter) -> List[str]:
    """SAN of the legal moves that stay in theory, most mainstream first, capped at MAX_THEORY_MOVES."""
    theory = []
    for move in board.legal_moves:
        san = board.san(move)
        board.push(move)
        key = position_key(board)
        if key in book:
            theory.append((-book[key], san))
        board.pop()
    return [san for _, san in sorted(theory)][:MAX_THEORY_MOVES]


def identify_opening(pgn: str, user_color: str) -> Optional[Dict[str, Any]]:
    """
    Finds the deepest named opening the game reached, the point where it left theory, who left it,
    and the theoretical moves available at that point. Returns None for non-standard starts.
    """
    if not pgn.strip():
        return None
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.board().fen() != chess.STARTING_FEN:
        return None

    named, book = load_openings()
    board = game.board()
    moves = list(game.mainline_moves())

    opening: Optional[Tuple[str, str, str]] = None
    book_sans: List[str] = []
    deviation: Optional[Dict[str, Any]] = None

    for ply, move in enumerate(moves):
        san = board.san(move)
        before = board.copy(stack=False)
        board.push(move)
        key = position_key(board)
        entry = named.get(key)

        if deviation is None and key in book:
            opening = entry or opening
            book_sans.append(san)
            continue

        if deviation is None:
            # The first move that leaves the book: record which theoretical moves existed instead.
            theory = book_moves_from(before, book)
            mover = "white" if ply % 2 == 0 else "black"
            deviation = {
                "ply": ply,
                "move_number": ply_label(ply),
                "san": san,
                "by": "user" if mover == user_color else "opponent",
                # "end_of_theory": the known lines simply stop here; "left_theory": a book move existed
                "kind": "left_theory" if theory else "end_of_theory",
                "theory_moves": theory,
            }
        elif entry:
            # Transposed back into a named line later on: keep the most specific name reached.
            opening = entry

    if opening is None:
        return None

    eco, name, line = opening
    return {
        "eco": eco,
        "name": name,
        "reference_line": line,
        "book_moves": book_sans,
        "deviation": deviation,  # None: the game never left the book
    }
