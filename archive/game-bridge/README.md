# Shelved: the Game Bridge

**Shelved 2026-08-20.** Not abandoned and not broken — it never shipped. The
design is finished and the two pieces that needed no API access were built and
tested; the rest waits on access to the game server's API, and rather than leave
a half-feature sitting in `worker/src/` reading as either live or forgotten, the
whole of it goes on the shelf in one piece.

**Nothing was removed from the live app, because nothing was ever wired in.**
No table, no migration, no route, no screen, no tile, no setting. Both modules
were imported by their own test and by nothing else. That is the whole difference
between this and the other directories here: shelving the storefront meant
unpicking it from six files, and shelving this meant moving four.

## What it was

Reading a live game world into the ledger. The **parcels** (buildings) a server
hosts, the **containers** inside them, what is in those containers, and the
**item definitions** behind it all — so a shop owner points the app at the chests
that ARE their shop and stops typing their inventory in twice.

`DESIGN.md` is the whole thing, and it is the reason this directory exists. The
code here is two files; the design is eight hundred lines of decisions that took
a conversation with the server's operator to settle, and re-deriving it later
would cost far more than rebuilding the modules.

The parts worth knowing without opening it:

- **Read-only, and structurally so.** The credential the operator would issue
  cannot write, so a bug in this app could not damage a player's property even if
  somebody wired one badly. Writing back — "sell an ale and it leaves the barrel"
  — was ruled out as its own, much larger trust problem.
- **The coffer is COUNTED.** Gold is an item, so a designated chest's coin *is*
  the shop's balance. The ledger becomes the EXPECTATION, and `counted −
  expected` is the "is any money missing" answer that makes the whole feature
  worth having. Stored as one reconciling entry per count, never as the balance —
  writing the counted amount each run would double a shop's money every sync.
- **A count, not a camera.** The world is never read live: a chest read mid-loot
  is a number that was never true for a whole second. Counts happen on a schedule
  and after a sale — and a sale *marks the shop due* rather than triggering a
  read, so two players have time to hand goods over and the till never waits on a
  game server.
- **The name stays the item index's key.** A game id is an alias column. Sale
  lines are historical records that must outlive any game server.
- **A synced shop's intake records what was PAID, not what arrived** — the goods
  are already in the chest — and since a sync states no price, a synced realm's
  Market Analysis reads the sales log only.

## Why it was shelved

Access to the game API had not been granted, and the two steps that could be
built without it were. Everything remaining needs either the test server or the
live credential. A feature that cannot be finished should not sit in the source
tree looking like one that can.

## The files here

| File | Was | State |
| --- | --- | --- |
| `DESIGN.md` | `docs/GAME-BRIDGE.md` | Complete, including the operator's answers to all ten questions |
| `worker-bridge.js` | `worker/src/game/bridge.js` | Finished — the adapter contract, the caps, and the cleaning rules for untrusted game data |
| `worker-mock-bridge.js` | `worker/src/game/mock-bridge.js` | Finished — a fixture world, live and mutable, with injectable faults |
| `game-bridge.test.js` | `worker/test/game-bridge.test.js` | 24 tests, all passing when they were last run |

The modules are unmodified. Their relative imports (`./bridge.js`,
`../src/game/bridge.js`) no longer resolve from this directory and are left that
way, so the archived copies stay a faithful record — the same rule the rest of
`archive/` follows. They resolve again the moment the files move back.

## Restoring it

There is no wiring to re-add, because there never was any. Move the files back:

```sh
mkdir -p worker/src/game
git mv archive/game-bridge/worker-bridge.js       worker/src/game/bridge.js
git mv archive/game-bridge/worker-mock-bridge.js  worker/src/game/mock-bridge.js
git mv archive/game-bridge/game-bridge.test.js    worker/test/game-bridge.test.js
git mv archive/game-bridge/DESIGN.md              docs/GAME-BRIDGE.md
```

`npx vitest run --root worker` should then be green again with 24 more tests,
and `DESIGN.md` §13 picks up at **step 2** — the sync planner and the item
matcher, which still need no API access at all and are the bulk of the remaining
thinking.

Two things to re-check before going further, both recorded in the design and
both cheap to get wrong from memory:

1. Everything above the adapter works in `{itemId, count}`. The two unknowns the
   operator could not answer — whether stacks expose enchantment or tempering,
   and the real-world sizes of a world — are contained by that boundary, and are
   first-contact tasks on the test server rather than blockers.
2. A realm pointed at the **test server** is a complete, isolated staging
   environment with no new machinery, because realm isolation already guarantees
   it. Every risky step belongs there; the only step genuinely gated on the live
   credential is the last one.
