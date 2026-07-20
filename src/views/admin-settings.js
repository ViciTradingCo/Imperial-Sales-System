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
  const motdHost = el('div', {});
  const dangerHost = el('div', {});
  mount(container, formHost, motdHost, dangerHost);

  renderSettingsForm(formHost, {
    title: 'Network Settings',
    subtitle: 'Network-wide settings for the whole East Empire network, saved to the Core ' +
      'and applied on the next sync.',
    load: async () => (await api.getSettings()).settings,
    save: async (updates) => (await api.saveSettings(updates)).settings,
  });

  mount(motdHost, motdCard());
  mount(dangerHost, clearLogsCard());
}

/** Editor for the message of the day (shown to everyone on Home). */
function motdCard() {
  const box = el('textarea', { rows: '3', placeholder: 'A notice shown to everyone on their Home page…' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save message');
  const clear = el('button.secondary-btn', { onclick: () => { box.value = ''; doSave(); } }, 'Clear');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  api.getMotd().then((r) => { box.value = (r && r.motd) || ''; }).catch(() => {});

  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.setMotd(box.value.trim());
      setStatus('Saved ✓', 'ok');
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      save.disabled = false;
    }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Message of the day'),
    el('p', { class: 'note' }, 'Shown as a notice on everyone’s Home page. Leave blank (or Clear) to hide it.'),
    box,
    el('div', { class: 'row-actions' }, [save, clear]),
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
