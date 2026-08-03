/**
 * The Master Item Index — the shared item library (canonical name + base value),
 * stored in D1 (`master_item`) so the register and market are a fast local read.
 * It starts empty; admins populate it (add or bulk Import).
 *
 * Also home to the fuzzy matcher that normalizes a typed item name to its
 * canonical master entry, so typos and stray spacing don't fragment the data.
 */
import { getDb } from './db.js';

export async function listItemIndex(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT name, base_value FROM master_item WHERE realm_id = ? ORDER BY name').bind(realmId).all();
  return (results || []).map((r) => ({ name: r.name, baseValue: Number(r.base_value) || 0 }));
}

/** Add a new item or edit an existing one (rename via oldName). */
export async function upsertItem(env, { name, baseValue, oldName }, realmId) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Enter an item name.');
  const val = Number(baseValue);
  if (!isFinite(val) || val < 0) throw new Error('Base value must be a number ≥ 0.');
  const db = await getDb(env);
  const clash = await db.prepare('SELECT name FROM master_item WHERE realm_id = ? AND lower(name) = ? AND lower(name) != ?')
    .bind(realmId, nm.toLowerCase(), String(oldName || '').toLowerCase()).first();
  if (clash) throw new Error('An item named "' + nm + '" already exists.');
  if (oldName && oldName !== nm) await db.prepare('DELETE FROM master_item WHERE realm_id = ? AND name = ?').bind(realmId, oldName).run();
  await db.prepare('INSERT INTO master_item (realm_id, name, base_value) VALUES (?, ?, ?) ON CONFLICT(realm_id, name) DO UPDATE SET base_value = excluded.base_value')
    .bind(realmId, nm, val).run();
  return listItemIndex(env, realmId);
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
export async function importItemIndex(env, rows, realmId) {
  const db = await getDb(env);
  const byNorm = new Map((await listItemIndex(env, realmId)).map((it) => [normalizeItem(it.name), it]));
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
      stmts.push(db.prepare('DELETE FROM master_item WHERE realm_id = ? AND name = ?').bind(realmId, hit.name)); // rename
    }
    stmts.push(db.prepare(
      'INSERT INTO master_item (realm_id, name, base_value) VALUES (?, ?, ?) ON CONFLICT(realm_id, name) DO UPDATE SET base_value = excluded.base_value')
      .bind(realmId, name, val));
    byNorm.set(norm, { name, baseValue: val }); // dedupe within the same paste
    imported++;
  });
  if (stmts.length) await db.batch(stmts);
  return { imported, items: await listItemIndex(env, realmId) };
}

/**
 * Classifies a pasted import WITHOUT applying it, so the admin can review:
 *   • update — an exact (normalized) match on an existing item.
 *   • typos  — a fuzzy match that ISN'T exact (a likely misspelling), with the
 *              suggested canonical name so the admin can fix or keep-as-new.
 *   • create — no match at all (a genuinely new item).
 */
export async function analyzeItemImport(env, rows, realmId) {
  const existing = await listItemIndex(env, realmId);
  const byNorm = new Map(existing.map((it) => [normalizeItem(it.name), it]));
  const create = [], update = [], typos = [];
  (rows || []).forEach((r) => {
    const name = String(r.name || '').trim();
    const val = Number(r.baseValue);
    if (!name || !isFinite(val) || val < 0) return;
    const exact = byNorm.get(normalizeItem(name));
    if (exact) { update.push({ name, baseValue: val, current: exact.name }); return; }
    const fuzzy = matchMasterItem(name, existing);
    if (fuzzy) { typos.push({ name, baseValue: val, suggestion: fuzzy.name }); return; }
    create.push({ name, baseValue: val });
  });
  return { create, update, typos };
}

/**
 * Empties this realm's item index. Other realms keep theirs — the index is per
 * realm like everything else.
 *
 * Inventory rows are NOT touched: a shop's stock is its own record, and an item
 * missing from the index simply stops being offered by the picker and stops
 * counting toward market analysis. Returns how many were removed so the caller
 * can say so.
 */
export async function purgeItemIndex(env, realmId) {
  const db = await getDb(env);
  const before = await db.prepare('SELECT COUNT(*) AS n FROM master_item WHERE realm_id = ?').bind(realmId).first();
  await db.prepare('DELETE FROM master_item WHERE realm_id = ?').bind(realmId).run();
  return { purged: (before && before.n) || 0, items: [] };
}

export async function deleteItemIndex(env, name, realmId) {
  const db = await getDb(env);
  await db.prepare('DELETE FROM master_item WHERE realm_id = ? AND lower(name) = ?').bind(realmId, String(name || '').trim().toLowerCase()).run();
  return listItemIndex(env, realmId);
}

/* ---- fuzzy matching (typo / grammar tolerance) ---- */

/** Loose normalization: lowercase, strip punctuation, collapse whitespace. */
export function normalizeItem(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Edit distance counting a TRANSPOSITION as one edit (Damerau-Levenshtein).
 *
 * That matters here: "Swrod" for "Sword" is the single most common way to
 * mistype a word, but plain Levenshtein scores it 2 — the same as two unrelated
 * letters — so a one-edit tolerance would reject the typo it most needs to
 * catch.
 */
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  // Three rolling rows: two back for the transposition case.
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev; prev = cur;
  }
  return prev[n];
}

/**
 * The forms a name could be the singular of. English pluralisation is ambiguous
 * from the outside — "axes" is axe+s, "boxes" is box+es — so rather than guess,
 * every plausible form is generated and two names match if their sets overlap.
 * Grammar tolerance only; deliberately not a stemmer, since over-reaching here
 * merges genuinely different items.
 */
function singularForms(s) {
  const out = new Set([s]);
  if (/[^s]s$/.test(s)) out.add(s.slice(0, -1));            // potions -> potion
  if (/(ches|shes|sses|xes|zes)$/.test(s)) out.add(s.slice(0, -2)); // boxes -> box
  if (/[^aeiou]ies$/.test(s)) out.add(s.slice(0, -3) + 'y'); // berries -> berry
  return out;
}
function sameWordForm(a, b) {
  const A = singularForms(a);
  for (const f of singularForms(b)) if (A.has(f)) return true;
  return false;
}

/**
 * Resolves a typed item name to its canonical master entry.
 *
 * A match means the two names are the SAME ITEM written differently — case,
 * punctuation, spacing (handled by normalizeItem), a plural, or a single
 * mistyped character. Anything beyond that is a DIFFERENT item and returns null,
 * so an import adds it rather than folding it into something else.
 *
 * The tolerance used to scale with length, allowing up to three edits on a long
 * name. That quietly merged real pairs: "Health Potion" / "Healing Potion" are
 * three edits apart, as are "Iron Sword" / "Iron Sworp"… and the first pair is
 * two different potions. One edit is the most that can be a typo rather than a
 * distinction, and even that is only allowed on names long enough for a single
 * letter not to change the meaning ("axe" vs "are").
 */
const TYPO_MIN_LENGTH = 6;

export function matchMasterItem(name, master) {
  const target = normalizeItem(name);
  if (!target) return null;
  let best = null, bestDist = Infinity;
  for (const it of master) {
    const cand = normalizeItem(it.name);
    if (cand === target) return it;              // same after normalizing
    if (sameWordForm(cand, target)) return it;   // same but for a plural
    const d = editDistance(target, cand);
    if (d < bestDist) { bestDist = d; best = it; }
  }
  if (!best) return null;
  // One typo, and only on a name long enough that one letter isn't the whole word.
  return (bestDist <= 1 && target.length >= TYPO_MIN_LENGTH) ? best : null;
}
