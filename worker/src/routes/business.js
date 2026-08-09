/**
 * Business-operations routes — everything a registered user, owner, or employee
 * does: inventory, intake, the register, transfers, the shop ledger (coffers /
 * discounts / style), per-shop settings, the item + hold lookups, certification,
 * MOTD banners, the Court hold report, and the owner CSV export.
 */
import { requireRegistered, requireOwnerOrAdmin, requireActive, publicUser, actorName, findBusinessMeta, realmIdOf } from '../guards.js';
import { listUsersByBusiness, setUserStatus, setUserNote, findUserByUid, setPayRate } from '../users.js';
import { renameBusiness, listBusinessCards } from '../registry.js';
import { getFlag } from '../db.js';
import { logAudit } from '../audit.js';
import { readBusinessSettings, writeBusinessSettings } from '../business-settings.js';
import { listInventory, upsertItem, deleteItem, importInventory, lowStockReport, convertItems, setStock } from '../inventory.js';
import { recordIntakeLines, recordHarvest, listIntake, deleteIntake } from '../intake.js';
import { readRegions } from '../regions.js';
import { listItemIndex, listItemTypes, listPendingItems } from '../item-index.js';
import { checkCertification } from '../cert.js';
import { checkout, listSales, voidSale, employeePerformance } from '../sales.js';
import { createTransfer, listTransfers, acceptTransfer, cancelTransfer, declineTransfer, countIncomingPending, listTransferHistory } from '../transfers.js';
import { cofferSummary, adjustCoffer } from '../coffers.js';
import { listDiscounts, addDiscount, deleteDiscount } from '../discounts.js';
import { getShopStyle, setShopStyle } from '../shop-style.js';
import { readMotd, readWarnDays, activeNoticesForBusiness,
  listMotdsForBusiness, addMotdForBusiness, deleteMotdForBusiness } from '../motd.js';
import { holdReport, businessReport } from '../market.js';
import { lastWeekWindow, isWeekTurnover } from '../week.js';
import { openShift, clockIn, clockOut, myShifts, shopShifts, markPaid, editShift, deleteShift } from '../timecard.js';
import { requireCourt, courtCompanies, courtShop } from '../oversight.js';
import {
  SPEND_CATEGORIES, STANDINGS, readCourtSettings, writeCourtSettings,
  courtStandings, setCourtStanding, courtPrices, setCourtPrice,
  courtDues, courtDuesFor, recordDuesPayment, courtSpending, recordCourtSpend, courtStock,
  standingOf,
} from '../court.js';
import { businessCsv } from '../export.js';
import { readBranding } from '../branding.js';
import { FEEDBACK_SUBJECTS, submitFeedback, listOwnFeedback } from '../feedback.js';

