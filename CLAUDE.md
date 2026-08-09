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
  first sign-in) — no hand-seeded row. Google's token is then traded once for a
  **24-hour session token** (`worker/src/sessions.js`); everything after sign-in
  carries that. A session proves IDENTITY only — role, business, realm and status
  are re-read from the `users` row on every request, which is what makes a
  day-long credential safe.
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

## UI convention: buttons and focal menus

Any page with more than one distinct section renders those sections as a grid of
big tiles (`tileGrid` in `src/lib/tiles.js`), each opening its content in a focal
menu (`openFocalMenu`) — not as a column of stacked cards. This is the default
for new work; reach for stacked cards only when a page is a single continuous
workflow that would be broken up by hiding half of it (the register and the
inventory table are the standing examples).

When adding a section, give it a stable `key` and add that key to `TILE_KEYS` in
`src/views/admin-settings.js` so an admin can assign artwork to it.

Navigation stays in the header/side menu; tiles are for content within a page.

## The register has two sides

`/pos` is SELLING and `/pos/buy` is BUYING — one `renderPos(container, { me, mode })`
with two routes, not a tab that swaps the body, so Back works and a half-built
cart survives a look at the deliveries. The Buying side lives in
`src/views/intake-form.js` (`renderBuying`).

The split is by WHAT MOVES, not by what changes stock. Buying spends coin and
names a supplier, so it is a till operation. Producing stock — Farm/Harvest,
Craft — costs nothing and has no vendor, so it stays on Inventory, which is the
list of what the shop HAS. Adding a stock-creating feature: if coin leaves the
coffer, it belongs on Buying.

Buying is ONE door (`Intake Ingredients/Stock`), not one per kind of purchase.
There were briefly two — a single delivery and an ingredient basket — and
nothing on the tiles told you which one your purchase was; the basket is in
`archive/ingredient-basket/`. A new kind of purchase is a step or a field in
intake, not a second tile.

## Forms teach themselves (`guide`)

A step in `openStepModal` may carry a `guide` — an array of paragraphs shown in
one collapsible panel that follows you from step to step. Not a tour with its
own Next button: a tour makes you read everything before you may touch anything,
and it is gone exactly when you need it. Pass `guideKey` and the panel opens
itself for someone who has never FINISHED that wizard (opening and abandoning it
does not count — that is often the person who needed it most).

## Shelved features live in `archive/`

Code taken off the site but kept for later goes in `archive/<feature>/` with a
README that says what it was, why it was shelved, and the exact wiring to
restore — see `archive/storefront/`. The archived modules are left UNMODIFIED
(their relative imports no longer resolve, deliberately) so they stay a faithful
record. `archive/` is outside the Vite and Worker builds and outside the bloat
audit's scan. Shelving a feature means removing every live mention of it; the
patch-notes history stays as written, because it is a record of what shipped.

## Standing rule: features are realm-wide, data is realm-local

Any new capability applies to EVERY realm — build it once, and every realm gets
it. What must never cross is DATA: one realm's rows, settings, codes, reports,
and searches are invisible to another. A change that would let one realm read or
alter another's data needs to be asked for explicitly (the only standing
exceptions are the System Admin's realm switch and the transfer tools, both of
which say so in their own comments).

In practice: put new settings in `master_settings` (numeric, per realm) or
`realm-prefs.js` (everything else, per realm) — never in a global `sys_flags`
key. If a flag genuinely has to live in `sys_flags`, put the realm in the KEY
(`tile_images:<realm>`, `motd_global:<realm>`). New tables go in `REALM_TABLES`
with a `realm_id` column and per-realm uniqueness, and every query filters on it.

## Naming: regions, not holds

The user-facing concept is a REGION, named per realm (Region / Hold / Province /
Sector — `realm-prefs.js`). The storage is still `hold_index` and the `hold`
column on sales, from when these were Skyrim holds; renaming the columns would
be a data migration for a cosmetic gain, so the storage keeps the old name and
everything above it says region. Module, route, and function names follow the
UI: `regions.js`, `/regions`, `readRegions`, `/market/region`.

## The item index is one table per type

The Master Item Index is divided into TABLES BY TYPE (Weapons, Potions, …). Those
are rows in `item_type` plus a `category` column on `master_item` — not one D1
table per type, which could not be admin-editable per realm and would turn the
register's picker into a growing UNION.

