/**
 * THE GAME BRIDGE'S CONTRACT — the shape of a game world, and the rules
 * everything crossing into the ledger obeys.
 *
 * DORMANT. Nothing routes here yet; the feature is designed in
 * docs/GAME-BRIDGE.md and waiting on API access. What lives in this file is the
 * half that never needed access in the first place: what an adapter must
 * provide, and what the ledger refuses to believe.
 *
 * EVERY FIELD HERE IS UNTRUSTED. It comes from a system this app does not
 * control, and it lands in the item index, the register's picker, and
 * eventually in sale lines that outlive the game server. So it is cleaned on
 * the way in, once, here — rather than by each of the four modules that will
 * later read it.
 *
 * TWO KINDS OF WRONG, and they are handled differently on purpose:
 *
 *   • STRUCTURAL — more parcels than a world can plausibly hold, a container
 *     with no id, a negative count. The read is REFUSED WHOLE. Half a shop's
 *     stock is not a smaller truth, it is a wrong one, and a sync that silently
 *     dropped the rows it could not read would write exactly that.
 *   • COSMETIC — a name with a tab in it, or one longer than the item index can
 *     hold. Cleaned, and FLAGGED so the importer can say so. Refusing an entire
 *     read because one sword has a forty-one character name would be brittle
 *     about something that is not even a mistake.
 */

/** A read that cannot be believed. Carries what was wrong, for the screen. */
export class BridgeError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'BridgeError';
    this.bridge = true;
    this.detail = detail || '';
  }
}

/**
 * What the ledger will accept in one read.
 *
 * Generous enough for a world nobody has to think about, small enough that a
 * runaway response cannot become a runaway import. `name` matches the item
 * index's own 40 characters (`item-index.js`), so a name that fits here fits
 * there — the bridge should never hand over something the index will quietly
 * shorten behind it.
 */
export const CAPS = {
  parcels: 500,
  containers: 200,      // per parcel
  stacks: 500,          // per container
  items: 2000,          // per definition read
  name: 40,
  id: 64,
  count: 1000000,       // a stack bigger than this is a bug or an attack
};

/**
 * Text from the game, made safe to store and show.
 *
 * Control characters out (a name is one line), whitespace collapsed, trimmed,
 * then capped. Returns whether it had to shorten, because "we changed what the
 * game calls this" is something the importer has to be able to say out loud.
 */
export function cleanText(value, max) {
  const raw = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const limit = max || CAPS.name;
  return { text: raw.slice(0, limit), truncated: raw.length > limit };
}

/** An id is opaque to us — but it has to exist, be short, and be one token. */
function cleanId(value, what) {
  const id = String(value == null ? '' : value).trim();
  if (!id) throw new BridgeError('The game sent a ' + what + ' with no id.', 'empty id');
  if (id.length > CAPS.id) {
    throw new BridgeError('The game sent a ' + what + ' id longer than ' + CAPS.id + ' characters.', id.slice(0, 80));
  }
  if (/[\s\u0000-\u001f\u007f]/.test(id)) {
    throw new BridgeError('The game sent a ' + what + ' id with whitespace or control characters in it.', id.slice(0, 80));
  }
  return id;
}

/** A whole, non-negative count. Fractions and negatives are not "nearly right". */
function cleanCount(value, what) {
  const n = Number(value);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) {
    throw new BridgeError('The game sent ' + what + ' a count that is not a whole number: ' + String(value) + '.');
  }
  if (n > CAPS.count) {
    throw new BridgeError('The game sent ' + what + ' a count of ' + n + ', which cannot be right.');
  }
  return n;
}

/** A gold value per unit, when the game states one. Absent is not zero. */
function cleanValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!isFinite(n) || n < 0) return null;
  return n;
}

/**
 * The structural cap, applied to every list the same way.
 *
 * `rows` must be an array — a game that answers an object where a list was
 * asked for is a game whose answer we do not understand, and guessing is how a
 * sync writes nonsense confidently.
 */
