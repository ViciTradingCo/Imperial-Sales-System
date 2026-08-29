/**
 * COURT ROUTES — a Court governing its region.
 *
 * Lifted out of business.js, which had grown past a thousand lines. This is a
 * real seam rather than an arbitrary cut: these handlers talk only to court.js
 * and oversight.js, nothing else in the app calls them, and a Court's two jobs
 * — running a shop, governing a region — are meant to stay separable.
 *
 * The rule they all share: COURT DATA IS KEYED BY REGION, never by the Court
 * company. `courtSeat` resolves the caller's own region once and every read and
 * write below is scoped to it, so a rename, or the flag moving to another shop,
 * leaves the region's rules and books intact — and a Court can never reach a
 * region it does not hold.
 */
import { requireRegistered, actorName, realmIdOf, managesBusiness } from '../guards.js';
import { logAudit } from '../audit.js';
import { requireCourt, courtCompanies, courtShop } from '../oversight.js';
import {
  SPEND_CATEGORIES, STANDINGS, readCourtSettings, writeCourtSettings,
  courtStandings, setCourtStanding, courtPrices, setCourtPrice,
  courtDues, courtDuesFor, recordDuesPayment, courtSpending, recordCourtSpend, courtStock,
} from '../court.js';
import { listProperties, saveProperty, deleteProperty, reissuePropertyCode } from '../property.js';
import { renameBusiness } from '../registry.js';

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

/**
 * THE PROPERTY INDEX'S TWO GATES.
 *
 * Governing a region is not the same job as working at the shop that governs
 * it, so the premises are not open to a Court's whole payroll. Two levels, and
 * both sit on top of `courtSeat` — the region check is never the thing that
 * gets skipped:
 *
 *   • READING — the owner or a MANAGER. A manager sees the index and the market
 *     data behind it, which is the Court's own view of its region.
 *   • WRITING — the OWNER alone (an admin passes, as everywhere). Letting
 *     premises, issuing the codes that create shops, and renaming a company are
 *     acts of government, and a manager is hired to run a shop.
 *
 * Predicates rather than role lists at each handler, for the reason in
 * guards.js: the fortieth copy is the one with the hole in it.
 */
async function courtDesk(request, env) {
  const seat = await courtSeat(request, env);
  if (!managesBusiness(seat.caller)) {
    const e = new Error('The Property Index is for a Court’s owner and managers.');
    e.forbidden = true;
    throw e;
  }
  return seat;
}
async function courtBench(request, env) {
  const seat = await courtDesk(request, env);
  if (seat.caller.role !== 'owner' && seat.caller.role !== 'admin') {
    const e = new Error('Only the Court’s owner can change the Property Index — a manager may read it.');
    e.forbidden = true;
    throw e;
  }
  return seat;
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

/* ---- the Property Index: who trades here, and where ---- */

/**
 * The region's premises, and what a Court may do about each.
 *
 * `canEdit` is sent rather than left for the client to work out from the role:
 * the screen must never offer a manager a button the Worker will refuse, and
 * the one place that decides is the gate above.
 */
async function courtGetProperties({ request, env }) {
  const { caller, realmId, hold } = await courtDesk(request, env);
  return {
    hold,
    properties: await listProperties(env, hold, realmId),
    canEdit: caller.role === 'owner' || caller.role === 'admin',
  };
}
async function courtSaveProperty({ request, env, body }) {
  const { caller, realmId, hold } = await courtBench(request, env);
  const property = await saveProperty(env, hold, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.property',
    detail: hold + ': ' + property.name + (body.id ? ' updated' : ' added'), realmId });
  return { property, properties: await listProperties(env, hold, realmId) };
}
async function courtRemoveProperty({ request, env, body }) {
  const { caller, realmId, hold } = await courtBench(request, env);
  const gone = await deleteProperty(env, body.id, hold, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.property.remove',
    detail: hold + ': ' + gone.removed, realmId });
  return { ...gone, properties: await listProperties(env, hold, realmId) };
}
async function courtPropertyCode({ request, env, body }) {
  const { caller, realmId, hold } = await courtBench(request, env);
  const issued = await reissuePropertyCode(env, body.id, hold, realmId);
  // The code itself is never logged. It is a credential for the duration, and
  // the audit trail is read by more people than should be able to redeem it.
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.property.code',
    detail: hold + ': new code issued for ' + issued.name, realmId });
  return { ...issued, properties: await listProperties(env, hold, realmId) };
}

/**
 * RENAMING THE SHOP ON A PROPERTY.
 *
 * A Court's authority here is the premises, so the property is what names the
 * shop — the request cannot simply hand over a company name. That is what keeps
 * a Court inside its own region without a second check to forget: it can only
 * rename what is standing on its own land, and a shop opened with an ADMIN'S
 * code is on no property at all and is therefore beyond it, which is exactly
 * what a code carrying no region is for.
 */
async function courtRenameOccupant({ request, env, body }) {
  const { caller, realmId, hold } = await courtBench(request, env);
  const rows = await listProperties(env, hold, realmId);
  const p = rows.find((x) => x.id === String(body.id || '').trim());
  if (!p) throw new Error('That property is not in your region.');
  if (p.vacant) throw new Error('"' + p.name + '" is empty — there is no business there to rename.');
  // A blank name is refused by `renameBusiness` itself, in the same words. One
  // rule about what a company may be called, not a copy of it per caller.
  const to = String(body.business || '').trim();
  const from = p.business;
  await renameBusiness(env, from, to, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'court.rename',
    detail: hold + ': ' + from + ' → ' + to + ' (' + p.name + ')', realmId });
  return { renamed: to, properties: await listProperties(env, hold, realmId) };
}

export const routes = [
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
  { method: 'GET', path: '/court/properties', handler: courtGetProperties },
  { method: 'POST', path: '/court/properties', handler: courtSaveProperty },
  { method: 'POST', path: '/court/properties/remove', handler: courtRemoveProperty },
  { method: 'POST', path: '/court/properties/code', handler: courtPropertyCode },
  { method: 'POST', path: '/court/properties/rename', handler: courtRenameOccupant },
];
