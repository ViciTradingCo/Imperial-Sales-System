/**
 * Per-business (per-shop) settings — the tunables that belong to one store
 * rather than the whole network. Stored in a Core "Business Settings" tab keyed
 * by business name (one row per business), so it works even before a shop's
 * ledger is linked (Phase 3). Owned and edited by the store owner via the
 * Ledger Settings page.
 *
 * Wide layout: Business | <one column per setting>.
 */
import { readRange, updateRange, appendRows, ensureSheet } from './sheets.js';

export const BUSINESS_SETTINGS_SHEET = 'Business Settings';

export const BUSINESS_SETTINGS_SCHEMA = [
  { label: 'Minimum priced units before flagging', def: 3, kind: 'int', min: 1,
    notes: 'Ignore items with fewer priced units when judging this shop’s pricing, so a one-off sale can’t raise a false alarm.' },
];

const HEADERS = ['Business'].concat(BUSINESS_SETTINGS_SCHEMA.map((s) => s.label));

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
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, BUSINESS_SETTINGS_SHEET, HEADERS);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${BUSINESS_SETTINGS_SHEET}!A2:Z`);
  const target = String(business || '').trim().toLowerCase();
  let found = null;
  let foundRow = null;
  rows.forEach((r, i) => {
    if (String(r[0] || '').trim().toLowerCase() === target) { found = r; foundRow = i + 2; }
  });
  const settings = BUSINESS_SETTINGS_SCHEMA.map((s, idx) => {
    const cell = found ? found[idx + 1] : undefined;
    return {
      label: s.label,
      value: cell !== undefined && cell !== '' ? Number(cell) : s.def,
      notes: s.notes,
      kind: s.kind,
      min: s.min,
      max: s.max === undefined ? null : s.max,
      def: s.def,
    };
  });
  return { business, settings, _row: foundRow };
}

/** Validates and writes a business's settings; upserts its row. */
export async function writeBusinessSettings(env, business, updates) {
  const cur = await readBusinessSettings(env, business);
  const values = BUSINESS_SETTINGS_SCHEMA.map((s, i) => cur.settings[i].value);
  (updates || []).forEach((u) => {
    const idx = BUSINESS_SETTINGS_SCHEMA.findIndex((s) => s.label === u.label);
    if (idx === -1) return;
    values[idx] = validate(BUSINESS_SETTINGS_SCHEMA[idx], u.value);
  });
  const rowValues = [business].concat(values);
  if (cur._row) {
    await updateRange(env, env.CORE_SPREADSHEET_ID, `${BUSINESS_SETTINGS_SHEET}!A${cur._row}`, [rowValues]);
  } else {
    await appendRows(env, env.CORE_SPREADSHEET_ID, `${BUSINESS_SETTINGS_SHEET}!A1`, [rowValues]);
  }
  const fresh = await readBusinessSettings(env, business);
  return { business: fresh.business, settings: fresh.settings };
}
