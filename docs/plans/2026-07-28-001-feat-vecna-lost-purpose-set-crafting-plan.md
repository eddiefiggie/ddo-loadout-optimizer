---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
date: 2026-07-28
title: Vecna Lost Purpose + Dino Set-Bonus — Chosen Set-Membership Crafting - Plan
---

# Vecna Lost Purpose + Dino Set-Bonus — Chosen Set-Membership Crafting - Plan

## Goal Capsule

**Objective.** Add a general **chosen-set-membership** crafting primitive to the optimizer and light up two crafting systems on it: (1) the Vecna Unleashed **Cannith Repurposing Station** — 44 "Lost Purpose" items each awaken **one** of **11** set bonuses; and (2) the already-sourced-but-solver-deferred **Dino Set-Bonus** — Isle of Dread Armor/Helmet/Cloak hosts count toward one of **6** Dino sets. Both are single-pick set-membership slots that differ only in their set pool and whether the set has intrinsic members. Add all Vecna raid + quest gear as items so the awaken prescriptions land on real gear.

**Why now.** Zero Vecna coverage exists today (verified: 0 hits in `data/seed/ddo_items.json` for every set name and for `lost purpose`/`repurposing`/`awaken`), and Vecna was deferred twice (`docs/plans/2026-07-25-002` L191; `2026-07-25-003` L43). Dino Set-Bonus activation was deferred until IoD intrinsic pieces exist and completion is meaningful (`CONCEPTS.md` "Dino Set-Bonus") — the R4 endgame band shipped those IoD ML30-36 pieces as solver-active, so completion is now meaningful. Both systems collapse onto one primitive, so building them together is cheaper than either alone.

**Mechanic — wiki-confirmed.** Cannith Repurposing Station (DDO wiki `Lost Purpose`), manual quoted: *"you may select a new purpose (set bonus) for them here... choosing a new one will erase the old one."* → single-pick, mutually exclusive. Distinct from the **Esoteric Table** (weapon/shield affix-swap) — deferred.

**Product authority.** This plan is the source of truth for WHAT and HOW. **Product Contract preservation: changed** — scope expanded on 2026-07-28 (user-approved) from Vecna-only to also activate Dino Set-Bonus on the shared primitive. The Vecna Product Contract is otherwise unchanged; the Dino addition is additive.

**Open blockers.** None. Mechanic + rosters wiki-sourced; per-set `piece_bonuses` harvest is a build-time unit (confirmed harvestable via the MediaWiki `parse` API in Chrome).

---

## Product Contract

### Primary actor & outcome
A DDO player theorycrafting a Vecna-era or endgame build enters ranked affix priorities and gets an optimizer result that (a) values Vecna raid/quest gear and IoD Dino hosts correctly, and (b) prescribes **which set bonus to awaken on which item at which station** ("Awaken *Legendary Vol's Influence* on *Legendary University Mage's Hat* at the Cannith Repurposing Station") to best serve those priorities — every value wiki-traceable, consistent with DDO bonus-type stacking.

### In scope
- **All 11 Vecna set bonuses** (Heroic + Legendary), each with wiki-sourced `piece_bonuses` → `(stat, bonus_type, value, pieces_required)`: Heart of Blades, Vol's Influence, The Fury's Rage, Delight of the Devourer, Minion of the Mockery, The Keeper's Coffin, The Shadow's Emptiness, The Traveler's Guidance, Devils' Infernal Dance, Armaments of the Archons, Forbidden Knowledge.
- **The 44 "Lost Purpose" items**, each a single-pick set-membership slot over the 11-set pool.
- **All remaining Vecna raid + quest gear** as items with static affixes: Fire Over Morgrave raid roster (weapons carry **Forbidden Knowledge** as fixed membership; shields, rune arm, gauntlets, necklace, Page Regalia cloaks) and the Update 61 named-items quest roster.
- **Dino Set-Bonus solver activation** — the 6 Dino sets (already in `dino_crafting.json` `set_augments`) become solver-active via the shared primitive; Armor/Helmet/Cloak hosts with `dino_set_bonus_slot` awaken one Dino set.
- **The chosen-set-membership solver primitive** — self-seeds set thresholds, per-host single-pick, feeds the shared `set_active` count; result sheet + browse disclose it.

