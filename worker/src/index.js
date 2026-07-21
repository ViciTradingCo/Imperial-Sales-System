/**
 * EEC Sales System — backend API (Cloudflare Worker).
 *
 * This is THE trust boundary. It:
 *   • verifies the caller's Google ID token (verify.js),
 *   • resolves them to a UID / role / business in the Core (users.js),
 *   • reads/writes Google Sheets as the service account (sheets.js),
 *   • returns only what that caller is allowed to see.
 *
 * Phase 1 surface:
 *   GET  /health     — liveness + config sanity (no auth)
 *   POST /auth/me    — verify token, return registry identity (or registered:false)
 *
 * Later phases add the role-scoped data routes. Authorization for those lives
 * HERE, never in the browser.
 *
 * Secrets (via `wrangler secret put`): SA_KEY (service-account JSON).
 * Vars (wrangler.toml [vars] or dashboard): CORE_SPREADSHEET_ID,
 *   GOOGLE_CLIENT_ID, ALLOWED_ORIGIN.
 */
import { verifyIdToken } from './verify.js';
import { findUserByEmail, listUsersByBusiness, listAllUsers, updateMember, deleteMember, setUserStatus, setUserCharacter, setUserNote, touchLastSeen, USERS_SHEET } from './users.js';
import { registerUser, renameBusiness, listCompanies, updateCompany, archiveCompany, findBusinessMeta, listBusinessNames } from './registry.js';
import { createTransfer, listTransfers, acceptTransfer, cancelTransfer, declineTransfer, countIncomingPending, listTransferHistory } from './transfers.js';
import { cofferSummary, adjustCoffer } from './coffers.js';
import { listDiscounts, addDiscount, deleteDiscount } from './discounts.js';
import { getShopStyle, setShopStyle } from './shop-style.js';
import { logAudit, listAudit } from './audit.js';
import { readRange } from './sheets.js';
import { readSettings, writeSettings } from './settings.js';
import { readBusinessSettings, writeBusinessSettings } from './business-settings.js';
import { listInventory, upsertItem, deleteItem, importInventory } from './inventory.js';
import { recordIntake, listIntake } from './intake.js';
import { readHolds, writeHolds } from './holds.js';
import { listItemIndex, upsertItem as upsertMasterItem, deleteItemIndex, importItemIndex } from './item-index.js';
import { checkCertification } from './cert.js';
import { checkout, listSales, voidSale, employeePerformance } from './sales.js';
import { rateHit, isPriorityToken, markPriority, MAX_BODY_BYTES } from './ratelimit.js';
import { renameBusinessData, ensureSchema, clearLogs } from './db.js';
import { runBackup } from './backup.js';
import { marketAnalysis, holdReport } from './market.js';
import { readMotd, writeMotd, readWarnDays, writeWarnDays, listIndividualMotds, addIndividualMotd, updateIndividualMotd, deleteIndividualMotd, activeNoticesForBusiness } from './motd.js';

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Echo the origin when it's on the allow-list; fall back to the first
  // configured origin so a misconfigured ALLOWED_ORIGIN fails visibly.
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/** Parses a JSON request body sent as text/plain (our CORS-preflight-free shape). */
async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Request body was not valid JSON.'); }
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

/** Verifies the Bearer ID token on a request; returns the decoded payload or throws. */
async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error('Missing bearer token.');
  return verifyIdToken(m[1], env.GOOGLE_CLIENT_ID);
}

/** Shapes a Users record for the client (never leaks sheet internals like row #). */
function publicUser(user, extra) {
  return {
    registered: true,
    uid: user.uid,
    email: user.email,
    character: user.character || '',
    business: user.business,
    role: user.role,
    isOwner: user.isOwner,
    status: user.status,
    ...(extra || {}),
  };
}

/** Verifies the token AND requires the caller to be a registered user. */
async function requireRegistered(request, env) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    const err = new Error('You are not registered yet.');
    err.notRegistered = true;
    err.payload = payload;
    throw err;
  }
  return user;
}

