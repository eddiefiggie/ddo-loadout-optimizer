# Essence Crafting — the harvest, and the one thing it cannot supply

**Harvested 2026-08-27** from ddowiki, same-origin from a ddowiki tab (see
`harvest-method.md`). Shard: `data/seed/compendium/essence_crafting.json`.

Essence Crafting is the Cannith Crafting rename (Update 79). It is #193, deferred
across nine plans, and the system a player asked about directly:

> "Was there any response to (cannith/essesnse) crafting offhand weapons to
> stats/effects so that it doesn't have to be in gear to free up the slot for
> vital priorities?"

**This document exists because the harvest succeeded and the modelling still
cannot proceed.** Read the blocker before writing any code against the shard.

**Status: the issue is CLOSED as not-planned** — declined on the measured evidence
below rather than deferred a tenth time. What would reopen it is listed at the
end.

## What was harvested

| Table | What it gives | Result |
|---|---|---|
| `Essence Crafting/table 1b` | which effects go in which item + affix slot | 16 equipment slots x 3 affix slots, **708 placements**, 157 distinct effect names |
| `Essence Crafting/table 3b` | each effect's magnitude at ML 1–36 | **75 effects**, every row exactly 36 values |
| `Essence Crafting/table 2c` | recipes: crafting level, essences, collectables | costs only — no magnitudes, no types |
| `Essence Crafting/table 2b` | non-scaling effects | small; not yet parsed |

The affix slots are **Prefix**, **Suffix** and **Extra** (Extra applies at ML 10+
only). The equipment slots are Belts, Boots, Bracers, Cloaks, Gloves, Goggles,
Headgear, Necklaces, Rings, Trinkets, Armors, Shields, Melee weapons, Ranged
weapons, Rune Arms, Orbs.

Five effects are **non-scalar** — their values are dice, not numbers (`Bashing`,
`Bane`, `Effect (dmg)`, `Shield spikes`, `Vampirism`). They are recorded and
flagged; the solver ranks scalar magnitudes, so these are not rankable as-is.

## THE BLOCKER: nothing records a crafted effect's bonus type

The solver buckets every contribution as `(stat, equivType(bonus_type))` and caps
each bucket at one contributor. Same bucket, sources take the max; different
buckets, they add. **A crafted effect with the wrong bonus type therefore either
double-counts against real gear or wrongly collapses with it — and both produce a
wrong number inside a finished loadout, which is this project's worst output.**

No source reachable to us states that type:

- **The Essence Crafting tables do not.** `table 2c`, the fullest of them at 93 KB,
  contains **zero** occurrences of `Enhancement`, `Insight`, `Competence`,
  `Quality`, `Profane`, `Sacred`, `Artifact`, `Exceptional`, `Deflection`, `Luck`
  or `Morale` as bonus types. Its 76 matches for "Insightful" and 23 for
  "Resistance" are parts of *effect names*, not type declarations.
- **gear-planner does not.** It is our single source of truth for item affixes and
  it ships **no Essence Crafting pool at all** — zero pools whose key contains
  `Essence` or `Cannith`. That is exactly why `crafting_coverage.UNSERVED_ALLOWLIST`
  lists the twelve `Essence Crafting: *` labels as "No pool": upstream declares the
  slot on the item and supplies nothing to put in it.
- **The individual effect pages do not do it reliably.** Sampled four: `Fortification`
  and `Sheltering` state typed bonuses but never mention Essence Crafting, so the
  types belong to named items generally rather than to the crafted version;
  `Seeker` mentions Essence Crafting and states types; `Dodge` is a 470-byte stub
  with no typed bonus at all. Harvesting ~157 such pages would produce a partly
  absent, partly off-topic answer — a weak base for 157 game values.

**Assigning types anyway would be inferring 157 game values.** That is the exact
move `exclude-until-verified-data-gates.md` forbids, and the failure mode is the
one this project fears most: a confidently-reported optimum whose total is wrong
in a way no player can see.

