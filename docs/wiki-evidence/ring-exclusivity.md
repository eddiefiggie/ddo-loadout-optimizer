# Ring exclusivity — which rings may be worn twice

**Harvested 2026-08-28** from ddowiki, same-origin from a ddowiki tab (the only
transport that works — see `harvest-method.md`). Every page in the ring
population was read; nothing here is derived.

Shard: `docs/wiki-evidence/ring-exclusivity.json` (435 entries, all `stated`).

It sits here rather than under `data/seed/` on purpose: nothing seeds from it yet.
An inert file under that prefix misrepresents itself as pipeline input, and the
stamp guard reads the prefix as player-facing — correctly, since a data-only
merge changes every solve. #566 moves it into `data/seed/compendium/` at the
moment it starts driving the gate, and owes the stamp bump then.

This supersedes the ruling in `duplicable-rings.md`, which is left in place as
the record of how the question was previously answered. See *What this
supersedes* at the end.

## The ruling

**A ring may be worn twice unless it is Exclusive or a Minor Artifact.** Both
disqualifiers are recorded per item by the wiki, as maintained categories.

| Population | Count |
|---|---:|
| Ring pages read (`Category:Finger items`) | 435 |
| Exclusive (`Category:Exclusive`) | 45 |
| Minor Artifact (`Category:{1,3,4,5} Slot Minor Artifacts`) | 19 |
| Both (`Black Pearl Ring`) | 1 |
| **Duplicable** | **372** |

Restricted to the population the twin gate can actually act on — rings carrying a
set bonus, since a second copy of a set-less ring adds nothing:

| Set-member rings | Count |
|---|---:|
| Duplicable | **100** |
| Exclusive | 36 |
| Minor Artifact | 3 |
| Total | 139 |

So the widening is from **2 rings to 100**. Note this is materially *lower* than
the 135 estimated when #566 was filed: that estimate subtracted only the
artifacts, because the Exclusive population was not yet known. 36 set-member
rings really are blocked, and the harvest is what distinguished them.

## The mechanic, as the wiki states it

**Exclusive** — from `[[Exclusive]]`:

> A character is only allowed to have a single version of an Exclusive item in their inventory.

It is an inventory restriction, which forecloses wearing two as a consequence:
you cannot equip a second copy you are not allowed to carry. The same page
records that the status is "primarily found on eternal wands, items with
limited-charge Absorption effects [...] and items with particularly valuable
clicky effects" — which independently corroborates the "(clickies)" gloss in the
player report that prompted this harvest, without that gloss being the rule.

**Minor Artifact** — from `[[Minor Artifact]]`:

> A character may only equip a single Minor Artifact, regardless of slot.

This is *stronger* than non-duplicability and we already enforce it: the
`Σ(artifacts) = 1` constraint at `web/solver.js:385`. Because twins are shallow
copies minted into the same `xVars` before that constraint is built, an artifact
ring's twin inherits `artifact: true` and is caught by the existing mutex. The
artifact half of the rule needs no new gate.

## Read the category, never the bind text

`Template:Bind` documents an `exclusive` parameter and emits the category from
it:

```
{{#ifeq: {{#var:exclusive}} | 1 | [[Category:Exclusive]] }}
```

The template normalises several spellings into that one variable. Across the 45
Exclusive rings the wikitext spells it as a bare positional argument in 43 cases
and as the literal word in only 2 (`Black Pearl Ring`,
`Legendary Ring of Spell Storing`).

**A text-match for "exclusive" therefore finds 2 of 45 and misses 43.** This
document's first pass made exactly that error and read the 43 as disagreeing
with the category; they were not disagreeing, they were spelled differently. The
template-computed category is the only correct read.

This is the same lesson as
`docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`,
one layer up: there, the rendered cell was not the value; here, the parameter's
spelling is not the value. The template's computed output is.

## Why reading the negative is sound

Absence of evidence is not evidence of absence, and the standing **never infer a
value** rule forbids reading silence as permission. This harvest is not doing
that, and the distinction is load-bearing enough to state precisely.

`duplicable-rings.md` was refusing to read a negative for good reason: the field
it consulted was a free-text `tips` parameter, and a page without the sentence
was a page where *nobody had written a sentence*. That is genuine silence.

Here the source affirms the negative in two independent ways:

1. **`Template:Bind` documents `exclusive` with an explicit default of false.**
   The default is published by the source, so the unset state is a value the
   wiki states, not a value nobody recorded.
