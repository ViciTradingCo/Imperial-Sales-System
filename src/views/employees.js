/**
 * Employees page (owner/admin) — the roster for the caller's business, with
 * activation of pending accounts and owner-private notes per employee. Scoped
 * to the caller's business by the API.
 */
import { el, mount, esc } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { setOpsActions } from '../lib/sections.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';
import { skeletonRows, skeletonLines } from '../lib/skeleton.js';
import { staffCodePanel } from './staff-code.js';
import { money } from '../lib/format.js';
import { isOwner, roleLabel } from '../lib/roles.js';

export function renderEmployees(container, { me }) {
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees
  // A manager keeps the roster — activating, annotating, reading it. What is
  // the OWNER'S alone is what someone is PAID and who else becomes a manager,
  // so those two buttons are the only thing on this page that asks.
  const owner = isOwner(me);
  const list = el('div', {}, skeletonRows(3));
  const perfHost = el('div', {}, skeletonLines(3));
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Employees'),
    el('p', { class: 'note' }, 'Your roster at ' + (me.business || 'your business') + '. Pick a section to open it.'),
    gridHost,
  ]));

  const sections = [
    // The staff code lives here as well as in Shop Settings. Someone wanting to
    // bring on an employee comes to THIS page; finding a roster and no way to
    // invite anyone is how people concluded there was no such button.
    { key: 'emp-code', label: 'Staff code', hint: 'Invite someone to your shop', glyph: '🎟️',
      open: (host) => mount(host, staffCodePanel()) },
    { key: 'emp-roster', label: 'Roster', hint: 'Activate & annotate', glyph: '🧑‍🤝‍🧑',
      open: (host) => mount(host, el('div.card', {}, [
        el('h3', {}, 'Roster'),
        el('p', { class: 'note' }, 'Everyone registered under ' + (me.business || 'your business') +
          '. Activate pending accounts to let them ring up sales. Notes are private to you.'),
        list,
      ])) },
    { key: 'emp-performance', label: 'Performance', hint: 'Sales per employee', glyph: '📈',
      open: (host) => mount(host, el('div.card', {}, [
        el('h3', {}, 'Employee performance'),
        el('p', { class: 'note' }, 'Sales rung up per employee (voided sales excluded).'),
        perfHost,
      ])) },
  ];

  function draw(images) {
    mount(gridHost, tileGrid(sectionTiles(sections, navigate), images));
  }
  draw({});
  api.getTiles().then((r) => draw(r.images || {})).catch(() => {});

  api.getEmployeePerformance()
    .then((r) => renderPerformance(perfHost, r.performance || []))
    .catch((e) => mount(perfHost, el('p', { class: 'error' }, e.message || String(e))));

  async function refresh() {
    try {
      const res = await api.listEmployees();
      const rows = res.employees || [];
      if (!rows.length) {
        mount(list, emptyState({ glyph: '🧑‍🤝‍🧑', title: 'No one registered yet',
          hint: 'Give someone your Staff code — the button beside this one — and they will appear here ' +
            'when they sign up, ready for you to activate.' }));
        return;
      }
      // Bulk activation — onboarding a group one row at a time is tedious.
      // It only EXISTS above one pending account, though: with a single one to
      // approve there is nothing to bulk, and the tick box that came with it
      // was a control with no button behind it and no way to guess that.
      const pending = rows.filter((u) => u.status === 'pending');
      const bulk = pending.length > 1;
      const checks = new Map();
      const items = rows.map((u) => {
        const who = u.character || u.email; // character name is the display identity
        // What they earn, said plainly when nothing is set: 0 and "nobody has
        // decided yet" look identical on a wage line. Either half may stand
        // alone, so the two are listed rather than one being a fallback.
        const earns = [
          u.payRate ? money(u.payRate) + ' an hour' : '',
          u.commissionRate ? u.commissionRate + '% commission' : '',
        ].filter(Boolean).join(' · ') || 'No pay set';
        const label = el('span', { class: 'emp-who', html:
          '<b>' + esc(who) + '</b> · <span class="role-pill">' + esc(roleLabel(u.role)) + '</span> · ' + statusBadge(u.status) +
          '<br><span class="note">' + esc(earns) + '</span>' +
          (u.notes ? '<br><span class="note">📝 ' + esc(u.notes) + '</span>' : '') });
        const row = el('div.emp-row', {}, []);
        if (u.status === 'pending' && bulk) {
          const cb = el('input', { type: 'checkbox', class: 'bulk-check', title: 'Select for bulk activation' });
          checks.set(u.uid, cb);
          row.appendChild(cb);
        }
        row.appendChild(label);
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
        if (owner) {
          actions.appendChild(el('button.secondary-btn.small', { onclick: () => openRateModal(u, refresh) }, 'Pay'));
          // Only for the people it can apply to. An owner is already above it
          // and an admin is not on this shop's ladder at all, so offering it on
          // their row would be a button that only ever refuses.
          if (u.role === 'employee' || u.role === 'manager') {
            actions.appendChild(el('button.secondary-btn.small', { onclick: () => openManagerModal(u, refresh) },
              u.role === 'manager' ? 'Stand down' : 'Make manager'));
          }
        }
        actions.appendChild(el('button.secondary-btn.small', { onclick: () => openNoteModal(u, refresh) }, 'Notes'));
        row.appendChild(actions);
        return row;
      });

      const nodes = [];
      if (bulk) {
        const selectAll = el('input', { type: 'checkbox' });
        selectAll.addEventListener('change', () => {
          checks.forEach((cb) => { cb.checked = selectAll.checked; });
        });
        const bulkBtn = el('button.primary.small', { onclick: doBulk }, 'Activate selected');
        nodes.push(el('div', { class: 'bulk-bar' }, [
          // Labelled, like the item index's. A bare tick box at the head of a
          // list does not say what it would select, and a `title` only tells
          // someone who already thought to hover it.
          el('label', { class: 'bulk-all' }, [selectAll, el('span', {}, 'Select all pending')]),
          el('span', { class: 'note' }, pending.length + ' pending'),
          bulkBtn,
        ]));
        async function doBulk() {
          const uids = [...checks.entries()].filter(([, cb]) => cb.checked).map(([uid]) => uid);
          if (!uids.length) { alert('Select at least one pending account.'); return; }
          bulkBtn.disabled = true; bulkBtn.textContent = 'Activating…';
          let ok = 0;
          for (const uid of uids) {
            try { await api.activateEmployee(uid); ok++; }
            catch (e) { /* keep going; the refresh below shows what stuck */ }
          }
          toast('Activated ' + ok + ' of ' + uids.length, ok === uids.length ? 'ok' : 'warn');
          await refresh();
        }
      }
      mount(list, ...nodes, ...items);
    } catch (e) {
      mount(list, el('p', { class: 'error' }, e.message || String(e)));
    }
  }
  refresh();
}

