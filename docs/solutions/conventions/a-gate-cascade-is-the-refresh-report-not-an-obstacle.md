---
title: "A gate cascade during a data refresh is the refresh report, not an obstacle"
module: data-pipeline
date: 2026-08-19
last_updated: 2026-08-19
category: conventions
problem_type: convention
component: tooling
severity: high
related_components:
  - build_dataset
  - item_value_corrections
  - affix_type_corrections
  - untyped_rankable
  - legendary_fold
  - crafting_catalog
  - tests/parity/golden.json
applies_when:
  - "An upstream data source is refreshed and its encoding changed, not just its values — a type field, a marker string, or a name spelling is now written differently"
  - "A build gate, corrections table, or quarantine entry fires during a refresh and the tempting fix is to re-freeze the count, bump the expectation, or retire the entry wholesale"
  - "An upstream or wiki ruling contradicts the project's own canonical spelling and a canon-defence migration is under way"
  - "Regenerating tests/parity/golden.json for a chosen-only diff, where the golden's sanctioned remedy for a red is to overwrite the objection"
  - "A negative test for a new guard passes but the failure output carries some other gate's message, not the guard under test"
symptoms:
  - "Each fix clears one gate and immediately exposes the next, so the refresh reads as an obstacle course rather than as the guard system's report"
  - "A corrections table is retired in bulk when the verifying evidence covered only some of its records"
  - "A fold or correction is cleared for removal on structured-affix occurrence counts while the spelling is still live in a free-text channel, minting two provenance labels for one mechanic"
  - "Pools whose loader defaults to catalog=None reload from disk and silently bypass a canon rename applied to every other pool"
  - "A fixture-level ranked-stat-at-zero detector stays green while a stat's population falls by 70 percent, because cross-add families leave a residue"
tags:
  - ddo
  - data-pipeline
  - upstream-refresh
  - guards
  - corrections
  - quarantine
  - golden
  - adjudication
---

# A refresh that re-encodes its upstream arrives as a cascade of gates — adjudicate each one, do not clear the path

## Context

On 2026-08-18 the vendored `ddo-gear-planner` snapshot was refreshed from upstream commit
`ec3e595…` to `767a7f7…` — both SHAs in the *upstream* gear-planner repo, not this one, so they
will not resolve locally (17 days stale). It was filed as a routine re-import. It was not one: upstream had
changed its **encoding**, not only its values.

Two encoding changes did all the damage.

- **The affix vocabulary flipped.** Upstream moved from DDO's in-game enchantment names to generic
  mechanic names — `Combustion` -> `Fire Spell Power`, and twelve more. This project's standing
  principle is "match what the player reads on the tooltip", so the correct response was to keep our
  names and absorb upstream's as aliases (#374), not to follow the flip.
- **The type field re-encoded.** Upstream stopped *omitting* `type` for an untyped affix and started
  emitting the literal string `"Untyped"`. Measured in the refreshed raw: key-less affixes
  5709 -> 90, literal `"Untyped"` 148 -> 886, `Bool` 8554 -> 13088
  (`docs/reports/2026-08-18-gear-planner-canon-migration.md` §2).

The work shipped as PR **#382** (merged, build 08182026.6), closing **#374** (#376 had been closed hours earlier by PR #377, whose split this work re-opened and re-closed, so #382's `Closes #376` was a no-op), with
`docs/reports/2026-08-18-gear-planner-canon-migration.md` as the adjudication of record. Six
gates fired in sequence — eight guard instances, since two of the report's sections cover two shards
each — each only after the previous was cleared, plus a ninth class that appeared
only because named assertions were written before the golden was regenerated. Three follow-ups were
filed from the work: **#379**, **#380**, **#381**.

This document is about the *shape* of that experience, because the shape recurs every time an
upstream re-encodes.

## Guidance

### The core rule

**The cascade is the deliverable.** A refresh that changes encoding does not present as one failure.
It presents as a queue of independent gate failures, because each guard stands between the build and
the next guard, so gate *n+1* is invisible until gate *n* is cleared. Every one of those reds is the
guard system reporting **one adjudication's worth of what the refresh actually changed**.

