---
title: "Verify a long-open issue's premise against the code before acting on its framing"
module: process
date: 2026-09-06
problem_type: workflow_issue
component: triage
severity: high
tags:
  - triage
  - stale-issues
  - premise
  - measurement
  - backlog
applies_when:
  - Picking up an issue that has been open for weeks or months
  - An issue's body describes how a subsystem behaves
  - Estimating or scoping work from an issue's own framing
  - Recommending an approach before reading the module the issue is about
related_components:
  - src/utility_procs.py
---

# Verify a long-open issue's premise against the code before acting on its framing

An issue body is a **claim about the system, written once, at a moment that has
passed**. The code moves; the issue does not. The longer it stays open, the more
likely its opening paragraph describes a system that no longer exists — and
every later reader, including every sweep, inherits that paragraph as fact.

## What happened

**#331** ("Proc magnitude, rate, and uptime valuation") was open from 2026-08-16
to 2026-09-06. It was re-scoped **three times in one session**, and each re-scope
died on something readable in `src/utility_procs.py` the whole time:

| framing | killed by |
|---|---|
| "The Utility tier counts presence, so a 2%-chance proc and a 20% one are each worth 1" | `metadata.utility_procs_coverage`: **25 candidates, 0 allowed**. The tier does not count procs at all. Nothing was being mis-weighted. |
| "Any model needs wiki-stated rates and magnitudes" | Already carried in the affix text — 10 of 15 proc-shaped names state a rate, 12 state a magnitude. |
| "Disclose the rate instead of scoring it" (a fresh proposal, approved before it was checked) | 18 affix rows in a 9,194-item catalog, all of which the solver already ignores. |
| "Then widen the proc channel into the counted set" | **Structurally impossible.** Since #343 an `allow` name feeds `utility_untyped_admitted` only, *never* `utility_counting_set`. |

The issue closed as not-planned. The valuation model it existed to track was never
the thing standing between the tier and a richer count — the actual lever is
`UTILITY_TIER1_PRESENCE` (16 curated names of 857) behind a **measured perf**
budget, which the issue never mentions because that constraint arrived after it
was filed (#343, #380).

## Why it survived so long

Nothing was wrong with the sweeps. The issue was well written, carried real
measurements, and had been commented on more than once. **Every reader reasoned
from its opening paragraph, and the paragraph was the error.** A stale premise is
invisible precisely because it reads like context rather than a claim.

## The rule

Before estimating, recommending, or building from a long-open issue: **open the
module it is about and check that its description of the system is still true.**
Usually two minutes, and it is the cheapest step in the whole triage.

Concretely, for this repo:

- If the issue asserts a behaviour, find the metadata the build already stamps
  about it. `utility_procs_coverage` answered #331 in one line and had been
  shipping in every dataset for weeks.
- If the issue names a gate, check the gate still connects to what it gated.
  #591 waited on #331 for a model that was never coming.
- If the issue is older than a refactor it does not mention, assume it predates
  the refactor. #343 and #380 both changed this subsystem after #331 was filed,
  and neither is referenced in its body.

## The generalisation

Same family as the population rule in `AGENTS.md` ("a count is a claim about a
population -- look the population up"), pointed at prose instead of numbers:

> **An issue body is a claim about the code. Look the code up.**

The failure is worse than a wrong number, because a wrong premise propagates:
#591 inherited #331's gate and sat parked behind it, and a fresh proposal
(mine) was approved on the strength of a framing nobody had re-checked.
