/**
 * The item index split into one table per TYPE.
 *
 * Three things have to hold: existing items keep their data (they become the
 * Unsorted table), the flag on an import line decides which table a row lands
 * in, and a realm's tables are its own — a type created in one realm must not
 * appear in another.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  listItemIndex, upsertItem, importItemIndex, analyzeItemImport, purgeItemIndex,
  listItemTypes, addItemType, updateItemType, deleteItemType, matchItemType, moveItems, UNSORTED,
} from '../src/item-index.js';

/** Type lists are records; most assertions only care about the names. */
const names = async (realm) => (await listItemTypes(env, realm)).map((t) => t.name);

let env;
const A = DEFAULT_REALM_ID;
const B = 'rlm-types-b';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('the Unsorted table', () => {
  it('exists in every realm without being created', async () => {
    expect(await names(A)).toEqual([UNSORTED]);
    expect(await names(B)).toEqual([UNSORTED]);
  });

  it('is where an item with no type flag goes', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A);
    expect((await listItemIndex(env, A))[0].category).toBe(UNSORTED);
  });

  it('cannot be renamed or removed — it is where deleted tables empty into', async () => {
    await expect(updateItemType(env, { name: UNSORTED, newName: 'Junk' }, A)).rejects.toThrow(/cannot be renamed/i);
    await expect(deleteItemType(env, UNSORTED, A)).rejects.toThrow(/cannot be removed/i);
  });
});

describe('sorting an import by its type flag', () => {
  it('files each row into the table its flag names', async () => {
    const res = await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30, type: 'Weapons' },
      { name: 'Health Potion', baseValue: 5, type: 'Potions' },
      { name: 'Odd Trinket', baseValue: 2 },
    ], A);
    expect(res.imported).toBe(3);
    const by = new Map((await listItemIndex(env, A)).map((i) => [i.name, i.category]));
    expect(by.get('Iron Sword')).toBe('Weapons');
    expect(by.get('Health Potion')).toBe('Potions');
    expect(by.get('Odd Trinket')).toBe(UNSORTED);
  });

  it('creates the tables the flags name, once each', async () => {
    const res = await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30, type: 'Weapons' },
      { name: 'Steel Dagger', baseValue: 20, type: 'weapons' },  // same table, cased differently
      { name: 'Iron Axe', baseValue: 25, type: 'Weapon' },       // and pluralised differently
    ], A);
    expect(res.typesAdded).toEqual(['Weapons']);
    expect(await names(A)).toEqual([UNSORTED, 'Weapons']);
    expect((await listItemIndex(env, A)).every((i) => i.category === 'Weapons')).toBe(true);
  });

  it('re-files an existing item when a later import flags it', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A);
    await importItemIndex(env, [{ name: 'iron sword', baseValue: 35, type: 'Weapons' }], A);
    const items = await listItemIndex(env, A);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ name: 'iron sword', baseValue: 35, category: 'Weapons' });
  });

  it('leaves an existing item where it is when the flag is omitted', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30, type: 'Weapons' }], A);
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 40 }], A);
    expect((await listItemIndex(env, A))[0]).toEqual({ name: 'Iron Sword', baseValue: 40, category: 'Weapons' });
  });

  it('reports the filing in the preview without applying it', async () => {
    await addItemType(env, 'Potions', A);
    const a = await analyzeItemImport(env, [
      { name: 'Iron Sword', baseValue: 30, type: 'Weapons' },
      { name: 'Health Potion', baseValue: 5, type: 'potion' },
    ], A);
    expect(a.create.map((c) => c.type)).toEqual(['Weapons', 'Potions']);
    expect(a.newTypes).toEqual(['Weapons']);
    expect(await listItemIndex(env, A)).toHaveLength(0);      // nothing written
    expect(await names(A)).toEqual([UNSORTED, 'Potions']);
  });
});

describe('managing the tables', () => {
  it('rejects a duplicate type however it is written', async () => {
    await addItemType(env, 'Weapons', A);
    await expect(addItemType(env, ' weapon ', A)).rejects.toThrow(/already exists/i);
  });

  it('carries a table\'s items with it on rename', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30, type: 'Weapons' }], A);
    await updateItemType(env, { name: 'Weapons', newName: 'Arms' }, A);
    expect(await names(A)).toEqual([UNSORTED, 'Arms']);
    expect((await listItemIndex(env, A))[0].category).toBe('Arms');
  });

  it('re-files, never deletes, when a table is removed', async () => {
    await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30, type: 'Weapons' },
      { name: 'Steel Dagger', baseValue: 20, type: 'Weapons' },
    ], A);
    const res = await deleteItemType(env, 'Weapons', A);
    expect(res.moved).toBe(2);
    expect(res.types.map((t) => t.name)).toEqual([UNSORTED]);
    const items = await listItemIndex(env, A);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.category === UNSORTED)).toBe(true);
  });

  it('files a hand-added item into the table it was added from', async () => {
    await addItemType(env, 'Potions', A);
    await upsertItem(env, { name: 'Health Potion', baseValue: 5, category: 'Potions' }, A);
    expect((await listItemIndex(env, A))[0].category).toBe('Potions');
  });

  it('falls back to Unsorted rather than inventing a table on a hand edit', async () => {
    await upsertItem(env, { name: 'Mystery Box', baseValue: 1, category: 'Nonexistent' }, A);
    expect((await listItemIndex(env, A))[0].category).toBe(UNSORTED);
    expect(await names(A)).toEqual([UNSORTED]);
  });

  it('matches a flag to an existing type loosely, and nothing else', () => {
    const types = [UNSORTED, 'Weapons', 'Alchemy Ingredients'];
    expect(matchItemType('weapon', types)).toBe('Weapons');
    expect(matchItemType('  WEAPONS  ', types)).toBe('Weapons');
    expect(matchItemType('alchemy-ingredient', types)).toBe('Alchemy Ingredients');
    expect(matchItemType('Armour', types)).toBeNull();
    expect(matchItemType('', types)).toBeNull();
  });
});

