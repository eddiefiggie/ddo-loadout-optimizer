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

### Crafting DOWN — harvested 2026-08-30, and now modelled (#611)

The earlier version of this section said a Legendary Gem could "presumably" be
crafted at ML 20. That word was doing too much work for something the optimizer
was about to act on, so the page was harvested again specifically for this
question. It is better sourced than "presumably" implied.

**Directly supporting, all from the Essence Crafting page:**

> Minimum Level shards simply determine the ML of the item.

> Scaling effects vary their values when placed in **lower** or higher Minimum
> Level shard items, increasing with higher ML.

> Material types and Augment Slots are retained on an item after disjunction.

and from `Essence Crafting steps`, in the ML-shard procedure:

> **Search for the Minimum Level you wish to create.**

The second quote is the load-bearing one: the wiki states outright that an effect's
magnitude varies when placed in a LOWER-ML shard item. That is the mechanic, named,
in the direction #611 needed. The third matters separately — it is why a Legendary
Gem crafted down keeps its Green and Yellow augment slots.

**The named-item question, which is real.** The general rule is that named items are
out:

> In Essence Crafting, only non-named equipment [...] can be deconstructed. Named
> items [...] cannot be deconstructed.

> Trinkets, which are usually named items, cannot be disjoined.

The Gem is an explicit exception, stated on its own item page — which is also why it
carries the `Craftable (hidden)` affix:

> This item is also keyed for Essence Crafting, and may be Disjuncted so that it can
> be crafted upon.  — `Item:Legendary Gem of Many Facets`

So the standard flow applies to this host, and the standard flow lets the crafter
pick the level.

**Searched for a prohibition and found only the opposite direction.** The single ML
restriction anywhere on either page is about raising, not lowering:

> Disjunction does not change the Minimum Level [...] of a rune arm, but its other
> benefits are removed. Note that the Minimum Level cannot be **raised** after
> disjunction.

That is stated of rune arms, but it is the same direction as the maintainer's play
observation on the Gem (an ML 30 Gem refuses an ML 36 shard) and the same direction
the implementation already refused. Nothing found states or implies a floor.

**What remains an inference, and is disclosed as one.** No sentence says *this named
item* may take a shard below its native level; that follows from the general rule
plus the Gem's stated exemption. The app therefore does not do it silently — a build
that crafts a host below its printed ML says so, names both levels, and says the
permission is general rather than item-specific. See `essenceNoticeLines` in
`web/projection.js`.

**One loose end, recorded not resolved.** Augment slots are listed as adding to an
item's minimum level (Colorless 1, Red/Blue 2, Yellow 3, Green 5, Purple/Orange 8),
and the page hedges on how that interacts with crafting:

> When crafting on an item with an augment slot, after disjuncting the item, it will
> be listed as having a minimum level, but it appears that a lower level shard can be
> applied. This may be a holdover from the old crafting system [...]

If those additions are a real floor rather than a holdover, the Legendary Gem's floor
would be ML 5 (Green) — below every cap at which crafting down is interesting, so it
changes no result today. Recorded so that a future host with a Purple or Orange slot
is not assumed to reach ML 1.

## The slot structure itself — harvested 2026-09-18 (#797)

#795 shipped a rule it did not source. The player-authored item bench enforces
**one enchantment per menu**, which replaced #773's `AFFIX_MAX = 12` and is what
makes the form render one row per menu instead of a grow-your-own list. It was
asserted in the source comment, the commit and the PR body as though wiki-stated.
It was not: it traced to prose in `docs/plans/2026-07-25-006-…-crafting-content-roadmap-plan.md`.

It is now sourced, from two pages, and the second quote is the strongest form the
wiki offers — the game refusing the action:

> "Each craftable item has a prefix and a suffix enchantment slot."
> "A Mark of House Cannith can be used to add a third extra enchantment slot."
> — `Essence Crafting`, Enchantments

> "All items can have one to three additional properties: A prefix effect
> (Clever, Vorpal, Holy, etc.) A suffix effect (Everbright, Springing, Pure Good,
> etc.) If the item is ML 10 or greater, it has a "Mark of House Cannith Slot",
> where another effect can be applied (Insightful Strength, Insightful Accuracy,
> etc.)"
> — `Essence Crafting steps`

