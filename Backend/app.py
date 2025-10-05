import json
import os
import re
from datetime import datetime, timezone, date
from functools import wraps
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from flask import Flask, render_template, request, redirect, url_for, jsonify, session, flash
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import pandas as pd
from dotenv import load_dotenv

# Support running the app both as ``python app.py`` and via ``flask run``.
if __package__ in (None, ""):
    import sys

    sys.path.append(os.path.dirname(os.path.dirname(__file__)))
    from backend.ai_narratives.storyboard_engine import (
        get_storyboards_for_role,
        refresh_storyboards as refresh_storyboards_cache,
        start_background_refresh,
    )
else:
    from .ai_narratives.storyboard_engine import (
        get_storyboards_for_role,
        refresh_storyboards as refresh_storyboards_cache,
        start_background_refresh,
    )

# Load environment variables from .env for configuration
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_PATH = DATA_DIR / "dummy_data.xlsx"
SQLITE_DB = DATA_DIR / "dummy_data.db"
SHARE_DB = DATA_DIR / "share_requests.db"
CONTACT_LOG_PATH = DATA_DIR / "contact_messages.xlsx"
USERS_DB = DATA_DIR / "users.db"

# Keep offer expiry surge focused on roughly the last/next 12 months.
OFFER_EXPIRY_LOOKAHEAD_DAYS = 365

def init_db():
    # Create users table if it does not already exist
    conn = sqlite3.connect(os.fspath(USERS_DB))
    c = conn.cursor()
    c.execute('CREATE TABLE IF NOT EXISTS users (\n            id INTEGER PRIMARY KEY AUTOINCREMENT,\n            email TEXT UNIQUE NOT NULL,\n            password TEXT NOT NULL,\n            role TEXT NOT NULL\n        )')
    conn.commit()
    conn.close()

# Initialize database on module import
init_db()


def init_share_db() -> None:
    """Ensure the dashboard share request log exists."""
    conn = sqlite3.connect(os.fspath(SHARE_DB))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS share_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_email TEXT NOT NULL,
                recipient_email TEXT NOT NULL,
                subject TEXT,
                message TEXT,
                charts_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


init_share_db()

# Toggle reading data from SharePoint instead of local/SQLite
USE_SP = os.getenv('USE_SHAREPOINT', 'false').lower() in ('1', 'true', 'yes')
print('DEBUG: USE_SHAREPOINT =', USE_SP)


def _is_benign_sql_error(exc: Exception) -> bool:
    """Return True if the SQLite exception is a harmless 'missing object' error."""
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            'no such table',
            'no such view',
            'no such column',
            'sqlite db not found',
            'unable to open database file',
        )
    )


def _resolve_column(columns: List[str], candidates: List[str]) -> Optional[str]:
    """Find the best matching column name from a list of candidates."""
    if not columns:
        return None

    normalized = {str(col).lower().replace(' ', '').replace('_', ''): col for col in columns}
    lowered = {str(col).lower(): col for col in columns}

    for name in candidates:
        if name in columns:
            return name
        lowered_name = name.lower()
        if lowered_name in lowered:
            return lowered[lowered_name]
        compact = lowered_name.replace(' ', '').replace('_', '')
        if compact in normalized:
            return normalized[compact]
    for name in candidates:
        compact = name.lower().replace(' ', '').replace('_', '')
        for key, value in normalized.items():
            if compact and compact in key:
                return value
    return None


def _load_report_dataframe() -> pd.DataFrame:
    """Load the master student dataset from the preferred data source."""
    try:
        return _load_tabular_dataset('reportdata')
    except Exception as exc:
        app.logger.warning('Falling back to empty report dataframe: %s', exc)
        return pd.DataFrame()


def _standardise_text_series(series: pd.Series, *, default: Optional[str] = None) -> pd.Series:
    if series is None:
        if default is None:
            return pd.Series([None])
        return pd.Series([default])
    def _coerce(value):
        if pd.isna(value):
            return ''
        if isinstance(value, (bytes, bytearray)):
            try:
                return value.decode('utf-8', errors='ignore')
            except Exception:
                return value.decode('latin-1', errors='ignore')
        return str(value)

    cleaned = series.map(_coerce)
    cleaned = cleaned.str.strip()
    cleaned = cleaned.str.replace(r'\s+', ' ', regex=True)
    if default is not None:
        cleaned = cleaned.replace('', default)
    return cleaned


def _filter_relevant_expiry_dates(dates: pd.Series) -> pd.Series:
    """Return offer expiry dates within a sensible +/- 12 month window."""
    if dates is None or dates.empty:
        return pd.Series(dtype='datetime64[ns]')

    today = pd.Timestamp.now().normalize()
    window_start = today - pd.Timedelta(days=OFFER_EXPIRY_LOOKAHEAD_DAYS)
    window_end = today + pd.Timedelta(days=OFFER_EXPIRY_LOOKAHEAD_DAYS)

    filtered = dates[(dates >= window_start) & (dates <= window_end)]
    if not filtered.empty:
        return filtered

    latest = dates.max()
    if pd.isna(latest):
        return dates.iloc[0:0]

    window_start = latest - pd.Timedelta(days=OFFER_EXPIRY_LOOKAHEAD_DAYS)
    window_end = latest + pd.Timedelta(days=OFFER_EXPIRY_LOOKAHEAD_DAYS)
    return dates[(dates >= window_start) & (dates <= window_end)]


def _get_standardised_records() -> pd.DataFrame:
    """Return a dataframe with harmonised column names for downstream APIs."""
    raw = _load_report_dataframe()
    if raw.empty:
        return pd.DataFrame(
            columns=[
                'student_id',
                'agent',
                'offer_id',
                'course_type',
                'visa_status',
                'status',
                'start_date',
                'enrolment_fees',
            ]
        )

    student_col = _resolve_column(raw.columns.tolist(), ['student_id', 'Student_Id', 'Student ID'])
    agent_col = _resolve_column(raw.columns.tolist(), ['agent_name', 'Agent_Name', 'agentname', 'Agent'])
    offer_col = _resolve_column(raw.columns.tolist(), ['offer_id', 'Offer_Id', 'Offer ID'])
    course_col = _resolve_column(raw.columns.tolist(), ['course_type', 'Course Type', 'coursetype'])
    visa_col = _resolve_column(raw.columns.tolist(), ['visa_status', 'Visa Status', 'visa_type', 'Visa Type'])
    status_col = _resolve_column(raw.columns.tolist(), ['status', 'Status', 'application_status'])
    start_col = _resolve_column(raw.columns.tolist(), ['start_date', 'Start_Date', 'Start Date', 'startdate'])
    fee_col = _resolve_column(raw.columns.tolist(), ['enrolment_fees', 'Enrolment_Fees', 'Enrolment Fees'])
    paid_fee_col = _resolve_column(raw.columns.tolist(), ['paid_fees', 'Paid_Fees', 'Paid Fees'])

    frame = pd.DataFrame(index=raw.index)

    def _default_series(value: str) -> pd.Series:
        return pd.Series([value] * len(raw), index=raw.index)

    frame['student_id'] = _standardise_text_series(
        raw[student_col] if student_col else _default_series(''),
        default='',
    ).fillna('')
    frame['agent'] = _standardise_text_series(
        raw[agent_col] if agent_col else _default_series('Unassigned'),
        default='Unassigned',
    )
    frame['offer_id'] = _standardise_text_series(
        raw[offer_col] if offer_col else _default_series('Unknown'),
        default='Unknown',
    )
    frame['course_type'] = _standardise_text_series(
        raw[course_col] if course_col else _default_series('Unknown'),
        default='Unknown',
    )
    frame['visa_status'] = _standardise_text_series(
        raw[visa_col] if visa_col else _default_series('Unknown'),
        default='Unknown',
    )
    statuses = _standardise_text_series(
        raw[status_col] if status_col else _default_series('Unknown'),
        default='Unknown',
    )
    frame['status'] = statuses.str.title()

    if start_col and start_col in raw.columns:
        start_series = pd.to_datetime(raw[start_col], errors='coerce', dayfirst=False)
    else:
        start_series = pd.Series(pd.NaT, index=raw.index)
    frame['start_date'] = start_series

    if fee_col and fee_col in raw.columns:
        fees = pd.to_numeric(raw[fee_col], errors='coerce').fillna(0)
    else:
        fees = pd.Series(0, index=raw.index, dtype=float)
    frame['enrolment_fees'] = fees.astype(float)

    if paid_fee_col and paid_fee_col in raw.columns:
        paid = pd.to_numeric(raw[paid_fee_col], errors='coerce').fillna(0)
    else:
        paid = pd.Series(0, index=raw.index, dtype=float)
    frame['paid_fees'] = paid.astype(float)

    return frame


