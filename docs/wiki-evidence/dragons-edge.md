# `Dragon's Edge` — the rank, the magnitude, and the bucket — RULING

**Established:** 2026-09-05 (issue #714)
**Guarded by:** `tests/test_dragons_edge_split.py`, `src/dragons_edge_split.py`
**Shard:** `data/seed/compendium/dragons_edge_version.json`

**Ruling: the stored number is a RANK; the granted stat is `Armor-Piercing` at
the percentage the rank's own tooltip states.** The rank→percentage mapping is a
lookup, never a formula.

---

## 1. The stored value is not a magnitude

gear-planner stores `Dragon's Edge | Enhancement | N` on 18 weapon records. The
rendered tooltip states what `N` buys:

| rank | carrier read | tooltip |
|---|---|---|
| 2 | `Item:Burning_Blade_of_Estelar` | `Dragon's Edge 2: +8% Enhancement bonus to bypass enemy Fortification. On Crit: 2d8 Bleeding Damage to those that are vulnerable to it.` |
| 3 | `Item:Axe_of_Savaran` | `… +9% … 3d8 …` |
| 7 | `Item:Legendary_Axe_of_Savaran` | `… +23% … 7d8 …` |

Same shape as `Parrying VIII → 4` (#169) and `Riposte IX → 5 AC / 4 saves`
(#546): a numeral standing in for a magnitude, defensible only by coincidence.

## 2. The mapping fits no formula — and this is the sharpest example yet

`2 → 8`, `3 → 9`, `7 → 23`.

- `rank × 3` gives **21** for rank 7. That is the value #714's body reasonably
  guessed, fitted to the rank-3 point.
- `rank + 6` fits ranks 2 *and* 3, and gives **13** for rank 7.
- The step 2→3 is **+1**; the step 3→7 is **+14**. No line passes through all
  three.

**The trap:** the *bleed* half of the same tooltip scales perfectly (`N d8`). A
reader who checked only the bleed would conclude the enchantment is linear in its
rank and compute the bypass; a reader who checked only ranks 2 and 3 would fit
`rank + 6`. Both are confidently wrong about rank 7.

So the shard is authoritative and `src/dragons_edge_split.py` **refuses** an
unlisted rank rather than computing one — it keeps the folded affix and reports
the gap as a harvest order. `test_the_mapping_is_not_a_formula` asserts the three
points stay non-collinear, so a future "tidy-up" replacing the table with
arithmetic fails rather than silently shipping a number.

## 3. The bucket is `Armor-Piercing`, and the wiki says so itself

The fold is **not** an inference from the tooltip wording. https://ddowiki.com/page/Armor-Piercing
lists this enchantment in its own *"Found on"* section:

> Thunder-Forged crafting: **Dragon's Edge** +35%

Both are stated as an *Enhancement bonus to bypass enemy Fortification*, and the
page's typed sections (`Artifact` / `Insightful` / `Legendary` Armor-Piercing)
match the bonus types the catalog already carries for that stat (Enhancement 120,
Insight 32, Legendary 22, Artifact 3, Quality 2).

**The `+35%` is the Thunder-Forged *crafted* tier**, not one of the item ranks.
It is evidence of classification, not a fourth value to store — recorded here
because it is the kind of number a later reader would otherwise try to reconcile
with the 8/9/23 table.

Since the rewrite emits `Armor-Piercing` at type `Enhancement`, the solver's
bucket-max core enforces the stacking rule with no extra machinery: a carrier
that ever gains a native Enhancement Armor-Piercing competes rather than sums.
No carrier does today (measured: 0 of 18), which is why `dedupe_primary` is a
guard against a future refresh rather than a fix for a present bug.

## 4. What stays uncredited

The `On Crit: Nd8 Bleeding Damage to those that are vulnerable to it` half is a
proc, and procs are not valued (#331). Recorded so a later reader can see it was
read and declined rather than missed.

## 5. What it changed

- 18 records stop carrying a rank and start crediting `Armor-Piercing`
  (7 at +9, 9 at +23, 2 at +8).
- `Dragon's Edge` leaves the rankable set — a name the pipeline rewrites away is
  not offered.
- Ledger: **total unchanged, engraved-eligible −18**, all 18 on weapons. A
  rename moves only the engraved count; an expansion moves both in opposite
  directions. Three ledger shapes now, one per mechanism.
- Goldens byte-identical: no ratified fixture's answer depended on it. Verified
  by running, not reasoned.
