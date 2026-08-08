/**
 * Schema rebuild — the migration that carries a pre-realm database forward.
 *
 * The tables below were created with GLOBAL uniqueness (master_item keyed on
 * name alone, inventory on business+item, …). SQLite cannot drop a PRIMARY KEY,
 * so ensureSchema rebuilds them. This test builds the genuine old schema and
 * proves the rebuild fires and preserves the rows.
 *
 * The regression it guards: the rebuild used to be skipped because the check
 * asked whether the table SQL mentioned realm_id, and the ADD COLUMN migration
 * that runs first had already put it there. The constraint stayed global, and
 * importing an item that another realm already had failed with
 * "UNIQUE constraint failed: master_item.name".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, resetSchemaCache, DEFAULT_REALM_ID } from '../src/db.js';
import { importItemIndex, listItemIndex } from '../src/item-index.js';
import { upsertItem as upsertInvItem, listInventory } from '../src/inventory.js';

const OTHER = 'rlm-other';
let env;

/** The schema exactly as it existed before realms. */
function seedLegacySchema(db) {
  db.exec(`CREATE TABLE master_item (name TEXT PRIMARY KEY, base_value REAL NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE inventory (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     business TEXT NOT NULL, item TEXT NOT NULL,
     price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
     low_stock INTEGER NOT NULL DEFAULT 0,
     UNIQUE (business, item))`);
  db.exec(`CREATE TABLE master_settings (label TEXT PRIMARY KEY, value REAL)`);
  db.exec(`CREATE TABLE shop_style (business TEXT PRIMARY KEY, tagline TEXT, accent TEXT)`);
  db.exec(`CREATE TABLE discounts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     business TEXT NOT NULL, name TEXT NOT NULL, percent REAL NOT NULL DEFAULT 0,
     UNIQUE (business, name))`);
  db.exec(`CREATE TABLE business_settings (
     business TEXT NOT NULL, label TEXT NOT NULL, value REAL,
     PRIMARY KEY (business, label))`);
  // Pre-existing rows that must survive the rebuild.
  db.exec(`INSERT INTO master_item (name, base_value) VALUES ('Iron Sword', 30)`);
  db.exec(`INSERT INTO inventory (business, item, price, stock, low_stock) VALUES ('Alpha', 'Iron Sword', 30, 5, 1)`);
  db.exec(`INSERT INTO master_settings (label, value) VALUES ('Overpricing threshold (x item average)', 2)`);
}

beforeEach(async () => {
  const d1 = makeD1();
  seedLegacySchema(d1._db);
  env = { DB: d1, ADMIN_EMAILS: '' };
  resetSchemaCache();
  await ensureSchema(env);
});

describe('pre-realm database upgrade', () => {
  it('rebuilds the globally-keyed tables so uniqueness is per realm', async () => {
    const sql = async (t) => (await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(t).first()).sql;
    for (const t of ['master_item', 'inventory', 'master_settings', 'shop_style', 'discounts', 'business_settings']) {
      expect(sql(t), t).toBeDefined();
      expect(await sql(t), t + ' should be keyed on realm_id').toMatch(/(PRIMARY KEY|UNIQUE)\s*\(\s*realm_id/i);
    }
  });

  it('keeps the existing rows, in the default realm', async () => {
    // Rows that predate the type split land in Unsorted — the whole point of
    // that table. The rebuild must fill it from the column DEFAULT, not from
    // the realm id it substitutes for a missing realm_id.
    expect(await listItemIndex(env, DEFAULT_REALM_ID)).toMatchObject([{ name: 'Iron Sword', baseValue: 30, category: 'Unsorted' }]);
    const inv = await listInventory(env, 'Alpha', DEFAULT_REALM_ID);
    expect(inv).toHaveLength(1);
    expect(inv[0].stock).toBe(5);
  });

  it('lets a second realm import an item the first realm already has', async () => {
    // This is the reported failure: it threw
    // "UNIQUE constraint failed: master_item.name".
    const res = await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 99 }], OTHER);
    expect(res.imported).toBe(1);
    expect(await listItemIndex(env, OTHER)).toMatchObject([{ name: 'Iron Sword', baseValue: 99, category: 'Unsorted' }]);
    // The original realm's value is untouched.
    expect(await listItemIndex(env, DEFAULT_REALM_ID)).toMatchObject([{ name: 'Iron Sword', baseValue: 30, category: 'Unsorted' }]);
  });

  it('lets two realms stock the same item in a same-named shop', async () => {
    await upsertInvItem(env, 'Alpha', { item: 'Iron Sword', price: 999, lowStock: 0 }, OTHER);
    expect((await listInventory(env, 'Alpha', DEFAULT_REALM_ID))[0].price).toBe(30);
    expect((await listInventory(env, 'Alpha', OTHER))[0].price).toBe(999);
  });
});
