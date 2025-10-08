from __future__ import annotations
from typing import Dict, Iterable

PROMPT_TEMPLATE = """You are an analytics co-pilot for a university admissions team.
Summarise the latest KPI snapshot in exactly three bullet points using the
following structure:
1. What happened?
2. Why did it happen?
3. What should the team do next?

Keep the language concise, data-driven, and actionable. Avoid repeating the KPI
values verbatim; interpret them instead.

KPI Snapshot:
- Total applications: {total_applications}
- Offers sent: {offers_sent}
- Active students: {active_students}
- Average applicant age: {average_age}
- Offer conversion rate (%): {offer_rate}
- Hybrid study preference (%): {hybrid_share}
- Notable anomalies: {anomalies}
"""


def _format_anomalies(anomalies: Iterable[str]) -> str:
    anomaly_list = list(anomalies)
    return "; ".join(anomaly_list) if anomaly_list else "None"


def build_kpi_prompt(metrics: Dict[str, object]) -> str:
    """Inject KPI values into the fixed prompt template."""
    prompt = PROMPT_TEMPLATE.format(
        total_applications=metrics.get("total_applications", "N/A"),
        offers_sent=metrics.get("offers_sent", "N/A"),
        active_students=metrics.get("active_students", "N/A"),
        average_age=metrics.get("average_age", "N/A"),
        offer_rate=metrics.get("offer_rate", "N/A"),
        hybrid_share=metrics.get("hybrid_share", "N/A"),
        anomalies=_format_anomalies(metrics.get("anomalies", [])),
    )
    return prompt.strip()