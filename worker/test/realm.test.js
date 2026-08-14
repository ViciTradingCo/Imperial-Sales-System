/**
 * Multi-realm isolation. Two realms are seeded with IDENTICAL business, member,
 * and item names — the worst case — and every read must return only the
 * caller's own realm. These tests are the guarantee that nothing is ever shared
 * or cross-referenced between servers.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { createRealm, listRealms, deleteRealm, realmStats, ensureDefaultRealm } from '../src/realm.js';
import { findUserByEmail, listAllUsers, listUsersByBusiness, findUserByUid, updateMember, deleteMember, transferMember } from '../src/users.js';
import { registerUser, listCompanies, findBusinessByName, listBusinessNames, findBusinessMeta, updateCompany, transferCompany } from '../src/registry.js';
import { listBundles, saveBundle } from '../src/bundles.js';
import { listInventory, upsertItem as upsertInvItem } from '../src/inventory.js';
import { recordIntake } from '../src/intake.js';
import { checkout, listSales } from '../src/sales.js';
import { cofferBalance } from '../src/coffers.js';
import { createTransfer, listTransfers, acceptTransfer } from '../src/transfers.js';
import { listItemIndex, upsertItem as upsertMasterItem } from '../src/item-index.js';
import { readRegions, writeRegions } from '../src/regions.js';
import { readSettings, writeSettings } from '../src/settings.js';
import { addGlobalMotd, activeGlobalNotices } from '../src/motd.js';
import { logAudit, listAudit } from '../src/audit.js';
import { marketAnalysis } from '../src/market.js';
import { cacheBust } from '../src/cache.js';

let env;
const REALM_B = 'rlm-test-b';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });

beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
  await env.DB.prepare("INSERT INTO realms (id, name, slug, created) VALUES (?, 'Realm B', 'b', '2026-01-01')")
    .bind(REALM_B).run();

  // Same names in both realms — if scoping is wrong, these collide.
  await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Iron Hearth', asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });
  await registerUser(env, { email: 'b@x.test', character: 'Bex', businessName: 'Iron Hearth', asOwner: true, hold: 'Falkreath', realmId: REALM_B });
  // Certify both so the register isn't blocked; certification isn't what's under test here.
  await env.DB.prepare('UPDATE companies SET perpetual = 1').run();
});

describe('realm isolation', () => {
  it('lets two realms hold the same business name independently', async () => {
    const a = await findBusinessByName(env, 'Iron Hearth', DEFAULT_REALM_ID);
    const b = await findBusinessByName(env, 'Iron Hearth', REALM_B);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.ledgerId).not.toBe(b.ledgerId); // distinct companies
  });

  it('scopes company lists, name pickers, and meta to one realm', async () => {
    expect(await listCompanies(env, DEFAULT_REALM_ID)).toHaveLength(1);
    expect(await listCompanies(env, REALM_B)).toHaveLength(1);
    // The transfer-target picker must never offer another realm's shops.
    expect(await listBusinessNames(env, DEFAULT_REALM_ID)).toEqual(['Iron Hearth']);
    // Meta (hold/court) resolves per realm, not globally.
    expect((await findBusinessMeta(env, 'Iron Hearth', DEFAULT_REALM_ID)).hold).toBe('Whiterun');
    expect((await findBusinessMeta(env, 'Iron Hearth', REALM_B)).hold).toBe('Falkreath');
  });

  it('scopes member lists to one realm', async () => {
    const a = await listAllUsers(env, DEFAULT_REALM_ID);
    const b = await listAllUsers(env, REALM_B);
    expect(a.map((u) => u.email)).toEqual(['a@x.test']);
    expect(b.map((u) => u.email)).toEqual(['b@x.test']);
    // Same business name, different rosters.
    expect(await listUsersByBusiness(env, 'Iron Hearth', DEFAULT_REALM_ID)).toHaveLength(1);
    expect((await listUsersByBusiness(env, 'Iron Hearth', REALM_B))[0].email).toBe('b@x.test');
  });

  it('refuses to resolve or mutate a member from another realm', async () => {
    const other = (await listAllUsers(env, REALM_B))[0];
    // A realm-A admin holding a realm-B uid gets nothing back...
    expect(await findUserByUid(env, other.uid, DEFAULT_REALM_ID)).toBeNull();
    // ...and cannot edit or delete them.
    await expect(updateMember(env, { uid: other.uid, character: 'Hax', business: 'X', role: 'admin' }, DEFAULT_REALM_ID))
      .rejects.toThrow(/not found/i);
    await expect(deleteMember(env, other.uid, DEFAULT_REALM_ID)).rejects.toThrow(/not found/i);
    // The target is untouched.
    expect((await findUserByUid(env, other.uid, REALM_B)).character).toBe('Bex');
  });

  it('refuses to edit a company from another realm', async () => {
    const otherCo = (await listCompanies(env, REALM_B))[0];
    await expect(updateCompany(env, { id: otherCo.id, name: 'Stolen', perpetual: true }, DEFAULT_REALM_ID))
      .rejects.toThrow(/not found/i);
    expect((await listCompanies(env, REALM_B))[0].business).toBe('Iron Hearth');
  });

  it('resolves a signed-in user to their own realm', async () => {
    expect((await findUserByEmail(env, 'a@x.test')).realmId).toBe(DEFAULT_REALM_ID);
    expect((await findUserByEmail(env, 'b@x.test')).realmId).toBe(REALM_B);
  });
});

describe('realm management', () => {
  it('creates realms and rejects duplicate names', async () => {
    const r = await createRealm(env, { name: 'Third Realm' });
    expect(r.id).toMatch(/^rlm-/);
    expect((await listRealms(env)).some((x) => x.name === 'Third Realm')).toBe(true);
    await expect(createRealm(env, { name: 'Third Realm' })).rejects.toThrow(/already exists/i);
  });

  it('reports per-realm stats', async () => {
    const before = await realmStats(env, DEFAULT_REALM_ID);
    expect(before.counts.companies).toBe(1);
  });

  it('refuses to delete a realm that still holds shops or members', async () => {
    // The expensive-and-irreversible guard: emptying the realm first forces a
    // deliberate second look at what is about to be destroyed.
    await expect(deleteRealm(env, REALM_B)).rejects.toThrow(/still holds/i);
    expect(await listCompanies(env, REALM_B)).toHaveLength(1);
  });

  it('deletes an emptied realm without touching others', async () => {
    await env.DB.prepare('DELETE FROM companies WHERE realm_id = ?').bind(REALM_B).run();
    await env.DB.prepare('DELETE FROM users WHERE realm_id = ?').bind(REALM_B).run();
    await deleteRealm(env, REALM_B);
    expect((await listRealms(env)).some((r) => r.id === REALM_B)).toBe(false);
    // Realm A is untouched.
    expect(await listCompanies(env, DEFAULT_REALM_ID)).toHaveLength(1);
    expect(await listAllUsers(env, DEFAULT_REALM_ID)).toHaveLength(1);
  });

  it('protects the built-in realm from deletion, however empty', async () => {
    await env.DB.prepare('DELETE FROM companies WHERE realm_id = ?').bind(DEFAULT_REALM_ID).run();
    await env.DB.prepare('DELETE FROM users WHERE realm_id = ?').bind(DEFAULT_REALM_ID).run();
    await expect(deleteRealm(env, DEFAULT_REALM_ID)).rejects.toThrow(/cannot be deleted/i);
  });
});

/**
 * The operational data. Every module below was scoped in the same pass, so each
 * gets the same test: do the identical thing in two realms, then assert neither
 * can see the other. Same shop name in both is the worst case and the point.
 */
