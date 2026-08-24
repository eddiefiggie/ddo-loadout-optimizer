---
title: "A dead-symbol scan must read both sides the way the runtime does — a comment is not a definition, and a built name has no literal"
date: 2026-08-24
category: conventions
module: web
problem_type: convention
component: styling
severity: medium
resolution_type: process_fix
applies_when:
  - "Sweeping for dead CSS, dead exports, or unreferenced constants after a feature removal"
  - "Extracting declarations with a regex over raw source that still contains comments"
  - "Deciding a symbol is unused because a literal grep found no hits"
  - "Working in a repo that leaves tombstone comments naming symbols it deleted"
  - "Auditing a file whose consumers build identifiers by interpolation"
symptoms:
  - "A scan reports orphaned rules that do not exist as rules at all — the only occurrence is inside a comment explaining their removal"
  - "A scan reports live classes as unused because every emitter builds the name with a template literal"
  - "Deleting the reported orphans leaves the JS and Python suites fully green"
  - "The proposed cleanup would remove styling with no test, no error, and no visible failure until someone looks at the page"
tags:
  - ddo
  - dead-code
  - css
  - grep
  - false-positive
  - verification
  - dynamic-identifiers
related_components:
  - web/styles.css
  - web/results.js
  - web/wizard.js
  - web/overrides.js
---

# A dead-symbol scan must read both sides the way the runtime does — a comment is not a definition, and a built name has no literal

## Context

After #498–#501 retired the Loadout Deep Dive and Alternatives tabs, a dead-CSS sweep ran over `web/styles.css`. The method looked sound: extract every class selector with `/\.([a-zA-Z][\w-]+)/`, concatenate every `web/*.js` and `web/index.html`, and report any class whose name does not appear in the concatenation.

It produced 47 candidates. Most were obviously fine — `aug-blue`, `pos-ring1`, `bmc-btn` — dynamic or third-party. Seven looked like genuine leftovers and were written up as a follow-up task:

| Reported orphan | Reality |
|---|---|
| `.pd-chip-head`, `.pd-chip-stat`, `.pd-chip-sub`, `.pd-chip-value` | **Not rules at all.** Deleted by #476. The only occurrence is the tombstone comment that records their deletion. |
| `.is-utility` | **Live.** `affixChipClass` returns `"utility"`, emitted as `is-${cls}`. |
| `.is-gain` | **Live.** `stackLine("gain", …)` renders the trade-off cards' gain rows. |
| `.is-suspended` | **Live.** `overrides.js` returns `state: "suspended"`, emitted as `is-${r.state}`. |

Seven candidates, seven false positives, in two distinct ways — and the two ways sit on opposite sides of the same comparison.

**The definition side counted comments as declarations.** `web/styles.css:400-408` is a block comment left by #476 explaining that the `.pd-prio` / `.pd-chip` family was removed, and naming each member so a future reader knows what went and why one did not:

```
/* #476 — the `.pd-prio` / `.pd-chip` family is gone with `whyThisLine`, the only
   thing that ever emitted it: `.pd-prio`, `.pd-chip`, `.pd-chip-head`,
   `.pd-chip-value`, `.pd-chip-check`, `.pd-chip-stat`, `.pd-chip-sub` and
   `.pd-chip.is-rank1`. …
   `.pd-chip-q` is NOT part of it and lives on with the row language further
   down — it is what `chipQualifiers` still emits … */
```

A regex over raw source cannot tell that block from a rule. It read six deleted class names as six live declarations, then correctly found no emitters, and reported them as orphans. The "cleanup" indicated by that report is to delete a comment — and that comment is the only artifact explaining why `.pd-chip-q` (`web/styles.css:1355`, emitted at `web/results.js:535`) survived when its seven siblings did not.

**The usage side could not see a name that is never written down.** Three live classes are built by interpolation, so no literal exists to grep for:

- `web/results.js:663` — `subLines` renders `<li class="is-${cls}">`, where `cls` comes from `affixChipClass` (`:452`), which returns `"utility"` at `:464`.
- `web/results.js:639` — `stackLine` renders `class="pd-line is-${cls}"`. Callers pass the four `LINE_MARK` keys (`:627`) plus three literals: `"empty"` (`:903`), `"gain"` (`:2887`) and `"cost"` (`:2906`).
- `web/wizard.js:3025` — `<div class="wz-pin-row wz-ov-row is-${esc(r.state)}">`, where `r.state` is one of the override states `overrides.js` mints, including `"suspended"` at `:387`, `:392`, `:404`, `:420`, `:458`, `:463` and `:472`.

