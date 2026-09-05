# Command — a Charisma-skills bonus and a −6 Hide penalty, not a stat (#192)

**Ruled:** 2026-09-04. **Method:** in-app Browser pane, per `harvest-method.md`.
**Shard:** none — the stored magnitude and type are the granted bonus and its
version; the penalty is a constant. **Module:** `src/command_split.py`.
**Guards:** `tests/test_command_split.py`; the build fails if any folded
`Command` survives or the seam touches zero records.

## The question #192 asked

The 2026-08-08 Parrying plan deferred `Command` as a product question because
"penalties may not be representable at all today". #614 made them representable
(a `Penalty` bucket that always stacks and is forced, never max'd), so the only
question left was what the enchantment grants.

## What the wiki states

[Command (enchantment)](https://ddowiki.com/page/Command_(enchantment)):

> Coveted by military leaders of all sorts, it carries a powerful aura that
> grants a +x Competence bonus to Charisma-based skill checks. Command armor and
> command shields make their owners very noticeable, imposing a -6 penalty on
> Hide checks.
>
> Notes: This enchantment provides +x bonus to Bluff, Diplomacy, Haggle,
> Intimidate, Perform, and Use Magic Device and imposes a -6 penalty to Hide.
> Some items have a version of this enchantment that uses an Insight bonus, not
> a Competence bonus.

Rendered tooltips, one per version:

| Item | Tooltip |
|---|---|
| Coin Belt | `Command: Passive: +2 competence bonus on Charisma based skill checks. Command armor and command shields make their owners very noticeable, imposing a -6 penalty on Hide checks.` |
| Citadel's Gaze | `Insightful Command: Passive: +7 Insight bonus on Charisma based skill checks. Command armor and command shields make their owners very noticeable, imposing a -6 penalty on Hide checks.` |

`Template:Command` is deprecated on the wiki in favour of `{{Skills}}`; the
enchantment page and the tooltips are the evidence, not the template.

## What upstream stores, and why no shard is needed

gear-planner stores one affix `Command | <Competence or Insight> | N` on 40
records — 38 items and the two Brightbane Emerald augments (19 Competence, 21
Insight after expansion, counted per record). Unlike Parrying, where a Roman numeral was
a rank and the stored number carried no signal, here the stored magnitude IS
the skill bonus and the stored type IS the version the wiki names. The penalty
is stated once for the whole enchantment and repeated verbatim on every
tooltip. So the expansion needs no per-item evidence: six skill affixes with
the item's own type and magnitude, plus `Hide | Penalty | -6`.

## Ruling

`Command` expands at the planner-record seam into the six Charisma-based skills
(`spell_focus.SKILLS_CHA`, the same roster the `Charisma Skills` umbrella
already uses) at the item's own type and magnitude, plus a `Hide` penalty of
−6 in the `Penalty` bucket. Every minted affix carries the engraved name on
`via` — `Command` or `Insightful Command` — so the card still names the
enchantment. `Command` joins the expanded-away map: the picker redirects a
typed `Command` to the six skills, and a saved build that ranked it migrates.

Six carriers also print an explicit same-skill affix (Coin Belt's Haggle, the
Helms of the Mroranon's Intimidate, Citadel's Gaze's Intimidate, Smoldering
Cudgel's Perform). Both affixes are kept: the solver buckets by (stat, type)
and takes the highest, which is what the game does with two same-type bonuses.

A `Command` affix whose type is neither Competence nor Insight, or whose value
is not a positive integer, is left folded and fails the build by name — the
wiki states two versions and no third is inferred.

## What the player sees

The six skills score from Command items when ranked, and Hide shows the −6 on
any equipped Command item, subtracted from the total as #614 renders every
penalty. No fixture in `tests/parity/fixtures.json` ranks a Charisma skill or
Hide, so the golden does not move.
