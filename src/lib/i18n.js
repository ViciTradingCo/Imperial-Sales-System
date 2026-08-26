/**
 * Lightweight client-side translation.
 *
 * The app is authored in English; this layer swaps interface text to the user's
 * chosen language at render time. It works by translating text nodes (and
 * placeholder/title attributes) against an English→target dictionary, and a
 * MutationObserver re-applies it to anything rendered later — so one mechanism
 * covers the whole app without threading a t() through every view.
 *
 * Notes:
 *  • English is the source language (no dictionary, no work).
 *  • Proper nouns (the app name, character/business names) and any string not in
 *    the dictionary are left as-is, so nothing ever renders blank.
 *  • The choice is per-device (localStorage), like the theme. Changing it
 *    reloads so every surface re-renders cleanly in the new language.
 */
/**
 * Every language the app has a pack for, finished or not.
 *
 * What a reader is actually OFFERED is `LANGS` below, which is this list
 * narrowed to the ones that are done.
 */
const ALL = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
};

/**
 * THE LANGUAGES THAT ARE FINISHED — the only ones anyone is given.
 *
 * A pack that covers part of the app renders the rest in English, and the
 * result is one language in the heading and another in the paragraph under it.
 * That is not a smaller version of being translated; it is its own kind of
 * broken, and it is what the app shipped for months without anyone noticing,
 * because nothing fails when a phrase is missing.
 *
 * So completeness is a GATE, not a percentage to feel bad about. A language
 * appears here when `npm run i18n:check` says its pack covers every string the
 * app renders, and until then it is not offered, not auto-selected from the
 * device, and not reachable by an old stored setting. English in the meantime,
 * which at least is one language.
 *
 * `i18n:check` fails if a language listed here is not actually complete, so
 * this cannot be edited optimistically.
 */
const READY = ['en', 'fr'];

/** What a reader may choose: English, plus every finished translation. */
export const LANGS = Object.fromEntries(READY.map((l) => [l, ALL[l]]));

const KEY = 'eec.lang';

/**
 * WHAT LANGUAGE SOMEONE GETS BEFORE THEY ASK FOR ONE — their device's.
 *
 * English was the default, so a French speaker opening the app for the first
 * time got an English interface until they found Appearance and said so. Their
 * browser has been telling us the answer the whole time; we were not listening.
 *
 * `navigator.languages` is their ORDERED preference, not one value, so a reader
 * who lists Catalan first and Spanish second gets Spanish here rather than
 * English — the best of what we can actually write, in their own order. Only a
 * device asking for nothing we have translated falls back to English.
 *
 * Matched on the BASE subtag: fr-CA and fr-FR are both `fr`, because this
 * dictionary is a language and not a region. What the region is good for is
 * DATES, and those read the full tag — see `deviceLocale`.
 */
export function deviceLang() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const tags = (nav && (nav.languages && nav.languages.length ? nav.languages : [nav.language])) || [];
  for (const tag of tags) {
    const base = String(tag || '').trim().toLowerCase().split('-')[0];
    if (LANGS[base]) return base;
  }
  return 'en';
}

/**
 * The device's own locale tag, region and all — 'en-US', 'fr-CA', 'de-AT'.
 *
 * Empty when the device does not say. `format.js` uses it so a date is written
 * the way its reader writes dates, which is a REGIONAL habit and not a language
 * one: an American and a Briton share every word on this page and disagree
 * about 3/4/2026.
 */
export function deviceLocale() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const tags = (nav && (nav.languages && nav.languages.length ? nav.languages : [nav.language])) || [];
  return String(tags[0] || '').trim();
}

/**
 * The language everything renders in: what this device asked for, or what its
 * reader chose in Appearance if they have overruled it.
 *
 * A stored value not in `LANGS` is treated as no choice at all rather than
 * passed on, so a stale key from an older build cannot leave the interface
 * half-translated.
 */
export function getLang() {
  let stored = '';
  try { stored = localStorage.getItem(KEY) || ''; } catch (e) { /* private mode */ }
  return LANGS[stored] ? stored : deviceLang();
}
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch (e) { /* private mode */ }
}

/**
 * THE PACKS — one module per language, fetched only when it is the one in use.
 *
 * The dictionary used to be an object inlined in this file, which meant every
 * reader downloaded all five languages to use one of them. That was tolerable
 * at 121 phrases and is not at 849: a pack is its own module now, pulled in by
 * a dynamic `import()` that Vite splits into its own chunk. An English reader
 * downloads none of them; everyone else downloads exactly one, once, and the
 * service worker keeps it for offline use like the rest of the shell.
 *
 * Keyed on the English EXACTLY as `scripts/i18n-extract.mjs` found it, so the
 * catalogue and the packs cannot drift: `npm run i18n:check` fails on a key
 * that no longer appears on screen and reports every string still missing.
 */
const PACKS = {
  es: () => import('./i18n/es.js'),
  fr: () => import('./i18n/fr.js'),
  de: () => import('./i18n/de.js'),
  it: () => import('./i18n/it.js'),
};

