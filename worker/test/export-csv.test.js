/**
 * The owner's CSV export.
 *
 * A "full shop" export is the same three sections the single exports produce,
 * one after another — so what these pin down is that the three agree, that a
 * single export is unchanged from what anyone already points a spreadsheet at,
 * and that data stored as data comes out readable.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { businessCsv } from '../src/export.js';
import { encodeSaleItems } from '../src/sales.js';
import { upsertItem } from '../src/inventory.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, discount, status)
     VALUES (?, ?, '2026-08-01T10:00:00Z', 'S-1', 'Walk-in', 'Whiterun', ?, 2, 50, 'Tess', '', '')`)
    .bind(R, SHOP, encodeSaleItems([{ name: 'Iron Sword', qty: 2, price: 25 }])).run();
  await env.DB.prepare(
    `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, '2026-08-01T10:00:00Z', 'sale', 50, 'S-1')`)
    .bind(R, SHOP).run();
  await upsertItem(env, SHOP, { item: 'Iron Sword', price: 25, lowStock: 2 }, R);
});

const csvOf = async (type) => (await businessCsv(env, SHOP, type, R)).csv;

describe('one section at a time', () => {
  it('gives the sales log its header and rows, and nothing else', async () => {
    const csv = await csvOf('sales');
    expect(csv.split('\n')[0]).toBe('order_no,ts,customer,hold,items,qty_total,total,employee,discount,status');
    expect(csv).not.toMatch(/^#/m); // no section markers on a single export
    expect(csv).toContain('S-1');
  });

  it('renders sale lines readably rather than as the JSON they are stored as', async () => {
    expect(await csvOf('sales')).toContain('Iron Sword x2 @ 25');
  });

  it('gives the coffer', async () => {
    const csv = await csvOf('coffer');
    expect(csv.split('\n')[0]).toBe('ts,kind,amount,note');
    expect(csv).toContain('sale');
  });

  it('gives the inventory', async () => {
    const csv = await csvOf('inventory');
    expect(csv.split('\n')[0]).toBe('item,price,stock,low_stock,ingredient,avg_cost,harvest_pay');
    expect(csv).toContain('Iron Sword');
  });

  it('falls back to the sales log for a type it does not know', async () => {
    expect(await csvOf('nonsense')).toBe(await csvOf('sales'));
  });
});

describe('the full shop export', () => {
  it('holds all three, each under its own heading', async () => {
    const csv = await csvOf('full');
    expect(csv).toContain('# SALES LOG');
    expect(csv).toContain('# COFFER');
    expect(csv).toContain('# INVENTORY');
  });

  it('says the same as the single exports — one definition, not four', async () => {
    const full = await csvOf('full');
    for (const type of ['sales', 'coffer', 'inventory']) {
      expect(full, type).toContain(await csvOf(type));
    }
  });

  it('keeps the sections in reading order, with a blank line between', async () => {
    const csv = await csvOf('full');
    expect(csv.indexOf('# SALES LOG')).toBeLessThan(csv.indexOf('# COFFER'));
    expect(csv.indexOf('# COFFER')).toBeLessThan(csv.indexOf('# INVENTORY'));
    expect(csv).toMatch(/\n\n# COFFER/);
  });

  it('is named for the shop and the day', async () => {
    const { filename } = await businessCsv(env, SHOP, 'full', R);
    expect(filename).toMatch(/^the-forge-everything-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('never reaches another realm’s shop of the same name', async () => {
    const csv = await businessCsv(env, SHOP, 'full', 'rlm-other');
    expect(csv.csv).not.toContain('S-1');
    expect(csv.csv).not.toContain('Iron Sword');
  });

  it('produces headings and no rows for a shop with nothing in it', async () => {
    const { csv } = await businessCsv(env, 'Empty Shop', 'full', R);
    expect(csv).toContain('# SALES LOG');
    expect(csv.split('\n').filter((l) => l && !l.startsWith('#'))).toHaveLength(3); // three header rows
  });
});

describe('csv safety', () => {
  it('quotes a value holding a comma so the columns survive', async () => {
    await upsertItem(env, SHOP, { item: 'Sword, Ceremonial', price: 90 }, R);
    expect(await csvOf('inventory')).toContain('"Sword, Ceremonial"');
  });
});
