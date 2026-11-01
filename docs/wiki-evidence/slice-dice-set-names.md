# Slice 'n Dice: two explicit set-name identities

Checked directly on DDO Wiki on **2026-11-01**, against main
`88c8dea28bc971d2b9e4671ee8310693cf12c350`. This is partial progress on #953
under #908. It matches two existing catalog labels to their stated Wiki names
for comparison only; production set data and item membership are unchanged.

## Source evidence

| Catalog label | Wiki-stated name | Page tier | Member item evidence |
|---|---|---|---|
| `Slice 'n Dice` | `Slice 'n Dice Set` | Heroic | [Slice rev 671155](https://ddowiki.com/index.php?title=Item:Slice&oldid=671155), [Dice rev 677125](https://ddowiki.com/index.php?title=Item:Dice&oldid=677125) |
| `Epic Slice 'n Dice` | `Epic Slice 'n Dice Set` | Epic | [Epic Slice rev 671208](https://ddowiki.com/index.php?title=Item:Epic_Slice&oldid=671208), [Epic Dice rev 677116](https://ddowiki.com/index.php?title=Item:Epic_Dice&oldid=677116) |

Each of the four item pages contains a `Named item sets` invocation with the
full name shown above. Its rendered HTML links to that exact named-set anchor.
The Epic name is explicitly present on both Epic item pages; it is not formed
by prepending a word to a Heroic anchor.

[Named item sets rev 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
places both anchors in its `Slice 'n Dice [ML:14/28]` row. The row names Slice
and Dice through `HELitem`; its rendered links explicitly include `Item:Slice`,
`Item:Dice`, `Item:Epic Slice`, and `Item:Epic Dice`. Its two-piece bonus uses
the Heroic and Epic positions of `HELstats`. That template's tier mapping is
already independently ruled on in [named-item-sets-structure.md](named-item-sets-structure.md).
The freshly rendered row also explicitly labels its +1 values Heroic and its
+2 values Epic; the mapping is not taken from position or magnitude alone.

[Template:Named item sets rev 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
has separate switch entries and explicit two-item prose for both full names.
The item references, anchors and named template entries establish the two
identities. Bonus agreement with the catalog is not the basis of the mapping.

All six pages were read through paced, same-origin API POSTs from a real Wiki
tab, with TLS verification enabled. Wikitext and rendered HTML were inspected.
The two complete set-source hashes still match `set-count-review.json`; all six
revision IDs and hashes are retained in the [measurement report](../reports/2026-11-01-slice-dice-set-names.json).

## Implementation boundary and guards

`scripts/diff_harvest_sets.py` has two explicit mappings, each naming its exact
Wiki target and page tier. They do not create a general `Set` suffix rule,
invent tier prefixes, change source text, or rename production catalog entries.
Every affected comparison reports its matched Wiki name and, for the page,
its tier. Readable source-to-source disagreements still use the matched page
entry, so a name match cannot choose a winning value.

Both CLI modes fail when a registered target is missing or ambiguous: the
expected template key must exist, the named page tier must be unique, and a
new direct source name or second catalog entry under the Wiki name requires
review. An invalid identity is not applied. The existing whole-source
revision/hash gate separately rejects changed source context. Small comparisons
can omit these two sets and report no applicable aliases; the existing count
gate rejects an empty catalog.

The four member-page revisions are the recorded basis of the identity ruling;
the comparator does not claim to re-harvest member pages on each invocation.

## What remains unread

Both sets become **partial**, not exact:

- The template's `Sneak Attack` wording remains quarantined. The catalog has
  `Deception`; this change does not assert those are equivalent (#951).
- The template's flavor sentence remains quarantined as non-numeric prose.
- The page literally produces `Quality bonus bonus to ...` for both Seeker and
  Sneak Attack. Those malformed clauses remain quarantined; this change does
  not repair their grammar or adopt their amounts.

No count is inferred from the member list. No disputed bonus, production
membership, stat phrase, stacking rule or set activation behavior is changed.
All other #953 identities, #951 phrases and #956 value disputes remain open.

## Measured scope and validation

Across all **282 catalog sets**, using the fresh complete sources:

- Template `no-wiki-name`: **9 → 7**; `partial`: **106 → 108**.
- Page `no-wiki-name`: **172 → 170**; `partial`: **27 → 29**.
- The other **280 set records** and all other classification counts are identical.
- Quarantined clauses in compared records rise **154 → 158** (template) and
  **40 → 44** (page), because these two previously skipped comparisons are now
  visible. No quarantined clause is admitted by this change.
- The 45/50 count review, Arcsteel ruling, source disagreements and recorded
  exceptions are unchanged.
- The rebuilt production dataset is byte-identical: 9,173 items, SHA-256
  `6e7c0b1ad25d7d0da5feb4ad77152fcde299d95e54ca9cb4009a0417fe72cd90`.

Five new behavioral tests pass with the change and fail by assertion on the
exported pre-change tree. They cover both sources, tier boundaries, unchanged
inputs, no fuzzy matching, visible bonus/count differences, source disagreements,
and deliberately broken identity targets through both CLI formats. Restoring
the inputs restores passing results.

Only the comparison script, tests and evidence change. No player-facing build
stamp bump is owed; the directional stamp guard remains part of validation.