The tempting move — re-freeze every registry, bump every count to the new number, retire every shard
the guard now calls stale, regenerate the golden — clears the path in an hour and destroys exactly
the information the guards exist to produce. A guard that fires is not an obstacle to the refresh;
it is the refresh's only description of itself.

Corollary: **budget the cascade, not the import.** Do not estimate a re-import as "vendor the files
and rebuild". Estimate it as *n* adjudications, where *n* is unknown until you start, and each one
needs its own evidence.

### The six classes, and the different adjudication each one needs

When gate #3 goes red at 2am, the first useful question is *which class is this*. These six covered
every gate on this migration.

**1. Retire — upstream adopted our correction.**
*Recognise it by:* a staleness guard firing on a curated correction shard, saying the correction no
longer matches anything.
*Adjudication:* the guard fired because the correction's **premise** ("upstream is wrong") stopped
holding. Verify the premise programmatically against the refreshed raw, then retire **with the
evidence recorded, not deleted**. All 17 affixes in `item_value_corrections.json` retired this way:
16 now read our wiki-verified `to` value exactly with zero divergences; the 17th (Juiblex's Reign /
Acid Absorption) through its paired type correction. The record lives in that file's
`_retired_2026_08_18` block — 8 records / 17 affixes, each keeping `name`/`from`/`to`/`value`/
`tooltip`/`wiki_url`/`verified`, plus the upstream commit it was verified against.

**2. Resolve — the quarantine's own hypothesis came true.**
*Recognise it by:* a quarantine entry whose stated reason names a condition, and the refresh
satisfies that condition.
*Adjudication:* read the reason you wrote and check whether the data now matches it. **Five** of the
21 `untyped_rankable` quarantine entries carried the reason *"also appears typed on other items, so
the untyped instances may be an upstream parse gap rather than an untyped stat."* Upstream typing
them **confirmed that hypothesis**, and the quarantine resolved in the direction it had itself
named. The other 16 read only `"unreviewed"` — worth noticing, because this class's adjudication is
*read the reason you wrote*, and for 16 of 21 there was no hypothesis to confirm; they resolved the
same way, but on the data alone. The same reasoning retired **104** `utility_procs` adjudications,
the single largest retirement of the migration. Retired
per entry, each recording the types upstream now emits (e.g. `Magical Efficiency`:
`{'Enhancement': 99, 'Bool': 8}`, zero untyped remaining) — 21 retired, 22 still live.

**3. A wiki ruling that goes AGAINST your canon.**
*Recognise it by:* a rename where you instinctively reach to defend your spelling.
*Adjudication:* go to the source of truth and be willing to lose. Two of four rulings went against
us. `Shock` -> `Electrifying`: the ITEM is *Ruby of Shock*, but the wiki page reads
`Enchantments: Electrifying 10` and files under `Electrifying 10 items` — so `Electrifying` is what
the player reads, and ours was the stale spelling. `Cannith:` -> `Essence Crafting:`: the wiki states
Update 79 renamed the system in game. **A canon-defence migration is not a presumption that our name
always wins.** "Match the tooltip" cuts both ways; when the wiki backs upstream, adopting upstream
*is* the canon defence.

**4. The same predicate bug repeated at N sites.**
*Recognise it by:* a re-encoded field, and a predicate that tests the *old* encoding shape.
*Adjudication:* grep the whole tree for the predicate's shape before fixing any single site, and
look for sites that **already** handle the new encoding — those turn a judgement call into
restoring the repo's own convention. Four sites tested `type in (None, "")` and so stopped
recognising an untyped affix. Two other sites already treated the literal marker as untyped, which
is what made the widening principled. Sites 1–3 were found by the cascade; **site 4 was found only
by the named assertions**, and until then it had made the entire declared-credit gate globally inert.

**5. Per-item verification where family inference would be wrong.**
*Recognise it by:* new records arriving in a family you already have a rule for.
*Adjudication:* read each one. Five new shields needed materials; the Oozing Hunger family splits
Wood/Steel, so inferring material from the family name would have mis-set the druidic oath gate.
All five were read from their own item-page infobox.

