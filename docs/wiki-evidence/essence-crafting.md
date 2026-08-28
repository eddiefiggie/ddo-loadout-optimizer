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
