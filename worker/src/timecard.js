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

/**
 * What one person is owed in COMMISSION, and over how many sales.
 *
 * Their own figure, for their own screen. An employee paid on results has to be
 * able to see what they have earned without asking the owner to open the log
 * for them — and someone paid only on commission has no shifts at all, so the
 * shift list alone would tell them they were owed nothing.
 */
export async function myCommission(env, uid, realmId) {
  const db = await getDb(env);
  const r = await db.prepare(
    `SELECT COALESCE(SUM(commission), 0) AS owed, COUNT(*) AS sales
       FROM sales
      WHERE realm_id = ? AND employee_uid = ? AND commission > 0 AND commission_paid = 0`)
    .bind(realmId, uid).first();
  return { owed: coin(Number((r && r.owed) || 0)), sales: Number((r && r.sales) || 0) };
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

  // WHAT THEY EARNED ON THE FLOOR, alongside what they earned by the clock.
  //
  // Two independent halves of one payout: somebody may be paid hourly, on
  // commission, or both, and a shop that pays only commission has people with
  // no shifts at all. That is why this is read separately and merged in rather
  // than hung off the shift rows — keyed on those, anyone who never clocked in
  // would be owed nothing however much they sold.
  //
  // A voided sale carries 0 (voiding clears it), so none needs filtering here.
  const { results: earners } = await db.prepare(
    `SELECT employee_uid AS uid, employee,
            COALESCE(SUM(commission), 0) AS owed,
            COUNT(*) AS sales
       FROM sales
      WHERE realm_id = ? AND business = ? AND commission > 0 AND commission_paid = 0
      GROUP BY employee_uid`).bind(realmId, business).all();

  const byPerson = new Map();
  const person = (uid, name) => {
    const cur = byPerson.get(uid) || {
      uid, employee: name || '', rate: 0,
      hours: 0, owedHours: 0,
      // The three figures the payout is FOR. `owed` stays the TOTAL, because
      // that is the number an owner acts on and every existing caller reads it.
      owedHourly: 0, owedCommission: 0, owed: 0,
      commissionSales: 0, shifts: 0, open: false,
    };
    cur.employee = cur.employee || name || '';
    byPerson.set(uid, cur);
    return cur;
  };

  for (const s of shifts) {
    const cur = person(s.uid, s.employee);
    cur.rate = cur.rate || s.rate;
    cur.shifts += 1;
    // An open shift counts toward NOTHING financial — it is still being worked
    // — but the person must still appear, flagged as on shift. Skipping the row
    // entirely left anyone whose only shift was open missing from the log, which
    // is exactly the person an owner opens it to find.
    if (s.open) cur.open = true;
    else {
      cur.hours += s.hours;
      if (!s.paid) { cur.owedHours += s.hours; cur.owedHourly += s.pay; }
    }
  }
  for (const e of (earners || [])) {
    // A sale rung up before commission existed carries no uid. It also carries
    // no commission, so it never reaches this loop — but a blank uid would
    // collapse several people into one row if it ever did.
    if (!e.uid) continue;
    const cur = person(e.uid, e.employee);
    cur.owedCommission += coin(Number(e.owed) || 0);
    cur.commissionSales += Number(e.sales) || 0;
  }

  const people = [...byPerson.values()]
    .map((p) => ({
      ...p,
      hours: Math.round(p.hours * 100) / 100,
      owedHours: Math.round(p.owedHours * 100) / 100,
      owed: p.owedHourly + p.owedCommission,
    }))
    .sort((a, b) => b.owed - a.owed || a.employee.localeCompare(b.employee));

  return {
    shifts,
    people,
    totals: {
      hours: Math.round(people.reduce((n, p) => n + p.hours, 0) * 100) / 100,
      owedHourly: people.reduce((n, p) => n + p.owedHourly, 0),
      owedCommission: people.reduce((n, p) => n + p.owedCommission, 0),
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
    // Named shifts only — a correction to part of a payout, which has nothing
    // to say about commission.
    for (const id of ids) {
      await db.prepare(
        'UPDATE time_card SET paid = 1, paid_ts = ? WHERE id = ? AND realm_id = ? AND business = ? AND clock_out IS NOT NULL')
        .bind(stamp, Number(id), realmId, business).run();
    }
  } else {
    if (!uid) throw new Error('Which employee?');
    // SETTLING A PERSON SETTLES THE WHOLE PAYOUT — both halves.
    //
    // The figure an owner is looking at when they press this is Total, and
    // marking the hours paid while leaving the commission outstanding would
    // make the screen disagree with what they just did. The two are one debt to
    // one person; they are settled together or not at all.
    await db.prepare(
      `UPDATE time_card SET paid = 1, paid_ts = ?
        WHERE realm_id = ? AND business = ? AND uid = ? AND paid = 0 AND clock_out IS NOT NULL`)
      .bind(stamp, realmId, business, uid).run();
    await db.prepare(
      `UPDATE sales SET commission_paid = 1, commission_paid_ts = ?
        WHERE realm_id = ? AND business = ? AND employee_uid = ? AND commission_paid = 0 AND commission > 0`)
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
