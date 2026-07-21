/**
 * A tiny D1-compatible adapter over Node's built-in SQLite, so the D1-backed
 * logic can be exercised in plain Vitest without Miniflare. Implements just the
 * slice of the D1 API the worker uses: prepare().bind().all()/first()/run() and
 * db.batch().
 */
import { DatabaseSync } from 'node:sqlite';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  const wrap = (sql) => {
    let params = [];
    const self = {
      bind(...args) { params = args.map((v) => (v === undefined ? null : v)); return self; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
      async first() { const r = db.prepare(sql).get(...params); return r === undefined ? null : r; },
      async run() { return db.prepare(sql).run(...params); },
    };
    return self;
  };
  return {
    prepare: wrap,
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}