def _build_revenue_forecast_rows() -> List[dict]:
    records = _get_standardised_records()
    if records.empty:
        return []

    if 'start_date' not in records.columns:
        return []

    working = records.copy()
    working = working[working['start_date'].notna()].copy()
    if working.empty:
        return []

    # ``Timestamp.utcnow()`` returns a timezone-aware value in UTC, whereas the
    # record data is timezone-naive.  Trying to compare the two raises
    # ``TypeError: Cannot compare tz-naive and tz-aware`` which bubbles up to the
    # API and prevents the chart from rendering.  Drop the timezone information
    # so that the comparison operates on like-for-like values.
    today = pd.Timestamp.utcnow().tz_localize(None).normalize()
    month_start = today.replace(day=1)
    horizon_end = month_start + pd.DateOffset(months=12)

    start_min = working['start_date'].min()
    start_max = working['start_date'].max()

    if pd.isna(start_min) or pd.isna(start_max):
        return []

    if start_max < month_start:
        reference_month = pd.Timestamp(start_max).replace(day=1)
        month_start = (reference_month - pd.DateOffset(months=11)).normalize()
        horizon_end = month_start + pd.DateOffset(months=12)
    elif start_min >= horizon_end:
        month_start = pd.Timestamp(start_min).replace(day=1).normalize()
        horizon_end = month_start + pd.DateOffset(months=12)

    statuses = working['status'].astype(str).str.lower().str.strip()
    mask = (
        (working['start_date'] >= month_start)
        & (working['start_date'] < horizon_end)
        & (~statuses.str.startswith('withdraw'))
    )
    filtered = working.loc[mask].copy()
    if filtered.empty:
        return []

    filtered['forecast_month'] = filtered['start_date'].dt.to_period('M').dt.to_timestamp()
    filtered['forecast_month_label'] = filtered['forecast_month'].dt.strftime('%b %Y')
    filtered['forecast_month'] = filtered['forecast_month'].dt.strftime('%Y-%m-%d')
    filtered['start_date'] = filtered['start_date'].dt.strftime('%Y-%m-%d')

    subset = filtered[
        [
            'student_id',
            'agent',
            'offer_id',
            'course_type',
            'visa_status',
            'status',
            'start_date',
            'forecast_month',
            'forecast_month_label',
            'enrolment_fees',
            'paid_fees',
        ]
    ].copy()

    subset['enrolment_fees'] = subset['enrolment_fees'].astype(float)
    if 'paid_fees' not in subset.columns:
        subset['paid_fees'] = 0.0
    subset['paid_fees'] = subset['paid_fees'].astype(float)
    return subset.to_dict(orient='records')


def _build_agent_performance_rows() -> List[dict]:
    records = _get_standardised_records()
    if records.empty:
        return []

    payload = records.copy()
    if 'start_date' in payload.columns:
        payload['start_date'] = payload['start_date'].dt.strftime('%Y-%m-%d')

    columns = [
        'student_id',
        'agent',
        'offer_id',
        'status',
        'start_date',
        'course_type',
        'visa_status',
        'enrolment_fees',
    ]

    for col in columns:
        if col not in payload.columns:
            payload[col] = '' if col != 'enrolment_fees' else 0.0

    payload['enrolment_fees'] = payload['enrolment_fees'].astype(float)
    return payload[columns].to_dict(orient='records')


def _build_student_classification_rows() -> List[dict]:
    records = _get_standardised_records()
    if records.empty:
        return []

    payload = records.copy()
    if 'start_date' in payload.columns:
        payload['start_date'] = payload['start_date'].dt.strftime('%Y-%m-%d')

    columns = [
        'student_id',
        'course_type',
        'visa_status',
        'status',
        'agent',
        'start_date',
        'enrolment_fees',
    ]

    for col in columns:
        if col not in payload.columns:
            payload[col] = '' if col != 'enrolment_fees' else 0.0

    payload['enrolment_fees'] = payload['enrolment_fees'].astype(float)
    return payload[columns].to_dict(orient='records')



def _normalise_category(value: Optional[str], *, default: str = 'Unknown') -> str:
    text_value = '' if value is None else str(value).strip()
    return text_value or default


def _build_study_reason_by_course_rows() -> List[dict]:
    frame = _load_report_dataframe()
    if frame.empty:
        return []

    student_col = _resolve_column(frame.columns.tolist(), ['student_id', 'Student_Id', 'Student ID'])
    course_col = _resolve_column(frame.columns.tolist(), ['course_name', 'Course_Name', 'course'])
    reason_col = _resolve_column(frame.columns.tolist(), ['study_reason', 'Study_Reason', 'Reason for Study'])
    course_type_col = _resolve_column(frame.columns.tolist(), ['course_type', 'Course_Type', 'Course Type'])

    if not student_col or not course_col or not reason_col:
        return []

    working = pd.DataFrame({
        'student_id': _standardise_text_series(frame[student_col], default='').fillna(''),
        'course_name': _standardise_text_series(frame[course_col], default='Unknown').fillna('Unknown'),
        'study_reason': _standardise_text_series(frame[reason_col], default='Unknown').fillna('Unknown'),
    })

    if course_type_col:
        working['course_type'] = _standardise_text_series(frame[course_type_col], default='Unknown').fillna('Unknown')
    else:
        working['course_type'] = 'Unknown'

    working = working[working['student_id'].str.strip() != '']
    if working.empty:
        return []

    grouped = (
        working.groupby(['course_name', 'study_reason'], dropna=False)
        .agg(
            student_count=('student_id', 'nunique'),
            course_type=('course_type', lambda s: s.mode().iat[0] if not s.mode().empty else s.iloc[0]),
        )
        .reset_index()
    )

    grouped['course_name'] = grouped['course_name'].map(lambda v: _normalise_category(v))
    grouped['study_reason'] = grouped['study_reason'].map(lambda v: _normalise_category(v))
    grouped['course_type'] = grouped['course_type'].map(lambda v: _normalise_category(v))

    grouped = grouped[grouped['student_count'] > 0]
    grouped = grouped.sort_values(['course_name', 'study_reason'])
    return grouped.to_dict(orient='records')


def _build_students_by_trimester_rows() -> List[dict]:
    frame = _load_report_dataframe()
    if frame.empty:
        return []

    student_col = _resolve_column(frame.columns.tolist(), ['student_id', 'Student_Id', 'Student ID'])
    start_col = _resolve_column(frame.columns.tolist(), ['start_date', 'Start_Date', 'Start Date'])
    trimester_col = _resolve_column(frame.columns.tolist(), ['trimester', 'Trimester', 'Term'])

    if not student_col:
        return []

    working = pd.DataFrame({
        'student_id': _standardise_text_series(frame[student_col], default='').fillna(''),
    })
    working = working[working['student_id'].str.strip() != '']
    if working.empty:
        return []

    if start_col and start_col in frame.columns:
        working['start_date'] = pd.to_datetime(frame[start_col], errors='coerce')
    else:
        working['start_date'] = pd.NaT

    if trimester_col:
        working['trimester'] = _standardise_text_series(frame[trimester_col], default='Unknown').fillna('Unknown')
    else:
        working['trimester'] = 'Unknown'

    def derive_term(row: pd.Series) -> str:
        trimester = _normalise_category(row.get('trimester'), default='Unknown')
        start_date = row.get('start_date')

        if trimester.lower() != 'unknown':
            if pd.notna(start_date):
                return f"{trimester} {start_date.year}"
            return trimester

        if pd.notna(start_date):
            return start_date.strftime('%Y')
        return 'Unknown'

    working['term'] = working.apply(derive_term, axis=1)

    grouped = (
        working.groupby('term', dropna=False)
        .agg(
            student_count=('student_id', 'nunique'),
            trimester=('trimester', lambda s: s.mode().iat[0] if not s.mode().empty else _normalise_category(s.iloc[0])),
            first_start_date=('start_date', 'min'),
        )
        .reset_index()
    )

    if grouped.empty:
        return []

    grouped['term'] = grouped['term'].map(lambda v: _normalise_category(v))
    grouped['trimester'] = grouped['trimester'].map(lambda v: _normalise_category(v))
    grouped['first_start_date'] = grouped['first_start_date'].apply(
        lambda v: v.strftime('%Y-%m-%d') if pd.notna(v) else None
    )

    grouped = grouped.sort_values('term')
    return grouped.to_dict(orient='records')


def _build_visa_breakdown_rows() -> List[dict]:
    frame = _load_report_dataframe()
    if frame.empty:
        return []

    visa_col = _resolve_column(
        frame.columns.tolist(),
        ['visa_type', 'Visa_Type', 'Visa Type', 'visa_status', 'Visa_Status', 'Visa Status'],
    )
    student_col = _resolve_column(frame.columns.tolist(), ['student_id', 'Student_Id', 'Student ID'])
    if not visa_col or not student_col:
        return []

    working = pd.DataFrame({
        'student_id': _standardise_text_series(frame[student_col], default='').fillna(''),
        'visa_type': _standardise_text_series(frame[visa_col], default='Unknown').fillna('Unknown'),
    })
    working = working[working['student_id'].str.strip() != '']
    if working.empty:
        return []

    grouped = (
        working.groupby('visa_type', dropna=False)['student_id']
        .nunique()
        .reset_index(name='student_count')
        .sort_values('student_count', ascending=False)
    )
    grouped['visa_type'] = grouped['visa_type'].map(lambda v: _normalise_category(v))
    return grouped.to_dict(orient='records')


