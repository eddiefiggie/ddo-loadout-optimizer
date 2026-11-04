# Compound spell attribution — local validation

Base: `96614a5f53e111c1fa5a7b4e1d6d04e48f52f8f6`, the actual main used for the
isolated `codex/compound-spell-attribution` branch. This report records local
builds, regression fidelity, data measurements and independent review. The main
checkout was not used for implementation.

## Measured dataset change

Both base and branch were rebuilt from actual repository sources. Each contains
9,173 item variants, with no added or removed IDs. Exactly **41 items** change:
only `affixes` and the derived `eligible_affix_count`. Exactly **71 compound
affix records become 144 component records**. A per-record comparison confirms
that each component retains the source value and bonus type and carries the exact
origin; there are no unrelated item changes. Two Frozen Thunderstorm sources
have three components; the other 69 sources have two.

All top-level data channels other than `items` and `metadata` are identical,
including crafting and set-definition pools. The exact census and changed IDs
are in [the measured diff](2026-11-04-compound-spell-dataset-diff.json).

The seven metadata changes are accounted for:

- `expanded_away_names` and `provenance_labels`: the 15 admitted names and their engraved labels.
- `rankable_affixes`: those 15 standalone names leave the numeric picker; no new numeric targets are invented.
- `umbrella_detector`: seven fully representable lores retire from atomic adjudications, 33 to 26.
- `affix_type_cross_check`: the same 15 sources move from direct agreement to agreement through components; no new disagreement.
- `compound_spell_evidence`: the new guard inspects 1,476 names, identifies 25 reviewed compounds, expands 15 and retains 10 unchanged.
- `build_id`: changes because the item data changed.

The controlled actual-item solve uses Epic Storm through `normalizeDataset`,
`buildModel` and real HiGHS. Base totals are 20 Magnetism, 20 Resonance and zero
Lightning/Sonic Lore. Branch totals are **131, 131, 16, 16**: 111 Equipment power
plus its unchanged 20 Implement Universal Spell Power. Results and Markdown
exports retain the Power of the Thunderstorm and Thunderstorm Lore engravings.

## Regression fidelity and review

The new Python behavior tests run against archived actual main with a separately
rebuilt base dataset. Seven new-behavior tests fail; two deliberate unchanged
boundary/universal guards pass. The six new guard tests also fail against that
base because the guard did not exist. This is not a missing-data pass.

The 13-test JavaScript regression has two pre-change matrices, each with Node 20:

| Source | Dataset | Passed | Failed | Purpose |
|---|---|---|---|---|
| Actual old base | Rebuilt base | 2 | 11 | Attribution and migration differ from the old implementation. |
| Actual old base | Rebuilt branch | 4 | 9 | All five source-exclusion solver cases fail when expanded data reaches old code. |
| Branch | Rebuilt branch | 13 | 0 | New behavior and compatibility assertions pass together. |

Old-code/current-data is necessary: before expansion, a compound exclusion could
appear harmless simply because no component contribution existed to suppress.
The second matrix shows that the new filtering is necessary after expansion.

Independent reviewers checked the retained mechanics separately from the code.
Review findings resolved in this branch include:

- Partial Evil/Force/Light coverage cannot fill broader existing buckets; those whole compounds remain unchanged.
- The Insight and Quality Frozen Storm sources must preserve their types.
- Saved credits must split before orphan cleanup; original same-source credit/skip conflicts still give the credit precedence.
- A source exclusion must run before dominance and same-host maximum selection, keep native alternatives, and remain specific to its origin/type.
- Filtered scoring views must restore full physical item and crafted-option affixes for result/export text.
- Source exclusions must remain visible and removable after save/reload even when priority substitution no longer fires.
- Coverage requires a source census and definition-drift guard, with deliberately corrupted inputs proving rejection.

## Scope and source limits

Eight spellpower and seven independently verified lore compounds are covered.
The remaining ten names are deliberately unchanged: six have residual damage
scopes that existing buckets cannot express, and four lack direct retained
definitions. This does not claim full resolution of #928.

