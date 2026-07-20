/**
 * Coffers — a shop's treasury ledger (D1). Balance is SUM(amount): sales credit
 * it, intake and withdrawals debit it, deposits credit it. Sale/intake/void
 * entries are written inside those operations' own atomic batches (see
 * sales.js / intake.js); this module owns the balance, the history, and manual
 * adjustments.
 */
import { getDb } from './db.js';

export async function cofferBalance(env, business) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS bal FROM coffer_entries WHERE business = ?').bind(business).first();
  return r ? r.bal : 0;
}

export async function listCofferEntries(env, business, limit = 30) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT ts, kind, amount, note FROM coffer_entries WHERE business = ? ORDER BY id DESC LIMIT ?')
    .bind(business, limit).all();
  return results || [];
}

export async function cofferSummary(env, business) {
  return { balance: await cofferBalance(env, business), entries: await listCofferEntries(env, business) };
}

/** Owner/admin manual adjustment — positive deposits, negative withdraws. */
export async function adjustCoffer(env, business, { amount, note }) {
  const n = Number(amount);
  if (!isFinite(n) || n === 0) throw new Error('Enter a non-zero amount (negative to withdraw).');
  const db = await getDb(env);
  await db.prepare('INSERT INTO coffer_entries (business, ts, kind, amount, note) VALUES (?, ?, ?, ?, ?)')
    .bind(business, new Date().toISOString(), n > 0 ? 'deposit' : 'withdrawal', n, String(note || '').trim()).run();
  return cofferSummary(env, business);
}
