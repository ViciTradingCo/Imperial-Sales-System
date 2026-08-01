/**
 * Admin-only Network Settings — a grid of big buttons rather than a wall of
 * stacked cards. Each tile opens its section in a focal menu: network tunables,
 * branding, holds, tile art, storefronts, system status, backup, and the danger
 * zone. The API enforces admin-only access.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';
import { toast } from '../lib/toast.js';
import { tileGrid, openFocalMenu } from '../lib/tiles.js';

export function renderAdminSettings(container) {
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Network Settings'),
    el('p', { class: 'note' }, 'Everything that governs the whole network. Pick a section to open it.'),
    gridHost,
  ]));

  const sections = [
    { key: 'set-tunables', label: 'Tunables', hint: 'Sync + market thresholds', glyph: '🎚️',
      open: (host) => renderSettingsForm(host, {
        title: 'Network tunables',
        subtitle: 'Network-wide settings for the whole trading network.',
        load: async () => (await api.getSettings()).settings,
        save: async (updates) => (await api.saveSettings(updates)).settings,
      }) },
    { key: 'set-branding', label: 'Branding', hint: 'Name, logo, icons', glyph: '🎨',
      open: (host) => mount(host, brandingCard()) },
    { key: 'set-holds', label: 'Holds', hint: 'The hold index', glyph: '🗺️',
      open: (host) => mount(host, holdsCard()) },
    { key: 'set-tiles', label: 'Tile images', hint: 'Home tile artwork', glyph: '🖼️',
      open: (host) => mount(host, tileImagesCard()) },
    { key: 'set-storefront', label: 'Storefronts', hint: 'Public shop pages', glyph: '🏪',
      open: (host) => mount(host, storefrontCard()) },
    { key: 'set-status', label: 'System status', hint: 'Counts + errors', glyph: '💚',
      open: (host) => mount(host, statusCard()) },
    { key: 'set-backup', label: 'Backup', hint: 'Export / restore', glyph: '💾',
      open: (host) => mount(host, backupCard()) },
    { key: 'set-danger', label: 'Danger zone', hint: 'Purge & full reset', glyph: '⚠️',
      open: (host) => mount(host, logsCard(), resetCard()) },
  ];

  function draw(images) {
    mount(gridHost, tileGrid(sections.map((s) => ({
      key: s.key, label: s.label, hint: s.hint, glyph: s.glyph,
      onOpen: () => openFocalMenu(s.label, (host) => s.open(host)),
    })), images));
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
  const save = el('button.primary', { onclick: doSave }, 'Save branding');

  api.getBrandingAdmin().then((b) => {
    fields.forEach(([key]) => { if (b[key]) inputs[key].value = b[key]; });
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
    el('p', { class: 'note' }, 'The name, logo, and icon used across the whole app — header, browser tab, and ' +
      'footer. Images are links to files hosted elsewhere (must be a direct https:// link to the image). ' +
      'Leave a field blank to use the default.'),
    ...rows,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/** Danger zone: full reset — wipe everything, keep only admin accounts. */
function resetCard() {
  const status = el('p', {});
  const btn = el('button.danger', { onclick: doReset }, 'Clear ALL data (full reset)');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }
  async function doReset() {
    if (!window.confirm('FULL RESET — permanently delete: companies, members (except admins), inventory, sales, ' +
      'intake, transfers, coffers, discounts, shop styles, the audit log, network settings, and MOTDs.\n\n' +
      'KEPT: admin accounts, the Master Item Index, and the Holds list (reference defaults).\n\n' +
      'This CANNOT be undone. Export a backup first.')) return;
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
    el('p', { class: 'note' }, 'Erase all business and transaction data and start fresh. Keeps admin accounts plus ' +
      'the reference defaults — the Master Item Index and the Holds list. Network settings and MOTDs return to ' +
      'defaults. Export a backup first; this cannot be undone.'),
    el('div', { class: 'row-actions' }, [btn]),
    status,
  ]);
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

/**
 * Tile artwork — assign an externally hosted image (https URL) to each home
 * tile. Blank falls back to the tile's glyph.
 */