### Out of scope (deferred)
- **Esoteric Table** weapon/shield affix-swaps (Object Seared → Warp Souls; Unleash Fire/Lightning/Resistance) — unrankable procs. Add the items; not the swaps.
- **Shield Repurposing** — dev-noted, wiki-unconfirmed. Excluded under strict exclude-until-verified.
- Ingredient/currency economics — theoretical-BiS assumes obtainable.

### Success criteria
- All 11 Vecna sets + 44 Lost Purpose items present and solver-active (or explicitly quarantined with reason + `wiki_url`, never inferred).
- **Awaken-only completion works**: N Lost Purpose items awakened to the same set with no intrinsic member equipped activate that set's N-piece threshold.
- **Fixed + awakened mix**: Forbidden Knowledge counts fixed raid-weapon pieces and awakened Lost Purpose pieces into one threshold.
- **Dino Set-Bonus fires**: a Dino set completes from intrinsic IoD pieces + a crafted set-bonus slot.
- Result sheet names the exact awaken + station; browse rows for slot-only hosts render their settable membership, not empty.
- Deterministic under the staged lexicographic solve; tests mirror the seal/joker suites.

### Key decisions (product-level)
- Single-pick, mutually-exclusive awaken (wiki manual).
- Full coverage, not a subset (user-directed).
- Strict wiki sourcing via Claude-in-Chrome; ambiguous values quarantined, never inferred.
- Esoteric Table swap deferred (user-chosen 2026-07-28).
- Dino Set-Bonus activated on the same primitive (user-approved 2026-07-28).

---

## Research Summary

**Primitive seam (reuse, do not add a code path).** Every stat source is a **gated contribution** `(stat, bonus_type, value)` whose `z` var is enabled only when its gates hold; new crafting primitives extend `buildProgram`'s `extraVars`/`extraConstraints` in `web/solver.js` (`docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md`). All sources feed the same `(stat,bonus_type)` max-buckets, so cross-source stacking is correct for free.

**The two closest primitives are orthogonal halves of what we need:**
- **Seal** (`web/solver.js:317-351`) = the single-pick choice-slot: host gate `sl - x_item <= 0`, per-slot `Σ sl <= 1`, bucket contribution. Pool keyed by `seal_type`.
- **Joker** (`web/solver.js:382-403`) = the set-piece contribution: appends a chosen-option binary onto a set's piece list (`setPieces.get(setName).push(j)`), summed by the threshold constraint at `web/solver.js:422`.

**The decisive finding (grounds KTD1).** Joker's counting **generalizes** to a non-disjoint shared pool (44 items → one shared threshold, mixed with fixed pieces — the per-host `hostSets` guard only stops one host double-feeding a set). **But** joker has a bootstrap gate at `web/solver.js:390`: a joker binary is created only for a set already registered in `setPieces`/`setTiers`, and those are populated **only from an equipped item's fixed `set_bonus` membership** (`web/solver.js:361-372`). Joker hosts have `set_bonus` cleared at build (`build_dataset.py:235`). So **joker cannot bootstrap a set with zero fixed members equipped** — which is exactly the Vecna Lost Purpose (awaken-only) case. The new primitive must **self-seed** `setPieces`/`setTiers` from set definitions.

**Set machinery.** Threshold = binary `s_active` with `N·s_active - Σ(pieceVars) <= 0` (`web/solver.js:405-427`); tier stats are contributions gated by `[s_active]`, emitted only when a tier affix advances a ranked target. Set definitions are baked onto member items at build (`src/set_catalog.py` `definition_for`, base-def-wins-else-catalog; catalog file `data/seed/compendium/raw/gearplanner_sets.json`).

