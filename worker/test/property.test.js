/**
 * THE PROPERTY INDEX — a Court letting premises, and the codes that open a shop
 * on one.
 *
 * Two things are really being pinned down here. The first is that a Court's
 * reach is its OWN REGION and nothing else: the code it issues carries the
 * region and the premises, so a shop opened with one lands where the Court put
 * it and not where the holder fancied. The second is the line between letting
 * premises and running a shop — a Court's manager reads the index, and only its
 * owner changes anything.
 *
 * The admin's realm founder code is the control in every one of these: it
 * carries neither a region nor a property, which is what makes a shop that
 * belongs to no Court, and therefore a shop no Court can touch.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  registerUser, findBusinessByName, archiveCompany, restoreCompany, renameBusiness,
} from '../src/registry.js';
import {
  listProperties, saveProperty, deleteProperty, reissuePropertyCode, propertyOf,
} from '../src/property.js';
import { resolveJoinCode, ensureDefaultRealm } from '../src/realm.js';
import { findUserByEmail } from '../src/users.js';

let env;
const R = DEFAULT_REALM_ID;
const REGION = 'Whiterun';
const SEAT = 'Dragonsreach';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare('DELETE FROM realms').run();
  await ensureDefaultRealm(env);
});

let n = 0;
/** A shop, optionally flagged as its region's Court. */
async function aShop(name, { court = false, hold = REGION } = {}) {
  await registerUser(env, { email: 'o' + (++n) + '@x.com', character: 'C' + n, businessName: name,
    asOwner: true, hold, realmId: R });
  const c = await findBusinessByName(env, name, R);
  await env.DB.prepare('UPDATE companies SET hold = ?, court = ? WHERE id = ?')
    .bind(hold, court ? 1 : 0, c.ledgerId).run();
  return c.ledgerId;
}
const add = (name, extra) => saveProperty(env, REGION, { name, ...(extra || {}) }, R);
const one = async (name) => (await listProperties(env, REGION, R)).find((p) => p.name === name);

describe('a Court letting premises', () => {
  it('records the place, not the shop — vacant until somebody takes it', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill', { notes: 'Waterwheel needs work', rent: 25 });
    expect(p).toMatchObject({ name: 'The Old Mill', business: '', notes: 'Waterwheel needs work', rent: 25 });
    expect(p.code).toMatch(/^PROP-/);
    expect((await one('The Old Mill')).vacant).toBe(true);
  });

  it('rounds rent to a whole coin, like every other amount', async () => {
    expect((await add('The Forge', { rent: 22.9 })).rent).toBe(22);
  });

  it('leaves an omitted field alone rather than blanking it', async () => {
    const p = await add('The Old Mill', { notes: 'Damp', rent: 10 });
    const after = await saveProperty(env, REGION, { id: p.id, rent: 12 }, R);
    expect(after).toMatchObject({ name: 'The Old Mill', notes: 'Damp', rent: 12 });
  });

  it('refuses two properties of one name in a region', async () => {
    await add('The Old Mill');
    await expect(add('the old mill')).rejects.toThrow(/already a property/i);
  });

  it('will not reach a property in another region', async () => {
    const p = await add('The Old Mill');
    await expect(saveProperty(env, 'Falkreath', { id: p.id, rent: 5 }, R))
      .rejects.toThrow(/not in your region/i);
    await expect(deleteProperty(env, p.id, 'Falkreath', R)).rejects.toThrow(/not in your region/i);
  });
});

