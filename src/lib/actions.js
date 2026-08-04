/**
 * The top action bar — a header of contextual buttons for the current view.
 * Views call setActions([...]) to populate it; it's cleared before each route
 * render, so buttons never leak between pages.
 *
 * SUSPENSION. The bar belongs to the PAGE. A view opened inside a focal menu —
 * the Register from a Home tile, say — is not the page, and its own bar
 * appearing above the modal is both wrong and unreachable: the buttons sit
 * behind the overlay. Rather than teaching every view whether it is embedded
 * (which each new one would have to remember), the bar is suspended while a
 * focal menu is open and restored to whatever the page had when it closes.
 */
let actionEl = null;
/** The buttons the PAGE last asked for, so a focal menu can hand them back. */
let current = [];
/** Nesting depth, not a flag: a focal menu can open another. */
let suspended = 0;

export function initActions(el) { actionEl = el; }

function paint(list) {
  if (!actionEl) return;
  actionEl.innerHTML = '';
  (list || []).forEach((b) => {
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (b.class ? ' ' + b.class : '');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    actionEl.appendChild(btn);
  });
  actionEl.hidden = !(list || []).length;
}

/** buttons: [{ label, onClick, class? }] */
export function setActions(buttons) {
  if (!actionEl) return;
  // A view rendering inside a focal menu still calls this; ignoring it is the
  // whole point, and the page's own bar is what comes back on close.
  if (suspended) return;
  current = buttons || [];
  paint(current);
}

export function clearActions() { setActions([]); }

/** Holds the page's bar while a focal menu is open. */
export function suspendActions() {
  suspended++;
  if (suspended === 1) paint([]);
}

/** Puts the page's own bar back once the last focal menu has closed. */
export function resumeActions() {
  suspended = Math.max(0, suspended - 1);
  if (!suspended) paint(current);
}
