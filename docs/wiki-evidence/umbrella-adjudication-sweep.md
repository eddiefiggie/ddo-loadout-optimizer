# The umbrella detector's first sweep — 30 rulings, 12 new family entries (#211)

**Ruled:** 2026-08-13/14. **Detector:** `src/vocabulary.py` (`umbrella_candidates`
+ `check_umbrella_adjudications`), run at build over the PICKER's universe
(worn rankable names plus every crafting pool's affix names plus the set-def
channels — the review pass on this very PR found `all Saving Throws` (12 set
tiers), `Saving Throws` (48 item-attached set tiers), and `Tactical DCs`
escaping a pools-only universe; all three are now set-channel wordings of the
Resistance/Combat Mastery families, admitted on the catalog's own self-stating
text per the #289 `spell dcs` precedent). **Seed:**
`data/seed/compendium/umbrella_adjudications.json` (atomic rulings only — a
name a mechanism models must not carry an entry). An unadjudicated candidate
fails the build.

## The detector's two signals

1. **Sibling axis (head-word):** any candidate name containing a registered
   expansion family's component head-word as a word (`Focus`, `Absorption`,
   `Save`, `Resistance`, each ability, each skill, ...). ANY word, not just the
   last — `Spell Focus Mastery` ends in `Mastery`, and last-word matching would
   have missed exactly the #205 name the detector exists to catch.
2. **Name-shape complement:** `^All |^Universal |^Elemental |` ` Mastery$` —
   strictly weaker, but the only signal for a family-less umbrella.

A candidate is a REVIEW QUEUE entry, never an auto-expansion (`Universal Spell
Lore` genuinely stacks — the standing spell-lore ruling — so name shape alone
must never collapse anything).

## Nine live umbrellas found and modeled (all via `src/spell_focus.py` `_UNIVERSAL`)

| Name | Components (full magnitude each, same bonus type) | Tooltip (verbatim, `action=parse`) | Scale |
|---|---|---|---|
| `Resistance` | Fortitude/Reflex/Will Save | `Resistance +6: Passive: +6 Resistance bonus to Fortitude, Reflex, and Will Saving Throws.` | **245 affix instances** — the largest umbrella ever found in this dataset (#205's Spell Focus Mastery was 232) |
| `Combat Mastery` | Stunning, Vertigo, Shatter | `Combat Mastery +7: +7 Enhancement bonus to the DC to resist the character's Trip, Improved Trip, Sunder, Improved Sunder, Stunning Blow, and Stunning Fist attempts.` | 136 instances + Viktranium options + an Artifact dino-set bonus |
| `Elemental Resonance` | Corrosion, Combustion, Magnetism, Glaciation | `Elemental Resonance +70: Passive: +70 Equipment bonus to Acid, Fire, Electric and Cold Spell Power.` | 2 (Slave Master's Staff pair) |
| `Charisma Skills` | Bluff, Diplomacy, Haggle, Intimidate, Perform, Use Magic Device | `Charisma Skills - Exceptional Bonus +2: Passive +2 Exceptional bonus to the Charisma based skills of: Bluff, Diplomacy, Haggle, Intimidate, Perform and Use Magic Device (UMD)` | 3 worn + NC menu |
| `Dexterity Skills` | Balance, Hide, Move Silently, Open Lock, Tumble | `... Balance, Hide, Move Silently, Open Lock, and Tumble` | 9 worn + NC menu |
| `Intelligence Skills` | Disable Device, Repair, Search, Spellcraft | `... Disable Device, Repair, Search, and Spellcraft` | 12 worn + NC menu |
| `Constitution Skills` | Concentration | `... Constitution based skills of: Concentration` | NC menu only |
| `Strength Skills` | Jump | `... Strength based skills of: Jump` | NC menu only |
| `Wisdom Skills` | Heal, Listen, Spot | `... Wisdom based skills of: Heal, Listen and Spot` | NC menu only |

The three NC-menu-only families are why the detector's universe is the
picker's, not the worn roster: `Constitution Skills` never appears on an item.

## Knock-on structural fixes the sweep forced

- **The Nearly-Complete category pool took the Viktranium correction** —
  ATOMIC (one record per option, expansion one level IN), because a Skill-menu
  craft grants four-to-six skills together and a flat pool under Σ≤1 would
  deliver one (`src/nearly_complete.py`, `src/container_registry.py`).
- **Declared stat credits migrate through the expanded-away map**
  (`migrateCredits` in `web/dataset.js`, wired into the wizard's
  `cleanCreditMap` and the golden harness): a saved Battle Trance credit
  (`Combat Mastery||Insight`) splits into per-tactic credits at full magnitude
  instead of going silently inert.
- **`Resistance` the label is exempt from the bare-bonus-type guards** (Python
  + JS, both re-ratified — the exemption is PINNED to the literal name, never
  the growing family table, per close-a-defect-at-the-narrow-control): the incident
  doc (`bonus-type-vocabulary-collides-with-bare-stat.md`) itself rules the
  bare-stat reading real, and the parser's `len(words) > 1` guard keeps the
  parse safe. Offering it is deliberate — picking it substitutes the three
  saves.
- **Green Steel exemption with a tripwire:** the GS pool carries skills-umbrella
  options but is unreachable (#194, no hosts). The survives-anywhere guard
  exempts the channel ONLY while `container_registry` declares it unreachable;
  reachability breaks the build and forces the ATOMIC conversion.

## The 30 atomic rulings (evidence in the seed, verbatim per entry)

Absorption channels (each a single-channel grant): Alignment, Chaos, Evil,
Force, Good, Law, Light, Negative Energy, Poison. Narrow saves: Curse
Resistance, Enchantment/Illusion/Spell Save, Fortitude Save Vs Disease (Green
Steel, self-scoping). Single-element resistances: Light, Negative, Poison.
Atomic mechanics: Spell Resistance, Armor Mastery (max dex), Breath Weapon
Focus, Magical Resistance Rating Cap (a cap adjustment, not a bundle). Standing rulings seeded so they are never re-raised: Deific Focus
(conditional ramping buff — never expand), Rune Arm Focus ("isn't directly tied
to a Spell School"). Cross-axis false positives of the any-word signal, each
ruled with its tooltip: Radiance/Repair Intensity + Lore (element crit
stats; lores stack per `spell-lore.md`), Repair Amplification, Strength of
Purpose (Bool proc), and the Woeful Shadows proc sentence (Bool).

## Standing cautions

- The disposition vocabulary is closed at `atomic`. A confirmed umbrella is
  MODELED (registered in `_UNIVERSAL` or a split module), never "pending" —
  the detector exists to make the latent state impossible, not to catalog it.
- A new gear-planner name that trips the detector fails the build until ruled.
  That is the design: every ruling costs one rendered tooltip, and the
  alternative was #205 (232 instances invisible for the feature's lifetime),
  `Resistance` (245), and six skills umbrellas nobody had reported.
