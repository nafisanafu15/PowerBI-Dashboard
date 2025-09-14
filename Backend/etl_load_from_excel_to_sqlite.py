#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ETL: Excel (.xlsx) -> SQLite (.db)
- Infers SQLite column types: INTEGER, REAL, TEXT (ISO date/datetime stored as TEXT)
- Coerces booleans (yes/no, true/false, 1/0) -> INTEGER 0/1
- Sanitizes table & column names, resolves duplicates
- Drops/recreates tables, bulk inserts
- Adds helpful indexes on common columns
"""

import os
import re
import sys
import time
import argparse
import sqlite3
from typing import Dict, List, Tuple
from datetime import datetime

import numpy as np
import pandas as pd

# -------- CLI --------

def parse_args():
    p = argparse.ArgumentParser(description="Load Excel sheets into a SQLite DB.")
    p.add_argument("--excel", default="dummy_data.xlsx", help="Path to input .xlsx")
    p.add_argument("--db", default="dummy_data.db", help="Output SQLite file")
    p.add_argument("--retries", type=int, default=8, help="Retries if files are locked")
    p.add_argument("--wait", type=float, default=0.75, help="Seconds between retries")
    return p.parse_args()

# -------- Name utilities --------

SQL_KEYWORDS = {"table", "select", "from", "where", "group", "order", "by", "join"}

def sanitize_name(name: str) -> str:
    """Standardize sheet/column names for SQLite."""
    name = (str(name) or "").strip().lower()
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = "unnamed"
    if re.match(r"^\d", name):
        name = f"t_{name}"
    if name in SQL_KEYWORDS:
        name = f"{name}_col"
    return name

def ensure_unique(names: List[str]) -> List[str]:
    """Ensure column names are unique after sanitizing."""
    seen = {}
    out = []
    for n in names:
        base = n
        if base not in seen:
            seen[base] = 0
            out.append(base)
        else:
            seen[base] += 1
            out.append(f"{base}_{seen[base]}")
    return out

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

def infer_datetime(series: pd.Series) -> Tuple[pd.Series, bool]:
    # Use pandas to attempt parse
    dt = pd.to_datetime(series, errors="coerce", dayfirst=False, infer_datetime_format=True)
    nonnull = series.notna().sum()
    if nonnull == 0:
        return series, False
    # Consider datetime if >=80% of non-nulls parse
    if dt.notna().sum() >= max(3, int(0.8 * nonnull)):
        # Pick DATE vs DATETIME by checking for time components
        times = dt.dt.time
        is_all_midnight = (times == datetime.min.time()).all()
        if is_all_midnight:
            out = dt.dt.strftime("%Y-%m-%d")
        else:
            out = dt.dt.strftime("%Y-%m-%d %H:%M:%S")
        return out.where(dt.notna(), None), True
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

def infer_df_types(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, str]]:
    """Return converted DataFrame and {col: sqlite_type}."""
    out = pd.DataFrame(index=df.index)
    coltypes: Dict[str, str] = {}
    for col in df.columns:
        s = df[col]

        # 1) Boolean?
        s2, is_bool = coerce_bool(s)
        if is_bool:
            out[col] = s2
            coltypes[col] = "INTEGER"
            continue

        # 2) Datetime?
        s3, is_dt = infer_datetime(s2)
        if is_dt:
            out[col] = s3
            coltypes[col] = "TEXT"  # ISO 8601
            continue

        # 3) Numeric?
        s4, num_type = infer_numeric(s3)
        if num_type is not None:
            out[col] = s4
            coltypes[col] = num_type
            continue

        # 4) Fallback text
        txt = s3.astype(str)
        # Keep None/NaN as None
        txt = txt.where(s3.notna(), None)
        out[col] = txt
        coltypes[col] = "TEXT"

    return out, coltypes

# -------- Excel loading --------

def open_excel(path: str, retries: int, wait: float) -> Dict[str, pd.DataFrame]:
    """Load all sheets; sanitize sheet & column names; ensure unique columns."""
    if not os.path.exists(path):
        sys.exit(f"[ERROR] Excel file not found: {path}")
    wait_for_file(path, retries=retries, wait=wait)

    try:
        xls = pd.ExcelFile(path, engine="openpyxl")
    except Exception as e:
        sys.exit(
            f"[ERROR] Could not open '{path}'. "
            f"If it's .xlsx, ensure 'openpyxl' is installed: pip install openpyxl\n{e}"
        )

    tables: Dict[str, pd.DataFrame] = {}
    used_names = set()

    for sheet in xls.sheet_names:
        raw = pd.read_excel(xls, sheet_name=sheet)
        # Sanitize and dedupe columns
        cols = [sanitize_name(c) for c in raw.columns]
        cols = ensure_unique(cols)
        raw.columns = cols

        # Sanitize table name; dedupe across sheets if needed
        tname = sanitize_name(sheet)
        suffix = 2
        base = tname
        while tname in used_names:
            tname = f"{base}_{suffix}"
            suffix += 1
        used_names.add(tname)

        tables[tname] = raw

    return tables

# -------- SQL helpers --------

def create_table_sql(table: str, df: pd.DataFrame, coltypes: Dict[str, str]) -> str:
    cols_sql = [f'"{c}" {coltypes[c]}' for c in df.columns]

    # Add synthetic PK only if you want explicit primary key;
    # SQLite already has an implicit rowid, so this is optional.
    # Keep for backward-compat with your previous script:
    has_id_like = any(
        c in df.columns
        for c in ["id", "student_id", "application_id", "offer_id"]
    )
    pk = "" if has_id_like else ', "__rowid__" INTEGER PRIMARY KEY AUTOINCREMENT'
    return f'CREATE TABLE "{table}" ({", ".join(cols_sql)}{pk});'

IDX_TARGETS = [
    "id", "student_id", "application_id", "offer_id", "enrollment_id", "visa_id",
    "agent_id", "term", "intake", "status",
    "date", "created_at", "updated_at", "offer_date", "expiry_date",
    "granted_date", "lodged_date", "startdate", "finishdate"
]

def add_indexes(conn: sqlite3.Connection, table: str, df: pd.DataFrame) -> None:
    existing = set(df.columns)
    made = 0
    for col in IDX_TARGETS:
        if col in existing:
            idx_name = f'idx_{table}_{col}'
            try:
                conn.execute(f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON "{table}" ("{col}");')
                made += 1
            except Exception as e:
                print(f"[WARN] Could not create index on {table}.{col}: {e}")
    if made:
        print(f"  - Added {made} index(es) to {table}")

def write_table(conn: sqlite3.Connection, table: str, df_raw: pd.DataFrame) -> None:
    # Infer & convert types
    df_conv, coltypes = infer_df_types(df_raw)

    # Create table
    cur = conn.cursor()
    cur.execute(f'DROP TABLE IF EXISTS "{table}";')
    ddl = create_table_sql(table, df_conv, coltypes)
    cur.execute(ddl)

    # Bulk insert
    placeholders = ",".join(["?"] * len(df_conv.columns))
    collist = ",".join([f'"{c}"' for c in df_conv.columns])
    sql = f'INSERT INTO "{table}" ({collist}) VALUES ({placeholders})'

    # Replace NaN/NaT with None for SQLite
    rows = [
        tuple(None if (pd.isna(v) or v == "nan") else v for v in row)
        for row in df_conv.itertuples(index=False, name=None)
    ]
    if rows:
        cur.executemany(sql, rows)
    conn.commit()

    add_indexes(conn, df_conv, df_conv)  # pass df for column existence
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
    sheets = open_excel(excel_path, retries=args.retries, wait=args.wait)
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
            df.columns = ensure_unique([sanitize_name(c) for c in df.columns])
            write_table(conn, table, df)
    finally:
        conn.close()

    print(f"\nDone. Created SQLite DB: {db_path}")
    print("Open it fresh in DB Browser (don’t rely on an old tab).")

if __name__ == "__main__":
    main()
