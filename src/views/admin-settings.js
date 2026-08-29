/**
 * Admin-only Network Settings — a grid of big buttons rather than a wall of
 * stacked cards. Each tile opens its section in a focal menu: network tunables,
 * branding, holds, tile art, system status, backup, and the danger
 * zone. The API enforces admin-only access.
 */
import { el, mount } from '../lib/dom.js';
import { formatDateTime } from '../lib/format.js';
import { api } from '../lib/api.js';
import { setAdminActions, recentErrorsPanel } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { toast } from '../lib/toast.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';

export function renderAdminSettings(container, { me } = {}) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/admin/realms') }, '← Realm Management'),
    el('h2', {}, 'Network Settings'),
    el('p', { class: 'note' }, 'Settings for the realm you are working in. Each realm keeps its own — regions, ' +
      'denomination, branding, and the rest — so changing these never affects another realm.'),
    gridHost,
  ]));

  const sections = [
    { key: 'set-branding', label: 'Branding', hint: 'Name, logo, icons', glyph: '🎨',
      open: (host) => mount(host, brandingCard()) },
    // Goes to the page itself: it is editable in place there, and the page is
    // the only honest preview of the page. Three boxes in a modal here said
    // nothing about what they would look like.
    { key: 'set-about', label: 'About page', hint: 'Edit it in place', glyph: '📖', goto: '/about' },
    { key: 'set-holds', label: 'Regions', hint: 'The region list', glyph: '🗺️',
      open: (host) => mount(host, regionsCard()) },
    { key: 'set-money', label: 'Denomination', hint: 'What the money is called', glyph: '🪙',
      open: (host) => mount(host, denominationCard()) },
    { key: 'set-trial', label: 'Certification', hint: 'Require it, trial length', glyph: '📜',
      open: (host) => mount(host, trialCard()) },
    { key: 'set-kinds', label: 'Item kinds', hint: 'Food, drink, weapons…', glyph: '🏷️',
      open: (host) => mount(host, itemKindsCard()) },
    { key: 'set-tiles', label: 'Tile images', hint: 'Home tile artwork', glyph: '🖼️',
      open: (host) => mount(host, tileImagesCard()) },
    { key: 'set-status', label: 'System status', hint: 'Counts + errors', glyph: '💚',
      open: (host) => mount(host, statusCard(me)) },
    // Backup, log maintenance, and the full reset are one "data" section — they
    // are the same job (safeguard first, then trim or wipe).
    { key: 'set-data', label: 'Data', hint: 'Backup, purge, reset', glyph: '💾',
      open: (host) => mount(host, backupCard(me), logsCard(me), resetCard(me)) },
  ];

  function draw(images) {
    mount(gridHost, tileGrid(sectionTiles(sections, navigate), images));
  }
  draw({});
  api.getTiles().then((r) => draw(r.images || {})).catch(() => {});
}

