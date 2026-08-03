/**
 * Feedback — what an owner or employee thinks of the app, sent to whoever runs
 * the deployment.
 *
 * Two fields only: a SUBJECT from a short dropdown, and the feedback itself.
 * Everything else that a useful report needs — who you are, your shop, your
 * status, your realm, the time — is attached by the SERVER from your signed-in
 * session. Asking a person to type their own name into a form they are already
 * signed into is asking them to get it wrong.
 *
 * The subject list comes from the API rather than living here, so the dropdown
 * and the validation are the same list.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { navigate } from '../lib/router.js';
import { skeletonLines } from '../lib/skeleton.js';

export function renderFeedback(container, { me } = {}) {
  const formHost = el('div', {}, skeletonLines(3));
  const mineHost = el('div', {});

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Feedback'),
    el('p', { class: 'note' }, 'Tell us what is working and what is not. Bugs, confusing screens, things you ' +
      'wish the ledger did — all of it helps.'),
    formHost,
    mineHost,
  ]));

  api.getFeedback()
    .then((d) => { renderForm(d.subjects || []); renderMine(d.mine || []); })
    .catch((e) => mount(formHost, el('p', { class: 'error' }, e.message || String(e))));

  function renderForm(subjects) {
    const subject = el('select', {});
    subjects.forEach((s) => subject.appendChild(el('option', { value: s }, s)));
    const body = el('textarea', { rows: '7', placeholder: 'What happened, what you expected, and anything ' +
      'that would help us reproduce it.' });
    const status = el('p', {});
    const send = el('button.primary', { onclick: submit }, 'Send feedback');
    const setStatus = (m, c) => { status.className = c || ''; status.textContent = m; };

    async function submit() {
      if (!body.value.trim()) { setStatus('Write your feedback before sending.', 'error'); return; }
      send.disabled = true; setStatus('Sending…', '');
      try {
        const r = await api.sendFeedback(subject.value, body.value.trim());
        body.value = '';
        setStatus('', '');
        toast('Thank you — your feedback was sent.', 'ok');
        renderMine(r.mine || []);
      } catch (e) { setStatus(e.message || String(e), 'error'); }
      finally { send.disabled = false; }
    }

    mount(formHost,
      el('label', {}, 'Subject'), subject,
      el('label', {}, 'Your feedback'), body,
      // Say what gets attached, rather than attaching it silently.
      el('p', { class: 'note' }, 'Sent with your name' +
        (me && me.business ? ', your shop (' + me.business + ')' : '') +
        ' and the date, so we can follow it up.'),
      send,
      status);
  }

  /** Your own submissions, so "did anyone see this" has an answer. */
  function renderMine(mine) {
    if (!mine.length) { mount(mineHost); return; }
    mount(mineHost,
      el('h3', {}, 'Your feedback'),
      ...mine.map((f) => el('div', { class: 'member-row' }, [
        el('p', { html: '<b>' + esc(f.subject) + '</b> · <span class="note">' +
          esc(String(f.ts || '').slice(0, 10)) + '</span><br><span class="note">' +
          esc(f.body.length > 160 ? f.body.slice(0, 160) + '…' : f.body) + '</span>' }),
        el('span', { class: f.completed ? 'ok' : 'note' }, f.completed ? 'Reviewed' : 'Open'),
      ])));
  }
}
