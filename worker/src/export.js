/**
 * Full data export / import — the operator-controlled backup that replaces the
 * old D1→Sheets mirror. Export collects every D1 table into one JSON document
 * (gzipped for download); import restores them (wipe + reinsert) from that file
 * after a system failure. Admin-only.
 *
 * Scope is the D1 store (the app's volatile operational data — the real loss
 * risk). The Google Sheets registry has its own version history and durability.
 */
import { getDb } from './db.js';

// Order matters only cosmetically; each table is independent.
const TABLES = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
  'discounts', 'shop_style', 'audit', 'master_item', 'hold_index', 'sys_flags'];

const SAFE_COL = /^[a-z_][a-z0-9_]*$/i;

export async function collectExport(env) {
  const db = await getDb(env);
  const data = { app: 'eec-ledger', version: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const { results } = await db.prepare('SELECT * FROM ' + t).all();
    data.tables[t] = results || [];
  }
  return data;
}

/** Restores tables from an export document (full replace). Returns row counts. */
export async function restoreImport(env, data) {
  if (!data || data.app !== 'eec-ledger' || !data.tables) {
    throw new Error('That doesn’t look like an EEC backup file.');
  }
  const db = await getDb(env);
  const counts = {};
  for (const t of TABLES) {
    const rows = data.tables[t];
    if (!Array.isArray(rows)) continue;
    const stmts = [db.prepare('DELETE FROM ' + t)];
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => SAFE_COL.test(c));
      if (!cols.length) continue;
      const sql = 'INSERT INTO ' + t + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')';
      stmts.push(db.prepare(sql).bind(...cols.map((c) => row[c])));
    }
    await db.batch(stmts);
    counts[t] = Math.max(0, stmts.length - 1);
  }
  return { restored: counts };
}

/** Gzips a JS object; returns an ArrayBuffer suitable for a file download. */
export async function gzipJson(obj) {
  const body = new Response(JSON.stringify(obj)).body.pipeThrough(new CompressionStream('gzip'));
  return await new Response(body).arrayBuffer();
}
