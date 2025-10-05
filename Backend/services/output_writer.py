from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

from backend.ai_narratives.config import get_output_path

FIELDNAMES = ["PageKey", "ScopeKey", "NarrativeText", "LastRunUtc"]


def _prepare_row(page_key: str, scope_key: str, narrative_text: str) -> Dict[str, str]:
    return {
        "PageKey": page_key,
        "ScopeKey": scope_key,
        "NarrativeText": narrative_text,
        "LastRunUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def persist_narrative(
    page_key: str, scope_key: str, narrative_text: str, *, output_path: Path | None = None
) -> Path:
    """Persist the narrative to a CSV file."""
    path = output_path or get_output_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    row = _prepare_row(page_key, scope_key, narrative_text)
    file_exists = path.exists()

    with path.open("a", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=FIELDNAMES)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)

    return path

