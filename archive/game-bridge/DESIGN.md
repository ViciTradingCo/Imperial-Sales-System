# The Game Bridge — architecture, not yet built

**STATUS: DESIGN, plus step 1 of §13.** The only things that exist in the repo
are `worker/src/game/bridge.js` (the contract and the rules for what the ledger
will believe) and `worker/src/game/mock-bridge.js` (a fixture world), with their
tests. **Nothing is wired**: no table, no route, no screen, no schema migration,
and nothing imports either file outside its own test. The rest is written down
so that the day API access is granted the work is assembly rather than design,
and so nobody has to re-derive the awkward parts under time pressure.

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

This is now **structural rather than a promise** (§12.1): the credential itself
is read-only, so a bug in this app cannot write to the game world even if
somebody later wires one badly. That is worth more than any rule written down
here, and it means the rules below are about protecting the LEDGER — the game
can look after itself.

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

- **Base URL, enabled flag, the count's hour, the settle delay after a sale
  (§7e), the assumed rate limit, the caps, and `goldItemId`:** `sys_flags` under a realm-keyed name —
  `game_bridge:<realm>` — read/written by a `game-settings.js` in the shape of
  `realm-prefs.js`. A realm pointed at the **test server** is exactly this
  setting with a different URL, which is what makes staging free (§12d). Not `realm-prefs` itself: those are sent to every
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
- `worker/src/game/mock-bridge.js` — **BUILT.** A fixture world and an adapter
  over it. Every test above this line runs against it, so the planner, the
  reconciler and the item importer can be finished and proven before the real
  endpoint is ever called. The world is a live object rather than a frozen
  fixture, so a test can move stock between two syncs; `faults` makes every
  failure in §11 reachable — a server that is down, a chest that has vanished.
  `worker/test/game-bridge.test.js` is also the **acceptance test the real
  adapter must pass**, so the thing that talks to a live server is held to the
  promises the mock is held to now.

`ctx` carries `{ baseUrl, key, realmId }`, resolved by the Worker from the
caller's realm. No module above the bridge ever sees the key. (The mock takes no
`ctx` — it has no server to reach, and a parameter that exists only to be
ignored is one a real adapter can forget to use.)

**Two kinds of wrong, handled differently** — `bridge.js` draws this line and
everything downstream inherits it:

- **Structural** (a list that is not a list, more rows than a read allows, a
  container with no id, a fractional count): the read is **refused whole**. A
  shortened list looks complete, which is the entire problem with one.
