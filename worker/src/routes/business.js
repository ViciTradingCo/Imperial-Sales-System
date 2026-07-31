/**
 * Business-operations routes — everything a registered user, owner, or employee
 * does: inventory, intake, the register, transfers, the shop ledger (coffers /
 * discounts / style), per-shop settings, the item + hold lookups, certification,
 * MOTD banners, the Court hold report, and the owner CSV export.
 */
import { requireUser, requireRegistered, requireOwnerOrAdmin, requireActive, publicUser, actorName, findBusinessMeta } from '../guards.js';
import { listUsersByBusiness, setUserStatus, setUserNote, findUserByUid } from '../users.js';
import { renameBusiness, listBusinessNames } from '../registry.js';
import { getFlag } from '../db.js';
import { logAudit } from '../audit.js';
import { readBusinessSettings, writeBusinessSettings } from '../business-settings.js';
import { listInventory, upsertItem, deleteItem, importInventory, lowStockReport } from '../inventory.js';
import { recordIntake, listIntake } from '../intake.js';
import { readHolds } from '../holds.js';
import { listItemIndex } from '../item-index.js';
import { checkCertification } from '../cert.js';
import { checkout, listSales, voidSale, employeePerformance } from '../sales.js';
import { createTransfer, listTransfers, acceptTransfer, cancelTransfer, declineTransfer, countIncomingPending, listTransferHistory } from '../transfers.js';
import { cofferSummary, adjustCoffer } from '../coffers.js';
import { listDiscounts, addDiscount, deleteDiscount } from '../discounts.js';
import { getShopStyle, setShopStyle } from '../shop-style.js';
import { readMotd, readWarnDays, activeNoticesForBusiness } from '../motd.js';
import { holdReport } from '../market.js';
import { businessCsv } from '../export.js';
import { publicStorefront } from '../storefront.js';

/* ---- employees ---- */
async function listEmployees({ request, env, url }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can view the employee roster.');
    e.forbidden = true; throw e;
  }
  const business = caller.role === 'admin' && url.searchParams.get('business')
    ? url.searchParams.get('business') : caller.business;
  const users = await listUsersByBusiness(env, business);
  return {
    business,
    employees: users.map((u) => ({ uid: u.uid, email: u.email, character: u.character, role: u.role, isOwner: u.isOwner, status: u.status, notes: u.notes || '' })),
  };
}
async function activateEmployee({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can activate employees.');
    e.forbidden = true; throw e;
  }
  const targetUid = String(body.uid || '').trim();
  if (!targetUid) throw new Error('Which employee? A uid is required.');
  const roster = await listUsersByBusiness(env, caller.business);
  const target = roster.find((u) => u.uid === targetUid);
  if (!target && caller.role !== 'admin') {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true; throw e;
  }
  const found = target || (caller.role === 'admin' ? await findUserByUid(env, targetUid) : null);
  if (!found) throw new Error('No such employee.');
  await setUserStatus(env, found.uid, 'active');
  return { ok: true, uid: targetUid, status: 'active' };
}
async function employeeNote({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can add employee notes.');
    e.forbidden = true; throw e;
  }
  const targetUid = String(body.uid || '').trim();
  if (!targetUid) throw new Error('Which employee? A uid is required.');
  const roster = await listUsersByBusiness(env, caller.business);
  const target = roster.find((u) => u.uid === targetUid);
  const found = target || (caller.role === 'admin' ? await findUserByUid(env, targetUid) : null);
  if (!found) {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true; throw e;
  }
  await setUserNote(env, found.uid, body.note);
  return { ok: true, uid: targetUid };
}
async function employeePerformanceRoute({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { performance: await employeePerformance(env, caller.business) };
}
async function lowStock({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await lowStockReport(env, caller.business);
}

/* ---- per-shop settings + rename ---- */
async function ledgerBusiness(request, env, override) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can manage ledger settings.');
    e.forbidden = true; throw e;
  }
  return caller.role === 'admin' && override ? override : caller.business;
}
async function getLedgerSettings({ request, env, url }) {
  return readBusinessSettings(env, await ledgerBusiness(request, env, url.searchParams.get('business')));
}
async function saveLedgerSettings({ request, env, body }) {
  return writeBusinessSettings(env, await ledgerBusiness(request, env, body.business), body.updates || []);
}
async function renameBusinessRoute({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can rename the company.');
    e.forbidden = true; throw e;
  }
  const newName = String(body.name || '').trim();
  if (!newName) throw new Error('Enter a company name.');
  await renameBusiness(env, caller.business, newName);
  caller.business = newName;
  return publicUser(caller);
}

