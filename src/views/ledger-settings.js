/**
 * Owner Ledger Settings page — the company name plus per-shop tunables. Scoped
 * to the caller's business by the API. Full ledger management (inventory,
 * discounts, employees, style) arrives in a later phase.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { renderSettingsForm } from './settings-form.js';

export function renderLedgerSettings(container, { me, onBusinessRenamed }) {
  const formHost = el('div', {});
  mount(container,
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    companyCard(me, onBusinessRenamed),
    formHost,
  );

  renderSettingsForm(formHost, {
    title: 'Shop settings',
    subtitle: 'Settings for your shop. These apply only to your business. ' +
      'Full ledger management (inventory, discounts, employees, style) arrives in a later phase.',
    load: async () => (await api.getLedgerSettings()).settings,
    save: async (updates) => (await api.saveLedgerSettings(updates)).settings,
    back: false,
  });
}

function companyCard(me, onBusinessRenamed) {
  const input = el('input', { type: 'text', value: me.business || '', placeholder: 'Company name' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save company name');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doSave() {
    const name = input.value.trim();
    if (!name) { setStatus('Enter a company name.', 'error'); return; }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      const updated = await api.renameBusiness(name);
      setStatus('Saved ✓', 'ok');
      save.disabled = false;
      if (onBusinessRenamed) onBusinessRenamed(updated);
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  return el('div.card', {}, [
    el('h2', {}, 'Company'),
    el('label', {}, 'Company name'),
    input,
    el('p', { class: 'note' }, 'Renaming updates it everywhere — your shop, your staff, and the registry.'),
    save,
    status,
  ]);
}
