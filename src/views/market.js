/**
 * Market Analysis (admin) — realm-wide analytics, split into sub-pages reached
 * from the action bar: Overview, Item Performance, Region Performance, Company
 * Performance, Trends. Read-only; the API enforces admin-only access.
 */
import { money, regionLabel, regionWord, regionsOn } from '../lib/format.js';
import { el, mount, esc, tableEl } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setMarketActions } from '../lib/sections.js';
import { createItemPicker } from '../lib/item-picker.js';
import { openFocalMenu } from '../lib/tiles.js';
import { lineChart } from '../lib/chart.js';

export function renderMarket(container, { tab } = {}) {
  setMarketActions(); // Market's own sub-pages; the side menu is the way back
  const host = el('div', {}, el('p', { class: 'note' }, 'Crunching the numbers…'));
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Market Analysis'),
    el('p', { class: 'note' }, 'Performance across every shop in this realm. Voided sales and employee ' +
      'purchases are excluded — neither is trade.'),
    host,
  ]));

  api.getMarket()
    .then((d) => renderTab(host, tab || 'overview', d))
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}

function renderTab(host, tab, d) {
  if (tab === 'items') return mount(host, itemPerformance(d));
  if (tab === 'regions') return mount(host, regionPerformance(d.holds || []));
  if (tab === 'companies') return mount(host, companyPerformance(d.businesses || []));
  if (tab === 'trends') return mount(host, trendsCard(d.trends || []));
  return mount(host, ...overview(d));
}

/**
 * The columns for each subject, defined ONCE.
 *
 * Overview's "Top 5" tables are previews of the pages below them, so they use
 * these too — a column added to Item Performance appears in its Top 5 without
 * anyone remembering to. They used to be written out separately and had already
 * drifted.
 *
 * Region headers are functions because a realm names its regions itself.
 */
const COMPANY_COLS = {
  headers: () => ['Company', 'Orders', 'Items', 'Revenue'],
  // No archived shops reach this table: a departed shop's trade leaves the
  // figures with it (worker `notArchived`), so there is nothing here to name as
  // departed and no ranking a shop that has left the network can top.
  row: (b) => [b.business || '—', b.orders, b.items, money(b.revenue)],
};
const REGION_COLS = {
  headers: () => [regionLabel(), 'Orders', 'Items', 'Revenue'],
  row: (h) => [h.hold, h.orders, h.items, money(h.revenue)],
};
/**
 * Item Performance answers ONE question: what is this item worth?
 *
 * It used to also carry quantity sold, order count, average bought and average
 * sold. Volume is not what an item is worth, and splitting the average by
 * direction split one number into two halves of the same thing — a buy and a
 * sale are both the item changing hands at a price. They are now one figure,
 * measured over every transaction, and the columns that were around it are
 * gone rather than left to be scanned past.
 */
/**
 * `oneRegion` drops the Best-region column. A report already scoped to a single
 * region cannot have a best one — the answer would be the region you are
 * looking at, on every row. Market Info passes it; the realm-wide page does not.
 */
const ITEM_COLS = {
  headers: (oneRegion) => ['Item', 'Avg value']
    // Only when the realm uses regions — otherwise the column would be a row of
    // dashes explaining a concept this realm has switched off.
    .concat(regionsOn() && !oneRegion ? ['Best ' + regionWord()] : []),
  row: (i, oneRegion) => [i.item, valueCell(i)]
    .concat(regionsOn() && !oneRegion ? [regionCell(i)] : []),
};
/**
 * Where the item is worth most — the region with the highest average value,
 * measured the same way the realm-wide valuation is. The figure is shown
 * beside the name: "best" is a comparison, and a comparison with the number
 * hidden is just an assertion.
 */
function regionCell(i) {
  const b = i.bestRegion;
  if (!b) return el('span', {}, '—');
  return el('span', { title: b.qty + ' sold there' }, b.region + ' · ' + money(b.value));
}

/**
 * The valuation, carrying how much trade it rests on. A figure from two units
 * and one from two hundred read identically in a table, and they should not.
 */
