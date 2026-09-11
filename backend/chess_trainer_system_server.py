import os
import sys
from typing import Optional
import chess
import chess.engine
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from classifier import classify_target_move

# Import formatting and parsing routines from POC
from chess_trainer_system_poc import (
    parse_board,
    format_analysis_summary,
    format_analysis_block
)

app = FastAPI(title="Chess Trainer System API")

# Enable CORS for Vite / React development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STOCKFISH_PATH = "/usr/games/stockfish" if os.path.exists("/usr/games/stockfish") else "stockfish"

# --- Request / Response Contracts ---
class EngineMoveRequest(BaseModel):
    fen: str

class EngineMoveResponse(BaseModel):
    engine_move_uci: str

class AnalysisRequest(BaseModel):
    fen: str
    prompt: Optional[str] = (
        "The user wants to understand the engine evaluation of this position. "
        "Explain like a coach. If possible, suggest theoretical lines."
    )

class EvaluateMoveRequest(BaseModel):
    fen: str
    move_uci: str

class EvaluateMoveResponse(BaseModel):
    move: str
    classification: str
    win_percent_loss: float


# --- API Endpoints ---

@app.post("/api/engine-move", response_model=EngineMoveResponse)
def get_engine_move(payload: EngineMoveRequest):
    """Calculates the best response move from Stockfish for the opponent."""
    board = parse_board(payload.fen)
    if not board:
        raise HTTPException(status_code=400, detail="Invalid FEN string")

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Game is already over")

    try:
        with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
            result = engine.play(board, chess.engine.Limit(time=0.3))
            if not result.move:
                raise HTTPException(status_code=500, detail="No legal move found by engine")
            return EngineMoveResponse(engine_move_uci=result.move.uci())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stockfish engine error: {str(e)}")


@app.post("/api/analyze-move")
def analyze_position(payload: AnalysisRequest):
    """
    Evaluates the position using Stockfish (depth 20)
    and formats the coach prompt.
    """
    board = parse_board(payload.fen)
    if not board:
        raise HTTPException(status_code=400, detail="Invalid FEN string")

    try:
        with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
            search_limit = chess.engine.Limit(depth=20)
            eval_result = engine.analyse(board, search_limit)

            summary = format_analysis_summary(
                board,
                eval_result,
                label="CURRENT POSITION EVALUATION"
            )
            
            base_prompt = payload.prompt.strip() if payload.prompt else ""
            output_prompt = base_prompt + "\n" + format_analysis_block(summary)

            return {"prompt": output_prompt}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stockfish analysis failure: {str(e)}")


class EvaluateMoveRequest(BaseModel):
    fen: str
    move_uci: str

class EvaluateMoveResponse(BaseModel):
    move: str
    classification: Optional[str] = None
    win_percent_loss: float


@app.post("/api/evaluate-move", response_model=EvaluateMoveResponse)
def evaluate_move_endpoint(payload: EvaluateMoveRequest):
    board = parse_board(payload.fen)
    if not board:
        raise HTTPException(status_code=400, detail="Invalid FEN string")

    try:
        user_move = chess.Move.from_uci(payload.move_uci)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid UCI move syntax: {payload.move_uci}")

    if user_move not in board.legal_moves:
        raise HTTPException(
            status_code=400, 
            detail=f"Move {payload.move_uci} is illegal in position: {payload.fen}"
        )

    try:
        with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
            classification, delta = classify_target_move(board, user_move, engine, depth=16)

        return EvaluateMoveResponse(
            move=payload.move_uci,
            classification=classification,  # Agora aceita None com sucesso
            win_percent_loss=round(delta, 2)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification evaluation failure: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("chess_trainer_system_server:app", host="0.0.0.0", port=8000, reload=True)