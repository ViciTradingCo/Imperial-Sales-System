/**
 * D1 (Cloudflare SQLite) access — the live transactional store for inventory,
 * sales, and intake. The binding is `env.DB`.
 *
 * The schema is ensured in-code (idempotent CREATE TABLE IF NOT EXISTS), so a
 * freshly-created D1 database works without a separate migration step. It runs
 * at most once per Worker instance.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     business TEXT NOT NULL, item TEXT NOT NULL,
     price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
     low_stock INTEGER NOT NULL DEFAULT 0,
     UNIQUE (business, item))`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_business ON inventory (business)`,
  `CREATE TABLE IF NOT EXISTS sales (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
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
     business TEXT NOT NULL, ts TEXT NOT NULL, item TEXT, vendor TEXT,
     source_hold TEXT, num_items INTEGER NOT NULL DEFAULT 0,
     price_per REAL NOT NULL DEFAULT 0, idem TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_business ON intake (business)`,
  `CREATE TABLE IF NOT EXISTS transfers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
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
     business TEXT NOT NULL, ts TEXT NOT NULL,
     kind TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_coffer_business ON coffer_entries (business)`,
  // Reusable named discounts per shop.
  `CREATE TABLE IF NOT EXISTS discounts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     business TEXT NOT NULL, name TEXT NOT NULL, percent REAL NOT NULL DEFAULT 0,
     UNIQUE (business, name))`,
  `CREATE INDEX IF NOT EXISTS idx_discounts_business ON discounts (business)`,
  // Per-shop style (tagline + accent colour), one row per business.
  `CREATE TABLE IF NOT EXISTS shop_style (
     business TEXT PRIMARY KEY, tagline TEXT, accent TEXT)`,
  // Audit trail of significant admin/owner actions.
  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL, actor TEXT, actor_business TEXT, action TEXT NOT NULL, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (id DESC)`,
  // Config indexes moved off Sheets onto D1 (hot paths: checkout, market, hold
  // dropdowns). Seeded once from the Core's index tabs (see item-index.js /
  // holds.js), then D1 is the source of truth.
  `CREATE TABLE IF NOT EXISTS master_item (name TEXT PRIMARY KEY, base_value REAL NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS hold_index (ord INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`,
  // Small key/value store for global MOTD, config values, checkout idempotency, etc.
  `CREATE TABLE IF NOT EXISTS sys_flags (k TEXT PRIMARY KEY, v TEXT)`,
  // ---- Registry (formerly Google Sheets; now D1 is the sole source of truth) ----
  // Who's registered: identity, role, and business. char_name / notes avoid the
  // SQLite keyword `character`.
  `CREATE TABLE IF NOT EXISTS users (
     uid TEXT PRIMARY KEY, email TEXT NOT NULL, business TEXT,
     role TEXT NOT NULL DEFAULT 'employee', is_owner INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active', char_name TEXT, notes TEXT,
     created TEXT, last_seen TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_business ON users (business)`,
  // Registered businesses + their Vici Trading Co. certification (subscription).
  `CREATE TABLE IF NOT EXISTS companies (
     id TEXT PRIMARY KEY, business TEXT NOT NULL, point_of_contact TEXT,
     until TEXT, perpetual INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '',
     hold TEXT, court INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_companies_business ON companies (business)`,
  // Network Master Settings (label → value); schema/defaults live in settings.js.
  `CREATE TABLE IF NOT EXISTS master_settings (label TEXT PRIMARY KEY, value REAL)`,
  // Per-shop settings (business + label → value); schema lives in business-settings.js.
  `CREATE TABLE IF NOT EXISTS business_settings (
     business TEXT NOT NULL, label TEXT NOT NULL, value REAL,
     PRIMARY KEY (business, label))`,
  // Individual (per-business, scheduled) MOTD messages. start_at/end_at avoid
  // the SQLite keyword `end`.
  `CREATE TABLE IF NOT EXISTS motd_list (
     id TEXT PRIMARY KEY, business TEXT, message TEXT, start_at TEXT, end_at TEXT)`,
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

/** The realm existing (pre-multi-realm) data belongs to. */
export const DEFAULT_REALM_ID = 'default';

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
  // rows land in the 'default' realm automatically — no backfill needed.
  ...REALM_TABLES.map((t) => `ALTER TABLE ${t} ADD COLUMN realm_id TEXT NOT NULL DEFAULT '${DEFAULT_REALM_ID}'`),
  ...REALM_TABLES.map((t) => `CREATE INDEX IF NOT EXISTS idx_${t}_realm ON ${t} (realm_id)`),
  // Per-realm uniqueness. The old global PRIMARY KEYs on master_item.name and
  // the composite keys elsewhere would stop two realms using the same item or
  // business name, so uniqueness is re-declared as (realm_id, key).
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_master_item_realm_name ON master_item (realm_id, name)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_realm_business ON companies (realm_id, business)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_realm_email ON users (realm_id, email)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_realm_item ON inventory (realm_id, business, item)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_master_settings_realm_label ON master_settings (realm_id, label)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_realm ON business_settings (realm_id, business, label)',
];

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
 * Clears the transactional LOGS (sales + intake) across the whole network. The
 * inventory catalog is kept (it's current state, not a log). Returns the counts
 * that were cleared.
 */
export async function clearLogs(env) {
  const db = await getDb(env);
  const sales = (await db.prepare('SELECT COUNT(*) AS n FROM sales').first()).n;
  const intake = (await db.prepare('SELECT COUNT(*) AS n FROM intake').first()).n;
  await db.batch([db.prepare('DELETE FROM sales'), db.prepare('DELETE FROM intake')]);
  return { sales, intake };
}

/** Gentle retention: delete sales + intake older than `months` months. */
export async function purgeLogs(env, amount, unit) {
  const n = Math.max(1, Math.floor(Number(amount) || 0));
  const cutoff = new Date();
  if (unit === 'days') cutoff.setDate(cutoff.getDate() - n);
  else if (unit === 'weeks') cutoff.setDate(cutoff.getDate() - n * 7);
  else cutoff.setMonth(cutoff.getMonth() - n); // 'months' (default)
  const iso = cutoff.toISOString();
  const db = await getDb(env);
  const sales = (await db.prepare('SELECT COUNT(*) AS n FROM sales WHERE ts < ?').bind(iso).first()).n;
  const intake = (await db.prepare('SELECT COUNT(*) AS n FROM intake WHERE ts < ?').bind(iso).first()).n;
  await db.batch([
    db.prepare('DELETE FROM sales WHERE ts < ?').bind(iso),
    db.prepare('DELETE FROM intake WHERE ts < ?').bind(iso),
  ]);
  return { sales, intake, cutoff: iso.slice(0, 10) };
}

/**
 * Full reset — wipes the operational data, keeping ONLY admin user accounts and
 * the reference DEFAULTS. Used to clear all test/launch data for a clean start.
 * Irreversible (export a backup first).
 *
 * PRESERVED on purpose: `master_item` (the Master Item Index) and `hold_index`
 * (the Holds list). Those are curated reference data, not per-season records —
 * rebuilding them by hand after every reset would be painful, so a reset leaves
 * them intact. Clear them individually from their own admin screens if needed.
 *
 * Network settings and MOTD fall back to defaults on the next read.
 */
export async function resetAllData(env) {
  const db = await getDb(env);
  const CLEARED = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
    'discounts', 'shop_style', 'audit', 'sys_flags',
    'companies', 'master_settings', 'business_settings', 'motd_list'];
  const stmts = CLEARED.map((t) => db.prepare('DELETE FROM ' + t));
  // Keep admin accounts only; everyone else is removed.
  stmts.push(db.prepare("DELETE FROM users WHERE lower(role) != 'admin'"));
  await db.batch(stmts);
  const admins = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE lower(role) = 'admin'").first()).n || 0;
  const items = (await db.prepare('SELECT COUNT(*) AS n FROM master_item').first()).n || 0;
  const holds = (await db.prepare('SELECT COUNT(*) AS n FROM hold_index').first()).n || 0;
  return { reset: true, tablesCleared: CLEARED.length, adminsKept: admins, itemsKept: items, holdsKept: holds };
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
  const rename = (table, col) => db
    .prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ? AND realm_id = ?`)
    .bind(newName, oldName, realm);
  await db.batch([
    rename('inventory', 'business'),
    rename('sales', 'business'),
    rename('intake', 'business'),
    rename('transfers', 'from_business'),
    rename('transfers', 'to_business'),
    rename('coffer_entries', 'business'),
    rename('discounts', 'business'),
    rename('shop_style', 'business'),
    // Registry tables (now D1): the company row, its members, and its settings.
    rename('companies', 'business'),
    rename('users', 'business'),
    rename('business_settings', 'business'),
  ]);
}
