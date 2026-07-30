---
title: "Stacked PRs — merge with a merge commit, and expect the child PR to close when you delete the base branch"
module: workflow
date: 2026-07-30
problem_type: workflow_issue
component: git-github
severity: medium
tags:
  - stacked-prs
  - github
  - merge-commit
  - squash-merge
  - branch-deletion
  - release-workflow
applies_when: "merging a chain of stacked PRs (PR B based on PR A's branch, not on main), especially with squash-merge or delete-branch-on-merge enabled"
---

# Stacked PRs — merge with a merge commit, and expect the child PR to close when you delete the base branch

## Context

When work is split into sequential PRs that share files, the later PR is often opened against the earlier PR's branch rather than `main` — a *stacked* PR. This session shipped a 3-phase feature that way: Phase 2's PR was based on Phase 1's branch because both touched the same files and Phase 1 wasn't merged yet. Two GitHub mechanics bit when merging the stack, both silent until they'd already happened.

## Guidance

**1. Merge the base PR with a *merge commit*, not a squash.** Squash-merging rewrites the base branch's commits into one new commit with a new SHA. The stacked child's commits were built on the base's *original* SHAs, which now exist nowhere on `main` — so GitHub computes the child's diff as "all of the base's changes plus mine," and the child PR balloons to re-include the entire base (conflicts, duplicated diff). A **merge commit** preserves the base commits' real SHAs on `main`, so the child's ancestor commits are reachable from `main` and the child cleanly shows only its own delta.

**2. Expect deleting the base branch to *close* the child PR, not retarget it.** GitHub does sometimes auto-retarget a child PR to the base's base when the base merges — but merging the base PR **with delete-branch** can instead **close** the child (its base branch no longer exists). A closed PR whose base branch is gone **cannot be reopened or retargeted** (`gh pr edit --base main` → "Cannot change the base branch of a closed pull request"; `gh pr reopen` → "Could not open the pull request"). The recovery is to **open a fresh PR** from the same still-existing child branch against `main`.

**Safe sequence for a stack A → B:**

1. Merge A with a merge commit: `gh pr merge A --merge` (optionally `--delete-branch`).
2. Confirm B's state. If GitHub retargeted B to `main`, verify `git log origin/main..origin/<B-branch>` shows only B's own commits, then merge B.
3. If deleting A's branch **closed** B, open a fresh PR from B's branch: `gh pr create --base main --head <B-branch> …` and merge that. Because A was merged (not squashed), the delta is clean.

## Why This Matters

Both failure modes are silent and easy to discover only *after* an irreversible step. A squash on the base doesn't error — it just produces a monstrous, conflict-ridden child diff that looks like the child author did something wrong. A closed-then-unreopenable child PR strands the branch with no obvious path forward; without knowing the fresh-PR recovery, it looks like the work is lost. Choosing the merge-commit strategy up front and knowing the delete-closes-child behavior turns both into non-events.

## When to Apply

- Any time PR B is based on PR A's branch instead of `main` (GitHub calls A the base).
- Especially when the repo has **squash-merge** or **auto-delete-branch-on-merge** enabled as defaults — those are exactly the settings that trigger these two behaviors.
- Not relevant for independent PRs both branched from `main` — they carry no stacking relationship.

## Examples

This session, shipping a feature in three phases:

- **Phase 1 (#55)** merged into `main` with a **merge commit** (`gh pr merge 55 --merge --delete-branch`), which preserved Phase 1's commit SHAs on `main`.
- Deleting Phase 1's branch **auto-closed Phase 2's stacked PR (#56)** — and #56 could not be reopened or retargeted because its base branch was gone.
- Recovery: opened a **fresh PR (#57)** from the same `feat/results-restructure` branch against `main`. Because #55 was merged (not squashed), the merge base was clean and #57's diff was exactly Phase 2's three commits — no re-included Phase 1 changes, no conflicts.
- **Phase 3 (#58)** branched from `main` *after* #55/#57 merged — no stacking, so a plain PR with none of the above pitfalls.
