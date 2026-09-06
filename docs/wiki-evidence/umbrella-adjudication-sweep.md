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
| `all Dexterity based Skills` (#694) | same five | the Mechanic set's own wording of the row above — `Named_item_sets`: `+2 Exceptional Bonus to all Dexterity based Skills`; the `Skill` table keys exactly these five to Dexterity | 1 set tier |
| `Intelligence Skills` | Disable Device, Repair, Search, Spellcraft | `... Disable Device, Repair, Search, and Spellcraft` | 12 worn + NC menu |
| `Constitution Skills` | Concentration | `... Constitution based skills of: Concentration` | NC menu only |
| `Strength Skills` | Jump | `... Strength based skills of: Jump` | NC menu only |
| `Wisdom Skills` | Heal, Listen, Spot | `... Wisdom based skills of: Heal, Listen and Spot` | NC menu only |
| `Alluring Skills Bonus` (#718) | Bluff, Diplomacy, Haggle, Intimidate, Perform — **not** Use Magic Device | `Exceptional Alluring Skills Bonus: +8 Exceptional bonus to Bluff, Diplomacy, Haggle, Intimidate, and Perform.` (`Item:Breaking_the_Bank`, 2026-09-04) | 61 worn (Exceptional 30, Quality 18, Insight 13) |
| `Nimble Skills Bonus` (#718) | the SKILLS_DEX five | `Exceptional Nimble Skills Bonus: +7 Exceptional bonus to Balance, Hide, Move Silently, Open Lock and Tumble.` (`Item:Boots_of_Fleet_and_Fortune`) | 28 worn |
| `Astute Skills Bonus` (#718) | Disable Device, Repair, Search — **not** Spellcraft | `Exceptional Astute Skills Bonus: +8 Exceptional bonus to Disable Device, Repair and Search.` (`Item:Epic_Treasure_Hunter's_Spyglass_(level_20)`) | 10 worn |
| `Prudent Skills Bonus` (#718) | the SKILLS_WIS three | `Exceptional Prudent Skills Bonus: +8 Exceptional bonus to Heal, Listen and Spot.` (same carrier) | 7 worn |
| `Good Luck` (#717) | Fortitude/Reflex/Will Save + the 21-skill roster of `all-skills-grants.md` | `Good Luck +2: This item gives a +2 Luck bonus to all saves and skill checks.` (`Item:Ancient_Gemstone`, 2026-09-04) | **68 worn/augment at +1..+5, type Luck** (plus one `Good Luck - Reflex`, ML 1, unrankable, left as-is) — no save or skill had a Luck bucket before this |
| `Mighty Skills Bonus` (#724) | Jump and Swim — **not** the `SKILLS_STR` `["Jump"]` an analogy gives | `Insightful Mighty Skills Bonus: +10 Insight bonus to Jump and Swim.` (`Item:The_Repulsor_Boots`, 2026-09-05; the same carrier also engraves the Quality variant at +5, same two skills) | 2 worn, below the rankability bar |

The five rows dated 2026-09-05 were **not found by the detector**. They came from a
player report ("Good Luck on both skills and saves seems to be missing"; "the
Insightful Alluring Skills bonus from Legendary Katra's Wit does not add to
Intimidate"), and each already had its tooltip on disk from the #713 harvest.
Two of them differ from the ability-keyed umbrella they resemble — `Alluring`
omits UMD, `Astute` omits Spellcraft — which is why each expands to its OWN
tooltip's list and never to the cousin's. `Mighty Skills Bonus` was left atomic at the time
for want of a tooltip, and #724 has since read one — see the row below, and note
that the analogy this rule refused would have been **wrong**. Why the
detector missed them is the next section's last caution.

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
- **A bundle named for the bundle is invisible to both signals (#719).** The
  head-word axis matches a candidate's words against component LAST words
  (`Save`, `Focus`, `Bluff`, `Device`...), and the shape complement is
  `^All |^Universal |^Elemental | Mastery$`. `Good Luck` and `Alluring Skills
  Bonus` share no word with any component and fit no shape, so 68 + 106 rankable
  affix instances sat in the picker's universe unflagged until a player
  reported them (2026-09-05). Do not read a green detector as "no umbrellas
  remain"; it means none of the shapes it knows remain.
- A new gear-planner name that trips the detector fails the build until ruled.
  That is the design: every ruling costs one rendered tooltip, and the
  alternative was #205 (232 instances invisible for the feature's lifetime),
  `Resistance` (245), and six skills umbrellas nobody had reported.

### The Mighty row is the never-infer rule paying for itself

#718 declined to expand `Mighty Skills Bonus` and recorded why: expanding it to
`Strength Skills` by analogy "is the inference the never-infer rule forbids".
That was a judgement call made with no tooltip in hand, and it would have been
easy to read as excessive caution over two records nobody can rank.

The tooltip, read 2026-09-05, settles it: `SKILLS_STR` is `["Jump"]` alone,
because that is what the `{{Skills|Strength|N}}` tooltip states — and Mighty
grants **Jump and Swim**. The analogy would have silently dropped a skill from
two records, in a bucket no test compares against anything, on a name no player
can rank and therefore no player could report.

`tests/test_spell_focus.py` now asserts `SKILLS_MIGHTY != SKILLS_STR` directly,
so a later tidy-up cannot re-merge them on the assumption that two
Strength-flavoured rosters ought to match.

## #719 — the third signal, and what measuring it cost

The two original signals both assume an umbrella **shares a word with its
members**: the sibling axis matches a component's head-word, and the name-shape
complement matches a quantifier prefix (`All `/`Universal `/`Elemental `/
` Mastery`). A bundle named for the **bundle** shares nothing — `Good Luck`'s
words are `Good` and `Luck`, and `Alluring Skills Bonus` ends in the category
word `Skills`, which is never a component's last word. Both were invisible by
construction, and a player found them (#717/#718), which is the outcome the
standing cautions above say this detector exists to prevent.

#719 asked for the widening's queue to be **measured before adopting it**: "if it
flags dozens of genuinely atomic names, the ruling cost may exceed the catch rate
and a narrower phrase set is the answer."

Measured 2026-09-05 against the real build inputs — universe 291, family
components 76, modeled 43, existing queue 36 — by instrumenting `build_dataset.py`
rather than reconstructing them (a first reconstruction disagreed with the
shipped numbers, 20 against 36, and reconstructed inputs are not the population):

| | result |
|---|---|
| new candidates the widening adds | **0** |
| the six motivating names, old signals | **0 of 6 caught** |
| the six motivating names, widened | **6 of 6 caught** |

So the ruling cost the issue was worried about is nil, and the catch is proven on
the names that prompted it. The build's queue is unchanged at 36 after adoption,
which is the same fact from the other direction.

**Two honest limits.** Zero new candidates means it costs nothing *now*, not that
it never will — a refresh introducing a matching name will queue it, and that is
the point of having it. And the back-test is **confirmatory, not predictive**:
these six names are what suggested the phrases, so it demonstrates the signal is
well-formed, not that it will catch the next unknown shape. The next bundle that
names itself something neither `Skills`, `Saves` nor `Luck` is still invisible.