async function handleMe(request, env) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    return { registered: false, email: payload.email, name: payload.name || '' };
  }
  touchLastSeen(env, user.row); // fire-and-forget
  const meta = await findBusinessMeta(env, user.business);
  // Learn this token's priority tier for the rate limiter.
  const tok = (String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1];
  markPriority(tok, meta.priority);
  return publicUser(user, { court: meta.court, hold: meta.hold });
}

/** Lets a signed-in user edit their own profile (currently the character name). */
async function handleUpdateProfile(request, env, body) {
  const user = await requireRegistered(request, env);
  const character = String(body.character || '').trim();
  if (!character) throw new Error("Your character name can't be empty.");
  await setUserCharacter(env, user.row, character);
  user.character = character;
  const meta = await findBusinessMeta(env, user.business);
  return publicUser(user, { court: meta.court, hold: meta.hold });
}

async function handleRegister(request, env, body) {
  const payload = await requireUser(request, env);
  const existing = await findUserByEmail(env, payload.email);
  if (existing) return publicUser(existing); // idempotent
  const user = await registerUser(env, {
    email: payload.email,
    name: payload.name || '',
    character: body.character,
    businessName: body.businessName,
    asOwner: !!body.asOwner,
    hold: body.hold,
  });
  return publicUser(user);
}

/** Owners/admins only: the roster of their business (admins may pass ?business=). */
async function handleListEmployees(request, env, url) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can view the employee roster.');
    e.forbidden = true;
    throw e;
  }
  const business = caller.role === 'admin' && url.searchParams.get('business')
    ? url.searchParams.get('business')
    : caller.business;
  const users = await listUsersByBusiness(env, business);
  return {
    business,
    // Notes are owner/admin-only — they're only ever returned on this roster.
    employees: users.map((u) => ({ uid: u.uid, email: u.email, character: u.character, role: u.role, isOwner: u.isOwner, status: u.status, notes: u.notes || '' })),
  };
}

/** Owners/admins only: set an owner-private note on one of their employees. */
async function handleEmployeeNote(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can add employee notes.');
    e.forbidden = true;
    throw e;
  }
  const targetUid = String(body.uid || '').trim();
  if (!targetUid) throw new Error('Which employee? A uid is required.');
  const roster = await listUsersByBusiness(env, caller.business);
  const target = roster.find((u) => u.uid === targetUid);
  // Scope: an owner can only note their OWN business's roster (an admin any).
  const found = target || (caller.role === 'admin' ? await findUserByUid(env, targetUid) : null);
  if (!found) {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true;
    throw e;
  }
  await setUserNote(env, found.row, body.note);
  return { ok: true, uid: targetUid };
}

/** Requires the caller to be a registered admin. */
async function requireAdmin(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'admin') {
    const e = new Error('Admins only.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

async function handleGetSettings(request, env) {
  await requireAdmin(request, env);
  return { settings: await readSettings(env) };
}

async function handleListMembers(request, env) {
  await requireAdmin(request, env);
  return { members: await listAllUsers(env) };
}

async function handleUpdateMember(request, env, body) {
  const caller = await requireAdmin(request, env);
  await updateMember(env, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'member.update', detail: 'uid ' + body.uid + ' → ' + body.role + ', ' + (body.business || '') });
  return { members: await listAllUsers(env) };
}

async function handleDeleteMember(request, env, body) {
  const caller = await requireAdmin(request, env);
  await deleteMember(env, body.uid);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'member.delete', detail: 'uid ' + body.uid });
  return { members: await listAllUsers(env) };
}

async function handleListCompanies(request, env) {
  await requireAdmin(request, env);
  return { companies: await listCompanies(env) };
}

async function handleUpdateCompany(request, env, body) {
  const caller = await requireAdmin(request, env);
  const companies = await updateCompany(env, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'company.update', detail: (body.name || '') + (body.court ? ' [Court]' : '') });
  return { companies };
}

async function handleDeleteCompany(request, env, body) {
  const caller = await requireAdmin(request, env);
  const companies = await archiveCompany(env, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'company.archive', detail: 'id ' + body.id });
  return { companies };
}

