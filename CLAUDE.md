# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EEC-Sales-System is a "Wheel-And-Spoke" style sales system for the Mereth Skyrim RP server, run by the in-fiction East Empire Trading Company and managed by SmileDaemon on Discord. The domain is roleplay commerce: goods flowing between a central hub ("wheel") and outlying nodes ("spokes").

## Origin: the Apps Script system

The system began as Google Apps Script bound to Google Sheets — a Core ("wheel")
spreadsheet plus per-shop ledger/storefront/market spreadsheets ("spokes"), with
logic in `.gs` files and UIs as HTML sidebars. Those original files are NOT in
this repo; they were provided as reference for the port. Their behavior (sync
pipeline, certification, MOTD, pairing, anomaly detection, the `_config` palette
system) is the specification being reimplemented here.

## Current architecture (the port, in progress)

A static web frontend on **GitHub Pages** + a **Cloudflare Worker** API + the
**same Google Sheets** as the data backend. Full detail in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the essentials:

- **The Worker is the trust boundary.** A static page can't enforce auth, so all
  authentication and per-business/role authorization happen in `worker/` — the
  only tier holding Google credentials. Never move an access decision into the
  browser; the frontend renders only what the API returns.
- **Identity:** Google Sign-In → the browser gets an ID token → the Worker
  verifies it (`worker/src/verify.js`, RS256 against Google's JWKS) → maps the
  email to a row in the Core `Users` sheet (`worker/src/users.js`).
- **Roles:** `admin` (Core Dashboard + Market Analysis + all), `owner` (their
  business + manage employees), `employee` (their business only).
- **Sheets access** is service-account only, via `worker/src/sheets.js`. The key
  is the `SA_KEY` Worker secret — never committed. `service-account.example.json`
  shows the shape only.
- **Background sync** (the old 5-minute trigger) → a GitHub Actions cron
  (`.github/workflows/core-sync.yml`) using the same service account.

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

- Config that is safe to publish (OAuth client ID, API URL, Core sheet ID) lives
  in `app-config.json` (frontend) and `worker/wrangler.toml` `[vars]`. The ONLY
  secret is `SA_KEY`; it lives in the Worker secret store and GitHub Actions
  secrets, never in the repo. `.gitignore` blocks real key files.
- Domain helpers ported from the `.gs` files (e.g. `parseSaleItems`, header
  validation, the palette system) are plain JS — port them faithfully; the
  original comments explain many hard-won edge cases worth preserving.

## Git workflow

- `main` is the default branch and is protected: never push directly to it without explicit user permission.
- Do the work on a feature branch and push there; open a pull request only when the user asks.
