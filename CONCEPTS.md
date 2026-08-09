# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

Seeded from the solver / gear-source area (the modules the dominance-pruning learning touched). Other areas accrete as later runs process learnings in them.

## Solve model

### Variant
A single candidate the solver may equip in a slot — one item expanded to one specific upgrade tier, with its affixes parsed to structured tuples. The dataset is a list of variants; a tiered item yields several.

### Target
A stat on the user's **ranked** priority list that a solve maximizes. Priority is strict and lexicographic, not weighted — target 1 is maximized first, then target 2 without giving up any of target 1, and so on.

### Rankable affix
An affix name eligible to become a [[Target]] — the set the priority picker offers. It is a strict subset of the affix names the dataset stores, and much smaller: most stored names are variant spellings, bonus-type-qualified forms, or names nothing can actually supply, and offering those would let a player rank something no item scores against. A name can therefore contribute to a solve without being rankable itself, which is why a flattened or mis-modelled affix still corrupts a loadout even when no player could have ranked it directly.

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

### Augment Set
A named set whose **only** piece source is a single Colorless "Set Augment" (crafted at the Cauldron of Cadence), so its one "3 Pieces Equipped" tier is reached by slotting **three copies of the same augment** across three items — the sole place the model permits an augment beyond one placement (every other augment stays ≤1). The augment carries no standalone stats; a copy contributes only a set-piece, so 1–2 copies grant nothing and 3 grant the tier bonus once. Distinct from a [[Dino Set-Bonus]] (a chosen-membership slot on a host that mixes with intrinsic pieces) and emphatically **not** a filigree (Sentient Weapon system) despite name overlap. Slotting a Set Augment **suppresses** the host item's own set while slotted, so placement is a real trade-off, not free.

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

### Integrity gate
A build-time check that validates the incoming upstream snapshot against a frozen, checked-in copy of what was last reviewed, and **fails the build** on any difference rather than absorbing it. Distinct from a test: a test asserts our own behavior, while an integrity gate asserts that the *external* world has not changed underneath us.

Each gate is non-mutating and reports how many references it validated — and that count must mean *validated*, not *iterated over*. A counter incremented before the gate reaches the thing it compares against reports confidence it did not earn, which turns the count itself into the thing that hides the gap. A difference is not presumed wrong — it is presumed *unreviewed*, and the resolution is a human confirming the change and re-freezing the registry in the same commit that handles its consequences. This is why the gates fail loudly instead of warning: a warning about a generated artifact is invisible by the time that artifact reaches the solver.

Because a gate that matches nothing passes silently and looks identical to a clean run, a gate is only trustworthy once it has been observed to **fail** on deliberately corrupted input, and it should refuse to run when it inspects zero records.

Corrupting one field in isolation does not establish that. A gate comparing a value against a stored reference rejects a single-sided break by construction — only one side moved, so of course they disagree. The corruption that actually tests such a gate moves the value **and** its reference together, which is also the shape a bad harvest produces, since both are written from the same wrong source.

### Harvest provenance
The trust label carried by every value sourced directly from the wiki, recording *why* it is or is not usable: **stated** (the wiki asserts it outright), **defaulted** (the wiki displays a number, but its own template filled that number in because nobody recorded a real one), or **unsourced** (the page is silent). Only **stated** is solver-eligible.

The **defaulted** state is the one that earns this concept its slot, and it is not the same as [[Quarantined]]. Quarantining answers "we could not parse a value"; defaulted answers "we parsed a value perfectly well, and it is still not evidence" — a source that renders a fallback is indistinguishable, at the character level, from one that renders a real measurement. Treating a displayed number as a sourced number is how a confident wrong value enters the dataset, which is worse than a visible gap. A defaulted value keeps whatever components *are* sourced and contributes nothing for the rest.

### Rendered-value authority
A wiki effect cell has two layers, and the magnitude often lives in the second one. The **visible cell text** is what a scrape returns — `Speed +30%`. The **rendered tooltip** behind it is what the template actually computed — "+30% enhancement bonus to movement speed, 15% bonus to attack speed". When a template bundles several stats under one enchantment name, the visible text names the enchantment and the tooltip carries the numbers, so reading only the visible layer silently drops every stat that was not spelled out in the cell. Upstream gear-planner scrapes the visible layer, which is one reason its catalog is authoritative for [[Worn affix]] structure but not for bundled magnitudes.

The tooltip is a pure function of the template invocation, not of the item — every page using `{{Speed|30}}` renders the same tooltip — so it snapshots per distinct invocation rather than per record, which is what makes re-checking it affordable against a rate-limited wiki. Store the two layers in separate fields: three augments share `{{Striding|30}}` while their cells differ, so filing cell text under a tooltip key makes one invocation look like several conflicting ones.

It settles magnitude and nothing else: a tooltip renders the template's fallback number just as confidently as a recorded one, so it cannot distinguish **stated** from **defaulted** (see [[Harvest provenance]]). Use it to verify a value we derived, never to promote a value the wiki never recorded.

And it settles even magnitude only while the stored tooltip is **bound to the invocation it is filed under**. A tooltip captured against the wrong invocation still agrees with a value derived from that same capture, so comparing the two proves only that they were produced together — not that either is right. Where an invocation states its own magnitude, assert that separately; a snapshot whose number disagrees with its own key is mis-filed, and nothing else in the chain will notice.

### Enchantment version
One enchantment name carrying two formats whose magnitudes differ — an Arabic form where the number is the bonus, and a Roman form where it is not. DDO introduced these splits when it reworked older enchantments, leaving legacy Roman items in circulation alongside current Arabic ones under the same name. Speed and Parrying both have one.

