from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import services
from services.engine_service import get_move_analysis, get_engine_move
from services.llm_service import (
    DEFAULT_PROVIDER,
    LLMError,
    LLMNotConfiguredError,
    generate_move_evaluation,
    get_provider_options,
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

class MoveEvaluationRequest(BaseModel):
    move_analysis: EngineAnalysisResponse
    # BYOK settings; an omitted model or base_url falls back to the provider's default
    provider: str = DEFAULT_PROVIDER
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None

class MoveEvaluationResponse(BaseModel):
    evaluation: str

class LLMProviderOption(BaseModel):
    label: str
    model: str
    base_url: str
    requires_api_key: bool
    uses_llm: bool

class LLMProvidersResponse(BaseModel):
    default_provider: str
    providers: dict[str, LLMProviderOption]

# --- API Endpoints ---

@app.post("/api/engine-move", response_model=EngineMoveResponse)
def engine_move(payload: EngineMoveRequest):
    """Calculates the best response move from Stockfish for the opponent."""
    try:
        return {"engine_move": get_engine_move(payload.fen)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stockfish analysis failure: {str(e)}")


@app.get("/api/llm-providers", response_model=LLMProvidersResponse)
def llm_providers():
    """Lists the LLM providers the user can configure and their default settings."""
    return get_provider_options()


@app.post("/api/move-evaluation", response_model=MoveEvaluationResponse)
def move_evaluation(payload: MoveEvaluationRequest):
    try:
        evaluation = generate_move_evaluation(
            payload.move_analysis.model_dump(),
            provider=payload.provider,
            api_key=payload.api_key,
            model=payload.model,
            base_url=payload.base_url,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LLMError as e:
        raise HTTPException(status_code=502, detail=f"LLM provider error: {e}")
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"LLM configuration error: {e}")

    return MoveEvaluationResponse(evaluation=evaluation)

if __name__ == "__main__":
    uvicorn.run("chess_trainer_system_server:app", host="0.0.0.0", port=8000, reload=True)