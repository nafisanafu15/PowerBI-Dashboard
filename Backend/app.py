# app.py

import os
from io import BytesIO
from flask import Flask, jsonify, render_template
import pandas as pd
from dotenv import load_dotenv

#  Load environment variables 
load_dotenv()  # reads .env in this directory

USE_SP = os.getenv("USE_SHAREPOINT", "false").lower() in ("1", "true", "yes")
print("DEBUG: USE_SHAREPOINT =", USE_SP)

#Paths & credentials 
BASE_DIR  = os.path.dirname(__file__)
DATA_PATH = os.path.join(BASE_DIR, "dummy_data.xlsx")

SP_TENANT_ID     = os.getenv("SP_TENANT_ID")
SP_CLIENT_ID     = os.getenv("SP_CLIENT_ID")
SP_CLIENT_SECRET = os.getenv("SP_CLIENT_SECRET")
SP_SITE_URL      = os.getenv("SP_SITE_URL")
SP_FILE_PATH     = os.getenv("SP_FILE_PATH")

# Flask app setup 
# static_folder="static" will serve /static/Assets, /static/Css, /static/Js
# template_folder="templates" will look here for your HTML
app = Flask(
    __name__,
    static_folder="static",
    static_url_path="/static",
    template_folder="templates"
)

# Routes 
@app.route("/")                 # Dashboard
def dashboard():
    return render_template("managerial-landing-dashboard.html")

@app.route("/landing")          # Public landing page
def landing():
    return render_template("website_landing_page.html")

@app.route("/register")         # Registration page
def register():
    return render_template("registration-page.html")

@app.route("/api/data")         # JSON data for charts
def api_data():
    if USE_SP:
        # SharePoint fetch (requires `office365` package) 
        from office365.runtime.auth.client_credential import ClientCredential
        from office365.sharepoint.client_context import ClientContext

        creds = ClientCredential(SP_CLIENT_ID, SP_CLIENT_SECRET)
        ctx   = ClientContext(SP_SITE_URL).with_credentials(creds)

        response = (
            ctx.web
               .get_file_by_server_relative_url(SP_FILE_PATH)
               .download()
               .execute_query()
        )
        excel_bytes = BytesIO(response.content)
        df = pd.read_excel(excel_bytes, sheet_name=0)
    else:
        # Local fallback
        print("DEBUG: Reading local Excel:", DATA_PATH)
        df = pd.read_excel(DATA_PATH, sheet_name=0)

    df = df.fillna(0)  # avoid JSON nulls
    records = df.to_dict(orient="records")
    print("DEBUG: Records returned:", len(records))
    return jsonify(records)

#  Main 
if __name__ == "__main__":
    # By default runs on http://127.0.0.1:5000
    app.run(debug=True)