def _build_course_by_manager_rows() -> List[dict]:
    frame = _load_report_dataframe()
    if frame.empty:
        return []

    student_col = _resolve_column(frame.columns.tolist(), ['student_id', 'Student_Id', 'Student ID'])
    course_col = _resolve_column(frame.columns.tolist(), ['course_name', 'Course_Name', 'course'])
    manager_col = _resolve_column(frame.columns.tolist(), ['course_manager', 'Course_Manager', 'manager'])
    trimester_col = _resolve_column(frame.columns.tolist(), ['trimester', 'Trimester', 'Term'])

    if not student_col or not course_col or not manager_col:
        return []

    working = pd.DataFrame({
        'student_id': _standardise_text_series(frame[student_col], default='').fillna(''),
        'course_name': _standardise_text_series(frame[course_col], default='Unknown').fillna('Unknown'),
        'course_manager': _standardise_text_series(frame[manager_col], default='Unknown').fillna('Unknown'),
    })

    if trimester_col:
        working['trimester'] = _standardise_text_series(frame[trimester_col], default='Unknown').fillna('Unknown')
    else:
        working['trimester'] = 'Unknown'

    working = working[working['student_id'].str.strip() != '']
    if working.empty:
        return []

    grouped = (
        working.groupby(['course_name', 'course_manager', 'trimester'], dropna=False)['student_id']
        .nunique()
        .reset_index(name='student_count')
    )

    for col in ('course_name', 'course_manager', 'trimester'):
        grouped[col] = grouped[col].map(lambda v: _normalise_category(v))

    grouped = grouped[grouped['student_count'] > 0]
    if grouped.empty:
        return []

    grouped = grouped.sort_values(['course_manager', 'course_name', 'trimester'])
    return grouped.to_dict(orient='records')

AI_CHAT_DEFAULT_FOLLOW_UPS: List[str] = [
    "How can I customise dashboards for my team?",
    "Where do the insights and AI narratives come from?",
    "How do I share insights with colleagues?",
    "How can I contact the team for more help?",
]

AI_CHAT_ROLE_CONTEXT = {
    "default": {
        "intro": (
            "I can walk you through dashboards, AI insights, sharing features, and support options. "
            "What would you like to explore?"
        ),
        "greeting": (
            "Hello! Ask me about custom dashboards, AI storyboards, how to share insights, or where to get more help."
        ),
        "fallback": (
            "Here’s what I can help with: explaining JTrack’s dashboards, AI storyboards, data sources, and how to get more support. "
            "Try one of the suggestions below or ask about something specific."
        ),
        "follow_ups": AI_CHAT_DEFAULT_FOLLOW_UPS,
    },
    "manager": {
        "intro": (
            "I can walk you through the managerial landing dashboards, AI insights, sharing features, and support options tailored "
            "for managers. What would you like to explore?"
        ),
        "greeting": (
            "Hello Manager! Ask me about the managerial landing dashboard, AI storyboards for your team, sharing insights, or getting more help."
        ),
        "fallback": (
            "Here’s what I can help with as your managerial assistant: navigating the landing dashboard, explaining AI storyboards, and guiding collaboration workflows. "
            "Try one of the suggestions below or ask about something specific."
        ),
        "follow_ups": [
            "What KPIs are highlighted on the managerial landing dashboard?",
            "How do I open the AI storyboards for my team?",
            "How can I customise dashboards for my team?",
            "How do I share insights with colleagues?",
        ],
    },
    "leader": {
        "intro": (
            "I can brief you on leader scorecards, executive-ready AI narratives, sharing workflows, and support options. "
            "What would you like to explore?"
        ),
        "greeting": (
            "Hello Leader! Ask me about the leader dashboard, executive scorecards, AI storyboards, or how to loop in your team."
        ),
        "fallback": (
            "Here’s what I can help with for leaders: monitoring executive dashboards, reviewing AI storyboards, and coordinating follow-up support. "
            "Try one of the suggestions below or ask about something specific."
        ),
        "follow_ups": [
            "Which insights are available on the leader dashboard?",
            "How do I monitor enrolment trends and revenue?",
            "How can I get AI storyboards tailored for executives?",
            "How can I contact the team for more help?",
        ],
    },
}

AI_CHAT_TOPICS = [
    {
        "keywords": {
            "what does",
            "platform",
            "jtrack",
            "overview",
            "capability",
            "portal",
            "help me",
        },
        "answer": (
            "JTrack unifies your enrolment and student success data in one governed portal so leaders, managers, and analysts "
            "share the same KPIs. The landing page highlights role-based scorecards, one-click exports, and predictive alerts, "
            "while the managerial dashboard links directly to reports like Current Students vs Enrolled, Visa breakdowns, and "
            "offer expiry tracking."
        ),
        "follow_ups": [
            "Where do the insights and AI narratives come from?",
            "How can I customise dashboards for my team?",
            "How do I share insights with colleagues?",
        ],
        "role_answers": {
            "manager": {
                "answer": (
                    "Managers land on a KPI hub with charts for Current Students vs Enrolled, Visa status, offer expiries, and "
                    "enrolment conversions. Each card opens a detailed report, and storyboard tiles like Due Payments or Course "
                    "Performance surface AI summaries with recommended actions for your teams."
                ),
                "follow_ups": [
                    "What KPIs are highlighted on the managerial landing dashboard?",
                    "How do I open the AI storyboards for my team?",
                    "How can I customise dashboards for my team?",
                ],
            },
            "leader": {
                "answer": (
                    "Leaders see an executive dashboard covering application status, offers overview, agent performance, and "
                    "student classification, plus storyboard callouts for top agents, intake trends, and estimated revenue. It's "
                    "designed for high-level monitoring with quick links into the deeper reports."
                ),
                "follow_ups": [
                    "Which insights are available on the leader dashboard?",
                    "How do I monitor enrolment trends and revenue?",
                    "How can I get AI storyboards tailored for executives?",
                ],
            },
        },
    },
    {
        "keywords": {
            "custom",
            "create dashboard",
            "builder",
            "add chart",
            "configure",
            "layout",
        },
        "answer": (
            "Head to the Create Dashboard workspace to assemble your own view. You can add charts, save the layout, reset it, "
            "and open the Share modal to email the highlights—all without leaving the page."
        ),
        "follow_ups": [
            "How do I share insights with colleagues?",
            "Where do the insights and AI narratives come from?",
            "What does this platform help me do?",
        ],
    },
    {
        "keywords": {
            "ai",
            "insight",
            "storyboard",
            "narrative",
            "explain",
            "recommendation",
        },
        "answer": (
            "AI storyboards are refreshed in the background so managers always see narrated insights. On the managerial landing "
            "page you can tap cards like Due Payments or Top Study Reasons to open the full summary, timestamps, and action "
            "recommendations."
        ),
        "follow_ups": [
            "How can I customise dashboards for my team?",
            "How do I share insights with colleagues?",
            "How can I contact the team for more help?",
        ],
        "role_answers": {
            "leader": {
                "answer": (
                    "Leader storyboards surface executive-ready summaries such as Top Performing Agents, Enrollment Trend by Intake, "
                    "and Estimated Revenue. Tap a card from the leader dashboard to open the full AI narrative, timestamp, and "
                    "next-step recommendations for your portfolio."
                ),
                "follow_ups": [
                    "Which insights are available on the leader dashboard?",
                    "How can I get AI storyboards tailored for executives?",
                    "How can I contact the team for more help?",
                ],
            },
        },
    },
    {
        "keywords": {
            "share",
            "email",
            "send",
            "collaborate",
            "export",
            "colleague",
        },
        "answer": (
            "Every dashboard includes collaboration tools. For example, the custom dashboard page lets you open a Share modal, "
            "capture the recipient email, subject, and message, and log the request via the share API so teammates receive the "
            "same charts."
        ),
        "follow_ups": [
            "How can I customise dashboards for my team?",
            "Where do the insights and AI narratives come from?",
            "How can I contact the team for more help?",
        ],
    },
    {
        "keywords": {
            "support",
            "contact",
            "help",
            "demo",
            "trial",
            "pricing",
        },
        "answer": (
            "You can reach the team through the Contact page, which includes a guided form for general questions, demos, pricing, "
            "and support. There’s also a direct email link so you can message hello@jtrack.example if that’s easier."
        ),
        "follow_ups": [
            "What does this platform help me do?",
            "How do I share insights with colleagues?",
            "Where do the insights and AI narratives come from?",
        ],
    },
    {
        "keywords": {
            "data",
            "sharepoint",
            "source",
            "excel",
            "update",
            "refresh",
        },
        "answer": (
            "Behind the scenes, the app can read governed data from SharePoint or fall back to the bundled SQLite and Excel "
            "samples. Environment flags like USE_SHAREPOINT, SP_CLIENT_ID, and SP_FILE_PATH control which source is used so "
            "your dashboards stay current."
        ),
        "follow_ups": [
            "Where do the insights and AI narratives come from?",
            "How can I customise dashboards for my team?",
            "How can I contact the team for more help?",
        ],
    },
]


