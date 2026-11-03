# Profane Experiment: one comparison spelling

Reviewed **2026-11-07 UTC** against main
`cee3b3f24a9b0d8233ec336362cd54863920ab23`, as partial progress on
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) under
[#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908).
Only the non-Legendary Template entry's spelling changes in comparison copies.
Production definitions, the shared reader, solver, UI and build stamp do not
change.

## Retained primary text

[Template:Named item sets revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
has switch key `profane experiment`, display metadata `Profane Experiment`,
and an explicit `3 Pieces Equipped:` header. Its four clauses are:

```text
+10% Artifact bonus to Doublestrike and Doubleshot.
+2 Artifact bonus to Constitution and Intelligence.
+25 Artifact bonus to Universal Spell Power.
+1 Artifact bonus to [[Imbue]] dice.
```

The last clause explicitly supplies **+1**, **Artifact**, and **Imbue dice**.
The set's name does not make its bonus type Profane. The existing catalog
vocabulary spells the field `Imbue Dice`; the reader currently quarantines the
lowercase spelling. Catalog agreement does not supply the source's value, type
or threshold.

The same retained Template has a separate `Legendary Profane Experiment` entry
that already spells `Imbue Dice` with an uppercase D. Its existing reading is
unchanged. [Named item sets revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
also spells `Imbue Dice` in its Soul Splitter table, using Heroic/Legendary
`HELstats` positions. This change does not establish a new page-tier identity:
both actual page comparisons remain `no-wiki-name`.

The full retained Template wikitext SHA-256 is
`319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a`.
The complete target bonus context, including its original `<br />` spacing,
has SHA-256
`c3d31c20b0788e4b77b5040e61db47a3e0be9ba1a3080eb87ac65774adf92558`.
The page wikitext SHA-256 is
`73ee1aa49cbf1ccf4bd660af325d53b9e96da17d0a840950b46e81606946441d`.
Both captures have matching `revid` and `html_revid` in the retained
`pages-20261101-review` harvest. No fresh Wiki retrieval is claimed.

## Boundary and guards

The comparison requires the source title and revision, exact switch key and
display name, full raw bonus-context hash, single three-piece tier, four lines,
and the exact relationship between those lines and the original raw text.
Only the literal lowercase `dice` in the one reviewed clause becomes `Dice`
in a comparison copy. Every clause still passes the existing vocabulary gate.
The aggregate source revision/hash review independently covers the full source.

This adds no generic case folding, other entry, percentage conversion, dice
size, damage formula, condition, activation or stacking rule. Missing vocabulary
stays quarantined; absent evidence never becomes a zero. Original raw text and
parsed inputs remain intact. The existing Universal/each-Spell-Power comparison
mapping is unchanged; its standing evidence is in
[set-bonus-universal-per-element.md](set-bonus-universal-per-element.md).

An `exact` comparison means this Template's explicitly read affix multiset
matches the catalog. It does not establish page identity, authorize production
source adoption, resolve other Wiki mechanics or verify live-game behavior.
Issues #908, #951, #953 and #956 remain open.

## Measured scope

Both complete CLI formats pass their source-review gates across **282 sets**.
Only `Profane Experiment`'s Template comparison changes from partial to exact:
**121 to 122 exact**, **99 to 98 partial**. The other **281 set records**, all
page results, every other report field and all **153 previously exact
comparisons** remain unchanged. The rebuilt dataset and all **190 production
hashes** are unchanged; build `11052026.1` is unchanged.

Ten focused tests cover the six explicit fields, missing and duplicated catalog
occurrences, source/catalog independence, vocabulary, source drift, the
Legendary exclusion and input preservation. Five tests for new behavior fail by
assertion on the exported base; five unchanged-boundary guards pass there.
The full switch entries and page bonus text in the tests match the retained
source; their surrounding wrappers and item cell are explicitly synthetic.

## Reconciliation with current main

The conflict repair keeps main's Heroic and Epic Slice 'n Dice helpers and page
comparison path intact, then adds the original Profane helper to the Template
comparison path. The Profane helper and every other comparison helper are
unchanged in syntax tree from their respective reviewed inputs. Both complete
report formats were checked against the new base; the measured scope above is
fresh for that base. No intervening solver, browser, test-harness or production
data change is reverted. This does not include the separate Skull source dispute.
