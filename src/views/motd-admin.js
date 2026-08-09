/**
 * Messages of the Day (admin). Three parts:
 *   • Global notices — shown to everyone on Home. A LIST: several can run at
 *     once, each with its own schedule, each editable and removable. It used to
 *     be a single box that could only be overwritten or cleared, so there was
 *     no record of what was announced and no way to take one notice down
 *     without retyping the others.
 *   • Individual messages — per-business notices, optionally scheduled.
 *   • Expiry warning — how many days before a subscription lapses to auto-warn
 *     that business's owner/employees (a banner that persists on every page).
 *
 * Both kinds of notice are the SAME editor, differing only in whether a
 * business is chosen — they are the same thing to write and the same thing to
 * schedule, and two editors would have drifted.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';

export function renderMotdAdmin(container) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const globalHost = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  let companies = [];

  const gridHost = el('div', {});
  let cfg = null;

  mount(container,
    el('div.card', {}, [
      el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
      el('h2', {}, 'MOTD'),
      el('p', { class: 'note' }, 'Post a notice for everyone, schedule per-business messages, and tune the ' +
        'subscription-expiry warning. Pick a section to open it.'),
      gridHost,
    ]));

  const sections = [
    { key: 'motd-global', label: 'Global notices', hint: 'Shown to everyone', glyph: '📣',
      open: (host) => mount(host, el('div.card', {}, [
        el('h3', {}, 'Global notices'),
        el('p', { class: 'note' }, 'Shown to everyone on Home. Post as many as you need — each can be ' +
          'scheduled, edited and taken down on its own.'),
        el('button.primary', { onclick: () => openEntryModal(null, { global: true }) }, 'Post a notice'),
        globalHost,
      ])) },
    { key: 'motd-individual', label: 'Individual messages', hint: 'Per-business, scheduled', glyph: '✉️',
      open: (host) => mount(host, el('div.card', {}, [
        el('h3', {}, 'Individual messages'),
        el('p', { class: 'note' }, 'Per-business notices, optionally scheduled with a start and end. Shown on ' +
          'that business’s Home while active.'),
        el('button.primary', { onclick: () => openEntryModal(null) }, 'Add message'),
        listHost,
      ])) },
    { key: 'motd-warn', label: 'Expiry warning', hint: 'Certification lead time', glyph: '⏳',
      open: (host) => mount(host, warnCard(cfg || {})) },
  ];

  function drawTiles(images) {
    mount(gridHost, tileGrid(sectionTiles(sections, navigate), images));
  }
  drawTiles({});
  api.getTiles().then((r) => drawTiles(r.images || {})).catch(() => {});

  function load() {
    Promise.all([api.getMotdConfig(), api.getCompanies()])
      .then(([config, cs]) => {
        cfg = config;
        companies = (cs.companies || []).map((c) => c.business).filter(Boolean);
        renderList(cfg.individual || []);
        renderGlobal(cfg.global || []);
      })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  /**
   * One notice, as a row.
   *
   * The schedule is on the row rather than behind the Edit button, because
   * "which of these is actually showing right now" is the question this page is
   * open to answer.
   */
  function noticeRow(m, { global }) {
    return el('div', { class: 'member-row' }, [
      el('p', { html:
        (global ? '' : '<b>' + esc(m.business || '—') + '</b><br>') +
        esc(m.message) + '<br>' +
        '<span class="note">' + esc(windowLabel(m)) + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => openEntryModal(m, { global }) }, 'Edit'),
        el('button.danger.small', { onclick: () => remove(m, { global }) }, 'Delete'),
      ]),
    ]);
  }

  function renderGlobal(items) {
    if (!items.length) {
      mount(globalHost, el('p', { class: 'note' }, 'Nothing posted to everyone right now.'));
      return;
    }
    mount(globalHost, ...items.map((m) => noticeRow(m, { global: true })));
  }

  function renderList(items) {
    if (!items.length) { mount(listHost, el('p', { class: 'note' }, 'No individual messages yet.')); return; }
    mount(listHost, ...items.map((m) => noticeRow(m, { global: false })));
  }

  async function remove(m, { global }) {
    if (!window.confirm(global
      ? 'Take this notice down for everyone?'
      : 'Delete this message for ' + (m.business || 'this business') + '?')) return;
    try {
      if (global) renderGlobal((await api.deleteGlobalMotd(m.id)).global || []);
      else renderList((await api.deleteIndividualMotd(m.id)).individual || []);
    } catch (e) { alert(e.message || e); }
  }

  /**
   * Write or edit one notice. `global` decides whether it asks who it is for —
   * everything else about a notice is the same either way.
   */
  function openEntryModal(entry, how) {
    const global = !!(how && how.global);
    const isEdit = !!entry;
    const biz = el('select', {});
    biz.appendChild(el('option', { value: '' }, 'Pick a business…'));
    const opts = entry && !companies.includes(entry.business) ? [entry.business, ...companies] : companies;
    opts.forEach((b) => {
      const o = el('option', { value: b }, b);
      if (entry && b === entry.business) o.selected = true;
      biz.appendChild(o);
    });
    const message = el('textarea', { rows: '3', placeholder: 'Message for this business…' });
    message.value = entry ? entry.message : '';
    // Stored as ISO (UTC); the datetime-local input works in the admin's local
    // time, so convert both ways to keep the schedule correct across zones.
    const start = el('input', { type: 'datetime-local', value: entry ? toLocalInput(entry.start) : '' });
    const end = el('input', { type: 'datetime-local', value: entry ? toLocalInput(entry.end) : '' });
    const status = el('p', {});
    const submit = el('button.primary', { onclick: doSubmit }, isEdit ? 'Save changes' : 'Submit');
    function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

    let modal;
    async function doSubmit() {
      if (!global && !biz.value) { setStatus('Pick a business.', 'error'); return; }
      if (!message.value.trim()) { setStatus('Enter a message.', 'error'); return; }
      submit.disabled = true;
      setStatus('Saving…', '');
      const payload = { message: message.value.trim(), start: toIso(start.value), end: toIso(end.value) };
      try {
        if (global) {
          const res = isEdit
            ? await api.updateGlobalMotd({ id: entry.id, ...payload })
            : await api.addGlobalMotd(payload);
          renderGlobal(res.global || []);
        } else {
          const res = isEdit
            ? await api.updateIndividualMotd({ id: entry.id, business: biz.value, ...payload })
            : await api.addIndividualMotd({ business: biz.value, ...payload });
          renderList(res.individual || []);
        }
        modal.close();
      } catch (e) {
        submit.disabled = false;
        setStatus(e.message || String(e), 'error');
      }
    }

    modal = openModal([
      el('h3', {}, (isEdit ? 'Edit ' : 'New ') + (global ? 'global notice' : 'message')),
      ...(global
        ? [el('p', { class: 'note' }, 'Everyone on this realm sees this on their Home page.')]
        : [el('label', {}, 'Business'), biz]),
      el('label', {}, 'Message'), message,
      el('label', {}, 'Starts appearing (optional)'), start,
      el('label', {}, 'Stops appearing (optional)'), end,
      el('p', { class: 'note' }, 'Leave both blank to show it from now until you take it down.'),
      submit,
      status,
    ]);
  }

  load();
}

