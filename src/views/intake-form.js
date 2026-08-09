/**
 * BUYING — the intake form, and the register's Buying side.
 *
 * These lived on the Inventory page, next to Craft and Transfer, which put
 * "what I have" and "what I am spending" on the same screen and left the
 * register meaning only half of what a shop does. Buying is a till operation:
 * a person, a supplier, a price agreed, coin leaving the coffer. It belongs
 * beside Selling, and the register now has both.
 *
 * ONE DOOR. There were briefly two — a single delivery, and a basket for an
 * ingredient run — and you could not tell from the tiles which one your purchase
 * was. Intake covers both: it takes as many items as the trip brought, and its
 * walk-through says so on the step where ingredients are actually decided. Both
 * of the basket's advantages came with it — knowing what you usually pay, and a
 * total that keeps up as you type. See archive/ingredient-basket/.
 *
 * Producing stock rather than buying it (Farm/Harvest, Craft) stays on
 * Inventory: no coin moves, no supplier exists, and there is no sale to ring.
 */
import { money, coins, regionLabel, regionWord, regionsOn } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openStepModal } from '../lib/steps.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { skeletonRows } from '../lib/skeleton.js';
import { tileGrid } from '../lib/tiles.js';

/**
 * Intake — one delivery, one or many items, asked a step at a time.
 *
 * A TRIP, NOT AN ITEM. A supplier run brings back a crate: three reagents, two
 * swords and a barrel of ale, from one person on one day. Recording that as six
 * visits to a one-item form is the job the ingredient basket existed to avoid,
 * and it is the job this form does now — the basket's running total included.
 *
 * The shape follows what varies. COST, sale price and whether a thing is an
 * ingredient differ item by item, so they are on the line. The SUPPLIER and the
 * region are the trip, so they are asked once. And the whole delivery is sent
 * as one request that the Worker writes atomically: a delivery lands whole or
 * not at all, rather than half-recorded with nothing saying which half.
 *
 * Three steps, because nine fields on one screen is a wall: WHAT arrived, WHAT
 * IT SELLS FOR, and WHERE it came from — with the whole delivery read back
 * before anything is written.
 */