/** Focus modal to view/edit an owner-private note on one employee. */
/**
 * WHAT THIS PERSON EARNS — by the hour, by what they sell, or both.
 *
 * Two independent halves, and either may be zero. A shop that pays a flat wage
 * leaves the commission at 0; one that pays purely on results leaves the hourly
 * rate at 0; plenty do both. Neither is a fallback for the other, which is why
 * they are two fields rather than a choice between two modes.
 *
 * Both apply from HERE ON. A finished shift keeps the rate it was stamped with,
 * and a sale keeps the commission it was rung up at — so giving someone a raise
 * never quietly restates what last month's work was worth. An owner who has
 * already agreed a figure still owes that figure.
 */
function openRateModal(u, onSaved) {
  const rate = el('input', { type: 'number', step: '0.01', min: '0', value: String(u.payRate || 0) });
  const commission = el('input', { type: 'number', step: '0.1', min: '0', max: '100', value: String(u.commissionRate || 0) });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');

  let modal;
  async function doSave() {
    save.disabled = true;
    status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setPayRate(u.uid, rate.value, commission.value);
      onSaved();
      modal.close();
      toast('Pay saved.', 'ok');
    } catch (e) {
      save.disabled = false;
      status.className = 'error'; status.textContent = e.message || String(e);
    }
  }

  modal = openModal([
    el('h3', {}, 'Pay — ' + (u.character || u.email)),
    el('label', {}, 'Hourly rate'), rate,
    el('p', { class: 'note' }, 'What they earn per hour on the time card. Leave it at 0 if you do not pay ' +
      'by the hour.'),
    el('label', {}, 'Commission — % of each sale they ring up'), commission,
    el('p', { class: 'note' }, 'Their share of every sale they make, worked out on what the shop actually ' +
      'took after any discount. It shows on the time card payout as its own figure beside the hours. ' +
      'Leave it at 0 if you do not pay commission.'),
    el('p', { class: 'note' }, 'Both apply from now on. Shifts already finished keep the rate they were ' +
      'recorded at and sales already rung up keep the commission they earned, so a raise never changes ' +
      'what past work was worth.'),
    save, status,
  ]);
}

/**
 * Appointing a manager. The OWNER'S own — a manager who could appoint managers
 * could appoint themselves out of every limit the role has.
 */
function openManagerModal(u, onSaved) {
  const who = u.character || u.email;
  const making = u.role !== 'manager';
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, making ? 'Make manager' : 'Stand down');

  let modal;
  async function doSave() {
    save.disabled = true;
    status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setManager(u.uid, making);
      onSaved();
      modal.close();
      toast(making ? who + ' is now a manager.' : who + ' is an employee again.', 'ok');
    } catch (e) {
      save.disabled = false;
      status.className = 'error'; status.textContent = e.message || String(e);
    }
  }

  modal = openModal([
    el('h3', {}, (making ? 'Make manager — ' : 'Stand down — ') + who),
    making
      ? el('p', { class: 'note' }, 'A manager runs the shop as you do: buying, inventory, the roster, ' +
          'notices, the ledger, transfers and the time card log.')
      : el('p', { class: 'note' }, 'They go back to being an ordinary employee. Nothing they recorded ' +
          'while a manager is changed.'),
    making
      ? el('p', { class: 'note' }, 'What stays yours: setting what people are paid, appointing other ' +
          'managers, reissuing the staff code, renaming the shop, and exporting the books. A manager ' +
          'cannot give themselves a raise or hand the shop to anyone.')
      : null,
    save, status,
  ].filter(Boolean));
}

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
