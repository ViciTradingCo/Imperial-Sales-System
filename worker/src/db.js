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
     employee TEXT, discount TEXT, status TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_sales_business ON sales (business)`,
  `CREATE TABLE IF NOT EXISTS intake (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     business TEXT NOT NULL, ts TEXT NOT NULL, item TEXT, vendor TEXT,
     source_hold TEXT, num_items INTEGER NOT NULL DEFAULT 0,
     price_per REAL NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_business ON intake (business)`,
];

let schemaReady = false;

export function hasDb(env) {
  return !!env.DB;
}

/** Ensures the tables exist (once per instance). */
export async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  for (const stmt of SCHEMA) {
    await env.DB.prepare(stmt).run();
  }
  schemaReady = true;
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

/** Renames a business across the D1 tables (part of a full company rename). */
export async function renameBusinessData(env, oldName, newName) {
  if (!env.DB) return;
  await ensureSchema(env);
  const db = env.DB;
  await db.batch([
    db.prepare('UPDATE inventory SET business = ? WHERE business = ?').bind(newName, oldName),
    db.prepare('UPDATE sales SET business = ? WHERE business = ?').bind(newName, oldName),
    db.prepare('UPDATE intake SET business = ? WHERE business = ?').bind(newName, oldName),
  ]);
}
