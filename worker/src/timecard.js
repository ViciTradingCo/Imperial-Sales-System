/**
 * Time cards — who was on shift, for how long, and what they are owed.
 *
 * One row per shift: clocked in, and clocked out later. A row with no
 * `clock_out` is a shift IN PROGRESS, which is the only state that needs
 * guarding — an employee must never have two.
 *
 * THE RATE IS COPIED ONTO THE SHIFT when it ends, not read from the employee's
 * current rate at payout. A raise applies to the work that comes after it; if
 * the rate were read live, giving someone a raise would silently restate what
 * every past unpaid shift was worth, and an owner who had already agreed a
 * figure would owe a different one.
 *
 * MARKING PAID MOVES NO MONEY. Same rule as the Court's levy: the app records
 * what is owed and an owner marks it settled when it actually is, in whatever
 * way the fiction settles it. A shop's coffer is its own to spend.
 */
import { getDb } from './db.js';
import { coin } from './money.js';

/** A shift longer than this is almost certainly a forgotten clock-out. */
const LONG_SHIFT_HOURS = 16;

const now = () => new Date().toISOString();

/** Hours between two ISO stamps, or 0 if either is unusable. */
export function hoursBetween(from, to) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!isFinite(a) || !isFinite(b) || b <= a) return 0;
  return (b - a) / 3600000;
}

/**
 * What a shift is worth: hours × rate, settled to whole coins.
 *
 * Rounded per SHIFT rather than per payout, because a shift is the thing an
 * owner and an employee agree on — "Tuesday was four hours at 5" has an answer
 * they can both check, and a total that disagrees with the sum of its rows is
 * a total nobody trusts.
 */
function shiftPay(row) {
  if (!row || !row.clock_out) return 0;
  return coin(hoursBetween(row.clock_in, row.clock_out) * (Number(row.rate) || 0));
}

function mapShift(r) {
  const open = !r.clock_out;
  const hours = open ? hoursBetween(r.clock_in, now()) : hoursBetween(r.clock_in, r.clock_out);
  return {
    id: r.id,
    uid: r.uid,
    employee: r.employee || '',
    clockIn: r.clock_in,
    clockOut: r.clock_out || '',
    open,
    hours: Math.round(hours * 100) / 100,
    rate: Number(r.rate) || 0,
    // An open shift is worth nothing YET — it is still being worked, and a
    // figure that ticks upward invites clocking out to make it stop.
    pay: open ? 0 : shiftPay(r),
    note: r.note || '',
    paid: !!r.paid,
    paidTs: r.paid_ts || '',
    // Flagged rather than refused: a shift really can run long, and the app
    // does not know which. It says so and lets a person decide.
    long: hours > LONG_SHIFT_HOURS,
  };
}

/** The shift this person is currently working, or null. */
export async function openShift(env, uid, realmId) {
  const db = await getDb(env);
  const r = await db.prepare(
    'SELECT * FROM time_card WHERE realm_id = ? AND uid = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1')
    .bind(realmId, uid).first();
  return r ? mapShift(r) : null;
}

/**
 * Starts a shift. Refuses a second one: two open shifts would double-count
 * every hour between them, and the usual cause is a double-tap on the button.
 */
export async function clockIn(env, { uid, employee, business, rate }, realmId) {
  if (!uid) throw new Error('Who is clocking in?');
  const already = await openShift(env, uid, realmId);
  if (already) throw new Error('You are already clocked in — since ' + already.clockIn + '.');
  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO time_card (realm_id, business, uid, employee, clock_in, rate) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(realmId, business, uid, String(employee || ''), now(), Number(rate) || 0).run();
  return openShift(env, uid, realmId);
}

/**
 * Ends the open shift, stamping the rate that applied to it.
 *
 * The rate is taken NOW rather than at clock-in so that a correction made
 * during the shift still counts — an owner who notices the rate is wrong at
 * lunchtime should not have to wait until tomorrow for it to apply.
 */
export async function clockOut(env, { uid, rate, note }, realmId) {
  const open = await openShift(env, uid, realmId);
  if (!open) throw new Error('You are not clocked in.');
  const db = await getDb(env);
  await db.prepare(
    'UPDATE time_card SET clock_out = ?, rate = ?, note = ? WHERE id = ?')
    .bind(now(), Number(rate) || 0, String(note || '').trim().slice(0, 200), open.id).run();
  const r = await db.prepare('SELECT * FROM time_card WHERE id = ?').bind(open.id).first();
  return mapShift(r);
}

/** One person's own shifts, newest first. */
export async function myShifts(env, uid, realmId, limit = 40) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT * FROM time_card WHERE realm_id = ? AND uid = ? ORDER BY id DESC LIMIT ?')
    .bind(realmId, uid, limit).all();
  return (results || []).map(mapShift);
}

