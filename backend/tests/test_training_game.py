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
from services.openings_service import identify_opening  # noqa: E402
from services.report_service import (  # noqa: E402
    compute_game_stats,
    error_tags,
    game_phase,
    generate_report_prompt,
    move_accuracy,
)


def stockfish_available() -> bool:
    try:
        find_stockfish()
        return True
    except FileNotFoundError:
        return False


needs_stockfish = pytest.mark.skipif(not stockfish_available(), reason="Stockfish not installed")


# --- fixtures: hand-built move data in the shape returned by /api/engine-analysis ---

def analysis(fen: str, best_move: str, evaluation: str, line: str = "") -> dict:
    return {"fen": fen, "best_move": best_move, "evaluation": evaluation, "depth": 20, "line": line}


# 2. Ba6?? in the Open Game: the bishop is hanging to b7 and the knight.
HUNG_BISHOP = {
    "ply": 2,
    "san": "Ba6",
    "move_classification": "Blunder",
    "move_delta": 30.0,
    "before_move_analysis": analysis(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "g1f3 (Nf3)", "+0.30 pawns"
    ),
    "after_move_analysis": analysis(
        "rnbqkbnr/pppp1ppp/B7/4p3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2", "b7a6 (bxa6)", "-3.20 pawns"
    ),
}

# Scholar's mate available (Qxf7#) but White plays d3.
MISSED_MATE = {
    "ply": 6,
    "san": "d3",
    "move_classification": "Blunder",
    "move_delta": 45.0,
    "before_move_analysis": analysis(
        "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "h5f7 (Qxf7#)", "Mate in 1 moves"
    ),
    "after_move_analysis": analysis(
        "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/3P4/PPP2PPP/RNB1K1NR b KQkq - 0 4", "f6h5 (Nxh5)", "-6.00 pawns"
    ),
}

GOOD_MOVE = {
    "ply": 0,
    "san": "e4",
    "move_classification": "Best Move",
    "move_delta": 0.0,
    "before_move_analysis": analysis(chess.STARTING_FEN, "e2e4 (e4)", "+0.30 pawns"),
    "after_move_analysis": analysis(
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", "e7e5 (e5)", "+0.30 pawns"
    ),
}


# --- report service ---

def test_move_accuracy_bounds():
    assert move_accuracy(0) == pytest.approx(100.0, abs=0.1)
    assert move_accuracy(30) < 30
    assert move_accuracy(100) == 0.0


def test_game_phase():
    assert game_phase(chess.Board()) == "opening"
    assert game_phase(chess.Board("8/8/4k3/8/8/4K3/R7/r7 w - - 0 40")) == "endgame"
    middlegame = chess.Board()
    middlegame.fullmove_number = 20
    assert game_phase(middlegame) == "middlegame"


def test_error_tags_hung_piece():
    tags = error_tags(HUNG_BISHOP)
    assert "hung_piece" in tags
    assert "walked_into_tactic" in tags


def test_error_tags_missed_mate():
    assert "missed_mate" in error_tags(MISSED_MATE)


def test_compute_game_stats_and_prompt():
    stats = compute_game_stats([GOOD_MOVE, HUNG_BISHOP, MISSED_MATE], "white", total_user_moves=4)

    assert stats["analysed_moves"] == 3
    assert stats["total_user_moves"] == 4
    assert stats["classification_counts"]["Blunder"] == 2
    assert stats["phases"]["opening"]["blunders"] == 2
    assert [km["san"] for km in stats["key_moments"]] == ["d3", "Ba6"]
    assert stats["error_tags"]["missed_mate"] == 1

    prompt = generate_report_prompt(stats, "0-1", "resignation", pgn="1. e4 e5", lenient_plies=[2])
    for section in ("Overall assessment", "Strengths", "Areas for improvement", "Specific guidance", "Key moments"):
        assert section in prompt
    assert "missed a forced mate" in prompt
    assert "on move 2 the engine deliberately did not punish" in prompt


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


# --- API ---

def test_game_report_endpoint_prompt_only():
    from fastapi.testclient import TestClient
    from chess_trainer_system_server import app

    client = TestClient(app)
    response = client.post(
        "/api/game-report",
        json={
            "user_color": "white",
            "result": "0-1",
            "termination": "resignation",
            "moves": [GOOD_MOVE, HUNG_BISHOP],
            "provider": "prompt",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stats"]["classification_counts"]["Blunder"] == 1
    assert "Specific guidance" in body["report"]

    # No API key: stats still come back, with an error instead of the narrative.
    response = client.post(
        "/api/game-report",
        json={"user_color": "white", "result": "0-1", "termination": "resignation", "moves": [HUNG_BISHOP], "provider": "gemini"},
    )
    assert response.status_code == 200
    assert response.json()["report"] is None
    assert response.json()["report_error"]


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


# --- openings ---

def test_identify_opening_user_left_theory():
    opening = identify_opening("1. e4 e5 2. Ba6 bxa6", "white")
    assert opening["eco"] == "C20"
    assert opening["deviation"]["by"] == "user"
    assert opening["deviation"]["kind"] == "left_theory"
    assert opening["deviation"]["theory_moves"][0] == "Nf3"


def test_identify_opening_follows_named_line():
    opening = identify_opening("1. d4 Nf6 2. c4 e6 3. Nc3 Bb4", "black")
    assert opening["name"] == "Nimzo-Indian Defense"
    assert opening["deviation"] is None


def test_identify_opening_non_standard_start():
    pgn = '[SetUp "1"]\n[FEN "8/8/4k3/8/8/4K3/R7/r7 w - - 0 40"]\n\n40. Ra3'
    assert identify_opening(pgn, "white") is None