The consequence is the part that matters: **the stored number cannot tell you which version produced it.** Upstream flattens the Roman numeral to an integer, so a legacy item and a current item can arrive carrying the identical value while granting different amounts — and reading that number as the bonus over-grants on every legacy item. Version is therefore per-item evidence, harvested and recorded with [[Harvest provenance]] like any other wiki-sourced value, never derived from the magnitude. Roman magnitudes resolve through a confirmed per-numeral lookup rather than a formula; the observed mappings are not a uniform ratio, so a numeral nobody has checked is quarantined rather than computed.

## Candidate pool & constraints

### Inventory mode ("What I own")
A candidate-pool option where the solve is restricted to the base items a player owns, imported from a Trove inventory export and matched to the dataset by name. Only **base items** are constrained; augments and each owned item's crafting transformations are still sourced from the full catalog, so the result shows the full build potential achievable with the owned base gear rather than what the player could craft from owned consumables. The alternative pool is all findable game gear (the default, theoretical best-in-slot).

### Slot constraint
A per-session hard constraint the user places on an equipment slot before solving: **pin** it to a specific item, **lock** it empty (excluded from the loadout), or leave it **free** for the solver. The solve honors these exactly and optimizes the remaining free slots around them.

A pin is the standing override for [[Candidacy]]: a rule that narrows which items compete for a slot yields to an explicit pin, so the player can always force an item the tool would otherwise not consider. It does **not** override [[Equippability]] — an item the character cannot wear at all stays unequippable however it is pinned, and such a pin is dropped with a stated reason rather than silently honored. Because a pin can be individually legal yet wrong for the slot it was placed in, pin legality is judged per-slot, not per-item alone.

### Equippability
Whether a character may wear a [[Variant]] **at all** under the current query — the ML band, race and armor proficiency, alignment, the [[Artifact (item type)]] opt-in, and the other character gates, judged one variant at a time without being told which slot it is being considered for.

Equippability is slot-blind by construction, which is what makes it a single shared authority: the solve's candidate filter and the pin UI's warning text read the same answer, so what the tool enforces and what it tells the player cannot drift apart. It may still reason about a variant's own *home* slot — that is a property of the item — but it never learns the slot of inquiry, so it can never express "this item is fine, but not *here*". That is [[Candidacy]]'s job.

### Candidacy
Whether an equippable [[Variant]] competes for one **particular** slot. Narrower than [[Equippability]]: an item can be perfectly equippable and still not be a candidate for a given slot, because a combat style, a feat declaration, or a per-slot allow-list excluded it there.

Candidacy is decided where each slot's candidate pool is assembled, after equippability has filtered the dataset. A pin overrides it (see [[Slot constraint]]); pruning exemptions do not — an item kept through the [[Dominance pre-filter]] for soundness reasons has not thereby been made a candidate anywhere, and treating a pruning exemption as evidence of user intent is a standing hazard.

### Artifact (item type)
A DDO item quality — distinct from the **Artifact bonus type** carried by Lunar/Solar Gem augments — of which only one may be equipped at a time. Surfaced as an opt-in: an "Include an Artifact" setup checkbox (default off). Off excludes Artifact-flagged variants from the candidate pool; on requires **exactly one** Artifact in the loadout (the best-scoring one, tagged in the results). Backed by a per-variant `artifact` flag (exclude-until-verified; unflagged variants are treated as non-Artifact). Because "exactly one" is a hard constraint that can force any Artifact off, an Artifact is only *conditionally available*, so the per-slot [[Dominance pre-filter]] must both exempt every Artifact from pruning and bar an Artifact from pruning a non-Artifact peer (its third soundness obligation). The exactly-one constraint is itself emitted only when satisfiable — skipped when no Artifact is placeable (empty data, or the only Artifact's slot locked/pinned away) so the solve stays feasible and discloses that none was included, rather than going infeasible.

### Hand mutex
A hard equip-legality rule that a two-handed main-hand weapon and any Off Hand item cannot be equipped together — a two-handed weapon occupies both hands. "Both-hands" covers two-handed melee, bows, and an unclassifiable/untyped weapon host; a one-handed main hand leaves the off hand free (a shield, orb, or two-weapon-fighting second weapon). Enforced as a solve-time at-most-one across the both-hands main and off-hand pick options.

Because a user can [[Slot constraint|pin]] both a two-handed main **and** an off-hand — two individually-legal pins that *jointly* violate the rule — the mutex carries the same feasibility escape hatch as the [[Artifact (item type)]] exactly-one: it is emitted only when the conflict is not already pin-forced, so a user who pins both hands gets their (illegal, separately warned) build rather than an empty result. The classifier that decides "occupies both hands" is shared with the [[Dominance pre-filter]], so a two-handed weapon is exempted from pruning a one-handed peer it merely dominates — the same conditional-availability obligation, since the mutex can force the two-handed weapon off.

### Two Weapon Fighting declaration
A character-level assertion that the build fights with a weapon in each hand, declared alongside race and armor rather than inferred from gear choices. It is character state, so changing combat style never clears it, and it travels with a saved or shared character.

The declaration changes [[Candidacy]], not [[Equippability]]: under a style that permits a second weapon it fills the off hand with a one-handed weapon and removes shields, orbs, and rune arms from off-hand candidacy — a pin brings one back. Every other style keeps its own off-hand allow-list unchanged, so the declaration narrows exactly one style and is inert (and says so) elsewhere. The optimizer does not score the feat's combat penalty, so the narrowing is disclosed with the result rather than modeled.
