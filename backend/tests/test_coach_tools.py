import json
import sys
from pathlib import Path

import chess
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.coach_tools import (  # noqa: E402
    CoachToolkit,
    EngineSession,
    analyze_move,
    find_threats,
    hanging_pieces,
    line_outcome,
    line_outcome_text,
    parse_moves,
    play_line,
    position_features,
    square_info,
    static_exchange,
)
from services.engine_service import find_stockfish  # noqa: E402


def stockfish_available() -> bool:
    try:
        find_stockfish()
        return True
    except FileNotFoundError:
        return False


needs_stockfish = pytest.mark.skipif(not stockfish_available(), reason="Stockfish not installed")

# Positions from opening theory (backend/data/openings.tsv), each with a knight move that loses material.
# Italian Game, Greco Gambit: 6... Nb8?? leaves the f6 knight to the e5 pawn.
ITALIAN = "r1bqk2r/pppp1ppp/2n2n2/2b1P3/2Bp4/2P2N2/PP3PPP/RNBQK2R b KQkq - 0 6"
# Semi-Tarrasch: 7... Na6? allows 8. Bb5+ Bd7 9. Bxd7+ Qxd7, a trade of bishops, not a lost bishop.
SEMI_TARRASCH = "rnbqkb1r/pp3ppp/4p3/2p5/3PP3/2P2N2/P4PPP/R1BQKB1R b KQkq - 0 7"
# Philidor, Jaenisch: after 6... Nd7?, 7. Qh5+ Ke7 8. Bxh6 wins the h6 knight with a check first.
PHILIDOR_AFTER_ND7 = "r1bqkb1r/pppn2pN/3p3n/5p2/2BpP3/8/PPP2PPP/RNBQK2R w KQkq - 1 7"


@pytest.fixture
def engine():
    session = EngineSession()
    yield session
    session.close()


# --- pure board helpers ---

def test_static_exchange_counts_recaptures():
    # Nxe5 dxe5? No: the e5 pawn is defended by d6, so Nxe5 dxe5 loses the knight for a pawn.
    board = chess.Board("rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3")
    assert static_exchange(board, board.parse_san("Nxe5")) == 1 - 3
    # An undefended pawn is simply won.
    board = chess.Board("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2")
    board.remove_piece_at(chess.D7)
    board.remove_piece_at(chess.B8)
    board.remove_piece_at(chess.D8)
    assert static_exchange(board, board.parse_san("Nxe5")) == 1


def test_hanging_pieces_after_the_italian_blunder():
    board = chess.Board(ITALIAN)
    board.push_san("Nb8")
    hanging = hanging_pieces(board, chess.BLACK)
    assert hanging[chess.F6] == 2  # exf6 and a recapture: knight for pawn


def test_line_outcome_reads_a_trade_as_a_trade():
    board = chess.Board(SEMI_TARRASCH)
    moves, error = parse_moves(board, "7... Na6 8. Bb5+ Bd7 9. Bxd7+ Qxd7 10. Ne5")
    assert error is None and len(moves) == 6
    outcome = line_outcome(board, moves, chess.BLACK)
    assert outcome["after_the_exchanges"] == "no material change for Black"
    assert "9. Bxd7+ takes the Black bishop on d7" in outcome["captures"]


def test_line_outcome_reads_past_quiet_moves_before_the_first_capture():
    # Scandinavian: 7... Nb8 8. a3 Bxc3 9. Bxc3 is a trade even though two quiet moves come first.
    board = chess.Board("r1b1k1nr/ppp2ppp/2n5/q3P3/1b6/2N2N2/PPPB1PPP/R2QKB1R b KQkq - 4 7")
    moves, _ = parse_moves(board, "7... Nb8 8. a3 Bxc3 9. Bxc3 Qb6 10. Bc4 Be6")
    outcome = line_outcome(board, moves, chess.BLACK)
    assert outcome["after_the_exchanges"] == "no material change for Black"
    assert outcome["exchanges_end_after"] == "7...Nb8 8. a3 Bxc3 9. Bxc3"


def test_line_outcome_counts_a_tactic_that_starts_with_a_check():
    board = chess.Board(PHILIDOR_AFTER_ND7)
    moves, _ = parse_moves(board, ["Qh5+", "Ke7", "Bxh6", "d5"])
    assert line_outcome(board, moves, chess.WHITE)["after_the_exchanges"] == "White wins 3 points of material"


