/**
 * The Court's market report — the Market tile on Court Tools. Shows the market
 * for the Court's own region: overview, the shops trading there, and the items
 * moving there. The API scopes it to the caller's region and refuses non-Court
 * callers.
 */
import { money, regionWord } from '../lib/format.js';
import { el, mount, statTiles } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { tableCard } from './market.js';

/**
 * Rendered INSIDE the Court Tools page's Market tile, never as a page of its
 * own — so no heading and no Back link. It had both when it was a nav
 * destination; a "← Back" in a focal menu would close the modal and leave the
 * page, which is not what the word means there.
 */
export function renderRegionReport(container) {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading your ' + regionWord() + '’s report…'));
  mount(container,
    el('p', { class: 'note' }, 'Commerce in your ' + regionWord() + ', as its Court — sales rung up here, and ' +
      'stock bought from here. Voided sales and employee purchases are excluded.'),
    host);

  api.getRegionReport()
    .then((d) => {
      const o = d.overview || {};
      /**
       * Trade with nobody to credit — supply bought from this region from an
       * unregistered seller (an NPC smith, a caravan, a farm). Listed as its own
       * line so the table adds up to the region's revenue instead of quietly
       * falling short of it. Only when there is some: a standing row of zeroes
       * is the kind of filler this screen was cleared of.
       */
      const un = d.unregistered || {};
      const sellers = (d.businesses || []).map((b) => [b.business || '—', money(b.revenue)]);
      if (Number(un.revenue) > 0) sellers.push(['Unregistered shops', money(un.revenue)]);

      mount(host,
        el('div.card', {}, [el('h3', {}, d.hold || 'Your ' + regionWord())]),
        // Revenue and how many shops trade here. Order and item counts said how
        // BUSY the region was, which is not a thing a Court rules on.
        statTiles([
          ['Revenue', money(o.revenue)],
          ['Shops', String(o.activeShops || 0)],
        ]),
        tableCard('Shops selling in your ' + regionWord(), ['Company', 'Revenue'], sellers,
          'No sales recorded in your ' + regionWord() + ' yet.'),
        tableCard('Items moving in your ' + regionWord(), ['Item', 'Qty sold', 'Revenue'],
          (d.items || []).map((i) => [i.item, i.qty, money(i.revenue)]),
          'No items sold in your ' + regionWord() + ' yet.'),
      );
    })
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}
