from .prompt_builder import build_kpi_prompt
from .storyboard_engine import (
    get_all_storyboards,
    get_storyboards_for_role,
    refresh_storyboards,
    start_background_refresh,
)

__all__ = [
    "build_kpi_prompt",
    "generate_narrative",
    "get_all_storyboards",
    "get_storyboards_for_role",
    "refresh_storyboards",
    "start_background_refresh",
]


def __getattr__(name):
    if name == "generate_narrative":
        from .gemini_client import generate_narrative as _generate_narrative

        return _generate_narrative
    raise AttributeError(name)

