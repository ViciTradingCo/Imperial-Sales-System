/**
 * The Master Item Index — the shared item library (canonical name + base value),
 * stored in D1 so the register and market are a fast local read. It starts
 * empty; admins populate it (add or bulk Import).
 *
 * The index is DIVIDED INTO TABLES BY TYPE. `item_type` holds a realm's list of
 * types and `master_item.category` says which one an item is filed under, so
 * each type reads and writes as an independent table without needing a real D1
 * table per type — which could not be admin-editable, would have to be added to
 * REALM_TABLES/export/backup one by one, and would make the register's picker a
 * growing UNION. Every type is per realm, like all other data.
 *
 * "Unsorted" is the table everything already in the index belongs to, and where
 * anything imported without a type flag lands. It always exists and cannot be
 * removed: deleting a type has to put its items somewhere.
 *
 * Also home to the fuzzy matcher that normalizes a typed item name to its
 * canonical master entry, so typos and stray spacing don't fragment the data.
 */
import { getDb } from './db.js';

/** The table unflagged items land in. Always present, never deletable. */
export const UNSORTED = 'Unsorted';

/* ---- item types (the tables the index is divided into) ---- */

/**
 * This realm's types, in display order, with Unsorted first. Each is
 * `{ name, flags }` — flags being the extra words that sort an import into it.
 *
 * Seeds Unsorted on first read rather than at schema time: the schema is shared
 * by every realm, and a realm's rows only ever come into being when that realm
 * is used.
 */
export async function listItemTypes(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT name, ord, flags FROM item_type WHERE realm_id = ? ORDER BY ord, name').bind(realmId).all();
  const rows = results || [];
  if (!rows.some((r) => r.name === UNSORTED)) {
    await db.prepare('INSERT OR IGNORE INTO item_type (realm_id, name, ord, flags) VALUES (?, ?, 0, \'[]\')').bind(realmId, UNSORTED).run();
    rows.unshift({ name: UNSORTED, ord: 0, flags: '[]' });
  }
  return rows.map((r) => ({ name: r.name, flags: parseFlags(r.flags) }));
}

/** Stored flags are JSON; a bad blob is treated as none rather than fatal. */
function parseFlags(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map((f) => String(f)).filter(Boolean) : [];
  } catch (e) { return []; }
}

/**
 * Cleans a submitted flag list: trimmed, de-duplicated, and capped so one table
 * can't carry a dictionary.
 *
 * De-duplication uses the SAME loose comparison that matches flags, so
 * "elixir, elixirs" stores one entry rather than two that can never be told
 * apart — a stored flag that could never fire is a setting that lies.
 */
function cleanFlags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  list.forEach((f) => {
    const s = String(f || '').trim().slice(0, 40);
    if (!s || !normalizeItem(s)) return;
    if (out.some((k) => looseSame(k, s))) return;
    out.push(s);
  });
  return out.slice(0, 20);
}

/** Accepts either `{name, flags}` records or bare name strings. */
function typeRecords(types) {
  return (types || []).map((t) => (typeof t === 'string' ? { name: t, flags: [] } : t));
}

/** True when two words are the same word for sorting purposes. */
function looseSame(a, b) {
  const x = normalizeItem(a), y = normalizeItem(b);
  if (!x || !y) return false;
  return x === y || sameWordForm(x, y);
}

/**
 * Resolves a written type flag to one of this realm's tables, returning its
 * NAME (or null when nothing matches — the caller decides whether to create the
 * table or fall back to Unsorted).
 *
 * A table's own name matches, and so does any of its flags. Both are compared
 * the tolerant way item names are (case, spacing, punctuation, plurals), so
 * "weapons", "Weapon" and "WEAPONS" are one table rather than three.
 *
 * Names are checked across ALL tables before flags, so a word that is one
 * table's name and another's flag belongs to the table it names — otherwise the
 * winner would depend on display order.
 */
export function matchItemType(flag, types) {
  const list = typeRecords(types);
  if (!normalizeItem(flag)) return null;
  for (const t of list) if (looseSame(t.name, flag)) return t.name;
  for (const t of list) {
    for (const f of t.flags || []) if (looseSame(f, flag)) return t.name;
  }
  return null;
}

/** The table actually NAMED this, ignoring flags. Null when the name is free. */
function nameClash(name, types) {
  return typeRecords(types).find((t) => looseSame(t.name, name)) || null;
}

