# app.py

import os                                      # import os for path and env vars
from io import BytesIO                         # BytesIO to read bytes from SharePoint
from flask import Flask, jsonify, render_template  # Flask core
# from flask import request                    # maybe needed later for POST?
import pandas as pd                            # pandas for Excel reading
from dotenv import load_dotenv                 # load .env file

# -------------------------------------------------------------------
# Load environment variables
# -------------------------------------------------------------------
load_dotenv()  # this reads the .env file in the same folder

# Decide whether to use SharePoint or local Excel
USE_SP = os.getenv("USE_SHAREPOINT", "false").lower() in ("1", "true", "yes")
print("DEBUG: USE_SHAREPOINT =", USE_SP)  # check flag

# -------------------------------------------------------------------
# Paths & credentials
# -------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)        # directory of this script
DATA_PATH = os.path.join(BASE_DIR, "dummy_data.xlsx")  # local fallback file

# SharePoint creds (None if not set)
SP_TENANT_ID     = os.getenv("SP_TENANT_ID")
SP_CLIENT_ID     = os.getenv("SP_CLIENT_ID")
SP_CLIENT_SECRET = os.getenv("SP_CLIENT_SECRET")
SP_SITE_URL      = os.getenv("SP_SITE_URL")
SP_FILE_PATH     = os.getenv("SP_FILE_PATH")

# -------------------------------------------------------------------
# Flask app setup
# -------------------------------------------------------------------
# static_folder=".." lets us serve Css/, Js/, Pages/ at root
# template_folder="../Pages" points to our HTML pages
app = Flask(
    __name__,
    static_folder="..",
    static_url_path="",
    template_folder="../Pages"
)

# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------
@app.route("/")  # home page route
def home():
    # render the main dashboard HTML
    # note: make sure Pages/managerial-landing-dashboard.html exists
    return render_template("managerial-landing-dashboard.html")
@app.route('/')
def landing():
  return render_template('website_landing_page.html')

@app.route("/api/data")  # API endpoint for chart data
def api_data():
    # if using SharePoint, fetch from online source
    if USE_SP:
        print("DEBUG: Fetching from SharePoint...")
        # import here to avoid errors when library not installed yet
        from office365.runtime.auth.client_credential import ClientCredential
        from office365.sharepoint.client_context import ClientContext

        # set up auth and context
        creds = ClientCredential(SP_CLIENT_ID, SP_CLIENT_SECRET)
        ctx = ClientContext(SP_SITE_URL).with_credentials(creds)

        # download file into memory
        response = ctx.web.get_file_by_server_relative_url(SP_FILE_PATH) \
                      .download().execute_query()
        excel_bytes = BytesIO(response.content)

        # read into pandas DataFrame
        df = pd.read_excel(excel_bytes, sheet_name=0)

    else:
        # fallback: read local dummy Excel file
        print("DEBUG: Reading local Excel:", DATA_PATH)
        df = pd.read_excel(DATA_PATH, sheet_name=0)

    # replace any NaNs so JSON doesn't break
    df = df.fillna(0)

    # convert to list of dicts for JSON
    records = df.to_dict(orient="records")
    print("DEBUG: Number of records to return:", len(records))

    return jsonify(records)  # return JSON to front end

# -------------------------------------------------------------------
# Main entry point
# -------------------------------------------------------------------
if __name__ == "__main__":
    # run on localhost:5000, debug mode on for auto-reload
    app.run(debug=True)
