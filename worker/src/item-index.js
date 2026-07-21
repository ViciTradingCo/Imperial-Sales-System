/**
 * The Master Item Index — the shared item library (canonical name + base value).
 *
 * Now stored in D1 (`master_item`) so the register and market don't hit Google
 * Sheets on hot paths. On first use it seeds itself ONCE from the Core's
 * `index_Items_Master` tab (the original data), then D1 is the source of truth.
 *
 * Also home to the fuzzy matcher that normalizes a typed item name to its
 * canonical master entry, so typos and stray spacing don't fragment the data.
 */
import { getDb, getFlag, setFlag } from './db.js';
import { readRange } from './sheets.js';

const SEED_FLAG = 'items_seeded';
const LEGACY_SHEET = 'index_Items_Master';

/** One-shot migration: copy the Core's item tab into D1 the first time. */
async function ensureSeeded(env) {
  if (await getFlag(env, SEED_FLAG)) return;
  const db = await getDb(env);
  let rows = [];
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${LEGACY_SHEET}!A2:B`);
  } catch (e) {
    return; // Sheets unreachable — retry seeding next call (flag stays unset).
  }
  const items = (rows || []).filter((r) => String(r[0] || '').trim());
  if (items.length) {
    await db.batch(items.map((r) =>
      db.prepare('INSERT INTO master_item (name, base_value) VALUES (?, ?) ON CONFLICT(name) DO NOTHING')
        .bind(String(r[0]).trim(), Number(r[1]) || 0)));
  }
  await setFlag(env, SEED_FLAG, '1');
}

export async function listItemIndex(env) {
  await ensureSeeded(env);
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT name, base_value FROM master_item ORDER BY name').all();
  return (results || []).map((r) => ({ name: r.name, baseValue: Number(r.base_value) || 0 }));
}

/** Add a new item or edit an existing one (rename via oldName). */
export async function upsertItem(env, { name, baseValue, oldName }) {
  await ensureSeeded(env);
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Enter an item name.');
  const val = Number(baseValue);
  if (!isFinite(val) || val < 0) throw new Error('Base value must be a number ≥ 0.');
  const db = await getDb(env);
  const clash = await db.prepare('SELECT name FROM master_item WHERE lower(name) = ? AND lower(name) != ?')
    .bind(nm.toLowerCase(), String(oldName || '').toLowerCase()).first();
  if (clash) throw new Error('An item named "' + nm + '" already exists.');
  if (oldName && oldName !== nm) await db.prepare('DELETE FROM master_item WHERE name = ?').bind(oldName).run();
  await db.prepare('INSERT INTO master_item (name, base_value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET base_value = excluded.base_value')
    .bind(nm, val).run();
  return listItemIndex(env);
}

/**
 * Bulk upsert from a pasted list. Each row: { name, baseValue }. Matching is by
 * NORMALIZED name (case / spacing / punctuation-insensitive), so recognized
 * items are UPDATED, not duplicated: the base value is set, and the canonical
 * spelling is corrected to the pasted name when it differs. Unrecognized names
 * are added. Rows with a non-numeric value (e.g. a header) are skipped.
 *
 * Matching is deliberately exact-after-normalization (not fuzzy) so a genuine
 * typo becomes a new item rather than silently overwriting a real one's name.
 */
export async function importItemIndex(env, rows) {
  await ensureSeeded(env);
  const db = await getDb(env);
  const byNorm = new Map((await listItemIndex(env)).map((it) => [normalizeItem(it.name), it]));
  const stmts = [];
  let imported = 0;
  (rows || []).forEach((r) => {
    const name = String(r.name || '').trim();
    if (!name) return;
    const val = Number(r.baseValue);
    if (!isFinite(val) || val < 0) return; // skip headers / bad rows
    const norm = normalizeItem(name);
    const hit = byNorm.get(norm);
    if (hit && hit.name !== name) {
      stmts.push(db.prepare('DELETE FROM master_item WHERE name = ?').bind(hit.name)); // rename
    }
    stmts.push(db.prepare(
      'INSERT INTO master_item (name, base_value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET base_value = excluded.base_value')
      .bind(name, val));
    byNorm.set(norm, { name, baseValue: val }); // dedupe within the same paste
    imported++;
  });
  if (stmts.length) await db.batch(stmts);
  return { imported, items: await listItemIndex(env) };
}

export async function deleteItemIndex(env, name) {
  await ensureSeeded(env);
  const db = await getDb(env);
  await db.prepare('DELETE FROM master_item WHERE lower(name) = ?').bind(String(name || '').trim().toLowerCase()).run();
  return listItemIndex(env);
}

/* ---- fuzzy matching (typo / grammar tolerance) ---- */

/** Loose normalization: lowercase, strip punctuation, collapse whitespace. */
export function normalizeItem(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Resolves a typed item name to its canonical master entry, tolerating typos and
 * spacing/grammar drift. Returns the master {name, baseValue} or null if there's
 * no confident match (i.e. a genuinely new item).
 */
export function matchMasterItem(name, master) {
  const target = normalizeItem(name);
  if (!target) return null;
  let best = null, bestDist = Infinity;
  for (const it of master) {
    const cand = normalizeItem(it.name);
    if (cand === target) return it; // exact (normalized) hit
    const d = levenshtein(target, cand);
    if (d < bestDist) { bestDist = d; best = it; }
  }
  if (!best) return null;
  const L = target.length;
  const allowed = L <= 4 ? 1 : L <= 8 ? 2 : 3;
  return bestDist <= allowed ? best : null;
}