/* ---- inventory ---- */
async function getInventory({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { inventory: await listInventory(env, caller.business) };
}
async function saveItem({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true; throw e;
  }
  return { inventory: await upsertItem(env, caller.business, body) };
}
async function deleteItemRoute({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true; throw e;
  }
  return { inventory: await deleteItem(env, caller.business, body.item) };
}
async function importInventoryRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await importInventory(env, caller.business, body.rows);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'inventory.import', detail: (res.imported || 0) + ' items' });
  return res;
}

/* ---- intake ---- */
async function getIntake({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { intake: await listIntake(env, caller.business, 20) };
}
async function recordIntakeRoute({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can record intake.');
    e.forbidden = true; throw e;
  }
  const intake = await recordIntake(env, caller.business, body);
  return { intake, inventory: await listInventory(env, caller.business) };
}

/* ---- register ---- */
async function getCert({ request, env }) {
  const caller = await requireRegistered(request, env);
  return await checkCertification(env, caller.business);
}
async function checkoutRoute({ request, env, body }) {
  const caller = await requireActive(request, env);
  return await checkout(env, caller.business, caller, body);
}
async function listSalesRoute({ request, env, url }) {
  const caller = await requireActive(request, env);
  return { sales: await listSales(env, caller.business, url.searchParams.get('q'), 25) };
}
async function voidSaleRoute({ request, env, body }) {
  const caller = await requireActive(request, env);
  return await voidSale(env, caller.business, body.orderNo);
}

/* ---- transfers ---- */
async function listTransfersRoute({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await listTransfers(env, caller.business);
}
async function createTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await createTransfer(env, caller.business, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.send', detail: (body.item || '') + ' ×' + (body.qty || '') + ' → ' + (body.toBusiness || '') });
  return await listTransfers(env, caller.business);
}
async function acceptTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await acceptTransfer(env, caller.business, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.accept', detail: 'id ' + body.id });
  return await listTransfers(env, caller.business);
}
async function cancelTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await cancelTransfer(env, caller.business, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.cancel', detail: 'id ' + body.id });
  return await listTransfers(env, caller.business);
}
async function declineTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await declineTransfer(env, caller.business, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.decline', detail: 'id ' + body.id });
  return await listTransfers(env, caller.business);
}
async function transferHistory({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { history: await listTransferHistory(env, caller.business) };
}

/* ---- shop ledger: coffers / discounts / style ---- */
async function getCoffer({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await cofferSummary(env, caller.business);
}
async function adjustCofferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await adjustCoffer(env, caller.business, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'coffer.adjust', detail: (Number(body.amount) || 0) + 'gp ' + (body.note || '') });
  return res;
}
async function getDiscounts({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { discounts: await listDiscounts(env, caller.business) };
}
async function addDiscountRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { discounts: await addDiscount(env, caller.business, body) };
}
async function deleteDiscountRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { discounts: await deleteDiscount(env, caller.business, body.id) };
}
async function getStyle({ request, env }) {
  const caller = await requireRegistered(request, env);
  return await getShopStyle(env, caller.business);
}
async function setStyle({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await setShopStyle(env, caller.business, body);
}

/** Owner/admin: download this shop's sales or coffer ledger as a CSV. */
async function ownerExport({ request, env, url, cors }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const type = url.searchParams.get('type') === 'coffer' ? 'coffer' : 'sales';
  const { filename, csv } = await businessCsv(env, caller.business, type);
  return new Response(csv, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + filename + '"' },
  });
}

/* ---- lookups shared across the app ---- */
async function listBusinesses({ request, env }) {
  await requireRegistered(request, env);
  return { businesses: await listBusinessNames(env) };
}
async function getItems({ request, env }) {
  await requireRegistered(request, env);
  return { items: await listItemIndex(env) };
}
/** Any registered user: the admin-assigned tile artwork (key → image URL). */
async function getTiles({ request, env }) {
  await requireRegistered(request, env);
  const raw = await getFlag(env, 'tile_images');
  let images = {};
  try { images = raw ? JSON.parse(raw) : {}; } catch (e) { images = {}; }
  return { images };
}
async function getHolds({ request, env }) {
  await requireUser(request, env); // usable during registration (caller not registered yet)
  return { holds: await readHolds(env) };
}
async function holdReportRoute({ request, env }) {
  const caller = await requireRegistered(request, env);
  const meta = await findBusinessMeta(env, caller.business);
  if (!meta.court) {
    const e = new Error('This report is available to Court businesses only.');
    e.forbidden = true; throw e;
  }
  return await holdReport(env, meta.hold);
}

