/**
 * Member List (admin) — every user with character, company, UID, and role.
 * Each has an Edit focus modal to change character name, company, and role.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { pager } from '../lib/paginate.js';

const PAGE_SIZE = 25;

export function renderMembers(container) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading members…'));
  const search = el('input', { type: 'search', placeholder: 'Search name, business, email, role…' });
  let page = 1;
  search.addEventListener('input', () => { page = 1; draw(); });
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Member List'),
    el('p', { class: 'note' }, 'Everyone registered in the Vici trading network.'),
    search,
    listHost,
  ]));

  let all = [];
  function load() {
    api.getMembers()
      .then((res) => { all = res.members || []; draw(); })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const members = !q ? all : all.filter((m) =>
      [m.character, m.email, m.business, m.role, m.uid].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!members.length) { mount(listHost, el('p', { class: 'note' }, all.length ? 'No matches.' : 'No members yet.')); return; }
    const pg = pager(members.length, page, PAGE_SIZE, (n) => { page = n; draw(); });
    page = pg.page;
    renderList(members.slice(pg.start, pg.end));
    listHost.appendChild(pg.bar);
  }

  function renderList(members) {
    mount(listHost, ...members.map((m) => el('div', { class: 'member-row' }, [
      el('p', { html:
        '<b>' + esc(m.character || m.email || '—') + '</b> · <span class="role-pill">' + esc(m.role) + '</span> ' +
        (m.status === 'pending' ? '<span class="warn">pending</span>' : '') + '<br>' +
        '<span class="note">' + esc(m.business || '—') + ' · ' + esc(m.email || '') + '</span><br>' +
        '<span class="note">UID: <code>' + esc(m.uid) + '</code></span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => openEditModal(m, load) }, 'Edit'),
        el('button.danger.small', { onclick: () => remove(m) }, 'Delete'),
      ]),
    ])));
  }

  async function remove(m) {
    const who = m.character || m.email || m.uid;
    if (!window.confirm('Remove ' + who + ' from the network? They can register again afterwards.')) return;
    mount(listHost, el('p', { class: 'note' }, 'Removing…'));
    try {
      const res = await api.deleteMember(m.uid);
      all = res.members || [];
      draw();
    } catch (e) {
      mount(listHost, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  load();
}

function openEditModal(member, onSaved) {
  const character = el('input', { type: 'text', value: member.character || '' });
  const business = el('input', { type: 'text', value: member.business || '' });
  const role = el('select', {});
  ['employee', 'owner', 'admin'].forEach((r) => {
    const opt = el('option', { value: r }, r);
    if (r === member.role) opt.selected = true;
    role.appendChild(opt);
  });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.updateMember({
        uid: member.uid,
        character: character.value.trim(),
        business: business.value.trim(),
        role: role.value,
      });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Edit member'),
    el('label', {}, 'Character name'), character,
    el('label', {}, 'Company'), business,
    el('label', {}, 'Role'), role,
    el('p', { class: 'note', html: 'UID: <code>' + esc(member.uid) + '</code> · ' + esc(member.email || '') }),
    save,
    status,
  ]);
}
