import random
import sys
from pathlib import Path

import chess
import chess.engine
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.engine_service import (  # noqa: E402
    choose_lenient_move,
    choose_varied_move,
    find_stockfish,
    get_engine_move,
)


def stockfish_available() -> bool:
    try:
        find_stockfish()
        return True
    except FileNotFoundError:
        return False


needs_stockfish = pytest.mark.skipif(not stockfish_available(), reason="Stockfish not installed")


# --- lenient engine ---

def candidate(move: str, cp: int) -> dict:
    return {"pv": [chess.Move.from_uci(move)], "score": chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)}


def test_lenient_plays_best_when_not_crushing():
    move, grace = choose_lenient_move(chess.Board(), [candidate("e2e4", 30), candidate("d2d4", 25)])
    assert move.uci() == "e2e4" and not grace


def test_lenient_skips_crushing_move():
    move, grace = choose_lenient_move(
        chess.Board(), [candidate("e2e4", 900), candidate("d2d4", 150), candidate("g1f3", 100)]
    )
    assert move.uci() == "d2d4" and grace


def test_lenient_never_picks_a_losing_move():
    # Only one sound move (e.g. a forced recapture): the engine must play it.
    move, grace = choose_lenient_move(chess.Board(), [candidate("e2e4", 900), candidate("d2d4", -300)])
    assert move.uci() == "e2e4" and not grace


@needs_stockfish
def test_engine_spares_early_queen_blunder():
    # 1. e4 d6 2. Qg4?? — Bxg4 wins the queen.
    fen = "rnbqkbnr/ppp1pppp/3p4/8/4P1Q1/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2"

    full_strength_move, grace = get_engine_move(fen, min_depth=14)
    assert full_strength_move == "c8g4" and not grace

    lenient_move, grace = get_engine_move(fen, min_depth=14, training=True)
    assert lenient_move != "c8g4" and grace


def test_engine_move_rejects_invalid_fen():
    with pytest.raises(ValueError):
        get_engine_move("not a fen")


# --- engine variety ---

def test_varied_move_picks_among_near_equal_moves():
    board = chess.Board()
    candidates = [candidate("e2e4", 30), candidate("d2d4", 25), candidate("c2c4", 20), candidate("a2a4", -60)]
    picks = {choose_varied_move(board, candidates, random.Random(seed)).uci() for seed in range(50)}
    assert picks == {"e2e4", "d2d4", "c2c4"}


def test_varied_move_narrow_margin_after_opening():
    board = chess.Board()
    board.fullmove_number = 30
    candidates = [candidate("e2e4", 30), candidate("d2d4", -10)]  # ~3.7% apart: beyond the late-game margin
    picks = {choose_varied_move(board, candidates, random.Random(seed)).uci() for seed in range(20)}
    assert picks == {"e2e4"}


def test_varied_move_always_plays_forced_mate():
    board = chess.Board()
    mate = {"pv": [chess.Move.from_uci("e2e4")], "score": chess.engine.PovScore(chess.engine.Mate(2), chess.WHITE)}
    picks = {choose_varied_move(board, [mate, candidate("d2d4", 2000)], random.Random(seed)).uci() for seed in range(20)}
    assert picks == {"e2e4"}