function windowLabel(m) {
  if (!m.start && !m.end) return 'Always showing';
  return 'From ' + (fmt(m.start) || 'now') + ' to ' + (fmt(m.end) || 'no end');
}
function fmt(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}
/** ISO (UTC) → the local value a datetime-local input expects. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/** A datetime-local value (local time) → ISO (UTC) for storage. */
function toIso(local) {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/* ---- the expiry-warning card ---- */
function warnCard(cfg) {
  // No local default: the server owns it, and hardcoding one here would show a
  // number that disagrees with what the banner actually uses.
  const days = el('input', { type: 'number', min: '0', step: '1',
    value: (cfg && cfg.warnDays != null) ? String(cfg.warnDays) : '' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save' );
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }
  async function doSave() {
    save.disabled = true; setStatus('Saving…', '');
    try { const r = await api.setWarnDays(days.value); days.value = String(r.warnDays); setStatus('Saved ✓', 'ok'); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }
  return el('div.card', {}, [
    el('h3', {}, 'Subscription-expiry warning'),
    el('p', { class: 'note' }, 'Auto-warn a business’s owner and employees this many days before their ' +
      'certification expires. The warning shows on every page until they renew.'),
    el('label', {}, 'Days before expiry'), days,
    save,
    status,
  ]);
}
