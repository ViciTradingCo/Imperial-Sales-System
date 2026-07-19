/**
 * Member List (admin) — every user in the system with their character name,
 * company, UID, and role. Read-only.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';

export function renderMembers(container) {
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading members…'));
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Member List'),
    el('p', { class: 'note' }, 'Everyone registered in the East Empire network.'),
    listHost,
  ]));

  api.getMembers()
    .then((res) => renderList(res.members || []))
    .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));

  function renderList(members) {
    if (!members.length) { mount(listHost, el('p', { class: 'note' }, 'No members yet.')); return; }
    mount(listHost, ...members.map((m) => el('div', { class: 'member-row' }, [
      el('p', { html:
        '<b>' + esc(m.character || m.email || '—') + '</b> · <span class="role-pill">' + esc(m.role) + '</span> ' +
        (m.status === 'pending' ? '<span class="warn">pending</span>' : '') + '<br>' +
        '<span class="note">' + esc(m.business || '—') + ' · ' + esc(m.email || '') + '</span><br>' +
        '<span class="note">UID: <code>' + esc(m.uid) + '</code></span>' }),
    ])));
  }
}
