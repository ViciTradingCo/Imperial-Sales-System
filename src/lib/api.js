/**
 * Frontend → Worker API client. Every call carries the session token as a Bearer
 * credential (auth.js gets it by trading a Google sign-in for one); the Worker
 * resolves it to an identity and scopes the response to the caller's
 * role/business. The browser never touches the datastore directly and never
 * holds any backend credential.
 */
import { getIdToken, handleUnauthorized } from './auth.js';

let baseUrl = '';
export function configureApi(url) { baseUrl = String(url || '').replace(/\/$/, ''); }

/**
 * The POSTs that change a reference list, so the cache clears itself rather
 * than relying on twenty call sites to remember.
 *
 * The admin item routes are matched by PREFIX: a new one added later changes
 * the index too, and the failure mode of forgetting is a picker quietly missing
 * an item somebody just created. The other three are the paths that can file a
 * PENDING item — the register meeting a name nobody has entered, a harvest of
 * something new, a stocktake counting something nobody wrote down.
 */
const REF_WRITES = ['/admin/items', '/admin/regions', '/sale', '/inventory/harvest', '/inventory/stocktake'];

/** Forget the cached reference lists (a write, or a realm switch). */
function clearRefCache() { _items = null; _regions = null; }

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

  // A write that lands changes what the reference lists say; a write that fails
  // changed nothing, so the cache is only cleared once the response is in hand.
  if (method === 'POST' && res.ok && REF_WRITES.some((p) => path.startsWith(p))) clearRefCache();

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }

  if (!res.ok) {
    // A 401 means the session was revoked or the Worker no longer knows it. Ask
    // Google for a fresh sign-in rather than leaving the user staring at an
    // error they could only fix by signing out and back in.
    if (res.status === 401 && token) handleUnauthorized();
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
/**
 * The master item index and the realm's regions — the two REFERENCE lists.
 *
 * Both are read by half the app and written by almost none of it, and the index
 * is the largest payload the API serves: every item in the realm. Six views ask
 * for it, and the register asks four times over just by walking Selling →
 * Buying → Harvest → Craft, since each side is its own route and re-mounts.
 *
 * So they are fetched once per session and shared. `bustRef()` clears them, and
 * `request` calls it after anything that can change either — see REF_WRITES.
 *
 * SHARED MEANS SHARED: every caller gets the same array, so nothing may sort or
 * splice it in place. Copy first (`[...r.items]`), as the Item Index does — an
 * in-place sort here would quietly reorder the register's picker too.
 */
let _items = null;
let _regions = null;

export const api = {
  health: () => request('GET', '/health'),
  /** Verifies the signed-in user and returns their profile, or {registered:false}. */
  me: () => request('POST', '/auth/me', {}),
  /** Sign-up: what a Business Code opens, without registering anything. */
  checkCode: (code) => request('POST', '/auth/code', { code }),
  /** Sign-up: register against a Business Code. The code decides realm + role. */
  register: (code, character, businessName, hold) =>
    request('POST', '/auth/register', { code, character, businessName, hold }),
  /**
   * Switches which of your shops you are working as. Returns the fresh profile,
   * so the caller re-renders from what the server now says rather than guessing.
   */
  switchBusiness: (uid) => request('POST', '/auth/business', { uid }),
  /** Adds another shop to an already-registered person, by the same join code. */
  addBusiness: (code, businessName, hold) =>
    request('POST', '/auth/business/add', { code, businessName, hold }),
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
  /** Admin: archive a company — it stops trading, nothing is deleted. */
  archiveCompany: (id) => request('POST', '/admin/companies/archive', { id }),
  /** Admin: the archive, to restore from. */
  getArchivedCompanies: () => request('GET', '/admin/companies/archived'),
  /** Admin: bring an archived company back as it was. */
  restoreCompany: (id) => request('POST', '/admin/companies/restore', { id }),
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
  /** Admin: items the register invented that nobody has confirmed yet. */
  getPendingItems: () => request('GET', '/admin/items/pending'),
  /** Admin: confirm a register-invented item is real and distinct. */
  approveItem: (name) => request('POST', '/admin/items/approve', { name }),
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
  /** Any shop with a region: that region's market for the week just gone. */
  getWeeklyMarket: () => request('GET', '/market/week'),
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
  /** Admin: post a global notice (shown to everyone), optionally scheduled. */
  addGlobalMotd: (m) => request('POST', '/admin/motd/global', m),
  /** Admin: edit a global notice. */
  updateGlobalMotd: (m) => request('POST', '/admin/motd/global/update', m),
  /** Admin: remove a global notice. */
  deleteGlobalMotd: (id) => request('POST', '/admin/motd/global/delete', { id }),
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
  /** What leaving would mean for me — what I am owed, and whether I may. */
  leavePreview: () => request('GET', '/business/leave'),
  /** Leave the shop I work for. My membership goes; what I am owed does not. */
  leaveBusiness: () => request('POST', '/business/leave', { confirm: true }),
  /** Owner: what closing the shop would mean — what is kept, and whether I may. */
  closePreview: () => request('GET', '/business/close'),
  /**
   * Owner: close the shop. `confirm` is its name typed out — the Worker checks
   * it against the shop's own, so a click alone cannot do this. Nothing is
   * destroyed: the company is archived and its books stay on the network's.
   */
  closeBusiness: (confirm) => request('POST', '/business/close', { confirm }),
  /** The shop's bundles — several items sold together for one price. */
  getBundles: () => request('GET', '/business/bundles'),
  /**
   * Owner/manager: create or replace a special. It either NAMES its items
   * (`parts`) or asks for KINDS of item (`needs`) — never both, and the Worker
   * refuses a special that tries. `percentOff` prices it as a percentage off
   * its own items instead of a flat `price`; the Worker works that out at the
   * till from the shop's own prices.
   */
  saveBundle: (name, price, parts, needs, percentOff) =>
    request('POST', '/business/bundles/save', { name, price, parts, needs, percentOff }),
  deleteBundle: (id) => request('POST', '/business/bundles/delete', { id }),
  getInventory: () => request('GET', '/inventory'),
  /** The shop's stock counts as `Name, Amount` text. */
  getStocktake: () => request('GET', '/inventory/stocktake'),
  /** Plan a pasted stocktake (apply=false) or carry it out (apply=true). */
  importStocktake: (text, apply) => request('POST', '/inventory/stocktake', { text, apply: !!apply }),
  /** Owner/admin: add or update an inventory item. */
  saveItem: (item) => request('POST', '/inventory', item),
  /** Owner/admin: delete an inventory item. */
  deleteItem: (item) => request('POST', '/inventory/delete', { item }),
  /** Any active member: stock produced rather than bought (a crop, a hunt, a dig). */
  harvest: (payload) => request('POST', '/inventory/harvest', payload),
  /* ---- time cards ---- */
  /** Whoever is asking: their open shift, their history, and their rate. */
  getTimecard: () => request('GET', '/timecard'),
  clockIn: () => request('POST', '/timecard/in', {}),
  clockOut: (note) => request('POST', '/timecard/out', { note }),
  /** Owner/admin: every shift at this shop, with who is owed what. */
  getTimecardLog: () => request('GET', '/timecard/log'),
  /** Owner/admin: mark wages settled. Records only — it moves no money. */
  payTimecard: (uid, ids) => request('POST', '/timecard/pay', { uid, ids }),
  editShift: (shift) => request('POST', '/timecard/edit', shift),
  deleteShift: (id) => request('POST', '/timecard/delete', { id }),
  /** Owner/admin: set an employee's hourly rate. */
  /** Owner: what an employee earns — an hourly rate, a commission percentage, or both. */
  setPayRate: (uid, rate, commissionRate) => request('POST', '/business/employees/rate', { uid, rate, commissionRate }),
  /** Owner: appoint an employee as a manager, or stand one down. */
  setManager: (uid, manager) => request('POST', '/business/employees/manager', { uid, manager }),
  /**
   * Owner/manager: set ONE kind across the shop — "these are the food".
   * A whole-list answer: what is not named has the tag taken off.
   */
  setItemTag: (tag, items) => request('POST', '/inventory/tag', { tag, items }),
  /** Owner/admin: correct an item's stock by hand (a stocktake, breakage, spoilage). */
  setStock: (item, stock, note) => request('POST', '/inventory/stock', { item, stock, note }),
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
  updateShopNotice: (n) => request('POST', '/business/notices/update', n),
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
  getItems: () => {
    if (!_items) {
      _items = request('GET', '/items');
      _items.catch(() => { _items = null; }); // don't cache a failure
    }
    return _items;
  },
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
  /** The region list for the caller's realm. (Sign-up gets its own from checkCode.) */
  getRegions: () => {
    if (!_regions) {
      _regions = request('GET', '/regions');
      _regions.catch(() => { _regions = null; });
    }
    return _regions;
  },
  /** Forget both cached reference lists — used on a realm switch. */
  bustRef: clearRefCache,
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
