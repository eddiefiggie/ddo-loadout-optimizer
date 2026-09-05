---
title: Legendary Green Steel is one container, not two - Plan
type: refactor
date: 2026-09-04
topic: legendary-green-steel-one-container
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: issue-triage
execution: code
---

# Legendary Green Steel is one container, not two (#687)

**Decision record.** Progress lives in git and in #687, not here.

## The ask

#687, deferred from the #194 hosts PR: the weapon half of Legendary Green Steel
shipped under a `thunder_forged` dataset key, a `tf` family key, a
`thunder_forged_tiers` host marker, a `src/thunder_forged.py` module and a
persisted `tfPlaced` result key — every one of them describing a crafting
system (Thunder-Forged, Magma Forge, ML 24/26/28) that has no menu in the
catalog at all (#653). #654 declined the rename as 34 files of churn for a pool
nobody could reach. #194 made both halves reachable, and every player-facing
label already reads "Legendary Green Steel", so the cost was entirely on the
next reader of the code.

## Key decisions

- **Unify, do not rename.** The two halves had identical shapes: per-tier
  single-pick over a Legendary Altar menu, one record per option carrying its
  own `affixes`, one host marker of `[{tier}]`, one solver loop each. Renaming
  `tf` to a Green-Steel-weapon name would have kept two copies of everything.
  One container, `legendary_green_steel`, keyed by `(item_class, tier)` with
  `item_class ∈ {accessory, weapon}`, replaces both — one builder
  (`crafting_catalog.legendary_green_steel_records`), one module
  (`src/legendary_green_steel.py`), one registry entry, one coverage reader,
  one host marker (`legendary_green_steel_tiers`, each slot carrying its class),
  one solver loop, one family key (`lgs` / `lgsEmpty`), one override channel,
  one placement key (`lgsPlaced`, each placement carrying `item_class`).
- **The class rides on the slot and the option, never on the host's name.** A
  host declares `T<n> (Equipment)` or `T<n> (Weapon)` in its own `crafting[]`;
  `planner_items` stamps the class from that label, and the solver matches a
  slot to an option on both class and tier. Nothing is inferred from
  "Legendary Green Steel Belt" versus "… Longsword".
- **Persisted state migrates on read, never in place.** `tfPlaced` and
  `gsPlaced` leave the save allowlist; `persist.migrateResult` folds them into
  `lgsPlaced` (stamping the class each key implied) when a character is
  loaded or exported, and a result already carrying `lgsPlaced` is never merged
  into. The stored record stays as the older build wrote it until the next
  save, so a downgrade still finds the keys it knows — the #346
  downgrade-bridge reasoning. Saved pool overrides get the same treatment:
  `overrides.migrateOverride` re-addresses a `thunder_forged||…` or
  `green_steel||T<n> (Equipment)||…` pool key to the new channel before the
  well-formedness filter, so a player's correction survives the rename.
- **The `greenSteelReport` shape is unchanged.** Its `half` field is now
  populated from `item_class`, so the notice, the exporters and every saved
  record that reads `half` keep working without a migration of their own.
- **The #653 guard is untouched.** `expects_stations` still asserts every
  option's station is a Legendary Altar. It is the thing that catches a
  relabelled pool, whatever the pool is called; the container name was never
  the guard.
- **Coverage keeps both populations visible.** `legendary_green_steel_coverage`
  carries the totals (116 options, 48 hosts, 144 slots) and a `by_class`
  breakdown (81 / 8 / 24 accessory, 35 / 40 / 120 weapon), and the build fails
  if either class has options but no verified host.

## Scope boundaries

- No change to what is modelled: the same 116 options reach the same 48 blanks
  and the matched-tier aspects stay disclosed, not modelled (AGENTS.md non-goal).
- `tests/parity/baseline.json` is the frozen pre-overhaul BEFORE image and keeps
  its historical `tfPlaced` keys; nothing reads them.
- Real Thunder-Forged recipes, should upstream ever add a Magma Forge menu, are
  a NEW container (`test_653_thunder_forged_has_no_menu_in_the_catalog` fires
  the day that happens).

## Deferred

Nothing. The rename was the whole of #687.
