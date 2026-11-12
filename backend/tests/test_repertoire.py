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
