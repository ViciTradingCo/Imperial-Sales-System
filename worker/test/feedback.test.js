/**
 * Feedback on the app.
 *
 * The thing worth guarding: the submitter's identity is stamped in by the
 * SERVER from the authenticated caller. A form that let the browser say who
 * wrote it would be a way to file complaints in someone else's name.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  FEEDBACK_SUBJECTS, submitFeedback, listOwnFeedback, listAllFeedback, setFeedbackComplete,
} from '../src/feedback.js';

let env;
const A = DEFAULT_REALM_ID;
const B = 'rlm-fb-b';

const ANN = { uid: 'u-ann', email: 'ann@x.test', character: 'Ann', business: 'Iron Hearth', role: 'owner', status: 'active' };
const BEX = { uid: 'u-bex', email: 'bex@x.test', character: 'Bex', business: 'Rift Traders', role: 'employee', status: 'pending' };

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('submitting', () => {
  it('attaches the submitter, their shop, role, status, realm and time', async () => {
    await submitFeedback(env, ANN, { subject: 'Feature request', body: 'A dark mode, please.' }, A);
    const [f] = await listOwnFeedback(env, ANN.uid, A);
    expect(f.character).toBe('Ann');
    expect(f.email).toBe('ann@x.test');
    expect(f.business).toBe('Iron Hearth');
    expect(f.role).toBe('owner');
    expect(f.status).toBe('active');
    expect(f.realmId).toBe(A);
    expect(f.subject).toBe('Feature request');
    expect(f.body).toBe('A dark mode, please.');
    expect(f.completed).toBe(false);
    expect(Date.parse(f.ts)).toBeGreaterThan(0);
  });

  it('ignores any identity the form tries to supply', async () => {
    // Everything but subject and body is read off the caller, so these are inert.
    await submitFeedback(env, ANN, {
      subject: 'Praise', body: 'Nice.',
      character: 'Someone Else', business: 'Not Mine', role: 'admin', uid: 'u-bex', realmId: B,
    }, A);
    const [f] = await listOwnFeedback(env, ANN.uid, A);
    expect(f.character).toBe('Ann');
    expect(f.business).toBe('Iron Hearth');
    expect(f.role).toBe('owner');
    expect(f.realmId).toBe(A);
    // And nothing landed under the impersonated account.
    expect(await listOwnFeedback(env, 'u-bex', A)).toEqual([]);
  });

  it('refuses an empty body', async () => {
    await expect(submitFeedback(env, ANN, { subject: 'Praise', body: '   ' }, A)).rejects.toThrow(/write your feedback/i);
  });

  it('pins an unrecognized subject to the catch-all rather than inventing one', async () => {
    await submitFeedback(env, ANN, { subject: 'Nonsense From A Stale Page', body: 'x' }, A);
    expect((await listOwnFeedback(env, ANN.uid, A))[0].subject).toBe('Other');
    expect(FEEDBACK_SUBJECTS).toContain('Other');
  });

  it('shows a person only their own submissions', async () => {
    await submitFeedback(env, ANN, { subject: 'Praise', body: 'from Ann' }, A);
    await submitFeedback(env, BEX, { subject: 'Praise', body: 'from Bex' }, A);
    expect((await listOwnFeedback(env, ANN.uid, A)).map((f) => f.body)).toEqual(['from Ann']);
    expect((await listOwnFeedback(env, BEX.uid, A)).map((f) => f.body)).toEqual(['from Bex']);
  });

  it('does not show one realm\'s submissions to the same uid in another', async () => {
    await submitFeedback(env, ANN, { subject: 'Praise', body: 'in A' }, A);
    expect(await listOwnFeedback(env, ANN.uid, B)).toEqual([]);
  });
});

describe('the Active / Archive split', () => {
  /** Find a form by its text — the two are submitted milliseconds apart. */
  const byBody = (list, body) => list.find((f) => f.body === body);

  beforeEach(async () => {
    await submitFeedback(env, ANN, { subject: 'Bug / something is broken', body: 'first' }, A);
    await submitFeedback(env, BEX, { subject: 'Feature request', body: 'second' }, B);
    // Backdate the first so "newest first" has an unambiguous answer; without
    // it both land in the same millisecond and either order is correct.
    await env.DB.prepare("UPDATE feedback SET ts = '2026-01-01T00:00:00.000Z' WHERE body = 'first'").run();
  });

  it('starts everything Active, newest first', async () => {
    const d = await listAllFeedback(env);
    expect(d.active.map((f) => f.body)).toEqual(['second', 'first']);
    expect(d.archive).toEqual([]);
  });

  it('reaches every realm — the System Admin is the only reader', async () => {
    const d = await listAllFeedback(env);
    expect(new Set(d.active.map((f) => f.realmId))).toEqual(new Set([A, B]));
  });

  it('moves a form to Archive when marked complete, stamped with who and when', async () => {
    const { active } = await listAllFeedback(env);
    const d = await setFeedbackComplete(env, byBody(active, 'second').id, true, 'Root Admin');
    expect(d.active.map((f) => f.body)).toEqual(['first']);
    expect(d.archive.map((f) => f.body)).toEqual(['second']);
    expect(d.archive[0].completedBy).toBe('Root Admin');
    expect(Date.parse(d.archive[0].completedAt)).toBeGreaterThan(0);
  });

  it('moves it back on reopen, clearing the completion stamp', async () => {
    const { active } = await listAllFeedback(env);
    const target = byBody(active, 'second');
    await setFeedbackComplete(env, target.id, true, 'Root Admin');
    const d = await setFeedbackComplete(env, target.id, false, 'Root Admin');
    expect(d.archive).toEqual([]);
    expect(d.active).toHaveLength(2);
    expect(d.active.find((f) => f.id === target.id).completedBy).toBe('');
  });

  it('reports a missing form rather than silently doing nothing', async () => {
    await expect(setFeedbackComplete(env, 'fb-nope', true, 'x')).rejects.toThrow(/no longer exists/i);
    await expect(setFeedbackComplete(env, '', true, 'x')).rejects.toThrow(/which feedback/i);
  });

  it('is carried by the submitter\'s realm — deleting a realm takes its feedback', async () => {
    await env.DB.prepare('DELETE FROM feedback WHERE realm_id = ?').bind(B).run();
    const d = await listAllFeedback(env);
    expect(d.active.map((f) => f.body)).toEqual(['first']);
  });
});
