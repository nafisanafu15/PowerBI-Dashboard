import sqlite3
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "backend" / "data"
USERS_DB = DATA_DIR / "users.db"


def main() -> None:
    conn = sqlite3.connect(str(USERS_DB))
    try:
        c = conn.cursor()
        c.execute("SELECT * FROM users")
        users = c.fetchall()

        print("All registered users:")
        for user in users:
            print(user)
    finally:
        conn.close()


if __name__ == "__main__":
    main()

