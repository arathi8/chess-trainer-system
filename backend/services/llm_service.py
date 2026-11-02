import os
from typing import Dict, Any, Optional

from openai import OpenAI, APIError as OpenAIAPIError

SYSTEM_PROMPT = "You are a chess expert assistant."
TIMEOUT = 60.0
MAX_TOKENS = 1024

# Default configurations per provider
PROVIDER_DEFAULTS = {
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "api_key": "ollama",
        "model": "llama3.2:3b",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "api_key": None,
        "model": "gemini-2.5-flash",
    }
}


class LLMError(Exception):
    """Generic LLM Error."""


class LLMService:
    def __init__(
        self,
        provider: str = "gemini",
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        provider = provider.lower()
        if provider not in PROVIDER_DEFAULTS:
            raise ValueError(f"Unknown provider: {provider}. Use: {list(PROVIDER_DEFAULTS)}")

        defaults = PROVIDER_DEFAULTS[provider]
        self.provider = provider
        
        # Model resolution: Explicit arg > Env Var > PROVIDER_DEFAULTS
        self.model = model or os.getenv("LLM_MODEL") or defaults["model"]
        
        # BYOK Resolution order: Explicit arg > Env Var > PROVIDER_DEFAULTS hardcoded key
        env_key_var = f"{provider.upper()}_API_KEY"
        # A server-side key must never be forwarded to a caller-supplied base URL.
        server_api_key = None if base_url else os.getenv(env_key_var)
        resolved_api_key = api_key or server_api_key or defaults["api_key"]

        if not resolved_api_key and provider != "ollama":
            raise LLMError(
                f"API Key not provided for provider '{provider}'. "
                f"Pass it in the request, set {env_key_var}, or add it to PROVIDER_DEFAULTS."
            )

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
    provider: str = "gemini",
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
    return f"{llm_service.model}: {text}"