describe('the code a Court issues', () => {
  it('opens a shop in the Court’s region, on its premises', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');

    const found = await resolveJoinCode(env, p.code);
    expect(found).toMatchObject({ kind: 'property', hold: REGION, propertyName: 'The Old Mill', realmId: R });

    await registerUser(env, { email: 'new@x.com', character: 'Sera', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });

    // It landed in the Court's region, and on the Court's property.
    const co = await env.DB.prepare('SELECT hold FROM companies WHERE business = ?').bind('Mill & Co').first();
    expect(co.hold).toBe(REGION);
    expect((await propertyOf(env, 'Mill & Co', R)).name).toBe('The Old Mill');
    expect((await one('The Old Mill')).vacant).toBe(false);
  });

  /**
   * The code IS the right to open here, so it stops meaning anything the moment
   * somebody has. Refused as unrecognised rather than as "taken" — nothing in
   * this resolver ever tells a stranger which kind of code they nearly had.
   */
  it('stops resolving once the premises are occupied', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const found = await resolveJoinCode(env, p.code);
    await registerUser(env, { email: 'new@x.com', character: 'Sera', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });
    expect(await resolveJoinCode(env, p.code)).toBe(null);
  });

  it('cannot put two shops in one building, even redeemed at once', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const found = await resolveJoinCode(env, p.code);
    await registerUser(env, { email: 'a@x.com', character: 'A', businessName: 'First',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });
    // A second holder of the same resolved code, racing the first.
    await expect(registerUser(env, { email: 'b@x.com', character: 'B', businessName: 'Second',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R }))
      .rejects.toThrow(/just been taken/i);
    // …and the company it half-created is not left standing in the doorway.
    expect(await findBusinessByName(env, 'Second', R)).toBe(null);
  });

  it('is reissued only on empty premises, and the old one dies at once', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const first = p.code;
    const { code } = await reissuePropertyCode(env, p.id, REGION, R);
    expect(code).not.toBe(first);
    expect(await resolveJoinCode(env, first)).toBe(null);
    expect((await resolveJoinCode(env, code)).propertyId).toBe(p.id);

    const found = await resolveJoinCode(env, code);
    await registerUser(env, { email: 'new@x.com', character: 'S', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });
    await expect(reissuePropertyCode(env, p.id, REGION, R)).rejects.toThrow(/occupied/i);
  });

  /**
   * THE ADMIN'S CODE IS THE ONE THAT CARRIES NOTHING. It is how a realm's first
   * Courts are made and how a shop that answers to no Court is set up, so it
   * must never acquire a region of its own.
   */
  it('is not what a realm’s own founder code does', async () => {
    const realm = await env.DB.prepare('SELECT join_code FROM realms WHERE id = ?').bind(R).first();
    const found = await resolveJoinCode(env, realm.join_code);
    expect(found.kind).toBe('realm');
    expect(found.hold).toBe(undefined);
    expect(found.propertyId).toBe(undefined);
  });
});

describe('the premises when a shop leaves', () => {
  it('are freed by archiving, so the Court can let them again', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const found = await resolveJoinCode(env, p.code);
    await registerUser(env, { email: 'new@x.com', character: 'S', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });

    const id = (await findBusinessByName(env, 'Mill & Co', R)).ledgerId;
    await archiveCompany(env, id, R);

    const after = await one('The Old Mill');
    expect(after.vacant).toBe(true);
    expect(after.business).toBe('');
    // And a new code can be issued for them.
    const { code } = await reissuePropertyCode(env, p.id, REGION, R);
    expect((await resolveJoinCode(env, code)).propertyId).toBe(p.id);
  });

  it('follow a rename, so the index never names a shop that has gone', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const found = await resolveJoinCode(env, p.code);
    await registerUser(env, { email: 'new@x.com', character: 'S', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });

    await renameBusiness(env, 'Mill & Co', 'The Millers', R);
    expect((await one('The Old Mill')).business).toBe('The Millers');
  });

  it('cannot be removed from the index while somebody is trading on them', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const found = await resolveJoinCode(env, p.code);
    await registerUser(env, { email: 'new@x.com', character: 'S', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });

    await expect(deleteProperty(env, p.id, REGION, R)).rejects.toThrow(/occupied/i);
    const id = (await findBusinessByName(env, 'Mill & Co', R)).ledgerId;
    await archiveCompany(env, id, R);
    expect(await deleteProperty(env, p.id, REGION, R)).toEqual({ removed: 'The Old Mill' });
  });

  /**
   * Restoring the SHOP does not restore the TENANCY. Somebody may be trading
   * there by now, and who occupies a Court's premises is the Court's decision —
   * which is the one thing "archiving is not deleting" cannot promise here.
   */
  it('are not re-let by restoring the shop', async () => {
    await aShop(SEAT, { court: true });
    const p = await add('The Old Mill');
    const found = await resolveJoinCode(env, p.code);
    await registerUser(env, { email: 'new@x.com', character: 'S', businessName: 'Mill & Co',
      asOwner: true, hold: found.hold, propertyId: found.propertyId, realmId: R });

    const id = (await findBusinessByName(env, 'Mill & Co', R)).ledgerId;
    await archiveCompany(env, id, R);
    await restoreCompany(env, id, R);

    expect((await findUserByEmail(env, 'new@x.com')).business).toBe('Mill & Co'); // the shop is back
    expect((await one('The Old Mill')).vacant).toBe(true);                        // the doorway is not
  });
});

describe('realm isolation', () => {
  it('keeps one realm’s premises and codes out of another', async () => {
    await env.DB.prepare("INSERT INTO realms (id, name, join_code) VALUES ('other', 'Other', 'RLM-OTHR-OTHR')").run();
    await aShop(SEAT, { court: true });
    await add('The Old Mill');
    // The same region name in another realm sees nothing of it.
    expect(await listProperties(env, REGION, 'other')).toEqual([]);
  });
});