/* ---- employees ---- */
async function listEmployees({ request, env, url }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can view the employee roster.');
    e.forbidden = true; throw e;
  }
  const business = caller.role === 'admin' && url.searchParams.get('business')
    ? url.searchParams.get('business') : caller.business;
  const users = await listUsersByBusiness(env, business, realmIdOf(caller, env));
  return {
    business,
    employees: users.map((u) => ({ uid: u.uid, email: u.email, character: u.character, role: u.role, isOwner: u.isOwner, status: u.status, notes: u.notes || '', payRate: u.payRate || 0 })),
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
  const roster = await listUsersByBusiness(env, caller.business, realmIdOf(caller, env));
  const target = roster.find((u) => u.uid === targetUid);
  if (!target && caller.role !== 'admin') {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true; throw e;
  }
  const found = target || (caller.role === 'admin' ? await findUserByUid(env, targetUid, realmIdOf(caller, env)) : null);
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
  const roster = await listUsersByBusiness(env, caller.business, realmIdOf(caller, env));
  const target = roster.find((u) => u.uid === targetUid);
  const found = target || (caller.role === 'admin' ? await findUserByUid(env, targetUid, realmIdOf(caller, env)) : null);
  if (!found) {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true; throw e;
  }
  await setUserNote(env, found.uid, body.note);
  return { ok: true, uid: targetUid };
}
async function employeePerformanceRoute({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { performance: await employeePerformance(env, caller.business, realmIdOf(caller, env)) };
}
async function lowStock({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await lowStockReport(env, caller.business, realmIdOf(caller, env));
}
/** Owner/admin: this shop's own sales performance (totals, trend, top items). */
async function shopReport({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await businessReport(env, caller.business, realmIdOf(caller, env));
}
/* ---- a shop's own notice board (owner posts to their staff) ---- */
async function listShopNotices({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { notices: await listMotdsForBusiness(env, caller.business, realmIdOf(caller, env)) };
}
async function addShopNotice({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { notices: await addMotdForBusiness(env, caller.business, body, realmIdOf(caller, env)) };
}
async function deleteShopNotice({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { notices: await deleteMotdForBusiness(env, caller.business, body.id, realmIdOf(caller, env)) };
}

/**
 * Removes an intake entry, putting its stock back out and refunding the coffer.
 * Owner/admin only: it rewrites the shop's books.
 */
async function deleteIntakeRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await deleteIntake(env, caller.business, body.id, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'intake.delete',
    detail: res.item + ' ×' + res.removed + ' returned' +
      (res.shortBy ? ' (' + res.shortBy + ' already sold on)' : ''), realmId });
  return res;
}

/**
 * Crafting: consume ingredients from this shop's stock, produce something else.
 *
 * Any ACTIVE member. Crafting is shop-floor work — the person at the bench is
 * usually not the owner — and it is not a money path: stock becomes other
 * stock, nothing is bought or sold, and the ingredients have to be there. An
 * employee who can sell the shop's goods can certainly make them.
 */
async function convertInventory({ request, env, body }) {
  const caller = await requireActive(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await convertItems(env, caller.business, body, realmId);
  if (!res.duplicate) {
    await logAudit(env, { actor: actorName(caller), business: caller.business,
      action: 'inventory.craft', detail: res.detail, realmId });
  }
  return res;
}

/* ---- Farm / Harvest: stock produced rather than bought ---- */
async function harvestRoute({ request, env, body }) {
  // Any active member: bringing in a crop is shop-floor work, like ringing up
  // a sale. It moves no money, so there is nothing here an owner must gate.
  const caller = await requireActive(request, env);
  const realmId = realmIdOf(caller, env);
  const intake = await recordHarvest(env, caller.business, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'inventory.harvest', detail: body.item + ' ×' + body.numItems, realmId });
  return { intake, inventory: await listInventory(env, caller.business, realmId) };
}

/* ---- time cards ---- */

/** Whoever is asking, plus the shift they are currently working (or none). */
async function myTimecard({ request, env }) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  return {
    open: await openShift(env, caller.uid, realmId),
    shifts: await myShifts(env, caller.uid, realmId),
    rate: caller.payRate || 0,
  };
}

async function clockInRoute({ request, env }) {
  const caller = await requireActive(request, env);
  const realmId = realmIdOf(caller, env);
  const open = await clockIn(env, {
    uid: caller.uid, employee: caller.character || caller.email,
    business: caller.business, rate: caller.payRate || 0,
  }, realmId);
  return { open, shifts: await myShifts(env, caller.uid, realmId) };
}

async function clockOutRoute({ request, env, body }) {
  const caller = await requireActive(request, env);
  const realmId = realmIdOf(caller, env);
  // The rate is read NOW, not at clock-in, so a correction made during the
  // shift still applies to it.
  await clockOut(env, { uid: caller.uid, rate: caller.payRate || 0, note: body.note }, realmId);
  return { open: null, shifts: await myShifts(env, caller.uid, realmId) };
}

/** The owner's log: every shift at this shop, with who is owed what. */
async function timecardLog({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await shopShifts(env, caller.business, realmIdOf(caller, env));
}

/**
 * Marks wages settled. Records only — no coffer entry, same rule as the Court's
 * levy: the app says what is owed and a person confirms it was actually paid.
 */
async function timecardPay({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await markPaid(env, { business: caller.business, uid: body.uid, ids: body.ids }, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'timecard.paid', detail: body.uid ? 'uid ' + body.uid : (body.ids || []).length + ' shift(s)', realmId });
  return res;
}

async function timecardEdit({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await editShift(env, { business: caller.business, ...body }, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'timecard.edit', detail: 'shift ' + body.id, realmId });
  return res;
}

async function timecardDelete({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await deleteShift(env, { business: caller.business, id: body.id }, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'timecard.delete', detail: 'shift ' + body.id, realmId });
  return res;
}

/** The owner sets what someone is paid per hour. */
async function payRateRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  // Their OWN roster only — the same check the note and activate routes make.
  const roster = await listUsersByBusiness(env, caller.business, realmId);
  const target = roster.find((u) => u.uid === String(body.uid || '').trim());
  if (!target) {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true; throw e;
  }
  const rate = await setPayRate(env, target.uid, body.rate, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'employee.rate', detail: (target.character || target.uid) + ' → ' + rate, realmId });
  return { ok: true, uid: target.uid, rate };
}

/* ---- feedback on the app ---- */
/**
 * The Feedback page's own data: the subject list (served rather than duplicated
 * in the client, so the dropdown and the validation can't disagree) plus this
 * user's past submissions, marked read or not.
 */
async function getFeedback({ request, env }) {
  const caller = await requireRegistered(request, env);
  return {
    subjects: FEEDBACK_SUBJECTS,
    mine: await listOwnFeedback(env, caller.uid, realmIdOf(caller, env)),
  };
}
/**
 * Files feedback. Only the subject and body come from the form — who submitted
 * it, from which shop, in what role and realm, and when, are all taken from the
 * authenticated caller here.
 */
async function postFeedback({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  await submitFeedback(env, caller, body, realmId);
  return { ok: true, mine: await listOwnFeedback(env, caller.uid, realmId) };
}

/* ---- per-shop settings + rename ---- */
async function ledgerBusiness(request, env, override) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can manage ledger settings.');
    e.forbidden = true; throw e;
  }
  return {
    business: caller.role === 'admin' && override ? override : caller.business,
    realmId: realmIdOf(caller, env),
  };
}
async function getLedgerSettings({ request, env, url }) {
  const { business, realmId } = await ledgerBusiness(request, env, url.searchParams.get('business'));
  return readBusinessSettings(env, business, realmId);
}
async function saveLedgerSettings({ request, env, body }) {
  const { business, realmId } = await ledgerBusiness(request, env, body.business);
  return writeBusinessSettings(env, business, body.updates || [], realmId);
}
async function renameBusinessRoute({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can rename the company.');
    e.forbidden = true; throw e;
  }
  const newName = String(body.name || '').trim();
  if (!newName) throw new Error('Enter a company name.');
  await renameBusiness(env, caller.business, newName, realmIdOf(caller, env));
  caller.business = newName;
  return publicUser(caller);
}

/* ---- inventory ---- */
async function getInventory({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { inventory: await listInventory(env, caller.business, realmIdOf(caller, env)) };
}
async function saveItem({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true; throw e;
  }
  return { inventory: await upsertItem(env, caller.business, body, realmIdOf(caller, env)) };
}
async function deleteItemRoute({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true; throw e;
  }
  return { inventory: await deleteItem(env, caller.business, body.item, realmIdOf(caller, env)) };
}
/**
 * A hand correction to an item's stock. Owner/admin only, and always audited:
 * this is the one path that changes stock without something having happened to
 * cause it, so the trail is the only thing that separates a stocktake from a
 * mistake.
 */
async function adjustStock({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await setStock(env, caller.business, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'inventory.stock',
    detail: res.item + ': ' + res.was + ' → ' + res.now + (res.note ? ' (' + res.note + ')' : ''),
    realmId });
  return { ...res, inventory: await listInventory(env, caller.business, realmId) };
}

async function importInventoryRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await importInventory(env, caller.business, body.rows, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'inventory.import', detail: (res.imported || 0) + ' items', realmId: realmIdOf(caller, env) });
  return res;
}

