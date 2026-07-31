/**
 * Full-reset tests. The reset clears operational data but must PRESERVE the
 * reference defaults (Master Item Index + Holds) and admin accounts.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, resetAllData } from '../src/db.js';

let env;
beforeAll(async () => { env = { DB: makeD1() }; await ensureSchema(env); });

beforeEach(async () => {
  for (const t of ['users', 'companies', 'inventory', 'sales', 'master_item', 'hold_index', 'sys_flags', 'audit']) {
    await env.DB.prepare('DELETE FROM ' + t).run();
  }
  // Reference defaults that must survive a reset.
  await env.DB.prepare("INSERT INTO master_item (name, base_value) VALUES ('Iron Sword', 30)").run();
  await env.DB.prepare("INSERT INTO master_item (name, base_value) VALUES ('Health Potion', 5)").run();
  await env.DB.prepare("INSERT INTO hold_index (name) VALUES ('Whiterun')").run();
  // Operational data that must be cleared.
  await env.DB.prepare("INSERT INTO users (uid, email, business, role, is_owner, status) VALUES ('a1','admin@x','','admin',0,'active')").run();
  await env.DB.prepare("INSERT INTO users (uid, email, business, role, is_owner, status) VALUES ('o1','owner@x','Shop','owner',1,'active')").run();
  await env.DB.prepare("INSERT INTO companies (id, business, status) VALUES ('b1','Shop','')").run();
  await env.DB.prepare("INSERT INTO inventory (business, item, price, stock, low_stock) VALUES ('Shop','Iron Sword',30,5,1)").run();
  await env.DB.prepare("INSERT INTO sales (business, ts, order_no, total) VALUES ('Shop','2026-01-01','A1',30)").run();
});

async function count(t) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + t).first()).n;
}

describe('resetAllData', () => {
  it('preserves the item + hold indexes (reference defaults)', async () => {
    const res = await resetAllData(env);
    expect(await count('master_item')).toBe(2);
    expect(await count('hold_index')).toBe(1);
    expect(res.itemsKept).toBe(2);
    expect(res.holdsKept).toBe(1);
  });

  it('clears operational data and non-admin members', async () => {
    const res = await resetAllData(env);
    expect(await count('companies')).toBe(0);
    expect(await count('inventory')).toBe(0);
    expect(await count('sales')).toBe(0);
    expect(await count('users')).toBe(1); // only the admin remains
    expect(res.adminsKept).toBe(1);
  });
});
