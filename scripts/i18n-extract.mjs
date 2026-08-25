#!/usr/bin/env node
/**
 * EVERY ENGLISH STRING THE APP RENDERS — `npm run i18n:extract`.
 *
 * The dictionary is keyed on the exact text that reaches the page, so the only
 * safe way to know what needs translating is to read the source the way the
 * browser will. Hand-collecting them is how the dictionary got to 3% coverage
 * without anyone noticing: nothing failed, the untranslated parts just rendered
 * in English beside the translated ones.
 *
 * WHY AN AST AND NOT A REGEX. Most of this app's prose is ASSEMBLED —
 *
 *   el('p', {}, 'What things are worth in your ' + regionWord() + ', last week.')
 *
 * — and what lands in the DOM is one text node holding the finished sentence.
 * A regex over the source sees three fragments and no way to tell that they are
 * one sentence, or which order they arrive in. So the file is parsed (rollup's
 * own parser, already installed for the build — no new dependency) and a
 * concatenation is flattened into a TEMPLATE with numbered holes:
 *
 *   'What things are worth in your {0}, last week.'
 *
 * The runtime matches a text node against the English template, keeps what fell
 * in the holes, and drops it into the translated one. That is the only way a
 * sentence with a realm's own word for "region" in the middle of it can be
 * translated at all.
 *
 * WHAT COUNTS AS RENDERABLE. A string is collected when it is in a position the
 * app puts on screen: a child of `el()`, a `label`/`hint`/`title`/`placeholder`
 * property, an `emptyState` field, a `guidePanel` line, a `toast`. Everything
 * else — routes, css classes, storage keys, API paths — is skipped, both by
 * position and by shape.
 *
 * It reports, it does not write translations. Output is `strings.json`: the
 * catalogue a translator (or a later pass here) fills in.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rollup/parseAst';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(SRC, 'lib', 'i18n', 'strings.json');

/** Files whose strings are never shown as interface text. */
const SKIP = ['lib/i18n.js', 'lib/i18n/'];

/**
 * Property names whose string value is NOT text, however much it looks like it.
 *
 * `glyph` holds an emoji, and translating one is a good way to turn 📦 into the
 * word for "box"; `key` and `value` are identifiers the app matches on; `class`
 * and `type` are markup. Everything else is assumed to be shown, which is the
 * bias this file is built on — see below.
 */
const SKIP_PROPS = new Set(['glyph', 'key', 'class', 'className', 'type', 'value', 'id', 'name', 'href', 'src',
  'method', 'path', 'action', 'style', 'autocomplete', 'step', 'min', 'max', 'accept', 'rel', 'target',
  // Request headers read as prose otherwise — 'Bearer {0}' is not a sentence.
  'Authorization', 'Content-Type', 'Accept-Language', 'headers']);

/**
 * Calls whose string arguments are machine values, never words on a page.
 *
 * This is the list that matters, because the rule below is OVER-COLLECT: a
 * string that turns out not to be rendered costs one unused row in a pack,
 * while a string that IS rendered and was missed is a sentence sitting in
 * English in the middle of somebody's own language. Given the whole point is
 * that the page is never half-translated, the cheap mistake is the right one
 * to prefer — so anything not obviously machinery is collected.
 */
const SKIP_CALLS = new Set(['request', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll',
  'getElementById', 'addEventListener', 'removeEventListener', 'setAttribute', 'getAttribute', 'hasAttribute',
  'removeAttribute', 'createElement', 'navigate', 'route', 'add', 'remove', 'toggle', 'contains', 'matches',
  'split', 'join', 'startsWith', 'endsWith', 'includes', 'indexOf', 'replace', 'replaceAll', 'match', 'test',
  'setProperty', 'getPropertyValue', 'importScripts', 'postMessage', 'open', 'fetch', 'assign', 'push']);

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : jsFiles(p);
    return name.endsWith('.js') ? [p] : [];
  });
}

/**
 * Whether a finished string is interface TEXT rather than a machine value.
 *
 * The position tests above catch most of it; this catches what slips through —
 * a css class handed to `el()` as a tag, a route, a storage key. The rule is
 * that prose has a capital or a space and is not a single lowercase token.
 */
