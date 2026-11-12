from typing import Dict, Any, List, Optional

from openai import OpenAI, APIError as OpenAIAPIError

from services.report_service import format_san_line, generate_report_prompt

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

PROMPT_ONLY_PROVIDER = "prompt"
PROMPT_ONLY_LABEL = "Somente prompt (sem LLM)"


class LLMError(Exception):
    """Generic LLM Error."""


class LLMNotConfiguredError(LLMError):
    """The request has no usable provider, or lacks the API key its provider requires."""


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


def format_prompt_only(prompt: str) -> str:
    """Shows the full prompt (system + user) verbatim in a Markdown code block."""
    return f"```text\n[SYSTEM]\n{SYSTEM_PROMPT}\n\n[USER]\n{prompt.strip()}\n```"


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


def format_analysis_block(analysis: Dict[str, Any]) -> str:
    """Formats the analysis summary dictionary into a standardized text block for the LLM."""
    label = analysis.get("label", "POSITION EVALUATION")
    return (
        f"\n📊 --- {label} ---\n"
        f"[] FEN: {analysis['fen']}\n"
        f"👉 Suggested best move: {analysis['best_move']}\n"
        f"📈 Position evaluation for White: {analysis['evaluation']}\n"
        f"🔬 Depth reached: {analysis['depth']} plies\n"
        f"♟️ Line: {analysis['line']}\n"
        f"---------------------------\n"
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
    # BYOK parameters forwarded from API/Frontend request
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    """Evaluates the user's move from its engine analysis, as returned by get_move_analysis.

    Instantiates the LLM service on demand using user-provided credentials or defaults.
    With the prompt-only provider, returns the generated prompt without calling any LLM.
    """
    return complete_prompt(generate_prompt(move_analysis, mover), provider, api_key, model, base_url)


def generate_game_report(
    stats: Dict[str, Any],
    result: str,
    termination: str,
    pgn: str = "",
    lenient_plies: Optional[List[int]] = None,
    imported: bool = False,
    # BYOK parameters forwarded from API/Frontend request
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
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
    return complete_prompt(prompt, provider, api_key, model, base_url)


# --- repertoire training (prompts in Portuguese: the user interface is in Portuguese) ---

COLOR_PT = {"white": "brancas", "black": "pretas"}

REPERTOIRE_COACH = (
    "Você é um treinador de xadrez ensinando repertório de aberturas a um aluno. "
    "Responda em português do Brasil, em Markdown, com linguagem didática e direta. "
    "Baseie-se apenas nos dados abaixo: não invente lances ou sequências fora das linhas fornecidas, "
    "e cite nomes de variantes somente se aparecerem nos dados. A avaliação do Stockfish está do ponto de "
    "vista das brancas (valores positivos favorecem as brancas)."
)


def generate_opening_intro_prompt(
    overview: Dict[str, Any], color: str, position_analysis: Optional[Dict[str, Any]] = None
) -> str:
    """Prompt to present an opening before the drill, from repertoire_service.opening_overview."""
    side = COLOR_PT.get(color, color)
    lines = [
        REPERTOIRE_COACH,
        "",
        f"O aluno vai treinar a abertura abaixo jogando com as {side}. Apresente-a antes do treino, em até "
        "300 palavras, com exatamente estas seções:",
        "1. **Ideia geral**: o que a abertura busca e por que é jogada.",
        f"2. **Planos típicos para as {side}**: o que o aluno deve buscar depois da linha de referência.",
        "3. **Estrutura de peões e casas-chave**.",
        "4. **Cuidados e erros comuns** para o lado do aluno.",
        "5. **Como treinar**: em que prestar atenção ao repetir as linhas.",
        "",
        "--- ABERTURA (base de aberturas do Lichess) ---",
        f"Nome: {overview['eco']} {overview['name']}",
        f"Linha de referência: {overview['reference_line']}",
        f"Linhas teóricas no treino: {overview['lines']}",
    ]
    if overview["variations"]:
        lines.append("Principais variantes (mais linhas teóricas primeiro):")
        lines += [
            f"- {v['name']} ({v['lines']} {'linha' if v['lines'] == 1 else 'linhas'}): {v['line']}"
            for v in overview["variations"]
        ]

    if position_analysis:
        lines.append(format_analysis_block({**position_analysis, "label": "POSIÇÃO AO FIM DA LINHA DE REFERÊNCIA"}))
    else:
        lines += ["", "Avaliação do Stockfish indisponível: não cite avaliações numéricas."]
    return "\n".join(lines)


def generate_theory_move_prompt(
    opening_name: str, color: str, context: Dict[str, Any], move_analysis: Optional[Dict[str, Any]] = None
) -> str:
    """Prompt to explain why theory plays a move, from repertoire_service.theory_move_context."""
    side = COLOR_PT.get(color, color)
    by_user = context["mover"] == color
    move_label = f"{format_san_line([context['move_san']], context['ply'])}"
    lines = [
        REPERTOIRE_COACH,
        "",
        f"O aluno treina {opening_name} com as {side} e quer entender o lance {move_label}, "
        + ("jogado pelo aluno (lance da teoria do seu repertório)." if by_user
           else "jogado pelo oponente (uma resposta teórica)."),
        "Explique em até 150 palavras: a ideia do lance, o que ele prepara ou impede, e por que a teoria o "
        "prefere nesta posição. "
        + ("Se houver alternativas teóricas, compare brevemente."
           if by_user else "Depois diga como o aluno deve responder, usando os lances teóricos indicados."),
        "",
        "--- CONTEXTO DA TEORIA ---",
        f"Linha até o lance: {format_san_line(context['line_sans'])}",
        f"Variante nesta altura: {context['opening']['name'] if context['opening'] else opening_name}",
        f"Outros lances teóricos nesta posição: {', '.join(context['alternatives']) or 'nenhum'}",
        f"Respostas teóricas depois do lance: {', '.join(context['next_theory']) or 'a teoria da base termina aqui'}",
    ]
    if move_analysis:
        lines.append(format_analysis_block({**move_analysis["before_move_analysis"], "label": "ANTES DO LANCE"}))
        lines.append(format_analysis_block({**move_analysis["after_move_analysis"], "label": "DEPOIS DO LANCE"}))
        lines.append(
            f"Classificação do lance pelo sistema: {move_analysis['move_classification']} "
            f"(perda de {move_analysis['move_delta']}% de chance de vitória)"
        )
    else:
        lines += ["", "Avaliação do Stockfish indisponível: não cite avaliações numéricas."]
    return "\n".join(lines)


def generate_opening_intro(
    overview: Dict[str, Any],
    color: str,
    position_analysis: Optional[Dict[str, Any]] = None,
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    """The coach's presentation of an opening. With the prompt-only provider, returns the prompt."""
    prompt = generate_opening_intro_prompt(overview, color, position_analysis)
    return complete_prompt(prompt, provider, api_key, model, base_url)


def generate_theory_move_explanation(
    opening_name: str,
    color: str,
    context: Dict[str, Any],
    move_analysis: Optional[Dict[str, Any]] = None,
    provider: str = DEFAULT_PROVIDER,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    """Why theory plays a move. With the prompt-only provider, returns the prompt."""
    prompt = generate_theory_move_prompt(opening_name, color, context, move_analysis)
    return complete_prompt(prompt, provider, api_key, model, base_url)
