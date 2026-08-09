/**
 * Public shop storefront — a read-only catalog anyone can view without signing
 * in (gated by the admin's storefront feature flag). Reached at
 * #/shop?b=Name&realm=<id>.
 *
 * The realm is in the link because a public visitor has no account to derive it
 * from, and two realms may each have a shop of the same name. Omitting it falls
 * back to the default realm, which is what every existing link does.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';

export function renderStorefront(container, business, realmId) {
  const body = el('div', {}, el('p', { class: 'note' }, 'Loading storefront…'));
  mount(container, el('div.card', {}, [
    el('a', { class: 'link-back', href: '#/' }, '← Vici Trading Co.'),
    body,
  ]));

  if (!business) { mount(body, el('p', { class: 'error' }, 'No shop specified.')); return; }

  api.getPublicStorefront(business, realmId).then((s) => {
    const accent = s.accent || '';
    const header = el('div', {}, [
      el('h2', { style: accent ? 'color:' + accent : '' }, s.business),
      // The region's Court either vouches for this shop, has sanctioned it, or
      // has said nothing — and "nothing" shows nothing, so a seal keeps meaning
      // something.
      s.seal === 'licensed'
        ? el('p', { class: 'court-seal ok' }, '⚖️ Licensed by the ' + (s.hold || '') + ' Court')
        : s.seal === 'restricted'
          ? el('p', { class: 'court-seal bad' }, '⚖️ Under restriction by the ' + (s.hold || '') + ' Court')
          : el('span', {}),
      s.tagline ? el('p', { class: 'shop-tagline', style: accent ? 'border-color:' + accent + ';color:' + accent : '' }, s.tagline) : el('span', {}),
    ]);
    const items = s.items || [];
    let list;
    if (!items.length) {
      list = el('p', { class: 'note' }, 'No wares listed yet.');
    } else {
      list = el('div', {}, items.map((it) => el('div', { class: 'member-row' }, [
        el('p', { html: '<b>' + esc(it.item) + '</b> · <span class="note">' + esc(money(it.price)) + '</span>' }),
        el('span', { class: 'pill' + (it.status === 'Out of Stock' ? ' danger' : it.status === 'Low' ? ' warn' : '') },
          it.status === 'Out of Stock' ? 'OUT' : it.status === 'Low' ? 'LOW' : 'IN STOCK'),
      ])));
    }
    mount(body, header, el('h4', {}, 'Wares'), list);
  }).catch((e) => mount(body, el('p', { class: 'error' }, e.message || String(e))));
}
