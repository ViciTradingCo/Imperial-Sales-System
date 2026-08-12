/**
 * The plaintext stocktake — `Name, Amount`.
 *
 * The shape is the point. A bulk import over this shop's inventory was shelved
 * once already (archive/inventory-import/) because a paste into it could
 * rewrite every PRICE a shop charged. This one carries counts and nothing else,
 * so the rules worth pinning down are all about what it must REFUSE to do:
 * invent items, zero what the paste never mentioned, or touch a price.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { planStockImport, stockText, importStockText, listInventory, upsertItem } from '../src/inventory.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'Iron Hearth';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await upsertItem(env, SHOP, { item: 'Iron Sword', price: 25 }, R);
  await upsertItem(env, SHOP, { item: 'Health Potion', price: 5 }, R);
  await env.DB.prepare('UPDATE inventory SET stock = 4 WHERE item = ?').bind('Iron Sword').run();
  await env.DB.prepare('UPDATE inventory SET stock = 9 WHERE item = ?').bind('Health Potion').run();
});

const inv = () => listInventory(env, SHOP, R);
const stockOf = async (name) => (await inv()).find((i) => i.item === name).stock;

describe('exporting', () => {
  it('writes one Name, Amount line per item', async () => {
    expect(await stockText(env, SHOP, R)).toBe('Health Potion, 9\nIron Sword, 4');
  });

  it('round-trips: its own output changes nothing', async () => {
    const res = await importStockText(env, SHOP, await stockText(env, SHOP, R), R);
    expect(res.changes).toEqual([]);
    expect(res.unchanged).toHaveLength(2);
  });
});

describe('reading a paste', () => {
  const plan = async (text) => planStockImport(text, await inv());

  it('sets a count and says what it was', async () => {
    expect((await plan('Iron Sword, 12')).changes).toEqual([{ item: 'Iron Sword', was: 4, now: 12, delta: 8 }]);
  });

  it('matches an item however it is capitalised', async () => {
    expect((await plan('iron SWORD, 7')).changes[0].item).toBe('Iron Sword');
  });

  it('takes a tab or spaces as well as a comma', async () => {
    expect((await plan('Iron Sword\t7')).changes[0].now).toBe(7);
    expect((await plan('Iron Sword 7')).changes[0].now).toBe(7);
  });

  it('reads the LAST number, so a name with a comma in it survives', async () => {
    await upsertItem(env, SHOP, { item: 'Sword, Ceremonial', price: 90 }, R);
    expect((await plan('Sword, Ceremonial, 3')).changes[0].item).toBe('Sword, Ceremonial');
  });

  it('skips the header its own export would produce', async () => {
    expect((await plan('Item, Amount\nIron Sword, 2')).invalid).toEqual([]);
  });

  it('reports a line with no amount rather than dropping it silently', async () => {
    const p = await plan('Iron Sword');
    expect(p.invalid).toHaveLength(1);
    expect(p.changes).toEqual([]);
  });

  it('refuses a negative amount', async () => {
    expect((await plan('Iron Sword, -3')).invalid[0].why).toMatch(/negative/);
  });

  it('floors a fractional count — stock is whole things', async () => {
    expect((await plan('Iron Sword, 7.9')).changes[0].now).toBe(7);
  });

  it('REPORTS an item the shop does not stock instead of inventing it', async () => {
    const p = await plan('Dwarven Helm, 3');
    expect(p.unknown).toEqual([{ item: 'Dwarven Helm', stock: 3 }]);
    expect(p.changes).toEqual([]);
  });

  it('counts what the paste never mentioned, and leaves it alone', async () => {
    expect((await plan('Iron Sword, 1')).untouched).toBe(1);
  });

  it('flags an item listed twice, and lets the last line win', async () => {
    const p = await plan('Iron Sword, 1\nIron Sword, 6');
    expect(p.invalid[0].why).toMatch(/more than once/);
    expect(p.changes).toEqual([{ item: 'Iron Sword', was: 4, now: 6, delta: 2 }]);
  });
});

describe('applying it', () => {
  it('writes the counts it planned', async () => {
    const res = await importStockText(env, SHOP, 'Iron Sword, 12\nHealth Potion, 0', R);
    expect(res.applied).toBe(2);
    expect(await stockOf('Iron Sword')).toBe(12);
    expect(await stockOf('Health Potion')).toBe(0);
  });

  it('NEVER touches a price — that is the whole reason this shape exists', async () => {
    await importStockText(env, SHOP, 'Iron Sword, 99', R);
    expect((await inv()).find((i) => i.item === 'Iron Sword').price).toBe(25);
  });

  it('leaves an item the paste did not mention exactly as it was', async () => {
    await importStockText(env, SHOP, 'Iron Sword, 1', R);
    expect(await stockOf('Health Potion')).toBe(9);
  });

  it('applies exactly what the preview promised', async () => {
    const text = 'Iron Sword, 12\nDwarven Helm, 3\nrubbish line';
    const preview = planStockImport(text, await inv());
    const applied = await importStockText(env, SHOP, text, R);
    expect(applied.changes).toEqual(preview.changes);
    expect(applied.unknown).toEqual(preview.unknown);
    expect(applied.invalid).toEqual(preview.invalid);
  });

  it('does nothing at all for a paste with nothing to do', async () => {
    const res = await importStockText(env, SHOP, 'Dwarven Helm, 3', R);
    expect(res.applied).toBe(0);
    expect(await stockOf('Iron Sword')).toBe(4);
  });

  it('cannot reach another realm’s shop of the same name', async () => {
    await env.DB.prepare('UPDATE inventory SET realm_id = ?').bind('rlm-other').run();
    const res = await importStockText(env, SHOP, 'Iron Sword, 99', R);
    expect(res.applied).toBe(0);
    const row = await env.DB.prepare('SELECT stock FROM inventory WHERE item = ?').bind('Iron Sword').first();
    expect(row.stock).toBe(4);
  });
});
