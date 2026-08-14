/**
 * BUYING — the intake form, and the register's Buying side.
 *
 * These lived on the Inventory page, next to Craft and Transfer, which put
 * "what I have" and "what I am spending" on the same screen and left the
 * register meaning only half of what a shop does. Buying is a till operation:
 * a person, a supplier, a price agreed, coin leaving the coffer. It belongs
 * beside Selling, and the register now has both.
 *
 * ONE DOOR, AND NO DOOR TO OPEN. There were briefly two forms — a single
 * delivery, and a basket for an ingredient run — and you could not tell from
 * the tiles which one your purchase was. Intake covers both, and it is now the
 * page rather than something a tile opens. Both of the basket's advantages came
 * with it: knowing what you usually pay, and a total that keeps up as you type.
 * See archive/ingredient-basket/.
 *
 * Producing stock rather than buying it (Farm/Harvest, Craft) stays on
 * Inventory: no coin moves, no supplier exists, and there is no sale to ring.
 */
import { money, coins, regionLabel, regionWord, regionsOn } from '../lib/format.js';
import { el, mount, esc, tableEl } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { canManage } from '../lib/roles.js';
import { guidePanel, guideUnseen, markGuideSeen } from '../lib/guide.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { skeletonRows } from '../lib/skeleton.js';
import { toast } from '../lib/toast.js';

/**
 * What each card explains. Kept out of the builder so the form reads as a form
 * and the prose reads as prose.
 */
const GUIDE = {
  arrived: [
    'Anything you bought. The stock goes on your shelf and the cost comes out of your coffer, as one ' +
      'record — the whole delivery lands, or none of it does.',
    'Pick from the index where you can: it keeps "Iron Sword" and "iron sword" one item instead of ' +
      'two. A name nobody has entered yet is fine — it is added for an admin to check.',
    'Quantity is how many arrived. Cost is what you paid EACH.',
  ],
  pricing: [
    'Cost was what you paid; this is what the register charges. The same number in both means the ' +
      'shop makes nothing on every sale.',
    'INGREDIENT is stock you craft with rather than sell — kept out of the register and out of the ' +
      'pricing figures, so it has no sale price to give.',
  ],
  source: [
    'Naming a REGISTERED shop credits it for the supply in its own region’s trade. Anyone else — an ' +
      'NPC smith, a traveller, a mine — is recorded as typed.',
    'Nothing is written until you press Record. A delivery entered by mistake can be removed under Deliveries on the Shop Ledger.',
  ],
};

/**
 * Intake — one delivery, one or many items, as three cards on the page.
 *
 * ON THE PAGE, not in a window. It was a stepped modal: one question at a time
 * behind Previous and Next, over the top of everything else. That is the right
 * shape for a form you meet once, and the wrong one for the thing a shop does
 * most often — you could not see what you had already typed, the deliveries
 * list you were checking against was hidden behind the form, and every glance
 * back cost two clicks. The three steps are now three cards, all visible, in
 * the order you fill them in.
 *
 * A TRIP, NOT AN ITEM. A supplier run brings back a crate: three reagents, two
 * swords and a barrel of ale, from one person on one day. COST, sale price and
 * whether a thing is an ingredient differ item by item, so they are on the
 * line. The SUPPLIER and the region are the trip, so they are asked once. The
 * whole delivery is sent as one request the Worker writes atomically.
 *
 * @returns {{ node: HTMLElement, reset: Function }}
 */
