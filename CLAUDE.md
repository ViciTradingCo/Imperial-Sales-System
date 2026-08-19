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
  business + manage employees), `manager` (an employee the owner appointed to run
  the shop — see Roles below), `employee` (their business only).
- **Data:** everything is in D1 via `worker/src/db.js`. There is no
  service-account key. Registry modules (`users.js`, `registry.js`, `cert.js`,
  `settings.js`, `business-settings.js`, `motd.js`) are D1-backed.
- **Router:** `worker/src/index.js` is a thin shell (CORS, size cap, rate limit,
  `/health`, dispatch); handlers live in `worker/src/routes/*.js` (`auth`,
  `admin`, `business`, `court`) and share `http.js` (dispatch/body/JSON) +
  `guards.js` (auth). A new route module exports its own `routes` array and is
  spread into `ROUTES` — and must also be added to `routes.test.js` and
  `api-client.test.js`, or the client/route drift check reports its paths as
  unserved.
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

Tests are Vitest against a `node:sqlite` D1 shim (`worker/test/d1shim.js`):
`cd worker && npx vitest run`. `npm run audit` is the bloat audit — unused
exports, dead CSS, stale translations, client/route drift. Setup (Google Cloud,
Cloudflare, Pages) is in `docs/SETUP.md`.

## The look: a ledger you can type into

The app IS an account book, and it reads as one. `src/styles/theme.css` holds
the whole of it; its header comment is the brief.

THREE FACES, and which one a thing is set in says what KIND of thing it is:

- `--font-hand` (Caveat, bundled) — prose, labels, buttons, nav. Written.
- `--font-book` (IM Fell English, bundled) — headings and the masthead. Printed.
- `--font-data` (the reader's own system face, tabular figures) — every input,
  every table, every sum. Upright means you are working with it; written means
  you are reading it. Never set a field in the hand: a quantity is not
  calligraphy, and columns of money have to line up.

Fonts are SELF-HOSTED in `src/styles/fonts/` (licences bundled beside them) —
the PWA's offline shell needs its own typefaces, and a font CDN is a third
party watching every page load. Put them under `src/styles/`, never `public/`:
Vite fingerprints and rewrites what it processes, and `base` is `./`.

SURFACES are `[data-theme]` blocks — `ledger` (default), `scroll`, `tome` —
each a palette AND a page texture, both in the stylesheet. `theme.js` sets the
attribute and nothing else, so a surface paints before any JS runs and cannot
half-exist. `index.html` names the default on `<html>` for the same reason.
Textures are CSS gradients, never images.

`--rule` is the page's ruled line and a surface may set it `transparent` (the
scroll does). A control that needs a visible hairline uses `--edge`.

TEXT SIZE is one number, `--type-scale`, set from Appearance the same way a
surface is (`data-text` on `<html>`, steps in the stylesheet). `--hand-size`,
`--data-size` and `--rule-step` are all multiplied by it, so bigger writing
still lands on the rules. A new fixed `font-size` in px should be
`calc(Npx * var(--type-scale))` unless it is genuinely decorative.

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

## The register is where stock CHANGES

Four sides, one `renderPos(container, { me, mode })`, one route each: `/pos`
(Selling), `/pos/buy` (Buying — `intake-form.js`), `/pos/harvest` and
`/pos/craft` (both `produce.js`). Routes rather than a tab that swaps the body,
so Back works and a half-built cart survives a look at the deliveries.

The line is WHAT CHANGES STOCK, not what moves coin. Harvest and Craft were on
Inventory under the older "the register is for money" rule, which put the four
things a shop does to its stock in two different places. Inventory is now what
the shop HOLDS — a list you consult, whose only writes CORRECT it (a miscount, a
price, a listing that should not exist). Anything that adds or removes stock is
a register side.

What is still true is why Harvest and Craft are not intake: nobody was BOUGHT
FROM, so no vendor, no region, and no effect on what items are worth. Buying is
owner/admin; Harvest and Craft are open to any ACTIVE member, because the person
at the bench is usually not the owner.

A harvest MAY cost the shop money. An owner sets `harvest_pay` on an inventory
row — what the shop pays one of its own people per unit — and an employee
claiming it gets a `harvest-pay` coffer entry. That is a WAGE, not a purchase:
the coffer moves, the market figures do not. `market.js` excludes harvest rows
by VENDOR (`NOT_HARVEST`), not by their price being zero, because the price is
no longer zero — a rate is set below what the goods fetch on purpose, and
averaging it in would call a shop's labour cost the item's worth. The Worker
re-reads the rate from the item on every claim and refuses one on an item with
no rate, so the client can never name a price.

