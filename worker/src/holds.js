/**
 * The network-wide hold index. Now stored in D1 (`hold_index`) so the many hold
 * dropdowns don't hit Google Sheets. Seeded ONCE from the Core's
 * `index_Holds_Master` tab, then D1 is the source of truth (admins edit it from
 * Network Settings). Falls back to the classic nine if D1 is empty/unreachable.
 */
import { getDb, getFlag, setFlag } from './db.js';
import { readRange } from './sheets.js';
import { DEFAULT_HOLDS } from './ledger.js';

const SEED_FLAG = 'holds_seeded';
const LEGACY_SHEET = 'index_Holds_Master';

async function ensureSeeded(env) {
  if (await getFlag(env, SEED_FLAG)) return;
  const db = await getDb(env);
  let rows = [];
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${LEGACY_SHEET}!A2:A`);
  } catch (e) {
    return; // retry next call
  }
  const holds = (rows || []).map((r) => String(r[0] || '').trim()).filter(Boolean);
  if (holds.length) {
    await db.batch(holds.map((h) => db.prepare('INSERT INTO hold_index (name) VALUES (?)').bind(h)));
  }
  await setFlag(env, SEED_FLAG, '1');
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
  await setFlag(env, SEED_FLAG, '1'); // don't re-seed over an admin edit
  return holds;
}