**6. A guard that fires for a DIFFERENT gate than the one under test.**
*Recognise it by:* your falsification attempt goes red — but read the message.
*Adjudication:* **proof arrives only when the failure output carries YOUR guard's message.** The
first falsification of the new crafting-coverage guard (renaming a pool key) was intercepted by
`crafting_catalog`'s own gate; the guard under test never ran. A sibling's red is not evidence about
your guard.

### The seventh point: named assertions BEFORE the golden

Write named behavioural assertions for what the migration must preserve, prove them red on the
pre-fix tree, and only then regenerate the snapshot/golden. This follows the 2026-08-17 amendment in
`docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md`: the classic
re-ratification clauses ("diff contained to expected fixtures" + "no priority target regressed")
cannot adjudicate a `chosen`-only diff, and a golden's sanctioned remedy for a red is to *overwrite
the objection*. A snapshot is a change detector, not a behaviour specification.

On this migration that ordering found **three live defects** a regenerate-then-eyeball pass would
have ratified as expected drift (report §11).

### The eighth point: record measured scope limits instead of assuming them away

The plan's fixture-level "ranked stat at zero" detector was assumed to be the safety net. It is not,
and the migration measured it: on a deliberately disarmed dataset (4,326 stat names reverted to
upstream spellings), `Combustion` fell 464 -> 128 and `Ice Lore` 46 -> 11, but **both stayed
non-zero** — cross-add families leave a residue. A zero-check catches a name that vanishes entirely;
it does not catch partial loss. The teeth are in the data-layer assertions. That limit is written
into the test file as a `SCOPE LIMIT` rather than left as folklore.

## Why This Matters

Each item below is a defect that a bulldozed cascade would have shipped silently.

- **Bulk retirement ships live bugs.** Retiring all 3 `affix_type_corrections` entries on evidence
  that covered 1 would have shipped `Action Boost Charges` untyped on both `Moment to Moment` stones
  and reproduced **#259**'s double-count.
- **A half-applied rename splits one mechanic into two buckets, silently.** Thunder-Forged and Green
  Steel re-loaded the catalog through a `catalog=None` default, bypassing the rename applied at the
  catalog's single load point; **18 Thunder-Forged** records shipped upstream spellings while every
  other pool carried our canon (Green Steel had the same bypass but no measured survivors). Both
  call sites now pass the renamed catalog explicitly. A player ranking `Combustion` would have scored some of their gear and not the rest.
- **A missing fold re-opens a just-closed issue.** `legendary_fold` never ran on the set catalog, so
  our own correction minted the engraved name into raw sets: 22 set-tier *affixes*, across four
  tiers, credited a stat name no item affix carries, disjoint from the 36 worn carriers — reopening the exact **#376** split it was
  meant to close, and deleting the provenance label so a player ranking what the item prints scored
  nothing.
- **One stale predicate can make a whole gate inert.** With the fourth site unfixed, `untypedOnly`
  collapsed to size 0. With it fixed, `untypedOnly` is exactly `{Enhanced Ki}` — size 1, unchanged
  from before the refresh, which is independent evidence the widening is the right shape and not an
  over-reach.

