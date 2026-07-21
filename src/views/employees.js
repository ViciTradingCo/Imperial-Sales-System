/**
 * Employees page (owner/admin) — the roster for the caller's business, with
 * activation of pending accounts and owner-private notes per employee. Scoped
 * to the caller's business by the API.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { setOpsActions } from '../lib/sections.js';
import { money } from '../lib/format.js';

export function renderEmployees(container, { me }) {
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees
  const list = el('div', {}, el('p', { class: 'note' }, 'Loading roster…'));
  const perfHost = el('div', {}, el('p', { class: 'note' }, 'Loading performance…'));
  mount(container,
    el('div.card', {}, [
      el('h2', {}, 'Employees'),
      el('p', { class: 'note' }, 'Everyone registered under ' + esc(me.business || 'your business') +
        '. Activate pending accounts to let them ring up sales. Notes are private to you.'),
      list,
    ]),
    el('div.card', {}, [
      el('h3', {}, 'Employee performance'),
      el('p', { class: 'note' }, 'Sales rung up per employee (voided sales excluded).'),
      perfHost,
    ]));

  api.getEmployeePerformance()
    .then((r) => renderPerformance(perfHost, r.performance || []))
    .catch((e) => mount(perfHost, el('p', { class: 'error' }, e.message || String(e))));

  async function refresh() {
    try {
      const res = await api.listEmployees();
      const rows = res.employees || [];
      if (!rows.length) { mount(list, el('p', { class: 'note' }, 'No one registered yet.')); return; }
      const items = rows.map((u) => {
        const who = u.character || u.email; // character name is the display identity
        const label = el('span', { html:
          '<b>' + esc(who) + '</b> · <span class="role-pill">' + esc(u.role) + '</span> · ' + statusBadge(u.status) +
          (u.notes ? '<br><span class="note">📝 ' + esc(u.notes) + '</span>' : '') });
        const row = el('div.emp-row', {}, [label]);
        const actions = el('span', { class: 'row-actions' }, []);
        if (u.status === 'pending') {
          const btn = el('button.primary.small', {
            onclick: async () => {
              btn.disabled = true;
              btn.textContent = 'Activating…';
              try { await api.activateEmployee(u.uid); await refresh(); }
              catch (e) { btn.disabled = false; btn.textContent = 'Activate'; alert(e.message || e); }
            },
          }, 'Activate');
          actions.appendChild(btn);
        }
        actions.appendChild(el('button.secondary-btn.small', { onclick: () => openNoteModal(u, refresh) }, 'Notes'));
        row.appendChild(actions);
        return row;
      });
      mount(list, ...items);
    } catch (e) {
      mount(list, el('p', { class: 'error' }, e.message || String(e)));
    }
  }
  refresh();
}

/** Focus modal to view/edit an owner-private note on one employee. */
function openNoteModal(u, onSaved) {
  const who = u.character || u.email || u.uid;
  const note = el('textarea', { rows: '5', placeholder: 'Private notes about ' + who + '…' });
  note.value = u.notes || '';
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save note');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.setEmployeeNote(u.uid, note.value.trim());
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Notes — ' + who),
    el('p', { class: 'note' }, 'Only you (the business owner/admin) can see these notes.'),
    note,
    save,
    status,
  ]);
}

function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}

/** Table + horizontal revenue bars for per-employee performance. */
function renderPerformance(host, rows) {
  if (!rows.length) { mount(host, el('p', { class: 'note' }, 'No sales recorded yet.')); return; }
  const max = Math.max(...rows.map((r) => Number(r.revenue) || 0), 1);
  const bars = rows.map((r) => {
    const pct = Math.round(((Number(r.revenue) || 0) / max) * 100);
    const fill = el('div', { class: 'hbar-fill' }, '');
    fill.style.width = pct + '%';
    return el('div', { class: 'hbar-row' }, [
      el('div', { class: 'hbar-label' }, r.employee),
      el('div', { class: 'hbar-track' }, fill),
      el('div', { class: 'hbar-val' }, money(r.revenue)),
    ]);
  });
  const table = el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' }, [
    el('thead', {}, el('tr', {}, ['Employee', 'Orders', 'Items', 'Revenue'].map((h) => el('th', {}, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, [
      el('td', {}, r.employee), el('td', {}, String(r.orders)), el('td', {}, String(r.items)), el('td', {}, money(r.revenue)),
    ]))),
  ]));
  mount(host, el('div', { class: 'hbar-chart' }, bars), table);
}