> "(An error will pop up if you already have a Suffix, Prefix, or Insightful
> bonus and are trying to install a second one.)"
> — `Essence Crafting steps`, Choosing enchantments

Three slots, one effect each, and the third gated at ML 10. That is the model
`web/custom-items.js` already implements; it now cites this.

### The "Mark of House Cannith Slot" is the EXTRA MENU, not an augment slot

#798 was filed on the opposite reading and is wrong; it is closed as not-planned with this evidence. The steps quote above places
"another effect" in it and names `Insightful Strength` and `Insightful Accuracy`
as examples — it is the third ENCHANTMENT slot, which the app already models as
the `Extra` menu behind `EXTRA_SLOT_MIN_ML`.

Two consequences worth keeping:

- **It corroborates the `Insightful`-prefix ML-10 gate** that #795 introduced by
  reading the placements table's naming convention. The wiki's own examples of
  what goes in this slot are both `Insightful X`.
- **Augment slots survive disjunction**, so the bench offering the seven colours
  freely is correct rather than an unmodelled gap:

  > "Any prefix, suffix, enhancement bonus, and race restriction will be stripped
  > away, but these properties are unaffected: Material type Augment Slots (and
  > augments therein) Guild augment slots (and augments therein) previous
  > eldritch rituals permanent damage"
  > — `Essence Crafting steps`, Deconstruction

  Essence Crafting neither adds nor removes an augment slot. The player records
  what their blank already had, which is exactly what the form asks for.

### Three automatic bonuses, none modelled

Found in the same read. All are stated, none is guessed, and none is in the app:

> "Unlike original Cannith Crafting, you don't need to craft an Enhancement Bonus
> shard for Weapons, Shields, or Armors (including Robes, Outfit, and Docents). A
> scaled Enhancement Bonus is applied automatically when you apply a Minimum
> Level shard."
> "A Weapon dice multiplier is automatically applied to a weapon."
> "A Spellcasting Implement bonus is added when a spell-related shard is applied
> to a weapon or shield. This bonus is equal to the item's minimum level."
> — `Essence Crafting`, Notes

So a player describing an essence-crafted weapon on the bench under-reported it:
the item carried an Enhancement bonus and a dice multiplier the form never asked
about. **Resolved by #799**, and the resolution is split, because only one of the
three is expressible:

| bonus | outcome | why |
|---|---|---|
| scaled Enhancement Bonus | **modelled** | `Enhancement Bonus (Weapon)` / `(Armor)` are stats the catalog already ranks — 3,259 and 1,239 instances |
| weapon dice multiplier | **disclosed** | `affix_parser` classes weapon dice as non-magnitude; there is no bucket a multiplier could join |
| Spellcasting Implement bonus | **disclosed** | the catalog carries only a `Bool` *"item becomes a Spellcasting Implement"*, never a magnitude |

**The data was already here.** All three curves are in `values_by_ml`, harvested
by #599, and `essence_curve_join.UNCRAFTABLE_ROWS` already excluded them from the
craftable pool — correctly, since nobody crafts them. They were excluded from one
pool and never added to another, which is why nothing read them for a year. The
footnote that justified the exclusion is the same one that justifies applying
them automatically:

> "These bonuses do not require a separate shard or take up a slot
> (suffix/prefix/extra), nor is one possible to craft."
> — `Essence Crafting`, table 3b footnote

**Scope is the wiki's own sentence**, which names three kinds: *"Weapons, Shields,
or Armors (including Robes, Outfit, and Docents)"*. Orbs and Rune Arms are off-hand
items it does not name, so they get nothing rather than a guess — the same refusal
`SLOT_GROUPS` makes for thrown weapons.

The spelling per group is measured, and it is why #792 mattered: slot `Weapon`
carries `(Weapon)` 3,259 times, slot `Armor` carries `(Armor)` 935, and slot
`Off Hand` — where Shields live — carries `(Armor)` 304 times against 2 bare. **A
shield takes the armour spelling.**

