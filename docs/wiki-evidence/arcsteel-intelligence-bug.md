# Arcsteel Battlemage: the explicit heroic Intelligence bug note

Checked directly on DDO Wiki on **2026-11-01**. This is one source ruling under
#956 and #908; it does not complete either issue or switch production set data.

## Evidence and ruling

| Source | Revision | Finding |
|---|---:|---|
| [Named item sets](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202) | 720202 | The Arcsteel row states three pieces. Its Intelligence line prints Heroic +2 and Legendary +3, followed by **“Bug: Heroic tier only gives +1 INT.”** The rendered HTML carries the same explicit note beside the tier-labelled values. |
| [Template:Named item sets](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530) | 723530 | The heroic entry states three items and +2 Artifact Intelligence; the Legendary entry is separate. |

Both complete sources were read through same-origin API calls in a Chromium
Wiki tab, with the usual pacing and TLS verification enabled. The revisions
and wikitext SHA-256 hashes still match `set-count-review.json`.

The page explicitly identifies an in-game bug in the **heroic** Intelligence
amount. That supports recording +1 as the actual amount for this comparison,
while retaining the template's printed +2. The catalog already carries +1
Artifact Intelligence at three pieces. Agreement with the catalog is a checked
consequence of the Wiki ruling, not the evidence for choosing it. This is not an
independent measurement in the game.

## Comparison behavior and guards

`scripts/diff_harvest_sets.py` reports the explained difference as `wiki-bug`,
including both the printed and actual affix. It does not change the Wiki reader,
catalog, production build, bonus type, stacking, or any Legendary value.

The exception applies only while all of these remain true:

- Exactly one Heroic Arcsteel page row has the three-piece tier and the exact
  Intelligence line with that bug note.
- The template has exactly one three-piece +2 Artifact Intelligence clause.
- The catalog has exactly one three-piece +1 Artifact Intelligence affix.
- The comparison actually exposes the expected +2-versus-+1 difference.

Changed, missing, differently typed, or duplicated evidence disables the
exception and makes both CLI output modes exit nonzero with a review message.
The existing full-source revision/hash gate separately requires review of any
source edit, including surrounding context. Comparisons omitting Arcsteel say
the ruling is not applicable; the existing count-review gate rejects an empty
catalog.

Only the explained Intelligence difference is removed from `extra`. Other
differences and quarantined clauses remain visible. In particular, Arcsteel's
template writes its spell-power amount as **+25%**, and that clause remains
quarantined. The ruling does not make this set an exact match. The Epic Double
Helix, Levikk, Lorikk, Dreadkeeper, Desert, Spring and Vulkoor questions remain
unchanged.

## Measured scope

Against main `50f041bbe8f466e34132b50385b6ffeb9c55a5de`, using the fresh complete
sources and all 282 catalog sets:

- Template `ours-differs` falls **5 → 4**, with one new `wiki-bug` record.
- All other counts, every page comparison and the other **281 set records** are
  identical. The 45/50 source-scoped count review remains complete; all existing
  disagreement and upstream-stale records still reproduce.
- The generated production dataset is byte-identical, SHA-256
  `6e7c0b1ad25d7d0da5feb4ad77152fcde299d95e54ca9cb4009a0417fe72cd90`.

The [measurement report](../reports/2026-11-01-arcsteel-bug-ruling.json) preserves
the exact before/after record. Five new behavioral tests fail by assertion on
the exported pre-change tree and pass with the change. They exercise both CLI
formats, changed notes/types/values/multiplicity, the Legendary boundary, the
unchanged Epic Double Helix dispute, and an unrelated extra affix. Corrupted
inputs fail and restored inputs pass.

No build-stamp bump is owed: only the comparison script, tests and evidence
change. The production dataset and player-facing paths stay unchanged; the
directional stamp check is still part of validation.
