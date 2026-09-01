# Wiki evidence — intrinsic in-game stat caps

**This file holds two sweeps.** §1–§5 are the #199 harvest of 2026-08-28;
§6–§12 are the 2026-09-01 sweep of the miss-chance family, Strikethrough, Jump
and shield bash. The second sweep's table is under its own heading further down —
do not read the first table as the whole roster.

# First sweep — 2026-08-28 (issue #199)

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

Left alone by the #199 pass, deliberately: it was pre-existing, it was honest about
being approximate, and correcting it looked like it meant harvesting Max Dex Bonus per
armor item — a different and much larger harvest. Tracked as #573.

### RESOLVED 2026-08-29 (#573) — the constant is removed, the gap is disclosed

`ARMOR_DODGE_CAP` and its clamp are **gone**. Dodge is no longer capped from gear.

Removal rather than harvest, on three findings:

1. **It contradicted this document.** §4 above refuses a Dodge cap on wiki evidence,
   and the build stamps that refusal as `metadata.intrinsic_stat_caps_refused`. Shipping
   a clamp anyway meant the solver disagreed with our own ruling — and an unsourced
   clamp is the sharpest form of the never-infer failure, because a wrong ceiling is
   invisible in a finished loadout.
2. **The per-item harvest has no cheap path.** gear-planner carries no Max Dex Bonus on
   any armor record. Exactly two variants mention the stat at all — `Sapphire of Armored
   Agility +1/+2` — and both **raise** it. So the "harvest it per item" option is a fresh
   paced ddowiki sweep of ~850 armor variants, not a re-read of existing seed.
3. **The clamp ignored the gear that defeats it.** `Solar Gem of Dodge Cap`
   (Heroic +1 / Legendary +3) and the two Sapphires above are real slottable augments
   carrying rankable stats (`Dodge Cap`, `Max Dex Bonus`, both in `CORE_STATS`). A
   constant keyed on armor category could never read them, so a player could slot a
   Legendary Dodge Cap gem and still be clamped at 4.

**What replaces it:** a disclosure, not a number. `dodgeMaxDexLine` (web/projection.js)
fires whenever an armor type is chosen AND Dodge is ranked AND the player has not set
their own Max, and says plainly that the armor reduction exists, that this solve does
not apply it, and that the Dodge total shown is therefore the un-reduced gear sum. It
rides the export notices bag as well as the results panel, so a shared build cannot
report the total without the caveat.

