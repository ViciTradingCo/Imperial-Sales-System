# The Game Bridge — architecture, not yet built

**STATUS: DESIGN ONLY. Nothing in this document is implemented.** No table, no
route, no module and no screen described here exists in the repo. It is written
now so that the day API access is granted the work is assembly rather than
design, and so nobody has to re-derive the awkward parts under time pressure.

The bridge reads a live game world and turns part of it into ledger data: the
**parcels** (buildings) a server hosts, the **containers** inside them, what is
in those containers, and the **item definitions** behind it all. A shop owner
points the app at the chests that ARE their shop, and their inventory and coffer
stop being something they have to type in twice.

---

## 1. What it is, and what it must never become

**READ-ONLY, in this direction only: game → ledger.** The game is the source of
truth for *what is in a box*. The ledger stays the source of truth for what
things cost, what was sold, who is owed what, and what the shop is worth.

Writing back — "ring up a sale and the ale disappears from the chest" — is the
obvious next request and is deliberately out of scope. It is a different and far
larger trust problem: a bug in a read shows the wrong number on a screen, a bug
in a write destroys a player's property inside the game. If it is ever built it
gets its own design and its own permission conversation.

Three more standing rules, each of which the ledger already lives by and which
the bridge must not be the exception to:

- **A sync never invents money.** Stock arriving because a chest was counted is
  a *correction*, not a purchase. Writing an intake row for it would push
  fabricated spend through the coffer and put an invented purchase price into
  Market Analysis, which is exactly why `setStock` exists and why the stocktake
  refuses to touch prices.
- **A sync never sets a price.** The game has no idea what a shop charges. A
  listing created by a sync takes its price from the master index's base value,
  or 0 and `pending`, exactly as a stocktake's unknown line does.
- **A sync writes one line in the log, not one per item.** A sync run is one
  act. See `worker/src/lines.js` and the "A bulk act is ONE line in the log"
  rule in CLAUDE.md.

---

## 2. Where it sits

```
  the game server
        │  HTTPS, key in a header
        ▼
  Cloudflare Worker  ── the only thing that ever holds the key ──┐
        │                                                        │
        ├── D1: game_parcel, game_container, master_item.game_id  │
        │                                                        │
        ▼                                                        │
  GitHub Pages frontend  ◄──────────────────────────────────────┘
        (never talks to the game directly)
```

**The browser must never call the game API.** Two independent reasons, either
of which is sufficient:

1. A key shipped to a static page is a published key. `app-config.json` is
   deliberately the *safe-to-publish* config and has no secrets in it; there is
   no application secret in this app today and the bridge must not introduce the
   first one into the browser.
2. A game server will not CORS-allow `github.io`, and should not be asked to.

So the Worker fetches, and the frontend only ever sees what the Worker chose to
return — the same shape as every other feature here.

---

## 3. Configuration, per realm

One deployment can host several realms, and each realm is a *different game
server*. The bridge is therefore per realm, like regions, denomination and
certification.

- **Base URL, enabled flag, schedule, caps:** `sys_flags` under a realm-keyed
  name — `game_bridge:<realm>` — read/written by a `game-settings.js` in the
  shape of `realm-prefs.js`. Not `realm-prefs` itself: those are sent to every
  signed-in client inside `/auth/me`, and a base URL is operator configuration,
  not presentation.
- **The credential:** a Worker **secret**, never a `[vars]` entry (`wrangler.toml`
  is in the repo). One secret holding a JSON map keeps rotation to a single
  command and avoids a per-realm deploy:

  ```
  wrangler secret put GAME_BRIDGE_KEYS
  {"default":"…","rlm-2":"…"}
  ```

  The Worker looks up **only the caller's own realm's** key. A Realm Admin can
  neither read a key nor reach another realm's server; `guards.realmIdOf`
  already refuses to return any realm but theirs, so the confinement is
  structural rather than a check somebody has to remember.

---

## 4. The adapter

Everything above the network sits behind one interface, so the rest of the
feature can be built and tested before access exists — and so a second server
(a different mod, a different game) is a new file rather than a rewrite.

