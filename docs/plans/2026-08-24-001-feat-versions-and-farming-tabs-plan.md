---
title: "Versions and Farming List - Plan"
type: feat
date: 2026-08-24
topic: versions-and-farming-tabs
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-captured
product_contract_source: maintainer-interview
execution: code+data
---

# Versions and Farming List - Plan

## Goal Capsule

**Objective.** Retire the *Loadout Deep Dive* and *Alternatives* result tabs and
replace them with two tabs that answer questions the app currently does not:
*how does this build differ from the one I had before?* (**Versions**) and
*where do I actually go to get this?* (**Farming List**). The trade-off job
Alternatives was doing survives, but only for trades that clear a bar the player
sets — the ridiculous suggestions go away by construction, not by taste.

**Tracked as** #498 (retire Deep Dive), #499 (Alternatives -> bounded notices),
#500 (Versions tab), #501 (Farming List tab). Deferrals: #495 (pack mapping),
#496 (Set Augment disclosure add-back), #497 (stale-code sweep).

**Product authority.** Maintainer interview, 2026-08-24.

**Execution profile.** Browser code, plus one new curated seed file
(quest -> adventure pack) and the pipeline stage that consumes it.

**Tail ownership.** Player-facing behavior changes, so the three build markers
move together per `AGENTS.md`: `?v=` in `web/index.html`, `BUILD` in
`web/app.js`, `**Current build:**` in `README.md`.

---

## Problem Frame

Six result tabs today: Loadout, Ranked Priorities, Set Bonuses, Loadout Deep
Dive, Alternatives, Share.

**Deep Dive is a second rendering of the Loadout tab.** Since #457 and #469 the
Loadout card body (`equippedBody`, `web/results.js:887`) renders Stats,
Augments and Crafts sections from the *same* `augmentSection` / `craftSection`
helpers the Deep Dive calls, and the card carries set glow via `is-set`. Three
facts are genuinely unique to Deep Dive and are being deliberately dropped
(see *Accepted Losses*).

**Alternatives produces suggestions the maintainer does not trust.** The
observed failure: a candidate offering **+1 of a low-ranked affix at a cost of 5
or more points of a higher-ranked one**. Under strict lexicographic priority
that is not a trade a player who ranked those stats would ever take, and one
such card poisons confidence in every card beside it.

**The wanted behavior already exists elsewhere.** The concession probe (#481,
`concessionControl`, `web/results.js:2566`) lives on the *Ranked Priorities*
stat cards and prices exactly the trade the maintainer described wanting: *a
very small loss up top for a large gain below*, computed by a real solve on
demand rather than generated speculatively. It is the feature; it was just
filed under the wrong tab.

---

## Decisions (from the interview)

### Tab lineup

`Loadout · Ranked Priorities · Set Bonuses · Versions · Farming List · Share`

### 1. Alternatives -> bounded upgrade notices (#499)

- The standalone Alternatives tab, its card list, and the "Viewing alternative"
  active-build bar are removed.
- Surviving trade-offs join the **existing notice panel** (`noticeDescriptors`)
  rather than getting their own block.
- **The bar is player-set, and a trade must pass two independent tests:**
  - **Proportional** — the loss on any ranked priority as a percentage of that
    priority's current total.
  - **Rank-weighted** — a point lost on priority 1 counts for far more than a
    point gained on priority 5.
  - Both must pass. Either alone lets through the failure case above.
- **Default: free-only.** The bar ships at zero, so out of the box the notices
  carry *only* zero-cost upgrades — open augment slots, set completions,
  cheaper crafting, unranked-stat gains that cost nothing. The player raises the
  bar deliberately when they want to see trades.
- The concession probe is **promoted**: it stays a per-stat, per-click control
  (running solves nobody asked for was rejected), and its results additionally
  surface in the notices when they clear the bar.

**Implementation note, not yet decided.** The free-upgrade generator is
`generateAlternatives`' `zeroCost` axis, so the generator is probably kept and
the bar applied as a filter, rather than the file being deleted outright.
`alternatives.js` still owns the gain/cost analysis the concession probe's
"See this build" path depends on. Scope the deletion at implementation time
against what the notices and the probe actually consume.

### 2. Deep Dive -> deleted (#498)

Removed entirely: `loadoutDeepDive`, the `rt-deep` / `rp-deep` tab and panel,
and the `.deepdive` / `.dd-*` CSS.

### 3. Versions tab (#500)

- **Sources of a version:** saved characters, an auto-snapshot taken on each
  solve, manually named versions, and imported Portable JSON.
- **Comparison shape:** the build currently on screen is always the left side;
  the player picks one saved version as the right side.
- **Diff depth: everything** — every differing stat, ranked or not, plus set
  bonuses, augments and craft steps.
- **Presentation:** a summary delta header (what the ranked stats gained and
  lost) above an expandable slot-by-slot diff.
- **Retention:** grow until storage complains, then warn and let the player
  prune manually. Snapshots carry full item objects and are not small; the
  warning path is load-bearing, not decorative.
- **Migration: fresh start.** Version history begins empty. Existing saved
  characters remain loadable and selectable as a comparison side (their
  snapshots render standalone) but are not retroactively made into history.

### 4. Farming List tab (#501)

- **Scope:** the current build only — its equipped items, their augments, and
  their crafting steps. **No prerequisites** (flagging, raid timers, level
  gates, saga/favor gates) — ruled not needed.
