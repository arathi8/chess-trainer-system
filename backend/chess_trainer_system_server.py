import threading
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

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
    generate_game_report,
    generate_move_evaluation,
    get_provider_options,
)
from services.openings_service import identify_opening, load_openings
from services.report_service import compute_game_stats

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Indexing the openings dataset takes seconds: do it in the background so the server starts
    # at once and the first game report does not pay for it.
    threading.Thread(target=load_openings, name="openings-preload", daemon=True).start()
    yield


app = FastAPI(title="Chess Trainer System API", lifespan=lifespan)

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
    # Training games make the engine lenient towards early mistakes
    training: bool = False

class EngineMoveResponse(BaseModel):
    engine_move: str
    grace_applied: bool = False

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
    # Who played the evaluated move: the user or their opponent
    mover: Literal["user", "opponent"] = "user"
    # BYOK settings; an omitted model or base_url falls back to the provider's default
    provider: str = DEFAULT_PROVIDER
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None

class MoveEvaluationResponse(BaseModel):
    evaluation: str

class GameReportMove(BaseModel):
    ply: int
    san: str
    move_classification: str
    move_delta: float
    before_move_analysis: dict
    after_move_analysis: dict

class GameReportRequest(BaseModel):
    user_color: str
    result: str
    termination: str
    pgn: str = ""
    moves: list[GameReportMove]
    total_user_moves: Optional[int] = None
    lenient_plies: list[int] = []
    # True for games imported from a PGN rather than played against the engine
    imported: bool = False
    # BYOK settings, as in MoveEvaluationRequest
    provider: str = DEFAULT_PROVIDER
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None

class GameReportResponse(BaseModel):
    stats: dict[str, Any]
    report: Optional[str] = None
    report_error: Optional[str] = None

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
        engine_move, grace_applied = get_engine_move(payload.fen, training=payload.training)
        return {"engine_move": engine_move, "grace_applied": grace_applied}
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
            mover=payload.mover,
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

@app.post("/api/game-report", response_model=GameReportResponse)
def game_report(payload: GameReportRequest):
    """Builds the post-game report of a training game: stats always, LLM narrative when configured."""
    moves = [move.model_dump() for move in payload.moves]
    if not moves:
        raise HTTPException(status_code=400, detail="No analysed moves to report on.")

    try:
        stats = compute_game_stats(moves, payload.user_color, payload.total_user_moves)
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid move data: {e}")

    try:
        stats["opening"] = identify_opening(payload.pgn, payload.user_color)
    except ValueError:
        stats["opening"] = None

    try:
        report = generate_game_report(
            stats,
            result=payload.result,
            termination=payload.termination,
            pgn=payload.pgn,
            lenient_plies=payload.lenient_plies,
            imported=payload.imported,
            provider=payload.provider,
            api_key=payload.api_key,
            model=payload.model,
            base_url=payload.base_url,
        )
    except (LLMError, ValueError) as e:
        # LLMNotConfiguredError is a subclass: the stats are still useful without the narrative.
        return GameReportResponse(stats=stats, report_error=str(e))

    return GameReportResponse(stats=stats, report=report)


if __name__ == "__main__":
    uvicorn.run("chess_trainer_system_server:app", host="0.0.0.0", port=8000, reload=True)