The cost of the disciplined path is real (PR #382 is large), but each gate cost one adjudication and
produced one durable record. The bulldozed path costs the same wall-clock and produces a dataset
whose divergences from reality are undiscoverable until a player reports them.

## When to Apply

- Any vendored-snapshot refresh where the upstream may have changed field encoding, key presence, or
  naming vocabulary — not just values.
- Whenever more than one curated shard, registry, or freeze-count guard goes red from a single data
  change. That is the cascade signature.
- Whenever a guard tells you a correction, quarantine entry, or allowlist entry is now stale. Stale
  is a claim about the world; verify it before acting on it.
- Before regenerating any golden or snapshot as part of a data migration.
- **Not** applicable to a values-only refresh where every guard stays green — that genuinely is an
  import.

## Examples

### The two errors made — both caught by process, not luck

**Error 1: bulk-retiring on evidence that covered one record.** All 3 `affix_type_corrections`
entries were retired when the verification covered only the `Juiblex's Reign` entry. Upstream had
*not* adopted the two `Moment to Moment` corrections — it still emits
`('Action Boost Charges', 'Untyped')` on both stones. The test re-ratification pass caught it; both
were restored to the live shard.

The fix was not "be more careful" — it was a guard that checks each retirement's premise **per
record**, in `tests/test_type_corrections.py`:

- `test_374_the_retirement_block_records_evidence_for_every_retired_entry` (line 195) — a retirement
  must carry a stated reason, name the upstream commit it was verified against, and record every
  evidence field per entry. Retirement is *the one exit that is not a guard firing*, so nothing in
  the pipeline checks it.
- `test_374_a_retired_correction_is_one_upstream_actually_adopted` (line 216) — asserts, against the
  refreshed raw rather than the note's word, that upstream now carries the corrected `to` type at the
  recorded value AND no longer emits the uncorrected `from`.
- The scoping is the whole point. Its helper `_raw_affixes(record)` (line 159) documents it: *"a
  global walk finds SOME record carrying the corrected pair and would wave through a retirement whose
  own target still carries the bug."* A global walk is not a weaker version of this check; it is a
  check that passes for the wrong reason.
- `test_374_the_moment_corrections_are_still_live_because_upstream_kept_the_bug` (line 253) pins the
  restored pair, and the retirement test asserts non-vacuity so it cannot pass by comparing nothing.

**Error 2: adjudicating a fold removal on the wrong channel's counts.** A removed fold was cleared on
structured-affix occurrence counts (0/0/0) while the spelling was still live in the Dino channel's
**free-text tier wording**, which would have produced two provenance labels for one mechanic. (This
one is recorded from the run's own account rather than a single source line; the corrected shape is
visible in report §5.1, where the surviving-spelling count names both channels explicitly:
`Damage vs. the Helpless` in structured affix names and `damage vs. the helpless` in Dino free text.)

**Method note, generalised: a fold-removal adjudication must count the free-text channels, not just
structured affix occurrences.** "Zero occurrences" is only evidence if the walk covered every channel
that can carry the spelling.

A third, smaller error belongs on the record for the same reason: a commit body claimed a follow-up
"is filed" when it was not. Claims about work outside the diff are as checkable as claims inside it.

### The four predicate sites, and the two that showed the way

Fixed this migration:

- `build_dataset.py:465` — `untyped = bt in (None, "", "Untyped")`
- `src/untyped_rankable.py:79`
- `src/utility_procs.py:171`
- `web/dataset.js:828` — `const _isUntyped = (t) => t == null || t === "" || t === "Untyped";`
  (found only by the named assertions; filed as **#380**)

Already correct before the migration, which is what made the widening a restoration of convention
rather than a judgement call:

- `src/membership.py:48` — `_UNTYPED_MARKERS = {None, "", "Untyped", "Enhancement"}`
- `src/set_catalog.py:78`

Note what the `web/dataset.js` comment is careful *not* to do: it widens the predicate that
**classifies the control**, and explicitly declines to fold an absent type into `"Untyped"` at the
bucket key, because real untyped bonuses stack and 30 stats carry both spellings meaning to add.
Encoding equivalence at one layer is not equivalence at every layer.

### The guards this migration left behind

- `src/crafting_coverage.py` — new this migration (from **#372**'s own recommendation that landing it
  *before* the refresh is the cheaper order). It computes served labels from each pool's real keying
  rather than by string-matching pool names, and fails in **both** directions: a newly-unserved label
  (line 292) and an allowlisted label no longer declared by anything (line 304) — a one-directional
  allowlist rots silently. It also raises on any pool that walked zero records (line 245), because a
  populated pool must not vouch for one that quietly emptied.
- `src/name_corrections.py` — `is_pending` (144), `assert_all_reached` (158, with pending entries
  exempt but required to state a reason: *"an exemption with no stated reason cannot be retired by
  review"*), and `assert_canon_defense` (191), which goes red the moment the data arms an entry whose
  `pending_upstream` marker is still set. The exemption self-retires.
- `tests/vocabulary_migration.test.js` — the named assertions, written and proven red before
  `tests/parity/golden.json` was regenerated. Its roster is **derived from the declaration**
  (`data/seed/compendium/affix_name_corrections.json`, 13 entries), not hand-listed, so a correction
  added or retired without a matching assertion cannot hide.
- The evidence blocks themselves: `_retired_2026_08_18` in `item_value_corrections.json`,
  `affix_type_corrections.json`, `untyped_rankable.json` and `utility_procs.json` (the last holding
  104 entries); the `reanchor_note` at
  `data/seed/compendium/ml36_augments.json:612` recording the `Shock` -> `Electrifying` ruling *and
  why it went against us*; the per-item note at `data/seed/compendium/item_material.json:726`
  recording that the shields were read per item because the family splits Wood/Steel.

### Verification that the discipline held

908 Python tests and all 25 JS test files green, including `solver_golden`. Zero upstream-spelling
survivors per pool (items 1391 -> 0, crafting 251 -> 0, sets 140 -> 0). Golden: 12 of 23 fixtures
byte-identical, 11 moved, **0 moved because of the branch's own fixes** — proven against a
fixes-free capture rather than asserted. Unserved slots identical to baseline at 35 labels /
415 item-slots. Performance reported as two numbers because the harness's ratio is invariant to the
refresh: absolute arm-(a) median 466ms -> 460–463ms (the data did not raise solve cost), Utility
ratio 1.69x -> 1.80x against a 2.00x budget.

Filed rather than folded in: **#379** (six Elemental Resistance carriers lost their components —
upstream re-typed Insight -> Competence), **#380** (the
predicate re-encoding and the collapsed `utilityAdmitted` stamp), **#381** (four adopted
`Legendary <stat>` labels stop resolving for pre-refresh saved characters). Related open threads the
report touches without claiming to close: **#371**, **#283**, **#229**, **#214** (**#372** is
addressed in the PR body rather than the report).

