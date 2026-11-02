# Abishai five-piece spell-DC comparison ruling

Recorded 2026-11-02 for #951 / #908. This is a comparison-only interpretation of
three five-piece clauses. It supplies no production values and does not settle
the three-piece clauses, #956 disputes, or the wider set migration.

## Retained direct evidence and freshness

The [Named item sets page, revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
was fetched directly as wikitext and rendered HTML at
**2026-11-01 22:07:07.452869 UTC**. The
[set template, revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
was fetched the same way at **22:07:09.432316 UTC**. Both reads used a same-origin
Wiki browser session during the Natural Armor investigation. Their verbatim
Abishai bonus bodies are retained in `tests/fixtures/natural_armor_sets.json`.
The complete harvest is guarded by the existing revision/digest receipts in
`set-count-review.json`:

| Source | SHA-256 of captured wikitext |
|---|---|
| Named item sets | `73ee1aa49cbf1ccf4bd660af325d53b9e96da17d0a840950b46e81606946441d` |
| Template:Named item sets | `319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a` |

A normal request to `https://ddowiki.com/page/Named_item_sets` at
**2026-11-01 23:52:29 UTC** returned HTTP 202 with an AWS WAF challenge and no
article. Reads stopped after that single request. No challenge interaction,
alternate route or further fresh Wiki request was used. This ruling relies on
the retained pinned captures; it does **not** claim the live Wiki was reverified
after those captures. The general spell-focus pages below were not refreshed.

## What the sources establish

The set page places this note on its **five-piece** DC line:

> Tactical DCs are not affected, only Spell DCs

Its HELstats values explicitly distinguish Heroic, Epic and Legendary tiers.
The separate three-piece line has no such note. The template gives both counts,
types and values but calls all six effects only `DCs`.

| Set | Five pieces: stated Profane spell-DC bonus | Three pieces: still ambiguous DC scope |
|---|---:|---:|
| Might of the Abishai | +2 | +1 |
| Epic Might of the Abishai | +2 | +2 |
| Legendary Might of the Abishai | +3 | +2 |

The stated condition is that the required number of pieces of that set/tier are
equipped. These captured clauses state no additional proc, duration, stance or
target condition. The five-piece note is not extended to the three-piece line.
Equality of Epic's two amounts does not establish equality of their scope.

The explicit item-template calls on
[Belt of the Black Abishai, revision 628530](https://ddowiki.com/index.php?title=Item:Belt_of_the_Black_Abishai&oldid=628530),
[Epic, revision 658847](https://ddowiki.com/index.php?title=Item:Epic_Belt_of_the_Black_Abishai&oldid=658847),
and [Legendary, revision 631814](https://ddowiki.com/index.php?title=Item:Legendary_Belt_of_the_Black_Abishai&oldid=631814)
state the three exact set identities. Direct captures were made at 22:08:52,
22:08:54 and 22:08:56 UTC on November 1. Their rendered tooltips repeat the shared
template's generic DC wording; they are **not independent scope evidence**.

The existing explicit `Spell DCs` mapping in `wiki_sets.STAT_PHRASES` cites
[Spell Focus Mastery, revision 612763](https://ddowiki.com/index.php?title=Spell_Focus_Mastery&oldid=612763)
and [Increasing spell DCs, revision 719694](https://ddowiki.com/index.php?title=Increasing_spell_DCs&oldid=719694).
This ruling reuses that reviewed mapping, described in
[spell-focus-universal.md](spell-focus-universal.md); it does not add a general
meaning for bare `DCs` or infer tactical, Assassinate or Rune Arm scope.

## Comparison boundary

Only `scripts/diff_harvest_sets.py` interprets the three reviewed five-piece
template clauses, after validating both sources together. The comparison reads
the magnitude from the source clause and passes its explicitly established spell
scope through the existing reader and vocabulary gate. Neither source nor the
catalog is rewritten. A catalog value/type disagreement remains visible as
`ours-differs`; agreement with the catalog is not used to choose a Wiki meaning.

The review requires all three exact catalog identities, one template switch key
and matching declared name for each, the three page tier records and exact
anchors, the stated 3/5 counts, values and Profane type, and the note on the
five-piece line only. Missing, duplicate, relocated, conditional, percentage,
changed or empty evidence fails the review. A failure disables all three scoped
readings and makes either CLI format exit nonzero. The complete-source
revision/hash guard still catches wider source drift.

All three three-piece DC clauses remain quarantined. The Legendary Heal Amp
phrases were unread at this ruling; their separately guarded interpretation is
now recorded in [abishai-amplification.md](abishai-amplification.md).
The multi-tier page-name matching gap remains separate
under #953; this ruling does not install a general HELstats identity rule.
Thus no set changes comparison category: template exact/partial remain 114/106,
and only three five-piece DC quarantines disappear. The other 279 catalog sets,
source disagreements and recorded exceptions are unchanged.

## Production and quality control

Production already stores all six clauses as Profane Spell Focus Mastery and
expands them to seven spell-school targets. This comparison-only change leaves
the generated dataset, application files, solved totals and build 11012026.5
unchanged. The three-piece production behavior is characterized, not newly
certified as a game mechanic by this ruling.

`test_abishai_five_piece_dcs.py` exercises the real comparison CLI in JSON and
text modes. Mutations update the unrelated count-review fixture's hashes to
prove the new source guard independently rejects changed evidence, including
when both sources' values are changed together. Other rulings and ordinary
catalog disagreements remain observable. Behavioral tests must fail by assertion
against the pre-change implementation; unchanged-behavior guards should pass.

`abishai_dcs.test.js` permanently retains 25 real-HiGHS preservation cases:
12 equipment thresholds across seven schools and five excluded targets,
nine weaker/equal/stronger Profane comparisons, mixed-tier rejection, and three
Gem of Many Facets assignments. Epic's wildcard case also ranks AC because its
three- and five-piece focus amounts are equal; focus alone cannot prove that a
fifth piece was assigned. These preservation tests intentionally pass on the
pre-change tree.

Remaining three-piece scope research stays under #951; wider page identity work
stays under #953. No new backlog, production bonus or release is created here.
