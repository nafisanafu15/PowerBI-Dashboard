import sqlite3  # Access SQLite database

# Connect to the existing users database
conn = sqlite3.connect('users.db')
c = conn.cursor()

# Retrieve all rows from users table
c.execute('SELECT * FROM users')
users = c.fetchall()

# Output each user
print('All registered users:')
for user in users:
    print(user)

# Release database resources
conn.close()