/** Admin-only: run the D1 → Sheets backup on demand (the cron does it on a schedule). */
async function handleRunBackup(request, env) {
  await requireAdmin(request, env);
  return await runBackup(env);
}

/** Admin-only: network-wide market analytics over the D1 store. */
async function handleMarket(request, env) {
  await requireAdmin(request, env);
  return await marketAnalysis(env);
}

/** Admin-only: wipe the sales + intake logs across the whole network. */
async function handleClearLogs(request, env) {
  const caller = await requireAdmin(request, env);
  const res = await clearLogs(env);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'logs.clear', detail: (res.sales || 0) + ' sales, ' + (res.intake || 0) + ' intake' });
  return res;
}

function daysUntil(untilStr) {
  const d = new Date(untilStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/**
 * Any registered user: the banners to show — Home notices (global + active
 * per-business messages) and a persistent expiry banner for owner/employees.
 */
async function handleGetMotd(request, env) {
  const caller = await requireRegistered(request, env);
  const notices = [];
  const global = await readMotd(env);
  if (global) notices.push(global);
  notices.push(...(await activeNoticesForBusiness(env, caller.business)));

  const banners = [];
  if (caller.role === 'owner' || caller.role === 'employee') {
    const cert = await checkCertification(env, caller.business);
    if (!cert.perpetual) {
      if (cert.status === 'EXPIRED') {
        banners.push({ text: '⚠ ' + caller.business + '’s East Empire certification has EXPIRED — renew with an admin to keep selling.' });
      } else if (cert.until) {
        const warnDays = await readWarnDays(env);
        const left = daysUntil(cert.until);
        if (left != null && left <= warnDays) {
          banners.push({ text: '⚠ ' + caller.business + '’s certification expires in ' + left + ' day' +
            (left === 1 ? '' : 's') + ' (' + cert.until + '). Renew with an admin.' });
        }
      }
    }
  }
  // Pending inbound transfers → a banner the receiver's owner/admin can act on.
  if (caller.role === 'owner' || caller.role === 'admin') {
    try {
      const n = await countIncomingPending(env, caller.business);
      if (n > 0) {
        banners.push({
          text: '📦 You have ' + n + ' pending transfer' + (n === 1 ? '' : 's') + ' to accept.',
          action: { label: 'Go to Inventory', route: '/inventory' },
        });
      }
    } catch (e) { /* D1 optional */ }
  }
  return { notices, banner: banners[0] ? banners[0].text : null, banners };
}

/* ---- Admin MOTD management ---- */
async function handleMotdConfig(request, env) {
  await requireAdmin(request, env);
  return { motd: await readMotd(env), warnDays: await readWarnDays(env), individual: await listIndividualMotds(env) };
}
async function handleSetMotd(request, env, body) {
  await requireAdmin(request, env);
  return { motd: await writeMotd(env, body.motd) };
}
async function handleSetWarnDays(request, env, body) {
  await requireAdmin(request, env);
  return { warnDays: await writeWarnDays(env, body.days) };
}
async function handleAddIndividual(request, env, body) {
  await requireAdmin(request, env);
  return { individual: await addIndividualMotd(env, body) };
}
async function handleUpdateIndividual(request, env, body) {
  await requireAdmin(request, env);
  return { individual: await updateIndividualMotd(env, body) };
}
async function handleDeleteIndividual(request, env, body) {
  await requireAdmin(request, env);
  return { individual: await deleteIndividualMotd(env, body.id) };
}

/** Any registered user: active business names (e.g. for the transfer picker). */
async function handleListBusinesses(request, env) {
  await requireRegistered(request, env);
  return { businesses: await listBusinessNames(env) };
}

/** Requires the caller to be an owner or admin; returns the caller record. */
async function requireOwnerOrAdmin(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can do that.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

async function handleCreateTransfer(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  await createTransfer(env, caller.business, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.send', detail: (body.item || '') + ' ×' + (body.qty || '') + ' → ' + (body.toBusiness || '') });
  return await listTransfers(env, caller.business);
}
async function handleListTransfers(request, env) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await listTransfers(env, caller.business);
}
async function handleAcceptTransfer(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  await acceptTransfer(env, caller.business, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.accept', detail: 'id ' + body.id });
  return await listTransfers(env, caller.business);
}
async function handleCancelTransfer(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  await cancelTransfer(env, caller.business, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.cancel', detail: 'id ' + body.id });
  return await listTransfers(env, caller.business);
}
async function handleDeclineTransfer(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  await declineTransfer(env, caller.business, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.decline', detail: 'id ' + body.id });
  return await listTransfers(env, caller.business);
}
async function handleTransferHistory(request, env) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { history: await listTransferHistory(env, caller.business) };
}

/* ---- Shop Ledger: coffers, discounts, style ---- */
async function handleGetCoffer(request, env) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await cofferSummary(env, caller.business);
}
async function handleAdjustCoffer(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await adjustCoffer(env, caller.business, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'coffer.adjust', detail: (Number(body.amount) || 0) + 'gp ' + (body.note || '') });
  return res;
}
async function handleGetDiscounts(request, env) {
  const caller = await requireRegistered(request, env);
  return { discounts: await listDiscounts(env, caller.business) };
}
async function handleAddDiscount(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { discounts: await addDiscount(env, caller.business, body) };
}
async function handleDeleteDiscount(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { discounts: await deleteDiscount(env, caller.business, body.id) };
}
async function handleGetStyle(request, env) {
  const caller = await requireRegistered(request, env);
  return await getShopStyle(env, caller.business);
}
async function handleSetStyle(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await setShopStyle(env, caller.business, body);
}

/** Admin-only: the audit trail. */
async function handleAudit(request, env) {
  await requireAdmin(request, env);
  return { audit: await listAudit(env) };
}

/* ---- Master Item Index + Holds index (admin-managed) ---- */
async function handleGetItems(request, env) {
  await requireRegistered(request, env);
  return { items: await listItemIndex(env) };
}
async function handleUpsertItem(request, env, body) {
  const caller = await requireAdmin(request, env);
  const items = await upsertMasterItem(env, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.upsert', detail: (body.oldName && body.oldName !== body.name ? body.oldName + ' → ' : '') + body.name + ' @ ' + body.baseValue });
  return { items };
}
async function handleDeleteMasterItem(request, env, body) {
  const caller = await requireAdmin(request, env);
  const items = await deleteItemIndex(env, body.name);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.delete', detail: body.name });
  return { items };
}
async function handleImportMasterItems(request, env, body) {
  const caller = await requireAdmin(request, env);
  const res = await importItemIndex(env, body.rows);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.import', detail: (res.imported || 0) + ' items' });
  return res;
}
async function handleSetHolds(request, env, body) {
  const caller = await requireAdmin(request, env);
  const holds = await writeHolds(env, body.holds);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'holds.set', detail: holds.join(', ') });
  return { holds };
}

/** A short actor label for the audit trail. */
function actorName(caller) {
  return (caller.character || caller.email || caller.uid) + (caller.business ? ' (' + caller.business + ')' : '');
}

/** Court businesses only: the market report for their own hold. */
async function handleHoldReport(request, env) {
  const caller = await requireRegistered(request, env);
  const meta = await findBusinessMeta(env, caller.business);
  if (!meta.court) {
    const e = new Error('This report is available to Court businesses only.');
    e.forbidden = true;
    throw e;
  }
  return await holdReport(env, meta.hold);
}

async function handleSaveSettings(request, env, body) {
  await requireAdmin(request, env);
  return { settings: await writeSettings(env, body.updates || []) };
}

/** Which business a ledger-settings request targets: the caller's, or (admin) any. */
async function ledgerSettingsBusiness(request, env, override) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can manage ledger settings.');
    e.forbidden = true;
    throw e;
  }
  return caller.role === 'admin' && override ? override : caller.business;
}

