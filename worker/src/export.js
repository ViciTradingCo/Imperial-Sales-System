/**
 * Full data export / import — the operator-controlled backup. Export collects
 * every D1 table into one JSON document (gzipped for download); import restores
 * them (wipe + reinsert) from that file after a failure. Admin-only.
 *
 * D1 is now the sole source of truth, so a snapshot captures the whole system
 * (registry included). Also home to the restore dry-run (previewImport) and the
 * owner-facing per-shop CSV export.
 */
import { getDb, REALM_TABLES } from './db.js';
import { parseSaleItems } from './sales.js';
import { readRealmPrefs } from './realm-prefs.js';

// Order matters only cosmetically; each table is independent. Includes the
// registry tables (users, companies, settings, MOTD) now that D1 is the sole
// source of truth — a backup captures the whole system.
const TABLES = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
  'discounts', 'shop_style', 'audit', 'master_item', 'item_type', 'hold_index', 'sys_flags',
  'users', 'companies', 'master_settings', 'business_settings', 'motd_list'];

const SAFE_COL = /^[a-z_][a-z0-9_]*$/i;

/**
 * A backup has a SCOPE.
 *
 *   • whole deployment (realmId omitted) — every table, every realm. What you
 *     want for disaster recovery.
 *   • one realm (realmId given)          — only that realm's rows. What you want
 *     before a risky change to one server, because restoring it cannot drag the
 *     other realms back in time with it.
 *
 * sys_flags is the exception: it is a flat key/value store with no realm_id, and
 * a realm-scoped backup deliberately skips it rather than carry another realm's
 * flags along. A whole-deployment backup includes it as before.
 */
function tablesFor(realmId) {
  if (!realmId) return TABLES;
  return TABLES.filter((t) => REALM_TABLES.includes(t));
}

export async function collectExport(env, realmId) {
  const db = await getDb(env);
  const realm = realmId ? String(realmId) : '';
  const data = {
    app: 'eec-ledger',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: realm ? 'realm' : 'all',
    realmId: realm || null,
    tables: {},
  };
  for (const t of tablesFor(realm)) {
    const { results } = realm
      ? await db.prepare('SELECT * FROM ' + t + ' WHERE realm_id = ?').bind(realm).all()
      : await db.prepare('SELECT * FROM ' + t).all();
    data.tables[t] = results || [];
  }
  return data;
}

/** The realm a restore will write into, and the tables it touches. */
function restoreScope(data, realmId) {
  // An explicit request wins; otherwise honour what the file says it is.
  const realm = realmId ? String(realmId) : (data.scope === 'realm' && data.realmId ? String(data.realmId) : '');
  return { realm, tables: tablesFor(realm) };
}

/**
 * Restores tables from an export document. Returns row counts.
 *
 * A realm-scoped restore replaces ONLY that realm's rows — every other realm is
 * left alone, which is the whole reason the scope exists. Incoming rows are
 * re-stamped with the destination realm, so a backup taken from one realm can be
 * restored into another (useful for cloning a server).
 */
export async function restoreImport(env, data, realmId) {
  if (!data || data.app !== 'eec-ledger' || !data.tables) {
    throw new Error('That doesn’t look like a Vici backup file.');
  }
  const db = await getDb(env);
  const { realm, tables } = restoreScope(data, realmId);
  const counts = {};
  for (const t of tables) {
    const rows = data.tables[t];
    if (!Array.isArray(rows)) continue;
    const stmts = [realm
      ? db.prepare('DELETE FROM ' + t + ' WHERE realm_id = ?').bind(realm)
      : db.prepare('DELETE FROM ' + t)];
    for (const row of rows) {
      const source = realm ? { ...row, realm_id: realm } : row;
      const cols = Object.keys(source).filter((c) => SAFE_COL.test(c));
      if (!cols.length) continue;
      const sql = 'INSERT INTO ' + t + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')';
      stmts.push(db.prepare(sql).bind(...cols.map((c) => source[c])));
    }
    await db.batch(stmts);
    counts[t] = Math.max(0, stmts.length - 1);
  }
  return { restored: counts, scope: realm ? 'realm' : 'all', realmId: realm || null };
}

/**
 * Restore dry-run — reports, per table, the current row count vs. the count in
 * the supplied backup, WITHOUT changing anything. Lets an admin sanity-check a
 * file before the destructive restore, including whether it is about to replace
 * one realm or the whole deployment.
 */
export async function previewImport(env, data, realmId) {
  if (!data || data.app !== 'eec-ledger' || !data.tables) {
    throw new Error('That doesn’t look like a Vici backup file.');
  }
  const db = await getDb(env);
  const { realm, tables } = restoreScope(data, realmId);
  const diff = {};
  let currentTotal = 0, incomingTotal = 0;
  for (const t of tables) {
    const incoming = Array.isArray(data.tables[t]) ? data.tables[t].length : 0;
    const cur = realm
      ? (await db.prepare('SELECT COUNT(*) AS n FROM ' + t + ' WHERE realm_id = ?').bind(realm).first()).n || 0
      : (await db.prepare('SELECT COUNT(*) AS n FROM ' + t).first()).n || 0;
    diff[t] = { current: cur, incoming };
    currentTotal += cur; incomingTotal += incoming;
  }
  return {
    diff, currentTotal, incomingTotal,
    exportedAt: data.exportedAt || null,
    scope: realm ? 'realm' : 'all',
    realmId: realm || null,
    fileScope: data.scope || 'all',
  };
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
export async function businessCsv(env, business, type, realmId) {
  const db = await getDb(env);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(business || 'shop').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'shop';
  let cols, rows;
  if (type === 'coffer') {
    cols = ['ts', 'kind', 'amount', 'note'];
    ({ results: rows } = await db.prepare('SELECT ts, kind, amount, note FROM coffer_entries WHERE realm_id = ? AND business = ? ORDER BY id').bind(realmId, business).all());
  } else {
    cols = ['order_no', 'ts', 'customer', 'hold', 'items', 'qty_total', 'total', 'employee', 'discount', 'status'];
    ({ results: rows } = await db.prepare('SELECT order_no, ts, customer, hold, items, qty_total, total, employee, discount, status FROM sales WHERE realm_id = ? AND business = ? ORDER BY id').bind(realmId, business).all());
    // Sale lines are stored as data; a spreadsheet wants them readable, so they
    // are rendered here in this realm's denomination.
    const { currency } = await readRealmPrefs(env, realmId);
    rows = (rows || []).map((r) => ({
      ...r,
      items: parseSaleItems(r.items).lines.map((l) => l.name + ' x' + l.qty + ' @ ' + l.price + currency).join(', ')
        || r.items,
    }));
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
