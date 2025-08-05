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

# New simplified dashboard replicating layout reference
@app.route("/managerial-dashboard")
def managerial_dashboard():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("managerial_dashboard.html")

# Detailed report for "Current Students vs Enrolled vs Pending for Visa"
@app.route("/report/current-students")
def current_students_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("current_students_report.html")

# Detailed report for "Enrolled vs Offer"
@app.route("/report/enrolled-offer")
def enrolled_offer_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("enrolled_offer_report.html")

# Detailed report for "Visa Status Breakdown"
@app.route("/report/visa-status")
def visa_status_breakdown():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("visa_status_breakdown.html")

# Detailed report for "Offer Expiry Surge"
@app.route("/report/offer-expiry")
def offer_expiry_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("offer_expiry_report.html")

# Detailed report for "Application Status"
@app.route("/report/application-status")
def application_status_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("application_status_report.html")

# Detailed report for "Deferred Offers"
@app.route("/report/deferred-offers")
def deferred_offers_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("deferred_offers_report.html")

# Detailed report for "Agent Performance"
@app.route("/report/agent-performance")
def agent_performance_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("agent_performance_report.html")

# Detailed report for "Student Classification"
@app.route("/report/student-classification")
def student_classification_report():
    if 'email' not in session:
        return redirect(url_for('login'))
    return render_template("student_classification_report.html")
@app.route("/leader-dashboard")
def leader_dashboard():
    if "email" not in session or session.get("role") != "Leader":
        return redirect(url_for("login"))
    return render_template("leader_dashboard.html")


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

        if len(password) < 12:
            flash("Password must be at least 12 characters long.", "error")
            return redirect(url_for("register"))

        hashed_pw = generate_password_hash(password)

        try:
            conn = sqlite3.connect("users.db")
            c = conn.cursor()
            c.execute("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", (email, hashed_pw, role))
            conn.commit()
            conn.close()

            session['email'] = email
            session['role'] = role
            if role == "Manager":
                return redirect(url_for("dashboard"))
            elif role == "Leader":
                return redirect(url_for("leader_dashboard"))
            else:
                return redirect(url_for("landing"))


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
                session["email"] = email
                session["role"] = role
                if role == "Manager":
                    return redirect(url_for("dashboard"))
                elif role == "Leader":
                    return redirect(url_for("leader_dashboard"))
                else:
                    return redirect(url_for("landing"))
            else:
                flash("Incorrect password", "error")
                return redirect(url_for("login"))
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