## Guidance

**1. Strip comments before extracting declarations.** Whatever the language, run the definition side through a comment-stripping pass first and compare the two counts. In this repo the one-liner is:

```python
import re
css = open('web/styles.css').read()
rules = re.sub(r'/\*.*?\*/', '', css, flags=re.S)     # the part a browser parses
in_rules   = bool(re.search(r'\.' + re.escape(name) + r'\b', rules))
only_in_comment = not in_rules and bool(re.search(r'\.' + re.escape(name) + r'\b', css))
```

A name in the `only_in_comment` bucket is not an orphan and needs no action. It is documentation, and in this repo it is documentation deliberately left behind.

**2. Enumerate the dynamic-construction sites, then resolve each one's value vocabulary.** Before trusting any "no hits" verdict, find every place the codebase builds a class name:

```bash
grep -rn 'class="[^"]*\${' web/*.js | grep -oE '\$\{[^}]*\}' | sort | uniq -c | sort -rn
grep -rn 'is-\${'  web/*.js        # or whatever prefix you are auditing
```

Then, for each interpolated variable, resolve what strings it can actually hold — a returned literal, a lookup table's keys, the literals callers pass. That resolution is the deliverable: a closed vocabulary you can compare against the stylesheet. Here it is `tracked` / `ranked` / `utility` / `incidental` / `empty` / `gain` / `cost` for `is-${cls}`, the three `NOTICE_*` constants for `is-${d.cls}`, and the override states for `is-${r.state}`.

**3. Verify a "this is dead" claim before acting, exactly as you would a claim about game data.** `plan-text-and-review-findings-are-unverified-claims.md` establishes that assertions about the repo get accepted on authorship rather than evidence. A tool's output is the same kind of claim, and it arrives with more apparent authority: "zero matches across every file" reads like proof. It is proof only that the search matched nothing, which is a statement about the search.

**4. Prefer the check that would have to be wrong twice.** The scan's verdict rested on one regex per side. The confirmation above rested on reading the actual rule text and the actual emitter for each candidate. When a cheap scan and a careful read disagree, the read wins; when only the scan has run, no conclusion is available yet.

## Why This Matters

**The test suite would mostly not have stopped this.** Of the six rules across the three live classes, exactly one is pinned:

| Rule | Guarded? |
|---|---|
| `.pd-line.is-utility .pd-ln-what` (`styles.css:1313`) | **Yes** — `tests/results.test.js:3548` asserts the selector is in the sheet |
| `.pd-line.is-utility .pd-ln-mark` (`:1311`) | No |
| `.pd-sub li.is-utility` (`:1368`) | No |
| `.pd-line.is-gain .pd-ln-what` / `.pd-ln-mark` (`:1330`, `:1331`) | No |
| `.wz-ov-row.is-suspended .wz-ov-state` (`:1767`) | No |

Deleting all three classes would have turned exactly one assertion red — and only because a #469 guard happens to pin that one selector for an unrelated reason. `is-gain` and `is-suspended` would have gone entirely silently: 987 Python tests green, the full JS sweep green, and three visual regressions shipped. `is-suspended` does not appear anywhere in `tests/`, so nothing in the repo would have noticed the override row losing its state indicator.

That is the asymmetry that makes this class of mistake worth a doc. Dead-code cleanup *feels* like the safest possible change — nothing is being added, no logic is touched, the diff is pure deletion — and in a codebase where CSS carries little test coverage, it is one of the few edits that can be wrong and green simultaneously.

**This repo's own conventions manufacture the first failure mode.** `edit-the-stale-comment-instead-of-stacking-a-new-one-above-it.md` and the institutional-knowledge discipline in `AGENTS.md` both push toward leaving a written record when something is removed. #476 did exactly that, correctly. The consequence is that `web/styles.css` contains, by design, the names of classes it does not define — and every naive dead-CSS scan run against this repo will keep rediscovering them and proposing that the documentation be deleted. The comment-stripping pass is not an optimization here; it is what makes the scan compatible with the repo's own habits.

**The correct outcome of a sweep can be zero deletions.** The follow-up task in this case ended with nothing changed, no build markers bumped, and both suites green — and that was the right result, not a wasted pass. What it produced was the resolved vocabulary in Guidance 2, which is reusable the next time someone asks whether an `is-*` class is live.

