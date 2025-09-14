import os
import re
from io import BytesIO
from typing import Optional
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, jsonify, session, flash
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import pandas as pd
from dotenv import load_dotenv

# Load environment variables from .env for configuration
load_dotenv()

def init_db():
    # Create users table if it does not already exist
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute('CREATE TABLE IF NOT EXISTS users (\n            id INTEGER PRIMARY KEY AUTOINCREMENT,\n            email TEXT UNIQUE NOT NULL,\n            password TEXT NOT NULL,\n            role TEXT NOT NULL\n        )')
    conn.commit()
    conn.close()

# Initialize database on module import
init_db()

# Toggle reading data from SharePoint instead of local/SQLite
USE_SP = os.getenv('USE_SHAREPOINT', 'false').lower() in ('1', 'true', 'yes')
print('DEBUG: USE_SHAREPOINT =', USE_SP)

# Base paths for locating data files
BASE_DIR = os.path.dirname(__file__)
DATA_PATH = os.path.join(BASE_DIR, 'dummy_data.xlsx')
SQLITE_DB = os.path.join(BASE_DIR, 'dummy_data.db')

# Optional defaults and SharePoint credentials
DEFAULT_SQLITE_TABLE = os.getenv('DEFAULT_SQLITE_TABLE')
SP_CLIENT_ID = os.getenv('SP_CLIENT_ID')
SP_CLIENT_SECRET = os.getenv('SP_CLIENT_SECRET')
SP_SITE_URL = os.getenv('SP_SITE_URL')
SP_FILE_PATH = os.getenv('SP_FILE_PATH')

# Create Flask app instance
app = Flask(__name__, static_folder='static', static_url_path='/static', template_folder='templates')
app.secret_key = os.getenv('SECRET_KEY', 'fallback_secret')

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
    if not os.path.exists(SQLITE_DB):
        raise FileNotFoundError(f'SQLite DB not found at {SQLITE_DB}')
    with sqlite3.connect(SQLITE_DB) as conn:
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
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f'Excel file not found at {DATA_PATH}')
    return pd.read_excel(DATA_PATH, sheet_name=0)

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

@app.route('/report/offer-expiry')
@role_required('Manager')
def offer_expiry_report():
    # Report of upcoming offer expiries
    return render_template('offer_expiry_report.html')

@app.route('/report/application-status')
@role_required('Leader')
def application_status_report():
    # Leader report of application statuses
    return render_template('application_status_report.html')

@app.route('/report/deferred-offers')
@role_required('Leader')
def deferred_offers_report():
    # Leader report of deferred offers
    return render_template('deferred_offers_report.html')

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

        # TODO: plug in email/DB logging here
        app.logger.info(f"[CONTACT] {name} <{email}> ({company}) [{subject}] — {len(message)} chars")
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
        conn = sqlite3.connect('users.db')
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
        conn = sqlite3.connect('users.db')
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
    # Provide tabular data as JSON from available source
    try:
        if USE_SP:
            df = _read_sharepoint_excel()
        elif os.path.exists(SQLITE_DB):
            table_param = request.args.get('table')
            df = _read_sqlite(table_param)
        else:
            df = _read_local_excel()
        df = df.fillna(0)
        return (jsonify(df.to_dict(orient='records')), 200)
    except Exception as e:
        return (jsonify({'error': str(e)}), 500)

def _json_from_view(view_name: str):
    """
    Return JSON from a database view with SQL fallbacks.

    This version is robust to schema differences. In particular, it
    dynamically resolves the visa status column for v_visa_breakdown
    to avoid 500s when the column is named e.g. 'Visa Status' or 'Visa'.
    """
    # --- small helpers (scoped to this function) ---
    def _table_columns(conn, table="reportdata"):
        cur = conn.execute(f"PRAGMA table_info({table})")
        cols = [row[1] for row in cur.fetchall()]
        return cols, {c.lower(): c for c in cols}  # map lower->actual

    def _resolve_col(conn, candidates, table="reportdata"):
        """Return the actual column name (case/spacing tolerant) that exists."""
        cols, lower_map = _table_columns(conn, table)
        for cand in candidates:
            # try exact, then case-insensitive
            if cand in cols:
                return cand
            lc = cand.lower()
            if lc in lower_map:
                return lower_map[lc]
        return None

    def _q(colname):
        """Quote identifier for SQLite (handles spaces/special chars)."""
        # Using [] quoting works in SQLite for odd names
        return f"[{colname}]"

    # Fallback queries that don't depend on fragile column names
