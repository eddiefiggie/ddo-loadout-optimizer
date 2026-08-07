---
title: "Impossible-looking affix values mean an upstream unit change, not corrupt data"
module: data-pipeline
date: 2026-08-07
problem_type: logic_error
component: tooling
severity: high
tags:
  - ddo
  - affix
  - vocabulary
  - upstream
  - gear-planner
  - synonyms
  - data-pipeline
  - exclude-until-verified
symptoms:
  - "A ranked stat scores zero against items that visibly grant it in game"
  - "Stored values are impossible for their apparent unit (movement percentages of 7, 11, 28)"
  - "A triage pass concludes the magnitude is unrecoverable and closes the issue as blocked upstream"
root_cause: "An upstream synonym table folded two distinct game mechanics under one affix name, changing the stored value's unit for a subset of items"
resolution_type: seed-plus-build-gate
---

# Impossible-looking affix values mean an upstream unit change, not corrupt data

> Notation: `{{Name|Arg}}` throughout is **literal MediaWiki template syntax** as it appears
> in DDO wiki page source — not a placeholder to substitute. The distinction between
> `{{Striding|N}}` and `{{Speed|MAG}}` is the subject of this learning.

## Problem

Issue #154: items with the `Speed` enchantment contributed nothing to a `Melee Alacrity`
or `Ranged Alacrity` priority, even though in game they grant both. A first triage pass
examined the stored values, found them impossible as movement percentages, and concluded
the attack-speed magnitude was **not recoverable** — closing the issue as blocked on
upstream. That conclusion was wrong, and the reasoning that produced it is the lesson.

## Symptoms

- Ranking `Melee Alacrity` matched 33 items when 174 grant it in game; `Ranged Alacrity`
  matched 20 when 153 do.
- The 194 items carrying a `Speed` affix stored values including 7, 8, 9, 11, 12, 14, 16,
  17, 18, 19, 21, 22, 23, 26, 27, 28 — none a multiple of 5, and therefore not valid
  movement percentages under the wiki's documented `+(5*X)%` formula.
- Two items on the same page disagreed: `Boots of Striding and Springing` and
  `Goatskin Boots (level 19)` both stored a bare `Speed` number that meant different things.

## What Didn't Work

**Inferring the unit from the data's shape.** The first pass reasoned: *if the stored
number were movement and the `5*X` formula held, then X would be derivable; the values are
not multiples of 5, so the relation does not describe what was captured, so X cannot be
recovered.* Every step is valid except the unstated premise — that the stored number is a
movement percentage at all. It is not. For 33 of the items it is a **rank**: the wiki
writes `{{Speed|XI}}`, which renders in game as "Speed XI" and means 30% movement plus 11%
attack speed. Converting the Roman numeral to an integer produced `11`, which then looked
like a corrupt percentage. The "impossible" values *were the answer*, wearing the wrong label.

**Treating an empty site-search as evidence of absence.** The same pass supported a
sub-verdict with a wiki search that returned nothing. `insource:` search is **disabled** on
ddowiki and returns empty even for strings that are demonstrably on live pages
(`"Topaz of Striding"` is one). The sub-verdict happened to be right, but the evidence
for it was worthless.

**Looking at the template source instead of its output.** `Template:Speed` is a nest of
`#switch` and `#ifexpr` branches that reads as self-contradictory — its Arabic branch maps
movement 30 to 15% attack speed while the prose page's formula implies 6%. Reverse-engineering
it produced a false contradiction. Rendering the template's own documented examples resolved
it immediately: the two branches are different **input conventions** (Roman = rank, Arabic =
movement percentage), not conflicting claims.

## Solution

Three parts, all on branch `fix/speed-split-and-material-gate` (unmerged as of this writing).

**1. Find the fold.** The upstream gear-planner repo (`illusionistpm/ddo-gear-planner`, not
this one) ships `site/src/assets/affix-synonyms.json` — an **external** path, vendored into
this repo at `data/seed/compendium/raw/gearplanner_affix_synonyms.json`. At the upstream
snapshot recorded in `data/seed/compendium/raw/SOURCE.json` it contains:

```json
{"name": "Speed", "synonyms": ["Striding", "movement speed"]}
```

DDO has two distinct enchantments here — `{{Striding|N}}` grants movement only, while
`{{Speed|MAG}}` grants movement *and* melee/ranged attack speed. Upstream folded them
under one name because both feed the same character-sheet number. The attack-speed half
was lost, and the stored value's unit silently changed for the Speed subset.

