/**
 * D1 (Cloudflare SQLite) access — the live transactional store for inventory,
 * sales, and intake. The binding is `env.DB`.
 *
 * The schema is ensured in-code (idempotent CREATE TABLE IF NOT EXISTS), so a
 * freshly-created D1 database works without a separate migration step. It runs
 * at most once per Worker instance.
 *
 * MULTI-REALM: every data table carries a realm_id, and uniqueness is declared
 * per realm — two realms may hold the same business, item, or setting label.
 * A fresh database gets the realm-aware tables straight from SCHEMA; a database
 * created before realms existed is brought forward by MIGRATIONS (added columns)
 * and REBUILDS (tables whose PRIMARY KEY / UNIQUE was global and cannot be
 * altered in place — SQLite has no DROP CONSTRAINT).
 */

/** The realm existing (pre-multi-realm) data belongs to. */
export const DEFAULT_REALM_ID = 'default';

/** What the built-in realm is called. It can be renamed, but never deleted. */
export const DEFAULT_REALM_NAME = 'Test Realm';

// Inlined into DDL text below; kept as its own name so the DDL reads clearly.
const R = DEFAULT_REALM_ID;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, item TEXT NOT NULL,
     price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
     low_stock INTEGER NOT NULL DEFAULT 0,
     ingredient INTEGER NOT NULL DEFAULT 0,
     harvest_pay REAL NOT NULL DEFAULT 0,
     UNIQUE (realm_id, business, item))`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_business ON inventory (business)`,
  `CREATE TABLE IF NOT EXISTS sales (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, ts TEXT NOT NULL, order_no TEXT NOT NULL,
     customer TEXT, hold TEXT, items TEXT,
     qty_total INTEGER NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
     employee TEXT, discount TEXT, status TEXT NOT NULL DEFAULT '', idem TEXT,
     staff_purchase INTEGER NOT NULL DEFAULT 0,
     -- Who rang it up, by uid rather than by name: a character rename must not
     -- detach somebody from the commission they have already earned.
     employee_uid TEXT,
     -- The commission STAMPED ON THE SALE, not recomputed at payout. Same rule
     -- as the shift rate: changing someone's percentage applies to what they
     -- sell next, never to what an owner has already agreed they earned.
     commission REAL NOT NULL DEFAULT 0,
     commission_paid INTEGER NOT NULL DEFAULT 0, commission_paid_ts TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_business ON sales (business)`,
  // NOTE: the idx_sales_idem index references the `idem` column, which is added
  // by an ALTER migration on pre-existing DBs — so it's created in MIGRATIONS,
  // AFTER that column exists, not here.
  `CREATE TABLE IF NOT EXISTS intake (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, ts TEXT NOT NULL, item TEXT, vendor TEXT,
     source_hold TEXT, num_items INTEGER NOT NULL DEFAULT 0,
     price_per REAL NOT NULL DEFAULT 0, idem TEXT,
     from_business TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_intake_business ON intake (business)`,
  `CREATE TABLE IF NOT EXISTS transfers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     from_business TEXT NOT NULL, to_business TEXT NOT NULL,
     item TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0,
     price REAL NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'pending', ts TEXT NOT NULL, idem TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers (to_business)`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers (from_business)`,
  // Coffers — a shop's treasury ledger. Balance = SUM(amount); credits are
  // positive (sales), debits negative (intake, withdrawals).
  `CREATE TABLE IF NOT EXISTS coffer_entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, ts TEXT NOT NULL,
     kind TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_coffer_business ON coffer_entries (business)`,
  // Reusable named discounts per shop.
  `CREATE TABLE IF NOT EXISTS discounts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, name TEXT NOT NULL, percent REAL NOT NULL DEFAULT 0,
     UNIQUE (realm_id, business, name))`,
  `CREATE INDEX IF NOT EXISTS idx_discounts_business ON discounts (business)`,
  // Per-shop style (tagline + accent colour), one row per business per realm.
  `CREATE TABLE IF NOT EXISTS shop_style (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, tagline TEXT, accent TEXT,
     PRIMARY KEY (realm_id, business))`,
  // Audit trail of significant admin/owner actions.
  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     ts TEXT NOT NULL, actor TEXT, actor_business TEXT, action TEXT NOT NULL, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (id DESC)`,
  // Config indexes moved off Sheets onto D1 (hot paths: checkout, market, hold
  // dropdowns). Seeded once from the Core's index tabs (see item-index.js /
  // holds.js), then D1 is the source of truth.
  // The index is divided into one table per TYPE of item (Weapons, Potions, …).
  // `category` is which of those an item belongs to; the type list itself lives
  // in item_type. An item's NAME is still unique realm-wide, not per type: the
  // register picks by name, so two "Iron Sword" rows filed under different types
  // would be an ambiguity, not a distinction.
  // `pending` marks an item the REGISTER invented: a clerk sold something the
  // index had never heard of, so it was added on the spot rather than refused.
  // It trades and reports like any other item — the sale really happened — but
  // it is held up for an admin to confirm or remove, because the usual cause is
  // a near-duplicate of something already there ("Iron Swrd", "iron sword +1").
  // `first_seen`, `first_by` and `first_shop` say when, by whom, and at which
  // till — which is what makes a duplicate identifiable months later, and lets
  // an admin see that one shop is generating most of them (usually a sign
  // somebody needs showing where the search box is, not a data problem).
  `CREATE TABLE IF NOT EXISTS master_item (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     name TEXT NOT NULL, base_value REAL NOT NULL DEFAULT 0,
     category TEXT NOT NULL DEFAULT 'Unsorted',
     pending INTEGER NOT NULL DEFAULT 0,
     first_seen TEXT, first_by TEXT, first_shop TEXT,
     PRIMARY KEY (realm_id, name))`,
  // The realm's item types, in display order. Every realm starts with (and can
  // never lose) "Unsorted" — the table anything unflagged lands in.
  //
  // `flags` is a JSON array of extra words an import line may carry to be sorted
  // into this table: the sheet a realm actually keeps says "wep" or "1H" where
  // the table is called Weapons, and renaming the table to match the sheet is
  // the wrong way round. The table's own name always sorts into it too.
  `CREATE TABLE IF NOT EXISTS item_type (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     name TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0, flags TEXT NOT NULL DEFAULT '[]',
     PRIMARY KEY (realm_id, name))`,
  `CREATE TABLE IF NOT EXISTS hold_index (
     ord INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     name TEXT NOT NULL)`,
  // Small key/value store for global MOTD, config values, checkout idempotency, etc.
  // NOT realm-scoped: keys that need to differ per realm embed the realm in the key.
  `CREATE TABLE IF NOT EXISTS sys_flags (k TEXT PRIMARY KEY, v TEXT)`,
  // ---- Registry (formerly Google Sheets; now D1 is the sole source of truth) ----
  // Who's registered: identity, role, and business. char_name / notes avoid the
  // SQLite keyword `character`. active_realm is the realm a super admin is
  // currently VIEWING (empty = their own realm); realm_id is the one they belong to.
  `CREATE TABLE IF NOT EXISTS users (
     uid TEXT PRIMARY KEY,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     email TEXT NOT NULL, business TEXT,
     role TEXT NOT NULL DEFAULT 'employee', is_owner INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active', char_name TEXT, notes TEXT,
     created TEXT, last_seen TEXT, active_realm TEXT NOT NULL DEFAULT '',
     pay_rate REAL NOT NULL DEFAULT 0,
     commission_rate REAL NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_business ON users (business)`,
  // Registered businesses + their Vici Trading Co. certification (subscription).
  // join_code is the STAFF code: an owner hands it to their employees so they
  // can register straight into this shop without being shown any other shop.
  `CREATE TABLE IF NOT EXISTS companies (
     id TEXT PRIMARY KEY,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, point_of_contact TEXT,
     until TEXT, perpetual INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '',
     hold TEXT, court INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0,
     join_code TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_companies_business ON companies (business)`,
  // Network Master Settings (label → value) PER REALM; schema lives in settings.js.
  `CREATE TABLE IF NOT EXISTS master_settings (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     label TEXT NOT NULL, value REAL,
     PRIMARY KEY (realm_id, label))`,
  // Per-shop settings (business + label → value); schema lives in business-settings.js.
  `CREATE TABLE IF NOT EXISTS business_settings (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, label TEXT NOT NULL, value REAL,
     PRIMARY KEY (realm_id, business, label))`,
  // Individual (per-business, scheduled) MOTD messages. start_at/end_at avoid
  // the SQLite keyword `end`.
  `CREATE TABLE IF NOT EXISTS motd_list (
     id TEXT PRIMARY KEY,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT, message TEXT, start_at TEXT, end_at TEXT)`,
  // Feedback on the app itself, submitted by owners and employees.
  //
  // The submitter's identity is COPIED IN at submit time (who, which shop,
  // what role/status, which realm) rather than joined on read: feedback is a
  // record of what someone said and who they were WHEN they said it, and a
  // report that reads "an employee of a shop that no longer exists" is more
  // useful than one whose author silently changed job.
  //
  // `completed` is the Active/Archive split.
  `CREATE TABLE IF NOT EXISTS feedback (
     id TEXT PRIMARY KEY,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     ts TEXT NOT NULL, uid TEXT, email TEXT, char_name TEXT, business TEXT,
     role TEXT, status TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
     completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_open ON feedback (completed, ts DESC)`,
  // ---- Courts: a region's government ----
  // A Court is the company an admin has flagged as its region's authority. These
  // tables are its instruments. All are keyed by REGION rather than by the Court
  // company, so a Court being renamed — or the flag moving to a different
  // company — leaves the region's rules and its books intact.
  //
  // tax_percent 0 means the levy is OFF, and checkout skips it entirely rather
  // than working out 0% of every sale.
  `CREATE TABLE IF NOT EXISTS court_settings (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     hold TEXT NOT NULL,
     tax_percent REAL NOT NULL DEFAULT 0,
     notice TEXT NOT NULL DEFAULT '',
     PRIMARY KEY (realm_id, hold))`,
  // A shop's standing with its Court. Absent = no ruling, which is the default
  // and is NOT the same as licensed — a seal has to be granted to mean anything.
  `CREATE TABLE IF NOT EXISTS court_status (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     hold TEXT NOT NULL, business TEXT NOT NULL,
     standing TEXT NOT NULL DEFAULT 'none', note TEXT, updated TEXT,
     PRIMARY KEY (realm_id, business))`,
  // Price controls: a floor and/or a ceiling on one item, region-wide.
  `CREATE TABLE IF NOT EXISTS court_price (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     hold TEXT NOT NULL, item TEXT NOT NULL,
     min_price REAL, max_price REAL, updated TEXT,
     PRIMARY KEY (realm_id, hold, item))`,
  // What each shop OWES its Court, as a ledger rather than a running total:
  // levies are positive, payments negative, and the balance is the sum. The
  // money never moves on its own — a Court records payment when it is made.
  `CREATE TABLE IF NOT EXISTS court_dues (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     hold TEXT NOT NULL, business TEXT NOT NULL, ts TEXT NOT NULL,
     kind TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_court_dues_shop ON court_dues (realm_id, hold, business)`,
  // Public spending, by category. Every row also debits the Court's own coffer,
  // so its treasury and its accounts cannot tell different stories.
  `CREATE TABLE IF NOT EXISTS court_spend (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     hold TEXT NOT NULL, ts TEXT NOT NULL,
     category TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_court_spend_hold ON court_spend (realm_id, hold)`,
  // ---- Realms (multi-tenancy) ----
  // One deployment can host several independent RP servers. Every data table
  // carries a realm_id and queries filter on it, so nothing is ever shared or
  // cross-referenced between realms. See realm.js.
  // join_code is the FOUNDER code: it admits someone to this realm and sends
  // them to Business Creation, where they start a shop of their own.
  `CREATE TABLE IF NOT EXISTS realms (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, created TEXT,
     join_code TEXT)`,
  // ---- Time cards ----
  // One row per shift: clocked in, and clocked out later (open while `out` is
  // NULL). The RATE IS COPIED ONTO THE ROW when the shift ends, not read from
  // the employee's current rate at payout — a raise must not silently restate
  // what last month's work was worth.
  `CREATE TABLE IF NOT EXISTS time_card (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, uid TEXT NOT NULL, employee TEXT,
     clock_in TEXT NOT NULL, clock_out TEXT,
     rate REAL NOT NULL DEFAULT 0, note TEXT,
     paid INTEGER NOT NULL DEFAULT 0, paid_ts TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_time_card_shop ON time_card (realm_id, business)`,
  `CREATE INDEX IF NOT EXISTS idx_time_card_open ON time_card (realm_id, uid, clock_out)`,
  // ---- Sessions (staying signed in) ----
  // A Google ID token lasts an hour; a shift at the register lasts longer. So
  // signing in trades the Google token for one of ours, which lasts a day.
  //
  // `id` is the SHA-256 of the token, never the token: a leaked backup of this
  // table cannot be replayed as anybody's session. NOT realm-scoped on purpose —
  // a session identifies a PERSON, and which realm they see is read from their
  // user row on every request (a System Admin switches realms mid-session, and a
  // realm stamped on the session here would go stale the moment they did).
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     uid TEXT, email TEXT NOT NULL, name TEXT,
     created TEXT, expires TEXT NOT NULL, last_seen TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions (email)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires)`,
];

/** Every table that holds realm-owned data (all get a realm_id column). */
export const REALM_TABLES = [
  'inventory', 'sales', 'intake', 'transfers', 'coffer_entries', 'discounts',
  'shop_style', 'audit', 'master_item', 'item_type', 'hold_index', 'users', 'companies',
  'time_card',
  'master_settings', 'business_settings', 'motd_list', 'feedback',
  'court_settings', 'court_status', 'court_price', 'court_dues', 'court_spend',
];

/**
 * The per-business tables — every table whose rows belong to ONE shop, and the
 * column naming it. Moving or renaming a business walks exactly this list, so a
 * new per-shop table only has to be added here.
 */
const BUSINESS_TABLES = [
  ['inventory', 'business'], ['sales', 'business'], ['intake', 'business'],
  ['transfers', 'from_business'], ['transfers', 'to_business'],
  ['coffer_entries', 'business'], ['discounts', 'business'], ['shop_style', 'business'],
  ['time_card', 'business'],
  ['companies', 'business'], ['users', 'business'], ['business_settings', 'business'],
  ['motd_list', 'business'],
];

// Additive migrations for databases created before a column existed. Each runs
// best-effort and IN ORDER; "duplicate column" on an already-migrated DB is
// ignored. The idem index comes AFTER its column is guaranteed to exist.
const MIGRATIONS = [
  'ALTER TABLE master_item ADD COLUMN pending INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE master_item ADD COLUMN first_seen TEXT',
  'ALTER TABLE master_item ADD COLUMN first_by TEXT',
  'ALTER TABLE master_item ADD COLUMN first_shop TEXT',
  'ALTER TABLE users ADD COLUMN pay_rate REAL NOT NULL DEFAULT 0',
  // A share of what they sell, as a percentage. 0 is "no commission", which is
  // also the default — a rate exists only where an owner has set one, and an
  // employee may have this, an hourly rate, or both.
  'ALTER TABLE users ADD COLUMN commission_rate REAL NOT NULL DEFAULT 0',
  // Commission is stamped on the SALE, so a later change of rate cannot restate
  // what was already earned. employee_uid is how a payout finds it after a
  // character rename.
  'ALTER TABLE sales ADD COLUMN employee_uid TEXT',
  'ALTER TABLE sales ADD COLUMN commission REAL NOT NULL DEFAULT 0',
  'ALTER TABLE sales ADD COLUMN commission_paid INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE sales ADD COLUMN commission_paid_ts TEXT',
  'ALTER TABLE sales ADD COLUMN idem TEXT',
  'CREATE INDEX IF NOT EXISTS idx_sales_idem ON sales (business, idem)',
  'ALTER TABLE intake ADD COLUMN idem TEXT',
  'CREATE INDEX IF NOT EXISTS idx_intake_idem ON intake (business, idem)',
  'ALTER TABLE transfers ADD COLUMN idem TEXT',
  'CREATE INDEX IF NOT EXISTS idx_transfers_idem ON transfers (from_business, idem)',
  // Multi-realm: every data table gains realm_id. The DEFAULT means existing
  // rows land in the 'default' realm automatically — no backfill needed. On a
  // fresh DB these are no-ops ("duplicate column"), since SCHEMA already has it.
  ...REALM_TABLES.map((t) => `ALTER TABLE ${t} ADD COLUMN realm_id TEXT NOT NULL DEFAULT '${R}'`),
  ...REALM_TABLES.map((t) => `CREATE INDEX IF NOT EXISTS idx_${t}_realm ON ${t} (realm_id)`),
  // The realm a super admin is currently viewing (empty = their own).
  "ALTER TABLE users ADD COLUMN active_realm TEXT NOT NULL DEFAULT ''",
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_realm_email ON users (realm_id, email)',
  // The idempotency lookups filter on realm as well as business, so the indexes
  // should too — otherwise they scan every realm's rows for that shop name.
  'CREATE INDEX IF NOT EXISTS idx_sales_idem_realm ON sales (realm_id, business, idem)',
  'CREATE INDEX IF NOT EXISTS idx_intake_idem_realm ON intake (realm_id, business, idem)',
  'CREATE INDEX IF NOT EXISTS idx_transfers_idem_realm ON transfers (realm_id, from_business, idem)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_realm_business ON companies (realm_id, business)',
  // Join codes: added by migration for databases that predate them, and unique
  // ACROSS realms — a code is typed with no other context, so it has to identify
  // exactly one realm or shop on its own.
  'ALTER TABLE realms ADD COLUMN join_code TEXT',
  'ALTER TABLE companies ADD COLUMN join_code TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_realms_join_code ON realms (join_code) WHERE join_code IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_join_code ON companies (join_code) WHERE join_code IS NOT NULL',
  // Item types: everything already in the index predates the split, so it lands
  // in "Unsorted" — the DEFAULT does the backfill, and no row is lost.
  "ALTER TABLE master_item ADD COLUMN category TEXT NOT NULL DEFAULT 'Unsorted'",
  'CREATE INDEX IF NOT EXISTS idx_master_item_category ON master_item (realm_id, category)',
  // Employee purchases: goods leave, no money changes hands. A separate column
  // rather than a status, because `status` is what VOIDED lives in and every
  // stats query filters on it — overloading it would have made an employee
  // purchase either count as a sale or count as voided, and it is neither.
  'ALTER TABLE sales ADD COLUMN staff_purchase INTEGER NOT NULL DEFAULT 0',
  // Stock a shop holds but does NOT sell — crafting materials. It is a property
  // of the shop's listing, not of the item itself: one shop's ingredient is
  // another's stock-in-trade, so this cannot live on the master index.
  'ALTER TABLE inventory ADD COLUMN ingredient INTEGER NOT NULL DEFAULT 0',
  // What a shop pays one of its own people, per unit, for bringing this in.
  // 0 is "we do not pay for this", which is also the default — a rate exists
  // only where an owner has deliberately set one.
  'ALTER TABLE inventory ADD COLUMN harvest_pay REAL NOT NULL DEFAULT 0',
  // Which REGISTERED COMPANY supplied a delivery, when one did. `vendor` stays
  // free text because most suppliers are NPCs with no account; this is the
  // joinable half, so a region's supply can be credited to the shop that
  // actually sold it.
  "ALTER TABLE intake ADD COLUMN from_business TEXT NOT NULL DEFAULT ''",
  'CREATE INDEX IF NOT EXISTS idx_intake_from ON intake (realm_id, from_business)',
  'CREATE INDEX IF NOT EXISTS idx_sales_counted ON sales (realm_id, status, staff_purchase)',
];

/**
 * Tables whose uniqueness was GLOBAL before realms and so must be rebuilt —
 * SQLite cannot drop or replace a PRIMARY KEY / UNIQUE in place. Each is
 * recreated with the realm-aware key and its rows copied across.
 *
 * This only fires on a database that predates realms: the check is whether the
 * stored CREATE TABLE text already mentions realm_id, so it runs at most once
 * and is a no-op on a fresh DB (and on every subsequent boot).
 */
const REBUILDS = [
  { table: 'master_settings', cols: ['realm_id', 'label', 'value'] },
  { table: 'business_settings', cols: ['realm_id', 'business', 'label', 'value'] },
  { table: 'shop_style', cols: ['realm_id', 'business', 'tagline', 'accent'] },
  { table: 'master_item', cols: ['realm_id', 'name', 'base_value', 'category'], defaults: { category: 'Unsorted' } },
  { table: 'inventory', cols: ['realm_id', 'business', 'item', 'price', 'stock', 'low_stock', 'ingredient'], defaults: { ingredient: 0 } },
  { table: 'discounts', cols: ['realm_id', 'business', 'name', 'percent'] },
];

/**
 * True when the live table still declares a GLOBAL key and must be rebuilt.
 *
 * The test is whether realm_id appears in the PRIMARY KEY / UNIQUE clause — NOT
 * merely whether the column exists. That distinction is the whole point: the
 * ALTER TABLE ... ADD COLUMN realm_id migration runs before this check and puts
 * realm_id into the stored CREATE TABLE text, so "does the SQL mention realm_id"
 * was true for every table and the rebuild never fired. The constraint kept its
 * pre-realm shape, and the first import into a second realm hit
 * "UNIQUE constraint failed: master_item.name".
 *
 * ALTER TABLE ADD COLUMN cannot change a constraint clause, so a clause naming
 * realm_id can only have come from the current SCHEMA.
 */
async function needsRebuild(db, table) {
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first();
  if (!row || !row.sql) return false; // table absent — SCHEMA will create it correctly
  return !/(PRIMARY\s+KEY|UNIQUE)\s*\(\s*realm_id/i.test(row.sql);
}

/**
 * Rebuilds one table: the new definition comes from SCHEMA, so there is a single
 * source of truth for what the table should look like. Rows are copied with
 * realm_id defaulting to the default realm (which is where all pre-realm data
 * belongs). Best-effort — a failure leaves the original table untouched.
 */
async function rebuildTable(db, { table, cols, defaults }) {
  const create = SCHEMA.find((s) => new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\b').test(s));
  if (!create) return;
  const tmp = table + '_realm_new';
  const ddl = create.replace('CREATE TABLE IF NOT EXISTS ' + table, 'CREATE TABLE ' + tmp);
  // Only copy columns the OLD table actually has. A column the old table lacks
  // is filled from the spec's `defaults` (realm_id always gets the default
  // realm). This used to substitute the realm id for ANY missing column, which
  // was only ever correct because realm_id was the sole one — the moment a
  // second new column appeared it would have written "default" into it.
  const info = await db.prepare('PRAGMA table_info(' + table + ')').all();
  const have = new Set((info.results || []).map((c) => String(c.name)));
  const fill = { realm_id: R, ...(defaults || {}) };
  const copy = cols.filter((c) => have.has(c));
  const select = cols.map((c) => (have.has(c) ? c
    : (fill[c] !== undefined ? `'${fill[c]}' AS ${c}` : `NULL AS ${c}`))).join(', ');
  if (!copy.length) return;
  await db.prepare('DROP TABLE IF EXISTS ' + tmp).run();
  await db.prepare(ddl).run();
  await db.prepare('INSERT OR IGNORE INTO ' + tmp + ' (' + cols.join(', ') + ') SELECT ' + select + ' FROM ' + table).run();
  await db.prepare('DROP TABLE ' + table).run();
  await db.prepare('ALTER TABLE ' + tmp + ' RENAME TO ' + table).run();
}

let schemaReady = false;

/** Tests only: forget that the schema was ensured, so a fresh DB re-runs it. */
export function resetSchemaCache() { schemaReady = false; }

/** Ensures the tables exist (once per instance). */
export async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  for (const stmt of SCHEMA) {
    await env.DB.prepare(stmt).run();
  }
  for (const alter of MIGRATIONS) {
    try { await env.DB.prepare(alter).run(); } catch (e) { /* already applied */ }
  }
  for (const spec of REBUILDS) {
    try {
      if (await needsRebuild(env.DB, spec.table)) await rebuildTable(env.DB, spec);
    } catch (e) { /* leave the original table in place */ }
  }
  schemaReady = true;
}

/** Reads a one-shot flag from sys_flags (null if unset). */
export async function getFlag(env, k) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT v FROM sys_flags WHERE k = ?').bind(k).first();
  return r ? r.v : null;
}
/** Sets a sys_flags value. */
export async function setFlag(env, k, v) {
  const db = await getDb(env);
  await db.prepare('INSERT INTO sys_flags (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(k, String(v)).run();
}

/** Returns the D1 binding (schema ensured), or throws a friendly error. */
export async function getDb(env) {
  if (!env.DB) {
    throw new Error('The shop database is not connected yet. An admin needs to finish the D1 setup (see docs/SETUP.md).');
  }
  await ensureSchema(env);
  return env.DB;
}

/**
 * Clears the transactional LOGS (sales + intake) for ONE realm. The inventory
 * catalog is kept (it's current state, not a log). Returns the counts cleared.
 */
export async function clearLogs(env, realmId) {
  const db = await getDb(env);
  const realm = String(realmId || DEFAULT_REALM_ID);
  const count = async (t) => (await db.prepare('SELECT COUNT(*) AS n FROM ' + t + ' WHERE realm_id = ?').bind(realm).first()).n;
  const sales = await count('sales');
  const intake = await count('intake');
  await db.batch([
    db.prepare('DELETE FROM sales WHERE realm_id = ?').bind(realm),
    db.prepare('DELETE FROM intake WHERE realm_id = ?').bind(realm),
  ]);
  return { sales, intake };
}

/** Gentle retention: delete one realm's sales + intake older than the cutoff. */
export async function purgeLogs(env, amount, unit, realmId) {
  const n = Math.max(1, Math.floor(Number(amount) || 0));
  const cutoff = new Date();
  if (unit === 'days') cutoff.setDate(cutoff.getDate() - n);
  else if (unit === 'weeks') cutoff.setDate(cutoff.getDate() - n * 7);
  else cutoff.setMonth(cutoff.getMonth() - n); // 'months' (default)
  const iso = cutoff.toISOString();
  const db = await getDb(env);
  const realm = String(realmId || DEFAULT_REALM_ID);
  const count = async (t) => (await db.prepare('SELECT COUNT(*) AS n FROM ' + t + ' WHERE realm_id = ? AND ts < ?').bind(realm, iso).first()).n;
  const sales = await count('sales');
  const intake = await count('intake');
  await db.batch([
    db.prepare('DELETE FROM sales WHERE realm_id = ? AND ts < ?').bind(realm, iso),
    db.prepare('DELETE FROM intake WHERE realm_id = ? AND ts < ?').bind(realm, iso),
  ]);
  return { sales, intake, cutoff: iso.slice(0, 10) };
}

/**
 * Full reset of ONE realm — wipes its operational data, keeping ONLY admin user
 * accounts and the reference DEFAULTS. Used to clear test/launch data for a
 * clean start. Irreversible (export a backup first).
 *
 * PRESERVED on purpose: `master_item` + `item_type` (the Master Item Index and
 * the tables it is divided into) and `hold_index` (the region list). Those are
 * curated reference data, not per-season records —
 * rebuilding them by hand after every reset would be painful, so a reset leaves
 * them intact. Clear them individually from their own admin screens if needed.
 *
 * Network settings and MOTD fall back to defaults on the next read.
 */
export async function resetAllData(env, realmId) {
  const db = await getDb(env);
  const realm = String(realmId || DEFAULT_REALM_ID);
  const CLEARED = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
    'discounts', 'shop_style', 'audit',
    'companies', 'master_settings', 'business_settings', 'motd_list'];
  const stmts = CLEARED.map((t) => db.prepare('DELETE FROM ' + t + ' WHERE realm_id = ?').bind(realm));
  // Keep admin accounts only; everyone else in this realm is removed.
  stmts.push(db.prepare("DELETE FROM users WHERE realm_id = ? AND lower(role) != 'admin'").bind(realm));
  await db.batch(stmts);
  const one = async (sql, ...b) => (await db.prepare(sql).bind(...b).first()).n || 0;
  return {
    reset: true,
    tablesCleared: CLEARED.length,
    adminsKept: await one("SELECT COUNT(*) AS n FROM users WHERE realm_id = ? AND lower(role) = 'admin'", realm),
    itemsKept: await one('SELECT COUNT(*) AS n FROM master_item WHERE realm_id = ?', realm),
    holdsKept: await one('SELECT COUNT(*) AS n FROM hold_index WHERE realm_id = ?', realm),
  };
}

/**
 * Renames a business across the D1 tables (part of a full company rename).
 * Scoped to one realm — two realms may hold the same business name, and a
 * rename in one must never touch the other.
 */
export async function renameBusinessData(env, oldName, newName, realmId) {
  if (!env.DB) return;
  await ensureSchema(env);
  const db = env.DB;
  const realm = String(realmId || DEFAULT_REALM_ID);
  await db.batch(BUSINESS_TABLES.map(([table, col]) => db
    .prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ? AND realm_id = ?`)
    .bind(newName, oldName, realm)));
}

