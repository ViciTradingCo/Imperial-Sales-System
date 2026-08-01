/**
 * Frontend → Worker API client. Every call carries the Google ID token as a
 * Bearer credential; the Worker verifies it and scopes the response to the
 * caller's role/business. The browser never touches the datastore directly and
 * never holds any backend credential.
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

// Short-lived shared cache for /motd so the Home notices and the shell banner
// (fetched near-simultaneously) collapse into one request.
let _motd = null;

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
  /** Admin: download a gzipped full-data backup (returns a Blob). */
  exportBackupBlob: async () => {
    const token = getIdToken();
    const res = await fetch(baseUrl + '/admin/export', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) { throw new Error((await res.text()) || res.statusText); }
    return await res.blob();
  },
  /** Admin: dry-run a restore — current-vs-incoming row counts, no changes made. */
  previewBackup: (data) => request('POST', '/admin/import/preview', data),
  /** Admin: restore all data from a parsed backup document. */
  importBackup: (data) => request('POST', '/admin/import', data),
  /** Admin: network-wide market analytics. */
  getMarket: () => request('GET', '/admin/market'),
  /** Admin: wipe all sales + intake logs across the network. */
  clearLogs: () => request('POST', '/admin/logs/clear', {}),
  /** Admin: delete sales + intake older than N days/weeks/months. */
  purgeLogs: (amount, unit) => request('POST', '/admin/logs/purge', { amount, unit }),
  /** Admin: D1 status snapshot. */
  getStatus: () => request('GET', '/admin/status'),
  /** Admin: full reset — wipe all data, keep admin accounts (requires confirm: 'ERASE'). */
  wipeData: () => request('POST', '/admin/data/wipe', { confirm: 'ERASE' }),
  /** Court businesses: the market report for their own hold. */
  getHoldReport: () => request('GET', '/market/hold'),
  /** Banners for the current user: { notices[], banners[] }. Deduped for ~3s. */
  getMotd: () => {
    const now = Date.now();
    if (_motd && now - _motd.at < 3000) return _motd.p;
    const p = request('GET', '/motd');
    _motd = { at: now, p };
    p.catch(() => { if (_motd && _motd.p === p) _motd = null; });
    return p;
  },
  /** Forces the next getMotd to refetch (e.g. after accepting a transfer). */
  bustMotd: () => { _motd = null; },
  /** Admin: read the MOTD config { motd, warnDays, individual[] }. */
  getMotdConfig: () => request('GET', '/admin/motd'),
  /** Admin: set the global message of the day (blank clears it). */
  setMotd: (motd) => request('POST', '/admin/motd', { motd }),
  /** Admin: set the expiry-warning lead time (days). */
  setWarnDays: (days) => request('POST', '/admin/motd/warn', { days }),
  /** Admin: add an individual (per-business, scheduled) message. */
  addIndividualMotd: (m) => request('POST', '/admin/motd/individual', m),
  /** Admin: edit an individual message. */
  updateIndividualMotd: (m) => request('POST', '/admin/motd/individual/update', m),
  /** Admin: delete an individual message. */
  deleteIndividualMotd: (id) => request('POST', '/admin/motd/individual/delete', { id }),
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
  /** Owner/admin: bulk import inventory rows [{item, price, stock, lowStock}]. */
  importInventory: (rows) => request('POST', '/inventory/import', { rows }),
  /** Owner/admin: per-employee sales performance. */
  getEmployeePerformance: () => request('GET', '/business/employees/performance'),
  /** Owner/admin: low + out-of-stock report ({ out, low }). */
  getLowStock: () => request('GET', '/business/low-stock'),
  /** Owner/admin: download this shop's sales or coffer ledger as a CSV Blob. */
  exportBusinessCsvBlob: async (type) => {
    const token = getIdToken();
    const res = await fetch(baseUrl + '/business/export?type=' + encodeURIComponent(type || 'sales'),
      { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) { throw new Error((await res.text()) || res.statusText); }
    return await res.blob();
  },
  /** Any registered user: active business names (transfer targets). */
  getBusinesses: () => request('GET', '/businesses'),
  /** Owner/admin: pending transfers ({ incoming, outgoing }). */
  getTransfers: () => request('GET', '/transfers'),
  /** Owner/admin: send goods to another company (debits your stock now). */
  createTransfer: (t) => request('POST', '/transfers', t),
  /** Owner/admin: accept an incoming transfer into your inventory. */
  acceptTransfer: (id) => request('POST', '/transfers/accept', { id }),
  /** Owner/admin (sender): cancel an outgoing transfer — goods return to you. */
  cancelTransfer: (id) => request('POST', '/transfers/cancel', { id }),
  /** Owner/admin (receiver): decline an incoming transfer — goods return to sender. */
  declineTransfer: (id) => request('POST', '/transfers/decline', { id }),
  /** Owner/admin: recent transfer history (any status). */
  getTransferHistory: () => request('GET', '/transfers/history'),
  /** Owner/admin: coffer balance + recent ledger. */
  getCoffer: () => request('GET', '/business/coffer'),
  /** Owner/admin: manual coffer adjustment (negative to withdraw). */
  adjustCoffer: (amount, note) => request('POST', '/business/coffer/adjust', { amount, note }),
  /** Any registered user: this shop's named discounts. */
  getDiscounts: () => request('GET', '/business/discounts'),
  /** Owner/admin: add a named discount. */
  addDiscount: (name, percent) => request('POST', '/business/discounts', { name, percent }),
  /** Owner/admin: delete a named discount. */
  deleteDiscount: (id) => request('POST', '/business/discounts/delete', { id }),
  /** Any registered user: this shop's style (tagline + accent). */
  getStyle: () => request('GET', '/business/style'),
  /** Owner/admin: set this shop's style. */
  setStyle: (tagline, accent) => request('POST', '/business/style', { tagline, accent }),
  /** Admin: the audit trail. */
  getAudit: () => request('GET', '/admin/audit'),
  /** Any registered user: the master item index (name + base value). */
  getItems: () => request('GET', '/items'),
  /** Admin: add/edit a master item (rename via oldName). */
  saveMasterItem: (item) => request('POST', '/admin/items', item),
  /** Admin: delete a master item. */
  deleteMasterItem: (name) => request('POST', '/admin/items/delete', { name }),
  /** Admin: bulk import master items [{name, baseValue}] (recognized names update, not duplicate). */
  importMasterItems: (rows) => request('POST', '/admin/items/import', { rows }),
  /** Admin: classify an item import (create/update/typos) without applying it. */
  analyzeItems: (rows) => request('POST', '/admin/items/import/analyze', { rows }),
  /** Admin: replace the hold index. */
  setHolds: (holds) => request('POST', '/admin/holds', { holds }),
  /** Public: sitewide branding (name, logo, favicon, footer, accent). */
  getBranding: () => request('GET', '/branding'),
  /** Admin: read branding for editing. */
  getBrandingAdmin: () => request('GET', '/admin/branding'),
  /** Admin: save sitewide branding. */
  setBranding: (b) => request('POST', '/admin/branding', b),
  /** Any registered user: tile artwork (key → image URL). */
  getTiles: () => request('GET', '/tiles'),
  /** Admin: read the tile artwork map. */
  getTileImages: () => request('GET', '/admin/tiles'),
  /** Admin: save the tile artwork map ({ key: httpsUrl }); blank clears a tile. */
  setTileImages: (images) => request('POST', '/admin/tiles', { images }),
  /** Admin: whether public storefronts are enabled. */
  getStorefrontFlag: () => request('GET', '/admin/storefronts'),
  /** Admin: enable/disable public storefronts. */
  setStorefrontFlag: (enabled) => request('POST', '/admin/storefronts', { enabled }),
  /** Public (no auth): a shop's read-only catalog. */
  getPublicStorefront: (business) => request('GET', '/public/storefront?b=' + encodeURIComponent(business || '')),
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
