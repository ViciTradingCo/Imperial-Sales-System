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
  { version: '7.2', date: '2026-08-29', notes: [
    'COURTS NOW LET THE PREMISES IN THEIR REGION. A new Property Index sits on the home page for a Court’s owner and managers: the places a shop can stand, who is on each, and what they are worth.',
    'A PROPERTY’S CODE IS WHAT CREATES A SHOP. Give it to whoever is taking the place; they sign up, name their own business, and it opens there — in your region, on those premises. They never see any other region or shop.',
    'A code only works while the premises are empty, so one can never put two shops in one building, and reissuing it kills the old one at once — the same fix as a leaked staff code.',
    'A Court can rename the business standing on its own property, and open that shop’s books from the place rather than from a list of names.',
    'An admin’s realm code is unchanged and carries no region and no property. That is what makes a shop answering to no Court — and how Courts themselves are set up — so a Court can never reach one.',
    'A property is the PLACE, not the shop: it keeps its name, its notes and its rent when a tenant leaves. Rent is a figure you record, exactly like the levy — nothing moves coin on its own.',
    'Closing or archiving a shop frees its premises as well as its name, so the Court can let them again. Restoring the shop does not put it back in the doorway; by then somebody else may be there.',
    'Only a Court’s OWNER changes any of this. A manager reads the index and the data behind it, and a Court’s other staff do not see the page at all.',
  ] },
  { version: '7.1', date: '2026-08-29', notes: [
    'AN ARCHIVED SHOP NOW LEAVES THE MARKET FIGURES WITH ITS TRADE. Market Analysis describes the network as it stands, and a shop nobody can buy from was still voting on what items are worth.',
    'That covers all of it: item values and the best-region column, region totals, Company Performance, the over- and underpricing lists, and a Court’s own region report and regional stock.',
    'Nothing is deleted, and nothing about closing a shop has changed. Restoring one puts every figure back exactly as it was — its sales were never touched, they simply stopped counting while it was away.',
    'A Court’s region still adds up. A delivery bought from a shop that has since closed is the buyer’s own record and stays in the region’s totals, but there is no longer a company to credit, so it moves to the “Unregistered shops” line.',
    'Fixed: renaming a company lost its credit for everything it had ever supplied. Deliveries recorded the supplier by name and that one reference was not moved with the rename, so past deliveries went on naming a shop that no longer existed.',
    'The same fault meant an archived shop’s name stayed on its old deliveries after being freed — so the next company to register under that name inherited supply it had never sent.',
  ] },
  { version: '7.0', date: '2026-08-26', notes: [
    'GERMAN IS FINISHED. The third language done end to end — the register, the stockrooms, the reports, the help under every form, the refusals the server sends back, and these notes.',
    'A German device opens a German ledger with nothing to switch on, and its dates come out German too. Appearance still lets you choose another language for this device.',
    'Italian is still being written, so it is still not offered — English until it is done.',
  ] },
  { version: '6.9', date: '2026-08-26', notes: [
    'SPANISH IS FINISHED. The same as French: every word, not a part of it — the register, the stockrooms, the reports, the help under every form, the server’s refusals, and these notes.',
    'A Spanish device now opens a Spanish ledger with nothing to switch on, and its dates come out Spanish too.',
    'German and Italian are still being written, so they are still not offered — English until they are done.',
  ] },
  { version: '6.8', date: '2026-08-26', notes: [
    'THE LEDGER SPEAKS FRENCH. Every word of it — the register, the stockrooms, the reports, the help text under every form, the refusals the server sends back, and these notes. Not part of it: all of it.',
    'If your device asks for French, that is what you get, with nothing to switch on. Appearance still lets you choose English instead.',
    'A language is only offered once it is FINISHED. A page half in your language and half in ours is not a smaller version of being translated, so a translation that is still being written is not shown at all. Spanish, German and Italian are on their way.',
    'Names stay as they are written — your shop, your characters, your items, and the kinds your realm has named. Those are yours, not ours to translate.',
  ] },
  { version: '6.7', date: '2026-08-25', notes: [
    'THE APP OPENS IN YOUR OWN LANGUAGE. It asked your device all along and never listened — it started in English and waited for you to find the setting. It now starts in whatever your device asks for, and Appearance still overrules it if you want something else.',
    'If your device lists more than one language, it takes the first one this app can write. Dates follow the same answer, so the words and the figures can never be in two different languages.',
    'Dates are also written YOUR way within a language — an American reads 8/16/2026 and a Briton reads 16/08/2026, with every word on the page the same.',
    'ANYTHING THAT DESTROYS SOMETHING IS NOW RED. Delete, Remove, Void, Archive, Purge, Leave, Close — one filled red button, the same everywhere, and nothing that is safe wears it. You no longer have to read the label to spot the one you cannot take back.',
    'Removing an inventory listing, voiding a sale and purging old logs were dressed as ordinary buttons. They are not, and now they do not look it.',
  ] },
  { version: '6.6', date: '2026-08-25', notes: [
    'YOU CAN CLOSE YOUR SHOP. Shop Settings → Close the Shop, for an owner, ends the business for good: it stops trading, its name is freed for someone else, and everyone on the roster is released.',
    'YOUR BOOKS ARE KEPT. Every sale, delivery, coffer entry and time card stays on the network’s records, and the page counts them for you before you decide. Nothing is erased — an admin can put the whole shop back if you change your mind.',
    'What the shop still owes stays owed. A departed employee’s hours and commission are still on the log and can still be settled.',
    'It will not let you close with anyone clocked in, or with a transfer still waiting — an open shift or a crate in mid-air would have nowhere to go. You are told which, by name.',
    'Owner only, and it asks you to write the shop’s name out. A manager runs the shop; ending it is not running it.',
    'DATES ARE IN THE APP’S LANGUAGE NOW. They followed whatever your device was set to, so an English page could print “16 – 22 août”. They follow your Appearance setting, like everything else.',
    'That covers Market Info’s week, the shift log, the sales and delivery lists, the audit trail, the item index, notices, and your best day of the week on Performance.',
  ] },
  { version: '6.5', date: '2026-08-21', notes: [
    'THE ORDER IS EDITABLE. Every line in the cart now has its count beside it — type over it, or use − and +. “They wanted three, not two” no longer means removing the line and typing the price in again.',
    'The line’s total and the order’s total follow as you type, and a special’s contents follow with them: three of a set that holds two ales now reads six ales, where it used to still say two.',
    'SPECIALS THAT ASK FOR KINDS TAKE A COUNT. Set How many to three and you are asked once for all three — fifteen food rather than five, three times over — and they ring up as three lines.',
    'They stay three lines on purpose: each one is its own deal with its own choice, and seven sweet rolls and three stews fills “five food” twice without either half being a neat five. The app works out the split for you.',
    'A special filled at the till has no count to edit in the cart, for the same reason — one line is one filling. Remove one if a customer changes their mind.',
  ] },
  { version: '6.4', date: '2026-08-20', notes: [
    'Shop Ledger → Performance is easier to read. The small labels under every figure were handwritten, uppercased and fixed at twelve pixels; they are printed now, sentence case, and they grow with your text size like the rest of the app.',
    'THE LAST 30 DAYS, against the 30 before. Revenue and orders each say whether they are up or down on the previous month, so the page answers “is my shop growing” without you working it out.',
    'Money in, money out, and what you kept — taken straight from your coffer over the same 30 days, so this page and your ledger can never disagree.',
    'HOW IT TRADES: your average order, items per order, how many customers you know by name and how many came back, your best day of the week, what you have given away in discounts, sales voided, and employee purchases.',
    'ON THE SHELF: what your stock is worth at your own prices, how many units you hold, and how many listings need restocking.',
    'NOT MOVING — the list a best-seller chart cannot show you: stock you are holding that has not sold in sixty days, worth most first. That is the money sitting on your shelves.',
    'WHAT SELLS, BY KIND — units of food, drink, weapons and the rest, once you have tagged your stock. A special counts as the things it actually took off the shelf.',
    'The revenue chart says what its tallest bar is worth. It used to hide that in a hover tooltip, which on a phone is nowhere at all.',
  ] },
  { version: '6.3', date: '2026-08-20', notes: [
    'CERTIFICATION IS NOW OPTIONAL, per realm. Network Settings → Certification has a switch: turn it off and no shop needs a subscription to trade.',
    'With it off nothing expires, no expiry warnings are shown, the Company List stops offering subscriptions, and a lapsed shop can ring up sales again.',
    'Nothing is erased by turning it off. Every subscription date stays on file, so switching it back on restores each shop exactly as it stood — it does not silently certify everybody.',
    'An archived shop still cannot trade, and neither can a business that is not registered. Those were never expiry questions.',
    'The old “New shops” setting lives in the same place now — it is the same question, and the trial length means nothing when certification is off, so it hides itself.',
  ] },
  { version: '6.2', date: '2026-08-20', notes: [
    'A SPECIAL CAN BE A PERCENTAGE OFF ITS OWN ITEMS. Set one up as “10% off” instead of a flat figure, and a full suit of armour sells for a tenth less — with the rest of the order rung up at full price beside it.',
    'That is the difference from a discount: a discount comes off the whole sale, this comes off only what is in the special.',
    'There is no fixed price to keep up to date. Reprice a piece and the deal follows it, because the saving is worked out from what you are charging that day.',
    'It works on both sorts of special — one that names its items, and one that asks for kinds and is filled at the till.',
    'A special priced this way needs every item in your inventory: there has to be a price to take a tenth off. You will be told which item is missing rather than quietly given it away.',
    'The kinds on an item are a dropdown and a row of chips now, instead of a grid of every kind at once — the picker is the size of the answer rather than the size of the list.',
  ] },
  { version: '6.1', date: '2026-08-19', notes: [
    'YOUR STOCK CAN SAY WHAT IT IS. Food, drink, a weapon, a potion — tag a listing with Edit, or answer for the whole shelf at once under Inventory → Kinds ("which of these are food?").',
    'The kinds come from your realm, so every shop uses the same words. An admin sets the list in Network Settings → Item kinds; it starts with Skyrim’s own — food, drink, potion, weapon, armor, and the rest.',
    'SPECIALS CAN NOW ASK FOR KINDS. "Five food and five drink for 40" — you set what it asks for, and the customer chooses which at the till from anything you have tagged.',
    'At the register, a special like that is marked “your choice”. Adding it asks what goes in it, counts as you go, and will not let a clerk go over or under what the deal says.',
    'It still rings up as ONE line at the special’s price, everything chosen still comes out of stock, and voiding it puts back exactly what was taken.',
    'One at a time: the next customer picks their own, so add it again for another.',
    'Specials that name their items work exactly as before, and so does everything you have already set up.',
  ] },
  { version: '6.0', date: '2026-08-19', notes: [
    'The About page has a tip jar under its credits. The Ledger is one person’s work, given away free; if it has saved you an evening of bookkeeping there is now a button there that says thank you.',
    'Nothing about the app changes whether you use it or not — no shop is treated differently, and nothing is held back behind it.',
    'Admins can write the About page ON the About page. Open it and there is an “Edit this page” button: the heading, the welcome, the credits and the tip jar become boxes you type into, with Save and Cancel at both ends.',
    'It replaces the form that was buried in Network Settings, where you wrote the page blind and had to go and look at it afterwards. The Network Settings tile now takes you to the page itself.',
    'A realm admin edits their own realm’s wording, as before. A box left blank shows what it will fall back to, so blank reads as “inherited” rather than “missing”.',
    'The page itself is shorter to read. What the Ledger is and what it does are one card now, and the credits and the tip jar close it as another, each divided by a ruled line rather than sitting in four separate cards you had to scroll past.',
  ] },
  { version: '5.9', date: '2026-08-18', notes: [
    'YOU CAN WORK AT MORE THAN ONE SHOP. Profile → Your businesses takes a Business Code and adds it to your account — a staff code joins you to somebody’s shop, a founder code lets you name another of your own.',
    'Once you have two, Switch Business appears in the side menu. Pick one and the whole app follows it: your register, your inventory, your ledger, your time card.',
    'Each is separate. You might own one shop and be a new hire at the next, and being the owner of one gives you nothing at the other — you are activated there the same way anybody is.',
    'Leaving one shop leaves the rest alone. You stay signed in and land on one of the others; only leaving your last shop signs you out.',
    'Nothing changes if you work at one shop. There is no menu entry to switch, and everything is where it was.',
  ] },
  { version: '5.8', date: '2026-08-18', notes: [
    'The app is quicker to move around. The item index and your region list are fetched once and kept, instead of being downloaded again by every screen that needs them — walking the register’s four sides used to pull the whole index down four times over.',
    'They refresh themselves the moment anything changes one: a sale that meets a new item, a harvest, a stocktake, or an admin editing the index.',
    'Recording a delivery, a haul or a transfer asks the database once for the items on it rather than once per line, so a big crate is no slower to send than a small one.',
  ] },
  { version: '5.7', date: '2026-08-17', notes: [
    'Your coffer records a delivery as ONE line, not one per item. A trip that brought six things was six debits sitting next to each other; it is now a single entry naming the trip, which is what actually happened — you paid once.',
    'The same for a paid harvest: one wage entry for the haul.',
    'The figures are better for it. The total is worked out once instead of each line being rounded on its own, so a delivery of three things at 10½ each takes 31 rather than 30 — you are no longer quietly losing a coin a line.',
    'Removing one item from a delivery gives back exactly what that item is costing you, and removing all of them leaves your coffer precisely where it started. Deliveries recorded before today are refunded by the rule they were written under, so nothing drifts either way.',
    'Harvest shows what each line earns beside the line itself, with the total on its own underneath — it used to recite the whole list back at you in the total.',
  ] },
  { version: '5.6', date: '2026-08-16', notes: [
    'Harvest takes as many things as you brought in. Add a line for each — wheat, apples, a hare — and record the lot as one haul.',
    'It goes in as ONE trip: a single entry in your delivery log rather than three, and if anything is wrong with one line none of it is recorded.',
    'Ingredient is ticked per line now, so a morning that brought in something to craft with and something to sell files each correctly.',
    'The payment adds up across the haul and says which lines earned it. A line the shop has set no rate for simply pays nothing, instead of the claim being refused for the whole basket.',
  ] },
  { version: '5.5', date: '2026-08-16', notes: [
    'Transfers waiting on somebody now read “Pending Transfer”, with how much is in the crate and who it is with — and the list of what is inside is folded away behind Show more.',
    'A crate of ten used to spell itself out beside its own Accept button, which turned a list of transfers into a wall of item names with the decisions buried in it. Press Show more on the one you mean; Show less puts it away.',
    'Recent transfers fold the same way, keeping their summary as their name so the log still says at a glance what each one was.',
  ] },
  { version: '5.4', date: '2026-08-16', notes: [
    'A transfer can carry as many items as you like. Inventory → Transfer is a list of lines now — add an item, add another, send the lot as one crate.',
    'It goes as ONE handover: the receiver accepts once and everything lands together, it shows up as a single line in both shops’ history, and declining or cancelling puts every item back on your shelf.',
    'It tells you what you are sending as you build it, and will not let you send more of something than you hold — including when the same item is on two lines, which is the easy way to promise twice what you have.',
    'Transfers you sent before this still show, still accept, and still return their goods exactly as they always did.',
  ] },
  { version: '5.3', date: '2026-08-15', notes: [
    'The row of buttons at the top of every shop screen — Register, Inventory, Shop Ledger, Employees — is gone. All four were already tiles under Shop tools, so it was a second copy of your home page following you around.',
    'Shop tools is the way to them now, and every shop page has a “← Back” at the top corner, the same one the admin screens have always had.',
    'Nothing has moved for admins: Member List, Company List, Item Index and Audit Log are still a row of buttons, because an admin has no tiles.',
  ] },
  { version: '5.2', date: '2026-08-15', notes: [
    'A bar now floats at the foot of the screen for as long as you are clocked in, telling you so and how long it has been. It follows you from page to page and stays put as you scroll, because a shift you have forgotten about is not something you go looking for.',
    'It carries a Time Card button, so clocking out is one press from wherever you are. The press takes you to your card rather than ending the shift where you stand — you still say when, and can still leave a note.',
    'After sixteen hours it turns amber and reads “Still clocked in”. That is the same threshold your time card has always used to flag a long shift.',
    'It shows no money. An open shift is worth nothing yet — it is still being worked — and a figure creeping up in the corner of every screen is an odd thing to be paid by.',
    'The Time Card has settled under Shop tools with the rest of the tiles, rather than the button it briefly was.',
  ] },
  { version: '5.1', date: '2026-08-15', notes: [
    'The Time Card is a button on the Home page now, at the top with the rest of the buttons.',
    'It used to sit on the shop-tools bar beside Register and Inventory — present on five pages you open once you are already working, and missing from the one page everybody starts on. Clocking on is the first thing you do, so it belongs where you arrive.',
    'It is the only way in now, rather than one of two: everything inside it — your own card, and the shift log for whoever runs the shop — is exactly where it was.',
  ] },
  { version: '5.0', date: '2026-08-15', notes: [
    'TRAVELING. A company can be marked as having no fixed region — a caravan, a peddler, a shop that follows the fairs. Admins set it on the company record, at the bottom of the region list.',
    'A travelling shop is asked where every sale is happening rather than being given a home to assume, and the register says why the box is empty instead of leaving you wondering.',
    'It gets no Market Info either: that page reports on one region’s market over the week just gone, and a shop that was in three of them has no such week. Its sales still count towards whichever region each one was rung up in, so the regions it visits see its trade exactly as before.',
    'A travelling company cannot be a Court — a Court governs a region, and this is a company that is not in one.',
    'Admins: the region list on the company record is now YOUR realm’s regions. It was the nine Skyrim holds written into the app, so a realm that had named its own regions was being offered somebody else’s here, and could file a company under a region its own register has never heard of.',
    '“Traveling” cannot be used as the name of a region, for the obvious reason that the network would no longer be able to tell one from the other.',
  ] },
  { version: '4.9', date: '2026-08-15', notes: [
    'The register starts on your own region. Nearly every sale happens where the shop is, so it is filled in for you — change it for the customer who came from somewhere else, instead of setting it by hand on every local sale.',
    'If your shop has no region on its record, or it is named something the network does not list, the register still asks — it will not guess one for you.',
    'Admins set a shop’s region on its company record; realms that do not trade by region are unaffected, as they never see the field.',
  ] },
  { version: '4.8', date: '2026-08-15', notes: [
    'Recording a delivery on a phone is typeable again. The item search was squeezed into a quarter of the screen — about five letters of the name you were trying to find — because the line was still laid out in the four columns it uses on a desk.',
    'On a narrow screen the line now wraps: the item takes the full width, and the quantity, the cost and the Remove button share the line beneath it. The “×” that removes a line is a proper button rather than a character to aim at.',
    'The same lines are used by Craft’s ingredients and by the items in a Special, so those are easier to fill in too. Nothing changes on a desktop or a tablet.',
  ] },
  { version: '4.7', date: '2026-08-14', notes: [
    'The Stocktake reads CSV files. Yesterday’s note said .xlsx as well; that has been taken back out in favour of one simple format. Every spreadsheet program writes CSV — choose “Save as” and pick it — and CSV is what the inventory export already gives you, so exporting, editing and reading it back needs nothing else.',
    'Picking an .xls or .xlsx now tells you to save it as CSV rather than failing oddly.',
  ] },
  { version: '4.6', date: '2026-08-14', notes: [
    'The Stocktake reads a spreadsheet. Pick a .csv or .xlsx and it fills the box for you — no retyping, no copy and paste.',
    'It finds your columns rather than demanding a shape: headings like “Item” and “Amount” are picked up wherever they sit, other columns are ignored, and a sheet with no headings is read as name-then-amount. It tells you which columns it used.',
    'What it reads still goes through the same check and the same Apply as anything typed by hand — you see exactly what would change before it changes.',
    'You can start the same job from Shop Settings → Export & import data, next to the exports, since “fix my inventory in a spreadsheet and put it back” is one task.',
    'Note: the older .xls format cannot be read — open it in your spreadsheet program and Save As .xlsx or .csv. Your sales log and coffer cannot be imported at all; they are the record of what actually happened.',
  ] },
  { version: '4.5', date: '2026-08-14', notes: [
    'Export everything in one file. Shop Settings → Export data now has “Export everything (CSV)”, which gives you a single spreadsheet holding your sales log, your coffer and your inventory, each under its own heading.',
    'The three are still available on their own — Sales log only, Coffer only, and Inventory only, which is new. A single export is byte for byte what it always was, so anything you already point a spreadsheet at keeps working.',
    'The inventory export carries what an ingredient has actually cost you, averaged over your own deliveries, alongside what you charge for what you sell.',
  ] },
  { version: '4.4', date: '2026-08-12', notes: [
    'Admins: an archived company no longer appears in Market Analysis’s Top 5 companies. A shop that has left the network cannot be one of the ones doing well, and a departed shop sitting at the top of the ranking was the wrong answer to the question that table asks.',
    'It keeps its line in Company Performance, marked “(archived)”. Its trade really happened, and dropping it there would have left the totals unexplainable.',
  ] },
  { version: '4.3', date: '2026-08-12', notes: [
    'The Sales Log has moved into the Shop Ledger. Past sales and deliveries are sections there now, beside Performance, Notices and Coffers — one book for what the shop has done and how it is doing, instead of two pages whose names did not say which held what.',
    'Nothing changed about who can do what. Looking up an order and voiding one you mis-rang are still open to anyone who works the till, so the Ledger opens for everyone; it simply shows fewer sections to somebody who is not running the shop. Deleting a delivery is still owner’s work.',
    'Old Sales Log links and home-screen shortcuts still work — they take you to the Ledger.',
  ] },
  { version: '4.2', date: '2026-08-12', notes: [
    'SPECIALS. Shop Settings → Specials & Discounts. Build a bundle — five drinks and five meals, say — give it one price, and your staff ring the whole thing up as a single line at the register.',
    'The bundle price is the bundle’s, not the sum of its parts; that difference is the whole point of one. While you set it up the screen tells you what the same items would come to separately, so you can see the saving — or see that the deal has quietly stopped being one.',
    'Everything in a special still comes out of your stock, and the register will not sell one you cannot cover. Voiding a sale puts every item in it back on the shelf.',
    'A special can hold only things you actually sell — an ingredient is stock you craft with, and a bundle containing one is refused.',
    'Discounts and upcharges have moved in beside it. They answer the same question — what do I charge for this, other than the list price? — so they are one section now instead of two places to look.',
  ] },
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
