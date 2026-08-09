/**
 * BUYING — the two forms for stock coming IN, and the register's Buying side.
 *
 * These lived on the Inventory page, next to Craft and Transfer, which put
 * "what I have" and "what I am spending" on the same screen and left the
 * register meaning only half of what a shop does. Buying is a till operation:
 * a person, a supplier, a price agreed, coin leaving the coffer. It belongs
 * beside Selling, and the register now has both.
 *
 * ONE DOOR. There were briefly two — a single delivery, and a basket for an
 * ingredient run — and you could not tell from the tiles which one your purchase
 * was. Intake covers both, which is why it is named for both, and its
 * walk-through says so on the step where ingredients are actually decided. The
 * basket's one real advantage (knowing what you usually pay) was moved into the
 * form rather than shelved with it. See archive/ingredient-basket/.
 *
 * Producing stock rather than buying it (Farm/Harvest, Craft) stays on
 * Inventory: no coin moves, no supplier exists, and there is no sale to ring.
 */
import { money, regionLabel, regionWord, regionsOn } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openStepModal } from '../lib/steps.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { skeletonRows } from '../lib/skeleton.js';
import { tileGrid } from '../lib/tiles.js';

/**
 * Intake (restock), asked one step at a time.
 *
 * The form grew to nine fields — item, quantity, cost, sale price, ingredient,
 * vendor, supplier, region — which is a wall to scroll for what is usually a
 * four-field job. It is now three steps: WHAT arrived, WHAT IT COST and what it
 * sells for, and WHERE it came from. The last step shows the whole delivery
 * back before anything is recorded.
 */