### Combined prefixes put TWO effects in one prefix slot

> "Combined prefixes are special higher level shards which have two combined
> effects. […] Update 81 introduced 100 more combined shards with a minimum level
> of 20."
> — `Essence Crafting`, Combined prefixes

This does not contradict one-per-*slot* — a combined prefix is one shard — but it
does mean "one enchantment per menu" is the wrong phrasing for the general case.
**Resolved by #800.**

### The recipe table, harvested 2026-09-19 (#800)

`Expand Dual Shard Recipe List` parses: **107 rows**, eight columns —
`Name | Effect 1 | Effect 2 | Mystical cost | Slot | Update | Bound Level | Unbound Level`.
Verbatim in `data/seed/compendium/essence_combined_prefixes.json`, including the
page's own typos (`Blaphemous`, and `Rebellious`'s lowercase `holy Blast`), which
the join folds through the repo's existing `_norm` rather than the shard
correcting its own source.

The split is an independent check on the harvest: the page says *"Update 81
introduced 100 more combined shards"*, and the table carries **exactly 100** U81
rows against 7 from U55.

Answering the four questions #800 opened with:

| question | answer |
|---|---|
| Is there a harvestable list? | Yes — the collapsed table parses cleanly. |
| Do both effects share the prefix slot's placement rules? | **No.** The recipes carry their OWN `Slot` column. `table 1b` is keyed by one effect and says nothing about combined shards. |
| Do the pair bucket as two independent affixes? | Yes — two ordinary affixes, minted from one entry row. They are never independently *selectable*, which is the part that mattered. |
| ML 20 floor? | Confirmed, and it is a THIRD ML gate: the Extra rule gates a menu, the Insight rule gates an effect, this gates the option. |

**A third slot vocabulary.** The `Slot` column uses singular names (`Weapon`,
`Ring`, `Shield`) matching neither `table 1b`'s plural groups nor the app's slot
list. `essence_combined.GROUP_OF_SLOT` is that join, written out and guarded in
both directions. Its `Weapon` is *undifferentiated* — and that is a statement
rather than a silence, unlike `table 1b`, which names Melee and Ranged separately
and never says which DDO weapon types are in each. So a weapon recipe serves both
groups.

**78 of 107 are served; 29 are withheld whole.** A recipe is served only when BOTH
effects resolve to a rankable catalog stat. Serving the half that resolves would
grant one effect where the game grants two, and is the fan-out shape
`src/container_registry.py` exists to refuse. The withheld 29 are recorded with
the unrankable effect named.

### The Melee/Ranged split — harvested 2026-09-19 (#804)

`table 1b` names `Melee weapons` and `Ranged weapons` and never defines either.
#795 wrote the mapping from `WeaponTaxonomy.STYLE_OF_TYPE`, whose axis is
HANDEDNESS, and labelled it a construction. The harvest splits three ways.

**RANGED is enumerated, and the construction was right.** `Ranged weapons` carries
`Table: Basic Ranged Weapons`, nine rows:

> Composite Longbow · Composite Shortbow · Great Crossbow · Heavy Crossbow ·
> Light Crossbow · Longbow · Repeating Heavy Crossbow · Repeating Light Crossbow ·
> Shortbow

Those nine fold onto exactly the **seven** taxonomy types the handedness
construction already called Ranged. So it is retired **by verification rather than
replacement**, and a test asserts the agreement so a future divergence goes red.

**THROWN AND HANDWRAPS stay refused — but the evidence improves from silence to
exclusion.** All five thrown types are ABSENT from that enumeration, and
`Thrown weapons` lists `Ranged weapons` under *See also* — a sibling, never a
parent. It defines them only as *"any weapon that may be physically thrown at a
target over a distance."* `Handwrap` never calls them either way and states
*"handwraps are not programmed as weapons by design."*

**MELEE IS NOT ENUMERATED, and remains an inference.** There is no `Melee weapons`
article — the page returns *"We don't currently have an article called 'Melee
weapons'"* — and no category for it: the type categories hang off
`Weapons by type`, and `Throwing weapons`' parent is plain `Weapons`. So melee is
the COMPLEMENT: every type that is neither sourced-ranged nor unplaced.

