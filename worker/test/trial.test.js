/**
 * A newly founded shop opens with a short certification trial, so its owner can
 * trade the moment they register rather than waiting on an admin.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser, listCompanies } from '../src/registry.js';
import { readRealmPrefs, writeRealmPrefs, PREFS_DEFAULTS } from '../src/realm-prefs.js';
import { checkCertification } from '../src/cert.js';
import { readWarnDays } from '../src/motd.js';
import { cacheBust } from '../src/cache.js';

let env;
beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sys_flags']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
});

/** YYYY-MM-DD, n days from today. */
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('new shop trial', () => {
  it('certifies a founded shop for seven days', async () => {
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });

    expect(PREFS_DEFAULTS.trialDays).toBe(7);
    const [co] = await listCompanies(env, DEFAULT_REALM_ID);
    expect(co.until).toBe(daysFromNow(7));
    expect(co.perpetual).toBe(false);
  });

  it('lets that shop sell straight away', async () => {
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });
    // Previously `until` was blank, which reads as EXPIRED — a new owner could
    // not ring up a single sale until an admin certified them.
    const cert = await checkCertification(env, 'Iron Hearth', DEFAULT_REALM_ID);
    expect(cert.status).toBe('VALID');
    expect(cert.until).toBe(daysFromNow(7));
  });

  it('does not certify a shop in another realm by accident', async () => {
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });

    // Read the certified realm FIRST so its answer is cached, then read the
    // other realm without busting. The cache used to key on business name
    // alone, so this second read was served realm A's VALID — one realm's
    // subscription decided whether another realm's shop could sell.
    expect((await checkCertification(env, 'Iron Hearth', DEFAULT_REALM_ID)).status).toBe('VALID');
    expect((await checkCertification(env, 'Iron Hearth', 'rlm-other')).status).toBe('EXPIRED');
  });
});

describe('trial length is a realm setting', () => {
  it('honours a realm’s own trial length', async () => {
    await writeRealmPrefs(env, { trialDays: 30 }, DEFAULT_REALM_ID);
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });
    expect((await listCompanies(env, DEFAULT_REALM_ID))[0].until).toBe(daysFromNow(30));
  });

  it('gives no trial at all when a realm sets zero', async () => {
    await writeRealmPrefs(env, { trialDays: 0 }, DEFAULT_REALM_ID);
    await registerUser(env, { email: 'a@x.test', character: 'Ann', businessName: 'Iron Hearth',
      asOwner: true, hold: 'Whiterun', realmId: DEFAULT_REALM_ID });
    expect((await listCompanies(env, DEFAULT_REALM_ID))[0].until).toBe('');
    // No trial means an admin has to certify by hand, so the shop can't sell yet.
    expect((await checkCertification(env, 'Iron Hearth', DEFAULT_REALM_ID)).status).toBe('EXPIRED');
  });

  it('rejects a nonsense trial length', async () => {
    await expect(writeRealmPrefs(env, { trialDays: -1 }, DEFAULT_REALM_ID)).rejects.toThrow(/between 0 and 365/i);
    await expect(writeRealmPrefs(env, { trialDays: 9999 }, DEFAULT_REALM_ID)).rejects.toThrow(/between 0 and 365/i);
  });

  it('keeps each realm’s trial to itself', async () => {
    await writeRealmPrefs(env, { trialDays: 30 }, DEFAULT_REALM_ID);
    expect((await readRealmPrefs(env, 'rlm-other')).trialDays).toBe(7); // untouched default
  });
});

describe('expiry warning', () => {
  it('warns three days out by default', async () => {
    expect(await readWarnDays(env, DEFAULT_REALM_ID)).toBe(3);
  });
});
