# Gear-planner single-source overhaul — migration report (U7 legacy purge)

_Generated 2026-08-01 from the purge-time dataset. Derived programmatically (base-seed − gear-planner recomputed at purge), not hand-authored._

## Sources — before / after

| | Before (pre-U7) | After (U7) |
|---|---|---|
| Item roster authority | base seed (`ddo_items.json`, hand-verified) **winning** collisions, over gear-planner, over wiki-enriched shards | **gear-planner only** (`gearplanner_items.json`) |
| Crafting pools | native (`gearplanner_crafting.json`) + legacy seed stubs on disk | native only (`gearplanner_crafting.json`) |
| Augment pool | `augments.json` seed (free-text parsed) | native `<Color> Augment Slot` menus in `gearplanner_crafting.json` |
| Artifact / Bool / sets | curated `artifacts.json` + `boolean_features.json` allowlist + base defs | native gear-planner `artifact`/`Bool`/`sets[]` |
| Override channel | `wiki_confirmed.json` stamp | **removed** (KTD4 — no local override) |
| `data/seed/` files | ~40 curated/harvest files | 3 gear-planner raw + SOURCE.json + 3 generated registries + 2 curated survivors (`affix_aliases.json`, `type_stacking_equivalence.json`) |

Provenance snapshot: `illusionistpm/ddo-gear-planner` @ `ec3e595d0d87` (Update 81 — Terror of Demogorgon, level cap 36).

## Native schema (the authority's shape, at rest)

Each item variant persists gear-planner's own record: native `affixes: [{name, type, value}]` (value a string, `"9%"` for percent) plus `type`/`ml`/`url`/`quests`/`crafting`/`sets`/`artifact` verbatim. The load-time normalizer (`web/dataset.js`) re-derives numeric value + unit; the legacy `{stat, bonus_type}` per-affix aliases and the item `minimum_level` alias were removed (all consumers read native). Host choice-slot markers (augment / seal / lamordia / nearly-complete / lost-purpose) are surfaced **natively** from `crafting[]`.

## Roster delta

- Dataset item count: **9002 → 9045** (net +43).
- Parity roster (distinct solver source-items): **8997 → 9045** (43 dropped, 91 added).
- Added ≈ the native augment-pool growth (**902 → 1000** stones, +98); a native stone whose name matched a base augment supersedes it, the rest are net-new.

### The 80 purged base-seed orphans (base-seed names − gear-planner names)

Recomputed at purge: the base seed held 169 items; **80** have no gear-planner catalog entry and are dropped. gear-planner supersedes the other 89 collisions (see the semantic-diff section).

| Class | Count | Disposition |
|---|---|---|
| Augment stones | 49 | incidental base augments; the native `<Color> Augment Slot` pool (1000 stones) is the authority — a same-name stone is superseded, the rest dropped |
| Cannith / essence-crafted bases | 17 | parametric crafted bases (Cannith Crafted / Feycraft / Magecraft), not gear-planner catalog items |
| Filigree annotation-guide rows | 10 | Sentient-weapon filigree guide rows (not equippable items) |
| Named gear | 4 | real named items absent from the gear-planner snapshot |

**Named-gear orphans (enumerated, with reason):**

- **Dino Bone Heavy Crossbow** — category='weapon', ML 31; no gear-planner catalog entry (name absent from gearplanner_items.json)
- **Ring of the Stalker** — category='item', ML 3; no gear-planner catalog entry (name absent from gearplanner_items.json)
- **The Diplomancer** — category='weapon', ML 5; no gear-planner catalog entry (name absent from gearplanner_items.json)
- **The Everstar** — category='item', ML 29; no gear-planner catalog entry (name absent from gearplanner_items.json)

<details><summary>All 80 orphans by class</summary>

**Augment stones (49):**  Art of Sabotage (The Art of Sabotage, Vol. 1), Deconstructor, Diamond of Constitution +12, Diamond of Constitution +14, Diamond of Exceptional Constitution +1, Diamond of Exceptional Intelligence +1, Diamond of Festive Charisma +2, Diamond of Festive Constitution +2, Diamond of Festive Dexterity +2, Diamond of Festive Intelligence +2, Diamond of Heal +17, Diamond of Heal +19, Diamond of Insightful Constitution +5, Diamond of Insightful Intelligence +5, Diamond of Intelligence +3, Diamond of Open Lock and Disable Device +19, Diamond of Repair +19, Diamond of Vitality +20, Draconic Soul Gem, Emerald of Arcane Empowerment, Emerald of Imbue Dice, Globe of True Imperial Blood, Legendary Moment to Legendary Moment, Legendary Undying Sapphire, Lifetaker, Ravil's Recipe (Ravil's Book of Recipes), Ruby of Flame, Ruby of the Vampire Slayer, Sapphire of Armored Agility +2, Sapphire of Crushing Wave Guard, Sapphire of Defense +24, Sapphire of Defense +32, Sapphire of Dodge, Sapphire of False Life, Sapphire of Healing Amplification, Sapphire of Heavy Fortification, Sapphire of Natural Armor +12, Sapphire of Resistance +4, Sapphire of Resistance +5, Sapphire of Spell Agility -15%, Swiftness (Topaz of Swiftness 15%), The Master's Gift, Topaz of Damage +8, Topaz of Deathblock, Topaz of Feather Falling, Topaz of Ranged Power (generic), Topaz of Ranged Power +10, Topaz of Ranged Power +6, Topaz of Vitality

