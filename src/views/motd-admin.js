/**
 * Messages of the Day (admin). Three parts:
 *   • Global message — one banner shown to everyone on Home.
 *   • Expiry warning — how many days before a subscription lapses to auto-warn
 *     that business's owner/employees (a banner that persists on every page).
 *   • Individual messages — per-business notices, optionally scheduled with a
 *     start and end, managed in a focus modal.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';

export function renderMotdAdmin(container) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const globalHost = el('div', {});
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  let companies = [];

  mount(container,
    el('div.card', {}, [
      el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
      el('h2', {}, 'MOTD'),
      el('p', { class: 'note' }, 'Post a notice for everyone, schedule per-business messages, and tune the subscription-expiry warning.'),
    ]),
    globalHost,
    el('div.card', {}, [
      el('h3', {}, 'Individual messages'),
      el('p', { class: 'note' }, 'Per-business notices, optionally scheduled with a start and end. Shown on that business’s Home while active.'),
      el('button.primary', { onclick: () => openEntryModal(null) }, 'Add message'),
      listHost,
    ]),
  );

  function load() {
    Promise.all([api.getMotdConfig(), api.getCompanies()])
      .then(([cfg, cs]) => {
        companies = (cs.companies || []).map((c) => c.business).filter(Boolean);
        mount(globalHost, globalCard(cfg), warnCard(cfg));
        renderList(cfg.individual || []);
      })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function renderList(items) {
    if (!items.length) { mount(listHost, el('p', { class: 'note' }, 'No individual messages yet.')); return; }
    mount(listHost, ...items.map((m) => el('div', { class: 'member-row' }, [
      el('p', { html:
        '<b>' + esc(m.business || '—') + '</b><br>' +
        '<span class="note">' + esc(m.message) + '</span><br>' +
        '<span class="note">' + esc(windowLabel(m)) + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => openEntryModal(m) }, 'Edit'),
        el('button.danger.small', { onclick: () => remove(m) }, 'Delete'),
      ]),
    ])));
  }

  async function remove(m) {
    if (!window.confirm('Delete this message for ' + (m.business || 'this business') + '?')) return;
    try { renderList((await api.deleteIndividualMotd(m.id)).individual || []); }
    catch (e) { alert(e.message || e); }
  }

  function openEntryModal(entry) {
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
      if (!biz.value) { setStatus('Pick a business.', 'error'); return; }
      if (!message.value.trim()) { setStatus('Enter a message.', 'error'); return; }
      submit.disabled = true;
      setStatus('Saving…', '');
      const payload = { business: biz.value, message: message.value.trim(), start: toIso(start.value), end: toIso(end.value) };
      try {
        const res = isEdit
          ? await api.updateIndividualMotd({ id: entry.id, ...payload })
          : await api.addIndividualMotd(payload);
        renderList(res.individual || []);
        modal.close();
      } catch (e) {
        submit.disabled = false;
        setStatus(e.message || String(e), 'error');
      }
    }

    modal = openModal([
      el('h3', {}, isEdit ? 'Edit message' : 'New message'),
      el('label', {}, 'Business'), biz,
      el('label', {}, 'Message'), message,
      el('label', {}, 'Starts appearing (optional)'), start,
      el('label', {}, 'Stops appearing (optional)'), end,
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

/* ---- global + warn cards ---- */
function globalCard(cfg) {
  const box = el('textarea', { rows: '3', placeholder: 'A notice shown to everyone on their Home page…' });
  box.value = (cfg && cfg.motd) || '';
  const status = el('p', {});
  const save = el('button.primary', { onclick: () => doSave() }, 'Save message');
  const clear = el('button.secondary-btn', { onclick: () => { box.value = ''; doSave(); } }, 'Clear');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }
  async function doSave() {
    save.disabled = true; setStatus('Saving…', '');
    try { await api.setMotd(box.value.trim()); setStatus('Saved ✓', 'ok'); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }
  return el('div.card', {}, [
    el('h3', {}, 'Global message'),
    el('p', { class: 'note' }, 'Shown to everyone on Home. Leave blank (or Clear) to hide it.'),
    box,
    el('div', { class: 'row-actions' }, [save, clear]),
    status,
  ]);
}

function warnCard(cfg) {
  const days = el('input', { type: 'number', min: '0', step: '1', value: String((cfg && cfg.warnDays != null) ? cfg.warnDays : 7) });
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