def _ai_chat_response(message: str) -> Tuple[str, List[str]]:
    """Return a lightweight assistant reply and follow-up suggestions."""

    text = (message or "").strip()
    role = (session.get("role") or "").strip().lower()
    context = AI_CHAT_ROLE_CONTEXT.get(role, AI_CHAT_ROLE_CONTEXT["default"])

    if not text:
        return context["intro"], context["follow_ups"]

    lowered = text.lower()
    greetings = {"hi", "hello", "hey", "good morning", "good afternoon", "good evening"}
    if lowered in greetings or any(lowered.startswith(greeting) for greeting in greetings):
        return context["greeting"], context["follow_ups"]

    best_entry = None
    best_score = 0
    for entry in AI_CHAT_TOPICS:
        score = sum(1 for keyword in entry["keywords"] if keyword in lowered)
        if score > best_score:
            best_score = score
            best_entry = entry

    if best_entry and best_score > 0:
        answer = best_entry["answer"]
        follow_ups = best_entry.get("follow_ups", context["follow_ups"])
        role_overrides = best_entry.get("role_answers", {})
        role_answer = role_overrides.get(role)
        if role_answer:
            answer = role_answer.get("answer", answer)
            follow_ups = role_answer.get("follow_ups", follow_ups)
        return answer, follow_ups

    return context["fallback"], context["follow_ups"]

# Optional defaults and SharePoint credentials
DEFAULT_SQLITE_TABLE = os.getenv('DEFAULT_SQLITE_TABLE')
SP_CLIENT_ID = os.getenv('SP_CLIENT_ID')
SP_CLIENT_SECRET = os.getenv('SP_CLIENT_SECRET')
SP_SITE_URL = os.getenv('SP_SITE_URL')
SP_FILE_PATH = os.getenv('SP_FILE_PATH')

# Create Flask app instance
app = Flask(__name__, static_folder='static', static_url_path='/static', template_folder='templates')
app.secret_key = os.getenv('SECRET_KEY', 'fallback_secret')

# Kick off the AI storyboard analysis during startup so the dashboards have
# insights ready on first load.
try:
    refresh_storyboards_cache()
except Exception as exc:
    app.logger.warning('Initial storyboard refresh failed: %s', exc)

def _safe_sql_identifier(name: Optional[str]) -> Optional[str]:
    # Validate that an identifier uses only safe characters
    if not name:
        return None
    name = name.strip().lower()
    if not re.fullmatch('[a-z0-9_]+', name):
        return None
    return name

def _first_user_table(conn: sqlite3.Connection) -> Optional[str]:
    # Return the first user-defined table in the SQLite database
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master\n                   WHERE type='table' AND name NOT LIKE 'sqlite_%'\n                   ORDER BY name;")
    row = cur.fetchone()
    return row[0] if row else None

def _read_sqlite(table_or_view: Optional[str]) -> pd.DataFrame:
    # Load data from the SQLite database
    if not SQLITE_DB.exists():
        raise FileNotFoundError(f'SQLite DB not found at {SQLITE_DB}')
    with sqlite3.connect(os.fspath(SQLITE_DB)) as conn:
        if table_or_view:
            safe_name = _safe_sql_identifier(table_or_view)
            if not safe_name:
                raise ValueError('Invalid table/view name (use lowercase letters, digits, underscores only).')
            query = f'SELECT * FROM "{safe_name}"'
        elif DEFAULT_SQLITE_TABLE:
            safe_name = _safe_sql_identifier(DEFAULT_SQLITE_TABLE)
            if not safe_name:
                raise ValueError('DEFAULT_SQLITE_TABLE is not a safe identifier.')
            query = f'SELECT * FROM "{safe_name}"'
        else:
            first_table = _first_user_table(conn)
            if not first_table:
                raise RuntimeError('No user tables found in SQLite DB.')
            query = f'SELECT * FROM "{first_table}"'
        df = pd.read_sql_query(query, conn)
    return df

def _read_sharepoint_excel() -> pd.DataFrame:
    # Download and read Excel data from SharePoint
    if not (SP_CLIENT_ID and SP_CLIENT_SECRET and SP_SITE_URL and SP_FILE_PATH):
        raise RuntimeError('SharePoint env vars missing: SP_CLIENT_ID, SP_CLIENT_SECRET, SP_SITE_URL, SP_FILE_PATH')
    try:
        from office365.runtime.auth.client_credential import ClientCredential
        from office365.sharepoint.client_context import ClientContext
    except Exception as e:
        raise RuntimeError('office365-rest-python-client not installed. pip install office365-rest-python-client') from e
    creds = ClientCredential(SP_CLIENT_ID, SP_CLIENT_SECRET)
    ctx = ClientContext(SP_SITE_URL).with_credentials(creds)
    response = ctx.web.get_file_by_server_relative_url(SP_FILE_PATH).download().execute_query()
    return pd.read_excel(BytesIO(response.content), sheet_name=0)

def _read_local_excel() -> pd.DataFrame:
    # Read Excel data from local path
    if not DATA_PATH.exists():
        raise FileNotFoundError(f'Excel file not found at {DATA_PATH}')
    return pd.read_excel(DATA_PATH, sheet_name=0)


def _load_tabular_dataset(table_or_view: Optional[str] = None) -> pd.DataFrame:
    """Return a populated dataframe from SharePoint, SQLite, or Excel."""

    errors: List[str] = []

    def _record_error(source: str, message: str) -> None:
        errors.append(f"{source}: {message}")

    # 1) SharePoint (if enabled)
    if USE_SP:
        try:
            df_sp = _read_sharepoint_excel()
            if not df_sp.empty:
                return df_sp
            _record_error('SharePoint', 'workbook returned no rows')
        except Exception as exc:  # pragma: no cover - depends on env configuration
            app.logger.warning('SharePoint load failed: %s', exc)
            _record_error('SharePoint', str(exc))

    # 2) SQLite database (primary local source)
    if SQLITE_DB.exists():
        sqlite_targets: List[Optional[str]] = []
        if table_or_view:
            sqlite_targets.append(table_or_view)
        sqlite_targets.append(None)  # fall back to default/first table

        for candidate in sqlite_targets:
            try:
                df_sql = _read_sqlite(candidate)
            except Exception as exc:
                log_method = app.logger.info if _is_benign_sql_error(exc) else app.logger.warning
                log_method('SQLite load failed%s: %s', f' ({candidate})' if candidate else '', exc)
                label = f"SQLite ({candidate})" if candidate else 'SQLite'
                _record_error(label, str(exc))
                continue

            if not df_sql.empty:
                return df_sql

            label = f"SQLite ({candidate})" if candidate else 'SQLite'
            _record_error(label, 'query returned no rows')
    else:
        _record_error('SQLite', f'database not found at {SQLITE_DB}')

    # 3) Excel fallback
    try:
        df_excel = _read_local_excel()
        if not df_excel.empty:
            return df_excel
        _record_error('Excel', 'workbook returned no rows')
    except Exception as exc:
        app.logger.warning('Excel load failed: %s', exc)
        _record_error('Excel', str(exc))

    raise RuntimeError('Unable to load data from available sources. ' + '; '.join(errors))