```js
// worker/src/game/bridge.js
/**
 * @typedef {Object} GameParcel
 * @property {string} id        opaque, stable, the game's own identifier
 * @property {string} name      as the game calls it
 * @property {string} [owner]   character/account the game says holds it, if it says
 * @property {string} [region]  where it stands, if the game knows
 *
 * @typedef {Object} GameContainer
 * @property {string} id
 * @property {string} parcelId
 * @property {string} name      "Barrel", "Strongbox", "Shelf (west wall)"
 *
 * @typedef {Object} GameStack
 * @property {string} itemId    the item DEFINITION's id, not the instance's
 * @property {string} name      the in-game display name
 * @property {number} count
 * @property {number} [value]   the game's own gold value per unit
 *
 * @typedef {Object} GameItemDef
 * @property {string} id
 * @property {string} name
 * @property {number} [value]
 * @property {string} [category] the game's own classification, if any
 */

/** Every adapter implements exactly this. */
export const GameBridge = {
  listParcels: async (ctx) => /** @type {GameParcel[]} */ ([]),
  listContainers: async (ctx, parcelId) => /** @type {GameContainer[]} */ ([]),
  readContainer: async (ctx, containerId) => /** @type {GameStack[]} */ ([]),
  listItems: async (ctx, ids) => /** @type {GameItemDef[]} */ ([]),
  ping: async (ctx) => ({ ok: true, version: '' }),
};
```

- `worker/src/game/http-bridge.js` — the real one: auth header, timeout, one
  retry on a 5xx, response-size cap, and **hard caps** on how much it will
  accept (see §9).
- `worker/src/game/mock-bridge.js` — fixtures. Every test above this line runs
  against it, so the planner, the reconciler and the item importer are finished
  and proven before the real endpoint is ever called. This is the single most
  useful thing that can be built *before* permission arrives.

`ctx` carries `{ baseUrl, key, realmId }`, resolved by the Worker from the
caller's realm. No module above the bridge ever sees the key.

---

## 5. Data model

Two new tables and one new column. Both tables carry `realm_id` and go in
`REALM_TABLES`; both carry `business` and go in `BUSINESS_TABLES`, so a company
rename or a realm transfer walks them like everything else.

```sql
-- A building in the game, and the company an admin has bound it to.
CREATE TABLE IF NOT EXISTS game_parcel (
  realm_id   TEXT NOT NULL DEFAULT 'default',
  parcel_id  TEXT NOT NULL,               -- the game's own id, opaque to us
  name       TEXT NOT NULL DEFAULT '',    -- as the game calls it, for display
  business   TEXT NOT NULL DEFAULT '',    -- '' = seen but not bound to anyone
  last_seen  TEXT,
  PRIMARY KEY (realm_id, parcel_id));

-- A chest inside a parcel, and what the shop uses it for.
CREATE TABLE IF NOT EXISTS game_container (
  realm_id     TEXT NOT NULL DEFAULT 'default',
  container_id TEXT NOT NULL,
  parcel_id    TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  business     TEXT NOT NULL DEFAULT '',
  -- '' | 'stock' | 'ingredients' | 'coffer'. Empty means the shop can see it
  -- and has said nothing about it, which is not the same as having said no.
  role         TEXT NOT NULL DEFAULT '',
  last_sync    TEXT,
  last_hash    TEXT,                      -- contents digest; equal means nothing to do
  status       TEXT NOT NULL DEFAULT 'ok',-- ok | stale | missing
  PRIMARY KEY (realm_id, container_id));
CREATE INDEX IF NOT EXISTS idx_game_container_business ON game_container (realm_id, business);

-- The item index gains an ALIAS, not a new key.
ALTER TABLE master_item ADD COLUMN game_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_item_game
  ON master_item (realm_id, game_id) WHERE game_id IS NOT NULL;
```

### Why the name stays the key

`master_item`'s primary key is `(realm_id, name)`, and **the whole app
references items by name** — sale lines, inventory rows, a special's parts,
transfer lines, the pending queue. Those are historical records; they have to
keep parsing in five years whether or not a game server still exists.

So the game id is an **alias column**: it is how the bridge recognises the same
item across syncs and across a rename, and it is nothing else. It never becomes
the reference used by a sale. This is the same decision the region storage made
(`hold_index` keeps its old name because renaming columns is a migration for a
cosmetic gain) and it is worth stating loudly, because "just key on the ID" is
the obvious wrong turn here.

