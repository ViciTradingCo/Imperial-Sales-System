/**
 * Patch notes — a static changelog rendered as its own nav page. Add a new
 * entry at the top as features ship.
 */
const PATCH_NOTES = [
  { version: '2.0', date: '2026-08-07', notes: [
    'The register can sell something that is not in the item index. Type the name, give the price, and the sale goes through — the item is added to the index flagged as new, for an admin to confirm or remove. Previously the only options were to abandon the sale or ring it up under the wrong name, and the item was left out of every report forever.',
    'Admins get a "New from the register" queue at the top of the Master Item Index, with a banner when anything is waiting. Each entry shows what it might be a duplicate of, so a misspelling can be told from a genuinely new thing at a glance. Keep it, or remove it — the sales are kept either way.',
    'Your Staff code has moved to the Employees page, which is where you are when you want to invite someone. It is no longer under Shop Settings.',
    'Shop Settings has a button on Home. It used to be reachable only from the side menu, which on a phone is behind the hamburger.',
  ] },
  { version: '1.9', date: '2026-08-07', notes: [
    'The buttons on a shop\'s Home page now open real pages instead of pop-up windows. The side menu and the shop-tools bar stay visible, Back works, and the address bar points at what you are actually looking at — so you can bookmark it or return to it.',
    'Restock and Shop Ledger got pages of their own to make that work. The restock nudge on the banner still opens as a window, since there you are mid-task and want to dismiss it.',
    'New Sales Log page, beside Register and Inventory: past sales and past deliveries in one place, each with the correction it allows — void an order, delete a delivery. Order Lookup has moved off the bottom of the register, and the delivery history off the bottom of Inventory.',
    'Home has buttons for Sales Log and, for shop owners, Market Info — so the things you consult are on the front page rather than at the foot of the things you use.',
  ] },
  { version: '1.8', date: '2026-08-05', notes: [
    'Shop owners have a new Market Info button beside Register and Inventory: what things are WORTH in your region, over the week just gone. It is the same Item Performance view an admin reads realm-wide — the top five items, each with its own graph, and a search for the rest — narrowed to your region and to the settled week.',
    'Everything that happens weekly now happens at the same moment: the market figures roll and the backup reminder arrives together, when the new week begins (Monday). The reminder used to fire on Sunday, a day before the figures it was about had settled.',
    'Inventory: the list of recorded deliveries at the bottom of the page now says History.',
    'Market Analysis → Company Performance now lists every registered company, including the ones that have not sold anything. A shop missing from the table looked the same as a shop that did not exist; a row of zeroes is something an admin can act on.',
    'The app now tells you when a new version has been released, with a Refresh button. A tab left open used to go on running whatever it loaded, for days.',
    'Inventory: stock can be corrected by hand. Count the shelf, enter what is actually there. It moves no money and records no purchase — for goods you really bought, record an intake so the coffer matches.',
    'Intake: Vendor and "bought from a registered company" are one field. Type a name; shops on this network appear as you type. Pick one and it is credited for the supply and fills in its region; type anything else and it is recorded as written.',
    'Court Tools → Market: the Orders and Items Sold figures are gone — they said how busy the region was, not what its Court should do about it. Items nothing sold of are no longer listed.',
    'Court Tools → Market: trade from sellers nobody registered now has its own "Unregistered shops" line, so the table adds up to the region\'s revenue instead of quietly falling short of it.',
  ] },
  { version: '1.7', date: '2026-08-05', notes: [
    'Money is whole coins. Prices can still be typed with a fraction — 22.5 is accepted anywhere a price is asked for — but every amount the system records or shows is a whole number with the fraction dropped, never rounded up. A ledger reads 1240gp, not 1240.00gp.',
    'The rounding happens once, on the total, so a cart of three items at 10.5 takes 31 rather than losing a coin on every line. A percentage discount rounds down the same way, and voiding a sale gives back exactly what was taken.',
  ] },
  { version: '1.6', date: '2026-08-04', notes: [
    'Fixed: the Record Intake button did nothing. A rename in the last release left the form calling something that no longer existed, so it failed before it could open. There is now a test that catches this whole class of mistake before it ships.',
    'Recording intake is now three short steps — what arrived, what it cost, where it came from — with Previous and Next, and a summary of the whole delivery before anything is recorded.',
    'You stay signed in for 24 hours. Signing in with Google now issues a session that lasts a day, so reloading, closing the tab, or leaving the app on your phone no longer signs you out. Sign Out still signs you out immediately, everywhere.',
  ] },
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
