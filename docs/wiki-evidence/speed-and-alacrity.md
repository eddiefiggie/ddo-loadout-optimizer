# Wiki evidence — Speed, Melee/Ranged Alacrity, and the Topaz of Swiftness family (U1)

**Verified:** 2026-08-05 (Chrome-MCP, interactive session)
**Plan:** `docs/plans/2026-08-05-002-fix-data-reconciliation-set-visibility-plan.md` (U1)
**Reports:** #134 — "Speed items are not counting towards Melee and Ranged Alacrity. Topaz of Swiftness 15% is missing the Melee Alacrity affix."

## Outcome

The report has two halves and they resolve in opposite directions.

| Half | Verdict |
|---|---|
| "Speed items are not counting towards Melee and Ranged Alacrity" | **CONFIRMED** as a mechanism — but the magnitude is not recoverable from current data |
| "Topaz of Swiftness 15% is missing the Melee Alacrity affix" | **NOT CONFIRMED** — the wiki does not list it as granting Melee Alacrity |

Neither half can be fixed with a sourced value today. No correction was written.

---

## 1. Speed grants attack speed — CONFIRMED mechanism

**Source:** https://ddowiki.com/page/Speed

> Effect: Passive:
> +(5*X)% enhancement bonus to movement speed (max 30%)
> **+X enhancement bonus to melee and ranged attack speed**
> Does not stack with Haste.

So an item with `Speed` **does** contribute to both melee and ranged attack speed. The dataset stores `Speed` as a single affix satisfying neither `Melee Alacrity` nor `Ranged Alacrity` targets, so the reporter's headline complaint is real: rank melee alacrity and a Speed item contributes nothing.

Corroborating, from the same page:

> A similar effect as Speed can be obtained by combining Striding and Melee / Ranged Alacrity.

Speed is effectively an umbrella of movement speed plus melee and ranged attack speed.

### Why it still cannot be fixed

The expansion needs the attack-speed magnitude, and that number is **not stored**. The dataset's `Speed` value is the *movement* percentage: values range 5–30 across 200 item records. The wiki's formula would make attack speed `X` where movement is `5*X`, but the stored values include 7, 8, 9, 11, 12, 14, 16, 17, 18, 19, 21, 22, 23, 26, 27 and 28 — none of which is a multiple of 5, so the `5*X` relation does not describe what gear-planner captured. `X` is therefore not derivable, and inventing it would violate the standing exclude-until-verified rule.

**This is an upstream data-source gap**, not a correction the sanctioned overlay can express: the overlay adds a missing affix with a known value, and here no value is known. Resolving it needs either per-item attack-speed values from the wiki, or a gear-planner import that captures both components of `Speed`.

---

## 2. Topaz of Swiftness 15% — NOT CONFIRMED

**Source:** https://ddowiki.com/page/Melee_Alacrity · https://ddowiki.com/page/Ranged_Alacrity

The Melee Alacrity page groups items by value. `Topaz of Swiftness` appears in exactly two buckets:

| Bucket | Contains |
|---|---|
| Melee Alacrity 5% items | `Topaz of Swiftness 5%` |
| Melee Alacrity 10% items | `Topaz of Swiftness 10%` |
| Melee Alacrity 15% items (19 items) | — **no Topaz entry** |

The Ranged Alacrity page lists no Topaz variant at any value. There is no `Item:Topaz of Swiftness` page, and a site search for the exact phrase returns nothing.

So the wiki does not corroborate that `Topaz of Swiftness 15%` grants Melee Alacrity. The dataset's records match the wiki exactly as they stand:

| Variant | Dataset affixes | Wiki agrees? |
|---|---|---|
| `Topaz of Swiftness 5%` | Speed 30, Melee Alacrity 5 | yes |
| `Topaz of Swiftness 10%` | Speed 30, Melee Alacrity 10 | yes |
| `Topaz of Swiftness 15%` | Speed 30 | yes — no Melee Alacrity listed |

Two readings remain open, and the wiki cannot distinguish them: the category listing may simply be incomplete (DDO wiki item lists are category-generated and lag), or the 15% variant genuinely differs. Either way, **writing `Melee Alacrity 15` would be inference**, and the sanctioned correction overlay exists precisely to hold only spot-validated values.

`Melee Alacrity` itself is confirmed as an **enhancement** bonus:

> Effect: Gain X% enhancement bonus to Melee attack speed. Does not stack with the Haste spell.

which matches the type already stored on the 5% and 10% variants.

---

## Consequence

- **R1 cannot be satisfied.** No correction is written for `Topaz of Swiftness 15%`. Reopening needs an item-level source stating its enchantments, or in-game verification.
- **R2 is answered but not actionable here.** `Speed` and the alacrities are *not* separate unrelated stats — Speed grants both attack speeds — but the magnitude gear-planner captured is the movement component only. This is an import-completeness problem, not an affix-equivalence one, so it does **not** belong in plan 001's equivalence table either: an equivalence would wrongly claim `Speed 30` means 30 melee alacrity.
- The sibling-differencing detector (U2) remains worth building: it correctly flags the Topaz family as an *anomaly worth checking*, which is exactly what it is. A finding is a candidate for confirmation, never an automatic correction — and this family is the case that proves why.
