from __future__ import annotations
import logging
from typing import Dict, Optional, Tuple
from backend.ai_narratives.config import get_env_variable, get_model_name
from backend.ai_narratives.prompt_builder import build_kpi_prompt

LOGGER = logging.getLogger(__name__)


def generate_narrative(metrics: Dict[str, object], *, model_name: Optional[str] = None) -> Tuple[str, str]:
    """Generate a narrative by calling the Gemini API.

    Returns a tuple of ``(narrative_text, prompt_used)`` so that callers can
    inspect the exact prompt that was sent to the model for debugging.
    """
    try:
        import google.generativeai as genai
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Missing optional dependency 'google-generativeai'. Install it with "
            "`pip install google-generativeai` or add it to your requirements file."
        ) from exc

    api_key = get_env_variable("GEMINI_API_KEY", required=True)
    genai.configure(api_key=api_key)

    prompt = build_kpi_prompt(metrics)
    resolved_model_name = model_name or get_model_name()
    model = genai.GenerativeModel(resolved_model_name)

    try:
        from google.api_core import exceptions as google_api_exceptions
    except ModuleNotFoundError:
        google_api_exceptions = None

    try:
        response = model.generate_content(prompt)
    except Exception as exc:
        if google_api_exceptions and isinstance(exc, google_api_exceptions.NotFound):
            raise RuntimeError(
                (
                    "The configured Gemini model "
                    f"'{resolved_model_name}' is not available for the current API version. "
                    "Set the GEMINI_MODEL environment variable to one of the supported "
                    "models returned by the ListModels endpoint."
                )
            ) from exc
        LOGGER.exception("Gemini API call failed")
        raise RuntimeError("Failed to generate narrative from Gemini API") from exc

    text = getattr(response, "text", None)
    if not text:
        candidates = getattr(response, "candidates", None)
        if candidates:
            collected = []
            for candidate in candidates:
                content = getattr(candidate, "content", None)
                parts = getattr(content, "parts", []) if content else []
                for part in parts:
                    if hasattr(part, "text") and part.text:
                        collected.append(part.text)
            if collected:
                text = "\n".join(collected)

    if not text:
        raise RuntimeError("Gemini API returned an empty response.")

    return text.strip(), prompt
