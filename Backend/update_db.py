import pandas as pd
import sqlite3

# Paths (adjust if needed)
EXCEL_FILE = "dummy_data.xlsx"
DB_FILE = "dummy_data.db"

# Load cleaned Excel
print("Loading cleaned Excel file...")
df = pd.read_excel(EXCEL_FILE)

# Connect to SQLite
conn = sqlite3.connect(DB_FILE)

# Overwrite reportdata table with cleaned data
df.to_sql("reportdata", conn, if_exists="replace", index=False)

conn.close()
print("SQLite database updated successfully!")
