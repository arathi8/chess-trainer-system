"""Repertoire training: a catalog of openings to study and the theory tree of the chosen one.

Built from the same Lichess dataset as openings_service. Dataset names look like
"Family: Variation, Subvariation"; the catalog groups lines by family and by variation.
"""

from typing import Any, Dict, List, Optional

import chess

from services.openings_service import OpeningLine, load_openings, position_key


class UnknownOpeningError(ValueError):
    """No dataset line belongs to the requested opening name."""


class NotInTheoryError(ValueError):
    """A move sequence that leaves the opening's theory tree."""


MAX_INTRO_VARIATIONS = 5


def family_of(name: str) -> str:
    return name.split(":", 1)[0].strip()


def variation_of(name: str) -> Optional[str]:
    """'Sicilian Defense: Najdorf Variation, English Attack' -> 'Sicilian Defense: Najdorf Variation'."""
    if ":" not in name:
        return None
    family, rest = name.split(":", 1)
    return f"{family.strip()}: {rest.split(',', 1)[0].strip()}"


def belongs_to(line_name: str, opening_name: str) -> bool:
    """Whether a dataset line is the opening itself or one of its variations/subvariations."""
    return line_name == opening_name or line_name.startswith((opening_name + ":", opening_name + ","))


def reference_line(lines: List[OpeningLine], opening_name: str) -> OpeningLine:
    """The line carrying exactly this name (shortest first), else the shortest line of the group."""
    exact = [line for line in lines if line.name == opening_name]
    return min(exact or lines, key=lambda line: len(line.moves))


def side_of_last_move(line: OpeningLine) -> str:
    """Who played the move that defines the opening: 1. e4 c5 -> black, 1. e4 e5 2. Nf3 Nc6 3. Bb5 -> white."""
    return "white" if len(line.moves) % 2 == 1 else "black"


def catalog_entry(lines: List[OpeningLine], opening_name: str, default_color: str) -> Dict[str, Any]:
    ref = reference_line(lines, opening_name)
    return {
        "name": opening_name,
        "eco": ref.eco,
        "reference_line": ref.pgn,
        "lines": len(lines),
        "default_color": default_color,
    }


def list_repertoire_catalog() -> List[Dict[str, Any]]:
    """
    Families sorted by name, each with its variations. A variation inherits the family's default
    colour: the Alapin (1. e4 c5 2. c3) is still studied as part of a Black repertoire by default.
    """
    families: Dict[str, List[OpeningLine]] = {}
    for line in load_openings().lines:
        families.setdefault(family_of(line.name), []).append(line)

    catalog = []
    for family_name in sorted(families):
        family_lines = families[family_name]
        color = side_of_last_move(reference_line(family_lines, family_name))

        variations: Dict[str, List[OpeningLine]] = {}
        for line in family_lines:
            variation = variation_of(line.name)
            if variation:
                variations.setdefault(variation, []).append(line)

        catalog.append({
            **catalog_entry(family_lines, family_name, color),
            "variations": [
                catalog_entry(variations[name], name, color) for name in sorted(variations)
            ],
        })
    return catalog


def build_repertoire_tree(opening_name: str) -> Dict[str, Any]:
    """
    Merges every line of the opening (and its variations) into one move tree rooted at the
    starting position. Children are sorted most mainstream first, using how many dataset lines
    pass through the resulting position. `opening` names the lines of this opening that end on a
    node; a node without children is the end of a line.
    """
    index = load_openings()
    lines = [line for line in index.lines if belongs_to(line.name, opening_name)]
    if not lines:
        raise UnknownOpeningError(f"Unknown opening: {opening_name}")

    start = chess.Board()
    root: Dict[str, Any] = {
        "san": None, "uci": None, "fen": start.fen(), "ply": 0, "popularity": 0, "opening": None, "children": [],
    }

    for line in lines:
        board = start.copy()
        node = root
        for move in line.moves:
            uci = move.uci()
            child = next((c for c in node["children"] if c["uci"] == uci), None)
            if child is None:
                san = board.san(move)
                board.push(move)
                child = {
                    "san": san,
                    "uci": uci,
                    "fen": board.fen(),
                    "ply": board.ply(),
                    "popularity": index.book[position_key(board)],
                    "opening": None,
                    "children": [],
                }
                node["children"].append(child)
            else:
                board.push(move)
            node = child
        # Several dataset lines can end on one position: keep the most specific (longest) name.
        if node["opening"] is None or len(line.name) > len(node["opening"]["name"]):
            node["opening"] = {"eco": line.eco, "name": line.name}

    sort_children(root)
    ref = reference_line(lines, opening_name)
    return {
        "name": opening_name,
        "eco": ref.eco,
        "reference_line": ref.pgn,
        "lines": len(lines),
        "tree": root,
    }


