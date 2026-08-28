---
title: "A closing keyword closes the issue even inside a sentence denying it"
module: workflow
date: 2026-08-27
problem_type: workflow_issue
component: git-github
severity: medium
tags:
  - github
  - issues
  - closing-keywords
  - pull-requests
  - automation
applies_when:
  - "A PR deliberately does NOT resolve an issue it references"
  - "A commit or PR body explains the relationship to an issue in prose"
  - "Writing 'this does not close #N', 'not a fix for #N', or similar"
---

# A closing keyword closes the issue even inside a sentence denying it

## Context

PR 557 delivered the Essence Crafting harvest for issue 193 but deliberately left the
issue open: the harvest succeeded, and the modelling remained blocked on a
dimension no source records. To make that unmistakable, the commit body said:

> This does NOT close [issue 193].

The merge closed issue 193.

GitHub's issue-closing parser is **purely lexical**. It scans for
`close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved` followed by an
issue reference, anywhere in the commit message or PR body. It has no notion of
negation, quoting, or sentence structure. `does NOT close` followed by a live
issue reference still contains the keyword and the reference, so the issue closed — the sentence written to prevent it is what
caused it.

## Guidance

**When a PR deliberately does not resolve an issue, never place a closing keyword
adjacent to the issue number at all — including inside a denial.**

- Reference it as **`Refs #N`**.
- Do not write "does not close #N", "not a fix for #N", "does not resolve #N".
  Say the status without the keyword: *"#N stays open"*, *"this does not complete
  #N"*, *"the remaining work on #N is …"*.
- The same applies to quoting someone else's sentence that contains one.

This is the mirror of the rule `AGENTS.md` already carries. That rule exists
because a **bare `#N` fails to close** an issue the PR did resolve — five issues
were found fixed-and-shipped but still open in a 2026-08-09 sweep. This is the
same mechanism failing in the other direction, and both come from the parser
being lexical rather than semantic.

| Intent | Write | Never write |
|---|---|---|
| The PR resolves it | `Closes #N` | a bare `#N` |
| The PR does NOT resolve it | `Refs #N` | any of close/fix/resolve near `#N` |

## Why This Matters

A wrongly-closed issue is worse than a wrongly-open one. An open issue that is
actually done gets rediscovered and closed by the next sweep. A closed issue that
is **not** done disappears from every backlog view — and here it would have taken
with it the finding that issue 193's remaining work is a bounded type-sourcing problem
rather than the large harvest the issue described. That finding only exists in the
issue thread; nobody greps closed issues before choosing what to work on.

The failure is also silent at the moment it happens. The merge succeeds, CI is
green, and the close shows up only if someone re-checks the issue afterwards.

## This document deliberately carries no live issue reference

Every example above writes `issue 193` rather than a live `#` reference, and the
quoted sentence is defused with brackets. That is not fussiness — it is the entry
earning its own advice.

The first version of this file quoted the offending sentence verbatim, and the
commit message that added it quoted the sentence too. **Merging the document that
warns about the trap sprang the trap**, closing the issue a second time. A
solutions entry about a lexical parser must not itself contain the lexeme.

## When to Apply

- Any PR that references an issue it does not resolve — a partial delivery, a
  harvest without the wiring, a spike, a doc-only change against a feature issue.
- Reviewing a PR body that discusses an issue in prose rather than just linking it.

## Examples

- **PR 557 / issue 193** (this entry). Body: *"This does NOT close [issue 193]."*
  Result: closed.
  Recovered by reopening and recording the cause in the issue thread, so the
  reopen does not read as a status change.
