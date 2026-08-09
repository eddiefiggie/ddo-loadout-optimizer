---
title: Parrying and Heightened Awareness Affixes - Plan
type: fix
date: 2026-08-08
topic: parrying-heightened-awareness-affixes
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Parrying and Heightened Awareness Affixes - Plan

## Goal Capsule

- **Objective:** Make `Parrying` and `Heightened Awareness` credit the stats the wiki says they grant, and correct four items whose value was doubled by a Roman numeral read as an integer.
- **Product authority:** The DDO Wiki. `Parrying`, `Heightened Awareness`, and the individual item pages for every Roman-variant item, all read 2026-08-08.
- **Open blockers:** None.

---

## Product Contract

### Summary

Two affixes are stored under names that are enchantments rather than stats, so they credit nothing a player can rank. `Parrying` grants Insight Armor Class plus Insight Fortitude, Reflex, and Will saves; `Heightened Awareness` grants Insight Armor Class. Separately, four items over-grant by 2× because their Roman-numeral magnitude was flattened to an integer. This corrects all of it against wiki evidence, with a snapshot and build-time guard in the shape #168 established.

### Problem Frame

The #168 fix corrected `Topaz of Swiftness 15%` and left the class uninvestigated. The audit in `docs/plans/2026-08-08-002-chore-bundled-template-affix-audit-plan.md` intersected our affix names against the wiki's template list and found `Parrying` and `Heightened Awareness` — neither previously reported, neither carrying a standing ruling.

`Parrying` has 139 instances in the dataset and `Armor Class` has 1,650, both rankable. A player ranking Armor Class today gets **zero** credit from any Parrying item. `Heightened Awareness` adds another 26 instances of the same silence.

Verifying at the wiki rather than from the audit's single-value template render then surfaced a second, larger defect the render could not have shown. `Parrying` has had two formats since Update 29, and they carry **different magnitudes under the same name**: the page states outright that `Parrying 8` gives +8 while `Parrying VIII` gives only +4. This is the Arabic-versus-Roman trap that `Speed` already taught, recurring in a second affix.

### Key Decisions

- **"Saves" means Fortitude, Reflex, and Will.** (session-settled: user-directed — chosen over crediting Armor Class alone and quarantining the saves half: 134 of 148 Parrying items are Arabic, so the strict reading would forfeit most of the value on a wording technicality.) The Arabic tooltip says only "Insight bonus to Saves"; the Roman tooltip for the same enchantment enumerates "Fortitude, Reflex, and Will Saving throws". The shorthand is read against the wiki's own expansion of the same mechanic, and that reasoning is recorded as evidence rather than left implicit.

- **The Roman mapping is a three-entry lookup, not a formula.** The wiki lists exactly three Roman variants and each was confirmed on an item page: I → 1, IV → 2, VIII → 4. That is not a clean halving, so no rule is derived from it. A Roman numeral outside those three is quarantined, not computed.

- **Version is per-item evidence, never inferred from the magnitude.** Nineteen items store the value 4 and only one of them is Roman. The stored number cannot distinguish the versions, so the split comes from the wiki's own item grouping.

- **Seed the split from the wiki's grouping, not an item-page harvest.** (session-settled: user-approved — chosen over harvesting all 148 Parrying item pages: the `Parrying` page already groups items by version, so the Roman set is 14 known names.) This keeps the wiki cost to a handful of calls against a source that throttles.

- **Confirm every value at the wiki; infer nothing.** (session-settled: user-directed.) This constraint is what surfaced the Roman over-grant at all — the audit's template render at a single value showed a correct-looking result.

### Requirements

**Affix modelling**

- R1. `Parrying` contributes Insight-typed Armor Class and Insight-typed Fortitude, Reflex, and Will Save, each at the value the wiki states for that item's version.
- R2. `Heightened Awareness` contributes Insight-typed Armor Class at the wiki-confirmed value for its rank. The wiki lists no Roman variant for it. A rank whose tooltip has not been harvested is quarantined: the affix's wiki page states no magnitude, so gear-planner's stored number is not evidence under this plan's governing constraint.
- R2a. A contribution is suppressed only when the record already carries the same stat in the **same stacking bucket**. Most affected items already carry an Armor Class affix typed Armor, Shield, or Deflection — none Insight, all of which stack with it — so a name-only suppression would withhold the fix from the majority of the items this plan exists to correct.
- R3. Neither name remains offered as a rankable target once it expands, following the treatment `Speed` already received — a name that is an enchantment rather than a stat scores partially against what the player meant.
- R3a. A saved character holding either name as a ranked target is migrated on load, with the substitution disclosed. No load path consults the expanded-away map today, so this is new behavior rather than inherited behavior.

