# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EEC-Sales-System is a "Wheel-And-Spoke" style sales system for the Mereth Skyrim RP server, run by the in-fiction Vici Trading Co. and managed by SmileDaemon on Discord. The domain is roleplay commerce: goods flowing between a central hub ("wheel") and outlying nodes ("spokes").

## Origin: the Apps Script system

The system began as Google Apps Script bound to Google Sheets — a Core ("wheel")
spreadsheet plus per-shop ledger/storefront/market spreadsheets ("spokes"), with
logic in `.gs` files and UIs as HTML sidebars. Those original files are NOT in
this repo; they were provided as reference for the port. Their behavior (sync
pipeline, certification, MOTD, pairing, anomaly detection, the `_config` palette
system) is the specification being reimplemented here.

## Current architecture

A static web frontend on **GitHub Pages** + a **Cloudflare Worker** API +
**Cloudflare D1** (SQLite) as the sole datastore. **Google Sheets is no longer
used** — the registry (users, companies, settings, MOTD) was migrated into D1.
The only Google product still involved is **Sign-In** (identity). Full detail in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the essentials:

- **The Worker is the trust boundary.** A static page can't enforce auth, so all
  authentication and per-business/role authorization happen in `worker/`. Never
  move an access decision into the browser; the frontend renders only what the
  API returns.
- **Identity:** Google Sign-In → the browser gets an ID token → the Worker
  verifies it (`worker/src/verify.js`, RS256 against Google's JWKS) → maps the
  email to a row in the D1 `users` table (`worker/src/users.js`). The **first
  admin** is bootstrapped from the `ADMIN_EMAILS` worker var (auto-provisioned on
  first sign-in) — no hand-seeded row.
- **Roles:** `admin` (Core Dashboard + Market Analysis + all), `owner` (their
  business + manage employees), `employee` (their business only).
- **Data:** everything is in D1 via `worker/src/db.js`. There is no
  service-account key. Registry modules (`users.js`, `registry.js`, `cert.js`,
  `settings.js`, `business-settings.js`, `motd.js`) are D1-backed.
- **Router:** `worker/src/index.js` is a thin shell (CORS, size cap, rate limit,
  `/health`, dispatch); handlers live in `worker/src/routes/*.js` and share
  `http.js` (dispatch/body/JSON) + `guards.js` (auth).
- **Backups:** admin file export/import (`export.js`) + an optional daily R2
  snapshot (`backup-cron.js`) + D1 Time Travel. No Sheets mirror.

Build phases and their status live in `docs/ARCHITECTURE.md`.

## Commands

```bash
npm install && npm run dev     # frontend (Vite) at localhost:5173
npm run build                  # production build → dist/
cd worker && npm install && npx wrangler dev    # API locally (localhost:8787)
cd worker && npx wrangler deploy                # deploy the API
```

No test suite exists yet. Setup (Google Cloud, Cloudflare, Pages) is in
`docs/SETUP.md`.

## Conventions

- Config that is safe to publish (OAuth client ID, API URL, admin emails) lives
  in `app-config.json` (frontend) and `worker/wrangler.toml` `[vars]`. There is
  no application secret anymore; the only GitHub Actions secrets are the
  Cloudflare deploy token/account ID.
- Domain helpers ported from the `.gs` files (e.g. `parseSaleItems`, the palette
  system) are plain JS — port them faithfully; the original comments explain many
  hard-won edge cases worth preserving.

## Git workflow

- `main` is the default branch and is protected: never push directly to it without explicit user permission.
- Do the work on a feature branch and push there; open a pull request only when the user asks.
