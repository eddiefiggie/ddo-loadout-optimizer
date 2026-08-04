---
title: Augment Sets - Findings & Design (build deferred)
type: feat
date: 2026-08-03
topic: augment-sets-design
artifact_contract: ce-design-note/v1
product_contract_source: ce-work
execution: knowledge-work
---

# Augment Sets — Findings & Design (build deferred)

Deliverable of U7 from `docs/plans/2026-08-03-002-fix-user-reported-correctness-batch-plan.md`: **investigate + design only, no product code.** The structural solver change ships as its own follow-up once the mechanic is wiki-confirmed.

## 1. Do the augments exist? — YES (in the dataset)

`web/data/items.json` contains **21 augments named `"Set Augment: <SetName>"`** (`category: augment`, `slot: Colorless`, `ML 30`), e.g. *Set Augment: Alluring Elocution, Arcane Barrier, Arcane Guardian, Bold Tactician, Brutal Blows, Cruel Cut, Cunning Impact, Dusk Raider, …*. They come from the gear-planner augment pool.

**But they are inert.** Each carries `sets: null`, `set_bonus: []`, `parsed_set_bonuses` empty, and `affixes: []` — so the augment grants nothing and contributes to no set today. `wiki_url` is the generic `https://ddowiki.com/page/Augment_Slot`.

## 2. Wiki confirmation of the mechanic — CONFIRMED 2026-08-04: these are FILIGREE SETS, not a duplicate-augment mechanic

**Source:** https://ddowiki.com/page/Sentient_Weapon/Filigrees. The "Set Augment: X" names (Bold Tactician, Brutal Blows, Quickblade, Subtle Blade, Touch of Power, Piercing Mind, …) are **Filigree set names** from the **Sentient Weapon** system (U37).

The real mechanic is materially different from this design's original assumption:

- Filigrees slot into a **Sentient Weapon or Minor Artifact** — NOT augment slots on ordinary gear.
- **"A weapon can only have one of each filigree: two of the same filigree cannot be slotted."** So it is emphatically **NOT** "slot duplicate augments." The user's "duplicates" framing was imprecise.
- Set bonuses come from slotting **multiple DIFFERENT filigrees of the same set**: thresholds at 3 pieces (some sets also 4 and 5). "Well over two dozen filigree sets, each with 4–9 unique filigrees." Set bonuses are unique bonuses that stack.
- The 21 gear-planner **"Set Augment: X" entries are inert proxies** — empty affixes, no set-bonus data. They do not carry what each set grants.

### Consequence for scope

Modeling this correctly is **not** a small solver relaxation — it is a whole **Sentient Weapon + Filigree** feature:
1. A Sentient Weapon (weapon-slot item) with a variable number of filigree slots.
2. A filigree pool (each filigree = a stat contribution + a set membership).
3. A set-threshold mechanic over slotted filigrees (3/4/5-piece), reusing the set-bonus machinery.
4. **The filigree set-bonus data** (what each set grants at each threshold) — which is NOT in the current dataset and would need wiki-sourcing (exclude-until-verified), like the joker/Vecna/Dino set defs.

This is its own feature-sized effort (recommend a fresh `ce-brainstorm`), not a follow-up build off this note. The 21 inert proxies are not a usable shortcut (no bonus data). **Original "relax one-augment-per-variant" design below is superseded** by this finding and retained only for history.

### (Superseded) original mechanic question

Attempted `ddowiki.com/page/Set_augment` and a sample set page (`Alluring_Elocution`) on 2026-08-03 — **neither exists under those names**. The precise rule — whether slotting **duplicate** `Set Augment: X` augments across multiple Colorless slots accrues pieces toward set X's threshold, and the max/color constraints — **is not confirmed from a clean wiki source**. Per the batch's hard gate (KTD2/R4), **the build MUST NOT proceed on this inferred rule**; a targeted wiki source (the actual set page, the augment's real page, or the Named-item-sets listing) must confirm it first. This is the single blocking item for the deferred build.

## 3. Current solver treatment (why duplicates are impossible today)

- The solver models each augment as **at most one placement, used at most once**; Unique-Equipped augments sharing a `variant_id` get a global `≤ 1` (`web/solver.js` ~L213-295). So two copies of the same augment can never be slotted.
- Set thresholds count pieces only from worn-item `set_bonus`/`parsed_set_bonuses`, jokers, and membership slots (`web/solver.js` ~L596-714) — **not** from augment placements.
- Closest existing analogue: the Dinosaur Bone "Set Bonus augment" crafting system (`web/crafting-systems.js`, `mechanism_kind: "set_bonus_augment_assignment"`), which is sourced/browsable but "pending activation" and is a single-pick membership, not a duplicate-accrual mechanic.

## 4. Design of the model change (for the follow-up build)

Once the mechanic is wiki-confirmed:

1. **Link each `Set Augment: X` to set X.** Parse the set name from the augment name and canonicalize via `set_catalog.canonical`, keeping only names that resolve to a real set definition (exclude-until-verified). Attach at build time, mirroring the U6 joker attach pattern (`build_dataset.py`, post-`expand_dataset`).
2. **Relax the one-per-`variant_id` constraint for this augment class only.** Introduce a bounded integer placement (0..K copies) for a `Set Augment: X` instead of the current binary, where K is the number of available Colorless slots (and any wiki-confirmed cap). Scope the relaxation narrowly — every other augment keeps the `≤ 1` rule.
3. **Feed copies into the set-threshold machinery.** Each placed copy contributes +1 piece toward set X, entering the same `setPieces` accounting the joker/membership primitives already feed (`web/solver.js` set-threshold constraints). Reuse that path rather than inventing a parallel one.
4. **Render + attribute.** Surface the placed set augments in the Loadout Deep Dive and count them in the Set Bonuses tab like any other set contribution.

## 5. Open questions / blast radius

- **The mechanic (blocking).** Max copies per build? Do they compete with other Colorless augment uses (opportunity cost the solver must weigh)? Do duplicate set augments stack toward one set only, or can different `Set Augment: X` combine? Wiki-confirm before building.
- **Program size.** A bounded-integer placement per set augment across Colorless slots adds variables; verify it doesn't blow up the MILP (the reason augments were modeled as single-placement originally).
- **Set-def coverage.** Only the ~subset of the 21 sets that resolve to real definitions can activate; the rest are membership-only and disclosed as pending.
- **Interaction with the Gem of Many Facets joker** and Vecna/Dino membership — all feed set thresholds; confirm no double-count across primitives (the existing `hostSets` guard is per-item, not cross-primitive).

**Status:** existence CONFIRMED (data); mechanic UNCONFIRMED (wiki source missing) — build blocked on that confirmation. No code shipped for U7.