def _json_from_view(view_name: str):
    """
    Return JSON from a database view with SQL fallbacks.
    - Handles both 'no such table' and 'no such view'
    - Dynamically resolves visa column for v_visa_breakdown
    """
    def _table_columns(conn, table="reportdata"):
        cur = conn.execute(f"PRAGMA table_info({table})")
        cols = [row[1] for row in cur.fetchall()]
        lower_map = {c.lower(): c for c in cols}
        return cols, lower_map

    def _find_column(conn, candidates, table="reportdata"):
        cols, lower_map = _table_columns(conn, table)
        # exact / case-insensitive candidates first
        for cand in candidates:
            if cand in cols:
                return cand
            if cand.lower() in lower_map:
                return lower_map[cand.lower()]
        # then anything that contains the substring (e.g., 'Visa Status', 'visa_type')
        for c in cols:
            if "visa" in c.lower():
                return c
        return None

    def _q(name):
        # bracket quoting works fine for SQLite identifiers with spaces
        return f"[{name}]"
def _json_from_view(view_name: str):
    """
    Return JSON from a database view with SQL fallbacks.
    - Handles 'no such table' and 'no such view'
    - Dynamically resolves visa column for v_visa_breakdown
    - Dynamically resolves offer expiry date column for v_offer_expiry_surge*
      and aggregates using pandas (robust to Excel-style dates)
    """
    # ---- helpers -------------------------------------------------------------
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

    FALLBACK_QUERIES = {
        'v_application_status_totals': """
            SELECT COALESCE(status,'Unknown') AS status,
                   COUNT(*) AS total
            FROM reportdata
            GROUP BY COALESCE(status,'Unknown')
            ORDER BY total DESC
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

    # ---- main logic ----------------------------------------------------------
    try:
        df = _read_sqlite(view_name)  # try a database view first
    except Exception as e:
        msg = str(e).lower()
        if ('no such table' not in msg) and ('no such view' not in msg):
            # real error -> bubble up
            raise

        with sqlite3.connect(SQLITE_DB) as conn:
            # ---- dynamic VISA BREAKDOWN --------------------------------------
            if view_name == 'v_visa_breakdown':
                visa_col = _find_column(conn,
                    ['visa_type', 'visa_status', 'Visa Type', 'Visa Status', 'visa', 'Visa']
                )
                if not visa_col:
                    df = pd.DataFrame(columns=['visa_type', 'total'])
                else:
                    qc = _q(visa_col)
                    query = f"""
                        SELECT COALESCE({qc}, 'Unknown') AS visa_type,
                               COUNT(*) AS total
                        FROM reportdata
                        GROUP BY COALESCE({qc}, 'Unknown')
                        ORDER BY total DESC
                    """
                    df = pd.read_sql_query(query, conn)

             # ---- dynamic OFFER EXPIRY (DAILY/MONTHLY) ------------------------
            elif view_name in ('v_offer_expiry_surge_daily',
                               'v_offer_expiry_surge_monthly',
                               'v_offer_expiry_surge'):
                exp_col = _find_column(conn,
                    ['offer_expiry_date', 'Offer Expiry Date', 'expiry_date', 'Expiry Date', 'offer expiry']
                )
                if not exp_col:
                    if view_name == 'v_offer_expiry_surge_monthly':
                        df = pd.DataFrame(columns=['expiry_month', 'expiring_offers'])
                    else:
                        df = pd.DataFrame(columns=['expiry_day', 'expiring_offers'])
                else:
                    qc = _q(exp_col)
                    raw = pd.read_sql_query(
                        f"SELECT {qc} AS raw_date FROM reportdata "
                        f"WHERE {qc} IS NOT NULL AND trim({qc}) <> ''",
                        conn
                    )
                    raw['raw_date'] = pd.to_datetime(raw['raw_date'], errors='coerce', dayfirst=True)
                    raw = raw.dropna(subset=['raw_date'])

                    if view_name == 'v_offer_expiry_surge_monthly':
                        raw['expiry_month'] = raw['raw_date'].dt.strftime('%Y-%m')
                        df = (raw.groupby('expiry_month')
                                .size().reset_index(name='expiring_offers')
                                .sort_values('expiry_month'))
                    else:
                        raw['expiry_day'] = raw['raw_date'].dt.strftime('%Y-%m-%d')
                        df = (raw.groupby('expiry_day')
                                .size().reset_index(name='expiring_offers')
                                .sort_values('expiry_day'))
                        # ---- dynamic DEFERRED OFFERS OVERVIEW ----------------------------
            elif view_name == 'v_deferred_offers_overview':
                # Resolve likely column names in your DB
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

                # Pull minimum necessary raw data
                if intake_col and year_col:
                    sel = [f"{_q(intake_col)} AS intake", f"{_q(year_col)} AS year"]
                elif term_col:
                    sel = [f"{_q(term_col)} AS term"]
                else:
                    # Nothing we can form a term from
                    df = pd.DataFrame(columns=['term', 'deferred_count', 'total_offers'])
                    # fall through to the post-processing at the end of the function
                    return jsonify(df.to_dict(orient='records')), 200

                if status_col:
                    sel.append(f"{_q(status_col)} AS status")
                if flag_col:
                    sel.append(f"{_q(flag_col)} AS flag")

                raw = pd.read_sql_query(f"SELECT {', '.join(sel)} FROM reportdata", conn)

                # Build term
                if 'term' not in raw.columns:
                    raw['term'] = raw['intake'].astype(str).str.strip() + ' ' + raw['year'].astype(str).str.strip()
                raw['term'] = raw['term'].astype(str).str.strip()

                # Determine 'deferred'
                if 'flag' in raw.columns:
                    s = raw['flag'].astype(str).str.strip().str.lower()
                    is_deferred = s.isin(['1','true','t','y','yes'])
                elif 'status' in raw.columns:
                    s = raw['status'].astype(str).str.strip().str.lower()
                    is_deferred = s.str.startswith('deferred')
                else:
                    is_deferred = pd.Series(False, index=raw.index)

                # Aggregate
                grp = (
                    pd.DataFrame({'term': raw['term'], 'is_def': is_deferred})
                      .groupby('term', dropna=False)['is_def']
                      .agg(deferred_count='sum', total_offers='size')
                      .reset_index()
                )

                # Add common aliases some front-ends expect
                grp['deferred'] = grp['deferred_count'].astype(int)
                grp['total'] = grp['total_offers'].astype(int)

                # Drop 'Unknown' buckets
                mask = grp['term'].astype(str).str.strip().str.lower().ne('unknown')
                df = grp[mask]


            # ---- generic fallbacks -------------------------------------------
            else:
                query = FALLBACK_QUERIES.get(view_name)
                if not query:
                    raise
                df = pd.read_sql_query(query, conn)

    # Fill numeric 
    for col in df.select_dtypes(include=['float', 'int']).columns:
        df[col] = df[col].fillna(0)

    return jsonify(df.to_dict(orient='records')), 200


@app.route('/api/application-status')
def api_application_status():
    # API endpoint for application status totals
    return _json_from_view('v_application_status_totals')

@app.route('/api/deferred-offers')
def api_deferred_offers():
    # API endpoint for deferred offers overview
    return _json_from_view('v_deferred_offers_overview')

@app.route('/api/agent-performance')
def api_agent_performance():
    # API endpoint for agent performance metrics
    return _json_from_view('v_agent_performance')

@app.route('/api/student-classification')
def api_student_classification():
    # API endpoint for student classification counts
    return _json_from_view('v_student_classification')

@app.route('/api/current-vs-enrolled')
def api_current_vs_enrolled():
    # API endpoint comparing current vs enrolled students
    return _json_from_view('v_current_vs_enrolled')

@app.route('/api/enrolled-vs-offer')
def api_enrolled_vs_offer():
    # API endpoint for enrolled vs offer data
    return _json_from_view('v_enrolled_vs_offer')

@app.route('/api/offer-expiry-surge')
def api_offer_expiry_surge():
    # API endpoint for daily offer expiry counts
    return _json_from_view('v_offer_expiry_surge_daily')

@app.route('/api/visa-breakdown')
def api_visa_breakdown():
    # API endpoint for visa type breakdown
    return _json_from_view('v_visa_breakdown')

if __name__ == '__main__':
    # Launch development server
    app.run(debug=True, port=5001)
