/**
 * Who may do what, said once.
 *
 * The Worker is the trust boundary and re-checks every one of these — nothing
 * here grants anything. This is what the interface should OFFER, so a manager
 * is not shown a button that will refuse them and an employee is not shown one
 * that was never theirs.
 *
 * It exists because the same two role comparisons were written out at fifteen
 * call sites. Adding the manager to fourteen of them would have left the
 * fifteenth quietly excluding managers with nothing to say why.
 */

/**
 * Runs the shop: the owner, a manager they appointed, or an admin.
 *
 * This is the ordinary gate — the register's Buying side, inventory, the
 * roster, notices, the ledger, the time card log.
 */
export function canManage(me) {
  return !!me && (me.role === 'owner' || me.role === 'manager' || me.role === 'admin');
}

/**
 * The owner's own, which a manager is NOT.
 *
 * Kept to what would let a manager rewrite their own terms or hand the shop
 * on: appointing managers, setting pay and commission, reissuing the staff
 * code, renaming the company, and taking the books out as a file. An admin
 * passes, because someone has to be able to act when an owner cannot.
 */
export function isOwner(me) {
  return !!me && (me.role === 'owner' || me.role === 'admin');
}

/**
 * Whether this person may put THAT one out of the shop — the screen's copy of
 * the Worker's `dismissalRefusal`.
 *
 * The one permission in the app that depends on both sides, so it cannot be
 * either predicate above on its own: anyone who runs the shop may let an
 * ordinary employee go, and a manager is the OWNER'S to stand down. An owner is
 * above it and an admin was never on this roster, so neither row offers it.
 *
 * Written in terms of `canManage` and `isOwner` rather than naming roles again
 * — those two are still where the line lives, and this only says which side of
 * them each kind of target falls on.
 */
export function canDismiss(me, target) {
  if (!me || !target) return false;
  if (target.role === 'employee') return canManage(me);
  if (target.role === 'manager') return isOwner(me);
  return false;
}

/** How a role is written on screen. */
export function roleLabel(role) {
  if (role === 'owner') return 'Shop Owner';
  if (role === 'manager') return 'Manager';
  if (role === 'admin') return 'Admin';
  // Somebody signed in who has not registered yet. Not an employee of anything,
  // and the badge is the one place that renders it.
  if (role === 'guest') return 'Guest';
  return 'Employee';
}
