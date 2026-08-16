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
import { backToHome } from '../lib/sections.js';
import { canManage } from '../lib/roles.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { skeletonRows } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';
import { openModal } from '../lib/modal.js';

/**
 * How this person is paid, in one line.
 *
 * Either half may stand alone — a shop can pay by the hour, on results, or
 * both — so this says what is actually set rather than assuming an hourly rate
 * exists and calling its absence an error.
 */
function terms(rate, commissionRate) {
  const parts = [];
  if (rate) parts.push(money(rate) + ' an hour');
  if (commissionRate) parts.push(commissionRate + '% of what you sell');
  if (!parts.length) {
    return 'No pay set — ask your owner to set an hourly rate, a commission, or both, or your work is ' +
      'worth nothing on the log.';
  }
  return 'You are paid ' + parts.join(' and ') + '.';
}

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
  const isOwner = canManage(me); // the shop's log; a manager keeps it too
  let tileImages = {};

  const sections = [
    { key: 'tc-mine', label: 'My time card', hint: 'Clock in & out', glyph: '⏱️',
      open: (host) => renderMine(host) },
    isOwner ? { key: 'tc-log', label: 'Shift log', hint: 'Hours & wages owed', glyph: '📋',
      open: (host) => renderLog(host) } : null,
  ].filter(Boolean);

  function draw() {
    mount(container, el('div.card', {}, [
      backToHome(),
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
    const comm = d.commission || { owed: 0, sales: 0 };

    mount(body,
      el('div.card', { class: 'card ' + (open ? 'shift-open' : '') }, [
        el('h3', {}, open ? '⏱️ On shift' : 'Not clocked in'),
        el('p', { class: 'note' }, open
          ? 'Since ' + when(open.clockIn) + ' · ' + hm(open.hours) + ' so far.'
          : 'Clock in when you start work.'),
        el('p', { class: 'note' }, terms(rate, d.commissionRate)),
        action,
      ]),
      // Their own two halves, the same way the owner's log breaks them out.
      // Commission only appears once there is a rate for it, so someone on a
      // flat wage sees exactly what they saw before.
      statTiles([
        ['Unpaid hours', hm(owedHours)],
        ['Hourly owed', money(owed.reduce((n, s) => n + s.pay, 0))],
        ...(comm.owed || d.commissionRate ? [['Commission owed', money(comm.owed || 0)]] : []),
        ...(comm.owed ? [['Total owed', money(owed.reduce((n, s) => n + s.pay, 0) + comm.owed)]] : []),
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

  /**
   * Clocking on or off changes what the floating shift bar should say, and the
   * shell is what draws it — so the shell is told, rather than this page being
   * given a second way to reach it. Same event the transfer screens already use.
   */
  const shellRecheck = () => window.dispatchEvent(new Event('eec:banners'));

  async function doIn() {
    try { await api.clockIn(); toast('Clocked in.', 'ok'); load(); shellRecheck(); }
    catch (e) { toast(e.message || String(e), 'error'); }
  }
  async function doOut() {
    const note = window.prompt('Anything to note about this shift? (optional)') || '';
    try { await api.clockOut(note); toast('Clocked out.', 'ok'); load(); shellRecheck(); }
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
      // The three figures broken out, not just the total. An owner settling a
      // payout has to be able to see WHERE it came from — a number that is
      // hours plus commission and says neither is a number you cannot check.
      // The commission tile is only shown once some exists, so a shop that
      // pays a flat wage is not carrying a column of zeroes.
      statTiles([
        ['Hours logged', hm(t.hours)],
        ['Hourly owed', money(t.owedHourly || 0)],
        ...(t.owedCommission ? [['Commission owed', money(t.owedCommission)]] : []),
        ['Total payout', money(t.owed)],
        ['On shift now', String(t.open || 0)],
      ]),
      el('p', { class: 'note' }, 'Marking a payout paid records that it happened — it does not move coin. ' +
        'Pay from your coffer however your shop actually pays people. Settling somebody settles both ' +
        'halves of what they are owed, the hours and the commission together.'),

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

  /**
   * One person's payout, itemised: Hourly = X, Commission = Y, Total = Z.
   *
   * The breakdown is spelled out whenever there IS a commission, and left off
   * entirely when there is not — a shop paying a flat wage should see the same
   * single figure it always saw, not a sum with a zero in it.
   */
  function personRow(p) {
    const worked = hm(p.hours) + ' logged · ' + hm(p.owedHours) + ' unpaid' +
      (p.rate ? ' · rate ' + money(p.rate) : '');
    const split = p.owedCommission
      ? '<br><span class="note">Hourly ' + esc(money(p.owedHourly)) +
        ' · Commission ' + esc(money(p.owedCommission)) +
        ' on ' + esc(String(p.commissionSales)) + (p.commissionSales === 1 ? ' sale' : ' sales') + '</span>'
      : '';
    const row = el('div.emp-row', {}, [
      el('span', { class: 'emp-who', html:
        '<b>' + esc(p.employee || p.uid) + '</b>' + (p.open ? ' <span class="pill warn">ON SHIFT</span>' : '') +
        '<br><span class="note">' + esc(worked) + '</span>' + split }),
      el('span', { html: '<b>' + esc(money(p.owed)) + '</b>' }),
    ]);
    if (p.owed > 0) {
      row.appendChild(el('span', { class: 'row-actions' }, [
        el('button.primary.small', {
          onclick: async () => {
            const parts = p.owedCommission
              ? ' (' + money(p.owedHourly) + ' hourly + ' + money(p.owedCommission) + ' commission)'
              : '';
            if (!confirm('Mark ' + money(p.owed) + parts + ' as paid to ' + (p.employee || p.uid) + '?\n\n' +
              'This records the payout as settled. It does NOT move coin out of your coffer — ' +
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