That is the one inference left in this model, and it is labelled as one in
`src/essence_placements.build_weapon_split` and `web/custom-items.js`. What keeps
it honest is a guard rather than a comment: `tests/custom-items.test.js` asserts
the three sets are TOTAL and DISJOINT over every `STYLE_OF_TYPE` key, so the
complement can never silently swallow a type the wiki actually placed.

Result: **27 melee, 7 ranged, 6 refused, 40 total** — byte-identical to what #795
produced. No behaviour changed; what changed is that two thirds of it is now read
rather than guessed.

### The SLOT_GROUPS join — checked, not sourced (#806)

`SLOT_GROUPS` maps the app's 14 slot names onto `table 1b`'s 16 groups. **This one
cannot be sourced, and chasing a source would be the wrong goal.** Unlike
melee-vs-ranged, which is a claim about the game, this relates *the app's*
vocabulary to *the wiki's* — and the wiki does not know gear-planner's slot names.

So it is checked instead, from two directions the wiki cannot reach.

**Side one — a third, anatomical vocabulary.** Every one-to-one worn slot holds
exactly ONE gear-planner type, and the type names the body part:

| app slot | catalog type | wiki group |
|---|---|---|
| Helmet | `Head items` | Headgear |
| Goggles | `Eye items` | Goggles |
| Necklace | `Neck items` | Necklaces |
| Cloak | `Back items` | Cloaks |
| Belt | `Waist items` | Belts |
| Ring | `Finger items` | Rings |
| Gloves | `Hand items` | Gloves |
| Boots | `Feet items` | Boots |
| Bracers | `Wrist items` | Bracers |
| Trinket | `Trinket items` | Trinkets |
| Quiver | `Quiver items` | *(none — see below)* |

`Helmet` holding only `Head items` is what licenses reading it as `Headgear`. A
slot that ever held two kinds would have stopped being one group, so the guard
breaks loudly instead of widening quietly. `Off Hand` holds exactly
`Bucklers, Small/Large/Tower shields, Orbs, Rune Arms` — the three groups it
claims, nothing left over. `Weapon` is #804's.

**Side two — the wiki names 11 of the 16 verbatim.** The `Items` navbox groups
them as `Helms · Gloves · Cloaks · Belts · Boots` (CLOTHING) and
`Bracers · Goggles · Necklaces · Rings · Trinkets` (JEWELRY), plus `Orbs` and
`Rune Arms`. The remaining five are naming correspondences, recorded as such:

| `table 1b` | the wiki elsewhere |
|---|---|
| `Headgear` | the navbox's **HEAD SLOT**, whose contents are `Helms` |
| `Armors` | the **ARMOR** category |
| `Shields` | Bucklers / Small / Large / Tower |
| `Melee weapons`, `Ranged weapons` | settled by #804 |

**Side three — a second join, written independently.**
`essence_combined.GROUP_OF_SLOT` maps a DIFFERENT wiki table's singular slot names
onto the same groups. The two reach 15 and 16 respectively, and the single
difference is **`Rune Arms`**: no combined-prefix recipe lists a rune arm slot.
That asymmetry is now asserted WITH its reason, so it reads as a fact about the
recipe table rather than a hole.

**`Quiver` maps to nothing**, because `table 1b` has no quiver group. A test
asserts quivers exist in the catalog, or the empty mapping would be
indistinguishable from a slot nobody has gear for.

### Two catalog slots that are not equipment slots

`Rune Arm` and `Main Hand` each hold exactly one item — both `Dinosaur Bone`
crafting blanks with zero affixes. They are Dino-crafting bases, which is why the
custom-item slot list correctly has neither, and why `Rune Arms` is reached
through `Off Hand`.

## Curve-join audit — four sources, none states the join (2026-09-19, #812)

