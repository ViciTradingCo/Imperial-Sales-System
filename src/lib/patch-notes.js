/**
 * Patch notes — a static changelog rendered as its own nav page. Add a new
 * entry at the top as features ship.
 *
 * WRITTEN FOR THE PEOPLE USING THE APP, not for whoever maintains it. Each line
 * says what is different when they next open it, and what that is for. Anything
 * a shopkeeper cannot see is not a patch note: no refactors, no test coverage,
 * no build or audit tooling, no internal renames. A fix belongs here when the
 * broken thing was visible — describe what was wrong and what it does now, and
 * stop before "and here is how we stopped it happening again".
 */
const PATCH_NOTES = [
  { version: '4.1', date: '2026-08-12', notes: [
    'You can leave the shop you work for. Profile → Leave your shop. It ends your place on the roster there and then — no waiting on anybody to remove you.',
    'ANYTHING YOU ARE OWED STAYS OWED. The screen tells you the figure before you decide. Your shifts and the sales you rang up stay on the shop’s books, your owner still sees what they owe you, and they can still settle it after you have gone. Leaving is not forfeiting.',
    'You are signed out afterwards, and you are simply unregistered again — to work anywhere, including back at the same shop, you need that shop’s staff code, the same as when you first registered.',
    'Managers can leave too. Owners cannot: a shop whose owner walked out has nobody left to run it, so that stays an admin’s job — archiving the company or handing it to somebody else.',
    'You cannot leave mid-shift. Clock out first, or the shift would sit open on the shop’s log with nobody able to close it.',
  ] },
  { version: '4.0', date: '2026-08-12', notes: [
    'Inventory is two tables: STOCK — what your shop sells — and INGREDIENTS, what it crafts with. They were one list with a small pill on some rows, so finding your stock meant reading past your ingredients and finding your ingredients meant reading past your stock.',
    'They do not even want the same columns. Stock shows what you charge; an ingredient is never sold, so what matters is what it has cost you — its column reads “Bought at”, averaged over your own deliveries. Each table says how many items are in it, and the harvest column only appears where something in that table actually pays.',
    'Move an item between the two the same way as before: tick or untick Ingredient with Edit.',
    'Fixed: on a phone, the buttons in a table row stacked on top of each other and stretched every row to three times its height, pushing them out of reach. Table rows stay one line tall and the table scrolls sideways instead.',
  ] },
  { version: '3.9', date: '2026-08-12', notes: [
    'UPCHARGES. Shop Settings → Discounts & upcharges now takes both. Pick “Take off” for a discount or “Add on” for an upcharge, name it, and your staff can pick it at the register — a rush job, a rare commission, a customer in poor standing.',
    'The register does the same either way: choose a saved one, or set a direction and a percentage by hand. An upcharge can go well past 100% if your shop really does charge triple for something; a discount still cannot take off more than the whole price.',
    'The order now shows what the customer actually pays. It used to show only the subtotal, which was survivable while every adjustment took money off — with an upcharge it understated the bill. You now get the subtotal, the adjustment, and the total.',
    'Totals still round down in the customer’s favour, upcharge or not, and the sale records it in words — “Rush job (25% surcharge)” — so your sales log reads the same way you set it up.',
  ] },
  { version: '3.8', date: '2026-08-12', notes: [
    'The Stocktake ADDS what it finds. Paste a count for something your shop does not list yet and it creates the listing instead of skipping it — because finding something on the shelf that was never written down is exactly what a stocktake is for.',
    'A new listing is priced from the Master Item Index. If the index has never heard of the item either, it comes in unpriced and is flagged for an admin to look at, the same way an item sold at the register for the first time is — set a price with Edit before you sell it.',
    'It still never changes the price of something you already list, and still leaves anything you left out exactly as it is. The check tells you what would be added, and at what price, before anything happens.',
  ] },
  { version: '3.7', date: '2026-08-12', notes: [
    'Fixed: the Stocktake would not do anything with what you pasted. The box took your counts perfectly well, but “Check this paste” and “Apply” sat below the bottom edge of the window — so you pasted, looked for the button, and there wasn\'t one. The two buttons are now pinned to the foot of the window and stay there however long the list of changes gets.',
    'The Stocktake window is wider and its two boxes are shorter, so the whole job fits on a phone screen without hunting for anything.',
  ] },
  { version: '3.6', date: '2026-08-12', notes: [
    'MANAGERS. An owner can appoint any employee as a manager, from the Roster. A manager runs the shop as the owner does — buying, inventory, the roster, notices, the shop ledger, transfers, the time card log — so a shop no longer stops when its owner is not online.',
    'What stays the owner\'s alone: setting what people are paid, appointing other managers, reissuing the staff code, renaming the shop, and exporting the books. A manager cannot give themselves a raise or hand the shop to anybody.',
    'COMMISSION. Set a percentage beside an employee\'s hourly rate — one, the other, or both. They earn that share of every sale they ring up, worked out on what the shop actually took after any discount.',
    'The time card payout now reads Hourly, Commission and Total, per person and across the shop, so the figure you settle is one you can check. Employees see the same split for their own work. Marking somebody paid settles both halves at once.',
    'A rate change applies to what happens next, never to what has already been earned — a finished shift keeps its rate and a rung-up sale keeps its commission, so a raise never restates what you already agreed to pay. Voiding a sale takes its commission back with it, unless it has already been paid out.',
    'STOCKTAKE. Inventory has a Stocktake button: your counts as plain text, one “Name, Amount” per line. Copy it out, count the back room, paste it back. It shows you exactly what will change before it changes anything.',
    'It sets counts and nothing else — no prices are touched — and anything you leave out is left alone, so counting one shelf is safe to paste on its own. An item your shop does not stock is reported rather than invented.',
    'ARCHIVING A COMPANY. What was the Company List\'s Delete button is now Archive, and it says what it does: the shop stops trading and leaves the list, and nothing is deleted.',
    'New: Archived companies, beside the search. Restoring one brings it back exactly as it was — its people, its stock, its books and its settings all return with it, and it takes its old name back. For a shop that leaves the server and comes back later, nothing is lost in between.',
    'Archiving still frees the shop\'s name for somebody else. If that name has been taken by the time you restore, you are told so and asked to sort it out, rather than the shop quietly coming back under a different one.',
    'Fixed: an archived shop with a perpetual certification could still ring up sales. It cannot now.',
  ] },
  { version: '3.5', date: '2026-08-11', notes: [
    'Fixed: you could not approve a new employee. Anyone waiting to be activated showed up on the Roster as a blank line with a stray tick box on it — their name, their pending badge and the Activate button beside it were all there, squeezed to nothing by a tick box that had stretched itself across the whole row. Every roster row now reads properly and Activate is where it should be.',
    'The same stretched tick box could have turned up anywhere a new one was added. It is fixed once, for all of them, rather than on the Roster alone.',
    'The tick box for activating several people at once now only appears when there are several people to activate, and it says "Select all pending" instead of sitting there unlabelled. With one person waiting there is just their Activate button, which was always the only thing that could have worked.',
  ] },
  { version: '3.4', date: '2026-08-11', notes: [
    'Shops can pay their own people for what they bring in. Owners set an Employee harvest value on any item in Inventory — what one of your staff earns for each one — and the item then says so wherever it is picked.',
    'On the register\'s Harvest side, the search marks the items your shop pays for, and the total tells you what you are owed before you record anything. Bring in twenty of something at 5 a piece and it says so.',
    'Recording it adds the stock and takes the payment out of the shop coffer as a business expense, in one step, with your name on the entry. No item has a value until an owner sets one, so nothing about Harvest changes for a shop that does not buy from its staff.',
    'The rate is the owner\'s and is read from the item when you record — you cannot name your own price, and a claim on an item with no value set is refused rather than paid at nothing.',
    'What your shop pays its own people is a wage, not what the item is worth, so it stays out of Market Analysis and out of the underpriced-stock check. A harvest has never counted as a purchase there and still does not.',
  ] },
  { version: '3.3', date: '2026-08-09', notes: [
    'Text size, under Profile → Appearance: Small, Normal, Large or Largest. It sets the writing, the figures, the menu and the ruled lines together, so the entries still sit on the lines at every size. Per device, since a phone in your hand and a monitor on your desk are not the same reading distance.',
    'Fixed: the side menu had no page under it. That was invisible while everything was cream, and became dark ink on dark wood the moment the desk arrived behind it. It is a leaf of the book now, like the pages beside it.',
  ] },
  { version: '3.2', date: '2026-08-09', notes: [
    'On a computer, the pages now lie on a wooden desk — planks, grain and a lamp above them, with each leaf casting a shadow onto the bench. Each surface gets its own timber: worn oak for the ledger, an older redder bench for the scroll, dark wood at the edge of the candlelight for the tome.',
    'Not on a phone, where the page fills the screen edge to edge and there is no desk to see around it.',
    'Fixed: an empty bar sat across the top of the screen on pages with no buttons, and followed you as you scrolled. It was the contextual button bar, being told to hide and going on taking up the room anyway.',
  ] },
  { version: '3.1', date: '2026-08-09', notes: [
    'The Ledger looks like a ledger. Every page is now a ruled leaf of an account book with a red margin, entries written by hand, and headings set in a printer\'s type.',
    'Anything you TYPE INTO — every field, every table, every sum — stays in a plain upright face with figures that line up in a column. Handwriting is for reading; numbers are for working with, and a quantity is no place for calligraphy.',
    'Three surfaces to choose from under Profile → Appearance: Ledger book, Scroll (unruled vellum, no margin), and Midnight tome for reading in the dark. If you had already picked a theme, yours has been carried over to whichever of the three it became.',
  ] },
  { version: '3.0', date: '2026-08-09', notes: [
    'The register has four sides: Selling, Buying, Harvest and Craft. Everything that changes your stock is now in one place, on its own page, instead of two of them being buttons on the Inventory list.',
    'Harvest and Craft are pages rather than pop-up windows, and both stay open after you use them — bring in a second crop or make a second batch without reopening anything. Craft re-reads your stock after each one, so what you just made is available to use straight away.',
    'Inventory is what your shop HOLDS. It still corrects a count, a price or a listing, and still transfers stock to another company — but buying, growing, making and selling all happen at the register now.',
    'Inventory: the bulk Import/Export has been removed.',
  ] },
  { version: '2.9', date: '2026-08-09', notes: [
    'Sales Log: a delivery that brought several items is now ONE entry with its items listed inside it, headed with the date, the supplier and what the whole trip cost. It used to be one row per item, with nothing saying they arrived together and the figure you actually handed over nowhere on the screen. Each item still has its own Delete, since the usual mistake is one wrong quantity among several right ones.',
    'The recent deliveries on the Buying page group the same way — one line per trip, with its items and its total.',
    'Intake: the item lines have proper column headings — Item, Qty, Cost each, Line total — so the boxes still say what they are once you have typed over the placeholder.',
  ] },
  { version: '2.8', date: '2026-08-09', notes: [
    'Intake is the Buying page itself — three cards down the page instead of a pop-up asking one question at a time. You can see what you have already typed, the deliveries list you are checking against is right below it, and there is no window to open first.',
    'What arrived, what you will charge, and where it came from are cards 1, 2 and 3. The second one fills itself in from the first as you add lines, and the summary above the Record button keeps up as you type.',
    'The form clears itself after a delivery is recorded, ready for the next one.',
    'The "How this works" help is still there, on each card, and still opens itself only for someone who has not recorded a delivery before.',
  ] },
  { version: '2.7', date: '2026-08-09', notes: [
    'The feedback form has a "Report Delivery" subject. Use it to tell the network about a delivery rather than about the app.',
    'Those reports go to their own Appointments tab on the admin review page instead of sitting in the middle of the bug reports — a thing waiting on somebody looked exactly like a thing waiting on nobody. Its button says Archive, since the delivery is what gets completed and the button only files the report.',
    'Everything still archives to the same place, and reopening a delivery report puts it back in Appointments rather than in with the feedback.',
    'Admins: the subscription date now works the way a date field should. On a phone it opens your own date wheel; on a computer the calendar opens and stays open — it used to shut again the instant you clicked, because the page was asking for it a second time on the same click. There is a Calendar button and a Clear button beside it.',
    'The separate "or type it (YYYY-MM-DD)" box is gone. The date field takes typing on its own, and having two boxes that had to agree was why the wrong one got filled in.',
  ] },
  { version: '2.6', date: '2026-08-09', notes: [
    'Admins: global notices are a list you manage, not one box. Post several, schedule each with a start and an end, edit one without retyping the rest, and take one down on its own. Before this there was a single message that could only be overwritten or cleared, so the only record of what had been announced was remembering it.',
    'The notices already posted are kept — your current global message becomes the first entry in the list.',
    'Shop owners can edit a notice on their board instead of deleting it and writing it again, which used to throw away its schedule too.',
  ] },
  { version: '2.5', date: '2026-08-09', notes: [
    'Admins: the Master Item Index is one table on the page. It was a tile per type, each opening its own list in a window — so seeing what the index held cost a click per type, and two items filed differently could not be looked at together. Now every item is listed at once, sorted by name, with the table it is filed under as a column.',
    'The types are still there as a filter beside the search. Picking one narrows the list in place, and Add, Import/Export and Empty follow whatever is on screen — each button says which, so none of them can act on something you are not looking at.',
    'Ticking and moving items between tables works from the same list, and long indexes are paged rather than rendered all at once.',
  ] },
  { version: '2.4', date: '2026-08-09', notes: [
    'A delivery can hold as many items as the trip brought. Add a line each — item, quantity, cost — and the total keeps up as you type, so you can check the form against what you actually handed over. The supplier and the region are asked once, because a crate comes from one person on one day.',
    'The second step now asks what each item will sell for, one at a time, with the Ingredient tick beside it. An ingredient run is one delivery again rather than a trip back to the form per reagent.',
    'The whole delivery lands or none of it does. Every line is checked before anything is written, and a mistake tells you which line it is on — so a typo on the fourth item can no longer leave the first three recorded with nothing saying so.',
  ] },
  { version: '2.3', date: '2026-08-09', notes: [
    'Intake explains itself. Every step of the form now has a "How this step works" panel — what the step is for, which number goes where, and what goes wrong. It opens itself the first time and stays shut once you have recorded a delivery, so it teaches without nagging.',
    'Recording a delivery is now one button, named for what it actually covers: Intake Ingredients/Stock. Buy Ingredients is gone — it recorded the same thing by a different door, and you could not tell from the tiles which door your purchase went through. An ingredient run is several intakes, one per reagent.',
    'What the basket was good for was kept: picking an item shows what you usually pay for it and fills the cost in from your own past deliveries, falling back to the index for something you have never bought. What is genuinely gone is the running total as you shop.',
    'Inventory no longer has a buying button at all. It is the list of what you have; what you spend is the register.',
  ] },
  { version: '2.2', date: '2026-08-09', notes: [
    'The register has two sides: Selling and Buying. Selling is the till you already know. Buying is where deliveries are now recorded — a supplier, a price, coin leaving the coffer is a thing you do at the counter, not a property of a list.',
    'Record Intake and Buy Ingredients have moved off Inventory and onto the register\'s Buying side. Inventory keeps what makes stock without spending: Farm/Harvest, Craft, and correcting a count. The old Inventory button is still there and takes you straight to Buying.',
    'Buying shows the last few deliveries, so you can see that what you just recorded actually landed. The full history — and removing a delivery entered by mistake — is still in Sales Log.',
    'Each side is its own page, so Back works and a half-built cart is not thrown away by a glance at your deliveries.',
    'Public storefronts are shelved. The share link, the network switch, and the public shop page are gone from the site; nothing else changes, and no shop data was touched. We will revisit it.',
    'Fixed: Market Analysis did not open for admins at all — the page threw before it drew anything, and had done since the Sales Log release on 7 August. The region tab was asking a question nobody had imported the answer to.',
    'Fixed: a shop, character or region whose name has an apostrophe in it was shown with "&#39;" where the apostrophe should be, on the register, Inventory, Employees, Home, the Shop Ledger and Court Tools. Grim&#39;s Forge is now Grim\'s Forge.',
  ] },
  { version: '2.1', date: '2026-08-09', notes: [
    'Fixed: a delivery recorded with different capitalisation ("iron sword" against "Iron Sword") was creating a SECOND listing with its own stock and price. The stock went up on a row nobody was looking at, which is why intake looked like it was not updating. Deliveries now always land on the listing you already have.',
    'Fixed: an ordinary restock was silently clearing an item\'s Ingredient flag, putting it back into the register and the pricing figures. A restock is not a re-classification — the flag only changes when the form actually says so.',
    'Inventory: Farm/Harvest. For stock you produced rather than bought — a crop, a hunt, a dig. Item and quantity, nothing else. No money leaves your coffer, and it is not counted as a purchase in the market figures.',
    'Inventory: Buy Ingredients. Build a basket and watch it total as you go, with prices starting at what you have paid before. Record it once and every line becomes a delivery with the stock added.',
    'Inventory: ingredients now show what they cost you — the average of your own deliveries, weighted by quantity — since a sale price says nothing about something you never sell.',
    'Intake accepts an item the index has never heard of, the same way the register now does.',
    'Time Cards, next to Register and Inventory. Clock on and off, see your own hours and what you are owed. Owners get a shift log with hours and wages per person, and can correct a forgotten clock-out. Marking wages paid records that it happened — it does not move coin.',
    'Employees: an hourly Pay rate on each person. It applies to shifts from then on, so a raise never changes what past work was worth.',
    'Employees can craft. The person at the bench is usually not the owner.',
  ] },
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
    'Fixed: the Record Intake button did nothing. A rename in the last release left the form calling something that no longer existed, so it failed before it could open.',
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
