# Override coverage trace — which reported cases the instrument actually reaches

**Issue:** #418 · **Measured against:** build 08212026.11 · **Date:** 2026-08-21

Answers the question #88 workstream 2 deferred: of the real reports in
`data/bug_reports.txt`, which can a player-created bonus-type override actually
fix, which are maintainer work, and which have no route at all.

The plan's coverage claim rested on one example — #259, *Legendary Moment to
Legendary Moment* typed `Untyped` instead of `Enhancement`. #418 observed that
this example does not support the claim, because the plan's own taxonomy makes it
**cause 1**. This trace confirms that and goes further.

## The taxonomy being applied

From the plan's Problem Frame, three causes wear one symptom:

1. **The catalog disagrees with the wiki.** Closed globally by
   `data/seed/compendium/affix_type_corrections.json`. Maintainer work.
2. **The wiki was corrected upstream, the catalog has not refreshed.** Resolves
   itself on the next snapshot.
3. **The wiki itself is wrong and uncorrected.** No other instrument exists. This
   is the only cause an override is *for*.

## Populations

Measured on the built dataset, not carried forward from the issue.

| Population | Count |
|---|---:|
| Item affixes, total | 42,088 |
| **Eligible for an override** | **20,613** |
| Excluded — presence-only (`Bool`) | 12,265 |
| Excluded — expansion-derived (`via`) | 8,942 |
| Excluded — composite components | 161 |
| Excluded — absent type key | 53 |
| Excluded — `Penalty` / `-` | 58 |

Two notes on the issue's own figures. The expansion-derived count reproduces
**exactly** (8,942). The "set tiers (14,094 rows)" figure does **not** reproduce
against any population found here: presence-only measures 12,265, and set tiers
are 53 across 49 set definitions, with 0 item affixes carrying a set marker. The
14,094 appears to be stale or measured against a different definition; the
excluded classes above are the current, reproducible decomposition.

## The trace

Every concrete bonus-type or stacking report in `data/bug_reports.txt`, against
the eligible population.

| # | Report | Cause | Reachable by an override? |
|---|---|---|---|
| 1 | *Legendary Moment to Legendary Moment* typed Untyped, not Enhancement (#259) | **1** | **No — already fixed.** The catalog now carries `Action Boost Charges \| Enhancement \| 3`, via a live entry in `affix_type_corrections.json` |
| 2 | Nearly Complete Heal Amp items give Enhancement to positive and negative "instead of competence and profane" | **3 → 2** | **No — already resolved.** The reporter edited the wiki themselves, converting their own case to cause 2. The catalog has since refreshed: `Healing Amplification \| Competence`, `Negative Amplification \| Profane` |
| 3 | Equipment spell lore stacking on top of element lore (Kinetic) | — | **No — ruled correct.** `docs/wiki-evidence/spell-lore.md`: universal and element-specific lore are *different stats*, occupy different buckets, and both apply |
| 4 | Spell lore 13% (Darstil's Gloves) stacking with void lore 24% (Cracked Symbol of Lolth) | — | **No — same ruling.** Different affix names stack by design |
| 5 | Pomura's Memento insightful lore V stacking with insightful void lore | — | **No — same ruling.** The same evidence doc names Pomura's Memento carrying `Spell Lore \| Insight \| 5`, and rules it correct |
| 6 | Insight / Insightful over- and under-stacking | **1** | **No — closed by workstream 1**, at the name level, with a build guard |
| 7 | "Profane Well Rounded" returns no items | — | **No — data correct by design** (`src/umbrella.py`); the picker offer was the bug (#136) |

## What this means

**No report currently in `data/bug_reports.txt` is reachable by a player
override.** Every concrete case is cause 1 (fixed globally), cause 2 (resolved by
refresh), or ruled correct by standing wiki evidence.

That is not the same as the feature being unjustified, and the distinction
matters:

- **Cause 3 is invisible by construction.** It is the case where the wiki is wrong
  and nobody has checked against a running client. A report of it cannot be
  distinguished from cause 1 or 2 at the moment it is filed — which is precisely
  the plan's argument for why the instrument exists and why the creation surface
  names the distinction rather than pretending to enforce it. The absence of a
  *confirmed* cause-3 case in the file is evidence about the file, not about the
  world.
- **Report 2 is the closest thing to a validating case**, and it validates the
  *lifecycle* rather than the creation path: a player found the wiki wrong, edited
  it, and the catalog caught up. Had they held an override across that window it
  would now resolve `satisfied` — exactly the state the plan designed for, and the
  reason an override records what it was overriding from.
- **Eligibility is necessary, not sufficient.** Reports 3–5 have eligible affixes
  (66 general `Spell Lore` rows, 149 specific-lore rows), so an override *could*
  be applied to them. It would be wrong: those reports are about whether two
  differently-*named* stats share a bucket, and an override changes the *type*
  component, not the name. Applying one there would be a player patching over
  behavior the wiki evidence rules correct.

The last point is the sharpest practical finding. The eligible population is not
the population of reachable reports, and the gap between them is not exclusion —
it is instrument mismatch.

## Follow-ups this trace does not take

- The three excluded classes are disclosed to the player at creation, but nothing
  measures how often a player *tries* to correct something in them. If that
  becomes interesting, the picker's empty-state is where it would be counted.
- `Repair Amplification` on the Nearly Complete Heal Amp options remains
  `Enhancement` while its siblings are `Competence` and `Profane`. Report 2 named
  only positive and negative, so this is unexamined rather than known-correct —
  worth a wiki check, not an override. Filed as
  [#440](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/440).
