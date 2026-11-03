# Heroic Slice 'n Dice: one jointly evidenced comparison clause

Reviewed **2026-11-03 UTC** against main
`8120158b63d67d2ddfe8942837cecab592b5132b`, as partial progress on
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) under
[#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908).
This later comparison reading requires both retained sources. It does not
derive a production value from the page's malformed grammar or claim that
the page alone has independently parsed correctly.

## Exact supporting text

[Named item sets revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
places the ordered anchors `Slice 'n Dice Set`, `Epic Slice 'n Dice Set` in
`The Devil's Gambit sets`. Its complete bonus cell is:

```text
2 Pieces Equipped:
* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Seeker]]
* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Sneak Attack]]
```

The retained cell includes a trailing newline. The standing
[identity ruling](slice-dice-set-names.md) maps the Heroic row to `Slice 'n Dice`;
the existing HELstats reader supplies the explicitly recorded Heroic position.
No new alias or tier interpretation is introduced.

[Template:Named item sets revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
has the exact switch key `slice 'n dice set` and this complete context:

```text
While wearing both items from the Slice 'n Dice Set, you gain:<br />+1 [[Quality bonus]] to [[Seeker]]<br />+1 Quality bonus to [[Sneak Attack]]<br />They make julienne fries.
```

The own Template explicitly supplies **two items, +1, Quality, Seeker**.
Catalog agreement supplies none of those fields. The historical
[membership correction](slice-dice-membership.md) used that explicit Template
evidence for its production value; that earlier decision is unchanged.

Retained source identities:

| Context | SHA-256 |
|---|---|
| Page full wikitext | `73ee1aa49cbf1ccf4bd660af325d53b9e96da17d0a840950b46e81606946441d` |
| Template full wikitext | `319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a` |
| Page bonus cell | `178ceeaceca14fbae264e99e08ff19f94d54fcfcd6d03f046216f989c19ef47d` |
| Heroic Template context | `c6bbb2a271eed7a901c5475ef34d28f37db8f5ef2354e004951b917745419573` |

Both captures in `pages-20261101-review` have matching `revid` and `html_revid`.
No fresh source retrieval or fresh member-item validation is claimed.

## Scope and rejection boundaries

Only the Heroic page Seeker clause loses its duplicated literal `bonus` in a
comparison copy. The helper requires both source titles and revisions, complete
local raw hashes, exact parsed clauses and two-piece thresholds, the page
section, ordered anchors, Heroic tier, and unique own Template switch key.
The existing identity ruling rejects missing or ambiguous matches. The complete
comparison's whole-source revision/hash review separately rejects changed outer
context; a helper match alone does not certify a changed source capture.

The raw sources, shared reader and production inputs remain unchanged. Epic's
page clauses, Heroic Sneak Attack and the Template flavor sentence stay quarantined;
the overall set stays **partial**. No Sneak Attack/Deception equivalence, dice
size, damage formula, activation, stacking or live-game behavior is inferred.
This does not authorize production-source adoption. Issues #908, #951, #953 and
#956 remain open.

## Measured validation

Both complete CLI formats pass across **282 sets**. Only Heroic Slice 'n Dice's
page quarantine list changes: page quarantines **43 to 42**. The other **281 set
records**, all Template records, every other report field and all **153 prior
exact comparisons** are unchanged. Profane Experiment remains partial on this
main-based branch; its separate draft is not included.

Twelve focused tests cover the jointly evidenced field and rejection boundaries.
Five new-behavior tests fail by assertion on the exported base; seven unchanged
boundary tests pass there. Twelve deliberate in-memory faults are rejected;
restoring the helper restores all twelve tests. Fixtures contain the verbatim
bonus cell and switch entries (without their leading indentation); table wrappers
and the item cell are synthetic. Missing or changed catalog Seeker is visibly
different. A duplicate catalog occurrence remains partial while Sneak Attack is
unread; no separately reported remainder or inferred zero is claimed.

The rebuilt dataset and all **190 production hashes** are unchanged. Build
`11012026.5` remains unchanged because this comparison-only change has no
player-facing behavior. Independent source/mechanics and adversarial code reviews
cover the paired contexts, ambiguity, conditional wording and report scope.
