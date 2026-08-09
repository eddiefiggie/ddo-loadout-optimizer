# Parrying and Heightened Awareness — version evidence

**Harvested 2026-08-08** from ddowiki, same-origin from a ddowiki tab (the only
transport that works — see `harvest-method.md`). Every number below is read out
of a rendered tooltip. Nothing here is derived, and the one place a formula
would fit is exactly where the wiki contradicts it.

Shards: `data/seed/compendium/parrying_version.json` (139 items),
`data/seed/compendium/heightened_awareness.json` (26 items). Both are 100%
`stated` — no `defaulted`, no `unsourced`.

## Why the version has to be per-item evidence

`Parrying` ships in two versions under **one affix name**, and the number
upstream stores cannot tell them apart:

| Stored value | Items | Actually |
|---|---|---|
| 1 | 13 | 12 are Arabic `Parrying 1` (grant 1); 1 is Roman `Parrying I` (grants 1) |
| 4 | 19 | 18 are Arabic `Parrying 4` (grant 4); 1 is Roman `Parrying IV` (grants **2**) |
| 8 | 3 | all three are Roman `Parrying VIII` (grant **4**) |

Nineteen items store `4` and one of them grants half that. No rule reading the
stored magnitude can produce both answers, which is why the version is harvested
per item rather than inferred. There is **no Arabic `Parrying 8`** on the wiki,
which is what makes every stored 8 a flattened Roman VIII.

## Parrying — rendered tooltips

Rendered via one `action=parse` POST per batch against `Template:Parrying`.

| Invocation | Rendered tooltip | AC | Saves |
|---|---|---|---|
| `{{Parrying\|1}}` | Parrying +1: +1 Insight bonus to Armor Class, +1 Insight bonus to Saves. | 1 | 1 |
| `{{Parrying\|2}}` | Parrying +2: +2 Insight bonus to Armor Class, +2 Insight bonus to Saves. | 2 | 2 |
| `{{Parrying\|3}}` | Parrying +3: … | 3 | 3 |
| `{{Parrying\|4}}` | Parrying +4: … | 4 | 4 |
| `{{Parrying\|5}}` | Parrying +5: … | 5 | 5 |
| `{{Parrying\|6}}` | Parrying +6: … | 6 | 6 |
| `{{Parrying\|I}}` | Parrying I: Passive: +1 Insight bonus to Armor Class, +1 Insight bonus to Fortitude, Reflex, and Will Saving throws. | 1 | 1 |
| `{{Parrying\|IV}}` | Parrying IV: Passive: +2 Insight bonus to Armor Class, +2 Insight bonus to Fortitude, Reflex, and Will Saving throws. | 2 | 2 |
| `{{Parrying\|VIII}}` | Parrying VIII: Passive: +4 Insight bonus to Armor Class, +4 Insight bonus to Fortitude, Reflex, and Will Saving throws. | 4 | 4 |

Verbatim tooltips live in each shard's `snapshots` block and are asserted on
every build. `scripts/merge_harvest.py --field parrying_version --tooltip-worklist`
prints the nine invocations to re-render.

### The Roman mapping is a lookup, not a formula

**I → 1, IV → 2, VIII → 4.** Each confirmed individually.

A halving reading fits IV and VIII and **breaks on I** — I renders 1, not 0 or
0.5. Any ratio fitted to the three points would therefore be wrong at one of
them, and worse, would silently produce a number for a numeral nobody checked.
`src/parrying_split.ROMAN_MAGNITUDE` holds the three entries and the build guard
fails on any Roman numeral outside them (KTD5). If a `Parrying II` ever appears,
it must be harvested, not extrapolated.

### The Arabic "Saves" shorthand covers all three saves

The Arabic tooltip says "Insight bonus to Saves"; the Roman one enumerates
"Fortitude, Reflex, and Will Saving throws". These are the same grant written two
ways — the Roman dialect is the explicit form of the Arabic shorthand, and DDO
has exactly those three saving throws. Both dialects therefore expand to
`Fortitude Save`, `Reflex Save`, and `Will Save` at the stated magnitude.

This is the one interpretive step in this document. It is recorded here rather
than buried in code so it can be challenged: if "Saves" were ever shown to mean
something narrower, only this mapping changes.

## Heightened Awareness — rendered tooltips

Arabic ranks 1–6 only. **No Roman variant is listed.** Every item's stored
magnitude already equalled its rank, so no value was corrected — the defect here
was purely that the affix name is not a stat.

| Invocation | Rendered tooltip | AC |
|---|---|---|
| `{{Heightened Awareness\|N}}` | Heightened Awareness N: This item helps you to quickly read situations with sharpness and clarity, allowing you to predict actions before they occur. You gain a **+N Insight bonus to AC**. | N |

It grants **AC only** — no saves. Parrying's saves clause has no analogue here
and must not be copied across.

## The cross-affix non-stacking rule

The Heightened Awareness page carries this note verbatim:

> Does not stack with the insight bonus to AC provided by the parrying suffix.

**No special case implements it.** Both affixes emit `Armor Class` typed
`Insight`, and the solver's bucket-max core caps every `(stat, bonus_type)`
bucket at one contributor (`sum(z) <= 1 per bucket`), so the rule enforces
itself. It holds only for as long as both keep emitting the same stat under the
same bonus type — **retyping either one would silently restore double-counting**,
with no test failing unless one pins it.

`tests/solver.test.js` pins it against shipped data: Admiral's Cummerbund
(Parrying +2) and Crown of Bone (Heightened Awareness 6) worn together solve to
6, not 8. Verified to fail by retyping Crown of Bone's AC to `Quality`.

## Items the dataset does not carry

The wiki's Roman groups hold 14 entries across 12 unique names —
`Epic Swashbuckler (legacy) (level 20)` and `Swashbuckler (legacy) (level 16)`
each appear under both IV and VIII. Five are in the dataset; the rest need no
correction until they arrive. All 139 Parrying and 26 Heightened Awareness items
the catalog *does* carry matched a wiki version group, with zero unmatched in
either direction.

## Corrections this evidence produced

| Item | Version | Was | Now |
|---|---|---|---|
| Bladed Steel Ring | IV | 4 | 2 |
| Balizarde, Protector of the King | VIII | 8 | 4 |
| Bracers of the Sun Soul | VIII | 8 | 4 |
| Oathblade | VIII | 8 | 4 |
| Ethereal Bracers | I | 1 | **1 (unchanged)** |

Ethereal Bracers is the guard against over-correcting: Parrying I really is +1,
so a "Roman means halve it" fix would have broken a value that was already right.

## Related

- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`
  — the class of defect this belongs to, found first on `Speed`.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — why an
  unharvested rank is quarantined rather than read from gear-planner.
- `docs/wiki-evidence/harvest-method.md` — the transport, pacing, and
  privacy-guard constraints every call here inherited.