**2. Re-source from the wiki, with provenance.** `src/harvest.py` merges a browser-side
harvest into a seed shard where every value declares `stated`, `defaulted`, or `unsourced`,
and only `stated` is solver-eligible. This matters because `Template:Speed` documents that
its attack-speed numbers are hand-maintained and that **any magnitude nobody recorded
silently renders 5%** — so a 5% reading is not evidence of a 5% bonus. Result across 194
items: 181 stated, 12 defaulted, 1 unsourced.

**3. Split at one seam.** `src/speed_split.py` rewrites the folded affix at the
planner-record seam in `build_dataset.py`, before variant expansion and before the
rankable-affix vocabulary is derived, so the solver, browse, the picker, and the exports all
inherit one corrected affix block instead of each re-deriving it. At rest the dataset now
carries 201 `Movement Speed`, 174 `Melee Alacrity` (from 33), 153 `Ranged Alacrity` (from
20), and zero `Speed`.

The Roman-numeral items also had their **movement value corrected**, not just their missing
alacrity added: upstream stored the rank as if it were a percentage, so a rank-11 item read
as 11% movement when it is 30%. Two defects, one fold.

## Why This Works

The fold is upstream's, so no amount of downstream reasoning could recover what it dropped —
the missing component genuinely was not in the data. But the *unit change* was recoverable,
because the wiki still says which template each item uses. Separating those two questions is
what unblocked it: "is the value present?" (no) and "does the stored number mean what we
think?" (also no, and that one is answerable).

Splitting at the planner-record seam rather than at the load-time normalizer follows from
the data's nature. `web/dataset.js` already fans one affix into several (bare `Sheltering`
becomes Physical + Magical) and additively derives components via `COMPOSITE_COMPONENTS` —
but both are static name-keyed tables with fixed values, and a Speed rank is per-item sourced
data. Logic belongs in the normalizer; sourced values belong in a seed.

## Prevention

**Gate the fold.** `assert_affix_synonyms()` in `build_dataset.py` now diffs the vendored
upstream synonym table against a frozen registry
(`data/seed/compendium/affix_synonyms_registry.json`), mirroring the existing
`assert_crafting_vocab()` gate. Added, removed, and re-pointed folds each fail the build,
naming both sides so the reviewer's question is concrete: *are these the same game mechanic?*

The diff keys by **synonym**, not by canonical name. Moving a synonym between canonicals
leaves both the entry count and the mapping count unchanged, so a count-only check passes
while the mechanic quietly relocates under a different stat:

```python
# src/vocabulary.py — _synonym_folds() returns {synonym: canonical}
for syn in sorted(set(live_folds) & set(frozen_folds)):
    if live_folds[syn] != frozen_folds[syn]:
        raise IntegrityError(f"upstream re-pointed {syn!r} from ...")
```

Verify a gate can fail before trusting it. Removing the `Striding` fold from the vendored
table produces `upstream no longer folds 'Striding' into 'Speed' (dropped-fold event)`;
restoring it builds clean.

**Rules that generalize past this affix:**

1. **An impossible value is a unit hypothesis, not a corruption verdict.** When stored
   numbers cannot be valid for the unit you assume, the cheapest next move is to check what
   unit the *source* uses — not to reason further from the numbers.
2. **Render the source; do not reverse-engineer it.** A wiki template, a formatter, or a
   serializer is a program. Run it on the inputs you actually have and read the output.
3. **A normalization/synonym table from an upstream source is a semantics contract.** Vendor
   it, freeze it, and diff it. Anything that renames or merges names upstream can merge two
   mechanics downstream, and the failure is silent by construction.
4. **A rename must reach every pool that carries the name.** Renaming items but not augments
   left 7 augment records still carrying `Speed`, unable to satisfy a `Movement Speed` target
   their host items now matched — worse than not renaming at all. Grep the built artifact for
   the old name and expect zero.
5. **Distrust a search that returns nothing** until you have confirmed the search works, by
   querying a string you know is present.

## Related

- `docs/wiki-evidence/speed-and-alacrity.md` — the superseding ruling, with the classifier
  and the rendered-template evidence.
- `docs/wiki-evidence/harvest-method.md` — the browser harvest loop and its traps.
- `docs/solutions/logic-errors/bonus-type-vocabulary-collides-with-bare-stat.md` — the other
  affix-vocabulary failure in this pipeline. Different root cause (the parser's own
  type-peeling), same lesson shape: a name collision that silently produces a wrong stat.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the standing rule the
  provenance model implements.
