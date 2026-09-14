---
module: crafting_coverage
component: UNSERVED_ALLOWLIST
problem_type: stale-claim
tags: [allowlist, coverage-gate, crafting, slavers, provenance, exclude-until-verified]
applies_when: >
  Adding a label, item, or family to an allowlist or exclusion list with a reason
  string — or reading one to decide whether the gap behind it is buildable.
---

# An allowlist reason must name the layer that lacks the thing

## The problem

`src/crafting_coverage.py`'s `UNSERVED_ALLOWLIST` carried ten Slaver's crafting
labels under one comment:

```
# Slaver's crafting — heroic and legendary. No pool.
```

"No pool" was true of the **pipeline**: nothing in `build_dataset` read those
menus. It was false of the **source**: `gearplanner_crafting.json` carried all
eight option pools, natively typed (Prefix 10, Suffix 25, Extra 27, Bonus 30 per
tier), plus the two set-bonus pools. Every reader of that comment — including a
2026-09-14 project scan that filed the system as a gap — took "no pool" to mean
the data was missing, and the whole system was costed as a wiki harvest. It was a
one-day pipeline change (#766).

The comment was not wrong. It was **ambiguous about which layer it described**,
and the cheaper reading was the one nobody checked.

## The rule

A reason string on an allowlist, an exclusion, or a deferral names **which layer
lacks the thing**, in words that cannot be read two ways:

- "no pool in the catalog" — the source has nothing; a harvest is the cost.
- "pool in the catalog, no reader in the pipeline" — the source has it; code is
  the cost.
- "pool read, options quarantined: <reason>" — both exist; a ruling is the cost.

Three different costs, and a reader picking work off the list needs to know
which one without opening the raw file.

## The check that catches it

Before writing "no X" on an allowlist entry, grep the source for X. Here:

```
python3 -c "import json; c=json.load(open('data/seed/compendium/raw/gearplanner_crafting.json')); print(len(c[\"Slaver's Prefix Slot\"]['*']))"
```

prints `10`. The entry should have said so. The same one-liner is what the
2026-09-14 scan eventually ran, three weeks late.

## Related

- `read-the-dump-for-a-structural-host-marker-before-assuming-a-harvest.md` — the
  host-side twin of this lesson (#194): the blanks had declared their altars all
  along. This note is the pool side: the options were in the catalog all along.
- `verify-a-long-open-issues-premise-against-the-code.md` — the same failure at
  issue level: a claim written once and never re-read against the thing it
  describes.
- `exclude-until-verified-data-gates.md` — why the gate exists; this note is
  about what its entries must say.
