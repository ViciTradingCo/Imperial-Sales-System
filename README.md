# EEC-Sales-System

Wheel-And-Spoke style sales system for the Mereth Skyrim RP server. Run by the East Empire Trading Company, managed by SmileDaemon on Discord.

Originally a Google Apps Script + Google Sheets system, now being ported to a
static web app on **GitHub Pages** backed by the **same Google Sheets**, with a
thin **Cloudflare Worker** API as the trust boundary for authentication and
per-business access control.

## Status

**Phase 1 (Foundation)** — scaffold, Google Sign-In, the Worker API skeleton
(token verification + service-account Sheets access), and the Pages deploy
pipeline. Not yet wired to a live Core until you complete setup.

See the roadmap in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Get it running

Follow [`docs/SETUP.md`](docs/SETUP.md) — a one-time Google Cloud + Cloudflare +
GitHub Pages setup. Nothing secret is committed to the repo.

### Local development
```bash
npm install          # frontend deps
npm run dev          # Vite dev server at http://localhost:5173

cd worker
npm install
npx wrangler dev     # the API locally
```
The frontend reads `app-config.json` at runtime; point `apiBaseUrl` at your
local Worker (`http://localhost:8787`) while developing.

## Layout
- `src/` — the static frontend (Vite): `lib/` shared modules, `views/` role-scoped screens, `styles/` the parchment theme.
- `worker/` — the Cloudflare Worker API (the trust boundary in front of Sheets).
- `.github/workflows/` — Pages deploy + the scheduled Core background sync.
- `docs/` — setup and architecture.

## License
MIT — see [LICENSE](LICENSE).
