---
title: Exact set parity requires equal affix multisets
module: set comparison
component: scripts/diff_harvest_sets.py
problem_type: logic_error
date: 2026-11-03
tags: [sets, comparison, evidence, multiset, migration]
applies_when:
  - A comparison claims exact parity after checking only one difference direction
  - A source reading can omit a catalog field or duplicate occurrence
---

# Exact set parity requires equal affix multisets

Issue [#984](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/984),
under the set-source migration #908. Base:
`6d1ccc088d75bcbdc5a9e1bf45c6206a6e1d9a46`.

The comparison checked `read - catalog` before reporting `exact`, but never
checked `catalog - read`. A fully read subset therefore looked equal. Synthetic
inputs reproduced this for a catalog-only stat, an extra catalog occurrence of
the same stat, and an empty Wiki tier opposite a populated catalog tier.
The Wiki-only difference also iterated a Counter's keys, so its report lost
duplicate occurrences even though the difference was detected.

This was a future verification risk, not a demonstrated gameplay defect. Every
currently exact comparison was independently checked in both directions:
**116 Template and 32 page comparisons**, with no missing occurrence. The full
282-set report remains byte-identical in JSON and text modes after the fix.
The retained sources are `pages-20261101-review`: Named item sets revision
720202 and Template:Named item sets revision 723530. Their existing complete
source hash/revision gates pass. No fresh Wiki access is claimed.

## Comparison behavior

Both directional differences now retain every occurrence through
`Counter.elements()`. A fully read comparison that would otherwise be exact
but has catalog-only occurrences becomes `catalog-unmatched`; its
`catalog_unmatched` detail lists the threshold and affix for every occurrence.
It requires review before a production source switch.

That label records missing comparison evidence. It does not say the Wiki grants
zero, that the catalog is wrong, or that an effect should be removed. An unread
clause might contain the unmatched field, so quarantined comparisons retain
their `partial` classification. Wiki-only differences and the existing scoped
value exceptions keep their classifications. The reverse check does not
reinterpret those exceptions or turn any of them into exact parity.

Both report formats expose the new class. The CLI's successful exit still means
the evidence reviews are complete, not that every set has reached parity;
unresolved classes remain visible. Production definitions, the shared clause
reader, calculations and player-facing files are unchanged. The phase parent
and the remaining phrase/value issues stay open.

## Regression proof

Nine permanent tests exercise both sources and both CLI formats, differences
in both directions, duplicate counts, an empty Wiki tier, later thresholds,
quarantine, scoped value exceptions and input immutability. Their invented
Strength/Dexterity values are comparison fixtures, not Wiki evidence.

Copied onto an exported base tree, six tests fail on their expected assertions;
three deliberate unchanged-behavior guards pass. Eight in-memory corruptions
were also rejected: disabling the reverse check, losing multiplicity in either
direction, skipping later thresholds, overriding quarantine or value rulings,
rewriting an input, and omitting the page report's result. All nine tests pass
again with the original candidate restored. All 190 snapshotted production
files remain identical.
