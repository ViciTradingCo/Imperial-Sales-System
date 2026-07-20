/**
 * Admin-only Network Settings page — the whole-network Master Settings (sync
 * cadence + market anomaly thresholds), plus a maintenance action to clear the
 * transactional logs. The API enforces admin-only access.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';
import { setAdminActions } from '../lib/sections.js';

export function renderAdminSettings(container) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const formHost = el('div', {});
  const holdsHost = el('div', {});
  const dangerHost = el('div', {});
  mount(container, formHost, holdsHost, dangerHost);

  renderSettingsForm(formHost, {
    title: 'Network Settings',
    subtitle: 'Network-wide settings for the whole East Empire network, saved to the Core ' +
      'and applied on the next sync.',
    load: async () => (await api.getSettings()).settings,
    save: async (updates) => (await api.saveSettings(updates)).settings,
  });

  mount(holdsHost, holdsCard());
  mount(dangerHost, clearLogsCard());
}

/** Editor for the network hold index (one hold per line). */
function holdsCard() {
  const box = el('textarea', { rows: '10' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save holds');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  api.getHolds().then((r) => { box.value = (r.holds || []).join('\n'); }).catch(() => {});

  async function doSave() {
    const holds = box.value.split('\n').map((h) => h.trim()).filter(Boolean);
    save.disabled = true; setStatus('Saving…', '');
    try {
      const r = await api.setHolds(holds);
      box.value = (r.holds || []).join('\n');
      setStatus('Saved ✓ — ' + (r.holds || []).length + ' holds.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Holds'),
    el('p', { class: 'note' }, 'The network’s hold names, one per line, in order. Used by every hold dropdown.'),
    box,
    save,
    status,
  ]);
}

/** Danger-zone card: wipe the sales + intake logs across the whole network. */
function clearLogsCard() {
  const status = el('p', {});
  const btn = el('button.danger', { onclick: doClear }, 'Clear all logs');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doClear() {
    if (!window.confirm('Clear ALL sales and intake logs for every shop in the network?\n\n' +
      'This permanently deletes the transaction history (Market Analysis resets to zero). ' +
      'Inventory catalogs are kept. This cannot be undone.')) return;
    btn.disabled = true;
    setStatus('Clearing…', '');
    try {
      const r = await api.clearLogs();
      setStatus('Cleared ' + (r.sales || 0) + ' sales and ' + (r.intake || 0) + ' intake records.', 'ok');
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Clear logs'),
    el('p', { class: 'note' }, 'Wipes every shop’s sales and intake history (used to start a fresh ' +
      'season). Inventory catalogs are kept. This can’t be undone.'),
    btn,
    status,
  ]);
}
