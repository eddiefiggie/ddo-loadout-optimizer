# No-known-drop-source triage — evidence and tracker

**Verified:** 2026-08-13 (Chrome-MCP, same-origin from a ddowiki tab). **Issue:** #262 (umbrella), #244 (Cataclysmic Buckler instance). **Shard:** `data/seed/compendium/no_drop_source.json`, loaded and guarded by `src/no_drop_source.py`.

**Sources:** per-item `https://ddowiki.com/page/Item:<name>` pages — wikitext via batched same-origin `POST /api.php` (`prop=revisions`, 20 titles per request, ~1.7s pacing), rendered layer via `action=parse` per flag candidate.

## The question

199 worn source items in the roster carry an empty `location_quest` (the gear-planner harvest recorded no quests). Absence of a recorded source is a candidate signal, not a verdict — which of these does the wiki actually record no live source for?

## The classification rule (validated before the bulk pass)

An item page records its acquisition through THREE channels, all checked:

1. **Drop params** — the `{{Named item}}` template's `quest` / `chest` / `location` parameters (the rendered Location section is generated from these; validated on both Spider Queen bracers pages, `Item:Embrace of the Spider Queen`, and `Item:Cataclysmic Buckler` before the bulk pass).
2. **A literal `== Location ==` wikitext section** (legacy page shape; none of the 199 used it exclusively).
3. **Crafting lineage params** — `epic = <base item>` (the page is the epic-crafted version of the base) or `legendary = <epic predecessor>` (the Legendary Crafting upgrade). **Flag-value guard:** the values `no`/`none`/`yes` are template flags, not lineage — `Legendary Great Forge Helm` and `Legendary High Priestess' Focus` carry `epic = no` and were initially misread as sourced.

A `confirmed_no_source` verdict additionally required a **rendered-page check** (`action=parse`, `#mw-content-text`): every flag candidate was verified to render no Location section and no acquisition heading. 124 candidates were rendered-checked in the first pass with zero wikitext-vs-rendered contradictions; the lineage pass then moved 108 of them to `wiki_has_source`, and the flag-value pair was rendered-checked individually.

**The lesson the lineage pass encodes:** a naive empty-Location flag would have mislabeled 108 obtainable items — every classic Epic item (epic-crafted from its base) and every Legendary Crafting upgrade has empty `quest`/`chest` params by design; their acquisition is the lineage, not a drop.

## Result (199 items dispositioned)

| Verdict | Count | Meaning |
|---|---|---|
| `confirmed_no_source` | 19 | wiki records no live source through any channel; flagged in the dataset and disclosed |
| `wiki_has_source` | 179 | wiki records a source our `location_quest` lacks (upstream data gap; backfill tracked separately) |
| unverified (tracker-only) | 1 | `Coronach (historic) [Crafted]` — no wiki page exists under this title (brackets are invalid in MediaWiki titles); never flagged |

## Confirmed no-source items (flagged + disclosed)

| Item | Evidence |
|---|---|
| +1 Starter Heavy Steel Shield | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| +1 Starter Heavy Wooden Shield | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Bracers of the Spider Queen | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Cataclysmic Buckler | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Cataclysmic Large Shield | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Cataclysmic Small Shield | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Cataclysmic Tower Shield | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Coronach (historic) | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Dark Star of the Deep | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Duergarcraft Robe | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Great Forge Helm | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| High Priestess' Focus | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Legendary Bracers of the Spider Queen | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Legendary Dark Star of the Deep | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Legendary Duergarcraft Robe | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Legendary Great Forge Helm | quest/chest params present and empty; the epic param carries the flag value 'no' (not a crafting lineage); rendered page shows no acquisition heading |
| Legendary High Priestess' Focus | quest/chest params present and empty; the epic param carries the flag value 'no' (not a crafting lineage); rendered page shows no acquisition heading |
| Legendary Shards of the Deep | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |
| Shards of the Deep | location channels (quest/chest params) present and empty in wikitext; rendered page shows no Location section; no epic/legendary crafting lineage recorded |

