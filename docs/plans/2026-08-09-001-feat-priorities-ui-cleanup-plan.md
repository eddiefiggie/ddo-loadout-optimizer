---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: Priorities step — fold per-row options into one Advanced control, and extend the bundles
date: 2026-08-09
---

# Priorities step UI cleanup

**Product Contract preservation:** unchanged. Planning added the Q1 resolution
(R5's indicator is a count badge) and closed the Scope Boundaries question about
the Adjust panel — both were explicitly left open for planning, not product
decisions rewritten here.

## Goal Capsule

Each ranked row on the Priorities step collapses its min input, max input, and
"already have" block into one optional Advanced control, closed by default, so
the row shows only rank, name, and reorder. The panel leads with the default —
no floor, no cap, solver takes what it can fit — and carries the min/max
explainer currently stranded at the bottom of the list. Bundles are reordered to
lead with the affix players want first, and gain Attributes and Warlock.

Presentation only. The same `state.targetCaps`, `state.targetFloors`, and
`state.declaredCredits` are read and written through the same handlers; the
solver never learns this happened.

---

## Product Contract

### Problem

The Priorities step (`stepPriorities`, `web/wizard.js:820`) has accumulated four
separate affordances on and around each ranked row, and they compete for
attention with the one thing that step is actually for — the **order**.

A single row currently renders:

```
[⋮⋮] [3] [Constitution]  [min][max]  [↑][↓][✕]  [+ already have]
```

Two number inputs and a credit affordance sit at the same visual weight as the
reorder controls, on every row, whether or not the player will ever use them.
The explanation of what min and max *do* lives in a `<details>` element at the
bottom of the list (`web/wizard.js:851`) — detached from the inputs it
describes, so a player reads the controls first and the caveats last, if at all.

Two further gaps:

- **The default is invisible.** Empty min/max means "no floor, no cap — let the
  solver find the best it can fit at this priority." That is the right default
  and the one almost every player wants, but nothing on screen says so. An empty
  box reads as unfinished, which invites players to fill it in and over-constrain
  a solve they had no reason to constrain.
- **"Already have" under-explains itself.** Its tooltip names trances, past
  lives, filigrees, and ship buffs, but the visible label is three words. The
  feature exists precisely because a player's non-gear bonuses are invisible to
  the tool, and the label does not carry that.

Separately, the bundle rows have drifted from how players actually build:
bundle affix order does not lead with the affix most players want first, there
is no way to add the six ability scores in one click, and Warlock — a class
whose entire damage identity is pact dice and eldritch blast — has no bundle.

### Goals

- One optional control per row, holding everything advanced, so the default row
  is just rank, name, and reorder.
- Make "no min, no max" legible as a deliberate, recommended default.
- Keep the row grid uniform — every row the same shape, aligned columns.
- Bundles that lead with the affix a player of that archetype wants first.
- One-click ability scores, and a Warlock bundle.

### Non-goals

- No change to solver behavior, the bounds model, or the declared-credit model.
- No change to which stats are rankable, beyond the twelve augment-only stats
  already added to `CORE_STATS` on this branch.
- No new persisted state. The Advanced panel's open/closed state is ephemeral.

### Requirements

#### Row: one Advanced control

| ID | Requirement |
|----|-------------|
| R1 | Each ranked row collapses its min input, max input, and "already have" block into a single optional per-row control, closed by default. The row's default state shows only grip, rank, name, and the reorder/remove buttons. |
| R2 | The control is uniform across rows: same label, same position, same column. Rows differ only in what the panel contains, never in the row's own shape or alignment. |
| R3 | The min/max explainer at `web/wizard.js:851` moves inside the panel, adjacent to the inputs it describes. The standalone element at the bottom of the list is removed — the text is relocated, not duplicated. |
| R4 | The panel leads with the default, stated plainly: no minimum and no maximum are set, and the solver will get as much of this stat as it can fit without giving up anything ranked above it. A player who opens the panel and reads nothing else should come away knowing they do not need to fill it in. |
| R5 | A row with settings applied is distinguishable while collapsed. A floor, a cap, or a declared credit must not become invisible when the panel closes. |
| R6 | Presence (on/off) rows carry no Advanced control. They already suppress declared credits (`web/wizard.js:1062`), and a floor or cap on a binary stat is meaningless. The row keeps the same grid columns so the list stays aligned. |
| R7 | "Already have" gains visible context naming the sources it covers — character effects from trances, enhancements, epic destinies and the like — rather than carrying that only in a `title` tooltip. |

#### Bundles

| ID | Requirement |
|----|-------------|
| R8 | *(session-settled: user-directed — reorder-only, chosen over trimming the bundle to the six named affixes.)* `Basic` is reordered to lead: Constitution, Healing Amplification, Physical Sheltering, Magical Sheltering, Dodge, Fortification. Its remaining affixes (False Life, Resistance, Freedom of Movement, Blurry, Ghostly, Blindness Immunity) follow in their existing order. Reorder only — nothing is dropped. |
| R9 | `Ranged` is reordered to lead: Ranged Power, Doubleshot, Deadly, Armor-Piercing, followed by Ranged Alacrity and Accuracy. Reorder only. |
| R10 | A new `Attributes` bundle offers the six ability scores: Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma. It sits **above** the Tactics row in the bundle area. |
| R11 | *(session-settled: user-directed — all three eldritch-blast damage families included, chosen over a generic pact-agnostic eight-affix bundle.)* A new `Warlock` bundle sits on the top packages row alongside Trapping: Power in Pact, Eldritch Blast Dice, Charisma, Spell Focus Mastery, Spell Penetration, Potency, Universal Spell Power, Constitution, Nullification, Void Lore, Radiance, Radiance Lore, Impulse, Kinetic Lore. All fourteen confirmed present in `metadata.rankable_affixes`. |
| R12 | Bundle affix lists remain subject to `resolveBundle` (`web/wizard.js:400`), which canonicalizes through the alias table and drops anything the dataset does not carry, so no bundle can inject a dead target. |

### Scope boundaries

`Attributes` is a bundle, not a reveal — it does not gate behind another package
and reveals nothing. `Warlock` sits on the top row and, like Trapping, reveals
no sub-row; its spell-power affixes ship inside the bundle rather than being
layered through `BUNDLE_REVEALS`.

**Resolved during planning:** the in-results "Adjust & re-solve" panel shares
`renderRankedList` (`web/wizard.js:1102`) with the Priorities step, so it
inherits the Advanced control from the same change. No divergence to manage.

#### Deferred to follow-up work

- Percentage-unit support in the solver, which would let `Armor Class (%)`,
  `False Life (%)`, and `Maximum Spell Points (%)` become rankable. Out of scope
  here; noted because it is the reason those three sat out the `CORE_STATS`
  addition on this branch. **Tracked as #189.**

### Success criteria

- A player who wants a straightforward solve never opens a panel and never sees
  an empty input inviting them to constrain the solve.
- A player who sets a floor can see, from the collapsed list, which row has it.
- A Warlock player reaches a sensible priority list in one click.
- The relocated explainer appears exactly once in the step.

### Assumptions

| ID | Assumption |
|----|-----------|
| A1 | Min/max and "already have" are genuinely advanced: most solves want neither. The current flat layout implies otherwise, and that is the defect. |
| A2 | Uniformity means every row is the same shape, not that every row offers the same controls. R6 trades a control for alignment on presence rows. |

---

## Planning Contract

### Key Technical Decisions

**KTD1 — The panel's open state is an ephemeral `Set` of stat names, re-applied
after each rebuild.** This is the plan's central risk, not a detail.
`renderRankedList` rebuilds the whole list with `ol.innerHTML = rankedHTML()`
(`web/wizard.js:1103`), and four handlers call `rerender()`: adding a credit
(`data-cadd`), removing one (`data-crem`), changing a credit's bonus type, and
drag-drop. A `<details open>` would therefore snap shut the instant a player
clicks "+ already have" *inside* the panel they just opened — the single most
likely interaction. Keep a module-scoped `Set` of open stat names, write to it
on `toggle`, and set `open` from it while composing each row.

Keyed by **stat name, not row index**: reordering changes indices, and a panel
should follow its stat up and down the list rather than staying with position 3.
The delete branch (`web/wizard.js:1108`) already sweeps `targetCaps`,
`targetFloors`, and `declaredCredits` for the removed stat — sweep the open set
there too, so a removed stat leaves nothing behind.

Not persisted (Non-goals): it never enters `state`, `INPUT_KEYS`
(`web/persist.js:41`), or the query.

**KTD2 — Native `<details>`/`<summary>`, not a custom button plus a hidden div.**
Keyboard operation, focus behavior, and AT semantics come free, and the `toggle`
event gives KTD1 its write point. The existing bottom explainer is already a
`<details>` (`web/wizard.js:851`), so this matches local convention rather than
introducing a second disclosure idiom.

**KTD3 — Extract a pure row model and export it.**
*(session-settled: user-directed — chosen over browser-only verification: the
collapsed-badge and presence-row rules get no regression guard without it.)*
`rankedHTML` and `renderRankedList` live inside a closure and are not exported,
so R1–R7 have no unit-test path today. Add
`advancedRowModel(stat, state, vocab)` returning
`{ hasAdvanced, floor, cap, credits, badgeCount }`, export it alongside the
other pure helpers, and have `rankedHTML` render from it. R5 and R6 then become
real assertions instead of browser observations, matching how the rest of
`web/wizard.js` is tested — pure functions exported, DOM left alone.

**KTD4 — R5's indicator is a count badge on the summary** (resolves Q1). A count
survives the compression the collapsed row demands, reads correctly for the
common one-setting case, and needs no truncation rules. An inline summary of the
settings themselves would reintroduce exactly the row clutter R1 removes.

**KTD5 — Presence rows render the Advanced column as empty, not absent.** R6
removes the control; R2 keeps the grid. Emitting an empty cell rather than
dropping the element keeps the reorder buttons in the same column on every row.

**KTD6 — `SUMMARY` joins the `ondragstart` tagName allowlist**
(`web/wizard.js:1189`). The comment there records that `draggable="false"` on a
child does not stop the ancestor `<li>` from becoming the drag source, and that
`stopPropagation` on pointerdown does not suppress the native drag — only the
tagName test does. `<select>` was added for U2's credit type for exactly this
reason. A `<summary>` is the next such child: without it, a click-and-twitch on
the disclosure starts a row drag instead of toggling.

### System-wide impact

`renderRankedList` is shared by the Priorities step (`#wz-ranked`) and the
in-results Adjust panel (`#wz-rranked`), so every change here lands in both. The
open-state `Set` is shared between them too — acceptable, since the same stat in
both is the same stat, and neither is visible while the other is.

### Risks

| Risk | Mitigation |
|------|-----------|
| An open panel makes its `<li>` much taller, shifting drop targets mid-drag. | Verify drag-reorder with a panel open during the browser pass (U5). |
| The open-state `Set` outlives the stats in it after deletes and character loads. | Sweep in the delete branch (KTD1); clear on `loadCharacter`, which already resets `declaredCredits` (`web/wizard.js:1404`). |
| Relocating the explainer leaves the original in place, so it renders twice (violates the success criterion). | U3 removes the source element in the same change; asserted in the U3 test scenarios. |
| A shipped `web/*.js` change without a cache-bust reads as "the fix didn't deploy". | DoD requires bumping both `?v` and the footer `BUILD` — four prior PRs missed this. |

---

## Implementation Units

### U1. Extract the pure row model

**Goal:** A pure, exported function that decides what one row's Advanced panel
holds, so R5 and R6 are unit-testable before any markup changes.

**Requirements:** R5, R6 (logic); enables KTD3.

**Dependencies:** none.

**Files:**
- Modify: `web/wizard.js`
- Test: `tests/wizard.test.js`

**Approach:** Add `advancedRowModel(stat, state, vocab)` near the other pure
helpers (`cleanBoundMap`, `cleanCreditMap`, `creditKey`). It returns
`hasAdvanced` (false for presence stats per R6), `floor` and `cap` read from
`state.targetFloors` / `state.targetCaps`, the stat's credit entries, and
`badgeCount` — the number of applied settings, counting a floor, a cap, and each
*usable* credit. Reuse `rankedHTML`'s existing `usable` predicate
(`web/wizard.js:1078`) so a half-typed credit that the solver will drop does not
inflate the badge; a row that reads "1" must have one setting that survives to
the query. Export it from the `module.exports` list at `web/wizard.js:424`.

**Patterns to follow:** the pure-helper-plus-export convention already used by
`cleanBoundMap` and `resolveBundle` — logic outside the DOM closure, DOM code
calls in.

**Test scenarios:**
- A presence stat returns `hasAdvanced: false`; a magnitude stat returns `true`.
- Floor only → `badgeCount` 1. Floor and cap → 2. Floor, cap, two usable
  credits → 4.
- A credit with a blank value, a `0`, or a value above `MAX_CREDIT_VALUE` does
  not count toward `badgeCount`, and the row with only such a credit reports 0.
- A stat with nothing set returns `badgeCount` 0 and null floor/cap.
- Absent `targetCaps` / `targetFloors` / `declaredCredits` maps do not throw.

**Verification:** `node tests/wizard.test.js` passes with the new assertions,
and each fails against the pre-change tree.

---

### U2. The Advanced disclosure — markup, wiring, and rerender survival

**Goal:** The min/max pair and the credits block move inside one closed-by-default
`<details>` per row, and the panel stays open across the rebuilds that current
handlers trigger.

**Requirements:** R1, R2, R5, R6; KTD1, KTD2, KTD5, KTD6.

**Dependencies:** U1.

**Files:**
- Modify: `web/wizard.js`
- Test: `tests/wizard.test.js`

**Approach:** `rankedHTML` composes from `advancedRowModel`. Rows with
`hasAdvanced` emit a `<details class="wz-adv">` whose `<summary>` reads
"Advanced" plus the KTD4 count badge when `badgeCount > 0`; rows without emit an
empty cell in the same column (KTD5). The existing `.wz-bounds` inputs and the
`creditsHTML(stat)` output move inside the panel unchanged — same `data-min` /
`data-max` / `data-cval` / `data-ctype` / `data-cadd` / `data-crem` attributes,
so every handler in `renderRankedList` keeps working untouched.

Add a module-scoped `Set` of open stat names (KTD1). In `renderRankedList`, wire
each `<details>`'s `toggle` to add or delete its stat, and set the `open`
attribute from the Set while composing. Sweep the removed stat from the Set in
the `data-del` branch alongside the existing bounds and credits cleanup, and
clear it in `loadCharacter`. Add `SUMMARY` to the `ondragstart` tagName
allowlist (KTD6).

**Execution note:** The rerender-survival behavior is the reason this unit
exists — write the failing assertion for it first. Adding a credit calls
`rerender()`, which rebuilds `innerHTML`; prove the panel closes before wiring
the Set, so the fix is demonstrably load-bearing.

**Patterns to follow:** the tagName-allowlist comment at `web/wizard.js:1185`
explains precisely why the guard is shaped that way — extend it, do not replace
it with a `closest()` check.

**Test scenarios:**
- The open-state Set survives a simulated rebuild: mark a stat open, rebuild,
  the stat is still in the Set.
- Deleting a priority removes its stat from the open Set, and from
  `targetCaps`, `targetFloors`, and `declaredCredits` as before (guard the
  existing behavior while the branch is edited).
- Reordering two priorities leaves the open Set unchanged — the panel follows
  the stat, not the index.
- `loadCharacter` clears the open Set.
- A presence-stat row produces no `<details>`.
- Credit add/remove/rekey still mutate `state.declaredCredits` exactly as
  before — the handlers moved but did not change.

**Verification:** `node tests/wizard.test.js` passes; the rerender-survival
assertion fails against the pre-change tree. Drag, disclosure, and layout
behavior are deferred to U5's browser pass.

---

### U3. Panel contents — default lead, relocated explainer, "already have" context

**Goal:** The panel explains itself: the default first, then what min and max do,
then the credit affordance with its sources named on screen.

**Requirements:** R3, R4, R7.

**Dependencies:** U2.

**Files:**
- Modify: `web/wizard.js`
- Test: `tests/wizard.test.js`

**Approach:** The panel opens with the R4 default line — no minimum and no
maximum are set, and the solver takes as much of this stat as it can fit without
giving up anything ranked above it. The two explainer paragraphs at
`web/wizard.js:852-853` move in beneath the inputs, and the standalone
`<details class="wz-bounds-help">` block is **deleted** from `stepPriorities`
(R3: relocated, not duplicated). The `+ already have` button gains visible
parenthetical context naming character effects from trances, enhancements, and
epic destinies (R7). Its existing `title` currently names a *different*
set — "a trance, past life, filigree, or ship buff" (`web/wizard.js:1095`) —
so the tooltip is broadened to cover both lists rather than left to contradict
the new visible text.

**Test scenarios:**
- `stepPriorities()` output contains no `wz-bounds-help` element.
- The min/max explainer text appears exactly once in the assembled step.
- The "already have" affordance's visible text names trances, enhancements, and
  epic destinies — not only its `title`.

**Verification:** `node tests/wizard.test.js` passes; the "exactly once"
assertion fails against a tree where the source element was copied rather than
moved.

---

### U4. Bundles — reorder, Attributes, Warlock

**Goal:** Bundles lead with the affix players want first, and cover ability
scores and Warlock.

**Requirements:** R8, R9, R10, R11, R12.

**Dependencies:** none — independent of U1–U3, safe to land in either order.

**Files:**
- Modify: `web/wizard.js`
- Test: `tests/wizard.test.js`

**Approach:** Reorder the `Basic` and `Ranged` arrays in `PRESET_BUNDLES`
(`web/wizard.js:366`) per R8 and R9 — reorder only, same membership. Add
`Attributes` and `Warlock` entries. In `BUNDLE_GROUPS`, append `Warlock` to
`packages` (R11) and add an `attributes` group rendered **above** the tactics row
in `stepPriorities` (R10). `Attributes` is always visible, not gated behind
`BUNDLE_REVEALS`.

**Patterns to follow:** the existing `wz-bundle-row` / `wz-bundle-tag` markup at
`web/wizard.js:831`. Attributes needs no `hidden` attribute and no `data-group`
reveal wiring, unlike the tactics and spellpower rows.

**Test scenarios:**
- `PRESET_BUNDLES.Basic` starts with the six R8 affixes in order and still
  contains all six trailing affixes — assert membership is unchanged, so a
  reorder cannot silently drop one.
- `PRESET_BUNDLES.Ranged` likewise for R9, retaining Ranged Alacrity and
  Accuracy.
- `resolveBundle("Warlock", vocab)` returns all fourteen affixes — none dropped
  by the dataset filter (R12 would silently swallow a typo otherwise).
- `resolveBundle("Attributes", vocab)` returns the six ability scores.
- `addBundle("Warlock", ["Charisma"], vocab)` does not duplicate Charisma and
  preserves the existing entry's position.
- `BUNDLE_GROUPS.packages` contains Warlock; the rendered step shows the
  Attributes row above the Tactics row.

**Verification:** `node tests/wizard.test.js` passes. The Warlock and Attributes
resolution tests are the ones that matter — they prove no bundle ships a dead
target.

---

### U5. Styling, cache-bust, and browser verification

**Goal:** The redesigned row looks uniform and deployed code is what players get.

**Requirements:** R1, R2 (visual); all of the above (verification).

**Dependencies:** U2, U3, U4.

**Files:**
- Modify: `web/styles.css`, `web/index.html`

**Approach:** Style `.wz-adv` and its summary to sit quieter than the reorder
controls, and the count badge to read as a state marker rather than a button.
Remove or repurpose the now-unused `.wz-bounds-help` rules
(`web/styles.css:772-776`). The panel's inner `.wz-bounds` and `.wz-credits`
rules mostly carry over; `.wz-credits` currently uses `flex-basis: 100%` to force
its own line within the row (`web/styles.css:780`) — inside the panel that is
likely no longer needed.

**Execution note:** Verification here is a runtime pass, not unit coverage —
serve `web/` over localhost and drive it with Claude-in-Chrome, the loop already
used in this project family.

**Test scenarios:** `Test expectation: none — styling and stamps.` Behavior is
covered by U1–U4; the browser pass below is the verification.

**Verification (browser pass, all required):**
- Collapsed rows show only grip, rank, name, reorder — and the columns line up
  across magnitude and presence rows.
- Opening a panel, clicking "+ already have", and typing a value leaves the
  panel open throughout.
- The count badge appears on setting a floor and clears on removing it.
- Dragging a row to reorder works with a panel open, and dragging *by the
  summary* toggles rather than dragging (KTD6).
- The same behavior in the in-results Adjust panel.
- Warlock and Attributes bundles populate the list in one click.

**Cache-bust:** bump both the `?v` query on the changed `web/*.js` references in
`web/index.html` and the footer `BUILD` string. Shipping browser code is the
trigger, not bumping `?v` — four prior PRs bumped neither and the footer
under-reported for two days.

---

## Verification Contract

| Gate | Command / method |
|------|------------------|
| JS suite, file by file | `for t in tests/*.test.js; do node "$t"; done` — `node a.js b.js` runs only the first and has silently skipped the golden solver check before |
| Python suite | `python3 tests/run_tests.py` |
| New tests are load-bearing | Export `main` to a scratch dir, copy `web/data/` and `web/vendor/` in, copy the new tests over, run them — anything still passing covers nothing |
| Runtime behavior | Browser pass per U5, over a localhost server |
| Deploy visibility | `?v` and footer `BUILD` both bumped |

No golden or parity movement is expected: this change never reaches the solver.
A diff in `tests/solver_golden.test.js` means something leaked out of the UI
layer and must be explained, not re-ratified.

## Definition of Done

- R1–R12 satisfied, with R5 and R6 asserted through the exported row model
  rather than observed in a browser.
- The min/max explainer appears exactly once in the Priorities step.
- Opening a panel and adding a credit inside it does not close the panel.
- Dragging by the summary toggles the disclosure instead of starting a drag.
- Warlock and Attributes both resolve to their full affix lists — nothing
  silently dropped by `resolveBundle`.
- Both suites green; new tests proven to fail against `main`.
- `?v` and footer `BUILD` bumped in the same change.
- No solver, bounds-model, or credit-model behavior changed; no new persisted
  state.

## Sources

- Origin: this file, enriched in place from its requirements-only revision.
- `docs/plans/2026-08-08-004-feat-declared-stat-credits-plan.md` — the credit
  model whose UI this reorganizes.
- Twelve augment-only stats added to `CORE_STATS` on this branch, including
  `Eldritch Blast Dice`, which R11 depends on.
