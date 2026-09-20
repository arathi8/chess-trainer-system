# ♟️ Chess Trainer System

An intelligent chess training and semantic analysis system developed for the **MC857A – IC UNICAMP (2026.2)** project.

This application provides a modern Single Page Application (SPA) built with **React (TypeScript)** and a **FastAPI (Python)** backend that natively runs **Stockfish** engine analysis. 

The system goes beyond raw engine evaluation (centipawns). It classifies the player's move technically (e.g., *Blunder*, *Inaccuracy*, *Best Move*) and then uses an LLM prompt generator to act as a chess coach, explaining the strategic reasoning behind the engine's assessment in a human-readable format.

---

## ✨ Features

* **Real-time Technical Classification:** Assigns accuracy badges (!, ?, ??) to user moves based on the mathematical drop in win probability.
* **Semantic Coach Feedback:** Generates contextual LLM prompts that compare the user's move with the optimal engine line.
* **Synchronous Play:** Play as White, Black, or Random against the Stockfish engine, with automated engine responses handling turn management.
* **History & Review Mode:** Navigate through the algebraic move history (PGN format) to review previous board states.
* 
---

## 📋 Prerequisites

* **Node.js** (v18+) and **Yarn** package manager
* **Python 3.10+**
* **Stockfish Engine** installed natively on your OS:
  * **Ubuntu/Debian:**
    ```bash
    sudo apt-get update && sudo apt-get install -y stockfish xclip
    ```
  * **macOS (Homebrew):**
    ```bash
    brew install stockfish
    ```
  * **Windows:** Download the compiled binary and add it to your system's `PATH`.

---

## 🚀 How to Run

### 1. Start the Backend (Python / FastAPI)
Open a dedicated terminal window for the server:

```bash
# Navigate to the backend directory
cd backend

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate       # On Windows use: .venv\Scripts\activate

# Upgrade pip and install required packages
pip install --upgrade pip
pip install -r requirements.txt

# Start the FastAPI server
python3 chess_trainer_system_server.py

```
> **The API will be available at:** `http://localhost:8000`
> Interactive API documentation (Swagger UI) is available at `http://localhost:8000/docs`.

### 2. Start the Frontend (React / Vite)
Open a second terminal window for the web interface:

```bash
# Navigate to the frontend directory
cd frontend

# Install dependencies via Yarn
yarn install

# Start the development server
yarn dev
```
> **The web application will be accessible at:** `http://localhost:5173`

---

## 🎮 How to Use the Application

1. Open the application in your browser (`http://localhost:5173`).
2. Click the **Novo jogo** button to start a new game.  
3. Drag and drop pieces on the central board. 
4. Each move you make is immediately validated and recorded in the left-hand navigation panel.
5. The system automatically classifies your move in the background and applies a badge (e.g., `??` for Blunder).
6. Click the **"Avaliar lance"** button in the right-hand panel. This gathers the calculated data from your last move and hits the `/semantic-evaluation` endpoint, displaying the detailed coach feedback explaining your position.