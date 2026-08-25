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
import { LANGS, getLang, setLang, deviceLang } from '../lib/i18n.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { signOut } from '../lib/auth.js';
import { money } from '../lib/format.js';
import { businessesPanel, reloadAsNewBusiness } from '../lib/businesses.js';

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
  /**
   * Your shops. Not gated: everyone has at least one, and this is where a
   * person with one adds their second — the nav's switcher only appears once
   * there is something to switch between.
   */
  sections.push({ key: 'prof-businesses', label: 'Your businesses', hint: 'Switch or add one', glyph: '🏪',
    open: (host) => mount(host, businessesPanel(me, reloadAsNewBusiness)) });

  // Leaving is YOUR OWN decision about your own account, so it belongs on your
  // own page — but only where there is something to leave. An owner has no
  // shop to walk away from (it would leave the shop with nobody running it) and
  // an admin was never in one.
  if (me.business && me.role !== 'owner' && !me.isOwner && me.role !== 'admin') {
    sections.push({ key: 'prof-leave', label: 'Leave your shop', hint: 'Stop working here', glyph: '🚪',
      open: (host) => mount(host, leaveCard(me)) });
  }

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

  // Language — the DEVICE'S by default, and this only overrules it. Reloads so
  // every surface re-renders cleanly, dates included: the words and the figures
  // read one setting, so the page can never be half in one language.
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
    el('p', { class: 'note' }, 'Starts as whatever your device asks for — ' + LANGS[deviceLang()] +
      ', here — and this changes it for this device only. Dates follow it too, so the page is never ' +
      'part in one language and part in another. Translations cover the interface; names and some ' +
      'messages stay as written.'),
  ]);
}

/**
 * LEAVING THE SHOP YOU WORK FOR.
 *
 * The reassurance comes first and the button last, because the question anyone
 * hesitates over is "do I lose what I am owed?" — and the answer is no. Their
 * shifts and their sales carry the shop on the row, so the debt stays on the
 * owner's log to be settled whether they are still employed there or not.
 *
 * What leaving actually does is end their MEMBERSHIP. They are unregistered
 * again, which is the state the app already knows how to handle: the way back
 * is a staff code, exactly as it was the first time.
 */
function leaveCard(me) {
  const status = el('p', {});
  const owedHost = el('div', {}, el('p', { class: 'note' }, 'Checking what you are owed…'));
  const leave = el('button.danger', { onclick: doLeave }, 'Leave ' + (me.business || 'this shop'));
  leave.disabled = true; // until we know where they stand
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  api.leavePreview().then((r) => {
    const nodes = [];
    if (r.owed && r.owed.total > 0) {
      nodes.push(el('p', { class: 'buy-total' }, 'You are owed ' + money(r.owed.total)));
      if (r.owed.hourly && r.owed.commission) {
        nodes.push(el('p', { class: 'note' }, money(r.owed.hourly) + ' in hours and ' +
          money(r.owed.commission) + ' in commission.'));
      }
      nodes.push(el('p', { class: 'note' }, 'Leaving does NOT cancel it. Your shifts and your sales stay ' +
        'on the shop’s books, and your owner still sees what they owe you and can still settle it.'));
    } else {
      nodes.push(el('p', { class: 'note' }, 'You have nothing outstanding — everything you have worked ' +
        'has been settled.'));
    }
    if (r.onShift) {
      nodes.push(el('p', { class: 'warn' }, 'You are clocked in. Clock out on your time card first — a ' +
        'shift left open would sit on the shop’s log with nobody able to close it.'));
    }
    // The server's own words for why not, rather than this screen guessing at
    // them. It should not be reachable — the tile is not offered to anyone the
    // rule refuses — but a stale page is exactly when it would be.
    if (r.refusal) nodes.push(el('p', { class: 'error' }, r.refusal));
    mount(owedHost, ...nodes);
    leave.disabled = !r.canLeave || r.onShift;
  }).catch((e) => {
    mount(owedHost, el('p', { class: 'error' }, e.message || String(e)));
  });

  async function doLeave() {
    if (!window.confirm('Leave ' + (me.business || 'this shop') + '?\n\n' +
      'You stop being an employee here straight away. Anything the shop owes you stays owed — your ' +
      'owner still sees it.\n\n' +
      'To work anywhere again (including here) you will need a staff code from that shop.')) return;
    leave.disabled = true;
    setStatus('Leaving…', '');
    try {
      const res = await api.leaveBusiness();
      // Their account is gone, so there is nothing left to render for. A reload
      // takes them to sign-up, which is exactly where they now belong.
      setStatus('You have left ' + res.left + '.', 'ok');
      signOut();
    } catch (e) {
      leave.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  return el('div.card', {}, [
    el('h2', {}, 'Leave ' + (me.business || 'your shop')),
    el('p', { class: 'note' }, 'Stop working here. This ends your place on the roster — you will not be ' +
      'able to ring up sales, see the shop’s stock, or clock on.'),
    owedHost,
    el('p', { class: 'note' }, 'You will be signed out. To join a shop again — this one or any other — ' +
      'you will need its staff code, the same as when you first registered.'),
    el('div', { class: 'row-actions' }, [leave]),
    status,
  ]);
}