- **Cosmetic** (a tab in a name, a name longer than the index's 40 characters):
  cleaned and **flagged**, so the importer can say "three names were shortened"
  rather than either lying or refusing a read over something that is not a
  mistake.

---

## 5. Data model

Three new tables (the third is in §7a) and one new column. All carry `realm_id`
and go in `REALM_TABLES`; all carry `business` and go in `BUSINESS_TABLES`, so a
company rename or a realm transfer walks them like everything else.

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
  name         TEXT NOT NULL DEFAULT '',    -- what the game calls it
  -- What the SHOP calls it. A game with four barrels is not much help; blank
  -- means "use the game's name", the same rule branding and the About page use,
  -- and a sync never overwrites a label somebody typed.
  label        TEXT NOT NULL DEFAULT '',
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

**SETTLED (§12.5): the game does not say who owns a parcel.** There is no field
to match against, so step 1 is not a stopgap on the way to self-service — it is
the only place ownership is established at all. Three things follow:

- **The admin's binding IS the record of ownership.** Nothing else in either
  system asserts that this building belongs to this shop, so the binding is
  written with an audit line naming who bound what and when, and re-binding a
  parcel to a different company is audited the same way. It is the sort of claim
  somebody will need to check the provenance of a year later.
- **An unbound parcel is invisible to owners.** The world list is an admin
  screen. An owner never browses the world and picks; they are handed one
  building and see only its chests.
- **Verification is a human step, out of band.** The System Admin confirms in
  the game (or with the server's own operators) that the parcel is the shop's
  before binding it. The app cannot help with this and should not pretend to —
  what it can do is make the claim explicit, dated and attributable.

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

- **`stock` / `ingredients` containers.** The **union of every assigned
  container** is the shop's shelf: an item in two chests is one listing with the
  counts added, and the same item in a third adds to it again. Which chests it
  is in travels with it (§7a), because "you have thirty ales" and "you have
  twenty-four in the barrel and six in the cupboard" are different amounts of
  help when somebody is standing in the room.

  The union is authoritative **for the items that appear in it**. An item the
  shop lists but which is in no assigned container is *left alone*, because the
  likeliest explanation is a chest nobody has assigned — and a partial list
  silently zeroing the rest is the worst thing a bulk edit can do (the shelved
  inventory import taught this). A shop that has assigned every chest it owns
  says so ONCE, at setup — **"these containers are the whole of my stock"** —
  and from then on an absent item really does mean none left. Asked once,
  because a question asked at every sync is a question nobody reads.

- **`coffer` containers.** See §7b. The coin in them IS the coffer.

- **Unassigned containers** are read for display only and change nothing.

### 7a. Where a thing is, not just how much of it

A ledger listing is one row per item per shop, so *which chest* is extra
knowledge the sync is uniquely able to supply. It is kept beside the listing
rather than inside it:

```sql
CREATE TABLE IF NOT EXISTS game_item_location (
  realm_id     TEXT NOT NULL DEFAULT 'default',
  business     TEXT NOT NULL,
  item         TEXT NOT NULL,          -- the ledger's own item name
  container_id TEXT NOT NULL,
  qty          INTEGER NOT NULL DEFAULT 0,
  last_sync    TEXT,
  PRIMARY KEY (realm_id, business, item, container_id));
```

The listing's stock is the SUM of its rows here, which is what makes the split
checkable: if the two disagree, the sync is wrong and says so rather than
quietly preferring one. Inventory shows it as a quiet line under the name —
*in: Barrel (24), Cupboard (6)* — in the shape the kind pills already use.

**Containers are nameable.** The game's own name for a chest is "Barrel", and a
shop with four barrels needs better than that. `game_container.label` is the
shop's own name for it, shown wherever the container is named and falling back
to the game's `name` when blank — the same blank-means-inherit rule branding and
the About page already follow. The game may rename a chest at any time; the
shop's label is never overwritten by a sync.

### 7b. The coffer is COUNTED, and the sales log is what it should have been

A shop with a coffer container does not compute its balance. **The coin in the
chest is the balance** — the game is where the money actually is, and a figure
derived from a list of entries can only ever be a claim about it.

What the ledger keeps being is the **expectation**: every sale credited, every
delivery debited, every wage and levy and hand adjustment. So the shop has two
numbers that should agree, and the interesting one is the gap:

> **counted − expected = what is unaccounted for.**

That is the answer to "is any money missing", and it is the reason to point the
app at the strongbox at all. An owner who sold 400 gold's worth on Saturday and
finds 340 more coin on Sunday has 60 to explain, and can say exactly which two
syncs it went missing between.

Mechanically this changes nothing about how the coffer is stored, and that is
deliberate: it stays an append-only ledger whose SUM is the balance, so every
query that already reads it — `cofferBalance`, the ledger screen, the
Performance page's money in and out — keeps working untouched. A sync writes at
most **one** entry:

> **the DIFFERENCE, never the amount.**

`kind: 'game-count'`, `amount: counted − expected`, worded as the finding it is:
*"Counted in the Strongbox: 1,310 — 70 more than the ledger expected."* Writing
the counted balance itself on every run would double the shop's money every
sync, which is the trap this rule exists to name.

- **Several coffer containers are summed.** A shop keeping a float behind the bar
  and a strongbox upstairs has one coffer made of two piles.
- **Which item is money is a REALM setting** (`goldItemId`), because only the
  game knows. It is not guessable and must not be guessed.
- **A run that finds no difference writes nothing.** No entry, no log line.
- **The gap is never "corrected" silently.** The entry that squares the books is
  also the record that something needed squaring, it names both figures, and it
  is what the Performance page counts as unexplained rather than as takings.

### 7c. A synced shop's stocktake is automatic — and its intake becomes MONEY

Once a shop is synced, **counting the shelves is not a job any more**. The
stocktake stops being something an owner does and becomes what the sync already
is: the chest is the count, and the ledger follows it. The manual stocktake
stays for shops that are not synced, and as the way to correct a shop whose
bridge is switched off.

The consequence is the part worth stating carefully, because getting it wrong
double-counts a shop's stock:

> **For a synced shop, recording a delivery records what was PAID, not what
> arrived.** The goods already arrived — they are in the chest, and the sync saw
> them. An intake that also incremented stock would count the same crate twice.

So the Buying side of the register keeps its whole purpose (a vendor, a region,
a price, a coffer debit, a cost history for margins) and loses exactly one
effect: it no longer moves stock. The screen says so.

**Market Analysis is then read from the SALES LOG ONLY.** Its buy side exists
because a purchase at a stated price is evidence of what a thing is worth — and
a sync states no price. Stock that appears because a chest was counted is
evidence of nothing, and letting it in at a base value or a zero would quietly
teach the realm that everything is cheap. A synced realm therefore values items
on what they SELL for, which is the honest half of the figure and the half a
shopkeeper cares about anyway.

A hand-recorded intake still carries a real price, so whether those keep feeding
realm-wide valuation is a realm setting (`marketFromBuys`), defaulting **off**
where the bridge is on. Off is the safe default: a synced realm's buy data is
sparse and volunteered, and a valuation built from what a handful of diligent
owners typed in is worse than one built from every sale.

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

### 7d. A COUNT, not a camera — the reading is deliberately behind

**SETTLED (§12.8): the world is not read live.** The bridge does not follow a
chest as it changes; it takes a **count at a moment**, on a schedule, and the
ledger is the books *as of that count*. Three reasons, and they all point the
same way:

- **Lore.** A ledger that updates as a player's hand moves in a chest is a
  magical readout, not an account book. A shop that was counted last night, and
  says so, is the fiction this whole app is written in.
- **Truth.** A container read while somebody is mid-loot is a number that was
  never true for a whole second. A quiet-hour count is a number that was.
- **Cost.** A count per shop per day is a handful of calls. Following a world
  live is a poll loop that would spend the rate limit on discovering that
  nothing has changed.

What this demands of the interface is one thing, done everywhere: **say when.**
Every figure that came from a count carries its as-of time — *"Counted at 03:00
today"* — on the inventory, on the coffer, and on the Performance page. A number
without its timestamp will be read as live, and then disbelieved the first time
it disagrees with what somebody is looking at in the game.

The cadence is a per-realm setting (a quiet hour, daily by default). A manual
**Sync now** stays, for setting a shop up and for the moment after somebody
moves stock deliberately — but it is the exception, not the mode.

### 7e. A sale makes a shop DUE for counting — it does not trigger a read

**SETTLED (§12.9): counts are pulled on a schedule AND after a sale.** The
second half needs care, because the obvious implementation of it is wrong in a
way that would be blamed on the game rather than on us.

A sale is exactly the moment the two worlds disagree. The till decrements the
ledger the instant it is rung up; the ale leaves the barrel and the coin enters
the strongbox whenever the two players actually get round to it — a minute
later, five, sometimes after a conversation. **Counting immediately would read
the chest before the goods had moved**, find the old numbers, and "correct" the
sale away. The next count would put it back. A shop's stock would flap between
two figures and its coffer would report money missing that is standing in front
of the shopkeeper.

So a sale does not read anything. **A sale marks the shop DUE**, and the count
happens afterwards:

- checkout stamps `due_at = now + settle` on the shop's bridge row, inside the
  batch it was already writing. One tiny write, no network call;
- the sweep (§7d's cron, running every few minutes rather than nightly) counts
  the shops whose `due_at` has passed, plus any whose scheduled hour has come;
- `settle` is a per-realm setting — long enough for two people to finish
  handing things over, short enough that the books are current within the hour.

Three properties fall out of it, all of them wanted:

- **Sales COALESCE.** The `due_at` is set by the first sale after a count and
  not pushed back by later ones, so a busy hour is one count at the end of the
  settle window rather than forty. A quiet shop is counted when something
  actually happened to it, and never otherwise.
- **The till never waits on the game.** No API call happens on the checkout
  path, so a game server that is down, slow, or rate-limiting cannot make a sale
  fail or hang. This is not negotiable: the register works when the game does
  not, exactly as it works when the network does not.
- **It replays correctly.** The marker is written where the sale LANDS, inside
  `checkout`, so a sale queued offline and replayed an hour later marks the shop
  due when it is really recorded rather than when somebody's browser managed to
  reach us.

### 7f. Two ledgers, and the gap between them is the point

With counts arriving after sales, the shape of the whole feature resolves into
one idea it is worth naming, because every part of it follows the same rule:

> **The ledger says what SHOULD be there. The count says what IS. The gap is a
> finding, not an error to be smoothed away.**

|  | Expected | Counted | The gap means |
|---|---|---|---|
| **Coin** | sales, deliveries, wages, the levy | gold in the coffer chests | money unaccounted for — the reason to point the app at a strongbox at all |
| **Stock** | what the till and the deliveries say is left | items in the stock chests | goods that left without a sale, or arrived without a delivery |

Both are applied — the count wins, because it is what is actually there — and
both are **recorded as the difference**, so the shop can see when it happened
and between which two counts. Counting after every sale narrows that window from
a day to minutes, which is precisely what makes the answer useful: "somewhere
this week" is a shrug, "between the count at 14:10 and the one at 14:25" is an
answer.

A stock gap is worded more carefully than a coin one, because most of them are
innocent: an increase is usually the owner restocking from their own pack, and
only a *shortfall beyond what the sales explain* is worth a word. It is reported
on the sync's own line and totalled on Performance as unaccounted stock; it is
never an alarm, and the app never accuses anybody of anything.

**Phasing is unchanged by this.** Manual first while it is proven; the schedule
switched on once a manual run has been boring for a fortnight. A cron that
rewrites inventories unattended on a feature nobody has watched work is how a
ledger gets corrupted quietly and at three in the morning — which is, awkwardly,
exactly when it would run.

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
| A shop is due but the game is unreachable | It **stays** due. The marker is not cleared by a failed attempt, so the count happens at the next sweep that works — a sale is never silently forgotten because a server blinked. |
| The sweep is behind (many shops due at once) | Shops are counted oldest-due first, a bounded number per run. Nothing is dropped; the queue drains. |
| Key missing / rejected | The bridge reports "not configured" rather than "broken": those are different problems with different fixes. |

Every run — including one that changed nothing — is one `audit` row
(`action: 'game.sync'`), worded by `lineSummary`, so the trail reads as one act
per run.

---

## 12. What was asked of the API provider, and what came back

Answered by the server's operator. Where an answer settled something, the
section it settled says so and this is the record of why.

| # | Question | Answer | What it settles |
|---|---|---|---|
| 1 | Auth, and does a **read-only** credential exist? | Read-only, and available — access is the only blocker | §1 is now structural, not just intent: a bug in this app *cannot* write to the game, because the credential cannot |
| 2 | Rate limits | Standard | Pace and cache as if modest (§12a); measure the real numbers on the test server |
| 3 | Are parcel / container / item ids **stable**? | **Yes** | The binding model stands as designed. This was the one that could have forced a rewrite |
| 4 | Is gold an item stack or a field? | **An item stack** | §7b as written: the coffer is a pile of coin found like any other stack, and `goldItemId` is a realm setting |
| 5 | Does a parcel report its owner? | **No** — ownership needs a System Admin to verify | §6: admin-mediated binding is permanent, and the binding is itself the ownership record |
| 6 | Do stacks expose instance data (enchanted, tempered, named)? | Unclear | §8's limitation stands, and §12b makes it a first-contact discovery |
| 7 | Pagination and worst-case sizes | Unclear | §12b: the adapter hides paging; the caps refuse what is too big either way |
| 8 | Is a read atomic? | **Do not read live** — a delayed count, for lore accuracy | §7d: the bridge takes a count on a schedule and every figure says as-of when |
| 9 | Webhooks, or polling? | **Polling** — on a schedule, and again after a sale | §12c, and §7e: a sale marks the shop DUE rather than triggering a read |
| 10 | Is there a **test server**? | **Yes** | §12d, and it reorders the work: the risky half can be learned somewhere harmless |

### 12a. "Standard" rate limits, until they are measured

Assume modest and behave well: one shop at a time, its containers read in
sequence rather than in a burst, listings cached for the length of a sync, and a
scheduled sweep that walks a few shops per run rather than the whole realm at
once. A realm setting holds the assumed limit so it can be raised to whatever the
server actually allows once that is known.

A shop of five containers is six calls a day. A realm of forty such shops is
under two hundred — trivially within anything, *provided* they are spread out
rather than fired together, which is why the sweep paces.

### 12b. Two unknowns, and why neither blocks anything

Both are contained by the shape already chosen:

- **Instance data (6).** Everything above the adapter works in `{itemId, count}`;
  merging by id happens in `bridge.js`. If it turns out a stack does expose
  enchantment or tempering, the *adapter* decides whether to hand up a qualified
  id — and nothing above it changes. If it does not, the limitation in §8 stands
  and is documented rather than discovered.
- **Pagination and sizes (7).** `listParcels()` returns a list; whether that took
  one request or nine is the adapter's business. The caps in `bridge.js` apply to
  the **assembled total**, so a paged world that is too large still refuses as a
  whole.

Both become **first-contact tasks on the test server**: read one parcel, one
container, one item definition, and write down what actually comes back.

### 12c. Polling versus push — and why polling wins here

*The question was "explain the differences", so:*

**Polling** is the app asking, on its own clock: *what is in this chest?* It is
simple, it needs nothing from the game beyond the read that already exists, it
fails safely (a missed run means stale data, not lost data), and it cannot be
spoofed — the app chose who to ask. Its costs are that it learns about a change
only at the next run, and that most runs discover nothing has changed.

**Push** (a webhook or event stream) is the game telling the app *the barrel
changed* the moment it does. It is immediate and spends nothing on quiet
periods. Its costs are real: the app must expose an endpoint the game can reach,
authenticate what arrives (an unauthenticated webhook is a stranger writing to
your ledger), survive duplicates and out-of-order events, and cope with a missed
event leaving the ledger silently wrong forever — so a periodic reconciling poll
is needed *anyway*, as a backstop. Push is strictly more machinery, and it buys
latency.

**For this app, latency is not wanted.** Answer 8 asks for a delayed count on
purpose. Push would deliver exactly the thing the design is trying not to have,
and would add an inbound attack surface to get it.

**SETTLED (§12.9): polling, on a schedule, and again after a sale** — with no
webhook endpoint anywhere. The second trigger is the interesting one, and it is
deliberately *not* "a sale causes a read": a sale marks the shop DUE and the
count follows a settle delay behind it (§7e). That keeps the delayed-count
principle intact, gives two players time to actually hand goods over, coalesces
a busy hour into one count, and keeps every API call off the checkout path so a
game server having a bad day can never cost somebody a sale.

Note what this gets us that push would not: the app decides *when* it is
counted, so the count is never mid-transaction, and a shop nobody has traded at
costs nothing. If push ever appears, the correct use of it is still not to sync
faster — it is to mark a shop due, which is the same mechanism a sale already
uses.

### 12d. The test server is where the risk goes

The multi-realm design pays for itself here: a **realm pointed at the test
server** is a complete, isolated staging environment with no new machinery. Its
shops, items, bindings and coffers are its own — realm isolation already
guarantees that — so the whole feature can be wrong there without touching the
live realm's books.

The order of work below assumes this: the HTTP adapter, the first real reads and
the first apply all happen in a test realm, and the live realm is pointed at the
real server only once a full cycle has run there without surprises.

---

## 13. Order of work, once access exists

1. ~~`mock-bridge.js` + fixtures.~~ **DONE** — with `bridge.js`, the contract and
   the cleaning rules, beside it.
2. `sync.js` planner + `items.js` matcher, with tests against the mock. This is
   the bulk of the thinking and none of it needs the network — **next, and still
   buildable with no access.**
3. Schema + `link.js`: bind a parcel, give a container a role.
4. `http-bridge.js` against the **test server**, in a **test realm**;
   `/game/status` and nothing else. First contact answers §12b's two unknowns —
   instance data and real-world sizes — somewhere harmless.
5. Preview screen — read-only, changes nothing, and is where the first real data
   gets looked at by human eyes. Still in the test realm.
6. Apply, in the test realm: stock corrections, then listings, then the coffer
   difference. Run a full cycle. Break it on purpose: unplug the server
   mid-sync, delete a chest, loot one while it reads.
7. Item import, limited to what bound containers actually contain.
8. Point the LIVE realm at the real server, manual syncs only.
9. Only then: the schedule — the cron sweep (§7d) and the sale-triggered due
   marker (§7e) together, once a manual run has been boring for a fortnight.
   The marker is one write in `checkout` and must stay that way; if it ever
   grows into an API call on the checkout path, it has become a bug.

Steps 1 and 2 need no access at all. Step 1 is done; step 2 is next and is the
bulk of the thinking. Steps 4–7 need only the TEST server, which exists — so the
only thing genuinely gated on the live credential is step 8.