Buying is ONE door (`Intake Ingredients/Stock`), not one per kind of purchase.
There were briefly two — a single delivery and an ingredient basket — and
nothing on the tiles told you which one your purchase was; the basket is in
`archive/ingredient-basket/`. A new kind of purchase is a step or a field in
intake, not a second tile.

A delivery is a TRIP, not an item: `recordIntakeLines` takes a list, the
supplier and region are per delivery, and cost/sale price/ingredient are per
line. Every line is validated before any is written and all of them go in one
`db.batch`, so a delivery lands whole or not at all — never loop a client over
a one-item endpoint to fake it, which is the flaw the basket had.

The intake form is THE PAGE, as three cards (`buildIntake`), not a modal and not
behind a tile. It is the standing example of the stacked-card exception above: a
form you fill in every day, next to the deliveries list you are checking it
against. The form stays put after a successful record and RESETS — including a
fresh idempotency key, or the next delivery looks like a retry of the last one
and is silently discarded.

## Inventory is TWO tables: Stock and Ingredients

Split on the per-listing `ingredient` flag, and they do not want the same
columns: stock shows what you CHARGE, an ingredient shows what it has COST
(`avgCost`, averaged over the shop's own deliveries), because an ingredient is
never sold. One table would carry both columns and leave one blank on every row.

The flag is per LISTING, not per item — one shop's ingredient is another's
stock-in-trade — which is why it could never live on the shared item index.

## Forms teach themselves (`guide`)

`guidePanel(lines, open)` in `src/lib/guide.js` is a collapsible "How this
works" that sits with a form and explains it. Not a tour with its own Next
button: a tour makes you read everything before you may touch anything, and it
is gone exactly when you need it.

`guideUnseen(key)` decides whether it starts open and `markGuideSeen(key)` is
called on a successful SUBMIT — finishing is what proves the help is no longer
needed. Opening the form and abandoning it does not count; that is often the
person who needed it most.

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

`Traveling` (`TRAVELING` / `isTraveling`, mirrored in `worker/src/regions.js` and
`src/lib/format.js`) is a company with no fixed region — a caravan. It is an
answer for a COMPANY's region and never for a SALE's: a travelling shop still
rings every sale up in the region it is standing in, so region reports stay
true. `writeRegions` refuses to let a realm name a region this, or "based
nowhere" and "based in Traveling" become indistinguishable. What a travelling
shop does not get is anything keyed on a home: no register default, no weekly
Market Info, no home Court notice, and it cannot BE a Court. Admin-set only —
it is not offered at sign-up, because a shop that could declare itself
region-less could put itself beyond every Court's roster.

## The item index is one table per type

The Master Item Index is divided into TABLES BY TYPE (Weapons, Potions, …). Those
are rows in `item_type` plus a `category` column on `master_item` — not one D1
table per type, which could not be admin-editable per realm and would turn the
register's picker into a growing UNION.

`Unsorted` is the DEFAULT table: where pre-split items live, where the
whole-index import puts unflagged rows, and where a removed table's items go. It
always exists and cannot be renamed or deleted. Removing a table never removes
items.

That division is STORAGE and routing, not layout. The admin view is ONE table on
the page listing every item, with the type as a column and a filter; it was a
tile per type, each opening its own list in a focal menu, which made reading the
index cost a click per type and made comparing two differently-filed items
impossible. Every action (add, import, empty) follows the filter and says so in
its label. Manage tables stays a focal menu — it is a settings screen, not the
index.

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

## Notices are rows, not settings

Global MOTDs, per-business MOTDs and a shop's own board are all `motd_list`
rows; an EMPTY `business` means everyone. One table so scheduling, editing and
deleting are the same code for all three — the global notice was a lone
`sys_flags` string for months and never gained a schedule or an edit because it
was not shaped like the others. Each endpoint re-checks the KIND of row it is
touching (`business = ''` or not), since an id alone reaches both.

The retired `motd_global:<realm>` flag is migrated to a row on first read,
guarded on there being no global rows yet, so it runs once per realm and cannot
resurrect a notice an admin deleted.

## Store data, present labels

Never write a realm's wording into a stored value. Sale lines are JSON numbers,
not "Iron Sword x2 @ 25gp"; the denomination and the region wording are applied
when something is DISPLAYED (`src/lib/format.js` — `money`, `regionLabel`,
`regionsOn`). A realm renaming its money or its regions must re-render its
history, never invalidate it.

Presentation settings are set once at sign-in from `/auth/me`'s `prefs`, not
fetched per screen. Threading them through every render function is how the
register ended up the only place that honoured them.

## A bundle is ONE LINE, priced by the Worker

`bundles` holds a name, a price, and `parts` (JSON `{item, qty}`). At checkout a
cart line is EITHER `{item, qty, price}` or `{bundle, qty}` — the client names a
bundle and nothing else, because its price and contents are the shop's to state
(the same rule as the harvest rate and the commission percentage).

Expanding a bundle into its parts at the till was the alternative and is wrong
twice: it would invent a per-item price for each part, which is a lie the market
analysis would believe, or leave the total disagreeing with its lines. So the
sale records the BUNDLE — which also means `canon()` never matches it, and a
bundle price is correctly no evidence of what any item is worth.

`encodeSaleItems` carries `parts` on a bundle line ONLY, and `voidSale` puts
those back rather than the line's own name — otherwise a voided bundle would try
to restock an item called "Tavern Feast" and the ales inside it would stay gone.
`qty_total` counts the UNITS that moved, not the number of bundles.

A Court's price controls apply to a bundle in AGGREGATE (the sum of its parts'
floors and caps), since it has no per-item price to check and selling ten capped
items for one price must not be a way around the cap.

