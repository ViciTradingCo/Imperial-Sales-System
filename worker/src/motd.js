/**
 * Message of the Day — a short banner an admin sets that every signed-in user
 * sees. Stored as a single cell in a dedicated Core tab (the Master Settings
 * schema is numbers-only, so MOTD lives on its own). Self-heals the tab.
 */
import { readRange, updateRange, ensureSheet } from './sheets.js';

const MOTD_SHEET = 'MOTD';

export async function readMotd(env) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, MOTD_SHEET, ['Message']);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${MOTD_SHEET}!A2`);
  return rows[0] && rows[0][0] != null ? String(rows[0][0]).trim() : '';
}

export async function writeMotd(env, text) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, MOTD_SHEET, ['Message']);
  const msg = String(text || '').trim();
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${MOTD_SHEET}!A2`, [[msg]]);
  return msg;
}