function buildIntake(me, onRecorded) {
  // ONE KEY PER DELIVERY, and a new one after each — retries must not double the
  // stock, but the form now stays on screen, so a second delivery typed into it
  // would otherwise look like a retry of the first and be silently discarded.
  let idem = newIdem();

  // What this shop already holds, so a line can say what the item usually costs
  // it and what it currently charges. Loaded once and shared by every line.
  let current = [];
  let master = [];
  const held = (name) => current.find((i) => i.item.toLowerCase() === String(name).toLowerCase());

  /* ---- card 1: the lines ----------------------------------------------- */
  const lines = [];
  const linesHost = el('div', {});
  const totalLine = el('p', { class: 'buy-total' }, '');

  /** What one line comes to, in whole coins — the figure the coffer will take. */
  const lineTotal = (l) => coins((Number(l.qty.value) || 0) * (Number(l.per.value) || 0));

  /**
   * True once a line has anything in it — an untouched row is skipped rather
   * than failed, so a stray press of "Add another item" is not an error to
   * clear before you can go on.
   *
   * Quantity is NOT evidence: it starts at 1, so counting it would make every
   * empty row look filled in.
   */
  const started = (l) => !!(l.name() || l.per.value);
  const liveLines = () => lines.filter(started);

  /**
   * Everything that depends on the lines, after any change to them.
   *
   * Called on every keystroke, so it must not rebuild anything a person could
   * be typing into: the totals and the card-2 headings are text updates, and
   * card 2 is only re-parented when the SET of lines actually changes.
   */
  function sync() {
    let sum = 0;
    lines.forEach((l) => {
      const n = lineTotal(l);
      sum += n;
      l.sub.textContent = n ? money(n) : '';
      l.remove.hidden = lines.length < 2;
    });
    // Summed from the FLOORED line totals rather than flooring the raw sum, so
    // the figure at the bottom is what the lines above it add up to — and both
    // match what the Worker will debit, since it rounds per line too.
    totalLine.textContent = 'Delivery: ' + money(sum);
    totalLine.hidden = !sum;
    syncPricing();
    fillReview();
  }

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
        sync();
      },
    });
    picker.setItems(master);

    // Labelled per field as well as headed per column. The heading says what
    // the column is; the label is what a screen reader reads out and what a
    // narrow phone falls back to when the columns stack.
    const qty = el('input', {
      type: 'number', step: '1', min: '1', value: '1',
      placeholder: 'Qty', 'aria-label': 'Quantity that arrived',
    });
    const per = el('input', {
      type: 'number', step: '0.01', min: '0',
      placeholder: 'Cost each', 'aria-label': 'Cost per item, what you paid',
    });
    const sub = el('span', { class: 'buy-sub', title: 'Line total' }, '');
    const remove = el('button.secondary-btn.small', {
      type: 'button', title: 'Remove this line', 'aria-label': 'Remove this line',
      onclick: () => {
        const i = lines.indexOf(line);
        if (i < 0) return;
        lines.splice(i, 1);
        wrap.remove();
        sync();
      },
    }, '×');
    const wrap = el('div', { class: 'craft-row' }, [picker.el, qty, per, sub, remove]);
    // One listener for the whole row: input events bubble, so this covers the
    // picker's own box as well as the two numbers without reaching inside it.
    wrap.addEventListener('input', sync);

    /**
     * Pricing lives on the line but is ASKED on the next card, so the block is
     * built here, once, and merely re-parented. Building it there instead meant
     * a fresh listener on the same checkbox every time the card was redrawn,
     * each holding a detached copy of the panel it was meant to hide.
     */
    const sale = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Leave blank to keep the current price' });
    const ingredient = el('input', { type: 'checkbox' });
    const saleHint = el('p', { class: 'note' }, '');
    const saleWrap = el('div', {}, [el('label', {}, 'Sells for'), sale, saleHint]);
    // Ticking Ingredient takes the sale price away rather than leaving it
    // sitting there inviting a number nobody will ever charge.
    ingredient.addEventListener('change', () => { saleWrap.hidden = ingredient.checked; fillReview(); });
    const priceHead = el('p', { class: 'price-head' }, '');
    const priceBlock = el('div', { class: 'price-block' }, [
      priceHead,
      el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
      saleWrap,
    ]);
    priceBlock.addEventListener('input', fillReview);

    const line = {
      wrap, picker, qty, per, sub, remove, sale, ingredient,
      priceBlock, priceHead, saleHint, saleWrap,
      name: () => (picker.selected() ? picker.selected().name : picker.value().trim()),
      picked: () => !!picker.selected(),
    };
    lines.push(line);
    linesHost.appendChild(wrap);
    sync();
    return line;
  }

  const addBtn = el('button.secondary-btn.small', {
    type: 'button', onclick: () => { addLine().picker.focus(); },
  }, '+ Add another item');

  /* ---- what the shop already knows ------------------------------------- */
  api.getItems().then((r) => {
    master = r.items || [];
    lines.forEach((l) => l.picker.setItems(master));
  }).catch(() => { /* free text still works; there is just nothing to suggest */ });
  api.getInventory().then((r) => { current = r.inventory || []; sync(); }).catch(() => {});

  /* ---- card 2: what each line sells for -------------------------------- */
  const priceHost = el('div', {});
  const nothingToPrice = el('p', { class: 'note' }, 'Add an item above and it will appear here.');

  function syncPricing() {
    const live = liveLines();
    live.forEach((l) => {
      const have = held(l.name());
      l.priceHead.textContent = l.name() + ' ×' + (Number(l.qty.value) || 0) +
        ' · cost ' + money(Number(l.per.value) || 0) + ' each';
      l.saleHint.textContent = have
        ? 'You currently sell this at ' + money(have.price) + '. Leave blank to keep that.'
        : 'New to your shop — this becomes its price in the register.';
    });
    // Only touch the DOM when the SET changes. Re-appending on every keystroke
    // would move the node a person is typing into and take the caret with it.
    const want = live.map((l) => l.priceBlock);
    const have = [...priceHost.children];
    if (have.length !== want.length || want.some((n, i) => have[i] !== n)) {
      priceHost.innerHTML = '';
      want.forEach((n) => priceHost.appendChild(n));
    }
    nothingToPrice.hidden = want.length > 0;
  }

  /* ---- card 3: the supplier, asked once for the whole trip -------------- */
  const hold = el('select', {}, el('option', { value: '' }, 'Select a ' + regionWord() + '…'));
  /**
   * WHO SOLD IT TO YOU — one field for both kinds of supplier.
   *
   * It used to be two: a free-text "Vendor" and a dropdown asking, separately,
   * whether that vendor happened to be a registered company. That made the
   * common case (an NPC smith) look like it was missing an answer, and the
   * useful case (a real shop) something you had to fill in twice.
   */
  const vendor = createItemPicker({
    allowFree: true,
    placeholder: 'Who did you buy from?',
    freeHint: 'Not a registered company — it will be recorded as typed.',
    meta: (c) => (regionsOn() && c.hold ? c.hold : ''),
    onPick: (c) => {
      // The supplier's own region, unless the user has already chosen one.
      if (regionsOn() && c.hold && !hold.value) hold.value = c.hold;
      fillReview();
    },
  });
  vendor.el.addEventListener('input', fillReview);
  hold.addEventListener('change', fillReview);
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

  /* ---- the read-back and the button ------------------------------------ */
  const review = el('div', { class: 'step-review' }, '');
  function fillReview() {
    const live = liveLines();
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
    review.innerHTML = rows.length
      ? rows.map(([k, v]) => '<div class="step-review-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('')
      : '<p class="note">Nothing to record yet.</p>';
  }

  const status = el('p', {});
  const record = el('button.primary', { onclick: doRecord }, 'Record delivery');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  /**
   * Everything is checked HERE, not card by card.
   *
   * The stepped version validated on the way forward, which it could because it
   * held you at a step. All three cards are visible now, so there is nowhere to
   * hold you — and a message that names the line is more use than one that
   * blocks a button anyway.
   */
  function problem() {
    const live = liveLines();
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
  }

  async function doRecord() {
    const bad = problem();
    if (bad) { setStatus(bad, 'error'); return; }
    record.disabled = true;
    setStatus('Recording…', '');
    try {
      await api.recordIntake({
        // One request for the whole trip. The Worker validates every line
        // before it writes any of them, so a bad line cannot leave half a
        // delivery.
        items: liveLines().map((l) => ({
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
      // Finishing once is what proves the walk-through is no longer needed.
      markGuideSeen('intake');
      toast('Delivery recorded.', 'ok');
      reset();
      onRecorded();
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      record.disabled = false;
    }
  }

  /** Back to an empty form, ready for the next trip. */
  function reset() {
    idem = newIdem();
    lines.splice(0, lines.length).forEach((l) => l.wrap.remove());
    priceHost.innerHTML = '';
    vendor.clear();
    hold.value = '';
    setStatus('');
    addLine();
  }

  const unseen = guideUnseen('intake');
  addLine();

  const node = el('div', {}, [
    el('div.card', {}, [
      el('h3', {}, '1 · What arrived?'),
      el('p', { class: 'note' }, 'One line per item. Add as many as the delivery brought.'),
      guidePanel(GUIDE.arrived, unseen),
      // The rows are bare boxes once a placeholder is typed over, so the
      // columns are named above them and stay named.
      el('div', { class: 'craft-row line-head' }, [
        el('span', {}, 'Item'),
        el('span', {}, 'Qty'),
        el('span', {}, 'Cost each'),
        el('span', {}, 'Line total'),
        el('span', {}, ''),
      ]),
      linesHost,
      el('div', { class: 'row-actions' }, [addBtn]),
      totalLine,
    ]),
    el('div.card', {}, [
      el('h3', {}, '2 · What will you charge?'),
      el('p', { class: 'note' }, 'Per item. Leave a price blank to keep whatever it is already listed at.'),
      guidePanel(GUIDE.pricing, unseen),
      nothingToPrice,
      priceHost,
    ]),
    el('div.card', {}, [
      el('h3', {}, '3 · Where did it come from?'),
      el('p', { class: 'note' }, 'All optional, and asked once for the whole delivery.'),
      guidePanel(GUIDE.source, unseen),
      el('label', {}, 'Vendor'), vendor.el,
      el('p', { class: 'note' }, 'Start typing — shops on this network appear as you go. Anyone else, ' +
        'just type the name.'),
      ...(regionsOn() ? [el('label', {}, regionLabel() + ' purchased in'), hold] : []),
      el('h4', {}, 'About to record'),
      review,
      el('div', { class: 'row-actions' }, [record]),
      status,
    ]),
  ]);

  sync();
  return { node, reset };
}

/**
 * The register's BUYING side.
 *
 * The form IS the page. There is no tile to press first: Buying does one thing,
 * and a grid of one button in front of it was a click that asked nothing.
 *
 * The deliveries below it are the receipt. Selling clears the cart when a sale
 * lands, which tells you it worked; recording a delivery used to close a window
 * and leave you looking at nothing. The full history — and removing a delivery
 * entered by mistake — stays on the Shop Ledger rather than being built twice.
 */
export function renderBuying(host, { me }) {
  const canBuy = canManage(me);
  const listHost = el('div', {}, skeletonRows(3));

  // Not a security check — the Worker refuses the write from an employee. The
  // page simply does not show a form that cannot be submitted.
  const intake = canBuy ? buildIntake(me, refresh) : null;

  mount(host,
    el('div.card', {}, [
      el('h3', {}, 'Intake Ingredients/Stock'),
      el('p', { class: 'note' }, canBuy
        ? 'Stock coming IN, and the coin going out for it — to sell or to craft with. Grown or crafted ' +
          'rather than bought? That is Farm/Harvest and Craft, on Inventory.'
        : 'Recording what the shop buys is the owner’s — it moves coin out of the coffer. Ask them to ' +
          'record an intake; what has already arrived is below.'),
    ]),
    intake ? intake.node : el('span', {}),
    el('div.card', {}, [
      el('h3', {}, 'Recent deliveries'),
      el('p', { class: 'note' }, 'The last few, so you can see what you just recorded. The full history, and ' +
        'removing a delivery recorded by mistake, are on the Shop Ledger.'),
      listHost,
    ]),
  );

  /**
   * ONE ROW PER DELIVERY, not per line.
   *
   * This is a receipt for "did the thing I just recorded land", and a trip that
   * brought six items answering that with six rows is the wrong shape — the
   * figure you actually handed over is not on any of them. The lines carry the
   * trip they belong to, so this is a grouping rather than a guess.
   */
  function draw(rows) {
    if (!rows.length) {
      mount(listHost, emptyState({
        glyph: '📦', title: 'No deliveries yet',
        hint: 'Record one above and it will appear here.',
      }));
      return;
    }
    const order = [];
    const by = new Map();
    rows.forEach((r) => {
      if (!by.has(r.delivery)) { by.set(r.delivery, []); order.push(r.delivery); }
      // Unshift: the query is newest-first, so a delivery's own lines arrive
      // backwards. Within one trip they should read in the order they were typed.
      by.get(r.delivery).unshift(r);
    });
    mount(listHost, el('div', { class: 'table-scroll' }, tableEl(
      ['When', 'Items', 'Total', 'From'],
      order.slice(0, 8).map((k) => {
        const ls = by.get(k);
        const first = ls[0];
        return [
          String(first.ts || '').slice(0, 10),
          el('span', { class: 'wrap-cell' }, ls.map((r) => r.item + ' ×' + r.numItems).join(', ')),
          money(ls.reduce((n, r) => n + coins(r.numItems * r.pricePer), 0)),
          // A registered supplier is worth marking: it is the one that shows up
          // in its own region's figures as having supplied you.
          (first.fromBusiness || first.vendor || '—') + (first.fromBusiness ? ' ✓' : ''),
        ];
      }),
    )));
  }

  function refresh() {
    api.getIntake()
      .then((r) => draw(r.intake || []))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }
  refresh();
}
