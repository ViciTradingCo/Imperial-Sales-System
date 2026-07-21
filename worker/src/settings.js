/**
 * Master Settings — the network's tunables (sync cadence + market anomaly
 * thresholds). The web app OWNS this: the Worker creates the tab, seeds it, and
 * is the only thing that reads/writes it, so an admin manages it from the admin
 * panel instead of hand-editing the Core sheet.
 *
 * Stored as label / value / notes rows in the Core's "Master Settings" tab,
 * with the exact labels the market analysis reads.
 */
import { getDb } from './db.js';
import { cacheGet, cacheSet, cacheBust } from './cache.js';

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
  // NOTE: "Minimum priced units before flagging" is a PER-SHOP setting — it
  // lives in Business Settings (the owner's Ledger Settings page), not here.
];

/** Reads stored values (label → value) from D1. */
async function storedValues(env) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT label, value FROM master_settings').all();
  const byLabel = {};
  (results || []).forEach((r) => { byLabel[String(r.label || '').trim()] = r.value; });
  return byLabel;
}

/** Returns the settings in schema order: [{ label, value, notes, kind, min, max, def }]. */
export async function readSettings(env) {
  const cached = await cacheGet(env, 'settings');
  if (cached) return cached;
  const byLabel = await storedValues(env);
  const out = SETTINGS_SCHEMA.map((s) => ({
    label: s.label,
    value: byLabel[s.label] != null && byLabel[s.label] !== '' ? Number(byLabel[s.label]) : s.def,
    notes: s.notes,
    kind: s.kind,
    min: s.min,
    max: s.max === undefined ? null : s.max,
    def: s.def,
  }));
  await cacheSet(env, 'settings', out, 60000);
  return out;
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
  const db = await getDb(env);
  // Validate everything first, so one bad value rejects the whole save.
  const writes = [];
  (updates || []).forEach((u) => {
    const schema = SETTINGS_SCHEMA.find((s) => s.label === u.label);
    if (!schema) return; // ignore unknown labels
    writes.push({ label: u.label, value: validate(schema, u.value) });
  });
  if (writes.length) {
    await db.batch(writes.map((w) =>
      db.prepare('INSERT INTO master_settings (label, value) VALUES (?, ?) ON CONFLICT(label) DO UPDATE SET value = excluded.value')
        .bind(w.label, w.value)));
  }
  cacheBust('settings');
  return readSettings(env);
}
