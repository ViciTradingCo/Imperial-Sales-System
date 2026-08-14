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
import { requireRegistered, actorName, realmIdOf } from '../guards.js';
import { logAudit } from '../audit.js';
import { requireCourt, courtCompanies, courtShop } from '../oversight.js';
import {
  SPEND_CATEGORIES, STANDINGS, readCourtSettings, writeCourtSettings,
  courtStandings, setCourtStanding, courtPrices, setCourtPrice,
  courtDues, courtDuesFor, recordDuesPayment, courtSpending, recordCourtSpend, courtStock,
} from '../court.js';

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
];
