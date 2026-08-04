/**
 * Court oversight — what a company flagged as its region's Court may see.
 *
 * A Court is the in-fiction authority over trade in one region, so it reads
 * more of its neighbours than an ordinary shop does: their rosters and their
 * books. What bounds it is the REGION. The Worker resolves the Court's own
 * region and scopes every read to it; this screen only draws what comes back.
 *
 * READ ONLY. A Court is a rival trader as well as an overseer, and nothing here
 * can move another shop's money or change its listing.
 */
import { el, mount, esc, tableEl, statTiles } from '../lib/dom.js';
import { money, regionWord } from '../lib/format.js';
import { api } from '../lib/api.js';
import { openFocalMenu } from '../lib/tiles.js';
import { skeletonRows } from '../lib/skeleton.js';

/** The list of shops trading in this Court's region. */
export function renderCourtCompanies(container) {
  const listHost = el('div', {}, skeletonRows(4));
  const search = el('input', { type: 'search', placeholder: 'Search company or contact…' });
  let all = [];
  let hold = '';
  search.addEventListener('input', draw);

  mount(container,
    el('p', { class: 'note' }, 'Every company trading in your ' + regionWord() + '. Opening one shows its ' +
      'roster and its books — as its Court, you may look, but not change anything.'),
    search,
    listHost);

  api.getCourtCompanies()
    .then((d) => { all = d.companies || []; hold = d.hold || ''; draw(); })
    .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((c) => !q ||
      [c.business, c.pointOfContact, c.status].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) {
      mount(listHost, el('p', { class: 'note' }, all.length
        ? 'No matches.'
        : 'No companies are registered in ' + (hold || 'your ' + regionWord()) + ' yet.'));
      return;
    }
    mount(listHost, ...rows.map((c) => {
      const statusCls = String(c.status).toUpperCase() === 'VALID' ? 'ok' : 'bad';
      const sub = c.perpetual ? 'Perpetual' : (c.until ? 'certified until ' + c.until : 'no subscription');
      return el('div', { class: 'member-row' }, [
        el('p', { html:
          '<b>' + esc(c.business || '—') + '</b> · <span class="' + statusCls + '">' + esc(c.status || '—') + '</span>' +
          (c.court ? ' <span class="role-pill">Court</span>' : '') + '<br>' +
          '<span class="note">' + esc(sub) + (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openCourtShop(c.business) }, 'Open'),
        ]),
      ]);
    }));
  }
}

/** One shop in the region: its roster, its treasury, and how it is trading. */
function openCourtShop(business) {
  openFocalMenu(business, (host) => {
    mount(host, el('p', { class: 'note' }, 'Loading…'));
    api.getCourtCompany(business)
      .then((d) => mount(host, ...shopBody(d)))
      .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  });
}

function shopBody(d) {
  const o = d.overview || {};
  const coffer = d.coffer || {};
  const entries = coffer.entries || [];
  const roster = d.roster || [];
  const discounts = d.discounts || [];
  const style = d.style || {};

  const nodes = [
    el('p', { class: 'note' }, 'Read only — what this company reports to its ' + regionWord() + '.'),
    statTiles([
      ['Coffer', money(coffer.balance || 0)],
      ['Revenue', money(o.revenue || 0)],
      ['Orders', String(o.orders || 0)],
      ['Items sold', String(o.itemsSold || 0)],
    ]),
    el('h4', {}, 'Staff'),
  ];

  nodes.push(roster.length
    ? el('div', { class: 'table-scroll' }, tableEl(['Name', 'Role', 'Status'],
        roster.map((p) => [p.character, p.isOwner ? 'Owner' : roleLabel(p.role), p.status])))
    : el('p', { class: 'note' }, 'Nobody registered to this company.'));

  nodes.push(el('h4', {}, 'Recent coffer activity'));
  nodes.push(entries.length
    ? el('div', {}, entries.slice(0, 15).map((e) => el('div.emp-row', {}, [
        el('span', { html: '<b>' + (Number(e.amount) >= 0 ? '+' : '') + esc(money(e.amount)) + '</b> ' +
          '<span class="note">' + esc(e.kind) + (e.note ? ' · ' + esc(e.note) : '') + ' · ' +
          esc(String(e.ts || '').slice(0, 10)) + '</span>' }),
      ])))
    : el('p', { class: 'note' }, 'No coffer activity yet.'));

  nodes.push(el('h4', {}, 'Top items'));
  nodes.push((d.items || []).length
    ? el('div', { class: 'table-scroll' }, tableEl(['Item', 'Qty sold', 'Revenue'],
        d.items.map((i) => [i.item, i.qty, money(i.revenue)])))
    : el('p', { class: 'note' }, 'Nothing sold yet.'));

  nodes.push(el('h4', {}, 'Discounts'));
  nodes.push(discounts.length
    ? el('div', {}, discounts.map((x) => el('p', { class: 'note' }, x.name + ' — ' + x.percent + '%')))
    : el('p', { class: 'note' }, 'No named discounts.'));

  if (style.tagline) nodes.push(el('p', { class: 'shop-tagline' }, style.tagline));
  return nodes;
}

function roleLabel(role) {
  return { owner: 'Shop Owner', employee: 'Employee', admin: 'Admin' }[role] || role || '';
}
