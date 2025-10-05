#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

"""
ETL: Excel (.xlsx) -> SQLite (.db)
- Infers SQLite column types: INTEGER, REAL, TEXT (ISO date/datetime stored as TEXT)
- Coerces booleans (yes/no, true/false, 1/0) -> INTEGER 0/1
- Sanitizes table & column names, resolves duplicates
- Drops/recreates tables, bulk inserts
- Adds helpful indexes on common columns
- Preserves Excel formatting cues (currency, IDs, dates) when loading to SQLite
"""

import os
import re
import sys
import time
import argparse
import sqlite3
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles.numbers import is_date_format

# -------- CLI --------

def parse_args():
    project_root = Path(__file__).resolve().parents[1]
    data_dir = project_root / "backend" / "data"
    p = argparse.ArgumentParser(description="Load Excel sheets into a SQLite DB.")
    p.add_argument("--excel", default=str(data_dir / "dummy_data.xlsx"), help="Path to input .xlsx")
    p.add_argument("--db", default=str(data_dir / "dummy_data.db"), help="Output SQLite file")
    p.add_argument("--retries", type=int, default=8, help="Retries if files are locked")
    p.add_argument("--wait", type=float, default=0.75, help="Seconds between retries")
    return p.parse_args()

# -------- Name utilities --------

SQL_KEYWORDS = {"table", "select", "from", "where", "group", "order", "by", "join"}


def sanitize_identifier(name: str) -> str:
    """Standardize sheet/index names for SQLite tables and indexes."""
    name = (str(name) or "").strip().lower()
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = "unnamed"
    if re.match(r"^\d", name):
        name = f"t_{name}"
    if name in SQL_KEYWORDS:
        name = f"{name}_obj"
    return name


def _flatten_header_value(value) -> str:
    """Return a human readable column header from Excel/ pandas values."""
    if isinstance(value, tuple):
        parts = [str(v).strip() for v in value if v is not None and str(v).strip()]
        value = " ".join(parts)
    value = "" if value is None else str(value)
    value = value.replace("\r", " ").replace("\n", " ")
    value = re.sub(r"\s+", " ", value).strip()
    if not value or value.lower() in {"nan", "none"}:
        return ""
    return value


def make_column_names(columns: Iterable, *, start: int = 1) -> List[str]:
    """Create readable + unique column names while preserving originals."""
    cleaned: List[str] = []
    for idx, col in enumerate(columns, start=start):
        value = _flatten_header_value(col)
        if not value:
            value = f"Column_{idx}"
        cleaned.append(value)

    counter: Counter[str] = Counter()
    unique: List[str] = []
    for name in cleaned:
        key = name.lower()
        counter[key] += 1
        if counter[key] == 1:
            unique.append(name)
        else:
            unique.append(f"{name}_{counter[key]}")
    return unique


def ensure_unique(names: List[str]) -> List[str]:
    """Backward compat shim; now uses case-insensitive uniqueness."""
    return make_column_names(names)


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'

# -------- Lock / file checks --------

def wait_for_file(path: str, retries: int = 8, wait: float = 0.75) -> None:
    """Retry opening a file to bypass transient locks (Excel/OneDrive/DB Browser)."""
    last_err: Exception | None = None
    for _ in range(retries):
        try:
            with open(path, "rb"):
                return
        except PermissionError as e:
            last_err = e
            time.sleep(wait)
    if last_err:
        raise last_err

def assert_db_not_locked(path: str) -> None:
    """Try to open SQLite quickly; if locked, raise a friendly message."""
    if not os.path.exists(path):
        return
    try:
        con = sqlite3.connect(path, timeout=1)
        con.execute("PRAGMA schema_version;")
        con.close()
    except sqlite3.OperationalError as e:
        raise SystemExit(f"[LOCKED] Close tools using {path} (e.g., DB Browser). {e}")

# -------- Type inference --------

NUMERIC_NULLS = {"", "na", "n/a", "null", "none", None}

BOOL_MAP = {
    "true": 1, "false": 0,
    "yes": 1, "no": 0,
    "y": 1, "n": 0,
    "1": 1, "0": 0,
    True: 1, False: 0,
}

