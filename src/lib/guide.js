/**
 * The walk-through panel — a collapsible "how this works" that sits with a
 * form and explains it.
 *
 * Not a tour with its own Next button: a tour makes you read everything before
 * you may touch anything, and it is gone exactly when you need it. This stays
 * put, closed to a single line of text, next to the fields it describes.
 *
 * It OPENS ITSELF for someone who has never finished the thing it belongs to
 * (`storeKey`, remembered per device) and stays shut for everyone else. Opening
 * or closing it by hand wins for the rest of the session — the app should not
 * argue with a person who has just said what they want.
 *
 * Finishing is what proves it is no longer needed, so `markGuideSeen` is called
 * on a successful submit rather than on opening the form. Opening and
 * abandoning does not count: that is often the person who needed it most.
 */
import { el } from './dom.js';

const key = (storeKey) => 'eec.guide.' + storeKey;

/** Whether this walk-through has never been finished on this device. */
export function guideUnseen(storeKey) {
  if (!storeKey) return false;
  try { return !localStorage.getItem(key(storeKey)); } catch (e) { return false; }
}

/** Records that the thing this guide belongs to was completed. */
export function markGuideSeen(storeKey) {
  if (!storeKey) return;
  try { localStorage.setItem(key(storeKey), '1'); } catch (e) { /* private mode */ }
}

/**
 * @param {string[]} lines  paragraphs, in reading order
 * @param {boolean}  open   whether it starts expanded
 */
export function guidePanel(lines, open) {
  const rows = (lines || []).filter(Boolean);
  if (!rows.length) return el('span', {});
  let shown = !!open;

  const body = el('div', { class: 'guide-body' }, rows.map((line) => el('p', {}, line)));
  // The caret is its own node so the LABEL is a text node on its own — the
  // translator matches whole text nodes, and '▾ How this works' is not a
  // phrase any dictionary will have a row for.
  const caret = el('span', { class: 'guide-caret', 'aria-hidden': 'true' }, '');
  const toggle = el('button', {
    type: 'button', class: 'guide-toggle', onclick: () => { shown = !shown; paint(); },
  }, [caret, el('span', {}, 'How this works')]);

  function paint() {
    caret.textContent = shown ? '▾' : '▸';
    toggle.setAttribute('aria-expanded', shown ? 'true' : 'false');
    body.hidden = !shown;
  }
  paint();
  return el('div', { class: 'guide' }, [toggle, body]);
}
