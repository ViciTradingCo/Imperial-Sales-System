/**
 * Registry migration tests — users, companies, settings, and MOTD now live in
 * D1 (formerly Google Sheets). Exercises the identity/authorization core against
 * the in-memory D1 shim: the ADMIN_EMAILS bootstrap, owner/employee registration,
 * company edits/archival, and settings/MOTD round-trips.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema } from '../src/db.js';
import { findUserByEmail, appendUser, listAllUsers } from '../src/users.js';
import { registerUser, listCompanies, updateCompany, archiveCompany, findBusinessByName, listBusinessNames } from '../src/registry.js';
import { checkCertification } from '../src/cert.js';
import { readSettings, writeSettings } from '../src/settings.js';
import { addGlobalMotd, activeGlobalNotices, addIndividualMotd, listIndividualMotds, activeNoticesForBusiness } from '../src/motd.js';
import { cacheBust } from '../src/cache.js';

let env;
beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: 'boss@eec.test' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of ['users', 'companies', 'master_settings', 'business_settings', 'motd_list', 'sys_flags']) {
    await env.DB.prepare('DELETE FROM ' + t).run();
  }
  cacheBust(''); // clear the in-memory identity/registry cache between cases
});

describe('users + admin bootstrap', () => {
  it('auto-provisions a configured admin on first lookup', async () => {
    const u = await findUserByEmail(env, 'BOSS@eec.test'); // case-insensitive
    expect(u).toBeTruthy();
    expect(u.role).toBe('admin');
    expect(u.status).toBe('active');
    // and it persisted as a real row
    expect((await listAllUsers(env)).some((m) => m.email === 'boss@eec.test')).toBe(true);
  });

  it('returns null for an unregistered non-admin', async () => {
    expect(await findUserByEmail(env, 'nobody@eec.test')).toBeNull();
  });

  it('enforces admin even if a listed email was stored with another role', async () => {
    await appendUser(env, { uid: 'u1', email: 'boss@eec.test', business: 'X', role: 'employee', isOwner: false, status: 'pending' });
    const u = await findUserByEmail(env, 'boss@eec.test');
    expect(u.role).toBe('admin');
  });
});

describe('registration', () => {
  it('registers an owner and creates the company', async () => {
    const owner = await registerUser(env, { email: 'o@eec.test', character: 'Ove', businessName: 'Iron Hearth', asOwner: true, hold: 'Whiterun' });
    expect(owner.role).toBe('owner');
    expect(owner.status).toBe('active');
    const biz = await findBusinessByName(env, 'iron hearth');
    expect(biz.businessName).toBe('Iron Hearth');
    expect(await listBusinessNames(env)).toContain('Iron Hearth');
  });

  it('blocks a second owner on a taken name, allows an employee (pending)', async () => {
    await registerUser(env, { email: 'o@eec.test', character: 'Ove', businessName: 'Iron Hearth', asOwner: true });
    await expect(registerUser(env, { email: 'o2@eec.test', character: 'Two', businessName: 'Iron Hearth', asOwner: true }))
      .rejects.toThrow(/already registered/i);
    const emp = await registerUser(env, { email: 'e@eec.test', character: 'Emp', businessName: 'Iron Hearth', asOwner: false });
    expect(emp.role).toBe('employee');
    expect(emp.status).toBe('pending');
  });

  it('rejects an employee joining a non-existent business', async () => {
    await expect(registerUser(env, { email: 'e@eec.test', character: 'Emp', businessName: 'Ghost Co', asOwner: false }))
      .rejects.toThrow(/No business named/i);
  });
});

describe('company edits + certification', () => {
  it('sets an expiry and reflects it in certification', async () => {
    await registerUser(env, { email: 'o@eec.test', character: 'Ove', businessName: 'Iron Hearth', asOwner: true });
    const co = (await listCompanies(env)).find((c) => c.business === 'Iron Hearth');
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await updateCompany(env, { id: co.id, name: 'Iron Hearth', until: future, perpetual: false });
    expect((await checkCertification(env, 'Iron Hearth', 'default')).status).toBe('VALID');

    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await updateCompany(env, { id: co.id, name: 'Iron Hearth', until: past, perpetual: false });
    expect((await checkCertification(env, 'Iron Hearth', 'default')).status).toBe('EXPIRED');
  });

  it('renames a company across users + registry', async () => {
    await registerUser(env, { email: 'o@eec.test', character: 'Ove', businessName: 'Iron Hearth', asOwner: true });
    const co = (await listCompanies(env)).find((c) => c.business === 'Iron Hearth');
    await updateCompany(env, { id: co.id, name: 'Iron Forge', perpetual: true });
    expect(await findBusinessByName(env, 'Iron Hearth')).toBeNull();
    expect((await findUserByEmail(env, 'o@eec.test')).business).toBe('Iron Forge');
  });

  it('archives a company: name freed, hidden from the list', async () => {
    await registerUser(env, { email: 'o@eec.test', character: 'Ove', businessName: 'Iron Hearth', asOwner: true });
    const co = (await listCompanies(env)).find((c) => c.business === 'Iron Hearth');
    await archiveCompany(env, co.id);
    expect((await listCompanies(env)).some((c) => c.business === 'Iron Hearth')).toBe(false);
    expect(await findBusinessByName(env, 'Iron Hearth')).toBeNull(); // freed for re-use
  });
});

describe('settings + motd', () => {
  it('round-trips master settings with validation', async () => {
    const before = await readSettings(env, 'default');
    const overLabel = before.find((s) => /Overpricing/i.test(s.label)).label;
    await writeSettings(env, [{ label: overLabel, value: 2 }], 'default');
    expect((await readSettings(env, 'default')).find((s) => s.label === overLabel).value).toBe(2);
    await expect(writeSettings(env, [{ label: overLabel, value: 0.5 }], 'default')).rejects.toThrow();
  });

  it('stores global notices and per-business notices', async () => {
    await addGlobalMotd(env, { message: 'Welcome to Skyrim' }, 'default');
    expect(await activeGlobalNotices(env, 'default')).toContain('Welcome to Skyrim');
    await addIndividualMotd(env, { business: 'Iron Hearth', message: 'Restock Tuesday' }, 'default');
    expect(await activeNoticesForBusiness(env, 'iron hearth', 'default')).toContain('Restock Tuesday');
    expect(await activeNoticesForBusiness(env, 'Other Co', 'default')).not.toContain('Restock Tuesday');
  });

  it('keeps a global notice out of the per-business list, and vice versa', async () => {
    // They share a table; an empty business is what makes a row global. Mixing
    // the two would offer a global notice for editing under a business
    // dropdown with nothing to show.
    await addGlobalMotd(env, { message: 'Everyone' }, 'default');
    await addIndividualMotd(env, { business: 'Iron Hearth', message: 'Just them' }, 'default');
    expect((await listIndividualMotds(env, 'default')).map((m) => m.message)).toEqual(['Just them']);
    expect(await activeGlobalNotices(env, 'default')).toEqual(['Everyone']);
    expect(await activeNoticesForBusiness(env, 'Iron Hearth', 'default')).not.toContain('Everyone');
  });
});
