from typing import Dict, Any, Optional

def format_analysis_block(summary: Dict[str, Any]) -> str:
    """Formats the analysis summary dictionary into a standardized text block for the LLM."""
    label = summary.get('label', 'POSITION EVALUATION')
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
    win_loss_delta: float = 0.0
) -> str:
    """
    Builds the complete semantic prompt anchoring the LLM to the engine's mathematical evaluation.
    """
    before_analysis["label"] = "BEFORE USER MOVE"
    after_analysis["label"] = "AFTER USER MOVE"

    prompt = (
        "The user wants to understand the engine evaluation of this position. "
        "Explain it like a chess coach, comparing the suggested best move with the played move."
    )

    prompt += "\n" + format_analysis_block(before_analysis)
    prompt += "\n" + format_analysis_block(after_analysis)

    if classification:
        prompt += (
            f"\n🎯 System Classification: {classification}\n"
            f"📉 Delta move: {win_loss_delta}\n"
        )

    return prompt