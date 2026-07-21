# EEC Sales System — Setup & Go-Live Guide

This is the one-time setup to bring the web app online, plus the checklist for
going live. The system is three moving parts:

1. **Google Sign-In** — an OAuth client, so people can log in with a Google account.
2. **Cloudflare Worker + D1** — the backend API and the database. **D1 is the
   sole source of truth** for everything (users, companies, inventory, sales, …).
3. **GitHub Pages** — the static frontend.

There is **no Google Sheets and no service-account key** anymore. The only Google
piece is Sign-In (identity); all data lives in Cloudflare D1.

You do this once. Nothing here puts a secret in the repo.

---

## Part 1 — Google Sign-In (OAuth client)

### 1a. Create a project
1. Go to <https://console.cloud.google.com/>.
2. Top bar → project dropdown → **New Project**. Name it e.g. `eec-sales-system`. Create, then select it.

### 1b. OAuth consent screen
1. **APIs & Services → OAuth consent screen**.
2. User type **External** → Create.
3. Fill app name (`East Empire Trading Company`), your support email, developer email. Save and continue.
4. Scopes: none needed — Save and continue.
5. Test users: add the Google accounts that will sign in while the app is in "Testing" (publish later to allow anyone). Save.

### 1c. OAuth client ID (this is PUBLIC)
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type **Web application**.
3. **Authorized JavaScript origins** — add:
   - `https://<your-github-username>.github.io` (e.g. `https://meretheec.github.io`)
   - `http://localhost:5173` (for local development)
4. Create. Copy the **Client ID** (`…apps.googleusercontent.com`). It goes in two
   places: `app-config.json` (frontend) and `wrangler.toml` `GOOGLE_CLIENT_ID` (Worker).

> No Sheets API, no service account, no downloaded key. Sign-In is the only Google product used.

---

## Part 2 — Cloudflare Worker (the API) + D1 (the database)

### 2a. Create the D1 database
1. Cloudflare dashboard → **Workers & Pages → D1 → Create database** → name it exactly **`eec-ledger`** → Create.
2. Copy the **Database ID** and put it in `worker/wrangler.toml` under `[[d1_databases]]` → `database_id`.
   (It's already filled in for this repo's database — only change it if you made a new one.)

The Worker creates every table in code on first run (idempotent `CREATE TABLE IF NOT EXISTS`), so there's no migration step.

### 2b. Set the admins
In `worker/wrangler.toml` `[vars]`, set **`ADMIN_EMAILS`** to a comma-separated list
of the Google emails that should be admins:

```toml
ADMIN_EMAILS = "you@example.com,partner@example.com"
```

Anyone signing in with a listed email becomes an admin automatically (and is
added to the member list on first sign-in). **This is how the first admin is
created** — there is no hand-seeded database row. Change the list and redeploy to
add/remove admins.

Also confirm `GOOGLE_CLIENT_ID` (from 1c) and `ALLOWED_ORIGIN` (your Pages origin,
plus `http://localhost:5173` while developing) in the same `[vars]` block.

### 2c. Deploy the Worker

**Option A — from GitHub Actions (browser only, recommended)**
1. Cloudflare: **Workers & Pages** → copy your **Account ID** (right sidebar).
2. Cloudflare: profile → **My Profile → API Tokens → Create Token** → **"Edit
   Cloudflare Workers"** template → Create → copy the token.
3. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = the token
   - `CLOUDFLARE_ACCOUNT_ID` = the account ID
   (No `SA_KEY` — there is no service account anymore.)
4. **Actions** tab → **Deploy Worker API → Run workflow**.
5. Smoke test: visit `https://eec-sales-system-api.<subdomain>.workers.dev/health`.
   Expect `{"ok":true,...,"configured":{"clientId":true,"admins":true,"db":"ok"}}`.
   `db:"ok"` means D1 is bound and its tables exist.

**Option B — from a local terminal**
```bash
cd worker && npm install
npx wrangler login
npx wrangler deploy      # prints the *.workers.dev URL
```

---

## Part 3 — GitHub Pages (the frontend)

1. Edit **`app-config.json`** (repo root):
   - `googleClientId` = client ID from 1c
   - `apiBaseUrl` = the Worker URL from Part 2
2. Commit and push to `main`.
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The
   `Deploy frontend to GitHub Pages` workflow publishes the site.
4. Visit `https://<your-username>.github.io/eec-sales-system/`. Sign in with an
   admin email from 2b — you should land on the **Admin Panel**.

---

## Part 4 — Backups & recovery

There are three independent layers; use as many as you like.

### 4a. Manual file backup (always available)
Admin → **Network Settings → Data backup**:
- **Export backup** downloads a gzipped JSON snapshot (`eec-backup-YYYY-MM-DD.json.gz`) of the **entire** database.
- **Preview restore** shows a current-vs-incoming row-count diff for a chosen file — sanity-check before applying.
- **Restore backup** replaces all live data with the file. It cannot be undone, so export first.
- Admins get a Monday reminder banner to grab a fresh export. Do it weekly.

### 4b. Automated off-site backup to R2 (optional, recommended for production)
A daily Worker cron writes a full snapshot to a Cloudflare **R2** bucket and keeps
the most recent `BACKUP_KEEP` (default 14). To enable:
1. Cloudflare → **R2 → Create bucket** → name it `eec-backups`.
2. In `worker/wrangler.toml`, uncomment the `[[r2_buckets]]` block (binding `BACKUPS`).
3. Redeploy. `/health` will then show `"backups":true`. (Until the bucket is bound, the cron is a harmless no-op.)

### 4c. Cloudflare D1 Time Travel (built-in, zero setup)
D1 keeps a continuous point-in-time history for the last **30 days** — a free
"oh no" recovery path that covers the gap between manual/R2 backups. To restore:
```bash
cd worker
npx wrangler d1 time-travel info eec-ledger              # see the current bookmark
npx wrangler d1 time-travel restore eec-ledger --timestamp=2026-07-21T12:00:00Z
```
(You can also restore to a bookmark from `time-travel info`.) This rewinds the
whole database, so export a current backup first if you might want today's data back.

---

## Going live — final checklist

- [ ] OAuth client origins include your real Pages origin (Part 1c).
- [ ] `ADMIN_EMAILS` lists the real operator email(s) (Part 2b).
- [ ] `GOOGLE_CLIENT_ID` matches in both `app-config.json` and `wrangler.toml`.
- [ ] `ALLOWED_ORIGIN` includes your Pages origin.
- [ ] `/health` returns `db:"ok"`.
- [ ] You can sign in as admin and see the Admin Panel; a test owner can register a business and ring up a sale.
- [ ] (Recommended) R2 bucket bound for automated backups (Part 4b).
- [ ] (Optional) Publish the OAuth consent screen so anyone — not just test users — can sign in.
- [ ] Take a first manual backup and store it somewhere safe.

## What lives where (security summary)

| Thing | Secret? | Where it lives |
|---|---|---|
| OAuth client ID | No (public) | `app-config.json`, `wrangler.toml` |
| Admin emails | No | `wrangler.toml` `ADMIN_EMAILS` |
| All application data | — | Cloudflare D1 (`eec-ledger`) |
| Cloudflare deploy token | **YES** | GitHub Actions secret only — never in git |

The browser never holds any data-store credential. Every access decision is made
by the Worker after verifying the Google ID token; the static frontend only
renders what the API returns.
