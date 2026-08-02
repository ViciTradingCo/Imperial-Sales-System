/**
 * A realm's REGIONS — the named places it trades in — stored in D1 so the many
 * region dropdowns are a fast local read. A realm with none yet is seeded once
 * from the classic nine Skyrim holds; admins edit the list from that realm's
 * Network Settings. Each realm keeps its own, and names them whatever its
 * fiction calls them (Region, Hold, Province, Sector — see realm-prefs.js).
 *
 * The TABLE is still `hold_index` and the column on sales is still `hold`, from
 * when these were Skyrim holds specifically. Renaming them would be a data
 * migration for a cosmetic gain, so the storage keeps the old name and
 * everything above it says region.
 */
import { getDb } from './db.js';
import { DEFAULT_HOLDS } from './ledger.js';

async function ensureSeeded(env, realmId) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hold_index WHERE realm_id = ?').bind(realmId).first();
  if (row && row.n > 0) return;
  await db.batch(DEFAULT_HOLDS.map((h) => db.prepare('INSERT INTO hold_index (realm_id, name) VALUES (?, ?)').bind(realmId, h)));
}

export async function readRegions(env, realmId) {
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
export async function writeRegions(env, list, realmId) {
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
