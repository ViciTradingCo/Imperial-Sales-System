/**
 * Profile page — replaces the static identity card with something editable.
 * Two sections:
 *   • Profile   — the user's character name (saved to the server) plus their
 *                 read-only registry facts (business, role, status, UID, email).
 *   • Appearance — GUI theme + accent colour, stored client-side and applied live.
 *
 * Signing out is NOT here: it already sits by the nameplate on desktop and at
 * the bottom of the drawer on mobile, and a third copy buried behind a tile was
 * the least discoverable of the three.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { THEMES, TEXT_SIZES, loadPrefs, savePrefs, resolveTheme, resolveText } from '../lib/theme.js';
import { LANGS, getLang, setLang } from '../lib/i18n.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';

export function renderProfile(container, { me, onProfileUpdated }) {
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Profile'),
    el('p', { class: 'note' }, 'Your character, how the app looks, and signing out. Pick a section to open it.'),
    gridHost,
  ]));

  const sections = [
    { key: 'prof-identity', label: 'Character', hint: 'Name & registry facts', glyph: '🪪',
      open: (host) => mount(host, profileCard(me, onProfileUpdated)) },
    { key: 'prof-appearance', label: 'Appearance', hint: 'Theme, accent, language', glyph: '🎨',
      open: (host) => mount(host, appearanceCard()) },
  ];

  function draw(images) {
    mount(gridHost, tileGrid(sectionTiles(sections, navigate), images));
  }
  draw({});
  api.getTiles().then((r) => draw(r.images || {})).catch(() => {});
}

function profileCard(me, onProfileUpdated) {
  const status = el('p', {});
  const charInput = el('input', { type: 'text', value: me.character || '', placeholder: 'Your character name' });
  const save = el('button.primary', { onclick: doSave }, 'Save profile');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doSave() {
    const character = charInput.value.trim();
    if (!character) { setStatus("Your character name can't be empty.", 'error'); return; }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      const updated = await api.updateProfile(character);
      setStatus('Saved ✓', 'ok');
      save.disabled = false;
      if (onProfileUpdated) onProfileUpdated(updated);
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  return el('div.card', {}, [
    el('h2', {}, 'Profile'),
    el('label', {}, 'Character name'),
    charInput,
    el('p', { class: 'note' }, 'Your in-character name — shown to the Company and your shop.'),
    save,
    status,
    el('div', { class: 'readonly-facts' }, [
      factRow('Business', me.business || '—'),
      factRow('Role', me.role),
      factRow('Status', me.status),
      factRow('Email', me.email || '—'),
      factRow('UID', me.uid),
    ]),
  ]);
}

function factRow(label, value) {
  return el('div.fact', {}, [
    el('span', { class: 'fact-label' }, label),
    el('span', { class: 'fact-value', html: '<code>' + esc(value) + '</code>' }),
  ]);
}

function appearanceCard() {
  const prefs = loadPrefs();

  // Through resolveTheme, so a surface stored under its old name shows the one
  // it actually became rather than falling back to the first in the list.
  const current = resolveTheme(prefs.theme);
  const themeSel = el('select', {});
  Object.keys(THEMES).forEach((key) => {
    const t = THEMES[key];
    const opt = el('option', { value: key }, t.label + (t.hint ? ' — ' + t.hint : ''));
    if (key === current) opt.selected = true;
    themeSel.appendChild(opt);
  });
  themeSel.addEventListener('change', () => savePrefs({ theme: themeSel.value }));

  // Text size. Applies live rather than on a save button — the thing you are
  // judging is the size of the words in front of you, so you have to see it.
  const currentText = resolveText(prefs.text);
  const textSel = el('select', {});
  Object.keys(TEXT_SIZES).forEach((key) => {
    const opt = el('option', { value: key }, TEXT_SIZES[key].label);
    if (key === currentText) opt.selected = true;
    textSel.appendChild(opt);
  });
  textSel.addEventListener('change', () => savePrefs({ text: textSel.value }));

  // Language — swaps the interface language for this device. Reloads so every
  // surface re-renders cleanly in the new language.
  const langSel = el('select', {});
  Object.keys(LANGS).forEach((code) => {
    const opt = el('option', { value: code }, LANGS[code]);
    if (code === getLang()) opt.selected = true;
    langSel.appendChild(opt);
  });
  langSel.addEventListener('change', () => { setLang(langSel.value); location.reload(); });

  return el('div.card', {}, [
    el('h2', {}, 'Appearance'),
    el('p', { class: 'note' }, 'What the ledger is written on, and the language it is written in. ' +
      'Both are for this device only.'),
    el('label', {}, 'Surface'),
    themeSel,
    el('p', { class: 'note' }, 'The writing stays the same; the page under it changes.'),
    el('label', {}, 'Text size'),
    textSel,
    el('p', { class: 'note' }, 'Sets the writing, the figures and the ruled lines together, so the ' +
      'entries still sit on the lines.'),
    el('label', {}, 'Language'),
    langSel,
    el('p', { class: 'note' }, 'Translations cover the interface; names and some ' +
      'messages stay as written.'),
  ]);
}
