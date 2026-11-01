# Unbreakable Adamancy: Luck PRR/MRR

**Verified:** 2026-11-01. Partial progress on #951, under #908.

## Source ruling

The current wiki was read in a Chromium tab, including same-origin API reads of
the wikitext and the two item pages' rendered tooltips. TLS verification stayed
enabled through the session proxy; no network or browser settings were changed.

| Source | Revision | Explicit evidence |
|---|---:|---|
| [Template:Named item sets](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530) | 723530 | Unbreakable Adamancy grants +5 Luck to both PRR and MRR when two set items are equipped. No additional activation condition is stated. |
| [Named item sets](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202) | 720202 | The Adamancy row independently states the two-piece +5 Luck PRR/MRR bonus. |
| [Luck bonus](https://ddowiki.com/index.php?title=Luck_bonus&oldid=606272) | 606272 | Multiple Luck bonuses do not stack; only the highest applies. |
| [Sheltering](https://ddowiki.com/index.php?title=Sheltering&oldid=595036) | 595036 | Sheltering grants the same amount to both ratings. Different bonus types stack; within one type only the highest applies. |
| [Epic Minos Legens](https://ddowiki.com/index.php?title=Item:Epic_Minos_Legens&oldid=684806) | 684806 | The rendered tooltip states Enhancement Sheltering +24 and the Adamancy two-piece +5 Luck bonus. |
| [Epic Chain of Conviction](https://ddowiki.com/index.php?title=Item:Epic_Chain_of_Conviction&oldid=684804) | 684804 | The rendered tooltip states membership in the same set and repeats its two-piece +5 Luck bonus. |

The item wikitext and rendered HTML have matching revision IDs. Both set-source
revisions and complete wikitext hashes still match the existing
`pages-20261101-review` harvest and `set-count-review.json`.

## Cause and scope

The raw set catalog already states Sheltering / Luck / 5 at two pieces. The
reviewed bonus-type vocabulary already includes Luck, and its disposition is
`legitimate`. However, `affix_parser.BONUS_TYPES` omitted it. `set_catalog`
therefore quarantined the only affix and emitted no usable set definition;
every Adamancy member reached the solver with membership but no bonus. The
wiki comparison also quarantined the explicit Luck clause.

Admit only Luck to that shared vocabulary. The existing catalog synthesis,
set parser, Sheltering expansion, two-piece activation and per-type maximum
then carry the bonus end to end. No source values, raw seeds, set-name aliases,
solver code, stacking equivalences or other bonus types are changed. Production
still uses the existing set catalog; this is not the #908 source switch.

The shared consumers were audited before choosing this change:

| Consumer | Use of the vocabulary | Measured current-data impact |
|---|---|---|
| `affix_parser`, through `variants` and `dino_parser` | Recognize explicit leading/trailing types in numeric text | Item affixes unchanged; bare `Luck` and `Good Luck` names retain their prior parsing. |
| `set_catalog` and `set_parser` | Validate catalog types, synthesize and parse tier clauses | Only Adamancy gains a usable definition. |
| `membership` | Parse chosen-membership sets and validate augment-set types | Both published set-definition channels unchanged. |
| `nearly_complete`, `viktranium`, `seal` | Validate typed options in seed readers | Every published crafting pool unchanged. |
| `diff_harvest_sets` / `wiki_sets` | Read typed wiki clauses for comparison | Adamancy becomes exact in each source; no other set comparison changes. |

A complete before/after build at base `c2f462be1d4a875fda361003761ad5ea52604a81`
changes only `set_bonus` and `parsed_set_bonuses` on these seven existing items:
Epic Chain of Conviction, Epic Death's Rampart, Epic Emerald Gaze, Epic Emerald
Guard, Epic Minos Legens, Epic Scales of Surety and Epic Seraphim. No items are
added or removed. Other top-level data sections are identical; only the expected
set coverage metadata and dataset build ID change. This is a measurement of
this build, not a claim about future catalog contents.

## Reproduction and checks

`tests/adamancy.test.js` loads the real generated catalog and normalizer, then
pins the two named items in a pool restricted to those items. It uses the real
model and HiGHS solver, with no fabricated gear or bonus values.

| Equipped gear / declared Luck | PRR | MRR |
|---|---:|---:|
| Epic Minos Legens alone | 24 | 24 |
| Helmet plus Epic Chain of Conviction, before fix | 24 | 24 |
| Same two pieces, fixed | 29 | 29 |
| Same two pieces, player declares Luck 3 or 5 | 29 | 29 |
| Same two pieces, player declares Luck 7 | 31 | 31 |

The declared values are test inputs through the existing player-credit path,
not claims that a particular item grants them. The two member definitions must
yield one Luck bonus, not two. The tests also require every catalog member to
carry exactly the two-piece definition. Parser tests exercise explicit Luck
syntax and the real catalog round trip. The comparison test requires Adamancy
to be exact while an invented bonus type remains quarantined.

The behavioral tests are run against an exported pre-change tree with its
original generated data. The one-piece and bare-stat cases deliberately pass
there too: they protect behavior that must remain unchanged.

The full solver golden check changes two of 24 fixtures. Both were reproduced
against the old dataset using the current solver before ratification:

- `endgame-tank-ml34`: Constitution 37 and Fortification 283 stay unchanged.
  PRR rises 126 to 131 from Luck +5. MRR rises 142 to 146: Luck adds 5 while
  Enhancement falls from 39 on the outgoing docent to 38 from Viktranium.
  Epic Emerald Guard and Epic Emerald Gaze complete Adamancy.
- `endgame-dex-ml36`: Dexterity 37 and Dodge 36 stay unchanged. PRR rises
  136 to 138: Luck adds 5 while Quality falls from 14 on the outgoing docent
  to 11 on Legendary Abyssal Compass. Epic Chain of Conviction and Epic Emerald
  Gaze complete Adamancy.

Only those two golden entries are re-ratified. The other 22 are identical.
