/**
 * Coffers — a shop's treasury ledger (D1). Balance is SUM(amount): sales credit
 * it, intake and withdrawals debit it, deposits credit it. Sale/intake/void
 * entries are written inside those operations' own atomic batches (see
 * sales.js / intake.js); this module owns the balance, the history, and manual
 * adjustments.
 *
 * Every query is realm-scoped: two realms may both have a shop of the same
 * name, and their coffers are entirely separate ledgers.
 */
import { getDb } from './db.js';
import { coin } from './money.js';
import { tsWindow } from './history.js';

export async function cofferBalance(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS bal FROM coffer_entries WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).first();
  return r ? r.bal : 0;
}

/**
 * WHICH ENTRIES A LOOKUP MEANS — one WHERE for the page and for its count.
 *
 * The note is what a coffer is searched BY. Every line carries one — what the
 * money was for — and it is the only part of an entry written in words, so
 * "find where that eighty went" is a question about the note and nothing else.
 * The kind is matched too, so "wage" or "delivery" finds those lines without
 * anybody having to know they are a `kind` rather than a note.
 */
function cofferWhere(business, realmId, query, from, to) {
  const q = String(query || '').trim().toLowerCase();
  const like = '%' + q + '%';
  const win = tsWindow('ts', from, to);
  return {
    sql: 'realm_id = ? AND business = ?' +
      (q ? ' AND (lower(COALESCE(note, \'\')) LIKE ? OR lower(kind) LIKE ?)' : '') + win.sql,
    binds: [realmId, business, ...(q ? [like, like] : []), ...win.binds],
  };
}

async function listCofferEntries(env, business, realmId, opts = {}) {
  const db = await getDb(env);
  const w = cofferWhere(business, realmId, opts.q, opts.from, opts.to);
  const { results } = await db.prepare(
    `SELECT ts, kind, amount, note FROM coffer_entries WHERE ${w.sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...w.binds, Math.max(1, opts.limit || 30), Math.max(0, opts.offset || 0)).all();
  return results || [];
}

/** How many entries that same lookup matches — what the pager counts from. */
export async function countCofferEntries(env, business, realmId, opts = {}) {
  const db = await getDb(env);
  const w = cofferWhere(business, realmId, opts.q, opts.from, opts.to);
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM coffer_entries WHERE ${w.sql}`).bind(...w.binds).first();
  return Number((r && r.n) || 0);
}

/**
 * The coffer: the balance, and a page of what moved it.
 *
 * THE BALANCE IS ALWAYS THE WHOLE COFFER, never the filtered rows. It is what
 * the shop HAS, and a figure that changed when somebody narrowed the list to
 * March would be answering a question nobody asked — and would read as money
 * having gone missing.
 */
export async function cofferSummary(env, business, realmId, opts = {}) {
  return {
    balance: await cofferBalance(env, business, realmId),
    entries: await listCofferEntries(env, business, realmId, opts),
  };
}

/** Owner/admin manual adjustment — positive deposits, negative withdraws. */
export async function adjustCoffer(env, business, { amount, note }, realmId) {
  const n = Number(amount);
  if (!isFinite(n) || n === 0) throw new Error('Enter a non-zero amount (negative to withdraw).');
  // Whole coins only, rounded down, like every other amount the ledger holds.
  const whole = coin(n);
  if (whole === 0) throw new Error('That rounds to nothing — amounts are whole coins.');
  const db = await getDb(env);
  await db.prepare('INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(realmId, business, new Date().toISOString(), whole > 0 ? 'deposit' : 'withdrawal', whole, String(note || '').trim()).run();
  return cofferSummary(env, business, realmId);
}