/** The loaded pack: exact phrases, plus templates compiled to matchers. */
let pack = null;
let packLang = null;

/**
 * A template's English side, turned into something that can recognise the
 * finished sentence on the page.
 *
 * `'Close {0} permanently'` becomes `/^Close (.*?) permanently$/`, anchored so
 * it identifies a whole text node and never a phrase buried in a longer one.
 * The holes are non-greedy so the LITERAL text either side is what decides
 * where they end, which is the only reliable anchor available.
 */
function compile(en) {
  const parts = en.split(/\{\d+\}/);
  const body = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)');
  return new RegExp('^' + body + '$');
}

/**
 * How trustworthy a template is when several could match.
 *
 * Counted in LETTERS outside the holes: `'{0} — peak {1}'` carries four and
 * `'Nothing was traded in your {0} last week.'` carries thirty-two, and if a
 * node somehow satisfies both, the second is far more likely to be what it
 * actually is. Sorted once at load, so matching is a walk down that order.
 */
function weight(en) {
  return (en.replace(/\{\d+\}/g, '').match(/[A-Za-z]/g) || []).length;
}

/** Loads the pack for the current language. Resolves to null for English. */
async function loadPack() {
  const l = getLang();
  if (l === packLang) return pack;
  const make = PACKS[l];
  if (!make) { pack = null; packLang = l; return null; }
  let table;
  try { table = (await make()).default || {}; }
  catch (e) { pack = null; packLang = l; return null; } // a missing pack is English, not a crash
  const exact = new Map();
  const templates = [];
  for (const en in table) {
    const to = table[en];
    if (!to) continue;
    if (en.indexOf('{') === -1) exact.set(en, to);
    else templates.push({ re: compile(en), to, w: weight(en) });
  }
  templates.sort((a, b) => b.w - a.w);
  pack = { exact, templates };
  packLang = l;
  return pack;
}

/**
 * One text node's worth of English, in the reader's language.
 *
 * EXACT FIRST, always. A template is only consulted when nothing matched
 * outright, so a sentence that happens to fit a loose pattern still gets its
 * own translation when it has one.
 *
 * The node's own leading and trailing whitespace is preserved: text nodes carry
 * the spacing between inline elements, and trimming it here would run words
 * together on the page.
 */
function translatePhrase(s) {
  if (!pack) return s;
  const key = String(s).trim();
  if (!key) return s;
  const hit = pack.exact.get(key);
  if (hit != null) return s.replace(key, hit);
  for (const t of pack.templates) {
    const m = t.re.exec(key);
    if (!m) continue;
    // Put what fell in the holes back into the translated sentence, in the
    // order the translation asks for — a language that reorders a clause moves
    // its {1} in front of its {0}, and that has to keep working.
    const out = t.to.replace(/\{(\d+)\}/g, (whole, i) => {
      const v = m[Number(i) + 1];
      return v == null ? whole : v;
    });
    return s.replace(key, out);
  }
  return s;
}

/**
 * ONE PHRASE, TRANSLATED IN CODE — for the few places that BUILD a label out of
 * two phrases the dictionary already holds.
 *
 * The surface picker reads `label + ' — ' + hint`, and what lands in the DOM is
 * "Ledger book — Ruled cream leaves, red margin": one text node that is neither
 * phrase, so neither is found, and a fully translated app kept three English
 * options in its Appearance list. Extracting it as a template does not help
 * either — `'{0} — {1}'` has no words in it to translate and would match half
 * the page if it did.
 *
 * So the two halves are translated BEFORE they are joined. This is the escape
 * hatch, not the mechanism: everywhere else the DOM pass is what runs, because
 * threading a t() through four hundred call sites is the thing this design
 * exists to avoid. Reach for it only where a label is assembled from parts that
 * are separately in the catalogue.
 */
export function t(phrase) {
  return translatePhrase(String(phrase == null ? '' : phrase));
}

function translateNode(node) {
  if (!pack) return;
  if (node.nodeType === 3) { // text
    const t = translatePhrase(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== 1) return; // elements only past here
  if (node.hasAttribute) {
    ['placeholder', 'title', 'aria-label'].forEach((a) => {
      if (node.hasAttribute(a)) {
        const v = node.getAttribute(a);
        const t = translatePhrase(v);
        if (t !== v) node.setAttribute(a, t);
      }
    });
  }
  node.childNodes.forEach(translateNode);
}

let observer = null;

/**
 * Translate the document and keep translating anything rendered later.
 *
 * AWAITED BEFORE THE FIRST PAINT (`main()` does this before it loads anything
 * else), because the pack now arrives over the network: starting the render
 * first would show a page of English that rewrote itself a moment later, which
 * is worse than the wait. The pack is a few tens of kilobytes from the same
 * origin, and after the first visit it is in the service worker's cache.
 */
export async function applyLang() {
  await loadPack();
  if (!pack) return;
  translateNode(document.body);
  if (!observer) {
    observer = new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes && m.addedNodes.forEach((n) => translateNode(n)));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
