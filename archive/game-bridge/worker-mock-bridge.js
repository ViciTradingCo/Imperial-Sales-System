/**
 * A GAME WORLD THAT IS NOT A GAME — fixtures, and an adapter over them.
 *
 * DORMANT, like everything under `game/`. This exists so that the half of the
 * bridge that has no business knowing about HTTP — the sync planner, the item
 * matcher, the reconciler — can be written and proven before API access is
 * granted, and so that its tests never depend on a server being up, a world
 * being in a particular state, or somebody's chest not being looted mid-run.
 *
 * The world is a PLAIN OBJECT and the adapter reads it live, so a test can move
 * a barrel's contents between two syncs and watch what the planner does — which
 * is the interesting case and the one a static fixture cannot express.
 *
 * `faults` is the other half of its job. Every failure the design promises to
 * survive (§11 of docs/GAME-BRIDGE.md) has to be reachable from a test, or the
 * promise is decoration: a container that has vanished, an endpoint that is
 * down, a world that answers with more than it should.
 */
import {
  BridgeError, CAPS, normalizeParcels, normalizeContainers, normalizeStacks, normalizeItems,
} from './bridge.js';

/**
 * Money is an ITEM, which is the thing about this that surprises people.
 *
 * A shop's coffer is a pile of coins in a chest, so the bridge finds it as a
 * stack like any other and the count IS the balance. Which item id means money
 * is a per-realm setting (the game decides, not us); this is the fixture's.
 */
export const MOCK_GOLD_ID = '0000000F';

/**
 * Two shops in a small town, with the awkward cases built in rather than added
 * by whoever writes the first test: stock split across two containers, an item
 * in both of them, a strongbox of coin, and a forge whose chest holds materials
 * it never sells.
 */
export function mockWorld() {
  return {
    parcels: [
      { id: 'PCL-0001', name: 'The Bannered Mare', owner: 'Hulda', region: 'Whiterun' },
      { id: 'PCL-0002', name: "Warmaiden's", owner: 'Adrianne', region: 'Whiterun' },
    ],
    containers: [
      { id: 'CNT-1001', parcelId: 'PCL-0001', name: 'Barrel' },
      { id: 'CNT-1002', parcelId: 'PCL-0001', name: 'Cupboard' },
      { id: 'CNT-1003', parcelId: 'PCL-0001', name: 'Strongbox' },
      { id: 'CNT-2001', parcelId: 'PCL-0002', name: 'Weapon rack' },
      { id: 'CNT-2002', parcelId: 'PCL-0002', name: 'Materials chest' },
    ],
    // containerId → the stacks inside it.
    contents: {
      'CNT-1001': [
        { itemId: 'ITM-ALE', name: 'Nord Ale', count: 24, value: 4 },
        { itemId: 'ITM-MEAD', name: 'Honningbrew Mead', count: 12, value: 6 },
      ],
      'CNT-1002': [
        { itemId: 'ITM-STEW', name: 'Venison Stew', count: 6, value: 9 },
        // The same ale again, in a second container. A shop's count is the sum.
        { itemId: 'ITM-ALE', name: 'Nord Ale', count: 6, value: 4 },
      ],
      'CNT-1003': [
        { itemId: MOCK_GOLD_ID, name: 'Gold', count: 1240, value: 1 },
      ],
      'CNT-2001': [
        { itemId: 'ITM-SWORD', name: 'Iron Sword', count: 3, value: 25 },
      ],
      'CNT-2002': [
        { itemId: 'ITM-INGOT', name: 'Iron Ingot', count: 14, value: 8 },
      ],
    },
    items: [
      { id: 'ITM-ALE', name: 'Nord Ale', value: 4, category: 'Food' },
      { id: 'ITM-MEAD', name: 'Honningbrew Mead', value: 6, category: 'Food' },
      { id: 'ITM-STEW', name: 'Venison Stew', value: 9, category: 'Food' },
      { id: 'ITM-SWORD', name: 'Iron Sword', value: 25, category: 'Weapon' },
      { id: 'ITM-INGOT', name: 'Iron Ingot', value: 8, category: 'Misc' },
      { id: MOCK_GOLD_ID, name: 'Gold', value: 1, category: 'Misc' },
    ],
  };
}

/**
 * An adapter over a world object.
 *
 * `faults` may name a method that should fail (`{ fail: 'readContainer' }`) or
 * containers the game has forgotten (`{ missing: ['CNT-1002'] }`), which is the
 * difference between "the server is down" and "that chest is gone" — two things
 * the sync must handle differently and which are easy to conflate until you can
 * produce both on demand.
 *
 * Everything goes out through the same normalizers the real adapter will use,
 * so a fixture cannot accidentally be cleaner than a game response.
 */
export function makeMockBridge(world, faults) {
  const w = world || mockWorld();
  const f = faults || {};
  const gone = new Set(f.missing || []);

  const check = (method) => {
    if (f.fail === method) throw new BridgeError('The game server did not answer.', method);
  };

  return {
    async ping() {
      check('ping');
      return { ok: true, version: 'mock-1' };
    },

    async listParcels() {
      check('listParcels');
      return normalizeParcels(w.parcels);
    },

    async listContainers(parcelId) {
      check('listContainers');
      const rows = (w.containers || []).filter((c) => c.parcelId === parcelId && !gone.has(c.id));
      return normalizeContainers(rows, parcelId);
    },

    async readContainer(containerId) {
      check('readContainer');
      // A container the world does not have is NOT an empty one. Answering with
      // "nothing in it" would tell a sync to zero a shop's stock, which is the
      // single most destructive thing a wrong answer here could do.
      if (gone.has(containerId) || !(w.contents || {})[containerId]) {
        throw new BridgeError('No such container in the game world.', containerId);
      }
      return normalizeStacks(w.contents[containerId]);
    },

    async listItems(ids) {
      check('listItems');
      const all = w.items || [];
      const wanted = ids && ids.length ? all.filter((i) => ids.includes(i.id)) : all;
      if (wanted.length > CAPS.items) {
        throw new BridgeError('Asked the game for more item definitions than one read allows.');
      }
      return normalizeItems(wanted);
    },
  };
}
