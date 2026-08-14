# Wiki evidence — Augment Sets (U7 / issue #122)

**Verified:** 2026-08-04 (Chrome-MCP, interactive session — DDO wiki 202-throttles background fetch; DOM reads of rendered pages are free)
**Sources:**
- https://ddowiki.com/page/Augment_Slot/Set_Augment (the 21-row Set Augment table)
- https://ddowiki.com/page/Named_item_sets → "Augment sets" section (mechanic prose + Set name / Augment / Original item / Raid / Set bonus)

## Ruling: "Augment Sets" are a DISTINCT system — NOT filigrees

The prior design note (`docs/plans/2026-08-03-003-feat-augment-sets-design.md`) concluded the 21 `Set Augment: X` entries were **Filigree set names** (Sentient Weapon system). **That identification is WRONG** — it matched names against the Filigrees page and inferred. The names coincide, but the mechanic is entirely different. The DDO wiki gives "Augment sets" their own section on the Named item sets page and their own subpage under Augment Slot.

## The mechanic (verbatim wiki prose, Named_item_sets → "Augment sets")

> "Collect 3 of the same BtC raid loot across your account. Take them to the **Cauldron of Cadence** in the **Hut from Beyond** and combine them with 50 Threads of Fate and an Empty Soul Vessel each, to forge **BtA Colorless Augments**. Then slot them into **3 items across equipment slots of one character** to gain 3 piece Set Bonuses listed below. **Be aware that slotting a Set Augment into an item with any existing sets will suppress those sets while the Set Augment is slotted.** For the list of other Essence Augments see Augment Slot#Essence augments. The first set augments were added with Fables of the Feywild."

### Confirmed facts (no inference)

1. **Crafting device:** the **Cauldron of Cadence**, located in **The Hut from Beyond**. Consumes, per augment, **Threads of Fate ×50 + an Empty Soul Vessel + one specific named ("Original") item**. (This is the "special crafting device" the user described.)
2. **Each Set Augment is a Colorless augment**, ML 30, BtA, category "Named augments".
3. **The set's ONLY piece source is the augment itself.** The "Original item" is *consumed* to make the augment, not worn as a set piece. So **"3 Pieces Equipped" = 3 copies of the same Set Augment** slotted into any standard augment color slots across 3 items on one character (the original "Colorless slots" wording here was the conservative pre-#316 reading — see the 2026-08-14 placement ruling below). (Matches user testimony: "requires using an augment more than once to get its set bonus.") No worn-gear mixing.
4. **Single tier only:** every Set Augment has exactly one threshold — **3 Pieces Equipped** (no 4/5-piece tiers).
5. **Bonus types:** almost all are **Artifact** bonuses (e.g., +3 Artifact bonus to an ability score, +30 Artifact bonus to MRR/PRR, +15 Artifact Melee/Ranged Power). One exception: **Legendary Bulwark = +10% Legendary bonus to Max HP**. Bonus type matters for stacking buckets.
6. **SUPPRESSION RULE (correctness-critical, would never be inferred):** slotting a Set Augment into an item that carries any named set(s) **suppresses those sets** while the augment is slotted. Placing a Set Augment is not free — it can nullify the host item's own set membership/bonuses.
7. **Origin:** first added with Fables of the Feywild; expanded through Update 65.

## The 21 Set Augments (from Augment_Slot/Set_Augment table)

Each row: `Set Augment: <name>` | Colorless | ML 30 | consumes `Thread of Fate x50 + Empty Soul Vessel + <original item>` | `3 Pieces Equipped: <bonus>` | `<raid/quest drop site>`.

| Set Augment | 3-Piece Set Bonus | Original item (consumed) | Drop site |
|---|---|---|---|
| Alluring Elocution | +3 Artifact Charisma | Tattered Scrolls of the Broken One (Bracers) | Too Hot to Handle |
| Arcane Barrier | +30 Magical Resistance Rating Cap | Mantle of Escher (Clothing) | The Curse of Strahd |
| Arcane Guardian | +30 Artifact MRR | Citadel's Gaze (Helm) | Too Hot to Handle |
| Bold Tactician | +3 Artifact Tactical DCs | Page Regalia: Exiled Tactica | Fire Over Morgrave |
| Brutal Blows | +3 Artifact Strength | Mail of the Mroranon (Medium Armor) | Killing Time |
| Cruel Cut | +15% Artifact damage vs Helpless | The Family's Blessing (Necklace) | Project Nemesis |
| Cunning Impact | +3 Artifact Dexterity | Strange Tidings | Defiler of the Just |
| Dusk Raider | +15 Artifact Melee & Ranged Power | Coat of Van Richten | The Curse of Strahd |
| Esoterica | +3 Artifact all Spell DCs | Cloak of the Mountain | Killing Time |
| Imbued Infusion | +3 Artifact bonus Imbue Dice | Kelas' Volatile Mixture | Skeletons in the Closet |
| Legendary Bulwark | +10% Legendary Max Hit Points | The Stablestone | Hunt or Be Hunted |
| Paragon Guard | +15% Artifact Armor Class | Platemail of Strahd | The Curse of Strahd |
| Perfect Silence | +3 Artifact Sneak Attack Dice | Vestments of Ravenloft | Old Baba's Hut |
| Piercing Mind | +3 Artifact Intelligence | Staggershockers | Project Nemesis |
| Quickblade | +15% Artifact Doublestrike & Doubleshot | Guided Sight (Trinket) | Riding the Storm Out |
| Subtle Blade | +3 Artifact Assassinate DCs | Page Regalia: Unsanctioned Arcana | Fire Over Morgrave |
| Touch of Power | +25 Artifact Universal Spell Power | Attunement's Gaze (Goggles) | Project Nemesis |
| Tough Shields | +30 Artifact Physical Resistance Rating | Dumathoin's Bracers | Temple of the Deathwyrm |
| Truthful Blow | +30% Artifact Fortification Bypass | Helm of the Final Watcher | Project Nemesis |
| Visions of the Beyond | +3 Artifact Wisdom | Crystalline Gauntlets | Too Hot to Handle |
| Wild Fortitude | +3 Artifact Constitution | Quori-Infused Core | Legendary Lord of Blades |