**Version handling**

- R4. Each Parrying item's version is recorded from wiki evidence with provenance, never derived from the stored magnitude.
- R5. Roman magnitudes resolve through the confirmed I → 1, IV → 2, VIII → 4 lookup. A Roman numeral absent from that lookup is quarantined and disclosed.
- R6. An item whose version cannot be established contributes nothing for the split rather than defaulting to either reading.

**Data corrections**

- R7. Four items are corrected: `Bladed Steel Ring` 4 → 2, and `Balizarde, Protector of the King`, `Bracers of the Sun Soul`, and `Oathblade` 8 → 4.
- R8. `Ethereal Bracers` stays at 1. Parrying I is +1, so it is already right and must not be swept into the correction.

**Evidence and guard**

- R9. Every derived value carries a verbatim wiki-sourced snapshot, in the shape `speed_enchantment.json` established.
- R10. A build-time guard asserts derived values against those snapshots and fails the build on divergence, covering both affixes.
- R11. The guard is proven to fail before it is trusted, and refuses to report a clean result over zero inspected records.

**Disclosure**

- R12. The change is disclosed to players as a correction that reduces four items' contribution, alongside the increase everywhere else.

### Acceptance Examples

- AE1. The silent case
  - **Covers R1.**
  - **Given:** a solve ranking Armor Class with `Admiral's Cummerbund` (Parrying +2, Arabic) available.
  - **Then:** the item contributes 2 Insight Armor Class and 2 Insight to each of the three saves. Today it contributes nothing to any of them.

- AE2. The over-grant
  - **Covers R7.**
  - **Given:** `Oathblade`, stored today as Parrying 8, wiki-listed under Parrying VIII.
  - **Then:** it contributes 4, not 8. A loadout that featured it for Parrying value gets correctly weaker.

- AE3. The magnitude collision
  - **Covers R4.**
  - **Given:** `Bladed Steel Ring` (Roman IV) and any of the eighteen Arabic `Parrying 4` items, all storing the same value.
  - **Then:** the ring contributes 2 and the Arabic items contribute 4. A model that read the stored number alone could not produce this.

- AE4. The correct-already case
  - **Covers R8.**
  - **Given:** `Ethereal Bracers`, stored as 1, wiki-listed under Parrying I.
  - **Then:** it contributes 1, unchanged.

### Scope Boundaries

- `Command`. Its template grants a Charisma-skills bonus *and* a −6 Hide penalty, and penalties may not be representable at all today. That is a product decision to settle before any modelling.
- The audit's six unresolved templates — `Combustion`, `Concealment`, `Search`, `Elemental Resistance`, `Enhancement Bonus`, `Spell Lore`. Each needs a type or element argument to render and remains unknown, not clean.
- `Seeker`. Its components are not modelled as separate stats, so nothing is currently dropped. Recorded so a later audit does not re-raise it.
- Parrying items the dataset does not carry. The wiki's Roman groups hold fourteen entries but twelve unique names — `Epic Swashbuckler (legacy) (level 20)` and `Swashbuckler (legacy) (level 16)` each appear under both IV and VIII. Five are in the dataset, so nine entries across seven names are absent; they need no correction until they arrive.

### Dependencies and Assumptions

- Both affixes grant *Insight*-typed Armor Class, so once expanded they compete with each other and with any other Insight AC — only the highest counts. Total AC rises, but by less than the sum of the two, and golden fixtures will move. Re-ratify deliberately.
- Saved characters may hold `Parrying` or `Heightened Awareness` as a ranked target. `Speed`'s expansion already faced this; reuse whatever handling it established rather than inventing a second one.
- No `web/` change is expected, since Armor Class and the three saves are already first-class rankable affixes. Confirm during implementation.

### Outstanding Questions

**Deferred to implementation**