def coerce_bool(series: pd.Series) -> Tuple[pd.Series, bool]:
    s = series.copy()
    # Treat NaN as NaN (don’t turn into "nan")
    mask_nonnull = s.notna()
    s_str = s.astype(str).str.strip().str.lower()
    mapped = s_str.map(BOOL_MAP)
    # keep NaNs
    mapped = mapped.where(mask_nonnull, np.nan)
    # Consider boolean if >=90% of non-nulls mapped
    if mapped.notna().sum() >= 0.9 * mask_nonnull.sum() and mask_nonnull.sum() > 0:
        return mapped.astype("Int64"), True
    return series, False

def infer_numeric(series: pd.Series) -> Tuple[pd.Series, str | None]:
    s = series.replace(list(NUMERIC_NULLS), np.nan)
    nums = pd.to_numeric(s, errors="coerce")
    nonnull = s.notna().sum()
    if nonnull == 0:
        return series, None
    if nums.notna().sum() >= max(3, int(0.8 * nonnull)):
        # INTEGER if all non-nulls are whole numbers
        only_whole = np.isclose(nums.dropna() % 1, 0).all()
        if only_whole:
            return nums.astype("Int64"), "INTEGER"
        return nums.astype(float), "REAL"
    return series, None

def _to_text(value, *, decimals: int | None = None) -> str | None:
    if pd.isna(value):
        return None
    if isinstance(value, float):
        if decimals is not None:
            return f"{value:.{decimals}f}"
        if value.is_integer():
            return str(int(value))
        return format(value, "g")
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    return str(value)


def infer_df_types(
    df: pd.DataFrame, metadata: Dict[str, ColumnMeta]
) -> Tuple[pd.DataFrame, Dict[str, str]]:
    """Return converted DataFrame and {col: sqlite_type}."""
    out = pd.DataFrame(index=df.index)
    coltypes: Dict[str, str] = {}
    for col in df.columns:
        s = df[col]
        meta = metadata.get(col, ColumnMeta())

        if meta.treat_as_text:
            txt = s.map(lambda v: _to_text(v))
            txt = txt.where(s.notna(), None)
            out[col] = txt
            coltypes[col] = "TEXT"
            continue

        # 1) Boolean?
        s2, is_bool = coerce_bool(s)
        if is_bool:
            out[col] = s2
            coltypes[col] = "INTEGER"
            continue

        s3 = s2
        if meta.treat_as_date:
            dt = pd.to_datetime(s3, errors="coerce", dayfirst=False)
            if dt.notna().sum() > 0:
                fmt = "%Y-%m-%d %H:%M:%S" if meta.treat_as_datetime else "%Y-%m-%d"
                formatted = dt.dt.strftime(fmt)
                out[col] = formatted.where(dt.notna(), None)
                coltypes[col] = "TEXT"
                continue

        # 3) Numeric?
        s4 = s3
        if meta.treat_as_currency:
            numeric = pd.to_numeric(s4, errors="coerce")
            if meta.decimal_places is not None:
                numeric = numeric.round(meta.decimal_places)
            out[col] = numeric
            coltypes[col] = "REAL"
            continue

        s5, num_type = infer_numeric(s4)
        if num_type is not None:
            if meta.decimal_places is not None and num_type == "REAL":
                s5 = s5.round(meta.decimal_places)
            out[col] = s5
            coltypes[col] = num_type
            continue

        # 4) Fallback text
        txt = s4.astype(str)
        # Keep None/NaN as None
        txt = txt.where(s4.notna(), None)
        out[col] = txt
        coltypes[col] = "TEXT"

    return out, coltypes

# -------- Excel loading --------

@dataclass
class ColumnMeta:
    """Describe how a column is formatted in Excel."""

    treat_as_text: bool = False
    treat_as_date: bool = False
    treat_as_datetime: bool = False
    treat_as_currency: bool = False
    decimal_places: int | None = None


def _looks_like_currency(fmt: str) -> bool:
    fmt_lower = fmt.lower()
    if "currency" in fmt_lower:
        return True
    if any(sym in fmt for sym in ["$", "€", "£", "¥", "₹", "₩", "₽", "฿"]):
        return True
    if "_ accounting" in fmt_lower:
        return True
    if re.search(r"\[\$[^\]]+\]", fmt):
        return True
    return False


def _has_time_component(fmt: str) -> bool:
    fmt_lower = fmt.lower()
    return any(tok in fmt_lower for tok in ["h", "s", "am/pm"])


def _decimal_places_from_format(fmt: str) -> int | None:
    match = re.search(r"\.([#0]+)", fmt)
    if not match:
        return None
    token = match.group(1)
    return len([ch for ch in token if ch == "0"])