The evidence is September's retained Wiki tooltips, with capture dates and carrier
URLs but no definition revision IDs or times. Supplemental November lookup was
denied by robots.txt; no alternate transport was used. Exact mappings, sources,
negative boundaries, credit/exclusion semantics, and historical bound disclosure
are recorded in [the ruling](../wiki-evidence/compound-spell-attribution.md).
The initiating contributors are [peng, September 30](https://forums.ddo.com/index.php?threads/ddo-loadout-optimizer-your-best-in-slot-gear-proven-by-math.29709/post-443342)
and [galvarian, November 2](https://forums.ddo.com/index.php?threads/ddo-loadout-optimizer-your-best-in-slot-gear-proven-by-math.29709/post-457897).

Final full-suite runs pass on the reviewed implementation:

| Gate | Result |
|---|---|
| `python3 tests/run_tests.py` | 1,882 passed, 0 failed; 716.53 seconds. |
| `bash scripts/run_js_tests.sh` with Node 20 | All 53 files passed: 3,145 tests, 0 failed; 308.78 seconds, including all 44 solver snapshot/source assertions. |
| `node tests/perf_utility.js` with Node 20 | PASS across all 24 fixtures; 174.84 seconds. Of these, 21 meet the 200 ms timing floor. Paired totals 43,845 ms baseline / 70,418 ms with Utility: weighted 1.61× ≤ 1.75× budget; worst measured ratio 3.25× ≤ 5.00× budget. |

The Python result remains applicable through the subsequent JavaScript test-only
ratifications: production and Python files did not change. Earlier incomplete
attempts and their specific resolutions are recorded below.
The performance run was isolated from the base-negative probes. All three build
stamp locations agree on `11042026.1`, advancing from `11012026.5`; tree consistency
is included in the Python pass. The directional stamp check is recorded separately
against the committed head and the base named at the top of this report.

The first full Python attempt was stopped after its existing tooltip test failed
on the old direct-agreement threshold. It is an incomplete, failed attempt, not a
passed suite. The assertion now counts both direct and component-backed agreement:
164 + 7 becomes 149 + 22, with 171 total agreements and 172 comparisons unchanged.
This is a measured coverage correction, not a golden result acceptance. The
source guard was also tightened to reject a nonempty census containing zero
compound candidates; its corruption test exercises that case.

A separate targeted native-schema run initially reported 9 passed / 1 failed:
`origin_stat` was absent from the closed affix-key allowlist. The test now permits
that one intentional native metadata field, with its exact source-exclusion
purpose documented; every other unknown key remains rejected. This is distinct
from the tooltip-coverage correction and does not change production behavior.

Independent final reviews both report **PASS, no unresolved findings**:

| Review | Independent checks |
|---|---|
| Goldfinger — mechanics and source evidence | 150 exact mapping/type probes; 30 HiGHS solves; 27 guard controls, including 24 deliberate refusals; four corrupted full builds rejected, including a crafting-only unknown compound. Final zero-candidate guard rechecked. |
| Blofeld — architecture, code and compatibility | Actual generated-item solve/render/export checks; seven source-exclusion adversarial checks; execution of the live saved-load and removal-handler code; all 13 new JS regressions; exact 41-item dataset comparison. Final 24 tooltip, six guard and ten native-schema tests pass, with unknown/legacy field corruption still rejected. |

The reviewers did not author the production implementation. Their conclusions
apply to the admitted subset and explicit unchanged scope above; neither asserts
fresh current-Wiki verification or full closure of #928.

The first full JavaScript attempt stopped at the override-population census;
performance had not run. Independent measurement through the actual
`normalizeDataset`, `classifyPool` and `isEligible` functions reconciles every pin:

| Override census | Base | Branch | Delta |
|---|---|---|---|
| All normalized affixes | 45,771 | 45,844 | +73 = 144 − 71 |
| Override-eligible affixes | 20,648 | 20,577 | −71 |
| Eligible worn-item affixes | 13,484 | 13,443 | −41 |
| Eligible weapon affixes | 6,259 | 6,229 | −30 |
| Eligible augment affixes | 905 | 905 | 0 |

All 71 original compound records were override-eligible; all 144 generated
components carry `via` and are ineligible under the existing generated-component
rule. No unrelated affix changes classification. The three census assertions and
stale test title are corrected with this arithmetic; override policy is unchanged.
A practical existing expansion limitation therefore applies here too: generated
components cannot be overridden individually, and an old override naming the
removed compound is suspended by the existing unmatched-target disclosure.

## Three solver ratifications

The second full JavaScript attempt reached the solver snapshots and reported
40 passed / 3 failed there; performance had not run. Those three changed solves
were investigated before updating their expectations. Actual archived base code
with its rebuilt dataset reproduces all three previous records exactly. Current
code with that same base dataset independently reproduces them too. Current
source with the rebuilt branch data supplies the three accepted outcomes below;
the other 21 snapshot records and the fixture definitions are untouched.

All three select Alaric's Grim Gauntlets. Its retained **Power of the Dark
Restoration, Equipment 155** now reaches Devotion and Nullification, retaining
the original engraving. This is the only changed item record among the selected
loadouts; all other new choices already had the same data at base. The named
source assertion in `solver_golden.test.js` requires these exact two components
and keeps all three fixtures exercising the carrier.
Run alone against archived actual base code and rebuilt base data, that assertion
fails on the missing two components (0 passed / 1 failed, exit 1), after the real
fixture solves complete; it does not fail on a missing dataset or dependency.

For `endgame-caster-ml32`, earlier priorities Universal Spell Power 54,
Combustion 411 and Corrosion 387 remain fixed. The first improvement is Devotion
377 → 382: Equipment 150 from Epic Halcyonia becomes 155 from the gauntlets.
Reoptimization preserves Combustion/Corrosion Artifact 30 using Astute Alchemist
instead of the former two sets, and selects the following unchanged sources:

| Later target | Base → branch | Exact changed bucket arithmetic |
|---|---|---|
| Glaciation | 278 → 345 | Equipment 139 → 153 from Dread Pirate's Cloak (level 32), Insight 20 → 49 from Legendary Dusk Lenses, Quality 0 → 24 from Legendary Mystic Wrappings: +14 +29 +24 = +67. |
| Impulse, Radiance, Reconstruction, Resonance (each) | 169 → 290 | Equipment Potency 30 → 98 from Legendary Dusk Lenses, Insight 20 → 49, Quality 0 → 24: +68 +29 +24 = +121. |
| Magnetism | 169 → 345 | Equipment 30 → 153 from Dread Pirate's Cloak (level 32), Insight 20 → 49, Quality 0 → 24: +123 +29 +24 = +176. |
| Nullification | 290 → 352 | Equipment 151 → 155 from Dark Restoration, Insight 20 → 49, Quality 0 → 24, Artifact 25 → 30 from Astute Alchemist: +4 +29 +24 +5 = +62. |
| Wisdom | 26 → 27 | Quality 2 → 3 from Nearly Finished: +1. |

Charisma remains 25. Utility remains seven with the same secured effects and
ordered outcomes. No later numeric target decreases. Universal Implement 39 and
Exceptional 15 contribute exactly once to each spellpower throughout.

For `trance-credit-additive-ml32` and its baseline twin, Devotion changes
422 → 424 and 410 → 412 respectively. Equipment 153 from Ruby of Devotion is
replaced by Dark Restoration's 155; every other Devotion bucket is unchanged.
Wisdom 34 and Universal Spell Power 54 remain fixed, the Sacred credit still adds
exactly 12, and the two resulting worn loadouts remain identical. The freed
Purple socket takes the Red Encyclopedia of the Dead, Vol. 1 instead of the
Devotion ruby, adding Ghost Touch: utility 12 → 13 with all former effects kept.

Both independent reviewers approved exactly these three records after checking
source magnitudes, same-type maxima, cross-adds and receipts. Every final effective
value equals its staged lexicographic lock, and every receipt sum reconciles.
The source captures and bucket arithmetic are retained in
[the ratification evidence](2026-11-04-compound-spell-golden-ratification.json).
