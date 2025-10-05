from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


LOGGER = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@lru_cache(maxsize=1)
def _load_dotenv() -> None:
    """Load environment variables from a local .env file if present."""
    project_root = Path(__file__).resolve().parents[2]
    env_file = project_root / ".env"
    if env_file.exists():
        load_dotenv(env_file)
    load_dotenv()


def get_env_variable(key: str, default: Optional[str] = None, *, required: bool = False) -> str:
    """Return an environment variable value, optionally enforcing presence.

    Args:
        key: Name of the environment variable to fetch.
        default: Value returned when the variable is absent.
        required: When ``True``, raise an exception if the value is missing.

    Raises:
        RuntimeError: If the variable is required but not set.
    """

    _load_dotenv()
    value = os.getenv(key, default)
    if required and value is None:
        raise RuntimeError(
            f"Required environment variable '{key}' is not set."
        )
    return value


def get_database_path() -> str:
    """Return the configured database path, defaulting to the bundled SQLite file."""
    default_db = DATA_DIR / "dummy_data.db"
    configured = get_env_variable("DATABASE_PATH", default=str(default_db))
    return str(Path(configured).expanduser().resolve())


def get_output_path() -> Path:
    """Return the CSV file path for narrative persistence."""
    default_path = DATA_DIR / "Narratives.csv"
    configured = get_env_variable("NARRATIVES_OUTPUT", default=str(default_path))
    return Path(configured).expanduser().resolve()


def get_storyboard_log_path() -> Path:
    """Return the CSV path used to log storyboard insight runs."""

    default_path = DATA_DIR / "storyboard_log.csv"
    configured = get_env_variable("STORYBOARD_LOG_PATH", default=str(default_path))
    return Path(configured).expanduser().resolve()


DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"

_DEPRECATED_MODEL_ALIASES = {
    "gemini-1.5-flash": DEFAULT_GEMINI_MODEL,
    "gemini-1.5-flash-latest": DEFAULT_GEMINI_MODEL,
}


def get_model_name() -> str:
    """Return the Gemini model name, defaulting to the current Flash release.

    Older defaults such as ``gemini-1.5-flash`` (and its ``-latest`` alias) are
    no longer available in newer API versions. When the configured value matches
    one of these deprecated identifiers we transparently fall back to
    ``gemini-2.0-flash`` while logging a helpful message so that operators can
    update their configuration.
    """

    configured = get_env_variable("GEMINI_MODEL", default=DEFAULT_GEMINI_MODEL)
    replacement = _DEPRECATED_MODEL_ALIASES.get(configured)
    if replacement:
        LOGGER.warning(
            "GEMINI_MODEL '%s' is deprecated; falling back to '%s'. Update your "
            "environment variable to silence this warning.",
            configured,
            replacement,
        )
        return replacement
    return configured