def analyze_sheet(ws, columns: List[str]) -> Dict[str, ColumnMeta]:
    """Collect formatting clues for each column of a worksheet."""
    metadata: Dict[str, ColumnMeta] = {}
    header_row = 1
    max_row = ws.max_row or 0

    for idx, col_name in enumerate(columns, start=1):
        meta = ColumnMeta()
        num_values = 0
        text_values = 0
        currency_detected = False
        decimal_places = None
        date_detected = False
        datetime_detected = False

        fmt_header = ws.cell(row=header_row, column=idx).number_format if max_row >= header_row else ""

        for row in ws.iter_rows(
            min_row=header_row + 1,
            max_row=max_row,
            min_col=idx,
            max_col=idx,
            values_only=False,
        ):
            cell = row[0]
            value = cell.value
            if value in (None, ""):
                continue

            fmt = cell.number_format or ""
            if cell.is_date or is_date_format(fmt):
                date_detected = True
                if _has_time_component(fmt):
                    datetime_detected = True
                continue

            if _looks_like_currency(fmt):
                currency_detected = True
                dp = _decimal_places_from_format(fmt)
                if dp is not None:
                    decimal_places = max(decimal_places or 0, dp)

            if fmt.strip() == "@":
                text_values += 1

            if cell.data_type == "s":
                text_values += 1
            elif cell.data_type == "n":
                num_values += 1
                if decimal_places is None and isinstance(value, float):
                    text_repr = f"{value}"
                    if "." in text_repr:
                        frac = text_repr.split(".")[1].rstrip("0")
                        if frac:
                            decimal_places = max(decimal_places or 0, len(frac))
            else:
                text_values += 1

        header_lower = col_name.lower()
        meta.treat_as_currency = currency_detected
        meta.decimal_places = decimal_places
        if date_detected:
            meta.treat_as_date = True
            meta.treat_as_datetime = datetime_detected

        text_hint = fmt_header.strip() == "@" or text_values > 0 and num_values == 0
        normalized_header = header_lower.replace("_", " ")
        id_like = (
            header_lower.endswith("id")
            or " id" in normalized_header
            or "id " in normalized_header
            or "_id" in header_lower
            or header_lower.endswith("code")
            or " code" in normalized_header
            or header_lower.endswith("number")
            or " number" in normalized_header
            or header_lower.endswith("no")
            or " no" in normalized_header
            or "ref" in normalized_header.split()
            or "offerid" in header_lower
            or "offer id" in normalized_header
        )
        if text_hint or (id_like and "date" not in header_lower and "time" not in header_lower):
            meta.treat_as_text = True

        metadata[col_name] = meta

    return metadata


def open_excel(path: str, retries: int, wait: float) -> Tuple[Dict[str, pd.DataFrame], Dict[str, Dict[str, ColumnMeta]]]:
    """Load all sheets; sanitize sheet & column names; ensure unique columns."""
    if not os.path.exists(path):
        sys.exit(f"[ERROR] Excel file not found: {path}")
    wait_for_file(path, retries=retries, wait=wait)

    try:
        xls = pd.ExcelFile(path, engine="openpyxl")
        wb = load_workbook(path, data_only=True)
    except Exception as e:
        sys.exit(
            f"[ERROR] Could not open '{path}'. "
            f"If it's .xlsx, ensure 'openpyxl' is installed: pip install openpyxl\n{e}"
        )

    tables: Dict[str, pd.DataFrame] = {}
    formats: Dict[str, Dict[str, ColumnMeta]] = {}
    used_names = set()

    for sheet in xls.sheet_names:
        raw = pd.read_excel(xls, sheet_name=sheet, dtype=object)
        # Clean and dedupe columns while preserving readable names
        cols = make_column_names(raw.columns)
        raw.columns = cols

        # Sanitize table name; dedupe across sheets if needed
        tname = sanitize_identifier(sheet)
        suffix = 2
        base = tname
        while tname in used_names:
            tname = f"{base}_{suffix}"
            suffix += 1
        used_names.add(tname)

        tables[tname] = raw
        ws = wb[sheet]
        formats[tname] = analyze_sheet(ws, cols)

    wb.close()

    return tables, formats

# -------- SQL helpers --------

