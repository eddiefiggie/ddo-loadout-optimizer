# Epic Slice 'n Dice: one jointly evidenced comparison clause

Reviewed **2026-11-03 UTC** against main
`8120158b63d67d2ddfe8942837cecab592b5132b`, as partial progress on
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) under
[#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908).
The original independent Epic candidate is preserved as
`c159502a8e57d5b3ce6cb9db5eeda052bc105d11`. The local reconciliation described
below adds that same helper to Heroic candidate
`616511b67480ad5df1b807af9d0e837741e6dac1`. Profane Experiment remains excluded.

## Direct retained evidence

[Named item sets revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
has the ordered anchors `Slice 'n Dice Set`, `Epic Slice 'n Dice Set` in
`The Devil's Gambit sets`. Its complete bonus cell, with a trailing newline, is:

```text
2 Pieces Equipped:
* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Seeker]]
* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Sneak Attack]]
```

The retained rendered row explicitly labels **+2 as Epic** and links Epic Slice
and Epic Dice. The standing [identity ruling](slice-dice-set-names.md) names the
exact Epic set and tier; neither an invented prefix nor the magnitude of the
number establishes that identity.

[Template:Named item sets revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
independently has switch key `epic slice 'n dice set` with this complete context:

```text
While wearing both items from the Epic Slice 'n Dice Set, you gain:<br />+2 [[Quality bonus]] to [[Seeker]]<br />+2 Quality bonus to [[Sneak Attack]]<br />They make julienne fries.
```

Epic's own source therefore states **two items, +2, Quality, Seeker**. No amount
is scaled from Heroic or supplied by catalog agreement. Both exact source
contexts are required for this later comparison reading; it is not a claim that
the malformed page alone parsed correctly. The historical
[membership ruling](slice-dice-membership.md), which used explicit Template
evidence for production Seeker, is unchanged.

| Retained context | SHA-256 |
|---|---|
| Page full wikitext | `73ee1aa49cbf1ccf4bd660af325d53b9e96da17d0a840950b46e81606946441d` |
| Template full wikitext | `319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a` |
| Complete page bonus cell | `178ceeaceca14fbae264e99e08ff19f94d54fcfcd6d03f046216f989c19ef47d` |
| Own Epic Template context | `836e6bd340db1d81fcd231764e3f1c13c7ddfe0bf2887f0141266617a27ca600` |

Both captures in `pages-20261101-review` have matching `revid` and `html_revid`.
No fresh source retrieval or member-item revalidation is claimed.

## Boundary

Only Epic's Seeker comparison copy loses the duplicated literal `bonus`. The
helper requires both source titles/revisions, full local raw hashes, exact
parsed clauses and thresholds, page section, ordered anchors, Epic tier and
unique own Template key. Existing identity review rejects missing or ambiguous
matches. The full comparison's whole-source hash/revision review separately
rejects changed outer context; a local helper match does not certify a changed
source capture. There is no generic grammar repair or tier-scaling rule.

Epic Sneak Attack and Template flavor remain quarantined, and the set remains
**partial**. This helper leaves Heroic rows unchanged; Heroic's separate helper
reads only its own jointly evidenced Seeker clause in the combined tree.
No Sneak Attack/Deception equivalence, dice size, damage formula, activation,
stacking or live-game behavior is inferred. Raw sources, the shared reader,
production definitions, solver and UI do not change. Comparison progress does
not authorize production-source adoption; #908, #951, #953 and #956 stay open.

## Original isolated scope and guards

Both complete CLI formats pass across **282 sets**. Only Epic Slice 'n Dice's
page quarantine list changes; total page quarantines fall **43 to 42**. The
other **281 records**, every Template result, all **153 previously exact
comparisons**, all classification counts and every other report field are
unchanged. All **190 production file hashes** and build `11012026.5` are unchanged.

Thirteen focused tests cover the explicit Epic field, catalog independence,
missing vocabulary, raw/parsed drift, identity, thresholds, units, conditional
text, unchanged inputs and Heroic exclusion. Changing Heroic's Template amount
cannot supply or alter Epic's reading. Six new-behavior assertions fail on the
exported base; seven unchanged-boundary tests pass. Twelve deliberate in-memory
faults are caught, and all thirteen tests pass after restoration. Fixtures use
the verbatim bonus cell and switch entries without leading indentation; table
wrappers and the item cell are synthetic. A duplicate catalog occurrence remains
partial while another clause is unread; it is not claimed separately reported
or treated as zero.

## Combined-tree reconciliation

Both original commits and their isolated validation receipts remain intact.
The combined tree retains both helper bodies unchanged and invokes them in
sequence. Each helper's wrong-tier control now checks that helper directly;
unrelated-anchor, identity, threshold, raw/parsed context and conditional-wording
controls remain. Integrated tests check both directions of own-Template
independence and reject both repairs if the complete shared page context changes.
These local independence tests do not certify altered full captures: the
existing whole-source revision/hash review still rejects those changes.

All 27 focused tests pass. Both complete report formats cover 282 sets. Relative
to Heroic `616511b`, only Epic's page quarantine list changes, from 42 to 41
overall; the other 281 records remain unchanged. Relative to main `8120158b`,
only Heroic and Epic change, from 43 to 41 quarantined page clauses overall;
the other 280 records remain unchanged. Every Template result, all 153 prior
exact comparisons, all classification counts and all other report fields are
unchanged. Both sets remain partial; all 190 production hashes are unchanged.
