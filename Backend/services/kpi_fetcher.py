from __future__ import annotations

from typing import Dict, List

from backend.services.database import database_connection

SUMMARY_QUERY = """
WITH summary AS (
    SELECT
        COUNT(*) AS total_applications,
        SUM(CASE WHEN Status = 'Offered' THEN 1 ELSE 0 END) AS offers_sent,
        SUM(CASE WHEN Status = 'Current Student' THEN 1 ELSE 0 END) AS active_students,
        AVG(Age) AS average_age,
        SUM(CASE WHEN [Mode of Study] = 'Hybrid' THEN 1 ELSE 0 END) AS hybrid_students
    FROM reportdata
)
SELECT
    total_applications,
    offers_sent,
    active_students,
    average_age,
    hybrid_students,
    CASE WHEN total_applications > 0 THEN offers_sent * 1.0 / total_applications ELSE 0 END AS offer_rate,
    CASE WHEN total_applications > 0 THEN hybrid_students * 1.0 / total_applications ELSE 0 END AS hybrid_share
FROM summary;
"""


def _detect_anomalies(metrics: Dict[str, float]) -> List[str]:
    anomalies: List[str] = []
    if metrics["offer_rate"] < 0.25:
        anomalies.append("Offer conversion is below 25% of applications.")
    if metrics["hybrid_share"] > 0.5:
        anomalies.append("More than half of students prefer hybrid study modes.")
    if metrics["average_age"] is not None and metrics["average_age"] < 20:
        anomalies.append("Average applicant age is trending unusually low.")
    return anomalies


def fetch_kpi_snapshot() -> Dict[str, float]:
    """Return a single dictionary containing aggregated KPI values."""
    with database_connection() as connection:
        row = connection.execute(SUMMARY_QUERY).fetchone()

    metrics = {
        "total_applications": row["total_applications"],
        "offers_sent": row["offers_sent"],
        "active_students": row["active_students"],
        "average_age": round(row["average_age"], 2) if row["average_age"] is not None else None,
        "offer_rate": round(row["offer_rate"] * 100, 2) if row["offer_rate"] is not None else 0.0,
        "hybrid_share": round(row["hybrid_share"] * 100, 2) if row["hybrid_share"] is not None else 0.0,
    }
    metrics["anomalies"] = _detect_anomalies(
        {
            "offer_rate": row["offer_rate"] or 0.0,
            "hybrid_share": row["hybrid_share"] or 0.0,
            "average_age": row["average_age"] or 0.0,
        }
    )
    return metrics

