---
title: Source named-set definitions from the gear-planner catalog, never a parallel file
module: data-pipeline
date: 2026-07-28
last_updated: 2026-07-28
problem_type: design_pattern
component: tooling
severity: high
tags:
  - set-bonus
  - single-source-of-truth
  - set-catalog
  - crafting
  - stat-vocabulary
  - chosen-set-membership
  - ddo
  - data-provenance
---

## Context

When adding a crafting system that lets an item **join or complete a named set** — Vecna Unleashed "Lost Purpose" awakening, Dino Set-Bonus, and any future system where gear gains set membership — that system needs the set's bonus definition (per-tier `(stat, bonus_type, value, pieces_required)`) so the solver can value completing it.

The tempting move is to harvest those definitions fresh from the DDO Wiki's *set page* into a new seed file dedicated to the crafting system. That is what the first cut of the Vecna work did (a hand-authored `vecna_sets.json`). It looked clean and self-contained. It was a latent bug.

## Guidance

**Named-set definitions have exactly one source: the gear-planner set catalog (`data/seed/compendium/raw/gearplanner_sets.json`), resolved through `src/set_catalog.py`.** This is the same catalog that already feeds *intrinsic* set members (e.g. the Fire Over Morgrave raid weapons that carry Forbidden Knowledge). Any new consumer — including a crafting system that awakens a set — must derive its definitions from that catalog, never re-harvest a parallel copy.

Concretely (`src/membership.py`): `build_membership_set_defs()` loads the catalog and, for each set it needs, pulls the definition via the catalog entry's `set_bonus` (the same `piece_bonuses` free-text the intrinsic path parses), runs it through the shared `src/set_parser.py` + umbrella-expansion path, and emits the runtime `membership_set_defs` table. No set values are typed by hand.

## Why This Matters

The wiki's *set page* and the gear-planner *catalog* describe the same set bonus in **different stat vocabulary**. The set page names the in-game *effect*; the gear-planner (and therefore the rest of this dataset) names the *affix*. For Legendary Vol's Influence, the 3-piece bonus is the same effect either way, but:

| Line | Wiki set page (what `vecna_sets.json` captured) | Catalog (what everything else uses) |
|------|-------------------------------------------------|-------------------------------------|
| spell crit chance | `Spell Critical Chance +6` | `Universal Spell Lore +6` |
| spell DCs | `Spell DCs +3` | `Spell Focus Mastery +3` |

With two sources, a single set **credits different stats depending on how it is completed**: an intrinsically-completed set uses the catalog vocab (baked onto members via `set_catalog.definition_for`), while an awakened one uses the parallel file's vocab. Those stats then don't stack with the rest of the dataset (which speaks catalog vocab), and a user's ranked target might match one path but not the other. The optimizer stays *internally* consistent only when every path reads one definition.

A second, quieter benefit: once definitions come from the catalog, an awaken-only set fires **only where it genuinely wins**, because its stats are the same real affixes other gear also provides — the solver correctly weighs "awaken a 3-piece set" against "equip three dedicated items." The parallel-file version made awakens look artificially attractive by giving them orphan stat names nothing else competed for.

## When to Apply

- Adding any crafting/upgrade system where gear **gains set membership** (awaken, imbue, "count as part of set X").
- Any new consumer of set-bonus values. If you're about to write a new file of set stats, stop — check whether `set_catalog.load_catalog()` already has them (canonical-name match handles apostrophes, `The `/`Legendary ` prefixes).
- Reviewing a diff that introduces a hand-authored set-definitions seed: that's the smell. A fail-loud test (assert the resolved count) guards against the catalog silently dropping a name later.

## Examples

**Before (divergent — two sources):**
```
data/seed/vecna_sets.json          # hand-harvested from the wiki set page
  Vol's Influence 3pc: Spell Critical Chance +6, Spell DCs +3, ...
src/membership.py: build from vecna_sets.json
# intrinsic members meanwhile resolve via gearplanner_sets.json -> different stat names
```

**After (single source of truth):**
```python
# src/membership.py
def build_membership_set_defs(catalog=None):
    catalog = catalog if catalog is not None else set_catalog.load_catalog()
    for name in all_set_names():                    # the sets this system can awaken
        entry = catalog.get(set_catalog.canonical(name))
        sb = entry["set_bonus"] if entry else None
        if not sb:
            continue                                # no catalog def -> awaken buys nothing (never fabricate)
        # parse sb.piece_bonuses through the SAME strict path intrinsic members use
```
`data/seed/vecna_sets.json` was deleted; awakened and intrinsic completions now give identical stats.

Related: [`milp-encoding-for-gear-optimization.md`](milp-encoding-for-gear-optimization.md) (the `set_active` threshold machinery these definitions feed), [`r4-endgame-band-enrichment.md`](r4-endgame-band-enrichment.md) (the enrichment/reconciliation pipeline and the KTD6 "one shard per name" rule), [`parsing-ddo-wiki-affix-text.md`](parsing-ddo-wiki-affix-text.md) (the strict affix parser the definitions run through).
