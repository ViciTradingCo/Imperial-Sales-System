/**
 * Thin Google Sheets API v4 wrapper, authenticated as the service account.
 * All sheet reads/writes in the backend go through here so the auth + error
 * handling live in one place.
 */
import { getAccessToken } from './google-auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function authFetch(env, url, init = {}) {
  const token = await getAccessToken(env);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep raw text */ }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || text || res.status;
    throw new Error('Sheets API error: ' + msg);
  }
  return data;
}

/** Reads a range, returning a 2-D array of values (empty array when blank). */
export async function readRange(env, spreadsheetId, range) {
  const url = `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const data = await authFetch(env, url);
  return (data && data.values) || [];
}

/** Appends one or more rows to a sheet/table. */
export async function appendRows(env, spreadsheetId, range, rows) {
  const url = `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
    '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  return authFetch(env, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
}

/** Overwrites a range with the given rows. */
export async function updateRange(env, spreadsheetId, range, rows) {
  const url = `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}` +
    '?valueInputOption=USER_ENTERED';
  return authFetch(env, url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
}

/**
 * Ensures a tab's grid is at least `minCols` wide, expanding it if needed.
 * A pre-existing tab created with fewer columns (e.g. the original 10-column
 * Certified Users) would otherwise reject writes past its last column with
 * "exceeds grid limits".
 */
export async function ensureColumns(env, spreadsheetId, title, minCols) {
  const data = await authFetch(env, `${BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties)`);
  const sheet = (data.sheets || []).find((s) => s.properties.title === title);
  if (!sheet) return;
  const cur = (sheet.properties.gridProperties && sheet.properties.gridProperties.columnCount) || 0;
  if (cur >= minCols) return;
  await authFetch(env, `${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateSheetProperties: {
      properties: { sheetId: sheet.properties.sheetId, gridProperties: { columnCount: minCols } },
      fields: 'gridProperties.columnCount',
    } }] }),
  });
}

/** Clears the values in a range (leaves formatting/tab intact). */
export async function clearRange(env, spreadsheetId, range) {
  const url = `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  return authFetch(env, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

/** Titles of every tab in a spreadsheet. */
export async function getSheetTitles(env, spreadsheetId) {
  const data = await authFetch(env, `${BASE}/${spreadsheetId}?fields=sheets.properties.title`);
  return (data.sheets || []).map((s) => s.properties.title);
}

/**
 * Ensures a tab exists (creating it with the given header row if missing).
 * Self-healing, like the original Apps Script `ensure*Tab` helpers — so the
 * Core doesn't need every tab hand-created before the app can use it.
 */
export async function ensureSheet(env, spreadsheetId, title, headers) {
  const titles = await getSheetTitles(env, spreadsheetId);
  if (titles.includes(title)) return false;
  await authFetch(env, `${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (headers && headers.length) {
    await updateRange(env, spreadsheetId, `${title}!A1`, [headers]);
  }
  return true;
}
