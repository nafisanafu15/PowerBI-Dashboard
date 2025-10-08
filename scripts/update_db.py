import sqlite3
from pathlib import Path

import pandas as pd


DATA_DIR = Path(__file__).resolve().parents[1] / "backend" / "data"
EXCEL_FILE = DATA_DIR / "dummy_data.xlsx"
DB_FILE = DATA_DIR / "dummy_data.db"

# Load cleaned Excel
print("Loading cleaned Excel file...")
df = pd.read_excel(EXCEL_FILE)

# Connect to SQLite
conn = sqlite3.connect(str(DB_FILE))

# Overwrite reportdata table with cleaned data
df.to_sql("reportdata", conn, if_exists="replace", index=False)

conn.close()
print("SQLite database updated successfully!")

