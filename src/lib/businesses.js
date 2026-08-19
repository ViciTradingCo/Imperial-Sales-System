/**
 * YOUR SHOPS — switching between them, and adding another.
 *
 * A person may work at more than one: an owner of a forge who also pulls shifts
 * at a tavern, someone running two shops of their own. Each is a MEMBERSHIP
 * with its own role and its own standing — you can own one and be a pending
 * employee at another, and neither says anything about the other.
 *
 * Only ONE is live at a time, and the whole app reads it: every screen shows
 * the shop you are currently working as, because the Worker resolves your
 * business from your account on every request. Switching is therefore a change
 * of identity, not a filter — which is why it reloads the page rather than
 * trying to re-render forty screens in place, and why it is a nav entry rather
 * than a dropdown tucked inside one of them.
 *
 * ADDING one uses THE SAME CODE a newcomer types. A founder code makes a shop
 * and hands it to you; a staff code puts you in one as a pending employee.
 * Anything else would be a second set of rules about who may create a company,
 * and the point of the codes is that there is only one.
 */
import { el, mount, esc } from './dom.js';
import { api } from './api.js';
import { toast } from './toast.js';

/**
 * What to do once the live shop has changed: start again from the top.
 *
 * A RELOAD rather than a re-render, and deliberately. The screen you are on may
 * not exist for the shop you just moved to — a manager at one is an ordinary
 * employee at the next, and half the app's nav, tiles and permissions differ.
 * Re-deriving all of that in place is a great deal of machinery to get subtly
 * wrong; asking the browser to start over gets it exactly right for free, and
 * it is the same thing the app already does after a sign-out.
 */
export function reloadAsNewBusiness() {
  location.hash = '#/';
  location.reload();
}

/** How a membership reads in a list: the shop, and what you are there. */
function memberLine(m) {
  const role = { owner: 'Owner', manager: 'Manager', employee: 'Employee', admin: 'Admin' }[m.role] || m.role;
  const pending = m.status === 'pending' ? ' <span class="pill warn">pending</span>' : '';
  return '<b>' + esc(m.business || '—') + '</b> <span class="note">' + esc(role) + '</span>' + pending;
}

/**
 * The panel: every shop you belong to, and a box to add another.
 *
 * `onSwitched` runs after a successful switch. The shell hands it a full
 * reload, because the page you are on may not even exist for the shop you just
 * moved to — a manager at one shop is an ordinary employee at the next.
 */
export function businessesPanel(me, onSwitched) {
  const host = el('div', {});
  const status = el('p', {});
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  const code = el('input', {
    type: 'text', placeholder: 'e.g. SHOP-ABCD-2345', autocomplete: 'off', 'aria-label': 'Business code',
  });
  // Codes are printed in caps; accept whatever is typed and show it that way.
  code.addEventListener('input', () => {
    const at = code.selectionStart;
    code.value = code.value.toUpperCase();
    code.setSelectionRange(at, at);
  });

  // A founder code names a shop of your own, so those two fields only appear
  // once the code has been checked and turns out to be one.
  const bizName = el('input', { type: 'text', placeholder: 'e.g. Riverwood Trader' });
  // The realm's own regions, offered exactly as sign-up offers them — a shop
  // founded without one gets no register default, no weekly Market Info and no
  // Court, and an admin has to go and fix it.
  const holdSel = el('select', {});
  const holdWrap = el('div', {}, [el('label', {}, 'Region'), holdSel]);
  const nameWrap = el('div', {}, [el('label', {}, 'Name your new business'), bizName, holdWrap]);
  nameWrap.hidden = true;
  const add = el('button.primary', { onclick: doAdd }, 'Add');

  let checked = null; // what the last checked code opens

  async function doAdd() {
    const typed = code.value.trim();
    if (!typed) { setStatus('Enter the code you were given.', 'error'); return; }
    add.disabled = true;
    try {
      // CHECKED FIRST, so a founder code can ask for a name before it makes
      // anything. The same check the sign-up form uses.
      if (!checked || checked.code !== typed) {
        setStatus('Checking…', '');
        const found = await api.checkCode(typed);
        checked = { ...found, code: typed };
        nameWrap.hidden = found.kind !== 'realm';
        if (found.kind === 'realm') {
          holdSel.replaceChildren(...(found.holds || []).map((h) => el('option', { value: h }, h)));
          // A realm that does not trade by region has nothing to ask.
          holdWrap.hidden = found.showRegion === false || !(found.holds || []).length;
          if (found.regionLabel) holdWrap.firstChild.textContent = found.regionLabel;
          setStatus('That opens a new business of your own — name it, then press Add again.', '');
          add.disabled = false;
          bizName.focus();
          return;
        }
      }
      if (checked.kind === 'realm' && !bizName.value.trim()) {
        setStatus('Name your business.', 'error');
        add.disabled = false;
        return;
      }
      setStatus('Adding…', '');
      await api.addBusiness(typed, bizName.value.trim(), holdWrap.hidden ? '' : holdSel.value);
      toast(checked.kind === 'realm' ? 'Business created — you are its owner.' : 'Joined ' + checked.business + '.', 'ok');
      // Left in a working state BEFORE handing over, whatever the caller does
      // next. The shell reloads, so nobody sees this — but a component that
      // only works because of what its caller happens to do is one that breaks
      // the first time somebody reuses it.
      add.disabled = false;
      checked = null;
      code.value = '';
      bizName.value = '';
      nameWrap.hidden = true;
      // Adding makes the new shop the live one, so the app has to be redrawn as
      // that shop exactly as a switch would.
      onSwitched();
    } catch (e) {
      setStatus(e.message || String(e), 'error');
      add.disabled = false;
    }
  }

  async function pick(uid) {
    setStatus('Switching…', '');
    try {
      await api.switchBusiness(uid);
      onSwitched();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  const mine = (me && me.businesses) || [];
  mount(host,
    el('p', { class: 'note' }, mine.length > 1
      ? 'You work at more than one shop. Pick the one you want to work as — every screen follows it.'
      : 'The shop you work at. Add another with a Business Code and you can switch between them here.'),
    ...mine.map((m) => el('div.emp-row', {}, [
      el('span', { class: 'emp-who', html: memberLine(m) }),
      m.current
        ? el('span', { class: 'pill' }, 'Working as')
        : el('button.primary.small', { onclick: () => pick(m.uid) }, 'Switch to'),
    ])),
    el('h4', {}, 'Add a business'),
    el('p', { class: 'note' }, 'Type the code you were given. A shop’s staff code joins you to it; ' +
      'a founder code lets you name a business of your own.'),
    code,
    nameWrap,
    el('div', { class: 'row-actions' }, [add]),
    status,
  );
  return host;
}
