/**
 * The Master Item Index — the shared item library in the Core's
 * `index_Items_Master` tab (Item | Base Value). It is the source of truth for
 * canonical item names (proper grammar/capitalization) and base values that the
 * market is measured against.
 *
 * Also home to the fuzzy matcher that normalizes a typed item name to its
 * canonical master entry, so typos and stray spacing don't fragment the data.
 */
import { readRange, updateRange, appendRows, ensureSheet } from './sheets.js';

const ITEMS_SHEET = 'index_Items_Master';
const HEADERS = ['Item', 'Base Value'];

async function ensureItems(env) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, ITEMS_SHEET, HEADERS);
}

export async function listItemIndex(env) {
  await ensureItems(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${ITEMS_SHEET}!A2:B`);
  return (rows || [])
    .filter((r) => String(r[0] || '').trim())
    .map((r) => ({ name: String(r[0]).trim(), baseValue: Number(r[1]) || 0 }));
}

/** Add a new item or edit an existing one (rename via oldName). */
export async function upsertItem(env, { name, baseValue, oldName }) {
  await ensureItems(env);
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Enter an item name.');
  const val = Number(baseValue);
  if (!isFinite(val) || val < 0) throw new Error('Base value must be a number ≥ 0.');
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${ITEMS_SHEET}!A2:B`);
  const key = String(oldName || name).trim().toLowerCase();
  let rowIdx = null;
  rows.forEach((r, i) => { if (String(r[0] || '').trim().toLowerCase() === key) rowIdx = i + 2; });
  // Block renaming onto a different existing item.
  const clashIdx = rows.findIndex((r) => String(r[0] || '').trim().toLowerCase() === nm.toLowerCase());
  if (clashIdx !== -1 && clashIdx + 2 !== rowIdx) throw new Error('An item named "' + nm + '" already exists.');
  if (rowIdx) {
    await updateRange(env, env.CORE_SPREADSHEET_ID, `${ITEMS_SHEET}!A${rowIdx}:B${rowIdx}`, [[nm, val]]);
  } else {
    await appendRows(env, env.CORE_SPREADSHEET_ID, `${ITEMS_SHEET}!A1`, [[nm, val]]);
  }
  return listItemIndex(env);
}

export async function deleteItemIndex(env, name) {
  await ensureItems(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${ITEMS_SHEET}!A2:B`);
  const key = String(name || '').trim().toLowerCase();
  let rowIdx = null;
  rows.forEach((r, i) => { if (String(r[0] || '').trim().toLowerCase() === key) rowIdx = i + 2; });
  if (!rowIdx) throw new Error('Item not found.');
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${ITEMS_SHEET}!A${rowIdx}:B${rowIdx}`, [['', '']]);
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
  // Allow more slack on longer names; short names must match tightly.
  const L = target.length;
  const allowed = L <= 4 ? 1 : L <= 8 ? 2 : 3;
  return bestDist <= allowed ? best : null;
}