- Whether the four corrections shift any golden fixture enough to warrant a separate re-ratification commit, or ride with the change.

### Sources and Research

All read 2026-08-08.

| Source | What it establishes |
|---|---|
| Wiki page `Parrying` | Two versions since Update 29; Arabic "+X Insight bonus to Armor Class, +X Insight bonus to Saves"; Roman "Passive: +X Insight bonus to Armor Class, +X Insight bonus to Fortitude, Reflex, and Will Saving throws"; the stated example that Parrying 8 gives +8 while Parrying VIII gives +4 |
| Same page, item grouping | Arabic 1–6 across 134 items; Roman I (6), IV (3), VIII (5). No Arabic "Parrying 8" exists, which is why every stored 8 is a flattened Roman VIII |
| Item page `Bladed Steel Ring` | "Parrying IV: Passive: +2 Insight bonus to Armor Class, +2 Insight bonus to Fortitude, Reflex, and Will Saving throws" — confirms IV → 2 |
| Item page `Ethereal Bracers` | "Parrying I: Passive: +1..." — confirms I → 1, and that Roman is not a uniform halving |
| Item page `Admiral's Cummerbund` | "Parrying +2: +2 Insight bonus to Armor Class, +2 Insight bonus to Saves" — confirms the Arabic variant does not enumerate the saves |
| Wiki page `Heightened Awareness` | "You gain an Insight bonus to AC." Arabic 1–6 across 37 items; no Roman variant listed |

Local state: 139 Parrying instances at values 1 (13), 2 (23), 3 (9), 4 (19), 5 (4), 6 (68), 8 (3); 26 Heightened Awareness instances; `Armor Class` 1,650 instances and all three saves present and rankable.

Prior art: `src/speed_split.py` and `data/seed/compendium/speed_enchantment.json` are the working precedent for per-item version evidence, snapshots, and the guard.

**Product Contract preservation:** unchanged. Planning added the Planning Contract and below; no requirement, decision, or scope boundary was rewritten.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Extract only the genuinely affix-agnostic pieces; every affix keeps its own guard.** An earlier draft of this decision claimed the guard and rewrite loop were not Speed-specific. That was wrong, and checking the code is what showed it: `check_against_snapshots()` branches on `RECORDED_SWITCH`, on regexes anchored to the literal `speed`, on four Speed tooltip dialects, and on a whole `defaulted` branch built around Template:Speed's 5% placeholder — none of which Parrying has. Moving it would be a redesign wearing a refactor's clothes, and "the Speed tests still pass" cannot detect a generalization that quietly loses strictness for the new affix. Extract `snapshot_key`, `snapshot_for`, `audit_snapshots`, `audit_shard`, and the record-iteration skeleton. Each affix keeps its own value derivation and its own guard behind a common call signature.

- KTD2. **Version is a per-item shard field, nested inside `value`.** (Instantiates the Product Contract decision "Version is per-item evidence, never inferred from the magnitude".) Nineteen items store Parrying 4 and one is Roman, so the magnitude carries no signal. The nesting is not cosmetic: `harvest.merge()` persists and diffs only `value`, `provenance`, `raw`, and `harvested`, so a `version` written as their sibling is silently dropped and the contradiction guard never fires. The Speed shard already nests its derived components inside `value` for the same reason.

