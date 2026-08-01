/**
 * A realm's hold index, stored in D1 (`hold_index`) so the many hold dropdowns
 * are a fast local read. If a realm has no holds yet it's seeded once from the
 * classic nine (DEFAULT_HOLDS); admins edit it from that realm's settings. Each
 * realm keeps its own map — a different server can have entirely different holds.
 */
import { getDb } from './db.js';
import { DEFAULT_HOLDS } from './ledger.js';

async function ensureSeeded(env, realmId) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hold_index WHERE realm_id = ?').bind(realmId).first();
  if (row && row.n > 0) return;
  await db.batch(DEFAULT_HOLDS.map((h) => db.prepare('INSERT INTO hold_index (realm_id, name) VALUES (?, ?)').bind(realmId, h)));
}

export async function readHolds(env, realmId) {
  try {
    await ensureSeeded(env, realmId);
    const db = await getDb(env);
    const { results } = await db.prepare('SELECT name FROM hold_index WHERE realm_id = ? ORDER BY ord').bind(realmId).all();
    const holds = (results || []).map((r) => String(r.name || '').trim()).filter(Boolean);
    return holds.length ? holds : DEFAULT_HOLDS.slice();
  } catch (e) {
    return DEFAULT_HOLDS.slice();
  }
}

/** Admin: replace the hold index with the given list (order preserved, de-duped). */
export async function writeHolds(env, list, realmId) {
  const db = await getDb(env);
  const seen = new Set();
  const holds = [];
  (list || []).forEach((h) => {
    const v = String(h || '').trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); holds.push(v); }
  });
  const stmts = [db.prepare('DELETE FROM hold_index WHERE realm_id = ?').bind(realmId)];
  holds.forEach((h) => stmts.push(db.prepare('INSERT INTO hold_index (realm_id, name) VALUES (?, ?)').bind(realmId, h)));
  await db.batch(stmts);
  return holds;
}
