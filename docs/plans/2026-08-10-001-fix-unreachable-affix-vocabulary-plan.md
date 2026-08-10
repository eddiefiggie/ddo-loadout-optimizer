---
title: Unreachable Affix Vocabulary - Plan
type: fix
date: 2026-08-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Unreachable Affix Vocabulary - Plan

## Goal Capsule

Make `Enhanced Ki` (#227) and `Kick 'Em While They're Down` (#228) selectable as priorities, and close the two vocabulary gaps that hid them so the next instance surfaces as a build event instead of a player report.

**Authority hierarchy:** the DDO wiki is the source of truth for names and values. `AGENTS.md` standing rules override this plan wherever they conflict — never infer a value, prove a guard fails before trusting it, gear-planner is the sole affix authority.

**Stop conditions:** stop and ask if the untyped-candidate adjudication turns out to require more than a handful of wiki calls (ddowiki throttles persistently after ~8 rapid requests), or if the golden solver diff moves for a reason this plan does not predict.

**Tail:** standalone run — owns commit, PR, and the shipping-hygiene bump.

---

## Product Contract

### Summary

Promote `Enhanced Ki` to the canonical affix name and admit adjudicated untyped worn-gear stats into the priority picker; unhide named multi-word presence effects that the picker's word cap currently drops. Both fixes ship behind curated seeds with build guards, so the classes stay visible without admitting weapon-proc noise.

### Problem Frame

Two players reported affixes they could not find. Both are in the dataset and both are solver-eligible; neither can be selected as a priority.

`Enhanced Ki` is the wiki and in-game name (confirmed on `Item:Legendary_Icewalkers` and the `Enhanced Ki` page). gear-planner stores it as bare `Ki` with a magnitude and no `type`, on 19 worn variants across 5 slots at values 1-5. Two failures compound: `affix_aliases.json` has no entry, so typing the real name is rejected; and `rankable_affixes()` skips untyped affixes, so the stored name never reaches the 215-name suggestion list. There is no path to rank ki generation at all.

`Kick 'Em While They're Down` is data-correct — 12 variants matching the wiki's item list exactly, stored as `Bool` presence. `_isPresenceTargetable` requires a name of four words or fewer; this one is five, so it is dropped from suggestions and from the `presence` set. It survives in `known`, so typing the exact string with both apostrophes works, but searching "kick" returns nothing.

The untyped skip is not a careless filter. Of 183 distinct untyped names across 5,427 raw item affixes, the population is dominated by weapon procs and banes — Holy (197 items), Chilling (191), Vampirism (161), Maiming (157), the Bane family. Admitting untyped names wholesale would flood the picker. The word cap is likewise a proxy that mostly works: of the 35 `Bool` names that pass the noise regex and fail only on length, roughly two-thirds are genuinely sentence-shaped and should stay hidden.

### Requirements

**Reachability**

R1. A player can select `Enhanced Ki` as a priority, and the receipts and exports name it as the wiki does.
R2. Typing the gear-planner name `Ki` still resolves, rather than being rejected as unknown.
R3. A player searching "kick" in the priority picker finds `Kick 'Em While They're Down`.

**Data discipline**

R4. An untyped affix name is admitted to the rankable vocabulary only after adjudication against the wiki; unadjudicated names stay out.
R5. A `Bool` presence name is admitted to suggestions only after adjudication; the word cap remains the default for everything unadjudicated.
R6. A new untyped worn-magnitude name, or a new named presence effect caught by the word cap, fails the build rather than passing unnoticed.

**Shipping hygiene**

R7. The `?v=` cache-busts, the footer `BUILD`, and the README `**Current build:**` line move together.

### Scope Boundaries

In scope: the picker vocabulary paths for untyped magnitude stats and for named multi-word presence effects, the alias and name-correction tables, and the guards that keep both classes visible.

#### Deferred to Follow-Up Work

Filed per the Open work rule in `AGENTS.md`: #229, #230, #231, #232.

- **The `iter_affixes` blindspot** (#229). `src/vocabulary.py:47` recognizes an affix only when `name`, `type`, and `value` are all present. A gear-planner affix with no `type` key therefore never enters the generated registry and is never validated by `check_referential_integrity` — a new untyped name can appear on re-import with no new-name event. This plan's guard reads the raw records directly and does not depend on that layer, so the two are independent.
- **The unreviewed untyped backlog** (#230). Roughly 25 untyped names besides `Enhanced Ki` are numeric, on two or more items, well-formed, and reach at least one worn slot (`Linguistics`, `Power`, `Spearblock`, `Axeblock`, `Fire Guard`, `Smite Evil Charges`, `Raging Strength`, `Minor Spell Penetration`, and the Guard/Augmentation/Incite families). They stay quarantined until adjudicated.
- **The remaining word-cap casualties** (#231). `Way of the Sun Soul`, `Embrace of the Spider Queen`, `Path of the Fire Dragon`, `Path of the Guarding Stone`, `Brilliance of the Shattered Sun`, `Greater Bane of the Unnatural`, `Lifeblood of the Undead Prince`, `Vile Grip of the Hidden Hand` (and its Legendary form), and the four `Litany of the Crimson Covenant` lines.
- **What Enhanced Ki overrides** (#232). The wiki states it does not stack with another enchantment and overrides that one's ki-generation portion; the link target was stripped by the privacy guard. No double-count risk exists today (see KTD4), so this is documentation, not correctness.

#### Outside this plan

- A name-shape detector for either class (#211). The curated-seed-plus-guard shape is the repo's established answer to expensive-to-source trusted data.
- The ~20 genuinely sentence-shaped `Bool` names. They stay hidden and free-typeable.

### Sources

- #227, #228 — the filed reports with the full evidence tables.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the curated-seed + fail-safe-empty + guard pattern this plan applies twice.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — required for both new guards.
- `docs/solutions/logic-errors/bonus-type-vocabulary-collides-with-bare-stat.md` — why a vocabulary change without a parse assertion ships invisibly.
- `src/value_corrections.py` + `data/seed/compendium/item_value_corrections.json` — the #207 correction-shard precedent (fails the build when the recorded source value moves).
- `src/speed_split.py`, `src/enchantment_split.py` — where `Movement Speed` is minted as a native name.

---

## Planning Contract

### Key Technical Decisions

**KTD1 — Promote `Enhanced Ki` as the canonical name in the pipeline; alias `Ki` onto it.** *(session-settled: user-approved — chosen over aliasing `Enhanced Ki -> Ki`: the alias table cannot make a non-native name canonical.)*

The picker's `canonical()` maps typed input to a canonical name, but the solver matches item affixes by `a.name`. If the canonical were `Enhanced Ki` while the dataset name stayed `Ki`, the target set would hold a name no item carries and the priority would score zero. The existing precedent resolves this: `Movement Speed`, `Physical Sheltering`, and `Armor-Piercing` are all *native dataset names* minted by the pipeline, with the spoken variant (`Striding`, `PRR`, `Fortification Bypass`) mapped in `affix_aliases.json`. Apply the same shape — rename at build time, then alias.

**KTD2 — A name-correction shard, guarded against source drift.** Model this on `item_value_corrections.json` (#207): the shard records both the source name and the corrected name, and the build fails when the recorded source name is no longer present in the raw data. A silent no-op after a gear-planner re-import is how this correction would rot.

**KTD3 — The untyped admission rule is `untyped + numeric + >= 2 distinct items + well-formed + reaches a worn slot`, and it gates a *quarantine*, not an admission.** The rule identifies candidates; a name still enters the rankable vocabulary only via the `allow` list. Everything else the rule catches goes on a `quarantined` list with a reason. The guard fails the build on any candidate in neither list, which makes a new one a reviewed event. Weapon and off-hand slots are excluded from "worn" because the rune-arm imbue family and the proc population live there.

**KTD4 — Ship `Enhanced Ki` rankable without resolving its override rule.** The solver buckets an item affix as `` `${a.name}||${_equivType(a.type)}` `` and caps each bucket at one contributor, so all 19 sources already collapse to max-of-Ki rather than a sum. The enchantment the wiki says it overrides is not a magnitude stat in the dataset today, so there is no double-count to prevent. The value on each item is wiki-stated per item; nothing is inferred.

**KTD5 — `PRESENCE_ALLOW` is the mechanism, not a new module.** It exists as the documented extension point and ships empty by design. Seeding it is using the design, not adding the one-off module #211 argues against. The word cap stays as the default for everything unadjudicated.

**KTD6 — Seed both lists only with wiki-verified names.** `Enhanced Ki` and `Kick 'Em While They're Down` are confirmed. Everything else is quarantined and filed. This keeps the wiki budget at roughly zero additional calls, which matters because ddowiki throttles persistently after about eight rapid requests.

### Assumptions

- The golden solves do not move. Adding names to the suggestion vocabulary changes no solve unless a priority uses them, and the golden fixtures use fixed priority lists. The `Ki -> Enhanced Ki` rename changes a dataset affix name, so a fixture referencing `Ki` would surface — verify rather than assume, and re-ratify deliberately if it moves.
- The 12 `Kick 'Em While They're Down` variants and 19 `Ki` variants in the current build match the wiki. Both were checked during triage.

### Sequencing

U1 and U3 are independent. U2 depends on U1 (the seed names the corrected name). U4 verifies all three.

---

## Implementation Units

### U1. Promote `Enhanced Ki` to the canonical affix name

**Goal:** the dataset carries `Enhanced Ki` where gear-planner records `Ki`, and typing either name resolves.

**Requirements:** R1, R2

**Dependencies:** none

**Files:**
- `data/seed/compendium/item_name_corrections.json` (new) — the shard, seeded with the single `Ki -> Enhanced Ki` entry and its wiki citation
- `src/name_corrections.py` (new) or an extension of `src/value_corrections.py` — loader plus the source-drift assertion
- `build_dataset.py` — apply before variant expansion and before `rankable_affixes()`, matching where the Speed split and value corrections run
- `data/seed/compendium/affix_aliases.json` — add `Ki -> Enhanced Ki` with a reason naming the wiki page
- `tests/test_name_corrections.py` (new)

**Approach:** follow `value_corrections` in shape — a curated JSON shard, a loader that fails safe when absent, an application step in `build()`, and an assertion that the recorded source name still exists in the raw records. Prefer extending `src/value_corrections.py` if its load-and-assert scaffolding generalizes cleanly to names; a sibling module is fine if forcing them together muddies either.

Placement matters: the rename must run before `rankable_affixes()` reads the planner records, or the corrected name will not reach the vocabulary. The alias entry is what keeps `Ki` typeable — `canonical("Ki")` returns `Enhanced Ki`, and `known` is built from dataset names, so the alias is the only thing bridging the two.

**Patterns to follow:** `src/value_corrections.py` and its call site around `build_dataset.py:420`; the alias entry shape and `reason` field in `data/seed/compendium/affix_aliases.json`.

**Execution note:** prove the drift guard fails before trusting it — change the recorded source name to something absent from the raw data, confirm the build goes red, then restore.

**Test scenarios:**
- The built dataset carries `Enhanced Ki` on all 19 variants and carries no affix named `Ki`.
- Spot-check three tiers end to end: `Icewalkers` ML 8 value 1, `Legendary Icewalkers` ML 34 value 5, `Legendary Webs of the Drow Penitent` ML 35 value 5.
- `canonical("Ki")` returns `Enhanced Ki`; `canonical("Enhanced Ki")` returns itself.
- `known` contains `Enhanced Ki`. Free-typing either name is accepted.
- The drift guard fails when the shard's recorded source name is absent from the raw records, and passes on the shipping data.
- The guard refuses to inspect zero records.

**Verification:** `python3 build_dataset.py` succeeds; the two names resolve to one canonical; the drift guard has been shown red and restored.

---

### U2. Admit adjudicated untyped worn-gear stats to the rankable vocabulary

**Goal:** `Enhanced Ki` appears in the priority suggestions, and any future untyped worn-magnitude name fails the build until someone rules on it.

**Requirements:** R1, R4, R6

**Dependencies:** U1

**Files:**
- `data/seed/compendium/untyped_rankable.json` (new) — `allow` (seeded with `Enhanced Ki`) and `quarantined` (the ~25 current candidates, each with a reason)
- `src/vocabulary.py` or a new `src/untyped_rankable.py` — the candidate rule and the adjudication assertion
- `build_dataset.py` — consume the `allow` list in `rankable_affixes()`; run the assertion in `build()`
- `tests/test_untyped_rankable.py` (new)
- `tests/test_build_metadata.py` — extend the rankable-list assertions

**Approach:** `rankable_affixes()` keeps its `bt in (None, "", "boolean", "Bool")` skip as the default and gains one exception: a name on the `allow` list is admitted when it otherwise qualifies (numeric value, well-formed name, two or more distinct items). Keeping the skip as the default is what stops the 168 proc names from arriving.

The candidate rule is separate from admission. It scans the raw planner records for untyped, numeric, well-formed names on two or more items that reach at least one worn slot — excluding `Weapon` and `Offhand`, where the rune-arm imbue family and the proc population live. Any candidate in neither `allow` nor `quarantined` fails the build with the offending name and its slot distribution.

Seed `quarantined` with the current candidate set so the build is green on day one. Each entry carries a reason; "unreviewed" is an honest reason and marks the filed backlog.

**Patterns to follow:** `docs/solutions/conventions/exclude-until-verified-data-gates.md` — empty-or-partial seed, fail-safe loader, absence as the signal. `_well_formed_stat` at `build_dataset.py:325` already rejects the unbalanced-paren parse leakage (`Required Trait: Chaotic (UMD`); reuse it rather than re-deriving.

**Execution note:** prove the adjudication guard fails before trusting it — drop one quarantined name from the seed, confirm the build goes red naming it, then restore.

**Test scenarios:**
- `metadata.rankable_affixes` contains `Enhanced Ki` and does not contain `Holy`, `Vampirism`, `Maiming`, or any Bane name.
- The picker's suggestions contain `Enhanced Ki`; searching "ki" surfaces it.
- A quarantined name (e.g. `Linguistics`) stays out of suggestions and stays free-typeable via `known`.
- The candidate rule excludes a `Weapon`-only and an `Offhand`-only untyped name.
- The candidate rule excludes a one-item untyped name and a non-numeric one.
- The candidate rule excludes an unbalanced-paren name.
- The guard fails on a candidate present in neither list, and the message names the offending affix.
- The guard refuses to inspect zero records.
- An empty `allow` list reproduces today's rankable vocabulary exactly.

**Verification:** `Enhanced Ki` is selectable and scores; the guard has been shown red and restored; the rankable count moves by exactly one.

---

### U3. Unhide named multi-word presence effects

**Goal:** searching "kick" in the priority picker finds `Kick 'Em While They're Down`, and new word-cap casualties are visible rather than silent.

**Requirements:** R3, R5, R6

**Dependencies:** none

**Files:**
- `web/dataset.js` — seed `PRESENCE_ALLOW` with `Kick 'Em While They're Down`
- `tests/dataset.test.js` — extend the picker-vocabulary assertions
- `tests/fixtures/` — a fixture pinning the current word-cap casualty set

**Approach:** `_isPresenceTargetable` already consults `PRESENCE_ALLOW` before the noise regex and the word cap, so seeding it is a data change, not a logic change. The cap stays for everything else.

Add a test-level report over the casualty set: `Bool` names that pass the noise regex and fail only the word count. Pin the current set as a fixture; when a dataset rebuild introduces a name that is not in the fixture and not in `PRESENCE_ALLOW`, the test fails and someone rules on it. This is the presence-side analogue of U2's guard, and it belongs in the JS suite because the cap lives in `web/dataset.js`.

**Patterns to follow:** the `presence` / `magnitude` distinction already documented at `web/dataset.js:383-400` — `Kick 'Em While They're Down` is presence-only with no magnitude anywhere, so it needs no declared-credit handling.

**Execution note:** prove the fixture guard fails before trusting it — add a synthetic five-word `Bool` name to the test dataset, confirm the test goes red, then remove it.

**Test scenarios:**
- `Kick 'Em While They're Down` is in `suggestions` and in `presence`.
- A picker search for "kick" returns it.
- It is not in `magnitude` — it has no rankable bucket, so no declared-credit control is offered.
- The other 34 casualties stay out of suggestions and stay in `known`.
- A sentence-shaped `Bool` name (e.g. the vorpal negative-level line) stays hidden.
- The casualty fixture guard fails when an unlisted five-word `Bool` name appears.

**Verification:** the reported search works; the casualty count is unchanged except for the one promotion.

---

### U4. Verify in the browser and ship

**Goal:** both reported affixes work end to end against real data, and the build stamps move together.

**Requirements:** R1, R3, R7

**Dependencies:** U1, U2, U3

**Files:**
- `web/index.html` — `?v=` cache-busts
- `web/app.js` — footer `BUILD`
- `README.md` — `**Current build:**` line and, if the numbers move, the affix counts

**Approach:** rebuild, run both suites, then a browser pass over a local server. Unit tests prove the vocabulary; only the browser proves a player can actually find and solve with these.

Re-ratify the golden solves deliberately if they move. A diff after the rename is possible if a fixture referenced `Ki`; a diff after the vocabulary additions is not expected and would mean something else changed.

**Test scenarios:**
- Search "enhanced ki" in the priority picker, add it, solve at ML 34, and confirm the loadout picks a `Enhanced Ki 5` item and the receipts name the enchantment.
- Search "kick" in the priority picker, add the effect, solve, and confirm one of the 12 carriers is chosen and shown as a feature rather than a magnitude.
- Confirm the Share exports carry both, per the standing exports invariant.
- Confirm `tests/test_build_stamp.py` passes, which means the three stamps agree.

**Verification:** both reports are reproducibly fixed in the browser; the full suite is green; `tests/test_build_stamp.py` passes.

---

## Verification Contract

```
python3 build_dataset.py                       # seed + shards -> web/data/items.json
python3 tests/run_tests.py                     # Python suite (baseline: 472 passed, 0 failed)
for t in tests/*.test.js; do node "$t"; done   # JS suite — one file per invocation
python3 -m http.server 8000                    # then browser-verify at /web/
```

Run the JS tests file by file. `node a.js b.js` executes only the first and has silently skipped the golden solver check before.

Gates:
- Both new guards have been shown red against a corrupted input and restored.
- Every new test has been shown to fail against the pre-change tree; copy the gitignored generated data in first, or the crash reads as a pass.
- A golden or parity diff is re-ratified deliberately, never blanket-accepted.

## Definition of Done

**Global**

- `Enhanced Ki` and `Kick 'Em While They're Down` are both findable by search in the priority picker and both score in a real solve.
- Typing `Ki` still resolves.
- Both curated seeds carry only wiki-verified entries; everything else is quarantined with a reason.
- Both guards fail the build on an unadjudicated name and have been proven to do so.
- Full suite green; golden re-ratified deliberately if it moved.
- The three build stamps agree and `tests/test_build_stamp.py` passes.
- The four deferrals in Scope Boundaries are filed as issues before the PR merges, per the Open work rule in `AGENTS.md`.
- The PR body writes `Closes #227` and `Closes #228` — a bare `#N` links without closing.
- No dead-end or experimental code left in the diff.

**Per-unit**

- U1: the rename is applied before `rankable_affixes()` reads the records, and the drift guard is live.
- U2: an empty `allow` list reproduces today's rankable vocabulary exactly.
- U3: the casualty fixture is pinned and its guard is live.
- U4: verified in a browser against real data, not only in unit tests.
