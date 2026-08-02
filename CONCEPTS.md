# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

Seeded from the solver / gear-source area (the modules the dominance-pruning learning touched). Other areas accrete as later runs process learnings in them.

## Solve model

### Variant
A single candidate the solver may equip in a slot — one item expanded to one specific upgrade tier, with its affixes parsed to structured tuples. The dataset is a list of variants; a tiered item yields several.

### Target
A stat on the user's **ranked** priority list that a solve maximizes. Priority is strict and lexicographic, not weighted — target 1 is maximized first, then target 2 without giving up any of target 1, and so on.

### Stat cap
An optional user-set maximum on a Target's counted value — the solve stops crediting the stat past the cap, so it clamps rather than forbids.

A cap is a clamp, not an eligibility filter: an item that exceeds the cap is still equippable, its counted value just saturates at the cap. Because a capped Target's contribution stops rising there, surplus slots fall through to the next-ranked Target instead of over-investing. When two caps name the same stat — a user cap and an intrinsic one such as an armor-type dodge ceiling — the tighter one applies.

### Best-effort floor
An optional user-set minimum on a Target that the solve tries to satisfy before maximizing the rest, but never at the cost of returning no result.

A floor is enforced only after a joint-feasibility check confirms the whole set of floors can hold together; floors that cannot all be met at once are relaxed in reverse-priority order, each relaxed floor recorded as a shortfall. So an unreachable or conflicting floor degrades to a best-effort target rather than making the solve infeasible — the "get as close as you can" contract.

### Gated contribution
The unifying primitive for every stat source: a `(stat, bonus_type, value)` that enters the objective only when all of its enabling binaries hold. A worn affix has one gate (its item is equipped); an augment, set bonus, or Dino insert adds more gates (placement chosen, piece threshold met, slot filled). This is what lets heterogeneous sources share one exact model instead of a code path each.

### Bonus-type bucket
The `(stat, bonus_type)` group in which at most one contributing value counts. Within a bucket only the single highest *selected* value applies; across buckets (different bonus types on the same stat) values sum. This encodes DDO stacking: same-type does not stack (max), different-type does (add).

### Boolean feature
A stat source with no magnitude — a toggle an item either grants or it doesn't (e.g. Ghostly, True Seeing, Freedom of Movement, an immunity, a DR-bypass material). Modeled with **presence semantics**: stored as a gated contribution with `value 1` and `bonus_type: boolean`, so the ordinary highest-of-bucket rule collapses any number of sources to a single 1 — present, never additive. Deliberately not `untyped`: real untyped bonuses stack, boolean features must not. Sourced from a curated exclude-until-verified allowlist (`data/seed/boolean_features.json`), matched against value-less parser lines; targetable like any stat.

