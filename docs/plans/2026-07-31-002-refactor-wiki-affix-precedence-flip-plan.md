---
title: "refactor: prefer gear-planner structured affixes over free-text-parsed wiki shards"
date: 2026-07-31
type: refactor
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
depth: standard
---

# refactor: prefer gear-planner structured affixes over free-text-parsed wiki shards

## Summary

PR #69 made `gearplanner_items.json` the structured, wiki-sourced source of truth for item affixes — but chose (KTD5) to append the gear-planner reader **last** in the merge, so the older **free-text-parsed wiki-enriched shards win name collisions**. That precedence is the entire remaining source of affix-vocabulary garbage: `Bal`, `INT`, `OL`, `DD`, `UMD`, `(upgraded via Black Abbot) Striding`, etc. — parser artifacts from ~740 wiki-shard body records.

**Diagnosis (this session, measured against a scratch build):** the ~740 wiki-shard body records reduce to **683 distinct-name collisions** with the gear-planner catalog (plus 1 truly wiki-only item, `Graz'zt's Reign`). Flipping precedence makes gear-planner win those collisions: **479 items get richer affixes, 8,415 are unchanged, and 9 lose an affix** gear-planner happens to lack — **7 of those 9 are in the ML33-35 endgame band**. So the flip is a net win but is **not** strictly "equal-or-richer": those 9 items need their missing affixes unioned back on. That reconciliation is **in scope** here, not deferred.

This plan: (1) flips the collision precedence so the gear-planner structured record wins; (2) grafts the wiki shards' unique crafting markers — `lamordia_slots` and `nearly_complete` — onto the winner via the existing order-independent Pass-2 mechanism; (3) unions back the specific affixes the ~9 regressing items would otherwise lose; (4) verifies the endgame band and every crafting system. Only the **collision-precedence half of KTD5** is reversed; the roster-membership half is unchanged. The change is confined to `build_dataset.py`.

---

## Problem Frame

**What's wrong:** After PR #69, the priority-picker still carries residual garbage because the wiki-enriched shards (`enriched_batch*.json`, `enriched_r4*.json`, `enriched_vecna_*.json`) carry free-text `enhancements[]` that `src/affix_parser.py` mangles, and those shards **win** collisions over the clean gear-planner records (`build_dataset.py` — `all_enriched = load_enriched_items() + planner_records`, planner last → loses the first-wins dedup).

**Why the flip is the right lever, and where it needs help:**
- 683 distinct-name collisions; for 479 gear-planner is richer, 8,415 unchanged — a large, clean win. The gear-planner reader already recovers `seal_slots` from `crafting` and emits `(set)` markers from the `sets` key, so **catalog-defined** set membership and seals survive the flip (verified: `set_bonus`-bearing variants 1390 == 1390 before/after; seal hosts 9/9).
- **But 9 items lose an affix** gear-planner lacks (measured, flip-only build): `Legendary Celestial Emerald Ring`, `Legendary Cloak of the Ambassador`/`Crownblade`/`Forest's Arrow`/`Forest's Blade`, `Legendary Dream of the Worldshaper`, `Legendary Feargaze`, `Legendary The Bloody Boulder`, `The Winter Solstice`. Seven are ML33-35 band items. The band **count** stays 188/188 (membership unchanged), so a count-only check would miss this — the fix is a per-item union-merge (U3).
- The only data the wiki shards uniquely hold beyond those affixes are two crafting markers — `lamordia_slots` and `nearly_complete` — not present in gear-planner's structure. Without grafting, a flip-only build drops `nearly_complete` to 0/70 hosts and `lamordia_slots` to 6/108. The Pass-2 graft already carries `seal_slots`/`lost_purpose` "from any record onto the winner"; extending it to these two closes the gap.

**In scope:** merge precedence flip; Pass-2 graft extension; the union-merge for the regressing items; regression/verification. **Out of scope:** any wiki re-harvest; changing the reader, `variants.py`, or the solver; the 1 truly-wiki-only item's body; stat-vocabulary normalization (e.g. renaming `DR`).

