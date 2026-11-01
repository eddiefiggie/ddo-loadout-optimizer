# Flat Natural Armor set bonuses

Reviewed 2026-11-01 for #951 / #908. This ruling restores eight missing flat AC
clauses in five sets. It does not settle the unrelated Wiki disagreements in #956
or complete migration of production set definitions away from gear-planner.

## Direct evidence

The [Named item sets page, revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
and [its template, revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
independently state all eight amounts, types and thresholds below. Both were read
as wikitext and rendered tooltips in a same-origin Wiki tab on 2026-11-01. No
value is selected by agreement with gear-planner. The page's HELstats tiers must
be expanded separately; Heroic, Epic and Legendary members are distinct sets.

| Set | Required pieces | Flat AC | Type |
|---|---:|---:|---|
| Might of the Abishai | 3 | 3 | Profane |
| Might of the Abishai | 5 | 5 | Profane |
| Epic Might of the Abishai | 3 | 5 | Profane |
| Epic Might of the Abishai | 5 | 8 | Profane |
| Legendary Might of the Abishai | 3 | 10 | Profane |
| Legendary Might of the Abishai | 5 | 10 | Profane |
| Wayward Warrior | 2 | 2 | Artifact |
| Wayward Warrior (Legendary) | 2 | 5 | Artifact |

The clauses require equipped members of the same set and tier. They state no
additional timed, stance, target, pet, or on-hit condition. The same set bonuses
are present in the rendered item tooltips checked directly:

- [Belt of the Black Abishai, revision 628530](https://ddowiki.com/index.php?title=Item:Belt_of_the_Black_Abishai&oldid=628530),
  [Epic, revision 658847](https://ddowiki.com/index.php?title=Item:Epic_Belt_of_the_Black_Abishai&oldid=658847),
  [Legendary, revision 631814](https://ddowiki.com/index.php?title=Item:Legendary_Belt_of_the_Black_Abishai&oldid=631814).
- [Giant's Platter, revision 653036](https://ddowiki.com/index.php?title=Item:Giant%27s_Platter&oldid=653036),
  [Scales of the Exile, revision 708407](https://ddowiki.com/index.php?title=Item:Scales_of_the_Exile&oldid=708407),
  [Legendary Giant's Platter, revision 653031](https://ddowiki.com/index.php?title=Item:Legendary_Giant%27s_Platter&oldid=653031),
  [Legendary Scales of the Exile, revision 708432](https://ddowiki.com/index.php?title=Item:Legendary_Scales_of_the_Exile&oldid=708432).

[Natural armor bonus, revision 682710](https://ddowiki.com/index.php?title=Natural_armor_bonus&oldid=682710)
explicitly describes its contribution to AC and distinguishes plain Natural from
bonuses carrying another type. It separately lists both Wayward amounts as
Artifact. [Template:NaturalArmor, revision 594274](https://ddowiki.com/index.php?title=Template:NaturalArmor&oldid=594274)
uses its explicit prefix to name the bonus type.
[Profane bonus, revision 613196](https://ddowiki.com/index.php?title=Profane_bonus&oldid=613196),
[Artifact bonus, revision 636950](https://ddowiki.com/index.php?title=Artifact_bonus&oldid=636950),
and [Stack, revision 669682](https://ddowiki.com/index.php?title=Stack&oldid=669682)
establish the same-type maximum. Thus five Heroic Abishai pieces grant 5 Profane
AC, not 3+5; five Legendary pieces grant 10, not 10+10. A stronger Profane source
replaces this contribution. Plain Natural and Artifact remain separate types.

## Production boundary

The raw catalog already supplies the correct eight values as `Armor Class` with
`Profane Natural` or `Artifact Natural` types. The strict set synthesizer previously
quarantined those types, so the built sets supplied no AC. `natural_armor_sets`
now verifies the exact reviewed population before translating those two types
**only for flat Armor Class** to the existing Profane/Artifact buckets. Values
still come from the one raw catalog. The reviewed tuples are rejection guards,
not a second definition source. Raw vendor inputs stay unchanged.

Production build and complete catalog loads reject missing/extra/duplicate rows,
changed magnitudes, types, stats or thresholds, absent sets, zero records, and new
occurrences of either composite type. Even an upstream conversion to the canonical
type requires review and retirement/update of the correction. Small synthetic
catalog callers may omit whole sets; any reviewed set present must be complete.

The harvest reader accepts only flat `Natural Armor` wording. Percentage forms
remain quarantined even if a caller supplies a percentage vocabulary; no source
here establishes whether a percentage applies to Natural Armor or total AC.
Existing conditions and unknown types remain excluded. The comparison tool uses
the same stat-specific type mapping, preserves magnitudes and multiplicity, and
requires the complete source guard in both CLI output modes. Existing full-source
revision/hash guards in `set-count-review.json` still reject Wiki source drift.

The shared catalog feeds item membership, Dino and craftable membership readers.
None of the five sets is a Dino/craftable membership choice. Existing Gem of Many
Facets pools include the three Abishai tiers; the solver uses the equipped member's
corrected definition. No wildcard rule changes. The existing Lunar Gem
`Profane Natural` equivalence now competes with the restored set AC in one bucket.

## Permanent quality control

`tests/fixtures/natural_armor_sets.json` retains the verbatim bonus bodies from the
two pinned sources, eight expected clauses, and sixteen real equipment fixtures.
It is test evidence and is never read by production. `test_natural_armor_sets.py`
covers the readers, comparison, complete source mutations, all affected member
definitions, and preservation of unrelated catalog/crafting definitions.
`natural_armor_sets.test.js` uses the generated dataset and real HiGHS solver.

The sixteen baseline gear-AC contributions (not total character AC) are:

| Equipment fixture | Prior build | Corrected |
|---|---:|---:|
| Heroic Abishai, 2 / 3 / 4 / 5 pieces | 0 / 0 / 0 / 4 | 0 / 3 / 3 / 9 |
| Epic Abishai, 2 / 3 / 4 / 5 pieces | 0 / 0 / 0 / 9 | 0 / 5 / 5 / 17 |
| Legendary Abishai, 2 / 3 / 4 / 5 pieces | 0 / 0 / 0 / 14 | 0 / 10 / 10 / 24 |
| Heroic Giant's Platter alone / with Scales of the Exile | 22 / 45 | 22 / 47 |
| Legendary versions of that single / pair | 46 / 92 | 46 / 97 |

These fixtures have no stronger competing Profane/Artifact AC source. Tests also
cover weaker/equal/stronger same-type sources, plain Natural coexistence, real
Lunar gems, both Abishai thresholds with Gem of Many Facets, mixed-tier rejection,
set pins, projection/saved exports, and set-augment display suppression. The
below-threshold and stronger/equal-source cases deliberately guard unchanged
behavior. They are expected to pass on the pre-change tree. Positive restoration
and source-boundary tests must fail there by assertion.

No solver rules, item affixes, disputed Sneak Attack/DC/Heal Amp values, percentage
bonuses, or other Wiki conflicts are changed by this ruling.
