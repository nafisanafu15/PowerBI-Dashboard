"""Generate AI-style storyboard insights from the admissions dataset.

This module inspects the SQLite database that powers the dashboards and
produces short, human-friendly insights for the storyboard panels.  The
computation happens in pure Python so that an "AI" summary is available even
when external LLM services are not configured.  Results are cached in memory
and refreshed periodically by a lightweight background thread.
"""
from __future__ import annotations

import csv
import logging
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Optional, Sequence

import pandas as pd

from .config import get_database_path, get_storyboard_log_path

LOGGER = logging.getLogger(__name__)

_storyboard_cache: Dict[str, Dict[str, object]] = {}
_cache_lock = threading.Lock()
_refresh_thread: Optional[threading.Thread] = None

_DEFAULT_REFRESH_INTERVAL = 15 * 60 

_FALLBACK_MESSAGE = (
    "AI insights are temporarily unavailable because the admissions dataset "
    "could not be analysed."
)


def _normalise_column_name(name: str) -> str:
    """Return a lowercase identifier stripped of non-alphanumeric characters."""

    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def _resolve_column_name(df: pd.DataFrame, *candidates: str) -> Optional[str]:
    """Find the first matching column name, ignoring spacing/casing differences."""

    if df is None or df.empty:
        return None

    normalised_map = {
        _normalise_column_name(column): column for column in df.columns
    }

    for candidate in candidates:
        key = _normalise_column_name(candidate)
        if key in normalised_map:
            return normalised_map[key]
    return None


def _load_dataframe() -> pd.DataFrame:
    """Return the admissions dataset as a DataFrame."""
    db_path = Path(get_database_path())
    if not db_path.exists():
        raise FileNotFoundError(f"Admissions database not found at {db_path}")

    with sqlite3.connect(db_path) as connection:
        dataframe = pd.read_sql_query("SELECT * FROM reportdata", connection)

    return dataframe


def _normalise_series(values: Iterable[object]) -> pd.Series:
    """Convert raw values to a stripped pandas Series while preserving index."""
    series = pd.Series(values, dtype="object").replace({None: ""})
    series = series.astype(str).str.strip()
    return series


def _status_series(df: pd.DataFrame) -> pd.Series:
    """Return the Status column as a normalised lower-case Series."""
    column_name = _resolve_column_name(df, "Status")
    if not column_name:
        return pd.Series([], dtype="object")
    series = _normalise_series(df[column_name].fillna(""))
    return series.str.lower()


def _is_active_status(status_series: pd.Series) -> pd.Series:
    """Flag rows where the status denotes an enrolled or current student."""
    return status_series.str.startswith("enrolled") | (status_series == "current student")


def _compose_term(intake: object, year: object) -> str:
    intake_str = str(intake).strip() if intake is not None else ""
    year_str = str(year).strip() if year is not None else ""

    if intake_str.lower() == "nan":
        intake_str = ""
    if year_str.lower() == "nan":
        year_str = ""

    if intake_str and year_str:
        return f"{intake_str} {year_str}"
    if year_str:
        return year_str
    if intake_str:
        return intake_str
    return "Unknown"


_TERM_ORDER = {
    "T1": 1,
    "T2": 2,
    "T3": 3,
    "S1": 1,
    "S2": 2,
    "S3": 3,
    "SEM1": 1,
    "SEM2": 2,
    "SEM3": 3,
    "SUMMER": 4,
    "WINTER": 5,
    "SPRING": 6,
    "AUTUMN": 7,
    "FALL": 7,
}


def _term_sort_key(term: str) -> tuple[int, int, str]:
    term_upper = str(term).upper()
    match = re.search(r"(19|20)\d{2}", term_upper)
    year = int(match.group(0)) if match else 0
    token = None
    for key in _TERM_ORDER:
        if key in term_upper:
            token = key
            break
    order = _TERM_ORDER.get(token, 99)
    return year, order, term_upper


