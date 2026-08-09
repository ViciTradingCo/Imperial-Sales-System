# Shelved: public storefronts

**Shelved 2026-08-09.** Not removed — the feature works; it was taken off the
site so the surface area stops advertising something that isn't part of the
current play loop. Every mention of it in the live UI, the API client and the
Worker routes was removed in the same change. This directory is the whole
feature, kept intact so it can come back without being rebuilt.

## What it was

A **public, sign-in-free catalog page for a shop**. A shop's non-ingredient
stock, its price list, and its notice, rendered read-only at
`#/shop?b=<business>&realm=<realm>` — a link an owner could paste into Discord
so customers could see what was on the shelf without an account.

One switch gated it: a **network-wide** flag, admin-only (Admin Panel →
Settings → Storefronts), stored in `sys_flags` under
`storefronts_enabled:<realm>`. Off, and nothing in that realm was public. Per
realm, not global, so one server could publish its shops while another kept
them private. An owner's side (Shop Ledger → Settings → Storefront) was not a
second switch — only the share link, and a note that it worked when the network
flag was on.

The public route was the only unauthenticated data route in the Worker, which
is why the flag check was the first thing `publicStorefront` did.

## Why it was shelved

It is the one feature that publishes realm data outside the trust boundary, and
nobody was using the links. Rather than carry an unauthenticated route and two
settings screens for a surface with no traffic, it goes on the shelf until
there is a reason to point people at it.

## The files here

| File | Was |
| --- | --- |
| `frontend-storefront.js` | `src/views/storefront.js` — `renderStorefront(container, business, realmId)` |
| `worker-storefront.js` | `worker/src/storefront.js` — `publicStorefront(env, business, realmId)`, `storefrontEnabled` |

Both are unmodified — their relative imports (`./db.js`, `../lib/api.js`) no
longer resolve from this directory, and are left that way so the archived copies
stay a faithful record of what shipped. They resolve again once the files are
moved back.

### One bug to fix before it ships again

`worker-storefront.js` calls `standingOf(env, co.business, co.hold, realm)` to
work out the Court's seal, but **never imports it** — the module imports only
from `./db.js` and `./shop-style.js`. Every request that got past the flag check
and found the shop would have thrown a `ReferenceError`. Add:

```js
import { standingOf } from './court.js';
```

It was not caught because the flag ships off, so nothing ever reached that line.
Whatever brings this feature back needs a test that actually fetches a
storefront for a real shop with storefronts ON.

## Restoring it

Move the two modules back (`git mv archive/storefront/frontend-storefront.js
src/views/storefront.js`, likewise the worker one), then re-add the wiring that
was deleted. Verbatim, as it stood:

### `src/lib/api.js` — three client methods

```js
  /** Admin: whether public storefronts are enabled. */
  getStorefrontFlag: () => request('GET', '/admin/storefronts'),
  /** Admin: enable/disable public storefronts. */
  setStorefrontFlag: (enabled) => request('POST', '/admin/storefronts', { enabled }),
  /** Public (no auth): a shop's read-only catalog. */
  getPublicStorefront: (business, realmId) => request('GET', '/public/storefront?b=' + encodeURIComponent(business || '') +
    (realmId ? '&realm=' + encodeURIComponent(realmId) : '')),
```

### `src/main.js` — the public route and its deep-link handling

```js
import { renderStorefront } from './views/storefront.js';

// Public storefront — no sign-in required. #/shop?b=<business>
route('/shop', (container, path, query) => {
  const q = new URLSearchParams(query || '');
  renderStorefront(container, q.get('b'), q.get('realm'));
});
```

`/shop` is PUBLIC, so it needs the two guards that go with that — without them
a signed-in visitor gets bounced off the link they were sent:

- in `onSignedIn`, before the redirect to Home:
  ```js
  // A public deep-link (e.g. a shared storefront) stays put — don't redirect.
  if (currentPath().split('?')[0] === '/shop') { render(); return; }
  ```
- in `main()`, so an anonymous visitor isn't shown the sign-in gate:
  ```js
  const publicDeepLink = currentPath().split('?')[0] === '/shop';
  ```
  used to skip the gate when true.

Also re-add `served.add('/shop');` to the route/served set in
`worker/test/api-client.test.js` — that test asserts every front-end route is
either served by the Worker or explicitly known to be public, and `/shop` is
the latter.

### `src/views/admin-settings.js` — the network switch

A tile in the settings grid:

```js
    { key: 'set-storefront', label: 'Storefronts', hint: 'Public shop pages', glyph: '🏪',
      open: (host) => mount(host, storefrontCard()) },
```

its `TILE_KEYS` entry `['set-storefront', 'Settings · Storefronts']`, and
`storefrontCard()` — a single checkbox reading `api.getStorefrontFlag()` and
writing `api.setStorefrontFlag(checked)`.

### `src/views/ledger-settings.js` — the owner's share link

A tile:

```js
      { key: 'led-storefront', label: 'Storefront', hint: 'Public share link', glyph: '🏪',
        open: (host) => mount(host, storefrontLinkCard(me)) },
```

its `TILE_KEYS` entry (which lives in `admin-settings.js` with the rest)
`['led-storefront', 'Ledger · Storefront']`, and `storefrontLinkCard(me)` — a
read-only box holding the link, a Copy button, and a Preview link. The realm is
part of the URL because a visitor has no account and two realms can each have a
shop of the same name:

```js
  const url = location.origin + location.pathname + '#/shop?b=' + encodeURIComponent(me.business || '') +
    (me.homeRealm && me.homeRealm !== 'default' ? '&realm=' + encodeURIComponent(me.homeRealm) : '');
```

### `worker/src/routes/admin.js` — the network flag routes

```js
import { storefrontsEnabled, setStorefrontsEnabled } from '../storefront.js';

async function getStorefrontFlag({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { enabled: await storefrontsEnabled(env, realmIdOf(caller, env)) };
}
async function setStorefrontFlag({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const on = await setStorefrontsEnabled(env, !!body.enabled, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'storefronts.toggle', detail: on ? 'enabled' : 'disabled', realmId: realmIdOf(caller, env) });
  return { enabled: on };
}

  { method: 'GET', path: '/admin/storefronts', handler: getStorefrontFlag },
  { method: 'POST', path: '/admin/storefronts', handler: setStorefrontFlag },
```

### `worker/src/routes/business.js` — the public route

```js
import { publicStorefront } from '../storefront.js';

/** Public (no auth): a shop's read-only catalog, if storefronts are enabled. */
async function storefront({ env, url }) {
  return await publicStorefront(env, url.searchParams.get('b'), realmOf(url.searchParams.get('realm')));
}

{ method: 'GET', path: '/public/storefront', handler: storefront },
```

**This is the one route in the whole Worker with no `require*` guard.** If it
comes back, it comes back with both flag checks intact — `publicStorefront`
already refuses when either is off, and that check is the whole security model
for the route.

## What was NOT removed

- The `storefronts_enabled:<realm>` rows already in `sys_flags`. Nothing reads
  them now, but they cost nothing and a restore finds every realm's earlier
  choice still set.
- The patch-notes entries that mention storefronts. Those are a record of what
  shipped when; rewriting history to hide a shelved feature would make the log
  useless.