function valueCell(i) {
  if (i.avgValue == null) return el('span', {}, '—');
  const n = i.valueSamples || 0;
  return el('span', { title: 'From ' + n + ' unit' + (n === 1 ? '' : 's') + ' traded' },
    money(i.avgValue) + (n < 4 ? ' ?' : ''));
}

/**
 * Overview: the top 5 of each category, plus the pricing alerts.
 *
 * No headline stat tiles. Network totals — gold taken, orders, items, shops
 * open — say how BUSY the realm is, which is not a thing an admin acts on; the
 * panels below say what to do about a specific shop, region, or item. The tiles
 * took the top of the screen to answer a question nobody was asking.
 */
function overview(d) {
  return [
    // Only shops that have actually traded. Company Performance lists the whole
    // roster, zeroes included, because an admin needs to see who has gone quiet
    // — but a "Top 5" is a ranking of who is doing well, and padding a ranking
    // with zeroes ranks nothing.
    tableCard('Top 5 companies', COMPANY_COLS.headers(),
      (d.businesses || []).filter((b) => b.revenue > 0).slice(0, 5).map(COMPANY_COLS.row),
      'No sales recorded yet.'),
    tableCard('Top 5 ' + regionWord() + 's', REGION_COLS.headers(),
      (d.holds || []).slice(0, 5).map(REGION_COLS.row),
      'No sales with a ' + regionWord() + ' recorded yet.'),
    tableCard('Top 5 items', ITEM_COLS.headers(),
      (d.items || []).slice(0, 5).map(ITEM_COLS.row),
      'No items sold yet.'),
    alertsCard('⚠ Priced below cost', 'bad',
      (d.underpriced || []).map((u) =>
        '<b>' + esc(u.business) + '</b> · ' + esc(u.item) + ' — selling at ' +
        money(u.salePrice) + ' vs. avg cost ' + money(u.avgCost)),
      'No items are priced below their purchase cost.'),
    // Measured against what the item actually sells for, not its index base —
    // and items with no sales yet are simply not judged.
    alertsCard('⤴ Overpriced (vs average value)', 'bad',
      (d.overpriced || []).map((o) =>
        '<b>' + esc(o.business) + '</b> · ' + esc(o.item) + ' — ' + money(o.price) +
        ' vs ' + money(o.value) + ' average (' + o.ratio.toFixed(2) + '×)'),
      'No items are priced above what they sell for.'),
    alertsCard('⤵ Undercut (vs average value)', 'warn',
      (d.undercut || []).map((u) =>
        '<b>' + esc(u.business) + '</b> · ' + esc(u.item) + ' — ' + money(u.price) +
        ' vs ' + money(u.value) + ' average (' + u.ratio.toFixed(2) + '×)'),
      'No items are undercut.'),
  ];
}

/* ---- Trends: daily revenue bars ---- */
function trendsCard(trends) {
  if (!trends.length) return el('div.card', {}, [el('h3', {}, 'Revenue trend'), el('p', { class: 'note' }, 'No sales yet.')]);
  const max = Math.max(...trends.map((t) => Number(t.revenue) || 0), 1);
  const bars = trends.map((t) => {
    const h = Math.round(((Number(t.revenue) || 0) / max) * 100);
    const bar = el('div', { class: 'trend-bar', title: t.day + ': ' + money(t.revenue) + ' · ' + t.orders + ' orders' },
      el('div', { class: 'trend-fill' }, ''));
    bar.querySelector('.trend-fill').style.height = h + '%';
    return el('div', { class: 'trend-col' }, [bar, el('div', { class: 'trend-day' }, String(t.day).slice(5))]);
  });
  return el('div.card', {}, [
    el('h3', {}, 'Revenue trend (last ' + trends.length + ' days)'),
    el('div', { class: 'trend-chart' }, bars),
  ]);
}

/* ---- Item Performance ---- */
/**
 * The five items carrying the realm, each as its own figures-over-a-graph
 * block, then a picker for looking up any other.
 *
 * It used to be one long table of every item, which answered "what exists"
 * rather than "what is happening" — the numbers were there but nothing showed
 * movement, and finding one item meant filtering a list of hundreds. The five
 * that matter now come with their trend; everything else is one search away.
 */