/**
 * Statements clearing a word from every OTHER table's flags.
 *
 * A table's own name beats any table's flag (see matchItemType), so once a table
 * is called "Gems" another table's "gems" flag can never fire again. Leaving it
 * on screen would show a setting that does nothing, so it is dropped instead.
 */
function unshadowFlags(db, realmId, types, name, exclude) {
  const stmts = [];
  typeRecords(types).forEach((t) => {
    if (t.name === exclude) return;
    const kept = (t.flags || []).filter((f) => !looseSame(f, name));
    if (kept.length !== (t.flags || []).length) {
      stmts.push(db.prepare('UPDATE item_type SET flags = ? WHERE realm_id = ? AND name = ?')
        .bind(JSON.stringify(kept), realmId, t.name));
    }
  });
  return stmts;
}

/**
 * Adds a table (with optional sorting flags), returning the realm's full list.
 *
 * Only a clash with another table's NAME is refused. Naming a table something
 * another table lists as a flag is allowed — names take precedence, so the new
 * table is unambiguously what that word means from then on.
 */
export async function addItemType(env, name, realmId, flags) {
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) throw new Error('Enter a type name.');
  const types = await listItemTypes(env, realmId);
  const hit = nameClash(nm, types);
  if (hit) throw new Error('A table called "' + hit.name + '" already exists.');
  const db = await getDb(env);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO item_type (realm_id, name, ord, flags) VALUES (?, ?, ?, ?)')
      .bind(realmId, nm, types.length, JSON.stringify(cleanFlags(flags))),
    ...unshadowFlags(db, realmId, types, nm),
  ]);
  return listItemTypes(env, realmId);
}

/**
 * Renames a table and/or replaces its sorting flags. A rename re-files every
 * item in it, so nothing is orphaned.
 *
 * Unsorted cannot be renamed — it is where deleted tables empty into — but it
 * CAN carry flags, so a realm whose sheet marks leftovers "misc" can route them
 * there deliberately.
 */
export async function updateItemType(env, { name, newName, flags }, realmId) {
  const from = String(name || '').trim();
  if (!from) throw new Error('Which table?');
  const types = await listItemTypes(env, realmId);
  const cur = types.find((t) => t.name === from);
  if (!cur) throw new Error('No table called "' + from + '".');

  const db = await getDb(env);
  const stmts = [];
  const nextFlags = flags === undefined ? cur.flags : cleanFlags(flags);
  const to = newName === undefined ? from : String(newName || '').trim().slice(0, 40);
  if (!to) throw new Error('Enter a name for the table.');

  if (to !== from) {
    if (from === UNSORTED) throw new Error(UNSORTED + ' is the default table and cannot be renamed.');
    const others = types.filter((t) => t.name !== from);
    const clash = nameClash(to, others);
    if (clash) throw new Error('A table called "' + clash.name + '" already exists.');
    const row = await db.prepare('SELECT ord FROM item_type WHERE realm_id = ? AND name = ?').bind(realmId, from).first();
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO item_type (realm_id, name, ord, flags) VALUES (?, ?, ?, ?)')
        .bind(realmId, to, (row && row.ord) || 0, JSON.stringify(nextFlags)),
      db.prepare('DELETE FROM item_type WHERE realm_id = ? AND name = ?').bind(realmId, from),
      db.prepare('UPDATE master_item SET category = ? WHERE realm_id = ? AND category = ?').bind(to, realmId, from),
      ...unshadowFlags(db, realmId, others, to));
  } else {
    stmts.push(db.prepare('UPDATE item_type SET flags = ? WHERE realm_id = ? AND name = ?')
      .bind(JSON.stringify(nextFlags), realmId, from));
  }
  await db.batch(stmts);
  return listItemTypes(env, realmId);
}

/**
 * Removes a type. Its items are NOT deleted — they move to Unsorted, so losing
 * a table never loses the entries in it.
 */
export async function deleteItemType(env, name, realmId) {
  const nm = String(name || '').trim();
  if (nm === UNSORTED) throw new Error(UNSORTED + ' is the default table and cannot be removed — it is where ' +
    'a removed table\'s items go.');
  const db = await getDb(env);
  await listItemTypes(env, realmId); // guarantees Unsorted exists to move into
  const moved = await db.prepare('SELECT COUNT(*) AS n FROM master_item WHERE realm_id = ? AND category = ?').bind(realmId, nm).first();
  await db.batch([
    db.prepare('UPDATE master_item SET category = ? WHERE realm_id = ? AND category = ?').bind(UNSORTED, realmId, nm),
    db.prepare('DELETE FROM item_type WHERE realm_id = ? AND name = ?').bind(realmId, nm),
  ]);
  return { moved: (moved && moved.n) || 0, types: await listItemTypes(env, realmId) };
}