/**
 * Moves a business and everything belonging to it into another realm — the fix
 * for someone picking the wrong realm when they registered. The caller checks
 * the name is free in the destination first.
 *
 * Transfers are deliberately NOT moved. A transfer row names two shops, and the
 * other end stays behind; dragging it across would leave one realm holding a
 * record of a shop it cannot see. transferCompany refuses the move while any
 * transfer is pending, and completed ones stay as history where they happened.
 */
export async function moveBusinessData(env, business, fromRealm, toRealm) {
  const db = await getDb(env);
  const from = String(fromRealm || DEFAULT_REALM_ID);
  const to = String(toRealm || DEFAULT_REALM_ID);
  if (from === to) return { moved: 0 };
  const tables = BUSINESS_TABLES.filter(([t]) => t !== 'transfers');
  await db.batch(tables.map(([table, col]) => db
    .prepare(`UPDATE ${table} SET realm_id = ? WHERE ${col} = ? AND realm_id = ?`)
    .bind(to, business, from)));
  return { moved: tables.length };
}

/** How many transfers still involve this business in this realm (any status). */
export async function countBusinessTransfers(env, business, realmId, pendingOnly) {
  const db = await getDb(env);
  const sql = 'SELECT COUNT(*) AS n FROM transfers WHERE realm_id = ? AND (from_business = ? OR to_business = ?)'
    + (pendingOnly ? " AND status = 'pending'" : '');
  const r = await db.prepare(sql).bind(String(realmId || DEFAULT_REALM_ID), business, business).first();
  return (r && r.n) || 0;
}