So the shard ships as **data only**. Nothing consumes it, the twelve labels stay
in `UNSERVED_ALLOWLIST`, and no solve changes.

## What would unblock it

In rough order of how much they would settle:

1. **An in-game source** — a tooltip dump or datamine of crafted shards, which
   would give type and magnitude together and supersede the whole shard.
2. **gear-planner shipping Essence Crafting pools.** It already models the other
   crafting systems this way, and its pools carry typed affixes. If upstream adds
   them, the modelling becomes the same shape as Viktranium or Seal, both of which
   already work.
3. **A wiki page that states crafted types systematically.** None was found; the
   sampling above suggests the information is scattered across effect pages rather
   than tabulated.

Absent one of those, the honest position is the current one: the system is
disclosed to the player as an unserved slot rather than modelled wrongly.

## The value question, measured

The nine deferrals all rested on one asserted claim: *generic Enhancement affixes
rarely beat named best-in-slot*. With the ML curves in hand it is checkable, and
it holds — more strongly than the phrasing suggests.

Each craftable effect's ML 34 magnitude against the best value any catalog item
carries for the same affix at ML <= 34, restricted to the **84 effects whose name
maps unambiguously onto a name the catalog actually uses**:

| Outcome | Count |
|---|---:|
| crafted beats named | 23 |
| tie | 16 |
| crafted loses | 45 |

**Every one of the 23 wins is by +1 or +2.** The largest is Incite 137 vs 135;
twenty are skills at 22 vs 21. No crafted effect is meaningfully stronger than
named gear anywhere.

The ties are exact, which is the more useful signal:

| | crafted ML 34 | best named ML <= 34 |
|---|---:|---:|
| every ability score | 15 | 15 |
| Wizardry | 310 | 310 |
| Physical Sheltering | 38 | 38 |
| Fortification | 159 | 162 |
| element spellpower | 159 | 168 |

So crafting is a way to **reach** named-BiS numbers on a slot you could not
otherwise fill, never a way to exceed them.

### What this measurement does NOT settle

It compares magnitude, and magnitude is half of what a contribution is worth.
Whether a crafted effect **adds** to named gear (a different bonus type) or
**competes** with it (the same bucket) is decided by the bonus type — the exact
dimension nothing records. If crafted effects stack, a 22 crafted skill on top of
a 21 named one is worth 22, not 1.

The value case therefore rests entirely on **stacking**, not on raw power. The
cheap measurement bounds the upside and relocates the question; it does not
escape the blocker.

### A correction worth keeping

The first run of this comparison reported 51 wins, including "Spell Power +159
against 0" and "Potency +111 against 0". Those were artifacts: craftable effects
were mapped onto **wiki** names and compared against a catalog that uses different
ones, so the baseline was zero wherever the name does not exist here. Named
element spellpower actually reaches 168 (Combustion, Corrosion, Glaciation,
Magnetism), so crafted spellpower **loses**.

The tell was that nearly every "win" sat against exactly zero. A comparison whose
baseline is empty is not a result, and this one looked like one.

73 of the 157 craftable effects still have no confident name mapping and are
excluded from the table above — which is itself the strongest evidence that the
vocabulary mapping, not the harvest, is the real work in this system.

## What the harvest is still worth

The placement and magnitude halves are real, sourced, and dated. Whoever picks
#193 up starts with 708 placements and 75 ML curves already read out of the wiki,
and starts knowing that the remaining work is a **type** problem rather than a
volume problem — which is the opposite of what the issue assumed.

It also means the value question can be answered before the cost is paid: with
the ML curves in hand, someone can check whether a crafted effect at ML 34 would
beat named best-in-slot at all. The recurring rationale across nine deferrals says
it usually would not, and that is now checkable rather than asserted.

## Related

- `src/crafting_coverage.py` — the `UNSERVED_ALLOWLIST` entry, and why the twelve
  labels are inert.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the rule the
  blocker rests on.