## When to Apply

- **Before deleting any symbol a scan called unused** — CSS class, exported function, constant, data field. Confirm the declaration is a declaration and not a comment, and confirm no consumer builds its name.
- **Whenever a scan's report and the repo's documentation habits could interact.** Any repo that records removals in comments will produce the first failure mode. Check whether the reported orphan's only occurrence is prose.
- **Whenever the audited file's consumers use template literals for identifiers.** `class="…${…}"`, `data-${k}`, `getElementById(\`x-${id}\`)`, dynamic property access. The literal-grep verdict is worthless there and needs the vocabulary resolution instead.
- **Whenever a proposed deletion has no test that would go red.** Ask what would fail if the deletion were wrong. If the answer is "nothing until someone looks at the page", the bar for evidence goes up, not down.
- **When a sweep returns nothing to delete.** Record the vocabulary you resolved. That is the durable output; the empty diff is not a failure.

## Examples

- `web/styles.css:400-408` — the #476 tombstone comment naming seven deleted classes, and explaining why `.pd-chip-q` was not among them. The source of four of the seven false positives.
- `web/styles.css:1355` / `web/results.js:535` — `.pd-chip-q`, the one member of that family that is still a rule and still emitted, by `chipQualifiers` (`web/results.js:522`).
- `web/results.js:452-465` — `affixChipClass`, whose four return values (`tracked`, `ranked`, `utility`, `incidental`) are half the `is-${cls}` vocabulary; `"utility"` is returned at `:464`.
- `web/results.js:627` — `LINE_MARK`, whose keys are the same four names, and `:639` — `stackLine`, the `is-${cls}` emitter.
- `web/results.js:663-673` — `subLines`, the second `is-${cls}` emitter, rendering `<li class="is-${cls}">` per augment affix.
- `web/results.js:903`, `:2887`, `:2906` — the three literal `cls` arguments (`"empty"`, `"gain"`, `"cost"`) that no lookup table would reveal; `:2887` is what makes `.is-gain` live.
- `web/results.js:1746` — `class="notice-card is-${esc(d.cls)}"`, which is why `.is-actionable`, `.is-qualifying` and `.is-informational` also appeared in the 47 and are also live.
- `web/wizard.js:3025` with `web/overrides.js:387` (and `:392`, `:404`, `:420`, `:458`, `:463`, `:472`) — the `is-${r.state}` emitter and the `"suspended"` state that reaches it.
- `tests/results.test.js:3548` — `assert.ok(/is-utility \.pd-ln-what/.test(on), …)`, the single assertion that would have caught any part of the proposed deletion.

## Related

- `docs/solutions/workflow-issues/plan-text-and-review-findings-are-unverified-claims.md` — establishes that a claim about the repo is a hypothesis until checked, whoever wrote it. **New here:** the claim came from a *tool*, not a person, and tool output resists that framing — "zero matches in every file" presents as measurement rather than assertion. It is an assertion about what the search could see. That doc's rule 3 ("specificity is what makes a claim cheap to check") applies exactly: a named class in a named file is thirty seconds of work to confirm, and confirming it is what dissolved all seven.
- `docs/solutions/conventions/a-symbol-on-one-export-surface-is-dead-on-the-other.md` — the same shape one layer down: a symbol's liveness depends on which surface you look at. **New here:** the surfaces are the raw file and the parsed file, and the symbol is live on neither and merely *named* on one.
- `docs/solutions/conventions/edit-the-stale-comment-instead-of-stacking-a-new-one-above-it.md` — the habit that produces the tombstone comments. Read together, the two say: keep writing the removal record, and make your scans comment-aware so the record is never mistaken for the thing it records.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — corrupt the input a guard exists to reject and confirm it goes red. The analogue for a *scan* is the inverse and worth stating: feed it a symbol you know is live and confirm it is NOT reported. Had the sweep been sanity-checked against `.is-tracked` — same emitter, same shape, differing only in which branch of `affixChipClass` returns it — the dynamic-name blind spot would have surfaced before anything was written up.
- `docs/solutions/conventions/a-source-guard-must-pin-the-property-not-the-syntax-beside-it.md` — on the limits of reading source as text. This is the failure that doc warns about, arriving from the other direction: not a guard over-specifying live syntax, but an audit under-specifying it and missing the construction entirely.