---

## Requirements

- **R1** — The gear-planner structured record wins name collisions against the free-text-parsed wiki-enriched shards (base seed still wins over both).
- **R2** — No crafting marker is lost by the flip: `lamordia_slots`, `nearly_complete`, `seal_slots`, and `lost_purpose` all end up on the winning record when any loaded record carries them.
- **R3** — The endgame band (ML30-36) stays solver-active at its current count (188/188), **and** no band item loses a solver-eligible affix after the U3 union-merge (a count-only check is insufficient — the affix set must be compared eligible-to-eligible).
- **R4** — Crafting systems keep working: Nearly-Complete, Viktranium/Lamordia, and Seal test suites pass; the Dino double-listing guard (0 duplicate `variant_id`s) holds. Any solver test that asserts *optimal placement* of an NC/craft on a specific target may legitimately change when gear-planner's richer bodies supply that stat elsewhere — such a test is updated (assert eligibility, or target a stat gear-planner doesn't cover), not treated as a regression.
- **R5** — The parser-artifact names `Bal`, `INT`, `OL`, `DD`, `UMD` and unbalanced-paren leaks are gone from item bodies. Distinct affix stats drop **352 → ~315** (not lower — most residual names are legitimate stats); the curated `rankable_affixes` vocabulary stays ~208. `DR` (a real base-seed Damage-Reduction stat) is **not** in scope to remove.
- **R6** — Roster membership and count are unchanged (same name set; 8,908 variants); the build stays deterministic.

---

## Key Technical Decisions

