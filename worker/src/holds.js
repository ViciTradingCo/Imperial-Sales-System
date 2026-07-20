/**
 * The network-wide hold list, read from the Core's index_Holds_Master (the one
 * source of truth) — now editable by admins from Network Settings. Falls back to
 * the classic nine if the Core is unreachable / empty.
 */
import { readRange, updateRange, clearRange, ensureSheet } from './sheets.js';
import { DEFAULT_HOLDS } from './ledger.js';

const HOLDS_SHEET = 'index_Holds_Master';

export async function readHolds(env) {
  try {
    const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${HOLDS_SHEET}!A2:A`);
    const holds = (rows || []).map((r) => String(r[0] || '').trim()).filter(Boolean);
    return holds.length ? holds : DEFAULT_HOLDS.slice();
  } catch (e) {
    return DEFAULT_HOLDS.slice();
  }
}

/** Admin: replace the hold index with the given list (order preserved). */
export async function writeHolds(env, list) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, HOLDS_SHEET, ['Hold']);
  // De-dupe (case-insensitive) while keeping the first spelling and order.
  const seen = new Set();
  const holds = [];
  (list || []).forEach((h) => {
    const v = String(h || '').trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); holds.push(v); }
  });
  await clearRange(env, env.CORE_SPREADSHEET_ID, `${HOLDS_SHEET}!A2:A`);
  if (holds.length) await updateRange(env, env.CORE_SPREADSHEET_ID, `${HOLDS_SHEET}!A2`, holds.map((h) => [h]));
  return holds;
}
