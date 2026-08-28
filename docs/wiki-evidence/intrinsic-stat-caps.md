# Wiki evidence — intrinsic in-game stat caps (issue #199)

**Harvested:** 2026-08-28, same-origin from a ddowiki tab per `harvest-method.md`.
**Outcome: 1 of 5 confirmed.** Four stats that "obviously" cap do not, and the
wiki says so outright in each case.

## Why this file is mostly refusals, and why that is the result

#199 asked for "Doublestrike, Doubleshot, Dodge, Fortification, and the rest that
have hard ceilings", on the reasonable assumption that most of them cap at 100%.
They do not. Three of the four named stats have no ceiling at all, and one has a
ceiling the player *builds* rather than a constant.

Every one of those four would have been a silently wrong number under a guess,
and a wrong cap is worse than no cap: it truncates a real stat and the loadout
still looks correct. This is the exclude-until-verified rule paying for itself,
so the refusals are recorded here as durably as the confirmation.

| Stat | Verdict | Fixed cap? |
|---|---|---|
| Doublestrike | **CONFIRMED — 100** | yes |
| Doubleshot | REFUSED — no ceiling; it wraps | no |
| Fortification | REFUSED — no ceiling; 300% is a normal build target | no |
| Dodge | REFUSED — the cap is itself player-built | no |
| Concealment | REFUSED — no numeric cap stated | no |

---

## 1. Doublestrike — CONFIRMED, 100

**Source:** https://ddowiki.com/page/Doublestrike

> Doublestrike above 100% has no effect on main-hand weapons.

Stated outright, as a flat ceiling, with no conditions attached to the main-hand
reading. Recorded as an intrinsic cap of **100**.

**Scope of the reading.** The sentence governs the **main hand**. The same page
records a separate off-hand rule — "off-hand doublestrike only doublestrikes half
as often as the main-hand, capped at a maximum of 50% (65% with Perfect Two
Weapon Fighting)" — which this cap deliberately does **not** model. That is the
Two Weapon Fighting penalty, which `AGENTS.md` declines to model numerically as a
standing non-goal; the limit is disclosed to the player instead. A 50 cap keyed on
wielding two weapons would be exactly the modelling this project has refused.

## 2. Doubleshot — REFUSED, no ceiling

**Source:** https://ddowiki.com/page/Doubleshot

> If your Doubleshot is greater than 100%, then a second shot is guaranteed, and the remainder is the chance at additional shots.

and, from the same page's history section:

> Doubleshot can now "wrap" and cause a third or fourth shot if it goes above 100%.

**This is the trap in this whole issue.** Doublestrike and Doubleshot are named as
siblings on each other's pages, they are described in parallel language, and they
behave in *opposite* ways past 100%. Capping Doubleshot at 100 by analogy with its
melee twin would delete every point a ranged build earned above it — and the two
pages sit one click apart, so the analogy is easy to make and never checked.

## 3. Fortification — REFUSED, no ceiling

**Source:** https://ddowiki.com/page/Fortification

> In DDO, most players strive for roughly +10% fortification per level, with the most durable characters achieving +300% at level 30.

100% is not a ceiling here, it is barely a third of the way to a built-out value.
Fortification above 100% is meaningful because monsters and bosses **bypass** a
portion of it, so the excess is what survives the bypass. No cap.

## 4. Dodge — REFUSED, the cap is player-built

**Source:** https://ddowiki.com/page/Dodge_bonus

Dodge has three layers and none of them is a constant this table can carry:

> The Maximum Dodge Bonus begins at 25%. This Maximum Dodge Bonus amount can be increased through various means (see Increasing Maximum Dodge).

So 25 is a **starting value the player raises**, not a ceiling — the page carries a
whole "Increasing maximum dodge" section of class enhancements, feats, monk
stances, guild buffs and items that raise it. Pinning 25 as intrinsic would
truncate every build that invested in raising it.

> If applicable, this Maximum Dodge Bonus may be subject to being capped (reduced) to functioning at a lower limit depending on the lower of Maximum Dexterity Bonus amount found on any armor and tower shields that has been equipped.

That is the armor reduction, and note it is keyed to the **Max Dex Bonus of the
specific equipped armor**, not to the armor category.

> Any combined amount of applicable dodge bonus (from any combination of passive and temporary bonus) that is in excess of 95%, will be capped to a maximum of 95%. This hard cap on Dodge was introduced as of Update 42 Patch 4.

95 is the one true constant, and it is unreachable from gear — so recording it
would add a cap that can never bind. Refused on both counts.

### Standing note on `ARMOR_DODGE_CAP`

`web/model.js` carries `ARMOR_DODGE_CAP = { cloth: 25, light: 25, medium: 11, heavy: 4 }`,
commented "Approximate DDO max-dodge by armor type (configurable; the mechanism is
what matters, not the exact cap)". Against the page above, that is modelling the
**Max Dex Bonus reduction** — the right mechanism, at the wrong granularity, with
unsourced numbers. Max Dex Bonus is a property of the individual armor, not of its
category, so no four-number table can be right for every armor in a category.

Left alone by this pass, deliberately: it is pre-existing, it is honest about being
approximate, and correcting it means harvesting Max Dex Bonus per armor item — a
different and much larger harvest. **Tracked as #573.** Recorded here so the next
reader of that constant finds the wiki rule beside it.

## 5. Concealment — REFUSED, no numeric cap

**Source:** https://ddowiki.com/page/Concealment

The page rules on **stacking**, not on a ceiling:

> Generally, multiple concealment bonuses of the same type do not stack, whether beneficial or offensive in nature, only the greatest concealment number applies.

That rule is already reproduced by the solver's max-within-bucket semantics (see
`boolean-composites.md`, which relies on it for the Blurry / Lesser Displacement
components). No numeric cap is stated anywhere on the page, so none is recorded.

Checked because the #140 U5 work made `Concealment` a credited stat for the first
time, so it was newly worth asking about.

---

## What this means for the feature

**The confirmed cap cannot bind on gear alone.** Measured against the built
catalog, the theoretical maximum Doublestrike from worn items is **45** — the sum
of the best value in each bonus-type bucket (Enhancement 18, Artifact 15, Insight
8, Quality 4), and that is a loose upper bound because it ignores slot conflicts.
A player cannot reach 100 from gear, so a solve with no other input will never see
this cap fire.

It binds through **declared credits**, which is the mechanism for exactly this: a
player asserting the Doublestrike they already hold from enhancements, feats,
epic destinies and past lives — the sources that actually carry a character to
100%. Declared credit plus gear is the state the original report describes:

> "doublestrike might be my highest priority until i hit 100% then its irrelevant"

So the cap is correct to record and correct to apply, and it is honest to say that
it does nothing until the player tells the app what they already have.
