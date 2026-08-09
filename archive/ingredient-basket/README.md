# Shelved: the ingredient basket

**Shipped 2026-08-09, shelved the same day.** It worked; it was taken off the
site because the job it did got folded into intake, and two doors onto the same
record is worse than one door that explains itself.

## What it was

A **shopping list that totalled as you built it**, on the register's Buying side.
Add a line per ingredient, watch the basket total climb, then record the lot —
each line becoming its own delivery with the stock added and the coffer debited.
Every price started at what this shop had actually paid before, so you arrived
at a supplier already knowing what the crate should come to.

## Why it was shelved

Buying had two tiles that both recorded deliveries, and the difference between
them (one item with a vendor and a region, versus several items with neither)
was not something you could tell from the tiles. Intake is now the one door,
renamed **Intake Ingredients/Stock** so it plainly covers both, with a
walk-through that says so on the step where it matters.

**Its best feature was kept, not shelved.** The reason to reach for the basket
was that it knew what you usually pay. Intake now does the same thing: picking
an item shows `usually 12gp` beside it and fills the cost field with this shop's
own weighted average, falling back to the index's valuation for something never
bought before. That is `held()` and the picker's `meta` / `onPick` in
`src/views/intake-form.js`.

**The running total came back too.** For one day it did not: a five-reagent trip
was five separate intakes with nothing adding them up. Intake now takes as many
items as the trip brought, on one screen, totalling as you type — so the basket
has nothing left that intake does not do.

## Restoring it

Move `ingredient-basket.js` back into `src/views/intake-form.js` (or its own
module) and delete this file's header comment. It needs, from that file's
existing imports:

```js
import { money } from '../lib/format.js';
import { el } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { toast } from '../lib/toast.js';
```

Then re-add its tile to `renderBuying`:

```js
      { key: 'buy-basket', label: 'Buy ingredients', glyph: '🧺',
        hint: 'A basket that totals as you build it',
        onOpen: () => openIngredientBuyModal(refresh) },
```

its `TILE_KEYS` entry in `src/views/admin-settings.js`:

```js
  ['buy-basket', 'Register · Buy ingredients'],
```

Its styles need nothing: `.buy-total`, `.buy-sub` and `.craft-row` are all live
again, because intake grew a line list with a running total of its own.

## One thing to fix if it returns

`addRowSeeded` is assigned inside the `api.getItems()` callback and declared
with `let` *below* the call that assigns it. It works, because the callback
runs after the declaration has been evaluated, but it reads as a bug and the
first person to move those two lines apart will create one. Declare it before
the fetch.

## What was NOT removed

Nothing in the data. Every delivery the basket recorded is an ordinary intake
row and is untouched — visible in Sales Log, counted in the market figures, and
reversible in exactly the same way as any other delivery.
