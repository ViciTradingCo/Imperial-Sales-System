/**
 * Landing / About page. Signed-out visitors see it first (with the sign-in
 * button); signed-in users can revisit it from the "About" nav item. Describes
 * the app and credits SmileDaemon, with a note on how to reach them.
 */
import { el, mount } from '../lib/dom.js';

export function renderLanding(container, { signInMount } = {}) {
  const nodes = [];

  nodes.push(el('div.card.hero', {}, [
    el('h2', {}, 'The East Empire Trading Company Sales Network'),
    el('p', {}, 'A sales system for the Mereth Skyrim RP server. Shops across the ' +
      'holds record their sales and restocks, owners manage their own inventory ' +
      'and staff, and the Company keeps the whole trade network — certification, ' +
      'pooled records, and market watch — in one place.'),
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
      el('li', {}, 'Admins oversee the network, its settings, and market analysis.'),
      el('li', {}, 'Your view only ever shows the business you belong to.'),
    ]),
  ]));

  nodes.push(el('div.card.credits', {}, [
    el('h3', {}, 'Credits'),
    el('p', { html: 'Created and managed by <b>SmileDaemon</b>.' }),
    el('p', { class: 'note' }, 'Questions or concerns? Send them directly to SmileDaemon on Discord.'),
  ]));

  mount(container, ...nodes);
}