function eachRow(rows, cap, what, fn) {
  if (!Array.isArray(rows)) {
    throw new BridgeError('The game did not send a list of ' + what + '.', typeof rows);
  }
  if (rows.length > cap) {
    throw new BridgeError('The game sent ' + rows.length + ' ' + what + ', over the limit of ' + cap + '.',
      'The whole read is refused rather than trimmed — a shortened list looks complete.');
  }
  return rows.map(fn);
}

/** Buildings. `owner` and `region` ride along only when the game states them. */
export function normalizeParcels(rows) {
  return eachRow(rows, CAPS.parcels, 'parcels', (raw) => {
    const r = raw || {};
    const name = cleanText(r.name, CAPS.name);
    return {
      id: cleanId(r.id, 'parcel'),
      name: name.text,
      nameTruncated: name.truncated,
      owner: cleanText(r.owner, 120).text,
      region: cleanText(r.region, CAPS.name).text,
    };
  });
}

/**
 * Chests inside one parcel.
 *
 * The parcel is passed in rather than read from the row: the caller asked about
 * a specific building, and a game that answers with a container belonging to a
 * different one is answering a question nobody asked.
 */
export function normalizeContainers(rows, parcelId) {
  const parcel = cleanId(parcelId, 'parcel');
  return eachRow(rows, CAPS.containers, 'containers', (raw) => {
    const r = raw || {};
    const name = cleanText(r.name, CAPS.name);
    const belongs = r.parcelId === undefined || r.parcelId === null ? parcel : cleanId(r.parcelId, 'container');
    if (belongs !== parcel) {
      throw new BridgeError('The game answered with a container from another parcel.', belongs + ' ≠ ' + parcel);
    }
    return { id: cleanId(r.id, 'container'), parcelId: parcel, name: name.text, nameTruncated: name.truncated };
  });
}

/**
 * What is in one container.
 *
 * STACKS ARE MERGED BY ITEM. A game may report the same item twice — two piles
 * of ale in one barrel — and the ledger holds one count per item per shop, so
 * they are added here rather than left for whichever caller notices first. The
 * merge is by ID, never by name: two forms may share a display name, and a
 * rename must not split a pile in two.
 */
export function normalizeStacks(rows) {
  const merged = new Map();
  eachRow(rows, CAPS.stacks, 'stacks', (raw) => {
    const r = raw || {};
    const id = cleanId(r.itemId, 'item');
    const name = cleanText(r.name, CAPS.name);
    const count = cleanCount(r.count, 'a stack of ' + (name.text || id));
    const prior = merged.get(id);
    if (prior) {
      prior.count += count;
      return prior;
    }
    const stack = {
      itemId: id,
      name: name.text,
      nameTruncated: name.truncated,
      count,
      value: cleanValue(r.value),
    };
    merged.set(id, stack);
    return stack;
  });
  // Empty stacks are dropped LAST, after merging: a game that reports a pile of
  // 0 is saying the shelf is bare, which is a fact about the container and not
  // about the item, and the shop's own count already says it better.
  return [...merged.values()].filter((s) => s.count > 0);
}

/** Item definitions — the index's raw material. */
export function normalizeItems(rows) {
  return eachRow(rows, CAPS.items, 'item definitions', (raw) => {
    const r = raw || {};
    const name = cleanText(r.name, CAPS.name);
    return {
      id: cleanId(r.id, 'item'),
      name: name.text,
      nameTruncated: name.truncated,
      value: cleanValue(r.value),
      category: cleanText(r.category, CAPS.name).text,
    };
  });
}

/**
 * Does this object implement the contract?
 *
 * One line, checked where an adapter is chosen, so a half-written adapter fails
 * at setup with a sentence rather than at the first sync with "not a function".
 * The behaviour behind these names is proven by the conformance tests in
 * `worker/test/game-bridge.test.js`, which the real adapter must also pass.
 */
export function assertBridge(adapter) {
  const missing = ['listParcels', 'listContainers', 'readContainer', 'listItems', 'ping']
    .filter((m) => typeof (adapter || {})[m] !== 'function');
  if (missing.length) {
    throw new BridgeError('This game adapter is incomplete: it has no ' + missing.join(', ') + '.');
  }
  return adapter;
}
