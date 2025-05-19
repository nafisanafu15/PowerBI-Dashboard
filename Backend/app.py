# app.py

import os
from io import BytesIO

from flask import Flask, jsonify, render_template, url_for
import pandas as pd
from dotenv import load_dotenv

#  Load .env (at project/Backend/.env)
load_dotenv()

#  Decide whether to pull from SharePoint
USE_SP = os.getenv("USE_SHAREPOINT", "false").lower() in ("1", "true", "yes")
print("DEBUG: USE_SHAREPOINT =", USE_SP)

#  Paths
BASE_DIR  = os.path.dirname(__file__)
DATA_PATH = os.path.join(BASE_DIR, "dummy_data.xlsx")

# Flask app  static_folder=static and template_folder=templates
app = Flask(
    __name__,
    static_folder="static",
    static_url_path="/static",
    template_folder="templates"
)


#  Home / Dashboard
@app.route("/")
def dashboard():
    return render_template("managerial-landing-dashboard.html")

#  Alternative landing page
@app.route("/landing")
def landing():
    return render_template("website_landing_page.html")

#  Registration frontend
@app.route("/register")
def register():
    return render_template("registration-page.html")

#  Data API for charts
@app.route("/api/data")
def api_data():
    if USE_SP:
        #  SharePoint logic 
        from office365.runtime.auth.client_credential import ClientCredential
        from office365.sharepoint.client_context import ClientContext

        creds = ClientCredential(
            os.getenv("SP_CLIENT_ID"),
            os.getenv("SP_CLIENT_SECRET")
        )
        ctx = ClientContext(os.getenv("SP_SITE_URL")).with_credentials(creds)

        response = ctx.web \
            .get_file_by_server_relative_url(os.getenv("SP_FILE_PATH")) \
            .download().execute_query()

        df = pd.read_excel(BytesIO(response.content), sheet_name=0)
    else:
        # fallback: local Excel
        df = pd.read_excel(DATA_PATH, sheet_name=0)

    # clean and jsonify
    df = df.fillna(0)
    records = df.to_dict(orient="records")
    return jsonify(records)

# Helper to inject static URLs into all templates 
@app.context_processor
def inject_static():
    return dict(
        css= lambda fname: url_for('static', filename=f'Css/{fname}'),
        js = lambda fname: url_for('static', filename=f'Js/{fname}'),
        img= lambda fname: url_for('static', filename=f'Assets/{fname}')
    )

# Main
if __name__ == "__main__":
    # if you need custom host/port, change here
    app.run(debug=True, port=5050)
