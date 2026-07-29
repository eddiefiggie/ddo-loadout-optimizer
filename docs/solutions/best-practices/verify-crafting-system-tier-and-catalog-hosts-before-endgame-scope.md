---
title: "Before scoping a crafting feature to endgame, verify the system has a Legendary tier AND the catalog carries Legendary hosts"
module: crafting
date: 2026-07-28
problem_type: best_practice
component: tooling
severity: medium
tags:
  - ddo
  - crafting
  - scope
  - endgame
  - gear-planner-catalog
  - wiki-sourcing
  - thunder-forged
  - green-steel
applies_when:
  - "Scoping a new crafting-system choice-slot feature to the ML30-36 endgame band"
  - "A plan assumes a 'Legendary <System>' exists because the Heroic/Epic version does"
  - "Deciding whether wiki-harvest work will attach to any real host item in the dataset"
---

# Before scoping a crafting feature to endgame, verify the system has a Legendary tier AND the catalog carries Legendary hosts

## Context

The Thunder-Forged + Green Steel endgame-crafting feature was brainstormed and planned
under an "endgame BiS competitiveness" driver, scoped Legendary-only (ML30-36 band). The
code scaffolding (choice-slot solver/model/UI + parsers) was built and merged against
empty pools, deferring the wiki harvest. At harvest time — the plan's own KTD3/KTD5
checkpoint ("confirm the Legendary tier boundary" / "filter to Legendary hosts only") —
two cheap checks collapsed the premise before any option was harvested.

## Guidance

Before committing harvest effort to an endgame crafting choice-slot, confirm **both**
gates with the wiki API and the local catalog — not the Heroic/Epic version's existence:

1. **Does a Legendary tier of the system actually exist?** Search the wiki API, don't
   assume symmetry with the Heroic/Epic form:

   ```bash
   # 0 hits => there is no Legendary version of this system
   curl -s 'https://ddowiki.com/api.php?action=query&list=search&srsearch=Legendary%20<System>&format=json' | jq '.query.searchinfo.totalhits'
   ```
   (Server-side fetch is blocked for ddowiki article pages, but the `api.php` JSON
   endpoint is reachable via Claude-in-Chrome by navigating to the URL and reading it
   with `get_page_text` — `javascript_tool` fetches timed out; direct navigation didn't.)

2. **Does the gear-planner catalog carry Legendary HOST items** (ML>=29) for the system?
   A choice-slot with no host attaches to nothing:

   ```python
   # Count catalog shells for the system and their ML spread
   leg = [it for it in rows if marker(it, "<system>") and (it.get("ml") or 0) >= 29]
   # 0 => a Legendary-only host filter marks zero hosts; the pool would be orphaned
   ```

Only if both gates pass is an endgame harvest worth starting.

## Why This Matters

Both gates failed here, and each independently kills the endgame scope:

- **Thunder-Forged has no Legendary version at all.** `Legendary Thunder-Forged` returns
  **0 wiki hits**. The real page (`Thunder-Forged`) is an Update 21 **Epic** system:
  base ML22 -> Tier 1 ML24 -> Tier 2 ML26 -> Tier 3 ML28. It caps at ML28, below the
  ML30-36 band. The catalog's 43 Thunder-Forged shells are **all ML22**.
- **Legendary Green Steel exists on the wiki (ML29) but not in the catalog.** The
  gear-planner's 97 Green Steel shells are the classic Heroic/Epic ones (ML11-26);
  **zero** LGS blanks. The catalog holds 2,350 ML>=29 items overall, so endgame gear
  isn't missing generally — LGS blanks specifically aren't in the source.

Net: `U3`'s Legendary-only host filter marks **zero hosts for both**. A perfect U1/U2
option harvest would have produced menus that attach to no item in the dataset — pure
wasted harvest. Catching it at the KTD checkpoint cost two API reads and one catalog
query instead.

Two supporting reasons the scope was wrong even setting hosts aside: both systems are
mechanically **proc/on-hit/caster-heavy** (Touch of Flames, dragon-breath clickies, the
augment-crafting recipes), so the clean `(stat, bonus_type, integer value)` tuples the
solver can model are a curated minority; and "the Heroic/Epic version is strong, so the
Legendary one must be too" is an assumption the wiki simply does not support for every
system.

The disciplined outcome: **park the feature, keep the merged scaffolding dormant** (empty
pools render nothing — nothing breaks), and record *why* in the seed metadata
(`data/seed/thunder_forged.json`, `data/seed/green_steel.json`, `status: SHELVED` +
`harvest_finding`) so it isn't re-litigated. See [[verify-js-tests-with-full-loop-not-tail]]
for the sibling "verify before you trust" discipline on the CI side.

## When to Apply

- Any future "add crafting system X as an endgame choice-slot" brainstorm/plan — run the
  two gates during planning (or at the first harvest checkpoint), not after building.
- Reviving TF/GS: only Option "source LGS properly" (harvest ML29 LGS blanks into the
  catalog as a new host shard + model augment-crafting) yields a real endgame feature,
  and it's a substantial effort for gear at the very bottom of the band. Epic-scope
  coverage (TF ML22-28, GS ML11-26) is feasible but is off the "endgame BiS" driver.

## Examples

```
❌ Assumed:  "Legendary Thunder-Forged", ML30+ endgame, ~37 hosts to mark
✅ Reality:  no Legendary Thunder-Forged exists; Epic ML22-28; 43 shells all ML22; 0 Legendary hosts

❌ Assumed:  Legendary Green Steel endgame effects, ~85 hosts to mark
✅ Reality:  LGS exists (wiki, ML29) but 0 LGS blanks in the catalog; 97 GS shells are ML11-26
```
