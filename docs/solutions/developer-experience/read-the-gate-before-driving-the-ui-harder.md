---
title: "When the wizard will not advance, read canAdvance before driving the browser harder"
module: wizard
date: 2026-08-18
problem_type: developer_experience
component: tooling
severity: medium
tags:
  - browser-verification
  - wizard
  - debugging
  - claude-in-chrome
  - verification
applies_when:
  - Driving the wizard through Claude-in-Chrome (or any automation) to verify a UI change
  - A Continue button appears enabled but the step does not advance
  - About to retry a browser interaction with a different input method
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
