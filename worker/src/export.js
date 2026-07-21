/**
 * Full data export / import — the operator-controlled backup. Export collects
 * every D1 table into one JSON document (gzipped for download); import restores
 * them (wipe + reinsert) from that file after a failure. Admin-only.
 *
 * D1 is now the sole source of truth, so a snapshot captures the whole system
 * (registry included). Also home to the restore dry-run (previewImport) and the
 * owner-facing per-shop CSV export.
 */
import { getDb } from './db.js';

// Order matters only cosmetically; each table is independent. Includes the
// registry tables (users, companies, settings, MOTD) now that D1 is the sole
// source of truth — a backup captures the whole system.
const TABLES = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
  'discounts', 'shop_style', 'audit', 'master_item', 'hold_index', 'sys_flags',
  'users', 'companies', 'master_settings', 'business_settings', 'motd_list'];

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

/**
 * Restore dry-run — reports, per table, the current row count vs. the count in
 * the supplied backup, WITHOUT changing anything. Lets an admin sanity-check a
 * file before the destructive restore.
 */
export async function previewImport(env, data) {
  if (!data || data.app !== 'eec-ledger' || !data.tables) {
    throw new Error('That doesn’t look like an EEC backup file.');
  }
  const db = await getDb(env);
  const diff = {};
  let currentTotal = 0, incomingTotal = 0;
  for (const t of TABLES) {
    const incoming = Array.isArray(data.tables[t]) ? data.tables[t].length : 0;
    const cur = (await db.prepare('SELECT COUNT(*) AS n FROM ' + t).first()).n || 0;
    diff[t] = { current: cur, incoming };
    currentTotal += cur; incomingTotal += incoming;
  }
  return { diff, currentTotal, incomingTotal, exportedAt: data.exportedAt || null };
}

/** CSV-quotes a value (wraps in quotes, doubles embedded quotes). */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Owner-facing per-shop CSV export. type='sales' → this shop's sales log;
 * type='coffer' → its coffer ledger. Returns { filename, csv }.
 */
export async function businessCsv(env, business, type) {
  const db = await getDb(env);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(business || 'shop').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'shop';
  let cols, rows;
  if (type === 'coffer') {
    cols = ['ts', 'kind', 'amount', 'note'];
    ({ results: rows } = await db.prepare('SELECT ts, kind, amount, note FROM coffer_entries WHERE business = ? ORDER BY id').bind(business).all());
  } else {
    cols = ['order_no', 'ts', 'customer', 'hold', 'items', 'qty_total', 'total', 'employee', 'discount', 'status'];
    ({ results: rows } = await db.prepare('SELECT order_no, ts, customer, hold, items, qty_total, total, employee, discount, status FROM sales WHERE business = ? ORDER BY id').bind(business).all());
  }
  const lines = [cols.join(',')];
  (rows || []).forEach((r) => lines.push(cols.map((c) => csvCell(r[c])).join(',')));
  return { filename: slug + '-' + (type === 'coffer' ? 'coffer' : 'sales') + '-' + stamp + '.csv', csv: lines.join('\n') };
}

/** Gzips a JS object; returns an ArrayBuffer suitable for a file download. */
export async function gzipJson(obj) {
  const body = new Response(JSON.stringify(obj)).body.pipeThrough(new CompressionStream('gzip'));
  return await new Response(body).arrayBuffer();
}
