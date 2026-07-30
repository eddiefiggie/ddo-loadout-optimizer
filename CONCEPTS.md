# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

Seeded from the solver / gear-source area (the modules the dominance-pruning learning touched). Other areas accrete as later runs process learnings in them.

## Solve model

### Variant
A single candidate the solver may equip in a slot — one item expanded to one specific upgrade tier, with its affixes parsed to structured tuples. The dataset is a list of variants; a tiered item yields several.

### Target
A stat on the user's **ranked** priority list that a solve maximizes. Priority is strict and lexicographic, not weighted — target 1 is maximized first, then target 2 without giving up any of target 1, and so on.

### Gated contribution
The unifying primitive for every stat source: a `(stat, bonus_type, value)` that enters the objective only when all of its enabling binaries hold. A worn affix has one gate (its item is equipped); an augment, set bonus, or Dino insert adds more gates (placement chosen, piece threshold met, slot filled). This is what lets heterogeneous sources share one exact model instead of a code path each.

### Bonus-type bucket
The `(stat, bonus_type)` group in which at most one contributing value counts. Within a bucket only the single highest *selected* value applies; across buckets (different bonus types on the same stat) values sum. This encodes DDO stacking: same-type does not stack (max), different-type does (add).

### Dominance pre-filter
A per-slot Pareto reduction run before the model is built: a variant beaten by a same-slot peer on **every value-carrying dimension** is dropped, since it can never be uniquely optimal. Soundness has two standing obligations — it holds only while every objective is max-aggregation (a piece-*count* objective breaks it in a multi-pick slot), and its comparison surface must stay a **superset** of every dimension the objective reads (a variant whose worth is a dimension the comparator ignores gets wrongly pruned).

### Lexicographic solve
The staged solve that realizes ranked-priority optimization: solve for target *k* with all earlier targets locked at the values they already won, then a final deterministic tie-break stage so repeated runs return the same canonical loadout.

## Stat sources

Each source family below feeds the same bonus-type buckets as a gated contribution; they differ only in what gates them.

### Worn affix
A structured `(stat, bonus_type, value)` carried by an equippable item, gated simply by that item being equipped. The base source family; everything else generalizes from it.

### Augment
An effect placed into a colored slot on an equipped item. Modeled by **aggregate per-color capacity** — total placements of a color are bounded by the open slots of that color across equipped items, not tied to a specific physical slot until reconstructed for display.

### Set bonus
A tier of stats that activates only when at least a threshold number of pieces of a named set are equipped. Its stats are gated by a piece-count indicator, so a set completes only when doing so advances a ranked target.

### Dino insert
A crafted Isle of Dread effect placed into a slot **two-keyed by `(dino_type, category)`** — a bone type (Scale / Fang / Claw / Horn) crossed with a gear category (Accessory / Armor / Weapon). An insert fills only a slot whose *both* keys match: a "Scale (Weapon)" insert fits a "Scale Slot (Weapon)" but never a "Scale Slot (Accessory)". Bounded by aggregate per-`(type, category)` slot capacity across equipped items — the typed analogue of augment per-color capacity, the same two-key shape as [[Viktranium Experiment crafting]]. Host layouts carry **mixed** typing (an armor blank exposes Scale/Fang as *Armor* slots but Claw/Horn as *Accessory* slots). Weapon inserts are mostly on-hit procs / material types with no parseable magnitude, so strict provenance quarantines the bulk of that pool and keeps only the clean stat inserts.

### Multi-affix Dino insert
One insert that grants several affixes at once (e.g. "Silverscale" = +56 to three healing amps; "Fang: Deception" = +11 Sneak Attacks AND +17 Sneak Attack Damage). Modeled as a single placeable **unit** carrying an `affixes` list: the solver gives it **one placement binary** that gates *every* affix's contribution, so the affixes apply all-or-nothing (they come together from one slot and cannot be split). The `dominates()` slot-guard must count a multi-affix blank's full value so it is never wrongly pruned. The one sanctioned model extension of M2 — a multi-affix insert provably cannot be expressed as independent single-affix placements. The parser earns these strictly: it splits an effect on newlines and sentence boundaries, drops any conditional / proc / DOT / flavor sentence ("If this is slotted…", "6d6+6 damage every 2 seconds"), and mints an affix only from a clean `+N Type bonus to Stat` clause — never from greedy tail text.

### Dino Set-Bonus
A crafted **set-membership** slot: a Dinosaur Bone host with a Set-Bonus slot can be made to "count as part of" one named Dino set (Dread Stalker, Devotion of the Firemouth, …), which activates at a piece threshold. Unlike an intrinsic [[Set bonus]] (membership is baked into the item), here membership is *chosen* per host — and only Armor / Helmet / Cloak hosts carry a Set-Bonus slot (≤3 crafted slots), while one set needs 5 pieces. So completion mixes chosen slots with intrinsic named/raid pieces that also belong to these sets. **Solver-active**, driven by the same general chosen-set-membership primitive as the Vecna "Lost Purpose" awaken (a host awakens one set from a pool; the threshold self-seeds from the [[Set bonus]] catalog so it works even when only awakened pieces are equipped). The set definitions come from the same catalog intrinsic members use, so an awakened set gives identical stats to an intrinsically-completed one.