> **Was false, fixed 2026-09-01 (#668).** For a time the second half of that last
> sentence was not true. `dodgeMaxDexNotice` was built into the projection bag and
> **no exporter rendered it** — every exporter hand-enumerated the notice names it
> printed, and this one (with four others) was never added, so a build shared in
> that window carried the Dodge total and dropped the caveat. #668 replaced the four
> hand-written lists with one `CHARACTER_NOTICES` roster that all four surfaces
> loop, and added the guard that fails when a notice in the bag has no roster row.
> The sentence above is true again. The §4 ruling was never affected; only the
> disclosure's REACH was overstated.

**If someone revisits this:** the honest fix remains a per-item `max_dex_bonus` field
fed by a paced harvest, plus a clamp that reads the equipped armor's real value *and*
adds the player's `Dodge Cap` / `Max Dex Bonus` gear. Do not reintroduce a
category-keyed constant — the wiki wording above rules that granularity out, and
`tests/model.test.js` now asserts both the constant and the model field stay gone.

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

---

# Second sweep — 2026-09-01 (miss-chance family, Strikethrough, Jump, shield bash)

**Harvested:** 2026-09-01, same-origin from a ddowiki tab per `harvest-method.md`.
**Outcome: 2 of 5 confirmed, and both confirmations need a qualifier.**

Prompted by a player report proposing five further ceilings, four of them by
analogy: that Concealment and Incorporeal share Dodge's 95, and that shield bash
chance shares off-hand strike chance's 100. Neither analogy survives. This is the
same failure shape §2 records for Doubleshot — sibling stats, parallel language,
different rules — so it is recorded here at the same weight.

| Stat | Verdict | Fixed cap? | Recorded as |
|---|---|---|---|
| Strikethrough | **CONFIRMED — 400** | yes (effective, not a clamp) | cap |
| Off-hand strike chance | **CONFIRMED — 100** | yes | neither; see §10 |
| Jump | CONFIRMED — 40, but only for jump *height* | soft | neither; see §9 |
| Incorporeal | REFUSED — no numeric cap stated | no | refusal |
| Secondary shield bash chance | REFUSED — no numeric cap stated | no | refusal |

Dodge (§4) and Concealment (§5) were re-read on the same pass and both rulings
stand unchanged.

---

## 6. Strikethrough — CONFIRMED, 400

**Filed as #661** (record the cap).

**Source:** https://ddowiki.com/page/Strikethrough

> If your Strikethrough Chance is 400% or higher, you will always attack a fifth target (if in range). Strikethrough effectively caps at 400%, in that while higher values are possible, they do not provide chances to attack sixth or further targets.

**Read the qualifier before recording this.** It is not a clamp. The page says
higher values "are possible" — they exist, they display, and the game does not
truncate them; what stops at 400 is the *benefit*. That is the same shape as
Doublestrike's cap (§1) and the opposite of Doubleshot's wrapping (§2), so 400
is a correct entry for a table whose semantics are "value above this buys
nothing".

The tiers below it are stated on the same page and are worth keeping in view,
because they are what makes 400 the ceiling rather than an arbitrary number:
over 100% guarantees a second target, over 200% a third, over 300% a fourth,
and 400% a fifth. There is no sixth target to buy.

Strikethrough begins at 20% while considered Two Handed Fighting, and the page
lists feats and enhancements well past 400 in combination (Two Handed Fighting
+60, Improved/Greater/Perfect +30 each, Two Handed Specialty +120, Dance of
Death +50/100/200). So unlike Doublestrike this ceiling is genuinely reachable —
just not from gear. See §11.

## 7. Incorporeal — REFUSED, no numeric cap

**Filed as #662** (record the refusal), with §8.

**Source:** https://ddowiki.com/page/Incorporeal

The page enumerates every player source by magnitude — sections headed 5%, 10%,
15%, 20%, 25%, 50%, plus two stacking bands — and states no ceiling anywhere. It
does state a *reduction*, which is the only number on the page that behaves like
a limit and is not one:

> However, note that Incorporeality and Concealment have decreased effect in Reaper difficulty. This reduction begins with 10% Concealment and 5% Incorporeal bypass at Reaper 1, with a further 5% Concealment and Incorporeal bypass per Skull difficulty.

That is a difficulty-scaled bypass applied to the attacker's side, not a cap on
the stat, and it is keyed to content the player selects rather than to the
character. Recording it as a ceiling would be wrong twice over.

## 8. Secondary shield bash chance — REFUSED, no numeric cap

**Filed as #662** (record the refusal), with §7.

**Source:** https://ddowiki.com/page/Shield_bashing

The page has a whole section headed "Sources of increased secondary shield bash
chance" listing feats, enhancements and items by magnitude, and never states a
ceiling. A full-text wiki search for a shield-bash cap returned nothing.

**Why the silence is evidence here.** The wiki writes these ceilings down where
they exist, and it does so on the *sibling* page: Two Weapon Fighting states the
off-hand cap outright (§10). Shield bashing is the closest analogue to off-hand
striking in the game — a second, automatic attack that procs off your main-hand
swing — and the page that would carry the same sentence does not. Under
exclude-until-verified that is a refusal, not an assumption of symmetry.

Two adjacent facts on the page are easy to misread as a cap and are not:

- "Doublestrike does not affect shield bashing... the shield will never strike
  more than once on a single attack." That is a rule about doublestrike, not a
  ceiling on bash *chance*.
- The Divine Crusader enhancement Bring Down Wrath lets the shield doublestrike
  at half the main-hand rate. That is an added mechanic, not a limit.

## 9. Jump — CONFIRMED at 40, for jump height only

**Filed as #663** (disclose the gap; see also §11).

**Source:** https://ddowiki.com/page/Jump_(skill)

> There is a soft cap on the Jump skill at 40 with regard to jumping height. Any higher number makes no difference in the height that you can jump while not using Sneak.

**Not recorded as an intrinsic cap, because the same page states three ways past
it**, and a flat 40 would be wrong under each:

1. **Fall damage keeps scaling.** "A higher Jump skill decreases the amount of
   damage you take from falling from great heights much like the Tumble skill,
   just at a slightly lower percentage. This reduction is not capped at 40 the
   way that jump height is." So Jump above 40 is dead weight for *height* and
   live for *falling*. A cap keyed to the stat cannot express that.
2. **Sneak moves the target to 60.** "When using Sneak, your Jump (and Tumble)
   skills receive a −20 penalty, so this soft cap becomes an effective 60."
   The page adds that "no Jump bonus will be applied to Sneaking characters until
   the Jump total is +21".
3. **Armor check penalty eats into it.** Jump is an ACP skill
   (https://ddowiki.com/page/Armor_check_penalty), and armor and shield ACP stack.

### RESOLVED 2026-09-01 (#663) — disclosed, not clamped

`jumpSoftCapLine` (web/projection.js) fires when Jump is ranked, the player has set
no Max of their own, and **the solve actually cleared 40**. It names the total
reached, the surplus above 40, and all three escapes above, then points at the one
control that resolves it — a Max of 40 on the Jump priority, which frees those slots
for the next priority.

Three choices worth the record:

- **It fires on the RESULT, not the query.** `dodgeMaxDexLine` fires on the query
  alone, which is right there: the armor reduction exists whatever the total. Here
  nothing is wasted below 40, and a sentence under every Jump solve is the
  boilerplate failure #449 R15 records — a line repeated everywhere stops being read.
- **Classified ACTIONABLE, where the Dodge notice beside it is QUALIFYING.** The two
  look alike and are not. There the number is unknown to us and to the wiki, so the
  player can only be told; here the ceiling is known and a Max of 40 fully resolves
  it. What we cannot decide for them is whether 40 is right for their character.
- **Wired to all four export surfaces**, deliberately not following the precedent
  above — which was broken, and is what surfaced #668. Since that fix, all four
  surfaces loop one roster, so this notice needs no per-surface wiring at all.

### ACP magnitudes, since the buffer argument depends on them

The player report that prompted this sweep cited "up to 6 from armor, 9 from
shield, and 6 from heavy encumbrance". Two of the three are off. Verbatim from
the wiki:

| Source | ACP | Page |
|---|---|---|
| Heavy encumbrance | −6 | Armor check penalty |
| Medium encumbrance | −3 | Armor check penalty |
| Armor, current progression tables | up to −5 (Full Plate line) | Armor by Proficiency |
| Armor, legacy low-level vendor table | up to −7 (Splint Mail, Half-plate) | Armor by Proficiency |
| Tower shield | −10, every variant | Category:Shields |
| Heavy shield | −2 | Category:Shields |
| Light shield | −1 | Category:Shields |
| Buckler | 0 | Category:Shields |

Note the two armor tables disagree by design — the vendor table is flagged on the
page as an older algorithm — so "the armor ACP" is not one number and must not be
recorded as one. Mithral reduces ACP by 3; Nimbleness by 2 or 4.

## 10. Off-hand strike chance — CONFIRMED 100, deliberately not recorded

**Source:** https://ddowiki.com/page/Two_Weapon_Fighting

> There's no benefit of having more than a 100% off-hand strike chance.

Stated outright. The same page restates the off-hand doublestrike rule that §1
already declines to model:

> Off-hand attacks Doublestrike at a rate of 50% of your main-hand weapon (handwraps have no offhand penalty). Perfect Two Weapon Fighting increases this chance to 65%. There's no benefit of having more than 100% doublestrike.

**Confirmed but not recorded, for the §1 reason.** A cap on off-hand strike chance
is a cap that only exists while dual-wielding, which is the Two Weapon Fighting
penalty — an `AGENTS.md` non-goal that is disclosed to the player rather than
modelled numerically. It is written down here so the next reader does not have to
re-harvest it to rediscover that it is out of scope, and so the refusal is not
mistaken for an oversight.

## 11. What binds, measured against the built catalog

Same method as the Doublestrike bound above: sum the best value in each
bonus-type bucket across worn-item affixes, ignoring slot conflicts, so these are
loose upper bounds. The method reproduces this document's existing Doublestrike
figure of 45 exactly, which is the cross-check that it is the same measurement.

| Stat | Gear-only upper bound | Ceiling | Can gear alone reach it? |
|---|---|---|---|
| Strikethrough | 15 (Artifact only) | 400 | No |
| Dodge | 36 (Enh 16, Artifact 10, Insight 7, Quality 3) | 95 | No |
| Shield Bashing | 36 (Enh 25, Insight 11) | none stated | n/a |
| Jump | 46 (Comp 22, Profane 6, Artifact 6, Enh 5, Quality 5, Exc 2) | 40 soft | **Yes** |

Two readings follow.

**Strikethrough behaves exactly like Doublestrike.** The cap is real and cannot
fire from gear; it binds through declared credits, which is the mechanism for a
player asserting the Strikethrough they hold from feats and enhancements — and
unlike Doublestrike, the feat lines alone clear 400 in combination, so this one
will actually be hit by real characters.

**Jump is the outlier in this whole document.** It is the only ceiling harvested
across both sweeps that gear alone can exceed, so it is the only one where a
solve could hand a player points that buy nothing without any declared credit
involved. It is also the one least suited to a cap constant, for the three
reasons in §9. That gap is a disclosure question, not a cap question — resolved
that way by #663; see the block at the end of §9.

## 12. Open discrepancy — a field report the wiki does not predict

**Filed as #664** (needs an in-game test).

Recorded because it is unresolved, and because resolving it by inference is
exactly what this document exists to prevent.

A player reports observing 170% concealment on the character sheet with three
sources active: Shadowdancer's Depths of Darkness (25%), Displacement (50%), and
Feydark Illusionist's Master Illusionist capstone (95%) — an exact sum of the
three.

The Concealment page predicts **120**, not 170. It lists Displacement and Master
Illusionist as *both* enhancement bonuses, rules that "only the greatest
concealment number applies" within a type, and names Depths of Darkness as the
documented exception: "This stacks with your highest enhancement bonus to
concealment." So 95 should suppress the 50, and only the 25 should add.

Three candidate explanations, none of them checkable from the wiki:

1. The character sheet sums sources rather than displaying what is applied.
2. One of the 50/95 sources is not actually enhancement-typed despite the listing.
3. The page is stale with respect to a patch.

**Do not resolve this by picking one** (#664). The distinguishing test is in-game and
cheap: drop Displacement alone and see whether the displayed number falls by 50
or holds at 120. Until someone runs it, the ruling on record is §5 — no numeric
cap — which this observation supports either way, and the stacking question stays
open.
