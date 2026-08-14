/**
 * Reading a CSV a shopkeeper picked, and turning it into a stocktake.
 *
 * CSV ONLY, deliberately. There was an .xlsx reader here for a few hours — a
 * ZIP walk and enough sheet XML to find the cells — and it worked, but every
 * spreadsheet program writes CSV, and CSV is what the Stocktake's own export
 * already produces. The round trip this exists for (export it, edit it, read it
 * back) never needed the other format. It is kept in `archive/xlsx-reader/`
 * with the notes on what it took to get right.
 */

/**
 * A CSV of the kind a spreadsheet exports, into rows of text.
 *
 * Hand-parsed rather than split on commas, because a quoted field may contain
 * a comma, a newline, or an escaped quote — and an item called
 * "Sword, Ceremonial" is exactly the sort of thing a shop stocks.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  // Excel writes CRLF, and a lone CR still turns up from older tools.
  const src = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Reads the file the user picked.
 *
 * A file named .xls or .xlsx is REFUSED with instructions rather than being
 * fed to the CSV parser, which would otherwise read a binary or a ZIP as one
 * enormous garbled row and report something useless about it.
 */
export async function readCsvFile(file) {
  const name = String((file && file.name) || '').toLowerCase();
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    throw new Error('This reads CSV files. In your spreadsheet program choose “Save as” (or “Export”) ' +
      'and pick CSV, then use that file.');
  }
  const text = await file.text();
  // A spreadsheet may write a byte-order mark; left in place it becomes part of
  // the first heading and "Item" stops matching.
  return parseCsv(text.replace(/^﻿/, ''));
}

/**
 * Turns rows of a spreadsheet into the `Name, Amount` lines the stocktake reads.
 *
 * IT FINDS THE COLUMNS rather than demanding a shape. A real stocktake sheet has
 * a header row, often more columns than these two, and not always in this order
 * — so the header is searched for something that means "name" and something
 * that means "how many". Failing that, the first two columns are used, which is
 * what a headerless two-column sheet is.
 *
 * The output is TEXT, deliberately: it goes into the same box a person would
 * have typed into, and from there through the same planner and the same preview.
 * A spreadsheet is a faster way to fill that box in, not a second way to change
 * stock.
 */
export function rowsToStocktake(rows) {
  const table = (rows || []).filter((r) => r && r.some((c) => String(c || '').trim()));
  if (!table.length) return { text: '', note: 'That file is empty.', count: 0 };

  const NAME = /^(item|name|product|goods?)\b/i;
  const QTY = /^(amount|qty|quantity|count|stock|on hand|in stock)\b/i;

  let nameAt = 0;
  let qtyAt = 1;
  let from = 0;
  let note = '';
  const head = table[0].map((c) => String(c || '').trim());
  const foundName = head.findIndex((c) => NAME.test(c));
  const foundQty = head.findIndex((c) => QTY.test(c));
  if (foundName >= 0 && foundQty >= 0) {
    nameAt = foundName; qtyAt = foundQty; from = 1;
    note = 'Read the “' + head[foundName] + '” and “' + head[foundQty] + '” columns.';
  } else {
    // No header this recognises. The first two columns are the convention the
    // export writes, so they are the sensible guess — said out loud, because a
    // guess the user cannot see is a guess they cannot correct.
    note = 'No “Item” and “Amount” headings found, so the first two columns were used.';
  }

  const lines = [];
  for (let i = from; i < table.length; i++) {
    const r = table[i];
    const item = String((r[nameAt] != null ? r[nameAt] : '')).trim();
    const qty = String((r[qtyAt] != null ? r[qtyAt] : '')).trim();
    if (!item && !qty) continue;
    lines.push(item + ', ' + qty);
  }
  return { text: lines.join('\n'), note, count: lines.length };
}
