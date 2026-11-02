from typing import Dict, Any, Optional

from openai import OpenAI, APIError as OpenAIAPIError

SYSTEM_PROMPT = "You are a chess expert assistant. Respond using Markdown formatting."
TIMEOUT = 60.0

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


class LLMError(Exception):
    """Generic LLM Error."""


class LLMNotConfiguredError(LLMError):
    """The request has no usable provider, or lacks the API key its provider requires."""


def get_provider_options() -> Dict[str, Any]:
    """Describes the selectable providers and their defaults, without any credential."""
    return {
        "default_provider": DEFAULT_PROVIDER,
        "providers": {
            name: {
                "label": config["label"],
                "model": config["model"],
                "base_url": config["base_url"],
                "requires_api_key": config["api_key"] is None,
            }
            for name, config in PROVIDER_DEFAULTS.items()
        },
    }


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

    def request(self, prompt: str) -> str:
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            )
            return response.choices[0].message.content or ""

        except (OpenAIAPIError) as e:
            raise LLMError(f"[{self.provider}/{self.model}] {e}") from e


def format_analysis_block(summary: Dict[str, Any]) -> str:
    """Formats the analysis summary dictionary into a standardized text block for the LLM."""
    label = summary.get("label", "POSITION EVALUATION")
    return (
        f"\n📊 --- {label} ---\n"
        f"[] FEN: {summary['fen']}\n"
        f"👉 Suggested best move: {summary['best_move']}\n"
        f"📈 Position evaluation for White: {summary['evaluation']}\n"
        f"🔬 Depth reached: {summary['depth']} plies\n"
        f"♟️ Line: {summary['line']}\n"
        f"---------------------------\n"
    )

def generate_prompt(
    before_analysis: Dict[str, Any],
    after_analysis: Dict[str, Any],
    classification: Optional[str] = None,
    win_loss_delta: float = 0.0,
) -> str:
    """Builds the complete semantic prompt anchoring the LLM to the engine's mathematical evaluation."""
    before = {**before_analysis, "label": "BEFORE USER MOVE"}
    after = {**after_analysis, "label": "AFTER USER MOVE"}

    prompt = (
        "The user wants to understand the engine evaluation of this position. "
        "Explain it like a chess coach, comparing the suggested best move with the played move. "
        "Focus on a short answer."
    )

    prompt += "\n" + format_analysis_block(before)
    prompt += "\n" + format_analysis_block(after)

    if classification:
        prompt += (
            f"\n🎯 System Classification: {classification}\n"
            f"📉 Delta move: {win_loss_delta}\n"
        )

    return prompt

def generate_evaluation(
    before_analysis: Dict[str, Any],
    after_analysis: Dict[str, Any],
    classification: Optional[str] = None,
    win_loss_delta: float = 0.0,
    # BYOK parameters forwarded from API/Frontend request
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    """Instantiates the service on demand using user-provided credentials or defaults."""
    llm_service = LLMService(
        provider=provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
    )
    
    prompt = generate_prompt(
        before_analysis=before_analysis,
        after_analysis=after_analysis,
        classification=classification,
        win_loss_delta=win_loss_delta,
    )
    text = llm_service.request(prompt)
    return text