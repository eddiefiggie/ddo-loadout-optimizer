---
title: Slaver's Crafting - Plan
type: feat
date: 2026-09-14
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: issue-triage
---

# Slaver's Crafting - Plan

**Issue:** #766. **Base:** `main` at `09142026.7`. Decision record; progress
lives in git and on the issue.

---

## Goal Capsule

Let the six Slaver's crafting hosts (`Chains`, `Five Rings`, `Shackles` at
heroic and legendary) craft one option into each of their four typed slots
(Prefix / Suffix / Extra / Bonus) and join one of the Slave Lord's sets through
their Set Bonus slot, from pools the gear-planner catalog already carries.

## The premise that was stale

`src/crafting_coverage.py`'s allowlist says "Slaver's crafting — heroic and
legendary. No pool." There is no *pipeline* pool. The raw catalog has all eight
option pools, natively typed, plus the two set-bonus pools:

| catalog key (heroic; legendary mirrors) | options | e.g. |
|---|---|---|
| `Slaver's Prefix Slot` | 10 | Charisma `Enhancement 5` (legendary 13) |
| `Slaver's Suffix Slot` | 25 | Accuracy `Competence 8`, Acid Spell Power `Equipment 70` |
| `Slaver's Extra Slot` | 27 | Balance `Competence 10` |
| `Slaver's Bonus Slot` | 30 | Balance `Quality 2` |
| `Slaver's Set Bonus` | 3 | `{set: "Slave Lord's Might"}` … |

No wiki harvest is needed for the four typed slots. That is the whole reason
this is the cheapest open system.

## Design

**One new ATOMIC container, `slavers`**, shaped like Legendary Green Steel:
one record per craftable option, carrying its own `affixes` list, keyed by
`(slot, tier)`. The host marker is `slavers_slots: [{slot, tier}]`, read
structurally from `crafting[]` (`^(Legendary )?Slaver's (Prefix|Suffix|Extra|Bonus) Slot$`),
never from a name.

**The tier is in the label, not the host's ML.** Viktranium derives its tier from
host ML (`lamordiaTier`, ML 30 boundary). `Legendary Chains` is **ML 28**, so
that rule would file a legendary host under the heroic pool. The label says
`Legendary Slaver's …`; the label is the source.

**The Set Bonus slot is chosen membership**, the Vecna Lost Purpose primitive:
`set_membership_slot: {pool: [set names], station}`, self-seeded from
`membership_set_defs`. The pool is the catalog's `Slaver's Set Bonus` option
list, **restricted to names that resolve to a set def**. Today that drops one:
the pool says `Slave Lord's Endurance`, the set catalog defines
`Slave's Endurance`. Same effect, different spelling, and mapping one onto the
other is an unsourced rename. It is dropped and **disclosed by name** in
`metadata.slavers_coverage.set_names_unresolved`; sourcing the name (a
one-line correction, wiki-cited) admits it.

**Player-facing name.** The data's own vocabulary is `Slaver's`; the wiki page
name was not readable from the build container and is not asserted. Labels use
"Slaver's crafting"; `station_name` is `null` until read.

## Units

- **U1 pipeline.** `src/slavers.py`; `planner_items._slavers_slots` /
  `_slavers_set_bonus`; `variants` carry-over; `membership` gains the Slaver's
  set names in `all_set_names()` (so `build_membership_set_defs` resolves them)
  and `attach_slavers_set_bonus_slots`; `build_dataset` builds, attaches,
  stamps `slavers_coverage`, emits the `slavers` key and its source-option
  count; `container_registry` declares it (`EXPECTED_CONTAINER_COUNT` 8 → 9);
  `crafting_coverage` drops the ten labels from the allowlist and gains a
  `_slavers` reader plus the set-bonus label in the membership reader;
  `craft_identity` stamps block keys.
- **U2 web.** `buildModel` takes a trailing `slavers` pool. Solver loop mirrors
  `lgsMeta` per declared slot (Σ ≤ 1 per slot, gated on the host). Results,
  projection, exporters, overrides, wizard picker, persist allowlist,
  alternatives craft count, crafting-systems entry, every `buildModel` call
  site including `capture_golden.js`.
- **U3 tests.** Proven red against the pre-change tree; golden re-ratified
  deliberately (heroic hosts are ML 8, legendary ML 28 — fixtures at ML 32+
  should not move; any that do are inspected, not accepted).
- **U4.** README row, stamp forward, PR with `Closes #766`.

## Scope Boundaries

- **The `Slave Lord's Endurance` name** is disclosed, not mapped. Filing it as a
  name correction needs the wiki's spelling, so it rides the next wiki window.
- **`Slaver's Set Bonus` on the fifteen non-host carriers** (`Breaker of
  Bodies`, `Executioner's Helm`, …) is the SAME membership slot and is served by
  this change; they are not hosts of the four typed slots.
- **No station name is asserted.**
