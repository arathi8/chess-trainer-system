from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import services
from services.engine_service import get_move_analysis, get_engine_move
from services.llm_service import generate_prompt
app = FastAPI(title="Chess Trainer System API")

# Enable CORS for Vite / React development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Request / Response Contracts ---
class EngineMoveRequest(BaseModel):
    fen: str

class EngineMoveResponse(BaseModel):
    engine_move: str

class EngineAnalysisRequest(BaseModel):
    fen: str  
    move: str  

class EngineAnalysisResponse(BaseModel):
    before_move_analysis: dict
    after_move_analysis: dict
    move_classification: str
    move_delta: float

class SemanticEvaluationRequest(BaseModel):
    before_move_analysis: dict
    after_move_analysis: dict
    move_classification: str
    move_delta: float

class SemanticEvaluationResponse(BaseModel):
    evaluation: str

# --- API Endpoints ---

@app.post("/api/engine-move", response_model=EngineMoveResponse)
def engine_move(payload: EngineMoveRequest):
    """Calculates the best response move from Stockfish for the opponent."""
    fen = payload.fen

    try:
        engine_move = get_engine_move(fen)
        return {"engine_move": engine_move}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stockfish engine error: {str(e)}")


@app.post("/api/engine-analysis",response_model=EngineAnalysisResponse)
def move_analysis(payload: EngineAnalysisRequest):

    fen = payload.fen
    move = payload.move

    try:
        move_analysis = get_move_analysis(fen, move)
        if move_analysis is None:
            raise HTTPException(
                status_code=400, 
                detail="Falha na avaliação. Verifique a string FEN, a validade do lance ou o binário do Stockfish."
            )
        return move_analysis

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stockfish analysis failure: {str(e)}")


@app.post("/api/semantic-evaluation", response_model=SemanticEvaluationResponse)
def evaluation_result(payload: SemanticEvaluationRequest):
    
    evaluation = generate_prompt(
        before_analysis=payload.before_move_analysis,
        after_analysis=payload.after_move_analysis,
        classification=payload.move_classification,
        win_loss_delta=payload.move_delta
    )

    return SemanticEvaluationResponse(evaluation=evaluation)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("chess_trainer_system_server:app", host="0.0.0.0", port=8000, reload=True)