---
title: Slot Reachability At The Moment Of Adding - Plan
type: feat
date: 2026-09-14
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
---

# Slot Reachability At The Moment Of Adding - Plan

**Issue:** #753. **Base:** `main` at `09122026.3`, clean and green.

---

## Goal Capsule

Tell a player where an effect can come from **when they add it**, without making
them open the Advanced panel to find out.

#743 shipped the answer; this changes only *when it arrives*. No solve changes,
no new model work, and no new claim about the game.

---

## Problem Frame, and where #753's own framing is wrong

#753 says the disclosure arrives "one step later than the moment the question
actually occurs" because the Advanced panel only exists on a row that is already
ranked. Re-verified against the tree, **that is not the gap**, and the rest of
the issue's design follows from the mistaken version.

Adding an effect *is* ranking it — `addPriority` appends to `state.priorities`.
So the row and its panel exist from the moment of the add. The real gap is
narrower and more ordinary: **the disclosure requires opening a panel, and
nothing tells the player it is there.** That is #747's failure mode, not a
sequencing one — two players worked around the per-stat cap in one thread
without finding a control that was one click away.

### The two mechanisms #753 proposes are not available

> The caution is crowding: … a picker that resolved reachability for every
> candidate as the player types would not [afford it] — that path needs either a
> debounce on the highlighted entry only, or a stat-keyed index built once per
> query.

- **A debounce on the highlighted entry** cannot be built. The picker is a native
  `<datalist>` (`web/wizard.js:3921-3922`). It exposes no per-option rendering
  and fires no event for a highlighted entry. There is no "while the player
  types" surface to hang anything on, which is also why #746's family hint and
  #404's companion hint both land **after a successful add**, in `wz-status`
  (`addPriority`, `web/wizard.js:4674`).
- **A stat-keyed index built once per query** is infeasible at the measured cost:
  1,589 known stats × ~68ms is over a minute.

### The cost is 6.8× what the issue states

The issue says "A full report is ~10ms per effect" and that the eager version
"cost ~129ms for twelve rows". Measured on the built catalog (9,194 items,
warm JIT, `ml: 34`):

| | #753 claims | measured |
|---|---|---|
| one `slotReachabilityReport` | ~10ms | **~68ms median** (58–85ms) |
| twelve rows, eagerly | ~129ms | **757ms** |

Where it goes: `slotReachabilityReport` runs `slotReachabilityFor` **twice** —
once over the filtered pool and once over all variants, to separate
`closedByFilters` from never-existed (`web/model.js:1180-1181`). The shared pool
filter is only 1.8ms, so hoisting it saves nothing; the per-stat scan is the cost.

**This does not block the work, it picks the shape.** One add is one report, so
the bill is ~68ms once per add — affordable, and paid off the paint path.

---

## Design

**One report per successful add, computed after paint, written to its own line.**

`addPriority` already runs on a discrete user action and already owns the
advisory channel. On success it schedules the reachability fill; the add and the
list re-render happen immediately, and the line fills a frame later.

### Its own element, not an append

#753's crowding caution is correct and is honoured literally:

> a second advisory line on the same control needs a deliberate layout decision
> rather than an append.

`#wz-status` is the wrong home for two reasons beyond length. It is styled
`color: var(--quarantined)` (`web/styles.css:1236`) — every message it carries
today is a warning, a refusal or a substitution, and reachability is none of
those; and it carries no `aria-live`, which an asynchronously-filled line needs.

So reachability gets a sibling `#wz-reach` / `#wz-radd-reach`, muted rather than
quarantined, with `role="status"` and `aria-live="polite"`. Existing messages are
untouched.

### Staleness

A ~68ms async fill races with fast adds. The fill carries a sequence token and
writes only if it is still the newest; otherwise it is dropped. Without this, a
player adding three stats quickly gets a line describing whichever report
finished last.

### Wording

One short sentence, and it lives in `projection.js` beside
`slotReachabilityLines` so both inherit the same discipline and its tests —
descriptive only, augment routes named as augments, no interchangeability
claims, never ranks a slot or proposes a pick.

| case | line |
|---|---|
| ≤ 3 open slots | `Assassinate can come from Off Hand and Rune Arm only.` |
| > 3 open slots | `Assassinate can come from 13 slots.` |
| some slots shut | `… Your filters closed 2 others.` |
| every route shut | `Assassinate exists in the catalog, but your filters closed every route to it.` |
| nothing carries it | reuses the existing never-existed sentence verbatim |

The ≤ 3 branch is where the value is: a widely-carried effect reports a count,
and a narrowly-carried one names the slots, which is the case the reporter was
actually in.

A pointer to the panel (`— open Advanced on its row for the routes`) rides the
summary when there is more detail to see. Pointing at a control is established
here (#747's notice names the cap as available); it is a pointer to information,
never a recommendation about gear.

---

## Units

**U1 — `slotReachabilitySummary(stat, report)` in `projection.js`**, exported
beside `slotReachabilityLines`. Pure; no DOM.

**U2 — the reach line in both picker mount points.** Markup, `pickerReachEl()`,
and the CSS. Mirrors `pickerStatusEl()`, which exists because the Adjust panel
silently dropped every message before #404.

**U3 — the async fill with its staleness token**, wired into `addPriority`.
Uses `yieldToPaint`, which already owns the hidden-tab hazard (#578: rAF is not
delivered to a hidden tab, so a bare nested-frame wait parks forever).

**TRAP:** the fill must never throw into the add path. `fillReachability`'s
existing comment states the rule — a disclosure must fail silent-and-empty
rather than take the step down — and this is a second caller of the same model
code, so it needs its own guard rather than inheriting that one.

---

## Verification

- Both suites. New tests proven to fail against the pre-change tree; each new
  guard corrupted and confirmed red, then restored.
- Chromium, real app: add a narrow effect and a wide one, confirm the line
  appears without opening any panel, that the add itself is not delayed, and
  that rapid adds leave the line describing the LAST stat added.

**Stamp.** Player-facing: `?v=` in `web/index.html`, `BUILD` in `web/app.js`,
`**Current build:**` in `README.md`, resolved FORWARD.

---

## Scope Boundaries

- **Browse** is #753's second home and is NOT built here. Separate surface, own
  rendering; filed intent stays on the issue.
- **Replacing the `<datalist>`** with a custom listbox — the only thing that
  would allow a while-typing hint — is declined: a large accessibility and
  mobile rewrite, and ~68ms per candidate is unaffordable regardless.
- **Making the report cheaper** (the double scan) is a real optimization and out
  of scope; one add is one report and 68ms off the paint path is not felt.
