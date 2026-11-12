import threading
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import services
from services.engine_service import get_move_analysis, get_engine_move, get_position_analysis
from services.llm_service import (
    DEFAULT_PROVIDER,
    LLMError,
    LLMNotConfiguredError,
    generate_game_report,
    generate_move_evaluation,
    generate_opening_intro,
    generate_theory_move_explanation,
    get_provider_options,
)
from services.openings_service import identify_opening, load_openings
from services.report_service import compute_game_stats
from services.repertoire_service import (
    NotInTheoryError,
    UnknownOpeningError,
    build_repertoire_tree,
    list_repertoire_catalog,
    opening_overview,
    theory_move_context,
)

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

class GameStatsRequest(BaseModel):
    user_color: str
    pgn: str = ""
    moves: list[GameReportMove]
    total_user_moves: Optional[int] = None

class GameStatsResponse(BaseModel):
    stats: dict[str, Any]

class GameReportRequest(BaseModel):
    # As returned by /api/game-stats
    stats: dict[str, Any]
    result: str
    termination: str
    pgn: str = ""
    lenient_plies: list[int] = []
    # True for games imported from a PGN rather than played against the engine
    imported: bool = False
    # BYOK settings, as in MoveEvaluationRequest
    provider: str = DEFAULT_PROVIDER
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None

class GameReportResponse(BaseModel):
    report: str

class LLMProviderOption(BaseModel):
    label: str
    model: str
    base_url: str
    requires_api_key: bool
    uses_llm: bool

class LLMProvidersResponse(BaseModel):
    default_provider: str
    providers: dict[str, LLMProviderOption]

class RepertoireOpening(BaseModel):
    name: str
    eco: str
    reference_line: str
    lines: int
    # Side that usually studies it: who plays the opening's defining move
    default_color: Literal["white", "black"]

class RepertoireFamily(RepertoireOpening):
    variations: list[RepertoireOpening]

class RepertoireCatalogResponse(BaseModel):
    families: list[RepertoireFamily]

class RepertoireNodeOpening(BaseModel):
    eco: str
    name: str

class RepertoireNode(BaseModel):
    # None only on the root (starting position)
    san: Optional[str]
    uci: Optional[str]
    fen: str
    ply: int
    popularity: int
    # Set when a named line of this opening ends here
    opening: Optional[RepertoireNodeOpening]
    # Most mainstream first; empty at the end of a line
    children: list["RepertoireNode"]

class RepertoireTreeResponse(BaseModel):
    name: str
    eco: str
    reference_line: str
    lines: int
    tree: RepertoireNode

class RepertoireIntroRequest(BaseModel):
    # Opening name as listed by /api/repertoire/catalog
    name: str
    color: Literal["white", "black"]
    # BYOK settings, as in MoveEvaluationRequest
    provider: str = DEFAULT_PROVIDER
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None

class RepertoireIntroResponse(BaseModel):
    intro: str

class RepertoireExplainMoveRequest(RepertoireIntroRequest):
    # UCI moves from the starting position up to and including the move to explain
    moves: list[str]

class RepertoireExplainMoveResponse(BaseModel):
    explanation: str

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

@app.post("/api/game-stats", response_model=GameStatsResponse)
def game_stats(payload: GameStatsRequest):
    """Deterministic part of the post-game report: accuracy, classifications, phases, key moments and opening."""
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

    return GameStatsResponse(stats=stats)


@app.post("/api/game-report", response_model=GameReportResponse)
def game_report(payload: GameReportRequest):
    """The coach's post-game report, written by the LLM from the stats of /api/game-stats."""
    try:
        report = generate_game_report(
            payload.stats,
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
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Invalid game stats: missing {e}")
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LLMError as e:
        raise HTTPException(status_code=502, detail=f"LLM provider error: {e}")
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"LLM configuration error: {e}")

    return GameReportResponse(report=report)


@app.get("/api/repertoire/catalog", response_model=RepertoireCatalogResponse)
def repertoire_catalog():
    """Openings and defences the user can study, grouped by family, from the Lichess dataset."""
    return RepertoireCatalogResponse(families=list_repertoire_catalog())


@app.get("/api/repertoire/tree", response_model=RepertoireTreeResponse)
def repertoire_tree(name: str):
    """Theory tree of one opening (family or variation name, as listed by /api/repertoire/catalog)."""
    try:
        return build_repertoire_tree(name)
    except UnknownOpeningError as e:
        raise HTTPException(status_code=404, detail=str(e))


def raise_llm_http_error(e: Exception):
    """Same HTTP errors as /api/move-evaluation and /api/game-report."""
    if isinstance(e, LLMNotConfiguredError):
        raise HTTPException(status_code=400, detail=str(e))
    if isinstance(e, LLMError):
        raise HTTPException(status_code=502, detail=f"LLM provider error: {e}")
    raise HTTPException(status_code=500, detail=f"LLM configuration error: {e}")


@app.post("/api/repertoire/intro", response_model=RepertoireIntroResponse)
def repertoire_intro(payload: RepertoireIntroRequest):
    """The coach presents the opening, grounded on its theory and Stockfish's view of the reference line."""
    try:
        overview = opening_overview(payload.name)
    except UnknownOpeningError as e:
        raise HTTPException(status_code=404, detail=str(e))

    analysis = get_position_analysis(overview["reference_fen"])  # None if Stockfish fails: the prompt says so
    try:
        intro = generate_opening_intro(
            overview,
            payload.color,
            analysis,
            provider=payload.provider,
            api_key=payload.api_key,
            model=payload.model,
            base_url=payload.base_url,
        )
    except (LLMError, ValueError) as e:
        raise_llm_http_error(e)
    return RepertoireIntroResponse(intro=intro)


@app.post("/api/repertoire/explain-move", response_model=RepertoireExplainMoveResponse)
def repertoire_explain_move(payload: RepertoireExplainMoveRequest):
    """Why theory plays a move of the line, grounded on the theory tree and Stockfish's analysis of the move."""
    try:
        context = theory_move_context(payload.name, payload.moves)
    except UnknownOpeningError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NotInTheoryError as e:
        raise HTTPException(status_code=400, detail=str(e))

    analysis = get_move_analysis(context["fen_before"], context["move_uci"])
    try:
        explanation = generate_theory_move_explanation(
            payload.name,
            payload.color,
            context,
            analysis,
            provider=payload.provider,
            api_key=payload.api_key,
            model=payload.model,
            base_url=payload.base_url,
        )
    except (LLMError, ValueError) as e:
        raise_llm_http_error(e)
    return RepertoireExplainMoveResponse(explanation=explanation)


if __name__ == "__main__":
    uvicorn.run("chess_trainer_system_server:app", host="0.0.0.0", port=8000, reload=True)