describe('sorting flags on a table', () => {
  it('files an import by a flag as well as by the table name', async () => {
    await addItemType(env, 'Weapons', A, 'wep, 1H, blade');
    await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30, type: 'wep' },
      { name: 'Steel Dagger', baseValue: 20, type: 'BLADES' },  // plural + case
      { name: 'Iron Axe', baseValue: 25, type: 'Weapons' },     // the name still works
    ], A);
    expect((await listItemIndex(env, A)).every((i) => i.category === 'Weapons')).toBe(true);
    expect(await names(A)).toEqual([UNSORTED, 'Weapons']); // no stray tables created
  });

  it('accepts a comma string or an array, de-duplicating either', async () => {
    await addItemType(env, 'Potions', A, ' elixir , elixirs ,, potion ');
    const [, potions] = await listItemTypes(env, A);
    expect(potions.flags).toEqual(['elixir', 'potion']);
    await updateItemType(env, { name: 'Potions', flags: ['draught'] }, A);
    expect((await listItemTypes(env, A))[1].flags).toEqual(['draught']);
  });

  it('lets the default table carry flags even though it cannot be renamed', async () => {
    await updateItemType(env, { name: UNSORTED, flags: 'misc, junk' }, A);
    await importItemIndex(env, [{ name: 'Odd Trinket', baseValue: 2, type: 'junk' }], A);
    expect((await listItemIndex(env, A))[0].category).toBe(UNSORTED);
    expect(await names(A)).toEqual([UNSORTED]);
  });

  it('keeps a table\'s flags when it is renamed', async () => {
    await addItemType(env, 'Weapons', A, 'wep');
    await updateItemType(env, { name: 'Weapons', newName: 'Arms' }, A);
    expect((await listItemTypes(env, A))[1]).toEqual({ name: 'Arms', flags: ['wep'] });
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30, type: 'wep' }], A);
    expect((await listItemIndex(env, A))[0].category).toBe('Arms');
  });

  it('gives a table\'s own name precedence over another table\'s flag', async () => {
    await addItemType(env, 'Relics', A, 'gems');   // claims "gems" as a flag first
    await addItemType(env, 'Gems', A);
    await importItemIndex(env, [{ name: 'Ruby', baseValue: 50, type: 'Gems' }], A);
    expect((await listItemIndex(env, A))[0].category).toBe('Gems');
  });

  it('drops a flag the new table\'s name has just shadowed', async () => {
    await addItemType(env, 'Relics', A, 'gems, curios');
    await addItemType(env, 'Gems', A);
    // "gems" could never fire again, so it isn't left on screen pretending to.
    const relics = (await listItemTypes(env, A)).find((t) => t.name === 'Relics');
    expect(relics.flags).toEqual(['curios']);
  });

  it('drops a shadowed flag on rename too', async () => {
    await addItemType(env, 'Relics', A, 'arms');
    await addItemType(env, 'Weapons', A);
    await updateItemType(env, { name: 'Weapons', newName: 'Arms' }, A);
    expect((await listItemTypes(env, A)).find((t) => t.name === 'Relics').flags).toEqual([]);
  });

  it('still refuses a table named the same as an existing table', async () => {
    await addItemType(env, 'Weapons', A);
    await expect(addItemType(env, ' weapon ', A)).rejects.toThrow(/already exists/i);
  });

  it('keeps flags per realm', async () => {
    await addItemType(env, 'Weapons', A, 'wep');
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30, type: 'wep' }], B);
    // B has no such flag, so "wep" builds B its own table and A is untouched.
    expect(await names(B)).toEqual([UNSORTED, 'wep']);
    expect(await names(A)).toEqual([UNSORTED, 'Weapons']);
    expect(await listItemIndex(env, A)).toHaveLength(0);
  });
});

