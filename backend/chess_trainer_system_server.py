import os
import sys
from typing import Optional
import chess
import chess.engine
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from classifier import classify_target_move, extract_cp, cp_to_win_percent

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
    fen: str  # Posição ANTES do lance do usuário
    move_uci: str  # Lance jogado pelo usuário, em UCI
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
    Julga o lance que o USUÁRIO acabou de jogar, comparando a avaliação
    antes e depois do seu movimento — sempre do ponto de vista de quem
    jogou (o usuário), igual à lógica usada em classify_target_move.

    payload.fen é a posição ANTES do lance do usuário.
    payload.move_uci é o lance que o usuário jogou.
    """
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

    mover_color = board.turn  # Cor de quem fez o lance (o usuário)

    try:
        with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
            search_limit = chess.engine.Limit(depth=18)

            # Avaliação ANTES do lance (multipv=2 para saber o melhor lance real)
            before_analysis = engine.analyse(board, search_limit, multipv=2)
            best_line = before_analysis[0]
            best_move_engine = best_line["pv"][0]
            cp_best = extract_cp(best_line["score"], mover_color)

            best_move_san = board.san(best_move_engine)

            # Avaliação DEPOIS do lance do usuário, sempre do ponto de vista do usuário
            board_after = board.copy()
            board_after.push(user_move)
            after_analysis = engine.analyse(board_after, search_limit)
            score_after = after_analysis["score"]
            relative_after = score_after.pov(mover_color)

            if relative_after.is_mate():
                mate_in = relative_after.mate()
                if mate_in and mate_in > 0:
                    eval_value = 100.0
                    feedback = f"Excelente! Você tem mate em {mate_in} lance{'s' if mate_in > 1 else ''}!"
                else:
                    eval_value = -100.0
                    feedback = f"Cuidado! O oponente tem mate em {abs(mate_in)} lance{'s' if mate_in and abs(mate_in) > 1 else ''}!"
            else:
                cp_after = extract_cp(score_after, mover_color)
                eval_value = cp_after / 100.0

                win_best = cp_to_win_percent(cp_best)
                win_after = cp_to_win_percent(cp_after)
                delta_win = max(0.0, win_best - win_after)

                played_best = (user_move == best_move_engine) or (delta_win <= 0.05)

                if played_best:
                    feedback = f"Ótimo lance! Foi exatamente a melhor jogada da posição (+{eval_value:.1f})."
                elif delta_win > 25.0:
                    feedback = f"Isso foi um erro grave (perda de {delta_win:.0f}% de chances de vitória). O melhor lance era {best_move_san}."
                elif delta_win > 12.0:
                    feedback = f"Esse lance não foi bom (perda de {delta_win:.0f}%). Considere {best_move_san} em posições parecidas."
                elif delta_win > 5.0:
                    feedback = f"Pequena imprecisão (perda de {delta_win:.0f}%). {best_move_san} seria mais preciso."
                elif abs(eval_value) < 0.5:
                    feedback = "Lance sólido. Posição equilibrada, continue desenvolvendo suas peças e controle o centro."
                elif eval_value > 3.0:
                    feedback = f"Bom lance! Você mantém uma vantagem significativa (+{eval_value:.1f})."
                elif eval_value > 1.0:
                    feedback = f"Bom lance! Você está com vantagem (+{eval_value:.1f})."
                elif eval_value < -3.0:
                    feedback = f"Lance jogável, mas a posição está difícil ({eval_value:.1f}). Procure táticas defensivas."
                elif eval_value < -1.0:
                    feedback = f"Lance jogável, porém a situação é desfavorável ({eval_value:.1f})."
                else:
                    side = "ligeira vantagem" if eval_value > 0 else "leve desvantagem"
                    feedback = f"Lance razoável, posição com {side} ({eval_value:+.1f})."

            return {
                "prompt": feedback,
                "evaluation": round(eval_value, 2),
                "best_move": best_move_san
            }

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