# ♟️ Resource and Reference Guide: Chess Trainer System

This document gathers the main links, libraries, datasets, and standards used in the development of the Chess Trainer System project.

---

## 📌 Chess Notations and Standards

* **[FEN (Forsyth-Edwards Notation)](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation)**
  * *Description:* A concise, single-line text standard used to record the exact state of any board position (piece placement, active color, castling rights, *en passant* target square, and move counters)
  
* **[PGN (Portable Game Notation)](https://en.wikipedia.org/wiki/Portable_Game_Notation)**
  * *Description:* A human- and computer-readable format for recording complete move sequences, variations, comments, and game metadata (event, date, players, result)

* **[UCI Protocol (Universal Chess Interface)](https://www.chessprogramming.org/UCI)**
  * *Description:* An open, text-based communication protocol that standardizes the transmission of commands and the reception of analyses between graphical interfaces/backends and chess engines (like Stockfish)

---

## 🛠️ Libraries and Tools

* **[python-chess](https://python-chess.readthedocs.io/)**
  * *Description:* An essential Python library for backend game state manipulation, rule validation, legal move generation, FEN/PGN parsing, and subprocess integration with UCI engines

* **[FastAPI](https://fastapi.tiangolo.com/)**
  * *Description:* A modern, fast web framework used to build the Python backend REST API, managing endpoints for engine moves and move analysis[cite: 3].

* **[React](https://react.dev/) & [react-chessboard](https://www.npmjs.com/package/react-chessboard)**
  * *Description:* The core UI framework and a lightweight, responsive library used for rendering and interactively controlling the chessboard on the frontend[cite: 1, 3].

* **[chess.js](https://github.com/jhlywa/chess.js)**
  * *Description:* A JavaScript chess library used on the frontend for move generation, validation, piece placement, and check/mate detection before sending data to the backend[cite: 3].

* **[Stockfish Engine](https://stockfishchess.org/)**
  * *Description:* A high-performance, open-source chess engine used to quantitatively evaluate positions (centipawns/mate scores) and calculate the best tactical lines (PV - *Principal Variation*)
  * *Install (Ubuntu):* `sudo apt install stockfish`

---

## 📊 Datasets and Theoretical Bases

* **[Lichess Open Database](https://database.lichess.org/)**
  * *Description:* A public repository with billions of evaluated games, puzzle databases classified by tactical themes, and open statistical data

* **[ChessEval Dataset (Hugging Face)](https://huggingface.co/datasets)**
  * *Description:* Collections of engine-evaluated and semantically annotated positions, useful for calibrating and providing structured context to LLM prompts

* **[Chess Openings & ECO Codes (365Chess)](https://www.365chess.com/eco.php)**
  * *Description:* A structured catalog of the Encyclopedia of Chess Openings (ECO), useful for mapping theoretical lines and naming openings played in training games