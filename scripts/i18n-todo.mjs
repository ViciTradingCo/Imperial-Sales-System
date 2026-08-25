#!/usr/bin/env node
/**
 * WHAT IS LEFT TO TRANSLATE — `node scripts/i18n-todo.mjs fr [count]`.
 *
 * `i18n:check` says how much a pack owes; this hands over the actual strings,
 * as a JSON skeleton ready to fill in and feed back through `i18n-merge.mjs`.
 * Shortest first, because the short ones are the interface's furniture — the
 * nav, the buttons, the column headings — and getting them done first is what
 * makes a half-finished pack feel like progress rather than a patchwork.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'lib', 'i18n');

const [lang, count] = process.argv.slice(2);
if (!lang) { console.error('usage: i18n-todo.mjs <es|fr|de|it> [count]'); process.exit(2); }

const catalogue = JSON.parse(readFileSync(join(DIR, 'strings.json'), 'utf8')).filter((r) => !r.ambiguous);
const file = join(DIR, `${lang}.js`);
const pack = existsSync(file) ? (await import(pathToFileURL(file).href)).default || {} : {};

const missing = catalogue.filter((r) => !pack[r.en]).sort((a, b) => a.en.length - b.en.length);
const take = missing.slice(0, Number(count) || 100);
const out = {};
for (const r of take) out[r.en] = '';
console.log(JSON.stringify(out, null, 1));
console.error(`${missing.length} left for ${lang}; showing ${take.length}`);
