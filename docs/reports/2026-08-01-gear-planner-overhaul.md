# Gear-planner single-source overhaul — migration report (U1–U9)

_Generated 2026-08-01 from the purge-time dataset. Derived programmatically (base-seed − gear-planner recomputed at purge), not hand-authored._

_Sections **1–7** below are the U7 purge-time manifest (unchanged). Sections **8–13** are the U8/U9 close-out: the native-schema/logic-not-data decision, the accepted-diff summary across U4b→U7.5, the app-smoke result, the final state, and the regression guard. Final dataset: **9045 items**, deterministic build (md5 `e467330c`; the solve-relevant body is unchanged from the U7.5 `b87c5d38` build — the hash moved only because the U9 SOURCE.json close-out stamp is embedded into `metadata.provenance`)._

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

---

## 8. Native schema, at rest — the KTD3 "logic-not-data" decision

The authority's own record persists **near-native**: each item variant keeps gear-planner's `affixes: [{name, type, value}]` block verbatim (`value` a string — `"15"`, `"9%"` for percent), plus native `type`/`ml`/`url`/`quests`/`crafting`/`sets`/`artifact`. There is **no persisted derived/normalized block** — the KTD3-superseded decision was to keep the normalization in **logic, not data**: the load-time normalizer in `web/dataset.js` re-derives numeric value + unit and installs `metadata.stacking_equivalence` into the solver on load, so the disk artifact never carries a second (drift-prone) copy of the derived view. The legacy per-affix `{stat, bonus_type}` aliases and the per-affix `minimum_level`/`unit` aliases were **removed from item affixes entirely** — every consumer reads the native `{name, type, value}` shape (verified: `stat`/`bonus_type`/`unit` appear nowhere in any of the 9045 items' `affixes`; the U8 semantic-invariant guard asserts this). Host choice-slot markers (augment / seal / lamordia / nearly-complete / lost-purpose) are surfaced natively from `crafting[]`.

> Note: the crafting/NC/dino/set/seal **option pools** (`nearly_complete`, `viktranium`, `seal`, `dino_inserts`, `membership_set_defs`, …) legitimately retain the `{stat, bonus_type, value, unit}` shape — that is the native crafting-catalog schema the solver reads for those pools, not a legacy item-affix alias. The invariant is scoped to worn-item affixes.

## 9. Accepted-diff summary (U4b → U7.5)

The single-source outcome landed as four ratified, individually-verified data changes:

**(a) U4b-i — native affix block, +11,380 affixes un-quarantined, ZERO fixture-solve change.** gear-planner variants now build their affixes from the native `affixes` block (verbatim, no remap, no quarantine gate) instead of the remapped/quarantined `structured_affixes`. This un-quarantines **+11,380 affixes** at the data level, yet **all 6 fixtures' `perTarget` and chosen loadouts are identical** to before — the newly-live affixes are non-rankable (Bool presence / null-type / descriptor) and the stacking-equivalence collapse it also installs touches only Armor Class (unranked by any fixture). Same commit fixed a real regression where `union_gearplanner_affix_losses` had been restoring affixes into the now-unused `structured_affixes` block (rerouted to native, tightening the no-double-count guarantee).

**(b) U4b-ii — crafting-rewire corrections, incl. the seal Insight double-count fix.** seal / nearly-complete / viktranium / dino / membership pools now source from the native crafting catalog (`src/crafting_catalog.py`), and the strict seed-parser gate was removed so native multi-affix options flow through. This surfaced a genuine **correctness bug fix**: the six "Sealed in Undeath" ability options were mistyped **Insightful** in the legacy seed; native types them **Insight**. In-game an item's Constitution Insight and the seal's Constitution Insight do **not** stack — the mistyping put them in separate buckets, so the pre-overhaul solver **double-counted** them. Now corrected (the fix is visible live in-app: "Sealed in Undeath: Constitution +7 Insight"). Three of six fixtures move, all lexicographically correct (e.g. tank Con held with PS −1 / Fort −4 — the honest cost of removing the double-count).

**(c) U7 endgame deltas are mostly double-count REMOVAL, not loss.** The endgame fixtures' ability drops (e.g. Constitution 44→37) are, in the main, base-seed **Insightful/Insight double-count removals** on endgame gear — a correctness gain, not lost coverage. Rigorous analysis of all **89** base∩gear-planner collision items found that, of ~100 naively-flagged "missing" affixes, all but one are **false gaps** (gear-planner already carries them under the correct type or a synonym — Protection = AC/Deflection, etc.; restoring them would re-introduce the very double-counts U4b/U7 removed). **Exactly one item — Ophael's Cincture (ML33) — was a genuine gear-planner parser gap** (wiki category tags confirm +15/+7/+3 to all six abilities; gear-planner captured only Deception + Seeker).

**(d) U7.5 — the one sanctioned KTD4 exception: the `gap_corrections` overlay.** `data/seed/gap_corrections.json` restores **only** Ophael's 18 missing ability affixes (6 abilities × Enhancement 15 / Insight 7 / Quality 3), sourced from the retired hand-verified base seed and spot-validated against the live DDO wiki. `build_dataset.py` applies it **additively** with an anti-double-count guard (skips any `(name, type)` the item already carries). Behavioral safety confirmed: the defensive/combat stats (PS/MS/Fort/Deadly/Accuracy) hold **exactly** at the U7-corrected values across all 6 fixtures — no double-count bounced back — and an isolated solve proves Ophael alone yields 25/ability (15+7+3). The U8 invariant guard asserts the six +15 Enhancement abilities remain present.

## 10. App-smoke result (browser end-to-end)

A full browser app-smoke **passed end-to-end**: the app loads clean, the guided wizard runs with correct validation gates, saved characters load, the native picker adds targets, the solver returns **OPTIMAL** (~248 ms), results render native affixes + native crafting (incl. the live "Sealed in Undeath: Constitution +7 Insight" U4b fix), and the Share/CSV/Print tab renders — console clean throughout.

The smoke caught **one bug every node suite missed**: `browse.js` and `results.js` each declared `const itemMl` at top level. As plain browser scripts they share **one** global scope, so the `const` redeclaration is a `SyntaxError` that blocked `browse.js` from loading — but node `require()`s each file in an isolated module scope, so the suites never saw it (a classic browser-vs-node scope gap). **Fix:** `const` → `var` on both (redeclaration-tolerant; each file keeps its own copy so node's module-scoped require still resolves it); cache-bust bumped `?v=33 → 34` across `index.html`.

## 11. Final state

- **Dataset: 9045 items**, deterministic build (`python3 build_dataset.py`, md5 `e467330c`, gear-planner roster 8034).
- **`data/seed/` is gear-planner-only + sanctioned survivors:** the gear-planner raw mirror (`compendium/raw/gearplanner_{items,crafting,sets}.json` + `SOURCE.json`), three generated registries (`compendium/augment_registry.json`, `compendium/crafting_slot_registry.json`, `compendium/vocab_registries.json`), and the curated survivors `compendium/affix_aliases.json`, `compendium/type_stacking_equivalence.json`, and `gap_corrections.json`. No legacy seed files remain (`ddo_items.json` / `augments.json` / `artifacts.json` / `boolean_features.json` / `alignment_restrictions.json` / `joker_sets.json` / `wiki_confirmed.json` are gone; the only source mentions of them are migration comments).
- **No live legacy symbols:** `FLIP_COLLISION_PRECEDENCE`, `union_gearplanner_affix_losses`, `wiki_confirmed`, `src.vocab` (module `vocab.py`), `GEARPLANNER_TYPE_MAP` — zero live references (the sole `src.vocab` textual hit is a "formerly … purged in U7" comment; `src/vocabulary.py` is the live replacement module).

## 12. Regression guard (U8)

- **`tests/parity/golden.json`** — the FORWARD golden fixture: the ratified/accepted post-overhaul solves (per fixture: `perTarget`, `effective`, and the sorted `chosen` slot+variant loadout) for the 6 `fixtures.json` characters, generated on the current build via `node tests/parity/capture_golden.js` (reuses the `capture_baseline.js` machinery — `buildModel` + `solveLexicographic` + `normalizeDataset`).
- **`tests/solver_golden.test.js`** — the guard: reloads the current `web/data/items.json`, re-solves the 6 fixtures, and asserts each fixture's `perTarget` and sorted `chosen` **exactly** equal `golden.json`. Any future change that alters an optimal loadout fails loudly. Deterministic; part of the node suite convention (prints its pass count). To ratify an intentional change, regenerate `golden.json` with the capture script.
- **`tests/test_overhaul_invariants.py`** — three structural invariants over the built dataset: (1) no legacy affix keys at rest (item affixes carry only `name`/`type`/`value` + `eligible`), (2) Ophael's Cincture's six base-ability +15 Enhancement affixes are intact (KTD4 gap-fill), (3) the stacking-equivalence collapse is embedded (`Insight Natural → Insight`, `Primal Natural → Primal`). Behavioral proof of the collapse (max-not-sum) lives in `solver.test.js` U4b-i.
- **`tests/parity/baseline.json`** — the pre-overhaul BEFORE image is **kept unmodified** as the historical record.

## 13. Suite status at close-out

- **Python:** `python3 tests/run_tests.py` → **252 passed, 0 failed** (adds the 3 U8 invariants to the prior 249).
- **Node:** 16 suites, **319 passed** (adds `solver_golden.test.js` = 7 to the prior 15 suites / 312). Per suite: alternatives 12, attribution 9, backup 12, breakdown 3, browse 22, constraints 6, crafting-systems 5, exporters 9, import 14, model 44, persist 11, results 52, solver 86, tabs 8, wizard 19, **solver_golden 7**.