describe('importing into one table', () => {
  it('puts unflagged rows in that table instead of Unsorted', async () => {
    await addItemType(env, 'Weapons', A);
    await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30 },
      { name: 'Health Potion', baseValue: 5, type: 'Potions' },  // an explicit flag still wins
    ], A, 'Weapons');
    const by = new Map((await listItemIndex(env, A)).map((i) => [i.name, i.category]));
    expect(by.get('Iron Sword')).toBe('Weapons');
    expect(by.get('Health Potion')).toBe('Potions');
  });

  it('moves an item already filed elsewhere into the table being imported into', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30, type: 'Relics' }], A);
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A, 'Relics');
    expect((await listItemIndex(env, A))[0].category).toBe('Relics');
  });

  it('previews the same destinations the import will use', async () => {
    await addItemType(env, 'Weapons', A);
    const a = await analyzeItemImport(env, [{ name: 'Iron Sword', baseValue: 30 }], A, 'Weapons');
    expect(a.create[0].type).toBe('Weapons');
  });

  it('falls back to Unsorted when the named table does not exist', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A, 'Nonexistent');
    expect((await listItemIndex(env, A))[0].category).toBe(UNSORTED);
    expect(await names(A)).toEqual([UNSORTED]);
  });
});

describe('moving a selection between tables', () => {
  beforeEach(async () => {
    await addItemType(env, 'Weapons', A);
    await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30 },
      { name: 'Steel Dagger', baseValue: 20 },
      { name: 'Health Potion', baseValue: 5 },
    ], A);
  });

  it('re-files only the items named', async () => {
    const res = await moveItems(env, ['Iron Sword', 'Steel Dagger'], 'Weapons', A);
    expect(res.moved).toBe(2);
    expect(res.category).toBe('Weapons');
    const by = new Map(res.items.map((i) => [i.name, i.category]));
    expect(by.get('Iron Sword')).toBe('Weapons');
    expect(by.get('Steel Dagger')).toBe('Weapons');
    expect(by.get('Health Potion')).toBe(UNSORTED);
  });

  it('accepts a flag or loose spelling as the destination', async () => {
    await updateItemType(env, { name: 'Weapons', flags: 'wep' }, A);
    await moveItems(env, ['iron sword'], 'wep', A);
    expect((await listItemIndex(env, A)).find((i) => i.name === 'Iron Sword').category).toBe('Weapons');
  });

  it('refuses an unknown destination instead of dumping into Unsorted', async () => {
    await expect(moveItems(env, ['Iron Sword'], 'Nonexistent', A)).rejects.toThrow(/No table called/i);
    expect((await listItemIndex(env, A)).every((i) => i.category === UNSORTED)).toBe(true);
  });

  it('refuses an empty selection', async () => {
    await expect(moveItems(env, [], 'Weapons', A)).rejects.toThrow(/at least one/i);
  });

  it('cannot reach another realm\'s item of the same name', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 99 }], B);
    await moveItems(env, ['Iron Sword'], 'Weapons', A);
    expect((await listItemIndex(env, B))[0].category).toBe(UNSORTED);
  });
});

describe('purging by table', () => {
  beforeEach(async () => {
    await importItemIndex(env, [
      { name: 'Iron Sword', baseValue: 30, type: 'Weapons' },
      { name: 'Health Potion', baseValue: 5, type: 'Potions' },
    ], A);
  });

  it('empties one table and leaves the others', async () => {
    const res = await purgeItemIndex(env, A, 'Weapons');
    expect(res.purged).toBe(1);
    expect(res.items.map((i) => i.name)).toEqual(['Health Potion']);
    // The table itself survives — it is structure, not contents.
    expect(await names(A)).toEqual([UNSORTED, 'Weapons', 'Potions']);
  });

  it('empties everything when no table is named', async () => {
    const res = await purgeItemIndex(env, A);
    expect(res.purged).toBe(2);
    expect(res.items).toEqual([]);
    expect(await names(A)).toEqual([UNSORTED, 'Weapons', 'Potions']);
  });
});

describe('realm isolation', () => {
  it('keeps one realm\'s tables and filing out of another\'s', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30, type: 'Weapons' }], A);
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 99, type: 'Relics' }], B);

    expect(await names(A)).toEqual([UNSORTED, 'Weapons']);
    expect(await names(B)).toEqual([UNSORTED, 'Relics']);
    expect(await listItemIndex(env, A)).toEqual([{ name: 'Iron Sword', baseValue: 30, category: 'Weapons' }]);
    expect(await listItemIndex(env, B)).toEqual([{ name: 'Iron Sword', baseValue: 99, category: 'Relics' }]);

    // Removing B's table must not touch A's identically named item.
    await deleteItemType(env, 'Relics', B);
    expect((await listItemIndex(env, A))[0].category).toBe('Weapons');
    expect((await listItemIndex(env, B))[0].category).toBe(UNSORTED);
  });

  it('purges only the calling realm', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], A);
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 99 }], B);
    await purgeItemIndex(env, A);
    expect(await listItemIndex(env, A)).toHaveLength(0);
    expect(await listItemIndex(env, B)).toHaveLength(1);
  });
});