def _format_percentage(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "0%"
    return f"{(numerator / denominator) * 100:.0f}%"


def _format_currency(amount: float) -> str:
    return f"${amount:,.0f}"


def _build_due_payments_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    column = _resolve_column_name(
        df,
        "Do you want to pay more than 50% upfront fee?",
        "Do_you_want_to_pay_more_than_50_upfront_fee",
    )
    if not column:
        return "Payment preference data is not available in the current dataset."

    responses = _normalise_series(df[column])
    valid_mask = responses.replace("nan", "").str.len() > 0
    if not valid_mask.any():
        return "Applicants have not supplied payment preference information yet."

    lowered = responses.str.lower()
    hesitant_mask = valid_mask & lowered.isin({"no", "n", "0", "false"})
    hesitant_total = int(hesitant_mask.sum())
    total_responses = int(valid_mask.sum())

    if hesitant_total == 0:
        return (
            f"Summary: All {total_responses} respondents are comfortable paying more than 50% upfront.\n"
            "Action: Maintain the current payment options and reinforce the positive sentiment."
        )

    percentage = _format_percentage(hesitant_total, total_responses)
    agent_column = _resolve_column_name(df, "AgentName")
    agent_series = (
        _normalise_series(df.loc[hesitant_mask, agent_column])
        if agent_column
        else pd.Series(dtype="object")
    )
    agent_series = agent_series.replace("", pd.NA).dropna()

    if not agent_series.empty:
        counts = agent_series.value_counts()
        top_agent = counts.index[0]
        top_count = int(counts.iloc[0])
        agent_fragment = f"Coordinate follow-ups with {top_agent}, who manages {top_count} of these cases."
    else:
        agent_fragment = ""

    summary = (
        f"Summary: {hesitant_total} of {total_responses} applicants ({percentage}) prefer to pay less than half upfront."
    )
    context = "Context: Payment preferences were captured from engaged applicants."
    if agent_fragment:
        action = f"Action: {agent_fragment.strip()}"
    else:
        action = "Action: Offer flexible instalment plans to keep these offers moving forward."

    return "\n".join([summary, context, action])


def _build_course_performance_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    course_column = _resolve_column_name(df, "CourseName")
    if not course_column:
        return "Course performance cannot be assessed without course information."

    if status_series is None or status_series.empty:
        return "Course performance cannot be assessed until enrolment statuses are available."

    active_mask = _is_active_status(status_series)
    course_series = (
        _normalise_series(df.loc[active_mask, course_column])
        .replace("", pd.NA)
        .dropna()
    )

    if course_series.empty:
        return "No students are currently marked as enrolled, so course performance is inconclusive."

    counts = course_series.value_counts()
    total_active = int(counts.sum())
    leader = counts.index[0]
    leader_count = int(counts.iloc[0])

    if len(counts) == 1:
        return (
            f"Summary: {leader} is currently the only active course with {leader_count} engaged students.\n"
            "Action: Monitor the pipeline for other courses so enrolments diversify."
        )

    runner_up = counts.index[1]
    runner_count = int(counts.iloc[1])
    delta = leader_count - runner_count
    summary = (
        f"Summary: {leader} leads with {leader_count} active students—{delta} more than {runner_up}."
    )
    context = f"Context: {total_active} learners are currently engaged across all courses."
    action = f"Action: Share {leader}'s approach to help {runner_up} close the gap."
    return "\n".join([summary, context, action])


def _build_study_reason_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    column = _resolve_column_name(df, "Study Reason")
    if not column:
        return "Study motivation data is missing from the dataset."

    reasons = (
        _normalise_series(df[column]).replace({"", "nan"}, pd.NA).dropna()
    )
    if reasons.empty:
        return "Study reasons have not been captured yet."

    counts = reasons.value_counts()
    total = int(counts.sum())
    top_reason = counts.index[0]
    top_count = int(counts.iloc[0])
    share = _format_percentage(top_count, total)

    if len(counts) == 1:
        return (
            f"Summary: Every respondent cites '{top_reason}' as their motivation to study.\n"
            "Action: Spotlight this motivation in upcoming outreach materials."
        )

    second_reason = counts.index[1]
    second_count = int(counts.iloc[1])
    summary = f"Summary: '{top_reason}' is the leading motivation with {top_count} students ({share})."
    context = f"Context: '{second_reason}' follows with {second_count} mentions."
    action = "Action: Tailor messaging to emphasise these motivations during counselling."
    return "\n".join([summary, context, action])


def _build_top_agents_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    agent_column = _resolve_column_name(df, "AgentName")
    if not agent_column:
        return "Agent performance cannot be measured because agent names are missing."

    agents = _normalise_series(df[agent_column]).replace("", pd.NA).dropna()
    if agents.empty:
        return "No agent activity has been logged yet."

    if status_series is None or status_series.empty:
        return "Agent performance insights require up-to-date enrolment statuses."

    student_column = _resolve_column_name(df, "StudentId")
    if not student_column:
        return "Agent performance cannot be summarised because student IDs are unavailable."

    working_df = df.loc[agents.index].copy()
    working_df[agent_column] = agents
    working_df["is_enrolled"] = _is_active_status(status_series.loc[agents.index])

    grouped = (
        working_df.groupby(agent_column, dropna=False)
        .agg(total=(student_column, "count"), enrolments=("is_enrolled", "sum"))
        .reset_index()
    )

    if grouped.empty:
        return "Agent performance data is currently unavailable."

    grouped["conversion"] = grouped.apply(
        lambda row: (row["enrolments"] / row["total"]) if row["total"] else 0.0,
        axis=1,
    )

    ranked = grouped.sort_values(
        by=["enrolments", "conversion", "total", agent_column],
        ascending=[False, False, False, True],
        ignore_index=True,
    )

    leader = ranked.iloc[0]
    leader_name = leader[agent_column]
    leader_enrolments = int(leader["enrolments"])
    leader_rate = leader["conversion"] * 100

    if len(ranked) == 1:
        total_pipeline = int(leader["total"])
        return (
            f"Summary: {leader_name} converted {leader_enrolments} enrolments from {total_pipeline} applicants.\n"
            "Action: Capture and share their winning tactics with the wider team."
        )

    runner = ranked.iloc[1]
    runner_name = runner[agent_column]
    runner_enrolments = int(runner["enrolments"])
    gap = leader_enrolments - runner_enrolments
    summary = (
        f"Summary: {leader_name} leads with {leader_enrolments} enrolments ({leader_rate:.0f}% conversion), "
        f"{gap} ahead of {runner_name}."
    )
    context = (
        f"Context: {runner_name} has {runner_enrolments} confirmed students and can close the gap with targeted support."
    )
    action = f"Action: Ask {leader_name} to mentor {runner_name} on high-conversion tactics."
    return "\n".join([summary, context, action])


def _build_enrolment_trend_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    intake_col = _resolve_column_name(df, "Previous Offer Intake")
    year_col = _resolve_column_name(df, "Previous Offer Year")
    if not intake_col and not year_col:
        return "Historical intake data is unavailable, so enrolment trends cannot be plotted."

    if status_series is None or status_series.empty:
        return "No confirmed students yet—trend analysis will appear once enrolments commence."

    active_mask = _is_active_status(status_series)
    if not active_mask.any():
        return "No confirmed students yet—trend analysis will appear once enrolments commence."

    available_columns = [col for col in [intake_col, year_col] if col]
    subset = df.loc[active_mask, available_columns]
    if intake_col:
        subset[intake_col] = df.loc[active_mask, intake_col]
    if year_col:
        subset[year_col] = df.loc[active_mask, year_col]

    subset = subset.copy()
    subset["term"] = subset.apply(
        lambda row: _compose_term(
            row.get(intake_col) if intake_col and intake_col in subset.columns else "",
            row.get(year_col) if year_col and year_col in subset.columns else "",
        ),
        axis=1,
    )
    subset = subset[subset["term"].ne("Unknown")]
    if subset.empty:
        return "Intake details are incomplete, so the trend cannot be calculated yet."

    counts = subset["term"].value_counts()
    ordered_terms = sorted(counts.index.tolist(), key=_term_sort_key)
    if not ordered_terms:
        return "Intake details are incomplete, so the trend cannot be calculated yet."

    latest_term = ordered_terms[-1]
    latest_count = int(counts[latest_term])

    if len(ordered_terms) == 1:
        return (
            f"Summary: {latest_term} has {latest_count} confirmed students so far.\n"
            "Action: Continue nurturing upcoming intakes to build on this baseline."
        )

    previous_term = ordered_terms[-2]
    previous_count = int(counts[previous_term])
    delta = latest_count - previous_count
    direction = "up" if delta >= 0 else "down"
    delta_abs = abs(delta)
    summary = (
        f"Summary: {latest_term} recorded {latest_count} enrolments, {delta_abs} {direction} from {previous_term}."
    )
    context = f"Context: The trend reflects {len(ordered_terms)} recent intakes with reliable data."
    if delta >= 0:
        action = "Action: Reinforce the campaigns that lifted the latest intake."
    else:
        action = "Action: Investigate the drop-off drivers with recruitment leads."
    return "\n".join([summary, context, action])


def _build_revenue_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    if status_series is None or status_series.empty:
        return (
            "Summary: Revenue cannot be estimated because enrolment statuses are missing.\n"
            "Action: Update student progression before forecasting tuition revenue."
        )

    active_mask = _is_active_status(status_series)
    confirmed = int(active_mask.sum())
    if confirmed == 0:
        return (
            "Summary: Revenue cannot be estimated because no students are confirmed yet.\n"
            "Action: Prioritise conversions before building the financial forecast."
        )

    assumed_fee = 18500
    confirmed_value = confirmed * assumed_fee

    offer_mask = status_series == "offered"
    offers = int(offer_mask.sum())
    pipeline_fragment = ""
    if offers:
        potential_value = offers * assumed_fee * 0.6 
        pipeline_fragment = (
            f"A further {offers} offers could add about {_format_currency(potential_value)} "
            "if 60% convert."
        )

    summary = (
        f"Summary: {confirmed} confirmed students represent about {_format_currency(confirmed_value)} in tuition revenue."
    )
    context = f"Context: Estimate based on {_format_currency(assumed_fee)} per enrolment."
    if pipeline_fragment:
        action = f"Action: {pipeline_fragment.strip()}"
    else:
        action = "Action: Maintain conversion velocity to safeguard the revenue outlook."
    return "\n".join([summary, context, action])


def _build_stage_health_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    stage_column = _resolve_column_name(df, "Stage")
    if not stage_column:
        return "Pipeline stage tracking is not available in the current dataset."

    stages = (
        _normalise_series(df[stage_column])
        .replace({"", "nan"}, pd.NA)
        .dropna()
    )
    if stages.empty:
        return "Stage progression has not been recorded yet."

    counts = stages.value_counts()
    total = int(counts.sum())
    leader = counts.index[0]
    leader_count = int(counts.iloc[0])
    share = _format_percentage(leader_count, total)

    if len(counts) == 1:
        return (
            f"Summary: All {total} applicants are sitting in {leader}.\n"
            "Action: Confirm whether progression updates are overdue for these cases."
        )

    runner = counts.index[1]
    runner_count = int(counts.iloc[1])
    summary = (
        f"Summary: {leader} is the busiest stage with {leader_count} applicants ({share})."
    )
    context = f"Context: {runner} follows with {runner_count} in the queue."
    action = (
        f"Action: Troubleshoot blockers in {leader} so applicants continue advancing."
    )
    return "\n".join([summary, context, action])


def _build_mode_of_study_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    mode_column = _resolve_column_name(df, "Mode of Study")
    if not mode_column:
        return "Study mode preferences are missing from the current dataset."

    modes = (
        _normalise_series(df[mode_column])
        .replace({"", "nan"}, pd.NA)
        .dropna()
    )
    if modes.empty:
        return "Applicants have not provided their preferred study mode yet."

    counts = modes.value_counts()
    total = int(counts.sum())
    leader = counts.index[0]
    leader_count = int(counts.iloc[0])
    share = _format_percentage(leader_count, total)

    if len(counts) == 1:
        return (
            f"Summary: Every applicant prefers {leader} delivery so far.\n"
            "Action: Ensure capacity planning aligns with this preference."
        )

    runner = counts.index[1]
    runner_count = int(counts.iloc[1])
    runner_share = _format_percentage(runner_count, total)
    summary = (
        f"Summary: {leader} is the preferred study mode for {leader_count} students ({share})."
    )
    context = f"Context: {runner} attracts {runner_count} learners ({runner_share})."
    action = "Action: Align delivery resources with these preferences."
    return "\n".join([summary, context, action])


def _build_visa_mix_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    visa_column = _resolve_column_name(df, "Visa Status")
    if not visa_column:
        return "Visa readiness cannot be analysed without visa status information."

    visas = (
        _normalise_series(df[visa_column])
        .replace({"", "nan"}, pd.NA)
        .dropna()
    )
    if visas.empty:
        return "Visa status has not been captured for applicants yet."

    counts = visas.value_counts()
    total = int(counts.sum())
    leader = counts.index[0]
    leader_count = int(counts.iloc[0])
    share = _format_percentage(leader_count, total)

    if len(counts) == 1:
        return (
            f"Summary: Every applicant is currently recorded as {leader}.\n"
            "Action: Confirm documentation requirements are aligned with this profile."
        )

    runner = counts.index[1]
    runner_count = int(counts.iloc[1])
    summary = (
        f"Summary: {leader} applicants lead the pipeline with {leader_count} cases ({share})."
    )
    context = f"Context: {runner} follows with {runner_count} students needing support."
    action = "Action: Coordinate visa assistance based on these priority cohorts."
    return "\n".join([summary, context, action])


def _build_campus_demand_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    campus_column = _resolve_column_name(df, "Campus Name", "Campus")
    if not campus_column:
        return "Campus preference data is unavailable in the dataset."

    if status_series is not None and not status_series.empty:
        focus_mask = _is_active_status(status_series)
        if focus_mask.any():
            working = df.loc[focus_mask, campus_column]
        else:
            working = df[campus_column]
    else:
        working = df[campus_column]

    campuses = (
        _normalise_series(working)
        .replace({"", "nan"}, pd.NA)
        .dropna()
    )
    if campuses.empty:
        return "Students have not selected a campus yet."

    counts = campuses.value_counts()
    total = int(counts.sum())
    leader = counts.index[0]
    leader_count = int(counts.iloc[0])
    share = _format_percentage(leader_count, total)

    if len(counts) == 1:
        return (
            f"Summary: All interest is centred on the {leader} campus for now.\n"
            "Action: Validate capacity to deliver on this concentrated demand."
        )

    runner = counts.index[1]
    runner_count = int(counts.iloc[1])
    summary = (
        f"Summary: {leader} attracts {leader_count} students ({share}), leading campus demand."
    )
    context = f"Context: {runner} is the next preference with {runner_count} prospects."
    action = "Action: Balance marketing and resources across the top campuses."
    return "\n".join([summary, context, action])


def _build_status_progress_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    if status_series is None or status_series.empty:
        return "Application status data is unavailable, so pipeline momentum cannot be summarised."

    counts = status_series.value_counts()
    if counts.empty:
        return "Application statuses have not been updated yet."

    total = int(counts.sum())
    leader = counts.index[0]
    leader_count = int(counts.iloc[0])
    share = _format_percentage(leader_count, total)

    if len(counts) == 1:
        status_label = leader.title()
        return (
            f"Summary: Every record is currently marked as {status_label}.\n"
            "Action: Confirm whether status updates are overdue."
        )

    runner = counts.index[1]
    runner_count = int(counts.iloc[1])
    status_label = leader.title()
    runner_label = runner.title()
    summary = (
        f"Summary: {status_label} leads the pipeline with {leader_count} cases ({share})."
    )
    context = (
        f"Context: {runner_label} follows with {runner_count}, signalling the next conversion focus."
    )
    action = "Action: Align follow-ups to accelerate movement from the leading status."
    return "\n".join([summary, context, action])


def _build_offer_expiry_story(
    df: pd.DataFrame, status_series: Optional[pd.Series] = None
) -> str:
    expiry_column = _resolve_column_name(df, "Offer Expiry Date")
    if not expiry_column:
        return "Offer expiry tracking is not available in the dataset."

    dates = pd.to_datetime(df[expiry_column], errors="coerce")
    dates = dates.dropna()
    if dates.empty:
        return "Offer expiry dates have not been recorded yet."

    today = pd.Timestamp.now().normalize()
    upcoming = dates[(dates >= today) & (dates <= today + pd.Timedelta(days=30))]
    overdue = dates[dates < today]

    summary = (
        f"Summary: {len(upcoming)} offers expire within the next 30 days, "
        f"while {len(overdue)} are already past due."
    )
    context = "Context: Expiry monitoring is based on recorded offer dates in the CRM."
    if len(upcoming) > 0:
        next_expiry = upcoming.min().strftime("%d %b %Y")
        action = f"Action: Prioritise renewals ahead of the next expiry on {next_expiry}."
    else:
        action = "Action: Follow up on overdue offers to recover potential enrolments."
    return "\n".join([summary, context, action])


@dataclass(frozen=True)
class StoryCandidate:
    key: str
    title: str
    builder: Callable[[pd.DataFrame, Optional[pd.Series]], str]
    theme: str = "blue"


_MANAGER_STORY_CANDIDATES: Sequence[StoryCandidate] = (
    StoryCandidate("due_payments", "Due Payments", _build_due_payments_story, "blue"),
    StoryCandidate("course_performance", "Course Performance", _build_course_performance_story, "orange"),
    StoryCandidate("study_reasons", "Top Study Reasons", _build_study_reason_story, "green"),
    StoryCandidate("stage_health", "Pipeline Momentum", _build_stage_health_story, "purple"),
    StoryCandidate("study_mode", "Study Mode Preferences", _build_mode_of_study_story, "teal"),
    StoryCandidate("visa_mix", "Visa Readiness", _build_visa_mix_story, "slate"),
)


_LEADER_STORY_CANDIDATES: Sequence[StoryCandidate] = (
    StoryCandidate("top_agents", "Top Performing Agents", _build_top_agents_story, "blue"),
    StoryCandidate("enrollment_trend", "Enrolment Trend", _build_enrolment_trend_story, "orange"),
    StoryCandidate("estimated_revenue", "Estimated Revenue", _build_revenue_story, "green"),
    StoryCandidate("campus_demand", "Campus Demand", _build_campus_demand_story, "purple"),
    StoryCandidate("status_progress", "Pipeline Status Mix", _build_status_progress_story, "teal"),
    StoryCandidate("offer_expiry", "Offer Expiry Watch", _build_offer_expiry_story, "slate"),
)


def _is_informative_story(text: str) -> bool:
    """Heuristically determine whether a storyboard contains real insight."""

    cleaned = str(text or "").strip().lower()
    if not cleaned:
        return False

    fallback_tokens = [
        "not available",
        "missing",
        "unavailable",
        "cannot be",
        "can't",
        "no students",
        "not been captured",
        "not been recorded",
        "incomplete",
        "yet.",
        "yet—",
        "yet-",
        "temporarily unavailable",
    ]

    return not any(token in cleaned for token in fallback_tokens)


def _generate_stories(
    candidates: Sequence[StoryCandidate],
    df: pd.DataFrame,
    status_series: Optional[pd.Series],
    limit: int = 3,
) -> List[Dict[str, object]]:
    informative: List[Dict[str, object]] = []
    fallback: List[Dict[str, object]] = []

    for candidate in candidates:
        try:
            text = candidate.builder(df, status_series)
        except Exception:
            LOGGER.exception("Storyboard builder %s failed", candidate.key)
            text = _FALLBACK_MESSAGE

        story = {
            "key": candidate.key,
            "title": candidate.title,
            "text": text,
            "theme": candidate.theme,
        }

        if _is_informative_story(text):
            informative.append(story)
        else:
            fallback.append(story)

    selected = informative[:limit]
    if len(selected) < limit:
        selected.extend(fallback[: limit - len(selected)])

    if not selected:
        return [
            {
                "key": "unavailable",
                "title": "AI Insight",
                "text": _FALLBACK_MESSAGE,
                "theme": "blue",
            }
        ]

    return selected


def _build_managerial_insights(
    df: pd.DataFrame, status_series: Optional[pd.Series]
) -> List[Dict[str, object]]:
    return _generate_stories(_MANAGER_STORY_CANDIDATES, df, status_series)


def _build_leader_insights(
    df: pd.DataFrame, status_series: Optional[pd.Series]
) -> List[Dict[str, object]]:
    return _generate_stories(_LEADER_STORY_CANDIDATES, df, status_series)


def _build_failure_payload(reason: str) -> Dict[str, Dict[str, object]]:
    message = f"{_FALLBACK_MESSAGE} ({reason})"
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manager_stories = [
        {
            "key": candidate.key,
            "title": candidate.title,
            "text": message,
            "theme": candidate.theme,
        }
        for candidate in list(_MANAGER_STORY_CANDIDATES)[:3]
    ]
    leader_stories = [
        {
            "key": candidate.key,
            "title": candidate.title,
            "text": message,
            "theme": candidate.theme,
        }
        for candidate in list(_LEADER_STORY_CANDIDATES)[:3]
    ]
    return {
        "manager": {"updated_at": timestamp, "stories": manager_stories},
        "leader": {"updated_at": timestamp, "stories": leader_stories},
    }


def refresh_storyboards() -> Dict[str, Dict[str, object]]:
    """Recompute storyboard insights and update the cache."""
    try:
        df = _load_dataframe()
    except Exception as exc:
        LOGGER.exception("Failed to load admissions data for storyboard analysis")
        payload = _build_failure_payload(str(exc))
    else:
        status_series = _status_series(df)
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        payload = {
            "manager": {"updated_at": timestamp, "stories": _build_managerial_insights(df, status_series)},
            "leader": {"updated_at": timestamp, "stories": _build_leader_insights(df, status_series)},
        }

    with _cache_lock:
        _storyboard_cache.clear()
        for role, data in payload.items():
            stories = [dict(story) for story in data.get("stories", [])]
            _storyboard_cache[role] = {
                "updated_at": data.get("updated_at"),
                "stories": stories,
            }

    _log_storyboards(payload)

    return get_all_storyboards()


def _log_storyboards(payload: Dict[str, Dict[str, object]]) -> None:
    """Append the current storyboard payload to a CSV audit log."""

    try:
        log_path = get_storyboard_log_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        rows = []
        for role, data in payload.items():
            updated_at = data.get("updated_at") or datetime.now(timezone.utc).isoformat(timespec="seconds")
            stories = data.get("stories") or []
            for story in stories:
                rows.append(
                    {
                        "timestamp": updated_at,
                        "role": role,
                        "story_key": story.get("key", ""),
                        "story_title": story.get("title", ""),
                        "story_text": str(story.get("text", "")),
                    }
                )

        if not rows:
            return

        file_exists = log_path.exists()
        with log_path.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["timestamp", "role", "story_key", "story_title", "story_text"],
            )
            if not file_exists:
                writer.writeheader()
            writer.writerows(rows)
    except Exception: 
        LOGGER.exception("Failed to append storyboard insights to log")


