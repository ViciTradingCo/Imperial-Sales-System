/**
 * The frontend's API client, checked against itself.
 *
 * `api.recordIntake(...)` on a client that has no `recordIntake` is not a syntax
 * error and not a route error — it is `undefined is not a function`, thrown at
 * the moment the user clicks, with nothing failing until then. That is exactly
 * how the intake form broke: a call site said `api.listBusinesses()` while the
 * client exported `getBusinesses`, so the modal threw before it could open and
 * the button simply did nothing.
 *
 * So: every `api.<name>(` anywhere in the frontend must exist on the client, and
 * every method the client exports must point at a route the Worker serves. Both
 * halves are cheap to check and neither can be caught by running the Worker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { routes as authRoutes } from '../src/routes/auth.js';
import { routes as adminRoutes } from '../src/routes/admin.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { routes as courtRoutes } from '../src/routes/court.js';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? jsFiles(p) : (name.endsWith('.js') ? [p] : []);
  });
}

const clientSource = readFileSync(join(SRC, 'lib', 'api.js'), 'utf8');

/** The method names on the exported `api` object literal. */
function clientMethods() {
  const body = clientSource.slice(clientSource.indexOf('export const api = {'));
  const names = new Set();
  for (const m of body.matchAll(/^ {2}([A-Za-z_]\w*)\s*:/gm)) names.add(m[1]);
  return names;
}

/** Every `api.<name>(` call in the frontend, with the file it appears in. */
function clientCalls() {
  const out = [];
  for (const file of jsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bapi\.([A-Za-z_]\w*)\s*\(/g)) {
      out.push({ name: m[1], file: file.slice(SRC.length + 1) });
    }
  }
  return out;
}

describe('frontend API client', () => {
  it('exports every method the frontend calls', () => {
    const have = clientMethods();
    expect(have.size).toBeGreaterThan(50); // the parse found the object, not nothing
    const missing = clientCalls()
      .filter((c) => !have.has(c.name))
      .map((c) => `${c.file}: api.${c.name}()`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('calls only paths the Worker actually routes', () => {
    const served = new Set([...authRoutes, ...adminRoutes, ...businessRoutes, ...courtRoutes].map((r) => r.path));
    served.add('/health');       // served by the router itself, not a route module
    const missing = [];
    // Paths are written as string or template literals in the client; take the
    // literal head, since anything after `?` or `${` is a query, not a route.
    for (const m of clientSource.matchAll(/request\('(?:GET|POST)',\s*['"`](\/[^'"`?]*)/g)) {
      const path = m[1].replace(/\$\{.*/, '');
      if (!served.has(path)) missing.push(path);
    }
    // auth.js calls the two session routes with its own fetch — it cannot use
    // the client, because the client imports it.
    const authSource = readFileSync(join(SRC, 'lib', 'auth.js'), 'utf8');
    for (const m of authSource.matchAll(/apiBase \+ '(\/[^']*)'/g)) {
      if (!served.has(m[1])) missing.push(m[1]);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
