# Legendary Vulkoor's Might: preserve the two sneak fields

Reviewed **2026-11-02–03 UTC** against `19a9f72cf7c34bcfa48ab9346815ad8b29c58808`.
This adds evidence and comparison regression guards for the existing
[#951 question](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951)
under #908 (confirmed open on this review date). It changes no production reader, catalog, generated data,
solver, UI, or build stamp. It does not resolve #951 or authorize a merge.

## Direct evidence and its limits

The retained normal-page captures of
[Legendary Bracers of the Claw](https://ddowiki.com/page/Item:Legendary_Bracers_of_the_Claw)
(observed revision 631874, 2026-11-02 17:27:41.202 UTC) and
[Legendary Gloves of the Claw](https://ddowiki.com/page/Item:Legendary_Gloves_of_the_Claw)
(observed revision 632339, 17:28:00.220 UTC) contain identical expanded
Legendary Vulkoor's Might popups. Each states a two-piece threshold and these
**separate** lines:

- `+3 Artifact bonus to Sneak Attack`
- `+3 Artifact bonus to Sneak Attack Damage`

The first line states neither dice/d6 nor a Deception equivalence or an explicit
attack-roll definition. The second is a separately named flat-damage field.
Two item popups repeat one set definition; they do not grant it twice.
The aggregate Named item sets capture (observed revision 720202) agrees on the
two separate Legendary lines. None of these captures is a gameplay experiment.
The observed revision links are metadata from normal-page captures, not proof
that historical endpoints were read. Anonymous-page cache warnings remain
applicable.

The retained [Sneak attack](https://ddowiki.com/page/Sneak_attack) card
(observed revision 695237) distinguishes an extra die, which adds 1d6, from
flat bonus damage. It supplies no set-specific mapping for the first Vulkoor
line. Do not convert that line to three dice, Deception +3, or a damage formula.
Leaving it unresolved in the comparison is not a claim that its game effect
is zero.

## Deception definitions conflict with some own-item values

The retained [Deception](https://ddowiki.com/page/Deception) capture (observed
revision 704007, 2026-11-02 17:28:54.762 UTC) distinguishes Arabic-numbered,
Insightful, Quality, Roman-numeral, unnumbered, Improved, and historic forms.
It does not authorize one formula or proc rule across those families.

| Evidence | Attack amount | Damage amount | Boundary |
|---|---:|---:|---|
| Arabic +X overview | X | Y | No universal X-to-Y formula stated |
| Insightful overview | X | X | Conflicts with the named example below |
| Ophael's Cincture, Insightful +6 popup | 6 | 9 | Exact own-item numbers, observed revision 685480 |
| Quality overview | X | X | Conflicts with the named example below |
| Legendary Belt of the Burrower, Quality +3 popup | 3 | 5 | Exact own-item numbers, observed revision 707408 |
| Ophael's Cincture, Enhancement +12 popup | 12 | 18 | Exact own-item numbers; no universal rule follows |

The Roman-numeral section states its own X/2X and proc rule; the separate
unnumbered section states X/1.5X and a proc. Improved and historic Deception have
their own Bluff/proc wording. None supplies the missing Vulkoor equivalence.
Preserve the named-item values and generic discrepancies separately. No rounding,
mixed-source stacking, proc uptime, target vulnerability, or total DPS ruling is
made here.

## Current reader and solver behavior

`wiki_sets.read_clause` reads the explicit flat-damage line and quarantines the
ambiguous `Sneak Attack` phrase. With the current catalog vocabulary,
`diff_harvest_sets.classify` returns `ours-differs`, specifically naming the
missing `(Sneak Attack Damage, Artifact, 3)` at two pieces. The current catalog
instead supplies `(Deception, Artifact, 3)`.

The new five tests deliberately preserve that distinction. They check both
own-item popup boundaries and threshold, reject inferred dice/Deception aliases,
keep literal fields distinct, keep the real catalog discrepancy visible, and
require the flat field's exact type/value/threshold in a hypothetical comparison.
That hypothetical input is a test fixture, never production data. Resolving
the flat field alone still leaves the ambiguous field quarantined.

Twelve fresh real-data HiGHS measurements were run with all named items pinned,
ML cap 36, Human, and only the named items in each pool. Every solve was optimal
and satisfied every pin. The targeted fields were Deception, Sneak Attack
Damage, Sneak Attack Dice, Accuracy, Deadly, and Seeker.

| Observed case | Cases | Deception | Separate flat sneak damage | Sneak dice | Accuracy / Deadly / Seeker |
|---|---:|---:|---:|---:|---|
| Bracers alone or gloves alone, each of Heroic/Epic/Legendary | 6 | 0 | 0 | 0 | 0 / 0 / 0 |
| Heroic Claw pair | 1 | 0 | 0 | 0 | 3 / 3 / 0 |
| Epic Claw pair | 1 | 0 | 0 | 0 | 3 / 3 / 3 |
| Legendary Claw pair | 1 | 3 | 0 | 0 | 3 / 3 / 3 |
| Legendary pair plus Ophael's Cincture | 1 | 21 | 0 | 0 | 3 / 3 / 18 |
| Legendary pair plus Legendary Belt of the Burrower | 1 | 6 | 0 | 0 | 3 / 6 / 3 |
| Legendary bracers plus Epic gloves | 1 | 0 | 0 | 0 | 0 / 0 / 0 |

These are **model observations**, not certified game totals. In particular,
Deception 21 is the model's combined Deception magnitude, not 21 flat damage or
21 dice. The solver measurements remain outside the permanent assertions so a
reviewed correction is not blocked by a test blessing the disputed mapping.

## Provenance and validation

The fixture `tests/fixtures/vulkoor_sneak_evidence.json` preserves fifteen exact
excerpt records and selected public source metadata from two verified evidence
payloads. Private transfer identities and producer workspace paths are omitted.
Capture metadata, public Wiki URLs, excerpt pointers, original-receipt hashes,
and limitations remain. Both manifests were read and verified too:

| Evidence packet | SHA-256 |
|---|---|
| Initial payload | `dd6dd628b8ac0c68f1942d92136762771b31489a468435042816d509223b8c71` |
| Initial manifest | `15131e2282e0bf9cb34a5a37ce6e0234d97b4a153ae4bca176786d8a4d55f10e` |
| Addendum payload | `24c7064b76874d7b05f805d8825a6dc68d9d3a4a0037d4125cdda280fc325ee5` |
| Addendum manifest | `1d42dc9473f8f014d01ef7bdf12bbe8ccef296ea77d7a9da5e7672e1b3bdb7bf` |

The packet bytes were independently hashed in this consumer environment. The
original raw capture files named by the packets were not transferred here;
their earlier validation is a packet claim, not a replay performed in this run.

Run the permanent guards with:

```sh
python3 tests/run_tests.py test_vulkoor_evidence
```

Each of the five guards was also observed to fail under a targeted in-memory
mutation: invented dice meaning, invented Deception meaning, collapsed literal
fields, a comparison alias hiding the discrepancy, or a wrong bonus-type fold.
Empty popup population, one missing popup, and a changed literal value were
also rejected. All five guards passed again after restoration. These are
unchanged-behavior tests, not claims of a new production fix.

The full Python suite completed with **1,800 passed, 0 failed**, including these
five guards. The full JavaScript suite completed with **3,131 passed, 0 failed**
across 52 files. All twelve real-data HiGHS measurement cases completed with
optimal status and every item pin satisfied. The Utility performance gate passed
across 24 fixtures: cost-weighted ratio **1.54x** (budget 1.75x), worst eligible
fixture **3.18x** (budget 5.00x). These local runs used Python 3.12.14 and Node
24.19.0; repository CI specifies Node 20, and no remote CI run is claimed.

A fresh dataset build reproduced the existing 9,173-item file byte for byte
(SHA-256 `5362bf6c2e213d930cc7e8f267abe6638237605325f6570d13e20b0f5c3031f2`).
All 190 snapshotted production files remained unchanged. The retained full set
review passed its revision/hash gates across 282 sets and still reports the
Vulkoor discrepancy. Whitespace checks passed. This patch changes only
documentation, a retained-source fixture, and Python comparison tests.

The source cards close the earlier missing-own-popup gap. They do not close the
semantic question already tracked in #951. Review this guard-only change first.
A later narrowly scoped correction can consider the explicit flat-damage field
and disclosure of the unresolved field, but must account for the existing
Deception grant across every set-definition channel to avoid double credit.
Do not settle that question by renaming, silently adding both, or assuming dice.
