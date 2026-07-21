/**
 * Per-business (per-shop) settings — the tunables that belong to one store
 * rather than the whole network. Stored in D1 (`business_settings`, keyed by
 * business + label). Owned and edited by the store owner via the Ledger Settings
 * page. (Renames are handled by renameBusinessData in db.js.)
 */
import { getDb } from './db.js';

export const BUSINESS_SETTINGS_SCHEMA = [
  { label: 'Minimum priced units before flagging', def: 3, kind: 'int', min: 1,
    notes: 'Ignore items with fewer priced units when judging this shop’s pricing, so a one-off sale can’t raise a false alarm.' },
];

function validate(schema, value) {
  let n = Number(value);
  if (!isFinite(n)) throw new Error('"' + schema.label + '" must be a number.');
  if (schema.kind === 'int') n = Math.round(n);
  if (schema.min !== undefined && n < schema.min) throw new Error('"' + schema.label + '" must be at least ' + schema.min + '.');
  if (schema.max !== undefined && n > schema.max) throw new Error('"' + schema.label + '" must be at most ' + schema.max + '.');
  return n;
}

/** Reads a business's settings (with defaults for any unset value). */
export async function readBusinessSettings(env, business) {
  const target = String(business || '').trim().toLowerCase();
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT label, value FROM business_settings WHERE lower(business) = ?').bind(target).all();
  const byLabel = {};
  (results || []).forEach((r) => { byLabel[String(r.label || '').trim()] = r.value; });
  const settings = BUSINESS_SETTINGS_SCHEMA.map((s) => ({
    label: s.label,
    value: byLabel[s.label] != null && byLabel[s.label] !== '' ? Number(byLabel[s.label]) : s.def,
    notes: s.notes,
    kind: s.kind,
    min: s.min,
    max: s.max === undefined ? null : s.max,
    def: s.def,
  }));
  return { business, settings };
}

/** Validates and writes a business's settings; upserts each row. */
export async function writeBusinessSettings(env, business, updates) {
  const db = await getDb(env);
  const writes = [];
  (updates || []).forEach((u) => {
    const schema = BUSINESS_SETTINGS_SCHEMA.find((s) => s.label === u.label);
    if (!schema) return;
    writes.push({ label: u.label, value: validate(schema, u.value) });
  });
  if (writes.length) {
    await db.batch(writes.map((w) =>
      db.prepare('INSERT INTO business_settings (business, label, value) VALUES (?, ?, ?) ' +
        'ON CONFLICT(business, label) DO UPDATE SET value = excluded.value')
        .bind(business, w.label, w.value)));
  }
  return readBusinessSettings(env, business);
}
