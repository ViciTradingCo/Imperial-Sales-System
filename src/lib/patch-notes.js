/**
 * Patch notes — a static changelog rendered in the right-hand column. Add a new
 * entry at the top as features ship.
 */
export const PATCH_NOTES = [
  { version: '1.0', notes: [
    'The Register (POS): ring up sales, order lookup, and void.',
    'Certification gate — expired shops can’t sell.',
  ] },
  { version: '0.9', notes: [
    'Top action bar for contextual buttons.',
    'Record Intake and item edits are now focus windows.',
  ] },
  { version: '0.8', notes: [
    'Inventory management (Cloudflare D1).',
    'Intake as a transaction — tracks cost paid and source hold.',
  ] },
  { version: '0.7', notes: [
    'Editable company name in Ledger Settings.',
    'Patch notes panel.',
    'Renamed to The EEC Automated Ledger.',
  ] },
  { version: '0.6', notes: [
    'Sidebar / mobile drawer navigation.',
    'Landing & About page with credits.',
  ] },
  { version: '0.5', notes: [
    'Editable profile + theme picker.',
    'Mobile-friendly layout.',
  ] },
  { version: '0.4', notes: [
    'Admin Network Settings.',
    'Owner Ledger Settings.',
  ] },
  { version: '0.3', notes: ['Character names as your display identity.'] },
  { version: '0.2', notes: ['Registration, roles, and employee management.'] },
  { version: '0.1', notes: ['Google sign-in and accounts.'] },
];

export function renderPatchNotes(container) {
  container.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Patch Notes';
  container.appendChild(h);

  PATCH_NOTES.forEach((p) => {
    const entry = document.createElement('div');
    entry.className = 'patch-entry';
    const ver = document.createElement('div');
    ver.className = 'patch-ver';
    ver.textContent = 'v' + p.version;
    entry.appendChild(ver);
    const ul = document.createElement('ul');
    p.notes.forEach((n) => {
      const li = document.createElement('li');
      li.textContent = n;
      ul.appendChild(li);
    });
    entry.appendChild(ul);
    container.appendChild(entry);
  });
}
