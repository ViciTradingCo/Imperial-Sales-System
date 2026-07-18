# EEC Sales System — Setup Guide

This is the one-time setup to bring the web app online. It has four parts:

1. **Google Cloud** — an OAuth client (for user sign-in) and a service account (for the backend to read/write Sheets).
2. **Google Sheets** — share the Core with the service account and add the `Users` tab.
3. **Cloudflare Worker** — the backend API.
4. **GitHub Pages** — the frontend.

You only do this once. Nothing here puts a secret in the repo — the single secret (the service-account key) lives in the Worker and in GitHub Actions secrets.

> **Alternative:** if you'd rather not use Cloudflare, the API can instead run as a Google Apps Script Web App. Ask and we'll swap Part 3. Everything else is identical.

---

## Part 1 — Google Cloud

### 1a. Create a project
1. Go to <https://console.cloud.google.com/>.
2. Top bar → project dropdown → **New Project**. Name it e.g. `eec-sales-system`. Create, then select it.

### 1b. Enable the Sheets API
1. **APIs & Services → Library**.
2. Search **Google Sheets API** → **Enable**.

### 1c. OAuth consent screen (for user sign-in)
1. **APIs & Services → OAuth consent screen**.
2. User type **External** → Create.
3. Fill app name (`East Empire Trading Company`), your support email, developer email. Save and continue.
4. Scopes: none needed beyond the defaults — click Save and continue.
5. Test users: add the Google accounts that will sign in while the app is in "Testing" (you can publish later to allow anyone). Save.

### 1d. OAuth client ID (this is PUBLIC)
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type **Web application**.
3. **Authorized JavaScript origins** — add:
   - `https://<your-github-username>.github.io` (e.g. `https://meretheec.github.io`)
   - `http://localhost:5173` (for local development)
4. Create. Copy the **Client ID** (`…apps.googleusercontent.com`). You'll paste it in two places (frontend config + Worker var).

### 1e. Service account (this key is SECRET)
1. **APIs & Services → Credentials → Create Credentials → Service account**.
2. Name it `eec-sheets`. Create and continue; no roles needed (it gets access via sheet sharing, not IAM). Done.
3. Click the new service account → **Keys → Add key → Create new key → JSON**. A JSON file downloads.
4. **Guard this file.** It's the one real secret. Never commit it. Note the `client_email` inside (`eec-sheets@…iam.gserviceaccount.com`).

---

## Part 2 — Google Sheets

### 2a. Share the Core (and ledgers) with the service account
1. Open the **EEC Core** spreadsheet.
2. **Share** → paste the service account's `client_email` → give it **Editor** → Send (uncheck "notify").
3. Do the same for each shop **ledger** the backend must read/write. (The Core owner sharing model is unchanged for humans; the service account is just another editor.)

### 2b. Get the Core spreadsheet ID
From the Core's URL: `https://docs.google.com/spreadsheets/d/`**`THIS_LONG_ID`**`/edit`. Copy it.

### 2c. Add the `Users` tab
1. In the Core, add a sheet named exactly **`Users`**.
2. Row 1 headers, in order: `UID | Email | Business | Role | Is Owner | Status | Created | Last Seen`.
3. Seed yourself as the first admin — add a row:
   - `UID`: `admin-1` (any unique value)
   - `Email`: **your** Google email (the one you sign in with)
   - `Business`: (leave blank, or `EEC`)
   - `Role`: `admin`
   - `Is Owner`: `FALSE`
   - `Status`: `active`
   - `Created` / `Last Seen`: today's date (optional)

---

## Part 3 — Cloudflare Worker (the API)

1. Create a free account at <https://dash.cloudflare.com/>.
2. Install the CLI and log in:
   ```bash
   npm install
   cd worker && npm install
   npx wrangler login
   ```
3. Edit `worker/wrangler.toml` `[vars]`:
   - `CORE_SPREADSHEET_ID` = the ID from step 2b
   - `GOOGLE_CLIENT_ID` = the client ID from step 1d
   - `ALLOWED_ORIGIN` = `https://<your-username>.github.io` (add `,http://localhost:5173` while developing)
4. Load the service-account key as a secret (paste the entire JSON when prompted):
   ```bash
   npx wrangler secret put SA_KEY
   ```
5. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Copy the printed URL (`https://eec-sales-system-api.<subdomain>.workers.dev`).
6. Smoke test:
   ```bash
   curl https://eec-sales-system-api.<subdomain>.workers.dev/health
   ```
   Expect `{"ok":true,...,"configured":{"coreId":true,"clientId":true,"saKey":true}}`.

---

## Part 4 — GitHub Pages (the frontend)

1. Edit **`app-config.json`** (repo root):
   - `googleClientId` = client ID from 1d
   - `apiBaseUrl` = the Worker URL from Part 3
   - `coreSpreadsheetId` = the ID from 2b
2. Commit and push to `main`.
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The `Deploy frontend to GitHub Pages` workflow publishes the site.
4. Visit `https://<your-username>.github.io/eec-sales-system/`. Sign in with the admin email from 2c — you should see **"You're in the registry ✓"** with your UID and `admin` role.

### Background sync (Part 4b)
1. Repo **Settings → Secrets and variables → Actions**:
   - **Secrets → New**: `SA_KEY` = the full service-account JSON.
   - **Variables → New**: `CORE_SPREADSHEET_ID` = the Core ID.
2. The `Core background sync` workflow is scheduled but no-ops until the crawl script ships (Phase 5/7).

---

## What lives where (security summary)

| Thing | Secret? | Where it lives |
|---|---|---|
| OAuth client ID | No (public) | `app-config.json`, `wrangler.toml` |
| Core spreadsheet ID | No | `app-config.json`, `wrangler.toml`, Actions var |
| Service-account **key** | **YES** | Worker secret (`SA_KEY`) + Actions secret only — never in git |
| User identity/roles | — | the Core `Users` sheet |

The browser never holds the service-account key and never talks to Sheets directly. Every access decision is made by the Worker after verifying the Google ID token.