/** Public (no auth): a shop's read-only catalog, if storefronts are enabled. */
async function storefront({ env, url }) {
  return await publicStorefront(env, url.searchParams.get('b'));
}

/* ---- MOTD banners ---- */
function daysUntil(untilStr) {
  const d = new Date(untilStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
async function getMotd({ request, env }) {
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
        banners.push({ text: '⚠ ' + caller.business + '’s Vici Trading Co. certification has EXPIRED — renew with an admin to keep selling.' });
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
  if (caller.role === 'admin' && new Date().getUTCDay() === 1) {
    banners.push({
      text: '🗓️ Start of the week — download a fresh data backup.',
      action: { label: 'Backup', route: '/admin/settings' },
    });
  }
  // Owner low/out-of-stock nudge → opens a focal report.
  if (caller.role === 'owner' || caller.role === 'admin') {
    try {
      const { out, low } = await lowStockReport(env, caller.business);
      const n = out.length + low.length;
      if (n > 0) {
        banners.push({
          text: '📦 ' + n + ' item' + (n === 1 ? '' : 's') + ' need restocking' + (out.length ? ' — ' + out.length + ' out of stock' : '') + '.',
          action: { label: 'View report', modal: 'lowstock' },
        });
      }
    } catch (e) { /* inventory optional */ }
  }
  return { notices, banner: banners[0] ? banners[0].text : null, banners };
}

export const routes = [
  { method: 'GET', path: '/business/employees', handler: listEmployees },
  { method: 'POST', path: '/business/employees/activate', handler: activateEmployee },
  { method: 'POST', path: '/business/employees/note', handler: employeeNote },
  { method: 'GET', path: '/business/employees/performance', handler: employeePerformanceRoute },
  { method: 'GET', path: '/business/low-stock', handler: lowStock },
  { method: 'GET', path: '/business/settings', handler: getLedgerSettings },
  { method: 'POST', path: '/business/settings', handler: saveLedgerSettings },
  { method: 'POST', path: '/business/rename', handler: renameBusinessRoute },
  { method: 'GET', path: '/business/export', handler: ownerExport },
  { method: 'GET', path: '/business/coffer', handler: getCoffer },
  { method: 'POST', path: '/business/coffer/adjust', handler: adjustCofferRoute },
  { method: 'GET', path: '/business/discounts', handler: getDiscounts },
  { method: 'POST', path: '/business/discounts', handler: addDiscountRoute },
  { method: 'POST', path: '/business/discounts/delete', handler: deleteDiscountRoute },
  { method: 'GET', path: '/business/style', handler: getStyle },
  { method: 'POST', path: '/business/style', handler: setStyle },
  { method: 'GET', path: '/inventory', handler: getInventory },
  { method: 'POST', path: '/inventory', handler: saveItem },
  { method: 'POST', path: '/inventory/delete', handler: deleteItemRoute },
  { method: 'POST', path: '/inventory/import', handler: importInventoryRoute },
  { method: 'GET', path: '/intake', handler: getIntake },
  { method: 'POST', path: '/intake', handler: recordIntakeRoute },
  { method: 'GET', path: '/cert', handler: getCert },
  { method: 'POST', path: '/sale', handler: checkoutRoute },
  { method: 'GET', path: '/sales', handler: listSalesRoute },
  { method: 'POST', path: '/sales/void', handler: voidSaleRoute },
  { method: 'GET', path: '/transfers', handler: listTransfersRoute },
  { method: 'POST', path: '/transfers', handler: createTransferRoute },
  { method: 'POST', path: '/transfers/accept', handler: acceptTransferRoute },
  { method: 'POST', path: '/transfers/cancel', handler: cancelTransferRoute },
  { method: 'POST', path: '/transfers/decline', handler: declineTransferRoute },
  { method: 'GET', path: '/transfers/history', handler: transferHistory },
  { method: 'GET', path: '/businesses', handler: listBusinesses },
  { method: 'GET', path: '/items', handler: getItems },
  { method: 'GET', path: '/holds', handler: getHolds },
  { method: 'GET', path: '/tiles', handler: getTiles },
  { method: 'GET', path: '/market/hold', handler: holdReportRoute },
  { method: 'GET', path: '/motd', handler: getMotd },
  { method: 'GET', path: '/public/storefront', handler: storefront },
];
