import sqlite3

# Connect to the SQLite database
conn = sqlite3.connect("users.db")
c = conn.cursor()

# Fetch all users
c.execute("SELECT * FROM users")
users = c.fetchall()

# Print users
print("All registered users:")
for user in users:
    print(user)

conn.close()
