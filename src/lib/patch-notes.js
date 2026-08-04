/**
 * Patch notes — a static changelog rendered as its own nav page. Add a new
 * entry at the top as features ship.
 */
export const PATCH_NOTES = [
  { version: '1.5', date: '2026-08-04', notes: [
    'Court Tools: a company flagged as a Court now governs its region from one page in the side menu — a levy on trade, licences and sanctions on the shops it oversees, price controls, a public notice, the treasury, and a view of everything held in the region.',
    'The levy never moves money on its own. A Court sets a percentage, the system records what each shop owes, and the Court marks it paid when it actually is. Set it to 0 and the feature is simply off.',
    'Courts can also look: a read-only view of every company in their region — rosters, ledgers and performance — without seeing anything outside it.',
    'Register: a sale can be ticked as an Employee Purchase. It leaves the stock and the record alone but charges nothing, and it is kept out of every statistic.',
    'Inventory: crafting. Turn a quantity of one or more items into a quantity of another — the ingredients come out of stock and the result goes in, in one step.',
    'Inventory: owners can set a sale price per item, which the register offers as the default. Deleting an intake entry is now possible, and an item that runs out of stock stays listed so its price and history survive.',
    'Intake: an item can be marked as an Ingredient (kept out of the register and out of pricing statistics), and can record which registered company it was Bought From.',
    'Intake now counts as trade for the region it came from, so a region that supplies goods shows up in Market Analysis instead of looking idle.',
    'Item Performance is down to what matters: one Average Value per item, worked out from every transaction in both directions, plus its best region and its trend. Over- and undercutting is measured against that value.',
    'Register: Style, Company and Settings are one Settings button. The Shop Ledger keeps Performance, Notices and Coffers; everything else moved into Shop Settings.',
    'Signing in sticks. The app no longer signs you out when a page reloads or when your phone puts the tab to sleep, and it quietly renews your session before it expires.',
  ] },
  { version: '1.4', date: '2026-08-03', notes: [
    'Feedback: owners and employees now have a Feedback page in the side menu. Pick a subject, write what you think, and send — your name, shop, and the date are attached automatically. You can see everything you have sent and whether it has been reviewed.',
    'Item Performance now leads with the top five items, each with its own trend graph, and a search box for looking up any item in the index.',
    'Item Performance reports what items are worth. "Average bought" is what shops pay on intake, "average sold" is what customers pay, and "average value" is a proper valuation from the sales themselves — so one collector overpaying no longer becomes an item\'s price.',
    'Market Analysis is quieter: the headline totals at the top of Overview are gone, and the Top 5 tables now match the pages they preview.',
  ] },
  { version: '1.3', date: '2026-08-03', notes: [
    'The Master Item Index is now divided into a table per type of item — Weapons, Potions, whatever your realm keeps. Everything that was already in the index is preserved in the "Unsorted" table.',
    'Imports sort themselves: put a type on the item line and it files itself. Each table can also carry extra flags, so a list that says "wep" can still land in Weapons.',
    'Every table has its own import/export, and items can be ticked and moved between tables in bulk.',
    'The import preview is now one table showing each line, where it will land, and what will happen to it.',
    'Admins: the Company List has a Ledger button — a read-only look at a shop\'s coffer, discounts, and performance.',
    'Admins: recent errors can be dismissed once dealt with, so the panel means "something is wrong now".',
    'The weekly backup reminder moved to Sunday.',
  ] },
  { version: '1.2', date: '2026-08-02', notes: [
    'New shops now open with a week of certification, so a new owner can trade the moment they sign up. Admins can change the length in Network Settings.',
    'Every realm can name its own money and its own regions, and switch the region field off entirely if its fiction has no regional trade.',
    'Sales history now stores plain numbers, so renaming your currency or your regions re-labels the history instead of invalidating it.',
    'The Item Index gained a purge, and imports no longer fold a genuinely new item into an existing one that merely looks similar.',
  ] },
  { version: '1.1', date: '2026-08-01', notes: [
    'One deployment can now host several independent servers ("realms"), with nothing shared between them. If you run only one realm, nothing changes and nothing new appears.',
    'Sign-up is by Business Code: type the code you were given and it takes you exactly where it admits you — founding your own shop, or joining an existing one as staff.',
    'Roles are clearer: System Admin runs the deployment, Realm Admin runs one realm, and shop owners and employees are unchanged.',
    'Pages with several sections now open them as big buttons rather than stacking every card down the screen.',
  ] },
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
