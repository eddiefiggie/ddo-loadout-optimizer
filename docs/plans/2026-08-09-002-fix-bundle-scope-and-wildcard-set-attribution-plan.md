---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
title: Bundle Scope Correction and Wildcard Set Attribution - Plan
date: 2026-08-09
---

# Bundle Scope Correction and Wildcard Set Attribution - Plan

## Goal Capsule

**Objective.** Two independent corrections to the Priorities and Results surfaces.
First, pull the affix bundles back to what was actually asked for: PR #185 padded
the Warlock package, batched the ability scores, and hid three bundle rows that
had always been on screen. Second, make a wildcard set piece — the Gem of Many
Facets and its family — visible as a set contributor everywhere the app already
attributes sets, because the solver counts it and no display does.

**Product authority.** This document. Group A supersedes R8–R12 of
`docs/plans/2026-08-09-001-feat-priorities-ui-cleanup-plan.md` where they conflict.

**Open blockers.** None.

---

## Product Contract

### Problem

**Group A — the bundles overshot.** Three separate overreaches shipped in #185:

- **Warlock carries fourteen affixes** when the request was the warlock mechanics
  themselves. Only two warlock-mechanic stats are rankable in the catalog —
  `Power in Pact` and `Eldritch Blast Dice`. The other twelve are generic caster
  stats (Charisma, Spell Focus Mastery, Potency…) plus three elemental damage
  families. The original brief asked to "find others"; the honest answer was that
  there are none, and the bundle was padded instead of reporting that.
- **Ability scores ship as one batch button.** Clicking `Attributes` adds all six.
  The intent was a typing shortcut for a stat a player always wants — not a way to
  rank all six at once, which almost nobody wants.
- **Three bundle rows disappeared.** Tactics, Spell power, and Spell schools were
  visible at all times for the life of the feature, because
  `.wz-bundle-row { display: flex }` overrode the `hidden` attribute. #185 made the
  intended progressive disclosure work for the first time, which removed three rows
  of buttons the player had been using.

**Group B — a wildcard set piece is invisible as a set contributor.** The solver is
correct: a chosen-membership pick self-seeds the set threshold
(`web/solver.js:776`), so a Gem of Many Facets genuinely completes a set. Every
display disagrees, because all three attribution paths read only an item's
**static** `set_bonus` field:

| Surface | Reader | Result |
|---|---|---|
| Set frame / glow | `slotSetNames` reads `v.set_bonus` (`web/projection.js:207`) | Gem has no static set, so no `.is-set` frame |
| Ranked Priorities source | `activeSetDetail` builds `yields` from `c.variant.set_bonus` (`web/projection.js:216-221`) | The gem's slot never enters the source list — the player sees "the ring" alone |
| Set Bonuses tab | `satisfiedSetDetail` builds `members` from `c.variant.set_bonus` (`web/projection.js:243-247`) | A gem-completed set falls through to the fallback with `members: []`, so the card shows a tier number and names nothing |

The runtime picks already exist — `membershipPlaced` entries are `{host, set, station}`
and `jokerPlaced` entries carry a host and set; `buildCraftMaps`
(`web/projection.js:271-290`) already groups both by host. Nothing needs
re-deriving. Three readers ask the wrong field.

This is shape (b) of the declared-credit failure — *a claim sourced from a
different layer than the one that produced the outcome*
(`docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md`). The
fix is to read the solver's report, not to reword anything. That doc also records
that all four instances were caught by review and none by a test.

### Goals

- Bundles that match what was asked: a warlock shortcut, an ability-score shortcut,
  and the rows that were always there.
- A wildcard set piece reads as part of its set, in the same visual language as any
  other piece, wherever sets are attributed.
- A set bonus always names the pieces producing it, each tied to its slot.

### Non-goals

- No change to solver behavior. The solve already counts wildcard pieces correctly;
  this is attribution only.
- No change to which stats are rankable, and no re-harvest of set definitions.
- No new set mechanics. Group B surfaces existing picks, it does not add any.

### Requirements

#### Group A — bundle scope

