# Slice 'n Dice: four explicit memberships and verified Seeker only

Checked directly on **2026-11-01**, against main
`5e16b41692da063f0df7e2dc077ce3e04c04f807`. Partial progress on #953 and #951
under #908; their broader migration scope remains open. The prior
[name comparison ruling](slice-dice-set-names.md) did not alter production
membership. This correction does.

## Evidence and boundary

| Set | Explicit item members | Two-piece Quality Seeker |
|---|---|---:|
| Slice 'n Dice Set | [Slice rev 671155](https://ddowiki.com/index.php?title=Item:Slice&oldid=671155), [Dice rev 677125](https://ddowiki.com/index.php?title=Item:Dice&oldid=677125) | +1 |
| Epic Slice 'n Dice Set | [Epic Slice rev 671208](https://ddowiki.com/index.php?title=Item:Epic_Slice&oldid=671208), [Epic Dice rev 677116](https://ddowiki.com/index.php?title=Item:Epic_Dice&oldid=677116) | +2 |

Each item explicitly invokes its respective named-set template. The
[set table, rev 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
names the four items in separate Heroic/Epic positions and states a two-piece
threshold. The [template, rev 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
requires both items and explicitly states the Quality Seeker value for each
set. The table's doubled `bonus` markup is not repaired to manufacture a
parsed value: the template supplies the independent, explicit Seeker evidence.

[Seeker rev 682718](https://ddowiki.com/index.php?title=Seeker&oldid=682718)
states that Seeker benefits both weapons, and identifies the former Exceptional
Seeker as Insight. [Quality bonus rev 364683](https://ddowiki.com/index.php?title=Quality_bonus&oldid=364683)
states that only the largest Quality bonus applies. The isolated matching
pairs therefore gain the verified Quality component beside their existing
Insight Seeker: modeled totals 3 to 4 and 6 to 8, without another Quality source.

Two limits remain explicit:

- The set's `Sneak Attack` wording does not establish the catalog's `Deception`
  interpretation. [Sneak attack rev 695237](https://ddowiki.com/index.php?title=Sneak_attack&oldid=695237)
  distinguishes dice from flat damage; [Deception rev 704007](https://ddowiki.com/index.php?title=Deception&oldid=704007)
  explicitly describes Quality Deception as affecting both attack and damage.
  The set text does not establish that equivalence. Its catalog Deception line
  is quarantined, with the original row and reason retained, not renamed or
  credited. This remains part of #951.
- The sources establish a matching Slice + Dice pair. They do not explicitly
  establish two copies of one dagger or a mixed Heroic/Epic pairing. These
  receive no set credit and are disclosed as unverified. This is an evidence
  boundary, not a claim that duplicate activation is impossible in the game.
  The set-page note about a duplicate penalty belongs to **Inevitable Balance**;
  it supplies no rule for Slice 'n Dice.

All pages were read through paced same-origin API POSTs from a real Wiki tab,
with TLS verification enabled; wikitext and rendered item tooltips were checked.
Revision IDs and source hashes are in the
[measurement report](../reports/2026-11-01-slice-dice-membership.json).

## Production correction

The four vendor records store the set name as a Boolean affix, while `sets[]`
contains only The Devil's Handiwork (or its Epic form). The reader corrects
exactly those four markers to membership, preserving other affixes and sets.
An upstream membership repair or changed marker fails for review; arbitrary
Boolean names are never promoted. A build guard rejects a missing, duplicate,
extra, or empty member population.

`src/set_catalog.py` remains the single set-definition source for every
consumer. It validates the two existing raw catalog rows, admits their verified
Seeker affix, and flags the disputed Deception affix. Raw vendor files remain
unchanged. `required_items` and the verification notice travel through the
shared set parser into the dataset. No second set-stat catalog is introduced.

The model preserves both required members during pruning and handles set pins.
The solver requires each named member in addition to the existing piece
threshold, honoring Set-Augment suppression. The result projection applies the
same membership requirement to completion cards and glow, including sets whose
bonuses were not ranked. Set limits travel with saved items and use the existing
shared notice path for live results and exports. Other definitions carry no
required-member metadata, so their existing piece-count behavior is unchanged.

## Validation

`tests/test_slice_dice_membership.py` covers the reader, shared definitions,
quarantine, built dataset, population and changed-input guards.
`tests/slice_dice_membership.test.js` uses the real dataset and HiGHS for both
hand orders, singles, duplicates, mixed tiers, Quality stacking, unpinned
optimization, set pins, disclosures and The Devil's Handiwork preservation.
A separate synthetic interface case isolates duplicate gating from ingestion;
the browser bridge test exercises completion without CommonJS.

The new behavior tests are also run against an exported pre-change tree with
its original generated dataset. Deliberate unchanged-behavior guards can pass
there. Corrupted catalog values, marker shapes and member populations must fail
before restoration passes. Existing weapon-twin, Adamancy and Arcsteel checks
remain part of the full applicable suites. A player-facing release advances
all three build stamps and cache-bust versions together.

The measured dataset delta is exactly four of 9,173 item records; the other
9,169 are identical to the base. Only the two reviewed catalog definitions
change; all other 280 definitions and the crafting membership pools are unchanged.