`inventory.game_id` is deliberately **not** proposed. A listing is already
identified by its item name within a shop, the master index carries the mapping,
and a second copy of it on every listing is a second thing to keep in step.

---

## 6. Who may bind what

The parcel list is the whole world. Nothing must let an owner bind their shop to
a chest inside someone else's house.

**Admin-mediated, in two steps:**

1. A **System or Realm Admin** binds a parcel to a company
   (`game_parcel.business`). This is the same shape as flagging a company as a
   Court or setting its region: an admin statement about who is who.
2. The **owner or manager** of that company may then see the containers inside
   *their own* bound parcel and give each one a role. They can reach nothing
   else; the Worker resolves the parcel from the caller's business rather than
   from anything the client sends.

If the game reports parcel ownership and it can be matched to a character the
app already knows, step 1 could later become self-service with a verification
step. That is a refinement, not the foundation — and it is one of the questions
in §12, because the answer decides whether it is possible at all.

---

## 7. The sync

### One planner, two callers

`planSync(...)` returns the complete set of changes; `applySync(...)` is the
planner with the last step *not* left off. The preview screen and the apply call
the same function, so what the preview promises is exactly what happens — the
rule `planStockImport` already follows, for the reason it follows it.

```js
// worker/src/game/sync.js
/**
 * @returns {{
 *   stock:  {item, was, now, delta, container}[],  // counts to correct
 *   added:  {item, gameId, price, pending}[],      // listings the shop has never had
 *   coffer: {was, now, delta} | null,              // ONE reconciling entry
 *   items:  {gameId, name, action}[],              // master-index work
 *   skipped:{reason, detail}[],                    // said out loud, never silently
 *   hash: string,
 * }}
 */
export function planSync(containers, reads, inventory, master, cofferBalance, opts)
```

### What "the truth" means, per role

- **`stock` / `ingredients` containers.** The union of the assigned containers is
  authoritative **for the items that appear in them**. An item the shop lists but
  which appears in no assigned container is *left alone*, because the most likely
  explanation is that it lives somewhere the owner has not assigned — and a
  partial list silently zeroing the rest is the worst thing a bulk edit can do
  (the shelved inventory import taught this).
  A per-shop opt-in — **"these containers are the whole of my stock"** — makes the
  set fully authoritative and zeroes the remainder. Off by default, and the
  preview spells out every row it would zero before anyone agrees to it.
- **`coffer` container.** Its gold becomes the shop's coffer balance. Gold is an
  *item* in the game, so this is a stack count, and the crucial rule is:

  > **The sync writes the DIFFERENCE, not the amount.**

  The coffer is an append-only ledger, not a balance field. Writing "deposit
  1,240" on every run would double the shop's money every sync. So a run writes
  at most one entry — `kind: 'game-sync'`, `amount: now − was`, note
  `"Game sync: coffer 1,240 → 1,310"` — and writes nothing at all when they
  already agree.
- **Unassigned containers** are read for display only and change nothing.

### Stock is corrected, never purchased

Every count change goes in as a **stocktake correction**: stock moves, no coffer
entry, and the audit line is what explains it. This is `setStock`'s existing
contract, and the bridge is a caller of that idea rather than a new path through
it.

### Atomicity and idempotency

- Every write of a run goes in **one `db.batch`**: a sync lands whole or not at
  all. A half-applied sync would leave a shop's books in a state nobody could
  reason about.
- Each run carries an **idempotency key**; a replay returns the first result.
  Per container, `last_hash` short-circuits the whole thing: identical contents,
  no work, no log line, no coffer entry.

### Manual before automatic

The first version has one button: **Preview**, then **Sync**. A cron that
rewrites shop inventories unattended, on a feature never tested against a live
API, is how a ledger gets corrupted quietly and at three in the morning. The
`scheduled()` entry already exists (`backup-cron.js`) and an opt-in periodic
sync is a small addition *later*, once the manual path has been boring for a
while.

---

## 8. Items and the master index

### Matching, in this order

