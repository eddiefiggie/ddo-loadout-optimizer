# Renegade Champion: three explicit sentences in one paragraph

Reviewed **2026-11-03 UTC** against `aac34594d2736d5ffb444ddaaf3ba40add10d566`.
This is a comparison-reader improvement under
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951), not a
production set-definition change or an issue resolution.

## Retained direct source

`pages-20261101-review` contains
[Template:Named item sets, revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530).
Its page ID is 15874; `revid` and `html_revid` both equal 723530. The complete
retained wikitext SHA-256 is
`319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a`.
The existing aggregate review verifies the full source revision and hash. This
review uses that retained source; it does not claim a fresh Wiki retrieval.

The two exact switch entries are retained verbatim in
`tests/test_renegade_set_paragraphs.py`. Their complete bonus paragraphs read:

```text
3 Pieces Equipped: +1 Artifact Bonus to Critical Multiplier on a 19-20. +2 Artifact Bonus to Rune Arm DCs. +10 Artifact Bonus to Repair Amplification
3 Pieces Equipped: +1 Artifact Bonus to Critical Multiplier on a 19-20. +3 Artifact Bonus to Rune Arm DCs. +30 Artifact Bonus to Repair Amplification
```

| Switch key | Display-name metadata | Complete bonus paragraph SHA-256 |
|---|---|---|
| `renegade champion` | No `#vardefine:set` name | `b70b36b0396b2f17198b636765d2fb84a537dc42243da6fd45b99b35ae8c95ab` |
| `renegade champion (legendary)` | `Renegade Champion (Legendary)` | `2f9e04420b7305905cb072ab6dad36113b228382cef00f2b6d3803cd857aaa3a` |

These paragraph hashes cover the reader's retained `raw` entry: the piece-count
header and all bonus text, after removing the separately checked `#vardefine`
metadata. There is no condition or additional sentence in either entry.

## What the comparison now reads

Previously, each paragraph reached the single-clause reader as one stat phrase.
It was quarantined even though each of its three sentences independently uses
the reader's existing typed-bonus grammar and catalog vocabulary.

`scripts/diff_harvest_sets.py` now splits a comparison copy only when the switch
key, display-name metadata, complete raw-text hash, and extracted three-piece
tier all match the reviewed entry. It splits the original text at its two
sentence boundaries and passes every resulting clause to the existing reader.
The hashes supply no values, bonus types or stat names. No generic sentence
splitting, stat alias, or new bonus rule is added.

Both catalog comparison and Wiki-to-Wiki comparison consume that same copy.
Source text, the shared `src/wiki_sets.py` reader, and production definitions
remain unchanged. An edited entry gets no additional parsing from this change;
the aggregate full-source revision/hash gate still rejects changed source
context, including changes otherwise readable by the existing clause reader.

The three-piece threshold is explicit in the source. Each set states Artifact
critical multiplier +1; the Heroic entry states Rune Arm DCs +2 and Repair
Amplification +10, while the Legendary entry states +3 and +30 respectively.
Those six typed fields already match the catalog exactly.

This establishes no stacking behavior. The separate critical-multiplier
spellings and [standing stacking quarantine](critical-multiplier-19-20.md)
remain unchanged. The real page's missing usable identities also remain
`no-wiki-name`; synthetic page rows in one regression test exercise the
comparison path without asserting new source identities.

## Verification and bounded result

On the complete retained harvest, all 282 catalog sets were compared and all
existing review gates passed in both JSON and text CLI modes. Exactly two
per-set records changed: these Template entries move from `partial` to `exact`.
Template totals move from **114 to 116 exact**, and **106 to 104 partial**.
All other report fields are unchanged, including page counts, source
disagreements, the four `ours-differs` sets, and the Vulkoor discrepancy.

The affected Python suites passed **160 tests across 10 modules**, including
six new tests. The three tests asserting new behavior failed on their expected
assertions in an exported pre-change tree; the three unchanged-behavior guards
passed there. Six in-memory corruptions were rejected: unrestricted splitting,
unreviewed identity, zero reviewed entries, missing Legendary coverage,
bypassed vocabulary checks, and folded critical spellings. All six tests
passed again after restoration.

The fixture's two switch-entry lines were checked byte for byte against the
retained source. All 190 production-file snapshots, including generated data,
the shared reader, and the stacking disclosure, remained identical. JavaScript
and solver performance tests were not repeated for this comparison-script
change. #951 remains open; no production source switch is authorized.
