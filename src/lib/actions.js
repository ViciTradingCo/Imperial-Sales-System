/**
 * The top action bar — a header of contextual buttons for the current view.
 * Views call setActions([...]) to populate it; it's cleared before each route
 * render, so buttons never leak between pages. Built to grow (future views add
 * their own buttons here).
 */
let actionEl = null;

export function initActions(el) { actionEl = el; }

/**
 * buttons: [{ label, onClick, class? } | { separator: true }]
 * A separator draws a divider instead of a button — used to set the realm
 * switcher apart from the page links it shares the bar with.
 */
export function setActions(buttons) {
  if (!actionEl) return;
  actionEl.innerHTML = '';
  const list = buttons || [];
  list.forEach((b) => {
    if (b.separator) {
      actionEl.appendChild(Object.assign(document.createElement('span'), { className: 'action-sep' }));
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (b.class ? ' ' + b.class : '');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    actionEl.appendChild(btn);
  });
  actionEl.hidden = list.length === 0;
}

export function clearActions() { setActions([]); }
