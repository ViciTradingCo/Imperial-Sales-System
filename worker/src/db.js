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

// Inlined into DDL text below; kept as its own name so the DDL reads clearly.
const R = DEFAULT_REALM_ID;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, item TEXT NOT NULL,
     price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
     low_stock INTEGER NOT NULL DEFAULT 0,
     UNIQUE (realm_id, business, item))`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_business ON inventory (business)`,
  `CREATE TABLE IF NOT EXISTS sales (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, ts TEXT NOT NULL, order_no TEXT NOT NULL,
     customer TEXT, hold TEXT, items TEXT,
     qty_total INTEGER NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
     employee TEXT, discount TEXT, status TEXT NOT NULL DEFAULT '', idem TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_business ON sales (business)`,
  // NOTE: the idx_sales_idem index references the `idem` column, which is added
  // by an ALTER migration on pre-existing DBs — so it's created in MIGRATIONS,
  // AFTER that column exists, not here.
  `CREATE TABLE IF NOT EXISTS intake (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, ts TEXT NOT NULL, item TEXT, vendor TEXT,
     source_hold TEXT, num_items INTEGER NOT NULL DEFAULT 0,
     price_per REAL NOT NULL DEFAULT 0, idem TEXT)`,
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
  `CREATE TABLE IF NOT EXISTS master_item (
     realm_id TEXT NOT NULL DEFAULT '${R}',
     name TEXT NOT NULL, base_value REAL NOT NULL DEFAULT 0,
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
     created TEXT, last_seen TEXT, active_realm TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_business ON users (business)`,
  // Registered businesses + their Vici Trading Co. certification (subscription).
  `CREATE TABLE IF NOT EXISTS companies (
     id TEXT PRIMARY KEY,
     realm_id TEXT NOT NULL DEFAULT '${R}',
     business TEXT NOT NULL, point_of_contact TEXT,
     until TEXT, perpetual INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '',
     hold TEXT, court INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0)`,
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
  // ---- Realms (multi-tenancy) ----
  // One deployment can host several independent RP servers. Every data table
  // carries a realm_id and queries filter on it, so nothing is ever shared or
  // cross-referenced between realms. See realm.js.
  `CREATE TABLE IF NOT EXISTS realms (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, created TEXT)`,
];

/** Every table that holds realm-owned data (all get a realm_id column). */
export const REALM_TABLES = [
  'inventory', 'sales', 'intake', 'transfers', 'coffer_entries', 'discounts',
  'shop_style', 'audit', 'master_item', 'hold_index', 'users', 'companies',
  'master_settings', 'business_settings', 'motd_list',
];

/**
 * The per-business tables — every table whose rows belong to ONE shop, and the
 * column naming it. Moving or renaming a business walks exactly this list, so a
 * new per-shop table only has to be added here.
 */
export const BUSINESS_TABLES = [
  ['inventory', 'business'], ['sales', 'business'], ['intake', 'business'],
  ['transfers', 'from_business'], ['transfers', 'to_business'],
  ['coffer_entries', 'business'], ['discounts', 'business'], ['shop_style', 'business'],
  ['companies', 'business'], ['users', 'business'], ['business_settings', 'business'],
  ['motd_list', 'business'],
];

// Additive migrations for databases created before a column existed. Each runs
// best-effort and IN ORDER; "duplicate column" on an already-migrated DB is
// ignored. The idem index comes AFTER its column is guaranteed to exist.
const MIGRATIONS = [
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
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_realm_business ON companies (realm_id, business)',
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
  { table: 'master_item', cols: ['realm_id', 'name', 'base_value'] },
  { table: 'inventory', cols: ['realm_id', 'business', 'item', 'price', 'stock', 'low_stock'] },
  { table: 'discounts', cols: ['realm_id', 'business', 'name', 'percent'] },
];

/** True when the live table definition already carries realm_id in its key. */
async function needsRebuild(db, table) {
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first();
  if (!row || !row.sql) return false; // table absent — SCHEMA will create it correctly
  return !/realm_id/i.test(row.sql);
}

/**
 * Rebuilds one table: the new definition comes from SCHEMA, so there is a single
 * source of truth for what the table should look like. Rows are copied with
 * realm_id defaulting to the default realm (which is where all pre-realm data
 * belongs). Best-effort — a failure leaves the original table untouched.
 */
async function rebuildTable(db, { table, cols }) {
  const create = SCHEMA.find((s) => new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\b').test(s));
  if (!create) return;
  const tmp = table + '_realm_new';
  const ddl = create.replace('CREATE TABLE IF NOT EXISTS ' + table, 'CREATE TABLE ' + tmp);
  // Only copy columns the OLD table actually has; realm_id gets the default.
  const info = await db.prepare('PRAGMA table_info(' + table + ')').all();
  const have = new Set((info.results || []).map((c) => String(c.name)));
  const copy = cols.filter((c) => have.has(c));
  const select = cols.map((c) => (have.has(c) ? c : `'${R}' AS ${c}`)).join(', ');
  if (!copy.length) return;
  await db.prepare('DROP TABLE IF EXISTS ' + tmp).run();
  await db.prepare(ddl).run();
  await db.prepare('INSERT OR IGNORE INTO ' + tmp + ' (' + cols.join(', ') + ') SELECT ' + select + ' FROM ' + table).run();
  await db.prepare('DROP TABLE ' + table).run();
  await db.prepare('ALTER TABLE ' + tmp + ' RENAME TO ' + table).run();
}

let schemaReady = false;

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
 * PRESERVED on purpose: `master_item` (the Master Item Index) and `hold_index`
 * (the Holds list). Those are curated reference data, not per-season records —
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