### Blank host
A Dinosaur Bone item whose entire value is the typed Dino slots it exposes — it carries no affixes of its own. Because its worth lives in a non-affix dimension, any code path that reads only affixes (a list view, or a dominance comparison) will treat it as empty and wrongly discard it unless taught to read its slots. Blanks are materialized per worn slot (accessory slots, Armor, Main Hand for a weapon, Rune Arm), deduped so six armor types collapse to one Armor blank; shields/orbs have no Off Hand slot in the solver, so their blanks are disclosed-deferred rather than dropped.

### Nearly Complete slot
An Update 81 upgrade slot that lets an item gain one extra affix chosen from a fixed **category** menu (Ability Score, Insightful Ability, Quality Ability, Healing Amplification, Skill, Spell Focus) — the category fixes the bonus type, the player picks the stat. Modeled as a **choice-slot**: a select-one over the category's option pool, gated by the item being equipped, so the solver picks whichever option best advances the ranked targets. The in-game choice is irreversible, so at most one option per slot ever applies.

### Roll group (choice-slot)
An item affix offering several mutually-exclusive options — "Rolls one of: Strength +13 / Dexterity +13 / Constitution +13". The same select-one choice-slot shape as a [[Nearly Complete slot]], but with the options listed inline rather than drawn from a category pool; the solver picks whichever option best advances the ranked targets. An item's whole stat block can be a single roll group.

### Umbrella stat
An affix that buffs every ability at once — "All Ability Scores +15", "Well Rounded". Expanded into the six concrete ability affixes so a single-ability [[Target]] is credited, since the optimizer matches a target only by exact stat name.

### Viktranium Experiment crafting
The Update 75 (The Chill of Ravenloft) crafting system whose slots the data keys as "Lamordia" — Lamordia is the Ravenloft domain these augments are themed on (the wiki calls them "Lamordia augments"), so the key is the correct augment-type name, not a mislabel; the system's own name is Viktranium. An item carries typed slots (Melancholic / Dolorous / Miserable / Woeful) filled from a documented augment pool keyed by **(slot type × item category)**, at the host's tier (Heroic ML8 / Legendary ML34). The same insert/[[choice-slot|Roll group (choice-slot)]] shape as a [[Dino insert]] / [[Nearly Complete slot]]; modeled by reusing the [[Gated contribution]] primitive with only a `dominates()` guard added (the slot value lives outside the bucket surface). Hosts appear in **two marker formats** the pipeline must both read: the enriched `{{Lamordia Slot|type|category}}` template, and the base seed's human-readable strings ("Lamordia: Melancholic Slot (Accessory)") — the latter flow through the affix parser and would be dropped as noise if not caught, the [[silent value loss|Quarantined]] trap. The "Cataclysmic Weapons and Shields" arm is item-*creation* (a new named weapon), not a choice-slot, so it is sourced as named gear, not modeled here.

### Seal slot
A "Sealed in X" unique enchantment (`Sealed in Fire / Undeath / Gloom / Mist`) that lets an item have its power *unsealed* at a crafting table, gaining **one** effect chosen from a pool keyed to the item's gear category — Fire/Undeath at the Ritual Table, Gloom/Mist at the Augmentation Altar. The wiki is explicit that the pick is mutually exclusive: "adding one effect. Attempting to add another will remove the original." The same select-one [[Nearly Complete slot|choice-slot]] shape, modeled by reusing the [[Gated contribution]] primitive; the solver picks whichever pool option best advances the ranked targets, and never stacks more than one per slot. Sealed in Undeath covers clothing/jewelry with a pool of ability score at +15 / +7 Insightful / +3 Quality. Distinct from the expansion's item-*creation* crafts (Catalyst) and the universal Essence/Cannith system, which are sourced or de-scoped rather than modeled as slots.

## Data trust

### Verified
A variant the solver is allowed to equip. The usual path to this status is contributing at least one solver-eligible affix — a value parsed to an explicit `(stat, bonus_type, value)` from wiki text. A slot-only Blank host is the deliberate exception: it is stamped verified despite having zero affixes, because its worth is its typed slots rather than affixes.

### Quarantined
A record excluded from the solver because it yields no explicitly-parseable value — its wiki text was ambiguous or value-less. Quarantined records stay in the dataset for browsing and coverage disclosure but never contribute to a solve; nothing is ever inferred to rescue one.

## Candidate pool & constraints

### Inventory mode ("What I own")
A candidate-pool option where the solve is restricted to the base items a player owns, imported from a Trove inventory export and matched to the dataset by name. Only **base items** are constrained; augments and each owned item's crafting transformations are still sourced from the full catalog, so the result shows the full build potential achievable with the owned base gear rather than what the player could craft from owned consumables. The alternative pool is all findable game gear (the default, theoretical best-in-slot).

### Slot constraint
A per-session hard constraint the user places on an equipment slot before solving: **pin** it to a specific item, **lock** it empty (excluded from the loadout), or leave it **free** for the solver. The solve honors these exactly and optimizes the remaining free slots around them.

### Artifact (item type)
A DDO item quality — distinct from the **Artifact bonus type** carried by Lunar/Solar Gem augments — of which only one may be equipped at a time. Surfaced as an opt-in: an "Include an Artifact" setup checkbox (default off). Off excludes Artifact-flagged variants from the candidate pool; on requires **exactly one** Artifact in the loadout (the best-scoring one, tagged in the results). Backed by a per-variant `artifact` flag (exclude-until-verified; unflagged variants are treated as non-Artifact). The "exactly one" case makes Artifact-ness a value dimension, so the per-slot dominance pre-filter must exempt the best Artifact (like set contributors).
