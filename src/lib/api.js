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
// Tile artwork changes only when an admin edits it, but six screens ask for it
// on every render. One promise per session; bustTiles() after a save.
let _tiles = null;

export const api = {
  health: () => request('GET', '/health'),
  /** Verifies the signed-in user and returns their profile, or {registered:false}. */
  me: () => request('POST', '/auth/me', {}),
  /** Sign-up: what a Business Code opens, without registering anything. */
  checkCode: (code) => request('POST', '/auth/code', { code }),
  /** Sign-up: register against a Business Code. The code decides realm + role. */
  register: (code, character, businessName, hold) =>
    request('POST', '/auth/register', { code, character, businessName, hold }),
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
  getMembers: (realmId) => request('GET', '/admin/members' + (realmId ? '?realm=' + encodeURIComponent(realmId) : '')),
  /** Admin: edit a member (character, company, role). */
  updateMember: (member) => request('POST', '/admin/members/update', member),
  /** Admin: remove a member from the network. */
  deleteMember: (uid) => request('POST', '/admin/members/delete', { uid }),
  /** Admin: every registered company. */
  getCompanies: (realmId) => request('GET', '/admin/companies' + (realmId ? '?realm=' + encodeURIComponent(realmId) : '')),
  /** Admin: read one company's ledger (coffer, discounts, style, performance). */
  getCompanyLedger: (business) => request('GET', '/admin/companies/ledger?business=' + encodeURIComponent(business)),
  /** Admin: edit a company (name + subscription). */
  updateCompany: (company) => request('POST', '/admin/companies/update', company),
  /** Admin: archive (delete) a company — data retained, name freed. */
  deleteCompany: (id) => request('POST', '/admin/companies/delete', { id }),
  /** Admin: download a gzipped full-data backup (returns a Blob). */
  exportBackupBlob: async (scope) => {
    const token = getIdToken();
    const q = scope === 'realm' ? '?scope=realm' : '';
    const res = await fetch(baseUrl + '/admin/export' + q, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) { throw new Error((await res.text()) || res.statusText); }
    return await res.blob();
  },
  /** Admin: dry-run a restore — current-vs-incoming row counts, no changes made. */
  previewBackup: (data, scope) => request('POST', '/admin/import/preview', { ...data, scope }),
  /** Admin: restore all data from a parsed backup document. */
  importBackup: (data, scope) => request('POST', '/admin/import', { ...data, scope }),
  /** Admin: network-wide market analytics. */
  getMarket: () => request('GET', '/admin/market'),
  /** Admin: one item's full performance, including its daily trend. */
  getMarketItem: (name) => request('GET', '/admin/market/item?name=' + encodeURIComponent(name)),
  /** Admin: wipe all sales + intake logs across the network. */
  clearLogs: () => request('POST', '/admin/logs/clear', {}),
  /** Admin: delete sales + intake older than N days/weeks/months. */
  purgeLogs: (amount, unit) => request('POST', '/admin/logs/purge', { amount, unit }),
  /** Admin: D1 status snapshot. */
  getStatus: () => request('GET', '/admin/status'),
  /* ---- feedback on the app ---- */
  /** Any registered user: the subject list + their own past submissions. */
  getFeedback: () => request('GET', '/feedback'),
  /** Any registered user: file feedback. Identity is stamped in by the server. */
  sendFeedback: (subject, body) => request('POST', '/feedback', { subject, body }),
  /** System Admin: every submission, split into active and archive. */
  getAllFeedback: () => request('GET', '/admin/feedback'),
  /** System Admin: mark complete (Active → Archive), or reopen with false. */
  completeFeedback: (id, complete) => request('POST', '/admin/feedback/complete', { id, complete }),
  /**
   * Admin: dismiss recent errors. A System Admin clears the buffer; a Realm
   * Admin clears only the entries stamped with their own realm.
   */
  clearErrors: () => request('POST', '/admin/status/errors/clear', {}),
  /** Admin: full reset — wipe all data, keep admin accounts (requires confirm: 'ERASE'). */
  wipeData: () => request('POST', '/admin/data/wipe', { confirm: 'ERASE' }),
  /** Court businesses: the market report for their own region. */
  getRegionReport: () => request('GET', '/market/region'),
  /** Court businesses: every shop trading in their region. */
  getCourtCompanies: () => request('GET', '/court/companies'),
  /** Court businesses: one of those shops in full — roster, coffer, performance. */
  getCourtCompany: (business) => request('GET', '/court/company?business=' + encodeURIComponent(business)),
  /* ---- Court Tools: a region's government ---- */
  /** The Court Tools landing data: levy rate, notice, dues owed, standings. */
  getCourt: () => request('GET', '/court'),
  /** Set the levy percentage (0 = off) and/or the region's notice. */
  saveCourtSettings: (patch) => request('POST', '/court/settings', patch),
  /** Grant a licence, restrict, bar, or clear a shop's standing. */
  setCourtStanding: (business, standing, note) => request('POST', '/court/standing', { business, standing, note }),
  /** Price controls in force across the region. */
  getCourtPrices: () => request('GET', '/court/prices'),
  /** Set (or, with both blank, remove) the floor and ceiling on one item. */
  saveCourtPrice: (item, min, max) => request('POST', '/court/prices', { item, min, max }),
  /** What each shop owes — or one shop's levy history with ?business=. */
  getCourtDues: (business) => request('GET', '/court/dues' + (business ? '?business=' + encodeURIComponent(business) : '')),
  /** Record a levy payment received; credits the Court's own coffer. */
  payCourtDues: (business, amount, note) => request('POST', '/court/dues/pay', { business, amount, note }),
  /** The treasury: public spending by category. */
  getCourtSpending: () => request('GET', '/court/spending'),
  /** Spend public money; debits the Court's own coffer. */
  spendCourt: (category, amount, note) => request('POST', '/court/spending', { category, amount, note }),
  /** What the whole region holds, by item. */
  getCourtStock: () => request('GET', '/court/stock'),
  /** Banners for the current user: { notices[], banners[] }. Deduped for ~3s. */
  getMotd: () => {
    const now = Date.now();
    // 30s, not 3s. This fires on every page render and every banner refresh,
    // and behind it the Worker recomputes certification, pending transfers and
    // the low-stock scan. Notices are not time-critical to the second.
    if (_motd && now - _motd.at < 30000) return _motd.p;
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
  /** Owner/admin: this shop's own performance (overview, trends, top items). */
  getShopReport: () => request('GET', '/business/report'),
  /** Owner/admin: this shop's own notice board. */
  getShopNotices: () => request('GET', '/business/notices'),
  /** Owner/admin: post a notice to this shop's staff. */
  addShopNotice: (n) => request('POST', '/business/notices', n),
  /** Owner/admin: delete one of this shop's notices. */
  deleteShopNotice: (id) => request('POST', '/business/notices/delete', { id }),
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
  /** Admin: the audit trail, optionally filtered ({actor, action, from, to}). */
  getAudit: (f) => {
    const q = new URLSearchParams();
    Object.entries(f || {}).forEach(([k, v]) => { if (v) q.set(k, v); });
    const s = q.toString();
    return request('GET', '/admin/audit' + (s ? '?' + s : ''));
  },
  /** Owner/admin: remove an intake entry — stock comes back out, coffer refunded. */
  deleteIntake: (id) => request('POST', '/business/intake/delete', { id }),
  /** Owner/admin: craft — consume ingredients from stock, produce another item. */
  convertInventory: (inputs, output, idempotencyKey) =>
    request('POST', '/business/inventory/convert', { inputs, output, idempotencyKey }),
  /** Any registered user: the item index ({items, types} — name, base value, type). */
  getItems: () => request('GET', '/items'),
  /** Admin: add/edit a master item (rename via oldName; `category` files it). */
  saveMasterItem: (item) => request('POST', '/admin/items', item),
  /** Admin: empty this realm's index, or one type table (requires confirm: 'PURGE'). */
  purgeItems: (category) => request('POST', '/admin/items/purge', { confirm: 'PURGE', category: category || '' }),
  /** Admin: delete a master item. */
  deleteMasterItem: (name) => request('POST', '/admin/items/delete', { name }),
  /** Admin: re-file a selection of items into one table. */
  moveItems: (names, category) => request('POST', '/admin/items/move', { names, category }),
  /**
   * Admin: bulk import master items [{name, baseValue, type}]. Recognized names
   * update, not duplicate. `into` is the table unflagged rows land in — omit it
   * (the whole-index import) and they go to Unsorted.
   */
  importMasterItems: (rows, into) => request('POST', '/admin/items/import', { rows, into: into || '' }),
  /** Admin: classify an item import (create/update/typos/newTypes) without applying it. */
  analyzeItems: (rows, into) => request('POST', '/admin/items/import/analyze', { rows, into: into || '' }),
  /** Admin: add a type table (flags: extra words that sort an import into it). */
  addItemType: (name, flags) => request('POST', '/admin/item-types', { name, flags: flags || [] }),
  /** Admin: rename a type table (its items move with it) and/or replace its flags. */
  updateItemType: (name, patch) => request('POST', '/admin/item-types/update', { name, ...patch }),
  /** Admin: remove a type table — its items are re-filed as Unsorted, not deleted. */
  deleteItemType: (name) => request('POST', '/admin/item-types/delete', { name }),
  /** Admin: replace the hold index. */
  setRegions: (regions) => request('POST', '/admin/regions', { holds: regions }),

  /* ---- realms (multi-server) ----
   * Everything below acts on the realm the caller is CURRENTLY VIEWING, which
   * the Worker reads from their own user row. The client never sends a realm
   * with ordinary requests — only realmSelect changes which one is active.
   */
  /** Admin: every realm, with its shop + member counts. */
  getRealms: () => request('GET', '/admin/realms'),
  /** Super admin: create a realm. */
  createRealm: (name, slug) => request('POST', '/admin/realms/create', { name, slug }),
  /** Super admin: rename a realm. */
  renameRealm: (id, name) => request('POST', '/admin/realms/rename', { id, name }),
  /** Super admin: delete a realm AND everything in it. */
  deleteRealm: (id) => request('POST', '/admin/realms/delete', { id, confirm: 'DELETE' }),
  /** Super admin: choose which realm the app shows data for ('' = own realm). */
  selectRealm: (realmId) => request('POST', '/admin/realms/select', { realmId }),
  /** Admin: row counts for the realm being viewed. */
  getRealmStats: () => request('GET', '/admin/realms/stats'),
  /** Super admin: move one member to another realm. */
  transferMemberRealm: (uid, toRealm, fromRealm) => request('POST', '/admin/realms/transfer-member', { uid, toRealm, fromRealm }),
  /** Super admin: move a company (and its members) to another realm. */
  transferCompanyRealm: (id, toRealm, fromRealm) => request('POST', '/admin/realms/transfer-company', { id, toRealm, fromRealm }),
  /** Admin: this realm's preferences (denomination, region field). */
  getRealmPrefs: () => request('GET', '/admin/realm-prefs'),
  /** Admin: save this realm's preferences. */
  setRealmPrefs: (prefs) => request('POST', '/admin/realm-prefs', prefs),
  /** System Admin: issue a new founder code for a realm (the old one dies). */
  resetRealmCode: (id) => request('POST', '/admin/realms/code', { id }),
  /** Owner/admin: this shop's staff code, for handing to employees. */
  getBusinessCode: () => request('GET', '/business/code'),
  /** Owner/admin: issue a new staff code (the old one dies). */
  resetBusinessCode: () => request('POST', '/business/code/reset', {}),
  /** Public: sitewide branding (name, logo, favicon, footer, accent). */
  getBranding: () => request('GET', '/branding'),
  /** Admin: read branding for editing. */
  getBrandingAdmin: () => request('GET', '/admin/branding'),
  /** Admin: save sitewide branding. */
  setBranding: (b) => request('POST', '/admin/branding', b),
  /**
   * Tile artwork (key → image URL), cached for the session.
   *
   * Six screens ask for this on every render and it only changes when an admin
   * edits it, so the promise is shared. bustTiles() clears it after a save and
   * a realm switch — artwork is per realm.
   */
  getTiles: () => {
    if (!_tiles) {
      _tiles = request('GET', '/tiles');
      _tiles.catch(() => { _tiles = null; }); // don't cache a failure
    }
    return _tiles;
  },
  /** Forget the cached artwork (after an admin saves it, or a realm switch). */
  bustTiles: () => { _tiles = null; },
  /** Admin: read the tile artwork map. */
  getTileImages: () => request('GET', '/admin/tiles'),
  /** Admin: save the tile artwork map ({ key: httpsUrl }); blank clears a tile. */
  setTileImages: async (images) => { const r = await request('POST', '/admin/tiles', { images }); _tiles = null; return r; },
  /** Admin: whether public storefronts are enabled. */
  getStorefrontFlag: () => request('GET', '/admin/storefronts'),
  /** Admin: enable/disable public storefronts. */
  setStorefrontFlag: (enabled) => request('POST', '/admin/storefronts', { enabled }),
  /** Public (no auth): a shop's read-only catalog. */
  getPublicStorefront: (business, realmId) => request('GET', '/public/storefront?b=' + encodeURIComponent(business || '') +
    (realmId ? '&realm=' + encodeURIComponent(realmId) : '')),
  /** The network hold list. */
  /** The region list for the caller's realm. (Sign-up gets its own from checkCode.) */
  getRegions: () => request('GET', '/regions'),
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
