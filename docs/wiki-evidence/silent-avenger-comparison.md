# Silent Avenger: two explicit three-piece entries

Reviewed **2026-11-03 UTC** against main
`6809863a32bc84473f44ee23b74322d7f349ce9d`, as partial progress on
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) under
[#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908).
This is a comparison-only prefix adjustment. No production definition,
activation, stacking, shared reader, solver, UI or build stamp changes.

## Actual retained source

The verified `pages-20261101-review` harvest contains
[Template:Named item sets revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530),
with matching `revid` and `html_revid`, page ID 15874. The complete retained
wikitext SHA-256 is
`319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a`.
This uses retained primary text; it does not claim a fresh Wiki retrieval.

The Heroic switch entry explicitly names **Silent Avenger Set (Heroic)** and
states `3 Pieces Equipped:` followed by these four clauses:

```text
You gain a 5% [[Artifact Bonus]] to [[Doublestrike]] and [[Doubleshot]].
You gain +1 Artifact Bonus to Sneak Attack Dice.
You gain a 10% Artifact Bonus to Fortification Bypass.
You gain +5% Artifact Bonus to Damage vs. Helpless opponents.
```

The Legendary entry explicitly names **Silent Avenger Set (Legendary)** and
states the same three-piece threshold, with:

```text
You gain a 15% [[Artifact Bonus]] to [[Doublestrike]] and [[Doubleshot]].
You gain +3 Artifact Bonus to Sneak Attack Dice.
You gain a 30% Artifact Bonus to Fortification Bypass.
You gain +15% Artifact Bonus to Damage vs. Helpless opponents.
```

The complete switch entries, including display-name metadata, are retained
verbatim in `tests/test_silent_avenger_comparison.py`. Their parsed raw bonus
contexts have these SHA-256 hashes:

| Exact switch key | Raw bonus context SHA-256 |
|---|---|
| `silent avenger set (heroic)` | `dd3981b49bf916991b0c145dd249997513bd4e244f2dd5516956ce2a4413d227` |
| `silent avenger set (legendary)` | `98de6298a004e28f1b70f2927f3d629a3adbc2c75bb58ee7f034c153a27b7f5d` |

## Narrow interpretation and unresolved evidence

Both entries explicitly state their values, types, units and threshold. Removing
only the literal `You gain a ` / `You gain ` prefixes lets the existing reader
read those clauses. Its existing Fortification Bypass and helpless-damage name
mappings remain unchanged; their evidence is recorded in
[Named item sets structure](named-item-sets-structure.md#fortification-bypass-951-2026-10-28)
and [helpless damage](helpless-damage.md). `Sneak Attack Dice` is explicit here;
no Deception equivalence, meaning for bare Sneak Attack, dice size or damage
formula is inferred.

**An older local evidence note quotes a different helpless-damage amount.**
`helpless-damage.md` records an August Helpless-page reading of Silent Avenger
as **5% / 10%**; the retained Template revision above prints **5% / 15%**.
This slice does not determine which value describes live-game behavior, claim
that the older note is stale, or choose a value by catalog agreement. It reads
the retained Template exactly as written for comparison. The historical numeric
discrepancy remains unresolved within the broader evidence work under #956.
The existing name mapping is reused without using that note's numbers as an
authority for this entry. No production value is changed.

An `exact` result here means this Template's explicitly read affix multiset
matches the current catalog. It does not mean every Wiki source agrees, the page
identity is resolved, production adoption is approved, or live-game behavior
has been verified. Both real page comparisons remain `no-wiki-name`.

## Guards and measured scope

The comparison requires source title/revision, exact switch key and display
name, complete raw bonus-context hash, the single three-piece tier, four lines,
and the complete raw structure reconstructed from those lines. Only comparison
copies lose their literal prefixes. Raw text and parsed inputs remain intact;
the aggregate full-source hash/revision review also guards the outer source.
Every resulting clause passes through the existing vocabulary gate.

Changed identities, values, units, types, thresholds or source context receive
no new reading. There is no generic `You gain` rule: conditional or proc wording
such as `You gain On Vorpal` remains unreviewed, as do summon bonuses and the
Vulkoor fields. Critical-multiplier stacking, activation conditions, unresolved
page identities and the production-source switch stay outside this slice.
Issues #908, #951, #953 and #956 remain open.

Both complete CLI formats pass their source-review gates across **282 sets**.
Only these two Template results move from partial to exact: **119 to 121 exact**,
**101 to 99 partial**. All page results, the other **280 set records**, every
other report field, and all **151 previously exact comparisons** are unchanged.
All **190 production hashes** remain unchanged, including generated data and
the shared reader; build `11012026.5` is unchanged.

Nine focused tests cover the five resulting fields per variant, catalog
disagreements, duplicate occurrences, vocabulary, independent entry coverage,
source drift and input preservation. The five tests for new behavior fail by
assertion on the pre-change tree; four unchanged-boundary guards pass there.
Deliberate implementation corruptions are checked separately. The test's outer
switch wrapper is synthetic; its two parsed entries match the retained source.
