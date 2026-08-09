# Shelved: inventory bulk import/export

**Shelved 2026-08-09**, at the same time Harvest and Craft moved off Inventory
onto the register. It worked; it was taken off the site.

## What it was

A focal modal on the Inventory page with two text boxes:

- **Export** — every item in the shop's inventory as `Item, price, stock, low`,
  ready to copy into a spreadsheet.
- **Import** — the same shape pasted back, upserted in one `db.batch`. Omitted
  numeric fields kept the item's current value (or 0 for a new item), so a list
  of just names and prices did not wipe everyone's stock. A row with a
  non-numeric price was skipped, which is what let a pasted header line through
  harmlessly.

It also accepted the looser `Item price` form, parsed by `parseImport` — the
value being the LAST numeric field, so an item name containing a comma still
worked.

## Why it was shelved

Asked for directly. It is the only place in the app where a paste could rewrite
every price and count a shop holds, and it sat one click from the list it would
overwrite. Inventory is now the list you consult and correct a row at a time;
nothing on it edits in bulk.

## What is in this file

Everything, in the order it was wired:

| Part | Was |
| --- | --- |
| `openImportExportModal`, `parseImport` | `src/views/inventory.js` |
| `importInventory` | `worker/src/inventory.js` |
| `importInventoryRoute` | `worker/src/routes/business.js` |

All three are unmodified. The frontend half needs `el`, `mount`, `api`, `toast`
and `openModal` from that file's imports; the Worker half needs `getDb` and
`listInventory` from `./db.js` and its own module, and the route needs
`requireOwnerOrAdmin`, `realmIdOf`, `logAudit` and `actorName`.

## Restoring it

1. Put `openImportExportModal` and `parseImport` back in
   `src/views/inventory.js`, and add the button to the owner's row:
   ```js
   el('button.secondary-btn', { onclick: () => openImportExportModal(refreshInventory) }, 'Import/Export'),
   ```
2. Put `importInventory` back in `worker/src/inventory.js` and export it.
3. Put `importInventoryRoute` back in `worker/src/routes/business.js`, add
   `importInventory` to its `../inventory.js` import, and re-add the route:
   ```js
   { method: 'POST', path: '/inventory/import', handler: importInventoryRoute },
   ```
4. Re-add the client method to `src/lib/api.js`:
   ```js
   /** Owner/admin: bulk import inventory rows [{item, price, stock, lowStock}]. */
   importInventory: (rows) => request('POST', '/inventory/import', { rows }),
   ```

`worker/test/api-client.test.js` cross-checks every client path against the
Worker's routes, so steps 3 and 4 have to land together or the suite says so.

## What was NOT removed

No data. Every inventory row an import ever created is untouched — this was only
ever a way to type them faster.

The **Master Item Index** keeps its own import/export, which is a different
thing: the shared library of canonical names and base values, network-wide, not
one shop's prices and counts.