/** Sitewide branding — app name, logo, favicon, footer, accent. */
function brandingCard() {
  const fields = [
    ['appName', 'App name', 'text', 'Vici Trading Co.'],
    ['tagline', 'Header title', 'text', 'The Vici Automated Ledger'],
    ['shortName', 'Short name (installed app)', 'text', 'Vici Ledger'],
    ['logoUrl', 'Logo image link', 'url', 'https://… (shown in the header)'],
    ['faviconUrl', 'Icon image link', 'url', 'https://… (browser tab icon)'],
    ['footerText', 'Footer text', 'text', 'The Vici Automated Ledger · created by …'],
    ['accent', 'Accent colour', 'text', '#7a4a1f'],
  ];
  const inputs = {};
  const rows = fields.map(([key, label, type, ph]) => {
    inputs[key] = el('input', { type: type === 'url' ? 'url' : 'text', placeholder: ph });
    return el('div', {}, [el('label', {}, label), inputs[key]]);
  });
  const status = el('p', {});
  const scopeNote = el('div', {});
  const save = el('button.primary', { onclick: doSave }, 'Save branding');

  // A System Admin edits the deployment's identity; a Realm Admin edits their
  // own realm's overrides, where a blank field means "inherit". The placeholder
  // shows what it will inherit, so blank never looks like broken.
  api.getBrandingAdmin().then((r) => {
    const b = r.branding || {};
    fields.forEach(([key]) => { if (b[key]) inputs[key].value = b[key]; });
    if (r.scope === 'realm') {
      const from = r.inherited || {};
      fields.forEach(([key]) => {
        if (from[key]) inputs[key].placeholder = 'Inherited: ' + from[key];
      });
      mount(scopeNote, el('p', { class: 'note' }, 'These are this realm’s overrides. Leave a field blank to use ' +
        'the deployment’s own branding, shown greyed out in each box.'));
    }
  }).catch(() => {});

  async function doSave() {
    const body = {};
    fields.forEach(([key]) => { body[key] = inputs[key].value.trim(); });
    save.disabled = true; status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setBranding(body);
      status.textContent = '';
      toast('Branding saved — reload to see it everywhere', 'ok');
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Branding'),
    el('p', { class: 'note' }, 'The name, logo, and icon used across the app — header, browser tab, and footer. ' +
      'Images are links to files hosted elsewhere (must be a direct https:// link to the image). Leave a field ' +
      'blank to use the default.'),
    scopeNote,
    ...rows,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/** Danger zone: full reset — wipe everything, keep only admin accounts. */
function resetCard(me) {
  const status = el('p', {});
  const btn = el('button.danger', { onclick: doReset }, 'Clear ALL data (full reset)');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }
  async function doReset() {
    const realm = (me && me.realmName) || 'this realm';
    if (!window.confirm('FULL RESET of ' + realm + ' — permanently delete its companies, members (except ' +
      'admins), inventory, sales, intake, transfers, coffers, discounts, shop styles, audit log, settings, ' +
      'and MOTDs.\n\nKEPT: admin accounts, the Master Item Index, and the Regions list (reference defaults).\n\n' +
      'Other realms are NOT affected.\n\nThis CANNOT be undone. Export a backup first.')) return;
    const typed = window.prompt('Type ERASE (all caps) to confirm the full reset:');
    if (typed !== 'ERASE') { setStatus('Reset cancelled.', ''); return; }
    btn.disabled = true; setStatus('Erasing…', '');
    try {
      const r = await api.wipeData();
      setStatus('Done — ' + r.tablesCleared + ' tables cleared. Kept ' + r.adminsKept + ' admin account(s), ' +
        r.itemsKept + ' master item(s), and ' + r.holdsKept + ' hold(s). Reload the page to see the clean state.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { btn.disabled = false; }
  }
  return el('div.card', {}, [
    el('h3', {}, 'Full reset'),
    el('p', { class: 'note' }, 'Erase this realm’s business and transaction data and start fresh. Keeps admin ' +
      'accounts plus the reference defaults — the Master Item Index and the Regions list. Settings and MOTDs return ' +
      'to defaults. Other realms are not affected. Export a backup first; this cannot be undone.'),
    el('div', { class: 'row-actions' }, [btn]),
    status,
  ]);
}

/**
 * Regions — the named places this realm trades in, plus whether the register
 * asks which one a sale happened in.
 *
 * (Stored as `hold_index` / the `hold` column, from when these were Skyrim
 * holds. The name is cosmetic and per realm; renaming the columns would be a
 * data migration for no gain.)
 */
function regionsCard() {
  const box = el('textarea', { rows: '10' });
  const showRegion = el('input', { type: 'checkbox' });
  const label = el('input', { type: 'text', placeholder: 'Region' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save regions');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  api.getRegions().then((r) => { box.value = (r.holds || []).join('\n'); }).catch(() => {});
  api.getRealmPrefs().then((p) => {
    showRegion.checked = p.showRegion !== false;
    label.value = p.regionLabel || '';
  }).catch(() => { showRegion.checked = true; });

  async function doSave() {
    const holds = box.value.split('\n').map((h) => h.trim()).filter(Boolean);
    save.disabled = true; setStatus('Saving…', '');
    try {
      const r = await api.setRegions(holds);
      box.value = (r.holds || []).join('\n');
      await api.setRealmPrefs({ showRegion: showRegion.checked, regionLabel: label.value.trim() });
      setStatus('Saved ✓ — ' + (r.holds || []).length + ' regions.', 'ok');
      toast('Regions saved — reload to apply the register change', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Regions'),
    el('p', { class: 'note' }, 'The places this realm trades in, one per line, in order. Each realm keeps its ' +
      'own list — changing one never affects another.'),
    box,
    el('label', {}, 'What to call them'),
    label,
    el('p', { class: 'note' }, 'Singular, as it appears on forms — Region, Hold, Province, Sector. Blank uses “Region”.'),
    el('label', { class: 'inline' }, [showRegion, document.createTextNode(' Ask for a region on the register')]),
    el('p', { class: 'note' }, 'Off hides the field and stops requiring it. Past sales keep whatever region they ' +
      'were recorded with; new ones simply have none, and the region reports have nothing to group.'),
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/**
 * CERTIFICATION: whether this realm requires one at all, and how long a newly
 * founded shop gets.
 *
 * One card, because they are one question — "how does this realm handle
 * subscriptions?" — and the second half is meaningless when the answer to the
 * first is "it does not". A server where nobody is charged for anything had
 * every shop lapse on a timer and an admin renewing dates for no reason; the
 * toggle turns the whole apparatus off, and turns it back on with every shop's
 * real standing intact, because nothing about the dates is rewritten either way.
 */
function trialCard() {
  const required = el('input', { type: 'checkbox' });
  const days = el('input', { type: 'number', min: '0', max: '365', step: '1' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  const sample = el('p', { class: 'note' }, '');
  const trialWrap = el('div', {});
  const offNote = el('p', { class: 'note' },
    'Nothing expires in this realm. Shops trade whether or not they have a subscription date, no expiry ' +
    'warnings are shown, and the Company List stops offering subscriptions. The dates already on file are ' +
    'kept, so turning this back on restores each shop exactly as it was.');
  function paintRequired() {
    trialWrap.hidden = !required.checked;
    offNote.hidden = required.checked;
  }
  required.addEventListener('change', paintRequired);
  function paint() {
    const n = Math.floor(Number(days.value));
    sample.textContent = !isFinite(n) || n <= 0
      ? 'New shops open EXPIRED — an admin must certify each one by hand before it can sell.'
      : 'A shop founded today would be certified until ' +
        new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) + '.';
  }
  days.addEventListener('input', paint);

  api.getRealmPrefs().then((p) => {
    required.checked = p.certification !== false;
    days.value = String(p.trialDays != null ? p.trialDays : 7);
    paint();
    paintRequired();
  }).catch(() => { required.checked = true; paint(); paintRequired(); });

  async function doSave() {
    save.disabled = true; status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setRealmPrefs({ certification: required.checked, trialDays: days.value });
      status.textContent = '';
      toast(required.checked ? 'Certification settings saved' : 'Certification is off for this realm', 'ok');
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { save.disabled = false; }
  }

  mount(trialWrap,
    el('label', {}, 'Opening trial (days)'),
    days,
    sample,
    el('p', { class: 'note' }, 'The expiry banner warns owners before this runs out — set that lead time in ' +
      'MOTD → Expiry warning.'));

  return el('div.card', {}, [
    el('h3', {}, 'Certification'),
    el('p', { class: 'note' }, 'Whether shops in this realm need a current subscription to trade. Turn it off ' +
      'and nothing expires — useful for a server that does not charge for anything.'),
    el('label', { class: 'check-row' }, [required, el('span', {}, 'Require certification to sell')]),
    offNote,
    trialWrap,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/**
 * THE KINDS OF THING THIS REALM TRADES IN — food, drink, a weapon.
 *
 * The vocabulary is the realm's and the tagging is each shop's: an owner marks
 * their own listings, and a special can then ask for five food rather than
 * naming five items. A shared list rather than free text per shop, because
 * "drink" and "drinks" typed at two counters are two kinds that look like one,
 * and the deal that asks for the first would quietly ignore the second.
 *
 * One per line — a textarea rather than a row of fields, because this is a list
 * somebody pastes and reorders far more often than they edit one entry of.
 */
function itemKindsCard() {
  const box = el('textarea', { rows: '10', placeholder: 'Food\nDrink\nWeapon' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save kinds');

  api.getRealmPrefs()
    .then((p) => { box.value = (p.itemTags || []).join('\n'); })
    .catch(() => {});

  async function doSave() {
    save.disabled = true; status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setRealmPrefs({ itemTags: box.value.split('\n').map((t) => t.trim()).filter(Boolean) });
      status.textContent = '';
      toast('Item kinds saved — reload to see them everywhere', 'ok');
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Item kinds'),
    el('p', { class: 'note' }, 'What kinds of thing this realm trades in. Shops tag their own stock with these ' +
      '(Inventory → Kinds), and a special can then ask for “five food and five drink” and let the customer ' +
      'choose which. One per line.'),
    el('label', {}, 'Kinds'),
    box,
    el('p', { class: 'note' }, 'Taking a kind off this list does NOT strip it from stock already tagged with ' +
      'it — a shop keeps what it wrote down, and the kind simply stops being offered.'),
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/** The denomination every amount in this realm is shown in. */
function denominationCard() {
  const input = el('input', { type: 'text', placeholder: 'gp' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save denomination');
  const sample = el('p', { class: 'note' }, '');
  function paint() { sample.textContent = 'Amounts will read: 12.50' + (input.value.trim() || 'gp'); }
  input.addEventListener('input', paint);

  api.getRealmPrefs().then((p) => { input.value = p.currency || ''; paint(); }).catch(paint);

  async function doSave() {
    save.disabled = true; status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setRealmPrefs({ currency: input.value.trim() });
      status.textContent = '';
      toast('Denomination saved — reload to see it everywhere', 'ok');
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Denomination'),
    el('p', { class: 'note' }, 'What this realm’s money is called. It follows every amount shown in the app — ' +
      'the register, coffers, inventory, reports, and exports. Each realm sets its own.'),
    el('label', {}, 'Denomination'),
    input,
    sample,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/**
 * Tile artwork — assign an externally hosted image (https URL) to each home
 * tile. Blank falls back to the tile's glyph.
 */
const TILE_KEYS = [
  // Home — shop (admins have no tiles; their tools are on the action bar)
  ['register', 'Register'], ['inventory', 'Inventory'], ['employees', 'Employees'],
  ['ledger', 'Shop Ledger'], ['restock', 'Restock'], ['timecard', 'Time Card'],
  ['marketinfo', 'Market Info'], ['shopsettings', 'Shop Settings'],
  // The Shop Ledger's history sections
  ['log-sales', 'Shop Ledger · Sales'], ['log-intake', 'Shop Ledger · Deliveries'],
  ['emp-code', 'Employees · Staff code'],
  ['tc-mine', 'Time Cards · Mine'], ['tc-log', 'Time Cards · Shift log'],
  // Network Settings sections
  ['set-branding', 'Settings · Branding'],
  ['set-about', 'Settings · About page'],
  ['set-holds', 'Settings · Regions'], ['set-money', 'Settings · Denomination'],
  ['set-trial', 'Settings · Certification'],
  ['set-kinds', 'Settings · Item kinds'],
  ['set-tiles', 'Settings · Tile images'],
  ['set-status', 'Settings · System status'],
  ['set-data', 'Settings · Data'],
  // MOTD sections
  ['motd-global', 'MOTD · Global notice'], ['motd-individual', 'MOTD · Individual'],
  ['motd-warn', 'MOTD · Expiry warning'],
  // Profile sections
  ['prof-identity', 'Profile · Character'], ['prof-appearance', 'Profile · Appearance'],
  ['prof-leave', 'Profile · Leave your shop'],
  // Realm Management sections
  ['rlm-list', 'Realms · List'], ['rlm-add', 'Realms · Add'], ['transfers', 'Realms · Transfers'],
  ['rlm-settings', 'Realms · Network Settings'],
  // NOTE: every key here must be unique — the form builds one input per key, so
  // a duplicate silently clobbers the first row's value on save.
  // Shop Ledger sections
  ['led-report', 'Ledger · Performance'], ['led-notices', 'Ledger · Notices'],
  ['led-coffer', 'Ledger · Coffers'], ['led-discounts', 'Ledger · Discounts'],
  ['led-style', 'Ledger · Style'],
  ['led-export', 'Ledger · Export'], ['led-company', 'Ledger · Company'],
  ['led-settings', 'Ledger · Shop settings'],
  ['led-close', 'Ledger · Close the shop'],
  // Court sections
  ['court-properties', 'Court · Property Index'],
  // Employees + Notices sections
  ['emp-roster', 'Employees · Roster'], ['emp-performance', 'Employees · Performance'],
  ['not-post', 'Notices · Post'], ['not-list', 'Notices · List'],
];
function tileImagesCard() {
  const status = el('p', {});
  const inputs = {};
  const previews = {};

  function paint(key) {
    const preview = previews[key];
    const url = String(inputs[key].value || '').trim();
    preview.innerHTML = '';
    if (!/^https:\/\//i.test(url)) { preview.textContent = '◆'; return; }
    const img = el('img', { src: url, alt: '' });
    img.addEventListener('error', () => { preview.innerHTML = ''; preview.textContent = '✕'; });
    preview.appendChild(img);
  }

  const rows = TILE_KEYS.map(([key, label]) => {
    const preview = el('span', { class: 'tile-img-preview' }, '◆');
    const input = el('input', { type: 'url', placeholder: 'https://… (blank = default glyph)' });
    input.addEventListener('input', () => paint(key));
    inputs[key] = input;
    previews[key] = preview;
    return el('div', { class: 'tile-img-row' }, [preview, el('label', {}, label), input]);
  });

  api.getTileImages().then((r) => {
    const images = r.images || {};
    TILE_KEYS.forEach(([key]) => {
      if (images[key]) { inputs[key].value = images[key]; paint(key); }
    });
  }).catch(() => {});

  const save = el('button.primary', { onclick: doSave }, 'Save tile images');
  async function doSave() {
    const images = {};
    TILE_KEYS.forEach(([key]) => { const v = inputs[key].value.trim(); if (v) images[key] = v; });
    save.disabled = true; status.className = ''; status.textContent = 'Saving…';
    try {
      await api.setTileImages(images);
      status.textContent = '';
      toast('Tile images saved', 'ok');
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Tile images'),
    el('p', { class: 'note' }, 'Give each home tile a picture by pasting a link to an image hosted elsewhere ' +
      '(Discord, Imgur, your own host). Must be a full https:// link straight to the image file. Leave blank to ' +
      'use the default glyph.'),
    el('div', { class: 'tile-img-list' }, rows),
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/** System status — D1 row counts, recent activity, and recent internal errors. */
function statusCard(me) {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  api.getStatus().then((s) => {
    const c = s.counts || {};
    const facts = Object.keys(c).map((k) => el('div.fact', {}, [
      el('span', { class: 'fact-label' }, k.replace(/_/g, ' ')),
      el('span', { class: 'fact-value' }, String(c[k])),
    ]));
    const errorHost = el('div', {});
    const showErrors = (errs) => mount(errorHost, recentErrorsPanel(errs, me, showErrors));
    showErrors(s.errors || []);
    mount(host,
      el('div', { class: 'readonly-facts' }, facts),
      el('p', { class: 'note' }, 'Last sale: ' + (s.lastSale ? formatDateTime(s.lastSale) : '—')),
      el('p', { class: 'note' }, 'Error alerts to Discord: ' + (s.discordConfigured ? 'on' : 'off (set DISCORD_WEBHOOK_URL to enable)')),
      errorHost);
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  return el('div.card', {}, [el('h3', {}, 'System status'), host]);
}

/** Data backup — download an export, or restore from one (with a preview diff). */
function backupCard(me) {
  const status = el('p', {});
  const diffHost = el('div', {});
  // A Realm Admin only ever gets their own realm; the Worker enforces that, so
  // showing them a chooser they can't act on would just be misleading.
  const canChoose = !!(me && me.systemAdmin);
  const scopeSel = el('select', {}, [
    el('option', { value: 'realm' }, 'This realm only (' + ((me && me.realmName) || 'current') + ')'),
    el('option', { value: 'all', selected: true }, 'Whole deployment (every realm)'),
  ]);
  function scope() { return canChoose ? scopeSel.value : 'realm'; }
  const exportBtn = el('button.primary', { onclick: doExport }, 'Export backup');
  const file = el('input', { type: 'file', accept: '.gz,application/gzip,application/json' });
  const previewBtn = el('button.secondary-btn', { onclick: doPreview }, 'Preview restore');
  const importBtn = el('button.danger', { onclick: doImport }, 'Restore backup');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doExport() {
    exportBtn.disabled = true; setStatus('Preparing…', '');
    try {
      const s = scope();
      const blob = await api.exportBackupBlob(s);
      downloadBlob(blob, 'vici-backup-' + s + '-' + new Date().toISOString().slice(0, 10) + '.json.gz');
      setStatus('Backup downloaded (' + (s === 'realm' ? 'this realm' : 'whole deployment') + ') — keep it somewhere safe.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { exportBtn.disabled = false; }
  }

  /** Reads the chosen file into a parsed backup document (gzip or plain JSON). */
  async function readFile() {
    const f = file.files && file.files[0];
    if (!f) throw new Error('Choose a backup file first.');
    const buf = await f.arrayBuffer();
    let text;
    try {
      const stream = new Response(buf).body.pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } catch (e) { text = new TextDecoder().decode(buf); } // maybe already uncompressed
    return JSON.parse(text);
  }

  async function doPreview() {
    mount(diffHost);
    previewBtn.disabled = true; setStatus('Reading…', '');
    try {
      const data = await readFile();
      const p = await api.previewBackup(data, scope());
      const rows = Object.keys(p.diff || {}).map((t) => el('div.fact', {}, [
        el('span', { class: 'fact-label' }, t.replace(/_/g, ' ')),
        el('span', { class: 'fact-value' }, p.diff[t].current + ' → ' + p.diff[t].incoming),
      ]));
      mount(diffHost,
        el('p', { class: 'note' }, 'This file was made ' + (p.exportedAt ? formatDateTime(p.exportedAt) : 'at an unknown time') +
          ' and covers ' + (p.fileScope === 'realm' ? 'one realm' : 'the whole deployment') + '. Restoring replaces ' +
          p.currentTotal + ' current rows with ' + p.incomingTotal + ' in ' +
          (p.scope === 'realm' ? 'THIS REALM ONLY' : 'EVERY REALM') + ' (current → incoming):'),
        el('div', { class: 'readonly-facts' }, rows));
      setStatus('Preview ready — review, then Restore to apply.', '');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { previewBtn.disabled = false; }
  }

  async function doImport() {
    const s = scope();
    const where = s === 'realm'
      ? 'THIS REALM (' + ((me && me.realmName) || 'the current realm') + '). Other realms are untouched.'
      : 'EVERY REALM in this deployment.';
    if (!window.confirm('Restore from this backup?\n\nThis REPLACES the registry, sales, intake, inventory, ' +
      'transfers, coffers, discounts, item index, holds, and audit for ' + where + '\n\nThis cannot be undone.')) return;
    importBtn.disabled = true; setStatus('Restoring…', '');
    try {
      const data = await readFile();
      const res = await api.importBackup(data, s);
      const total = Object.values(res.restored || {}).reduce((a, b) => a + Number(b || 0), 0);
      setStatus('Restored ' + total + ' rows across ' + Object.keys(res.restored || {}).length + ' tables.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { importBtn.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Data backup'),
    el('p', { class: 'note' }, 'Download a compressed backup, or restore from one after a failure. Do this ' +
      'weekly (you’ll get a reminder on Sundays).'),
    canChoose ? el('div', {}, [
      el('label', {}, 'Backup scope'),
      scopeSel,
      el('p', { class: 'note' }, 'Whole-deployment is what you want for disaster recovery. A single-realm backup ' +
        'is what you want before a risky change to one server — restoring it cannot drag the other realms back ' +
        'in time with it.'),
    ]) : el('p', { class: 'note' }, 'Covers this realm only.'),
    el('div', { class: 'row-actions' }, [exportBtn]),
    el('label', {}, 'Restore from a backup file'),
    file,
    el('div', { class: 'row-actions' }, [previewBtn, importBtn]),
    diffHost,
    status,
  ]);
}

/** Triggers a browser download of a Blob. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Danger zone: purge old logs, or clear all of them. */
function logsCard(me) {
  const status = el('p', {});
  const amount = el('input', { type: 'number', min: '1', value: '6', style: 'width:5em' });
  const unit = el('select', {}, [
    el('option', { value: 'days' }, 'days'),
    el('option', { value: 'weeks' }, 'weeks'),
    el('option', { value: 'months', selected: true }, 'months'),
  ]);
  // Deletes real rows, so it wears the same red as Clear all logs beside it —
  // "older than six months" is a smaller blast radius, not a different kind of act.
  const purgeBtn = el('button.danger', { onclick: doPurge }, 'Purge older');
  const clearBtn = el('button.danger', { onclick: doClear }, 'Clear all logs');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doPurge() {
    const n = Math.floor(Number(amount.value));
    if (!n || n < 1) { setStatus('Enter a number.', 'error'); return; }
    if (!window.confirm('Delete sales & intake older than ' + n + ' ' + unit.value + ' in ' +
      ((me && me.realmName) || 'this realm') + '? Other realms are not affected. This cannot be undone.')) return;
    purgeBtn.disabled = true; setStatus('Purging…', '');
    try {
      const r = await api.purgeLogs(n, unit.value);
      setStatus('Purged ' + r.sales + ' sales and ' + r.intake + ' intake older than ' + r.cutoff + '.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { purgeBtn.disabled = false; }
  }

  async function doClear() {
    if (!window.confirm('Clear ALL sales and intake logs for every shop in ' + ((me && me.realmName) || 'this realm') +
      '?\n\nThis permanently deletes that realm’s transaction history (its Market Analysis resets to zero). ' +
      'Inventory catalogs are kept, and other realms are not affected. This cannot be undone.')) return;
    clearBtn.disabled = true; setStatus('Clearing…', '');
    try {
      const r = await api.clearLogs();
      setStatus('Cleared ' + (r.sales || 0) + ' sales and ' + (r.intake || 0) + ' intake records.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { clearBtn.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Log maintenance'),
    el('p', { class: 'note' }, 'Purge trims old history; Clear wipes it all (used to start a fresh season). ' +
      'Both act on this realm only. Inventory catalogs are always kept. Neither can be undone — export a ' +
      'backup first.'),
    el('div', { class: 'row-actions' }, [amount, unit, purgeBtn]),
    el('div', { class: 'row-actions' }, [clearBtn]),
    status,
  ]);
}