**Cannith / essence-crafted (17):**  Cannith Crafted Belt — Constitution of False Life, Cannith Crafted Boots — Seeker / Parrying, Cannith Crafted Boots — Strength / Feather Falling, Cannith Crafted Bracers — Dodge / Protection, Cannith Crafted Bracers — Protection / Insightful Magical Sheltering, Cannith Crafted Cloak — Intelligence / Fire Absorption, Cannith Crafted Gloves — Tendon Slice / Wizardry, Cannith Crafted Goggles — Deadly / Seeker, Cannith Crafted Goggles — Search / Spot (+Ranged Power), Cannith Crafted Goggles — Spot / Search, Cannith Crafted Heavy Repeating Crossbow, Cannith Crafted Helm — Sheltering / Accuracy, Cannith Crafted Necklace — Natural Armor / Spell Saves, Cannith Crafted Trinket — Intelligence, Cannith Crafted Trinket — Intelligence / Armor-Piercing, Feycraft Fearsome Light Armor, Magecraft Fearsome Docent

**Filigree annotation-guide (10):**  Crackshot Negotiator: Attack and Damage, Crackshot Negotiator: Ranged Power, Crackshot Negotiator: Reflex, Ranged Power (Raid) [guide: 'Raid RP'], Spines of the Manticore: Attack and Damage, Spines of the Manticore: Ranged Power, The Long Shadow: Attack and Damage, The Long Shadow: Ranged Power, Wildhunter: Deception, Wildhunter: Ranged Power

**Named gear (4):**  Dino Bone Heavy Crossbow, Ring of the Stalker, The Diplomancer, The Everstar

</details>

## Accepted gameplay-gate loss (separate from the 80 orphans)

- **Legendary Gem of Many Facets** (`joker_sets.json`) — the wildcard/"joker" set-piece mechanic (rolls one set from each of two pools) is **not** in gear-planner's set model. **Accepted loss: 1 item.** The solver's joker code path remains inert (no data feeds it), like the fail-open alignment gate.
- `alignment_restrictions.json` held **0** real gates (only `_README`/`_example`) and `model.js eligible()` is fail-open → deleting it is **no gameplay loss** and causes no unequippable-recommendation regression.

## Augment-pool delta

- Legacy `augments.json`: **902** stones (free-text `enhancements` parsed).
- Native `<Color> Augment Slot` menus: **1000** stones (one per option; native `{name,type,value}` affix block; color from the slot key). Superset — all 902 legacy names present, +98 net-new. Affix magnitudes/types are identical where spot-checked (e.g. `Constitution +14 Enhancement`, `Fortification +100 Enhancement`).

## Accepted semantic diff — the real behavioral change

**gear-planner now wins the 89 base∩gear-planner collisions that the hand-verified base seed previously won.** The task's framing ("gear-planner wins collisions already, so only the orphans disappear") did not hold for the pre-purge code: the base seed seeded the dedup first and won every collision, with `union_gearplanner_affix_losses` layering wiki affixes on top. Purging it switches those 89 items to gear-planner's (sometimes thinner) affixes — the mandated "gear-planner is the sole authority" outcome, larger than the roster-−80 framing implied.

Example: **Ophael's Cincture** — base seed carried `All Abilities +15`, `Insightful All Abilities +7`, `Quality All Abilities +3`, `Mythic Belt Boost` (hand-added enrichments); gear-planner carries `Deception 12/6`, `Seeker 15` only. The extra ability/mythic affixes are gone (fix path per KTD4 is upstream re-import, not a local override).

### Golden-fixture solve deltas (6 character fixtures)

| Fixture | perTarget before → after |
|---|---|
| `heroic-str-melee` | unchanged |
| `mid-caster` | Wisdom 34→28 |
| `endgame-tank-ml34` | Constitution 44→37; Fortification 292→283; Magical Sheltering 151→133; Physical Sheltering 143→125 |
| `endgame-dex-ml36` | Dexterity 44→37; Physical Sheltering 154→134 |
| `endgame-dps-ml33` | Accuracy 74→50; Deadly 38→30; Seeker 30→28; Strength 44→37 |
| `endgame-caster-ml32` | Charisma 25→29; Wisdom 35→30 |

The `heroic-str-melee` fixture is unchanged (low-level gear is well-covered by gear-planner). The five endgame fixtures lose defensive/ability value: the base seed's hand-enriched endgame gear (extra `All Abilities`/`Mythic Boost`/union-restored affixes) is no longer available, so the solver's optimum drops to what gear-planner alone supplies. This is expected and ratified as the cost of single-source authority — the same items are still equipped where they win; they simply carry gear-planner's affix set. `tests/parity/baseline.json` was left unmodified.

### Native host-marker surfacing (fuller coverage, additive)

Extracting lamordia / nearly-complete / lost-purpose markers natively from gear-planner `crafting[]` (rather than grafting from the deleted wiki shards) is a superset — every previously-active host is preserved and more are activated: lamordia hosts 108→350, nearly-complete 70→140, lost-purpose 44 (unchanged). Seal hosts (9 Undeath) unchanged. This is the plan's intended native host-marker surfacing (fuller = correct under single-source authority).

