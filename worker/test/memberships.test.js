/**
 * ONE PERSON, SEVERAL SHOPS.
 *
 * A membership is a users row: its own uid, its own role at that shop, its own
 * standing. An email may have several, and exactly one is CURRENT — the one
 * every request resolves to. That is what makes this safe to bolt onto an app
 * where forty routes read `caller.business`: none of them had to change,
 * because the caller is still one person at one shop.
 *
 * What has to hold:
 *   • the roles do not leak — owning one shop grants nothing at another;
 *   • switching is checked against the EMAIL, so a stray uid is not a way to
 *     put on somebody else's shop;
 *   • leaving one shop leaves the others, and the session, alone;
 *   • a person who has never had a second membership behaves exactly as before.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser, addBusiness, listCompanies } from '../src/registry.js';
import { findUserByEmail, listMemberships, switchMembership, deleteMember } from '../src/users.js';
import { createSession, resolveSession } from '../src/sessions.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const ANN = 'ann@x.test';

/** Ann owns a forge, and later takes shifts at somebody else's tavern. */
const foundForge = () => registerUser(env, {
  email: ANN, character: 'Ann', businessName: 'Iron Hearth', asOwner: true, hold: 'Whiterun', realmId: R,
});
const foundTavern = () => registerUser(env, {
  email: 'bo@x.test', character: 'Bo', businessName: 'The Bannered Mare', asOwner: true, hold: 'Whiterun', realmId: R,
});

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
});

describe('a person with one shop', () => {
  it('resolves to it, exactly as before any of this', async () => {
    await foundForge();
    const me = await findUserByEmail(env, ANN);
    expect(me).toMatchObject({ business: 'Iron Hearth', role: 'owner', status: 'active' });
  });

  it('has one membership, and it is the current one', async () => {
    await foundForge();
    const mine = await listMemberships(env, ANN);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ business: 'Iron Hearth', current: true });
  });

  it('is still registered idempotently — a second sign-up changes nothing', async () => {
    await foundForge();
    const again = await registerUser(env, {
      email: ANN, character: 'Ann', businessName: 'Somewhere Else', asOwner: true, realmId: R,
    });
    expect(again.alreadyRegistered).toBe(true);
    expect(await listMemberships(env, ANN)).toHaveLength(1);
  });
});

describe('adding a second shop', () => {
  it('joins one that already exists, as a pending employee', async () => {
    await foundForge();
    await foundTavern();
    await addBusiness(env, { email: ANN, character: 'Ann', businessName: 'The Bannered Mare', asOwner: false, realmId: R });

    const mine = await listMemberships(env, ANN);
    expect(mine.map((m) => m.business).sort()).toEqual(['Iron Hearth', 'The Bannered Mare']);
    const tavern = mine.find((m) => m.business === 'The Bannered Mare');
    // Owning a forge grants NOTHING at the tavern: a new hire is a new hire.
    expect(tavern).toMatchObject({ role: 'employee', status: 'pending', current: true });
  });

  it('founds another of their own, and they own that one', async () => {
    await foundForge();
    await addBusiness(env, { email: ANN, character: 'Ann', businessName: 'Ann’s Second', asOwner: true, hold: 'The Rift', realmId: R });
    const mine = await listMemberships(env, ANN);
    expect(mine).toHaveLength(2);
    expect(mine.find((m) => m.business === 'Ann’s Second')).toMatchObject({ role: 'owner', status: 'active' });
    // The company really exists, with its own record.
    expect((await listCompanies(env, R)).map((c) => c.business)).toContain('Ann’s Second');
  });

  it('lands you at the new one, because that is where you just went', async () => {
    await foundForge();
    await addBusiness(env, { email: ANN, character: 'Ann', businessName: 'Ann’s Second', asOwner: true, realmId: R });
    expect((await findUserByEmail(env, ANN)).business).toBe('Ann’s Second');
  });

  it('refuses somewhere you already work', async () => {
    await foundForge();
    await expect(addBusiness(env, {
      email: ANN, character: 'Ann', businessName: 'Iron Hearth', asOwner: false, realmId: R,
    })).rejects.toThrow(/already work/i);
    expect(await listMemberships(env, ANN)).toHaveLength(1);
  });

  it('still refuses a name somebody else has taken', async () => {
    await foundForge();
    await foundTavern();
    await expect(addBusiness(env, {
      email: ANN, character: 'Ann', businessName: 'The Bannered Mare', asOwner: true, realmId: R,
    })).rejects.toThrow(/already registered/i);
  });
});