/* ---- intake ---- */
async function getIntake({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { intake: await listIntake(env, caller.business, realmIdOf(caller, env)) };
}
async function recordIntakeRoute({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can record intake.');
    e.forbidden = true; throw e;
  }
  const realmId = realmIdOf(caller, env);
  // One delivery, one or many items. A body without `items` is the single-item
  // shape and is wrapped here, so the handler has one path rather than two.
  const lines = Array.isArray(body.items) ? body.items : [body];
  const intake = await recordIntakeLines(env, caller.business, { ...body, items: lines }, realmId);
  return { intake, inventory: await listInventory(env, caller.business, realmId) };
}

/* ---- register ---- */
async function getCert({ request, env }) {
  const caller = await requireRegistered(request, env);
  return await checkCertification(env, caller.business, realmIdOf(caller, env));
}
async function checkoutRoute({ request, env, body }) {
  const caller = await requireActive(request, env);
  return await checkout(env, caller.business, caller, body, realmIdOf(caller, env));
}
async function listSalesRoute({ request, env, url }) {
  const caller = await requireActive(request, env);
  return { sales: await listSales(env, caller.business, url.searchParams.get('q'), realmIdOf(caller, env)) };
}
async function voidSaleRoute({ request, env, body }) {
  const caller = await requireActive(request, env);
  return await voidSale(env, caller.business, body.orderNo, realmIdOf(caller, env));
}

/* ---- transfers ---- */
async function listTransfersRoute({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await listTransfers(env, caller.business, realmIdOf(caller, env));
}
async function createTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await createTransfer(env, caller.business, body, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.send', detail: (body.item || '') + ' ×' + (body.qty || '') + ' → ' + (body.toBusiness || ''), realmId: realmIdOf(caller, env) });
  return await listTransfers(env, caller.business, realmIdOf(caller, env));
}
async function acceptTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await acceptTransfer(env, caller.business, body.id, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.accept', detail: 'id ' + body.id, realmId: realmIdOf(caller, env) });
  return await listTransfers(env, caller.business, realmIdOf(caller, env));
}
async function cancelTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await cancelTransfer(env, caller.business, body.id, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.cancel', detail: 'id ' + body.id, realmId: realmIdOf(caller, env) });
  return await listTransfers(env, caller.business, realmIdOf(caller, env));
}
async function declineTransferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  await declineTransfer(env, caller.business, body.id, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'transfer.decline', detail: 'id ' + body.id, realmId: realmIdOf(caller, env) });
  return await listTransfers(env, caller.business, realmIdOf(caller, env));
}
async function transferHistory({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { history: await listTransferHistory(env, caller.business, realmIdOf(caller, env)) };
}

/* ---- shop ledger: coffers / discounts / style ---- */
async function getCoffer({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await cofferSummary(env, caller.business, realmIdOf(caller, env));
}
async function adjustCofferRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await adjustCoffer(env, caller.business, body, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'coffer.adjust', detail: (Number(body.amount) || 0) + 'gp ' + (body.note || ''), realmId: realmIdOf(caller, env) });
  return res;
}
async function getDiscounts({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { discounts: await listDiscounts(env, caller.business, realmIdOf(caller, env)) };
}
async function addDiscountRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { discounts: await addDiscount(env, caller.business, body, realmIdOf(caller, env)) };
}
async function deleteDiscountRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return { discounts: await deleteDiscount(env, caller.business, body.id, realmIdOf(caller, env)) };
}
async function getStyle({ request, env }) {
  const caller = await requireRegistered(request, env);
  return await getShopStyle(env, caller.business, realmIdOf(caller, env));
}
async function setStyle({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  return await setShopStyle(env, caller.business, body, realmIdOf(caller, env));
}

/** Owner/admin: download this shop's sales or coffer ledger as a CSV. */
async function ownerExport({ request, env, url, cors }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const type = url.searchParams.get('type') === 'coffer' ? 'coffer' : 'sales';
  const { filename, csv } = await businessCsv(env, caller.business, type, realmIdOf(caller, env));
  return new Response(csv, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + filename + '"' },
  });
}