**Amendment, 2026-08-19.** #379 was filed on a wrong premise. This doc originally recorded it as
"the harvested evidence contradicts itself"; it does not. `docs/wiki-evidence/elemental-resistance.md`
had ruled on 2026-08-13 (#191) that the legacy dialect's *visible label* lies about the type and the
tooltip is the authority, naming these exact six carriers — and the shard's own `raw` field stored
the wiki's `{{Elemental Resistance|elemental|10|insight}}` invocation, which states the type as a
parameter. Nothing was ambiguous and no harvest was needed. Closed by PR #387 with six
`affix_type_corrections.json` entries. See
[`read-the-standing-ruling-and-judge-the-strongest-evidence-layer.md`](read-the-standing-ruling-and-judge-the-strongest-evidence-layer.md).

## Related

- [`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`](prove-a-guard-fails-before-trusting-it.md) — owns class 6 in full ("a red proves *a* gate fired, not that YOURS did"). This migration is a fourth confirming case, not a restatement; go there for the rule.
- [`docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md`](../workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md) — its 2026-08-17 amendment is what forced assertions-before-golden here, and this migration is the amendment's first large-scale payoff.
- [`docs/solutions/conventions/name-corrections-canonical-must-be-a-raw-upstream-name.md`](name-corrections-canonical-must-be-a-raw-upstream-name.md) — written days before this refresh; it **predicted this failure class** and named the `Ki` trigger that duly fired. **Two of its six registry-membership rows are flipped by this very refresh** (`Legendary Conditioning` yes→no, `Ki` no→yes) and needs a refresh pass (see the recommendation below).
- [`docs/solutions/logic-errors/impossible-values-mean-a-unit-change-not-corruption.md`](../logic-errors/impossible-values-mean-a-unit-change-not-corruption.md) — the #154 origin of the synonym gate, and the source of "a rename must reach every pool", which class 4 and the Thunder-Forged/Green Steel defect both instantiate.
- [`docs/solutions/workflow-issues/rebuild-the-dataset-before-any-golden-capture.md`](../workflow-issues/rebuild-the-dataset-before-any-golden-capture.md) — the precondition for every measurement in this doc.
- `docs/reports/2026-08-18-gear-planner-canon-migration.md` — the adjudication of record: the fold diff, all 60 registry removals, the golden attribution, and the perf pair.
- Issue #374 (closed by PR #382; #376 was already closed hours earlier by PR #377); #379, #380, #381 filed from this work. **#229's mask is gone** — upstream now emits a `type` key on `Ki` so `iter_affixes` sees it at all; the marker itself is still `Untyped`, and the cause is structural rather than any per-name decision and **#372 is half done** (this closed the refresh; #371's import remains) — both are stale as written.
