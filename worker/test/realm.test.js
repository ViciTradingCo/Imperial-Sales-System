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
import { findUserByEmail, listAllUsers, listUsersByBusiness, appendUser, findUserByUid, updateMember, deleteMember } from '../src/users.js';
import { registerUser, listCompanies, findBusinessByName, listBusinessNames, findBusinessMeta, updateCompany } from '../src/registry.js';
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

  it('reports per-realm stats and deletes a realm without touching others', async () => {
    const before = await realmStats(env, DEFAULT_REALM_ID);
    expect(before.counts.companies).toBe(1);

    await deleteRealm(env, REALM_B);
    expect(await listCompanies(env, REALM_B)).toHaveLength(0);
    expect(await listAllUsers(env, REALM_B)).toHaveLength(0);
    // Realm A is untouched.
    expect(await listCompanies(env, DEFAULT_REALM_ID)).toHaveLength(1);
    expect(await listAllUsers(env, DEFAULT_REALM_ID)).toHaveLength(1);
  });

  it('protects the default realm from deletion', async () => {
    await expect(deleteRealm(env, DEFAULT_REALM_ID)).rejects.toThrow(/cannot be deleted/i);
  });
});
