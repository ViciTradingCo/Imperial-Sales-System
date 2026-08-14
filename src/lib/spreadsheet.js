/**
 * Reading a spreadsheet a shopkeeper actually has — .xlsx or .csv.
 *
 * WHY THIS IS HAND-WRITTEN. The obvious answer is a spreadsheet library, and
 * the smallest capable one is larger than this entire application. This is a
 * PWA whose whole point is working offline on a phone; a megabyte of parser so
 * that a stocktake can be pasted from Excel is the wrong trade. What is
 * actually needed is narrow — read the first sheet of a file, get back rows of
 * text — and that fits in a page.
 *
 * An .xlsx IS A ZIP of XML. Its entries are usually DEFLATE-compressed, which
 * the browser can undo itself (`DecompressionStream`), so there is no
 * compression code here either — only the container format and enough of the
 * sheet XML to find the cells.
 *
 * WHAT IT DOES NOT READ is a genuine legacy .xls, the old binary format. That
 * is a different thing entirely despite the name, and rather than half-support
 * it the caller is told to save as .xlsx — which Excel does in two clicks.
 */

/* ---- the ZIP container ---- */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * Every file in the archive, by name.
 *
 * Read through the CENTRAL DIRECTORY rather than by scanning for local headers:
 * the directory is the archive's own index of itself, and scanning can be fooled
 * by a byte sequence inside compressed data that happens to look like a header.
 */
async function unzip(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // The end-of-directory record sits at the very end, after a comment of
  // unknown length — so it is found by searching backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That does not look like a spreadsheet — no archive directory in it.');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // The local header repeats the name and extra fields, and its extra field
    // may be a DIFFERENT length from the directory's — so the data offset has
    // to be read from the local header, never computed from this one.
    const lNameLen = view.getUint16(localAt + 26, true);
    const lExtraLen = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    files.set(name, { method, at: dataAt, size: compressed });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    async text(name) {
      const f = files.get(name);
      if (!f) return '';
      const raw = bytes.subarray(f.at, f.at + f.size);
      if (f.method === 0) return new TextDecoder().decode(raw); // stored
      if (f.method !== 8) throw new Error('That spreadsheet uses a compression this app cannot read.');
      if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser cannot unpack .xlsx files. Save the sheet as CSV and use that instead.');
      }
      const stream = new Response(raw).body.pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    },
    has: (name) => files.has(name),
    names: () => [...files.keys()],
  };
}

/* ---- the sheet ---- */

/** XML text with its five entities put back. Cell text is escaped in the file. */
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // Ampersand LAST, or "&amp;lt;" would decode twice and turn into "<".
    .replace(/&amp;/g, '&');
}

/** All the text inside a run of <t> elements, joined — a cell can be several. */
function textOf(xml) {
  let out = '';
  for (const m of String(xml).matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1]);
  return out;
}

/** "BC" → 54. A cell reference names its column in letters, not a number. */
function colIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The first sheet of an .xlsx, as rows of plain strings.
 *
 * Cells are placed BY THEIR REFERENCE rather than in the order they appear: a
 * sheet omits empty cells entirely, so a row written A, C, D would otherwise
 * read as three adjacent columns and silently shift everything left.
 */
async function readXlsx(buf) {
  const zip = await unzip(buf);

  // Shared strings: most text in a sheet is an index into this table.
  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const xml = await zip.text('xl/sharedStrings.xml');
    for (const m of xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }

  // The first sheet by the workbook's own order, not by filename: sheet1.xml is
  // not reliably the first tab, and the one a person was looking at is.
  let target = 'xl/worksheets/sheet1.xml';
  if (zip.has('xl/workbook.xml') && zip.has('xl/_rels/workbook.xml.rels')) {
    const wb = await zip.text('xl/workbook.xml');
    const rels = await zip.text('xl/_rels/workbook.xml.rels');
    const first = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/);
    if (first) {
      const rel = rels.match(new RegExp('<Relationship[^>]*Id="' + first[1] + '"[^>]*Target="([^"]+)"'));
      if (rel) {
        const t = rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
        if (zip.has('xl/' + t)) target = 'xl/' + t;
      }
    }
  }
  if (!zip.has(target)) {
    const any = zip.names().find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
    if (!any) throw new Error('That spreadsheet has no sheets in it.');
    target = any;
  }

  const sheet = await zip.text(target);
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1];
      const body = cm[2];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let value = '';
      if (type === 's') {
        const idx = Number((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
        value = shared[idx] || '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        value = unescapeXml((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      }
      const at = colIndex(ref);
      if (at >= 0) cells[at] = value;
      else cells.push(value);
    }
    // A sheet's used range is often far wider than its data; trailing holes are
    // not columns anybody typed in.
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

/** A CSV of the simple kind a spreadsheet exports — quoted fields included. */
function readCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
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
 * Reads a file the user picked, whatever of the two kinds it is, into rows.
 *
 * The extension decides, because that is what the user believes they have —
 * and an .xlsx really is unmistakable if the extension lies, since it must
 * start with a ZIP signature.
 */
export async function readSpreadsheet(file) {
  const name = String((file && file.name) || '').toLowerCase();
  if (name.endsWith('.xls')) {
    throw new Error('That is the older .xls format, which this app cannot read. Open it in your ' +
      'spreadsheet program and use “Save as” to make an .xlsx or a .csv.');
  }
  const buf = await file.arrayBuffer();
  const looksZipped = new Uint8Array(buf, 0, 2)[0] === 0x50 && new Uint8Array(buf, 0, 2)[1] === 0x4b;
  if (looksZipped) return readXlsx(buf);
  return readCsv(new TextDecoder().decode(buf));
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
  if (!table.length) return { text: '', note: 'That sheet is empty.' };

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
