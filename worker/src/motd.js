/**
 * Messages of the Day.
 *
 *  • Global MOTD — one banner shown to everyone on Home.
 *  • Individual MOTDs — per-business notices with an optional start/end window;
 *    shown on that business's Home while active.
 *  • Expiry warning — an automatic banner for a business's owner/employees when
 *    its certification is near (or past) expiry; the lead time is configurable.
 *
 * Storage in the Core (self-healing):
 *  • "MOTD" tab: A2 = global message, B2 = expiry-warning lead days.
 *  • "MOTD List" tab: ID | Business | Message | Start | End (ISO datetimes).
 */
import { readRange, updateRange, appendRows, ensureSheet } from './sheets.js';

const MOTD_SHEET = 'MOTD';
const LIST_SHEET = 'MOTD List';
const LIST_HEADERS = ['ID', 'Business', 'Message', 'Start', 'End'];
const DEFAULT_WARN_DAYS = 7;

async function ensureMotd(env) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, MOTD_SHEET, ['Message', 'Expiry Warn Days']);
}
async function ensureList(env) {
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, LIST_SHEET, LIST_HEADERS);
}

/* ---- global message ---- */
export async function readMotd(env) {
  await ensureMotd(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${MOTD_SHEET}!A2`);
  return rows[0] && rows[0][0] != null ? String(rows[0][0]).trim() : '';
}
export async function writeMotd(env, text) {
  await ensureMotd(env);
  const msg = String(text || '').trim();
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${MOTD_SHEET}!A2`, [[msg]]);
  return msg;
}

/* ---- expiry-warning lead days ---- */
export async function readWarnDays(env) {
  await ensureMotd(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${MOTD_SHEET}!B2`);
  const n = rows[0] && rows[0][0] != null ? Number(rows[0][0]) : NaN;
  return isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_WARN_DAYS;
}
export async function writeWarnDays(env, days) {
  await ensureMotd(env);
  let n = Math.round(Number(days));
  if (!isFinite(n) || n < 0) n = DEFAULT_WARN_DAYS;
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${MOTD_SHEET}!B2`, [[n]]);
  return n;
}

/* ---- individual (per-business, scheduled) messages ---- */
function genId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export async function listIndividualMotds(env) {
  await ensureList(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${LIST_SHEET}!A2:E`);
  return (rows || [])
    .filter((r) => String(r[0] || '').trim())
    .map((r) => ({
      id: String(r[0] || '').trim(),
      business: String(r[1] || '').trim(),
      message: String(r[2] || '').trim(),
      start: String(r[3] || '').trim(),
      end: String(r[4] || '').trim(),
    }));
}

export async function addIndividualMotd(env, { business, message, start, end }) {
  await ensureList(env);
  const biz = String(business || '').trim();
  const msg = String(message || '').trim();
  if (!biz) throw new Error('Pick a business.');
  if (!msg) throw new Error('Enter a message.');
  await appendRows(env, env.CORE_SPREADSHEET_ID, `${LIST_SHEET}!A1`,
    [[genId(), biz, msg, String(start || '').trim(), String(end || '').trim()]]);
  return listIndividualMotds(env);
}

function findRow(rows, id) {
  let idx = null;
  rows.forEach((r, i) => { if (String(r[0] || '').trim() === id) idx = i + 2; });
  return idx;
}

export async function updateIndividualMotd(env, { id, business, message, start, end }) {
  await ensureList(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${LIST_SHEET}!A2:E`);
  const rowIdx = findRow(rows, String(id || '').trim());
  if (!rowIdx) throw new Error('Entry not found.');
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${LIST_SHEET}!B${rowIdx}:E${rowIdx}`,
    [[String(business || '').trim(), String(message || '').trim(), String(start || '').trim(), String(end || '').trim()]]);
  return listIndividualMotds(env);
}

export async function deleteIndividualMotd(env, id) {
  await ensureList(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${LIST_SHEET}!A2:E`);
  const rowIdx = findRow(rows, String(id || '').trim());
  if (!rowIdx) throw new Error('Entry not found.');
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${LIST_SHEET}!A${rowIdx}:E${rowIdx}`, [['', '', '', '', '']]);
  return listIndividualMotds(env);
}

/** Active individual messages for a business right now (respecting start/end). */
export async function activeNoticesForBusiness(env, business) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const now = Date.now();
  return (await listIndividualMotds(env))
    .filter((m) => {
      if (String(m.business).trim().toLowerCase() !== target) return false;
      if (m.start) { const s = Date.parse(m.start); if (isFinite(s) && now < s) return false; }
      if (m.end) { const e = Date.parse(m.end); if (isFinite(e) && now > e) return false; }
      return true;
    })
    .map((m) => m.message);
}