`Cataclysmic Buckler` is the #244 report, verified here; the four Cataclysmic shields were creation-system rewards whose pages record no live acquisition. `Coronach (historic)` is wiki-marked historic. The Spider Queen bracers are the original #262 player report.

## Re-check cadence and staleness

- **Automatic:** `src/no_drop_source.py check()` fails the build when an entry's item gains a non-empty upstream `quests` array — retiring or un-flagging is a manual review event, never automatic (the speed-tooltip-tracker precedent).
- **Manual:** re-run this triage after major DDO updates that revive old content. The work order is resumable: the shard skips entries already dispositioned; only shard-absent universe members need fetching. A wiki page gaining a source shows up as a `check()` failure only after the gear-planner harvest also records it; the wiki-side drift check is re-running the classifier over the 19 confirmed titles (2 batched calls).

## Guards (all proven to fire in tests/test_no_drop_source.py)

Closed verdict vocabulary; roster-reachability (anti-orphan); evidence/URL/date completeness on every confirmed entry; upstream-quests staleness; empty-seed full inertness (byte-identical dataset, the labeled exclude-until-verified exception).

## wiki_has_source rulings (upstream location backfill candidates)

| Item | Recorded source |
|---|---|
| Drow Wizard's Greaves | quest Stealing from Sorcere (optional chest), recorded in the page's quest/chest params |
| Epic Adherent's Pendant | epic-crafted from Adherent's Pendant (the page's epic param records the base item) |
| Epic Azure Necklace of Prophecy | epic-crafted from Azure Necklace of Prophecy (the page's epic param records the base item) |
| Epic Belt of the Mroranon | epic-crafted from Belt of the Mroranon (the page's epic param records the base item) |
| Epic Blademark's Docent | epic-crafted from Blademark's Docent (the page's epic param records the base item) |
| Epic Boots of Corrosion | epic-crafted from Boots of Corrosion (the page's epic param records the base item) |
| Epic Bracers of Deftness | epic-crafted from Bracers of Deftness (the page's epic param records the base item) |
| Epic Bracers of the Demon's Consort | epic-crafted from Bracers of the Demon's Consort (the page's epic param records the base item) |
| Epic Bramble-Casters | epic-crafted from Bramble-Casters (the page's epic param records the base item) |
| Epic Brawn's Spirits | epic-crafted from Brawn's Spirits (the page's epic param records the base item) |
| Epic Chainmail Coif | epic-crafted from Chainmail Coif (the page's epic param records the base item) |
| Epic Charged Gauntlets | epic-crafted from Charged Gauntlets (the page's epic param records the base item) |
| Epic Chimera's Crown | epic-crafted from Chimera's Crown (the page's epic param records the base item) |
| Epic Cloak of the Zephyr | epic-crafted from Cloak of the Zephyr (the page's epic param records the base item) |
| Epic Coronation Shield | epic-crafted from Coronation Shield (the page's epic param records the base item) |
| Epic Crimson Necklace of Prophecy | epic-crafted from Crimson Necklace of Prophecy (the page's epic param records the base item) |
| Epic Darkstorm Helm | epic-crafted from Darkstorm Helm (the page's epic param records the base item) |
| Epic Demon Scale Armor | epic-crafted from Demon Scale Armor (the page's epic param records the base item) |
| Epic Diabolist's Docent | epic-crafted from Diabolist's Docent (the page's epic param records the base item) |
| Epic Diabolist's Robe | epic-crafted from Diabolist's Robe (the page's epic param records the base item) |
| Epic Docent of Grace | epic-crafted from Docent of Grace (the page's epic param records the base item) |
| Epic Dragon's Eye | epic-crafted from Dragon's Eye (the page's epic param records the base item) |
| Epic Dusk Heart | epic-crafted from Dusk Heart (the page's epic param records the base item) |
| Epic Dustless Boots | epic-crafted from Dustless Boots (the page's epic param records the base item) |
| Epic Envenomed Cloak | epic-crafted from Envenomed Cloak (the page's epic param records the base item) |
| Epic Firestorm Greaves | epic-crafted from Firestorm Greaves (the page's epic param records the base item) |
| Epic Frozen Plate | epic-crafted from Frozen Plate (the page's epic param records the base item) |
| Epic Full Plate of the Ringleader | epic-crafted from Full Plate of the Ringleader (the page's epic param records the base item) |
| Epic Gloves of the Falcon | epic-crafted from Gloves of the Falcon (the page's epic param records the base item) |
| Epic Golden Greaves | epic-crafted from Golden Greaves (the page's epic param records the base item) |
| Epic Golden Guile | epic-crafted from Golden Guile (the page's epic param records the base item) |
| Epic Grim's Bracelet | epic-crafted from Grim's Bracelet (the page's epic param records the base item) |
| Epic Helm of the Mroranon | epic-crafted from Helm of the Mroranon (the page's epic param records the base item) |
| Epic Hruvayah's Medallion | epic-crafted from Hruvayah's Medallion (the page's epic param records the base item) |
| Epic Hyena Claw Necklace | epic-crafted from Hyena Claw Necklace (the page's epic param records the base item) |
| Epic Infested Scalemail | epic-crafted from Infested Scalemail (the page's epic param records the base item) |
| Epic Ironweave Robe | epic-crafted from Ironweave Robe (the page's epic param records the base item) |
| Epic Kundarak Delving Boots | epic-crafted from Kundarak Delving Boots (the page's epic param records the base item) |
| Epic Kundarak Delving Goggles | epic-crafted from Kundarak Delving Goggles (the page's epic param records the base item) |
| Epic Kundarak Warding Bracers | epic-crafted from Kundarak Warding Bracers (the page's epic param records the base item) |
| Epic Lion-headed Belt Buckle | epic-crafted from Lion-headed Belt Buckle (the page's epic param records the base item) |
| Epic Marilith Chain | epic-crafted from Marilith Chain (the page's epic param records the base item) |
| Epic Mask of Comedy | epic-crafted from Mask of Comedy (the page's epic param records the base item) |
| Epic Mask of Tragedy | epic-crafted from Mask of Tragedy (the page's epic param records the base item) |
| Epic Mummy Wrappings | epic-crafted from Mummy Wrappings (the page's epic param records the base item) |
| Epic Phiarlan Mirror Cloak | epic-crafted from Phiarlan Mirror Cloak (the page's epic param records the base item) |
| Epic Pouch of Jerky | epic-crafted from Pouch of Jerky (the page's epic param records the base item) |
| Epic Rakshasa Hide | epic-crafted from Rakshasa Hide (the page's epic param records the base item) |
| Epic Ring of Baphomet | epic-crafted from Ring of Baphomet (the page's epic param records the base item) |
| Epic Ring of Elemental Essence | epic-crafted from Ring of Elemental Essence (the page's epic param records the base item) |
| Epic Ring of Spell Storing | epic-crafted from Ring of Spell Storing (the page's epic param records the base item) |
| Epic Robe of Dissonance | epic-crafted from Robe of Dissonance (the page's epic param records the base item) |
| Epic Robe of Fire | epic-crafted from Robe of Fire (the page's epic param records the base item) |
| Epic Ruby Encrusted Gauntlets | epic-crafted from Ruby Encrusted Gauntlets (the page's epic param records the base item) |
| Epic Saltiron Targe | epic-crafted from Saltiron Targe (the page's epic param records the base item) |
| Epic Sandstorm Glasses | epic-crafted from Sandstorm Glasses (the page's epic param records the base item) |
| Epic Scorched Bracers | epic-crafted from Scorched Bracers (the page's epic param records the base item) |
| Epic Seal of the Earth | epic-crafted from Seal of the Earth (the page's epic param records the base item) |
| Epic Shard of Vollun | epic-crafted from Shard of Vollun (the page's epic param records the base item) |
| Epic Shield of the Scorpion | epic-crafted from Shield of the Scorpion (the page's epic param records the base item) |
| Epic Shimmering Pendant | epic-crafted from Shimmering Pendant (the page's epic param records the base item) |
| Epic Shining Crest of St. Markus | epic-crafted from Shining Crest of St. Markus (the page's epic param records the base item) |
| Epic Silken Mail | epic-crafted from Silken Mail (the page's epic param records the base item) |
| Epic Silver Necklace of Prophecy | epic-crafted from Silver Necklace of Prophecy (the page's epic param records the base item) |
| Epic Skull of the Sea | epic-crafted from Skull of the Sea (the page's epic param records the base item) |
| Epic Smash 'n Grabber | epic-crafted from Smash 'n Grabber (the page's epic param records the base item) |
| Epic Snakeskin Belt | epic-crafted from Snakeskin Belt (the page's epic param records the base item) |
| Epic Spectacles of Spirit Sight | epic-crafted from Spectacles of Spirit Sight (the page's epic param records the base item) |
| Epic Spectral Gloves | epic-crafted from Spectral Gloves (the page's epic param records the base item) |
| Epic Spiked Turban | epic-crafted from Spiked Turban (the page's epic param records the base item) |
| Epic Stinkpelt's Hide | epic-crafted from Stinkpelt's Hide (the page's epic param records the base item) |
| Epic Stonemeld Plate Armor | epic-crafted from Stonemeld Plate Armor (the page's epic param records the base item) |
| Epic Templar's Bastion | epic-crafted from Templar's Bastion (the page's epic param records the base item) |
| Epic Templar's Bulwark | epic-crafted from Templar's Bulwark (the page's epic param records the base item) |
| Epic Templar's Docent | epic-crafted from Templar's Docent (the page's epic param records the base item) |
| Epic Torc of Prince Raiyum-de II | epic-crafted from Torc of Prince Raiyum-de II (the page's epic param records the base item) |
| Epic Tourney Armor | epic-crafted from Tourney Armor (the page's epic param records the base item) |
| Epic Utility Vest | epic-crafted from Utility Vest (the page's epic param records the base item) |
| Epic Vambraces of Inner Light | epic-crafted from Vambraces of Inner Light (the page's epic param records the base item) |
| Epic Vulkoorim Fighting Leathers | epic-crafted from Vulkoorim Fighting Leathers (the page's epic param records the base item) |
| Epic Vulkoorim Pendant | epic-crafted from Vulkoorim Pendant (the page's epic param records the base item) |
| Epic Ward of Undeath | epic-crafted from Ward of Undeath (the page's epic param records the base item) |
| Epic Weathered Targe | epic-crafted from Weathered Targe (the page's epic param records the base item) |
| Epic Wind-Swept Buckler | epic-crafted from Wind-Swept Buckler (the page's epic param records the base item) |
| Epic Wolf Whistle | epic-crafted from Wolf Whistle (the page's epic param records the base item) |
| Legendary Azure Necklace of Prophecy | legendary-crafted from Epic Azure Necklace of Prophecy (the page's legendary param records the epic predecessor) |
| Legendary Belt of the Mroranon | legendary-crafted from Epic Belt of the Mroranon (the page's legendary param records the epic predecessor) |
| Legendary Big Top | legendary-crafted from Epic Big Top (the page's legendary param records the epic predecessor) |
| Legendary Blademark's Docent | legendary-crafted from Epic Blademark's Docent (the page's legendary param records the epic predecessor) |
| Legendary Bloodstone | legendary-crafted from Epic Bloodstone (the page's legendary param records the epic predecessor) |
| Legendary Boots of the Mire | legendary-crafted from Epic Boots of the Mire (the page's legendary param records the epic predecessor) |
| Legendary Bracers of Deftness | legendary-crafted from Epic Bracers of Deftness (the page's legendary param records the epic predecessor) |
| Legendary Bracers of the Claw | legendary-crafted from Epic Bracers of the Claw (the page's legendary param records the epic predecessor) |
| Legendary Bracers of the Demon's Consort | legendary-crafted from Epic Bracers of the Demon's Consort (the page's legendary param records the epic predecessor) |
| Legendary Bracers of the Hunter | legendary-crafted from Epic Bracers of the Hunter (the page's legendary param records the epic predecessor) |
| Legendary Bramble-Casters | legendary-crafted from Epic Bramble-Casters (the page's legendary param records the epic predecessor) |
| Legendary Brawn's Spirits | legendary-crafted from Epic Brawn's Spirits (the page's legendary param records the epic predecessor) |
| Legendary Cape of the Roc | legendary-crafted from Epic Cape of the Roc (the page's legendary param records the epic predecessor) |
| Legendary Chainmail Coif | legendary-crafted from Epic Chainmail Coif (the page's legendary param records the epic predecessor) |
| Legendary Chimera's Crown | legendary-crafted from Epic Chimera's Crown (the page's legendary param records the epic predecessor) |
| Legendary Cloak of the Silver Concord | legendary-crafted from Epic Cloak of the Silver Concord (the page's legendary param records the epic predecessor) |
| Legendary Cloak of the Zephyr | legendary-crafted from Epic Cloak of the Zephyr (the page's legendary param records the epic predecessor) |
| Legendary Coronation Shield | legendary-crafted from Epic Coronation Shield (the page's legendary param records the epic predecessor) |
| Legendary Crimson Necklace of Prophecy | legendary-crafted from Epic Crimson Necklace of Prophecy (the page's legendary param records the epic predecessor) |
| Legendary Darkstorm Helm | legendary-crafted from Epic Darkstorm Helm (the page's legendary param records the epic predecessor) |
| Legendary Demon Scale Armor | legendary-crafted from Epic Demon Scale Armor (the page's legendary param records the epic predecessor) |
| Legendary Deneith Heavy Chain | legendary-crafted from Epic Deneith Heavy Chain (the page's legendary param records the epic predecessor) |
| Legendary Docent of Grace | legendary-crafted from Epic Docent of Grace (the page's legendary param records the epic predecessor) |
| Legendary Dragon's Eye | legendary-crafted from Epic Dragon's Eye (the page's legendary param records the epic predecessor) |
| Legendary Drow Wizard's Greaves | quest Stealing from Sorcere (optional chest), recorded in the page's quest/chest params |
| Legendary Dusk Heart | legendary-crafted from Epic Dusk Heart (the page's legendary param records the epic predecessor) |
| Legendary Dustless Boots | legendary-crafted from Epic Dustless Boots (the page's legendary param records the epic predecessor) |
| Legendary Elder's Cap | legendary-crafted from Epic Elder's Cap (the page's legendary param records the epic predecessor) |
| Legendary Elder's Focus | legendary-crafted from Epic Elder's Focus (the page's legendary param records the epic predecessor) |
| Legendary Firestorm Greaves | legendary-crafted from Epic Firestorm Greaves (the page's legendary param records the epic predecessor) |
| Legendary Frozen Plate | legendary-crafted from Epic Frozen Plate (the page's legendary param records the epic predecessor) |
| Legendary Full Plate of the Ringleader | legendary-crafted from Epic Full Plate of the Ringleader (the page's legendary param records the epic predecessor) |
| Legendary Gloves of the Claw | legendary-crafted from Epic Gloves of the Claw (the page's legendary param records the epic predecessor) |
| Legendary Gloves of the Falcon | legendary-crafted from Epic Gloves of the Falcon (the page's legendary param records the epic predecessor) |
| Legendary Goggles of Time-Sensing | legendary-crafted from Epic Goggles of Time-Sensing (the page's legendary param records the epic predecessor) |
| Legendary Golden Greaves | legendary-crafted from Epic Golden Greaves (the page's legendary param records the epic predecessor) |
| Legendary Golden Guile | legendary-crafted from Epic Golden Guile (the page's legendary param records the epic predecessor) |
| Legendary Grim's Bracelet | legendary-crafted from Epic Grim's Bracelet (the page's legendary param records the epic predecessor) |
| Legendary Helm of the Mroranon | legendary-crafted from Epic Helm of the Mroranon (the page's legendary param records the epic predecessor) |
| Legendary Helm of the Red Dragon | legendary-crafted from Epic Helm of the Red Dragon (the page's legendary param records the epic predecessor) |
| Legendary Hruvayah's Medallion | legendary-crafted from Epic Hruvayah's Medallion (the page's legendary param records the epic predecessor) |
| Legendary Hyena Claw Necklace | legendary-crafted from Epic Hyena Claw Necklace (the page's legendary param records the epic predecessor) |
| Legendary Ironweave Robe | legendary-crafted from Epic Ironweave Robe (the page's legendary param records the epic predecessor) |
| Legendary Jidz-Tet'ka | legendary-crafted from Epic Jidz-Tet'ka (the page's legendary param records the epic predecessor) |
| Legendary Kundarak Delving Boots | legendary-crafted from Epic Kundarak Delving Boots (the page's legendary param records the epic predecessor) |
| Legendary Kundarak Delving Goggles | legendary-crafted from Epic Kundarak Delving Goggles (the page's legendary param records the epic predecessor) |
| Legendary Kundarak Warding Bracers | legendary-crafted from Epic Kundarak Warding Bracers (the page's legendary param records the epic predecessor) |
| Legendary Kundarak Warding Shield | legendary-crafted from Epic Kundarak Warding Shield (the page's legendary param records the epic predecessor) |
| Legendary Lion-headed Belt Buckle | legendary-crafted from Epic Lion-headed Belt Buckle (the page's legendary param records the epic predecessor) |
| Legendary Marilith Chain | legendary-crafted from Epic Marilith Chain (the page's legendary param records the epic predecessor) |
| Legendary Mask of Comedy | legendary-crafted from Epic Mask of Comedy (the page's legendary param records the epic predecessor) |
| Legendary Mask of Tragedy | legendary-crafted from Epic Mask of Tragedy (the page's legendary param records the epic predecessor) |
| Legendary Mummy Wrappings | legendary-crafted from Epic Mummy Wrappings (the page's legendary param records the epic predecessor) |
| Legendary Necklace of Venom | legendary-crafted from Epic Necklace of Venom (the page's legendary param records the epic predecessor) |
| Legendary Phiarlan Mirror Cloak | legendary-crafted from Epic Phiarlan Mirror Cloak (the page's legendary param records the epic predecessor) |
| Legendary Pouch of Jerky | legendary-crafted from Epic Pouch of Jerky (the page's legendary param records the epic predecessor) |
| Legendary Raven's Sight | legendary-crafted from Epic Raven's Sight (the page's legendary param records the epic predecessor) |
| Legendary Raven's Talons | legendary-crafted from Epic Raven's Talons (the page's legendary param records the epic predecessor) |
| Legendary Ring of Baphomet | legendary-crafted from Epic Ring of Baphomet (the page's legendary param records the epic predecessor) |
| Legendary Ring of Spell Storing | legendary-crafted from Epic Ring of Spell Storing (the page's legendary param records the epic predecessor) |
| Legendary Ring of Venom | legendary-crafted from Epic Ring of Venom (the page's legendary param records the epic predecessor) |
| Legendary Ring of the Mire | legendary-crafted from Epic Ring of the Mire (the page's legendary param records the epic predecessor) |
| Legendary Ring of the Silver Concord | legendary-crafted from Epic Ring of the Silver Concord (the page's legendary param records the epic predecessor) |
| Legendary Robe of Fire | legendary-crafted from Epic Robe of Fire (the page's legendary param records the epic predecessor) |
| Legendary Ruby Encrusted Gauntlets | legendary-crafted from Epic Ruby Encrusted Gauntlets (the page's legendary param records the epic predecessor) |
| Legendary Sacred Band | legendary-crafted from Epic Sacred Band (the page's legendary param records the epic predecessor) |
| Legendary Sacred Helm | legendary-crafted from Epic Sacred Helm (the page's legendary param records the epic predecessor) |
| Legendary Sandstorm Glasses | legendary-crafted from Epic Sandstorm Glasses (the page's legendary param records the epic predecessor) |
| Legendary Seal of the Earth | legendary-crafted from Epic Seal of the Earth (the page's legendary param records the epic predecessor) |
| Legendary Shaman's Band | legendary-crafted from Epic Shaman's Band (the page's legendary param records the epic predecessor) |
| Legendary Shaman's Beads | legendary-crafted from Epic Shaman's Beads (the page's legendary param records the epic predecessor) |
| Legendary Shard of Vollun | legendary-crafted from Epic Shard of Vollun (the page's legendary param records the epic predecessor) |
| Legendary Shield of the Scorpion | legendary-crafted from Epic Shield of the Scorpion (the page's legendary param records the epic predecessor) |
| Legendary Shimmering Pendant | legendary-crafted from Epic Shimmering Pendant (the page's legendary param records the epic predecessor) |
| Legendary Shining Crest of St. Markus | legendary-crafted from Epic Shining Crest of St. Markus (the page's legendary param records the epic predecessor) |
| Legendary Silken Mail | legendary-crafted from Epic Silken Mail (the page's legendary param records the epic predecessor) |
| Legendary Silver Necklace of Prophecy | legendary-crafted from Epic Silver Necklace of Prophecy (the page's legendary param records the epic predecessor) |
| Legendary Siren's Belt | legendary-crafted from Epic Siren's Belt (the page's legendary param records the epic predecessor) |
| Legendary Siren's Charm | legendary-crafted from Epic Siren's Charm (the page's legendary param records the epic predecessor) |
| Legendary Spectacles of Spirit Sight | legendary-crafted from Epic Spectacles of Spirit Sight (the page's legendary param records the epic predecessor) |
| Legendary Spectral Gloves | legendary-crafted from Epic Spectral Gloves (the page's legendary param records the epic predecessor) |
| Legendary Spiked Turban | legendary-crafted from Epic Spiked Turban (the page's legendary param records the epic predecessor) |
| Legendary Stinkpelt's Hide | legendary-crafted from Epic Stinkpelt's Hide (the page's legendary param records the epic predecessor) |
| Legendary Templar's Bulwark | legendary-crafted from Epic Templar's Bulwark (the page's legendary param records the epic predecessor) |
| Legendary Torc of Prince Raiyum-de II | legendary-crafted from Epic Torc of Prince Raiyum-de II (the page's legendary param records the epic predecessor) |
| Legendary Tourney Armor | legendary-crafted from Epic Tourney Armor (the page's legendary param records the epic predecessor) |
| Legendary Twisted Talisman | legendary-crafted from Epic Twisted Talisman (the page's legendary param records the epic predecessor) |
| Legendary Vambraces of Inner Light | legendary-crafted from Epic Vambraces of Inner Light (the page's legendary param records the epic predecessor) |
| Legendary Vulkoorim Dervish Robe | legendary-crafted from Epic Vulkoorim Dervish Robe (the page's legendary param records the epic predecessor) |
| Legendary Vulkoorim Fighting Leathers | legendary-crafted from Epic Vulkoorim Fighting Leathers (the page's legendary param records the epic predecessor) |
| Legendary Vulkoorim Pendant | legendary-crafted from Epic Vulkoorim Pendant (the page's legendary param records the epic predecessor) |
| Legendary Ward of Undeath | legendary-crafted from Epic Ward of Undeath (the page's legendary param records the epic predecessor) |
| Legendary Weathered Targe | legendary-crafted from Epic Weathered Targe (the page's legendary param records the epic predecessor) |
| Legendary Wolf Whistle | legendary-crafted from Epic Wolf Whistle (the page's legendary param records the epic predecessor) |
