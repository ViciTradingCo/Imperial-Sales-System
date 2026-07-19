/**
 * Company List (admin) — every registered company. Each has:
 *   • Edit — a focus modal to rename the company (propagated everywhere).
 *   • Subscription — its own focus modal to set when the subscription expires
 *     (calendar picker OR manual entry) or mark it Perpetual.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';

export function renderCompanies(container) {
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading companies…'));
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Company List'),
    el('p', { class: 'note' }, 'Every registered business. Edit renames a company; Subscription sets its certification.'),
    listHost,
  ]));

  function load() {
    api.getCompanies()
      .then((res) => renderList(res.companies || []))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function renderList(companies) {
    if (!companies.length) { mount(listHost, el('p', { class: 'note' }, 'No companies yet.')); return; }
    mount(listHost, ...companies.map((c) => {
      const sub = c.perpetual ? 'Perpetual' : (c.until ? 'until ' + c.until : 'no subscription');
      const statusCls = String(c.status).toUpperCase() === 'VALID' ? 'ok' : 'bad';
      return el('div', { class: 'member-row' }, [
        el('p', { html:
          '<b>' + esc(c.business || '—') + '</b> · <span class="' + statusCls + '">' + esc(c.status || '—') + '</span><br>' +
          '<span class="note">' + esc(sub) + (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openNameModal(c, load) }, 'Edit'),
          el('button.secondary-btn.small', { onclick: () => openSubscriptionModal(c, load) }, 'Subscription'),
        ]),
      ]);
    }));
  }

  load();
}

/** Rename modal. */
function openNameModal(company, onSaved) {
  const name = el('input', { type: 'text', value: company.business || '' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    const newName = name.value.trim();
    if (!newName) { setStatus('Company name is required.', 'error'); return; }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      // Preserve the current subscription while renaming.
      await api.updateCompany({ id: company.id, name: newName, until: company.until, perpetual: company.perpetual });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Edit company'),
    el('label', {}, 'Company name'),
    name,
    el('p', { class: 'note' }, 'Renaming updates the company everywhere — its shop, staff, and records.'),
    save,
    status,
  ]);
}

/** Subscription modal — calendar picker or manual entry, plus Perpetual. */
function openSubscriptionModal(company, onSaved) {
  const perpetual = el('input', { type: 'checkbox' });
  perpetual.checked = !!company.perpetual;

  const picker = el('input', { type: 'date', value: company.until || '', class: 'date-picker' });
  const manual = el('input', { type: 'text', placeholder: 'YYYY-MM-DD', value: company.until || '' });

  // On desktop the native calendar only opens from the tiny icon, so make a
  // click anywhere on the field pop it. On touch devices the OS already opens
  // the calendar on tap — calling showPicker() there fights the native picker,
  // so we leave mobile to its built-in behaviour.
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!isTouch) {
    picker.addEventListener('click', () => { try { picker.showPicker(); } catch (e) { /* older browsers */ } });
  }

  // Keep the calendar picker and the manual field in sync.
  picker.addEventListener('input', () => { manual.value = picker.value; });
  manual.addEventListener('input', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(manual.value.trim())) picker.value = manual.value.trim();
  });

  function syncDisabled() {
    const off = perpetual.checked;
    picker.disabled = off;
    manual.disabled = off;
  }
  perpetual.addEventListener('change', syncDisabled);
  syncDisabled();

  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    const perp = perpetual.checked;
    const until = perp ? '' : (picker.value || manual.value.trim());
    if (!perp && until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      setStatus('Enter the date as YYYY-MM-DD, or use the calendar.', 'error');
      return;
    }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      // Keep the current name; only the subscription changes here.
      await api.updateCompany({ id: company.id, name: company.business, until, perpetual: perp });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Subscription — ' + (company.business || '')),
    el('label', { class: 'inline' }, [perpetual, document.createTextNode(' Perpetual (never expires)')]),
    el('label', {}, 'Expires — pick from the calendar'),
    picker,
    el('label', {}, '…or type it (YYYY-MM-DD)'),
    manual,
    save,
    status,
  ]);
}