/**
 * The owner's log: every shift at this shop, with a per-person summary.
 *
 * The summary is what the page is FOR — an owner opening this wants "what do I
 * owe, and to whom", not a list to add up by hand. Owed counts only shifts that
 * are finished and unpaid: an open shift is still being worked, and a paid one
 * is settled.
 */
export async function shopShifts(env, business, realmId, limit = 200) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT * FROM time_card WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?')
    .bind(realmId, business, limit).all();
  const shifts = (results || []).map(mapShift);

  const byPerson = new Map();
  for (const s of shifts) {
    const cur = byPerson.get(s.uid) || {
      uid: s.uid, employee: s.employee, rate: s.rate,
      hours: 0, owedHours: 0, owed: 0, shifts: 0, open: false,
    };
    cur.employee = cur.employee || s.employee;
    cur.shifts += 1;
    // An open shift counts toward NOTHING financial — it is still being worked
    // — but the person must still appear, flagged as on shift. Skipping the row
    // entirely left anyone whose only shift was open missing from the log, which
    // is exactly the person an owner opens it to find.
    if (s.open) cur.open = true;
    else {
      cur.hours += s.hours;
      if (!s.paid) { cur.owedHours += s.hours; cur.owed += s.pay; }
    }
    byPerson.set(s.uid, cur);
  }
  const people = [...byPerson.values()]
    .map((p) => ({ ...p, hours: Math.round(p.hours * 100) / 100, owedHours: Math.round(p.owedHours * 100) / 100 }))
    .sort((a, b) => b.owed - a.owed || a.employee.localeCompare(b.employee));

  return {
    shifts,
    people,
    totals: {
      hours: Math.round(people.reduce((n, p) => n + p.hours, 0) * 100) / 100,
      owed: people.reduce((n, p) => n + p.owed, 0),
      open: shifts.filter((s) => s.open).length,
    },
  };
}

/**
 * Marks shifts settled. Money is NOT moved — see the note at the top.
 *
 * Takes a person rather than a shift by default, because that is how wages are
 * actually paid: everything outstanding for one employee, at once.
 */
export async function markPaid(env, { business, uid, ids }, realmId) {
  const db = await getDb(env);
  const stamp = now();
  if (Array.isArray(ids) && ids.length) {
    for (const id of ids) {
      await db.prepare(
        'UPDATE time_card SET paid = 1, paid_ts = ? WHERE id = ? AND realm_id = ? AND business = ? AND clock_out IS NOT NULL')
        .bind(stamp, Number(id), realmId, business).run();
    }
  } else {
    if (!uid) throw new Error('Which employee?');
    await db.prepare(
      `UPDATE time_card SET paid = 1, paid_ts = ?
        WHERE realm_id = ? AND business = ? AND uid = ? AND paid = 0 AND clock_out IS NOT NULL`)
      .bind(stamp, realmId, business, uid).run();
  }
  return shopShifts(env, business, realmId);
}

/**
 * Corrects or removes a shift. An owner's job: a forgotten clock-out leaves a
 * shift that ran overnight, and there has to be a way to fix it that is not
 * "live with it".
 */
export async function editShift(env, { business, id, clockIn: cin, clockOut: cout, note }, realmId) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT * FROM time_card WHERE id = ? AND realm_id = ? AND business = ?')
    .bind(Number(id), realmId, business).first();
  if (!row) throw new Error('That shift is not on this shop’s log.');
  const inAt = cin ? new Date(cin) : new Date(row.clock_in);
  if (isNaN(inAt.getTime())) throw new Error('That start time is not a date.');
  let outAt = cout === undefined ? row.clock_out : (cout || null);
  if (outAt) {
    const d = new Date(outAt);
    if (isNaN(d.getTime())) throw new Error('That end time is not a date.');
    if (d.getTime() <= inAt.getTime()) throw new Error('A shift has to end after it starts.');
    outAt = d.toISOString();
  }
  await db.prepare('UPDATE time_card SET clock_in = ?, clock_out = ?, note = ? WHERE id = ?')
    .bind(inAt.toISOString(), outAt, note === undefined ? row.note : String(note || '').slice(0, 200), row.id).run();
  return shopShifts(env, business, realmId);
}

export async function deleteShift(env, { business, id }, realmId) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT id FROM time_card WHERE id = ? AND realm_id = ? AND business = ?')
    .bind(Number(id), realmId, business).first();
  if (!row) throw new Error('That shift is not on this shop’s log.');
  await db.prepare('DELETE FROM time_card WHERE id = ?').bind(row.id).run();
  return shopShifts(env, business, realmId);
}
