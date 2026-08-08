/**
 * Items the register invents.
 *
 * A clerk sells something the index has never heard of. Refusing the sale is
 * the wrong trade-off — the goods left the shelf whatever the index thinks —
 * and the old behaviour, logging it and dropping it, quietly held whatever
 * nobody remembered to enter out of the realm's own figures forever.
 *
 * So it goes in, flagged, and an admin confirms or removes it. What has to hold:
 * the flag is real (it does not silently approve itself), the item TRADES
 * meanwhile, a second sale of the same name does not overwrite or duplicate it,
 * and the duplicate suggestions are useful enough to act on.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  notePendingItem, listPendingItems, approveItem, listItemIndex,
  importItemIndex, deleteItemIndex,
} from '../src/item-index.js';

let env;
const A = DEFAULT_REALM_ID;
const B = 'rlm-pending-b';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('meeting a new item', () => {
  it('adds it to the index, flagged, priced at what it sold for', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99, by: 'Ann', shop: 'Iron Hearth' }, A);
    const [it] = await listItemIndex(env, A);
    expect(it).toMatchObject({
      name: 'Mystery Trinket', baseValue: 99, pending: true,
      firstBy: 'Ann', firstShop: 'Iron Hearth',
    });
    expect(it.firstSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is a REAL index entry meanwhile — the sale happened', async () => {
    // The whole point of adding rather than logging: it must count. A flag that
    // excluded it from the index would reproduce the bug it exists to fix.
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99 }, A);
    expect(await listItemIndex(env, A)).toHaveLength(1);
  });

  it('files it under Unsorted, where an admin will look', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99 }, A);
    expect((await listItemIndex(env, A))[0].category).toBe('Unsorted');
  });

  it('a second sale of the same name neither duplicates nor overwrites', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99, by: 'Ann', shop: 'Iron Hearth' }, A);
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 5, by: 'Bex', shop: 'Rift Traders' }, A);
    const items = await listItemIndex(env, A);
    expect(items).toHaveLength(1);
    // First price, first finder and first till stand: the row records when the
    // realm first met this thing, not the most recent time.
    expect(items[0]).toMatchObject({ baseValue: 99, firstBy: 'Ann', firstShop: 'Iron Hearth' });
  });

  it('never disturbs an item already in the index', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A);
    await notePendingItem(env, { name: 'Iron Sword', baseValue: 1 }, A);
    const [it] = await listItemIndex(env, A);
    expect(it).toMatchObject({ baseValue: 30, pending: false });
  });

  it('ignores an empty name rather than filing a blank', async () => {
    expect(await notePendingItem(env, { name: '   ', baseValue: 5 }, A)).toBe(null);
    expect(await listItemIndex(env, A)).toHaveLength(0);
  });

  it('treats a missing price as zero rather than storing nonsense', async () => {
    await notePendingItem(env, { name: 'Odd Thing', baseValue: undefined }, A);
    expect((await listItemIndex(env, A))[0].baseValue).toBe(0);
  });
});

describe('the review queue', () => {
  it('carries the shop and the person to the review queue', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99, by: 'Ann', shop: 'Iron Hearth' }, A);
    expect((await listPendingItems(env, A))[0]).toMatchObject({ firstBy: 'Ann', firstShop: 'Iron Hearth' });
  });

  it('lists only what is still pending, oldest first', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A);
    await notePendingItem(env, { name: 'Aaa Thing', baseValue: 1 }, A);
    await env.DB.prepare("UPDATE master_item SET first_seen = '2020-01-01T00:00:00Z' WHERE name = 'Aaa Thing'").run();
    await notePendingItem(env, { name: 'Zzz Thing', baseValue: 1 }, A);
    const pending = await listPendingItems(env, A);
    expect(pending.map((p) => p.name)).toEqual(['Aaa Thing', 'Zzz Thing']);
  });

  it('approving clears the flag and leaves everything else alone', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99 }, A);
    await approveItem(env, 'Mystery Trinket', A);
    expect(await listPendingItems(env, A)).toEqual([]);
    expect((await listItemIndex(env, A))[0]).toMatchObject({ name: 'Mystery Trinket', baseValue: 99, pending: false });
  });

  it('approving matches the name however it is cased', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99 }, A);
    expect(await approveItem(env, 'mystery TRINKET', A)).toBe('Mystery Trinket');
    expect(await listPendingItems(env, A)).toEqual([]);
  });

  it('refuses to approve something that is not there', async () => {
    await expect(approveItem(env, 'Nothing At All', A)).rejects.toThrow(/not in the index/i);
    await expect(approveItem(env, '', A)).rejects.toThrow(/which item/i);
  });

  it('removing a pending item takes it out of the index entirely', async () => {
    // The other answer to the review: it was a duplicate, so it should not exist.
    await notePendingItem(env, { name: 'Iron Swrd', baseValue: 30 }, A);
    await deleteItemIndex(env, 'Iron Swrd', A);
    expect(await listPendingItems(env, A)).toEqual([]);
    expect(await listItemIndex(env, A)).toHaveLength(0);
  });
});

/**
 * The suggestions are the reason an admin can act on this quickly. They are a
 * WIDER net than the import matcher on purpose: that one decides automatically
 * and a false positive merges two real items, this one only offers a comparison
 * to a person who is about to look at both.
 */
describe('what it might be a duplicate of', () => {
  const seed = () => importItemIndex(env, [
    { name: 'Iron Sword', baseValue: 30 },
    { name: 'Steel Sword', baseValue: 60 },
    { name: 'Health Potion', baseValue: 5 },
  ], A);

  it('spots a typo of an existing item', async () => {
    await seed();
    await notePendingItem(env, { name: 'Iron Swrod', baseValue: 30 }, A);
    expect((await listPendingItems(env, A))[0].looksLike).toContain('Iron Sword');
  });

  it('spots a name sharing a significant word', async () => {
    await seed();
    await notePendingItem(env, { name: 'Iron Greatsword', baseValue: 80 }, A);
    const [p] = await listPendingItems(env, A);
    expect(p.looksLike).toContain('Iron Sword');
  });

  it('offers nothing for a genuinely unrelated item', async () => {
    await seed();
    await notePendingItem(env, { name: 'Mammoth Tusk', baseValue: 200 }, A);
    expect((await listPendingItems(env, A))[0].looksLike).toEqual([]);
  });

  it('never suggests another unreviewed item', async () => {
    // Two pending names pairing with each other would just double the work.
    await notePendingItem(env, { name: 'Iron Swrod', baseValue: 30 }, A);
    await notePendingItem(env, { name: 'Iron Swrd', baseValue: 30 }, A);
    const pending = await listPendingItems(env, A);
    expect(pending.every((p) => p.looksLike.length === 0)).toBe(true);
  });
});

describe('scope', () => {
  it('one realm cannot see or approve another realm\'s pending items', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99 }, B);
    expect(await listPendingItems(env, A)).toEqual([]);
    await expect(approveItem(env, 'Mystery Trinket', A)).rejects.toThrow(/not in the index/i);
    expect(await listPendingItems(env, B)).toHaveLength(1);
  });

  it('the same new item in two realms is two independent rows', async () => {
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 99 }, A);
    await notePendingItem(env, { name: 'Mystery Trinket', baseValue: 5 }, B);
    await approveItem(env, 'Mystery Trinket', A);
    expect(await listPendingItems(env, A)).toEqual([]);
    expect(await listPendingItems(env, B)).toHaveLength(1);
  });
});
