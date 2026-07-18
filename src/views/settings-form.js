/**
 * Shared schema-driven settings form. Both the admin Network Settings and the
 * owner Ledger Settings pages are the same shape — a list of validated numeric
 * fields with a Save button — so they share this renderer.
 *
 *   load() → Promise<[{ label, value, notes, kind, min, max }]>
 *   save(updates) → Promise<same shape>   (updates = [{ label, value }])
 */
import { el, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';

export function renderSettingsForm(container, { title, subtitle, load, save }) {
  const status = el('p', {});
  const fields = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, title),
    el('p', { class: 'note' }, subtitle),
    fields,
    status,
  ]));

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
    wrap.appendChild(el('button.primary', { onclick: doSave }, 'Save'));
    mount(fields, wrap);
  }

  async function doLoad() {
    try { SETTINGS = (await load()) || []; renderFields(); }
    catch (e) { mount(fields, el('p', { class: 'error' }, e.message || String(e))); }
  }

  async function doSave(ev) {
    const btn = ev.currentTarget;
    const updates = Array.from(fields.querySelectorAll('input[data-label]')).map((i) => ({
      label: i.getAttribute('data-label'),
      value: i.value,
    }));
    btn.disabled = true;
    setStatus('Saving…', '');
    try {
      SETTINGS = (await save(updates)) || SETTINGS;
      renderFields();
      setStatus('Saved ✓', 'ok');
    } catch (e) {
      btn.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  doLoad();
}
