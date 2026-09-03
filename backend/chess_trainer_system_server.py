import os
import sys
from typing import Optional
import chess
import chess.engine
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Importa as funções auxiliares de formatação diretamente da sua POC intacta
from chess_trainer_system_poc import (
    parse_board,
    format_analysis_summary,
    format_analysis_block
)

app = FastAPI(title="Chess Trainer System API")

# Habilita CORS para o Vite / React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STOCKFISH_PATH = "/usr/games/stockfish" if os.path.exists("/usr/games/stockfish") else "stockfish"

# --- Contratos esperados pelo seu Front-end atual ---
class EngineMoveRequest(BaseModel):
    fen: str

class EngineMoveResponse(BaseModel):
    engine_move_uci: str

class AnalysisRequest(BaseModel):
    fen: str
    prompt: Optional[str] = "The user want to uderstand the engine evaluation of this position, explain like a coach."


# --- Endpoints REST ---

@app.post("/api/engine-move", response_model=EngineMoveResponse)
def get_engine_move(payload: EngineMoveRequest):
    """Calcula a melhor resposta do Stockfish para o lance do adversário."""
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
    Avalia a posição enviada pelo front-end no Stockfish (depth 20)
    e formata o prompt do treinador sem exigir o lance anterior.
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
            
            output_prompt = payload.prompt.strip() + "\n" + format_analysis_block(summary)

            return {"prompt": output_prompt}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stockfish analysis failure: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("chess_trainer_system_server:app", host="0.0.0.0", port=8000, reload=True)