2. **Every ring page affirmatively records a binding.** All 435 pages carry the
   Named-item infobox and a non-empty `bind` parameter — 0 missing pages, 0
   without the parameter, 0 with it left blank. There is no page where the
   editor simply never filled the field in, which is the one case where the
   template default would mask an unmaintained page.

So "not in `Category:Exclusive`" means "this page records a binding, and that
binding does not set exclusive" — a stated fact. It does not mean "nobody said."
Had (2) come back with even a handful of bind-less pages, those pages would need
quarantining individually rather than defaulting; it is worth re-checking on any
future refresh for exactly that reason.

## Validations

Three checks, run because a population claim needs one:

**The artifact cross-check agrees exactly.** gear-planner carries an independent
`artifact` boolean, harvested from a different source by different people. It
flags 101 items and 19 rings. The wiki's Minor Artifact categories contain 101
items and 19 rings, and the symmetric difference of the two ring sets is
**empty**. Two unrelated sources agreeing to the record is the strongest
available evidence that the category read is sound.

**Catalog coverage is total.** All 426 ring titles in our catalog appear in
`Category:Finger items`. No ring falls through to a default, and nothing needs
quarantining. (The wiki's 435 exceeds our 426 by nine pages we do not carry —
historic variants and similar. Extra pages on their side are harmless; missing
ones on ours would not have been.)

**The rule predicts the two known-true cases.** `Legendary Katra's Wit` and
`Legendary Katra's Razor Wit` are the only rings independently confirmed
duplicable, by the verbatim `tips` prose recorded in `duplicable-rings.md`. This
harvest reads a completely different field and classifies both as duplicable.
The rule reproduces the known answers it was not fitted to.

It also resolves the asymmetry that `duplicable-rings.md` flagged and could not
close. All four Katra rings — heroic and Legendary — carry `{{Bind|BtA|BoA}}`
with no exclusive flag, and none is in `Category:Exclusive`. The heroic pair is
duplicable. That doc's own caveat guessed as much:

> it is far more likely that nobody wrote the tip on the heroic pages than that
> the heroic rings behave differently

It was right, and it declined to act on the guess. This harvest is the evidence
that guess was waiting for.

## What this supersedes, and what it does not claim

`duplicable-rings.md` closes with the condition for its own replacement:

> If a per-item Unique Equipped source is ever found — an in-game tooltip dump, a
> different wiki template, a datamine — it supersedes this document entirely and
> the shard should be rebuilt from it.

"A different wiki template" is what this is. The `#442` harvest went looking for
a `Unique Equipped` field and correctly found that none exists; what it could not
know is that the absence was structural rather than a gap. Duplicability is not
recorded per item because it is not a per-item property — it is the absence of
two others, and both of those are recorded.

**Not claimed:** that `Category:Exclusive` is complete as a matter of game truth.
It is a wiki category, maintained by editors, and an item whose page nobody has
updated could be mis-filed. The claim is that it is the wiki's own computed
reading of a field every ring page fills in — which is a far better source than
the `tips` prose, and the best one available short of a datamine or an in-game
tooltip dump. A ring absent from `harvested` must still be refused.

**Still unwitnessed:** nobody has produced a screenshot of two heroic Katras
equipped. The harvest settles the question at the level of the recorded rule; a
screenshot would settle it at the level of the running game. They are different
kinds of evidence and the second has not been collected.

## Status

The shard is **inert**. Nothing reads it yet — `duplicable_rings.json` still
drives `isTwinEligible`, so solver behavior is unchanged by this harvest. Wiring
it in, flipping the gate to a blocklist, and re-ratifying the golden diff is
#566.

Guards that need to exist when it is wired in (none of which exist yet):

- Every `Ring` in the built catalog appears in the shard's `harvested` map —
  a coverage assertion, so the 426/426 claim above cannot go stale silently.
  This is the `a-dated-coverage-claim-cannot-notice-its-own-staleness` rule: the
  numbers in this document are readable at build time, so assert them.
- Every shard entry still resolves to a `Ring` in the catalog (the existing
  `duplicable_rings.check` shape).
- The artifact agreement holds — the shard's `minor_artifact` set equals the set
  of catalog rings flagged `artifact`. It agrees exactly today, and a future
  drift between the two sources is a review event, not something to reconcile
  automatically.

## Related

- `duplicable-rings.md` — the superseded ruling and its negative result.
- `harvest-method.md` — transport, pacing, and privacy-guard constraints.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the
  fail-closed rule, which survives the polarity flip.
- #566 (wire it in), #567 (correct the superseded doc's framing), #442, #335.
