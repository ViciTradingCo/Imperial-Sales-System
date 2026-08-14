# Shelved: the .xlsx reader

**Shelved 2026-08-14**, hours after it shipped. It worked; it was taken off in
favour of CSV alone, which is simpler.

## What it was

`src/lib/spreadsheet.js` — a dependency-free reader that took a file a
shopkeeper had picked and returned rows of text, for the Stocktake to read a
count out of.

CSV was the easy half. The other two thirds of the file were .xlsx, which is a
ZIP of XML:

- a **ZIP central-directory walk**, reading the archive's own index of itself
  rather than scanning for local headers (a byte sequence inside compressed data
  can look exactly like a header), and taking each entry's data offset from its
  LOCAL header, whose extra field may be a different length from the
  directory's;
- **inflation** via the browser's own `DecompressionStream('deflate-raw')`, so
  there was no compression code;
- enough **sheet XML** to find cells: shared strings, inline strings, XML
  entities, and — the part a naive reader gets wrong — cells placed by their
  `r="B3"` REFERENCE rather than in the order they appear, because a sheet omits
  empty cells entirely and reading them in order silently shifts every column
  left;
- the first sheet taken from the **workbook's own order**, since `sheet1.xml` is
  not reliably the first tab.

## Why it was shelved

Asked for directly: CSV is simpler. Every spreadsheet program writes CSV, and it
is the format the Stocktake's own export already produces — so the round trip
(export, edit, read back) never needed the other format at all.

## Restoring it

The file is UNMODIFIED, so its relative imports no longer resolve — that is
deliberate, and it is a faithful record. To bring it back:

1. Move it to `src/lib/spreadsheet.js`.
2. In `src/views/inventory.js`, import `readSpreadsheet` in place of
   `readCsvFile` and call it the same way — the signature is identical, and it
   already falls through to CSV for anything that is not a ZIP.
3. Widen the file input's `accept` back to
   `.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
   and say so in the note beside it.

## What was NOT removed

Reading a CSV, and `rowsToStocktake` — the column-finding that turns a sheet
into `Name, Amount` lines. Both live on in `src/lib/csv.js`; they were never the
.xlsx part.