/* ---- lookups shared across the app ---- */
async function listBusinesses({ request, env }) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  // `businesses` stays a list of names, because that is what every existing
  // caller puts in a dropdown. `cards` carries the same companies with the
  // details a form can fill itself in from.
  const cards = await listBusinessCards(env, realmId);
  return { businesses: cards.map((b) => b.business), cards };
}
/**
 * The item index plus the type tables it is divided into. Both in one call: the
 * index screen renders a table per type, and the register's picker groups by
 * type, so a second round-trip would only ever be for the same page load.
 */
async function getItems({ request, env }) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  return { items: await listItemIndex(env, realmId), types: await listItemTypes(env, realmId) };
}
/** Any registered user: the admin-assigned tile artwork (key → image URL). */
async function getTiles({ request, env }) {
  const caller = await requireRegistered(request, env);
  // Per realm — see the note on tileKey in routes/admin.js.
  const raw = await getFlag(env, 'tile_images:' + realmIdOf(caller, env));
  let images = {};
  try { images = raw ? JSON.parse(raw) : {}; } catch (e) { images = {}; }
  return { images };
}
/** The hold list for the caller's realm. (Sign-up gets its holds from
 *  /auth/code instead, since it has no account to derive a realm from.) */
async function getHolds({ request, env }) {
  const caller = await requireRegistered(request, env);
  return { holds: await readRegions(env, realmIdOf(caller, env)) };
}
async function holdReportRoute({ request, env }) {
  const caller = await requireRegistered(request, env);
  const meta = await findBusinessMeta(env, caller.business, realmIdOf(caller, env));
  if (!meta.court) {
    const e = new Error('This report is available to Court businesses only.');
    e.forbidden = true; throw e;
  }
  return await holdReport(env, meta.hold, realmIdOf(caller, env));
}

