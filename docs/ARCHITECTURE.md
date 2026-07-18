# EEC Sales System — Architecture

A port of the original Google Apps Script + Sheets system to a static web app,
keeping the same wheel-and-spoke data model and Google Sheets as the backend.

## Tiers

```
┌─ GitHub Pages (static frontend) ─────────────┐
│  Vite build · Google Sign-In · role-scoped   │
│  views (Register · Ledger · Core · Market)   │
└───────────────┬──────────────────────────────┘
                │  HTTPS + Google ID token (Bearer)
┌───────────────▼──────────────────────────────┐   THE TRUST BOUNDARY
│  Cloudflare Worker API                        │   verifies token → resolves
│  verify.js · users.js · sheets.js · index.js  │   UID/role/business → returns
│  holds the service-account key (SA_KEY)       │   only permitted data
└───────────────┬──────────────────────────────┘
                │  Sheets API v4 (as the service account)
┌───────────────▼──────────────────────────────┐   unchanged data model
│  Google Sheets: EEC Core + shop ledgers       │   Core = the wheel/hub
└───────────────┬──────────────────────────────┘
                │  same service account
┌───────────────▼──────────────────────────────┐
│  GitHub Actions cron — Core maintenance crawl │   replaces the 5-min trigger
└───────────────────────────────────────────────┘
```

## Why the trust boundary is a real server

A static page runs entirely in the visitor's browser, so any check it makes can
be bypassed. Per-business isolation and admin-only areas are therefore enforced
in the Worker, which is the only tier that (a) holds Google credentials and
(b) the user cannot edit. The browser is told only what it's allowed to see.

## Identity & roles

- **Identity:** Google Sign-In → signed ID token → the Worker verifies it
  (RS256 against Google's JWKS, checks issuer/audience/expiry) → maps the
  verified email to a row in the Core `Users` sheet.
- **Roles:** `admin` (Core Dashboard + Market Analysis + everything),
  `owner` (their business: ledger, stats, manage employees),
  `employee` (their business's register/content only).
- Authorization is applied per request in the Worker, never in the frontend.

## Mapping from the Apps Script system

| Apps Script | Web app |
|---|---|
| `.gs` logic run as owner | JS split between the browser (UI) and the Worker (data + auth) |
| HTML sidebars | frontend views under `src/views/` |
| `SpreadsheetApp` | `worker/src/sheets.js` (Sheets API v4) |
| library + shim + identifiers | one shared codebase — the split is gone |
| `onOpen` / timed triggers | sync-on-load + manual + GitHub Actions cron |
| implicit owner auth | Google Sign-In + Worker verification |
| `Certified Users` registry | unchanged; new `Users` sheet adds people/roles |

## Repo layout

```
index.html, app-config.json     frontend entry + public runtime config
src/lib/     config, auth (GIS), api (fetch client), + domain modules (later)
src/views/   role-scoped views (added per phase)
src/styles/  the parchment theme
worker/      the Cloudflare Worker API (the trust boundary)
scripts/     Node scripts for the GitHub Actions cron (later)
.github/workflows/  Pages deploy + Core background sync
docs/        SETUP.md, ARCHITECTURE.md
```

## Build phases

1. **Foundation** (this phase) — scaffold, auth round-trip, Worker skeleton, deploy pipeline, setup guide.
2. Registration + `Users` registry writes + role/business scoping.
3. Register (POS) — sales, cert gate, order lookup/void.
4. Ledger/Shop settings — employees, discounts, style, Coffers, intake.
5. Core Dashboard (admin) — registry, connect-shop, sync/flash pipeline, MOTD.
6. Market Analysis (admin) — overviews, performance, anomaly alerts.
7. GitHub Actions background sync (port the Core crawl).
