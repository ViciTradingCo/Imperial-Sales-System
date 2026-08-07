#!/usr/bin/env node
/**
 * The bloat audit — `npm run audit`.
 *
 * This started as a sweep pasted into a shell each time a batch shipped, which
 * meant it drifted, got skipped, and once missed a real bug (a call to an API
 * method that did not exist, because the sweep only checked route paths). It is
 * a committed script now so it runs the same way every time and can be improved
 * in one place.
 *
 * It reports, it does not fix. Every finding is something a person should look
 * at and decide about — "unused" often means "used somewhere this script cannot
 * see", and a long file is sometimes just a long file. So each finding carries a
 * SUGGESTION rather than a verdict, and nothing here fails a build.
 *
 * Findings are grouped:
 *   DEAD WEIGHT   — code that nothing reaches. Safe to delete, usually.
 *   DUPLICATION   — the same thing written more than once.
 *   SIZE          — files and functions big enough to be worth splitting.
 *   LEFTOVERS     — commented-out code, stale markers, unused dependencies.
 *
 * Exit code is always 0. This is a report for a human, not a gate.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const WORKER = join(ROOT, 'worker', 'src');
const TESTS = join(ROOT, 'worker', 'test');

/** A file long enough that finding anything in it is a scroll. */
const BIG_FILE_LINES = 700;
/** A function long enough to be doing more than one thing. */
const BIG_FN_LINES = 120;
/** How many times a string has to repeat before it wants to be a constant. */
const REPEAT_LITERAL = 4;

const findings = { dead: [], dup: [], size: [], left: [] };
const add = (group, file, what, suggestion) => findings[group].push({ file, what, suggestion });

/* ---------------------------------------------------------------- helpers */

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : jsFiles(p);
    return name.endsWith('.js') || name.endsWith('.mjs') ? [p] : [];
  });
}
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p);

/** Strips comments and string bodies, so matches are code and not prose. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const IMPORT_RE = /import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/gs;

/**
 * The names an import statement involves. `import { routes as authRoutes }`
 * binds `authRoutes` locally but consumes `routes` from the module — and the
 * two checks below want different halves. Conflating them made every aliased
 * export look like nothing imported it.
 */
function importedNames(match, which = 'local') {
  const group = match[1] || match[2] || '';
  return group.split(',').map((n) => {
    const [source, alias] = n.trim().split(/\s+as\s+/).map((s) => s.trim());
    return which === 'local' ? (alias || source) : source;
  }).filter(Boolean);
}

/* ------------------------------------------------------------ dead weight */

/** Imports bound but never mentioned again, and modules imported twice. */
function unusedImports(files) {
  for (const file of files) {
    const text = read(file);
    const body = text.replace(IMPORT_RE, '');
    const seen = new Map();
    for (const m of text.matchAll(IMPORT_RE)) {
      seen.set(m[3], (seen.get(m[3]) || 0) + 1);
      for (const name of importedNames(m)) {
        if (!new RegExp(`\\b${name}\\b`).test(body)) {
          add('dead', rel(file), `imports \`${name}\` and never uses it`,
            'Delete the binding. If the import is there for a side effect, use the bare `import "…"` form so that is obvious.');
        }
      }
    }
    for (const [mod, n] of seen) {
      if (n > 1) {
        add('dup', rel(file), `imports from \`${mod}\` ${n} times`,
          'Merge them into one import statement — two statements from one module drift apart.');
      }
    }
  }
}

/**
 * Exports nothing else imports.
 *
 * Two different findings share this shape. If the name is used inside its own
 * file it is merely over-exposed (drop the `export`); if it is used nowhere at
 * all it is dead and can go.
 */
