/**
 * The network-wide hold index, stored in D1 (`hold_index`) so the many hold
 * dropdowns are a fast local read. If the table is empty it's seeded once from
 * the classic nine (DEFAULT_HOLDS); admins edit it from Network Settings.
 */
import { getDb } from './db.js';
import { DEFAULT_HOLDS } from './ledger.js';

async function ensureSeeded(env) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hold_index').first();
  if (row && row.n > 0) return;
  await db.batch(DEFAULT_HOLDS.map((h) => db.prepare('INSERT INTO hold_index (name) VALUES (?)').bind(h)));
}

export async function readHolds(env) {
  try {
    await ensureSeeded(env);
    const db = await getDb(env);
    const { results } = await db.prepare('SELECT name FROM hold_index ORDER BY ord').all();
    const holds = (results || []).map((r) => String(r.name || '').trim()).filter(Boolean);
    return holds.length ? holds : DEFAULT_HOLDS.slice();
  } catch (e) {
    return DEFAULT_HOLDS.slice();
  }
}

/** Admin: replace the hold index with the given list (order preserved, de-duped). */
export async function writeHolds(env, list) {
  const db = await getDb(env);
  const seen = new Set();
  const holds = [];
  (list || []).forEach((h) => {
    const v = String(h || '').trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); holds.push(v); }
  });
  const stmts = [db.prepare('DELETE FROM hold_index')];
  holds.forEach((h) => stmts.push(db.prepare('INSERT INTO hold_index (name) VALUES (?)').bind(h)));
  await db.batch(stmts);
  return holds;
}
