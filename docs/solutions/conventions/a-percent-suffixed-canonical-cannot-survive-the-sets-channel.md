---
title: A "(%)"-suffixed canonical cannot survive the sets channel — fold it at the parse seam instead
module: pipeline
date: 2026-09-03
problem_type: convention
component: data-pipeline
severity: medium
related_components:
  - src/name_corrections.py
  - src/set_parser.py
  - src/set_tier_folds.py
  - src/set_catalog.py
tags:
  - naming
  - percent
  - unit-marker
  - set-bonuses
  - seam-choice
  - text-round-trip
  - buckets
  - provenance
applies_when:
  - "Adding an affix_name_corrections.json entry whose canonical ends in ' (%)'"
  - "Folding a set-tier spelling onto a canonical that already exists on items"
  - "Choosing between name_corrections and the set_parser parse seam for a naming fix"
  - "A rename looks right in the built dataset but the paired alias resolves to a name no tier carries"
---

## Context

#695: the Eminence of Autumn 4-piece is `+10% Legendary bonus to Maximum Spellpoints`
on the wiki, and reached us as the name `Maximum Spellpoints` — a third spelling
belonging to neither canonical. The flat pool is `Wizardry` and the percent pool is
`Maximum Spell Points (%)` (#639 split them), so it should fold to the latter.

The obvious mechanism is an `affix_name_corrections.json` entry, and it satisfies
both rules in `name-corrections-canonical-must-be-a-raw-upstream-name.md`:
`Maximum Spell Points (%)` **is** a raw upstream name (7 item occurrences), and the
sets-channel correction runs before `catalog_from_raw` synthesizes.

**It still cannot work**, for a reason neither rule covers.

## The mechanism

The sets channel round-trips through TEXT. `catalog_from_raw` rebuilds a tier's
text from its raw affixes, and `set_parser` re-parses that text. So a rename there
is laundered through the parser, and the parser reads a trailing `(%)` as a
percent marker on the VALUE:

```
declared canonical:   "Maximum Spell Points (%)"
synthesized tier raw: "+10% Legendary bonus to Maximum Spell Points"
materialised stat:    "Maximum Spell Points"   unit="pct"
```

The canonical you declared is not what the tier ends up carrying. Two consequences,
and the second is the one that bites:

1. Tier `raw` is rewritten, so the set no longer says what the wiki engraved — and
   on a `merge_into_existing` the `via` receipt does not survive the re-parse
   either (measured: all 20 occurrences came back `via: null`, and no set-tier
   affix anywhere carries a `via` from a name correction). That breaks the merge
   contract in `src/name_corrections.py`: *"a merge must not change what the item
   says it has."*
2. `test_every_correction_has_a_matching_alias_so_the_upstream_name_still_resolves`
   forces the alias to equal the DECLARED canonical. A player typing the old name
   therefore canonicalizes to `Maximum Spell Points (%)` — a string the tier does
   not carry — and scores **zero** on all 20 occurrences. Strictly worse than
   leaving the bug alone.

## Guidance

**Fold at the `src/set_parser.py` parse seam** (`src/set_tier_folds.py`), which sets
`stat` directly and never touches the text. Tier `raw` stays verbatim, the canonical
survives exactly as written, and no alias is owed because no rename happened
upstream of the parser.

This is the same seam #305 chose for the helpless family and #683 identified for the
critical-multiplier fold, for the same underlying reason: **set-tier affixes are
`stat`-keyed and produced by a parser, so a `name`-keyed rename upstream of that
parser is not the same operation as it is on the item channel.**

### Scope the seam with an allow-list, not "every local family"

`src/set_tier_folds.py` reads `vocabulary._local_synonym_folds` filtered through an
explicit `SET_TIER_CANONICALS`. Two traps this closes:

- **`vocabulary.registry_synonym_folds()` is NOT the local section.** It merges
  upstream's `affix_synonyms` table (134 spellings: `Accuracy` <- Attack,
  `Armor Class` <- Shield, PRR) with the local one. Applying it here is the mass
  drift `helpless_fold`'s own SCOPE note declined. A note on #683 described widening
  this seam "to every `local_affix_synonyms` family" while naming the merged
  function — which would have shipped exactly the drift it believed it was avoiding.
- **Even genuinely-local families can be wrong to fold here.** `Well Rounded` is
  reviewed and local, and folding `all Ability Scores` at this seam changes what
  `parse_piece_text` returns — pinned by `tests/test_set_parser.py` — while making
  no difference to the built dataset, because a later pass already canonicalises and
  expands it. Measuring "no fold-away spelling survives in the dataset" does **not**
  prove a parse-seam widening is inert; that measurement passed while the widening
  broke a pinned unit test.

## Verification that actually discriminates

Copying only the new test file onto the base tree yields an ImportError, which
proves nothing but the module's novelty. Copying the new **module and registry**
onto the base tree while withholding the **seam wiring** is the discriminating run:
9 of 11 tests pass (they are module-unit tests) and exactly the 2 behavioural ones
fail — the parse-seam assertion and the built-dataset assertion.