function openIntakeModal(onRecorded, me) {
  const idem = newIdem(); // one key per intake entry — retries won't double the stock
  // What this shop already holds, so the form can say what an item usually costs
  // it and what it currently charges. Declared before the picker because both of
  // the picker's callbacks read it.
  let current = [];
  const held = (name) => current.find((i) => i.item.toLowerCase() === String(name).toLowerCase());

  // Items must be chosen from the master index so stock never lands under a typo.
  const picker = createItemPicker({
    // Same as the register: a delivery can contain something the index has
    // never heard of, and refusing it would mean either abandoning the record
    // or filing it under the wrong name. It is added flagged, for an admin.
    allowFree: true,
    freeHint: 'Not in the index — recording this will add it, for an admin to check.',
    placeholder: 'Search the item index…',
    // What you usually pay for it, and its type to tell similar names apart.
    // The cost belongs here for the same reason the ingredient basket showed it:
    // you come to this form already knowing roughly what the crate should come
    // to, and a figure you have to go and look up is a figure nobody checks.
    meta: (it) => {
      const have = held(it.name);
      const usually = have && have.avgCost ? 'usually ' + money(have.avgCost) : '';
      const type = it.category && it.category !== 'Unsorted' ? it.category : '';
      return [usually, type].filter(Boolean).join(' · ');
    },
    onPick: (it) => {
      // YOUR OWN average cost beats the index's valuation for the cost field —
      // a shop buying reagents every week knows its price better than the index
      // does. Falls back to the index for something never bought before.
      const have = held(it.name);
      if (!per.value) per.value = String(have && have.avgCost ? have.avgCost : it.baseValue);
      // Suggest the index's base value to charge, not the cost — a shop that
      // sells at what it paid makes nothing, and that was the old default.
      if (!sale.value) sale.value = String(it.baseValue);
      showKnownPrice(it.name);
    },
  });
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});
  const hold = el('select', {}, el('option', { value: '' }, 'Select a ' + regionWord() + '…'));
  /**
   * WHO SOLD IT TO YOU — one field for both kinds of supplier.
   *
   * It used to be two: a free-text "Vendor" and a dropdown asking, separately,
   * whether that vendor happened to be a registered company. That made the
   * common case (an NPC smith) look like it was missing an answer, and the
   * useful case (a real shop) something you had to fill in twice.
   *
   * Now you type a name. Registered companies narrow as you type and can be
   * clicked; anything else is taken as written. Naming a registered company
   * credits it for the supply in its region's figures, and fills in the region
   * from that company's own record — the goods came from where the seller
   * trades, and asking a second time invites a different answer.
   */
  const vendor = createItemPicker({
    allowFree: true,
    placeholder: 'Who did you buy from?',
    freeHint: 'Not a registered company — it will be recorded as typed.',
    meta: (c) => (regionsOn() && c.hold ? c.hold : ''),
    onPick: (c) => {
      // The supplier's own region, unless the user has already chosen one.
      if (regionsOn() && c.hold && !hold.value) hold.value = c.hold;
    },
  });
  api.getBusinesses()
    .then((r) => {
      // `cards` carries each company's region; the plain name list is the
      // fallback for a Worker that has not caught up with this deploy yet.
      const cards = r.cards || (r.businesses || []).map((b) => ({ business: b, hold: '' }));
      vendor.setItems(cards
        .filter((c) => c.business !== (me && me.business))   // a shop does not buy from itself
        .map((c) => ({ name: c.business, hold: c.hold })));
    })
    .catch(() => { /* free text still works; there is just nothing to suggest */ });
  /** The typed name, only when it IS a registered company. */
  const vendorCompany = () => (vendor.selected() ? vendor.selected().name : '');
  const qty = el('input', { type: 'number', step: '1', min: '1', placeholder: '# of items' });
  const per = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Cost per item' });
  /**
   * What the register will charge for this item. Separate from the cost above,
   * which is what the shop PAID — conflating the two is how an item ends up
   * listed at its own purchase price.
   */
  const sale = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Leave blank to keep the current price' });
  const saleHint = el('p', { class: 'note' }, '');
  /**
   * Stock the shop holds to CRAFT with, not to sell. Ticking it takes the item
   * out of the register, and the sale price stops meaning anything — so the
   * field goes with it rather than sitting there inviting a number nobody will
   * ever charge.
   */
  const ingredient = el('input', { type: 'checkbox' });
  const saleWrap = el('div', {}, [
    el('label', {}, 'Sale price — what the register will charge'), sale, saleHint,
  ]);
  ingredient.addEventListener('change', () => { saleWrap.hidden = ingredient.checked; });

  // If the shop already lists this item, say what it currently charges, so a
  // blank field is an informed choice rather than a guess.
  api.getInventory().then((r) => { current = r.inventory || []; }).catch(() => {});
  function showKnownPrice(name) {
    const have = held(name);
    saleHint.textContent = have
      ? 'You currently sell this at ' + money(have.price) + '. Leave blank to keep that.'
      : 'New to your shop — this becomes its price in the register.';
  }
  // Fill the hold dropdown.
  api.getRegions()
    .then((res) => (res.holds || []).forEach((h) => hold.appendChild(el('option', { value: h }, h))))
    .catch(() => { /* hold is optional */ });

  // The delivery read back before it is recorded — the one screen where a
  // mistyped quantity or a cost in the sale-price field is obvious.
  const review = el('div', { class: 'step-review' }, '');
  function fillReview() {
    const picked = picker.selected();
    const name = picked ? picked.name : picker.value();
    const n = Number(qty.value) || 0;
    const cost = Number(per.value) || 0;
    const rows = [
      ['Item', name ? name + (picked ? '' : ' (new)') : '—'],
      ['Quantity', String(n)],
      ['Cost', money(cost) + ' each · ' + money(n * cost) + ' total'],
    ];
    if (ingredient.checked) rows.push(['Sells for', 'Ingredient — not sold']);
    else if (sale.value !== '') rows.push(['Sells for', money(Number(sale.value) || 0)]);
    const source = vendor.value();
    // Say which kind it was: a registered company is credited for the supply,
    // a typed name is not, and that difference is worth seeing before it lands.
    if (source) rows.push(['Bought from', source + (vendorCompany() ? ' (registered)' : '')]);
    if (regionsOn() && hold.value) rows.push([regionLabel(), hold.value]);
    review.innerHTML = rows
      .map(([k, v]) => '<div class="step-review-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>')
      .join('');
  }

  async function doRecord() {
    const picked = picker.selected();
    await api.recordIntake({
      // A picked item carries its canonical spelling; free text is taken as
      // typed and added to the index flagged for review.
      item: picked ? picked.name : picker.value(),
      salePrice: ingredient.checked ? '' : sale.value,
      ingredient: ingredient.checked,
      vendor: vendor.value(),
      fromBusiness: vendorCompany(),
      hold: hold.value,
      numItems: qty.value,
      pricePer: per.value,
      idempotencyKey: idem,
    });
    onRecorded();
  }

  return openStepModal({
    title: 'Intake Ingredients/Stock',
    finishLabel: 'Record intake',
    guideKey: 'intake',
    onFinish: doRecord,
    steps: [
      {
        title: 'What arrived?',
        hint: 'Pick the item from the index so the stock never lands under a typo.',
        guide: [
          'Intake is how anything you BOUGHT gets onto your shelf — a crate from a supplier, a sack of ' +
            'reagents, one sword from a traveller. It adds the stock and takes the cost out of your coffer, ' +
            'in one record.',
          'Start typing and the item index narrows as you go. Picking a match matters: it is what keeps ' +
            '"Iron Sword" and "iron sword" the same item, so your stock and your prices stay on one line ' +
            'instead of quietly splitting in two.',
          'If nobody has ever entered it, type the name anyway — the sale is not held up. It is added to ' +
            'the index flagged as new, and an admin confirms it or merges it with whatever it duplicates.',
          'Quantity is how many arrived, not how many you now have. The stock you already hold is added to.',
        ],
        nodes: [
          el('label', {}, 'Item'), picker.el,
          el('label', {}, '# of items'), qty,
        ],
        validate: () => {
          if (!picker.selected() && !picker.value()) return 'Type an item, or pick one from the index.';
          if (!(Number(qty.value) > 0)) return 'How many arrived? Enter at least 1.';
          return null;
        },
      },
      {
        title: 'What did it cost?',
        hint: 'The cost is what you paid. The sale price is what the register will charge — they are not the same number.',
        guide: [
          'Two different numbers, and mixing them up is the most common mistake on this form. The COST is ' +
            'what left your coffer, per item. The SALE PRICE is what the register will charge a customer. ' +
            'Put the cost in both and your shop makes nothing on every sale.',
          'A price may be typed with a fraction — 22.5 is fine — but every amount the ledger stores is a ' +
            'whole coin with the fraction dropped, and the rounding happens once on the total.',
          'Tick INGREDIENT for stock you hold to craft with rather than to sell. It is kept out of the ' +
            'register so nobody rings it up by accident, and out of the market pricing figures, which are ' +
            'about what things SELL for. The sale price disappears when you tick it, because there is no ' +
            'sale to price.',
          'That is where ingredients live now: there is no separate ingredient form. Buying a basket of ' +
            'reagents is several intakes, one per reagent — each with its own cost, which is what makes ' +
            'the average you are shown on Inventory worth anything.',
          'Leaving the sale price blank keeps whatever the item is already priced at. For something new to ' +
            'your shop, it becomes its price.',
        ],
        nodes: [
          el('label', {}, 'Cost per item — what you paid'), per,
          el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
          saleWrap,
        ],
        validate: () => (per.value !== '' && Number(per.value) >= 0
          ? null
          : 'Enter what you paid per item — 0 is fine if it was free.'),
      },
      {
        title: 'Where did it come from?',
        hint: 'All optional. Fill in what you know.',
        guide: [
          'Everything on this step can be left blank. The delivery records fine without it — this is for ' +
            'the figures your ' + regionWord() + ' and the network read, not for your own stock.',
          'Naming a REGISTERED shop credits it for the supply in its own ' + regionWord() + '’s trade, and ' +
            'fills in where the goods came from. Anyone else — an NPC smith, a traveller, a mine — just ' +
            'type the name and it is recorded as written.',
          'Read the summary at the bottom before you finish. A quantity in the cost field or a cost in the ' +
            'sale-price field is obvious here and nowhere else. If something is wrong, Previous goes back ' +
            'and nothing has been recorded yet.',
          'Recorded a delivery you should not have? Sales Log has the full history, and an owner can delete ' +
            'one — the stock comes back out and the coffer is refunded.',
        ],
        nodes: [
          el('label', {}, 'Vendor'), vendor.el,
          el('p', { class: 'note' }, 'Start typing — shops on this network will appear as you go. Naming one ' +
            'credits it for the supply in its ' + regionWord() + '’s figures. Anyone else, just type the name.'),
          ...(regionsOn() ? [el('label', {}, regionLabel() + ' purchased in'), hold] : []),
          review,
        ],
        onEnter: fillReview,
      },
    ],
  });
}


