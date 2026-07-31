/**
 * Patch notes — a static changelog rendered as its own nav page. Add a new
 * entry at the top as features ship.
 */
export const PATCH_NOTES = [
  { version: '1.0', date: '2026-07-31', notes: [
    'Vici Trading Co. Automated Ledger is live! Sign in with Google to manage your shop — register sales, track inventory and intake, transfer goods between companies, and keep your coffers in order.',
  ] },
];

export function renderPatchNotes(container) {
  container.innerHTML = '';
  container.classList.add('patch-notes-page');
  const h = document.createElement('h3');
  h.textContent = 'Patch Notes';
  container.appendChild(h);

  PATCH_NOTES.forEach((p) => {
    const entry = document.createElement('div');
    entry.className = 'patch-entry';
    const ver = document.createElement('div');
    ver.className = 'patch-ver';
    ver.textContent = 'v' + p.version;
    if (p.date) {
      const d = document.createElement('span');
      d.className = 'patch-date';
      d.textContent = ' · ' + p.date;
      ver.appendChild(d);
    }
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
