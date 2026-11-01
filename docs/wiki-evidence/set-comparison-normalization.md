# Wiki evidence — set comparison normalization (#951)

Checked directly through the DDO Wiki API in Chromium on 2026-11-01.
These rules apply to `scripts/diff_harvest_sets.py` comparison keys only.

| Source | Revision | Explicit evidence |
|---|---:|---|
| [Sheltering](https://ddowiki.com/index.php?title=Sheltering&oldid=595036) | 595036 | “This item provides a +X bonus to both your Physical Resistance Rating and Magical Resistance Rating.” |
| [Insightful bonus](https://ddowiki.com/index.php?title=Insightful_bonus&oldid=140374) | 140374 | `#REDIRECT [[Insight bonus]]` |
| [Insight bonus](https://ddowiki.com/index.php?title=Insight_bonus&oldid=689072) | 689072 | Describes insight bonuses and explicitly describes Insightful Ability enchantments as granting an Insight bonus. |
| [Template:Sheltering](https://ddowiki.com/index.php?title=Template:Sheltering&oldid=696462) | 696462 | Both `insight` and `insightful` produce the Insightful prefix; the tooltip converts `insightful` to `Insight bonus` and states Physical and Magical Resistance Ratings. |
| [Template:Named item sets](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530) | 723530 | Double Helix's +2 and Epic Double Helix's +4 clauses both use `[[Insight bonus|Insightful]] bonus to [[Sheltering]]`. |
| [Named item sets](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202) | 720202 | The Double Helix row uses `{{HELstats|+2|+5}} [[Insight bonus|Insightful]] bonus to [[Sheltering]]`. |

## Ruling

For comparison, `Sheltering` expands into `Physical Sheltering` and `Magical
Sheltering`, each with the original amount and bonus type. The exact type
spelling `Insightful` compares as `Insight`, as the redirect, link target and
template code explicitly establish. Apply these forms to the catalog, the wiki
clauses, and the separate wiki-to-wiki comparison alike.

Previously only the catalog's Sheltering affixes expanded. Thus Heroic Double
Helix's wiki `Sheltering / Insightful / 2` was compared with the catalog's two
`Physical Sheltering / Insight / 2` and `Magical Sheltering / Insight / 2` keys.
The mismatch was representational, supported by the cited wiki definitions.

This does not modify `src/wiki_sets.py`'s returned affixes, `BONUS_TYPES`, the
shared affix parser, production set definitions, or solver stacking. The source
reader still returns the stated `Sheltering / Insightful / 2` affix. Only parity
keys change. No default type is supplied; percentage units, values, distinct
other types, duplicate occurrences and quarantined conditions are preserved.

## Remaining Epic disagreement

The template explicitly states **+4**; the page's Epic `HELstats` value states
**+5**. Normalization preserves that conflict: Epic Double Helix still reports
extra Physical and Magical Sheltering, each `Insight / 4`, against catalog 5.
No value is selected by agreement with the catalog. The conflict stays under
#956, and the page's bundled tier identity remains separate work under #953.

## Measurement and verification

Against merged commit `6ce0f9b`, over the 282 catalog sets compared independently
against each source:

- Heroic Double Helix moves from `ours-differs` to `exact`.
- Epic Double Helix stays `ours-differs`, now showing the two actual rating
  differences instead of a combined-name/type mismatch.
- Template exact becomes **111** (from 110), ours-differs **5** (from 6).
  All other template counts and every page count stay unchanged.
- The source-scoped count review remains complete, with 45 template and 50 page
  findings. No source revision, review hash or count is changed. Recorded
  disagreement and upstream-stale exceptions still reproduce.

The [measurement report](../reports/2026-11-01-set-comparison-normalization.json)
records the exact before/after records and citations. All 87 set-reader tests
and six count-review CLI tests pass. Five new behavioral tests fail by assertion
on the pre-change tree; two deliberate unchanged guards protect the source
representation and the remaining boundaries. Mutations that also alias Quality,
erase value differences, or drop repeated wiki affixes each fail the guard.