async function handleGetLedgerSettings(request, env, url) {
  const business = await ledgerSettingsBusiness(request, env, url.searchParams.get('business'));
  return readBusinessSettings(env, business);
}

async function handleSaveLedgerSettings(request, env, body) {
  const business = await ledgerSettingsBusiness(request, env, body.business);
  return writeBusinessSettings(env, business, body.updates || []);
}

/** Owner/admin: rename their company everywhere it's referenced. */
async function handleRenameBusiness(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can rename the company.');
    e.forbidden = true;
    throw e;
  }
  const newName = String(body.name || '').trim();
  if (!newName) throw new Error('Enter a company name.');
  await renameBusiness(env, caller.business, newName);
  await renameBusinessData(env, caller.business, newName); // keep D1 rows aligned
  caller.business = newName;
  return publicUser(caller);
}

/** Any registered user may read their own business's inventory. */
async function handleGetInventory(request, env) {
  const caller = await requireRegistered(request, env);
  return { inventory: await listInventory(env, caller.business) };
}

/** Owner/admin: add or update an inventory item. */
async function handleSaveItem(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true;
    throw e;
  }
  return { inventory: await upsertItem(env, caller.business, body) };
}

/** Owner/admin: remove an inventory item. */
async function handleImportInventory(request, env, body) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await importInventory(env, caller.business, body.rows);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'inventory.import', detail: (res.imported || 0) + ' items' });
  return res;
}

