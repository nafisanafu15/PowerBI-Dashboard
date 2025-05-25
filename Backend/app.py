import os
from io import BytesIO
from flask import Flask, render_template, request, redirect, url_for, jsonify, session, flash
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import pandas as pd
from dotenv import load_dotenv



load_dotenv()
def init_db():
    conn = sqlite3.connect("users.db")
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL)""")
    conn.commit()
    conn.close()

init_db()

USE_SP = os.getenv("USE_SHAREPOINT", "false").lower() in ("1", "true", "yes")
print("DEBUG: USE_SHAREPOINT =", USE_SP)

BASE_DIR = os.path.dirname(__file__)
DATA_PATH = os.path.join(BASE_DIR, "dummy_data.xlsx")

SP_CLIENT_ID     = os.getenv("SP_CLIENT_ID")
SP_CLIENT_SECRET = os.getenv("SP_CLIENT_SECRET")
SP_SITE_URL      = os.getenv("SP_SITE_URL")
SP_FILE_PATH     = os.getenv("SP_FILE_PATH")

app = Flask(__name__,
            static_folder="static",
            static_url_path="/static",
            template_folder="templates")
app.secret_key = 'supersecretkey123' #key to secure my db for user
app.secret_key = os.getenv("SECRET_KEY", "fallback_secret")

@app.route("/managerial")
def dashboard():
    if 'email' not in session:
        return redirect(url_for('login'))  # redirect to login page
    return render_template("managerial-landing-dashboard.html")
@app.route("/stakeholder")
def stakeholder_dashboard():
    return render_template("stakeholder-landing-dashboard.html")

@app.route("/")
def landing():
    return render_template("website_landing_page.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        email = request.form.get("Email")
        password = request.form.get("Password")
        role = request.form.get("Role")
        role = request.form.get("Role")
        print("role received:", role)

        hashed_pw = generate_password_hash(password)

        try:
            conn = sqlite3.connect("users.db")
            c = conn.cursor()
            c.execute("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", (email, hashed_pw, role))
            conn.commit()
            conn.close()

            session['email'] = email
            session['role'] = role
            print("Redirecting to:", "dashboard" if role == "Manager" else "stakeholder_dashboard")


            if role == "Manager":
                return redirect(url_for("dashboard"))
            else:
                return redirect(url_for("stakeholder_dashboard"))

        except sqlite3.IntegrityError:
            # Lookup existing role only once
            conn = sqlite3.connect("users.db")
            c = conn.cursor()
            c.execute("SELECT role FROM users WHERE email = ?", (email,))
            result = c.fetchone()
            conn.close()

            if result:
                existing_role = result[0]
                message = f"This email is already registered as {existing_role}"
            else:
                message = "This email is already registered"

            #  Flash only once
            flash(message, "error")

            return redirect(url_for("register"))


        finally:
            conn.close()

    return render_template("registration-page.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form['email']
        password = request.form['password']

        conn = sqlite3.connect("users.db")
        c = conn.cursor()
        c.execute("SELECT password, role FROM users WHERE email = ?", (email,))
        result = c.fetchone()
        conn.close()

        if result:
            stored_password, role = result
            if check_password_hash(stored_password, password):
                session['email'] = email
                session['role'] = role

                if role == "Manager":
                    return redirect(url_for("dashboard"))
                else:
                    return redirect(url_for("stakeholder_dashboard"))
            else:
                flash("Incorrect password", "error")
                return redirect(url_for("login"))  # stay on login, not register
        else:
            flash("User not found", "error")
            return redirect(url_for("login"))

    return render_template("login.html")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("landing"))  # Redirects to website landing page



@app.route("/api/data")
def api_data():
    if USE_SP:
        from office365.runtime.auth.client_credential import ClientCredential
        from office365.sharepoint.client_context import ClientContext

        creds = ClientCredential(SP_CLIENT_ID, SP_CLIENT_SECRET)
        ctx = ClientContext(SP_SITE_URL).with_credentials(creds)

        response = ctx.web.get_file_by_server_relative_url(SP_FILE_PATH).download().execute_query()
        df = pd.read_excel(BytesIO(response.content), sheet_name=0)
    else:
        df = pd.read_excel(DATA_PATH, sheet_name=0)

    df = df.fillna(0)
    return jsonify(df.to_dict(orient="records"))

if __name__ == "__main__":
    app.run(debug=True, port=5001)