**KTD1 — Flip collision precedence; reverse only KTD5's precedence half.**
`all_enriched = planner_records + load_enriched_items()` (planner first → wins first-wins dedup). KTD5's roster-membership half ("own the growth", net-new items gated by verify) is untouched — the name set and count don't change, only which record wins each collision. *(session-settled: user-directed — reverses the collision-precedence half of PR #69's KTD5, chosen over keeping wiki shards authoritative: 683 collisions are 479-richer / 8,415-same / 9-poorer in gear-planner, so the parse garbage is almost pure precedence cost; the 9 losers are reconciled by KTD2.)*

**KTD2 — Preserve wiki-only data by (a) grafting markers and (b) unioning back the lost affixes for the enumerated regressors.**
Two mechanisms: the winner-takes-all flip drops the wiki shard's affixes (intended — gear-planner is richer for 479, same for 8,415), and its `lamordia_slots` / `nearly_complete` markers are grafted onto the winner via the existing order-independent Pass-2 loop (list values copied to avoid shared refs across tier variants). For the **9 items whose wiki record had a solver-eligible affix gear-planner lacks**, union those specific affixes onto the winning record (deduped by `(stat, bonus_type)`). The regressing set is **computed at build time** (eligible-vs-eligible diff), not hardcoded — the exact loser set is small and data-dependent.

**KTD3 — Landing order keeps the tree valid at every commit.**
Land the graft extension (additive, a no-op while wiki still wins) before the precedence flip, so no intermediate state strands a marker. The union-merge (U3) lands with or immediately after the flip so no shipped build has the 9-item regression.

---

## Implementation Units

### U1. Extend the Pass-2 marker graft

**Goal:** Carry `lamordia_slots` and `nearly_complete` from any loaded record onto the winning record, alongside the existing `seal_slots` / `lost_purpose` grafts.
**Requirements:** R2; implements KTD2 (graft half).
**Dependencies:** none (additive — a no-op until U2 flips precedence).
**Files:** `build_dataset.py` (Pass-2 loop), `tests/test_nearly_complete.py` (graft coverage).
**Approach:** In the `for it in all_enriched` Pass-2 loop, add two grafts mirroring the seal-slot graft: if the winner lacks `lamordia_slots` and this record has them, copy them (`[dict(s) for s in it["lamordia_slots"]]`); if the winner lacks `nearly_complete` and this record has it, copy it. Guard each on `winner is not None` and `not winner.get(<key>)`, using `.get()` for the source read. **Do not graft `nc_tier`** — it does not occur in any enriched shard (0 records); a literal `winner["nc_tier"] = it["nc_tier"]` would `KeyError`. `variants.py` already reads `nc_tier` defensively via `.get()`.
**Patterns to follow:** the `seal_slots` graft and the `lost_purpose` graft in the Pass-2 loop (copy-on-graft, "from ANY record onto the winner").
**Test scenarios:**
- A record whose winner lacks `lamordia_slots` but a co-loaded record has them ends up with the slots grafted, as an independent copy (mutating one variant's slots doesn't bleed into another).
- A Nearly-Complete host: winner lacks `nearly_complete`, a co-loaded record has it → it lands on the winner.
- A winner that already has its own `lamordia_slots`/`nearly_complete` is not overwritten.
- No `KeyError` when a record has `nearly_complete` but no `nc_tier`.
**Verification:** With precedence still un-flipped, the full build is byte-identical to before (graft is a no-op); the new tests pass by constructing a winner/loser pair. After U2, `lamordia_slots` reaches 108 hosts and `nearly_complete` reaches 70 (the pre-flip counts).

### U2. Flip collision precedence

**Goal:** Make the gear-planner structured record win name collisions.
**Requirements:** R1, R5, R6; implements KTD1.
**Dependencies:** U1.
**Files:** `build_dataset.py` (merge line).
**Approach:** Change `all_enriched = load_enriched_items() + planner_records` to `all_enriched = planner_records + load_enriched_items()`. Update the adjacent comment (which says planner is appended "LAST so … existing wiki-enriched shards win name collisions") to reflect the flip and cite KTD1. Base seed still wins (it seeds `kept_by_name` before the loop); the dino host-pipeline exclusion and the truly-wiki-only item (`Graz'zt's Reign`) are unaffected.
**Execution note:** Rebuild and diff the affix vocabulary before/after; confirm the parser-artifact names disappear and the roster count is unchanged.
**Patterns to follow:** the existing first-wins Pass-1 dedup.
**Test scenarios:**
- A collision item present in both sources resolves to the gear-planner structured affixes (assert a known endgame item, e.g. `Legendary Abyssal Arbalest`, now carries its full structured affix set, not the wiki shard's empty/mangled one).
- `Graz'zt's Reign` still resolves from its wiki-shard body.
- Roster distinct-name set and total variant count unchanged vs. the pre-flip build (8,908 variants).
- `Bal`, `INT`, `OL`, `DD`, `UMD` are absent from the built dataset's affix stats; `DR` is still present (base-seed, expected).
- Build is deterministic (two runs → identical output).
**Verification:** distinct affix stats drop 352 → ~315; the 5 parser artifacts gone; planner wins the 683 distinct-name collisions (spot-check a Demogorgon, a Myth Drannor, and an IoD item).

### U3. Union-merge the affixes the flip would strip from the ~9 regressing items

**Goal:** Ensure no collision item ends with fewer solver-eligible affixes than it had before the flip.
**Requirements:** R3; implements KTD2 (union half).
**Dependencies:** U2.
**Files:** `build_dataset.py` (after the merge, before/within expansion), `tests/test_planner_import.py` (no-affix-loss coverage).
**Approach:** Compute, at build time, the set of collision items whose **winning** record has a smaller solver-eligible affix set than the losing wiki-shard record — compared **eligible-to-eligible** (post-quarantine), so garbage the flip is meant to drop never counts as a "loss." For each such item, union the missing affixes (those in the wiki record's eligible set but not the winner's) onto the winner, deduped by `(stat, bonus_type)`. The measured set today is 9 items (7 in-band: `The Bloody Boulder` ML35, `Dream of the Worldshaper` ML35, `Cloak of the Crownblade`/`Forest's Arrow`/`Forest's Blade`/`Ambassador` ML33, `The Winter Solstice` ML33; plus `Celestial Emerald Ring` ML29, `Feargaze` ML29) — but the code enumerates it, not a hardcoded list, so a catalog refresh can't silently reintroduce a loss.
**Execution note:** Characterize the loser set from a flip-only build first (U2 landed, U3 not yet) so the union-merge target is proven before implementing it.
**Patterns to follow:** the eligible-affix determination in `src/verify.py`; the copy-on-attach discipline used by the seal/marker grafts.
**Test scenarios:**
- After the full build, every collision item's winner has ≥ the eligible-affix count it had pre-flip (assert across the whole collision set, not a sample).
- A known regressor (e.g. `Legendary The Bloody Boulder`) exposes its full pre-flip affix set again, with no duplicate `(stat, bonus_type)` entries.
- Garbage affixes (`Bal`/`INT`/…) are NOT unioned back (the merge operates on eligible affixes only).
- The union-merge is a no-op for the 8,894 non-regressing collision items (they're untouched).
**Verification:** the no-affix-loss assertion passes across all collisions; the 7 in-band regressors carry their full affix set.

### U4. Endgame-band and crafting regression guard

**Goal:** Prove the flip + graft + union-merge preserve the endgame band and every crafting system.
**Requirements:** R3, R4.
**Dependencies:** U1, U2, U3.
**Files:** `tests/run_tests.py` (`test_nearly_complete.py`, `test_viktranium.py`, `test_seal.py`, `test_r4_enrichment.py`, `test_r4_reconciliation.py`, `test_band_frontier.py`), node `tests/solver.test.js` / `model.test.js` / `browse.test.js` / `results.test.js`.
**Approach:** Run the full Python + node suites. Guard the endgame band's solver-active count (188/188 per `band_coverage`). Confirm the Dino guard (0 duplicate `variant_id`s) holds and NC/Viktranium/Lamordia/Seal hosts still resolve their craftable pools. **Expected test update:** `tests/solver.test.js`'s "U81 Nearly-Complete crafts onto a real enriched host (real dataset)" asserts an NC craft is *placed* for a specific target (Constitution at mlCap 36); after the flip, gear-planner's richer bodies can satisfy Constitution without the NC craft, so 0 crafts are placed and the assertion fails though the NC machinery is intact (70 hosts, coverage identical). Update that test to assert NC *eligibility* on a chosen host, or target a stat gear-planner doesn't otherwise supply — this is an expected consequence of the flip, not a regression.
**Execution note:** Treat a band-count drop, a genuine crafting-pool break, or a surviving affix-loss as a blocker. The NC-placement test change above is expected and is not a blocker.
**Test scenarios:**
- `band_coverage` solver-active count == 188 (unchanged).
- `test_nearly_complete`, `test_viktranium`, `test_seal` pass — a known NC/Lamordia/seal host still exposes its craftable pool after the flip.
- The updated solver.test.js NC assertion passes on the flipped dataset (eligibility- or coverage-based, not optimal-placement-for-Constitution).
- 0 duplicate `variant_id`s (Dino guard from PR #69 holds).
- Full Python (`python3 tests/run_tests.py`) and the four node suites are green.
**Test expectation:** feature-bearing — full regression coverage required.
**Verification:** all suites green; band intact; no surviving affix-loss.

---

## Scope Boundaries

**In scope:** merge precedence flip; Pass-2 graft extension; union-merge for the regressing items; regression/verification.

**Non-goals:** wiki re-harvesting; touching `src/planner_items.py`, `src/variants.py`, or solver code; changing roster membership; altering the truly-wiki-only item's body; **stat-vocabulary normalization** — renaming legitimate short stats like `DR` (Damage Reduction) to full labels is a separate effort and is not what reaches the ~208 rankable count.

### Deferred to Follow-Up Work
- Native gear-planner recovery of `lamordia_slots`/`nearly_complete` from the dump's `crafting` strings (would retire the graft dependency for these too) — a later cleanup, not needed now.
- Storing `Graz'zt's Reign` (the truly-wiki-only item) structurally — negligible value for one item.
- Optional stat-vocabulary normalization (e.g. `DR` → `Damage Reduction`) to shrink the distinct-stat count below ~315 — out of scope; the picker is already clean via the `rankable_affixes` gate.

---

## Risks & Dependencies

- **R-risk-1 — Endgame affix loss (proven, not hypothetical).** 9 collision items (7 in-band) lose a solver-eligible affix under a flip-only build; the band **count** metric (188/188) masks it. *Mitigation:* U3 union-merge (in scope, build-time-enumerated) + U4's eligible-to-eligible no-affix-loss assertion across the whole collision set. This is why the union-merge is a unit, not a deferred contingency.
- **R-risk-2 — A stranded crafting marker (Lamordia/NC) breaks a craftable pool.** A flip-only build drops `nearly_complete` to 0/70 and `lamordia_slots` to 6/108. *Mitigation:* U1 graft (land before the flip, KTD3) + U4's crafting-suite pass.
- **R-risk-3 — A solver test asserts optimal NC/craft placement that the richer bodies make unnecessary.** *Mitigation:* U4 updates the affected assertion to eligibility/coverage (expected, not a regression).
- **R-risk-4 — Gear-planner's own noise wins now (e.g. a `+14 Bool` mangled entry).** *Mitigation:* handled by KTD6 quarantine from PR #69; the rankable-vocab filter (≥2 items + balanced brackets) keeps it out of the picker.
- **R-risk-5 — A wiki-only `(set)` marker for an undefined/novelty set is dropped.** Two items (`Legendary Capelet of Cuisine`, `Legendary Cook's Coat`) carry only `Legendary Cooking By the Book (set)`, which is in `_KNOWN_UNDEFINED_SETS` (no catalog def → no bonus either way). *Mitigation:* harmless today; note it so a future catalog def for such a set doesn't silently under-populate membership.
- **Dependency:** gear-planner set catalog remains SSOT; do not re-harvest.

---

## Definition of Done

- `build_dataset.py` merges `planner_records` first; gear-planner wins the 683 distinct-name collisions; base seed still wins over both.
- Pass-2 grafts `lamordia_slots` and `nearly_complete` (plus the existing seal/lost_purpose) onto the winner, as independent copies; `nc_tier` is not grafted.
- The union-merge restores every affix the flip would have stripped from the ~9 regressing items; U4's eligible-to-eligible assertion finds zero surviving losses.
- Parser artifacts `Bal`/`INT`/`OL`/`DD`/`UMD` gone from item bodies; distinct affix stats ~315; `rankable_affixes` stays ~208; `DR` intentionally retained.
- Endgame band solver-active count unchanged (188/188); 0 duplicate `variant_id`s; NC/Viktranium/Lamordia/Seal pools resolve.
- `Graz'zt's Reign` still resolves from its wiki body; roster count 8,908; build deterministic.
- Full Python + node suites green (with the expected NC-placement solver-test update).

---

## Sources & Research

- Scratch flip+graft build this session (measured against the committed baseline): 683 distinct-name collisions (740 body records, 684 unique names, 1 truly wiki-only `Graz'zt's Reign`); affix deltas 479 richer / 8,415 same / 9 poorer; 7 of the 9 losers in ML33-35; distinct affix stats 352 → 315; roster 8,908 variants unchanged; band 188/188; `set_bonus`-bearing variants 1390 == 1390; seal hosts 9/9; flip-only marker loss `nearly_complete` 70→0, `lamordia_slots` 108→6 (restored by U1 graft).
- `DR` is a base-seed structured stat (`Bastion (level N)` → `{stat: DR, bonus_type: Piercing, value: 5}`), 65→67 variants after the flip — not a wiki parse artifact.
- Current merge/graft code: `build_dataset.py` merge line + Pass-1 first-wins dedup + Pass-2 marker graft (`seal_slots` / `lost_purpose`).
- Prior art: `docs/plans/2026-07-31-001-refactor-structured-affix-sourcing-plan.md` (PR #69, KTD5/KTD6); memory `ddo-structured-affix-sourcing`, `ddo-r4-endgame-band-shipped`.
