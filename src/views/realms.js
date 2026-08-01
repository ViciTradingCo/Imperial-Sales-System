/**
 * Realm Management — the page for running more than one server from a single
 * deployment. A realm is an independent world: its own shops, members, items,
 * holds, economy settings, and MOTD, with nothing shared or cross-referenced.
 *
 * This page is for the realms themselves: creating them, naming them, editing
 * each one's settings, and deleting them.
 *
 * CHOOSING which realm to work in is not here — that happens once, on the Admin
 * Panel, and filters the session from then on. Keeping the switch in a single
 * place means you can't change realm by reflex while you're in the middle of
 * editing one.
 *
 * Creating, renaming, and deleting are SUPER-ADMIN only (an address in
 * ADMIN_EMAILS). The Worker enforces that independently; hiding the controls
 * here is a courtesy, not the security.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { tileGrid, openFocalMenu } from '../lib/tiles.js';
import { renderSettingsForm } from './settings-form.js';
import { skeletonLines } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';

export function renderRealms(container, { me }) {
  const gridHost = el('div', {});
  let realms = [];

  mount(container, el('div.card', {}, [
    el('h2', {}, '🌐 Realm Management'),
    el('p', { class: 'note' }, 'A realm is a self-contained server: its own shops, members, item index, holds, ' +
      'economy settings, and notices. Nothing is shared between realms, and no report or search ever crosses ' +
      'from one into another.'),
    el('p', { class: 'note' }, [
      document.createTextNode('You are working in '),
      el('b', {}, me.realmName || me.activeRealm || 'your realm'),
      document.createTextNode('. To work in a different one, pick it on the Admin Panel.'),
    ]),
    gridHost,
  ]));

  draw({});
  refresh();
  api.getTiles().then((r) => draw(r.images || {})).catch(() => { /* glyphs are fine */ });

  async function refresh() {
    try { realms = (await api.getRealms()).realms || []; } catch (e) { realms = []; }
  }

  function sections() {
    return [
      { key: 'rlm-list', label: 'Realms', hint: 'Every server', glyph: '🌐',
        open: (host) => mount(host, realmListCard(me, refreshAnd(host))) },
      me.superAdmin ? { key: 'rlm-add', label: 'Add a realm', hint: 'Start a new server', glyph: '➕',
        open: (host) => mount(host, createRealmCard(refresh)) } : null,
      // Moving someone who joined the wrong realm belongs with the realms
      // themselves, not on the Admin Panel.
      me.superAdmin ? { key: 'transfers', label: 'Transfers', hint: 'Move members & shops', glyph: '🔀',
        open: (host) => mount(host, transferCard(() => realms, me)) } : null,
    ].filter(Boolean);
  }

  /** Re-renders an open focal menu after a change to the realm list. */
  function refreshAnd(host) {
    return async () => {
      await refresh();
      mount(host, realmListCard(me, refreshAnd(host)));
      draw({});
    };
  }

  function draw(images) {
    mount(gridHost, tileGrid(sections().map((s) => ({
      key: s.key, label: s.label, hint: s.hint, glyph: s.glyph,
      onOpen: () => openFocalMenu(s.label, (host) => s.open(host)),
    })), images));
  }

  /** The realm list, with each realm's own settings and deletion. */
  function realmListCard(me, onChanged) {
    const listHost = el('div', {}, skeletonLines(3));
    api.getRealms().then((r) => {
      realms = r.realms || [];
      if (!realms.length) { mount(listHost, emptyState('🌐', 'No realms yet', 'Add one to get started.')); return; }
      mount(listHost, el('div', { class: 'realm-list' }, realms.map((x) => realmRow(x, onChanged))));
    }).catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
    return el('div.card', {}, [el('h3', {}, 'Realms'), listHost]);
  }

  function realmRow(r, onChanged) {
    const active = r.id === me.activeRealm;
    return el('div', { class: 'realm-row' + (active ? ' is-active' : '') }, [
      el('div', { class: 'realm-id' }, [
        el('span', { class: 'realm-name' }, r.name),
        el('span', { class: 'note' }, r.companies + ' shop' + (r.companies === 1 ? '' : 's') +
          ' · ' + r.members + ' member' + (r.members === 1 ? '' : 's')),
      ]),
      el('div', { class: 'realm-actions' }, [
        active ? el('span', { class: 'realm-badge' }, 'Viewing') : null,
        me.superAdmin ? el('button.secondary-btn', { onclick: () => openRealmSettings(r, onChanged) }, 'Settings') : null,
        me.superAdmin && r.id !== 'default'
          ? el('button.danger', { onclick: () => doDelete(r, onChanged) }, 'Delete')
          : null,
      ].filter(Boolean)),
    ]);
  }

  async function doDelete(r, onChanged) {
    if (!window.confirm('DELETE THE REALM "' + r.name + '"?\n\nThis permanently removes its ' + r.companies +
      ' shop(s), ' + r.members + ' member(s), and every sale, intake, transfer, coffer entry, item, hold, ' +
      'setting, and notice inside it.\n\nThis CANNOT be undone. Export a backup first.')) return;
    const typed = window.prompt('Type the realm name exactly to confirm:\n' + r.name);
    if (typed !== r.name) { toast('Delete cancelled.', ''); return; }
    try {
      await api.deleteRealm(r.id);
      toast('Realm "' + r.name + '" deleted.', 'ok');
      await onChanged();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  /**
   * A realm's own settings. Network Settings live HERE rather than in the admin
   * panel, because each realm runs its own economy and needs its own thresholds.
   * Editing them requires that realm to be the one selected, since the API
   * always writes to the realm the caller is viewing.
   */
  function openRealmSettings(r, onChanged) {
    openFocalMenu(r.name, (host) => {
      const nameInput = el('input', { type: 'text', value: r.name });
      const renameStatus = el('p', {});
      const nameCard = el('div.card', {}, [
        el('h3', {}, 'Name'),
        el('p', { class: 'note' }, 'What this realm is called on the Admin Panel and in this list.'),
        nameInput,
        el('div', { class: 'row-actions' }, [el('button.primary', { onclick: doRename }, 'Save name')]),
        renameStatus,
      ]);
      async function doRename() {
        renameStatus.className = ''; renameStatus.textContent = 'Saving…';
        try {
          await api.renameRealm(r.id, nameInput.value.trim());
          renameStatus.textContent = '';
          toast('Realm renamed', 'ok');
          await onChanged();
        } catch (e) { renameStatus.className = 'error'; renameStatus.textContent = e.message || String(e); }
      }

      if (r.id !== me.activeRealm) {
        mount(host, nameCard, el('div.card', {}, [
          el('h3', {}, 'Network Settings'),
          el('p', { class: 'note' }, 'Each realm keeps its own sync cadence and market thresholds. Settings always ' +
            'apply to the realm you are viewing, so to edit ' + esc(r.name) + '’s, select it on the Admin Panel ' +
            'first. That way you can never edit one realm while looking at another.'),
        ]));
        return;
      }

      const settingsHost = el('div', {});
      mount(host, nameCard, settingsHost);
      renderSettingsForm(settingsHost, {
        title: 'Network Settings',
        subtitle: 'Sync cadence and market anomaly thresholds for ' + r.name + ' only.',
        load: async () => (await api.getSettings()).settings,
        save: async (updates) => (await api.saveSettings(updates)).settings,
      });
    });
  }
}

/** Create a realm: a name, and the settings it starts with (the defaults). */
function createRealmCard(onCreated) {
  const name = el('input', { type: 'text', placeholder: 'e.g. Tamriel Reborn' });
  const status = el('p', {});
  const btn = el('button.primary', { onclick: doCreate }, 'Create realm');

  async function doCreate() {
    const nm = name.value.trim();
    if (!nm) { status.className = 'error'; status.textContent = 'Enter a realm name.'; return; }
    btn.disabled = true; status.className = ''; status.textContent = 'Creating…';
    try {
      const r = await api.createRealm(nm);
      name.value = '';
      status.textContent = '';
      toast('Realm "' + r.realm.name + '" created', 'ok');
      await onCreated();
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { btn.disabled = false; }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Add a realm'),
    el('p', { class: 'note' }, 'A new realm starts completely empty — no shops, no members, no items — with the ' +
      'default holds and economy settings. Give it a name; everything else is configured from its Settings once ' +
      'you switch to it.'),
    el('label', {}, 'Realm name'),
    name,
    el('div', { class: 'row-actions' }, [btn]),
    status,
  ]);
}

/**
 * Moving between realms — the repair tool for the most likely mistake, someone
 * picking the wrong realm when they signed up.
 *
 * "Transfer from" defaults to the realm currently being viewed, which is the
 * usual case, but can be changed: a misplaced account is often spotted while
 * working somewhere else, and making you switch realms first just to move one
 * person is busywork. Changing it reloads the member and company lists from that
 * realm, so you always pick from the source you named.
 *
 * A member moves alone; their business is kept only if a shop of that name also
 * exists in the destination, otherwise they arrive unassigned. A company moves
 * with its whole roster, and is refused if the name (or any member's email) is
 * already taken over there.
 */
export function transferCard(getRealms, me) {
  const fromSel = el('select', {});
  const memberSel = el('select', {});
  const memberTo = el('select', {});
  const companySel = el('select', {});
  const companyTo = el('select', {});
  const status = el('p', {});
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  function fill(sel, realms, selected) {
    sel.innerHTML = '';
    realms.forEach((r) => {
      const o = el('option', { value: r.id }, r.name);
      if (r.id === selected) o.selected = true;
      sel.appendChild(o);
    });
  }

  let allRealms = [];

  /** Loads the realm list, then the contents of whichever realm is the source. */
  async function init() {
    try {
      allRealms = (getRealms && getRealms()) || [];
      if (!allRealms.length) allRealms = (await api.getRealms()).realms || [];
      // Default the source to the realm being viewed.
      fill(fromSel, allRealms, (me && me.activeRealm) || '');
      fill(memberTo, allRealms);
      fill(companyTo, allRealms);
      await loadSource();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  /** Member + company lists for the SOURCE realm, not necessarily the active one. */
  async function loadSource() {
    const from = fromSel.value;
    memberSel.innerHTML = ''; companySel.innerHTML = '';
    try {
      const [m, c] = await Promise.all([api.getMembers(from), api.getCompanies(from)]);
      (m.members || []).forEach((u) => memberSel.appendChild(
        el('option', { value: u.uid }, (u.character || u.email) + (u.business ? ' — ' + u.business : ' — (no shop)'))));
      (c.companies || []).forEach((co) => companySel.appendChild(el('option', { value: co.id }, co.business)));
      if (!(m.members || []).length) setStatus('That realm has no members.', '');
      else setStatus('', '');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }
  fromSel.addEventListener('change', loadSource);
  init();

  function fromName() { return fromSel.options[fromSel.selectedIndex] ? fromSel.options[fromSel.selectedIndex].textContent : 'this realm'; }

  async function moveMember() {
    if (!memberSel.value) { setStatus('Pick a member.', 'error'); return; }
    const label = memberSel.options[memberSel.selectedIndex].textContent;
    const to = memberTo.options[memberTo.selectedIndex].textContent;
    if (memberTo.value === fromSel.value) { setStatus('Pick a different destination realm.', 'error'); return; }
    if (!window.confirm('Move ' + label + ' from ' + fromName() + ' to ' + to + '?\n\nThey keep their shop only ' +
      'if one of the same name exists there; otherwise they arrive with no shop assigned.')) return;
    setStatus('Moving…', '');
    try {
      const r = await api.transferMemberRealm(memberSel.value, memberTo.value, fromSel.value);
      setStatus('Moved to ' + to + (r.businessCleared ? ' — no matching shop there, so they arrive unassigned.' : '.'), 'ok');
      toast('Member moved', 'ok');
      await loadSource();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  async function moveCompany() {
    if (!companySel.value) { setStatus('Pick a company.', 'error'); return; }
    const label = companySel.options[companySel.selectedIndex].textContent;
    const to = companyTo.options[companyTo.selectedIndex].textContent;
    if (companyTo.value === fromSel.value) { setStatus('Pick a different destination realm.', 'error'); return; }
    if (!window.confirm('Move ' + label + ' and its whole roster from ' + fromName() + ' to ' + to + '?\n\n' +
      'Its inventory, sales, intake, coffers, discounts, and notices go with it. Completed transfers stay behind ' +
      'as history in the source realm.')) return;
    setStatus('Moving…', '');
    try {
      const r = await api.transferCompanyRealm(companySel.value, companyTo.value, fromSel.value);
      setStatus('Moved ' + label + ' and ' + r.members + ' member(s) to ' + to + '.', 'ok');
      toast('Company moved', 'ok');
      await loadSource();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Move between realms'),
    el('p', { class: 'note' }, 'For when someone chose the wrong realm when they registered.'),

    el('label', {}, 'Transfer from'),
    fromSel,
    el('p', { class: 'note' }, 'Defaults to the realm you are viewing. The lists below come from whichever realm ' +
      'you pick here.'),

    el('h4', {}, 'Move a member'),
    el('label', {}, 'Member'), memberSel,
    el('label', {}, 'Move to realm'), memberTo,
    el('div', { class: 'row-actions' }, [el('button.secondary-btn', { onclick: moveMember }, 'Move member')]),

    el('h4', {}, 'Move a company'),
    el('label', {}, 'Company'), companySel,
    el('label', {}, 'Move to realm'), companyTo,
    el('p', { class: 'note' }, 'The whole shop travels: its staff, stock, sales history, and coffers. Settle any ' +
      'pending transfers first — a transfer names two shops, and the other end would be left behind.'),
    el('div', { class: 'row-actions' }, [el('button.secondary-btn', { onclick: moveCompany }, 'Move company')]),

    status,
  ]);
}