/* ---- the index itself ---- */

export async function listItemIndex(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT name, base_value, category FROM master_item WHERE realm_id = ? ORDER BY name').bind(realmId).all();
  return (results || []).map((r) => ({
    name: r.name,
    baseValue: Number(r.base_value) || 0,
    category: r.category || UNSORTED,
  }));
}

/** Add a new item or edit an existing one (rename via oldName). */
export async function upsertItem(env, { name, baseValue, category, oldName }, realmId) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Enter an item name.');
  const val = Number(baseValue);
  if (!isFinite(val) || val < 0) throw new Error('Base value must be a number ≥ 0.');
  const types = await listItemTypes(env, realmId);
  const cat = category === undefined ? UNSORTED : (matchItemType(category, types) || UNSORTED);
  const db = await getDb(env);
  const clash = await db.prepare('SELECT name FROM master_item WHERE realm_id = ? AND lower(name) = ? AND lower(name) != ?')
    .bind(realmId, nm.toLowerCase(), String(oldName || '').toLowerCase()).first();
  if (clash) throw new Error('An item named "' + nm + '" already exists.');
  if (oldName && oldName !== nm) await db.prepare('DELETE FROM master_item WHERE realm_id = ? AND name = ?').bind(realmId, oldName).run();
  await db.prepare('INSERT INTO master_item (realm_id, name, base_value, category) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(realm_id, name) DO UPDATE SET base_value = excluded.base_value, category = excluded.category')
    .bind(realmId, nm, val, cat).run();
  return listItemIndex(env, realmId);
}

/**
 * Bulk upsert from a pasted list. Each row: { name, baseValue, type }. Matching
 * is by NORMALIZED name (case / spacing / punctuation-insensitive), so
 * recognized items are UPDATED, not duplicated: the base value is set, and the
 * canonical spelling is corrected to the pasted name when it differs.
 * Unrecognized names are added. Rows with a non-numeric value (e.g. a header)
 * are skipped.
 *
 * SORTING BY FLAG: `type` is the flag on the item line. A flag matching a
 * table's name OR one of its sorting flags (however it is cased or pluralised)
 * files the item there; a flag matching nothing CREATES that table, since the
 * point of the flag is to build the split as the data arrives.
 *
 * DESTINATION FOR UNFLAGGED ROWS: `into` names the table an unflagged row goes
 * to. Importing into one table's own screen passes that table; the whole-index
 * import passes nothing and unflagged rows land in Unsorted, which is what the
 * default table is for. Either way an item ALREADY in the index keeps its
 * current table unless the row explicitly says otherwise — an import that omits
 * the type column must never silently re-file the whole index.
 *
 * Name matching is deliberately exact-after-normalization (not fuzzy) so a
 * genuine typo becomes a new item rather than silently overwriting a real one.
 */
export async function importItemIndex(env, rows, realmId, into) {
  const db = await getDb(env);
  const existing = await listItemIndex(env, realmId);
  const byNorm = new Map(existing.map((it) => [normalizeItem(it.name), it]));
  const types = await listItemTypes(env, realmId);
  const plan = destinationPlanner(types, into);
  const stmts = [];
  let imported = 0;
  (rows || []).forEach((r) => {
    const name = String(r.name || '').trim();
    if (!name) return;
    const val = Number(r.baseValue);
    if (!isFinite(val) || val < 0) return; // skip headers / bad rows
    const norm = normalizeItem(name);
    const hit = byNorm.get(norm);
    const cat = plan.destination(r.type, hit);
    if (hit && hit.name !== name) {
      stmts.push(db.prepare('DELETE FROM master_item WHERE realm_id = ? AND name = ?').bind(realmId, hit.name)); // rename
    }
    stmts.push(db.prepare(
      'INSERT INTO master_item (realm_id, name, base_value, category) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(realm_id, name) DO UPDATE SET base_value = excluded.base_value, category = excluded.category')
      .bind(realmId, name, val, cat));
    byNorm.set(norm, { name, baseValue: val, category: cat }); // dedupe within the same paste
    imported++;
  });
  // Tables first, so an item never references one that isn't there yet.
  if (plan.newTypes.length) {
    await db.batch(plan.newTypes.map((t, i) => db
      .prepare('INSERT OR IGNORE INTO item_type (realm_id, name, ord, flags) VALUES (?, ?, ?, \'[]\')')
      .bind(realmId, t, types.length + i)));
  }
  if (stmts.length) await db.batch(stmts);
  return {
    imported, typesAdded: plan.newTypes,
    items: await listItemIndex(env, realmId), types: await listItemTypes(env, realmId),
  };
}

