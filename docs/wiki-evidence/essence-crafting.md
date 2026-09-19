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
