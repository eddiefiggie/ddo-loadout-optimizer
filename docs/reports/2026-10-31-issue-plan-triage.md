# Issue and plan organization review — 2026-10-31

This is a dated review, not a maintained backlog. Live status belongs to
[GitHub Issues](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues).
The table below preserves the original recommendations. The 12 issue title/body
updates were subsequently applied and read back through the GitHub API; #967
remains automation-owned. Public issue pages supplied the initial review data
while the environment proxy blocked the API.

The subsequent [execution report](2026-10-31-improvement-follow-through.md)
records the upstream retest, completed set harvest, current parity counts, and
the exact issue-update bundle prepared from this review. The observations below
remain the initial review snapshot.

## Evidence and limits

- Checkout and remote HEAD both: `fe22ef78e81aa27fe5a5d5b51704577432706462`.
- GitHub's issue listing returned 13 open issues on one page. All 13 issue bodies
  and their available timelines were read; none reported another timeline page.
- Cataloged all 102 existing plan documents. This was an index and targeted
  cross-check, not an adjudication of every historical checkbox or deferral.
- Read the migration plan, current set reader/parity code, build source wiring,
  source provenance, issue templates, and the standing triage rules.
- The raw `data/harvest/` inputs are absent in this checkout. The old issue counts
  below were not remeasured as current parity results. Restore/ingest the set
  harvest before ranking remaining parser families by coverage.

## Recommended queue and exact cleanup

| Issue | Role / recommended position | Evidence and proposed update |
|---|---|---|
| [#967](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/967) | Refresh signal; first bounded investigation | The bot reports upstream `ac7874b` past held `0412da1`. Link to #933 as the execution owner. Let the existing alarm manage status; do not close merely because it overlaps the refresh issue. |
| [#933](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/933) | Refresh work alongside set migration | Retest the newly reported commit using the held-snapshot method. Move steps 0/2/5 into “completed on 2026-10-24,” with that date's no-new-stat-bearing-gear result. Record the 2026-10-26 hold and link the current alarm instead of relying on #932. The zero-item delta bug mentioned in comments was fixed by `5125a23` (#938); remove it from remaining work. Preserve the warning against regenerating the frozen vocabulary to clear junk. |
| [#951](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/951) | Main implementation lane: remaining stat families | Suggested title: **Set harvest: finish remaining stat phrases and the Vulkoor ruling**. Replace “exact catalog names only” with the current `STAT_PHRASES`, percent handling, and compound-list behavior. PRs #955–#970 contain many shipped families; regenerate parity before claiming the old 424-line/~115-phrase backlog remains. Keep the Vulkoor ruling and per-family acceptance criteria. |
| [#952](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/952) | Next bounded parser slice; can proceed independently of #951 | `src/wiki_sets.py::tiers` still obtains thresholds from explicit headers. Implement only wiki-stated prose counts through reviewed phrases; retain unknowns. Remeasure the old 90/51 counts before using them as coverage targets. |
| [#953](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/953) | Name/coverage reconciliation | Keep aliases, missing wearable sets, and placeholders as distinct outcomes. Do not manufacture Legendary names or treat every unmatched template as a missing feature. Use the named-set ruling and item-page/redirect evidence; remeasure the old 27-set list. |
| [#956](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/956) | Waiting for external evidence | Suggested title: **Set bonuses: resolve four sets with conflicting wiki values**. Incorporate Eminence of Spring from the comment. Code records five affix disagreements across four sets: three PRR values plus Doublestrike/Doubleshot. Record the evidence needed; preserve quarantine while other families progress. |
| [#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908) | Phase parent, not another implementation ticket | Replace the stale “harvest and reader still open” comment summary: #948/#950/#954 delivered tooling, evidence, reader, and parity. Link #951/#952/#953/#956. Remaining gate: classify differences, zero parser errors, explicit disposition of unresolved cases, and switch build input. Keep open: the production build still loads the upstream set catalog. |
| [#928](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/928) | Waiting for player reproduction | Preserve `question`. Required evidence is a named item/effect or `.report.json`; do not expand into a speculative “all special effects” project. An actionable player defect takes precedence when that evidence arrives. |
| [#913](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/913) | Decision before retirement | Record actual delta/full-harvest elapsed time, coverage, and failure rate. #933's comment recommends weekly deltas and after patches; treat that as the interim practice, not a resolved full-refresh cadence. Browser automation now works in this cloud session, so replace “owner-only browser work” with capability-dependent language. Do not promise CI scheduling from one successful session. |
| [#916](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/916) | Phase 5 decision; not an active harvest task | Replace the superseded body with the 2026-10-21 re-scope: decide drop `rare` or retain only sourced flags. Keep the old 136/332 measurement dated. Check current consumers before deciding; do not reopen a search for the nonexistent rare-loot page. |
| [#909](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/909) | Later: crafting decisions | Keep as parent. Create a child only when a system is selected, with a migrate/retain decision and parity criterion. The approved plan permits retaining upstream crafting data indefinitely. No blanket migration deadline. |
| [#910](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/910) | Blocked on retirement gates | Add explicit dependencies on #908, #913, #916, and #909's system decisions. Include remaining item fallbacks and validation population coverage. Keep the #935 assembled-dataset guard as a decision to reassess at retirement, not a new duplicate task today. |
| [#911](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/911) | Migration roll-up | Preserve the completed Phase 0–2 checklist. Link the Phase 3 children under #908 and keep the Phase 4 retain/migrate option visible. Do not duplicate every child as a separate competing priority. |

There is no demonstrated duplicate or fully completed open issue to close from
this review. A phase can have substantial merged work and still lack its source
switch. #967 is an automated signal; #933 is the work it triggers.

## First work session after this cleanup

1. Evaluate #967's upstream revision under #933's existing hold/adopt gates.
   This is a bounded check, not permission to replace the pin automatically.
2. Restore/ingest the two-page set harvest and regenerate the #908 parity report.
   Use it to select one remaining #951 family, or the bounded #952 count parser.
3. Refresh the stale issue bodies using the table above. Track #956 and #928 as
   evidence requests so they do not stall unrelated work. Resolve #913's cadence
   with measurements gathered from actual refresh sessions.

## Repository organization delivered

- The README now points to the live issue list and development guide instead of
  presenting September priorities and “4 open” as current state.
- Its previous Project state section is preserved verbatim in
  [historical project-state notes](project-state-history.md).
- The [plan index](../plans/README.md) links every existing plan in date order.
  Filenames are preserved so historical references remain valid.
- The [development guide](../DEVELOPMENT.md) explains dependency order, evidence
  gates, and queue maintenance. It introduces no second open-work checklist.

GitHub cleanup is complete. After `api.github.com` was applied to the running
allowlist, the existing authentication was verified. All 12 reviewed issues still
matched their original bodies/titles before editing, and each update was read
back successfully. No issue was closed, relabelled, or assigned; comments were
preserved. #967 was left to its existing automation.
