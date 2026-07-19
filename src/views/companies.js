/**
 * Company List (admin) — every registered company, with an Edit focus modal to
 * change the name and set when the subscription expires (or make it perpetual).
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
    el('p', { class: 'note' }, 'Every registered business. Edit a company to rename it or set its subscription.'),
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
      const row = el('div', { class: 'member-row' }, [
        el('p', { html:
          '<b>' + esc(c.business || '—') + '</b> · <span class="' + statusCls + '">' + esc(c.status || '—') + '</span><br>' +
          '<span class="note">' + esc(sub) + (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' }),
        el('button.primary.small', { onclick: () => openEditModal(c, load) }, 'Edit'),
      ]);
      return row;
    }));
  }

  load();
}

function openEditModal(company, onSaved) {
  const name = el('input', { type: 'text', value: company.business || '' });
  const until = el('input', { type: 'date', value: company.until || '' });
  const perpetual = el('input', { type: 'checkbox' });
  perpetual.checked = !!company.perpetual;
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  // When perpetual is ticked the date is irrelevant.
  function syncDisabled() { until.disabled = perpetual.checked; }
  perpetual.addEventListener('change', syncDisabled);
  syncDisabled();

  let modal;
  async function doSave() {
    const newName = name.value.trim();
    if (!newName) { setStatus('Company name is required.', 'error'); return; }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.updateCompany({
        id: company.id,
        name: newName,
        until: until.value,
        perpetual: perpetual.checked,
      });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Edit company'),
    el('label', {}, 'Company name'), name,
    el('label', { class: 'inline' }, [perpetual, document.createTextNode(' Perpetual (never expires)')]),
    el('label', {}, 'Subscription expires'), until,
    el('p', { class: 'note' }, 'Renaming updates the company everywhere — its shop, staff, and records.'),
    save,
    status,
  ]);
}