/**
 * A SHOP's view of its own region — the same report its Court reads, one week
 * behind.
 *
 * Same data, deliberately lagged. A Court governs its region and needs it live;
 * everyone else gets the week that has finished. A shop watching its
 * neighbours' takings arrive in real time would be pricing against them by the
 * hour, which is not knowing the market, it is watching the till. A settled
 * week is enough to trade on and too old to chase.
 *
 * Owner-level, like the rest of the shop's own figures: this is what the person
 * setting prices needs, not the person ringing them up. A Court's owner may read
 * it too, and sees exactly what its neighbours see of the region — which is the
 * fair arrangement for the one company that also holds the live view.
 */
async function weeklyRegionRoute({ request, env }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const meta = await findBusinessMeta(env, caller.business, realmId);
  if (!meta.hold) {
    // Nothing to report on rather than an empty report: the difference between
    // "your region traded nothing" and "you have no region" matters.
    return { hold: '', noRegion: true, week: lastWeekWindow(), overview: {}, businesses: [], items: [] };
  }
  const week = lastWeekWindow();
  // keepTrends: this view is Item Performance's graphs, scoped to the week.
  const report = await holdReport(env, meta.hold, realmId, { ...week, keepTrends: true });
  // The window travels with the figures so the page can say which week it is
  // showing. A report that does not name its period is a report you cannot check.
  return { ...report, week };
}

/**
 * Court oversight: the shops trading in this Court's region.
 *
 * A Court sees more of its neighbours than an ordinary shop does — rosters and
 * ledgers — which is the point of the flag. What bounds it is the REGION: the
 * gate resolves the caller's own region and every read is scoped to it, so a
 * Court cannot reach a shop trading anywhere else.
 */
async function courtCompaniesRoute({ request, env }) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  const hold = await requireCourt(env, caller.business, realmId);
  return { hold, companies: await courtCompanies(env, hold, realmId) };
}
/** One of those shops in full — roster, coffer, discounts, style, performance. */
async function courtShopRoute({ request, env, url }) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  const hold = await requireCourt(env, caller.business, realmId);
  return await courtShop(env, hold, url.searchParams.get('business'), realmId);
}

/* ---- Court Tools: a region's government ---- */
/**
 * Every Court route resolves the caller's OWN region first, and acts only on
 * it. One gate, applied identically, so no individual handler can be the one
 * that forgot.
 */
async function courtSeat(request, env) {
  const caller = await requireRegistered(request, env);
  const realmId = realmIdOf(caller, env);
  const hold = await requireCourt(env, caller.business, realmId);
  return { caller, realmId, hold };
}