def create_table_sql(table: str, df: pd.DataFrame, coltypes: Dict[str, str]) -> str:
    cols_sql = [f'{quote_ident(c)} {coltypes[c]}' for c in df.columns]

    # Add synthetic PK only if you want explicit primary key;
    # SQLite already has an implicit rowid, so this is optional.
    # Keep for backward-compat with your previous script:
    has_id_like = any(
        c in df.columns
        for c in ["id", "student_id", "application_id", "offer_id"]
    )
    pk = "" if has_id_like else f', {quote_ident("__rowid__")} INTEGER PRIMARY KEY AUTOINCREMENT'
    return f'CREATE TABLE {quote_ident(table)} ({", ".join(cols_sql)}{pk});'

IDX_TARGETS = [
    "id", "student_id", "application_id", "offer_id", "enrollment_id", "visa_id",
    "agent_id", "term", "intake", "status",
    "date", "created_at", "updated_at", "offer_date", "expiry_date",
    "granted_date", "lodged_date", "startdate", "finishdate"
]

def add_indexes(conn: sqlite3.Connection, table: str, df: pd.DataFrame) -> None:
    existing = {c: c for c in df.columns}
    normalized = {re.sub(r"[^a-z0-9]", "", c.lower()): c for c in df.columns}
    made = 0
    for col in IDX_TARGETS:
        if col in existing:
            target_col = existing[col]
        else:
            key = re.sub(r"[^a-z0-9]", "", col.lower())
            target_col = normalized.get(key)
        if target_col:
            idx_name = sanitize_identifier(f"idx_{table}_{target_col}")
            try:
                conn.execute(
                    f'CREATE INDEX IF NOT EXISTS {quote_ident(idx_name)} '
                    f'ON {quote_ident(table)} ({quote_ident(target_col)});'
                )
                made += 1
            except Exception as e:
                print(f"[WARN] Could not create index on {table}.{col}: {e}")
    if made:
        print(f"  - Added {made} index(es) to {table}")

def write_table(
    conn: sqlite3.Connection,
    table: str,
    df_raw: pd.DataFrame,
    metadata: Dict[str, ColumnMeta],
) -> None:
    # Infer & convert types
    df_conv, coltypes = infer_df_types(df_raw, metadata)

    # Create table
    cur = conn.cursor()
    cur.execute(f'DROP TABLE IF EXISTS {quote_ident(table)};')
    ddl = create_table_sql(table, df_conv, coltypes)
    cur.execute(ddl)

    # Bulk insert
    placeholders = ",".join(["?"] * len(df_conv.columns))
    collist = ",".join([quote_ident(c) for c in df_conv.columns])
    sql = f'INSERT INTO {quote_ident(table)} ({collist}) VALUES ({placeholders})'

    # Replace NaN/NaT with None for SQLite
    rows = [
        tuple(None if (pd.isna(v) or v == "nan") else v for v in row)
        for row in df_conv.itertuples(index=False, name=None)
    ]
    if rows:
        cur.executemany(sql, rows)
    conn.commit()

    add_indexes(conn, table, df_conv)
    # Log summary
    summary = ", ".join(f"{k}:{coltypes[k]}" for k in df_conv.columns)
    print(f"[OK] {table}: {len(rows)} rows → {summary}")

# -------- Main --------

def main():
    args = parse_args()
    excel_path = os.path.abspath(args.excel)
    db_path = os.path.abspath(args.db)

    print(f"[INFO] Excel: {excel_path}")
    print(f"[INFO] DB out: {db_path}")

    # Load excel (with lock retry)
    sheets, formats = open_excel(excel_path, retries=args.retries, wait=args.wait)
    if not sheets:
        sys.exit("[ERROR] No sheets found.")

    # Prepare DB (ensure not locked by DB Browser)
    assert_db_not_locked(db_path)
    if os.path.exists(db_path):
        try:
            os.remove(db_path)
        except PermissionError as e:
            sys.exit(f"[ERROR] Can't remove existing DB (locked?): {db_path}\n{e}")

    conn = sqlite3.connect(db_path)
    try:
        # Slightly safer journaling for bulk load
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")

        for table, df in sheets.items():
            if df.empty:
                print(f"[SKIP] {table} is empty")
                continue
            # Ensure columns are unique/safe (already done, but enforce again)
            df.columns = make_column_names(df.columns)
            write_table(conn, table, df, formats.get(table, {}))
    finally:
        conn.close()

    print(f"\nDone. Created SQLite DB: {db_path}")
    print("Open it fresh in DB Browser (don’t rely on an old tab).")

if __name__ == "__main__":
    main()
