/**
 * Looking at a shop's books from OUTSIDE it.
 *
 * Two roles do this, for different reasons and over different scopes:
 *
 *   • an ADMIN, from the Company List, over every shop in their realm;
 *   • a COURT, over the shops trading in its own region — the in-fiction
 *     oversight the Court flag exists for.
 *
 * Both read the same snapshot (`shopOverview`) so they cannot drift into two
 * different ideas of what a shop's books are. What differs is the SCOPE, and
 * that is decided here rather than by either caller.
 *
 * READ ONLY, throughout. Nothing in this module writes: an outsider looking at
 * a shop's ledger must not be able to move its money, and a Court is a rival
 * trader as well as an overseer.
 */
import { listCompanies, findBusinessMeta } from './registry.js';
import { isTraveling, TRAVELING } from './regions.js';
import { listUsersByBusiness } from './users.js';
import { cofferSummary } from './coffers.js';
import { listDiscounts } from './discounts.js';
import { getShopStyle } from './shop-style.js';
import { businessReport } from './market.js';

/**
 * One shop's books: its treasury, its offers, its look, and how it is trading.
 *
 * The staff code is deliberately NOT here. It is the shop's own recruiting
 * secret — anyone holding it can put people on that roster — and an overseer
 * needs to read a shop's books, not to hire into it.
 */
export async function shopOverview(env, business, realmId) {
  const [coffer, discounts, style, report] = await Promise.all([
    cofferSummary(env, business, realmId),
    listDiscounts(env, business, realmId),
    getShopStyle(env, business, realmId),
    businessReport(env, business, realmId),
  ]);
  return {
    business,
    coffer,
    discounts,
    style,
    overview: report.overview,
    items: (report.items || []).slice(0, 10),
  };
}

/**
 * The roster, as an OUTSIDER may see it: who works there, in what role, and
 * whether they are active.
 *
 * Email addresses are left out. They identify the person behind the character
 * rather than the shop, and a Court overseeing trade in its region has no
 * business collecting them. An admin, who administers the accounts themselves,
 * reads the roster through the member list instead.
 */
export async function shopRoster(env, business, realmId) {
  const users = await listUsersByBusiness(env, business, realmId);
  return users.map((u) => ({
    character: u.character || '(unnamed)',
    role: u.role,
    isOwner: !!u.isOwner,
    status: u.status,
  }));
}

/**
 * Confirms the caller's own shop is a Court and hands back the region it
 * oversees. Everything else in this module is scoped by that region, so this is
 * the single gate — a Court's reach is its own region and nothing else, however
 * the request is shaped.
 */
export async function requireCourt(env, business, realmId) {
  const meta = await findBusinessMeta(env, business, realmId);
  if (!meta || !meta.court) {
    const e = new Error('This is available to Court businesses only.');
    e.forbidden = true;
    throw e;
  }
  // A Court IS a region's government, and its every book is keyed by region. A
  // travelling company has none, so it would govern the word "Traveling" — a
  // place no sale can ever be filed under, and therefore a Court with a levy
  // nobody owes and licences nobody needs.
  if (isTraveling(meta.hold)) {
    throw new Error('A company marked as ' + TRAVELING + ' has no region to govern. An admin needs to ' +
      'give it a region, or move the Court flag to a company based in one.');
  }
  if (!meta.hold) {
    throw new Error('Your company is marked as a Court but has no region assigned — an admin needs to set one.');
  }
  return meta.hold;
}

/**
 * Every shop trading in a Court's region, with the certification an overseer
 * cares about. The Court's own shop is included: it trades there too, and
 * hiding it would make the totals not add up.
 */
export async function courtCompanies(env, hold, realmId) {
  const all = await listCompanies(env, realmId);
  const target = String(hold || '').trim().toLowerCase();
  return all
    .filter((c) => String(c.hold || '').trim().toLowerCase() === target)
    // joinCode is stripped, not merely unrendered: it must not travel to a
    // browser that has no business holding another shop's staff code.
    .map(({ joinCode, ...rest }) => rest);
}

/**
 * One shop in the Court's region, in full. Refuses anything outside the region
 * even when named directly — the list is a convenience, this is the boundary.
 */
export async function courtShop(env, hold, business, realmId) {
  const name = String(business || '').trim();
  if (!name) throw new Error('Which company?');
  const inRegion = await courtCompanies(env, hold, realmId);
  const match = inRegion.find((c) => c.business.toLowerCase() === name.toLowerCase());
  if (!match) {
    const e = new Error('"' + name + '" does not trade in your region.');
    e.forbidden = true;
    throw e;
  }
  const [overview, roster] = await Promise.all([
    shopOverview(env, match.business, realmId),
    shopRoster(env, match.business, realmId),
  ]);
  return { ...overview, company: match, roster };
}
