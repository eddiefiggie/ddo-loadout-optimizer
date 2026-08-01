# Bug-report audit — user reports vs. the native-schema build

**Date:** 2026-08-01
**Source:** `data/bug_reports.txt` (user reports against the *previous* build)
**Validated against:** the merged gear-planner native-schema build (PR #70, `main` @ `1200d2b`), via data probes on `web/data/items.json` + the picker vocabulary, and real HiGHS solves mimicking the wizard's query.

## Headline

Roughly **10 of the reported problems were fixed or materially improved by the native-schema overhaul** — they were largely the stacking / missing-affix / data-currency class the overhaul targeted. ~8 are confirmed-remaining (several are small vocab/UI items; two are addressed in the accompanying PR). The rest are feature requests.

Two reports that looked like data gaps turned out to be **already-correct behavior** on inspection — flagging them here so they are not "fixed" into regressions.

---

## 1. Fixed / improved by the overhaul (validated)

| # | Report | Evidence |
|---|---|---|
| stacking | Insight/Insightful stack wrong (2 reporters) | `Insightful` is **gone from the dataset** — it was the legacy wiki-parser mistyping. `Insight`/`Insightful` no longer split into two buckets. |
| missing effects | Bone Paws, procs, Relentless Fury, Heroism/Greater Heroism, Legendary Affirmation, Dodge bypass "not coming up" | All now **present** in the data — un-quarantining surfaced +11,380 affixes. |
| SALT-type | effects with no magnitude can't be scored (workaround: default +1) | Now carried as `Bool` presence (value 1) — the "+1" is built in. |
| synonyms | PRR/MRR should map to full names | `PRR`→`Physical Sheltering`, `MRR`→`Magical Sheltering` (curated alias). |
| eligibility | Docent placed on a Halfling / non-forged race | Solved Halfling+Light → *Legendary Azurescale Armor (light)*, **no docent**. No repro. |
| eligibility | picked heavy armor, got a cloth robe | Solved Heavy → *Legendary Downcast Armor (heavy)*. No repro. |
| solver | Kinetic Lore placed 4×, Kinetic Intensity ignored | All four targets satisfied (Impulse 310 / K.Lore 30 / **K.Intensity 41** / Int 36); no redundant Lore. |
| solver | ml36 → level-8 docent, no rings | Now *Legendary Docent of Sunlight (ML33)* + rings + most slots. |
| solver | ml7 build → Chain Shirt lvl 4, **no set** | Now a full loadout **with Vulkoor's Might set**. |
| picker | augment affixes (Greater Heroism) not searchable | Picker now unions the crafting pools; Heroism/Greater Heroism present. |

## 2. Already-correct on inspection (do NOT "fix")

- **False Life vs Vitality** (Ravil's) — Ravil's Book grants **`False Life` (bonus type `Vitality`) +48** natively, so **targeting `False Life` already catches it**. The literal `Vitality`-named affixes (`Chimera's Vitality`, `Pirate Vitality`) are unrelated `Bool` procs. Adding a `Vitality→False Life` alias would be a **false merge** (cf. the `Blood Rage`/`Bloodrage` lesson) and is deliberately *not* done.
- **`Well Rounded`** — not dropped; `umbrella.py` **expands** it into +N to all six abilities (correct DDO behavior). Its effect is fully present; you target the abilities, not the name. Same for `All Ability Scores`.
- **`Druidic Mastery`** — present as **`Druidic Survival Mastery`** (7 items) + `Druidic Stoneshape`. A naming difference, not a gap. No `gap_corrections` needed.

## 3. Confirmed remaining (flagged to investigate/resolve)

| # | Issue | Class / fix |
|---|---|---|
| A | **Missing races** (Eladrin + others) | **Fixed in the accompanying PR** — added Eladrin, Deep Gnome, Shadar-kai, Battleforged (the model already treated `battleforged` as forged but the picker lacked it). |
| B | **Default ML is 34, users expect 36** | **Fixed in the accompanying PR** — default ML → 36. |
| C | **Bool presence effects typeable but not *suggested***  (SALT, Druidic Survival Mastery, Relentless Fury, procs, "build-around rares") | The ~7,900-`Bool` suggestion exclusion. This is the single most-repeated complaint. **Open product decision** — recommend a curated "build-around" allowlist (Bool affixes that appear on a small number of *named* items) shown in suggestions, while still excluding one-off proc descriptions. |
| D | **Low-ML items chosen at high ML / over-prioritizing small bonuses** | Correct given the objective, but wants a **minimum-level filter** (feature, see §4). |
| E | **`Force Spell Crit` / `Sonic Spell Crit`/`Spellpower` naming** | Those exact terms match nothing; effects live under DDO's real names (`Universal Spell Power`, `Sonic Lore`). The **"Biting Sands is the only way"** set-over-prioritization claim could not be reproduced — needs the correct affix name to re-test set weighting. |
| F | **Spell Focus U80 values** | gear-planner is U81-current so likely fine; magnitudes not byte-verified. |
| G | **`Dodge Bypass` picker miss** | Only exists in a pool/set string (`Dodge bypass`), not on items; low value — deferred. |

## 4. Feature requests (not bugs; out of overhaul scope)

Presets (Ranged/Melee/Caster + subsets like TWF/DC Caster) · **min *and* max level** · stat **caps** awareness (doublestrike→100%) · stat **floors** ("300 PRR then maximize") · stat **maximums** · dps/stat-weighting (build awareness) · **expansion-content filter** for the gear pool · manual per-item bonus-type override · **Sun/Moon augment filter** · raid-augment-set awareness.

Note: **"pick items you definitely want" already exists** — the results view has per-slot pin / lock-empty / free via **Adjust & re-solve**; the reporter likely hadn't found it.

## 5. Recommended next steps (priority order)

1. **Bool "build-around" allowlist in suggestions** (§3-C) — resolves the most reports (SALT, Druidic, Relentless Fury, procs) at once.
2. **Minimum-level filter** (§3-D, §4) — resolves the low-ML over-selection reports and is a common request.
3. **Presets** (§4) — the biggest UX ask ("too cumbersome").
4. Re-test the **set-weighting** claim (§3-E) once the correct spell-crit affix name is identified.
