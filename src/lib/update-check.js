/**
 * Noticing that a new version has been deployed.
 *
 * THE PROBLEM. This is a single-page app behind a service worker, so a tab left
 * open on someone's second monitor goes on running whatever it loaded — for
 * days. They report bugs that were fixed a week ago, and they never see a new
 * feature until something happens to reload them. Nothing in the app ever said
 * "there is a newer version of this".
 *
 * THE SIGNAL. The build writes the bundle to a hashed filename —
 * `index-CGeMwQZ_.js` — and that hash changes when, and only when, the code
 * changes. So the running version is the script tag this page loaded, and the
 * deployed version is the script tag in the index.html sitting on the server
 * right now. If they differ, there is an update. No version file to remember to
 * bump, no endpoint to keep in step: it is the build's own fingerprint.
 *
 * THE CATCH. The service worker serves same-origin GETs stale-while-revalidate,
 * so a naive fetch of index.html hands back the copy from the cache — the very
 * page we are trying to notice has been superseded. The check therefore asks for
 * it with a `vcheck` parameter, which sw.js is written to pass straight to the
 * network and never store.
 */

/** How often to look. Rare enough to be free, often enough to matter in a shift. */
const EVERY_MS = 10 * 60 * 1000;

let running = '';
let timer = null;
let notified = false;

/** The bundle THIS page is running, from the module script index.html loaded. */
function runningAsset() {
  const tag = document.querySelector('script[type="module"][src]');
  const src = tag ? tag.getAttribute('src') : '';
  return src ? src.split('/').pop() : '';
}

/** The bundle the server would hand a visitor arriving right now. */
async function deployedAsset() {
  const url = new URL('index.html', document.baseURI);
  // Two belts: `vcheck` tells our service worker to stay out of the way, and its
  // changing value defeats any HTTP cache in between.
  url.searchParams.set('vcheck', String(Date.now()));
  const res = await fetch(url.href, { cache: 'no-store' });
  if (!res.ok) return '';
  const html = await res.text();
  const m = html.match(/src="[^"]*?(index-[A-Za-z0-9_-]+\.js)"/);
  return m ? m[1] : '';
}

async function look(onUpdate) {
  if (notified) return;
  try {
    const latest = await deployedAsset();
    // An empty or unrecognisable answer means the check failed, not that
    // everything is current — say nothing rather than nag on a bad network.
    if (!latest || !running || latest === running) return;
    notified = true;
    stopUpdateWatch();
    onUpdate();
  } catch (e) { /* offline, or the page is not served from a build — never mind */ }
}

/**
 * Starts watching. Calls `onUpdate` at most once, when the deployed build stops
 * matching this one.
 *
 * Checks on returning to the tab as well as on the timer: coming back to a
 * window left open overnight is exactly when the answer has changed, and it is
 * the moment the person is about to act on what they see.
 */
export function startUpdateWatch(onUpdate) {
  running = runningAsset();
  // In dev the script is ./src/main.js, which never changes name — there is no
  // deploy to notice, so do not sit there polling for one.
  if (!/^index-.*\.js$/.test(running)) return;

  const tick = () => look(onUpdate);
  timer = setInterval(tick, EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  tick();

  function onVisible() { if (document.visibilityState === 'visible') tick(); }
  stopUpdateWatch.cleanup = () => document.removeEventListener('visibilitychange', onVisible);
}

function stopUpdateWatch() {
  if (timer) { clearInterval(timer); timer = null; }
  if (stopUpdateWatch.cleanup) { stopUpdateWatch.cleanup(); stopUpdateWatch.cleanup = null; }
}