function isProse(s) {
  const v = s.trim();
  if (!v || v.length < 2) return false;
  if (!/[A-Za-z]/.test(v)) return false;              // pure punctuation/emoji
  if (/^[a-z0-9_.\/#:-]+$/.test(v)) return false;      // route, key, class, path
  if (/^https?:/.test(v)) return false;
  if (/^[A-Z_]+$/.test(v) && v.length < 20) return false; // CONSTANT
  // A one-word camelCase identifier — `supportTitle`, a settings key. Prose has
  // spaces or starts with a capital; this has neither.
  if (/^[a-z]+[A-Z]\w*$/.test(v)) return false;
  // A single token that is plainly a machine value: a query string, a filename,
  // an idempotency stem, a BCP-47 tag. Real interface text has a space in it or
  // is a word; none of these are either.
  if (!/\s/.test(v.replace(/\{\d+\}/g, ''))
    && (/[=?\\]/.test(v) || /\.[a-z0-9]{2,4}$/i.test(v) || /^[a-z]{2}-[A-Z]{2}$/.test(v))) return false;
  return true;
}

/**
 * Flattens a `+` chain into { template, holes }.
 *
 * Returns null when the expression is not worth a row: no literal text in it at
 * all (a bare variable), or every literal is punctuation. A template that is
 * nothing but holes translates nothing and would match every text node on the
 * page, which is worse than not having it.
 */
function flatten(node) {
  const parts = [];
  (function walk(n) {
    if (n.type === 'BinaryExpression' && n.operator === '+') { walk(n.left); walk(n.right); return; }
    if (n.type === 'Literal' && typeof n.value === 'string') { parts.push({ lit: n.value }); return; }
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0) {
      parts.push({ lit: n.quasis[0].value.cooked }); return;
    }
    parts.push({ hole: true });
  })(node);

  let out = '';
  let holes = 0;
  let letters = 0;
  for (const p of parts) {
    if (p.hole) { out += '{' + holes++ + '}'; } else { out += p.lit; letters += (p.lit.match(/[A-Za-z]/g) || []).length; }
  }
  // A hole-only or near-hole-only string carries no words to translate.
  if (letters < 2) return null;
  return { template: out.replace(/\s+/g, ' ').trim(), holes };
}

const found = new Map();   // template → { holes, files:Set }
function keep(template, holes, file) {
  if (!isProse(template.replace(/\{\d+\}/g, ' '))) return;
  const row = found.get(template) || { holes, files: new Set() };
  row.files.add(relative(ROOT, file));
  found.set(template, row);
}

/** Whether a finished string is markup, and so several text nodes rather than one. */
const isMarkup = (t) => /<[a-z/][^>]*>/i.test(t);

function collect(node, file) {
  const f = flatten(node);
  if (!f) return;
  // Markup can reach `el()` from anywhere — an `html:` property, a helper that
  // returns a line, a variable assembled three functions away. Whatever built
  // it, the browser turns it into SEVERAL text nodes, so it is split wherever
  // it is found rather than only where it is obviously html.
  if (isMarkup(f.template)) { splitRuns(f.template, file); return; }
  keep(f.template, f.holes, file);
}

/**
 * One markup string, cut into the text runs the browser will make of it.
 *
 * Runs are renumbered from {0} because each is matched on its own, and a run
 * left with no words after the split is dropped by `keep`.
 */
function splitRuns(template, file) {
  for (const run of template.split(/<[^>]*>/)) {
    let n = 0;
    const t = run.replace(/\{\d+\}/g, () => '{' + n++ + '}').replace(/\s+/g, ' ').trim();
    if (t) keep(t, n, file);
  }
}

/**
 * An `html:` property, which is NOT one string on the page.
 *
 * `'Your code admits you to <b>' + esc(name) + '</b> as a shop owner.'` becomes
 * three DOM nodes, and the runtime translates text NODES — so it will be asked
 * about "Your code admits you to" and "as a shop owner." separately and never
 * about the whole. Collecting the whole would produce a row that can never
 * match. So the template is split on its tags and each text run is its own row,
 * exactly as the browser will present them.
 *
 * Runs are renumbered from {0} because each is matched on its own; a run that
 * is left with no words after the split is dropped by `keep`.
 */
function collectHtml(node, file) {
  const f = flatten(node);
  if (f) splitRuns(f.template, file);
}

/** Every node in the tree, depth-first. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  if (typeof node.type === 'string') visit(node);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    walk(node[k], visit);
  }
}

const files = jsFiles(SRC).filter((f) => !SKIP.some((s) => relative(SRC, f).replace(/\\/g, '/').startsWith(s)));
for (const file of files) {
  let ast;
  try { ast = parseAst(readFileSync(file, 'utf8')); }
  catch (e) { console.error('parse failed:', relative(ROOT, file), e.message); continue; }

  /**
   * Positions that are structurally not text, whatever they contain: the
   * source of an import, a property NAME, the tag handed to `el()`, and the
   * arguments of the machinery listed above. Everything else is collected and
   * left to `isProse` to judge.
   */
  const skip = new Set();
  // A skipped expression takes its PIECES with it. Marking only the top node
  // left `Authorization: 'Bearer ' + token` skipped as a whole while the bare
  // `'Bearer '` inside it was still collected on the way down.
  const skipTree = (n) => { skip.add(n); walk(n, (c) => skip.add(c)); };
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration' && node.source) skipTree(node.source);
    if (node.type === 'ExportNamedDeclaration' && node.source) skipTree(node.source);
    if (node.type === 'Property' && !node.computed) {
      skip.add(node.key);
      const key = node.key.type === 'Identifier' ? node.key.name
        : (node.key.type === 'Literal' ? String(node.key.value) : '');
      if (SKIP_PROPS.has(key)) skipTree(node.value);
    }
    if (node.type === 'MemberExpression' && !node.computed) skip.add(node.property);
    // `headers['Authorization'] = 'Bearer ' + token` — the same machine value as
    // the object-literal form above, reached by assignment instead.
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.computed
      && node.left.property.type === 'Literal' && SKIP_PROPS.has(String(node.left.property.value))) {
      skipTree(node.right);
    }
    if (node.type === 'CallExpression') {
      const name = node.callee.type === 'Identifier' ? node.callee.name
        : (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier'
          ? node.callee.property.name : '');
      // `el('div.card', …)` — the first argument is a tag, never words.
      if (name === 'el' && node.arguments[0]) skipTree(node.arguments[0]);
      if (SKIP_CALLS.has(name)) node.arguments.forEach(skipTree);
    }
  });

  walk(ast, (node) => {
    if (skip.has(node)) return;
    // `html:` is split on its tags — it is several text nodes, not one string.
    if (node.type === 'Property' && !node.computed && !skip.has(node.value)) {
      const key = node.key.type === 'Identifier' ? node.key.name
        : (node.key.type === 'Literal' ? String(node.key.value) : '');
      if (key === 'html') { collectHtml(node.value, file); skip.add(node.value); return; }
    }
    if (node.type === 'Literal' && typeof node.value === 'string') collect(node, file);
    // A `+` chain is ONE sentence; collect it whole and skip its pieces, or the
    // fragments would each become a row that can never match a text node.
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      collect(node, file);
      walk(node, (n) => skip.add(n));
    }
  });
}

