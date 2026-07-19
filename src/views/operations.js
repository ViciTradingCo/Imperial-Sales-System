/**
 * Business Operations — the working hub for a shop. The day-to-day tools
 * (Register, Inventory, and — for owners/admins — Employees) live on this
 * page's action bar rather than the main nav.
 */
import { el, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { setActions } from '../lib/actions.js';

export function renderOperations(container, { me }) {
  const canStaff = me.role === 'owner' || me.role === 'admin';
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Business Operations'),
    el('p', { class: 'note' }, 'Your shop’s day-to-day tools. Use the buttons above to ' +
      'ring up sales, manage inventory' + (canStaff ? ', and manage staff.' : '.')),
  ]));

  const actions = [
    { label: 'Register', onClick: () => navigate('/pos') },
    { label: 'Inventory', onClick: () => navigate('/inventory') },
  ];
  if (canStaff) actions.push({ label: 'Employees', onClick: () => navigate('/employees') });
  setActions(actions);
}
