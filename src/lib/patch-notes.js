/**
 * Patch notes — a static changelog rendered as its own nav page. Add a new
 * entry at the top as features ship.
 */
export const PATCH_NOTES = [
  { version: '2.6', date: '2026-07-20', notes: [
    'Master Item Index (admin) — manage canonical item names and base values.',
    'Editable Holds index in Network Settings.',
    'Register item search backed by the master index; base value / your price auto-fill; off-inventory and new items still sell but are flagged in the audit log (new items stay out of market). Typos are normalized to canonical names.',
  ] },
  { version: '2.5', date: '2026-07-20', notes: [
    'Shop Ledger: Coffers (treasury with sales/intake/void tracking + manual adjustments), reusable Discounts on the register, and a shop Style (tagline + accent).',
    'Audit Log (admin), transfer history, and searchable Member/Company lists.',
    'Scheduled MOTDs are timezone-correct; cleanup of orphaned code.',
  ] },
  { version: '2.4', date: '2026-07-20', notes: [
    'Transfer goods between companies — leaves your stock now, arrives once the receiver accepts.',
    'Pending-transfer banner (with a jump to Inventory) that persists on every page.',
    'Decline an incoming transfer or cancel an outgoing one — goods return to the sender.',
  ] },
  { version: '2.3', date: '2026-07-20', notes: [
    'MOTD is its own admin page (MOTD button).',
    'Schedule per-business notices with a start/end window.',
    'Automatic subscription-expiry warning banner (adjustable lead time) that persists on every page.',
  ] },
  { version: '2.2', date: '2026-07-20', notes: [
    'Message of the day — admins can post a notice shown on everyone’s Home.',
  ] },
  { version: '2.1', date: '2026-07-20', notes: [
    'Market Analysis is its own admin page with Overview, Item, Hold, and Company sub-pages (Item search included).',
    'Court businesses get a Hold Report for their own hold.',
    'Network Settings: “Clear all logs” to wipe sales/intake for a fresh season.',
  ] },
  { version: '2.0', date: '2026-07-20', notes: [
    'Market Analysis (admin): network revenue, per-shop and per-hold performance, below-cost and low-stock alerts.',
  ] },
  { version: '1.9', date: '2026-07-20', notes: [
    'Language picker in Profile — translate the interface (Español, Français, Deutsch, Italiano).',
    'Admin nav labeled “Admin Panel”.',
  ] },
  { version: '1.8', date: '2026-07-20', notes: [
    'Subscription panel on Home / Business Operations.',
    'Owners can keep private notes on each employee.',
    'Action-bar buttons persist across a section’s sub-pages.',
    'Patch Notes is its own page; Sign Out lives in the menu.',
  ] },
  { version: '1.7', date: '2026-07-20', notes: [
    'Scheduled backup mirrors the live data into a Google Sheet you control.',
    'Admins can run a backup on demand from Home.',
  ] },
  { version: '1.6', date: '2026-07-20', notes: [
    'Admins can delete members and companies from the admin lists.',
    'Deleting a company archives it — market data kept, name freed, records sealed.',
  ] },
  { version: '1.5', date: '2026-07-20', notes: [
    'Businesses are associated with a Hold at registration.',
    'Admins can flag a company as a Court.',
    'Action bar buttons scale to fit on mobile.',
  ] },
  { version: '1.4', date: '2026-07-19', notes: [
    'New Business Operations page — Register, Inventory, and Employees moved to its action bar.',
    'Network Settings moved to the admin Home action bar.',
  ] },
  { version: '1.3', date: '2026-07-19', notes: [
    'Floating, centered header; action bar tucks beneath it.',
    'Admins can edit a member’s name, company, and role.',
    'Patch Notes as a menu page on mobile; steadier mobile sign-in.',
  ] },
  { version: '1.2', date: '2026-07-19', notes: [
    'Currency shown in gold pieces (gp).',
    'Stay signed in across reloads; Sign Out on the top bar / menu.',
  ] },
  { version: '1.1', date: '2026-07-19', notes: [
    'Admin: Member List and Company List pages.',
    'Admin can edit a company’s name and subscription.',
  ] },
  { version: '1.0', date: '2026-07-19', notes: [
    'The Register (POS): ring up sales, order lookup, and void.',
    'Certification gate — expired shops can’t sell.',
  ] },
  { version: '0.9', date: '2026-07-19', notes: [
    'Top action bar for contextual buttons.',
    'Record Intake and item edits are now focus windows.',
  ] },
  { version: '0.8', date: '2026-07-18', notes: [
    'Inventory management (Cloudflare D1).',
    'Intake as a transaction — tracks cost paid and source hold.',
  ] },
  { version: '0.7', date: '2026-07-18', notes: [
    'Editable company name in Ledger Settings.',
    'Patch notes panel.',
    'Renamed to The EEC Automated Ledger.',
  ] },
  { version: '0.6', date: '2026-07-18', notes: [
    'Sidebar / mobile drawer navigation.',
    'Landing & About page with credits.',
  ] },
  { version: '0.5', date: '2026-07-18', notes: [
    'Editable profile + theme picker.',
    'Mobile-friendly layout.',
  ] },
  { version: '0.4', date: '2026-07-18', notes: [
    'Admin Network Settings.',
    'Owner Ledger Settings.',
  ] },
  { version: '0.3', date: '2026-07-18', notes: ['Character names as your display identity.'] },
  { version: '0.2', date: '2026-07-18', notes: ['Registration, roles, and employee management.'] },
  { version: '0.1', date: '2026-07-18', notes: ['Google sign-in and accounts.'] },
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
