/**
 * Market Info — a shop's view of its own region, one week behind.
 *
 * The same report the region's Court reads, with one difference that is the
 * whole point of the page: it covers the week that has FINISHED, not the week
 * happening. A Court governs its region and needs it live; a shop needs to know
 * the market it trades in. Those are different needs, and a live feed of the
 * neighbours' takings answers neither — it just invites pricing against the till
 * by the hour. A settled week is enough to trade on and too old to chase.
 *
 * The figures change once, when Monday arrives, and hold still for seven days.
 */
import { money, regionWord, regionsOn } from '../lib/format.js';
import { el, mount, statTiles } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setOpsActions } from '../lib/sections.js';
import { emptyState } from '../lib/empty.js';
import { tableCard } from './market.js';

/** "1–7 Aug" for a half-open [from, to) week, in the reader's own locale. */
function weekLabel(week) {
  if (!week || !week.from || !week.to) return '';
  const from = new Date(week.from);
  // `to` is the Monday AFTER the week, so the last day it covers is the day before.
  const to = new Date(new Date(week.to).getTime() - 86400000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return '';
  const day = { day: 'numeric' };
  const dayMonth = { day: 'numeric', month: 'short' };
  // Drop the repeated month when the week does not straddle one.
  const left = from.getMonth() === to.getMonth()
    ? from.toLocaleDateString(undefined, day)
    : from.toLocaleDateString(undefined, dayMonth);
  return left + ' – ' + to.toLocaleDateString(undefined, dayMonth);
}

export function renderMarketInfo(container, { me }) {
  setOpsActions(me); // stays on the shop-tools bar with Register / Inventory
  const host = el('div', {}, el('p', { class: 'note' }, 'Reading last week’s trade…'));
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Market Info'),
    el('p', { class: 'note' }, 'How your ' + regionWord() + ' traded LAST week — every shop selling there, ' +
      'and what moved. It updates once a week, when the new week starts.'),
    host,
  ]));

  api.getWeeklyMarket()
    .then((d) => {
      if (d.noRegion) {
        mount(host, emptyState({
          glyph: '🗺️',
          title: regionsOn() ? 'No ' + regionWord() + ' set' : 'Not used in this realm',
          hint: regionsOn()
            ? 'Your shop has no ' + regionWord() + ' assigned, so there is no local market to report on. An admin can set one.'
            : 'This realm does not divide trade by ' + regionWord() + ', so there is no local market to report on.',
        }));
        return;
      }

      const o = d.overview || {};
      const label = weekLabel(d.week);
      // Trade with nobody to credit: supply bought from this region from a
      // seller nobody registered. Listed so the table adds up to the total.
      const un = d.unregistered || {};
      const sellers = (d.businesses || []).map((b) => [b.business || '—', money(b.revenue)]);
      if (Number(un.revenue) > 0) sellers.push(['Unregistered shops', money(un.revenue)]);

      const traded = (o.revenue || 0) > 0 || sellers.length > 0;
      mount(host,
        el('div.card', {}, [
          el('h3', {}, (d.hold || 'Your ' + regionWord()) + (label ? ' · ' + label : '')),
          el('p', { class: 'note' }, 'The week just gone. This is what every shop in your ' + regionWord() +
            ' can see, including yours.'),
        ]),
        ...(traded ? [
          statTiles([
            ['Revenue', money(o.revenue)],
            ['Shops', String(o.activeShops || 0)],
          ]),
          tableCard('Shops selling in your ' + regionWord(), ['Company', 'Revenue'], sellers,
            'Nobody sold here last week.'),
          tableCard('Items moving in your ' + regionWord(), ['Item', 'Qty sold', 'Revenue'],
            (d.items || []).map((i) => [i.item, i.qty, money(i.revenue)]),
            'Nothing sold here last week.'),
        ] : [
          emptyState({
            glyph: '🪙',
            title: 'A quiet week',
            hint: 'Nothing was traded in your ' + regionWord() + ' last week. Check back when the next week turns over.',
          }),
        ]),
      );
    })
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}
