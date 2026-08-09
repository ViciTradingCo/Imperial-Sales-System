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

/**
 * Delivery reports come through the same form but are not opinions about the
 * app — they are requests with an errand at the end. They get their own queue,
 * and they archive exactly like everything else.
 */
describe('Appointments', () => {
  const report = (who, body) => submitFeedback(env, who, { subject: 'Report Delivery', body }, A);

  it('is a subject the form actually offers', async () => {
    expect(FEEDBACK_SUBJECTS).toContain('Report Delivery');
  });

  it('keeps delivery reports out of Active and in their own list', async () => {
    await report(ANN, 'Ten crates of ale, Tuesday');
    await submitFeedback(env, BEX, { subject: 'Bug / something is broken', body: 'a bug' }, A);
    const d = await listAllFeedback(env);
    expect(d.appointments.map((f) => f.body)).toEqual(['Ten crates of ale, Tuesday']);
    expect(d.active.map((f) => f.body)).toEqual(['a bug']);
  });

  it('marks the row so the page never has to know the subject string', async () => {
    await report(ANN, 'a delivery');
    await submitFeedback(env, BEX, { subject: 'Praise', body: 'nice' }, A);
    const d = await listAllFeedback(env);
    expect(d.appointments[0].appointment).toBe(true);
    expect(d.active[0].appointment).toBe(false);
  });

  it('archives to the SAME archive as everything else', async () => {
    await report(ANN, 'a delivery');
    const id = (await listAllFeedback(env)).appointments[0].id;
    const d = await setFeedbackComplete(env, id, true, 'Root Admin');
    expect(d.appointments).toEqual([]);
    expect(d.archive.map((f) => f.body)).toEqual(['a delivery']);
    expect(d.archive[0].completedBy).toBe('Root Admin');
  });

  it('reopens into Appointments, not into Active', async () => {
    // The subject decides the queue, so a reopened delivery report goes back
    // where anyone would look for it rather than into the feedback pile.
    await report(ANN, 'a delivery');
    const id = (await listAllFeedback(env)).appointments[0].id;
    await setFeedbackComplete(env, id, true, 'Root Admin');
    const d = await setFeedbackComplete(env, id, false, 'Root Admin');
    expect(d.appointments.map((f) => f.body)).toEqual(['a delivery']);
    expect(d.active).toEqual([]);
  });

  it('does not become the home for every unrecognised subject', async () => {
    // The fallback used to be "the last entry in the list", so adding a subject
    // at the end would silently redirect every stale submission into it — and
    // this one has a queue with an errand attached.
    await submitFeedback(env, ANN, { subject: 'Nonsense From A Stale Page', body: 'x' }, A);
    const d = await listAllFeedback(env);
    expect(d.appointments).toEqual([]);
    expect(d.active[0].subject).toBe('Other');
  });
});
