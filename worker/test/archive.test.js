/**
 * Archiving and restoring a company.
 *
 * Archiving is NOT deleting. A shop leaves the network, its name is freed for
 * somebody else, and everything it owned is renamed out of the way — and a
 * month later it comes back, as itself, with its people, stock, books and
 * settings intact.
 *
 * What these tests are really pinning down is that nothing is destroyed on the
 * way out and nothing is lost on the way back, plus the one case that cannot be
 * resolved automatically: somebody else took the name while it was away.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  registerUser, listCompanies, listArchivedCompanies, archiveCompany, restoreCompany, findBusinessByName,
} from '../src/registry.js';
import { listUsersByBusiness } from '../src/users.js';
import { upsertItem, listInventory } from '../src/inventory.js';
import { checkCertification } from '../src/cert.js';
import { listBundles, saveBundle } from '../src/bundles.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

/** A shop with an owner, an employee and some stock — something worth losing. */
async function aShop(name = SHOP) {
  await registerUser(env, { email: 'own@x.com', character: 'Marcus', businessName: name, asOwner: true, realmId: R });
  await registerUser(env, { email: 'emp@x.com', character: 'Sera', businessName: name, asOwner: false, realmId: R });
  await upsertItem(env, name, { item: 'Iron Sword', price: 25 }, R);
  await env.DB.prepare('UPDATE inventory SET stock = 7 WHERE business = ?').bind(name).run();
  const c = await findBusinessByName(env, name, R);
  return c.ledgerId;
}
const idOf = async (name) => (await findBusinessByName(env, name, R)).ledgerId;

describe('archiving', () => {
  it('takes the company off the active list without deleting a thing', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    expect(await listCompanies(env, R)).toEqual([]);
    const archived = await listArchivedCompanies(env, R);
    expect(archived).toHaveLength(1);
    expect(archived[0].archivedFrom).toBe(SHOP);
  });

  it('frees the name for somebody else', async () => {
    await archiveCompany(env, await aShop(), R);
    expect(await findBusinessByName(env, SHOP, R)).toBe(null);
    // And it really can be taken.
    await registerUser(env, { email: 'new@x.com', character: 'Vex', businessName: SHOP, asOwner: true, realmId: R });
    expect((await findBusinessByName(env, SHOP, R)).businessName).toBe(SHOP);
  });

  it('takes its people and its stock with it, under the archived name', async () => {
    await archiveCompany(env, await aShop(), R);
    expect(await listUsersByBusiness(env, SHOP, R)).toEqual([]);
    const key = (await listArchivedCompanies(env, R))[0].business;
    expect(await listUsersByBusiness(env, key, R)).toHaveLength(2);
    expect(await listInventory(env, key, R)).toHaveLength(1);
  });

  it('stops it trading, even when its certification is PERPETUAL', async () => {
    const id = await aShop();
    await env.DB.prepare('UPDATE companies SET perpetual = 1 WHERE id = ?').bind(id).run();
    await archiveCompany(env, id, R);
    const key = (await listArchivedCompanies(env, R))[0].business;
    // Before this was checked, a perpetual archived shop still read VALID and
    // its staff could go on ringing up sales against a company that had left.
    expect((await checkCertification(env, key, R)).status).toBe('EXPIRED');
  });

  it('is idempotent — archiving twice does not mangle the name twice', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    const key = (await listArchivedCompanies(env, R))[0].business;
    await archiveCompany(env, id, R);
    expect((await listArchivedCompanies(env, R))[0].business).toBe(key);
  });
});

describe('restoring', () => {
  it('brings it back as itself, with everything it had', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    const res = await restoreCompany(env, id, R);

    expect(res.business).toBe(SHOP);
    expect(await listArchivedCompanies(env, R)).toEqual([]);
    expect((await listCompanies(env, R)).map((c) => c.business)).toEqual([SHOP]);
    expect(await listUsersByBusiness(env, SHOP, R)).toHaveLength(2);
    const stock = await listInventory(env, SHOP, R);
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({ item: 'Iron Sword', price: 25, stock: 7 });
  });

  it('puts its certification back the way it was', async () => {
    const id = await aShop();
    await env.DB.prepare("UPDATE companies SET status = 'VALID', perpetual = 1 WHERE id = ?").bind(id).run();
    await archiveCompany(env, id, R);
    await restoreCompany(env, id, R);
    expect((await checkCertification(env, SHOP, R)).status).toBe('VALID');
  });

  it('lets its people back in — they can be found by the shop again', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    await restoreCompany(env, id, R);
    const roster = await listUsersByBusiness(env, SHOP, R);
    expect(roster.map((u) => u.character).sort()).toEqual(['Marcus', 'Sera']);
  });

  it('REFUSES when somebody has taken the name, and says what to do', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    await registerUser(env, { email: 'new@x.com', character: 'Vex', businessName: SHOP, asOwner: true, realmId: R });
    await expect(restoreCompany(env, id, R)).rejects.toThrow(/registered again/);
    // …and the refusal changes nothing: the archive still holds it, intact.
    expect(await listArchivedCompanies(env, R)).toHaveLength(1);
  });

  it('refuses a company that is not archived', async () => {
    await expect(restoreCompany(env, await aShop(), R)).rejects.toThrow(/not archived/);
  });

  it('can still restore an OLD archive that predates the name being recorded', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    // Simulate a row archived before archived_from existed.
    await env.DB.prepare('UPDATE companies SET archived_from = NULL WHERE id = ?').bind(id).run();
    expect((await restoreCompany(env, id, R)).business).toBe(SHOP);
  });

  it('brings its specials back too — a bundle belongs to the shop', async () => {
    const id = await aShop();
    await saveBundle(env, SHOP, { name: 'Feast', price: 60, parts: [{ item: 'Iron Sword', qty: 2 }] }, R);
    await archiveCompany(env, id, R);
    expect(await listBundles(env, SHOP, R), 'gone with the shop').toEqual([]);
    await restoreCompany(env, id, R);
    expect((await listBundles(env, SHOP, R)).map((b) => b.name)).toEqual(['Feast']);
  });

  it('cannot be reached from another realm', async () => {
    const id = await aShop();
    await archiveCompany(env, id, R);
    await expect(restoreCompany(env, id, 'rlm-elsewhere')).rejects.toThrow(/not found/i);
  });
});
