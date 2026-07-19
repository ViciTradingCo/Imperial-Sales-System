/**
 * Registration view — shown when a signed-in Google account isn't in the
 * registry yet. The user discloses a business name and whether they own it:
 *   • Owner   → the business is created (name must be free) and they become its
 *               active owner.
 *   • Employee → they join an existing business and wait for owner/admin
 *               activation (status: pending).
 * The API enforces all of this; this form just collects and reports.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

const DEFAULT_HOLDS = ['Eastmarch', 'Falkreath', 'Haafingar', 'Hjaalmarch', 'The Pale', 'The Reach', 'The Rift', 'Whiterun', 'Winterhold'];

export function renderRegister(container, { profile, onRegistered }) {
  const status = el('p', { id: 'regStatus' });

  const charInput = el('input', { type: 'text', id: 'charName', placeholder: 'e.g. Brynja Iron-Song' });
  const bizInput = el('input', { type: 'text', id: 'bizName', placeholder: 'e.g. Riverwood Trader' });

  const holdSelect = el('select', { id: 'bizHold' });
  DEFAULT_HOLDS.forEach((h) => holdSelect.appendChild(el('option', { value: h }, h)));
  // Refresh from the Core's authoritative hold list if it's reachable.
  api.getHolds().then((res) => {
    const holds = (res && res.holds) || [];
    if (!holds.length) return;
    const prev = holdSelect.value;
    holdSelect.innerHTML = '';
    holds.forEach((h) => holdSelect.appendChild(el('option', { value: h }, h)));
    if (holds.includes(prev)) holdSelect.value = prev;
  }).catch(() => { /* keep the defaults */ });
  // The Hold is a property of the BUSINESS, so it's only asked of owners (who
  // create it); employees join a business that already has one.
  const holdWrap = el('div', {}, [el('label', {}, 'Hold'), holdSelect,
    el('p', { class: 'note' }, 'The Skyrim hold your business trades in.')]);
  holdWrap.hidden = true;

  const ownerRadio = el('input', { type: 'radio', name: 'role', value: 'owner', id: 'roleOwner' });
  const empRadio = el('input', { type: 'radio', name: 'role', value: 'employee', id: 'roleEmp', checked: true });
  const syncHold = () => { holdWrap.hidden = !ownerRadio.checked; };
  ownerRadio.addEventListener('change', syncHold);
  empRadio.addEventListener('change', syncHold);

  const submit = el('button.primary', { onclick: doRegister }, 'Register');

  function setStatus(msg, cls) {
    status.className = cls || '';
    status.textContent = msg;
  }

  async function doRegister() {
    const character = charInput.value.trim();
    if (!character) { setStatus("Enter your character's name.", 'error'); return; }
    const businessName = bizInput.value.trim();
    if (!businessName) { setStatus('Enter your business name.', 'error'); return; }
    const asOwner = ownerRadio.checked;
    const hold = asOwner ? holdSelect.value : '';
    submit.disabled = true;
    setStatus('Registering…', '');
    try {
      const me = await api.register(businessName, asOwner, character, hold);
      onRegistered(me);
    } catch (e) {
      submit.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  const card = el('div.card', {}, [
    el('h2', {}, 'Welcome, new trader'),
    el('p', { class: 'note', html:
      'Signed in as <b>' + esc(profile.email || '') + '</b>. ' +
      'Tell the Company who you trade as, and who you trade for.' }),

    el('label', {}, 'Character name'),
    charInput,
    el('p', { class: 'note' }, 'Your in-character name — this is what the Company and your shop see, not your email.'),

    el('label', {}, 'Business name'),
    bizInput,

    el('label', {}, 'Your role'),
    el('div', { class: 'choice' }, [
      el('label', { class: 'inline' }, [empRadio, document.createTextNode(' I work for this business (employee)')]),
      el('label', { class: 'inline' }, [ownerRadio, document.createTextNode(' I own / am starting this business (owner)')]),
    ]),
    el('p', { class: 'note', html:
      'Owners create the business (the name must be free). Employees join an ' +
      'existing business and are activated by its owner or an admin.' }),

    holdWrap,

    submit,
    status,
  ]);

  mount(container, card);
}
