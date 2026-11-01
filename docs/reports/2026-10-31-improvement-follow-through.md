# Improvement follow-through — 2026-10-31

Execution of the first steps from the [organization review](2026-10-31-issue-plan-triage.md).
Base: `fe22ef78e81aa27fe5a5d5b51704577432706462`. Dates in this report use
America/Los_Angeles; the harvest ID uses the execution host's UTC date.

## Upstream retest: hold

`git ls-remote https://github.com/illusionistpm/ddo-gear-planner.git HEAD` resolved
`156288739d39b7884c78df115ba022f58c85ba0f`, an auto-update dated 2026-10-31.
It is newer than the `ac7874b` named in #967. All four candidate data files were
downloaded from `raw.githubusercontent.com` at the full SHA.

The base was exported with `git archive HEAD` into a temporary directory. Its
dataset build passed. The candidate was evaluated there, preserving the working
checkout and its pinned data.

| Check | Result |
|---|---|
| Raw item roster vs pin | 10 names added, 8 removed |
| Shared raw records losing a nonempty `quests` field | 119 |
| Frozen vocabulary check on unmodified candidate | Failed: unknown affix name `1d6` |
| Scratch build with base roster retained | Failed: new `Blurry` → `Concealment` synonym absent from frozen registry |
| Completed candidate dataset comparison | Not available: build failed before output |

The vocabulary check directly invoked
`tests/test_vocabulary.py::test_integrity_gate_passes_on_real_data_and_fails_on_unknown`
against the candidate's four raw files. The scratch build then followed #933's
previous comparison method: exclude new names, retain removed base records,
and use candidate data for shared names. This isolates shared-record changes;
it is not a proposal to adopt a mixed roster. No guard was bypassed and no frozen
registry regenerated. There was no reason to run downstream suites against an
unbuildable candidate.

For sizing only, recursively counting raw `affixes` entries whose `name` is absent
from the frozen `affix_names` registry yields 3,194 item occurrences (91 distinct
names), 372 crafting occurrences (50 distinct), and 1 set occurrence. This is
**not** a count of confirmed junk or of effects reaching the built app; aliases
and newly legitimate names require adjudication. The actual guard failure is the
adoption blocker.

Keep production pin `c36b45e`. The staged SOURCE.json proposal changes only
`_held_upstream` to record this retest. It has not been applied: it belongs in the
normal repository review/CI flow, including the existing seed-path stamp gate.
The automatic freshness issue has not been manually closed. This evaluation is
complete enough to reject adoption without weakening a guard to obtain more data.

## Set harvest and current parity

Used the existing `scripts/browser/harvest_items.js` in installed Chromium with
the environment proxy. The title list was pinned to this repository's base SHA;
`parse: true` and `chunkPages: 1` captured both wikitext and rendered HTML.
The existing pacing/backoff was retained.

Harvest `pages-20261101-review`: **2/2 pages, 0 missing, 0 throttles, 0 errors**.
The loader verified the title-list digest and chunk body checksums. Page and
rendered-HTML revisions agree for both inputs: `Named item sets` rev 720202,
`Template:Named item sets` rev 723530.

Commands from the repository root:

```sh
python3 scripts/load_harvest.py --titles data/harvest_titles/named-item-sets.json status pages-20261101-review
python3 scripts/diff_harvest_sets.py pages-20261101-review --json
```

| Classification | Template | Page |
|---|---:|---:|
| Exact | 88 | 30 |
| Partial | 89 | 28 |
| Threshold unstated | 90 | 51 |
| No matching wiki name | 9 | 172 |
| Wiki disagrees | 4 | 0 |
| Ours differs | 1 | 0 |
| Upstream stale | 1 | 1 |
| **Compared catalog sets** | **282** | **282** |

The [machine-readable summary](2026-10-31-set-parity-summary.json) preserves the
revision IDs and classification counts. All five disagreement records and the
upstream-stale exception still reproduce. `sources_disagree: []` considers only
fully readable entries in both sources; it does not erase the four known
conflicting sets. The sole `ours-differs` set remains Legendary Vulkoor's Might.

There are 128 quarantined template clauses among compared sets with stated
thresholds. This excludes the 90 sets classified threshold-unstated before clause
parsing. Common unmapped phrases include Spell Critical Chance (%) (9), Natural
Armor (8), DCs (6), and Threat Generation (%) (5). Twenty-five clauses do not match
a typed numeric clause. Frequency alone does not justify a mapping.

The recommended next implementation slice is **#952: exact prose piece-count
forms**. Its 90/51 affected-set counts now have fresh evidence, its scope is
bounded, and it does not depend on settling #956's conflicting values. The
acceptance criteria remain those in #952: sourced explicit wording, unknown
sentences remain unknown, and no inference from counting item links.

## Issue updates applied and verified

The initial run was blocked by the network policy. After the environment was
published with `api.github.com` allowed, repository API access and the existing
account permissions were verified. All 12 issues still matched the reviewed
bodies/titles before the batch started. Each update was then applied and read
back successfully.

Applied 12 title/body updates to #908, #909, #910, #911, #913, #916, #928,
#933, #951, #952, #953 and #956. Each adds current scope/evidence while preserving
the original body under a historical-context disclosure. #951 and #956 receive
the more accurate titles from the organization review. Comments, labels and
issue states are preserved. #967 remains automation-owned.

Local execution artifacts are under `/workspace/scratch/ddo-review/`:

- `issue-updates-preview.md` and `issue-updates.json`: exact proposed edits.
- `apply_issue_updates.py`: defaults to read-only preflight; `--apply` writes only
  after all issues match the reviewed bodies/titles. It rechecks each issue before
  writing, retains a before snapshot and verifies the result. Already-applied
  edits are skipped; concurrent changes stop the batch for review.
- `upstream-evaluation.json`, build/gate logs, pinned upstream files and
  `proposed-SOURCE.json`: hold evidence and the metadata proposal.
- `harvest_sets.py`, raw chunks and full `set-parity.json`: reproducible browser
  workflow and detailed set results. Raw ingested pages also live in the ignored
  `data/harvest/pages-20261101-review/` directory.

These scratch artifacts are local session work, not published repository files.
The issue cleanup is complete. The staged SOURCE.json hold proposal remains
unapplied and is separate from this documentation/issue organization change.
Do not copy credential values into the local scripts.
