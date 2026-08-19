/**
 * BRANDING — the deployment's identity, the About page, and the tip jar.
 *
 * Two layers, and the layering is the whole point: sitewide is what an
 * anonymous visitor sees (before sign-in there is no realm to know about), and
 * a realm may override any field without touching anyone else's. What must
 * hold:
 *   • a realm's blank field INHERITS rather than blanking the sitewide value;
 *   • a realm's write reaches only its own overrides;
 *   • image and support links are https:// or refused — they are rendered into
 *     other people's pages;
 *   • a blank support link is a real, stored decision (the tip jar comes off),
 *     not a fall back to the built-in one.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema } from '../src/db.js';
import { readBranding, readRealmBranding, writeBranding } from '../src/branding.js';

let env;

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { await env.DB.prepare('DELETE FROM sys_flags').run(); });

describe('defaults', () => {
  it('ships a tip jar that already points somewhere', async () => {
    const b = await readBranding(env);
    expect(b.supportUrl).toMatch(/^https:\/\//);
    expect(b.supportImageUrl).toMatch(/^https:\/\//);
  });

  it('leaves the About wording blank — the page supplies its own stock copy', async () => {
    const b = await readBranding(env);
    expect(b.aboutBody).toBe('');
    expect(b.supportBody).toBe('');
  });
});

describe('writing sitewide', () => {
  it('keeps what it is given and leaves the rest alone', async () => {
    await writeBranding(env, { aboutBody: 'We trade in salt.' }, '');
    const b = await writeBranding(env, { supportTitle: 'Buy me a mead' }, '');
    expect(b.aboutBody).toBe('We trade in salt.');
    expect(b.supportTitle).toBe('Buy me a mead');
  });

  /** Clearing the destination is how the tip jar comes off the page. */
  it('lets a blank support link stand, rather than restoring the default', async () => {
    const b = await writeBranding(env, { supportUrl: '' }, '');
    expect(b.supportUrl).toBe('');
    expect((await readBranding(env)).supportUrl).toBe('');
  });

  it('refuses a support link that is not https', async () => {
    await expect(writeBranding(env, { supportUrl: 'javascript:alert(1)' }, ''))
      .rejects.toThrow(/https/i);
    await expect(writeBranding(env, { supportImageUrl: 'http://ko-fi.test/b.svg' }, ''))
      .rejects.toThrow(/https/i);
  });

  it('caps the long fields so one paste cannot become the whole page', async () => {
    const b = await writeBranding(env, { supportBody: 'x'.repeat(9000) }, '');
    expect(b.supportBody).toHaveLength(4000);
  });
});

describe('a realm on top', () => {
  it('overrides only what it sets, and inherits the rest', async () => {
    await writeBranding(env, { appName: 'Vici', supportUrl: 'https://ko-fi.test/site' }, '');
    await writeBranding(env, { appName: 'Second Server' }, 'rlm-2');

    const b = await readBranding(env, 'rlm-2');
    expect(b.appName).toBe('Second Server');
    expect(b.supportUrl).toBe('https://ko-fi.test/site');
  });

  it('treats a blank field as INHERIT, not as empty', async () => {
    await writeBranding(env, { aboutBody: 'The sitewide welcome.' }, '');
    await writeBranding(env, { aboutBody: '' }, 'rlm-2');
    expect((await readBranding(env, 'rlm-2')).aboutBody).toBe('The sitewide welcome.');
  });

  it('does not reach the sitewide copy, nor any other realm', async () => {
    await writeBranding(env, { aboutBody: 'Sitewide.' }, '');
    await writeBranding(env, { aboutBody: 'Realm two only.' }, 'rlm-2');

    expect((await readBranding(env)).aboutBody).toBe('Sitewide.');
    expect((await readBranding(env, 'rlm-3')).aboutBody).toBe('Sitewide.');
  });

  it('reads back unmerged, so its editing form can tell blank from inherited', async () => {
    await writeBranding(env, { aboutBody: 'Sitewide.' }, '');
    await writeBranding(env, { supportTitle: 'Tip us' }, 'rlm-2');
    const own = await readRealmBranding(env, 'rlm-2');
    expect(own.supportTitle).toBe('Tip us');
    expect(own.aboutBody).toBeUndefined();
  });
});