**Dominance safety (grounds KTD5) — recurring P1 bug class.** The pre-filter's comparison surface must remain a superset of every dimension the objective reads (`docs/solutions/.../milp-encoding-for-gear-optimization.md` guidance #6). A new value-carrying dimension (a settable set-membership slot) must be added to `dominates()` (`web/model.js`, mirror the seal `web/model.js:102-109` and joker `web/model.js:115-117` `countColors` guards) plus a regression test — this bug recurred 3× (set thresholds, Dino slots, Nearly-Complete). Separately, dominance is **unsound for piece-count thresholds in multi-pick slots** (`cardinality > 1`): two same-set awakened pieces in a multi-pick slot are both legitimately needed, so a `cardinality` guard must prevent pruning one (real repro precedent: Seasons of the Feywild 6-piece; pinned by `tests/model.test.js` "keeps a dominated set-member in a multi-pick slot").

**Dino Set-Bonus (grounds U4).** Already sourced + browsable: `dino_crafting.json` carries `set_augments` (6 sets) + `crafted_hosts`; hosts flag `dino_set_bonus_slot` (`src/dino.py:84-126`); only Armor/Helmet/Cloak carry it, one set needs 5 pieces. Solver activation was deferred pending intrinsic IoD pieces — now present. It is **intrinsic-anchored** (unlike awaken-only Vecna), so the self-seeding primitive covers both.

**Pipeline / provenance.** Strict per-affix quarantine (`docs/solutions/design-patterns/parsing-ddo-wiki-affix-text.md`): gate eligibility per-affix, quarantine an item only if it has zero eligible affixes; never fabricate magnitudes; capture sign. **KTD6 reconciliation gotcha** (`docs/solutions/.../r4-endgame-band-enrichment.md`): host-pipeline items never appear in `enriched_*.json`; derive "already active" from a build excluding new shards, and `build_dataset` dedups by name (a double-listed name is silently dropped). Dataset identity is `source_item`/`variant_id`, not `name`.

**Harvest bridge (confirmed working).** `ddowiki.com` server-side fetch is blocked; same-origin MediaWiki `parse` API works in Claude-in-Chrome (verified: `Named_item_sets` pageid 9371 returned wikitext). `javascript_tool` truncates ~2 KB and guards wikitext payloads — stage JSON into a `<pre>` and read via `get_page_text`. Sets can be **multi-threshold** (bonus at 3 + superior at 5); Vecna predates the Lunar/Solar era so it uses classic set bonuses.

**Browse visibility.** A pool not merged into `dataset.items[]` is invisible to the browser (iterates `items[]` only) — add slot-only hosts to `browsableItems()` in `web/browse.js` and surface the settable membership or the row renders empty (`docs/solutions/.../browse-visibility-for-separate-source-pools.md`).

---

## Key Technical Decisions

