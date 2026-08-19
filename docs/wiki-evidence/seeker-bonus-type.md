# Seeker — the bonus type is the template's third parameter (#392)

**Ruled:** 2026-08-19. **Method:** same-origin harvest per `harvest-method.md`;
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
