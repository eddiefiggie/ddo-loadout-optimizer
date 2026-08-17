---
title: "Plan text and review findings are unverified claims — check them against the tree before acting"
module: development-workflow
date: 2026-08-08
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Implementing from a plan that asserts something about current code or data"
  - "Applying code-review findings, especially in bulk rather than one at a time"
  - "Carrying forward a note or summary written in an earlier session"
tags:
  - ddo
  - exclude-until-verified
  - code-review
  - planning
  - verification
  - agent-workflow
---

# Plan text and review findings are unverified claims — check them against the tree before acting

## Context

This project applies **exclude-until-verified** rigorously to game data: no wiki value enters the dataset unless the wiki states it outright. That discipline stops at the repo boundary. Claims *about the codebase* — written in a plan, produced by a reviewer, or carried forward in a note — get accepted on authorship rather than evidence, even though they are equally checkable and equally wrong-able.

One session (#168) produced three false claims of this kind. All three were caught, each by a check that took under a minute. None would have been caught by reading more carefully, because each one was plausible, specific, and confidently stated.

| Claim | Where it came from | Reality |
|---|---|---|
| "`Item:Belt of the Ram` currently loses its movement bonus entirely" | A requirement in the plan being implemented | False. The `unsourced` branch already keeps gear-planner's value and renames it, so the item had movement 15 the whole time. |
| "`The Changestone` and six `Skullduggery Kit` levels also carry the folded `Speed` affix" | A code-review finding, accepted and written into the plan's Scope Boundaries | False. Zero records match. The Kits carry `Intelligence Skills` / `Dexterity Skills` and live in a file the item path already reaches. |
| "Green Steel / Thunder-Forged pools are intentionally empty" | A note carried forward from an earlier session | False. 108 and 36 recipe options are loaded across all tiers. What is missing is any item flagged as a host, so they are unreachable rather than unmodelled. |

The middle one is the most instructive: a reviewer **fabricated** a specific, checkable claim naming seven records, and it was applied into a planning document during a bulk auto-resolve pass without anyone opening the file.

## Guidance

**1. Treat a claim about the repo the way you treat a wiki value.** If a plan, finding, or note asserts that code behaves a certain way, that a file contains something, or that a count is N, that is a hypothesis until checked. The check is usually one command. Authorship is not evidence — including your own authorship from twenty minutes ago.

**2. Verify before you build on it, not before you ship.** The cost of a false claim scales with how much work is layered on top. Belt of the Ram was caught while writing the first unit's tests, so the correction was one sentence. Had it survived into the commit message and the PR body, it would have been three places to fix and a wrong claim already published.

**3. Specificity is what makes a claim cheap to check — use it.** "The Changestone and six Skullduggery Kit levels carry the folded Speed affix" names exact records and an exact field. That is thirty seconds of grep. Vague claims are harder to verify and, for that reason, more dangerous to accept; a claim precise enough to act on is precise enough to check.

**4. Bulk-applying review findings skips the moment where you would have checked.** Walking findings one at a time creates a natural pause per finding. A bulk apply removes it. If you take the bulk path, verify the findings that assert facts about the tree *before* applying, not after — the fabricated finding here was applied in exactly that gap.

**5. When a claim turns out wrong, fix the artifact, not just your understanding.** All three corrections above landed back in the plan, the scope boundary, and the README respectively. A false claim left standing in a decision document is the seed of the next wrong ruling — this repo already has a documented case where two artifacts disagreed for a full harvest cycle because nothing compared them.

## Why This Matters

The failure mode is not that these claims were wrong. It is that **every one of them was actionable, and acting on them silently produces work that looks correct.** Building a requirement around "the item is losing its movement bonus" yields a fix, tests, and a commit — all coherent, all resting on a premise nobody checked.

Agent-produced findings sharpen this. An AI reviewer will state a false claim with exactly the same confidence, structure, and citation format as a true one; tone carries no signal. In this session the *same review* that fabricated the Skullduggery claim also found two genuine P1 defects, including one the author had missed while quoting the relevant learning in a docstring. Discarding the reviewer would have been the wrong lesson. Checking its checkable claims is the right one.

This is the same shape as the project's data discipline, one level up. `docs/solutions/conventions/exclude-until-verified-data-gates.md` refuses to infer a game value from a plausible-looking source. This says: refuse to inherit a repo fact from a plausible-looking sentence.

## When to Apply

- Implementing a plan requirement that asserts current behavior, a current value, or a current absence — especially an absence, which is the easiest thing to state and the hardest to notice is wrong.
- Applying code-review findings, particularly in bulk. Any finding citing a file, symbol, or count is worth confirming before it changes an artifact.
- Reading a session summary, resume prompt, or memory note that states repo state. These age badly and carry no provenance.
- Writing a "the codebase does not have X" claim yourself. That is the highest-risk sentence shape in a plan, because nothing fails when it is wrong.

Not needed for claims that fail loudly on their own — a wrong import path, a bad symbol name, a broken command. Those surface immediately. The rule targets claims that stay quiet.

## Examples

**The check that caught the fabricated finding**, run before trusting it:

```
$ python3 -c "walk gearplanner_crafting.json for records carrying a 'Speed' affix
              whose name contains Changestone or Skullduggery"
  matches: 0
```

Thirty seconds. The finding had been written into the plan's Scope Boundaries an hour earlier.

**The correction that followed** — the boundary now records the negative result and the guard that makes a real future case fail loudly, rather than silently excluding records on a guess:

> Checked during implementation and found empty: exactly seven records in
> `gearplanner_crafting.json` carry the folded `Speed` affix, and all seven are
> augments this work covers. A test now asserts the shard covers every folded
> record in the catalog, so a genuine future case fails loudly instead of being
> scoped out on a guess.

That last clause is the durable half. Verifying a claim once fixes one document; converting the verification into an assertion fixes the class.

## Scope note — the cheap-check class is dominant, not universal (added 2026-08-16)

This doc frames the whole class as cheap: "the check is usually one command", "specificity is what makes a claim cheap to check." That holds for claims about the current state of the code, which is the dominant case and the one every instance above came from.

It does not hold for one sub-class: a **causal** claim about the effect of your own change. `docs/solutions/conventions/measure-the-counterfactual-before-crediting-your-fix.md` records an instance where the check required adding an A/B axis to a measurement harness before it could be run at all — the instrument could only measure the configuration that shipped, so the comparative claim was untestable by construction rather than merely unchecked. The discipline is the same; the cost estimate is not. Do not let "the check is one command" become a reason to treat an expensive check as optional.

## Related

- `docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md` — the mirror image on the other side of the same axis. That doc governs claims you **emit** (a notice, a label, an export line) and its remedy is *reword it*; this one governs claims you **consume** (a plan sentence, a review finding, a carried-forward note) and its remedy is *check it*. It has long cited this doc; the reciprocal link was missing until 2026-08-16.
- `docs/solutions/conventions/measure-the-counterfactual-before-crediting-your-fix.md` — the third cell: a claim you emit about your own diff, where the counterfactual is neither barred nor grep-able. See the Scope note above.

- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the same discipline applied to game values rather than repo facts.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the assertion half: turning a one-time check into a standing one.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md` — the case where two repo artifacts disagreed for a full harvest cycle because nothing compared them.
