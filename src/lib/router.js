/**
 * Minimal hash-based router. Hash routing avoids GitHub Pages' need for a
 * server-side rewrite/404 fallback: every route lives under `#/...` on one HTML
 * file. Views register a path → handler; navigate() changes the hash; the
 * handler renders into the app container.
 *
 * Access control is NOT enforced here — the API is the trust boundary. The
 * router only decides which screen to *show*; the data behind it is still
 * gated server-side.
 */
const routes = new Map();
let notFound = null;
let container = null;
let beforeRender = null;

export function initRouter(appEl, fallbackRender) {
  container = appEl;
  notFound = fallbackRender;
  window.addEventListener('hashchange', render);
}

/** Runs before every render (e.g. to clear per-view action buttons). */
export function onBeforeRender(fn) { beforeRender = fn; }

export function route(path, render) { routes.set(path, render); }

export function navigate(path) {
  if (location.hash === '#' + path) render();
  else location.hash = '#' + path;
}

export function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

export function render() {
  if (beforeRender) beforeRender();
  const path = currentPath();
  const handler = routes.get(path) || notFound;
  if (handler) handler(container, path);
}