const TILE_KEYS = [
  ['members', 'Members'], ['companies', 'Companies'], ['items', 'Item Index'],
  ['market', 'Market'], ['motd', 'MOTD'], ['audit', 'Audit Log'], ['settings', 'Settings'],
  ['register', 'Register'], ['inventory', 'Inventory'], ['employees', 'Employees'],
  ['ledger', 'Shop Ledger'], ['restock', 'Restock'],
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

/** Admin toggle for the public storefront feature (off by default). */
function storefrontCard() {
  const status = el('p', {});
  const toggle = el('input', { type: 'checkbox' });
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }
  api.getStorefrontFlag().then((r) => { toggle.checked = !!r.enabled; }).catch(() => {});
  async function doSave() {
    save.disabled = true; setStatus('Saving…', '');
    try {
      const r = await api.setStorefrontFlag(toggle.checked);
      setStatus('Public storefronts ' + (r.enabled ? 'enabled' : 'disabled') + '.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }
  return el('div.card', {}, [
    el('h3', {}, 'Public storefronts'),
    el('p', { class: 'note' }, 'When on, every active shop gets a public, read-only catalog page (no sign-in) at ' +
      'its share link — great for RP customers. Off by default.'),
    el('label', { class: 'inline' }, [toggle, document.createTextNode(' Enable public storefronts')]),
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/** System status — D1 row counts, recent activity, and recent internal errors. */
function statusCard() {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  api.getStatus().then((s) => {
    const c = s.counts || {};
    const facts = Object.keys(c).map((k) => el('div.fact', {}, [
      el('span', { class: 'fact-label' }, k.replace(/_/g, ' ')),
      el('span', { class: 'fact-value' }, String(c[k])),
    ]));
    const errs = s.errors || [];
    const errorSection = errs.length
      ? el('div', {}, [
          el('h4', {}, 'Recent errors (' + errs.length + ')'),
          ...errs.slice(0, 8).map((e) => el('p', { class: 'note error' },
            new Date(e.ts).toLocaleString() + ' · ' + e.where + ' — ' + e.message)),
        ])
      : el('p', { class: 'note ok' }, 'No recent errors ✓');
    mount(host,
      el('div', { class: 'readonly-facts' }, facts),
      el('p', { class: 'note' }, 'Last sale: ' + (s.lastSale ? new Date(s.lastSale).toLocaleString() : '—')),
      el('p', { class: 'note' }, 'Error alerts to Discord: ' + (s.discordConfigured ? 'on' : 'off (set DISCORD_WEBHOOK_URL to enable)')),
      errorSection);
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  return el('div.card', {}, [el('h3', {}, 'System status'), host]);
}

/** Data backup — download an export, or restore from one (with a preview diff). */
function backupCard() {
  const status = el('p', {});
  const diffHost = el('div', {});
  const exportBtn = el('button.primary', { onclick: doExport }, 'Export backup');
  const file = el('input', { type: 'file', accept: '.gz,application/gzip,application/json' });
  const previewBtn = el('button.secondary-btn', { onclick: doPreview }, 'Preview restore');
  const importBtn = el('button.danger', { onclick: doImport }, 'Restore backup');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doExport() {
    exportBtn.disabled = true; setStatus('Preparing…', '');
    try {
      const blob = await api.exportBackupBlob();
      downloadBlob(blob, 'eec-backup-' + new Date().toISOString().slice(0, 10) + '.json.gz');
      setStatus('Backup downloaded — keep it somewhere safe.', 'ok');
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
      const p = await api.previewBackup(data);
      const rows = Object.keys(p.diff || {}).map((t) => el('div.fact', {}, [
        el('span', { class: 'fact-label' }, t.replace(/_/g, ' ')),
        el('span', { class: 'fact-value' }, p.diff[t].current + ' → ' + p.diff[t].incoming),
      ]));
      mount(diffHost,
        el('p', { class: 'note' }, 'This file was made ' + (p.exportedAt ? new Date(p.exportedAt).toLocaleString() : 'at an unknown time') +
          '. Restoring replaces ' + p.currentTotal + ' current rows with ' + p.incomingTotal + ' (current → incoming):'),
        el('div', { class: 'readonly-facts' }, rows));
      setStatus('Preview ready — review, then Restore to apply.', '');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { previewBtn.disabled = false; }
  }

  async function doImport() {
    if (!window.confirm('Restore from this backup?\n\nThis REPLACES all current data (registry, sales, intake, ' +
      'inventory, transfers, coffers, discounts, item index, holds, audit). This cannot be undone.')) return;
    importBtn.disabled = true; setStatus('Restoring…', '');
    try {
      const data = await readFile();
      const res = await api.importBackup(data);
      const total = Object.values(res.restored || {}).reduce((a, b) => a + Number(b || 0), 0);
      setStatus('Restored ' + total + ' rows across ' + Object.keys(res.restored || {}).length + ' tables.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { importBtn.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Data backup'),
    el('p', { class: 'note' }, 'Download a compressed backup of all live data, or restore from one after a ' +
      'failure. Do this weekly (you’ll get a reminder on Mondays).'),
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
function logsCard() {
  const status = el('p', {});
  const amount = el('input', { type: 'number', min: '1', value: '6', style: 'width:5em' });
  const unit = el('select', {}, [
    el('option', { value: 'days' }, 'days'),
    el('option', { value: 'weeks' }, 'weeks'),
    el('option', { value: 'months', selected: true }, 'months'),
  ]);
  const purgeBtn = el('button.secondary-btn', { onclick: doPurge }, 'Purge older');
  const clearBtn = el('button.danger', { onclick: doClear }, 'Clear all logs');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doPurge() {
    const n = Math.floor(Number(amount.value));
    if (!n || n < 1) { setStatus('Enter a number.', 'error'); return; }
    if (!window.confirm('Delete sales & intake older than ' + n + ' ' + unit.value + ' across the network? This cannot be undone.')) return;
    purgeBtn.disabled = true; setStatus('Purging…', '');
    try {
      const r = await api.purgeLogs(n, unit.value);
      setStatus('Purged ' + r.sales + ' sales and ' + r.intake + ' intake older than ' + r.cutoff + '.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { purgeBtn.disabled = false; }
  }

  async function doClear() {
    if (!window.confirm('Clear ALL sales and intake logs for every shop in the network?\n\n' +
      'This permanently deletes the transaction history (Market Analysis resets to zero). ' +
      'Inventory catalogs are kept. This cannot be undone.')) return;
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
      'Inventory catalogs are always kept. Neither can be undone — export a backup first.'),
    el('div', { class: 'row-actions' }, [amount, unit, purgeBtn]),
    el('div', { class: 'row-actions' }, [clearBtn]),
    status,
  ]);
}