async function handleEmployeePerformance(request, env) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { performance: await employeePerformance(env, caller.business) };
}

async function handleDeleteItem(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true;
    throw e;
  }
  return { inventory: await deleteItem(env, caller.business, body.item) };
}

/** Requires a registered user whose account is active (can operate the register). */
async function requireActive(request, env) {
  const user = await requireRegistered(request, env);
  if (user.status !== 'active') {
    const e = new Error('Your account is pending — an owner or admin must activate you before you can use the register.');
    e.forbidden = true;
    throw e;
  }
  return user;
}

async function handleGetCert(request, env) {
  const caller = await requireRegistered(request, env);
  return await checkCertification(env, caller.business);
}

async function handleCheckout(request, env, body) {
  const caller = await requireActive(request, env);
  return await checkout(env, caller.business, caller, body);
}

async function handleListSales(request, env, url) {
  const caller = await requireActive(request, env);
  return { sales: await listSales(env, caller.business, url.searchParams.get('q'), 25) };
}

async function handleVoidSale(request, env, body) {
  const caller = await requireActive(request, env);
  return await voidSale(env, caller.business, body.orderNo);
}

/** Any signed-in user: the network hold list (for intake / sales dropdowns and
 *  the registration form, where the caller isn't registered yet). */
async function handleGetHolds(request, env) {
  await requireUser(request, env);
  return { holds: await readHolds(env) };
}

/** Any registered user: recent intake transactions for their business. */
async function handleGetIntake(request, env) {
  const caller = await requireRegistered(request, env);
  return { intake: await listIntake(env, caller.business, 20) };
}

/** Owner/admin: record a stock intake (purchase) — logs it and adds stock. */
async function handleRecordIntake(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can record intake.');
    e.forbidden = true;
    throw e;
  }
  const intake = await recordIntake(env, caller.business, body);
  return { intake, inventory: await listInventory(env, caller.business) };
}

/** Owners/admins only: activate a pending employee of their own business. */
async function handleActivateEmployee(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can activate employees.');
    e.forbidden = true;
    throw e;
  }
  const targetUid = String(body.uid || '').trim();
  if (!targetUid) throw new Error('Which employee? A uid is required.');
  const roster = await listUsersByBusiness(env, caller.business);
  const target = roster.find((u) => u.uid === targetUid);
  // An owner can only touch their OWN business's roster; the scope check IS the
  // security — a uid from another business simply won't be in this list.
  if (!target && caller.role !== 'admin') {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true;
    throw e;
  }
  const found = target || (caller.role === 'admin' ? (await findUserByUid(env, targetUid)) : null);
  if (!found) throw new Error('No such employee.');
  await setUserStatus(env, found.row, 'active');
  return { ok: true, uid: targetUid, status: 'active' };
}