| ID | Requirement |
|----|-------------|
| R1 | *(session-settled: user-directed — chosen over the fourteen-affix bundle shipped in #185.)* The `Warlock` bundle contains exactly `Power in Pact` and `Eldritch Blast Dice`. It stays on the top packages row beside Trapping. |
| R2 | *(session-settled: user-directed — chosen over a single batch button that adds all six.)* The six ability scores are offered as six individual buttons, each adding only itself: Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma. The batch `Attributes` bundle is removed. |
| R3 | *(session-settled: user-directed — chosen over the progressive disclosure the code intends.)* Every bundle row is visible at all times. Tactics, Spell power, and Spell schools no longer wait on a package click. |
| R4 | `Basic` and `Ranged` keep the order established in #185, with membership unchanged. Nothing in this change touches their contents. |
| R5 | The code comment describing Melee-reveals-Tactics and Caster-reveals-schools is rewritten to record that flat visibility is the deliberate choice, so the disclosure is not "restored" by a later reader. |

#### Group B — wildcard set attribution

| ID | Requirement |
|----|-------------|
| R6 | One shared resolver answers "which sets is this equipped item contributing to?" from three inputs together: the item's static `set_bonus`, the runtime membership picks, and the runtime wildcard/joker picks. Every attribution surface reads it; none re-derives the answer. |
| R7 | A wildcard piece contributing to a completed set receives the same set-colored frame as any other contributing piece, and names **every** set it is feeding. A Gem of Many Facets takes one membership from each of two independent pools, so a single slot commonly feeds two sets at once. |
| R8 | *(session-settled: user-approved — chosen over identical treatment.)* The existing `Wildcard set: X` chip is retained alongside the frame. A wildcard slot and an intrinsic member are both set contributors, but they are not interchangeable, and the display should not imply they are. |
| R9 | Ranked Priorities lists the wildcard piece among the sources of a set bonus, alongside the intrinsic pieces. |
| R10 | The Set Bonuses tab names every contributing piece for each active set, associated with the slot it occupies. A set never presents a bare count with no members. An Augment Set has no worn members — it names its Set Augment copies and the item each is slotted into, read verbatim from `setAugmentsPlaced[].host`. |
| R11 | The same attribution reaches every share export. A shared build must not omit a piece the solve counted. |
| R12 | The fix covers the whole wildcard family, not one item: chosen-membership hosts (Vecna Lost Purpose, Cannith Repurposing Station, Dino Set-Bonus) and wildcard/joker hosts (the Gem of Many Facets family) are attributed by the same resolver. |

### Key decisions

- **Warlock stays on the packages row despite being a two-affix shortcut**
  *(session-settled: user-directed)*. It is a different shape from the role
  archetypes beside it — `Basic` carries twelve — but that is where it was asked
  for. If the row later reads as mixed, the ability-score row is the natural home
  for shortcuts.
- **Flat bundle visibility overrides the code's stated design.** The progressive
  disclosure never functioned, the flat layout is what has been in use, and it is
  the chosen behavior. R5 exists so this reads as a decision rather than a
  regression.
- **Keep the CSS rule, drop the markers.** `.wz-bundle-row[hidden]` is correct CSS
  hygiene and stays; these rows simply stop being marked hidden. A row marked
  hidden in future will then actually hide.
- **Attribution is a read-side fix.** Group B adds no solver concept. The
  temptation to give the gem a synthetic static `set_bonus` is rejected: that would
  put a runtime decision into item data and make the catalog lie.

### Scope boundaries

Group A and Group B are independent and touch different files. They are batched
because they are one round of feedback, not because either depends on the other.

**Browse is deliberately out of scope** *(session-settled: user-approved)*.
`web/browse.js` has its own set-shape resolver from an earlier plan, and it stays.
Browse answers "what could this item do", reading the catalog with no solve in
hand — there is no `membershipPlaced` to consult. The four surfaces here answer
"what did this build do". Different question, different input, legitimately
different resolver. R6's "none re-derives the answer" is scoped to those four.

The tab's "N pieces" label is the **tier threshold**, not a count of equipped
items. R10 adds the member list; it does not redefine that number.

### Success criteria

- Clicking `Warlock` adds two priorities. Clicking `Constitution` adds one.
- All bundle rows are on screen before any package is clicked.
- With a Gem of Many Facets completing a set, the gem's slot carries the set frame,
  Ranked Priorities names it among that set's sources, and the Set Bonuses tab lists
  every contributing piece with its slot.
- A shared export of that build names the same pieces the app does.

### Assumptions

| ID | Assumption |
|----|-----------|
| A1 | The solver's wildcard accounting is correct and needs no change; only the readers are wrong. **Re-anchored during planning:** the original citation pointed at the Set Augment block's *mirror* of the mechanism. The chosen-membership self-seed is `web/solver.js:776`. |
| A2 | **Narrowed during planning — the original form was wrong.** Both lists key on `variant_id`, not slot, and `buildCraftMaps` groups by host id. When the same variant is worn in two slots (two rings), the maps cannot say which slot received the pick, so every duplicate slot would show the chip. R10 requires slot association, so U3 keys the resolver by `(slot, variant_id)` rather than host alone. |

### Outstanding questions

- **Q1 — resolved during planning.** The solver already answers half of it and the
  two families differ. `jokerPlaced` is filtered by `realShort` (`web/solver.js:1140-1163`)
  — a joker is reported only when the set is active *and* its non-joker pieces fall
  short, so a redundant Gem pick is absent and shows no frame at all.
  `membershipPlaced` is filtered only on the set being active, so a redundant
  membership pick does show. That asymmetry is intended and is recorded here so it
  reads as behavior rather than a bug.

---

## Planning Contract

**Product Contract preservation:** changed R7, R10, A1, A2, Q1, plus a new browse
scope boundary. R7 and A1/A2 are factual corrections from research — the Gem takes
one membership from *each* of two pools so a slot commonly feeds two sets; the
self-seed citation pointed at the Set Augment mirror; the placement maps key on
`variant_id`, not slot. R10's Augment Set carve-out and the browse exclusion are
substantive and were confirmed with the user before writing units.

### Key Technical Decisions

**KTD1 — The resolver is one `function` in `web/projection.js`, never a per-file
alias.** `web/*.js` are classic scripts sharing one global scope. A shared
identifier declared as `const` in more than one file is a redeclaration that aborts
script parsing and blanks the app, which has happened twice here
(`docs/solutions/conventions/shared-classic-script-globals-use-var-not-const.md`).
`results.js` and `exporters.js` already call into `projection.js` as `Proj.*`, so a
single declaration needs no alias at all. Node passing is not evidence — each
`require()` gets its own module scope, so the collision is browser-only.

**KTD2 — The resolver is suppression-aware, and suppresses only the static
component.** All three functions it replaces already subtract
`suppressedHostIds(build)`: a Set Augment slotted into an item suppresses that
item's intrinsic sets (`docs/wiki-evidence/augment-sets.md`), and the solver has
already dropped them from `setsActive`. A resolver that unions static + membership
+ joker without that input silently re-adds a piece the solver removed — and R10
would then name it. Suppression applies to the item's *intrinsic* membership only;
a runtime pick on a suppressed host is a separate decision the solver made
independently.

**KTD3 — `slotSetNames` keeps a static-only caller.** `project()` builds its
`suppressedSets` disclosure from `slotSetNames(v)` (`web/projection.js:507`), which
must keep meaning "the intrinsic sets this host gave up". Blanket-replacing every
`slotSetNames` call site with the new resolver corrupts that field. Only the
glow/attribution call sites move.

**KTD4 — The resolver returns a list of sets per slot, keyed by `(slot, variant_id)`.**
Two independent reasons: a Gem takes one membership from each of two pools, so one
slot commonly feeds two sets; and the same variant can occupy two slots, which a
host-keyed map cannot disambiguate (A2).

**KTD5 — Name it for the concept the repo already has.** `CONCEPTS.md` defines
**set contributor** — intrinsic member, chosen-membership host, wildcard piece —
and states the rule this plan implements. Use that vocabulary rather than a synonym.

**KTD6 — `BUNDLE_REVEALS` is retired, not left inert.** R3 makes every row visible,
which leaves the map, its reveal handler, and two tests pinning it with nothing to
do. A dead map plus green tests asserting its contents is the unfalsifiable shape
the #185 post-mortem names. Remove all three together.

### Risks

| Risk | Mitigation |
|------|-----------|
| The shared resolver blanks the app in the browser while every node test passes. | KTD1 (single declaration, no alias) plus the U6 browser pass. Node cannot see this class. |
| The resolver re-adds a suppressed host's intrinsic set, and R10 names it. | KTD2; U3 test scenario asserts a suppressed host contributes nothing statically but still reports its runtime pick. |
| Group A's tests pass without constraining anything — the #185 failure repeating in the same file. | Every Group A test gets the mutation check, not just a pre-change-tree run (`docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`). |
| `tests/solver_golden.test.js` moves. | That would mean the attribution-only non-goal was violated. Do not re-ratify — investigate. |

---

## Implementation Units

### U1. Bundle definitions, and retire the reveal map

**Goal:** `Warlock` is two affixes, the six ability scores are individual bundles,
and `BUNDLE_REVEALS` is gone.

**Requirements:** R1, R2, R4; KTD6.

**Dependencies:** none.

**Files:** Modify `web/wizard.js` · Test `tests/wizard.test.js`

**Approach:** `PRESET_BUNDLES.Warlock` becomes `["Power in Pact", "Eldritch Blast Dice"]`.
Replace the `Attributes` entry with six single-affix bundles, one per ability score,
and point `BUNDLE_GROUPS.attributes` at those six keys. `Basic` and `Ranged` are
untouched. Delete `BUNDLE_REVEALS`, its export, and its reveal handler.

**Patterns to follow:** the existing single-affix bundles (`Stunning`, `Sundering`,
`Vertigo`) are already one-affix entries — the ability scores take the same shape.

**Test scenarios:**
- `resolveBundle("Warlock", vocab)` returns exactly the two affixes, neither dropped
  by the dataset filter. Keep the existing test's *intent*: `resolveBundle` silently
  drops unknown names, and `Eldritch Blast Dice` only resolves because the
  augment-only stats reached `CORE_STATS`.
- Each ability-score bundle resolves to exactly one affix, and clicking one adds one
  priority.
- `Basic` and `Ranged` membership and order are unchanged (set equality against the
  current arrays).
- `BUNDLE_REVEALS` is absent from the module exports, and no test still pins it.
- The existing `tests/wizard.test.js` assertions for the fourteen-affix Warlock, the
  six-affix `Attributes`, and the two `BUNDLE_REVEALS` pins are updated or removed —
  not left asserting a shape that no longer exists.

**Verification:** `node tests/wizard.test.js` passes; each changed assertion fails
against a tree where the corresponding production change is reverted.

---

### U2. Bundle rows always visible

**Goal:** Every bundle row renders on load, and the comment says that is deliberate.

**Requirements:** R3, R5.

**Dependencies:** U1.

**Files:** Modify `web/wizard.js` · Test `tests/wizard.test.js`

**Approach:** Drop the `hidden` attribute from the tactics, spellpower, and schools
rows, and the ability-score row renders the six buttons. Keep the
`.wz-bundle-row[hidden]` CSS rule — it is correct, and a row marked hidden in future
should hide. Rewrite the `PRESET_BUNDLES` header comment: the flat layout is chosen,
progressive disclosure was never functional, and it should not be reinstated.

**Test scenarios:**
- `stepPriorities()` source carries no `hidden` attribute on any bundle row.
- All five group rows render, ability scores among them.
- The comment no longer describes Melee-reveals-Tactics as current behavior.

**Verification:** `node tests/wizard.test.js` passes; confirmed visually in U6.

---

### U3. The set-contributor resolver

**Goal:** One pure, exported function answering "which sets does this equipped slot
contribute to?" from all three contributor kinds, suppression-aware.

**Requirements:** R6, R12; KTD1, KTD2, KTD4, KTD5.

**Dependencies:** none.

**Files:** Modify `web/projection.js` · Test `tests/projection.test.js`

**Approach:** Add a `setContributors(build)` function beside `slotSetNames` returning
a map keyed by `(slot, variant_id)` to a list of `{set, kind}` where `kind` is
`intrinsic`, `membership`, or `wildcard`. Static membership comes from
`v.set_bonus` minus `suppressedHostIds(build)`; runtime membership from
`membershipPlaced`; wildcard from `jokerPlaced`. Declared once in `projection.js`
and reached as `Proj.setContributors` — no alias in `results.js` or `exporters.js`
(KTD1). `slotSetNames` stays and keeps its static-only caller at
`web/projection.js:507` (KTD3).

**Execution note:** Pure and exported specifically so the suppression and multi-set
cases are unit-testable without a DOM — the same move KTD3 of the previous plan made
for the row model.

**Test scenarios:**
- An intrinsic member reports its set with `kind: intrinsic`.
- A membership host reports its runtime pick; a wildcard host reports its joker pick.
- A Gem holding picks from both pools reports **two** sets for one slot.
- A host suppressed by a Set Augment contributes **no** intrinsic set, but still
  reports any runtime pick it holds.
- The same variant worn in two slots attributes each pick to the correct slot, not
  to both.
- A build with no runtime picks produces exactly what `slotSetNames` produced before
  — the no-change guard.

**Verification:** `node tests/projection.test.js` passes; the multi-set and
suppression scenarios fail against the pre-change tree.

---

### U4. Wire the three in-app surfaces

**Goal:** The paperdoll frames a wildcard piece, Ranked Priorities lists it as a
source, and the Set Bonuses tab names every piece with its slot.

**Requirements:** R7, R8, R9, R10.

**Dependencies:** U3.

**Files:** Modify `web/results.js`, `web/projection.js` · Test `tests/results.test.js`

**Approach:** The glow decision and `activeSetDetail`'s `yields` read
`setContributors`. `satisfiedSetDetail`'s `members` becomes a list of
`{slot, item, kind}` rather than bare `variant_id`. The Set Bonuses card renders
every member with its slot; an Augment Set names its copies and their hosts from
`setAugmentsPlaced[].host` read verbatim. The existing `Wildcard set: X` chip stays
(R8).

**Test scenarios:**
- A gem-completed set glows on the gem's slot and names both of its sets.
- Ranked Priorities set-source attribution includes the gem's slot alongside the
  intrinsic pieces.
- A Set Bonuses card never renders with zero members — including an Augment Set,
  which names three copies and their host items.
- A suppressed host does not appear as a member of the set it gave up.
- A redundant membership pick still shows; a redundant joker never reaches the
  display because the solver filtered it (Q1).

**Verification:** `node tests/results.test.js` passes; confirmed visually in U6.

---

### U5. Carry the attribution into every export

**Goal:** No share format omits a piece the solve counted.

**Requirements:** R11.

**Dependencies:** U3, U4.

**Files:** Modify `web/projection.js`, `web/exporters.js` · Test `tests/exporters.test.js`

**Approach:** `project()` currently drops `members` when mapping
`satisfiedSetDetail` (`web/projection.js:511`) — carry it through, and the portable
JSON inherits it. The five text formats each render `view.sets` by hand
(`web/exporters.js:172, 211, 254, 291, 467`); each needs its own member line, and
the CSV needs a column. This is one projection line plus five renderers, not one
change.

**Test scenarios:**
- The portable JSON carries members with slots for a gem-completed set.
- Each of the five text formats names the gem among that set's pieces.
- The CSV row carries the members column.
- An undeclared/no-wildcard build exports byte-identically to before — the no-change
  guard.

**Verification:** `node tests/exporters.test.js` passes. The standing invariant is
that a mechanic is never solve-visible but share-invisible
(`tests/exporters.test.js:565`).

---

### U6. Cache-bust and browser verification

**Goal:** Deployed code is what players get, and both groups are confirmed in a real
browser.

**Requirements:** all of the above.

**Dependencies:** U1–U5.

**Files:** Modify `web/index.html`, `web/app.js`

**Execution note:** Runtime verification, not unit coverage. Clear
`localStorage`/`sessionStorage` first — the wizard persists state and a stale
character manufactures phantom bugs. Trust a live DOM query over a screenshot, but
take the screenshot too: the last two rounds each shipped a defect that only a
screenshot revealed.

**Test scenarios:** `Test expectation: none — stamps and runtime verification.`

**Verification (browser pass, all required):**
- All bundle rows visible on load; Warlock adds two priorities; one ability-score
  button adds one.
- A build using a Gem of Many Facets: the gem's slot carries the set frame, names
  both sets, and keeps its wildcard chip.
- Ranked Priorities names the gem among that set's sources.
- Every Set Bonuses card names its pieces with slots.
- A shared export of that build names the same pieces.

**Cache-bust:** bump both the `?v` query in `web/index.html` and the footer `BUILD`
string in `web/app.js`.

---

## Verification Contract

| Gate | Method |
|------|--------|
| JS suite, file by file | `for t in tests/*.test.js; do node "$t"; done` — `node a.js b.js` runs only the first |
| Python suite | `python3 tests/run_tests.py` |
| Tests constrain behavior | Mutate the line each new test claims to cover and confirm the suite reddens. A pre-change-tree run alone is insufficient here — source-regex tests clear it for free |
| Golden must not move | `tests/solver_golden.test.js` unchanged. Movement means the attribution-only non-goal was violated — investigate, do not re-ratify |
| Browser | U6 pass over a localhost server, storage cleared |
| Deploy visibility | `?v` and footer `BUILD` both bumped |

## Definition of Done

- R1–R12 satisfied, with the resolver's suppression and multi-set behavior asserted
  in unit tests rather than observed in a browser.
- No bundle row is hidden; `BUNDLE_REVEALS` and its tests are gone, not inert.
- A Gem of Many Facets shows its frame, both its sets, and its wildcard chip; appears
  as a source in Ranked Priorities; and is named with its slot in the Set Bonuses tab
  and every export.
- No Set Bonuses card renders a count with no members, Augment Sets included.
- Both suites green; golden unmoved; new tests proven to fail on mutation.
- `?v` and footer `BUILD` bumped.