def get_storyboards_for_role(role: str) -> Optional[Dict[str, object]]:
    """Return cached storyboard insights for the requested role."""
    if not role:
        return None
    normalized = role.strip().lower()
    with _cache_lock:
        data = _storyboard_cache.get(normalized)
    if not data:
        return None
    stories = [dict(story) for story in data.get("stories", [])]
    return {"updated_at": data.get("updated_at"), "stories": stories}


def get_all_storyboards() -> Dict[str, Dict[str, object]]:
    with _cache_lock:
        return {
            role: {
                "updated_at": data.get("updated_at"),
                "stories": [dict(story) for story in data.get("stories", [])],
            }
            for role, data in _storyboard_cache.items()
        }


def start_background_refresh(interval_seconds: int = _DEFAULT_REFRESH_INTERVAL) -> Optional[threading.Thread]:
    """Start a daemon thread that periodically refreshes the storyboard cache."""
    global _refresh_thread

    with _cache_lock:
        if _refresh_thread and _refresh_thread.is_alive():
            return _refresh_thread

    def _worker() -> None:
        while True:
            time.sleep(max(60, interval_seconds))
            try:
                refresh_storyboards()
            except Exception:
                LOGGER.exception("Background storyboard refresh failed")

    thread = threading.Thread(target=_worker, name="StoryboardRefresh", daemon=True)
    thread.start()

    with _cache_lock:
        _refresh_thread = thread
    return thread



try:
    refresh_storyboards()
except Exception:
    LOGGER.exception("Initial storyboard refresh failed")
