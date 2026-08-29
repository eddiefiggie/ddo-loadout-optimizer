---
title: "When the wizard will not advance, read the gate — then check the click is even arriving"
module: wizard
date: 2026-08-18
last_updated: 2026-08-29
problem_type: developer_experience
component: tooling
severity: medium
tags:
  - browser-verification
  - wizard
  - debugging
  - claude-in-chrome
  - verification
  - detached-node
  - stale-element
  - re-render
applies_when:
  - Driving the wizard through Claude-in-Chrome (or any automation) to verify a UI change
  - A Continue button appears enabled but the step does not advance
  - About to retry a browser interaction with a different input method
  - About to conclude that browser verification is blocked and ship with a stated gap
  - Capturing an element reference before an interaction that can trigger a re-render
related_components:
  - web/wizard.js
  - tests/wizard.test.js
---

## Context

Verifying the #348 container panel needed the browser on the Priorities step. The
wizard would not advance past Character. The Continue button was present, visible, and
not disabled; no console errors appeared. Six attempts followed across two input
paths — synthetic `.click()`, then real mouse input — including selecting an armor
type, which visibly took (the chip highlighted) and changed nothing.

`canAdvance` is four lines:

```js
function canAdvance(stepId, state) {
  if (stepId === "character") return !!state.race && Number(state.ml) > 0;
  ...
}
```

The gate is **race**. Armor type is not part of it. One grep would have replaced the
entire sequence of attempts.

## Guidance

**When a UI will not advance, read the advance condition in source first.** It is
usually one predicate, it is usually named something like `canAdvance` / `isValid` /
`canSubmit`, and reading it is faster than any single browser attempt — let alone six.

Symptoms that specifically point at a *gate* rather than a broken interaction:

- The button is enabled and clickable, and clicking produces no error and no movement.
- Nothing appears in the console.
- Some interactions clearly register (a chip highlights, a field accepts text) while
  the advance still does not happen.

That combination means the click is arriving and the app is declining. An app that is
declining will not be talked round by a different kind of click.

**Do not escalate input fidelity to solve a state problem.** Moving from synthetic to
real mouse events is the right move when interactions are *not registering* — and it
was the right move for this repo's armor chips, which genuinely ignore synthetic
clicks. It is the wrong move when interactions register fine and a precondition is
unmet. Distinguish the two before retrying.

## Why This Matters

The failed sequence nearly cost the verification entirely: the conclusion after six
attempts was "browser verification is blocked, ship with a stated gap". The gap was
avoidable, and the check that closed it took one command.

The verification, once it ran, immediately found two defects that no unit test could
have caught — a rank badge inherited by a row that is deliberately not ranked, and a
curation panel that opens already at its cap with an unhelpful empty state. Wrongly
concluding the browser was unusable would have shipped both.

## When to Apply

Every time an automated browser pass stalls on a step transition, before the second
attempt.

More generally: when automation stalls against an app you have the source for, the
source is the cheapest instrument available. Reach for it before reaching for a
different way of clicking.

## Examples

The whole diagnosis:

```bash
sed -n "$(grep -n '^function canAdvance' web/wizard.js | cut -d: -f1),+6p" web/wizard.js
```

The working drive, once the real gate was known — note that the race `select` needs an
explicit `change` event, because the app listens for it rather than polling:

```js
const race = vis("select");
race.value = "Human";
race.dispatchEvent(new Event("change", { bubbles: true }));
```

For future runs in this repo, the Priorities step needs: race set (Character gate),
and at least one non-sentinel priority (Priorities gate, per `canAdvance`). Armor,
alignment, and the ML floor are all optional.

---

## Amendment, 2026-08-29 — the same symptoms, the opposite cause

The symptom list above is **not sufficient on its own**, and following it produced a
wrong conclusion twice in one session (#573 and #246). Both times the button was
enabled, the click produced no error and no movement, and other interactions clearly
registered. By the rule above that means "the app is declining". It was not declining.
**The click was never arriving.**

### The cause

`render()` rebuilds the step's DOM. An element captured *before* a re-render is a
detached node, and `.click()` on a detached node is a silent no-op — no error, no
console entry, nothing:

```js
const cont = [...document.querySelectorAll("button")].find((e) => /Continue/i.test(e.textContent));
// …set the name / ML / race — each handler can re-render, detaching `cont`…
cont.click();          // silently does nothing
```

Any input whose handler calls `render()` invalidates every reference captured before
it. In this wizard the race `select` is one such handler, so the very sequence the
original entry recommends — set race, then press Continue — detaches a Continue button
captured beforehand.

### The discriminator

"Enabled, no error, no movement" is shared by both causes. What separates them is
whether **the gate produced its own output**. `blockFeedback()` is not silent:

| Reading | The app is declining | The click never arrived |
|---|---|---|
| `#wz-charmsg` | names the missing fields | empty |
| `[data-req].wz-invalid` | one host per missing field | none |
| `[data-next].wz-nudge` | present (non-character steps flash) | absent |

If all three are empty, `canAdvance` returned **true** and `navigate()` ran — so the
problem is upstream of the app, in the automation. Do not go read the gate again.

```js
({ charmsg: document.getElementById("wz-charmsg")?.textContent,
   invalid: [...document.querySelectorAll(".wz-invalid")].map((e) => e.dataset.req),
   nudged: !!document.querySelector("[data-next].wz-nudge") })
```

### The fix, and the habit

**Re-query immediately before dispatching, never across an interaction.** The one-liner
that works, and that also proves the handler is reachable:

```js
document.querySelector("[data-next]").click();
```

Calling the live handler directly is a useful confirmation when a click still does
nothing, because it bypasses event delivery entirely — if this advances and `.click()`
does not, the node was detached:

```js
const b = document.querySelector("[data-next]");
b.onclick.call(b);        // -> STEP 2 OF 4 · WHICH GEAR SHOULD WE SEARCH?
```

### Two corrections to the entry above

- **The stepper chips are a red herring.** `[data-goto="pool"]` is `disabled` until the
  step is reachable and its handler is `if (!b.disabled) navigate(...)`, so clicking it
  is *correctly* a no-op. It is not evidence of a gate refusing anything.
- **The armor chips do accept synthetic clicks.** The original entry says they "genuinely
  ignore" them. Re-checked 2026-08-29: `document.querySelector('#wz-armor button[data-armor="light"]').click()`
  runs the handler — the `on` class is toggled *inside* that handler, and `armor`
  disappears from `missingRequired`. Escalating to real mouse input for these is no
  longer necessary, and doing so hid the detached-node cause behind a second variable.

### Why this matters

The original entry's own warning applies to itself: the failed sequence "nearly cost the
verification entirely — the conclusion was *browser verification is blocked, ship with a
stated gap*". That is exactly what happened again on #246, which shipped with the gap
stated in its PR body. The gap was avoidable, and closing it immediately confirmed the
one behaviour unit tests could not — that the first touch of a checkbox materialises the
answer from "everything" rather than reading as "I own only this one".

Two entries giving opposite readings of one symptom would be worse than none, which is
why this is an amendment rather than a second file.