def _dataframe_to_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Convert a dataframe to JSON-safe records with friendly types."""

    def _coerce(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (bytes, bytearray)):
            if not value:
                return None
            try:
                decoded = value.decode("utf-8")
            except UnicodeDecodeError:
                if len(value) <= 8:
                    return int.from_bytes(value, byteorder="little", signed=False)
                return value.hex()
            return decoded
        if isinstance(value, pd.Timestamp):
            if pd.isna(value):
                return None
            return value.isoformat()
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, pd.Timedelta):
            # Timedelta has isoformat from pandas >= 2; str() as fallback
            return value.isoformat() if hasattr(value, 'isoformat') else str(value)
        if isinstance(value, pd.Interval):
            return str(value)
        if pd.isna(value):
            return None
        return value

    records: List[Dict[str, Any]] = []
    for record in df.to_dict(orient='records'):
        cleaned: Dict[str, Any] = {}
        for key, value in record.items():
            cleaned[key] = _coerce(value)
        records.append(cleaned)
    return records

def role_required(role: str):
    # Decorator enforcing that the session user has the given role
    def decorator(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            if 'email' not in session or session.get('role') != role:
                return redirect(url_for('login'))
            return func(*args, **kwargs)
        return wrapped
    return decorator

@app.route('/managerial')
@role_required('Manager')
def dashboard():
    # Show landing dashboard for managers
    return render_template('managerial-landing-dashboard.html')

@app.route('/managerial-dashboard')
@role_required('Manager')
def managerial_dashboard():
    # Render detailed manager dashboard
    return render_template('managerial_dashboard.html')

@app.route('/report/current-students')
@role_required('Manager')
def current_students_report():
    # Display report of current students
    return render_template('current_students_report.html')

@app.route('/report/enrolled-offer')
@role_required('Manager')
def enrolled_offer_report():
    # Report comparing enrolled students with offers
    return render_template('enrolled_offer_report.html')

@app.route('/report/visa-status')
@role_required('Manager')
def visa_status_breakdown():
    # Show visa status breakdown report
    return render_template('visa_status_breakdown.html')

@app.route('/report/course-manager')
@role_required('Manager')
def course_manager_report():
    # Report of course performance by manager
    return render_template('course_manager_report.html')


@app.route('/report/offer-expiry')
@role_required('Manager')
def offer_expiry_report():
    # Backward-compatible route for legacy bookmarks
    return redirect(url_for('course_manager_report'))

@app.route('/report/application-status')
@role_required('Leader')
def application_status_report():
    # Leader report of application statuses
    return render_template('application_status_report.html')

@app.route('/report/offers')
@role_required('Leader')
def offers_report():
    # Leader report of offer statuses
    return render_template('offers_report.html')

@app.route('/report/agent-performance')
@role_required('Leader')
def agent_performance_report():
    # Leader report of agent performance
    return render_template('agent_performance_report.html')

@app.route('/report/student-classification')
@role_required('Leader')
def student_classification_report():
    # Leader report of student classifications
    return render_template('student_classification_report.html')

@app.route('/leader-dashboard')
@role_required('Leader')
def leader_dashboard():
    # Render dashboard for leaders
    return render_template('leader_dashboard.html')

@app.route('/custom-dashboard')
def custom_dashboard():
    if 'email' not in session:
        return redirect(url_for('login'))
    # Render custom dashboard after login
    return render_template('custom_dashboard.html')

@app.route('/welcome')
def welcome():
    if 'email' not in session:
        return redirect(url_for('login'))
    role = session.get('role')
    if role == 'Manager':
        dashboard_endpoint = 'dashboard'
    elif role == 'Leader':
        dashboard_endpoint = 'leader_dashboard'
    else:
        dashboard_endpoint = 'landing'
    # Landing page after login with link to dashboard
    return render_template('welcome.html', dashboard_endpoint=dashboard_endpoint, role=role)

@app.route('/')
def landing():
    # Public landing page
    return render_template('website_landing_page.html')

def append_contact_submission(entry: dict) -> None:
    """Append a validated contact submission to the Excel log."""
    columns = ["timestamp", "name", "email", "company", "subject", "message"]
    new_row = pd.DataFrame([entry], columns=columns)

    if CONTACT_LOG_PATH.exists():
        try:
            existing = pd.read_excel(CONTACT_LOG_PATH)
            combined = pd.concat([existing, new_row], ignore_index=True)
        except Exception as exc:  # pragma: no cover - defensive logging
            app.logger.exception("Failed to read existing contact log: %s", exc)
            combined = new_row
    else:
        combined = new_row

    combined.to_excel(CONTACT_LOG_PATH, index=False)

@app.route('/about')
def about():
    # Public about page
    return render_template('about.html')

# ------------------- NEW: Contact page -------------------
@app.route('/contact', methods=['GET', 'POST'])
def contact():
    """
    Simple contact page.
    - GET: render the form
    - POST: basic validation + flash a success message (you can wire email later)
    """
    if request.method == 'POST':
        # Honeypot field to deter bots (ignored by real users)
        honey = (request.form.get('website') or '').strip()

        name = (request.form.get('name') or '').strip()
        email = (request.form.get('email') or '').strip().lower()
        company = (request.form.get('company') or '').strip()
        subject = (request.form.get('subject') or 'General').strip()
        message = (request.form.get('message') or '').strip()

        if honey:
            # Bot submission — pretend success
            flash("Thanks! We’ll get back to you shortly.", "success")
            return redirect(url_for('contact'))

        if not name or not email or not message:
            flash("Please fill in your name, email, and message.", "error")
            # Re-render with previously entered values
            return render_template('contact.html')

        timestamp = datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')
        submission = {
            "timestamp": timestamp,
            "name": name,
            "email": email,
            "company": company,
            "subject": subject,
            "message": message,
        }

        append_contact_submission(submission)

        app.logger.info(
            "[CONTACT] %s <%s> (%s) [%s] — %d chars", name, email, company, subject, len(message)
        )
        flash("Thanks! We’ll get back to you shortly.", "success")
        return redirect(url_for('contact'))

    return render_template('contact.html')
# ---------------------------------------------------------

@app.route('/register', methods=['GET', 'POST'])
def register():
    # Handle user registration form
    if request.method == 'POST':
        email = (request.form.get('Email') or '').strip().lower()
        password = request.form.get('Password')
        role = request.form.get('Role')
        email_regex = r'^[\w\.-]+@[\w\.-]+\.\w{2,}$'
        # Validate user inputs
        if not re.match(email_regex, email):
            flash('Please enter a valid email address.', 'error')
            return redirect(url_for('register'))
        if len(password or '') < 12:
            flash('Password must be at least 12 characters long.', 'error')
            return redirect(url_for('register'))
        if role not in ('Leader', 'Manager'):
            flash('Please select a role.', 'error')
            return redirect(url_for('register'))
        # Store new user
        hashed_pw = generate_password_hash(password)
        conn = sqlite3.connect(os.fspath(USERS_DB))
        try:
            c = conn.cursor()
            c.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', (email, hashed_pw, role))
            conn.commit()
            session['email'] = email
            session['role'] = role
            return redirect(url_for('welcome'))
        except sqlite3.IntegrityError:
            c = conn.cursor()
            c.execute('SELECT role FROM users WHERE email = ?', (email,))
            result = c.fetchone()
            if result:
                flash(f'This email is already registered as {result[0]}', 'error')
            else:
                flash('This email is already registered', 'error')
            return redirect(url_for('register'))
        finally:
            conn.close()
    return render_template('registration-page.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    # Handle login form submission
    if request.method == 'POST':
        email = (request.form.get('email') or '').strip().lower()
        password = request.form.get('password')
        if not email or not password:
            flash('Email and password are required.', 'error')
            return redirect(url_for('login'))
        conn = sqlite3.connect(os.fspath(USERS_DB))
        c = conn.cursor()
        c.execute('SELECT password, role FROM users WHERE email = ?', (email,))
        result = c.fetchone()
        conn.close()
        if result:
            stored_password, role = result
            if check_password_hash(stored_password, password):
                session['email'] = email
                session['role'] = role
                return redirect(url_for('welcome'))
            flash('Incorrect password', 'error')
            return redirect(url_for('login'))
        flash('User not found', 'error')
        return redirect(url_for('login'))
    return render_template('login.html')

@app.route('/logout')
def logout():
    # Sign out the current user
    session.clear()
    return redirect(url_for('landing'))

@app.route('/api/data')
def api_data():
    table_param = request.args.get('table')
    try:
        df = _load_tabular_dataset(table_param)
    except Exception as exc:
        app.logger.exception('Failed to load data for /api/data: %s', exc)
        return (
            jsonify({'error': 'Unable to load dashboard data from the database or Excel.'}),
            500,
        )

    records = _dataframe_to_records(df)
    return jsonify(records), 200


@app.route('/api/share-dashboard', methods=['POST'])
def share_dashboard():
    """Persist a queued dashboard share request with chart snapshots."""
    if 'email' not in session:
        return jsonify({'error': 'Authentication required.'}), 401

    try:
        payload = request.get_json(force=True) or {}
    except Exception:
        return jsonify({'error': 'Invalid JSON payload.'}), 400

    recipient = (payload.get('recipientEmail') or '').strip().lower()
    email_regex = r'^[\w\.-]+@[\w\.-]+\.\w{2,}$'
    if not re.match(email_regex, recipient):
        return jsonify({'error': 'Please provide a valid recipient email address.'}), 400

    charts = payload.get('charts')
    if not isinstance(charts, list) or not charts:
        return jsonify({'error': 'At least one chart snapshot is required.'}), 400

    sanitized_charts = []
    for idx, chart in enumerate(charts):
        if not isinstance(chart, dict):
            continue
        chart_image = chart.get('chartImage')
        story_image = chart.get('storyImage')
        story_text = (chart.get('storyText') or '').strip()
        title = (chart.get('title') or f'Chart {idx + 1}').strip()
        chart_type = (chart.get('type') or '').strip()
        if not chart_image or not story_image:
            continue
        sanitized_charts.append({
            'index': idx,
            'title': title,
            'type': chart_type,
            'chartImage': chart_image,
            'storyImage': story_image,
            'storyText': story_text,
        })

    if not sanitized_charts:
        return jsonify({'error': 'No valid chart snapshots were provided.'}), 400

    subject = (payload.get('subject') or '').strip()
    message = (payload.get('message') or '').strip()
    created_at = datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')

    try:
        with sqlite3.connect(SHARE_DB) as conn:
            conn.execute(
                '''
                INSERT INTO share_requests (
                    sender_email, recipient_email, subject, message, charts_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (
                    session['email'],
                    recipient,
                    subject,
                    message,
                    json.dumps(sanitized_charts),
                    created_at,
                ),
            )
            conn.commit()
    except Exception as exc:
        app.logger.exception('Failed to persist share request: %s', exc)
        return jsonify({'error': 'Failed to save the share request.'}), 500

    app.logger.info('[SHARE] %s -> %s (%d charts)', session['email'], recipient, len(sanitized_charts))
    return jsonify({'message': 'Share request saved.'}), 201


@app.route('/api/ai-chat', methods=['POST'])
def ai_chat_assistant():
    """Return a lightweight conversational response for the chat widget."""

    payload = request.get_json(silent=True) or {}
    message = payload.get('message', '')
    response_text, follow_ups = _ai_chat_response(message)
    return jsonify({
        'response': response_text,
        'followUps': follow_ups,
    })


@app.route('/api/storyboards/<role>')
def api_storyboards(role: str):
    """Expose the cached AI storyboard insights for each dashboard role."""
    if request.args.get('refresh') == '1':
        refresh_storyboards_cache()

    payload = get_storyboards_for_role(role)
    if payload is None:
        refresh_storyboards_cache()
        payload = get_storyboards_for_role(role)

    if payload is None:
        return jsonify({'error': f'No storyboards configured for role {role!r}'}), 404

    return jsonify(payload)

def _json_from_view(view_name: str):
    """
    Return JSON from a database view with SQL fallbacks.
    - Handles 'no such table' and 'no such view'
    - Dynamically resolves visa column for v_visa_breakdown
    - Dynamically resolves offer expiry date column for v_offer_expiry_surge*
      and aggregates using pandas (robust to Excel-style dates)
    """
    # ---- helpers -------------------------------------------------------------
    def _has_meaningful_data(df: Optional[pd.DataFrame]) -> bool:
        if df is None or df.empty:
            return False
        numeric = df.select_dtypes(include=["number"])
        if numeric.empty:
            return not df.empty
        return bool((numeric.abs().sum(axis=0) > 0).any())

    def _table_columns(conn, table="reportdata"):
        cur = conn.execute(f"PRAGMA table_info({table})")
        cols = [row[1] for row in cur.fetchall()]
        lower_map = {c.lower(): c for c in cols}
        return cols, lower_map

    def _find_column(conn, candidates, table="reportdata"):
        cols, lower_map = _table_columns(conn, table)
        # exact / case-insensitive first
        for cand in candidates:
            if cand in cols:
                return cand
            if cand.lower() in lower_map:
                return lower_map[cand.lower()]
        # then any column containing the token
        tokens = [c.lower() for c in candidates if c]
        for c in cols:
            lc = c.lower()
            if any(tok.replace(" ", "") in lc.replace(" ", "") for tok in tokens):
                return c
        return None

    def _q(name):
        # Quote identifiers with spaces/special chars for SQLite
        return f"[{name}]"

    def _match_column(columns, candidates):
        columns = [str(col) for col in columns]
        lower_map = {col.lower(): col for col in columns}
        for cand in candidates:
            if cand in columns:
                return cand
            lc = cand.lower()
            if lc in lower_map:
                return lower_map[lc]
        normalized_candidates = [re.sub(r"[\s_]+", "", cand.lower()) for cand in candidates if cand]
        for col in columns:
            norm = re.sub(r"[\s_]+", "", col.lower())
            if any(token in norm for token in normalized_candidates):
                return col
        return None

    def _empty_offer_expiry(view_name: str) -> pd.DataFrame:
        if view_name == 'v_offer_expiry_surge_monthly':
            return pd.DataFrame(columns=['expiry_month', 'expiring_offers'])
        return pd.DataFrame(columns=['expiry_day', 'expiring_offers'])

    def _aggregate_offer_expiry(series, view_name: str) -> pd.DataFrame:
        if series is None:
            return _empty_offer_expiry(view_name)
        dates = pd.to_datetime(series, errors='coerce', dayfirst=True)
        dates = dates.dropna()
        dates = _filter_relevant_expiry_dates(dates)
        if dates.empty:
            return _empty_offer_expiry(view_name)
        temp = pd.DataFrame({'clean_date': dates})
        if view_name == 'v_offer_expiry_surge_monthly':
            temp['expiry_month'] = temp['clean_date'].dt.strftime('%Y-%m')
            grouped = (
                temp.groupby('expiry_month')
                    .size().reset_index(name='expiring_offers')
                    .sort_values('expiry_month')
            )
        else:
            temp['expiry_day'] = temp['clean_date'].dt.strftime('%Y-%m-%d')
            grouped = (
                temp.groupby('expiry_day')
                    .size().reset_index(name='expiring_offers')
                    .sort_values('expiry_day')
            )
        return grouped

    def _offer_expiry_from_sqlite(view_name: str) -> pd.DataFrame:
        if not SQLITE_DB.exists():
            return _empty_offer_expiry(view_name)
        try:
            with sqlite3.connect(os.fspath(SQLITE_DB)) as conn:
                exp_col = _find_column(conn, [
                    'offer_expiry_date', 'Offer Expiry Date', 'expiry_date', 'Expiry Date', 'offer expiry'
                ])
                if not exp_col:
                    return _empty_offer_expiry(view_name)
                qc = _q(exp_col)
                raw = pd.read_sql_query(
                    f"SELECT {qc} AS raw_date FROM reportdata "
                    f"WHERE {qc} IS NOT NULL AND trim({qc}) <> ''",
                    conn
                )
        except Exception as exc:
            app.logger.warning('Offer expiry SQLite fallback failed for %s: %s', view_name, exc)
            return _empty_offer_expiry(view_name)
        return _aggregate_offer_expiry(raw.get('raw_date'), view_name)

    def _offer_expiry_from_excel(view_name: str) -> pd.DataFrame:
        if not os.path.exists(DATA_PATH):
            return _empty_offer_expiry(view_name)
        try:
            excel_df = pd.read_excel(DATA_PATH)
        except Exception as exc:
            app.logger.warning('Offer expiry Excel load failed for %s: %s', view_name, exc)
            return _empty_offer_expiry(view_name)
        column = _match_column(excel_df.columns, [
            'offer_expiry_date', 'Offer Expiry Date', 'expiry_date', 'Expiry Date', 'offer expiry'
        ])
        if not column:
            return _empty_offer_expiry(view_name)
        return _aggregate_offer_expiry(excel_df[column], view_name)

    def _load_offer_expiry_view(view_name: str):
        try:
            df = _read_sqlite(view_name)
            if not df.empty:
                return df, 200, None
        except Exception as exc:
            msg = str(exc).lower()
            benign = ('no such table' in msg or 'no such view' in msg or
                      'no user tables' in msg or 'sqlite db not found' in msg)
            if not benign:
                raise
        # Either no dedicated view or it returned no rows - build from raw sources
        df = _offer_expiry_from_sqlite(view_name)
        if df.empty:
            df = _offer_expiry_from_excel(view_name)
        if df.empty:
            return df, 404, 'No offer expiry data available'
        return df, 200, None

    FALLBACK_QUERIES = {
        'v_application_status_totals': """
            SELECT COALESCE(status,'Unknown') AS status,
                   COUNT(*) AS total
            FROM reportdata
            GROUP BY COALESCE(status,'Unknown')
            ORDER BY total DESC
        """,
        'v_offers_status_counts': """
            SELECT COALESCE(status,'Unknown') AS status,
                   COUNT(*) AS student_count
            FROM reportdata
            GROUP BY COALESCE(status,'Unknown')
            ORDER BY student_count DESC
        """,
        'v_deferred_offers_overview': """
            SELECT COALESCE(previous_offer_intake || ' ' || previous_offer_year, 'Unknown') AS term,
                   SUM(CASE
                         WHEN LOWER(COALESCE(is_the_offer_deferred,'')) IN ('1','y','yes','true') THEN 1
                         WHEN status = 'Deferred' THEN 1
                         ELSE 0 END) AS deferred_count,
                   COUNT(*) AS total_offers
            FROM reportdata
            GROUP BY term
            ORDER BY term
        """,
        'v_agent_performance': """
            SELECT COALESCE(agentname,'Unknown') AS agent,
                   SUM(CASE WHEN status='New Application Request' THEN 1 ELSE 0 END) AS applications,
                   SUM(CASE WHEN status='Offered' THEN 1 ELSE 0 END) AS offers,
                   SUM(CASE WHEN status LIKE 'Enrolled%' THEN 1 ELSE 0 END) AS enrolled
            FROM reportdata
            GROUP BY agent
            ORDER BY enrolled DESC, offers DESC, applications DESC
        """,
        'v_student_classification': """
            SELECT COALESCE(coursetype,'Unknown') AS classification,
                   COUNT(*) AS total
            FROM reportdata
            GROUP BY COALESCE(coursetype,'Unknown')
            ORDER BY total DESC
        """,
        'v_current_vs_enrolled': """
            SELECT strftime('%Y', date(startdate)) AS term,
                   SUM(CASE WHEN status='Current Student' THEN 1 ELSE 0 END) AS current_students,
                   SUM(CASE WHEN status LIKE 'Enrolled%' THEN 1 ELSE 0 END) AS enrolled
            FROM reportdata
            WHERE startdate IS NOT NULL AND trim(startdate) <> ''
            GROUP BY term
            ORDER BY term
        """,
        'v_enrolled_vs_offer': """
            SELECT strftime('%Y', date(startdate)) AS term,
                   SUM(CASE WHEN status='Offered' THEN 1 ELSE 0 END) AS offers,
                   SUM(CASE WHEN status LIKE 'Enrolled%' THEN 1 ELSE 0 END) AS enrolled
            FROM reportdata
            WHERE startdate IS NOT NULL AND trim(startdate) <> ''
            GROUP BY term
            ORDER BY term
        """,
        # We will handle v_visa_breakdown and v_offer_expiry_* dynamically below
    }

    VIEW_LABELS = {
        'v_application_status_totals': 'application status',
        'v_offers_status_counts': 'offer status',
        'v_deferred_offers_overview': 'deferred offers',
        'v_agent_performance': 'agent performance',
        'v_student_classification': 'student classification',
        'v_current_vs_enrolled': 'current vs enrolled',
        'v_enrolled_vs_offer': 'enrolled vs offer',
        'v_visa_breakdown': 'visa breakdown',
    }

    def _is_benign_sqlite_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        return any(
            token in msg
            for token in (
                'no such table',
                'no such view',
                'no user tables',
                'sqlite db not found',
            )
        )

    def _query_sqlite_reportdata(view_name: str) -> Optional[pd.DataFrame]:
        if not SQLITE_DB.exists():
            return None
        try:
            with sqlite3.connect(os.fspath(SQLITE_DB)) as conn:
                if view_name == 'v_visa_breakdown':
                    visa_col = _find_column(conn, [
                        'visa_type', 'visa_status', 'Visa Type', 'Visa Status', 'visa', 'Visa'
                    ])
                    if not visa_col:
                        return pd.DataFrame(columns=['visa_type', 'total'])
                    qc = _q(visa_col)
                    query = f"""
                        SELECT COALESCE({qc}, 'Unknown') AS visa_type,
                               COUNT(*) AS total
                        FROM reportdata
                        GROUP BY COALESCE({qc}, 'Unknown')
                        ORDER BY total DESC
                    """
                    return pd.read_sql_query(query, conn)

                if view_name == 'v_offers_status_counts':
                    status_col = _find_column(conn, [
                        'status', 'Status', 'application_status', 'Application Status', 'offer_status', 'Offer Status'
                    ])
                    if not status_col:
                        return pd.DataFrame(columns=['status', 'student_count'])
                    qs = _q(status_col)
                    query = f"""
                        SELECT COALESCE({qs}, 'Unknown') AS status,
                               COUNT(*) AS student_count
                        FROM reportdata
                        GROUP BY COALESCE({qs}, 'Unknown')
                        ORDER BY student_count DESC
                    """
                    return pd.read_sql_query(query, conn)

                if view_name == 'v_deferred_offers_overview':
                    intake_col = _find_column(conn, [
                        'Previous Offer Intake', 'Offer Intake', 'Intake', 'Trimester', 'Semester'
                    ])
                    year_col = _find_column(conn, [
                        'Previous Offer Year', 'Offer Year', 'Year'
                    ])
                    status_col = _find_column(conn, [
                        'Status', 'Offer Status', 'application_status'
                    ])
                    flag_col = _find_column(conn, [
                        'Is the Offer Deferred', 'is_the_offer_deferred', 'Offer Deferred', 'Deferred'
                    ])
                    term_col = _find_column(conn, ['term', 'Term'])

                    if intake_col and year_col:
                        sel = [f"{_q(intake_col)} AS intake", f"{_q(year_col)} AS year"]
                    elif term_col:
                        sel = [f"{_q(term_col)} AS term"]
                    else:
                        return pd.DataFrame(columns=['term', 'deferred_count', 'total_offers', 'deferred', 'total'])

                    if status_col:
                        sel.append(f"{_q(status_col)} AS status")
                    if flag_col:
                        sel.append(f"{_q(flag_col)} AS flag")

                    raw = pd.read_sql_query(f"SELECT {', '.join(sel)} FROM reportdata", conn)

                    if 'term' not in raw.columns:
                        raw['term'] = (
                            raw['intake'].astype(str).str.strip()
                            + ' '
                            + raw['year'].astype(str).str.strip()
                        )
                    raw['term'] = raw['term'].astype(str).str.strip()

                    if 'flag' in raw.columns:
                        s = raw['flag'].astype(str).str.strip().str.lower()
                        is_deferred = s.isin(['1', 'true', 't', 'y', 'yes'])
                    elif 'status' in raw.columns:
                        s = raw['status'].astype(str).str.strip().str.lower()
                        is_deferred = s.str.startswith('deferred')
                    else:
                        is_deferred = pd.Series(False, index=raw.index)

                    grp = (
                        pd.DataFrame({'term': raw['term'], 'is_def': is_deferred})
                        .groupby('term', dropna=False)['is_def']
                        .agg(deferred_count='sum', total_offers='size')
                        .reset_index()
                    )

                    grp['deferred'] = grp['deferred_count'].astype(int)
                    grp['total'] = grp['total_offers'].astype(int)
                    mask = grp['term'].astype(str).str.strip().str.lower().ne('unknown')
                    return grp[mask]

                query = FALLBACK_QUERIES.get(view_name)
                if not query:
                    return None
                return pd.read_sql_query(query, conn)
        except Exception as exc:
            if _is_benign_sqlite_error(exc):
                return pd.DataFrame()
            raise

    def _load_excel_reportdata(view_name: str) -> pd.DataFrame:
        if not os.path.exists(DATA_PATH):
            return pd.DataFrame()
        try:
            excel_df = pd.read_excel(DATA_PATH)
        except Exception as exc:
            app.logger.warning('Excel fallback failed for %s: %s', view_name, exc)
            return pd.DataFrame()

        def _clean_series(series: pd.Series, *, unknown: str = 'Unknown') -> pd.Series:
            values = series.fillna(unknown).astype(str).str.strip()
            values = values.replace('', unknown)
            return values

        if view_name == 'v_application_status_totals':
            status_col = _match_column(excel_df.columns, ['status', 'Status', 'application_status'])
            if not status_col:
                return pd.DataFrame(columns=['status', 'total'])
            statuses = _clean_series(excel_df[status_col])
            grouped = (
                pd.DataFrame({'status': statuses})
                .groupby('status')
                .size()
                .reset_index(name='total')
                .sort_values('total', ascending=False)
            )
            return grouped

        if view_name == 'v_offers_status_counts':
            status_col = _match_column(excel_df.columns, [
                'status', 'Status', 'application_status', 'Offer Status', 'offer_status'
            ])
            if not status_col:
                return pd.DataFrame(columns=['status', 'student_count'])
            statuses = _clean_series(excel_df[status_col])
            grouped = (
                pd.DataFrame({'status': statuses})
                .groupby('status')
                .size()
                .reset_index(name='student_count')
                .sort_values('student_count', ascending=False)
            )
            return grouped

        if view_name == 'v_visa_breakdown':
            visa_col = _match_column(excel_df.columns, [
                'visa_type', 'Visa Type', 'visa_status', 'Visa Status', 'visa'
            ])
            if not visa_col:
                return pd.DataFrame(columns=['visa_type', 'total'])
            visas = _clean_series(excel_df[visa_col])
            grouped = (
                pd.DataFrame({'visa_type': visas})
                .groupby('visa_type')
                .size()
                .reset_index(name='total')
                .sort_values('total', ascending=False)
            )
            return grouped

        if view_name == 'v_deferred_offers_overview':
            intake_col = _match_column(excel_df.columns, [
                'Previous Offer Intake', 'Offer Intake', 'Intake', 'Trimester', 'Semester'
            ])
            year_col = _match_column(excel_df.columns, [
                'Previous Offer Year', 'Offer Year', 'Year'
            ])
            status_col = _match_column(excel_df.columns, [
                'Status', 'Offer Status', 'application_status'
            ])
            flag_col = _match_column(excel_df.columns, [
                'Is the Offer Deferred', 'is_the_offer_deferred', 'Offer Deferred', 'Deferred'
            ])
            term_col = _match_column(excel_df.columns, ['term', 'Term'])

            if intake_col and year_col:
                terms = (
                    _clean_series(excel_df[intake_col], unknown='')
                    + ' '
                    + _clean_series(excel_df[year_col], unknown='')
                )
            elif term_col:
                terms = _clean_series(excel_df[term_col], unknown='')
            else:
                return pd.DataFrame(columns=['term', 'deferred_count', 'total_offers', 'deferred', 'total'])

            terms = terms.str.strip()
            flags = None
            if flag_col:
                flags = _clean_series(excel_df[flag_col], unknown='').str.lower()
                is_deferred = flags.isin(['1', 'true', 't', 'y', 'yes'])
            elif status_col:
                statuses = _clean_series(excel_df[status_col], unknown='').str.lower()
                is_deferred = statuses.str.startswith('deferred')
            else:
                is_deferred = pd.Series(False, index=terms.index)

            data = pd.DataFrame({'term': terms, 'is_def': is_deferred})
            grouped = (
                data.groupby('term', dropna=False)['is_def']
                .agg(deferred_count='sum', total_offers='size')
                .reset_index()
            )
            grouped['deferred'] = grouped['deferred_count'].astype(int)
            grouped['total'] = grouped['total_offers'].astype(int)
            mask = grouped['term'].astype(str).str.strip().str.lower().ne('unknown')
            grouped = grouped[mask]
            return grouped

        if view_name == 'v_agent_performance':
            agent_col = _match_column(excel_df.columns, ['agentname', 'Agent Name', 'Agent'])
            status_col = _match_column(excel_df.columns, ['status', 'Status', 'application_status'])
            if not agent_col or not status_col:
                return pd.DataFrame(columns=['agent', 'applications', 'offers', 'enrolled'])
            agents = _clean_series(excel_df[agent_col])
            statuses = _clean_series(excel_df[status_col], unknown='').str.lower()
            frame = pd.DataFrame({'agent': agents, 'status': statuses})
            frame['is_app'] = (frame['status'] == 'new application request').astype(int)
            frame['is_offer'] = (frame['status'] == 'offered').astype(int)
            frame['is_enrolled'] = frame['status'].str.startswith('enrolled').astype(int)
            grouped = (
                frame.groupby('agent')[['is_app', 'is_offer', 'is_enrolled']]
                .sum()
                .reset_index()
            )
            grouped = grouped.rename(columns={
                'is_app': 'applications',
                'is_offer': 'offers',
                'is_enrolled': 'enrolled',
            })
            grouped = grouped.sort_values(
                ['enrolled', 'offers', 'applications'], ascending=[False, False, False]
            )
            return grouped

        if view_name == 'v_student_classification':
            class_col = _match_column(excel_df.columns, [
                'coursetype', 'Course Type', 'course_type', 'Classification'
            ])
            if not class_col:
                return pd.DataFrame(columns=['classification', 'total'])
            classes = _clean_series(excel_df[class_col])
            grouped = (
                pd.DataFrame({'classification': classes})
                .groupby('classification')
                .size()
                .reset_index(name='total')
                .sort_values('total', ascending=False)
            )
            return grouped

        if view_name in ('v_current_vs_enrolled', 'v_enrolled_vs_offer'):
            start_col = _match_column(excel_df.columns, ['startdate', 'Start Date', 'start_date'])
            status_col = _match_column(excel_df.columns, ['status', 'Status', 'application_status'])
            default_cols = (
                ['term', 'current_students', 'enrolled']
                if view_name == 'v_current_vs_enrolled'
                else ['term', 'offers', 'enrolled']
            )
            if not start_col or not status_col:
                return pd.DataFrame(columns=default_cols)
            dates = pd.to_datetime(excel_df[start_col], errors='coerce')
            statuses = _clean_series(excel_df[status_col], unknown='').str.lower()
            mask = dates.notna()
            if not mask.any():
                return pd.DataFrame(columns=default_cols)
            working = pd.DataFrame({
                'term': dates[mask].dt.strftime('%Y'),
                'status': statuses[mask],
            })
            if view_name == 'v_current_vs_enrolled':
                working['is_current'] = (working['status'] == 'current student').astype(int)
                working['is_enrolled'] = working['status'].str.startswith('enrolled').astype(int)
                grouped = (
                    working.groupby('term')[['is_current', 'is_enrolled']]
                    .sum()
                    .reset_index()
                    .rename(columns={'is_current': 'current_students', 'is_enrolled': 'enrolled'})
                    .sort_values('term')
                )
                return grouped
            working['is_offer'] = (working['status'] == 'offered').astype(int)
            working['is_enrolled'] = working['status'].str.startswith('enrolled').astype(int)
            grouped = (
                working.groupby('term')[['is_offer', 'is_enrolled']]
                .sum()
                .reset_index()
                .rename(columns={'is_offer': 'offers', 'is_enrolled': 'enrolled'})
                .sort_values('term')
            )
            return grouped

        return pd.DataFrame()

    def _load_generic_view(view_name: str):
        sqlite_rows = False
        excel_rows = False
        latest = pd.DataFrame()

        try:
            df_view = _read_sqlite(view_name)
            if _has_meaningful_data(df_view):
                return df_view, True, False
            latest = df_view
        except Exception as exc:
            if not _is_benign_sqlite_error(exc):
                raise

        sqlite_df = _query_sqlite_reportdata(view_name)
        if sqlite_df is not None:
            latest = sqlite_df
            if _has_meaningful_data(sqlite_df):
                sqlite_rows = True

        if not sqlite_rows:
            excel_df = _load_excel_reportdata(view_name)
            latest = excel_df
            if _has_meaningful_data(excel_df):
                excel_rows = True

        return latest, sqlite_rows, excel_rows

    OFFER_EXPIRY_VIEWS = {
        'v_offer_expiry_surge_daily',
        'v_offer_expiry_surge_monthly',
        'v_offer_expiry_surge',
    }

    if view_name in OFFER_EXPIRY_VIEWS:
        df, status_code, error_message = _load_offer_expiry_view(view_name)
        if status_code != 200:
            return jsonify({'error': error_message or 'No offer expiry data available'}), status_code
        for col in df.select_dtypes(include=['float', 'int']).columns:
            df[col] = df[col].fillna(0)
        return jsonify(df.to_dict(orient='records')), 200

    df, sqlite_rows, excel_rows = _load_generic_view(view_name)
    if df is None:
        df = pd.DataFrame()

    if not _has_meaningful_data(df):
        label = VIEW_LABELS.get(view_name, view_name)
        return jsonify({'error': f'No {label} data available'}), 404

    for col in df.select_dtypes(include=['float', 'int']).columns:
        df[col] = df[col].fillna(0)

    return jsonify(df.to_dict(orient='records')), 200


@app.route('/api/application-status')
def api_application_status():
    # Legacy endpoint retained for backwards compatibility
    return _json_from_view('v_application_status_totals')


@app.route('/api/revenue-forecast')
def api_revenue_forecast():
    """API endpoint returning rows for the next-12-month revenue forecast."""
    rows = _build_revenue_forecast_rows()
    return jsonify(rows), 200


@app.route('/api/offers-status')
def api_offers_status():
    # API endpoint for offer status counts
    return _json_from_view('v_offers_status_counts')


@app.route('/api/agent-performance')
def api_agent_performance():
    # API endpoint for agent performance metrics (agent, offer, status)
    rows = _build_agent_performance_rows()
    if not rows:
        return jsonify({'error': 'No agent performance data available'}), 404
    return jsonify(rows), 200


@app.route('/api/student-classification')
def api_student_classification():
    # API endpoint for student classification rows (course type x visa status)
    rows = _build_student_classification_rows()
    if not rows:
        return jsonify({'error': 'No student classification data available'}), 404
    return jsonify(rows), 200

@app.route('/api/current-vs-enrolled')
@app.route('/api/study-reason-by-course')
def api_study_reason_by_course():
    rows = _build_study_reason_by_course_rows()
    if not rows:
        return jsonify({'error': 'No study reason by course data available'}), 404
    return jsonify(rows), 200


@app.route('/api/enrolled-vs-offer')
@app.route('/api/students-by-trimester')
def api_students_by_trimester():
    rows = _build_students_by_trimester_rows()
    if not rows:
        return jsonify({'error': 'No trimester student data available'}), 404
    return jsonify(rows), 200


def _course_manager_payload():
    rows = _build_course_by_manager_rows()
    if not rows:
        return jsonify({'error': 'No course manager data available'}), 404
    return jsonify(rows), 200


@app.route('/api/course-by-manager')
def api_course_by_manager():
    return _course_manager_payload()


@app.route('/api/offer-expiry-surge')
def api_offer_expiry_surge():
    # Legacy endpoint retained for backwards compatibility
    return _course_manager_payload()


@app.route('/api/visa-breakdown')
def api_visa_breakdown():
    rows = _build_visa_breakdown_rows()
    if not rows:
        return jsonify({'error': 'No visa breakdown data available'}), 404
    return jsonify(rows), 200

if __name__ == '__main__':
    # Launch development server
    if not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_background_refresh()
    app.run(debug=True, port=5001)
