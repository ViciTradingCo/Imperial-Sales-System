/**
 * Realm Management — the page for running more than one server from a single
 * deployment. A realm is an independent world: its own shops, members, items,
 * holds, economy settings, and MOTD, with nothing shared or cross-referenced.
 *
 * Three parts, in the order you actually use them:
 *   1. Which realm the app is showing (and how to switch).
 *   2. Creating a realm, and each realm's own settings.
 *   3. Moving a member or a shop that landed in the wrong realm.
 *
 * Creating, renaming, deleting, and moving are SUPER-ADMIN only (an address in
 * ADMIN_EMAILS). The Worker enforces that independently; hiding the controls
 * here is a courtesy, not the security.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { openFocalMenu } from '../lib/tiles.js';
import { renderSettingsForm } from './settings-form.js';
import { skeletonLines } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';

export function renderRealms(container, { me, onRealmChanged }) {
  const listHost = el('div', {}, skeletonLines(3));
  const createHost = el('div', {});
  const transferHost = el('div', {});
  let realms = [];

  mount(container,
    el('div.card', {}, [
      el('h2', {}, '🌐 Realm Management'),
      el('p', { class: 'note' }, 'A realm is a self-contained server: its own shops, members, item index, holds, ' +
        'economy settings, and notices. Nothing is shared between realms, and no report or search ever crosses ' +
        'from one into another.'),
      el('p', { class: 'note' }, [
        document.createTextNode('The app is currently showing '),
        el('b', {}, me.realmName || me.activeRealm || 'your realm'),
        document.createTextNode('. Everything you see elsewhere — members, companies, market, settings — belongs to it.'),
      ]),
    ]),
    el('div.card', {}, [el('h3', {}, 'Realms'), listHost]),
    createHost,
    transferHost);

  if (me.superAdmin) {
    mount(createHost, createRealmCard(refresh));
    mount(transferHost, transferCard(() => realms));
  }

  refresh();

  async function refresh() {
    try {
      const r = await api.getRealms();
      realms = r.realms || [];
      drawList();
    } catch (e) {
      mount(listHost, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  function drawList() {
    if (!realms.length) { mount(listHost, emptyState('🌐', 'No realms yet', 'Create one below.')); return; }
    mount(listHost, el('div', { class: 'realm-list' }, realms.map(realmRow)));
  }

  function realmRow(r) {
    const active = r.id === me.activeRealm;
    const row = el('div', { class: 'realm-row' + (active ? ' is-active' : '') }, [
      el('div', { class: 'realm-id' }, [
        el('span', { class: 'realm-name' }, r.name),
        el('span', { class: 'note' }, r.companies + ' shop' + (r.companies === 1 ? '' : 's') +
          ' · ' + r.members + ' member' + (r.members === 1 ? '' : 's')),
      ]),
      el('div', { class: 'realm-actions' }, [
        active
          ? el('span', { class: 'realm-badge' }, 'Viewing')
          : (me.superAdmin ? el('button.secondary-btn', { onclick: () => switchTo(r) }, 'View this realm') : null),
        me.superAdmin ? el('button.secondary-btn', { onclick: () => openRealmSettings(r) }, 'Settings') : null,
        me.superAdmin && r.id !== 'default'
          ? el('button.danger', { onclick: () => doDelete(r) }, 'Delete')
          : null,
      ].filter(Boolean)),
    ]);
    return row;
  }

  async function switchTo(r) {
    try {
      await api.selectRealm(r.id);
      toast('Now showing ' + r.name, 'ok');
      // The whole app is realm-scoped, so re-read the profile and redraw rather
      // than leaving other pages showing the realm we just left.
      if (onRealmChanged) await onRealmChanged();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  async function doDelete(r) {
    if (!window.confirm('DELETE THE REALM "' + r.name + '"?\n\nThis permanently removes its ' + r.companies +
      ' shop(s), ' + r.members + ' member(s), and every sale, intake, transfer, coffer entry, item, hold, ' +
      'setting, and notice inside it.\n\nThis CANNOT be undone. Export a backup first.')) return;
    const typed = window.prompt('Type the realm name exactly to confirm:\n' + r.name);
    if (typed !== r.name) { toast('Delete cancelled.', ''); return; }
    try {
      await api.deleteRealm(r.id);
      toast('Realm "' + r.name + '" deleted.', 'ok');
      await refresh();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  /**
   * A realm's own settings. Network Settings live HERE rather than in the admin
   * panel, because each realm runs its own economy and needs its own thresholds.
   * Editing them requires viewing that realm, since the API always writes to the
   * realm the caller is currently in.
   */
  function openRealmSettings(r) {
    openFocalMenu(r.name, (host) => {
      const nameInput = el('input', { type: 'text', value: r.name });
      const renameStatus = el('p', {});
      const nameCard = el('div.card', {}, [
        el('h3', {}, 'Name'),
        el('p', { class: 'note' }, 'What this realm is called in the switcher and on this page.'),
        nameInput,
        el('div', { class: 'row-actions' }, [
          el('button.primary', { onclick: doRename }, 'Save name'),
        ]),
        renameStatus,
      ]);
      async function doRename() {
        renameStatus.className = ''; renameStatus.textContent = 'Saving…';
        try {
          await api.renameRealm(r.id, nameInput.value.trim());
          renameStatus.textContent = '';
          toast('Realm renamed', 'ok');
          await refresh();
        } catch (e) { renameStatus.className = 'error'; renameStatus.textContent = e.message || String(e); }
      }

      if (r.id !== me.activeRealm) {
        mount(host, nameCard, el('div.card', {}, [
          el('h3', {}, 'Network Settings'),
          el('p', { class: 'note' }, 'Each realm keeps its own sync cadence and market thresholds. Switch to ' +
            esc(r.name) + ' to edit them — settings always apply to the realm you are viewing, so this avoids ' +
            'editing one realm while looking at another.'),
          el('div', { class: 'row-actions' }, [
            el('button.secondary-btn', { onclick: () => switchTo(r) }, 'View this realm'),
          ]),
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
 * Moving between realms. This is the repair tool for the most likely mistake —
 * someone picking the wrong realm when they signed up.
 *
 * A member moves alone; their business is kept only if a shop of that name also
 * exists in the destination, otherwise they arrive unassigned. A company moves
 * with its whole roster, and is refused if the name (or any member's email) is
 * already taken over there.
 */
function transferCard(getRealms) {
  const memberSel = el('select', {});
  const memberTo = el('select', {});
  const companySel = el('select', {});
  const companyTo = el('select', {});
  const status = el('p', {});
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  function fillRealms(sel) {
    sel.innerHTML = '';
    getRealms().forEach((r) => sel.appendChild(el('option', { value: r.id }, r.name)));
  }

  async function load() {
    try {
      const [m, c] = await Promise.all([api.getMembers(), api.getCompanies()]);
      memberSel.innerHTML = '';
      (m.members || []).forEach((u) => memberSel.appendChild(
        el('option', { value: u.uid }, (u.character || u.email) + (u.business ? ' — ' + u.business : ' — (no shop)'))));
      companySel.innerHTML = '';
      (c.companies || []).forEach((co) => companySel.appendChild(el('option', { value: co.id }, co.business)));
      fillRealms(memberTo); fillRealms(companyTo);
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }
  load();

  async function moveMember() {
    if (!memberSel.value) { setStatus('Pick a member.', 'error'); return; }
    const label = memberSel.options[memberSel.selectedIndex].textContent;
    const to = memberTo.options[memberTo.selectedIndex].textContent;
    if (!window.confirm('Move ' + label + ' to ' + to + '?\n\nThey keep their shop only if one of the same name ' +
      'exists there; otherwise they arrive with no shop assigned.')) return;
    setStatus('Moving…', '');
    try {
      const r = await api.transferMemberRealm(memberSel.value, memberTo.value);
      setStatus('Moved to ' + to + (r.businessCleared ? ' — no matching shop there, so they arrive unassigned.' : '.'), 'ok');
      toast('Member moved', 'ok');
      await load();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  async function moveCompany() {
    if (!companySel.value) { setStatus('Pick a company.', 'error'); return; }
    const label = companySel.options[companySel.selectedIndex].textContent;
    const to = companyTo.options[companyTo.selectedIndex].textContent;
    if (!window.confirm('Move ' + label + ' and its whole roster to ' + to + '?\n\nIts inventory, sales, intake, ' +
      'coffers, discounts, and notices go with it. Completed transfers stay behind as history in this realm.')) return;
    setStatus('Moving…', '');
    try {
      const r = await api.transferCompanyRealm(companySel.value, companyTo.value);
      setStatus('Moved ' + label + ' and ' + r.members + ' member(s) to ' + to + '.', 'ok');
      toast('Company moved', 'ok');
      await load();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  return el('div.card', {}, [
    el('h3', {}, 'Move between realms'),
    el('p', { class: 'note' }, 'For when someone chose the wrong realm when they registered. Both lists show the ' +
      'realm you are currently viewing.'),

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