describe('operational data is realm-scoped', () => {
  const A = DEFAULT_REALM_ID;
  const SHOP = 'Iron Hearth';

  it('keeps inventory separate for same-named shops', async () => {
    await upsertInvItem(env, SHOP, { item: 'Iron Sword', price: 30, lowStock: 1 }, A);
    await upsertInvItem(env, SHOP, { item: 'Iron Sword', price: 999, lowStock: 1 }, REALM_B);
    const a = await listInventory(env, SHOP, A);
    const b = await listInventory(env, SHOP, REALM_B);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].price).toBe(30);
    expect(b[0].price).toBe(999); // the same name, a different item row
  });

  it('keeps sales, coffers, and reports separate', async () => {
    const caller = { character: 'Ann', email: 'a@x.test' };
    await upsertInvItem(env, SHOP, { item: 'Iron Sword', price: 10, lowStock: 0 }, A);
    await upsertInvItem(env, SHOP, { item: 'Iron Sword', price: 10, lowStock: 0 }, REALM_B);
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 10, pricePer: 1, hold: 'Whiterun' }, A);
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 10, pricePer: 1, hold: 'Falkreath' }, REALM_B);

    await checkout(env, SHOP, caller, { cart: [{ item: 'Iron Sword', qty: 2, price: 10 }], hold: 'Whiterun' }, A);

    expect(await listSales(env, SHOP, '', A)).toHaveLength(1);
    expect(await listSales(env, SHOP, '', REALM_B)).toHaveLength(0); // realm B sold nothing
    // Coffers: A took 20 in and paid 10 for stock; B only paid 10 for stock.
    expect(await cofferBalance(env, SHOP, A)).toBe(10);
    expect(await cofferBalance(env, SHOP, REALM_B)).toBe(-10);
    // Stock moved only in A.
    expect((await listInventory(env, SHOP, A))[0].stock).toBe(8);
    expect((await listInventory(env, SHOP, REALM_B))[0].stock).toBe(10);

    // A's sale must not appear in B's market, from any angle. B lists its own
    // registered shop — Company Performance covers the whole roster, so a shop
    // that has sold nothing is a row of zeroes rather than an absence — but the
    // figures on it are B's, which is to say none.
    //
    // B's item list is empty: its intake is real, but its item INDEX is empty,
    // and the market only reports indexed items. That is the same rule that
    // keeps off-index names out of A's numbers.
    const market = await marketAnalysis(env, REALM_B);
    expect(market.businesses).toEqual([{ business: SHOP, orders: 0, items: 0, revenue: 0, archived: false }]);
    expect(market.items).toEqual([]);
    // …and A's shop, which did sell, reports only A's sale.
    expect((await marketAnalysis(env, A)).businesses)
      .toEqual([{ business: SHOP, orders: 1, items: 2, revenue: 20, archived: false }]);
  });

  it('keeps the item index, holds, and network settings separate', async () => {
    await upsertMasterItem(env, { name: 'Dwarven Bow', baseValue: 100 }, A);
    expect(await listItemIndex(env, A)).toHaveLength(1);
    expect(await listItemIndex(env, REALM_B)).toHaveLength(0);

    await writeRegions(env, ['Whiterun', 'Riften'], A);
    await writeRegions(env, ['Elsweyr'], REALM_B);
    expect(await readRegions(env, A)).toEqual(['Whiterun', 'Riften']);
    expect(await readRegions(env, REALM_B)).toEqual(['Elsweyr']);

    const label = 'Overpricing threshold (x item average)';
    await writeSettings(env, [{ label, value: 3 }], A);
    expect((await readSettings(env, A)).find((s) => s.label === label).value).toBe(3);
    expect((await readSettings(env, REALM_B)).find((s) => s.label === label).value).toBe(1.5); // untouched default
  });

  it('keeps the MOTD separate and refuses cross-realm audit reads', async () => {
    await addGlobalMotd(env, { message: 'Realm A news' }, A);
    await addGlobalMotd(env, { message: 'Realm B news' }, REALM_B);
    expect(await activeGlobalNotices(env, A)).toEqual(['Realm A news']);
    expect(await activeGlobalNotices(env, REALM_B)).toEqual(['Realm B news']);

    await logAudit(env, { actor: 'Ann', business: SHOP, action: 'test.a', detail: 'x', realmId: A });
    await logAudit(env, { actor: 'Bex', business: SHOP, action: 'test.b', detail: 'y', realmId: REALM_B });
    expect((await listAudit(env, { realmId: A })).map((r) => r.action)).toEqual(['test.a']);
    expect((await listAudit(env, { realmId: REALM_B })).map((r) => r.action)).toEqual(['test.b']);
  });

  it('refuses to accept a transfer belonging to another realm', async () => {
    await registerUser(env, { email: 'c@x.test', character: 'Cyn', businessName: 'Second Shop', asOwner: true, hold: 'Riften', realmId: A });
    await upsertInvItem(env, SHOP, { item: 'Iron Sword', price: 10, lowStock: 0 }, A);
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 5, pricePer: 1, hold: 'Whiterun' }, A);
    await createTransfer(env, SHOP, { toBusiness: 'Second Shop', item: 'Iron Sword', qty: 2 }, A);

    const { incoming } = await listTransfers(env, 'Second Shop', A);
    expect(incoming).toHaveLength(1);
    // Realm B sees nothing, and cannot act on realm A's transfer id.
    expect((await listTransfers(env, 'Second Shop', REALM_B)).incoming).toHaveLength(0);
    await expect(acceptTransfer(env, 'Second Shop', incoming[0].id, REALM_B))
      .rejects.toThrow(/not found/i);
  });
});

