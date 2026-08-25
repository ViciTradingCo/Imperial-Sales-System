/**
 * Shop performance (owner) — the owner-facing counterpart to network Market
 * Analysis, scoped to their own business.
 *
 * TWO CLOCKS, and the page says which is which. The headline figures are ALL
 * TIME, because that is what "how is my shop doing" means to somebody who has
 * run it for a month. Everything that only means something against a clock —
 * growth, what the month cost, which day is worth opening for — sits under a
 * heading that names the window. A report that quotes a year's takings beside a
 * week's costs is worse than one that reports less.
 *
 * The figures are set in the DATA face and the labels in the printed one: this
 * is bookkeeping, and a column of money that does not line up is a column you
 * cannot read down. Nothing here is written in the hand.
 */
import { el, mount, tableEl } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { money, coins, tagLabel, weekdayName } from '../lib/format.js';
import { skeletonLines } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';

export function renderShopReport(container) {
  const host = el('div', {}, skeletonLines(4));
  mount(container, host);

  api.getShopReport().then((r) => {
    const o = r.overview || {};
    if (!o.orders) {
      mount(host, emptyState({
        glyph: '📈', title: 'No sales yet',
        hint: 'Once your shop rings up its first sale, your revenue trend and best sellers appear here.',
      }));
      return;
    }
    mount(host, ...report(r));
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}

/** The whole page, in the order an owner reads it. */
function report(r) {
  const o = r.overview || {};
  const p = r.period || null;
  const out = [];

  out.push(el('h4', {}, 'All time'));
  out.push(el('div', { class: 'stat-row' }, [
    stat('Revenue', money(o.revenue)),
    stat('Orders', String(o.orders)),
    stat('Items sold', String(o.itemsSold)),
    stat('Average order', money(o.avgOrder)),
  ]));

  if (p) {
    out.push(el('h4', {}, 'The last ' + p.days + ' days'));
    out.push(el('div', { class: 'stat-row' }, [
      // Growth is the one figure a shopkeeper actually acts on, so it is beside
      // the takings rather than buried in a table.
      stat('Revenue', money(p.revenue), change(p.revenue, p.prevRevenue)),
      stat('Orders', String(p.orders), change(p.orders, p.prevOrders)),
      stat('Average order', money(p.avgOrder)),
      stat('Days traded', p.activeDays + ' of ' + p.days),
    ]));
    out.push(el('div', { class: 'stat-row' }, [
      stat('Money in', money(p.moneyIn)),
      stat('Money out', money(p.moneyOut)),
      stat('Kept', money(p.kept), p.kept < 0 ? 'spent more than it took' : ''),
    ]));
    out.push(el('p', { class: 'note' }, 'Money in and out is your coffer over the same ' + p.days +
      ' days — every sale, delivery, wage and adjustment — so this page and your ledger cannot disagree.'));
  }

  out.push(el('h4', {}, 'Revenue — last 30 active days'));
  out.push(trendChart(r.trends || []));

  out.push(tradeTable(o, p));

  const stock = r.stock;
  if (stock) {
    out.push(el('h4', {}, 'On the shelf'));
    out.push(el('div', { class: 'stat-row' }, [
      stat('Stock value', money(stock.value), 'at your own prices'),
      stat('Units held', String(stock.units)),
      stat('Listings', String(stock.listings), stock.ingredients ? stock.ingredients + ' ingredient listings besides' : ''),
      stat('Needs restocking', String(stock.low + stock.out), stock.out + ' out, ' + stock.low + ' low'),
    ]));
  }

  out.push(el('h4', {}, 'Best sellers'));
  out.push(topItems(r.items || []));

  if ((r.kinds || []).length) {
    out.push(el('h4', {}, 'What sells, by kind'));
    out.push(kindBars(r.kinds));
    out.push(el('p', { class: 'note' }, 'Units sold over the last 30 days, by the kinds you have tagged your ' +
      'stock with. Something tagged twice counts under both.'));
  }

  if ((r.slow || []).length) {
    out.push(el('h4', {}, 'Not moving'));
    out.push(slowTable(r.slow));
    out.push(el('p', { class: 'note' }, 'Stock you are holding that has not sold in sixty days, and what it is ' +
      'worth at your prices. The most tied-up first.'));
  }

  return out;
}

/** A headline figure, its name, and an optional line of context under it. */
function stat(label, value, hint) {
  return el('div', { class: 'stat-tile' }, [
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label' }, label),
    hint ? el('div', { class: 'stat-hint' }, hint) : null,
  ].filter(Boolean));
}

/**
 * This window against the one before it.
 *
 * Nothing is said when there is no earlier window to compare with: "+100%"
 * against a month that did not exist is not a fact about the shop.
 */
function change(now, before) {
  const a = Number(now) || 0;
  const b = Number(before) || 0;
  if (!b) return a ? 'no earlier period to compare' : '';
  const pct = Math.round(((a - b) / b) * 100);
  if (!pct) return 'level with the 30 days before';
  return (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% on the 30 days before';
}

/** The figures that are a sentence rather than a headline. */
function tradeTable(o, p) {
  const rows = [
    ['Items in an average order', (Math.round((Number(o.itemsPerOrder) || 0) * 10) / 10).toFixed(1)],
    ['Customers by name', String(o.customers || 0)],
    ['Of those, came back', String(o.repeat || 0)],
  ];
  // The Worker sends the day's NUMBER; what it is called is decided here, in
  // whatever language the reader has the app set to.
  if (p && p.busiestDay != null) {
    rows.push(['Best day of the week', weekdayName(p.busiestDay) + ' · ' + money(p.busiestRevenue)]);
  }
  // Wording, not a sign: nobody should have to read a minus to learn they
  // charged over the odds.
  const given = Number(o.discountGiven) || 0;
  if (coins(Math.abs(given))) {
    rows.push([given > 0 ? 'Given away in discounts' : 'Added in upcharges', money(Math.abs(given))]);
  }
  if (o.voided) rows.push(['Sales voided', String(o.voided)]);
  if (o.staffOrders) rows.push(['Employee purchases', o.staffOrders + ' · ' + o.staffUnits + ' item' + (o.staffUnits === 1 ? '' : 's')]);
  // Named columns rather than an empty header row: this is a table of figures,
  // and a reader coming to it cold should not have to infer which side is which.
  return el('div', { class: 'table-scroll' }, tableEl(['How it trades', 'Figure'], rows));
}

/**
 * The daily bars.
 *
 * A bar chart with no scale is a picture, not a figure — so the tallest day is
 * named above it. The old version put the day and its takings in a `title`,
 * which on a phone is nowhere at all.
 */
function trendChart(trends) {
  if (!trends.length) return el('p', { class: 'note' }, 'No activity yet.');
  const max = Math.max(...trends.map((t) => Number(t.revenue) || 0), 1);
  const peak = trends.reduce((a, t) => ((Number(t.revenue) || 0) > (Number(a.revenue) || 0) ? t : a), trends[0]);
  return el('div', {}, [
    el('p', { class: 'chart-scale' }, 'Best day ' + money(peak.revenue) + ' (' + peak.day + ') · ' +
      trends.length + ' day' + (trends.length === 1 ? '' : 's') + ' shown'),
    el('div', { class: 'trend-chart' }, trends.map((t) => {
      const pct = Math.round(((Number(t.revenue) || 0) / max) * 100);
      return el('div', { class: 'trend-col', title: t.day + ' · ' + money(t.revenue) + ' · ' + t.orders + ' order(s)' }, [
        el('div', { class: 'trend-bar' }, [el('div', { class: 'trend-fill', style: 'height:' + pct + '%' })]),
        el('div', { class: 'trend-day' }, String(t.day || '').slice(5)),
      ]);
    })),
  ]);
}

function topItems(items) {
  if (!items.length) return el('p', { class: 'note' }, 'No item sales recorded yet.');
  const max = Math.max(...items.map((i) => Number(i.revenue) || 0), 1);
  return el('div', { class: 'hbar-chart' }, items.slice(0, 10).map((i) => el('div', { class: 'hbar-row' }, [
    el('span', { class: 'hbar-label', title: i.item }, i.item),
    el('div', { class: 'hbar-track' }, [
      el('div', { class: 'hbar-fill', style: 'width:' + Math.round((Number(i.revenue) / max) * 100) + '%' }),
    ]),
    el('span', { class: 'hbar-val' }, money(i.revenue) + ' · ' + i.qty),
  ])));
}

/** The same bars, counting units of each KIND rather than money per item. */
function kindBars(kinds) {
  const max = Math.max(...kinds.map((k) => k.qty), 1);
  return el('div', { class: 'hbar-chart' }, kinds.slice(0, 10).map((k) => el('div', { class: 'hbar-row' }, [
    el('span', { class: 'hbar-label', title: tagLabel(k.tag) }, tagLabel(k.tag)),
    el('div', { class: 'hbar-track' }, [
      el('div', { class: 'hbar-fill', style: 'width:' + Math.round((k.qty / max) * 100) + '%' }),
    ]),
    el('span', { class: 'hbar-val' }, k.qty + ' sold'),
  ])));
}

function slowTable(slow) {
  return el('div', { class: 'table-scroll' }, tableEl(
    ['Item', 'In stock', 'Worth', 'Last sold'],
    slow.map((s) => [s.item, String(s.stock), money(s.value), s.lastSold || 'never']),
  ));
}
