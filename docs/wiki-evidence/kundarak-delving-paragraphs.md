# Kundarak Delving Equipment: three explicit bonus sentences

Reviewed **2026-11-03 UTC** against main
`b039d92d94e356acb5944f6a2db077f30c48d78c`, under
[#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) and
[#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908).
This is a comparison-only parsing improvement. Production set definitions,
membership, activation, stacking, solver behavior and the UI are unchanged.

## Retained Wiki evidence

The verified `pages-20261101-review` harvest contains
[Template:Named item sets revision 723530](https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530),
page ID 15874, with `revid` and `html_revid` both 723530. The complete retained
wikitext SHA-256 is
`319adf3d1643d50397b103672a16aa2136f27c5e31e131128a1eb1a84bcd977a`.
This review uses retained source; it does not claim a fresh Wiki retrieval.

Each of the three entries explicitly states `3 Pieces Equipped:` and these
three sentences, with the corresponding numbers below:

```text
+1 Artifact bonus to Sneak Attack Dice. +5% Artifact bonus to Helplessness Damage. +5% Artifact bonus to Doublestrike and Doubleshot
+2 Artifact bonus to Sneak Attack Dice. +10% Artifact bonus to Helplessness Damage. +10% Artifact bonus to Doublestrike and Doubleshot
+3 Artifact bonus to Sneak Attack Dice. +15% Artifact bonus to Helplessness Damage. +15% Artifact bonus to Doublestrike and Doubleshot
```

| Explicit display name | Sneak Attack Dice | Helplessness Damage | Doublestrike and Doubleshot |
|---|---:|---:|---:|
| Kundarak Delving Equipment | +1 Artifact | +5% Artifact | +5% Artifact |
| Epic Kundarak Delving Equipment | +2 Artifact | +10% Artifact | +10% Artifact |
| Legendary Kundarak Delving Equipment | +3 Artifact | +15% Artifact | +15% Artifact |

The three full switch-entry lines are preserved verbatim in
`tests/test_kundarak_set_paragraphs.py` and checked against the retained source.
The structural reader includes the following alphabetic section marker,
`<!-- L -->`, in the Heroic entry's raw text. That exact suffix is also pinned;
it is not bonus text or an activation condition.

| Switch key | Complete raw-entry SHA-256, after extracting display-name metadata |
|---|---|
| `kundarak delving equipment` | `d583d0d248bf6e3a2d9f6302ec04f179a3d1c7cb9dde853a8511a248b50534eb` |
| `epic kundarak delving equipment` | `18699c247498aa998ffaac34c5533d5f483c26bd48ccaeb7e592834fcfb31a94` |
| `legendary kundarak delving equipment` | `3ca06dc6919c9f1da8dbeddcfbfa6d0fd32873aabebd7354a8e02e9e1b1abb1c` |

## Narrow parsing boundary

The comparison splits a copy of a paragraph only when its switch key,
display name, full raw-text hash, single three-piece tier and complete paragraph
match the reviewed entry. It removes only the Heroic entry's exact section
suffix for the final structural comparison. All three sentences then pass
through the existing clause reader, including its vocabulary and unit checks.
Both catalog and Wiki-to-Wiki comparisons use that copy. No generic sentence
splitting, name alias or production reader change is introduced.

`Sneak Attack Dice` is the source's explicit name here. This supplies no
definition for Vulkoor's separate `Sneak Attack` or `Sneak Attack Damage`, no
Deception equivalence, and no damage formula. The existing
[Helplessness Damage mapping](helpless-damage.md) already has Wiki evidence;
the final sentence explicitly names both Doublestrike and Doubleshot. These
are existing reader capabilities, not conclusions drawn from catalog agreement.

Edited text, units, conditions, identities, counts or section context receive
no additional parsing. The aggregate full-source revision/hash gate also
requires review of changed source context. A catalog disagreement stays visible;
an absent vocabulary entry stays quarantined, and extra catalog occurrences
remain `catalog-unmatched`. Unknown source text is never interpreted as zero.

The real page's unusable names remain `no-wiki-name`; the test's synthetic page
rows exercise comparison without asserting aliases. Equipment-specific and
conditional activation, the Vulkoor ruling, critical-multiplier stacking and
the disputed Wiki values remain outside this slice. Issues #908, #951, #953
and #956 remain open; production adoption requires a separate decision.

## Measured result

Both complete CLI formats pass the retained-source review gates across all
282 catalog sets. Exactly the three Kundarak Template results move from
`partial` to `exact`: Template totals become **119 exact and 101 partial**
(previously 116 and 104). All 148 previously exact comparisons remain exact.
Every page result, all other 279 per-set records, and all other report fields
are unchanged, including the four `ours-differs` sets and source disagreements.

All 190 production-file hashes, including generated data and the shared
reader, remain unchanged. The build stamp remains `11012026.5`.

Eight focused tests pass. Five new-behavior tests fail by assertion on an
exported copy of the base commit above; the three unchanged-boundary guards
pass there. Nine deliberate in-memory corruptions are rejected: empty review
coverage, missing Legendary coverage, bypassed text hash, an unreviewed switch
key, changed display-name metadata, bypassed vocabulary, a Dice-to-Deception
fold applied to both source and catalog, dropped duplicate occurrences, and
mutation of the source entry. All eight tests pass again after restoration.

The complete local Python suite passes **1,823 tests with zero failures**.
JavaScript and performance checks run in the draft PR's full CI; no local
rerun of those unchanged production paths is claimed here.