### KTD1 — A general self-seeding chosen-set-membership primitive (not joker-reuse)
Build a thin new primitive rather than reusing joker. **Rationale:** joker cannot bootstrap awaken-only sets (`web/solver.js:390`), and Vecna Lost Purpose items are awaken-only. The primitive **self-seeds** `setPieces`/`setTiers` for its set pool from the set catalog regardless of any equipped fixed member, then adds per-host single-pick binaries feeding the shared threshold. *(session-settled: user-directed — chosen over joker-reuse: joker's bootstrap gate makes pure-awaken completion unreachable.)*

### KTD2 — One single-pick group per host
Each host exposes one group over its pool with `Σ pick <= 1` (mirroring seal's per-slot cap and joker's per-group cap). Matches the wiki "choosing a new one erases the old." Re-craftability is irrelevant under theoretical-BiS.

### KTD3 — Unified primitive, two pools
Vecna Lost Purpose hosts carry pool = 11 Vecna sets; Dino hosts (`dino_set_bonus_slot`, Armor/Helmet/Cloak) carry pool = 6 Dino sets. One solver block, keyed by a generic `set_membership_slot` field on the variant; the pool list distinguishes systems. Avoids two near-identical code paths.

### KTD4 — Self-seed thresholds from a runtime-exported set-def table
The primitive registers each pool set's tier definition into `setTiers`/`setPieces` even when no fixed member is equipped (the gap joker leaves). **Critical dependency:** today set definitions are baked onto member items at build time and there is **no standalone set-def table the browser solver reads** (`gearplanner_sets.json` is build-time Python only). Self-seeding therefore requires **exporting the membership pools' set definitions (name → tiers → parsed affixes) into `web/data/items.json` as a runtime structure** (e.g. a `membership_set_defs` map). U7 exports it; U5 reads from it, not from an equipped item. For intrinsic-anchored sets (Dino, Forbidden Knowledge) the fixed pieces still register and sum in normally — self-seeding is idempotent with fixed membership.

### KTD5 — Dominance carry-through + cardinality guard
Add `set_membership_slot` to `dominates()` in `web/model.js` (mirror seal/joker `countColors`), and honor the `cardinality > 1` guard so multi-pick-slot pieces awakened to the same set are not pruned. Both pinned by new `tests/model.test.js` regressions.

### KTD6 — Strict-provenance sourcing + baseline-excluding reconciliation
Harvest via the MediaWiki `parse` API in Chrome; parse through the strict `src.enrich`/affix parser; quarantine per-affix with reason + `wiki_url`; never infer. Derive "already active" from a build excluding the new Vecna shards to avoid silent dedup drops.

### KTD7 — Defer Esoteric Table + shield repurposing
Add the items; do not model the affix-swap (unrankable procs) or the unconfirmed shield repurposing.

---

## High-Level Technical Design

Constraint construction for one host with a `set_membership_slot` (pool = its system's sets), showing the self-seed that distinguishes this from joker:

```mermaid
flowchart TD
  A[Variant with set_membership_slot: pool of set names] --> B{For each set in pool}
  B --> C[Self-seed: ensure setTiers/setPieces registered<br/>from set catalog def — even if no fixed member]
  C --> D[Emit host-gated pick binary p_i<br/>p_i - x_host &lt;= 0]
  D --> E[Append p_i to setPieces of that set]
  B --> F[Per host: Σ p_i &lt;= 1  single awaken]
  E --> G[Shared threshold:<br/>N·s_active - Σ pieceVars &lt;= 0<br/>fixed + awakened pieces summed]
  G --> H[Tier stats gated by s_active → (stat,bonus_type) buckets]
  H --> I[Bucket max Σz &lt;= 1 → objective]
```

Data flow across the pipeline:

```mermaid
flowchart LR
  W[DDO wiki via Chrome parse API] --> R[raw/vecna_*.json harvest]
  R --> E[src.enrich strict parse] --> S1[enriched_vecna_sets.json + items]
  DINO[existing dino_crafting.json set_augments] --> SC[set catalog]
  S1 --> SC[set catalog defs]
  SC --> B[build_dataset.py attach set_membership_slot + reconcile]
  B --> J[web/data/items.json: items[] + set defs]
  J --> SV[web/solver.js membership primitive]
  J --> BR[web/browse.js slot-only host display]
  SV --> UI[web/results.js awaken prescription]
```

---

## Implementation Units

### U1. Source and model the 11 Vecna set definitions
**Goal:** the 11 Vecna sets exist as catalog set definitions with per-tier `piece_bonuses` → `(stat, bonus_type, value, pieces_required)`, Heroic + Legendary.
**Requirements:** In-scope "all 11 Vecna set bonuses"; success criterion "solver-active or explicitly quarantined."
**Dependencies:** none.
**Files:** `data/seed/compendium/raw/vecna_sets_raw.json` (harvested wikitext staging, new), `data/seed/compendium/raw/gearplanner_sets.json` (extend catalog), `src/set_catalog.py` (consume), `tests/test_set_catalog.py` (or nearest existing set test).
**Approach:** Harvest each set's tier table from `Named item sets` (pageid 9371) / per-set sections via the Chrome `parse` API into `<pre>` → repo. Parse each `piece_bonuses` label through the strict affix parser (`src/set_parser.py` shape). Preserve multi-threshold sets (e.g. 3-piece + 5-piece). Quarantine any label with no explicit magnitude (record reason + `wiki_url`); never infer.
**Patterns to follow:** `src/set_parser.py:88-113` (`parse_set_bonuses`, `_pieces_required`); `src/set_catalog.py:141` (`definition_for`).
**Test scenarios:**
- A set with a single threshold parses to the right `pieces_required` and affix tuples.
- A multi-threshold set yields both tiers with distinct `pieces_required`.
- A non-magnitude/descriptive `piece_bonuses` line is flagged/quarantined, not guessed (Covers success criterion "never inferred").
- Sign captured correctly on any negative line.
**Verification:** the 11 sets resolve via `definition_for`; quarantined tiers list a reason + `wiki_url`.

### U2. Source and add the 44 Lost Purpose items with a set-membership slot
**Goal:** the 44 Lost Purpose items are dataset variants each carrying `set_membership_slot: {pool: "vecna_lost_purpose"}`.
**Requirements:** In-scope "44 Lost Purpose items."
**Dependencies:** U1 (pool set names must resolve).
**Files:** `data/seed/compendium/raw/vecna_lost_purpose_raw.json` (new), `data/seed/compendium/enriched_vecna_lost_purpose.json` (new shard), `src/variants.py` (thread the new field, mirror `seal_slots` at `src/variants.py:71`), `tests/test_vecna_repurpose.py` (new).
**Approach:** Harvest the 44-item roster + each item's base affixes from `Lost Purpose` + `Update 61 named items` / `Fire Over Morgrave`. Enrich base affixes via strict `src.enrich`. Attach `set_membership_slot` with the Vecna pool. Items with zero eligible base affixes but a membership slot are **kept** (slot-only hosts are the sanctioned Verified exception), not quarantined.
**Patterns to follow:** `seal_slots` threading (`src/variants.py:71`, `build_dataset.py:151-159` graft); Blank-host "kept despite no affixes" rule (`CONCEPTS.md`).
**Test scenarios:**
- All 44 items load as variants; each carries the Vecna pool on its membership slot.
- A slot-only Lost Purpose item (no parseable base affix) is Verified, not quarantined.
- Item base affixes parse to expected tuples for a representative armor + a Page Regalia cloak.
**Verification:** dataset build exposes 44 hosts with a Vecna membership slot.

### U3. Source and add remaining Vecna raid + quest gear
**Goal:** all Fire Over Morgrave raid items and Update 61 quest items exist as variants with static affixes; raid weapons carry **Forbidden Knowledge** fixed membership.
**Requirements:** In-scope "all remaining Vecna raid + quest gear."
**Dependencies:** U1.
**Files:** `data/seed/compendium/raw/vecna_gear_raw.json` (new), `data/seed/compendium/enriched_vecna_gear.json` (new shard).
**Approach:** Harvest rosters; enrich via strict parser. Weapons list "Legendary Forbidden Knowledge" → attach fixed `set_bonus` membership for Forbidden Knowledge (so it registers the threshold and mixes with awakened pieces). Do **not** model Esoteric Table swaps.
**Patterns to follow:** enriched shard format (`docs/solutions/.../r4-endgame-band-enrichment.md`); base `set_bonus[]` shape (`data/seed/ddo_items.json:106-116`).
**Test scenarios:**
- A raid weapon carries Forbidden Knowledge fixed membership and its static affixes.
- A quest item with only rankable affixes is Verified; an item with no explicit magnitudes is quarantined with reason.
- No Esoteric-Table-only proc is emitted as a rankable affix.
**Verification:** raid + quest rosters present; Forbidden Knowledge has fixed members.

### U4. Activate Dino Set-Bonus on the shared membership slot
**Goal:** the 6 Dino sets become solver-active; Dino hosts with `dino_set_bonus_slot` expose `set_membership_slot: {pool: "dino"}` gated to Armor/Helmet/Cloak.
**Requirements:** In-scope "Dino Set-Bonus solver activation."
**Dependencies:** U5 (primitive), U1 pattern (catalog defs) — Dino set defs already in `dino_crafting.json` `set_augments`.
**Files:** `src/dino.py` (emit `set_membership_slot` from `dino_set_bonus_slot`/`set_augments`), `data/seed/dino_crafting.json` (no re-source; map existing `set_augments` into catalog defs if not already), `tests/test_dino.py` or nearest.
**Approach:** Reuse the sourced `set_augments` as the Dino pool's set definitions. Map the existing `dino_set_bonus_slot: bool` to the generic `set_membership_slot` with the Dino pool, restricted to Armor/Helmet/Cloak hosts. Intrinsic IoD pieces register thresholds normally; the crafted slot adds pieces.
**Patterns to follow:** `src/dino.py:84-126` (host layout, `dino_set_bonus_slot`).
**Test scenarios:**
- Only Armor/Helmet/Cloak Dino hosts expose a Dino membership slot.
- A Dino set completes from intrinsic IoD pieces + one crafted set-bonus slot.
- A 5-piece Dino set does not activate below threshold.
**Verification:** the 6 Dino sets appear as solver-active given intrinsic pieces + a crafted slot.

### U5. Solver — the chosen-set-membership primitive
**Goal:** `web/solver.js` builds self-seeding, single-pick membership binaries feeding shared set thresholds.
**Requirements:** Success criteria "awaken-only completion," "fixed + awakened mix," "Dino Set-Bonus fires."
**Dependencies:** none (data units feed it, but the code stands alone against fixtures).
**Files:** `web/solver.js`, `web/model.js` (thread `set_membership_slot` into the model like `seal` at `web/model.js:258-265`).
**Approach:** New block after set-tier construction. For each variant's `set_membership_slot`, for each set in its pool: (1) **self-seed** — if the set is not yet in `setTiers`/`setPieces`, register it from the **runtime `membership_set_defs` table** exported by U7 (this is the joker gap; the def must be runtime-available, not baked-on-member-only); (2) emit host-gated pick binary `p - x_host <= 0`; (3) push `p` onto `setPieces[set]`. Per host: `Σ p <= 1`. Append pick vars to the tie-break objective with continuing positive coefficients so an awaken is set only when load-bearing (mirror joker `web/solver.js:466-468`). Report awakens (set + item + station) only when the set is active and the pick is load-bearing.
**Technical design (directional):** the self-seed step is the one line joker omits — register the threshold def before the `continue` at the joker equivalent of `web/solver.js:390`.
**Patterns to follow:** seal construction `web/solver.js:317-351`; joker construction `web/solver.js:382-403`; threshold `web/solver.js:405-427`.
**Execution note:** start with a failing end-to-end test for awaken-only completion (the case joker cannot do), then build the primitive to pass it.
**Test scenarios:** (owned by U9 end-to-end; unit-level here:)
- Self-seed registers a set with zero fixed members so its threshold constraint is emitted.
- `Σ p <= 1` enforces one awaken per host.
- A pick var is minimized to 0 unless load-bearing.
**Verification:** LP includes membership pick vars and self-seeded thresholds; `node tests/solver.test.js` green.

### U6. Dominance carry-through and guards
**Goal:** slot-only membership hosts survive the Pareto pre-filter; multi-pick same-set pieces are not wrongly pruned.
**Requirements:** KTD5; success criterion "browse rows not empty" depends on hosts surviving.
**Dependencies:** U5.
**Files:** `web/model.js`, `tests/model.test.js`.
**Approach:** Add `set_membership_slot` pools to `dominates()` as a `countColors` multiset guard (B has it, A must match or A can't dominate B) — mirror seal `web/model.js:102-109`. Extend/confirm the `cardinality > 1` guard covers membership-slot pieces.
**Patterns to follow:** seal/joker dominance guards (`web/model.js:102-117`); existing cardinality guard + its test.
**Test scenarios:**
- An affix-rich rival does NOT dominate a slot-only membership host (regression, mirrors the Blank-host case).
- In a multi-pick slot (e.g. rings), a dominated same-set awakened piece is kept when needed for a threshold (mirrors "keeps a dominated set-member in a multi-pick slot").
- A host with a superset of membership pools is not pruned by one with a subset.
**Verification:** `node tests/model.test.js` green; no slot-only host pruned end-to-end.

### U7. Build pipeline wiring and reconciliation
**Goal:** the new shards + `set_membership_slot` fields flow into `web/data/items.json` without double-listing.
**Requirements:** KTD6.
**Dependencies:** U1, U2, U3, U4.
**Files:** `build_dataset.py`, `src/set_membership.py` (new, if a parse step is warranted; else inline like joker at `build_dataset.py:228-235`), `tests/test_build_dataset.py` or nearest.
**Approach:** Load the Vecna shards + attach `set_membership_slot` to matching variants (by `source_item`). Ensure Vecna set defs enter the set catalog. **Export a runtime `membership_set_defs` map** (set name → tiers → parsed affixes) into `web/data/items.json` for every set in a membership pool (Vecna 11 + Dino 6), so the solver can self-seed thresholds without an equipped member (KTD4). Derive "already active" from a build excluding the new shards; assert no name is double-listed (the silent-dedup trap). Expose any separate membership pool alongside `dino_inserts`/`seal` in the output object.
**Patterns to follow:** joker inline attach (`build_dataset.py:228-235`); seal graft (`build_dataset.py:151-159`); output pools (`build_dataset.py:346-374`).
**Test scenarios:**
- A Vecna Lost Purpose variant emerges from `build()` with its membership slot and pool.
- A name present in both base seed and a new shard is not double-listed (dedup honored).
- The 11 Vecna set defs resolve via `definition_for` after build.
- `items.json` carries a `membership_set_defs` entry (name → tiers → affixes) for every Vecna and Dino pool set, so the solver can self-seed with no member equipped.
**Verification:** `python3 build_dataset.py` produces items.json with Vecna hosts + set defs; `python3 tests/run_tests.py` green.

### U8. Results prescription and browse visibility
**Goal:** results name the exact awaken + station; slot-only hosts render their settable membership in browse.
**Requirements:** Success criteria "result sheet names the exact awaken + station," "browse rows not empty."
**Dependencies:** U5, U7.
**Files:** `web/results.js`, `web/browse.js`.
**Approach:** In results, render awaken prescriptions ("Awaken *&lt;set&gt;* on *&lt;item&gt;* at the &lt;Cannith Repurposing Station|Dinosaur Bone crafting&gt;"). In browse, include slot-only membership hosts in `browsableItems()` and display the pool of awakenable sets so the row is not empty.
**Patterns to follow:** existing seal/joker result disclosure; `browsableItems()` display-only projection (`web/browse.js`).
**Test scenarios:** (JS filter/browse suite)
- A slot-only Lost Purpose host appears in browse with its awakenable-set list.
- A result with an awakened set shows the prescription text with the correct station.
**Verification:** `node tests/browse.test.js` green; manual browser pass shows a Lost Purpose host and an awaken prescription.

### U9. End-to-end solver + Python tests
**Goal:** the four success behaviors are pinned by tests mirroring seal/joker.
**Requirements:** all success criteria.
**Dependencies:** U5, U7.
**Files:** `tests/solver.test.js`, `tests/test_vecna_repurpose.py`.
**Approach:** Fixtures for Vecna Lost Purpose hosts + the 11 sets, and a Dino fixture.
**Test scenarios:**
- **Awaken-only completion:** 3 Lost Purpose hosts awakened to the same set, no intrinsic member → set activates at 3 pieces (the joker-impossible case).
- **Single-pick:** a host cannot awaken two sets.
- **Fixed + awakened mix:** 1 Forbidden Knowledge raid weapon + 1 awakened Lost Purpose item complete a 2-piece Forbidden Knowledge tier.
- **Dino:** intrinsic IoD pieces + a crafted Dino set-bonus slot complete a Dino set.
- **Load-bearing reporting:** an awaken is reported only when it is the Nth piece that activates the set.
- **Determinism:** identical inputs → identical awaken assignment across runs.
**Verification:** `node tests/solver.test.js` and `python3 tests/run_tests.py` green.

---

## Verification Contract
- `python3 build_dataset.py` regenerates `web/data/items.json` with the 11 Vecna sets, 44 Lost Purpose hosts, Vecna raid/quest gear, and Dino membership slots — no errors, no double-listed names.
- `python3 tests/run_tests.py` (Python suite) and `node tests/solver.test.js` + `node tests/model.test.js` + `node tests/browse.test.js` all green.
- The four success behaviors (awaken-only, fixed+awakened, Dino, single-pick) each have a passing test.
- Browser pass: a query where a Vecna set is optimal shows the awaken prescription with the correct station; a Lost Purpose host is browsable and non-empty.
- Quarantine report lists any ambiguous set tier / item affix with reason + `wiki_url`; nothing inferred.

## Definition of Done
- All in-scope items and sets are solver-active or explicitly quarantined; success criteria met and tested.
- Dominance regressions (slot-only host survives; multi-pick same-set piece kept) pass.
- Deterministic solve confirmed.
- No Esoteric Table swap modeling; no shield repurposing.
- Live site regenerates cleanly (dataset is a gitignored artifact — edit pipeline + seed, not the JSON).

---

## Risks & Dependencies
- **Pre-existing Dino JS test failure** (noted in project memory) — must be triaged separately; U4/U9 Dino tests should not be conflated with it. Confirm the baseline failure before adding Dino tests so a new red is distinguishable.
- **Are the 11 Vecna sets new or pre-existing?** Some names (Vol's Influence, Armaments of the Archons) may be established DDO sets with intrinsic members elsewhere. The self-seeding primitive is robust either way, but the harvest (U1) must resolve each set's canonical definition and avoid duplicate catalog entries.
- **Wiki harvest volume** — 11 sets × 2 tiers + 44 items + raid/quest rosters. Respect rate limits; stage via `<pre>` + `get_page_text` (2 KB `javascript_tool` truncation).
- **Multi-threshold sets** interacting with existing named-item sets under stacking rules — validate during U1 that no Vecna set's `(stat, bonus_type)` silently collides.

## Scope Boundaries
### Deferred to Follow-Up Work
- Esoteric Table weapon/shield affix-swap upgrades.
- Shield repurposing (wiki-unconfirmed).
- Broader audit of whether other deferred crafting systems (Sharn, Myth Drannor, Ravenloft, Slave Lords) can adopt the same chosen-set-membership primitive.

## Open Questions (for implementation)
- Whether a dedicated `src/set_membership.py` parse module is warranted or inline attach (joker-style) suffices — resolve when wiring U7 against the real shard shapes.
- Exact canonical names for any pre-existing sets among the 11 (resolve during U1 harvest).

## Sources & Research
- DDO wiki (via Claude-in-Chrome): `Lost Purpose` (Cannith Repurposing Station — mechanic, 44-item list, 11-set pool), `Fire Over Morgrave` (raid roster, Esoteric Table), `Esoteric_Table`, `Update 61 named items` (quest roster), `Named item sets` (pageid 9371, set defs — harvest via `parse` API).
- Codebase: `web/solver.js` (seal 317-351, joker 382-403, sets 359-427, bootstrap gate 390), `web/model.js` (dominance 102-117), `build_dataset.py` (joker attach 228-235, seal graft 151-159), `src/set_parser.py`, `src/set_catalog.py`, `src/dino.py:84-126`, `CONCEPTS.md` (Dino Set-Bonus, Seal slot, Set bonus, Gated contribution).
- Learnings: `docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md`, `.../parsing-ddo-wiki-affix-text.md`, `.../r4-endgame-band-enrichment.md`, `.../browse-visibility-for-separate-source-pools.md`, `docs/solutions/logic-errors/bonus-type-vocabulary-collides-with-bare-stat.md`.