/** Everything the Court Tools page opens with, in one call. */
async function courtOverview({ request, env }) {
  const { caller, realmId, hold } = await courtSeat(request, env);
  const [settings, dues, standings] = await Promise.all([
    readCourtSettings(env, hold, realmId),
    courtDues(env, hold, realmId),
    courtStandings(env, hold, realmId),
  ]);
  return {
    hold, seat: caller.business, settings, dues,
    shops: standings.length,
    standings, categories: SPEND_CATEGORIES, options: STANDINGS,
  };
}
async function courtSaveSettings({ request, env, body }) {
  const { caller, realmId, hold } = await courtSeat(request, env);
  const settings = await writeCourtSettings(env, hold, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.settings',
    detail: hold + ': levy ' + settings.taxPercent + '%' + (body.notice !== undefined ? ', notice updated' : ''), realmId });
  return { settings };
}
async function courtSetStanding({ request, env, body }) {
  const { caller, realmId, hold } = await courtSeat(request, env);
  const standings = await setCourtStanding(env, hold, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.standing',
    detail: String(body.business || '') + ' → ' + String(body.standing || ''), realmId });
  return { standings };
}
async function courtGetPrices({ request, env }) {
  const { realmId, hold } = await courtSeat(request, env);
  return { hold, prices: await courtPrices(env, hold, realmId) };
}
async function courtSavePrice({ request, env, body }) {
  const { caller, realmId, hold } = await courtSeat(request, env);
  const prices = await setCourtPrice(env, hold, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.price',
    detail: String(body.item || '') + ': ' + (body.min || '—') + ' to ' + (body.max || '—'), realmId });
  return { prices };
}
async function courtGetDues({ request, env, url }) {
  const { realmId, hold } = await courtSeat(request, env);
  const one = String(url.searchParams.get('business') || '').trim();
  return one
    ? { hold, business: one, entries: await courtDuesFor(env, hold, one, realmId) }
    : { hold, ...(await courtDues(env, hold, realmId)) };
}
async function courtPayDues({ request, env, body }) {
  const { caller, realmId, hold } = await courtSeat(request, env);
  const dues = await recordDuesPayment(env, hold, body, realmId, caller.business);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.dues.paid',
    detail: String(body.business || '') + ': ' + String(body.amount || ''), realmId });
  return dues;
}
async function courtGetSpending({ request, env }) {
  const { realmId, hold } = await courtSeat(request, env);
  return { hold, ...(await courtSpending(env, hold, realmId)) };
}
async function courtSpend({ request, env, body }) {
  const { caller, realmId, hold } = await courtSeat(request, env);
  const spending = await recordCourtSpend(env, hold, body, realmId, caller.business);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.spend',
    detail: String(body.category || '') + ': ' + String(body.amount || ''), realmId });
  return spending;
}
async function courtGetStock({ request, env }) {
  const { realmId, hold } = await courtSeat(request, env);
  return { hold, stock: await courtStock(env, hold, realmId) };
}

/**
 * Public (no auth): branding — needed before sign-in, so this is the DEPLOYMENT's
 * identity. A realm's own overrides are applied once the user signs in and their
 * realm is known (see /auth/me → realmBranding).
 */
