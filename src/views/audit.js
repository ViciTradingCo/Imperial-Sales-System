/**
 * Audit Log (admin) — recent significant actions across the network, searchable.
 * Read-only; the API enforces admin-only access.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { pager } from '../lib/paginate.js';

const PAGE_SIZE = 50;

export function renderAudit(container) {
  setAdminActions();
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const search = el('input', { type: 'search', placeholder: 'Search actor, action, detail…' });
  let all = [];
  let page = 1;
  search.addEventListener('input', () => { page = 1; draw(); });
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Audit Log'),
    el('p', { class: 'note' }, 'Recent significant actions — member/company edits, deletions, transfers, coffer and log changes.'),
    search,
    host,
  ]));

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = !q ? all : all.filter((r) =>
      [r.actor, r.action, r.detail].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) { mount(host, el('p', { class: 'note' }, all.length ? 'No matches.' : 'No audit entries yet.')); return; }
    const pg = pager(rows.length, page, PAGE_SIZE, (n) => { page = n; draw(); });
    page = pg.page;
    const slice = rows.slice(pg.start, pg.end);
    mount(host,
      el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' }, [
        el('thead', {}, el('tr', {}, ['When', 'Actor', 'Action', 'Detail'].map((h) => el('th', {}, h)))),
        el('tbody', {}, slice.map((r) => el('tr', {}, [
          el('td', {}, when(r.ts)),
          el('td', {}, r.actor || ''),
          el('td', {}, r.action || ''),
          el('td', {}, r.detail || ''),
        ]))),
      ])),
      pg.bar);
  }

  api.getAudit()
    .then((res) => { all = res.audit || []; draw(); })
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}

function when(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}
