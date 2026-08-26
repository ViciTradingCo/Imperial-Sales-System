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
