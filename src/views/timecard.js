/**
 * Time cards — clocking on and off, and the owner's log of who is owed what.
 *
 * Two audiences on one page, which is why it is one page: an employee clocks
 * in and reads their own hours; an owner does the same for themselves AND sees
 * the shop. Splitting them would mean an owner who works shifts having to visit
 * two screens to do one job.
 *
 * MARKING PAID MOVES NO MONEY, exactly as a Court's levy does not. The app says
 * what is owed; a person confirms it was actually handed over, in whatever way
 * the fiction settles it.
 */
import { money } from '../lib/format.js';
import { el, mount, esc, statTiles } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setOpsActions } from '../lib/sections.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { skeletonRows } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';
import { openModal } from '../lib/modal.js';

/** "3h 25m" — hours as people say them, not as a decimal. */
function hm(hours) {
  const total = Math.max(0, Math.round((Number(hours) || 0) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return (h ? h + 'h ' : '') + m + 'm';
}

function when(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

export function renderTimecard(container, { me }) {
  setOpsActions(me);
  const isOwner = me.role === 'owner' || me.role === 'admin';
  let tileImages = {};

  const sections = [
    { key: 'tc-mine', label: 'My time card', hint: 'Clock in & out', glyph: '⏱️',
      open: (host) => renderMine(host) },
    isOwner ? { key: 'tc-log', label: 'Shift log', hint: 'Hours & wages owed', glyph: '📋',
      open: (host) => renderLog(host) } : null,
  ].filter(Boolean);

  function draw() {
    mount(container, el('div.card', {}, [
      el('h2', {}, 'Time Cards'),
      el('p', { class: 'note' }, isOwner
        ? 'Clock yourself on and off, and see what your staff have worked and are owed.'
        : 'Clock on when you start a shift and off when you finish. Your owner sees the log.'),
      tileGrid(sectionTiles(sections), tileImages),
    ]));
  }
  draw();
  api.getTiles().then((r) => { tileImages = r.images || {}; draw(); }).catch(() => {});
}

/* ---- an employee's own card ---- */

function renderMine(host) {
  const body = el('div', {}, skeletonRows(3));
  mount(host, body);

  function load() {
    api.getTimecard()
      .then(draw)
      .catch((e) => mount(body, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw(d) {
    const open = d.open;
    const shifts = d.shifts || [];
    const rate = Number(d.rate) || 0;

    const action = open
      ? el('button.danger', { onclick: doOut }, 'Clock out')
      : el('button.primary', { onclick: doIn }, 'Clock in');

    // Unpaid, finished work — what an employee actually wants to know.
    const owed = shifts.filter((s) => !s.open && !s.paid);
    const owedHours = owed.reduce((n, s) => n + s.hours, 0);

    mount(body,
      el('div.card', { class: 'card ' + (open ? 'shift-open' : '') }, [
        el('h3', {}, open ? '⏱️ On shift' : 'Not clocked in'),
        el('p', { class: 'note' }, open
          ? 'Since ' + when(open.clockIn) + ' · ' + hm(open.hours) + ' so far.'
          : 'Clock in when you start work.'),
        el('p', { class: 'note' }, rate
          ? 'Your rate: ' + money(rate) + ' an hour.'
          : 'No pay rate set — ask your owner to set one, or your shifts are worth nothing on the log.'),
        action,
      ]),
      statTiles([
        ['Unpaid hours', hm(owedHours)],
        ['Unpaid wage', money(owed.reduce((n, s) => n + s.pay, 0))],
      ]),
      el('h4', {}, 'Your shifts'),
      shifts.length
        ? el('div', {}, shifts.map(shiftRow))
        : emptyState({ glyph: '⏱️', title: 'No shifts yet', hint: 'Clock in above and it will be listed here.' }),
    );
  }

  function shiftRow(s) {
    return el('div.emp-row', {}, [
      el('span', { html:
        '<b>' + esc(when(s.clockIn)) + '</b>' +
        (s.open ? ' <span class="pill warn">ON SHIFT</span>' : ' → ' + esc(when(s.clockOut))) +
        '<br><span class="note">' + esc(hm(s.hours)) +
        (s.open ? ' so far' : ' · ' + money(s.pay) + (s.paid ? ' · paid' : ' · unpaid')) +
        (s.note ? ' · ' + esc(s.note) : '') + '</span>' }),
    ]);
  }

  async function doIn() {
    try { await api.clockIn(); toast('Clocked in.', 'ok'); load(); }
    catch (e) { toast(e.message || String(e), 'error'); }
  }
  async function doOut() {
    const note = window.prompt('Anything to note about this shift? (optional)') || '';
    try { await api.clockOut(note); toast('Clocked out.', 'ok'); load(); }
    catch (e) { toast(e.message || String(e), 'error'); }
  }

  load();
}

/* ---- the owner's log ---- */

function renderLog(host) {
  const body = el('div', {}, skeletonRows(4));
  mount(host, body);

  function load() {
    api.getTimecardLog()
      .then(draw)
      .catch((e) => mount(body, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw(d) {
    const people = d.people || [];
    const shifts = d.shifts || [];
    const t = d.totals || {};

    mount(body,
      statTiles([
        ['Hours logged', hm(t.hours)],
        ['Wages owed', money(t.owed)],
        ['On shift now', String(t.open || 0)],
      ]),
      el('p', { class: 'note' }, 'Marking wages paid records that it happened — it does not move coin. ' +
        'Pay from your coffer however your shop actually pays people.'),

      el('h4', {}, 'By employee'),
      people.length
        ? el('div', {}, people.map(personRow))
        : emptyState({ glyph: '📋', title: 'Nobody has clocked in yet',
            hint: 'Shifts your staff record will be summarised here.' }),

      el('h4', {}, 'Every shift'),
      shifts.length
        ? el('div', {}, shifts.slice(0, 60).map(logRow))
        : el('p', { class: 'note' }, 'No shifts recorded.'),
    );
  }

  function personRow(p) {
    const row = el('div.emp-row', {}, [
      el('span', { html:
        '<b>' + esc(p.employee || p.uid) + '</b>' + (p.open ? ' <span class="pill warn">ON SHIFT</span>' : '') +
        '<br><span class="note">' + esc(hm(p.hours)) + ' logged · ' +
        esc(hm(p.owedHours)) + ' unpaid · rate ' + esc(money(p.rate)) + '</span>' }),
      el('span', { html: '<b>' + esc(money(p.owed)) + '</b>' }),
    ]);
    if (p.owed > 0) {
      row.appendChild(el('span', { class: 'row-actions' }, [
        el('button.primary.small', {
          onclick: async () => {
            if (!confirm('Mark ' + money(p.owed) + ' as paid to ' + (p.employee || p.uid) + '?\n\n' +
              'This records the wage as settled. It does NOT move coin out of your coffer — ' +
              'pay them however your shop actually pays people.')) return;
            try { await api.payTimecard(p.uid); toast('Marked paid.', 'ok'); load(); }
            catch (e) { toast(e.message || String(e), 'error'); }
          },
        }, 'Mark paid'),
      ]));
    }
    return row;
  }

  function logRow(s) {
    const row = el('div.emp-row', {}, [
      el('span', { html:
        '<b>' + esc(s.employee || s.uid) + '</b> · ' + esc(when(s.clockIn)) +
        (s.open ? ' <span class="pill warn">ON SHIFT</span>' : ' → ' + esc(when(s.clockOut))) +
        (s.long ? ' <span class="pill danger">LONG</span>' : '') +
        '<br><span class="note">' + esc(hm(s.hours)) +
        (s.open ? ' so far' : ' · ' + money(s.pay) + (s.paid ? ' · paid' : ' · unpaid')) +
        (s.note ? ' · ' + esc(s.note) : '') + '</span>' }),
    ]);
    row.appendChild(el('span', { class: 'row-actions' }, [
      el('button.secondary-btn.small', { onclick: () => openEdit(s, load) }, 'Edit'),
      el('button.danger.small', {
        onclick: async () => {
          if (!confirm('Delete this shift?\n\n' + (s.employee || s.uid) + ' · ' + hm(s.hours) +
            '\n\nUse this for a shift recorded by mistake.')) return;
          try { await api.deleteShift(s.id); toast('Shift deleted.', 'ok'); load(); }
          catch (e) { toast(e.message || String(e), 'error'); }
        },
      }, 'Delete'),
    ]));
    return row;
  }

  load();
}

/**
 * Correcting a shift — usually a forgotten clock-out that ran overnight.
 *
 * Takes local datetimes and sends ISO, so an owner types the time they mean
 * rather than converting to UTC in their head.
 */
function openEdit(s, onSaved) {
  const toLocal = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const cin = el('input', { type: 'datetime-local', value: toLocal(s.clockIn) });
  const cout = el('input', { type: 'datetime-local', value: s.clockOut ? toLocal(s.clockOut) : '' });
  const note = el('input', { type: 'text', value: s.note || '', placeholder: 'Note (optional)' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save shift');

  let modal;
  async function doSave() {
    save.disabled = true;
    status.className = ''; status.textContent = 'Saving…';
    try {
      await api.editShift({
        id: s.id,
        clockIn: cin.value ? new Date(cin.value).toISOString() : undefined,
        // Blank end time reopens the shift, which is the right answer when
        // someone clocked out by accident and is still working.
        clockOut: cout.value ? new Date(cout.value).toISOString() : '',
        note: note.value,
      });
      onSaved();
      modal.close();
      toast('Shift updated.', 'ok');
    } catch (e) {
      save.disabled = false;
      status.className = 'error'; status.textContent = e.message || String(e);
    }
  }

  modal = openModal([
    el('h3', {}, 'Edit shift — ' + (s.employee || s.uid)),
    el('p', { class: 'note' }, 'For a forgotten clock-out, or a shift recorded at the wrong time. ' +
      'Clearing the end time puts the person back on shift.'),
    el('label', {}, 'Clocked in'), cin,
    el('label', {}, 'Clocked out'), cout,
    el('label', {}, 'Note'), note,
    save, status,
  ]);
}
