import logging
from typing import Dict, Any, List, NamedTuple, Optional

from openai import OpenAI, APIError as OpenAIAPIError, BadRequestError, UnprocessableEntityError

from services.coach_tools import (
    MOVE_EVALUATION_TOOL_CALLS,
    REPORT_TOOL_CALLS,
    TOOL_DEFINITIONS,
    CoachToolkit,
    line_outcome_text,
)
from services.report_service import (
    PGN_NOTATION_RULE,
    generate_report_prompt,
    pgn_move,
    played_move,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = "You are a chess expert assistant. Respond using Markdown formatting."
TIMEOUT = 60.0

# Rounds of tool calls before the model must answer: each round is one more request to the provider.
MAX_TOOL_ROUNDS = 6

# Added to the semantic prompts when the model can check its claims with the engine (coach_tools).
ENGINE_TOOLS_RULE = (
    "You can check facts with tools that query Stockfish and the board (evaluate_position, analyze_move, "
    "play_line, square_info, find_threats); pass them the FENs from the data. Before you state a concrete fact "
    "that the data does not already give word for word (that a move wins, loses or allows material and which "
    "piece, that a piece is attacked, defended, hanging or pinned, what a move threatens, what a line achieves, "
    "or a feature of the pawn structure), check it with a tool, and follow the tool when it contradicts you. "
    "Count material after the exchanges: a piece that gets recaptured is a trade, not a loss. Moves and lines "
    "you cite must come from the data or from tool results. Do not mention the tools or the checking in your answer."
)
FINAL_ANSWER_REQUEST = "Write your final answer now, using only what the data and your checks established."


class CoachAnswer(NamedTuple):
    """The coach's text and the engine checks it ran to write it (empty without tools)."""

    text: str
    checks: List[str]

MISSING_API_KEY_MESSAGE = "Você precisa configurar sua LLM para avaliar lances."

DEFAULT_PROVIDER = "gemini"

# Default configurations per provider. "api_key" is None when the user must supply one.
PROVIDER_DEFAULTS = {
    "gemini": {
        "label": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "api_key": None,
        "model": "gemini-2.5-flash",
    }
}

PROMPT_ONLY_PROVIDER = "prompt"
PROMPT_ONLY_LABEL = "Somente prompt (sem LLM)"


class LLMError(Exception):
    """Generic LLM Error."""


class LLMNotConfiguredError(LLMError):
    """The request has no usable provider, or lacks the API key its provider requires."""


class ToolsUnsupportedError(LLMError):
    """The provider or model rejected a request offering tools: the answer is asked for without them."""


def get_provider_options() -> Dict[str, Any]:
    """Describes the selectable providers and their defaults, without any credential."""
    providers = {
        name: {
            "label": config["label"],
            "model": config["model"],
            "base_url": config["base_url"],
            "requires_api_key": config["api_key"] is None,
            "uses_llm": True,
        }
        for name, config in PROVIDER_DEFAULTS.items()
    }
    providers[PROMPT_ONLY_PROVIDER] = {
        "label": PROMPT_ONLY_LABEL,
        "model": "",
        "base_url": "",
        "requires_api_key": False,
        "uses_llm": False,
    }
    return {"default_provider": DEFAULT_PROVIDER, "providers": providers}


def format_prompt_only(prompt: str, tools: bool = False) -> str:
    """Shows the full prompt (system + user, and the tools offered) verbatim in a Markdown code block."""
    tool_names = ", ".join(t["function"]["name"] for t in TOOL_DEFINITIONS)
    tools_section = f"\n\n[TOOLS]\n{tool_names}" if tools else ""
    return f"```text\n[SYSTEM]\n{SYSTEM_PROMPT}\n\n[USER]\n{prompt.strip()}{tools_section}\n```"


class LLMService:
    def __init__(
        self,
        provider: str = DEFAULT_PROVIDER,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        provider = provider.lower()
        # Saved browser settings can outlive a provider that is no longer offered.
        if provider not in PROVIDER_DEFAULTS:
            raise LLMNotConfiguredError(MISSING_API_KEY_MESSAGE)

        defaults = PROVIDER_DEFAULTS[provider]
        self.provider = provider
        
        # Model resolution: Explicit arg > PROVIDER_DEFAULTS
        self.model = model or defaults["model"]
        
        # BYOK: keys come only from the request, never from the server environment
        resolved_api_key = api_key or defaults["api_key"]

        if not resolved_api_key:
            raise LLMNotConfiguredError(MISSING_API_KEY_MESSAGE)

        # Base URL resolution: Explicit arg > PROVIDER_DEFAULTS
        resolved_base_url = base_url or defaults["base_url"]

        self.client = OpenAI(
            base_url=resolved_base_url,
            api_key=resolved_api_key,
            timeout=TIMEOUT
        )

    def request(self, prompt: str, toolkit: Optional[CoachToolkit] = None) -> str:
        """The model's answer to the prompt. With a toolkit, the model may call its tools first: each round
        sends their results back, until it answers, runs out of rounds or uses up the toolkit's budget."""
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        try:
            if toolkit is None:
                return self._complete(messages).content or ""

            for round_number in range(MAX_TOOL_ROUNDS):
                try:
                    message = self._complete(messages, tools=toolkit.definitions)
                except (BadRequestError, UnprocessableEntityError) as e:
                    # A model without function calling (BYOK allows any OpenAI-compatible endpoint)
                    # rejects the first request; later rounds failing are real errors.
                    if round_number == 0:
                        raise ToolsUnsupportedError(str(e)) from e
                    raise
                if not message.tool_calls:
                    return message.content or ""
                # Sent back as received: some providers attach data to tool calls (e.g. thought signatures).
                messages.append(message.model_dump(exclude_none=True))
                for call in message.tool_calls:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": toolkit.call(call.function.name, call.function.arguments),
                    })
                if toolkit.exhausted:
                    break

            logger.info("coach tools: answer requested after %d checks", len(toolkit.calls))
            messages.append({"role": "user", "content": FINAL_ANSWER_REQUEST})
            return self._complete(messages, tools=toolkit.definitions, tool_choice="none").content or ""

        except (OpenAIAPIError) as e:
            raise LLMError(f"[{self.provider}/{self.model}] {e}") from e

    def _complete(self, messages: List[Dict[str, Any]], **options: Any) -> Any:
        response = self.client.chat.completions.create(model=self.model, messages=messages, **options)
        return response.choices[0].message


