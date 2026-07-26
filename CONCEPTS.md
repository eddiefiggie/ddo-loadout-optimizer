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
A crafted Isle of Dread effect placed into a **typed** slot — Scale, Fang, Claw, or Horn — where an insert fills only a slot of its own type. Bounded by aggregate per-type slot capacity across equipped items, the typed analogue of augment per-color capacity.

### Blank host
A Dinosaur Bone item whose entire value is the typed Dino slots it exposes — it carries no affixes of its own. Because its worth lives in a non-affix dimension, any code path that reads only affixes (a list view, or a dominance comparison) will treat it as empty and wrongly discard it unless taught to read its slots.

### Nearly Complete slot
An Update 81 upgrade slot that lets an item gain one extra affix chosen from a fixed **category** menu (Ability Score, Insightful Ability, Quality Ability, Healing Amplification, Skill, Spell Focus) — the category fixes the bonus type, the player picks the stat. Modeled as a **choice-slot**: a select-one over the category's option pool, gated by the item being equipped, so the solver picks whichever option best advances the ranked targets. The in-game choice is irreversible, so at most one option per slot ever applies.

### Roll group (choice-slot)
An item affix offering several mutually-exclusive options — "Rolls one of: Strength +13 / Dexterity +13 / Constitution +13". The same select-one choice-slot shape as a [[Nearly Complete slot]], but with the options listed inline rather than drawn from a category pool; the solver picks whichever option best advances the ranked targets. An item's whole stat block can be a single roll group.

### Umbrella stat
An affix that buffs every ability at once — "All Ability Scores +15", "Well Rounded". Expanded into the six concrete ability affixes so a single-ability [[Target]] is credited, since the optimizer matches a target only by exact stat name.

## Data trust

### Verified
A variant the solver is allowed to equip. The usual path to this status is contributing at least one solver-eligible affix — a value parsed to an explicit `(stat, bonus_type, value)` from wiki text. A slot-only Blank host is the deliberate exception: it is stamped verified despite having zero affixes, because its worth is its typed slots rather than affixes.

### Quarantined
A record excluded from the solver because it yields no explicitly-parseable value — its wiki text was ambiguous or value-less. Quarantined records stay in the dataset for browsing and coverage disclosure but never contribute to a solve; nothing is ever inferred to rescue one.
