# Continued development

[GitHub Issues](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues) is the
single backlog. This guide defines how to select and finish work; it is not a
second status tracker. The [plan index](plans/README.md) holds design context,
[wiki evidence](wiki-evidence/README.md) holds data rulings, and
[solutions](solutions/) holds lessons from resolved problems.

## Order of work

1. **Reproducible player defects first.** Use the existing player-report form and
   its `.report.json` attachment. A question without an item/effect or reproduction
   stays awaiting evidence; it does not justify speculative solver changes.
2. **Maintain data freshness alongside the migration.** Keep the upstream alarm
   tied to the refresh work in [#933](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/933).
   A newer upstream commit triggers evaluation, not automatic adoption. Retain a
   held pin until vocabulary, farming sources, and real stat comparisons pass.
   Continue paced wiki deltas; record elapsed time and coverage for the cadence
   decision in [#913](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/913).
3. **Finish the set-data phase before retiring its source.**
   [#908](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/908) owns the
   switch; its children cover remaining stat phrases (#951), stated piece counts
   (#952), name reconciliation (#953), and conflicting wiki values (#956). Re-run
   parity against a complete harvest before choosing the next family. Prefer one
   bounded, evidenced family per PR. An unresolved value remains disclosed and
   quarantined; do not rename it merely to make parity green.
4. **Make crafting decisions system by system.**
   [#909](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/909) permits a
   system to remain on the upstream crafting dump. File a child only when picking
   up that system; record migrate/retain decisions and parity evidence. Do not
   turn this into a compulsory rewrite of every crafting system.
5. **Retire item/set inputs only after the gates are explicit.**
   [#910](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/910) needs the
   set switch, an accounting of remaining item fallbacks, crafting retain/migrate
   decisions, refresh cadence (#913), and the rarity decision (#916). Audit which
   population each validation guard will cover after its old input disappears.
   Remove correction shards individually only when their guards prove replacement.

The [migration roll-up #911](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/911)
owns the phase checklist. Phase parents and their implementation children are
different levels of tracking, not duplicates to close together. The
[2026-10-31 review](reports/2026-10-31-issue-plan-triage.md) records the evidence
behind this order and concrete GitHub cleanup proposals.

## Keep the queue usable

- Choose one implementation slice at a time. Reproduction requests and freshness
  checks can proceed alongside it without broadening that slice.
- In each issue body, keep **remaining work**, **evidence/blocker**, and **done
  when** current. Move completed measurements into a dated evidence section.
  Link the parent and children explicitly; update stale titles when scope changes.
- Keep `bug`, `enhancement`, and `question` as type labels. Use `backlog` for
  genuinely deferred work, not every migration child. Keep `upstream-stale`
  automation-owned. If a project board is used, one status field is enough:
  Ready / In progress / Waiting for evidence / Later / Done.
- Separate implementation from external evidence. A set-value dispute needs a
  sourced ruling; a player report needs a reproduction. Neither blocks unrelated
  parser families from landing.
- Before filing an old plan deferral, check the live issue list, current code,
  merged history, and `AGENTS.md` non-goals. Do not recreate a declined feature.
- On merge, close only the issue whose acceptance criteria the PR satisfies.
  Link the phase parent without a closing keyword. GitHub has previously closed
  #908 even from the phrase “does not close #908”; avoid that construction in PRs.

## Evidence and completion

Record the base commit, exact measurement command, input harvest/revision, and
result. A missing harvest means coverage is unknown, not zero. For set parity,
restore or ingest the complete two-page harvest, then use
`python3 scripts/diff_harvest_sets.py <harvest-id> --json`.

Use the tests in [AGENTS.md](../AGENTS.md), and the relevant CI gates, for code or
data changes. Prove new behavioral tests fail against the base tree. Review
golden changes individually. Player-facing changes require the three build-stamp
updates; documentation-only organization does not.

Browser access is a runtime capability, not a permanent project blocker. This
cloud setup has demonstrated Chromium/Playwright page and same-origin API reads
after allowing the wiki and its AWS WAF challenge host. Use the pacing and
resumption rules in [the harvest method](wiki-evidence/harvest-method.md).
This does not establish unattended CI harvesting or a durable browser session;
test the target runtime before changing the refresh policy.
