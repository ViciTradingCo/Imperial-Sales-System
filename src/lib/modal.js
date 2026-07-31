/**
 * A minimal in-browser modal (focus window). Renders a centered card over a
 * dimmed overlay; closes on the ✕, on backdrop click, or Escape.
 */
import { el } from './dom.js';

export function openModal(contentNodes, { onClose, wide } = {}) {
  const win = el('div.modal-window', {});
  if (wide) win.classList.add('modal-wide'); // full sections opened from a tile
  const closeBtn = el('button', { class: 'modal-close', 'aria-label': 'Close', onclick: () => close() }, '✕');
  win.appendChild(closeBtn);
  (Array.isArray(contentNodes) ? contentNodes : [contentNodes]).forEach((n) => win.appendChild(n));

  const overlay = el('div.modal-overlay', {}, [win]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (onClose) onClose();
  }

  document.body.appendChild(overlay);
  return { close };
}