## A discount and an upcharge are ONE signed percent

`discounts.percent` is positive to take money off, negative to put it on, and
checkout applies both with the same sum — `total × (100 − percent) ÷ 100`. A
second kind of row would mean a second path through checkout, the sales log, the
offline queue and the levy, and an upcharge some one of them forgot about would
be an upcharge that silently did not happen.

The SIGN IS STORAGE, never wording: `adjustmentLabel` turns −25 into
"(25% surcharge)", and no screen asks anyone to type a minus to charge more.
The wire field stays `discountPercent` so a sale queued offline before upcharges
existed still replays. A discount cannot exceed 100% (you cannot take off more
than the price); an upcharge has no natural ceiling so it gets a stated one,
`MAX_UPCHARGE`.

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

## A bulk act is ONE line in the log

A delivery, a haul, a crate is a single act — coin left the coffer once, one
trip happened — so it gets ONE entry wherever a log holds one line per act: the
coffer, the audit detail, a pending row. Never one per item. A coffer showing
six lines for one trip to the smith is a coffer you have to reassemble in your
head before you can check it against anything.

It is also the only way to obey the rule above: the total is settled once, so
three lines at 10.5 take 31 rather than three tens. `lineSummary` in
`worker/src/lines.js` is how such an act is worded, shared so the coffer, the
audit log and the transfer lists cannot describe the same act differently.

WHICH MOVES THE WEIGHT ONTO UNDOING IT. With the debit settled once, a line's
refund is not its own price floored — it is the difference that line makes to
what the trip still costs, measured against the rows STILL on the books rather
than against the original debit (measured against the debit, the last line
removed would hand back the whole trip). Difference by difference, the refunds
sum to exactly what went out.

`coffer_entries.ref` carries the act's idempotency stem, and is what says a trip
was settled once. A row without one predates this and took a debit per line, so
its lines are refunded by the old rule — which is what stops an old delivery
minting a coin on its way out.

## Multi-realm

The system can host several independent servers ("realms") from one deployment,
with nothing shared between them — see `worker/src/realm.js` for the isolation
rule. It is DORMANT until a second realm exists: with one realm, the nav, the
Admin Panel, and sign-up say nothing about realms and the app looks exactly as it
did before the feature. The way in is Network Settings → Realms.

`/auth/me` returns `realmCount`, `activeRealm`, and `systemAdmin`; the UI gates
on those. Realm selection happens in exactly ONE place (the Admin Panel) and
filters the session from then on.

## One person, several shops

A MEMBERSHIP is a `users` row — its own uid, its own role at that shop, its own
standing. An email may have several, and exactly one carries `current`, which is
the one `findUserByEmail` resolves to. That is what let this be added to an app
where forty routes read `caller.business` without touching any of them: the
caller is still one person at one shop.

The roles do not leak. Owning one shop grants nothing at another — you can own a
forge and be a pending employee at a tavern, and neither fact says anything
about the other.

Switching (`switchMembership`) is checked against the EMAIL, never the uid
alone: the uid is the only thing a client sends, and one belonging to someone
else would be a way to put on their shop like a coat. The session is untouched —
it proves WHO you are, and who you are has not changed. The frontend RELOADS
after a switch (`reloadAsNewBusiness`) rather than re-rendering: the page you
are on may not exist for the shop you moved to.

ADDING one uses the same join code a newcomer types (`addBusiness`) — a founder
code makes a shop, a staff code joins one. Anything else would be a second set
of rules about who may create a company. Leaving one membership leaves the
others and the session alone; sessions are revoked only when the last one goes.

## Roles

- **Manager** — an employee the OWNER appointed to run the shop. Everything the
  owner does day to day; what they cannot do is change WHO HAS POWER or WHAT
  PEOPLE ARE PAID. Owner-only stays: setting pay/commission, appointing managers,
  reissuing the staff code, renaming the shop, exporting the books.
