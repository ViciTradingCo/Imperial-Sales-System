# Shelved: the stepped-modal wizard

**Shelved 2026-08-09.** It works and nothing is wrong with it — it simply has no
caller left. Intake was its only user, and intake moved onto the page as three
cards.

## What it was

`openStepModal({ title, steps, finishLabel, onFinish, guideKey })` — a focal
modal that asked **one question per screen**, with Previous and Next, a step
counter and a row of progress dots. Steps were built up front and only their
visibility changed, so state lived in the field elements and moving back and
forth never lost anything. Validation ran per step, on the way FORWARD only:
returning a string from a step's `validate` held you there and showed it as the
error, while going back was always free.

## Why it was shelved

It is the right shape for a form you meet once and the wrong one for the thing a
shop does most often. Recording a delivery behind Previous/Next meant you could
not see what you had already typed, the deliveries list you were checking against
was hidden behind the modal, and every glance back cost two clicks. The three
steps are now three cards on `/pos/buy`, all visible at once, in the order you
fill them in.

Nothing about the wizard caused that — the modal was the problem, and this is a
modal wizard. If a form arrives that genuinely is a one-off (a setup flow, a
migration, an onboarding walk), this is ready for it.

## What came OUT of it before it was shelved

The walk-through panel is now `src/lib/guide.js` — `guidePanel(lines, open)`,
`guideUnseen(key)`, `markGuideSeen(key)`. It was the best thing in here and it
was not specific to stepping: a collapsible "How this works" that opens itself
for someone who has never FINISHED the form it belongs to, and stays shut for
everyone else. The archived `steps.js` still carries its own copy, so restoring
this file means deleting that copy and calling the shared one.

Two hard-won details in the archived code that a reader should not undo:

- **`e.defaultPrevented` in `onKey`.** The item picker accepts its highlighted
  match on Enter and calls `preventDefault`. Without the check, the same
  keystroke also advanced the step, so choosing an item skipped past the
  quantity field.
- **`if (at === last) return;` in `onKey`.** The last step's button is the one
  that writes the record. Nobody should commit a delivery with a stray Enter
  while typing into a field above the summary.

## Restoring it

`git mv archive/step-wizard/steps.js src/lib/steps.js`, delete the SHELVED
header comment at the top, and delete its internal guide panel in favour of
`src/lib/guide.js` (the CSS for `.guide*` is still live).

Its own styles were removed from `src/styles/theme.css` and need putting back:

```css
/* Stepped forms (steps.js) — one question per screen, with Previous/Next.
   The dots are a progress bar, not controls: they say how far in you are and
   how much is left, which is the thing a long form never tells you. */
.step-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--sp-3); margin-bottom: var(--sp-2);
}
.step-count { color: var(--note); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.step-dots { display: flex; gap: 6px; }
.step-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: rgba(122, 74, 31, 0.22); transition: background 0.15s, transform 0.15s;
}
.step-dot.on { background: var(--accent); transform: scale(1.25); }
.step-title { margin: 0 0 var(--sp-1); font-weight: bold; color: var(--accent); font-size: 16px; }
.step-form .note { margin-top: 0; }
.step-pane > label:first-child { margin-top: var(--sp-2); }
.step-nav {
  display: flex; gap: var(--sp-2); margin-top: var(--sp-4);
  padding-top: var(--sp-3); border-top: 1px solid rgba(122, 74, 31, 0.18);
}
.step-nav button { margin: 0; flex: 1 1 0; }
.step-nav button:disabled { opacity: 0.45; cursor: default; }
```

`.step-review` and `.step-review-row` are NOT in that list — they are still live,
because the read-back above the Record button kept them.
