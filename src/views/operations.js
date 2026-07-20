/**
 * Business Operations — the working hub for a shop. The day-to-day tools
 * (Register, Inventory, and — for owners/admins — Employees) live on this
 * page's action bar; the page shows the shop's subscription status.
 *
 * For owners/employees this content is merged into Home; the standalone page
 * remains for admins (who reach it from the nav).
 */
import { el, mount } from '../lib/dom.js';
import { setOpsActions, subscriptionCard } from '../lib/sections.js';

export function renderOperations(container, { me }) {
  const canStaff = me.role === 'owner' || me.role === 'admin';
  setOpsActions(me);
  mount(container,
    el('div.card', {}, [
      el('h2', {}, 'Business Operations'),
      el('p', { class: 'note' }, 'Your shop’s day-to-day tools. Use the buttons above to ' +
        'ring up sales, manage inventory' + (canStaff ? ', and manage staff.' : '.')),
    ]),
    subscriptionCard(me),
  );
}
