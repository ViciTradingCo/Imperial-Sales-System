/**
 * Company List (admin) — every registered company. Each has:
 *   • Edit — a focus modal to rename the company (propagated everywhere).
 *   • Subscription — its own focus modal to set when the subscription expires
 *     (calendar picker OR manual entry) or mark it Perpetual.
 *   • Ledger — a READ-ONLY look at the shop's books: coffer, discounts, style,
 *     and what it sells. Admins look; owners keep them.
 */
import { regionLabel, regionWord, money, TRAVELING, isTraveling, certificationOn } from '../lib/format.js';
import { el, mount, esc, tableEl, statTiles } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { pager } from '../lib/paginate.js';
import { openFocalMenu } from '../lib/tiles.js';
import { toast } from '../lib/toast.js';
import { emptyState } from '../lib/empty.js';

const PAGE_SIZE = 25;

export function renderCompanies(container, { me } = {}) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const listHost = el('div', {}, skeletonRows(5));
  const search = el('input', { type: 'search', placeholder: 'Search business, contact, ' + regionWord() + ', status…' });
  let page = 1;
  search.addEventListener('input', () => { page = 1; draw(); });
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Company List'),
    el('p', { class: 'note' }, certificationOn()
      ? 'Every registered business. Edit renames a company, Subscription sets its ' +
        'certification, and Ledger opens a read-only view of its books.'
      : 'Every registered business. Edit renames a company and Ledger opens a read-only view of its books. ' +
        'This realm does not require certification, so there are no subscriptions to set.'),
    el('div', { class: 'row-actions' }, [
      el('button.secondary-btn', { onclick: () => openArchiveModal(load) }, 'Archived companies'),
    ]),
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
      // A realm that does not require certification has nothing to say here:
      // the dates are still stored, but they decide nothing, and reading
      // "no subscription" beside a shop that trades freely is a puzzle.
      const sub = !certificationOn()
        ? 'certification not required in this realm'
        : (c.perpetual ? 'Perpetual' : (c.until ? 'until ' + c.until : 'no subscription'));
      // With certification off, the stored VALID/EXPIRED decides nothing — so
      // the pill says what is actually true of the shop instead of quoting a
      // date that stopped mattering.
      const certOn = certificationOn();
      const statusText = certOn ? (c.status || '—') : 'Trading';
      const statusCls = !certOn || String(c.status).toUpperCase() === 'VALID' ? 'ok' : 'bad';
      const court = c.court ? ' <span class="role-pill">Court</span>' : '';
      const realmPill = (me && me.realmCount > 1 && c.realmId)
        ? ' <span class="realm-pill">' + esc(c.realmName || c.realmId) + '</span>' : '';
      const holdLine = c.hold ? '<br><span class="note">' + esc(regionLabel()) + ': ' + esc(c.hold) + '</span>' : '';
      return el('div', { class: 'member-row' }, [
        el('p', { html:
          '<b>' + esc(c.business || '—') + '</b> · <span class="' + statusCls + '">' + esc(statusText) + '</span>' + court + realmPill + '<br>' +
          '<span class="note">' + esc(sub) + (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' + holdLine }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openNameModal(c, load) }, 'Edit'),
          certOn
            ? el('button.secondary-btn.small', { onclick: () => openSubscriptionModal(c, load) }, 'Subscription')
            : null,
          el('button.secondary-btn.small', { onclick: () => openLedgerModal(c) }, 'Ledger'),
          el('button.danger.small', { onclick: () => remove(c) }, 'Archive'),
        ].filter(Boolean)),
      ]);
    }));
  }

  /**
   * Archiving is not deleting, and the wording has to say so — the button read
   * "Delete" and warned that the records "can never be pulled back", which was
   * true of a REMADE company pulling the old one's history, and read as "this
   * is gone forever". Nothing is destroyed; the shop leaves the list and can be
   * brought back exactly as it was.
   */
  async function remove(c) {
    if (!window.confirm('Archive "' + (c.business || 'this company') + '"?\n\n' +
      'It stops trading and leaves this list. Nothing is deleted — its people, stock, books and ' +
      'settings are all kept, and you can restore it exactly as it is from Archived companies.\n\n' +
      'Its trade leaves Market Analysis with it: item values, region totals and the company table ' +
      'stop counting a shop that is no longer trading here. Restoring it puts every figure back.\n\n' +
      'The name "' + (c.business || '') + '" becomes free for someone else. If it is taken before you ' +
      'restore this one, you will be asked to sort that out first.')) return;
    mount(listHost, el('p', { class: 'note' }, 'Archiving…'));
    try {
      const res = await api.archiveCompany(c.id);
      all = res.companies || [];
      draw();
      toast('Archived. You can restore it from Archived companies.', 'ok');
    } catch (e) {
      mount(listHost, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  load();
}

/**
 * A company's ledger, as an admin sees it: coffer balance and recent movements,
 * the shop's own discounts and style, its headline performance, and what it
 * sells most.
 *
 * READ ONLY. An admin's job here is to look — the write paths (adjusting the
 * coffer, editing discounts) belong to the owner running that shop, and an
 * admin who moved someone else's gold from a list screen would have no way to
 * explain it. Renaming and certification, which ARE the admin's job, are the
 * two buttons beside this one.
 */
function openLedgerModal(company) {
  const name = company.business || 'this company';
  openFocalMenu(name + " — ledger", (host) => {
    mount(host, el('p', { class: 'note' }, 'Loading…'));
    api.getCompanyLedger(name)
      .then((d) => mount(host, ...ledgerBody(d)))
      .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  });
}

function ledgerBody(d) {
  const o = d.overview || {};
  const coffer = d.coffer || {};
  const entries = coffer.entries || [];
  const discounts = d.discounts || [];
  const style = d.style || {};
  const items = d.items || [];

  const nodes = [
    el('p', { class: 'note' }, 'Read only — an admin views a shop\'s books; the owner keeps them.'),
    statTiles([
      ['Coffer', money(coffer.balance || 0)],
      ['Revenue', money(o.revenue || 0)],
      ['Orders', String(o.orders || 0)],
      ['Items sold', String(o.itemsSold || 0)],
    ]),
    el('h4', {}, 'Recent coffer activity'),
  ];

  nodes.push(entries.length
    ? el('div', {}, entries.slice(0, 15).map((e) => el('div.emp-row', {}, [
        el('span', { html: '<b>' + (Number(e.amount) >= 0 ? '+' : '') + esc(money(e.amount)) + '</b> ' +
          '<span class="note">' + esc(e.kind) + (e.note ? ' · ' + esc(e.note) : '') + ' · ' +
          esc(String(e.ts || '').slice(0, 10)) + '</span>' }),
      ])))
    : el('p', { class: 'note' }, 'No coffer activity yet.'));

  nodes.push(el('h4', {}, 'Top items'));
  nodes.push(items.length
    ? el('div', { class: 'table-scroll' }, tableEl(['Item', 'Qty sold', 'Revenue'],
        items.map((i) => [i.item, i.qty, money(i.revenue)])))
    : el('p', { class: 'note' }, 'Nothing sold yet.'));

  nodes.push(el('h4', {}, 'Discounts'));
  nodes.push(discounts.length
    ? el('div', {}, discounts.map((x) => el('p', { class: 'note' }, x.name + ' — ' + x.percent + '%')))
    : el('p', { class: 'note' }, 'No named discounts.'));

  if (style.tagline || style.accent) {
    nodes.push(el('h4', {}, 'Shop style'));
    nodes.push(el('p', { class: 'note' }, (style.tagline || 'No tagline') +
      (style.accent ? ' · accent ' + style.accent : '')));
  }
  return nodes;
}

/** Edit modal — name, associated Region, and the admin-only Court flag. */
function openNameModal(company, onSaved) {
  const name = el('input', { type: 'text', value: company.business || '' });

  /**
   * The region select — THE REALM'S OWN regions, plus Traveling.
   *
   * The list here used to be the nine Skyrim holds, written into this file. A
   * realm that had named its own regions in Network Settings was therefore
   * offered somebody else's on this screen, and a company could be filed under
   * a region its own register has never heard of.
   *
   * Repainted rather than appended to, because the list arrives over the
   * network while the modal is already open: whatever is currently chosen is
   * carried across each repaint, so a save that lands before the regions do
   * cannot write "— none —" over a region nobody meant to clear. A region the
   * realm has since dropped is kept for the same reason — editing a company's
   * NAME must not quietly move it out of its region.
   */
  const hold = el('select', {});
  function paintRegions(list) {
    const chosen = hold.value || company.hold || '';
    hold.replaceChildren(el('option', { value: '' }, '— none —'));
    const opts = list.slice();
    if (chosen && !isTraveling(chosen) && !opts.includes(chosen)) opts.push(chosen);
    opts.forEach((h) => hold.appendChild(el('option', { value: h }, h)));
    // Last, and spelled out: it is not a place, it is the absence of one.
    hold.appendChild(el('option', { value: TRAVELING }, TRAVELING + ' — no fixed ' + regionWord()));
    hold.value = isTraveling(chosen) ? TRAVELING : chosen;
  }
  paintRegions(company.hold && !isTraveling(company.hold) ? [company.hold] : []);
  api.getRegions().then((r) => paintRegions(r.holds || [])).catch(() => { /* keep what it has */ });

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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Subscription modal — one native date field, plus Perpetual.
 *
 * ONE FIELD. It used to be a date input AND a free-text "YYYY-MM-DD" box kept
 * in sync, which gave every platform the wrong answer: on a phone the plain
 * text box is the inviting one to tap, so people typed a date by hand next to a
 * control that would have opened the OS date wheel; and two fields that must
 * agree is where "which one wins" bugs live. A date input already accepts
 * typing — it is segmented — so the second box bought nothing.
 *
 * AND NO CLICK HANDLER. The old code called showPicker() from the field's own
 * click. Chrome, Edge and Firefox all open the calendar when you click a date
 * field, so that fired a SECOND open on the same gesture and the panel toggled
 * straight back shut — which is why the calendar looked broken on a PC. The
 * button below is a separate target, so it cannot fight the field.
 */
function openSubscriptionModal(company, onSaved) {
  const perpetual = el('input', { type: 'checkbox' });
  perpetual.checked = !!company.perpetual;

  const stored = String(company.until || '').trim();
  const picker = el('input', { type: 'date', value: YMD.test(stored) ? stored : '' });

  // An explicit way in for anyone whose browser does not open the calendar on
  // click, and a visible affordance rather than the tiny built-in icon. Hidden
  // where showPicker() does not exist, so it is never a button that does
  // nothing — there, clicking the field is the way, as it always was.
  const openBtn = el('button.secondary-btn.small', {
    type: 'button',
    onclick: () => { picker.focus(); try { picker.showPicker(); } catch (e) { /* already open, or refused */ } },
  }, '📅 Calendar');
  openBtn.hidden = typeof picker.showPicker !== 'function';
  // Clearing matters: an empty date is "no subscription", and not every browser
  // offers a way to empty a date field once it has one.
  const clearBtn = el('button.secondary-btn.small', {
    type: 'button', onclick: () => { picker.value = ''; },
  }, 'Clear');

  function syncDisabled() {
    const off = perpetual.checked;
    picker.disabled = off;
    openBtn.disabled = off;
    clearBtn.disabled = off;
  }
  perpetual.addEventListener('change', syncDisabled);
  syncDisabled();

  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    const perp = perpetual.checked;
    const until = perp ? '' : picker.value;
    if (!perp && until && !YMD.test(until)) {
      setStatus('Pick a date from the calendar.', 'error');
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
    el('label', {}, 'Expires'),
    el('div', { class: 'date-row' }, [picker, openBtn, clearBtn]),
    // A stored value the date field cannot show would otherwise just look
    // blank, and saving would quietly wipe it.
    ...(stored && !YMD.test(stored)
      ? [el('p', { class: 'note warn' }, 'Currently stored as "' + stored + '", which is not a date this ' +
          'field can show. Picking one will replace it.')]
      : []),
    el('p', { class: 'note' }, 'Leave it empty for no subscription. Type into the field or use the calendar.'),
    save,
    status,
  ]);
}

/**
 * THE ARCHIVE — shops that have left, and the way back.
 *
 * Archiving was a one-way door dressed up as a delete: it renamed the company
 * and everything it owned to a unique key and there was no screen that could
 * see the result, let alone undo it. A shop that leaves the server and comes
 * back a month later is an ordinary thing to happen, and it should not cost
 * everyone their inventory, their books and their roster.
 *
 * Restoring puts the NAME back, and everything follows it — the people, the
 * stock, the sales, the coffer, the settings — because they were all renamed
 * together and are renamed back together.
 */
function openArchiveModal(onRestored) {
  const listHost = el('div', {}, skeletonRows(3));
  let modal;

  function load() {
    api.getArchivedCompanies()
      .then((r) => draw(r.archived || []))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw(rows) {
    if (!rows.length) {
      mount(listHost, emptyState({ glyph: '🗄️', title: 'Nothing archived',
        hint: 'Companies you archive from the list appear here, ready to be restored.' }));
      return;
    }
    mount(listHost, ...rows.map((c) => el('div', { class: 'member-row' }, [
      el('p', { html:
        '<b>' + esc(c.archivedFrom || c.business) + '</b>' +
        '<br><span class="note">' + (c.archivedAt ? 'Archived ' + esc(c.archivedAt.slice(0, 10)) : 'Archived') +
        (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => restore(c) }, 'Restore'),
      ]),
    ])));
  }

  async function restore(c) {
    const name = c.archivedFrom || c.business;
    if (!window.confirm('Restore "' + name + '"?\n\n' +
      'It comes back exactly as it was — its people, stock, books and settings all return with it, ' +
      'and it takes its old name back.')) return;
    mount(listHost, el('p', { class: 'note' }, 'Restoring…'));
    try {
      const res = await api.restoreCompany(c.id);
      draw(res.archived || []);
      toast(res.business + ' is back.', 'ok');
      onRestored(); // the main list has gained a company
    } catch (e) {
      // The likely failure is the name having been taken while it was away, and
      // that message explains what to do about it — so it is shown in place
      // rather than as a toast that vanishes before it can be read.
      mount(listHost, el('p', { class: 'error' }, e.message || String(e)));
      const back = el('button.secondary-btn.small', { onclick: load }, 'Back to the archive');
      listHost.appendChild(el('div', { class: 'row-actions' }, [back]));
    }
  }

  load();
  modal = openModal([
    el('h3', {}, '🗄️ Archived companies'),
    el('p', { class: 'note' }, 'Shops that have left the network. Nothing here has been deleted — restoring ' +
      'one brings it back exactly as it was, with its people, stock, books and settings.'),
    el('p', { class: 'note' }, 'A restored company takes its old name back, so if somebody else has ' +
      'registered under that name since, you will be asked to sort that out first.'),
    listHost,
  ]);
  return modal;
}
