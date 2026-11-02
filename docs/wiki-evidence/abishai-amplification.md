# Legendary Abishai amplification comparison ruling

Recorded 2026-11-02 for #951 / #908. Only two Legendary comparison clauses are
interpreted here. The production catalog already supplies these bonuses; this
change does not add a player bonus, change build 11012026.5, or complete the set
migration.

## Direct evidence and freshness

The [Named item sets page, revision 720202](https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202)
was captured as wikitext and rendered HTML at **2026-11-01 22:07:07.452869 UTC**.
The [set template, revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530)
was captured at **22:07:09.432316 UTC**. These are retained same-origin Wiki
browser captures from the Natural Armor investigation. Their relevant verbatim
bodies remain in `tests/fixtures/natural_armor_sets.json`; fixture wrappers are
test scaffolding, not source text.

| Source | SHA-256 of captured wikitext |
|---|---|
| Named item sets | `73ee1aa49cbf1ccf4bd660af325d53b9e96da17d0a840950b46e81606946441d` |
| Template:Named item sets | `319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a` |

A normal request to the Named item sets page at **2026-11-01 23:52:29 UTC**
returned HTTP 202 with an AWS WAF challenge and no article. That read stopped.
No fresh Wiki requests, challenge interaction or alternate access were attempted
for this change. This ruling is revision-scoped; current live Wiki freshness is
unverified.

## Exact scope

The page explicitly names `Positive, Negative and Repair Amplification`. Its
HELstats calls supply only Legendary amounts. The template calls these effects
`Heal Amp (all types)`; the rendered page agrees with the explicit three-member
list and labels the amounts Legendary.

| Exact set | Pieces equipped | Flat bonus to each named channel | Type |
|---|---:|---:|---|
| Legendary Might of the Abishai | 3 | +10 | Profane |
| Legendary Might of the Abishai | 5 | +30 | Profane |

Neither captured clause states an additional proc, duration, stance or target
condition, or a percentage. Heroic and Epic receive no amplification amount from
these clauses. No other meaning of “all types” is established.

[Profane bonus, revision 613196](https://ddowiki.com/index.php?title=Profane_bonus&oldid=613196),
captured **2026-11-01 22:07:15.323956 UTC**, states highest-only stacking for this
type. Five equipped pieces therefore supply 30 per channel, not 10+30.
[Legendary Belt of the Black Abishai, revision 631814](https://ddowiki.com/index.php?title=Item:Legendary_Belt_of_the_Black_Abishai&oldid=631814),
captured **22:08:56.656054 UTC**, confirms the exact set identity; its tooltip
transcludes the shared template and is not independent scope evidence.

The existing explicit-list reader maps Positive Amplification to the canonical
Healing Amplification name. Its standing evidence is
[Template:Fleshmaker, revision 479947](https://ddowiki.com/index.php?title=Template:Fleshmaker&oldid=479947),
recorded in [named-item-sets-structure.md](named-item-sets-structure.md). That
general naming source was not freshly reread. This change reuses the established
reader and vocabulary gate without adding a global alias.

## Guard and comparison boundary

`scripts/diff_harvest_sets.py` requires both pinned revisions, the exact Legendary
catalog identity, one exact template key and declared identity, unique page
anchors and tier records, both equip thresholds, flat amounts, Profane types and
the explicit three channels. It also hashes the complete normalized Legendary
tier contexts so a condition on another line cannot silently be discarded.

For each source, the digest input is `{str(threshold): [wiki_sets.plain(line), ...]}`
over all of its Legendary tiers, including any `None` preamble, serialized by
`json.dumps(context, sort_keys=True, separators=(",", ":"))` and UTF-8 encoded.

| Source | SHA-256 of normalized Legendary tier context |
|---|---|
| Template | `4b56e12cbe4479af076f72d59bbc3358c516bcb6fdb52e5095cbd45251b4ab33` |
| Page | `7783971e747d88c5970abc3d016923b1e4a74f13cf947d136e84bc3ad3912e75` |

Both full captures and the minimal verbatim fixture yield those receipts.
Context drift conservatively requires review even if the amplification number
itself did not change. The existing whole-source revision/hash gate additionally
guards changes outside these local contexts.

Only after this review succeeds does the comparison feed the page's actual
explicit clause through the existing reader. Missing vocabulary leaves the whole
clause quarantined. No catalog amount supplies or chooses a Wiki value: catalog
value/type/member differences remain visible as ordinary `ours-differs` results.
Missing, altered, duplicate, conditional or empty source evidence disables both
scoped readings and makes both CLI formats exit nonzero.

Legendary's template quarantines decrease from three to one: the ambiguous
three-piece DC clause stays quarantined and its category stays `partial`. All
three Abishai three-piece DC quarantines remain. The multi-tier page identity
gap remains under #953, and #956 disputes remain untouched. Other set records,
comparison-category counts and recorded disagreements are preserved. #951 and
#908 remain open for their broader scope.

## Permanent quality control

`test_abishai_amplification.py` tests both CLI formats, each channel and threshold,
source mutation/restoration, conditions on separate lines, duplicate identities,
empty/missing inputs, catalog disagreement and unknown vocabulary. Mutation
fixtures refresh the unrelated full-source receipts so the scoped guard must
reject the corruption independently. New-behavior tests must fail by assertion
against the pre-change tree; explicitly unchanged guards should pass.

`abishai_amplification.test.js` retains **21 real-HiGHS behavior cases**: Legendary
counts 2/3/4/5; Heroic/Epic negatives; weaker/equal/stronger Profane stacking at
three and five pieces; independent channel overrides; Artifact coexistence;
mixed tiers; and Gem of Many Facets at both thresholds. A further population
guard checks every current production item variant carrying the set's parsed
bonuses, refusing an empty population. These preservation tests intentionally
pass on the pre-change implementation. Production source paths and the rebuilt
dataset must remain byte-identical.