`Unsorted` is the DEFAULT table: where pre-split items live, where the
whole-index import puts unflagged rows, and where a removed table's items go. It
always exists and cannot be renamed or deleted. Removing a table never removes
items.

Each table also carries `flags` — words an import line may use instead of the
table's name. A table's own name beats any flag, and creating a table strips that
word from other tables' flags so no stored flag can ever be dead. Import
destinations come from one shared planner (`destinationPlanner`) so the preview
and the apply cannot disagree.

## Courts govern a region

A company an admin flags as **Court** is its region's government. Everything it
can do lives behind one nav entry, **Court Tools** (`/court`), so a Court's two
jobs — running a shop, governing a region — stay separable.

`oversight.js` is a Court LOOKING (companies, rosters, books — shared with the
admin Company List). `court.js` is a Court GOVERNING: the levy, licences and
sanctions, price controls, the notice, the treasury, regional stock.

Court data is keyed by REGION, never by the Court company, so a rename or the
flag moving elsewhere leaves the region's rules and books intact. `requireCourt`
resolves the caller's own region and every read and write is scoped to it.

THE MONEY NEVER MOVES ON ITS OWN. A levy records what a shop OWES; a Court marks
it paid when it actually is. A levy of 0 is the feature DISABLED — checkout skips
it entirely rather than working out 0% of every sale, and the UI says "Disabled".

## Store data, present labels

Never write a realm's wording into a stored value. Sale lines are JSON numbers,
not "Iron Sword x2 @ 25gp"; the denomination and the region wording are applied
when something is DISPLAYED (`src/lib/format.js` — `money`, `regionLabel`,
`regionsOn`). A realm renaming its money or its regions must re-render its
history, never invalidate it.

Presentation settings are set once at sign-in from `/auth/me`'s `prefs`, not
fetched per screen. Threading them through every render function is how the
register ended up the only place that honoured them.

## Money is whole coins, rounded down

Fractional input is ACCEPTED — a price may be typed as 22.5 — but every amount
that gets stored, moved, owed or shown is a whole number with the fraction
DROPPED, never rounded up. `coin()` in `worker/src/money.js` is the one rule;
`money()` in `src/lib/format.js` applies the same arithmetic so the figure on
screen is the figure in the ledger, and a test asserts the two agree.

Round ONCE, at the total. Rounding every line compounds the loss across a cart
(three lines at 10.5 must take 31, not 30). The intermediate arithmetic stays
exact; only the settled figure is a coin.

Settle the float tail BEFORE flooring, at six places. Money summed in JS drifts,
so a day's takings arrive as 1239.9999999999998 and a bare floor would report
1239 — but settling at 2dp would round a genuine 12.999 UP to 13, which is the
one thing this must never do.

## Multi-realm

The system can host several independent servers ("realms") from one deployment,
with nothing shared between them — see `worker/src/realm.js` for the isolation
rule. It is DORMANT until a second realm exists: with one realm, the nav, the
Admin Panel, and sign-up say nothing about realms and the app looks exactly as it
did before the feature. The way in is Network Settings → Realms.

`/auth/me` returns `realmCount`, `activeRealm`, and `systemAdmin`; the UI gates
on those. Realm selection happens in exactly ONE place (the Admin Panel) and
filters the session from then on.

## Roles

- **System Admin** — an address in the `ADMIN_EMAILS` worker var. Runs the
  deployment: creates/renames/deletes realms, moves people between them, and
  switches which realm they are viewing. Granted by config, never in-app, because
  it is the only role that crosses realm boundaries.
- **Realm Admin** — role `admin` without an `ADMIN_EMAILS` entry. A full
  administrator of their OWN realm and nothing else; `guards.realmIdOf` refuses
  to return any realm but theirs, so the confinement is structural, not cosmetic.
- **Shop Owner** / **Employee** — scoped to one business, as before.

## Join codes (registration)

Sign-up never lists realms or shops — a new user types a **Business Code** and
gets exactly what it admits them to:

- a realm's **founder code** (`RLM-…`) → Business Creation: they name their own
  shop and become its owner;
- a shop's **staff code** (`SHOP-…`) → they join that shop as a pending employee.

Codes are globally unique (a code arrives with no other context), case- and
space-insensitive, and use an alphabet without I/O/0/1 since they get read aloud.
Either kind can be reissued, which kills the old one immediately — that is the
fix for a leaked code. `resolveJoinCode` in `worker/src/realm.js` is the only
resolver; a bad code must never reveal whether some other code would have
worked.

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
