# Target-conditional set bonuses are flagged at the parse seam, never scored (#694)

**Ruled:** 2026-09-04. **Method:** in-app Browser pane reads of
`Named_item_sets` and `Skill`, per `harvest-method.md`. **Shard:** none — the
rule is a parse-seam rule in `src/set_parser.py`, disclosed at build time as
`metadata.target_conditional_set_coverage`. **Guards:**
`tests/test_set_parser.py` (the seam), `tests/test_set_tier_residue_694.py`
(the built channels), `tests/dataset.test.js` (the picker never sees the names).

## What #694 found

Three set-tier names sat in the picker's `known` set as raw prose — a player
who typed them got a priority nothing could score. They arrived as one
population from #675's "parse residue" class and are three different shapes.

| Set (tier) | Wiki text, verbatim | Shape | Ruling |
|---|---|---|---|
| Mechanic (2 pc) | `+2 Exceptional Bonus to all Dexterity based Skills` | umbrella | **expand** to the five Dexterity skills |
| Crypt Raider (3 pc, Legendary ★) | `+5 Artifact Bonus to hit and damage vs. Evil creatures` | compound **and** target-conditional | **flag**, never score |
| Crypt Raider (3 pc, Legendary ★) | `+2 Artifact Bonus to Saves vs. Evil Creatures` | target-conditional | **flag**, never score |

## 1. The umbrella — `all Dexterity based Skills`

[Skill](https://ddowiki.com/page/Skills) keys exactly five skills to Dexterity
in its *List of Skills* table (the same table `all-skills-grants.md` cites as
the wiki's own completeness claim): Balance, Hide, Move Silently, Open Lock,
Tumble. That is the `SKILLS_DEX` roster the `Dexterity Skills` tooltip already
enumerates (`umbrella-adjudication-sweep.md`, row 2). The Mechanic 2-piece is
that umbrella in the set catalog's own wording, and it expands the same way:
one Exceptional +2 across the five, highest-of-type per skill. The spelling
joins `spell_focus.py`'s family table beside `dexterity skills`; tier `raw` stays
verbatim.

## 2 and 3. The conditionals — "vs. Evil creatures"

[Named item sets](https://ddowiki.com/page/Named_item_sets), Crypt Raider
[ML:10/29], 3 Pieces Equipped:

> ★+5 Artifact Bonus to hit and damage vs. Evil creatures
> ★+2 Artifact Bonus to Saves vs. Evil Creatures
> ♦+5★+15 Artifact Bonus to Melee and Ranged Power

The condition is in the sentence: the bonus applies against Evil creatures and
against nothing else. gear-planner stores each as a flat constant with the
condition folded into the stat NAME, so it reached `parsed_set_bonuses` as a
scoring affix under a name no player can rank — and had the compound been
expanded onto `Accuracy` and `Deadly` (the #396 Litany precedent for
"attack bonus and damage"), an always-on +5 would have been credited against
every enemy.

**This is the #88 quarantine class on the set channel.** `conditional_affix_
quarantine.json` exists for "affixes upstream stores as a FLAT CONSTANT that the
wiki states are CONDITIONAL, RAMPING or TEMPORARY"; its entries are
trigger-conditional (Meridian Fragment's ramp). A target condition is the same
class — never unconditionally active — and the same discipline applies:
**quarantine is the conservative direction; the wiki states no unconditional
value, and inventing one violates the never-infer rule.** The item-record
quarantine joins by record name and cannot reach a set tier, so the set channel
gets its rule at the one seam both set channels share, `parse_piece_text`: a
parsed stat matching `vs. <…> creature(s)` is FLAGGED with
`TARGET_CONDITIONAL_REASON` and never emitted. The unconditional clauses on the
same tier (Melee Power, Ranged Power, Imbue Dice) still score.

**The compound is moot once the condition is ruled.** #694 warned that
expanding `hit and damage vs. Evil creatures` without ruling on the condition
turns one unadjudicated name into two. Flagging the clause whole is what keeps
that from happening; no compound rule was added for it.

**Narrowness.** `Damage vs. the Helpless` is "vs." wording too and is a real,
unconditional stat (`helpless-damage.md`) — the pattern requires the word
`creature(s)` at the end, and `tests/test_set_parser.py` pins that the helpless
family is not caught.

## Disclosure

`build_dataset.py` counts what the seam dropped into
`metadata.target_conditional_set_coverage` (`clauses_flagged: 2`, `sets:
["Crypt Raider (Legendary)"]`) and fails the build if a target-conditional stat
is ever emitted by either set channel. A visible gap, never a silent one.

## What would change this ruling

A wiki statement that the Crypt Raider bonuses are unconditional, or a product
decision to model target-conditional bonuses as presence effects the way item
affixes such as `+2 vs Evil` already are (they are stored `Bool`, and score
nothing). The second is a design question, not a data one, and would be its own
issue.