1. `game_id` — the same definition, whatever it is called now.
2. Normalized name (`normalizeItem` / `matchMasterItem`) — a first meeting, or an
   index built by hand before the bridge existed. On a hit, the row **adopts the
   game id**, which is the moment the two worlds are stitched together.
3. Neither — a new row, filed under `Unsorted` and marked **`pending`**, exactly
   as an item invented at the register is. An admin confirms it. The usual cause
   of a near-duplicate is a near-duplicate, and that is precisely what `pending`
   exists to catch.

### Do NOT import the whole game

A Skyrim-family form list runs to tens of thousands of entries. The master index
is already the largest payload the API serves, and the register's picker is only
usable because the index is curated.

**Import only what is actually seen in bound containers**, plus an admin-pasted
allow-list if a realm wants staples present before anything is stocked. "Import
everything" is a one-line change that would make the app unusable and is
therefore called out here so that nobody makes it by accident.

### Names, values, and who wins

- **Display:** the item list shows the in-game name, with the id beside it as
  quiet secondary text — enough to tell two similarly-named forms apart, never
  the thing a person is asked to read.
- **A game rename does not rename a curated item.** The realm's name stays; the
  bridge knows they are the same thing through the id. An admin action —
  *"adopt the game's names"* — does it deliberately and in bulk, because
  renaming an index entry rewrites how history reads and `upsertItem(oldName)`
  treats it as the migration it is.
- **`base_value` is seeded once**, on first import, from the game's value. It is
  never overwritten afterwards: a realm that has priced its own world must not
  have that undone by a sync. Same rule as `harvest_pay` and `tags` — an
  unmanaged field is left alone.

### The uniqueness problem, stated plainly

Two "Iron Swords" in the same chest may not be the same object: one may be
tempered, enchanted, or named. The ledger's model is *name + count*, and the
bridge collapses stacks by **definition id, ignoring per-instance data**.

A shop selling a unique enchanted blade will therefore see it counted among the
plain ones. This is a known and accepted limitation of the first version; it is
written here rather than discovered later. If it matters, the answer is probably
that flagged instances become their own index entries with a qualified name —
which needs the API to expose instance data at all (§12).

---

## 9. The game's data is untrusted input

Everything crossing the bridge is text from a system this app does not control,
and it lands in the item index, the picker, and eventually in sale lines.

