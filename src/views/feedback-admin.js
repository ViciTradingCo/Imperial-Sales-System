/**
 * Feedback review (System Admin) — every submission from every realm, split
 * into ACTIVE (still to deal with) and ARCHIVE (marked complete).
 *
 * Deployment-wide on purpose: this is feedback about the SOFTWARE, so it goes
 * to the person who can change it. Each card names the realm it came from, so
 * an entry is never mistaken for one about the realm you happen to be viewing.
 *
 * Every card carries who wrote it, from which shop, in what role and status,
 * and when — captured at submit time, so a report still reads correctly after
 * its author changes job or their shop is renamed.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { navigate } from '../lib/router.js';
import { skeletonRows } from '../lib/skeleton.js';

export function renderFeedbackAdmin(container, { me } = {}) {
  const listHost = el('div', {}, skeletonRows(4));
  const search = el('input', { type: 'search', placeholder: 'Search subject, text, person, shop…' });
  // Active first: the list exists to be worked through, and Archive is where
  // things go to stop being asked about.
  let tab = 'active';
  let data = { active: [], archive: [] };

  const tabs = el('div', { class: 'row-actions' }, [
    tabBtn('active', 'Active'),
    tabBtn('archive', 'Archive'),
  ]);
  search.addEventListener('input', draw);

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Feedback'),
    el('p', { class: 'note' }, 'What owners and employees have sent about the app, across every realm. ' +
      'Marking one complete moves it to the Archive.'),
    tabs,
    search,
    listHost,
  ]));

  function tabBtn(key, label) {
    return el('button' + (tab === key ? '.primary' : '.secondary-btn'), {
      onclick: () => { tab = key; redrawTabs(); draw(); },
    }, label);
  }
  function redrawTabs() {
    mount(tabs, tabBtn('active', 'Active (' + data.active.length + ')'),
      tabBtn('archive', 'Archive (' + data.archive.length + ')'));
  }

  function load() {
    api.getAllFeedback()
      .then((d) => { data = { active: d.active || [], archive: d.archive || [] }; redrawTabs(); draw(); })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = (data[tab] || []).filter((f) => !q ||
      [f.subject, f.body, f.character, f.email, f.business].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) {
      mount(listHost, el('p', { class: 'note' }, (data[tab] || []).length
        ? 'No matches.'
        : (tab === 'active' ? 'Nothing waiting — all feedback has been dealt with.' : 'Nothing archived yet.')));
      return;
    }
    mount(listHost, ...rows.map(card));
  }

  function card(f) {
    const who = [f.character || f.email || 'Someone', f.business, roleLabel(f), f.status]
      .filter(Boolean).join(' · ');
    // The realm is only worth naming when there is more than one to confuse.
    const realm = (me && Number(me.realmCount) > 1 && f.realmId) ? ' · realm ' + f.realmId : '';
    const done = f.completed;
    return el('div', { class: 'card feedback-card' }, [
      el('div', { class: 'panel-head' }, [
        el('h4', {}, f.subject || 'Feedback'),
        el('button' + (done ? '.secondary-btn.small' : '.primary.small'), {
          onclick: () => setComplete(f, !done),
        }, done ? 'Reopen' : 'Mark complete'),
      ]),
      el('p', { class: 'note', html: esc(who) + esc(realm) + ' · ' + esc(stamp(f.ts)) }),
      el('p', { class: 'feedback-body' }, f.body || ''),
      done
        ? el('p', { class: 'note ok' }, 'Completed ' + stamp(f.completedAt) +
            (f.completedBy ? ' by ' + f.completedBy : ''))
        : el('span', {}),
    ]);
  }

  async function setComplete(f, complete) {
    try {
      const d = await api.completeFeedback(f.id, complete);
      data = { active: d.active || [], archive: d.archive || [] };
      redrawTabs();
      draw();
      toast(complete ? 'Moved to Archive.' : 'Reopened.', 'ok');
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  redrawTabs();
  load();
}

function roleLabel(f) {
  return { owner: 'Shop Owner', employee: 'Employee', admin: 'Admin' }[f.role] || f.role || '';
}
/** Submitted stamps are ISO; a local date+time is what a reader wants. */
function stamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}
