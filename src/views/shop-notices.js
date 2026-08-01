/**
 * Shop notice board (owner) — post a message to your own staff. These are the
 * same per-business notices admins can set, but scoped so an owner only ever
 * sees and edits their OWN shop's board.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { skeletonRows } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';

export function renderShopNotices(container) {
  const listHost = el('div', {}, skeletonRows(2));
  const message = el('textarea', { rows: '3', placeholder: 'A message for your staff…' });
  const start = el('input', { type: 'date' });
  const end = el('input', { type: 'date' });
  const status = el('p', {});
  const post = el('button.primary', { onclick: doPost }, 'Post notice');

  mount(container,
    el('div.card', {}, [
      el('h3', {}, 'Post a notice'),
      el('p', { class: 'note' }, 'Shown on your staff’s Home page. Leave the dates blank to show it immediately ' +
        'and indefinitely.'),
      message,
      el('label', {}, 'Show from (optional)'), start,
      el('label', {}, 'Until (optional)'), end,
      el('div', { class: 'row-actions' }, [post]),
      status,
    ]),
    el('div.card', {}, [el('h3', {}, 'Your notices'), listHost]),
  );

  function draw(notices) {
    if (!notices.length) {
      mount(listHost, emptyState({ glyph: '📣', title: 'No notices posted', hint: 'Anything you post appears here.' }));
      return;
    }
    mount(listHost, ...notices.map((n) => el('div', { class: 'member-row' }, [
      el('p', { html: esc(n.message) + '<br><span class="note">' +
        (n.start ? 'from ' + esc(n.start) : 'active now') + (n.end ? ' until ' + esc(n.end) : '') + '</span>' }),
      el('button.danger.small', { onclick: () => remove(n.id) }, 'Delete'),
    ])));
  }

  function load() {
    api.getShopNotices().then((r) => draw(r.notices || []))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  async function doPost() {
    if (!message.value.trim()) { status.className = 'error'; status.textContent = 'Enter a message.'; return; }
    post.disabled = true; status.className = ''; status.textContent = 'Posting…';
    try {
      const r = await api.addShopNotice({ message: message.value.trim(), start: start.value, end: end.value });
      message.value = ''; start.value = ''; end.value = '';
      status.textContent = '';
      draw(r.notices || []);
      toast('Notice posted', 'ok');
    } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
    finally { post.disabled = false; }
  }

  async function remove(id) {
    if (!window.confirm('Delete this notice?')) return;
    try { draw((await api.deleteShopNotice(id)).notices || []); toast('Notice deleted', 'ok'); }
    catch (e) { alert(e.message || e); }
  }

  load();
}