describe('moving between realms', () => {
  it('moves a member and clears a business that does not exist there', async () => {
    const bex = (await listAllUsers(env, REALM_B))[0];
    const res = await transferMember(env, bex.uid, DEFAULT_REALM_ID, REALM_B);
    expect(res.realmId).toBe(DEFAULT_REALM_ID);
    // "Iron Hearth" exists in the destination too, so the business is KEPT.
    expect(res.business).toBe('Iron Hearth');
    expect(await listAllUsers(env, REALM_B)).toHaveLength(0);
    expect((await listAllUsers(env, DEFAULT_REALM_ID)).map((u) => u.email).sort())
      .toEqual(['a@x.test', 'b@x.test']);
  });

  it('refuses a company move when the name is taken in the destination', async () => {
    const co = (await listCompanies(env, REALM_B))[0];
    await expect(transferCompany(env, co.id, DEFAULT_REALM_ID, REALM_B))
      .rejects.toThrow(/already exists/i);
  });

  it('moves a company and its members when the name is free', async () => {
    const { id } = await createRealm(env, { name: 'Empty Realm' });
    const co = (await listCompanies(env, REALM_B))[0];
    const res = await transferCompany(env, co.id, id, REALM_B);
    expect(res.members).toBe(1);
    expect(await listCompanies(env, REALM_B)).toHaveLength(0);
    expect(await listCompanies(env, id)).toHaveLength(1);
    // The owner came along.
    expect((await listAllUsers(env, id))[0].email).toBe('b@x.test');
  });

  it('moves everything the shop OWNS, not just its people', async () => {
    // The per-shop tables are walked from one list, so a table added later is
    // either on it or silently left behind in the old realm. Bundles were the
    // most recent addition; this is the canary for the next one too.
    const co = (await listCompanies(env, REALM_B))[0];
    await saveBundle(env, co.business, { name: 'Feast', price: 60, parts: [{ item: 'Ale', qty: 2 }] }, REALM_B);
    const { id } = await createRealm(env, { name: 'Empty Realm' });
    await transferCompany(env, co.id, id, REALM_B);
    expect(await listBundles(env, co.business, REALM_B), 'left nothing behind').toEqual([]);
    expect((await listBundles(env, co.business, id)).map((b) => b.name)).toEqual(['Feast']);
  });
});
