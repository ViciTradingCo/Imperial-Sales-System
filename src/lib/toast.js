/**
 * Toasts — transient confirmations that don't shift the layout (replacing
 * inline "Saved ✓" status lines for success cases). Errors usually stay inline
 * next to the field that caused them.
 */
let host = null;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

/** Shows a toast. kind: 'ok' | 'warn' | 'danger' | '' */
export function toast(message, kind, ms) {
  const h = ensureHost();
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' toast-' + kind : '');
  t.textContent = String(message || '');
  h.appendChild(t);
  // Allow the entry transition to run, then schedule removal.
  requestAnimationFrame(() => t.classList.add('in'));
  const life = ms || 2600;
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
  }, life);
  return t;
}
