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

export function renderRegister(container, { profile, onRegistered }) {
  const status = el('p', { id: 'regStatus' });

  const charInput = el('input', { type: 'text', id: 'charName', placeholder: 'e.g. Brynja Iron-Song' });
  const bizInput = el('input', { type: 'text', id: 'bizName', placeholder: 'e.g. Riverwood Trader' });

  const ownerRadio = el('input', { type: 'radio', name: 'role', value: 'owner', id: 'roleOwner' });
  const empRadio = el('input', { type: 'radio', name: 'role', value: 'employee', id: 'roleEmp', checked: true });

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
    submit.disabled = true;
    setStatus('Registering…', '');
    try {
      const me = await api.register(businessName, asOwner, character);
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
    el('p', { class: 'note' }, 'Your in-fiction name — this is what the Company and your shop see, not your email.'),

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

    submit,
    status,
  ]);

  mount(container, card);
}
