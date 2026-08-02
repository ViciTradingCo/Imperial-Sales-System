/**
 * Company List (admin) — every registered company. Each has:
 *   • Edit — a focus modal to rename the company (propagated everywhere).
 *   • Subscription — its own focus modal to set when the subscription expires
 *     (calendar picker OR manual entry) or mark it Perpetual.
 */
import { el, mount, esc } from '../lib/dom.js';
import { regionLabel } from '../lib/format.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { pager } from '../lib/paginate.js';

const PAGE_SIZE = 25;
const HOLDS = ['Eastmarch', 'Falkreath', 'Haafingar', 'Hjaalmarch', 'The Pale', 'The Reach', 'The Rift', 'Whiterun', 'Winterhold'];

export function renderCompanies(container, { me } = {}) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const listHost = el('div', {}, skeletonRows(5));
  const search = el('input', { type: 'search', placeholder: 'Search business, contact, hold, status…' });
  let page = 1;
  search.addEventListener('input', () => { page = 1; draw(); });
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Company List'),
    el('p', { class: 'note' }, 'Every registered business. Edit renames a company; Subscription sets its certification.'),
    search,
    listHost,
  ]));

  let all = [];
  function load() {
    api.getCompanies()
      .then((res) => { all = res.companies || []; draw(); })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const companies = !q ? all : all.filter((c) =>
      [c.business, c.pointOfContact, c.hold, c.status, c.court ? 'court' : ''].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!companies.length) { mount(listHost, el('p', { class: 'note' }, all.length ? 'No matches.' : 'No companies yet.')); return; }
    const pg = pager(companies.length, page, PAGE_SIZE, (n) => { page = n; draw(); });
    page = pg.page;
    renderList(companies.slice(pg.start, pg.end));
    listHost.appendChild(pg.bar);
  }

  function renderList(companies) {
    mount(listHost, ...companies.map((c) => {
      const sub = c.perpetual ? 'Perpetual' : (c.until ? 'until ' + c.until : 'no subscription');
      const statusCls = String(c.status).toUpperCase() === 'VALID' ? 'ok' : 'bad';
      const court = c.court ? ' <span class="role-pill">Court</span>' : '';
      const realmPill = (me && me.realmCount > 1 && c.realmId)
        ? ' <span class="realm-pill">' + esc(c.realmId) + '</span>' : '';
      const holdLine = c.hold ? '<br><span class="note">' + esc(regionLabel()) + ': ' + esc(c.hold) + '</span>' : '';
      return el('div', { class: 'member-row' }, [
        el('p', { html:
          '<b>' + esc(c.business || '—') + '</b> · <span class="' + statusCls + '">' + esc(c.status || '—') + '</span>' + court + realmPill + '<br>' +
          '<span class="note">' + esc(sub) + (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' + holdLine }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openNameModal(c, load) }, 'Edit'),
          el('button.secondary-btn.small', { onclick: () => openSubscriptionModal(c, load) }, 'Subscription'),
          el('button.danger.small', { onclick: () => remove(c) }, 'Delete'),
        ]),
      ]);
    }));
  }

  async function remove(c) {
    if (!window.confirm('Delete "' + (c.business || 'this company') + '"?\n\n' +
      'Its market data is kept for analysis but archived — the name is freed and ' +
      'the archived records can never be pulled back if the company is remade.')) return;
    mount(listHost, el('p', { class: 'note' }, 'Archiving…'));
    try {
      const res = await api.deleteCompany(c.id);
      all = res.companies || [];
      draw();
    } catch (e) {
      mount(listHost, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  load();
}

/** Edit modal — name, associated Region, and the admin-only Court flag. */
function openNameModal(company, onSaved) {
  const name = el('input', { type: 'text', value: company.business || '' });

  const hold = el('select', {});
  hold.appendChild(el('option', { value: '' }, '— none —'));
  const holds = HOLDS.includes(company.hold) || !company.hold ? HOLDS : [company.hold, ...HOLDS];
  holds.forEach((h) => {
    const opt = el('option', { value: h }, h);
    if (h === company.hold) opt.selected = true;
    hold.appendChild(opt);
  });

  const court = el('input', { type: 'checkbox' });
  court.checked = !!company.court;

  const priority = el('input', { type: 'checkbox' });
  priority.checked = !!company.priority;

  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    const newName = name.value.trim();
    if (!newName) { setStatus('Company name is required.', 'error'); return; }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      // Preserve the current subscription while editing name / hold / court.
      await api.updateCompany({
        id: company.id, name: newName, until: company.until, perpetual: company.perpetual,
        hold: hold.value, court: court.checked, priority: priority.checked,
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
    el('label', {}, 'Company name'),
    name,
    el('p', { class: 'note' }, 'Renaming updates the company everywhere — its shop, staff, and records.'),
    el('label', {}, regionLabel()),
    hold,
    el('label', { class: 'inline' }, [court, document.createTextNode(' Court (admin-only flag)')]),
    el('label', { class: 'inline' }, [priority, document.createTextNode(' Priority (higher rate-limit ceiling)')]),
    save,
    status,
  ]);
}

/** Subscription modal — calendar picker or manual entry, plus Perpetual. */
function openSubscriptionModal(company, onSaved) {
  const perpetual = el('input', { type: 'checkbox' });
  perpetual.checked = !!company.perpetual;

  const picker = el('input', { type: 'date', value: company.until || '', class: 'date-picker' });
  const manual = el('input', { type: 'text', placeholder: 'YYYY-MM-DD', value: company.until || '' });

  // On desktop the native calendar only opens from the tiny icon, so make a
  // click anywhere on the field pop it. On touch devices the OS already opens
  // the calendar on tap — calling showPicker() there fights the native picker,
  // so we leave mobile to its built-in behaviour.
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!isTouch) {
    picker.addEventListener('click', () => { try { picker.showPicker(); } catch (e) { /* older browsers */ } });
  }

  // Keep the calendar picker and the manual field in sync.
  picker.addEventListener('input', () => { manual.value = picker.value; });
  manual.addEventListener('input', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(manual.value.trim())) picker.value = manual.value.trim();
  });

  function syncDisabled() {
    const off = perpetual.checked;
    picker.disabled = off;
    manual.disabled = off;
  }
  perpetual.addEventListener('change', syncDisabled);
  syncDisabled();

  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    const perp = perpetual.checked;
    const until = perp ? '' : (picker.value || manual.value.trim());
    if (!perp && until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      setStatus('Enter the date as YYYY-MM-DD, or use the calendar.', 'error');
      return;
    }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      // Keep the current name; only the subscription changes here.
      await api.updateCompany({ id: company.id, name: company.business, until, perpetual: perp });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Subscription — ' + (company.business || '')),
    el('label', { class: 'inline' }, [perpetual, document.createTextNode(' Perpetual (never expires)')]),
    el('label', {}, 'Expires — pick from the calendar'),
    picker,
    el('label', {}, '…or type it (YYYY-MM-DD)'),
    manual,
    save,
    status,
  ]);
}