function orphanExports(files, universe) {
  const imported = new Set();
  for (const file of universe) {
    // The SOURCE name, not the local alias — `routes as authRoutes` consumes
    // `routes`, and that is the export we are asking about.
    for (const m of read(file).matchAll(IMPORT_RE)) importedNames(m, 'source').forEach((n) => imported.add(n));
  }
  for (const file of files) {
    const text = read(file);
    const body = code(text);
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+))/g)) {
      const name = m[1] || m[2];
      if (imported.has(name)) continue;
      // Count uses outside its own declaration line.
      const uses = (body.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      if (uses <= 1) {
        add('dead', rel(file), `exports \`${name}\`, which nothing uses anywhere`,
          'Delete it. If it is a deliberate seam for future work, say so in a comment or it will read as an oversight.');
      } else {
        add('dead', rel(file), `exports \`${name}\`, used only inside this file`,
          'Drop the `export` keyword. A smaller public surface is one less thing to keep working.');
      }
    }
  }
}

/**
 * Functions declared and never called, inside their own file.
 *
 * The export check cannot see these — they were never exported — but they are
 * the same dead weight, and they appear for the same reason: the caller moved
 * to another module and the helper it used got left behind.
 */
function unusedLocals(files) {
  for (const file of files) {
    const text = read(file);
    const body = code(text);
    for (const m of text.matchAll(/^(?:\s*)(?:async\s+)?function\s+(\w+)/gm)) {
      const name = m[1];
      if (/^export/.test(text.slice(Math.max(0, m.index - 7), m.index + 7))) continue;
      const uses = (body.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      // One hit is the declaration itself.
      if (uses <= 1) {
        add('dead', rel(file), `declares \`${name}()\`, which nothing calls`,
          'Delete it. A helper whose caller moved away is the usual cause, and it will not be missed.');
      }
    }
  }
}

/** Frontend calls into the API client that the client does not define. */
function apiClientDrift() {
  const clientPath = join(SRC, 'lib', 'api.js');
  if (!existsSync(clientPath)) return;
  const client = read(clientPath);
  const have = new Set([...client.slice(client.indexOf('export const api = {'))
    .matchAll(/^ {2}([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]));
  for (const file of jsFiles(SRC)) {
    for (const m of read(file).matchAll(/\bapi\.([A-Za-z_]\w*)\s*\(/g)) {
      if (!have.has(m[1])) {
        add('dead', rel(file), `calls \`api.${m[1]}()\`, which the client does not export`,
          'This throws the moment the code runs. Check the name against src/lib/api.js.');
      }
    }
  }
}

/**
 * CSS classes defined in the stylesheet that nothing ever applies.
 *
 * The catch is class names BUILT at runtime — `'toast-' + kind` produces
 * toast-ok, toast-warn and toast-danger, none of which appear in the source as
 * a whole word. Reporting those as unused would be worse than useless: deleting
 * them silently breaks styling that works. So any `'prefix-' +` concatenation
 * in the JS marks every class starting with that prefix as spoken for.
 */
function unusedCss() {
  const cssPath = join(SRC, 'styles', 'theme.css');
  if (!existsSync(cssPath)) return;
  const css = read(cssPath);
  const used = jsFiles(SRC).map(read).join('\n') + read(join(ROOT, 'index.html'));
  // The leading \s* matters: the real-world shape is `' toast-' + kind`, with
  // the separating space inside the quotes.
  const prefixes = [...used.matchAll(/['"]\s*([a-z][a-z0-9]*-)['"]\s*\+/gi)].map((m) => m[1]);
  const defined = new Set([...css.matchAll(/\.([a-z][a-z0-9-]{2,})/gi)].map((m) => m[1]));
  const orphans = [...defined]
    .filter((c) => !used.includes(c) && !prefixes.some((p) => c.startsWith(p)))
    .sort();
  if (orphans.length) {
    add('dead', rel(cssPath), `${orphans.length} class(es) nothing references: ${orphans.slice(0, 12).join(', ')}${orphans.length > 12 ? ', …' : ''}`,
      'Delete the rules. Every one is bytes in the stylesheet and a wrong lead for the next person styling this.');
  }
}

/**
 * Translations for text the app no longer renders.
 *
 * i18n here matches rendered text against an English→target dictionary, so a key
 * whose English never appears in the source translates nothing — it just ships,
 * in every bundle, in five languages. They accumulate silently whenever a button
 * is renamed or a screen retired, because nothing ever fails.
 *
 * It under-reports rather than over-reports: a phrase mentioned anywhere in the
 * source counts as live, including in patch-note prose describing the screen
 * that was removed. That is the safe direction — a missed row costs bytes, a
 * wrongly-deleted one costs a translation.
 */
function staleTranslations() {
  const path = join(SRC, 'lib', 'i18n.js');
  if (!existsSync(path)) return;
  const dict = read(path);
  const body = dict.slice(dict.indexOf('const T = {'));
  const source = jsFiles(SRC).filter((f) => f !== path).map(read).join('\n');
  const stale = [];
  for (const m of body.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*\{/gm)) {
    const phrase = m[1].replace(/\\'/g, "'");
    // The dictionary quotes with ', the source may use either.
    if (!source.includes(phrase)) stale.push(phrase);
  }
  if (stale.length) {
    add('left', rel(path), `${stale.length} translation(s) for text nothing renders: ${stale.slice(0, 8).map((p) => `"${p}"`).join(', ')}${stale.length > 8 ? ', …' : ''}`,
      'Delete the rows. Check first that the phrase is not assembled at runtime — this only sees whole literals.');
  }
}

/** Dependencies declared but never imported. */
function unusedDeps() {
  for (const dir of [ROOT, join(ROOT, 'worker')]) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(read(pkgPath));
    const scripts = Object.values(pkg.scripts || {}).join(' ');
    const sources = jsFiles(join(dir, 'src')).concat(jsFiles(join(dir, 'scripts')))
      .concat(dir === ROOT ? [] : jsFiles(join(dir, 'test')))
      .map(read).join('\n');
    const config = ['vite.config.js', 'wrangler.toml'].map((f) => join(dir, f))
      .filter(existsSync).map(read).join('\n');
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const named = new RegExp(`['"]${dep.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}(/|['"])`);
      if (!named.test(sources) && !scripts.includes(dep.split('/').pop()) && !named.test(config)) {
        add('left', rel(pkgPath), `declares \`${dep}\`, which nothing imports or runs`,
          'Remove it from package.json — an unused dependency is install time, lockfile churn, and an advisory you have to read.');
      }
    }
  }
}

/* ------------------------------------------------------------- duplication */

/**
 * The same PROSE written out over and over — a label, a message, a hint.
 *
 * Deliberately narrow. Twelve files importing '../lib/format.js' is not
 * duplication, it is how modules work; a CSS class named in six files is not
 * drift-prone. What this is looking for is wording a person reads, because that
 * is what gets edited in one place and left stale in five others. So a candidate
 * has to look like a sentence: words and spaces, no operators, no path.
 */
function repeatedLiterals(files) {
  const counts = new Map();
  const prose = /^[A-Za-z][A-Za-z0-9 ,.'’!?—-]*[A-Za-z.!?]$/;
  for (const file of files) {
    // Import specifiers are not content.
    const text = read(file).replace(IMPORT_RE, '');
    for (const m of text.matchAll(/'((?:[^'\\\n]|\\.){12,80})'/g)) {
      const v = m[1];
      if (!v.includes(' ') || !prose.test(v)) continue;
      const at = counts.get(v) || new Set();
      at.add(rel(file));
      counts.set(v, at);
    }
  }
  for (const [text, where] of counts) {
    if (where.size >= REPEAT_LITERAL) {
      add('dup', [...where].sort()[0], `"${text.slice(0, 48)}${text.length > 48 ? '…' : ''}" appears in ${where.size} files`,
        'Hoist it to a shared constant. Copies of a user-facing string drift, and then two screens disagree.');
    }
  }
}

/* -------------------------------------------------------------------- size */

function bigFiles(files) {
  for (const file of files) {
    const lines = read(file).split('\n').length;
    if (lines > BIG_FILE_LINES) {
      add('size', rel(file), `${lines} lines`,
        'Look for a seam — a group of functions that only talk to each other — and lift it into its own module.');
    }
  }
}

/** Functions long enough that they are probably several functions. */
function bigFunctions(files) {
  for (const file of files) {
    const lines = read(file).split('\n');
    let name = null, start = 0, depth = 0;
    lines.forEach((line, i) => {
      if (!name) {
        const m = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (m) { name = m[1]; start = i; depth = 0; }
      }
      if (!name) return;
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0 && i > start) {
        const len = i - start + 1;
        if (len > BIG_FN_LINES) {
          add('size', `${rel(file)}:${start + 1}`, `\`${name}\` is ${len} lines`,
            'Pull the distinct steps out as named helpers — the names document what the middle of it is doing.');
        }
        name = null;
      }
    });
  }
}

/* --------------------------------------------------------------- leftovers */

/** Commented-out code, as opposed to prose. */
function commentedCode(files) {
  for (const file of files) {
    const lines = read(file).split('\n');
    let run = 0, at = 0;
    lines.forEach((line, i) => {
      const t = line.trim();
      const isCode = /^\/\/\s*(?:const |let |var |if \(|for \(|return |await |function |\w+\(|\}|\{)/.test(t);
      if (isCode) { if (!run) at = i; run++; return; }
      if (run >= 3) {
        add('left', `${rel(file)}:${at + 1}`, `${run} lines of commented-out code`,
          'Delete it. Git remembers; a commented block only raises the question of whether it still matters.');
      }
      run = 0;
    });
  }
}

/** Markers that were meant to be temporary. */
function staleMarkers(files) {
  for (const file of files) {
    read(file).split('\n').forEach((line, i) => {
      const m = line.match(/\b(TODO|FIXME|XXX|HACK)\b[:\s]*(.*)/);
      if (m) {
        add('left', `${rel(file)}:${i + 1}`, `${m[1]}: ${m[2].trim().slice(0, 60) || '(no note)'}`,
          'Do it, or write down why it is not being done. A marker with no owner is a decision nobody made.');
      }
    });
  }
}

/* ------------------------------------------------------------------ report */

const GROUPS = [
  ['dead', 'DEAD WEIGHT', 'Nothing reaches this code.'],
  ['dup', 'DUPLICATION', 'The same thing, written more than once.'],
  ['size', 'SIZE', 'Big enough to be worth splitting.'],
  ['left', 'LEFTOVERS', 'Things that were meant to be temporary.'],
];

function report() {
  const total = Object.values(findings).reduce((n, list) => n + list.length, 0);
  console.log('\n\x1b[1mBloat audit\x1b[0m — src/, worker/src/\n');
  if (!total) {
    console.log('  Nothing to report. Everything here is reachable, unduplicated, and roughly the right size.\n');
    return;
  }
  for (const [key, title, blurb] of GROUPS) {
    const list = findings[key];
    if (!list.length) continue;
    console.log(`\x1b[1m${title}\x1b[0m \x1b[2m(${list.length}) — ${blurb}\x1b[0m`);
    // Group by file so one file's problems read together.
    const byFile = new Map();
    for (const f of list) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [file, items] of [...byFile].sort()) {
      console.log(`\n  \x1b[36m${file}\x1b[0m`);
      for (const it of items) {
        console.log(`    · ${it.what}`);
        console.log(`      \x1b[2m→ ${it.suggestion}\x1b[0m`);
      }
    }
    console.log('');
  }
  console.log(`\x1b[1m${total} thing(s) to look at.\x1b[0m Nothing here is automatic — each one is a judgement call.\n`);
}

/* -------------------------------------------------------------------- main */

const front = jsFiles(SRC);
const back = jsFiles(WORKER);
const all = [...front, ...back];
const universe = [...all, ...jsFiles(TESTS)];

unusedImports(all);
orphanExports(front, [...front, ...jsFiles(join(ROOT, 'scripts'))]);
orphanExports(back, universe);
unusedLocals(all);
apiClientDrift();
unusedCss();
staleTranslations();
unusedDeps();
repeatedLiterals(all);
bigFiles(all);
bigFunctions(all);
commentedCode(all);
staleMarkers(all);
report();
