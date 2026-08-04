---
title: Constraint & Nav Quick-Wins Batch - Plan
type: fix
date: 2026-08-04
topic: constraint-nav-quickwins
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Constraint & Nav Quick-Wins Batch - Plan

## Goal Capsule

**Objective:** Fix four logged issues in one batch — three equip-legality / pin correctness fixes and
one wizard-navigation polish. Three change solver output (#107, #108, #90) and re-ratify the golden
solves; one is pure UI (#105).

**Product authority:** eddiefiggie. Issues from `data/bug_reports.txt`. DDO rules touched here are
structural (armor proficiency, weapon handedness, forged-race docents) and already partially modeled;
confirm against the existing gates, wiki-verify only a genuinely uncertain rule.

**Open blockers:** none. Delivery: single PR, four fixes + a golden/build unit.

**Product Contract preservation:** unchanged. #90 confirmed split — constraint-violation half in scope,
under-leveled/empty-slots half routes to #91.

---

## Context / Why now

Highest-value small items from the backlog. #107/#108 are gaps adjacent to shipped work (weapon/off-hand
constraints PRs #77/#78/#79; pin machinery PR #86). #90 is a correctness cluster the issue itself
hypothesizes is mis-tagged data slipping existing, unit-tested gates (`isForgedRace`, armor-proficiency).
#105 is bounded UI normalization.

---

## Product Contract

### Requirements

- **R1 — #107:** an off-hand shield must forbid two-handed main-hand weapons. Restrict Main Hand to
  one-handed weapons (plus crossbows per the rune-arm rule) whenever a shield is in the off hand.
- **R2 — #108:** honor a legal pin regardless of item ML vs the character ML cap. A below-cap-but-legal
  pin stays pinned and in the loadout; never silently dropped/replaced.
- **R3 — #105:** consistent back/advance navigation on every wizard step — Back bottom-left, Advance
  bottom-right — including the two ends (step 1 intro, step 5 results).
- **R4 — #90:** no returned loadout violates the character's body-slot / armor-type / race constraints.
  Three sub-cases: (1) docent on a non-forged race; (2) wrong armor type (robe returned when Heavy
  selected); (3) under-leveled forged docent — fix the constraint/tag half; the empty-slots/niche-pick
  half is #91.

### Key Decisions

- **KTD-1 — #107 is the symmetric partner of an existing constraint.** The model already blocks
  off-hand items under a two-hand main-hand weapon (`web/model.js:212`, "R9/B5"). This adds the reverse:
  when the off hand holds a shield, forbid `isBothHandsWeapon` (`web/model.js:408-448`) in Main Hand.
  Reuse `offHandGate` / the weapon-handedness taxonomy — no new taxonomy.
- **KTD-2 — #108 is a pin-precedence gap, not new logic.** A pin already overrides the soft `mlFloor`
  (`web/model.js:159-160`); the bug is a *below-cap* legal pin being dropped elsewhere. Find the drop
  site (a below-cap exclusion or a `dominanceFilter` mlCap path) and let a pinned variant bypass it.
- **KTD-3 — #90 is diagnosis-first, likely data-tagging.** The race→docent gate (`isForgedRace`,
  `web/model.js:70-82`, with a hardened non-name docent check at `:77-82`) and the armor-type gate
  (`:220`, R6/AE1) exist and are tested. Reproduce each sub-case and inspect the offending item's
  `slot` / `armor_type` / race tag before touching gate logic; fix the tag (or the tag-reading path),
  following exclude-until-verified for any data correction.
- **KTD-4 — Golden re-ratify for #107/#108/#90.** They can change optimal builds. Run the golden guard
  locally (not in the ad-hoc sweep) and regenerate only after confirming each changed fixture is a
  correct improvement with no priority target regressed
  (`docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md`).

### Scope Boundaries (out of scope)

- The under-leveled/empty-slots half of #90's third case → #91.
- Sword-and-board combat style (#111) — R1 fixes only the illegal-combo half.
- #106, data-currency #93, block/forbid-items #110.

### Success Signals

- An off-hand shield never coexists with a 2H main-hand weapon in a returned loadout (#107).
- A legal below-cap pin is always honored and present (#108).
- Back/Advance controls sit in the same location on every wizard step (#105).
- No returned loadout violates race/armor-type/body-slot constraints across the three #90 sub-cases;
  a valid Docent option appears in the picker for forged races.
- Golden solves re-ratified; no priority target regressed.

---

## Planning Contract

**Depth:** Standard. **Delivery:** single PR, units in order below. **Execution direction:** #90 is
characterization-first — reproduce each reported case as a failing assertion before changing tags/gates.

### U1. #107 — off-hand shield forbids two-handed main-hand weapons

- **Goal:** When a shield occupies the off hand, exclude two-handed weapons from Main Hand.
- **Requirements:** R1, KTD-1.
- **Dependencies:** none.
- **Files:** `web/model.js` (Main Hand eligibility, symmetric to the R9/B5 off-hand block at `:212`;
  reuse `isBothHandsWeapon` `:408-448` and `offHandGate` `:131`), `tests/model.test.js`.
- **Approach:** Detect an off-hand shield (selected or pinned) and gate Main Hand to non-two-handed
  weapons (one-handed + crossbows per the rune-arm rule). Mirror the existing two-hand→off-hand block.
- **Patterns to follow:** the R9/B5 off-hand configuration block; the handMutex path in `dominanceFilter`.
- **Test scenarios:** shield pinned in off hand + solve ⇒ no quarterstaff/greatsword/greataxe/maul/
  falchion/THF-bow in Main Hand; one-handed weapon still allowed; a crossbow still allowed where the
  rune-arm rule applies; no off-hand shield ⇒ 2H weapons still allowed (no regression).
- **Verification:** `node tests/model.test.js` green; a shield-tank solve returns a legal main-hand.

### U2. #108 — honor legal below-cap pins

- **Goal:** A pinned item legal for the character but below the ML cap stays pinned and equipped.
- **Requirements:** R2, KTD-2.
- **Dependencies:** none.
- **Files:** `web/model.js` (pin handling / `pinConflict` / `dominanceFilter` pin bypass),
  `web/solver.js` (pin constraints if the drop is solver-side), `tests/model.test.js`.
- **Execution note:** Start from a failing test that pins a below-cap legal item and asserts it survives
  the solve, then locate and fix the drop site.
- **Approach:** Identify where a below-cap pinned variant is excluded or replaced; extend the existing
  pin-overrides-`mlFloor` precedence (`web/model.js:159-160`) so a legal pin also bypasses the below-cap
  exclusion. Do NOT weaken the illegal-pin drop (wrong slot/class/config still drops).
- **Test scenarios:** a legal below-cap pin is present in the result; an illegal pin (wrong
  slot/class/config) still drops (no regression); a below-cap pin does not suppress a higher-priority
  legal pick elsewhere.
- **Verification:** `node tests/model.test.js` green.

### U3. #90 — body-slot / armor-type / race constraint violations

- **Goal:** No pick violates race/armor-type/body-slot constraints across the three reported cases.
- **Requirements:** R4, KTD-3.
- **Dependencies:** none.
- **Files:** the data-tag source (`build_dataset.py` / `web/dataset.js` normalization, or the seed for
  the offending items), `web/model.js` (gates only if a logic gap is proven), `tests/model.test.js`,
  `tests/dataset.test.js`.
- **Execution note:** Characterization-first — reproduce each of the three cases as a failing assertion,
  inspect the offending item's `slot`/`armor_type`/race tag, then fix the narrowest cause.
- **Approach:** (1) docent-on-Halfling — confirm the item is tagged/detected as a docent and the R6 race
  gate rejects it for non-forged; also ensure a valid Docent option surfaces in the picker for forged
  races. (2) robe-when-heavy — confirm the robe's `armor_type` (cloth/outfit) and that the armor-type
  gate excludes it when Heavy is selected. (3) under-leveled docent — confirm it's the tag/eligibility
  half (the niche/empty-slot half is #91). Fix mis-tags at the source; touch gate logic only if a gap is
  proven.
- **Test scenarios:** a docent is rejected for a Halfling with Light selected; a Docent option appears
  for a Bladeforged; a cloth robe is excluded when Heavy armor is selected; heavy armor is returned for a
  heavy-armor Paladin; no forbidden body-slot pick across the three inputs.
- **Verification:** `node tests/model.test.js` + `node tests/dataset.test.js` green; the three reported
  inputs return legal loadouts.

### U4. #105 — consistent wizard navigation

- **Goal:** Back/Advance controls in the same location on every step.
- **Requirements:** R3.
- **Dependencies:** none.
- **Files:** `web/wizard.js` (the `wz-actions` rows — step 1 `data-next` at `:364`; steps 2–4 back+spacer
  +next at `:470-501`; step 5 results controls), the wizard CSS (`.wz-actions` / `.wz-spacer`),
  `tests/wizard.test.js`.
- **Approach:** Normalize every step's action row to Back bottom-left + `wz-spacer` + Advance
  bottom-right. Give step 1 the same row shape (spacer even without a Back). Move step 5's re-solve/adjust
  controls into the consistent bottom bar (default per the confirmed decision; re-solve controls kept
  accessible).
- **Test scenarios:** every step exposes the advance control in the bottom-right position; steps with a
  back control expose it bottom-left; step 1 aligns like the rest; step 5 nav is in the bottom bar.
  `Test expectation: DOM-structure assertions on the wizard action rows.`
- **Verification:** `node tests/wizard.test.js` green; visual pass shows uniform placement across steps.

### U5. Golden re-ratify + BUILD bump

- **Goal:** Re-ratify golden solves after the solver-affecting fixes and stamp the deploy.
- **Requirements:** all (regression safety), KTD-4.
- **Dependencies:** U1, U2, U3.
- **Files:** `tests/parity/golden.json`, `web/app.js` (BUILD stamp), `web/index.html` (`?v=`).
- **Approach:** Run `node tests/solver_golden.test.js`; where fixtures change, confirm each is a correct
  improvement (no priority regressed), then `node tests/parity/capture_golden.js`. Bump the footer BUILD
  stamp and `?v=` together.
- **Test scenarios:** golden guard green after regeneration; no priority target regressed.
- **Verification:** `node tests/solver_golden.test.js` green; footer BUILD matches new `?v=`.

---

## Verification Contract

- `node tests/solver_golden.test.js tests/model.test.js tests/dataset.test.js tests/wizard.test.js`
  (+ any new tests) all green.
- The three #90 reported inputs, the #107 shield-tank case, and a #108 below-cap pin each return a legal
  result on a manual solve.
- Golden re-ratified only after confirming changed fixtures are correct improvements.

## Definition of Done

- R1–R4 satisfied; all success signals met.
- Each fix has a regression test; golden guard green post-regeneration.
- BUILD stamp + `?v=` bumped together; deploy green.

---

## Sources & Research

- `data/bug_reports.txt` — source user feedback (issues #107, #108, #105, #90).
- Seams: off-hand/weapon gate `web/model.js:109-173, 408-448`; race/armor/docent gates
  `web/model.js:70-82, 220`; pin precedence `web/model.js:159-160`; wizard action rows
  `web/wizard.js:364, 470-501`.
- Related shipped work: weapon/off-hand constraints (PRs #77/#78/#79), pin machinery (PR #86).
- `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` — golden re-ratify discipline.
