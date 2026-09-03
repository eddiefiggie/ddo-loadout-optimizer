---
title: "Read the dump for a structural host marker before assuming a harvest is the blocker"
module: pipeline
date: 2026-09-03
problem_type: convention
component: data
severity: medium
tags:
  - gear-planner
  - crafting
  - host-marker
  - green-steel
  - stale-premise
  - harvest
applies_when:
  - A crafting pool is loaded but "needs a wiki harvest" to learn which items host it
  - A plan, PR body, or README line defers a feature on "the host half needs a harvest"
  - Deciding whether a ddowiki session is the prerequisite for surfacing a marker
---

## Context

#194 sat open for 25 days on one sentence, repeated in PR #652's body, the
container registry, and the README's next-up line: the Legendary Green Steel
recipes were loaded, and "the half that surfaces the host markers — the half
that needs a wiki harvest" was still to do. A harvest cannot run from a
non-interactive session (ddowiki has no server-side transport), so the issue
read as blocked on a tool nobody had open.

Measured against the gear-planner dump before writing any code: all 48
`Legendary Green Steel *` records declare their altar menus in their own
`crafting[]` — `T1 (Equipment)`, `T2 (Equipment)`, `T3 (Equipment)` on the 8
accessory blanks and the `(Weapon)` triple on the 40 weapon blanks. That is the
same structural field the Gem of Many Facets' `essence_slots` are read from, and
the same one the Lamordia, seal, Nearly Complete and Lost Purpose markers come
from. The hosts had been declaring themselves the whole time. No harvest was
needed; the deferral rested on nobody having looked.

## Guidance

**Before deferring a host-marker feature on a harvest, grep the dump for the
pool's menu keys in `crafting[]`.** One query, against the file the pipeline
already trusts:

```python
import json
raw = json.load(open("data/seed/compendium/raw/gearplanner_items.json"))
hosts = [it["name"] for it in raw if set(it.get("crafting") or []) & {"T1 (Equipment)", "T1 (Weapon)"}]
```

If it returns records, the marker is structural: read it in
`src/planner_items.py` beside the other `crafting[]` readers, stamp it from the
label alone, and gate it on `verification` the way `essence_slots` is. A wiki
harvest is the prerequisite only for what the dump does NOT carry — here, the
matched-tier aspect bonuses, which stay a disclosed non-goal.

Two corollaries:

- **A dated "zero hosts in the catalog" finding expires with the next refresh.**
  The 2026-07-28 best-practice doc measured zero Legendary Green Steel blanks and
  was right about that snapshot; the 2026-08-18 refresh carried 48. A count is a
  claim about a population at a time — re-measure it before citing it.
- **"Recipes loaded, no host" is a state to test for, not to describe.** The
  container registry's host-marker trigger exists for exactly this; what it
  cannot do is notice that the marker was never READ. Reachability is a property
  of the reader as much as of the data.

## Why This Matters

A pool that is loaded and unreachable is the state
`exclude-until-verified-empty-seed-masks-consuming-bugs.md` calls worse than
honestly absent: it costs build time, its latent defects stay invisible, and
every reader of the queue sees a blocked item. Here the "block" also hid two real
defects that only reachability could surface — the accessory pool was shaped as
one pick over three altars (under-crediting every host by two effects), and the
picker vocabulary read both pools as flat records and offered none of their 116
options. Both were found the day the hosts were stamped, not the day the pool was
loaded.

## When to Apply

- Any "hosts pending" or "marker surfacing lands with the harvest" note on a
  crafting family sourced from the gear-planner catalog.
- Re-judging an issue that has been deferred on a harvest more than once.
