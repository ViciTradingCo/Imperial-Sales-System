/**
 * DEALING ONE FILLING OUT INTO SEVERAL SPECIALS.
 *
 * A special that asks for kinds — "two food and two drink" — is rung up ONE AT
 * A TIME, because a stored line's parts are per unit of the special and two
 * fillings need not divide evenly: seven sweet rolls and three stews fills
 * "five food" twice, and there is no per-special half of that.
 *
 * That rule is right and it stays. What it should not cost is the clerk's time:
 * asking a customer buying three of the same deal to pick their food three
 * times, in three separate boxes, is the app being pedantic at somebody
 * standing at a counter.
 *
 * So the till asks ONCE for the whole amount — three specials wanting two food
 * each is a box asking for six — and this deals what was chosen out into three
 * fillings, each satisfying the deal exactly on its own. Three specials are
 * still three lines, each with its own parts, and the Worker still checks each
 * one against the shop's own tags without knowing they were ordered together.
 *
 * The dealing is greedy and always succeeds when the totals are right: nothing
 * links one kind to another, so each kind is dealt independently and any split
 * that gives every special its required count is as valid as any other. Seven
 * sweet rolls across two specials needing five food each is five and two, then
 * the three stews land on the second — five and five.
 */

/** One line of a filling, as the till and the Worker both understand it. */
function addPart(parts, item, qty, tag) {
  const same = parts.find((p) => p.item === item && p.tag === tag);
  if (same) { same.qty += qty; return; }
  parts.push({ item, qty, tag });
}

/**
 * `chosen` is what the customer picked in total — `[{item, qty, tag}]`.
 * `needs` is what ONE special asks for — `[{tag, qty}]`.
 * Returns `count` arrays of parts, each filling the deal on its own.
 *
 * Throws when a kind's total is not exactly `count × its requirement`. The
 * check lives here rather than only in the screen above it, because this is the
 * function that would otherwise deal out a filling that quietly comes up short.
 */
export function dealSpecial(chosen, needs, count) {
  const n = Math.floor(Number(count)) || 0;
  if (n < 1) throw new Error('How many of the special?');
  const lines = Array.from({ length: n }, () => []);

  for (const need of needs || []) {
    const want = need.qty * n;
    const pool = (chosen || []).filter((c) => c.tag === need.tag && c.qty > 0);
    const got = pool.reduce((sum, c) => sum + c.qty, 0);
    if (got !== want) {
      throw new Error(want + ' ' + need.tag + ' needed — ' + got + ' chosen.');
    }

    // Fill special 0 to its requirement, then 1, and so on. `at` is the one
    // being filled and `filled` is how much of THIS kind is in it.
    let at = 0;
    let filled = 0;
    for (const pick of pool) {
      let left = pick.qty;
      while (left > 0) {
        const take = Math.min(need.qty - filled, left);
        addPart(lines[at], pick.item, take, need.tag);
        left -= take;
        filled += take;
        if (filled === need.qty) { at += 1; filled = 0; }
      }
    }
  }
  return lines;
}
