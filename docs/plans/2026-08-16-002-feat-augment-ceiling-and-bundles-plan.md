---
title: Augment Ceiling and Bundled Enchantments - Plan
type: feat
date: 2026-08-16
topic: augment-ceiling-and-bundles
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Augment Ceiling and Bundled Enchantments - Plan

## Goal Capsule

- **Objective:** Ship the two opt-in refinements from the 2026-08-16 report: an augment-specific ML ceiling (#339) and a Sets-tab bundled-enchantments grouping (#340).
- **Product authority:** Issues #339 and #340 (both claims wiki/data-validated 2026-08-16 — no underlying bugs; both features sit on working-as-designed behavior). The attainability non-goal's carve-out authorizes opt-in exclusion filters.
- **Stop conditions:** Surface rather than guess if any crafted-channel option catalog turns out to draw leveled catalog augments (contradicting the exemption ruling in KTD2), or if the engraved-name provenance turns out to be stamped by a family beyond the four registered ones.
- **Open blockers:** None.

---

## Product Contract

### Summary

Two additions. An **"Augments up to ML __"** numeric input beside the ML cap lets a player at item cap 36 restrict augment answers to tiers they can realistically obtain — defaulting to the item cap, so nothing changes until lowered. A **"Bundled enchantments"** grouping on the Sets tab shows each engraved bundle present on the equipped loadout (Profane Well Rounded, Profane Potency, …) with what it grants and which item or augment carries it.

**Product Contract preservation:** changed: R3, AE3 — the pin-override half was rewritten because augments cannot be pinned at all today (the pinning feature is worn-gear-only), so there is no pin for the ceiling to yield to; the gate carries the exemption rule so it activates if augment pinning ever ships. Confirmed at the 2026-08-16 scoping synthesis.

### Problem Frame

At the default ML cap of 36, the wiki-verified ML36 sale-tier augments outclass every alternative, and a player who cannot realistically obtain them yet has no right-shaped lever: lowering the ML cap also caps items, the blocklist means ticking ~63 augments family-by-family, and Trove/owned mode deliberately never restricts augments.

Separately, bundled enchantments are fully credited but invisible as units: the Essence of the Epic Litany of the Dead's "Profane Well Rounded" renders as six expanded ability lines, and the only place its engraved identity appears is the per-contribution receipts. Players look for "one thing granting several stats" on the Sets tab and conclude the bundle is missing.

### Key Decisions

- KD1. **The ceiling is a player-set number, not a hardcoded "realistic" boundary.** (session-settled: user-directed — chosen over band presets and a fixed "realistic augments" toggle: which tier is realistic moves with every cap raise; a number the player owns never goes stale.)
- KD2. **The ceiling defaults to the item ML cap — no restriction until lowered.** (session-settled: user-approved — the attainability non-goal permits only filters the player chooses; the default must change nothing.)
- KD3. **Bundles surface as a Sets-tab grouping, distinct from sets.** (session-settled: user-directed — chosen over folding into #252 and over receipts-only: the tab is where players look for multi-stat grants; #252's engraved-name work on loadout surfaces stays its own issue.)
- KD4. **The grouping uses the general rule: every engraved bundle on equipped gear shows.** (session-settled: user-approved — includes Potency and other umbrella bundles, not just ability bundles; a Lunar gem's "Profane Potency" row doubles as the disclosure that defuses the recurring lunar-stacking confusion.)
- KD5. **Pins override the ceiling**, matching how pins already override the ML floor. (session-settled: user-approved — a pin is an explicit instruction; filters never silently defeat it. Inert today: augments cannot be pinned, so the gate records the rule for the day augment pinning exists; see KTD1.)

### Requirements

**Augment ML ceiling (#339)**

- R1. The Character step gains an "Augments up to ML __" input beside the ML cap, defaulting to the item cap; values above the cap are clamped to it.
- R2. When lowered, augments with ML above the ceiling are ineligible for the solve — placement, alternatives, and every crafted-augment channel that draws from the augment catalog respect it. (Per KTD2, exactly one channel draws from the leveled augment catalog: the regular augment-slot pool.)
- R3. The result disclosures state the active ceiling on every surface that renders notices, so a restricted solve reads as restricted; the gate carries the pin-exemption rule from KD5 so a pinned augment would stay eligible if augment pinning ever ships.
- R4. The ceiling persists with saved characters and rides the standard input persistence; pre-feature saves load as unrestricted.

**Bundled enchantments on the Sets tab (#340)**

- R5. The Sets tab gains a "Bundled enchantments" grouping listing each engraved bundle present on the equipped loadout, per carrier: the bundle name, the stats it grants (with values and bonus type), and the carrying item or augment.
- R6. Bundles are visually distinct from sets — no piece counts, no tier language; the grouping states plainly that these are single-source enchantments, not sets.
- R7. The grouping is derived from the same engraved-name provenance the receipts already carry — no new data, no re-parse; solve-invisible display only.
- R8. The grouping flows through projection into the exports that render the Sets section (the standing every-mechanic-in-every-export invariant).

### Acceptance Examples

- AE1. **Ceiling restricts.** **Covers R2.** Given ML cap 36 and ceiling 32: no ML36 augment appears in the solution or alternatives; the best ML≤32 augments compete instead.
- AE2. **Default changes nothing.** **Covers R1.** Given the default ceiling: the solve is identical to pre-feature behavior.
- AE3. **Restricted solve reads as restricted.** **Covers R3.** Given ceiling 32: the results and the share exports state the augment ceiling, and a restored saved character shows the same disclosure without a re-solve.
- AE4. **Litany bundle shows.** **Covers R5.** Given the Essence of the Epic Litany of the Dead slotted: the Sets tab lists "Profane Well Rounded — +2 Profane to all six abilities — from Essence of the Epic Litany of the Dead".
- AE5. **Umbrella bundle shows.** **Covers R5, KD4.** Given a Lunar Gem of Spellpower slotted: the grouping lists "Profane Potency" with its elements and carrier.

### Scope Boundaries

**Deferred for later**

- Engraved-name display on loadout/deep-dive surfaces — stays #252.
- Any automatic notion of "realistic" tiers (drop-rate, currency, content gating) — the shared blocker is #197; the ceiling is deliberately manual.

**Outside this product's identity**

- Attainability as a default solver input — the standing non-goal; the ceiling defaults to no restriction.

**Recorded so a later audit does not re-raise it (do not file)**

- The crafted-channel option catalogs (Dino inserts, Sealed-in-X seals, Thunder-Forged, Green Steel, Lamordia Viktranium, Set-Bonus augments) are outside the ceiling by construction: none carries a numeric augment ML in the shipped data (Viktranium and Nearly Finished collapse their source ML into a binary heroic/legendary tier at build time; the rest never had one), and all are already exempt from the existing ML cap and floor the same way. The ML36 sale-tier augments behind the report are all regular slotted augments, so the ceiling fully addresses the complaint.
- Augment pinning — does not exist today and is not built here; KD5's pin exemption ships inert and activates if pinning ever arrives.

### Sources / Research

- Issues #339 / #340 — the validated report, evidence, and existing-lever analysis.
- `docs/wiki-evidence/ml36-augment-tier.md` — the 63-augment tier's provenance (added for the opposite complaint, #260).
- `docs/reports/2026-08-01-bug-report-audit.md` §2 — the standing Well Rounded expansion ruling.
- `web/model.js` — `variantConflict` (~234-254: the cap gate, the floor with its augment exemption and `pinnedIds` override), `queryGates` (~209-226), the augment pool built from `eligible()` (~829-839).
- `web/wizard.js` — ML cap/floor inputs in `stepCharacter` (~1112-1126) and their `oninput` wiring (~2514-2528); `buildQuery` (~359-363, the `mlFloor: Number(...) || null` shape); `isPinnable` (~1317, excludes `category === "augment"`).
- `web/persist.js` — `INPUT_KEYS` (~62-78); the `utility_tier_aware` marker (~70-77) exists to heal a list mutation and is the wrong precedent here — `mlFloor`'s markerless nullable scalar is the right one.
- `web/projection.js` — `collapseExpansions` (~48-103, groups affixes by the `via` provenance key with the no-fabricated-magnitude `parts` rule), `augView` (~944-952, stores raw augment affixes — never collapsed today), `project()` sets view (~1034), `attributionByTarget` (~267-330, rank-keyed — wrong shape for bundles).
- `web/results.js` — notice family wired at ~942-950; Sets tab with the set-like second block at ~1181-1212 (the precedent for a third block).
- `web/exporters.js` — five `view.sets` render sites (~241, ~300, ~367, ~433, ~658), one per export format.
- `docs/solutions/design-patterns/where-a-per-item-gate-may-live-in-the-solver.md` — pin-overridable gates in `variantConflict` must carry their own pin exemption or `reconcilePinLegality` deletes the escape hatch; `pinnedIds` also contains Artifact-opt-in injected variants, not just player pins.
- `docs/solutions/design-patterns/browse-visibility-for-separate-source-pools.md` — reconcile invisible pools with a display-only projection, never by merging into the canonical structure.
- `docs/solutions/conventions/stamp-shared-fixtures-for-new-required-fields.md` — a grouping test needs a populated positive-arm fixture; absence-shaped assertions pass vacuously.
- `docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` — run the golden solver check explicitly in local sweeps.
- `docs/solutions/logic-errors/closure-scoped-ui-state-must-reset-on-character-load.md` — any UI-staged input must reflect loaded character state.
- Dataset facts verified 2026-08-16: augment ML distribution tops at 36 (63 entries); 91 items + the Litany essence carry `via: 'Profane Well Rounded'` expansions.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The ceiling gate is a `variantConflict` sibling of the ML floor, mirroring the floor's exact shape — including the `pinnedIds` exemption.** An augment-only inverted condition (`category === "augment"` and `ml` above the ceiling) placed beside the floor check covers everything downstream automatically: the augment pool is built from `eligible()`, so placement, alternatives, and the browse-view ineligibility reason all inherit the gate from one choke point. The standing rule that a pin-overridable gate in `variantConflict` must carry its own exemption is satisfied by the `pinnedIds` clause; it is inert today (augments cannot be pinned — instantiates KD5, inheriting its session-settled label) and cannot misfire on Artifact-injected `pinnedIds` entries because those are worn items, not augments. `queryGates` gains a `ceiling` field threaded from `query.augCeiling`.
- KTD2. **One channel is gated; the crafted catalogs are exempt by construction.** Only the regular augment-slot pool draws leveled catalog augments through `eligible()`. The crafted option catalogs (dino, seal, Thunder-Forged, Green Steel, Viktranium, Nearly Finished, Set-Bonus augments) are separate synthetic structures with no numeric ML field, already exempt from the existing cap and floor. R2 is fully satisfied by the single gate; the exemption is recorded in Scope Boundaries, not filed.
- KTD3. **Persistence is the `mlFloor` precedent: a nullable scalar in `INPUT_KEYS`, no save marker.** `null`/absent means unrestricted, so a pre-feature save loads as unrestricted for free (`Number(undefined) || null`). The `utility_tier_aware` marker precedent does not apply — it heals a list mutation whose absence is ambiguous; a scalar's absence is not. The **authoritative clamp lives in `buildQuery`, evaluated against the effective cap at query time**: the ceiling is emitted only when positive and below the cap, else `null` — so a cap lowered after the ceiling was written re-normalizes to unrestricted instead of leaving a stale restriction that would make an unrestricted solve read as restricted. The UI input is cosmetic on top of that: it defaults its displayed value to the current cap, refreshes that displayed value from the cap's input handler whenever the ceiling is unset (mirroring the floor's live-update wiring), and clamps an over-cap entry's displayed value on blur. No auto-follow flag is needed because `null` already tracks the cap by meaning rather than by value.
- KTD4. **The ceiling disclosure is input-derived and projection-sourced.** A pure line-generator in `web/projection.js` reads the active ceiling from the query inputs (like the bound notice, not the solve-derived notices), a thin wrapper renders it in the results notice block, and the exports consume the same lines — so a restored character shows it without a re-solve and the every-mechanic-in-every-export invariant holds by construction.
- KTD5. **Bundles are a new pure grouping function in `web/projection.js`, filtered to multi-stat groups.** It scans each chosen item's affixes *and* each assigned augment's affixes (augment affixes are never collapsed anywhere today — this is new logic sharing `collapseExpansions`' group-by-`via` and never-fabricate-a-magnitude rules), groups by the engraved-name provenance key, keeps only groups with 2+ members, and tags each group with its carrier (item or augment name), one entry per carrier occurrence. It emits its **own entry shape carrying the full member list — per-member stat, value, and bonus type** — because `collapseExpansions`' collapsed entries deliberately drop both and cannot back an R5 row. The 2+ filter is what makes "engraved bundle" honest: the `via` key is also stamped by single-stat renames (the Legendary fold, DR qualifier retyping) that would otherwise render as bogus one-line bundles. Cross-added universals need no exclusion branch: cross-add lives in `metadata.cross_add` and on attribution breakdown parts, never on item/augment affix arrays, so the affix-scan input excludes them by construction — the tests guard that assumption rather than an unreachable filter. Consumers: a third Sets-tab block after the set-like block, and a `bundles` view in `project()` rendered at all five exporter sets sites.

### High-Level Technical Design

Two independent data flows; neither touches the other or the solver's objective machinery.

```mermaid
flowchart TB
  subgraph Ceiling ["#339 - augment ML ceiling"]
    A[Character step input] --> B[state / INPUT_KEYS persistence]
    B --> C[buildQuery: nullable augCeiling]
    C --> D[queryGates -> variantConflict augment-only gate]
    D --> E[eligible() -> augment pool, placement + alternatives]
    C --> F[projection ceiling notice lines]
    F --> G[results notice block + all exports]
  end
```

```mermaid
flowchart TB
  subgraph Bundles ["#340 - bundled enchantments (display-only)"]
    H[chosen items' affixes] --> J[group by engraved-name provenance]
    I[assigned augments' affixes] --> J
    J --> K[filter: 2+ members, no crossAdd]
    K --> L[Sets tab third block]
    K --> M[project() bundles view -> five exports]
  end
```

---

## Implementation Units

### U1. Augment ML ceiling: gate, input, persistence

**Goal:** Lowering the ceiling excludes above-ceiling augments from every solve path; the default changes nothing; the value persists.

**Requirements:** R1, R2, R4. Implements KTD1, KTD2, KTD3 (KTD1 cites KD5; KTD3 cites KD2).

**Dependencies:** none.

**Files:** `web/model.js`, `web/wizard.js`, `web/persist.js`, `tests/model.test.js`, `tests/persist.test.js`, `tests/parity/fixtures.json`, `tests/parity/golden.json`.

**Approach:** Add the augment-only ceiling check to `variantConflict` beside the floor check, mirroring its shape including the `pinnedIds` exemption; the conflict reason mirrors the floor's wording (e.g. "above your augment ML 32 ceiling"), which the browse view inherits automatically. Thread `ceiling` through `queryGates` from `query.augCeiling`. In the wizard: a numeric input as its **own standalone field row directly below the ML cap/floor pair** in the Character step (the existing solo-field precedent on that step — do not widen the two-column pair to three), with the display-sync wiring per KTD3. `buildQuery` owns the authoritative clamp per KTD3: emit the ceiling only when positive and below the cap, else null. Add `augCeiling` to `INPUT_KEYS`; the input must reflect loaded character state (the closure-scoped-UI-state learning). Add one ceiling-exercising parity fixture; every pre-existing fixture carries no ceiling and must stay byte-identical in the golden (the conditional-widening pattern).

**Execution note:** Prove the new tests red against the pre-change tree (copy the gitignored `web/data/items.json` into the scratch export first).

**Test scenarios:**
- Happy (Covers AE1): with a ceiling set, `eligible()` excludes an augment above it, keeps one at/below it, and leaves a non-augment item at the same ML untouched (mirror of the existing floor-exemption test).
- Happy (Covers AE2): a query with no ceiling produces eligibility identical to pre-feature; all pre-existing golden fixtures byte-identical.
- Edge: ceiling equal to the cap behaves as unrestricted (stored as null per KTD3); an entry above the cap clamps.
- Edge (stale ceiling): a state with ceiling 32 and cap 30 emits a null query ceiling — no gate effect and no ceiling notice lines; the restriction disclosure never outlives the restriction.
- Edge (display): with the ceiling unset, changing the ML cap updates the ceiling input's displayed value; an over-cap entry's display clamps on blur.
- Edge: ceiling below every augment's ML leaves augment slots unfilled but the solve feasible.
- Contract (future pin exemption): calling the gate directly with an above-ceiling augment whose key is in the pin set returns no conflict — pins the KD5 rule the day augment pinning exists.
- Persistence: `augCeiling` round-trips through save/load; a serialized pre-feature save (no key) loads unrestricted; `INPUT_KEYS` contains the key; loading a character updates the visible input.
- Integration (parity fixture, Covers AE1): cap 36 + ceiling 32 with a spellpower-ranked priority solves deterministically with no ML36 augment chosen.

**Verification:** `python3 tests/run_tests.py` green; changed JS test files green individually; golden diff limited to the one new fixture.

### U2. Ceiling disclosure across surfaces

**Goal:** A restricted solve reads as restricted everywhere results render.

**Requirements:** R3. Implements KTD4.

**Dependencies:** U1.

**Files:** `web/projection.js`, `web/results.js`, `web/exporters.js`, `tests/spell-focus-receipts.test.js` (or a sibling export-parity test file if cleaner).

**Approach:** Pure ceiling-notice line-generator in `web/projection.js` reading the query inputs; thin notice wrapper in `web/results.js` added to the existing notice block; exports render the same lines wherever notices already flow. Input-derived per KTD4, so restored characters show it without a re-solve.

**Test scenarios:**
- Happy (Covers AE3): with a ceiling set, the notice lines name the ceiling value; the Markdown export carries the same line the app renders (the cross-export parity precedent).
- Happy: with no ceiling, no notice lines are produced anywhere.
- Integration (Covers AE3): a restored character with a saved ceiling renders the notice from inputs alone.

**Verification:** changed JS test files green individually; manual spot-check of one export.

### U3. Bundled enchantments on the Sets tab and exports

**Goal:** Every multi-stat engraved bundle on the equipped loadout is visible as one named grant with its carrier, on the Sets tab and in every sets-rendering export.

**Requirements:** R5, R6, R7, R8. Implements KTD5 (cites KD3, KD4).

**Dependencies:** none (independent of U1/U2).

**Files:** `web/projection.js`, `web/results.js`, `web/exporters.js`, `tests/spell-focus-receipts.test.js` or a new `tests/bundles.test.js`.

**Approach:** New pure grouping function in `web/projection.js` per KTD5 (items' + assigned augments' affixes, group by the engraved-name provenance key, filter to 2+ members, tag carrier, one entry per carrier occurrence, emitting its own entry shape with per-member stat, value, and bonus type). Render as a third Sets-tab block after the set-like block, with heading copy stating these are single-source enchantments (R6 — no piece counts, no tier language). Add a `bundles` view to `project()` and render it at all five exporter sets sites. Display-only: no solver, model, or dataset change.

**Test scenarios:**
- Happy (Covers AE4): a fixture with the Litany essence yields a "Profane Well Rounded" group with its six ability members, carrier = the item name.
- Happy (Covers AE5): a fixture with an augment carrying a Potency bundle yields the bundle with its element members, carrier = the augment name — proving the new augment-affix path, which no existing view exercises.
- Edge: single-member provenance groups (a Legendary fold rename, a DR qualifier retype) never appear as bundles.
- Edge (guard): the positive-arm fixtures' affix records carry no cross-add key — pins the KTD5 assumption that cross-add lives in metadata, never on affix arrays, so cross-added universals stay out of the grouping by construction.
- Edge: two carriers of the same bundle produce one entry per carrier.
- Edge: a loadout with no bundles renders no section (and the positive-arm fixtures above are what prove the grouping — the empty case alone is vacuous per the fixture-stamping convention).
- Integration (Covers R8): the Markdown export renders the same bundle lines the app renders; every sets-rendering export includes the grouping when bundles exist.

**Verification:** changed JS test files green individually; goldens untouched (display-only).

### U4. Ship

**Goal:** Verified end to end and deployed.

**Requirements:** R1-R8 landed together.

**Dependencies:** U1, U2, U3.

**Files:** `web/index.html`, `web/app.js`, `README.md`.

**Approach:** Full suites (JS file-by-file, including the golden solver check explicitly). Golden handling per U1: pre-existing fixtures byte-identical, the new ceiling fixture ratified deliberately. Three-way build bump (behavior changes in `web/`). PR body: `Closes #339` and `Closes #340` (keywords outside backticks), with a short player-facing note covering both features and the crafted-channel exemption ruling.

**Test scenarios:** Test expectation: none — ship mechanics; U1-U3 carry the behavior tests and `tests/test_build_stamp.py` enforces the bump.

**Verification:** All suites green; live footer shows the new build after merge.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python suite | `python3 tests/run_tests.py` | U1, U4 |
| JS suite (file-by-file) | `for t in tests/*.test.js; do node "$t"; done` | U1-U4 |
| Prove-red | base-commit scratch export + `web/data/items.json` copied in | U1, U3 |
| Golden capture (new fixture only) | `node tests/parity/capture_golden.js`, per-fixture review; pre-existing fixtures byte-identical | U1, U4 |
| Build stamp | `tests/test_build_stamp.py` | U4 |

---

## Definition of Done

- All four units landed; CI green on `main`; #339 and #340 closed by the PR with the evidence cited.
- AE1-AE5 each demonstrated by a passing test or fixture; pre-existing golden fixtures byte-identical.
- Three-way build bump shipped and live-verified; no abandoned experimental code in the diff.
