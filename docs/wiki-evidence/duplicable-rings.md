# Duplicable rings — which rings may be worn twice

> **SUPERSEDED by `ring-exclusivity.md` (2026-08-28, #566).** The ruling below —
> an allowlist of two rings — is no longer what ships. It is kept as the record
> of how the question was answered before the disqualifiers were found, and
> because its two citations are now the *corroboration* the replacement is
> checked against on every build.
>
> **The negative result below is correct and was misread — including by this
> document.** No ddowiki ring page carries a `Unique Equipped` parameter, and
> that is not the wiki declining to answer. Duplicability is not a per-item
> property at all: it is the absence of two others, **Exclusive** and **Minor
> Artifact**, both of which *are* recorded per item as maintained categories.
> The sweep looked for a field that was never going to exist.
>
> **Do not re-run the `Unique Equipped` sweep.** That specific search is closed
> and will stay empty. The live question was answered in `ring-exclusivity.md`.
>
> The caveat at the end of this document — that the heroic/Legendary Katra split
> was far more likely an unwritten page than a real difference — turned out to be
> right. All four Katra rings record a binding with no exclusive flag, and all
> four are now duplicable. The caveat is the most load-bearing paragraph here,
> and it is last; read it first.

**Harvested 2026-08-27** from ddowiki, same-origin from a ddowiki tab (the only
transport that works — see `harvest-method.md`). Every ring item page in the
set-member population was read; nothing here is derived.

Shard: `data/seed/compendium/duplicable_rings.json` (2 items, both `stated`).

This was the evidence behind `src/duplicable_rings.py` and the `#442` widening of
the `#335` twin gate. That module was retired by #566; the shard survives it, now
read by `src/ring_exclusivity.load_corroboration` as a cross-check rather than as
the gate's input.

## The ruling

**Two rings are wiki-confirmed duplicable** *(by this document's method — the
`tips` prose. Ninety-five more are confirmed by `ring-exclusivity.md`, which
reads the disqualifiers instead.)*

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
the wiki states *in this field*, and re-reading `tips` will not find more until
someone edits a wiki page.

The sentence that used to close this paragraph — that the document exists so the
next person asking "surely more rings than that?" reads a result instead of
repeating the sweep — was doing real harm, because the honest answer to that
question turned out to be "yes, ninety-five more". What is settled is the
`Unique Equipped` sweep. What was open, and is now answered elsewhere, is the
question itself.

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

`src/duplicable_rings.check` ran on every build and failed it when a named ring
left the catalog, stopped being a Ring, or lost its `set_bonus`. It was retired
with the module in #566; `src/ring_exclusivity.check` carries the same shape plus
a coverage assertion, an artifact cross-check, and a corroboration clause.

**This shard is still read on every build** — by
`src/ring_exclusivity.load_corroboration`, which requires both rings below to come
out duplicable under the replacement rule. Their evidence is a different field
entirely, so a blocklist that contradicted them would be contradicting something
it was not derived from. That makes these two citations more useful now than they
were as the gate itself.

The stamp is still `duplicable_ring: true`, written only in the true case. The
absent field IS the fail-closed default; writing `false` on nine thousand records
would carry no more information while inviting a reader to treat the flag as
harvested for all of them.

## Related

- `docs/plans/2026-08-21-003-feat-duplicate-ring-set-completion-plan.md` — #335,
  which built the twin machinery and shipped narrowed to one name for want of
  this evidence.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the rule
  the fail-closed direction comes from.
- `docs/wiki-evidence/harvest-method.md` — the transport, pacing, and
  privacy-guard constraints every call here inherited.
