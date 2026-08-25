/**
 * Audit Log (admin) — recent significant actions across the network, searchable.
 * Read-only; the API enforces admin-only access.
 */
import { el, mount } from '../lib/dom.js';
import { formatDateTime } from '../lib/format.js';
import { api } from '../lib/api.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { pager } from '../lib/paginate.js';
import { skeletonRows } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';

const PAGE_SIZE = 50;

export function renderAudit(container) {
  setAdminActions();
  const host = el('div', {}, skeletonRows(5));
  const search = el('input', { type: 'search', placeholder: 'Search detail…' });
  // Server-side filters — the log is append-only and grows fast, so actor /
  // action / date narrowing happens in SQL rather than in the browser.
  const actor = el('input', { type: 'search', placeholder: 'Actor…' });
  const action = el('select', {}, el('option', { value: '' }, 'Any action'));
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  const applyBtn = el('button.secondary-btn', { onclick: () => load() }, 'Apply filters');
  const clearBtn = el('button.secondary-btn', { onclick: () => {
    actor.value = ''; action.value = ''; from.value = ''; to.value = ''; search.value = ''; load();
  } }, 'Clear');

  let all = [];
  let page = 1;
  search.addEventListener('input', () => { page = 1; draw(); });
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Audit Log'),
    el('p', { class: 'note' }, 'Recent significant actions — member/company edits, deletions, transfers, coffer and log changes.'),
    el('div', { class: 'filter-row' }, [actor, action, from, to, applyBtn, clearBtn]),
    search,
    host,
  ]));

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = !q ? all : all.filter((r) =>
      [r.actor, r.action, r.detail].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) { mount(host, emptyState({ glyph: '🧾', title: all.length ? 'No matches' : 'No audit entries yet', hint: all.length ? 'Try widening the filters.' : 'Significant actions will be recorded here.' })); return; }
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

  let knownActions = null;
  function load() {
    page = 1;
    mount(host, skeletonRows(5));
    api.getAudit({ actor: actor.value.trim(), action: action.value, from: from.value, to: to.value })
      .then((res) => {
        all = res.audit || [];
        // Populate the action dropdown once, from what's actually in the log.
        if (!knownActions && res.actions) {
          knownActions = res.actions;
          knownActions.forEach((a) => action.appendChild(el('option', { value: a }, a)));
        }
        draw();
      })
      .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  }
  load();
}

function when(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : formatDateTime(d);
}
