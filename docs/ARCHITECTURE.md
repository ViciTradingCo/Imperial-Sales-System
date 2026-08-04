# Vici Trading Co. — Architecture

A static web app that keeps the original wheel-and-spoke data model, backed
entirely by **Cloudflare D1**. It began as a Google Apps Script + Sheets system;
the port moved every datastore off Sheets into D1. The only Google product still
used is **Sign-In** (identity).

## Tiers

```
┌─ GitHub Pages (static frontend) ─────────────┐
│  Vite build · Google Sign-In · role-scoped   │
│  views (Register · Ledger · Admin · Market)  │
│  offline-tolerant register (localStorage)    │
└───────────────┬──────────────────────────────┘
                │  HTTPS + 24h session token (Bearer)
┌───────────────▼──────────────────────────────┐   THE TRUST BOUNDARY
│  Cloudflare Worker API                        │   verifies token → resolves
│  index.js (shell) · http.js · guards.js       │   UID/role/business → returns
│  routes/*.js · verify.js · users.js …         │   only permitted data
└───────────────┬──────────────────────────────┘
                │  D1 client (SQL)
┌───────────────▼──────────────────────────────┐   sole source of truth
│  Cloudflare D1 (SQLite): registry + ledger    │   users, companies, settings,
│  inventory · sales · intake · transfers · …   │   MOTD, inventory, sales, …
└───────────────┬──────────────────────────────┘
                │  daily cron (optional)
┌───────────────▼──────────────────────────────┐
│  R2 bucket — off-site gzip snapshots          │   + D1 Time Travel (30 days)
└───────────────────────────────────────────────┘
```

## Why the trust boundary is a real server

A static page runs entirely in the visitor's browser, so any check it makes can
be bypassed. Per-business isolation and admin-only areas are therefore enforced
in the Worker, the only tier that (a) holds the D1 binding and (b) the user
cannot edit. The browser is told only what it's allowed to see.

## Identity & roles

- **Identity:** Google Sign-In → signed ID token → the Worker verifies it
  (RS256 against Google's JWKS, checks issuer/audience/expiry) → maps the
  verified email to a row in the D1 `users` table.
- **Sessions:** a Google ID token lasts an hour and cannot be extended, which is
  shorter than a shift at the register. So `POST /auth/session` trades a verified
  Google token for a **24-hour session token** (`sessions.js`), and every later
  request carries that instead. Only the SHA-256 of the token is stored, so the
  table cannot be replayed; the row holds an email and nothing else, because
  role, business, realm and status are still re-read from the `users` row on
  every request. Sign-out deletes the row, so the token dies everywhere at once.
  Not a cookie: the site and the API are on different hosts, so a session cookie
  would be third-party (`SameSite=None`) — blocked in Safari, restricted in
  Chrome. `localStorage` + `Authorization` behaves the same everywhere.
- **First admin:** bootstrapped from the `ADMIN_EMAILS` worker var — a listed
  email is treated as admin and auto-provisioned a row on first sign-in. No
  hand-seeded database row.
- **Roles:** `admin` (Admin Panel + Market Analysis + everything),
  `owner` (their business: ledger, stats, manage employees),
  `employee` (their business's register/content only).
- Authorization is applied per request in the Worker, never in the frontend.

## Worker layout

- `index.js` — thin shell: CORS, request-size cap, rate limit, `/health`, and
  dispatch to the route tables. Also the `scheduled()` cron entry.
- `http.js` — CORS headers, JSON responses, one-place body parsing, error→status
  mapping, and the route dispatcher.
- `guards.js` — the authorization guards (`requireUser/Registered/Admin/…`).
- `routes/auth.js`, `routes/admin.js`, `routes/business.js` — the handlers,
  grouped by area, each exporting a `{ method, path, handler }[]`.
- Data modules: `db.js` (schema + D1 access), `users.js`, `registry.js`,
  `cert.js`, `settings.js`, `business-settings.js`, `motd.js`, `holds.js`,
  `item-index.js`, `inventory.js`, `sales.js`, `intake.js`, `transfers.js`,
  `coffers.js`, `discounts.js`, `shop-style.js`, `market.js`, `audit.js`.
- Cross-cutting: `cache.js` (two-tier identity cache), `ratelimit.js`,
  `export.js` (backup/restore + owner CSV), `backup-cron.js` (R2), `status.js`
  (System Status + error observability).

## Data & backups

- **D1 is the sole source of truth.** `db.js` ensures the schema in-code
  (idempotent `CREATE TABLE IF NOT EXISTS` + guarded `ALTER` migrations), so a
  fresh database just works.
- **Backups:** (1) admin file export/import with a restore preview/diff;
  (2) an optional daily R2 snapshot (`backup-cron.js`, keeps the last N);
  (3) D1 Time Travel (30-day point-in-time restore, built in). See SETUP.md.

## Repo layout

```
index.html, app-config.json     frontend entry + public runtime config
src/lib/     config, auth (GIS), api (fetch client), offline queue, + domain modules
src/views/   role-scoped views
src/styles/  the parchment theme
worker/      the Cloudflare Worker API (the trust boundary)
.github/workflows/  Pages deploy + Worker deploy
docs/        SETUP.md, ARCHITECTURE.md
```