async function branding({ env }) {
  return await readBranding(env);
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
  const realmId = realmIdOf(caller, env);
  const notices = [];
  const global = await readMotd(env, realmId);
  if (global) notices.push(global);
  notices.push(...(await activeNoticesForBusiness(env, caller.business, realmId)));
  // The Court's notice to its region — announcements from the government of
  // the place you trade in, alongside the network's own.
  const meta = await findBusinessMeta(env, caller.business, realmId);
  if (meta && meta.hold) {
    const court = await readCourtSettings(env, meta.hold, realmId);
    if (court.notice) notices.push('⚖️ ' + meta.hold + ' Court: ' + court.notice);
  }

  const banners = [];
  // A sanction is not a notice to skim past: it stops or threatens trade, so it
  // goes in the banner strip with the certification warnings.
  if (meta && meta.hold && (caller.role === 'owner' || caller.role === 'employee')) {
    const standing = await standingOf(env, caller.business, meta.hold, realmId);
    if (standing === 'banned') {
      banners.push({ text: '⚖️ The ' + meta.hold + ' Court has BARRED this shop from trading — sales are blocked.' });
    } else if (standing === 'restricted') {
      banners.push({ text: '⚖️ The ' + meta.hold + ' Court has placed this shop under restriction.' });
    }
  }
  if (caller.role === 'owner' || caller.role === 'employee') {
    const cert = await checkCertification(env, caller.business, realmId);
    if (!cert.perpetual) {
      if (cert.status === 'EXPIRED') {
        banners.push({ text: '⚠ ' + caller.business + '’s Vici Trading Co. certification has EXPIRED — renew with an admin to keep selling.' });
      } else if (cert.until) {
        const warnDays = await readWarnDays(env, realmId);
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
      const n = await countIncomingPending(env, caller.business, realmId);
      if (n > 0) {
        banners.push({
          text: '📦 You have ' + n + ' pending transfer' + (n === 1 ? '' : 's') + ' to accept.',
          action: { label: 'Go to Inventory', route: '/inventory' },
        });
      }
    } catch (e) { /* D1 optional */ }
  }
  // Once a week, on the day the week turns over — the same instant Market Info
  // rolls to the week just finished. It used to fire on Sunday, a full day
  // BEFORE the figures settled, so the prompt to back up a week arrived while
  // the reports still called that week unfinished. One definition now, in
  // week.js, shared by everything weekly.
  /**
   * New items the register invented and nobody has confirmed. Ahead of the
   * weekly backup nudge because it is the one banner with a queue behind it:
   * every day it goes unread, more sales attach to a name that may turn out to
   * be a duplicate of something already in the index.
   */
  if (caller.role === 'admin') {
    try {
      const n = (await listPendingItems(env, realmId)).length;
      if (n > 0) {
        banners.push({
          text: '🆕 ' + n + ' new item' + (n === 1 ? '' : 's') + ' from the register need review.',
          action: { label: 'Item Index', route: '/admin/items' },
        });
      }
    } catch (e) { /* the index is optional */ }
  }
  if (caller.role === 'admin' && isWeekTurnover()) {
    banners.push({
      text: '🗓️ A new week has begun — download a backup of the week just gone.',
      action: { label: 'Backup', route: '/admin/settings' },
    });
  }
  // Owner low/out-of-stock nudge → opens a focal report.
  if (caller.role === 'owner' || caller.role === 'admin') {
    try {
      const { out, low } = await lowStockReport(env, caller.business, realmId);
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
  { method: 'GET', path: '/business/report', handler: shopReport },
  { method: 'GET', path: '/business/notices', handler: listShopNotices },
  { method: 'POST', path: '/business/notices', handler: addShopNotice },
  { method: 'POST', path: '/business/notices/delete', handler: deleteShopNotice },
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
  { method: 'POST', path: '/inventory/stock', handler: adjustStock },
  { method: 'POST', path: '/inventory/harvest', handler: harvestRoute },
  { method: 'GET', path: '/timecard', handler: myTimecard },
  { method: 'POST', path: '/timecard/in', handler: clockInRoute },
  { method: 'POST', path: '/timecard/out', handler: clockOutRoute },
  { method: 'GET', path: '/timecard/log', handler: timecardLog },
  { method: 'POST', path: '/timecard/pay', handler: timecardPay },
  { method: 'POST', path: '/timecard/edit', handler: timecardEdit },
  { method: 'POST', path: '/timecard/delete', handler: timecardDelete },
  { method: 'POST', path: '/business/employees/rate', handler: payRateRoute },
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
  { method: 'GET', path: '/regions', handler: getHolds },
  { method: 'GET', path: '/tiles', handler: getTiles },
  { method: 'GET', path: '/market/region', handler: holdReportRoute },
  { method: 'GET', path: '/market/week', handler: weeklyRegionRoute },
  { method: 'GET', path: '/court/companies', handler: courtCompaniesRoute },
  { method: 'GET', path: '/court/company', handler: courtShopRoute },
  { method: 'GET', path: '/court', handler: courtOverview },
  { method: 'POST', path: '/court/settings', handler: courtSaveSettings },
  { method: 'POST', path: '/court/standing', handler: courtSetStanding },
  { method: 'GET', path: '/court/prices', handler: courtGetPrices },
  { method: 'POST', path: '/court/prices', handler: courtSavePrice },
  { method: 'GET', path: '/court/dues', handler: courtGetDues },
  { method: 'POST', path: '/court/dues/pay', handler: courtPayDues },
  { method: 'GET', path: '/court/spending', handler: courtGetSpending },
  { method: 'POST', path: '/court/spending', handler: courtSpend },
  { method: 'GET', path: '/court/stock', handler: courtGetStock },
  { method: 'GET', path: '/motd', handler: getMotd },
  { method: 'POST', path: '/business/intake/delete', handler: deleteIntakeRoute },
  { method: 'POST', path: '/business/inventory/convert', handler: convertInventory },
  { method: 'GET', path: '/feedback', handler: getFeedback },
  { method: 'POST', path: '/feedback', handler: postFeedback },
  { method: 'GET', path: '/branding', handler: branding },
];
