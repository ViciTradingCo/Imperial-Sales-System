/**
 * A stepped (wizard) modal — one question at a time, with Previous and Next.
 *
 * WHY. A form with nine fields is not nine times harder than a form with three,
 * it is worse than that: everything is on screen at once, nothing says which
 * parts matter, and the optional fields look exactly as compulsory as the
 * required ones. Intake was that form. Splitting it into steps means each screen
 * asks one small thing, and the fields nobody usually touches are somewhere you
 * walk past rather than something you have to read.
 *
 * The steps are all built up front and only their visibility changes, so state
 * lives in the field elements themselves — going back and forth never loses
 * anything, and the caller reads its values at the end exactly as it would from
 * a plain form.
 *
 * Validation is per step, on the way FORWARD only: a step that cannot be
 * completed stops you there rather than at the end, and going back is always
 * free. Returning a string from `validate` shows it as the step's error.
 */
import { el } from './dom.js';
import { openModal } from './modal.js';

/**
 * @param {object} opts
 * @param {string} opts.title        heading, shown on every step
 * @param {Array}  opts.steps        [{ title, hint, nodes, validate, onEnter }]
 * @param {string} opts.finishLabel  label of the button on the last step
 * @param {Function} opts.onFinish   async; throwing shows the message and stays open
 * @returns the modal handle (`.close()`)
 */
export function openStepModal({ title, steps, finishLabel = 'Done', onFinish }) {
  const live = steps.filter(Boolean);
  const last = live.length - 1;
  let at = 0;
  let busy = false;

  const heading = el('h3', {}, title);
  const counter = el('span', { class: 'step-count' }, '');
  const dots = el('div', { class: 'step-dots' }, live.map((_, i) =>
    el('span', { class: 'step-dot' + (i === 0 ? ' on' : '') }, '')));
  const stepTitle = el('p', { class: 'step-title' }, '');
  const hint = el('p', { class: 'note' }, '');
  const status = el('p', {});

  const panes = live.map((s, i) => {
    const pane = el('div', { class: 'step-pane' }, s.nodes);
    pane.hidden = i !== 0;
    return pane;
  });

  const back = el('button.secondary-btn', { onclick: () => go(at - 1) }, 'Previous');
  const next = el('button.primary', { onclick: () => go(at + 1) }, 'Next');
  const nav = el('div', { class: 'step-nav' }, [back, next]);

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg || ''; }

  /** Moves to a step, running the outgoing step's validation when going forward. */
  async function go(to) {
    if (busy) return;
    if (to > at) {
      const err = live[at].validate ? live[at].validate() : null;
      if (err) { setStatus(err, 'error'); return; }
    }
    if (to > last) return finish();
    if (to < 0) return;
    setStatus('');
    panes[at].hidden = true;
    at = to;
    panes[at].hidden = false;
    paint();
    if (live[at].onEnter) live[at].onEnter();
    // Put the cursor where the step expects to be typed into. Skipped on the
    // last step, where the focus should stay on the button that finishes.
    const field = at === last ? null : panes[at].querySelector('input, select, textarea');
    if (field && !field.disabled) field.focus();
  }

  function paint() {
    counter.textContent = 'Step ' + (at + 1) + ' of ' + live.length;
    dots.childNodes.forEach((d, i) => d.classList.toggle('on', i === at));
    stepTitle.textContent = live[at].title || '';
    hint.textContent = live[at].hint || '';
    hint.hidden = !live[at].hint;
    back.disabled = at === 0;
    next.textContent = at === last ? finishLabel : 'Next';
  }

  async function finish() {
    busy = true;
    next.disabled = true;
    back.disabled = true;
    setStatus('Working…', '');
    try {
      await onFinish();
      modal.close();
    } catch (e) {
      busy = false;
      next.disabled = false;
      back.disabled = false;
      setStatus((e && e.message) || String(e), 'error');
    }
  }

  /**
   * Enter advances, the way it would submit an ordinary form — with two
   * exceptions that are both bugs if you skip them:
   *
   *   • a control that already handled Enter keeps it. The item picker accepts
   *     the highlighted match on Enter and calls preventDefault; without this
   *     check the same keystroke would also jump to the next step, so choosing
   *     an item would skip past the quantity field. `defaultPrevented` is the
   *     general form of "someone downstream already dealt with this".
   *   • the last step never fires on Enter. That button is the one that writes
   *     the record, and nobody should commit a delivery with a stray keystroke
   *     while typing into a field above the summary.
   */
  function onKey(e) {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    if (e.defaultPrevented) return;
    if (at === last) return;
    e.preventDefault();
    go(at + 1);
  }

  const body = el('div', { class: 'step-form' }, [
    el('div', { class: 'step-head' }, [counter, dots]),
    stepTitle, hint,
    ...panes,
    nav, status,
  ]);
  body.addEventListener('keydown', onKey);

  paint();
  if (live[0].onEnter) live[0].onEnter();

  const modal = openModal([heading, body]);
  return modal;
}