def complete_prompt(
    prompt: str,
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    """Sends the prompt to the configured LLM, or returns it as-is with the prompt-only provider."""
    if provider.lower() == PROMPT_ONLY_PROVIDER:
        return format_prompt_only(prompt)

    llm_service = LLMService(
        provider=provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
    )
    return llm_service.request(prompt)


def complete_coach_prompt(
    prompt: str,
    engine_tools: bool,
    max_tool_calls: int,
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> CoachAnswer:
    """A semantic answer (move evaluation or report). With `engine_tools`, the model is told to verify its
    claims and is given the coach tools, backed by one Stockfish process for the whole answer."""
    checked_prompt = f"{prompt}\n\n{ENGINE_TOOLS_RULE}" if engine_tools else prompt
    if provider.lower() == PROMPT_ONLY_PROVIDER:
        return CoachAnswer(format_prompt_only(checked_prompt, tools=engine_tools), [])

    llm_service = LLMService(provider=provider, api_key=api_key, model=model, base_url=base_url)
    if not engine_tools:
        return CoachAnswer(llm_service.request(prompt), [])
    try:
        with CoachToolkit(max_calls=max_tool_calls) as toolkit:
            return CoachAnswer(llm_service.request(checked_prompt, toolkit), toolkit.calls)
    except ToolsUnsupportedError as e:
        logger.warning("coach tools rejected by %s/%s, answering without them: %s", provider, llm_service.model, e)
        return CoachAnswer(llm_service.request(prompt), [])


def format_analysis_block(analysis: Dict[str, Any]) -> str:
    """Formats the analysis summary dictionary into a standardized text block for the LLM."""
    label = analysis.get("label", "POSITION EVALUATION")
    best_move = pgn_move(analysis["fen"], analysis["best_move"]) or analysis["best_move"]
    # Computed from the line, so the model does not have to read the material balance off it.
    outcome = line_outcome_text(analysis["fen"], analysis.get("line", ""))
    return (
        f"\n📊 --- {label} ---\n"
        f"[] FEN: {analysis['fen']}\n"
        f"👉 Suggested best move: {best_move}\n"
        f"📈 Position evaluation for White: {analysis['evaluation']}\n"
        f"🔬 Depth reached: {analysis['depth']} plies\n"
        f"♟️ Line: {analysis['line']}\n"
        + (f"⚖️ Material along the line: {outcome}\n" if outcome else "")
        + "---------------------------\n"
    )

def generate_prompt(move_analysis: Dict[str, Any], mover: str = "user") -> str:
    """Builds the complete semantic prompt anchoring the LLM to the engine's mathematical evaluation.

    `mover` is "user" when the user played the move, "opponent" when their opponent did.
    """
    by_opponent = mover == "opponent"
    who = "OPPONENT" if by_opponent else "USER"
    before = {**move_analysis["before_move_analysis"], "label": f"BEFORE {who} MOVE"}
    after = {**move_analysis["after_move_analysis"], "label": f"AFTER {who} MOVE"}
    classification = move_analysis.get("move_classification")
    move_delta = move_analysis.get("move_delta", 0.0)

    if by_opponent:
        prompt = (
            "The user wants to understand a move played by their OPPONENT, not by the user. "
            "Explain it like a chess coach talking to the user: what the opponent's idea was and how good the move was "
            "compared with the engine's suggested best move. Then tell the user what it means for them: if it was a "
            "mistake, how the user could exploit or punish it; if it was strong, which threat or plan it creates and "
            "how the user should respond. Always refer to it as the opponent's move. Focus on a short answer."
        )
    else:
        prompt = (
            "The user wants to understand the engine evaluation of this position. "
            "Explain it like a chess coach, comparing the suggested best move with the played move. "
            "Focus on a short answer."
        )

    prompt += " " + PGN_NOTATION_RULE

    played = played_move(before["fen"], after["fen"])
    if played:
        prompt += f"\n\n♟️ Move played by the {'opponent' if by_opponent else 'user'}: {played}\n"

    prompt += "\n" + format_analysis_block(before)
    prompt += "\n" + format_analysis_block(after)

    if classification:
        classification_label = (
            "System Classification of the opponent's move" if by_opponent else "System Classification"
        )
        prompt += (
            f"\n🎯 {classification_label}: {classification}\n"
            f"📉 Delta move: {move_delta}\n"
        )

    return prompt

def generate_move_evaluation(
    move_analysis: Dict[str, Any],
    mover: str = "user",
    engine_tools: bool = True,
    # BYOK parameters forwarded from API/Frontend request
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> CoachAnswer:
    """Evaluates the user's move from its engine analysis, as returned by get_move_analysis.

    Instantiates the LLM service on demand using user-provided credentials or defaults; with
    `engine_tools`, the model can check its claims with the engine. With the prompt-only provider,
    returns the generated prompt without calling any LLM.
    """
    return complete_coach_prompt(
        generate_prompt(move_analysis, mover), engine_tools, MOVE_EVALUATION_TOOL_CALLS,
        provider, api_key, model, base_url,
    )


def generate_game_report(
    stats: Dict[str, Any],
    result: str,
    termination: str,
    pgn: str = "",
    lenient_plies: Optional[List[int]] = None,
    imported: bool = False,
    engine_tools: bool = True,
    # BYOK parameters forwarded from API/Frontend request
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> CoachAnswer:
    """Writes the coach's post-game report from the game stats, as returned by compute_game_stats.

    Instantiates the LLM service on demand using user-provided credentials or defaults.
    With the prompt-only provider, returns the generated prompt without calling any LLM.
    """
    prompt = generate_report_prompt(
        stats,
        result=result,
        termination=termination,
        pgn=pgn,
        lenient_plies=lenient_plies,
        imported=imported,
    )
    return complete_coach_prompt(prompt, engine_tools, REPORT_TOOL_CALLS, provider, api_key, model, base_url)