`essence_curve_join` resolves 120 of 157 effect names and quarantines 37: **21
correctly** (`table 2b` lists them non-scaling) and **16** as `unmapped` or
`ambiguous`. Its `rows_unused` list is suggestive — `Amplification`,
`Penetration`, `Ins. Penetration`, `Ins. Sheltering`, `Lore (all)`,
`Lore (one type)`, `Resistance`, `Resistance (save)` — so this was audited to see
whether the wiki states their membership.

**It does not.** Recorded so the next sweep does not repeat the search:

| source | what it carries | states the join? |
|---|---|---|
| `Essence Crafting/table 3b` | 75 curve rows × ML 1–36, one footnote about automatic bonuses | no |
| `Essence Crafting/table 2c` | `Group / Name / Bound / Unbound / Item slot`, 348 rows | no |
| `Essence Crafting enchantments` | the same 3b table, plus a Notes block | no |
| `Augments by level` | does not carry these effect names at all | no |

Table 2c's `Group` column is a **third** vocabulary — `Defense`, `Spellcasting`,
`Spell critical`, `Offense` — that coincides with a row label only for `Ability`
and `Skill`, which is what `CATEGORY_ROWS` already encodes. `Healing
Amplification` is group **`Defense`**, not group `Amplification`.

So the obvious guesses stay guesses. A head-noun rule is the exact error this
module prevents: `Spell Resistance` ends in `Resistance` and has its own
`Spell Resistance (SR)` row, and the module's own opening example is `Insightful
Accuracy` reading **23** against `Accuracy` where `Ins. Accuracy` gives **11** —
a wrong number that looked right.

`CANDIDATE_ROWS` now records what each unmapped effect would be confirmed
*against*, as documentation only. A test asserts every name in it is still
quarantined and absent from the mapping, so the list can never quietly become the
join.

### The same read found something that IS sourced

> "Scaling effects increase their values when placed in increasingly higher
> minimum level (ML) shard items. **Combined Shards also use this scaling for
> their individual effects.**"
> — `Essence Crafting enchantments`, Bonus by level, Notes

#800 shipped combined prefixes asking the player for every magnitude, and a guard
asserted `essence_combined` took no number from the curve join. That guard
encoded something true at the time; this sentence makes it wrong, so it was
**updated with the quote rather than deleted**.

**51 of 156** combined-effect instances now take their magnitude from the curve —
only those the **existing** mapping already resolves. The other 105 name effects
`table 1b` does not carry (`Entropic`, `Anarchic`, `Acid Absorption`,
`Deception`) and keep asking the player, because resolving a new vocabulary
through a join validated against a different one is the same refusal as above.

## Owner sweep, 2026-09-19 (#815)

Four points raised against the bench. Three were defects; one was already right
and badly labelled.

### `Insightful X` is an Insight bonus — 9 of 9 stated

The bench let the player choose a bonus type, which the mechanic fixes. #193 read
all 157 effect pages and found 22 with a stated type. Those 22 split:

| | count |
|---|---|
| `Insightful X` → **Insight** | **9 of 9** |
| non-Insightful → Enhancement | 10 |
| non-Insightful → Competence | 2 (`Haggle`, `Healing Amplification`) |
| non-Insightful → Natural | 1 (`Natural Armor`) |

Every stated `Insightful X` is Insight, without exception, and it is the wiki's
own convention — it describes the ML-10 slot as the place *"where another effect
can be applied (**Insightful Strength, Insightful Accuracy**, etc.)"*, and
`essence_pool._stat_name` has stripped that prefix since #193.

So the rule READS the harvest. It is not a default: the non-Insightful 13 carry
three different types between them, so that half keeps asking the player.
`assert_insightful_is_always_insight` fails the build on a stated
counter-example, so the reading cannot rot into an assumption.

**233 of 523 placements now carry a sourced type, up from 93.**

### The third slot was there, under table 1b's name

> "All items can have one to three additional properties: A prefix effect … A
> suffix effect … If the item is ML 10 or greater, it has a **"Mark of House
> Cannith Slot"**, where another effect can be applied"
> — `Essence Crafting steps`

The bench called it `Extra`, which is `table 1b`'s column heading and the correct
DATA key — and the wrong word to show a player, who could not find the Cannith
slot. `MENU_LABELS` renames it for display only; `MENUS` is unchanged.

### The name field asked for something the mechanic has no room for

You do not name a crafted item. The field existed because #773 made the name the
`variant_id`, and that issue's negative result records why an opaque id was
wrong — this app treats `variant_id` as both identity and display text.

So the name is DERIVED, in menu order, from what is on the item: `Constitution
Ring`, `Fortifying Ring`. **This is the tool's label, not the game's.** The wiki
states no naming convention for crafted items — `Essence Crafting steps` was read
for one — so the derivation deliberately does not mimic one. An entry that
already carries a name keeps it, which is what stops the change renaming saved
items and stranding their pins.

### What the sweep re-confirmed as sourced

slot→group (#806), Melee/Ranged (#804), three menus one effect each (#797), the
ML-10 gates, effects per menu (`table 1b`), magnitude by ML (#810), the automatic
Enhancement bonus (#799), combined prefixes and their scaling (#800, #812), and
augment slots surviving disjunction (#798).

## The bonus type, read from the other direction (2026-09-19, #817)

#193 read all 157 **effect** pages and found a stated bonus type for 22. #815
then typed the `Insightful X` half from that harvest (9 of 9 stated are Insight).
That left 41 effects, 222 placements, asking the player.

**The bonus-type pages had never been read.** One of them states the answer for
nearly half of what was left:

> "Sources of competence bonus to **skills**: Named or randomly generated items ·
> **Essence Crafting** · Colorless Augments"
> — `Competence bonus`

Corroborated by the one skill #193 did type: `Haggle`, *"+20 **Competence**
([[Essence Crafting]])"*. And checked for a competitor — **`Enhancement bonus`,
`Quality bonus` and `Exceptional bonus` do not mention Essence Crafting at all**,
so nothing else claims this ground.

Membership is `table 2c`'s `Skill` group, the same sourced list the curve join
already uses for the `Skill` row. The rule is ordered AFTER the Insightful one,
so `Insightful Balance` stays Insight — the insight variant is a different
enchantment, not a competing answer for the base, and `Insightful Haggle` being
stated Insight is that ordering read off the harvest.

`assert_no_stated_skill_contradicts_competence` checks the claim against the
population it is about: no skill whose type #193 *did* find may disagree. It
refuses to pass over an empty skill group or zero stated skills.

| | placements (of 523) |
|---|---|
| typed before #815 | 93 |
| after #815 (`Insightful` → Insight) | 233 |
| **after #817 (skills → Competence)** | **334** |
| on/off flags — need no type | 68 |
| **still asking** | **121**, across 23 effects |

### The lesson worth keeping

A harvest that reads one side exhaustively can still miss the answer. #193 read
157 effect pages and recorded the silence honestly; the silence was real, and the
statement was on a page it had no reason to open. **When a harvest comes back
empty, ask what the other end of the relation would say.**

The 23 effects that remain are not skills and have no such page: `Sheltering`,
`False Life`, `Assassinate`, `Fortification`, `Wizardry`, `Dodge`, `Stunning`,
`Diversion`, the two Alacrities, `Shatter`, `Vertigo`, `Spell Penetration`,
`Deadly`, `Tendon Slice`, `Doubleshot`, `Armor-Piercing`, `Shield Bashing`,
`Underwater Action`, `Incite`, `Negative Amplification`, `Accuracy`, `Deception`.

### Sweeping the bonus-type pages for the rest (2026-09-19, #817)

After skills, 23 effects still asked. All 25 bonus-type pages in the app's
vocabulary were then read — the sweep the skill find suggested.

**Result: one more, and a clean negative for the other 22.**

`Dodge` is an **Enhancement** bonus:

> "Items · **Essence Crafting**: Up to +14% **enhancement bonus**. Up to +6%
> **insight bonus**."
> — `Dodge bonus`, Items

#193 read the page `Dodge`, which is silent. The statement lives on `Dodge
bonus` — a *separate* page, which exists only because dodge is itself an AC bonus
type. Checked for the other 22: **no `<Name> bonus` page exists for any of them.**

The insight half of that quote agrees with #815's `Insightful X` → Insight rule,
a third independent corroboration.

**Known discrepancy, taken deliberately.** The page's magnitudes run one lower
than `table 3b` at the top — "+14%" where the curve reaches 15 at ML 34–36, and
"+6%" insight where `Ins. Dodge` reaches 7. Only the TYPE is taken from here; the
magnitude comes from `table 3b` as it does for every effect.

**One false positive worth recording**, because trusting it would have been
wrong: `Armor bonus` mentions Essence Crafting *and* contains the word "Dodge" —
but the Essence line is about `Armored Bracers` (+1-7), and "dodge bonus" appears
only in the closing list of other AC bonus types. A keyword hit is not a
statement.

Pages checked with no Essence Crafting mention at all: `Enhancement`, `Insight`,
`Quality`, `Exceptional`, `Profane`, `Sacred`, `Morale`, `Luck`, `Resistance`,
`Deflection`, `Shield`, `Equipment`, `Artifact`, `Implement`, `Legendary`,
`Alchemical`, `Primal`, `Festive`, `Determination`. No page: `Vitality`,
`Untyped`, `Orb`.

| | placements (of 523) |
|---|---|
| typed | **340** |
| on/off flags — need no type | 68 |
| **still asking** | **115**, across 22 effects |

## 2026-09-20 — #840: where the source of truth and the wiki disagree, read row by row

`veteran-software/yourddo` is the source of truth for placements since #837, with the
recorded rule that **the wiki wins where the two disagree unless the owner rules
otherwise**. Measured across every (effect, group) both sources place — 480 pairs —
474 agree on menu and 6 do not. Each of the 6 was settled by reading the wiki's own
row on `Essence Crafting enchantments` (the Group / Name / … / Item slot table, whose
last three columns are Prefix / Suffix / Extra; the column reading is corroborated by
`Dodge Bonus`, which matches yourddo exactly, and `Insightful Spell Resistance`, which
matches our harvest exactly):

| effect | wiki row (2026-09-20) | yourddo | ruling |
|---|---|---|---|
| Spell Resistance | Prefix: Belts, Cloaks, Rings, Trinkets, Armors, Shields; no Suffix; no Extra | Belts/Cloaks/Trinkets Suffix, Armors/Shields Extra, Rings Prefix | wiki — five pair-level overrides |
| Strength | Prefix: Bracers, Gloves, Trinkets; Suffix: Belts, Boots, Trinkets | Belts Prefix | wiki — one pair-level override |

`WIKI_PLACEMENT_OVERRIDES` in `src/essence_source.py` carries exactly these six pairs,
and `assert_wiki_overrides_are_live` fails when one goes stale, contradicts the harvest
it cites, or stops changing anything. Pair-level on purpose: a group the wiki is silent
on keeps yourddo's placement, and the recipe's enchantments and curves stay yourddo's.

**`Deception` — a since-removed row, not a loss.** Our 2026-09 harvest carried a
standalone `Deception` in Goggles / Prefix (`placements.Goggles.Prefix[4]`, between
`Persuasion` and `Seeker`). On 2026-09-20 the live `Essence Crafting enchantments` page
contains no `Deception` anywhere. yourddo's omission therefore agrees with the current
wiki, and the standalone effect is NOT overlaid. It survives where the wiki still has
it: the **Combined prefixes (dual shard)** table on `Essence Crafting` names `Deception`
as the second effect of `Sabotaging` (with Seeker), `Assassin's` (Doublestrike),
`Outlander's` (Doubleshot), `Relentless` (Deadly) and `Thieving` (Accuracy). yourddo's
versions of those five recipes name that enchantment `Sneak Attack Attack`, with the
same slots. Joined five-for-five (`essence_stat_join.json`, rule
`wiki-dual-shard-table`); it reaches the bench through those five recipes, typed
Enhancement from the source.

Our harvest also placed `Spell Resistance` at Orbs / Prefix, which the live row does not
list. Not touched — yourddo does not place it on Orbs either, so there is no pair to
override — but recorded, because it is the second harvest entry the live page no longer
backs.
