/**
 * Route wiring. Importing a route module is enough to catch the mistake that
 * `node --check` cannot see: a routes[] entry naming a handler that was never
 * written. That ships as a green syntax check and then dies at deploy with
 * "X is not defined", so it is worth a test of its own.
 */
import { describe, it, expect } from 'vitest';
import { routes as authRoutes } from '../src/routes/auth.js';
import { routes as adminRoutes } from '../src/routes/admin.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { routes as courtRoutes } from '../src/routes/court.js';

const groups = { auth: authRoutes, admin: adminRoutes, business: businessRoutes, court: courtRoutes };
const all = Object.values(groups).flat();

describe('route wiring', () => {
  for (const [name, routes] of Object.entries(groups)) {
    it(`${name}: every route has a method, path, and callable handler`, () => {
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) {
        expect(['GET', 'POST'], `${r.path} method`).toContain(r.method);
        expect(r.path, 'path must start with /').toMatch(/^\//);
        expect(typeof r.handler, `${r.method} ${r.path} handler`).toBe('function');
      }
    });
  }

  it('has no duplicate method+path across modules', () => {
    const seen = new Set();
    const dupes = [];
    for (const r of all) {
      const key = r.method + ' ' + r.path;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  it('exposes the realm management surface', () => {
    const paths = all.map((r) => r.method + ' ' + r.path);
    expect(paths).toContain('GET /admin/realms');
    expect(paths).toContain('POST /admin/realms/create');
    expect(paths).toContain('POST /admin/realms/rename');
    expect(paths).toContain('POST /admin/realms/delete');
    expect(paths).toContain('GET /admin/realms/stats');
  });

  /**
   * A shop's books are the OWNER's to keep. The admin surface reads one
   * company's ledger and nothing more — if a write path for someone else's
   * coffer, discounts, or style ever appears under /admin/companies, that is a
   * decision to make deliberately, not to notice after it ships.
   */
  it('exposes only a read path into another company\'s ledger', () => {
    const paths = all.map((r) => r.method + ' ' + r.path);
    expect(paths).toContain('GET /admin/companies/ledger');
    const writes = all.filter((r) => r.method === 'POST' && /^\/admin\/companies\/(ledger|coffer|discounts|style)/.test(r.path));
    expect(writes.map((r) => r.path)).toEqual([]);
  });

  /**
   * A Court governs its region, so it does write — but only its OWN
   * instruments: the levy, its rulings, price controls, the notice, its dues
   * ledger and its treasury. It has no path that reaches into a shop's stock,
   * coffer or sales, which is what separates governing from helping yourself.
   *
   * Listed exactly, so a new Court write is a decision rather than a surprise.
   */
  it('lets a Court write only its own instruments', () => {
    const writes = all.filter((r) => r.method === 'POST' && r.path.startsWith('/court')).map((r) => r.path).sort();
    expect(writes).toEqual([
      '/court/dues/pay',
      '/court/prices',
      '/court/settings',
      '/court/spending',
      '/court/standing',
    ]);
  });
});
