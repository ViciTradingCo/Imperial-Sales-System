/**
 * Admin-only Master Settings page. Lets an admin tune the network's sync cadence
 * and market anomaly thresholds from the app instead of editing the Core sheet.
 * The API enforces admin-only access; this view just presents and saves.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';

export function renderAdminSettings(container) {
  const status = el('p', { id: 'setStatus' });
  const fields = el('div', {}, el('p', { class: 'note' }, 'Loading settings…'));

  const card = el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Network Settings'),
    el('p', { class: 'note' }, 'The Master Settings for the whole East Empire network. ' +
      'Saved straight to the Core — every shop and the market analysis pick these up on their next sync.'),
    fields,
    status,
  ]);
  mount(container, card);

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let SETTINGS = [];

  function renderFields() {
    const wrap = el('div', {});
    SETTINGS.forEach((s) => {
      const input = el('input', {
        type: 'number',
        value: String(s.value),
        step: s.kind === 'float' ? '0.05' : '1',
        'data-label': s.label,
      });
      if (s.min != null) input.min = String(s.min);
      if (s.max != null) input.max = String(s.max);
      wrap.appendChild(el('div.field', {}, [
        el('label', {}, s.label),
        input,
        el('p', { class: 'note' }, s.notes || ''),
      ]));
    });
    wrap.appendChild(el('button.primary', { onclick: save }, 'Save settings'));
    mount(fields, wrap);
  }

  async function load() {
    try {
      const res = await api.getSettings();
      SETTINGS = res.settings || [];
      renderFields();
    } catch (e) {
      mount(fields, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  async function save(ev) {
    const btn = ev.currentTarget;
    const updates = Array.from(fields.querySelectorAll('input[data-label]')).map((i) => ({
      label: i.getAttribute('data-label'),
      value: i.value,
    }));
    btn.disabled = true;
    setStatus('Saving…', '');
    try {
      const res = await api.saveSettings(updates);
      SETTINGS = res.settings || SETTINGS;
      renderFields();
      setStatus('Saved ✓', 'ok');
    } catch (e) {
      btn.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  load();
}