- **Grouping: adventure pack first**, with sibling top-level groups for the
  sources that are not packs: *Vendors*, *Seasonal Events*, *Crafting*,
  *DDO Store*, and *Source unknown*. Everything lands somewhere; the unknown
  bucket is a visible gap, never an omission.
- **Checkable progress**, persisted per character.
- **Exportable / printable**, reusing the Share tab's existing exporters.
- Ticking an item does **not** feed the owned-inventory pool (rejected as too
  tight a coupling between two features).

---

## Data Work

`location_quest` is the only acquisition field on an item. Current state:

| Fact | Value |
|---|---|
| Gear variants with a `location_quest` | 7,836 of 8,047 (97.4%) |
| Gear variants with none | 211 |
| Augment variants with any acquisition data | 0 of 1,063 |
| Distinct source values | 533 |

**Corrected during implementation.** This table first read "1,274 variants with
none", which mixed two populations — per *a count is a claim about a population*.
The 1,274 was every variant lacking the field, and 1,063 of those are augments,
which carry no acquisition data at all by construction. Among gear, coverage is
97.4%, not 86%. The two facts have opposite consequences: gear sourcing is nearly
complete and the gaps are a short visible list, while augments cannot be sourced
at all and the Farming List must say so rather than imply a location.

The 533 values are heterogeneous by nature: real quests (`Gianthold Tor`), raids,
NPC vendors (`Morten Edgewright`, `Captain Xendros`), crafting stations
(`Ritual Table`, `Sealed Altar`), seasonal events (`Night Revels`,
`Treasure of Crystal Cove`), `DDO Store`, and non-locations
(`Advance to level 15`). There is no drop-rate, chest, or difficulty data
anywhere in the dataset.

**New seed file (#495):** a hand-curated `location_quest -> {kind, adventure_pack}`
mapping under `data/seed/`, where `kind` is one of pack-quest / vendor / event /
crafting / store / unknown. Built incrementally; every uncovered value renders
under *Source unknown* rather than being guessed at, per the **never infer a
value** rule.

**Coverage guard required.** Per *a completeness claim needs a guard, not a
date*: the build must assert the mapping's coverage of the live
`location_quest` population and stamp it into `metadata`, so a dataset refresh
that introduces new source values cannot silently widen the unknown bucket.
Prove the guard fails before trusting it — corrupt the mapping, confirm red,
restore. It must refuse to inspect zero records.

---

## Accepted Losses

Recorded so a later audit does not re-raise them as oversights. All three were
raised in the interview and dropped deliberately.

1. **"Part of set: <name>"** — the spelled-out set name per item. The Loadout
   card's set glow still says *that* an item is in a set, not *which*.
2. **"suppressed by Set Augment"** (#496) — currently the only place the app admits
   that slotting a Set Augment overrode a host item's own set bonus. This is the
   sharpest of the three, because it is a disclosure of a cost. If it turns out
   to matter in play, it is a small add-back to the Loadout card foot notes.
3. **"Unrealized upgrade - N open augment slots"** — the per-item judgement
   note. Open augment slots still appear as their own rows in the card's
   Augments section (#472), and the free-upgrade notice covers the judgement.

---

## Documentation Consequence

`AGENTS.md` / `CLAUDE.md` declines weighted-sum and Pareto trade-off modes with
the justification that *"The Alternatives tab is how near-optimal trade-offs
surface instead."* That sentence names a tab this plan deletes. The non-goal is
unchanged, but its rationale must be rewritten to point at the bounded upgrade
notices and the concession probe, or the next person to ask for a weighted mode
gets an argument with no floor under it.

---

## Follow-up Work — filed

Per *open work lives in GitHub Issues*, filed 2026-08-24 before any code moved:

- **#495** — curated `location_quest -> adventure pack` mapping, with its
  build-time coverage guard.
- **#496** — add-back of the Set Augment suppression disclosure to the Loadout
  card, if play shows it is missed.
- **#497** — post-change stale-code sweep (scoped below).
- **#502** — the version store has no lifecycle management. Filed 2026-08-24 from
  the branch's own code review: the retention this plan settled on ("grow until
  storage complains, then warn and let the player prune") ships with the growing
  and the warning but no pruning, a warning that latches on and never clears, and
  an auto-snapshot that duplicates on every re-solve. The design decision was
  sound; what it assumed — a prune control — was never built.

---

## Verification

- `python3 tests/run_tests.py`
- `./scripts/run_js_tests.sh` — never a bare loop.
- **Prove each new test fails against the pre-change tree**: export the base
  commit to a scratch dir, copy the generated dataset in first, copy the new
  tests over it, run. Anything still passing covers nothing.
- Browser-verify the notices against real data at several ML caps, confirming
  the default free-only bar admits no cost-bearing trade.
- Golden / parity diffs after the seed change are re-ratified deliberately,
  never blanket-accepted.

## Stale-Code Sweep (after implementation) — #497

Deleting two tabs will strand code. Sweep at minimum: `alternatives.js` and
whatever `generateAlternatives` machinery in `solver.js` no longer has a
consumer; the `.deepdive` / `.dd-*` and alt-card CSS in `styles.css`; the
`renderBuild` / `setActive` / return-to-optimum path in `results.js` that exists
to swap an alternative into the paperdoll; alternative-specific exporters; and
any test fixtures asserting the removed tabs.
