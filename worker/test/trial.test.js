/**
 * A newly founded shop opens with a short certification trial, so its owner can
 * trade the moment they register rather than waiting on an admin.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser, listCompanies, NEW_SHOP_TRIAL_DAYS } from '../src/registry.js';
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

    expect(NEW_SHOP_TRIAL_DAYS).toBe(7);
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
    cacheBust('');
    expect((await checkCertification(env, 'Iron Hearth', 'rlm-other')).status).toBe('EXPIRED');
  });
});

describe('expiry warning', () => {
  it('warns three days out by default', async () => {
    expect(await readWarnDays(env, DEFAULT_REALM_ID)).toBe(3);
  });
});
