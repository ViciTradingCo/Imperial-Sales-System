/**
 * The admin System Status panel: a D1 health snapshot (row counts + recent
 * activity) plus a rolling log of recent internal errors (observability).
 *
 * Errors are kept in sys_flags as a small JSON ring buffer so they survive
 * isolate recycling without a new table. An optional Discord webhook
 * (DISCORD_WEBHOOK_URL) can be notified of each new error in the future — the
 * plumbing lives here so it's a one-line switch to turn on.
 */
import { getDb, getFlag, setFlag } from './db.js';

const TABLES = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
  'discounts', 'master_item', 'hold_index', 'audit', 'users', 'companies'];

const ERR_KEY = 'recent_errors';
const ERR_MAX = 25;

/** Records an internal error to the rolling buffer (and, if configured, Discord). */
export async function recordError(env, where, message) {
  try {
    const raw = await getFlag(env, ERR_KEY);
    let list = [];
    try { list = raw ? JSON.parse(raw) : []; } catch (e) { list = []; }
    list.unshift({ ts: new Date().toISOString(), where: String(where || '').slice(0, 120), message: String(message || '').slice(0, 300) });
    if (list.length > ERR_MAX) list = list.slice(0, ERR_MAX);
    await setFlag(env, ERR_KEY, JSON.stringify(list));
  } catch (e) { /* observability must never break the request path */ }
  await notifyDiscord(env, where, message);
}

/** Optional: ping a Discord webhook. No-op unless DISCORD_WEBHOOK_URL is set. */
async function notifyDiscord(env, where, message) {
  const hook = String(env.DISCORD_WEBHOOK_URL || '').trim();
  if (!hook) return;
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '⚠️ EEC API error at `' + String(where || '') + '`: ' + String(message || '').slice(0, 300) }),
    });
  } catch (e) { /* best-effort */ }
}

/** Reads the recent-errors buffer (newest first). */
export async function recentErrors(env) {
  const raw = await getFlag(env, ERR_KEY);
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

export async function systemStatus(env) {
  const db = await getDb(env);
  const counts = {};
  for (const t of TABLES) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM ' + t).first();
    counts[t] = r ? r.n : 0;
  }
  const lastSale = await db.prepare('SELECT ts FROM sales ORDER BY id DESC LIMIT 1').first();
  const lastAudit = await db.prepare('SELECT ts FROM audit ORDER BY id DESC LIMIT 1').first();
  return {
    counts,
    lastSale: lastSale ? lastSale.ts : null,
    lastAudit: lastAudit ? lastAudit.ts : null,
    errors: await recentErrors(env),
    discordConfigured: !!String(env.DISCORD_WEBHOOK_URL || '').trim(),
  };
}