- `docs/wiki-evidence/harvest-method.md` — transport, pacing, and the privacy
  guard, which is why these tables were parsed in-page: the guard strips the `|`
  that wikitable markup is built from, so raw wikitext cannot be returned.


## The minimum level is the CRAFTER's choice, not the item's (2026-08-30)

Raised by the maintainer against the shipped Gem implementation, and they were
right about the mechanic. From the Essence Crafting page, Steps:

> Craft a Minimum Level shard at a Shard (Bound or Unbound) Crafting Device.
> **This shard determines the minimum level of the item, the power level of
> scaling effect shards crafted onto the item**, and the level-appropriate
> Enhancement bonus (+1, +2, etc.) for a weapon, shield, or armor.

Minimum Level shards exist for **ML 1 through 36** (the page tabulates a crafting
difficulty for every one). So an item's ML under Essence Crafting is not a
property it arrives with — it is set during crafting, and it determines how strong
every scaling effect on that item is.

**This is the premise the other slots will be modelled on**, and it is the one
`src/essence_pool.py` got wrong in principle. Rune Arms, Rings and Melee blanks
have no meaningful native ML to read; a blank craftable trinket is ML 1 until a
shard says otherwise. Reading the host record's ML works for the Gem only because
of the ceiling below, and it will not survive contact with the other twelve menus.

### Two ML gates, from two different sentences

Both are sourced, and they are NOT the same rule — they only coincide today
because every offered Extra effect happens to be Insight-typed.

| Gate | Source | What it blocks |
|---|---|---|
| Insight effects need ML 10+ | table 3b Notes: *"Effects that grant insight bonuses can be applied to items ML 10 and higher only, regardless of prefix/suffix/extra slot"* | the effect |
| The Extra SLOT needs ML 10+ | main page: *"Extra enchantment slots are not available on items under minimum level 10"*, and `Essence Crafting steps`: *"If the item is ML 10 or greater, it has a 'Mark of House Cannith Slot'"* | the slot itself |

### Picking the highest ML is always correct — measured, not assumed

All 25 offered options have a **monotonic non-decreasing** ML curve, and every
one of them peaks at ML 36. So there is never a reason to craft below the ceiling
for the sake of the effect, and "use the highest ML available" is optimal rather
than a heuristic. `tests/test_essence_pool.py` asserts the monotonicity, because
the moment one curve peaks mid-range that reasoning stops holding and the solver
would need to search the ML instead of taking the top.

The one reason to craft LOWER is to make a high-ML item usable by a lower-level
character — see the gap recorded below.

### The ceiling is NOT wiki-sourced

The maintainer reports, from play on 2026-08-30: a **Legendary** Gem of Many
Facets (native ML 30) would not go above **ML 30** even with an ML 36 shard
applied.

That is consistent with "a named item cannot be crafted above its own minimum
level", and the implementation behaves that way. **The rule itself was not found
on the wiki.** Searched: the Essence Crafting page (Steps, Components, Minimum
Level shards, Named items), all three Gem item pages, `Item:Mysterious Ring`,
`Item:Trinket`, `Minimum level`, `Essence Crafting steps`, `Essence Crafting
enchantments`, `Essence Crafting level progression`. The search API returned empty
for every query, which `harvest-method.md` records as unreliable on this wiki
rather than as evidence of absence.

The nearest signal is on `Item:Mysterious Ring`:

> There is no "Epic" version of this item. However, it can be Essence Crafted to
> any ML desired.

The "However" reads as though items that DO have version tiers are constrained by
them — but that is a reading, not a statement, and it is recorded here as one.

So the ceiling is carried as a **player observation with named provenance**, not
as a game rule. If it is ever contradicted — a heroic Gem crafted to 30, say —
this is the paragraph to correct, and nothing about the effect values changes with
it.

### Known gap: crafting DOWN is not modelled

Because the shard sets the ML, a Legendary Gem can presumably be crafted at ML 20
to be worn by a character capped there, at ML 20 effect values. The optimizer
currently excludes it outright below ML 30. That is a missing option rather than a
wrong number, and it is filed separately.