- KTD3. **Harvest the Arabic item lists too, rather than treating "absent from the Roman list" as Arabic.** (session-settled: user-directed — chosen over defaulting unlisted items to Arabic: that default is an inference, and its failure mode is silent full value, which is the current bug's behavior.) The wiki page groups all 148 items by version, so one read of an already-open page turns an assumption into evidence for every item and leaves anything unlisted quarantined.

- KTD4. **Saved-character migration is new behavior that must be built, not inherited.** An earlier draft of this decision assumed `EXPANDED_AWAY` already covered it, citing a comment in `web/dataset.js` that says the rule serves "the saved-character load check". The call sites say otherwise: `wizard.js loadCharacter()` restores `state.priorities` verbatim, and the only two callers of `expandedAwayMessage` are add-a-priority paths in `query.js` and `wizard.js`. The comment is aspirational. Because both names are rankable today, a player can already have saved either, and after the rewrite no item carries them — so the load path needs an explicit substitution-with-disclosure. This makes a `web/*.js` change unavoidable, which moves the cache-bust and the footer build stamp with it.

- KTD5. **The shard's stored value is authoritative; the three-entry lookup is the guard's assertion.** (Instantiates the Product Contract decision on the Roman mapping.) I→1, IV→2, VIII→4 are each individually wiki-confirmed and are not a uniform ratio. Splitting the roles this way is what makes "no fallback formula" enforceable rather than aspirational: the harvester records what the wiki said, and the guard fails the build on any Roman numeral outside the three. A formula fitted to three points would silently produce a number for a numeral nobody checked.

- KTD6. **The anti-shadow rule keys on stat plus stacking bucket, not on name.** (Instantiates R2a.) The Speed path suppresses on name alone, which was safe there only because no Speed item carries a `Movement Speed` affix. Here, 94 of 139 Parrying items and 12 of 26 Heightened Awareness items already carry an Armor Class affix — typed Armor, Shield, Deflection, or Primal Natural, never Insight — and `web/model.js` buckets by stat plus stacking-equivalent type, so those stack with Insight rather than competing. A name-keyed rule would withhold the new contribution from 68% of Parrying items: the same silent zero this plan exists to remove. Speed's own rule is left unchanged; retyping it would move shipped behavior and belongs to its own decision.

### Assumptions

- Both affixes are Insight-typed, so once expanded they compete rather than sum with each other and with existing Insight AC. Insight-bucket Armor Class is currently almost absent from the dataset, so these two affixes become effectively the whole Insight AC pool and fixture movement will be larger than a naive read suggests.
- A `web/*.js` change **is** required, per KTD4. The cache-bust and footer build stamp both move. This reverses an earlier assumption that no web change was needed.
- `_bonus_type` falls back to `Enhancement` when an affix carries no type. All 165 current instances are typed `Insight`, so this is latent rather than live — but if that fallback moves into the shared module unchanged, a future null-typed record would emit Enhancement AC and stack against real Insight AC.

### Sequencing

U1 lands the evidence for both affixes, because nothing downstream can derive a value without it. U2 extracts the shared skeleton and changes no behavior, so a regression there is attributable to the move alone. U7 wires Parrying onto it; U3 adds Heightened Awareness and the saved-character migration. U4 extends the guard to both new shards and is proven to fail before the corrections are trusted. U5 re-ratifies fixtures once solver output has actually moved. U6 records the evidence last.

Document order follows dependencies, not U-ID order: U1, U2, U7, U3, U4, U5, U6. U7 carries a later number because U2 was split after its ID was assigned, and IDs are never reused or renumbered.

---

## Implementation Units

### U1. Harvest per-item version and magnitude evidence for both affixes

- **Goal:** Every Parrying and Heightened Awareness instance carries a wiki-stated value; anything the wiki does not list is quarantined rather than defaulted.
- **Requirements:** R2, R4, R5, R6, R9. Cites KTD2, KTD3.
- **Dependencies:** none.
- **Files:** `data/seed/compendium/parrying_version.json` (new), `data/seed/compendium/heightened_awareness.json` (new), `scripts/merge_harvest.py`, `tests/test_merge_harvest.py`.
- **Approach:** Read each affix page's item grouping — Parrying's Arabic 1 through 6 plus Roman I, IV, VIII, and Heightened Awareness's Arabic 1 through 6 — and record one entry per item name. **Nest the version and derived value inside `value`**, because `harvest.merge()` persists and diffs only `value`, `provenance`, `raw`, and `harvested`; a `version` written beside them is dropped and the contradiction guard never fires. Add a `snapshots` block per shard holding the verbatim rendered tooltip per distinct invocation. Register both fields in `FIELDS` and give `roster()` a real branch for each, keyed on item **name** — the `"key": "name"` entry already present for `speed_augment` is decorative and read by nothing.
- **Execution note:** ddowiki has no server-side transport and throttles persistently. Run same-origin from a ddowiki tab, pace requests, and strip `| = & ?` from anything returned. Both pages are already grouped, so this is two page reads, not 185.
- **Patterns to follow:** `data/seed/compendium/speed_enchantment.json` for shard shape and its `value`-nesting; `merge_harvest.py`'s refuse-to-overwrite merge for contradictions.
- **Test scenarios:**
  - A dump whose entry differs only in nested version raises rather than merging — proves the version actually persists.
  - Every Parrying and Heightened Awareness instance in the built dataset resolves to a shard entry, or is reported uncovered.
  - An item present locally but absent from every wiki group is recorded `unsourced` and reported as a harvest suspect.
  - Re-merging an identical dump changes nothing, including the harvest date.
  - `--field parrying_version --coverage` and `--field heightened_awareness --coverage` both run without aborting.
- **Verification:** both shards cover their instances or name the exceptions; coverage output shows zero unexplained gaps.

### U2. Extract the affix-agnostic skeleton — no behavior change

- **Goal:** One shared module holds the pieces every affix split needs, with Speed's behavior byte-identical.
- **Requirements:** none directly; enables U7 and U3. Cites KTD1.
- **Dependencies:** none.
- **Files:** `src/enchantment_split.py` (new), `src/speed_split.py`, `tests/test_speed_split.py`.
- **Approach:** Move only `snapshot_key`, `snapshot_for`, `audit_snapshots`, `audit_shard`, and the record-iteration skeleton. **Leave `check_against_snapshots` and the value-derivation half in `speed_split`** — they branch on `RECORDED_SWITCH`, on `speed`-anchored regexes, on four Speed tooltip dialects, and on a `defaulted` placeholder rule Parrying does not have. Define the common call signature each affix's own guard will implement.
- **Execution note:** This unit ships alone and changes no behavior, so a regression after merge is revertable without touching new-affix work. The full existing Speed suite passing unchanged is the whole acceptance bar.
- **Patterns to follow:** the existing function boundaries in `src/speed_split.py`.
- **Test scenarios:**
  - Every pre-existing Speed test passes unchanged.
  - `check_against_snapshots` still fails the build on a corrupted Speed value, exactly as before the move.
  - A rebuild produces a byte-identical `web/data/items.json` to the pre-extraction build.
- **Verification:** the dataset is unchanged and the suite is green; the diff contains no behavior edits.

### U7. Wire Parrying onto the shared skeleton

- **Goal:** Parrying rewrites into Insight Armor Class and Insight Fortitude, Reflex, and Will Save at the version-correct value.
- **Requirements:** R1, R2a, R3, R4, R5, R6, R7, R8. Cites KTD2, KTD5, KTD6.
- **Dependencies:** U1, U2.
- **Files:** `src/parrying_split.py` (new), `build_dataset.py`, `tests/test_parrying_split.py` (new).
- **Approach:** One folded source name, four output contributions, each inheriting the source affix's bonus type. Add a Parrying tooltip reader that parses "+N Insight bonus to Armor Class" and the saves clause into comparable numbers — the Speed analogues are `tooltip_alacrity` and `tooltip_movement`, and without an equivalent the guard has nothing to compare. **Key the anti-shadow set on stat plus stacking-equivalent type**, per KTD6. Declare Parrying in `EXPANDED_AWAY` mapping to the four concrete stats, and union it into `metadata.expanded_away_names` alongside Speed's.
- **Patterns to follow:** `_rewrite_all`'s iteration; `EXPANDED_AWAY` in `src/speed_split.py`; `equivType` bucketing in `web/model.js` for what "same stacking bucket" means.
- **Test scenarios:**
  - Covers AE1. An Arabic `Parrying +2` item yields Insight Armor Class 2 and Insight 2 on each of the three saves.
  - Covers AE2. A Roman VIII item yields 4, not 8.
  - Covers AE3. A Roman IV item yields 2 while an Arabic `Parrying 4` item yields 4, from identical stored magnitudes.
  - Covers AE4. A Roman I item yields 1, unchanged.
  - Covers R2a. An item carrying an **Armor-typed** Armor Class still receives a second, Insight-typed one; an item already carrying an **Insight-bucket** Armor Class does not.
  - An item recorded under a Roman numeral outside I, IV, VIII is quarantined and contributes nothing.
  - An `unsourced` item keeps the folded affix and increments an uncovered count.
  - Applying twice is idempotent.
  - `Parrying` is declared expanded-away to exactly the four concrete stats, and the metadata field carries both affixes.
- **Verification:** a rebuild shows the four corrected items at their wiki values, Ethereal Bracers unchanged at 1, and no `Parrying` affix remaining on any record.

### U3. Heightened Awareness, and the saved-character migration

- **Goal:** Heightened Awareness contributes Insight Armor Class at its wiki-confirmed value, and a saved character holding either expanded name loads without silently losing a priority.
- **Requirements:** R2, R2a, R3, R3a. Cites KTD4, KTD6.
- **Dependencies:** U1, U2, U7.
- **Files:** `src/heightened_awareness.py` (new), `build_dataset.py`, `web/wizard.js`, `web/app.js`, `tests/test_heightened_awareness.py` (new).
- **Approach:** A single-output config over the shared skeleton with no version branch, its own tooltip reader and guard, and the same type-aware anti-shadow rule. A rank with no harvested tooltip quarantines rather than falling back to gear-planner's number. Separately, add expanded-away substitution with disclosure to `loadCharacter()` in `web/wizard.js` — it currently restores priorities verbatim and never consults the map, so this is new behavior. Bump the cache-bust and the footer build stamp, since a `web/*.js` file changes.
- **Execution note:** The web change is small but user-visible. Verify a saved character holding `Parrying` loads with the substitution shown rather than the priority vanishing.
- **Patterns to follow:** the Parrying config from U7 minus the version branch; `expandedAwayMessage` usage at `web/query.js` and the add-a-priority path in `web/wizard.js`.
- **Test scenarios:**
  - An item with a wiki-confirmed Heightened Awareness 4 yields Insight Armor Class 4.
  - A rank with no harvested tooltip contributes nothing and is disclosed.
  - Covers R2a. An item carrying an Armor-typed Armor Class still gains the Insight one.
  - `Heightened Awareness` is declared expanded-away to Armor Class.
  - Loading a saved character whose priorities include `Parrying` substitutes the four concrete stats and surfaces the disclosure.
  - Loading a saved character with no expanded-away priority is unchanged.
- **Verification:** a solve ranking Armor Class credits Heightened Awareness items that previously contributed nothing, and a saved character holding an expanded name loads intact.

### U4. Guard both new shards, and prove each fails

- **Goal:** Derived values for both affixes are asserted against wiki snapshots on every build, with no way to pass vacuously.
- **Requirements:** R5, R10, R11.
- **Dependencies:** U1, U7, U3.
- **Files:** `build_dataset.py`, `src/parrying_split.py`, `src/heightened_awareness.py`, `tests/test_parrying_split.py`, `tests/test_heightened_awareness.py`.
- **Approach:** Wire each shard into its own guard explicitly. **Assert a non-zero *compared* count, not a non-zero inspected count** — the Speed implementation increments `checked` for an `unsourced` entry before any snapshot lookup, so a shard whose entries all failed to resolve returns a healthy count with zero comparisons. Count only entries whose derived value was matched against a parsed snapshot, and fail when that count is below the shard's non-quarantined entry count. Fail the build on any Roman numeral outside I, IV, VIII.
- **Execution note:** Corrupt real data in each shard and watch the build go red before trusting either guard. A guard never observed failing is not a guard.
- **Patterns to follow:** `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`, including its rule that coverage of one source is not coverage of another.
- **Test scenarios:**
  - A Parrying derived value altered away from its snapshot fails the build.
  - A Heightened Awareness derived value altered away from its snapshot fails the build.
  - A Roman item relabelled Arabic fails, because the derived value no longer matches the version.
  - A shard whose entries are entirely `unsourced` **fails** rather than reporting a clean non-zero count.
  - An entry recorded under a Roman numeral outside the three fails the build.
  - Each guard raises rather than passing when given zero records.
  - Neither guard makes a network call.
- **Verification:** deliberate corruption of each shard independently fails the build; restoring returns it to green.

### U5. Re-ratify golden and parity fixtures

- **Goal:** Fixture movement is reviewed and accepted deliberately.
- **Requirements:** none directly; protects R1, R2, R7.
- **Dependencies:** U7, U3, U4.
- **Files:** `tests/parity/baseline.json`, `tests/parity/golden.json`, `tests/solver.test.js`, `tests/solver_golden.test.js`, `tests/parity/capture_golden.js`.
- **Approach:** Regenerate the golden fixtures, then read each delta against three admissible causes: Armor Class and save totals rising where the affixes now credit; the four corrected items falling where they were previously selected on inflated value; and a changed item selection, accepted only when the swap is named and the loadout's objective did not decrease. Anything fitting none of the three is a finding. Expect movement to be larger than "rises by less than the sum" implies — Insight-bucket Armor Class is nearly absent today, so these two affixes become effectively the whole Insight AC pool.
- **Execution note:** Re-ratify consciously. A blanket accept would hide exactly the defect class this plan removes.
- **Test scenarios:**
  - A fixture equipping both a Parrying item and a Heightened Awareness item totals the **larger** of their Insight Armor Class values, not the sum.
  - Every `tests/*.test.js` file passes individually after re-ratification.
- **Verification:** each changed fixture value is attributed to one of the three causes.

### U6. Record the evidence and make the refresher cover it

- **Goal:** The wiki findings survive as a citable ruling, and the manual refresh loop actually reaches the new invocations.
- **Requirements:** R12.
- **Dependencies:** U1, U7, U3, U4, U5.
- **Files:** `docs/wiki-evidence/parrying-versions.md` (new), `docs/wiki-evidence/speed-tooltip-tracker.md`, `scripts/merge_harvest.py`, `tests/test_merge_harvest.py`.
- **Approach:** Record the two-version split, the three confirmed Roman mappings with their per-item citations, the absence of an Arabic `Parrying 8`, and the reasoning mapping the Arabic "Saves" shorthand onto the three named saves. Make `--tooltip-worklist` per-field: it currently filters every entry through a `speed`-anchored regex, so a Parrying shard prints an empty list and exits 0 — the inspect-nothing shape this repo bans. For Parrying it emits every stored invocation including Roman ones, since KTD5's lookup is not a formula, and it exits non-zero rather than printing an empty list.
- **Test scenarios:**
  - `--tooltip-worklist --field parrying_version` emits a non-empty list including Roman invocations.
  - `--tooltip-worklist` on a field with no invocations exits non-zero rather than printing an empty list.
- **Verification:** a future reader can reconstruct every derived value from the recorded citations, and the refresher returns real work for both new fields.

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Python suite | `python3 tests/run_tests.py` | U1, U2, U7, U3, U4 |
| Full JS suite | glob `tests/*.test.js`, run each file separately | U7, U3, U5 |
| Dataset rebuild | `python3 build_dataset.py` | U1, U2, U7, U3, U4 |
| Byte-identical rebuild | rebuild before and after U2, diff the dataset | U2 |
| Guard negative test | corrupt each shard independently, confirm the build fails, restore | U4 |
| Golden regeneration | `node tests/parity/capture_golden.js`, then review each delta | U5 |
| Coverage read | `merge_harvest.py --coverage` for both new fields | U1 |
| Refresher work list | `merge_harvest.py --tooltip-worklist` for both new fields returns non-empty | U6 |

`node a.js b.js` runs only the first file — glob and run each separately, or `solver_golden` silently never executes.

---

## Definition of Done

- Parrying contributes Insight Armor Class and Insight Fortitude, Reflex, and Will Save at the version-correct value on every covered item.
- Heightened Awareness contributes Insight Armor Class at a wiki-confirmed value; any unconfirmed rank contributes nothing and is disclosed.
- An item already carrying a non-Insight Armor Class still receives the Insight one; only a same-bucket affix suppresses it.
- The four over-granting items are corrected; Ethereal Bracers is unchanged at 1.
- Every instance of both affixes resolves to wiki-stated evidence, or is quarantined and disclosed — nothing defaults.
- A Roman numeral outside I, IV, VIII fails the build rather than resolving to a computed value.
- Neither name remains rankable, and a saved character holding either loads with the substitution disclosed rather than the priority vanishing.
- Both shards are guarded, each guard asserts a non-zero *compared* count, and each has been observed to fail on corrupted data.
- Fixture movement is re-ratified with each delta attributed to one of the three admissible causes.
- The full Python suite and every `tests/*.test.js` file pass.
- `docs/wiki-evidence/parrying-versions.md` records the citations behind every derived value, and the refresher returns real work for both new fields.
