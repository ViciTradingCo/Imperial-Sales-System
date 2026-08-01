/**
 * Registration view — shown when a signed-in Google account isn't in the
 * registry yet. The user picks a realm, then discloses a business and whether
 * they own it:
 *   • Owner   → the business is created (the name must be free IN THAT REALM)
 *               and they become its active owner.
 *   • Employee → they join an existing business in that realm and wait for
 *               owner/admin activation (status: pending).
 *
 * The realm comes first because everything after it depends on it: the shop
 * list, the holds, and whether a name is free are all per-realm. An account
 * belongs to exactly one realm from here on; an admin can move someone who
 * picked wrong (Realm Management → Move between realms).
 *
 * The API enforces all of this; this form just collects and reports.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

const DEFAULT_HOLDS = ['Eastmarch', 'Falkreath', 'Haafingar', 'Hjaalmarch', 'The Pale', 'The Reach', 'The Rift', 'Whiterun', 'Winterhold'];

export function renderRegister(container, { profile, onRegistered }) {
  const status = el('p', { id: 'regStatus' });

  const charInput = el('input', { type: 'text', id: 'charName', placeholder: 'e.g. Brynja Iron-Song' });

  /* ---- realm ---- */
  const realmSelect = el('select', { id: 'realmPick' });
  const realmWrap = el('div', {}, [
    el('label', {}, 'Realm'),
    realmSelect,
    el('p', { class: 'note' }, 'Which server you play on. Realms are completely separate — you will only ever ' +
      'see the shops, items, and people of the realm you join.'),
  ]);
  realmWrap.hidden = true; // only worth showing when there's a choice to make

  /* ---- business: a picker for employees, a free field for owners ---- */
  const bizSelect = el('select', { id: 'bizPick' });
  const bizInput = el('input', { type: 'text', id: 'bizName', placeholder: 'e.g. Riverwood Trader' });
  const bizNote = el('p', { class: 'note' }, '');
  const bizWrapEmployee = el('div', {}, [el('label', {}, 'Business'), bizSelect, bizNote]);
  const bizWrapOwner = el('div', {}, [el('label', {}, 'Business name'), bizInput,
    el('p', { class: 'note' }, 'The name must not already be taken in this realm.')]);

  /* ---- hold (owners only — it's a property of the business) ---- */
  const holdSelect = el('select', { id: 'bizHold' });
  DEFAULT_HOLDS.forEach((h) => holdSelect.appendChild(el('option', { value: h }, h)));
  const holdWrap = el('div', {}, [el('label', {}, 'Hold'), holdSelect,
    el('p', { class: 'note' }, 'The hold your business trades in.')]);

  const ownerRadio = el('input', { type: 'radio', name: 'role', value: 'owner', id: 'roleOwner' });
  const empRadio = el('input', { type: 'radio', name: 'role', value: 'employee', id: 'roleEmp', checked: true });

  function syncRole() {
    const owner = ownerRadio.checked;
    holdWrap.hidden = !owner;
    bizWrapOwner.hidden = !owner;
    bizWrapEmployee.hidden = owner;
  }
  ownerRadio.addEventListener('change', syncRole);
  empRadio.addEventListener('change', syncRole);
  syncRole();

  const submit = el('button.primary', { onclick: doRegister }, 'Register');

  function setStatus(msg, cls) {
    status.className = cls || '';
    status.textContent = msg;
  }

  /** The realm the form is currently working against. */
  function realmId() {
    return realmSelect.value || '';
  }

  // Realms first; the shop list and holds follow from whichever is chosen.
  api.getRealmChoices().then((r) => {
    const realms = (r && r.realms) || [];
    realmSelect.innerHTML = '';
    realms.forEach((x) => realmSelect.appendChild(el('option', { value: x.id }, x.name)));
    // With a single realm there is nothing to choose, so don't ask.
    realmWrap.hidden = realms.length < 2;
    loadRealmData();
  }).catch(() => { loadRealmData(); });

  realmSelect.addEventListener('change', loadRealmData);

  /** Loads the shops and holds belonging to the selected realm. */
  function loadRealmData() {
    bizSelect.innerHTML = '';
    bizNote.textContent = 'Loading shops…';
    api.getRealmBusinesses(realmId()).then((r) => {
      const names = (r && r.businesses) || [];
      bizSelect.innerHTML = '';
      if (!names.length) {
        bizNote.textContent = 'No shops are registered in this realm yet — register as an owner to start the first one.';
        return;
      }
      names.forEach((n) => bizSelect.appendChild(el('option', { value: n }, n)));
      bizNote.textContent = 'Pick the shop you work for. Only shops in this realm are listed.';
    }).catch(() => { bizNote.textContent = 'Could not load the shop list — try again in a moment.'; });

    api.getHolds(realmId()).then((res) => {
      const holds = (res && res.holds) || [];
      if (!holds.length) return;
      const prev = holdSelect.value;
      holdSelect.innerHTML = '';
      holds.forEach((h) => holdSelect.appendChild(el('option', { value: h }, h)));
      if (holds.includes(prev)) holdSelect.value = prev;
    }).catch(() => { /* keep the defaults */ });
  }

  async function doRegister() {
    const character = charInput.value.trim();
    if (!character) { setStatus("Enter your character's name.", 'error'); return; }
    const asOwner = ownerRadio.checked;
    const businessName = asOwner ? bizInput.value.trim() : bizSelect.value;
    if (!businessName) {
      setStatus(asOwner ? 'Enter your business name.' : 'Pick the shop you work for.', 'error');
      return;
    }
    const hold = asOwner ? holdSelect.value : '';
    submit.disabled = true;
    setStatus('Registering…', '');
    try {
      const me = await api.register(businessName, asOwner, character, hold, realmId());
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

    realmWrap,

    el('label', {}, 'Your role'),
    el('div', { class: 'choice' }, [
      el('label', { class: 'inline' }, [empRadio, document.createTextNode(' I work for this business (employee)')]),
      el('label', { class: 'inline' }, [ownerRadio, document.createTextNode(' I own / am starting this business (owner)')]),
    ]),
    el('p', { class: 'note', html:
      'Owners create the business (the name must be free). Employees join an ' +
      'existing business and are activated by its owner or an admin.' }),

    bizWrapEmployee,
    bizWrapOwner,
    holdWrap,

    submit,
    status,
  ]);

  mount(container, card);
}
