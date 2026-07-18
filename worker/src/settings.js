/**
 * Master Settings — the network's tunables (sync cadence + market anomaly
 * thresholds). The web app OWNS this: the Worker creates the tab, seeds it, and
 * is the only thing that reads/writes it, so an admin manages it from the admin
 * panel instead of hand-editing the Core sheet.
 *
 * Stored as label / value / notes rows in the Core's "Master Settings" tab,
 * with the exact labels the market analysis reads.
 */
import { readRange, updateRange, appendRows, ensureSheet } from './sheets.js';

export const MASTER_SETTINGS_SHEET = 'Master Settings';
export const SETTINGS_HEADERS = ['Setting', 'Value', 'Notes'];

// Canonical schema — the source of truth for defaults, validation, and UI.
export const SETTINGS_SCHEMA = [
  { label: 'Shop sync interval (minutes)', def: 5, kind: 'int', min: 1, max: 30,
    notes: 'How often each shop self-syncs.' },
  { label: 'Core maintenance interval (minutes)', def: 5, kind: 'int', min: 1, max: 30,
    notes: 'How often the Core background sync runs.' },
  { label: 'Overpricing threshold (x item average)', def: 1.5, kind: 'float', min: 1.01,
    notes: 'At or above this multiple of an item’s network average → OVERPRICED. Must be above 1.' },
  { label: 'Undercutting threshold (x item average)', def: 0.5, kind: 'float', min: 0.01, max: 0.99,
    notes: 'At or below this multiple → UNDERCUT (possible dumping). Between 0 and 1.' },
  { label: 'Minimum priced units before flagging', def: 3, kind: 'int', min: 1,
    notes: 'Ignore items with fewer priced units, to avoid false alarms.' },
];

/** Creates the tab (if missing) and seeds every setting the first time. */
export async function ensureSettings(env) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, MASTER_SETTINGS_SHEET, SETTINGS_HEADERS);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${MASTER_SETTINGS_SHEET}!A2:C`);
  const have = {};
  rows.forEach((r) => { have[String(r[0] || '').trim()] = true; });
  const missing = SETTINGS_SCHEMA.filter((s) => !have[s.label]);
  if (missing.length) {
    await appendRows(env, env.CORE_SPREADSHEET_ID, `${MASTER_SETTINGS_SHEET}!A1`,
      missing.map((s) => [s.label, s.def, s.notes]));
  }
}

/** Returns the settings in schema order: [{ label, value, notes, kind, min, max, def }]. */
export async function readSettings(env) {
  await ensureSettings(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${MASTER_SETTINGS_SHEET}!A2:C`);
  const byLabel = {};
  rows.forEach((r, i) => { byLabel[String(r[0] || '').trim()] = { value: r[1], row: i + 2 }; });
  return SETTINGS_SCHEMA.map((s) => ({
    label: s.label,
    value: byLabel[s.label] !== undefined && byLabel[s.label].value !== '' ? Number(byLabel[s.label].value) : s.def,
    notes: s.notes,
    kind: s.kind,
    min: s.min,
    max: s.max === undefined ? null : s.max,
    def: s.def,
  }));
}

function validate(schema, value) {
  let n = Number(value);
  if (!isFinite(n)) throw new Error('"' + schema.label + '" must be a number.');
  if (schema.kind === 'int') n = Math.round(n);
  if (schema.min !== undefined && n < schema.min) throw new Error('"' + schema.label + '" must be at least ' + schema.min + '.');
  if (schema.max !== undefined && n > schema.max) throw new Error('"' + schema.label + '" must be at most ' + schema.max + '.');
  return n;
}

/** Validates and writes the given { label, value } updates; returns the fresh settings. */
export async function writeSettings(env, updates) {
  await ensureSettings(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${MASTER_SETTINGS_SHEET}!A2:C`);
  const rowByLabel = {};
  rows.forEach((r, i) => { rowByLabel[String(r[0] || '').trim()] = i + 2; });

  // Validate everything first, so one bad value rejects the whole save.
  const writes = [];
  (updates || []).forEach((u) => {
    const schema = SETTINGS_SCHEMA.find((s) => s.label === u.label);
    if (!schema) return; // ignore unknown labels
    const v = validate(schema, u.value);
    const row = rowByLabel[u.label];
    if (row) writes.push({ row, value: v });
  });

  for (const w of writes) {
    await updateRange(env, env.CORE_SPREADSHEET_ID, `${MASTER_SETTINGS_SHEET}!B${w.row}`, [[w.value]]);
  }
  return readSettings(env);
}
