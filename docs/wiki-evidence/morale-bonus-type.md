# `Morale` as a modelled bonus type — RULING

**Established:** 2026-08-28 (issue #569)
**Question:** Does `Morale` become a bonus type this dataset models, and what does it stack with?
**Sources:** https://ddowiki.com/page/Morale_bonus · https://ddowiki.com/page/Category:Bonus_types · https://ddowiki.com/page/Equipment_bonus

**Ruling: YES — `Morale` is a real DDO bonus type and takes its own stacking
bucket, with NO entry in `type_stacking_equivalence.json`.** The identity
behavior `equivType()` already gives an unmapped type is the correct behavior.

---

## 1. It is a first-class bonus type, not a spell-description word

`Category:Bonus types` — the page `Bonus` points to as "a list of bonus types
available to player characters in DDO" — contains **36 pages**, and
`Morale bonus` is one of them. It sits in the same enumeration as `Enhancement
bonus`, `Insight bonus`, `Quality bonus`, `Profane bonus`, `Determination bonus`
and every other type this dataset already models.

That disposes of the weakest reading of #569 — that "+4 morale" in the Greater
Heroism spell text might be prose rather than a type name. It is a type name.

## 2. Its stacking rule, verbatim

`Morale bonus`, in full:

> A morale bonus represents the effects of greater hope, courage, and
> determination (or hopelessness, cowardice, and despair in the case of a morale
> penalty). Multiple morale bonuses on the same character do not stack. Only the
> highest morale bonus applies. Nonintelligent creatures (creatures with an
> Intelligence of 0 or no Intelligence at all) cannot benefit from morale
> bonuses.

**Same-type competes; the page says nothing about competing with any other
type.** That is the ordinary shape every bonus-type page on this wiki uses —
`Equipment bonus` was read as a control and states the identical rule in the
identical words: "Multiple sources of equipment bonus do not stack, only the
highest bonus applies."

So `Morale` needs no equivalence entry. Under the project's standing bucket rule
(`CONCEPTS.md` → *Bonus-type bucket*), an unmapped type keys its own bucket:
max-within, additive-across. That is exactly what the wiki describes.

**Do not map `Morale` onto `Competence`, `Enhancement`, or anything else.** No
source suggests it, and a wrong collapse silently converts a legitimate sum into
a max — the inverse of the `Natural armor` error `bonus-type-equivalence.md` §1
exists to prevent.

## 3. The over-credit risk #569 raised does not apply here

#569 correctly flagged the shape of the defect in
`a-dated-coverage-claim-cannot-notice-its-own-staleness.md`: a stacking bucket
admitted **without its stacking being examined** credited +24 Universal Spell
Power permanently for a conditional buff.

That defect was about an *unexamined* type carrying an *unconditional-looking
magnitude for a conditional effect*. Neither half is present:

- the stacking rule is examined and quoted above;
- the magnitude in question (`+4 morale`) is passive, permanent and equipped —
  `Greater Heroism`'s passive item form, which the wiki rules on directly
  (`boolean-composites.md` §4). It is not a proc, a stack, or a timed buff.

## 4. The app already treats `Morale` as exactly this — by prior design

`Morale` is **already shipped** in `CREDIT_BONUS_TYPES` (`web/model.js`), the
curated closed vocabulary a declared credit may name. It was put there
deliberately, and the reasoning is recorded in the plan that added it
(`docs/plans/2026-08-08-004-feat-declared-stat-credits-plan.md`):

> Sacred-typed Devotion and Morale-typed gear do not currently exist in the
> catalog. If either is added, the credits that target those buckets become
> displacing rather than additive with no change to this feature.

**That is a prediction of this exact ruling, and it says the credits feature
needs no change.** A player who declares a Morale credit today gets an additive
bucket because nothing competes; the moment Morale-typed gear ships, the same
bucket starts taking a max across the two. That transition is correct, and it is
the behavior the plan named in advance.

`tests/wizard.test.js:1526` and `tests/model.test.js:1507` both assert the
premise "no shipped item carries a Morale-typed affix". **Those assertions are
premise-checks for the additive-credit case, not a prohibition** — when #140
writes a Morale-typed component they will need re-ratifying against the new
premise, deliberately, not blanket-accepted.

## 5. What this obliges when a Morale-typed affix first ships

`data/seed/compendium/bonus_type_dispositions.json` records a disposition for
every type the built dataset produces, and `tests/test_bonus_type_coverage.py`
fails the build on a type with none. `Morale` is absent today because the
dataset produces zero instances — correctly.

**Writing the first Morale-typed affix must add `"Morale": "legitimate"` to that
shard in the same change, or the build goes red.** That is the guard working, not
an obstacle. It belongs to #140's write, not here.

## Scope

Ruling only; no code and no data changes with it. The dataset still produces
zero `Morale` affixes. The `Greater Heroism` write that consumes this ruling is
#140, and its other prerequisite is `all-skills-grants.md` (#570).

## Harvest record

Four paced navigations from a `ddowiki.com` tab on 2026-08-28, read via
`#mw-content-text` per `harvest-method.md`: `Morale_bonus`, `Equipment_bonus`
(control), `Bonus`, `Category:Bonus_types`. `Bonus_types` and `Stacking` were
tried first and **do not exist** — the real page is the category, which `Bonus`
links to. Recorded so the next harvest does not repeat the two dead pages.