- **System Admin** — an address in the `ADMIN_EMAILS` worker var. Runs the
  deployment: creates/renames/deletes realms, moves people between them, and
  switches which realm they are viewing. Granted by config, never in-app, because
  it is the only role that crosses realm boundaries.
- **Realm Admin** — role `admin` without an `ADMIN_EMAILS` entry. A full
  administrator of their OWN realm and nothing else; `guards.realmIdOf` refuses
  to return any realm but theirs, so the confinement is structural, not cosmetic.
- **Shop Owner** / **Employee** — scoped to one business, as before.

## Permission is ONE predicate per side, never a role list per call site

`managesBusiness` / `requireManages` (worker `guards.js`) and `canManage` /
`isOwner` (frontend `lib/roles.js`) are where the line lives. Before the manager
role there were ~40 copies of `role !== 'owner' && role !== 'admin'`; adding a
role to thirty-nine of them is how the fortieth becomes a hole nobody notices.
A new capability picks one of these — it does not spell out roles again.

`requireOwner` is the short dangerous list, and it is short ON PURPOSE. If a new
route needs to be owner-only, say why in a comment where it is used.

## Pay is stamped where it is EARNED, never recomputed at payout

A finished shift keeps `time_card.rate`; a sale keeps `sales.commission`, worked
out at checkout from the seller's own `users.commission_rate` (never from the
request — the person at the register must not name their own percentage). A rate
change therefore applies to what happens NEXT. Recomputing at payout would let a
raise silently restate what an owner had already agreed to pay.

Hourly and commission are INDEPENDENT halves — either may be 0, and a
commission-only earner has no shifts at all, which is why `shopShifts` reads
them separately and merges rather than hanging commission off shift rows.
Settling a person settles both: it is one debt, and marking half would leave the
screen disagreeing with what the owner just did.

## Leaving a shop ends MEMBERSHIP, never the debt

An employee (or a manager) leaves from Profile → Leave your shop. It removes
their user row and revokes their sessions — an account belonging to no shop is a
state nothing else knows what to do with, and the way back already exists: a
staff code, the same one that let them in. `time_card` and `sales` rows carry the
BUSINESS, not a live link to the account, so the shop keeps its history and goes
on owing what it owed; `shopShifts` still lists a departed person by name and
`markPaid` still settles them.

`leaveRefusal` in `guards.js` is the one rule — used by the route that refuses
AND the screen that decides whether to offer the button, so a screen can never
offer what the server will turn down. An OWNER is refused: a shop whose owner
walked out cannot be put right from the inside, so that is an admin's job.
Someone clocked in is refused too, or the open shift outlives them.

## Archiving is not deleting

`archiveCompany` renames the shop and everything it owns to a unique key — which
frees the name and stops a remade company inheriting the old one's history — and
records `archived_from` / `archived_status` so `restoreCompany` can put it back
as itself. Nothing is destroyed either way. Restore REFUSES when the old name has
been taken rather than inventing a suffix; an admin decides what it is called.

An archived shop does not trade: `checkCertification` returns EXPIRED for it
BEFORE it looks at `perpetual`, or a perpetual archived shop goes on selling.

## Bulk edits carry ONE kind of value

The shelved inventory import (`archive/inventory-import/`) carried price, stock
and low-stock on every line, so one paste could rewrite everything a shop
charged. The stocktake that replaced it is `Name, Amount` and the Worker will not
let a line move anything but a count. Anything the paste omits is LEFT ALONE — a
partial list silently zeroing the rest is the worst thing it could do — and an
unknown name is reported, never invented.

A CSV IS A FASTER WAY TO FILL THE BOX IN, never a second way to change stock:
`src/lib/csv.js` reads a file into `Name, Amount` text and drops it in the same
textarea a person types into, so a file goes through the same planner, preview
and Apply. CSV ONLY — an .xlsx reader existed briefly and is in
`archive/xlsx-reader/`; every spreadsheet writes CSV and CSV is what the
inventory export produces, so the round trip never needed a second format. An
.xls/.xlsx file is refused with instructions rather than fed to the CSV parser,
which would read a ZIP as one garbled row.

`planStockImport` is the one planner for both preview and apply (the preview is
the apply with the last step left off), so the two cannot promise different
things.

A name the shop does not stock is ADDED — counting the shelves and finding
something nobody wrote down is what a stocktake is FOR. The price comes from the
master index, or 0 when the index has never heard of it either, in which case
the item is also filed as `pending` exactly as the register files one sold at
the till. What a paste still cannot do is change the price of a listing that
already exists.

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