- **Cap everything**: name length (the index's own limits), stacks per container,
  containers per parcel, parcels per read, and total response bytes. A response
  that exceeds a cap is refused as a whole and reported — never truncated into
  something that looks complete.
- **Sanitize names**: trim, collapse whitespace, strip control characters. The
  frontend renders text as text nodes, which is the real defence, and this is the
  belt to that pair of braces.
- **Reject nonsense counts**: negative, fractional, or absurd stack sizes fail
  the run rather than being clamped into a plausible-looking lie.
- **Never trust an id from the client.** A container id in a request is checked
  against `game_container` *for the caller's own business* before anything is
  read or written. The client names a container; the Worker decides whether it is
  theirs — the same rule as every other route here.

---

## 10. Modules, routes, screens

### Worker

```
worker/src/game/bridge.js        the interface + shared caps/validation
worker/src/game/http-bridge.js   the real adapter (auth, retry, caps)
worker/src/game/mock-bridge.js   fixtures — everything above is testable without access
worker/src/game/settings.js      per-realm config in sys_flags (game_bridge:<realm>)
worker/src/game/link.js          parcels & containers: list, bind, set a role
worker/src/game/sync.js          planSync / applySync
worker/src/game/items.js         game definitions → master_item
worker/src/routes/game.js        the route module
```

`routes/game.js` exports its own `routes` array and is spread into `ROUTES` in
`index.js`. Per CLAUDE.md it must also be added to `routes.test.js` and
`api-client.test.js`, or the client/route drift check reports its paths as
unserved.

### Routes

The dispatcher matches **exact paths** (`worker/src/http.js`) — there are no
`:params`, so identifiers go in the query string.

| Method | Path | Who |
|---|---|---|
| `GET` | `/game/status` | admin — configured? reachable? last run? |
| `GET` | `/game/parcels` | admin — the world, cached |
| `POST` | `/game/parcels/bind` | admin — parcel → company |
| `GET` | `/game/containers?parcel=…` | admin, or the owner of the bound company |
| `POST` | `/game/containers/role` | owner/manager — stock \| ingredients \| coffer \| none |
| `GET` | `/game/preview` | owner/manager — what a sync would change |
| `POST` | `/game/sync` | owner/manager — apply it (idempotency key) |
| `POST` | `/game/items/import` | admin — definitions seen in bound containers |
| `GET`/`POST` | `/admin/game/settings` | system admin — URL, on/off, caps, schedule |

Guards: `requireAdmin` for the world-level routes, `requireManages` for a shop's
own — the existing predicates, not a new role list at each call site.

### Screens

Both follow the tile convention; both need their key added to `TILE_KEYS` in
`src/views/admin-settings.js` so artwork can be assigned.

- **Network Settings → Game bridge** (`set-game`, system admin): base URL, test
  connection, item import, last run, caps.
- **Shop Settings → Game link** (`led-game`, owner/manager): the shop's parcel,
  its containers with a role dropdown each, **Preview** and **Sync**, and the
  last run's summary.
- **Inventory**: a synced listing is an ordinary listing. At most a quiet `game`
  pill beside the name, in the shape of the kind pills.

---

## 11. Failure modes, and what each one does

| What happens | What the app does |
|---|---|
| API unreachable / times out | Nothing is written. The screen says so, with the last successful run's time. |
| Partial or truncated read | The **whole run** is refused. Half a shop's stock is not a smaller truth, it is a wrong one. |
| A bound container is gone from the game | `status: 'missing'`, the binding is **kept**, stock is **left alone**. Deleting a binding because one read failed would zero a shop's inventory. |
| A parcel changes hands in the game | The binding is flagged for an admin. Nothing is unbound automatically. |
| Item id already on another index row | Refuse and report both rows — never silently move an alias. |
| Contents unchanged since last run | No writes, no coffer entry, no log line. |
| Key missing / rejected | The bridge reports "not configured" rather than "broken": those are different problems with different fixes. |

Every run — including one that changed nothing — is one `audit` row
(`action: 'game.sync'`), worded by `lineSummary`, so the trail reads as one act
per run.

---

## 12. What must be asked of the API provider

Answers here change the design; several of them decide whether parts of it are
possible at all.

1. **Auth**: scheme, where the credential goes, rotation, and whether a
   *read-only* credential exists.
2. **Rate limits**: requests per minute, burst, and what a limit response looks
   like. This sets the cache TTLs and whether a scheduled sync is viable at all.
3. **ID stability**: are parcel, container and item ids stable across a server
   restart, a mod update, a load-order change? *If container ids are not stable,
   the whole binding model needs a different anchor* — this is the single most
   important question on the list.
4. **Gold**: an item stack, or a field on the container/owner?
5. **Ownership**: does a parcel report who owns it, in a form matchable to a
   player account? (Decides whether §6 can ever be self-service.)
6. **Instance data**: do stacks expose enchantment / tempering / custom names,
   or only the base form? (Decides §8's known limitation.)
7. **Pagination** and worst-case sizes: how many parcels, containers per parcel,
   stacks per container.
8. **Consistency**: is a read atomic, or can a container be read mid-write while
   a player is looting it?
9. **Push**: are there webhooks or an event stream, or is polling the only way?
10. **A test server**: is there a staging world to build against? Without one,
    the mock adapter is the only safe place to develop, which is why it is in
    §4.

---

## 13. Order of work, once access exists

1. `mock-bridge.js` + fixtures. **Buildable today, without any access.**
2. `sync.js` planner + `items.js` matcher, with tests against the mock. This is
   the bulk of the thinking and none of it needs the network.
3. Schema + `link.js`: bind a parcel, give a container a role.
4. `http-bridge.js` against the real API; `/game/status` and nothing else.
5. Preview screen — read-only, changes nothing, and is where the first real data
   gets looked at by human eyes.
6. Apply: stock corrections, then listings, then the coffer difference.
7. Item import, limited to what bound containers actually contain.
8. Only then: an opt-in schedule.

Steps 1 and 2 are the ones worth doing while permission is pending. They are
also the ones that determine whether the rest is correct.
