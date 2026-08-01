/**
 * Landing / About page. Signed-out visitors see it first (with the sign-in
 * button); signed-in users can revisit it from the "About" nav item.
 *
 * The wording is ADMIN-EDITABLE (Network Settings → About page). When the admin
 * has written their own title/body/credits those replace the defaults below;
 * blank fields fall back to this stock copy.
 */
import { el, mount } from '../lib/dom.js';
import { branding } from '../lib/branding.js';

/** Renders free text: blank lines split paragraphs, "- " lines become bullets. */
function richText(text) {
  const out = [];
  String(text || '').split(/\n{2,}/).forEach((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (lines.every((l) => l.startsWith('- '))) {
      out.push(el('ul', { class: 'feature-list' }, lines.map((l) => el('li', {}, l.slice(2)))));
    } else {
      out.push(el('p', {}, lines.join(' ')));
    }
  });
  return out;
}

export function renderLanding(container, { signInMount } = {}) {
  const nodes = [];
  const b = branding();

  nodes.push(el('div.card.hero', {}, [
    el('h2', {}, b.aboutTitle || b.tagline || 'The Vici Automated Ledger'),
    ...(b.aboutBody
      ? richText(b.aboutBody)
      : [el('p', {}, 'A sales system for the Mereth Skyrim RP server. Shops across the ' +
          'holds record their sales and restocks, owners manage their own inventory ' +
          'and staff, and Vici Trading Co. keeps the whole trade network — certification ' +
          'and pooled records — in one place.')]),
  ]));

  if (signInMount) {
    nodes.push(el('div.card.signin-wrap', {}, [
      el('h3', {}, 'Sign in to begin'),
      el('p', { class: 'note' }, 'Use the Google account you trade under. ' +
        'New faces are asked to register a character and a business.'),
      signInMount,
    ]));
  }

  nodes.push(el('div.card', {}, [
    el('h3', {}, 'What you can do'),
    el('ul', { class: 'feature-list' }, [
      el('li', {}, 'Employees ring up sales at their shop’s register.'),
      el('li', {}, 'Owners manage their shop: inventory, staff, and pricing.'),
      el('li', {}, 'Admins keep the network and its settings in order.'),
      el('li', {}, 'Your view only ever shows the business you belong to.'),
    ]),
  ]));

  nodes.push(el('div.card.credits', {}, [
    el('h3', {}, 'Credits'),
    ...(b.aboutCredits
      ? richText(b.aboutCredits)
      : [
          el('p', { html: 'Created and managed by <b>SmileDaemon</b>.' }),
          el('p', { class: 'note' }, 'Questions or concerns? Send them directly to SmileDaemon on Discord.'),
        ]),
  ]));

  mount(container, ...nodes);
}