const rows = [...found.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([template, { holes, files: fs }]) => ({
    en: template,
    holes,
    // How many LETTERS the template has outside its holes. The runtime uses it
    // twice: to refuse a template too vague to identify a sentence ("{0} — {1}"
    // would match half the page), and to try the most specific first when two
    // could both match.
    lits: (template.replace(/\{\d+\}/g, '').match(/[A-Za-z]/g) || []).length,
    /**
     * Two holes with NOTHING between them cannot be taken apart again.
     * `'{0}{1} item'` against "3 red item" has no way to know where the first
     * value ended and the second began, so the pieces would go back into the
     * translation in the wrong places. These are LEFT IN ENGLISH rather than
     * guessed at — there are six, they are mostly counters, and a scrambled
     * sentence is worse than an English one.
     *
     * A separator is enough to make it safe: `'older than {0} {1} in {2}'`
     * splits cleanly on its spaces, so it is not flagged.
     */
    ambiguous: /\{\d+\}\{\d+\}/.test(template) || undefined,
    seen: [...fs].sort(),
  }));

if (!existsSync(dirname(OUT))) {
  console.error('Create ' + relative(ROOT, dirname(OUT)) + ' first.');
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n');

const withHoles = rows.filter((r) => r.holes > 0).length;
const chars = rows.reduce((n, r) => n + r.en.length, 0);
console.log(`${rows.length} strings (${withHoles} with placeholders, ${rows.length - withHoles} plain)`);
console.log(`${chars.toLocaleString()} characters of English`);
console.log('→ ' + relative(ROOT, OUT));
