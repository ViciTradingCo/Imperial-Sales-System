#!/usr/bin/env node
/**
 * WHAT EACH LANGUAGE STILL OWES — `npm run i18n:check`.
 *
 * The dictionary falls through to English for anything it does not hold, and
 * nothing fails when it does. That is the right behaviour at runtime — a blank
 * page is worse than an English one — but it means a language can be offered
 * while translating a tenth of what is on screen, and nobody finds out. This is
 * the thing that finds out.
 *
 * It reports in both directions:
 *   MISSING — the app renders it, no pack has it. The reader sees English.
 *   STALE   — a pack has it, the app no longer renders it. Dead weight in a
 *             chunk somebody downloads.
 *
 * And it checks the HOLES, which is the failure that would actually corrupt a
 * sentence: `'Close {0}'` translated as `'Cerrar'` silently drops the shop's
 * name, and `'{1} de {0}'` is fine but `'{2} de {0}'` reaches for a value that
 * was never captured. Both are errors here, not warnings.
 *
 * Exit code is 1 when anything is wrong, so it can gate a release. Run
 * `npm run i18n:extract` first if the catalogue is stale.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'lib', 'i18n');
const LANGS = ['es', 'fr', 'de', 'it'];

/**
 * The languages `i18n.js` currently claims are finished.
 *
 * Read out of the source rather than imported, because importing the module
 * would drag `localStorage` and `navigator` into a build script. A language
 * listed there and not actually complete is the one failure this whole file
 * exists to prevent, so it is checked rather than trusted.
 */
const READY = new Set((readFileSync(join(ROOT, 'src', 'lib', 'i18n.js'), 'utf8')
  .match(/const READY = \[([^\]]*)\]/) || [, ''])[1]
  .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean));

const strings = JSON.parse(readFileSync(join(DIR, 'strings.json'), 'utf8'));
/** Ambiguous rows are deliberately left in English — see the extractor. */
const wanted = strings.filter((r) => !r.ambiguous);
const known = new Set(strings.map((r) => r.en));
const holesOf = (s) => new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]));

let bad = 0;
const complete = new Set();
const verbose = process.argv.includes('--verbose');

/**
 * A PLAIN STRING A TEMPLATE WOULD SWALLOW.
 *
 * The runtime tries exact matches first and only then templates, so a plain
 * string is safe as long as it HAS a translation. When it does not, it falls
 * through — and `'Close the Shop'` met `'Close {0}'`, came back as
 * "Fermer the Shop", and looked for all the world like a broken translation
 * rather than a missing one.
 *
 * So a collision is only a problem while the plain string is untranslated, and
 * that is exactly what is reported: fill it in and the shadow is gone. Listing
 * them separately matters because the symptom — a half-French sentence — points
 * at the template, and the fault is in the row that is not there.
 */
const compile = (en) => new RegExp('^' + en.split(/\{\d+\}/)
  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$');
const templates = wanted.filter((r) => r.holes > 0).map((r) => ({ en: r.en, re: compile(r.en) }));
const plains = wanted.filter((r) => r.holes === 0);
function shadowed(pack) {
  const out = [];
  for (const p of plains) {
    if (pack[p.en]) continue;                       // translated: exact match wins
    const t = templates.find((x) => x.re.test(p.en));
    if (t) out.push({ en: p.en, by: t.en });
  }
  return out;
}

for (const lang of LANGS) {
  const file = join(DIR, `${lang}.js`);
  if (!existsSync(file)) { console.log(`${lang}: no pack`); bad = 1; continue; }
  const pack = (await import(pathToFileURL(file).href)).default || {};

  const missing = wanted.filter((r) => !pack[r.en]);
  const stale = Object.keys(pack).filter((en) => !known.has(en));
  const holeErrors = [];
  for (const en of Object.keys(pack)) {
    const want = holesOf(en);
    const got = holesOf(pack[en]);
    // Every hole the English has must survive, and none may be invented — a
    // hole with no capture behind it renders as the literal "{2}".
    const lost = [...want].filter((h) => !got.has(h));
    const extra = [...got].filter((h) => !want.has(h));
    if (lost.length || extra.length) holeErrors.push({ en, lost, extra });
  }

  const shadows = shadowed(pack);
  const pct = Math.round(((wanted.length - missing.length) / wanted.length) * 100);
  const flag = missing.length || stale.length || holeErrors.length ? '✗' : '✓';
  console.log(`${flag} ${lang}  ${pct}% — ${wanted.length - missing.length}/${wanted.length} translated` +
    (stale.length ? `, ${stale.length} stale` : '') +
    (shadows.length ? `, ${shadows.length} shadowed by a template` : '') +
    (holeErrors.length ? `, ${holeErrors.length} placeholder error(s)` : ''));

  if (shadows.length) {
    bad = 1;
    for (const sh of shadows.slice(0, 8)) {
      console.log(`    shadowed: ${JSON.stringify(sh.en.slice(0, 50))} would be eaten by ${JSON.stringify(sh.by)}`);
    }
    if (shadows.length > 8) console.log(`    …and ${shadows.length - 8} more`);
  }

  if (holeErrors.length) {
    bad = 1;
    for (const e of holeErrors.slice(0, 10)) {
      console.log(`    ${JSON.stringify(e.en.slice(0, 60))}` +
        (e.lost.length ? ` — lost {${e.lost.join('} {')}}` : '') +
        (e.extra.length ? ` — invented {${e.extra.join('} {')}}` : ''));
    }
  }
  if (stale.length) {
    bad = 1;
    for (const s of stale.slice(0, 10)) console.log(`    stale: ${JSON.stringify(s.slice(0, 60))}`);
  }
  if (missing.length) {
    if (verbose) for (const m of missing) console.log(`    missing: ${JSON.stringify(m.en)}`);
  } else if (!stale.length && !holeErrors.length && !shadows.length) {
    complete.add(lang);
  }
}

/**
 * The gate itself: what `READY` claims against what the packs actually hold.
 * A language may only be offered when it is finished, and one that has just
 * become finished should be offered — both directions are reported.
 */
for (const lang of LANGS) {
  const done = complete.has(lang);
  if (READY.has(lang) && !done) {
    console.log(`\n✗ ${lang} is listed in READY but is not complete — readers would see a half-translated page.`);
    bad = 1;
  }
  if (done && !READY.has(lang)) {
    console.log(`\n✓ ${lang} is COMPLETE — add it to READY in src/lib/i18n.js to offer it.`);
  }
}

if (bad) console.log('\nRun `npm run i18n:extract` if the catalogue is out of date.');
process.exit(bad);