/**
 * Where each row of an import lands. Shared by the import and its preview so
 * the two can never disagree — the preview's whole job is to be what happens.
 *
 * `into` names the table this import is FOR (a table's own Import/Export). It
 * is an explicit destination, so an unflagged row goes there even if the item is
 * currently filed elsewhere — you opened that table and pasted into it. The
 * whole-index import has no such destination, and there an unflagged row must
 * leave an existing item where it is: the type column being absent is an
 * omission, not an instruction to re-file the index. New items land in Unsorted,
 * which is what the default table is for.
 *
 * An unrecognized flag creates a table; `newTypes` collects those in first-seen
 * order. A named destination that doesn't exist is ignored rather than created —
 * it can only come from a stale screen.
 */
function destinationPlanner(types, into) {
  const known = typeRecords(types);
  const target = into ? matchItemType(into, known) : null;
  const newTypes = [], seen = new Set();
  return {
    newTypes,
    destination(flag, current) {
      const raw = String(flag || '').trim();
      if (!raw) return target || (current ? current.category : UNSORTED);
      const hit = matchItemType(raw, known);
      if (hit) return hit;
      const made = raw.slice(0, 40);
      if (!seen.has(made)) {
        seen.add(made);
        newTypes.push(made);
        known.push({ name: made, flags: [] }); // later rows match it too
      }
      return made;
    },
  };
}

/**
 * Classifies a pasted import WITHOUT applying it, so the admin can review:
 *   • update   — an exact (normalized) match on an existing item.
 *   • typos    — a fuzzy match that ISN'T exact (a likely misspelling), with the
 *                suggested canonical name so the admin can fix or keep-as-new.
 *   • create   — no match at all (a genuinely new item).
 *   • newTypes — type flags that would create a new table.
 *
 * Every row carries the `type` it would be filed under, so the preview shows the
 * sorting as well as the additions. `into` is the same destination default the
 * import will use, and the planner is shared, so the preview cannot drift from
 * what applying it actually does.
 */
export async function analyzeItemImport(env, rows, realmId, into) {
  const existing = await listItemIndex(env, realmId);
  const byNorm = new Map(existing.map((it) => [normalizeItem(it.name), it]));
  const plan = destinationPlanner(await listItemTypes(env, realmId), into);
  const create = [], update = [], typos = [];
  (rows || []).forEach((r) => {
    const name = String(r.name || '').trim();
    const val = Number(r.baseValue);
    if (!name || !isFinite(val) || val < 0) return;
    const exact = byNorm.get(normalizeItem(name));
    const type = plan.destination(r.type, exact);
    if (exact) { update.push({ name, baseValue: val, type, current: exact.name, currentType: exact.category }); return; }
    const fuzzy = matchMasterItem(name, existing);
    if (fuzzy) { typos.push({ name, baseValue: val, type, suggestion: fuzzy.name }); return; }
    create.push({ name, baseValue: val, type });
  });
  return { create, update, typos, newTypes: plan.newTypes };
}

/**
 * Empties this realm's item index. Other realms keep theirs — the index is per
 * realm like everything else. Pass a type name to empty just that table.
 *
 * The TYPE LIST survives either way: the tables are the realm's structure, not
 * its contents, and rebuilding them by hand after clearing the items would be
 * the same chore the purge is meant to save.
 *
 * Inventory rows are NOT touched: a shop's stock is its own record, and an item
 * missing from the index simply stops being offered by the picker and stops
 * counting toward market analysis. Returns how many were removed so the caller
 * can say so.
 */
export async function purgeItemIndex(env, realmId, category) {
  const db = await getDb(env);
  const cat = String(category || '').trim();
  const where = cat ? 'realm_id = ? AND category = ?' : 'realm_id = ?';
  const args = cat ? [realmId, cat] : [realmId];
  const before = await db.prepare('SELECT COUNT(*) AS n FROM master_item WHERE ' + where).bind(...args).first();
  await db.prepare('DELETE FROM master_item WHERE ' + where).bind(...args).run();
  return { purged: (before && before.n) || 0, category: cat, items: await listItemIndex(env, realmId) };
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