def sort_children(node: Dict[str, Any]) -> None:
    node["children"].sort(key=lambda c: (-c["popularity"], c["san"]))
    for child in node["children"]:
        sort_children(child)


def opening_lines_of(opening_name: str) -> List[OpeningLine]:
    lines = [line for line in load_openings().lines if belongs_to(line.name, opening_name)]
    if not lines:
        raise UnknownOpeningError(f"Unknown opening: {opening_name}")
    return lines


def sub_opening_name(line_name: str, opening_name: str) -> Optional[str]:
    """
    The name one level below `opening_name`: for the family 'Sicilian Defense', the line
    'Sicilian Defense: Najdorf Variation, English Attack' belongs to 'Sicilian Defense: Najdorf Variation';
    for that variation, to '... Najdorf Variation, English Attack'. None for the opening itself.
    """
    rest = line_name[len(opening_name):]
    if not rest:
        return None
    return opening_name + rest[0] + rest[1:].split(",", 1)[0]


def opening_overview(opening_name: str) -> Dict[str, Any]:
    """
    Grounding data to present an opening: its reference line and final position, and its most
    mainstream sub-openings (the ones with the most dataset lines), each with its shortest line.
    """
    lines = opening_lines_of(opening_name)
    ref = reference_line(lines, opening_name)
    board = chess.Board()
    for move in ref.moves:
        board.push(move)

    groups: Dict[str, List[OpeningLine]] = {}
    for line in lines:
        sub = sub_opening_name(line.name, opening_name)
        if sub:
            groups.setdefault(sub, []).append(line)
    ranked = sorted(groups.items(), key=lambda item: (-len(item[1]), item[0]))[:MAX_INTRO_VARIATIONS]

    return {
        "name": opening_name,
        "eco": ref.eco,
        "reference_line": ref.pgn,
        "reference_fen": board.fen(),
        "lines": len(lines),
        "variations": [
            {"name": name, "lines": len(group), "line": min(group, key=lambda line: len(line.moves)).pgn}
            for name, group in ranked
        ],
    }


def theory_move_context(opening_name: str, ucis: List[str]) -> Dict[str, Any]:
    """
    Where a theoretical move sits in the opening's tree: the position before it, the move, the other
    theoretical options there and the theoretical replies after it. `ucis` runs from the starting
    position up to and including the move. Raises NotInTheoryError if the sequence leaves the tree.
    """
    if not ucis:
        raise NotInTheoryError("No move given")
    tree = build_repertoire_tree(opening_name)["tree"]

    node = parent = tree
    opening = None
    line_sans: List[str] = []
    for uci in ucis:
        child = next((c for c in node["children"] if c["uci"] == uci), None)
        if child is None:
            raise NotInTheoryError(f"{uci} is not in the theory of {opening_name}")
        parent, node = node, child
        opening = child["opening"] or opening
        line_sans.append(child["san"])

    return {
        "fen_before": parent["fen"],
        "move_uci": node["uci"],
        "move_san": node["san"],
        "ply": parent["ply"],
        "mover": "white" if parent["ply"] % 2 == 0 else "black",
        "line_sans": line_sans,
        "alternatives": [c["san"] for c in parent["children"] if c["uci"] != node["uci"]],
        "next_theory": [c["san"] for c in node["children"]],
        "opening": opening,
    }
