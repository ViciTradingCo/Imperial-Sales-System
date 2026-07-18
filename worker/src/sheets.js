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
 * Creates a new spreadsheet owned by the service account, with the named tabs
 * (in order). Returns its spreadsheetId. Used to mint a shop's ledger when a
 * business owner registers — the service account owns it, so the app reaches it
 * without any human having to share anything.
 */
export async function createSpreadsheet(env, title, tabTitles) {
  const body = {
    properties: { title },
    sheets: (tabTitles && tabTitles.length ? tabTitles : ['Sheet1']).map((t) => ({
      properties: { title: t },
    })),
  };
  const data = await authFetch(env, BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.spreadsheetId;
}
