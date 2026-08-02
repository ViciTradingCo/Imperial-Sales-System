/**
 * Join codes and dormancy.
 *
 * Codes are the only thing a new user supplies, so the tests that matter are:
 * a code admits you to exactly what it names, a wrong code admits you to
 * nothing, and neither kind leaks the existence of anything else.
 *
 * Dormancy is the other half: a fresh deployment has exactly one realm, and the
 * app is supposed to look as though realms were never built.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, DEFAULT_REALM_NAME, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm, listRealms, createRealm, resolveJoinCode, generateCode,
  normalizeCode, regenerateRealmCode, deleteRealm } from '../src/realm.js';
import { registerUser, listCompanies, businessJoinCode, regenerateBusinessCode } from '../src/registry.js';
import { findUserByEmail } from '../src/users.js';
import { collectExport, restoreImport } from '../src/export.js';
import { cacheBust } from '../src/cache.js';

let env;

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });

beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sys_flags']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
});

describe('dormancy: a fresh deployment', () => {
  it('has exactly one realm, named Test Realm, which cannot be deleted', async () => {
    const realms = await listRealms(env);
    expect(realms).toHaveLength(1);
    expect(realms[0].id).toBe(DEFAULT_REALM_ID);
    expect(realms[0].name).toBe(DEFAULT_REALM_NAME);
    expect(realms[0].permanent).toBe(true);
    await expect(deleteRealm(env, DEFAULT_REALM_ID)).rejects.toThrow(/cannot be deleted/i);
  });

  it('gives the built-in realm a founder code, so someone can actually sign up', async () => {
    const [realm] = await listRealms(env);
    expect(realm.joinCode).toMatch(/^RLM-/);
    const found = await resolveJoinCode(env, realm.joinCode);
    expect(found.kind).toBe('realm');
    expect(found.realmId).toBe(DEFAULT_REALM_ID);
  });
});

describe('join codes', () => {
  it('generates readable codes with no ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode('RLM');
      expect(code).toMatch(/^RLM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it('matches codes regardless of case and spacing', async () => {
    const [realm] = await listRealms(env);
    const messy = '  ' + realm.joinCode.toLowerCase() + ' ';
    expect(normalizeCode(messy)).toBe(realm.joinCode);
    expect((await resolveJoinCode(env, messy)).realmId).toBe(DEFAULT_REALM_ID);
  });

  it('resolves nothing for an unknown code', async () => {
    expect(await resolveJoinCode(env, 'RLM-ZZZZ-ZZZZ')).toBeNull();
    expect(await resolveJoinCode(env, '')).toBeNull();
  });

  it('mints a staff code when a shop is founded, which admits an employee to it', async () => {
    const [realm] = await listRealms(env);
    await registerUser(env, { email: 'owner@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: realm.id });

    const staff = await businessJoinCode(env, 'Iron Hearth', realm.id);
    expect(staff).toMatch(/^SHOP-/);

    const found = await resolveJoinCode(env, staff);
    expect(found).toEqual({ kind: 'business', realmId: realm.id, realmName: DEFAULT_REALM_NAME, business: 'Iron Hearth' });
  });

  it('invalidates the old staff code when a new one is issued', async () => {
    const [realm] = await listRealms(env);
    await registerUser(env, { email: 'owner@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: realm.id });
    const old = await businessJoinCode(env, 'Iron Hearth', realm.id);
    const fresh = await regenerateBusinessCode(env, 'Iron Hearth', realm.id);
    expect(fresh).not.toBe(old);
    expect(await resolveJoinCode(env, old)).toBeNull(); // the leaked code is dead
    expect((await resolveJoinCode(env, fresh)).business).toBe('Iron Hearth');
  });

  it('invalidates the old founder code when a realm code is reset', async () => {
    const [realm] = await listRealms(env);
    const fresh = await regenerateRealmCode(env, realm.id);
    expect(await resolveJoinCode(env, realm.joinCode)).toBeNull();
    expect((await resolveJoinCode(env, fresh)).realmId).toBe(realm.id);
  });

  it('gives every new realm its own founder code, distinct from the others', async () => {
    const made = await createRealm(env, { name: 'Second Realm' });
    expect(made.joinCode).toMatch(/^RLM-/);
    const found = await resolveJoinCode(env, made.joinCode);
    expect(found.realmId).toBe(made.id);
    expect(found.realmId).not.toBe(DEFAULT_REALM_ID);
  });

  it('sends a staff code holder into the code’s realm, not the default one', async () => {
    const other = await createRealm(env, { name: 'Second Realm' });
    await registerUser(env, { email: 'o2@x.test', character: 'Bex', businessName: 'Far Shop',
      asOwner: true, hold: 'Falkreath', realmId: other.id });
    const staff = await businessJoinCode(env, 'Far Shop', other.id);

    const found = await resolveJoinCode(env, staff);
    await registerUser(env, { email: 'emp@x.test', character: 'Cyn', businessName: found.business,
      asOwner: false, realmId: found.realmId });

    const emp = await findUserByEmail(env, 'emp@x.test');
    expect(emp.realmId).toBe(other.id);
    expect(emp.business).toBe('Far Shop');
    expect(emp.status).toBe('pending');
    // The default realm never saw any of it.
    expect(await listCompanies(env, DEFAULT_REALM_ID)).toHaveLength(0);
  });
});

describe('backup scope', () => {
  it('takes and restores ONE realm without touching the others', async () => {
    const other = await createRealm(env, { name: 'Second Realm' });
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Alpha',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });
    await registerUser(env, { email: 'b@x.test', character: 'Bex', businessName: 'Beta',
      asOwner: true, hold: 'Falkreath', realmId: other.id });

    const backup = await collectExport(env, other.id);
    expect(backup.scope).toBe('realm');
    expect(backup.tables.companies).toHaveLength(1);
    // A realm backup must not carry the deployment-wide flag store.
    expect(backup.tables.sys_flags).toBeUndefined();

    // Wreck realm B, then restore only it.
    await env.DB.prepare('DELETE FROM companies WHERE realm_id = ?').bind(other.id).run();
    expect(await listCompanies(env, other.id)).toHaveLength(0);

    await restoreImport(env, backup, other.id);
    expect((await listCompanies(env, other.id))[0].business).toBe('Beta');
    // Realm A was never in the file and is untouched.
    expect((await listCompanies(env, DEFAULT_REALM_ID))[0].business).toBe('Alpha');
  });

  it('takes the whole deployment when no realm is named', async () => {
    const other = await createRealm(env, { name: 'Second Realm' });
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Alpha',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });
    await registerUser(env, { email: 'b@x.test', character: 'Bex', businessName: 'Beta',
      asOwner: true, hold: 'Falkreath', realmId: other.id });

    const backup = await collectExport(env);
    expect(backup.scope).toBe('all');
    expect(backup.tables.companies).toHaveLength(2);
    expect(backup.tables.sys_flags).toBeDefined();
  });
});
