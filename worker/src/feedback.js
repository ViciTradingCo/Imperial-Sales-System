/**
 * Feedback on the app — what owners and employees think of the thing they use
 * every day, sent to whoever runs the deployment.
 *
 * WHO SEES IT: the System Admin, and nobody else. This is feedback about the
 * SOFTWARE, not about a realm's trade, so it goes to the person who can act on
 * it — the one who runs the deployment — rather than to whichever admin happens
 * to run the submitter's realm. Rows still carry a realm_id so a realm's
 * deletion or backup takes its feedback with it.
 *
 * WHO THE SUBMITTER WAS is stamped in by the SERVER from the authenticated
 * caller, never accepted from the request. A form that let the browser say who
 * wrote it would be a way to file complaints in someone else's name.
 */
import { getDb } from './db.js';

/**
 * The subjects offered in the dropdown, served to the client so there is ONE
 * list: a client-side copy would drift, and the server has to validate anyway.
 * Deliberately short — a long menu makes people pick "Other".
 */
export const FEEDBACK_SUBJECTS = [
  'Bug / something is broken',
  'Feature request',
  'Confusing or hard to use',
  'Wrong or missing data',
  'Performance / speed',
  'Praise',
  'Other',
];

const MAX_BODY = 4000;

function genId() {
  return 'fb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function rowToFeedback(r) {
  return {
    id: r.id,
    realmId: r.realm_id,
    ts: r.ts,
    character: r.char_name || '',
    email: r.email || '',
    business: r.business || '',
    role: r.role || '',
    status: r.status || '',
    subject: r.subject || '',
    body: r.body || '',
    completed: !!r.completed,
    completedAt: r.completed_at || '',
    completedBy: r.completed_by || '',
  };
}

/**
 * Files a piece of feedback. `caller` is the authenticated user — everything
 * about the submitter is taken from it, so only the subject and the body come
 * from the form.
 */
export async function submitFeedback(env, caller, { subject, body }, realmId) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Write your feedback before submitting.');
  // An unknown subject means a stale page, not a new category: pin it to the
  // catch-all rather than inventing one that no filter will ever match.
  const chosen = FEEDBACK_SUBJECTS.includes(String(subject || '').trim())
    ? String(subject).trim()
    : FEEDBACK_SUBJECTS[FEEDBACK_SUBJECTS.length - 1];
  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO feedback (id, realm_id, ts, uid, email, char_name, business, role, status, subject, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(genId(), realmId, new Date().toISOString(), caller.uid || '', caller.email || '',
      caller.character || '', caller.business || '', caller.role || '', caller.status || '',
      chosen, text.slice(0, MAX_BODY)).run();
  return { ok: true };
}

/** One person's own submissions, so they can see it was received and read. */
export async function listOwnFeedback(env, uid, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT * FROM feedback WHERE realm_id = ? AND uid = ? ORDER BY ts DESC, id DESC LIMIT 20')
    .bind(realmId, String(uid || '')).all();
  return (results || []).map(rowToFeedback);
}

/**
 * Everything submitted, split into Active and Archive.
 *
 * Deployment-wide, because the System Admin is the only reader and their job
 * spans realms. Each row carries its realm so the page can say where it came
 * from — that is a label on the System Admin's own screen, not one realm being
 * shown another's trade.
 */
export async function listAllFeedback(env) {
  const db = await getDb(env);
  // By TIMESTAMP, not by id: the id embeds a base36 clock reading but ends in
  // random characters, so two submissions in the same millisecond would order
  // arbitrarily — and the ordering is the whole point of a queue to work through.
  const { results } = await db.prepare('SELECT * FROM feedback ORDER BY ts DESC, id DESC LIMIT 500').all();
  const all = (results || []).map(rowToFeedback);
  return {
    active: all.filter((f) => !f.completed),
    archive: all.filter((f) => f.completed),
  };
}

/**
 * Marks feedback complete (or puts it back), moving it between Active and
 * Archive. Reopening exists because "done" is a judgement, and one that is
 * sometimes made too early.
 */
export async function setFeedbackComplete(env, id, complete, actor) {
  const target = String(id || '').trim();
  if (!target) throw new Error('Which feedback?');
  const db = await getDb(env);
  const row = await db.prepare('SELECT id FROM feedback WHERE id = ?').bind(target).first();
  if (!row) throw new Error('That feedback no longer exists.');
  const done = complete !== false;
  await db.prepare('UPDATE feedback SET completed = ?, completed_at = ?, completed_by = ? WHERE id = ?')
    .bind(done ? 1 : 0, done ? new Date().toISOString() : '', done ? String(actor || '') : '', target).run();
  return listAllFeedback(env);
}
