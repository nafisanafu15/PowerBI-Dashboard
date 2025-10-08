from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.ai_narratives import generate_narrative
from backend.services import fetch_kpi_snapshot, persist_narrative


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate KPI narratives with Gemini")
    parser.add_argument("--page-key", default="AdmissionsOverview", help="Power BI page identifier")
    parser.add_argument("--scope-key", default="Global", help="Power BI visual scope identifier")
    parser.add_argument(
        "--test",
        action="store_true",
        help="Print the prompt and generated narrative instead of only writing the CSV.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    metrics: Dict[str, Any] = fetch_kpi_snapshot()
    try:
        narrative_text, prompt = generate_narrative(metrics)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.test:
        print("Prompt sent to Gemini:\n")
        print(prompt)
        print("\nGenerated narrative:\n")
        print(narrative_text)

    persist_narrative(args.page_key, args.scope_key, narrative_text)

    if args.test:
        print("\nMetrics snapshot:\n")
        print(json.dumps(metrics, indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