/** Admin-only helper: locate any user by uid across all businesses. */
async function findUserByUid(env, uid) {
  // Small scale — a linear scan of the Users sheet is fine.
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === uid) {
      return { uid, business: String(rows[i][2] || '').trim(), row: i + 2 };
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Request-size cap (cheap abuse guard, before we read the body).
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
      return json({ error: 'Request too large.' }, 413, cors);
    }
    // Rate limit — keyed by token (or IP), with a higher ceiling for priority
    // businesses (learned at /auth/me). Health checks are exempt.
    if (path !== '/health' && path !== '/') {
      const tok = (String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
      const key = tok ? 'tok:' + tok : 'ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
      const rl = rateHit(key, isPriorityToken(tok));
      if (!rl.ok) return json({ error: 'Rate limit exceeded — slow down.' }, 429, { ...cors, 'Retry-After': String(rl.retryAfter) });
    }

    try {
      if (request.method === 'GET' && (path === '/health' || path === '/')) {
        // Probe D1: 'ok' means bound + migrated; 'error' means bound but the
        // tables aren't there; 'unbound' means no binding yet.
        let db = 'unbound';
        if (env.DB) {
          try { await ensureSchema(env); await env.DB.prepare('SELECT COUNT(*) AS n FROM inventory').first(); db = 'ok'; }
          catch (e) { db = 'error'; }
        }
        return json({
          ok: true,
          service: 'eec-sales-system-api',
          configured: {
            coreId: !!env.CORE_SPREADSHEET_ID,
            clientId: !!env.GOOGLE_CLIENT_ID,
            saKey: !!env.SA_KEY,
            db,
            backup: !!(env.BACKUP_SPREADSHEET_ID && String(env.BACKUP_SPREADSHEET_ID).trim()),
          },
          time: new Date().toISOString(),
        }, 200, cors);
      }

      if (request.method === 'POST' && path === '/auth/me') {
        return json(await handleMe(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/auth/register') {
        const body = await readJsonBody(request);
        return json(await handleRegister(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/me/profile') {
        const body = await readJsonBody(request);
        return json(await handleUpdateProfile(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/business/employees') {
        return json(await handleListEmployees(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/employees/activate') {
        const body = await readJsonBody(request);
        return json(await handleActivateEmployee(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/employees/note') {
        const body = await readJsonBody(request);
        return json(await handleEmployeeNote(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/business/employees/performance') {
        return json(await handleEmployeePerformance(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/settings') {
        return json(await handleGetSettings(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/settings') {
        const body = await readJsonBody(request);
        return json(await handleSaveSettings(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/members') {
        return json(await handleListMembers(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/members/update') {
        const body = await readJsonBody(request);
        return json(await handleUpdateMember(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/members/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteMember(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/companies') {
        return json(await handleListCompanies(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/companies/update') {
        const body = await readJsonBody(request);
        return json(await handleUpdateCompany(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/companies/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteCompany(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/backup') {
        return json(await handleRunBackup(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/market') {
        return json(await handleMarket(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/logs/clear') {
        return json(await handleClearLogs(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/market/hold') {
        return json(await handleHoldReport(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/motd') {
        return json(await handleGetMotd(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/motd') {
        return json(await handleMotdConfig(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/motd') {
        const body = await readJsonBody(request);
        return json(await handleSetMotd(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/motd/warn') {
        const body = await readJsonBody(request);
        return json(await handleSetWarnDays(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/motd/individual') {
        const body = await readJsonBody(request);
        return json(await handleAddIndividual(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/motd/individual/update') {
        const body = await readJsonBody(request);
        return json(await handleUpdateIndividual(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/motd/individual/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteIndividual(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/business/settings') {
        return json(await handleGetLedgerSettings(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/settings') {
        const body = await readJsonBody(request);
        return json(await handleSaveLedgerSettings(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/rename') {
        const body = await readJsonBody(request);
        return json(await handleRenameBusiness(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/inventory') {
        return json(await handleGetInventory(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/inventory') {
        const body = await readJsonBody(request);
        return json(await handleSaveItem(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/inventory/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteItem(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/inventory/import') {
        const body = await readJsonBody(request);
        return json(await handleImportInventory(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/businesses') {
        return json(await handleListBusinesses(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/transfers') {
        return json(await handleListTransfers(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/transfers') {
        const body = await readJsonBody(request);
        return json(await handleCreateTransfer(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/transfers/accept') {
        const body = await readJsonBody(request);
        return json(await handleAcceptTransfer(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/transfers/cancel') {
        const body = await readJsonBody(request);
        return json(await handleCancelTransfer(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/transfers/decline') {
        const body = await readJsonBody(request);
        return json(await handleDeclineTransfer(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/transfers/history') {
        return json(await handleTransferHistory(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/business/coffer') {
        return json(await handleGetCoffer(request, env), 200, cors);
      }
      if (request.method === 'POST' && path === '/business/coffer/adjust') {
        const body = await readJsonBody(request);
        return json(await handleAdjustCoffer(request, env, body), 200, cors);
      }
      if (request.method === 'GET' && path === '/business/discounts') {
        return json(await handleGetDiscounts(request, env), 200, cors);
      }
      if (request.method === 'POST' && path === '/business/discounts') {
        const body = await readJsonBody(request);
        return json(await handleAddDiscount(request, env, body), 200, cors);
      }
      if (request.method === 'POST' && path === '/business/discounts/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteDiscount(request, env, body), 200, cors);
      }
      if (request.method === 'GET' && path === '/business/style') {
        return json(await handleGetStyle(request, env), 200, cors);
      }
      if (request.method === 'POST' && path === '/business/style') {
        const body = await readJsonBody(request);
        return json(await handleSetStyle(request, env, body), 200, cors);
      }
      if (request.method === 'GET' && path === '/admin/audit') {
        return json(await handleAudit(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/items') {
        return json(await handleGetItems(request, env), 200, cors);
      }
      if (request.method === 'POST' && path === '/admin/items') {
        const body = await readJsonBody(request);
        return json(await handleUpsertItem(request, env, body), 200, cors);
      }
      if (request.method === 'POST' && path === '/admin/items/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteMasterItem(request, env, body), 200, cors);
      }
      if (request.method === 'POST' && path === '/admin/items/import') {
        const body = await readJsonBody(request);
        return json(await handleImportMasterItems(request, env, body), 200, cors);
      }
      if (request.method === 'POST' && path === '/admin/holds') {
        const body = await readJsonBody(request);
        return json(await handleSetHolds(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/holds') {
        return json(await handleGetHolds(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/intake') {
        return json(await handleGetIntake(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/intake') {
        const body = await readJsonBody(request);
        return json(await handleRecordIntake(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/cert') {
        return json(await handleGetCert(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/sale') {
        const body = await readJsonBody(request);
        return json(await handleCheckout(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/sales') {
        return json(await handleListSales(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/sales/void') {
        const body = await readJsonBody(request);
        return json(await handleVoidSale(request, env, body), 200, cors);
      }

      return json({ error: 'Not found: ' + path }, 404, cors);
    } catch (err) {
      // Map error kinds to status codes; the frontend surfaces .error verbatim.
      // Stack traces never leave the Worker.
      const msg = err && err.message ? err.message : String(err);
      let status = 400;
      if (err && err.forbidden) status = 403;
      else if (err && err.notRegistered) status = 403;
      else if (/token|bearer|verified|audience|expired|issuer/i.test(msg)) status = 401;
      return json({ error: msg }, status, cors);
    }
  },

  /**
   * Cron Trigger (wrangler.toml [triggers]) — the slow, operator-owned backup.
   * Runs off the request path; errors are logged, not surfaced (no client).
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runBackup(env)
        .then((r) => console.log('Scheduled backup:', JSON.stringify(r)))
        .catch((e) => console.error('Scheduled backup failed:', e && e.message ? e.message : String(e)))
    );
  },
};
