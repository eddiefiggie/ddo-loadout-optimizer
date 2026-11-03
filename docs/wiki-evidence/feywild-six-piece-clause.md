# Seasons of the Feywild: the six-piece spell-DC clause

Reviewed **2026-11-03 UTC** against main
`767758c3438545fe43c56dfb3a60b76d01a51958`, as partial progress on
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) under
[#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908).
This changes comparison reading only. Production definitions, activation,
stacking, the shared reader, solver, UI and build stamp remain unchanged.

## Actual retained passages

The retained `pages-20261101-review` harvest contains both sources below, with
matching `revid` and `html_revid`. No fresh Wiki retrieval is claimed.

From [Named item sets revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202),
the row anchored **Seasons of the Feywild**, in **Fables of the Feywild sets**:

```text
6 Pieces Equipped:
* +1 Artifact bonus to all spell DCs
```

From [Template:Named item sets revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530),
switch key `seasons of the feywild`, with display-name metadata
`{{#vardefine:set|Seasons of the Feywild}}`:

```html
<li>6 Pieces Equipped: +1 Artifact bonus to all spell DCs</li>
```

Both passages explicitly give threshold **6**, amount **+1** (no percent sign),
bonus type **Artifact**, and scope **all spell DCs**. Neither includes an extra
activation condition. Matching these passages establishes what these Wiki
revisions say; it is not independent verification of live-game behavior.

The case-preserved spelling `all Spell DCs` already maps to `Spell Focus Mastery`
in the shared reader, with its existing vocabulary gate and evidence recorded
in [Named item sets structure, Spell DCs](named-item-sets-structure.md#spell-dcs-951-2026-10-27)
and [universal spell focus](spell-focus-universal.md). This slice changes only
the lower-case `s` in a comparison copy of the exact clause above. It introduces
no additional stat meaning, stacking rule, school interaction or tactical-DC
mapping. The source value and type still pass through the existing clause reader;
agreement with the catalog is not evidence for them.

## Source identity and exclusions

| Source | Complete retained wikitext SHA-256 | Parsed raw bonus-context SHA-256 |
|---|---|---|
| Page 720202 | `73ee1aa49cbf1ccf4bd660af325d53b9e96da17d0a840950b46e81606946441d` | `24f0b53deb373e34f086e9e0ee18c86376315ba1fe0d1239bb6484a2e2e3f092` |
| Template 723530 | `319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a` | `652cc329eeb176d820ffad8aaebb6b64b299de196cfadf3faae493c6ec78f987` |

The comparison requires the source title/revision, complete raw bonus-context
hash, exact identity and six-piece line. Template key and display name must both
match. The page must have the single exact anchor, the reviewed section, and no
HELstats tier. Both must retain the explicit 2/3/4/5/6/7 threshold structure.
Only the six-piece spelling changes in the copy; raw text and inputs remain
unchanged. The aggregate full-source hash/revision review also rejects changes
outside these parsed contexts, including discarded markup or comments.

The independent three-piece source text remains unread:

```text
Page:     +50 Artifact bonus to your maximum Spell Points
Template: +50 Artifact bonus to your maximum Spell Points.
```

No `Wizardry` equivalence is inferred from catalog agreement. Both comparisons
remain **partial**, and source silence is never interpreted as zero. Other
identities, revisions, contexts, thresholds, values, types, percentage units,
bare/tactical DCs, generic case changes and conditional wording receive no new
parsing. Vulkoor, critical-multiplier stacking, conditional activation and the
production-source switch remain outside this slice. Issues #908, #951, #953 and
#956 remain open.

## Validation boundary

The test fixtures preserve the complete retained template entry and page bonus
cell. Their surrounding table/item cell and switch wrapper are explicitly
synthetic. Both parsed fixtures were compared directly with the retained source.

Across all **282 sets**, only Seasons of the Feywild's two six-piece quarantine
records disappear. Both three-piece quarantine records remain, all classification
counts are unchanged, all **151 previously exact comparisons** remain exact, and
every other set and report field is unchanged. Both complete CLI formats pass
their existing source-review gates. All **190 production-file hashes** are
unchanged, including the shared reader and generated dataset; build `11012026.5`
is unchanged.

Eight focused tests cover both positive readings, catalog disagreements,
independent source coverage and the exclusion boundaries. The three tests for
new behavior fail by assertion on the pre-change tree; the five deliberately
unchanged-boundary tests pass there. Deliberate implementation corruptions are
also checked separately so source, identity, vocabulary and input-preservation
guards cannot pass vacuously.
