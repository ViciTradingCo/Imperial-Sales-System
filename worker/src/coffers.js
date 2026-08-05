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

export async function cofferBalance(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS bal FROM coffer_entries WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).first();
  return r ? r.bal : 0;
}

async function listCofferEntries(env, business, realmId, limit = 30) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT ts, kind, amount, note FROM coffer_entries WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?')
    .bind(realmId, business, limit).all();
  return results || [];
}

export async function cofferSummary(env, business, realmId) {
  return {
    balance: await cofferBalance(env, business, realmId),
    entries: await listCofferEntries(env, business, realmId),
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
