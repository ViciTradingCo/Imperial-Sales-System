/**
 * Feedback review (System Admin) — every submission from every realm, in three
 * tabs: ACTIVE (feedback still to deal with), APPOINTMENTS (delivery reports,
 * which are requests with something to do at the end rather than opinions about
 * the app), and ARCHIVE (anything marked done, of either kind).
 *
 * Appointments are split out by SUBJECT and archived the same way as everything
 * else — one place where finished things go. The button says "Archive" there
 * rather than "Mark complete", because completing a delivery is the errand and
 * filing the report is what this button actually does.
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
  let data = { active: [], appointments: [], archive: [] };

  const TABS = [['active', 'Active'], ['appointments', 'Appointments'], ['archive', 'Archive']];
  const tabs = el('div', { class: 'row-actions' }, []);
  search.addEventListener('input', draw);

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Feedback'),
    el('p', { class: 'note' }, 'What owners and employees have sent, across every realm. Delivery reports ' +
      'have their own tab; everything moves to the Archive when it is dealt with.'),
    tabs,
    search,
    listHost,
  ]));

  function tabBtn(key, label) {
    return el('button' + (tab === key ? '.primary' : '.secondary-btn'), {
      onclick: () => { tab = key; redrawTabs(); draw(); },
    }, label + ' (' + (data[key] || []).length + ')');
  }
  function redrawTabs() {
    mount(tabs, ...TABS.map(([key, label]) => tabBtn(key, label)));
  }

  /** Whatever the API returned, with every tab guaranteed to be a list. */
  function take(d) {
    return { active: (d && d.active) || [], appointments: (d && d.appointments) || [], archive: (d && d.archive) || [] };
  }

  function load() {
    api.getAllFeedback()
      .then((d) => { data = take(d); redrawTabs(); draw(); })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = (data[tab] || []).filter((f) => !q ||
      [f.subject, f.body, f.character, f.email, f.business].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) {
      mount(listHost, el('p', { class: 'note' }, (data[tab] || []).length ? 'No matches.' : EMPTY[tab]));
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
    // "Mark complete" is right for an opinion about the app; a delivery report
    // is finished when the delivery is, and this button only files it.
    const action = done ? 'Reopen' : (f.appointment ? 'Archive' : 'Mark complete');
    return el('div', { class: 'card feedback-card' }, [
      el('div', { class: 'panel-head' }, [
        el('h4', {}, f.subject || 'Feedback'),
        el('button' + (done ? '.secondary-btn.small' : '.primary.small'), {
          onclick: () => setComplete(f, !done),
        }, action),
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
      data = take(d);
      redrawTabs();
      draw();
      // Say WHERE it went. Reopening a delivery report puts it in Appointments,
      // not back where the reader is standing, and a toast that just said
      // "Reopened" would leave them looking at a list it is not in.
      toast(complete ? 'Moved to Archive.'
        : 'Reopened — back in ' + (f.appointment ? 'Appointments' : 'Active') + '.', 'ok');
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  redrawTabs();
  load();
}

const EMPTY = {
  active: 'Nothing waiting — all feedback has been dealt with.',
  appointments: 'No deliveries reported.',
  archive: 'Nothing archived yet.',
};

function roleLabel(f) {
  return { owner: 'Shop Owner', employee: 'Employee', admin: 'Admin' }[f.role] || f.role || '';
}
/** Submitted stamps are ISO; a local date+time is what a reader wants. */
function stamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}
