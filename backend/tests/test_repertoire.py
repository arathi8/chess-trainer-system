import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.repertoire_service import (  # noqa: E402
    UnknownOpeningError,
    belongs_to,
    build_repertoire_tree,
    list_repertoire_catalog,
    variation_of,
)

NAJDORF = "Sicilian Defense: Najdorf Variation"


def family(catalog, name):
    return next(f for f in catalog if f["name"] == name)


def walk(node, sans):
    """Follows a SAN path from `node`; fails if a move is not in the tree."""
    for san in sans:
        node = next((c for c in node["children"] if c["san"] == san), None)
        assert node is not None, f"{san} not in tree"
    return node


def test_name_helpers():
    assert variation_of("Sicilian Defense: Najdorf Variation, English Attack") == NAJDORF
    assert variation_of("Sicilian Defense") is None
    assert belongs_to("Sicilian Defense: Najdorf Variation, English Attack", NAJDORF)
    assert belongs_to(NAJDORF, NAJDORF)
    assert not belongs_to("Sicilian Defense: Najdorf Variation", "Sicilian Defense: Naj")


def test_catalog_default_colors():
    catalog = list_repertoire_catalog()
    assert family(catalog, "Sicilian Defense")["default_color"] == "black"
    assert family(catalog, "Ruy Lopez")["default_color"] == "white"
    assert family(catalog, "French Defense")["default_color"] == "black"


def test_catalog_lists_variations():
    sicilian = family(list_repertoire_catalog(), "Sicilian Defense")
    assert sicilian["lines"] >= 300
    najdorf = next(v for v in sicilian["variations"] if v["name"] == NAJDORF)
    assert najdorf["default_color"] == "black"  # inherits the family's colour
    assert najdorf["reference_line"].startswith("1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6")


def test_najdorf_tree():
    data = build_repertoire_tree(NAJDORF)
    root = data["tree"]
    assert root["san"] is None and root["ply"] == 0

    node = walk(root, ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"])
    assert node["ply"] == 10
    assert node["opening"]["name"] == NAJDORF
    assert node["children"], "the Najdorf has variations after 5...a6"


def test_tree_children_sorted_by_popularity():
    def check(node):
        pops = [c["popularity"] for c in node["children"]]
        assert pops == sorted(pops, reverse=True)
        for child in node["children"]:
            check(child)

    check(build_repertoire_tree("Ruy Lopez")["tree"])


def test_tree_leaves_end_named_lines():
    def leaves(node):
        if not node["children"]:
            yield node
        for child in node["children"]:
            yield from leaves(child)

    assert all(leaf["opening"] for leaf in leaves(build_repertoire_tree(NAJDORF)["tree"]))


def test_unknown_opening():
    with pytest.raises(UnknownOpeningError):
        build_repertoire_tree("Not An Opening")


def test_repertoire_endpoints():
    from fastapi.testclient import TestClient
    from chess_trainer_system_server import app

    client = TestClient(app)
    response = client.get("/api/repertoire/catalog")
    assert response.status_code == 200
    assert any(f["name"] == "Sicilian Defense" for f in response.json()["families"])

    response = client.get("/api/repertoire/tree", params={"name": NAJDORF})
    assert response.status_code == 200
    assert response.json()["tree"]["children"][0]["san"] == "e4"

    response = client.get("/api/repertoire/tree", params={"name": "Not An Opening"})
    assert response.status_code == 404


# --- phase 4: opening presentation and "why this move?" ---

NAJDORF_UCIS = ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"]

FAKE_POSITION = {
    "fen": "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6",
    "best_move": "c1e3 (Be3)",
    "evaluation": "+0.30 pawns",
    "depth": 20,
    "line": "6. Be3 e5 7. Nb3",
}


@pytest.fixture
def client(monkeypatch):
    """API client with Stockfish replaced by fixed analyses, so these tests neither need nor wait for it."""
    from fastapi.testclient import TestClient
    import chess_trainer_system_server as server

    monkeypatch.setattr(server, "get_position_analysis", lambda fen: FAKE_POSITION)
    monkeypatch.setattr(server, "get_move_analysis", lambda fen, move: {
        "before_move_analysis": {**FAKE_POSITION, "label": "x"},
        "after_move_analysis": FAKE_POSITION,
        "move_classification": "Best Move",
        "move_delta": 0.0,
    })
    return TestClient(server.app)


def test_opening_overview_lists_main_variations():
    from services.repertoire_service import opening_overview

    overview = opening_overview("Sicilian Defense")
    assert overview["reference_line"] == "1. e4 c5"
    names = [v["name"] for v in overview["variations"]]
    assert len(names) == 5
    assert all(name.startswith("Sicilian Defense: ") and "," not in name for name in names)
    counts = [v["lines"] for v in overview["variations"]]
    assert counts == sorted(counts, reverse=True)


def test_theory_move_context():
    from services.repertoire_service import NotInTheoryError, theory_move_context

    ctx = theory_move_context(NAJDORF, NAJDORF_UCIS)
    assert ctx["move_san"] == "a6" and ctx["mover"] == "black" and ctx["ply"] == 9
    assert ctx["opening"]["name"] == NAJDORF
    assert ctx["next_theory"], "the Najdorf goes on after 5...a6"

    with pytest.raises(NotInTheoryError):
        theory_move_context(NAJDORF, ["e2e4", "c7c5", "a2a3"])


def test_intro_endpoint_prompt(client):
    response = client.post("/api/repertoire/intro", json={"name": NAJDORF, "color": "black", "provider": "prompt"})
    assert response.status_code == 200
    prompt = response.json()["intro"]
    assert "português" in prompt and "pretas" in prompt
    assert "B90" in prompt and "5. Nc3 a6" in prompt
    assert "+0.30 pawns" in prompt  # Stockfish's evaluation of the reference position


def test_explain_move_endpoint_prompt(client):
    response = client.post(
        "/api/repertoire/explain-move",
        json={"name": NAJDORF, "color": "black", "moves": NAJDORF_UCIS, "provider": "prompt"},
    )
    assert response.status_code == 200
    prompt = response.json()["explanation"]
    assert "5... a6" in prompt and "jogado pelo aluno" in prompt
    assert "Best Move" in prompt and "Be3" in prompt

    # The opponent's move is explained from the user's side
    response = client.post(
        "/api/repertoire/explain-move",
        json={"name": NAJDORF, "color": "black", "moves": NAJDORF_UCIS[:9], "provider": "prompt"},
    )
    assert "jogado pelo oponente" in response.json()["explanation"]


def test_repertoire_llm_errors(client):
    base = {"name": NAJDORF, "color": "black"}
    assert client.post("/api/repertoire/intro", json={**base, "provider": "gemini"}).status_code == 400
    assert client.post("/api/repertoire/intro", json={**base, "name": "Nope", "provider": "prompt"}).status_code == 404
    off_book = {**base, "moves": ["e2e4", "c7c5", "a2a3"], "provider": "prompt"}
    assert client.post("/api/repertoire/explain-move", json=off_book).status_code == 400
