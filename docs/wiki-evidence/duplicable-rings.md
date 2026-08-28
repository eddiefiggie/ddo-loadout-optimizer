# Duplicable rings — which rings may be worn twice

**Harvested 2026-08-27** from ddowiki, same-origin from a ddowiki tab (the only
transport that works — see `harvest-method.md`). Every ring item page in the
set-member population was read; nothing here is derived.

Shard: `data/seed/compendium/duplicable_rings.json` (2 items, both `stated`).

This is the evidence behind `src/duplicable_rings.py` and the `#442` widening of
the `#335` twin gate.

## The ruling

**Two rings are wiki-confirmed duplicable. Every other ring is not, and the wiki
does not say otherwise about any of them.**

| Ring | Verbatim `tips` |
|---|---|
| `Legendary Katra's Razor Wit` | "2 rings, identical or not, can be used for the set bonus." |
| `Legendary Katra's Wit` | "2 rings, identically or not, can be used for set bonus." |

Note the pair is the **Legendary** tier only. The heroic `Katra's Wit` and
`Katra's Razor Wit` pages carry no such line, so under the fail-closed rule they
are not duplicable. That is a real asymmetry in the source, not an oversight
here — see the caveat at the end.

## The negative result, which is the point of this document

`#442` was written to "harvest the Unique Equipped flag for the set-member ring
population". **That flag does not exist on ddowiki item pages.** Across all 131
set-member ring pages:

| | |
|---|---:|
| pages read | 131 |
| pages that failed to load | 0 |
| carrying a `unique` / `uniqueequipped` template parameter | **0** |
| containing the word "unique" anywhere in the wikitext | **0** |
| carrying a free-text `tips` parameter | 23 |
| whose `tips` says anything about wearing a second copy | **2** |

The `Named item Jewelry` template has no uniqueness field at all. Its parameters
are `name`, `slot`, `type`, `durability`, `material`, `hardness`, `minlevel`,
`basevalue`, `weight`, `bind`, `quest`, `chest`, `released`, `mythic`,
`enhancements`, `crafting`, `craftingupgrade`, `description`, `pic`, `picdesc`,
`tips`. Duplicate-wearability, where it is recorded at all, is recorded as prose
in `tips`.

All 23 `tips` fields were read individually rather than filtered by pattern, so
the count of 2 is a read of the population and not the yield of a regex. The
other 21 concern minor-artifact filigree counts, quest routing, set-stacking
notes, bug reports, and image placeholders — none touches wearing two copies.

**So the widening this evidence produced is one ring.** That is the whole of what
the wiki states, and re-running the harvest will not find more until someone
edits a wiki page. This document exists so that the next person to ask "surely
more rings than that?" reads a result instead of repeating the sweep.

## Why fail-closed, and why that direction

A ring absent from the shard is **not** duplicable.

The two errors are not symmetric. Wrongly allowing a duplicate produces a
loadout the player cannot equip — a confidently-reported optimum that is simply
wrong at the character sheet, and indistinguishable from a correct one until they
try to wear it. Wrongly refusing one costs a set bonus the player can usually
reach another way, and the refusal is visible to them.

This is the same reasoning as `exclude-until-verified-data-gates.md`: a visible
gap beats a confident wrong number.

## What the game rule actually is, and what we are NOT claiming

DDO's real mechanic is **Unique Equipped**, an item property that forbids wearing
two copies. Most named items carry it; some do not. This document does **not**
claim to know which rings carry it — it claims only that two ring pages state
outright that two copies work for a set bonus.

That is a narrower claim than the mechanic, and deliberately so. Generalising
from "the wiki is silent" to "the item is not Unique Equipped" would be inferring
a game value from an absence, which the standing **never infer a value** rule
forbids. The heroic/Legendary asymmetry above is the clearest illustration: it is
far more likely that nobody wrote the tip on the heroic pages than that the
heroic rings behave differently. We still refuse them, because a guess in the
permissive direction is the one that produces an unequippable answer.

If a per-item Unique Equipped source is ever found — an in-game tooltip dump, a
different wiki template, a datamine — it supersedes this document entirely and
the shard should be rebuilt from it.

## Guards

`src/duplicable_rings.check` runs on every build and fails it when a named ring
is no longer in the catalog, no longer a Ring, or no longer carries a
`set_bonus`. The last one matters because a second copy of a set-less ring buys
nothing: duplicate affixes at the same name and bonus type collapse to a max
rather than summing, so an entry that lost its set membership is a stale claim.

The stamp is `duplicable_ring: true`, written only in the true case. The absent
field IS the fail-closed default; writing `false` on nine thousand records would
carry no more information while inviting a reader to treat the flag as harvested
for all of them.

## Related

- `docs/plans/2026-08-21-003-feat-duplicate-ring-set-completion-plan.md` — #335,
  which built the twin machinery and shipped narrowed to one name for want of
  this evidence.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the rule
  the fail-closed direction comes from.
- `docs/wiki-evidence/harvest-method.md` — the transport, pacing, and
  privacy-guard constraints every call here inherited.
