/**
 * Registration — shown when a signed-in Google account isn't in the registry yet.
 *
 * Registration is BY CODE, in two steps:
 *   1. Character name + the Business Code you were given.
 *   2. What the code opens:
 *        • a realm's FOUNDER code → Business Creation: name your shop, pick its
 *          hold, and you become its active owner.
 *        • a shop's STAFF code    → confirmation only: you join that shop as a
 *          pending employee, activated by its owner or an admin.
 *
 * Nothing here ever lists realms or shops. A person signing up sees only what
 * their own code admits them to, so the network can't be browsed by anyone who
 * doesn't already belong to it. The API enforces this; the form just collects.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

export function renderRegister(container, { profile, onRegistered }) {
  const status = el('p', { id: 'regStatus' });
  const stepHost = el('div', {});

  const charInput = el('input', { type: 'text', id: 'charName', placeholder: 'e.g. Brynja Iron-Song' });
  const codeInput = el('input', { type: 'text', id: 'joinCode', placeholder: 'e.g. SHOP-ABCD-2345', autocomplete: 'off' });
  const checkBtn = el('button.primary', { onclick: doCheck }, 'Continue');

  function setStatus(msg, cls) {
    status.className = cls || '';
    status.textContent = msg;
  }

  // Codes are printed in caps; accept whatever is typed and show it that way.
  codeInput.addEventListener('input', () => {
    const pos = codeInput.selectionStart;
    codeInput.value = codeInput.value.toUpperCase();
    codeInput.setSelectionRange(pos, pos);
  });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCheck(); });

  async function doCheck() {
    const character = charInput.value.trim();
    if (!character) { setStatus("Enter your character's name.", 'error'); return; }
    const code = codeInput.value.trim();
    if (!code) { setStatus('Enter the Business Code you were given.', 'error'); return; }
    checkBtn.disabled = true;
    setStatus('Checking code…', '');
    try {
      const found = await api.checkCode(code);
      setStatus('', '');
      if (found.kind === 'realm') showBusinessCreation(code, character, found);
      else showJoinShop(code, character, found);
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      checkBtn.disabled = false;
    }
  }

  /** Step 2a — a founder code: create your own shop inside that realm. */
  function showBusinessCreation(code, character, found) {
    const bizInput = el('input', { type: 'text', placeholder: 'e.g. Riverwood Trader' });
    const holdSelect = el('select', {});
    (found.holds || []).forEach((h) => holdSelect.appendChild(el('option', { value: h }, h)));
    const submit = el('button.primary', { onclick: doCreate }, 'Create my business');

    async function doCreate() {
      const businessName = bizInput.value.trim();
      if (!businessName) { setStatus('Enter your business name.', 'error'); return; }
      submit.disabled = true;
      setStatus('Creating your business…', '');
      try {
        const me = await api.register(code, character, businessName, holdSelect.value);
        onRegistered(me);
      } catch (e) {
        submit.disabled = false;
        setStatus(e.message || String(e), 'error');
      }
    }

    mount(stepHost, el('div.card', {}, [
      el('h3', {}, '🏛️ Create your business'),
      el('p', { class: 'note', html: 'Your code admits you to <b>' + esc(found.realmName) + '</b> as a shop owner. ' +
        'Name your business and pick the hold it trades in.' }),
      el('label', {}, 'Business name'),
      bizInput,
      el('p', { class: 'note' }, 'This name must not already be taken in this realm.'),
      el('label', {}, 'Hold'),
      holdSelect,
      el('div', { class: 'row-actions' }, [submit, backBtn()]),
    ]));
  }

  /** Step 2b — a staff code: join the shop the code belongs to. */
  function showJoinShop(code, character, found) {
    const submit = el('button.primary', { onclick: doJoin }, 'Join ' + found.business);

    async function doJoin() {
      submit.disabled = true;
      setStatus('Registering…', '');
      try {
        const me = await api.register(code, character);
        onRegistered(me);
      } catch (e) {
        submit.disabled = false;
        setStatus(e.message || String(e), 'error');
      }
    }

    mount(stepHost, el('div.card', {}, [
      el('h3', {}, '🧑‍🤝‍🧑 Join a business'),
      el('p', { html: 'Your code is for <b>' + esc(found.business) + '</b> in <b>' + esc(found.realmName) + '</b>.' }),
      el('p', { class: 'note' }, 'You will join as an employee. Your account stays pending until the shop’s owner ' +
        'or an admin activates it — until then you can sign in, but not ring up sales.'),
      el('div', { class: 'row-actions' }, [submit, backBtn()]),
    ]));
  }

  function backBtn() {
    return el('button.secondary-btn', { onclick: () => { mount(stepHost); setStatus('', ''); } }, 'Use a different code');
  }

  mount(container, el('div.card', {}, [
    el('h2', {}, 'Welcome, new trader'),
    el('p', { class: 'note', html:
      'Signed in as <b>' + esc(profile.email || '') + '</b>. ' +
      'Tell the Company who you trade as, and enter the code you were given.' }),

    el('label', {}, 'Character name'),
    charInput,
    el('p', { class: 'note' }, 'Your in-character name — this is what the Company and your shop see, not your email.'),

    el('label', {}, 'Business Code'),
    codeInput,
    el('p', { class: 'note' }, 'The code from your shop’s owner (to join their shop) or from an admin (to start ' +
      'a shop of your own). Ask whoever invited you if you don’t have one.'),

    el('div', { class: 'row-actions' }, [checkBtn]),
    status,
  ]), stepHost);
}