def test_parse_moves_accepts_numbered_moves_in_any_form():
    board = chess.Board(ITALIAN)
    for text in (["6... Nb8", "7. exf6"], "6...Nb8 7.exf6", "6. ... Nb8 7. exf6!", ["c6b8", "e5f6"]):
        moves, error = parse_moves(board, text)
        assert error is None and [m.uci() for m in moves] == ["c6b8", "e5f6"], text


def test_parse_moves_reports_an_illegal_move_with_the_legal_ones():
    board = chess.Board(PHILIDOR_AFTER_ND7)
    moves, error = parse_moves(board, "7. Qh5+ Kd7 8. Bxh6")
    assert [board.san(m) for m in moves] == ["Qh5+"]
    assert error["illegal_move"] == "Kd7"
    assert "Ke7" in error["legal_moves"]


def test_line_outcome_text_for_the_prompts():
    board = chess.Board(ITALIAN)
    board.push_san("Nb8")
    text = line_outcome_text(board.fen(), "7. exf6 d5 8. fxg7 Rg8 9. Be2")
    assert text.startswith("White wins 4 points of material")
    assert line_outcome_text(board.fen(), "") is None
    assert line_outcome_text("not a fen", "7. exf6") is None


def test_position_features():
    board = chess.Board(ITALIAN)
    features = position_features(board)
    assert features["black"]["pawns"]["doubled"] == ["d4", "d7"]
    assert "not castled yet" in features["white"]["king"]
    assert "Black bishop on c8" in features["black"]["minor_pieces_still_at_home"]


# --- tools with the engine ---

@needs_stockfish
def test_analyze_move_finds_the_threat_the_move_ignored(engine):
    result = analyze_move(engine, ITALIAN, "Nb8")
    assert result["move"] == "6... Nb8"
    assert result["opponent_best_reply"] == "7. exf6"
    assert any("knight on f6" in threat for threat in result["threats_the_move_ignored"])
    assert result["material_outcome_for_black"]["after_the_exchanges"].startswith("Black loses")


@needs_stockfish
def test_analyze_move_does_not_call_a_trade_a_loss(engine):
    result = analyze_move(engine, SEMI_TARRASCH, "Na6")
    assert result["engine_best_move_instead"] != "7... Na6"
    assert result["material_outcome_for_black"]["after_the_exchanges"] == "no material change for Black"


@needs_stockfish
def test_analyze_move_rejects_an_illegal_move(engine):
    result = analyze_move(engine, ITALIAN, "Nb5")  # the c6 knight cannot reach b5
    assert "error" in result


@needs_stockfish
def test_play_line_and_threats(engine):
    line = play_line(engine, PHILIDOR_AFTER_ND7, "7. Qh5+ Ke7 8. Bxh6")
    assert line["material_outcome_for_white"]["after_the_exchanges"] == "White wins 3 points of material"
    assert "evaluation" in line["final_position"]

    threats = find_threats(engine, PHILIDOR_AFTER_ND7)
    assert any("knight on h7" in item for item in threats["white_pieces_that_can_be_won"])
    assert "7. Qh5+" in threats["checks_available"]
    assert "black_threat_if_white_passed" in threats


@needs_stockfish
def test_play_line_warns_when_it_stops_mid_exchange(engine):
    board = chess.Board(SEMI_TARRASCH)
    board.push_san("Na6")
    result = play_line(engine, board.fen(), "8. Bb5+ Bd7 9. Bxd7+")
    assert result["material_outcome_for_white"]["after_the_exchanges"] == "White wins 3 points of material"
    assert result["material_outcome_with_best_play_after_it"] == "no material change for White"
    assert "middle of an exchange" in result["warning"]


@needs_stockfish
def test_square_info(engine):
    info = square_info(engine, PHILIDOR_AFTER_ND7, "h7")
    assert info["occupant"] == "White knight on h7"
    assert info["attacked_by_black"] == ["rook h8"]
    assert info["can_be_won"].startswith("yes")


@needs_stockfish
def test_toolkit_budget_and_errors():
    with CoachToolkit(max_calls=2) as kit:
        assert "error" in json.loads(kit.call("square_info", json.dumps({"fen": "bad fen", "square": "e4"})))
        assert "error" in json.loads(kit.call("no_such_tool", "{}"))
        assert "error" in json.loads(kit.call("square_info", "not json"))
        result = json.loads(kit.call("square_info", json.dumps({"fen": ITALIAN, "square": "f6"})))
        assert result["occupant"] == "Black knight on f6"
        assert kit.exhausted
        assert "No more checks" in json.loads(kit.call("square_info", json.dumps({"fen": ITALIAN, "square": "e5"})))["error"]
        assert kit.calls == ["verificou a casa e4", "verificou a casa f6"]