function itemPerformance(d) {
  const top = d.topItems || [];
  const picker = createItemPicker({
    placeholder: 'Look up any item…',
    meta: (it) => (it.category && it.category !== 'Unsorted' ? it.category : ''),
    onPick: (it) => { picker.clear(); openItemDetail(it.name); },
  });
  // The same index the register picks from, so a name typed here is a real item.
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});

  return el('div.card', {}, [
    el('h3', {}, 'Item Performance'),
    el('p', { class: 'note' }, 'Average value is what the item actually changes hands for — every sale, ' +
      'every intake, every transfer, weighted by units and with outliers fenced off, so one collector ' +
      'overpaying does not become the item’s worth. Hover a value to see how much trade it rests on.'),
    top.length
      ? el('div', {}, top.map((i) => itemBlock(i)))
      : el('p', { class: 'note' }, 'No items sold yet.'),
    el('h4', {}, 'Look up an item'),
    el('p', { class: 'note' }, 'Any item in the index, whether or not it made the top five.'),
    picker.el,
  ]);
}

/**
 * One item: its figures as a table, with its trend graph directly beneath.
 *
 * The table is the SAME column set the lists use, so a column added anywhere
 * appears here too — and a reader moving between Overview and this page is
 * reading the same row twice, not two different summaries.
 */
export function itemBlock(i, opts) {
  const o = opts || {};
  return el('div', { class: 'item-block' }, [
    el('div', { class: 'table-scroll' }, tableEl(ITEM_COLS.headers(o.oneRegion), [ITEM_COLS.row(i, o.oneRegion)])),
    lineChart((i.trend || []).map((p) => ({ day: p.day, value: p.qty })), {
      label: i.item + ' units sold per day',
      format: (v) => v + ' sold',
      emptyMsg: o.emptyMsg || 'No sales in the last 30 days.',
    }),
  ]);
}

/** A searched item, shown exactly as the top five are. */
function openItemDetail(name) {
  openFocalMenu(name, (host) => {
    mount(host, el('p', { class: 'note' }, 'Loading…'));
    api.getMarketItem(name)
      .then((d) => mount(host,
        el('p', { class: 'note' }, 'Base value ' + money(d.baseValue) +
          (d.category ? ' · ' + d.category : '')),
        itemBlock(d.item)))
      .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  });
}

/* ---- Region Performance ---- */
function regionPerformance(holds) {
  return el('div', {}, [
    tableCard(regionLabel() + ' Performance', REGION_COLS.headers(),
      holds.map(REGION_COLS.row),
      'No trade with a ' + regionWord() + ' recorded yet.'),
    el('p', { class: 'note' }, 'Counts everything that changed hands in a ' + regionWord() + ': sales rung up ' +
      'there, and stock bought FROM there — somebody in that ' + regionWord() + ' selling to a shop.'),
  ]);
}

/* ---- Company Performance ---- */
/**
 * Every registered company, whether or not it has sold anything. A shop with a
 * row of zeroes is a shop that has not traded; a shop missing from the table
 * looks like a shop that does not exist, and only one of those is actionable.
 */
function companyPerformance(businesses) {
  return tableCard('Company Performance', COMPANY_COLS.headers(),
    businesses.map(COMPANY_COLS.row),
    'No companies registered yet.');
}

/* ---- shared bits ---- */
export function tableCard(title, headers, rows, emptyMsg) {
  const body = rows.length
    ? el('div', { class: 'table-scroll' }, tableEl(headers, rows))
    : el('p', { class: 'note' }, emptyMsg);
  return el('div.card', {}, [el('h3', {}, title), body]);
}

function alertsCard(title, cls, lines, emptyMsg) {
  const body = lines.length
    ? el('ul', { class: 'alert-list' }, lines.map((l) => el('li', { class: cls, html: l })))
    : el('p', { class: 'ok' }, emptyMsg);
  return el('div.card', {}, [el('h3', {}, title), body]);
}