/**
 * The register's BUYING side.
 *
 * Two doors and a short receipt. The receipt is the point: Selling clears the
 * cart when a sale lands, which tells you it worked. Recording a delivery
 * closes a modal and leaves you looking at nothing, so the last few deliveries
 * sit here to say the thing you just typed actually landed. The full history —
 * and deleting one — stays in Sales Log rather than being built twice.
 */
export function renderBuying(host, { me }) {
  const canBuy = me.role === 'owner' || me.role === 'admin';
  const listHost = el('div', {}, skeletonRows(3));

  // Not a security check — the Worker refuses both of these from an employee.
  // The page simply does not offer a door that would slam.
  const doors = el('div', {});
  const drawDoors = (images) => mount(doors, canBuy
    ? tileGrid([
      { key: 'buy-intake', label: 'Intake Ingredients/Stock', glyph: '📦',
        hint: 'Anything you bought — to sell or to craft with',
        onOpen: () => openIntakeModal(refresh, me) },
    ], images)
    : el('p', { class: 'note' }, 'Recording what the shop buys is the owner’s — it moves coin out of the ' +
      'coffer. Ask them to record an intake; what has already arrived is below.'));
  // Glyphs first so the page is usable immediately; artwork replaces them when
  // it arrives. Only the tiles are redrawn — the deliveries below are fetched
  // once, not twice.
  drawDoors({});
  api.getTiles().then((r) => drawDoors(r.images || {})).catch(() => { /* glyphs are fine */ });

  mount(host,
    el('div.card', {}, [
      el('p', { class: 'note' }, 'Stock coming IN, and the coin going out for it — whether you will sell it or ' +
        'craft with it. First time? The form explains itself as you go. Grown or crafted rather than bought? ' +
        'That is Farm/Harvest and Craft, on Inventory — no coin moves, so there is nothing to ring up.'),
      doors,
    ]),
    el('div.card', {}, [
      el('h3', {}, 'Recent deliveries'),
      el('p', { class: 'note' }, 'The last few, so you can see what you just recorded. The full history, and ' +
        'removing a delivery recorded by mistake, are in Sales Log.'),
      listHost,
    ]),
  );

  function draw(rows) {
    if (!rows.length) {
      mount(listHost, emptyState({
        glyph: '📦', title: 'No deliveries yet',
        hint: 'Record one above and it will appear here.',
      }));
      return;
    }
    mount(listHost, el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, 'When'), el('th', {}, 'Item'), el('th', {}, 'Qty'),
        el('th', {}, 'Cost each'), el('th', {}, 'From'),
      ])),
      el('tbody', {}, rows.slice(0, 8).map((r) => el('tr', {}, [
        el('td', {}, String(r.ts || '').slice(0, 10)),
        el('td', {}, r.item || ''),
        el('td', {}, String(r.numItems || 0)),
        el('td', {}, money(r.pricePer || 0)),
        // A registered supplier is worth marking: it is the one that shows up in
        // its own region's figures as having supplied you.
        el('td', {}, (r.fromBusiness || r.vendor || '—') + (r.fromBusiness ? ' ✓' : '')),
      ]))),
    ]));
  }

  function refresh() {
    api.getIntake()
      .then((r) => draw(r.intake || []))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }
  refresh();
}
