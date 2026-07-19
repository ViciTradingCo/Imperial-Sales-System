/**
 * D1 (Cloudflare SQLite) access — the live transactional store for inventory,
 * sales, and intake. The binding is `env.DB` (configured in wrangler.toml once
 * the D1 database exists). Until then, requireDb throws a friendly error so the
 * rest of the app keeps working and the UI can explain what's missing.
 */
export function hasDb(env) {
  return !!env.DB;
}

export function requireDb(env) {
  if (!env.DB) {
    throw new Error('The shop database is not connected yet. An admin needs to finish the D1 setup (see docs/SETUP.md).');
  }
  return env.DB;
}

/** Renames a business across the D1 tables (part of a full company rename). */
export async function renameBusinessData(env, oldName, newName) {
  if (!env.DB) return;
  const db = env.DB;
  await db.batch([
    db.prepare('UPDATE inventory SET business = ? WHERE business = ?').bind(newName, oldName),
    db.prepare('UPDATE sales SET business = ? WHERE business = ?').bind(newName, oldName),
    db.prepare('UPDATE intake SET business = ? WHERE business = ?').bind(newName, oldName),
  ]);
}
