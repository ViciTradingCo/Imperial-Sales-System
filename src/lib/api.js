/**
 * Frontend → Worker API client. Every call carries the Google ID token as a
 * Bearer credential; the Worker verifies it and scopes the response to the
 * caller's role/business. The browser never talks to Google Sheets directly and
 * never holds any service-account secret.
 */
import { getIdToken } from './auth.js';

let baseUrl = '';
export function configureApi(url) { baseUrl = String(url || '').replace(/\/$/, ''); }

async function request(method, path, body) {
  const token = getIdToken();
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  // text/plain avoids a CORS preflight for simple POSTs; the Worker parses JSON.
  if (body !== undefined) headers['Content-Type'] = 'text/plain;charset=utf-8';

  let res;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Could not reach the API at ' + baseUrl + ' — check apiBaseUrl in app-config.json and that the Worker is deployed.');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }

  if (!res.ok) {
    const msg = (data && data.error) || text || (res.status + ' ' + res.statusText);
    throw new Error(msg);
  }
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  /** Verifies the signed-in user and returns their profile, or {registered:false}. */
  me: () => request('POST', '/auth/me', {}),
  /** Registers the signed-in user against a business (as owner or employee). */
  register: (businessName, asOwner, character, hold) =>
    request('POST', '/auth/register', { businessName, asOwner: !!asOwner, character, hold }),
  /** Updates the signed-in user's own profile (character name). */
  updateProfile: (character) => request('POST', '/me/profile', { character }),
  /** Owner/admin: the roster for the caller's business. */
  listEmployees: () => request('GET', '/business/employees'),
  /** Owner/admin: activate a pending employee. */
  activateEmployee: (uid) => request('POST', '/business/employees/activate', { uid }),
  /** Owner/admin: set an owner-private note on an employee. */
  setEmployeeNote: (uid, note) => request('POST', '/business/employees/note', { uid, note }),
  /** Admin: read the network's Master Settings. */
  getSettings: () => request('GET', '/admin/settings'),
  /** Admin: save Master Settings updates ([{label, value}]). */
  saveSettings: (updates) => request('POST', '/admin/settings', { updates }),
  /** Admin: every user in the system. */
  getMembers: () => request('GET', '/admin/members'),
  /** Admin: edit a member (character, company, role). */
  updateMember: (member) => request('POST', '/admin/members/update', member),
  /** Admin: remove a member from the network. */
  deleteMember: (uid) => request('POST', '/admin/members/delete', { uid }),
  /** Admin: every registered company. */
  getCompanies: () => request('GET', '/admin/companies'),
  /** Admin: edit a company (name + subscription). */
  updateCompany: (company) => request('POST', '/admin/companies/update', company),
  /** Admin: archive (delete) a company — data retained, name freed. */
  deleteCompany: (id) => request('POST', '/admin/companies/delete', { id }),
  /** Admin: run the D1 → Sheets backup on demand. */
  runBackup: () => request('POST', '/admin/backup', {}),
  /** Admin: network-wide market analytics. */
  getMarket: () => request('GET', '/admin/market'),
  /** Admin: wipe all sales + intake logs across the network. */
  clearLogs: () => request('POST', '/admin/logs/clear', {}),
  /** Court businesses: the market report for their own hold. */
  getHoldReport: () => request('GET', '/market/hold'),
  /** Owner/admin: read this shop's per-business (ledger) settings. */
  getLedgerSettings: () => request('GET', '/business/settings'),
  /** Owner/admin: save per-business (ledger) settings ([{label, value}]). */
  saveLedgerSettings: (updates) => request('POST', '/business/settings', { updates }),
  /** Owner/admin: rename the company. */
  renameBusiness: (name) => request('POST', '/business/rename', { name }),
  /** Any registered user: read their business's inventory. */
  getInventory: () => request('GET', '/inventory'),
  /** Owner/admin: add or update an inventory item. */
  saveItem: (item) => request('POST', '/inventory', item),
  /** Owner/admin: delete an inventory item. */
  deleteItem: (item) => request('POST', '/inventory/delete', { item }),
  /** The network hold list. */
  getHolds: () => request('GET', '/holds'),
  /** Recent intake transactions for the caller's business. */
  getIntake: () => request('GET', '/intake'),
  /** Owner/admin: record a stock intake (purchase). */
  recordIntake: (intake) => request('POST', '/intake', intake),
  /** This business's certification status. */
  getCert: () => request('GET', '/cert'),
  /** Ring up a sale. */
  checkout: (sale) => request('POST', '/sale', sale),
  /** Order lookup — recent sales, optionally filtered by q (order/customer/employee). */
  getSales: (q) => request('GET', '/sales' + (q ? '?q=' + encodeURIComponent(q) : '')),
  /** Void a sale by order number. */
  voidSale: (orderNo) => request('POST', '/sales/void', { orderNo }),
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body || {}),
};