function openIntakeModal(onRecorded, me) {
  const idem = newIdem(); // one key per delivery — retries won't double the stock

  // What this shop already holds, so a line can say what the item usually costs
  // it and what it currently charges. Loaded once and shared by every line.
  let current = [];
  let master = [];
  const held = (name) => current.find((i) => i.item.toLowerCase() === String(name).toLowerCase());

  /* ---- the lines ------------------------------------------------------- */
  const lines = [];
  const linesHost = el('div', {});
  const totalLine = el('p', { class: 'buy-total' }, '');

  /** What one line comes to, in whole coins — the figure the coffer will take. */
  const lineTotal = (l) => coins((Number(l.qty.value) || 0) * (Number(l.per.value) || 0));

  /**
   * The running total, and each line's own subtotal.
   *
   * Summed from the FLOORED line totals rather than flooring the raw sum, so
   * the figure at the bottom is the figure the lines above it add up to — and
   * both match what the Worker will debit, since it rounds per line too.
   */
  function retotal() {
    let sum = 0;
    lines.forEach((l) => {
      const n = lineTotal(l);
      sum += n;
      l.sub.textContent = n ? money(n) : '';
    });
    totalLine.textContent = 'Delivery: ' + money(sum);
    totalLine.hidden = !sum;   // nothing costed yet is not a delivery worth 0
  }

  /**
   * True once a line has anything in it — an untouched row is skipped rather
   * than failed, so a stray press of "+ Add another item" is not an error to
   * clear before you can go on.
   *
   * Quantity is NOT evidence: it starts at 1, so counting it would make every
   * empty row look filled in.
   */
  const started = (l) => !!(l.name() || l.per.value);
  const removeBtnsVisible = () => {
    // Nothing to remove when there is only one line; a lone × that empties the
    // form is a trap rather than an affordance.
    lines.forEach((l) => { l.remove.hidden = lines.length < 2; });
  };

  function addLine() {
    const picker = createItemPicker({
      // Same as the register: a delivery can contain something the index has
      // never heard of, and refusing it would mean either abandoning the record
      // or filing it under the wrong name. It is added flagged, for an admin.
      allowFree: true,
      freeHint: 'Not in the index — recording this will add it, for an admin to check.',
      placeholder: 'Search the item index…',
      // What you usually pay for it, and its type to tell similar names apart.
      // The cost belongs here because you come to this form already knowing
      // roughly what the crate should come to, and a figure you have to go and
      // look up is a figure nobody checks.
      meta: (it) => {
        const have = held(it.name);
        const usually = have && have.avgCost ? 'usually ' + money(have.avgCost) : '';
        const type = it.category && it.category !== 'Unsorted' ? it.category : '';
        return [usually, type].filter(Boolean).join(' · ');
      },
      onPick: (it) => {
        // YOUR OWN average cost beats the index's valuation for the cost field —
        // a shop buying reagents every week knows its price better than the
        // index does. Falls back to the index for something never bought.
        const have = held(it.name);
        if (!line.per.value) line.per.value = String(have && have.avgCost ? have.avgCost : it.baseValue);
        if (!line.sale.value) line.sale.value = String(it.baseValue);
        retotal();
      },
    });
    picker.setItems(master);

    const qty = el('input', { type: 'number', step: '1', min: '1', value: '1', placeholder: 'Qty' });
    const per = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Cost each' });
    const sub = el('span', { class: 'buy-sub' }, '');
    qty.addEventListener('input', retotal);
    per.addEventListener('input', retotal);
    const remove = el('button.secondary-btn.small', { onclick: () => {
      const i = lines.indexOf(line);
      if (i < 0) return;
      lines.splice(i, 1);
      wrap.remove();
      removeBtnsVisible();
      retotal();
    } }, '×');
    const wrap = el('div', { class: 'craft-row' }, [picker.el, qty, per, sub, remove]);

    /**
     * Pricing lives on the line too, but is ASKED on the next step: the sale
     * price of a thing you have not finished describing is a question nobody
     * can answer yet.
     *
     * The block is built here, once, and merely re-parented when that step is
     * entered. Building it there instead meant a fresh `change` listener on the
     * same checkbox every time you stepped back and forth, each holding a
     * detached copy of the panel it was meant to hide.
     */
    const sale = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Leave blank to keep the current price' });
    const ingredient = el('input', { type: 'checkbox' });
    const saleHint = el('p', { class: 'note' }, '');
    const saleWrap = el('div', {}, [el('label', {}, 'Sells for'), sale, saleHint]);
    // Ticking Ingredient takes the sale price away rather than leaving it
    // sitting there inviting a number nobody will ever charge.
    ingredient.addEventListener('change', () => { saleWrap.hidden = ingredient.checked; });
    const priceHead = el('p', { class: 'price-head' }, '');
    const priceBlock = el('div', { class: 'price-block' }, [
      priceHead,
      el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
      saleWrap,
    ]);

    const line = {
      wrap, picker, qty, per, sub, remove, sale, ingredient,
      priceBlock, priceHead, saleHint, saleWrap,
      name: () => (picker.selected() ? picker.selected().name : picker.value().trim()),
      picked: () => !!picker.selected(),
    };
    lines.push(line);
    linesHost.appendChild(wrap);
    removeBtnsVisible();
    retotal();
    return line;
  }

  const addBtn = el('button.secondary-btn.small', {
    onclick: () => { addLine().picker.focus(); },
  }, '+ Add another item');

  /* ---- what the shop already knows ------------------------------------- */
  api.getItems().then((r) => {
    master = r.items || [];
    lines.forEach((l) => l.picker.setItems(master));
  }).catch(() => { /* free text still works; there is just nothing to suggest */ });
  api.getInventory().then((r) => { current = r.inventory || []; }).catch(() => {});

  /* ---- the supplier, asked once for the whole trip --------------------- */
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
    .catch(() => { /* free text still works */ });
  /** The typed name, only when it IS a registered company. */
  const vendorCompany = () => (vendor.selected() ? vendor.selected().name : '');
  api.getRegions()
    .then((res) => (res.holds || []).forEach((h) => hold.appendChild(el('option', { value: h }, h))))
    .catch(() => { /* the region is optional */ });

  /* ---- step 2: what each line sells for -------------------------------- */
  const priceHost = el('div', {});
  /**
   * Shows one block per line that has something in it, in the order they were
   * entered. Re-parenting rather than rebuilding, so a price already typed
   * survives stepping back to fix a quantity.
   */
  function fillPricing() {
    priceHost.innerHTML = '';
    lines.filter(started).forEach((l) => {
      const have = held(l.name());
      // Named and costed HERE rather than at build time, because the line was
      // still being filled in when the block was made.
      l.priceHead.textContent = l.name() + ' ×' + (Number(l.qty.value) || 0) +
        ' · cost ' + money(Number(l.per.value) || 0) + ' each';
      l.saleHint.textContent = have
        ? 'You currently sell this at ' + money(have.price) + '. Leave blank to keep that.'
        : 'New to your shop — this becomes its price in the register.';
      l.saleWrap.hidden = l.ingredient.checked;
      priceHost.appendChild(l.priceBlock);
    });
  }

  /* ---- step 3: the read-back ------------------------------------------- */
  const review = el('div', { class: 'step-review' }, '');
  function fillReview() {
    const live = lines.filter(started);
    let sum = 0;
    const rows = live.map((l) => {
      const n = lineTotal(l);
      sum += n;
      const what = l.name() + (l.picked() ? '' : ' (new)') + ' ×' + (Number(l.qty.value) || 0) +
        (l.ingredient.checked ? ' · ingredient' : '');
      return [what, money(n)];
    });
    if (live.length > 1) rows.push(['Delivery total', money(sum)]);
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
    const live = lines.filter(started);
    await api.recordIntake({
      // One request for the whole trip. The Worker validates every line before
      // it writes any of them, so a bad line cannot leave a half-delivery.
      items: live.map((l) => ({
        // A picked item carries its canonical spelling; free text is taken as
        // typed and added to the index flagged for review.
        item: l.name(),
        numItems: l.qty.value,
        pricePer: l.per.value,
        salePrice: l.ingredient.checked ? '' : l.sale.value,
        ingredient: l.ingredient.checked,
      })),
      vendor: vendor.value(),
      fromBusiness: vendorCompany(),
      hold: hold.value,
      idempotencyKey: idem,
    });
    onRecorded();
  }

  addLine();

  return openStepModal({
    title: 'Intake Ingredients/Stock',
    finishLabel: 'Record delivery',
    guideKey: 'intake',
    onFinish: doRecord,
    steps: [
      {
        title: 'What arrived?',
        hint: 'One line per item. Add as many as the delivery brought.',
        guide: [
          'Intake is how anything you BOUGHT gets onto your shelf — a crate from a supplier, a sack of ' +
            'reagents, one sword from a traveller. It adds the stock and takes the cost out of your coffer, ' +
            'in one record.',
          'A delivery can hold as many items as you like. Add a line each and the total at the bottom keeps ' +
            'up as you type, so you can check it against what you actually handed over. It is recorded as ' +
            'one trip: either the whole delivery lands or none of it does.',
          'Start typing and the item index narrows as you go. Picking a match matters: it is what keeps ' +
            '"Iron Sword" and "iron sword" the same item, so your stock and your prices stay on one line ' +
            'instead of quietly splitting in two.',
          'If nobody has ever entered it, type the name anyway — nothing is held up. It is added to the ' +
            'index flagged as new, and an admin confirms it or merges it with whatever it duplicates.',
          'Quantity is how many arrived, not how many you now have. Cost is what you paid PER ITEM, and it ' +
            'is what leaves your coffer — what you will charge for it is the next step.',
        ],
        nodes: [
          linesHost,
          el('div', { class: 'row-actions' }, [addBtn]),
          totalLine,
        ],
        validate: () => {
          const live = lines.filter(started);
          if (!live.length) return 'Add at least one item to the delivery.';
          for (let i = 0; i < live.length; i++) {
            const l = live[i];
            const where = live.length > 1 ? ' (item ' + (i + 1) + ')' : '';
            if (!l.name()) return 'Type an item, or pick one from the index.' + where;
            if (!(Number(l.qty.value) > 0)) return 'How many arrived? Enter at least 1.' + where;
            if (l.per.value === '' || !(Number(l.per.value) >= 0)) {
              return 'Enter what you paid per item — 0 is fine if it was free.' + where;
            }
          }
          return null;
        },
      },
      {
        title: 'What will you charge?',
        hint: 'Per item. Leave a price blank to keep whatever it is already listed at.',
        guide: [
          'Two different numbers, and mixing them up is the most common mistake on this form. The COST on ' +
            'the last step is what left your coffer. The SALE PRICE here is what the register will charge a ' +
            'customer. Put the cost in both and your shop makes nothing on every sale.',
          'A price may be typed with a fraction — 22.5 is fine — but every amount the ledger stores is a ' +
            'whole coin with the fraction dropped, and the rounding happens once per line.',
          'Tick INGREDIENT for stock you hold to craft with rather than to sell. It is kept out of the ' +
            'register so nobody rings it up by accident, and out of the market pricing figures, which are ' +
            'about what things SELL for. The sale price disappears when you tick it, because there is no ' +
            'sale to price.',
          'That is where ingredients live: there is no separate ingredient form. A supply run is one ' +
            'delivery with a line per reagent, each with its own cost — which is what makes the average ' +
            'you are shown on Inventory worth anything.',
          'Leaving a sale price blank keeps whatever that item is already priced at. For something new to ' +
            'your shop, it becomes its price.',
        ],
        nodes: [priceHost],
        onEnter: fillPricing,
      },
      {
        title: 'Where did it come from?',
        hint: 'All optional, and asked once for the whole delivery.',
        guide: [
          'Everything on this step can be left blank. The delivery records fine without it — this is for ' +
            'the figures your ' + regionWord() + ' and the network read, not for your own stock.',
          'One supplier for the trip, not one per item: a crate came from a person, on a day. If two items ' +
            'genuinely came from different people, they are two deliveries.',
          'Naming a REGISTERED shop credits it for the supply in its own ' + regionWord() + '’s trade, and ' +
            'fills in where the goods came from. Anyone else — an NPC smith, a traveller, a mine — just ' +
            'type the name and it is recorded as written.',
          'Read the summary at the bottom before you finish. A quantity in the cost field or a cost in the ' +
            'sale-price field is obvious here and nowhere else. If something is wrong, Previous goes back ' +
            'and nothing has been recorded yet.',
          'Recorded a delivery you should not have? Sales Log has the full history, and an owner can delete ' +
            'a line from it — the stock comes back out and the coffer is refunded.',
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