describe('switching between them', () => {
  const twoShops = async () => {
    await foundForge();
    await foundTavern();
    await addBusiness(env, { email: ANN, character: 'Ann', businessName: 'The Bannered Mare', asOwner: false, realmId: R });
    return listMemberships(env, ANN);
  };

  it('changes who every later request resolves to', async () => {
    const mine = await twoShops();
    const forge = mine.find((m) => m.business === 'Iron Hearth');
    expect((await findUserByEmail(env, ANN)).business).toBe('The Bannered Mare');
    await switchMembership(env, ANN, forge.uid);
    expect(await findUserByEmail(env, ANN)).toMatchObject({ business: 'Iron Hearth', role: 'owner' });
  });

  it('leaves exactly one current, however often it is switched', async () => {
    const mine = await twoShops();
    for (const m of [...mine, ...mine].reverse()) await switchMembership(env, ANN, m.uid);
    expect((await listMemberships(env, ANN)).filter((m) => m.current)).toHaveLength(1);
  });

  /**
   * The uid is the only thing a client sends, so it is checked against the
   * caller's own email. Otherwise it would be a way to put on somebody else's
   * shop like a coat.
   */
  it('refuses a uid that is not yours', async () => {
    await twoShops();
    const bo = (await listMemberships(env, 'bo@x.test'))[0];
    await expect(switchMembership(env, ANN, bo.uid)).rejects.toThrow(/not one of your businesses/i);
    expect((await findUserByEmail(env, 'bo@x.test')).business).toBe('The Bannered Mare');
  });

  it('refuses a uid that does not exist at all', async () => {
    await twoShops();
    await expect(switchMembership(env, ANN, 'usr-nope')).rejects.toThrow(/not one of your businesses/i);
  });

  it('does not touch the session — who you are has not changed', async () => {
    const mine = await twoShops();
    const { token } = await createSession(env, { email: ANN, name: 'Ann', uid: mine[0].uid });
    await switchMembership(env, ANN, mine[0].uid);
    expect((await resolveSession(env, token)).email).toBe(ANN);
  });
});

describe('leaving one of them', () => {
  const twoShops = async () => {
    await foundForge();
    await foundTavern();
    await addBusiness(env, { email: ANN, character: 'Ann', businessName: 'The Bannered Mare', asOwner: false, realmId: R });
    return listMemberships(env, ANN);
  };

  it('ends that membership and leaves the other standing', async () => {
    const mine = await twoShops();
    const tavern = mine.find((m) => m.business === 'The Bannered Mare');
    await deleteMember(env, tavern.uid, R);
    const left = await listMemberships(env, ANN);
    expect(left).toHaveLength(1);
    expect(left[0].business).toBe('Iron Hearth');
  });

  it('leaves you working as what remains, not as nothing', async () => {
    const mine = await twoShops();
    const tavern = mine.find((m) => m.business === 'The Bannered Mare'); // the current one
    expect(tavern.current).toBe(true);
    await deleteMember(env, tavern.uid, R);
    expect((await findUserByEmail(env, ANN)).business).toBe('Iron Hearth');
  });

  it('keeps you SIGNED IN while you still work somewhere', async () => {
    const mine = await twoShops();
    const { token } = await createSession(env, { email: ANN, name: 'Ann', uid: mine[0].uid });
    await deleteMember(env, mine.find((m) => m.business === 'The Bannered Mare').uid, R);
    expect(await resolveSession(env, token)).not.toBe(null);
  });

  it('signs you out when the last one goes — nothing is left to authorize', async () => {
    await foundForge();
    const [only] = await listMemberships(env, ANN);
    const { token } = await createSession(env, { email: ANN, name: 'Ann', uid: only.uid });
    await deleteMember(env, only.uid, R);
    expect(await resolveSession(env, token)).toBe(null);
    expect(await findUserByEmail(env, ANN)).toBe(null);
  });
});