## No standalone stats — a copy contributes ONLY a set-piece (verified at item-page level)

Checked individual item pages (the definitive per-augment source), not just the summary tables:
- **Item:Set Augment: Alluring Elocution** — Description: *"Slotting this Augment in any Augment Slot will override its Set Bonus to the Alluring Elocution set."* Enchantments: **Alluring Elocution** (only). `Alluring Elocution: 3 pieces equipped: +3 Artifact bonus to Charisma`. BtA, Colorless, ML 30, max stack 5.
- **Item:Set Augment: Quickblade** — Description: *"…will override its Set Bonus to the Quickblade set. Quickblade: 3 pieces equipped: +15% Artifact bonus to Doublestrike and Doubleshot."*

Both summary tables (Augment_Slot/Set_Augment; Named_item_sets → Augment sets) have **only** a "Set bonus effect" column — no passive/always-on column — for all 21. So:

- **A Set Augment carries NO always-on stat.** Its sole enchantment is the set membership. A slotted copy contributes exactly one set-piece and nothing else.
- **No per-copy stacking concern:** slotting 2 or 3 copies does NOT stack any base stat (there is none to stack). You get **nothing** at 1–2 copies and the **single 3-piece set bonus** (applied once) at 3 copies. (Confirms user's rule: "other stats won't stack on the 2nd/3rd augment — you just get the set bonus on 3." Even stronger: there are no other stats.)
- **"Override" language re-confirms suppression:** slotting the augment *overrides* the host item's Set Bonus with this augment's set — i.e., the host item's own set is suppressed while the Set Augment is slotted.

## Placement ruling (2026-08-14) — any standard color slot; Moon/Sun ruled out

**Verified:** 2026-08-14 (Chrome-MCP, interactive session — DOM reads of the rendered pages)
**Sources:** https://ddowiki.com/page/Augment_Slot (Color types + Set augments + Special augment slots), https://ddowiki.com/page/Lunar_and_Solar_Gems

Supersedes the "Colorless slots" placement reading in confirmed fact 3 and the "Consumes 3 Colorless augment slots" modeling line below — on the placement point only; the three-copies, no-worn-gear-mixing, and suppression facts stand.

1. **Set augments fit any standard color slot.** Augment_Slot → Set augments, verbatim: *"These level 30 Set augments can be slotted in any augment color slot."* The warrant is a verified chain independent of that sentence too: each Set Augment is a **Colorless augment** (fact 2), and the page's Color types table admits Colorless augments into **all seven** slot colors (Colorless, Red, Blue, Yellow, Purple, Orange, Green) — "It's good to mentally add the words '…and Colorless' to the description."
2. **Moon/Sun (Lunar/Solar) slots are ruled OUT, not pending.** The Color types table defines the color system as exactly the seven colors — no Moon/Sun rows. Augment_Slot → Special augment slots lists *"Moon and Sun Augment Slots"* among the special-system slots that *"will not interact with standard colored augments (nor vice versa)"*, and the Lunar_and_Solar_Gems hub shows those slots holding Lunar/Solar Gems only. A Set Augment is a standard-window Colorless augment, so it does not fit Moon/Sun. The solver's seven-color matrix (`SLOT_ACCEPTS` / `fits_slots("Colorless")` in `src/colors.py`) models the rule exactly; the "pending Moon/Sun ruling" deferral raised while planning #316 is resolved by this reading and no follow-up remains open.

## Modeling implications (for the brainstorm/plan — not yet decisions)

- **Solver change:** the model forbids duplicate augment placement (each `variant_id` ≤ 1, `web/solver.js`). Set Augments REQUIRE up to 3 copies of the same augment. Needs a bounded 0..3 placement for this augment class only.
- **Activation is exactly at 3** copies (one tier); fewer than 3 grants nothing. Consumes 3 augment slots of any standard color (per the 2026-08-14 placement ruling above; the solver prefers Colorless on ties) — an opportunity cost against other augments.
- **Suppression:** placing a Set Augment on a set-bearing item suppresses that item's sets — a real trade-off the solver must weigh to stay correct. This is the hard modeling piece.
- The set-bonus values are wiki-sourced above; data would be seeded (exclude-until-verified), mirroring joker/Vecna/Dino.
