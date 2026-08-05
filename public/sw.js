/**
 * Vici Ledger service worker — makes the app installable and lets the shell load
 * offline. Strategy:
 *   • navigations        → network-first, fall back to the cached shell.
 *   • app-config.json    → network-first (stays fresh online), cached fallback.
 *   • other same-origin  → stale-while-revalidate (fast + self-updating).
 *   • cross-origin (API, Google Sign-In) → untouched; always live.
 *
 * The register/POS keeps its own offline sales queue (localStorage); this SW only
 * caches static assets, so it never risks serving stale API data.
 */
const CACHE = 'vici-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API + Google stay live

  // The update check asks for index.html to find out whether a NEWER build has
  // been deployed. Serving it from the cache would answer with the very version
  // it is trying to notice has been replaced, so this one goes straight to the
  // network and is never stored (its URL is unique per check — caching it would
  // grow the cache forever, for answers that are stale the moment they land).
  if (url.searchParams.has('vcheck')) {
    event.respondWith(fetch(req));
    return;
  }

  const isConfig = url.pathname.endsWith('app-config.json');

  if (req.mode === 'navigate' || isConfig) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, net.clone());
        return net;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetching = fetch(req).then((net) => {
      if (net && net.ok) caches.open(CACHE).then((c) => c.put(req, net.clone()));
      return net;
    }).catch(() => cached);
    return cached || fetching;
  })());
});
