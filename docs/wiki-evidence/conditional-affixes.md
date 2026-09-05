# Conditional effects stored as constants — the tooltip harvest and its rulings (#713, #214)

**Harvested:** 2026-09-04, in-app Browser pane, the `parse` variant of the
same-origin loop (`harvest-method.md`, last section). **Shard:**
`data/seed/compendium/affix_tooltip.json`, one verbatim rendered tooltip per
rankable affix name with a numeric item carrier. **Rulings:**
`data/seed/compendium/conditional_adjudications.json`. **Detector and guards:**
`src/affix_tooltip.py`, `tests/test_affix_tooltip.py`.

## Why a harvest, and why one tooltip per name

`docs/plans/2026-09-04-003-conditional-effects-stored-as-constants-design-note.md`
records the decision (Option B with C): there is no local signal that a stored
magnitude is the ceiling of a conditional — the only evidence is the sentence the
wiki renders — and the condition lives in the enchantment template, so one
rendering per name is the evidence for every carrier. The harvest unit is the
name, read from its alphabetically first item carrier's page.

## The population

| population | count |
|---|---|
| rankable names with a numeric, non-Bool, non-expanded item carrier (the roster) | 198 |
| tooltips captured verbatim (`provenance: stated`) | 197 |
| carrier page renders no tooltip under any matching label (`unmatched`) | 1 — `Minor Spell Penetration` (Elfcrafted Chain Armor engraves only its material) |
| rankable names with NO item page to read (augment-, set- or expansion-only), recorded under `_meta.unharvested` with the reason | 25 |
| names the wiki engraves under a different label than gear-planner's stat name, matched on a second pass by label | 9 (`Accuracy` → `Attack Bonus`, `False Life` → `Vitality`, the charge counts → `Action Boost Enhancement` / `Anger` / `Minor Greater Dragonmark Enhancement`, `DR` → `Damage Reduction 5/-`, the two `Enhancement Bonus` halves) |

The roster is COMPUTED by `build_dataset.py` from the records it just built,
never from a hand list, and the build fails on a roster name with neither a
tooltip nor a recorded reason — so a new rankable name cannot ship unharvested.

## The detector

The first draft's markers (`chance to`, `after`, `while`, `vs.`, `against`,
`does not stack`) flagged **49** of 197 names, and 44 were the stat's own
definition: every Lore says "chance to critical hit", every Absorption says
"after resistance", every Alacrity says "does not stack with Haste", Deception
says "qualify as a sneak attack". The shipped markers are STRONG — an on-hit /
on-cast trigger, a stack ceiling, a duration, a cooldown, a standing "while …"
clause — and flag **5**.

## The rulings

| name | markers | stored | tooltip says | ruling |
|---|---|---|---|---|
| Dazing | trigger, ramp, window, cooldown | Enhancement 8 (Buckler of the Demonic Soldier) | `Dazing IV: On Hit: … -1 Penalty to Will Saving Throws for 6 seconds. … stacks up to 5 times. … once every three seconds. Passive: The DC … Stunning Blow and Stunning Fist … increased by 8.` | **constant** — the stored 8 is the passive DC; the on-hit debuff is uncredited |
| Sundering | trigger, ramp, window, cooldown | Enhancement 10 (Giant's Fist) | same shape, Sunder DC `increased by 10` | **constant** |
| Dragon's Edge | trigger | Enhancement 3 (Axe of Savaran) | `Dragon's Edge 3: +9% Enhancement bonus to bypass enemy Fortification. On Crit: 3d8 Bleeding Damage …` | **constant** for the condition; the stored 3 is a RANK, not the 9% — the Parrying trap, tracked separately |
| Improved Deception | standing, window | Enhancement 5 (most carriers) | `… provides a +5 enhancement bonus to Bluff checks. In addition, while using this item your weapons have a chance to envelop the target in darkness …` | **constant** — the stored value is the Bluff bonus; the proc is uncredited |
| Orb Bonus | standing | Orb 4 (Acidic Sphere) | `+4 Orb Bonus: While this orb is equipped and you are actively blocking, you gain a +4 orb bonus to all saving throws, as well as Acid, Cold, Fire, Electric, and Sonic resistances.` | **disclose** — the whole bonus is conditional; the credit stands and the result says "only while the orb is equipped and you are actively blocking" |

Every ruling's `evidence` is the shard tooltip verbatim; the build fails when
the wiki sentence moves, when a candidate is unruled, when a ruling names no
candidate, and when a `quarantine` ruling is not carried out by
`conditional_affix_quarantine.json`. Deific Focus, the case #214 was filed on,
is quarantined there (PR #712) and is what this detector would have caught.

## What the player sees (Option C)

A ranked stat with a `disclose` ruling gets a post-solve line — "Orb Bonus (4
here) is credited at its full value, but the game grants it only while the orb
is equipped and you are actively blocking. The wiki's own words: …" — on the
results card and in every export, quoting the ruling's sentence so the app and
a shared build cannot disagree.

## Follow-ups

- The 25 unharvested names need a second source: the `Lunar_and_Solar_Gems`
  table for the augment-only ones, the set-tier text for the set-only ones. **#715.**
- `Dragon's Edge` stores its rank (3 / 7) where the tooltip states 9%; a
  value-is-a-rank case in the Parrying shape. **#714.**
