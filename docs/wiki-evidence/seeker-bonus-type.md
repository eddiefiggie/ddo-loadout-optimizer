# Seeker — the bonus type is the template's third parameter (#392) — SUPERSEDED for `exc`, see the 2026-09-04 re-ruling at the end

**Ruled:** 2026-08-19. **Re-ruled:** 2026-09-04 (#697) — the `exc` rows below
are corrected to Insight; the Insight and Enhancement rows stand. **Method:** same-origin harvest per `harvest-method.md`;
invocation lines via `action=query&prop=revisions` (POST, paced), 33 titles in
four batches. **Shard:** none — no data change was required. **Guard:**
`tests/test_seeker_bonus_type.py`.

## The ruling

`{{Seeker|N|<type>}}` states the bonus type as its **third positional
parameter**, in the same shape as `{{Elemental Resistance|elemental|10|insight}}`
(`elemental-resistance.md`). Observed spellings, case-insensitive:

| Third parameter | Bonus type |
| --- | --- |
| `exc`, `Exceptional` | Exceptional |
| `ins`, `Insight`, `Insightful` | Insight |
| *absent* | Enhancement |

`Insight` and `Insightful` are the same type in two spellings; the optimizer
records both as `Insight`. The absent-parameter default is confirmed, not
assumed — `Burrowing Claws` carries both `{{Seeker|6}}` and
`{{Seeker|2|Insightful}}` on one page, and the dataset stores them as
`Enhancement 6` and `Insight 2` respectively.

## What was contested

The 2026-08-18 gear-planner refresh (#374, PR #382) re-typed **18 `Seeker`
affixes from `Insight` to `Exceptional`** and left 32 others as `Insight`.
Because bonus type is the stacking key, an Exceptional source now adds to an
Insight one where the two previously took a max — `endgame-dps-ml33` gained
**+5** on its `Seeker` target
(`docs/reports/2026-08-18-gear-planner-canon-migration.md` §12a, cause C).

The question was whether to absorb upstream's new typing or defend the prior
one with `affix_type_corrections.json` entries.

**Upstream is correct on all 18. Our pre-refresh `Insight` was wrong, and the
refresh fixed a latent bug.** No corrections were added. The re-type is not a
vocabulary flip — upstream kept both types in the same catalog, and in three
cases split them *within one item family*, which is exactly what the wiki does.

## The 18 Exceptional carriers — verified individually

Every row's invocation was read from its own page. No row is inferred from a
sibling.

| Item | Wiki invocation | Dataset |
| --- | --- | --- |
| Bracers of Twisting Shade (level 18) | `{{seeker\|3\|exc}}` | Exceptional 3 |
| Bracers of Twisting Shade (level 23) | `{{seeker\|4\|exc}}` | Exceptional 4 |
| Bracers of Twisting Shade (level 24) | `{{seeker\|4\|exc}}` | Exceptional 4 |
| Bracers of Twisting Shade (level 25) | `{{seeker\|5\|exc}}` | Exceptional 5 |
| Steady Handed Armbands (level 23) | `{{Seeker\|3\|Exceptional}}` | Exceptional 3 |
| Steady Handed Armbands (level 24) | `{{Seeker\|4\|Exceptional}}` | Exceptional 4 |
| Steady Handed Armbands (level 25) | `{{Seeker\|5\|Exceptional}}` | Exceptional 5 |
| Souvenir Coin | `{{Seeker\|3\|Exceptional}}` | Exceptional 3 |
| Golden Souvenir Coin | `{{Seeker\|3\|Exceptional}}` | Exceptional 3 |
| Legendary Souvenir Coin | `{{Seeker\|5\|Exceptional}}` | Exceptional 5 |
| Legendary Golden Souvenir Coin | `{{Seeker\|5\|Exceptional}}` | Exceptional 5 |
| Helm of the Warblade | `{{Seeker\|3\|Exceptional}}` | Exceptional 3 |
| Legendary Helm of the Warblade | `{{Seeker\|5\|Exceptional}}` | Exceptional 5 |
| Iron Cloak of the Wolf | `{{Seeker\|3\|exc}}` | Exceptional 3 |
| Mithral Cloak of the Wolf | `{{Seeker\|4\|exc}}` | Exceptional 4 |
| Adamantine Cloak of the Wolf | `{{Seeker\|5\|exc}}` | Exceptional 5 |
| Slice | `{{Seeker\|3\|exc}}` | Exceptional 3 |
| Horseshoe Crab Shield (level 26) | `{{Seeker\|5\|exc}}` | Exceptional 5 |

Magnitudes match the dataset on all 18. The refresh moved the type only.

## Control set — Insight carriers that did NOT move

Sampled to prove the re-type is discriminating rather than a blanket rewrite.

| Item | Wiki invocation | Dataset |
| --- | --- | --- |
| Bracers of Twisting Shade (level 16) | `{{Seeker\|2\|ins}}` | Insight 2 |
| Horseshoe Crab Shield (level 7) | `{{Seeker\|2\|ins}}` | Insight 2 |
| Vambrace of the Summer Court | `{{Seeker\|1\|Insightful}}` | Insight 1 |
| Bold Trinket | `{{Seeker\|2\|Insightful}}` | Insight 2 |
| Dread Stalker's Cloak | `{{Seeker\|2\|Insightful}}` | Insight 2 |
| Tinker's Gloves | `{{Seeker\|2\|Insightful}}` | Insight 2 |
| Cloak of Balance | `{{Seeker\|3\|Insight}}` | Insight 3 |
| Periapt of Dexterity | `{{Seeker\|3\|Insightful}}` | Insight 3 |
| Sunken Chains | `{{Seeker\|3\|Insightful}}` | Insight 3 |
| Epic Slice | `{{Seeker\|6\|Insight}}` | Insight 6 |
| Burrowing Claws | `{{Seeker\|6}}` + `{{Seeker\|2\|Insightful}}` | Enhancement 6 + Insight 2 |

**The within-family splits are real.** Three item families carry both types at
different levels, and the wiki says so per level:

- `Bracers of Twisting Shade` — `ins` at level 16, `exc` from level 18 up
- `Horseshoe Crab Shield` — `ins` at level 7, `exc` at level 26
- `Slice` / `Epic Slice` — `exc` on the base item, `Insight` on the Epic

A ruling drawn from one level of a tiered item would have been wrong about the
others. Tiered items live on per-level subpages (`Item:X (level N)`); the parent
page is a `{{Tiered item}}` stub with no enchantment lines, and reading only the
parent returns zero hits rather than an error.

## Why this is recorded even though nothing changed

`AGENTS.md`: an issue resolved as already-correct still gets closed with the
evidence, or it reads as untouched forever. This family has now flipped once and
sits on a stacking key, so the next refresh that moves it should find a ruling
rather than an open question — which is precisely the failure
`docs/solutions/conventions/read-the-standing-ruling-and-judge-the-strongest-evidence-layer.md`
was written about, from the sibling case in the same refresh.

`tests/test_seeker_bonus_type.py` pins all 29 rows above against the raw
gear-planner dump, so a future re-type fails the build naming the carrier
instead of silently changing what stacks with what.

---

## RE-RULED 2026-09-04 (#697) — `exc` is a label; the applied bonus is Insight

**Trigger.** A player reported that the tool recommends Legendary Helm of the
Warblade for its "5 Exceptional Seeker" and then a second item for Insightful
Seeker, "causing an unnecessary overlap" — the item's sub-description and the
combat log both show the helm's bonus applied as Insight. Reproduced: with
Seeker ranked at ML 34 the helm's Exceptional 5 was summed on top of the Periapt
of Strength's Insight 6, crediting 33 where the game grants 28.

**Method.** Browser pane, per `harvest-method.md`. The rendered tooltip of every
one of the 18 `exc` carriers was read from its own page (`span.tooltip`
containing "Seeker"), plus the Seeker page and Template:Seeker, plus three
controls.

**What the ruling above got wrong, and why it is not a re-litigation.** #392
judged the template invocation's third parameter and called it the bonus type.
It is the LABEL: Template:Seeker documents `Exc for Exceptional` as a display
prefix, and the tooltip it renders for that prefix states the type the game
applies. This is the exact shape `bundled-template-values-live-in-the-tooltip-
not-the-cell.md` and the Barnacled Buckler correction (#379) record for
Elemental Resistance — "the visible label lies about the type; the tooltip is
the authority". The invocation was the strongest layer #392 read; it was not
the strongest layer available.

**The wiki states it three ways.**

1. [Seeker](https://ddowiki.com/page/Seeker): "Seeker items can provide various
   types of bonus. Regular Seeker grants Enhancement bonus, then there's
   Insightful Seeker and much rarer Quality Seeker. **The former Exceptional
   Seeker grants Insight bonus.**"
2. Every `exc` carrier's rendered tooltip: "Exceptional Seeker +N: Provides a +N
   **Insight** bonus to confirm critical hits, and a +N **Insight** bonus to
   critical hit damage (before multipliers are applied)."
3. The controls render the other types as themselves — Burrowing Claws:
   "Seeker +6: Provides a +6 **Enhancement** bonus …" and "Insightful Seeker +2:
   Provides a +2 **Insight** bonus …" — so the template is not printing Insight
   indiscriminately.

**The 18 carriers — tooltip read individually, 2026-09-04.** Magnitudes match
the dataset on all 18; the correction moves the type only.

| Item | Label (invocation) | Tooltip states | Correction |
| --- | --- | --- | --- |
| Bracers of Twisting Shade (level 18) | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Bracers of Twisting Shade (level 23) | Exceptional Seeker +4 | +4 Insight bonus | Exceptional → Insight 4 |
| Bracers of Twisting Shade (level 24) | Exceptional Seeker +4 | +4 Insight bonus | Exceptional → Insight 4 |
| Bracers of Twisting Shade (level 25) | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |
| Steady Handed Armbands (level 23) | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Steady Handed Armbands (level 24) | Exceptional Seeker +4 | +4 Insight bonus | Exceptional → Insight 4 |
| Steady Handed Armbands (level 25) | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |
| Souvenir Coin | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Golden Souvenir Coin | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Legendary Souvenir Coin | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |
| Legendary Golden Souvenir Coin | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |
| Helm of the Warblade | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Legendary Helm of the Warblade | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |
| Iron Cloak of the Wolf | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Mithral Cloak of the Wolf | Exceptional Seeker +4 | +4 Insight bonus | Exceptional → Insight 4 |
| Adamantine Cloak of the Wolf | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |
| Slice | Exceptional Seeker +3 | +3 Insight bonus | Exceptional → Insight 3 |
| Horseshoe Crab Shield (level 26) | Exceptional Seeker +5 | +5 Insight bonus | Exceptional → Insight 5 |

**What shipped.** 18 entries in `affix_type_corrections.json`
(`from: Exceptional, to: Insight`, tooltip verbatim, one page each), read as a
class under `_meta.seeker_exceptional_class`. The stale guard keeps them honest
in both directions: if upstream re-types the label to Insight itself, the
`from` no longer matches and the entry must be retired (the #374 retirement
block); if a carrier's magnitude moves, the `value` binding fails.
`tests/test_seeker_bonus_type.py` now pins BOTH populations — the raw dump
(upstream's label, the `from` side) and the built dataset (the applied type,
the `to` side) — so a correction that silently stops applying is caught where
the solver reads.

**Consequence for the golden.** `endgame-dps-ml33` gained +5 Seeker at #392
from Horseshoe Crab Shield (level 26)'s Exceptional 5 stacking on an Insight
source. That gain reverses; the fixture was re-ratified deliberately with this
change.

**The forum and release-note trail** (#697 cites a thread titled "Exceptional
Seeker +5 on Rare items like Legendary Golden Souvenir Coin and Legendary Helm
of the Warblade" and a report that "Warblade Helm's Mislabeled Seeker Gets
Fixed") was NOT readable from this environment — forums.ddo.com is blocked in
the Browser pane. It was not needed: the wiki's own tooltip and Seeker page state
the applied type outright, which is the evidence rule
`affix_type_corrections.json` requires. If a later game patch relabels the items
Insightful, upstream's type will follow, the `from` guard will fire, and the 18
entries move to the retirement block with that patch as the citation.