### Dominance pre-filter
A per-slot Pareto reduction run before the model is built: a variant beaten by a same-slot peer on **every value-carrying dimension** is dropped, since it can never be uniquely optimal. Soundness has three standing obligations — it holds only while every objective is max-aggregation (a piece-*count* objective breaks it in a multi-pick slot); its comparison surface must stay a **superset** of every dimension the objective reads (a variant whose worth is a dimension the comparator ignores gets wrongly pruned); and every kept item's dominator must be **unconditionally available** to equip. The third breaks when a hard constraint can force a candidate off (an exactly-one-of-a-class, a mutual exclusion, a quota): such a candidate is only *conditionally* available, so it must be exempted from pruning AND barred from pruning the peers it merely dominates — once it is forced off, a peer it dominated may be the true best.

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
A crafted **set-membership** slot: a Dinosaur Bone host with a Set-Bonus slot can be made to "count as part of" one named Dino set (Dread Stalker, Devotion of the Firemouth, …), which activates at a piece threshold. Unlike an intrinsic [[Set bonus]] (membership is baked into the item), here membership is *chosen* per host — and only Armor / Helmet / Cloak hosts carry a Set-Bonus slot (≤3 crafted slots), while one set needs 5 pieces. So completion mixes chosen slots with intrinsic named/raid pieces that also belong to these sets. A Dinosaur Bone host does **not** "awaken" a set (that verb is Vecna's); it slots a crafted **Set Bonus augment**. **Solver-active**, driven by the same general chosen-set-membership primitive as the Vecna "Lost Purpose" awaken (a host joins one set from a pool; the threshold self-seeds from the [[Set bonus]] catalog so it works even when only crafted-membership pieces are equipped). The set definitions come from the same catalog intrinsic members use, so a crafted-membership set gives identical stats to an intrinsically-completed one.

### Blank host
A Dinosaur Bone item whose entire value is the typed Dino slots it exposes — it carries no affixes of its own. Because its worth lives in a non-affix dimension, any code path that reads only affixes (a list view, or a dominance comparison) will treat it as empty and wrongly discard it unless taught to read its slots. Blanks are materialized per worn slot (accessory slots, Armor, Main Hand for a weapon, Rune Arm), deduped so six armor types collapse to one Armor blank; shields/orbs have no Off Hand slot in the solver, so their blanks are disclosed-deferred rather than dropped.

### Nearly Completed slot
An Update 81 upgrade slot that lets an item gain one extra affix chosen from a fixed **category** menu (Ability Score, Insightful Ability, Quality Ability, Healing Amplification, Skill, Spell Focus) — the category fixes the bonus type, the player picks the stat. Modeled as a **choice-slot**: a select-one over the category's option pool, gated by the item being equipped, so the solver picks whichever option best advances the ranked targets. The in-game choice is irreversible, so at most one option per slot ever applies.

### Roll group (choice-slot)
An item affix offering several mutually-exclusive options — "Rolls one of: Strength +13 / Dexterity +13 / Constitution +13". The same select-one choice-slot shape as a [[Nearly Completed slot]], but with the options listed inline rather than drawn from a category pool; the solver picks whichever option best advances the ranked targets. An item's whole stat block can be a single roll group.

### Umbrella stat
An affix that buffs every ability at once — "All Ability Scores +15", "Well Rounded". Expanded into the six concrete ability affixes so a single-ability [[Target]] is credited, since the optimizer matches a target only by exact stat name.

### Viktranium Experiment crafting
The Update 75 (The Chill of Ravenloft) crafting system whose slots the data keys as "Lamordia" — Lamordia is the Ravenloft domain these augments are themed on (the wiki calls them "Lamordia augments"), so the key is the correct augment-type name, not a mislabel; the system's own name is Viktranium. An item carries typed slots (Melancholic / Dolorous / Miserable / Woeful) filled from a documented augment pool keyed by **(slot type × item category)**, at the host's tier (Heroic ML8 / Legendary ML34). The same insert/[[choice-slot|Roll group (choice-slot)]] shape as a [[Dino insert]] / [[Nearly Completed slot]]; modeled by reusing the [[Gated contribution]] primitive with only a `dominates()` guard added (the slot value lives outside the bucket surface). Hosts appear in **two marker formats** the pipeline must both read: the enriched `{{Lamordia Slot|type|category}}` template, and the base seed's human-readable strings ("Lamordia: Melancholic Slot (Accessory)") — the latter flow through the affix parser and would be dropped as noise if not caught, the [[silent value loss|Quarantined]] trap. The "Cataclysmic Weapons and Shields" arm is item-*creation* (a new named weapon), not a choice-slot, so it is sourced as named gear, not modeled here.

### Seal slot
A "Sealed in X" unique enchantment (`Sealed in Fire / Undeath / Gloom / Mist`) that lets an item have its power *unsealed* at a crafting table, gaining **one** effect chosen from a pool keyed to the item's gear category — Fire/Undeath at the Ritual Table, Gloom/Mist at the Augmentation Altar. The wiki is explicit that the pick is mutually exclusive: "adding one effect. Attempting to add another will remove the original." The same select-one [[Nearly Completed slot|choice-slot]] shape, modeled by reusing the [[Gated contribution]] primitive; the solver picks whichever pool option best advances the ranked targets, and never stacks more than one per slot. Sealed in Undeath covers clothing/jewelry with a pool of ability score at +15 / +7 Insightful / +3 Quality. Distinct from the expansion's item-*creation* crafts (Catalyst) and the universal Essence/Cannith system, which are sourced or de-scoped rather than modeled as slots.

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
A DDO item quality — distinct from the **Artifact bonus type** carried by Lunar/Solar Gem augments — of which only one may be equipped at a time. Surfaced as an opt-in: an "Include an Artifact" setup checkbox (default off). Off excludes Artifact-flagged variants from the candidate pool; on requires **exactly one** Artifact in the loadout (the best-scoring one, tagged in the results). Backed by a per-variant `artifact` flag (exclude-until-verified; unflagged variants are treated as non-Artifact). Because "exactly one" is a hard constraint that can force any Artifact off, an Artifact is only *conditionally available*, so the per-slot [[Dominance pre-filter]] must both exempt every Artifact from pruning and bar an Artifact from pruning a non-Artifact peer (its third soundness obligation). The exactly-one constraint is itself emitted only when satisfiable — skipped when no Artifact is placeable (empty data, or the only Artifact's slot locked/pinned away) so the solve stays feasible and discloses that none was included, rather than going infeasible.
