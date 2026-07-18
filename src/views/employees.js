/**
 * Employees page (owner/admin) — the roster for the caller's business, with
 * activation of pending accounts. Scoped to the caller's business by the API.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

export function renderEmployees(container, { me }) {
  const list = el('div', {}, el('p', { class: 'note' }, 'Loading roster…'));
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Employees'),
    el('p', { class: 'note' }, 'Everyone registered under ' + esc(me.business || 'your business') +
      '. Activate pending accounts to let them ring up sales.'),
    list,
  ]));

  async function refresh() {
    try {
      const res = await api.listEmployees();
      const rows = res.employees || [];
      if (!rows.length) { mount(list, el('p', { class: 'note' }, 'No one registered yet.')); return; }
      const items = rows.map((u) => {
        const who = u.character || u.email; // character name is the display identity
        const label = el('span', { html:
          '<b>' + esc(who) + '</b> · <span class="role-pill">' + esc(u.role) + '</span> · ' + statusBadge(u.status) });
        const row = el('div.emp-row', {}, [label]);
        if (u.status === 'pending') {
          const btn = el('button.primary.small', {
            onclick: async () => {
              btn.disabled = true;
              btn.textContent = 'Activating…';
              try { await api.activateEmployee(u.uid); await refresh(); }
              catch (e) { btn.disabled = false; btn.textContent = 'Activate'; alert(e.message || e); }
            },
          }, 'Activate');
          row.appendChild(btn);
        }
        return row;
      });
      mount(list, ...items);
    } catch (e) {
      mount(list, el('p', { class: 'error' }, e.message || String(e)));
    }
  }
  refresh();
}

function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
