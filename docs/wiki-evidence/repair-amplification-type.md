# Wiki evidence — Repair Amplification's bonus type on crafted options (issue #440)

**Status:** UNRULED — the wiki check that would settle it has not been run.
**Investigated:** 2026-08-23 (measurement against the built dataset only)
**Source needed:** https://ddowiki.com/page/Repair_Amplification, and the
Nearly Completed Healing Amplification option tooltips.

## The question

Three amplification stats are minted together by crafting options and carry three
different bonus types:

| Affix | Recorded type |
|---|---|
| Healing Amplification | `Competence` |
| Negative Amplification | `Profane` |
| Repair Amplification | `Enhancement` |

A 2026-08-18 player report said these items gave "enhancement to positive and
negative, instead of competence and profane". It named **only** positive and
negative; both were corrected in a later catalog refresh. #440 asks whether
Repair is the third member of the same set, left behind because nobody reported
it.

## Why this file exists before a ruling

Two reasons. The measurements below narrow the question enough that the wiki
check is a single page-read rather than a re-investigation, and — more
importantly — the shape of the *fix* is dangerous in a way the question does not
advertise. Anyone settling this needs the second half before touching a type.

## Measured (built dataset, upstream snapshot `767a7f74`)

**1. The crafted rows are not an orphan.** Each member of the triple carries the
type its own stat predominantly carries on worn gear and augments:

| Stat | Crafted type | Dominant type in `items[]` | Runner-up |
|---|---|---|---|
| Healing Amplification | Competence | **Competence, 120 rows** | Exceptional, 55 |
| Repair Amplification | Enhancement | **Enhancement, 48 rows** | Insight, 3 |
| Negative Amplification | Profane | **Profane, 37 rows** | Insight, 5 |

`Repair Amplification` is `Enhancement` on 48 worn/augment rows — ordinary named
gear such as `Adamantine Bracers` (53) and the `Sapphire of Repair Amplification`
augment line — and `Competence` on **zero** rows anywhere in the catalog. Upstream
carries it as `Enhancement` in 62 places across items, sets and crafting.

So the asymmetry is not obviously "two corrected, one missed". It is equally
consistent with three stats that simply carry three different conventional bonus
types in DDO, with the crafted channel matching each one. That does not settle
it — only a tooltip does — but it means the sibling pattern is **not** evidence
for a correction.

**2. The typing is solver-inert today.** No `Competence`-typed Repair
Amplification exists, so every crafted and worn `Enhancement` row shares one
bucket and collapses to the max. Nothing is currently mis-credited.

**3. A partial fix invents points.** The solver buckets by
`stat||equivType(type)` and takes the max within a bucket (`web/solver.js`,
`Σz ≤ 1`); `Competence` and `Enhancement` are distinct buckets. Retyping a subset
moves those rows into a *second* bucket, and the two then sum:

| Edit | Credited |
|---|---|
| today — all rows `Enhancement` | **62** |
| retype `nearly_complete` only (what #440's title names) | **123** |
| retype all three crafted channels, leave worn gear | **115** |
| retype crafted **and** worn together | **62** |

Only the last is a bonus-type correction. The other two are phantom stat points
no item grants, and both are strictly worse than leaving the catalog alone.

`tests/test_amplification_bonus_types.py` fails the build on the middle two.

## What would settle it

A wiki read of the Nearly Completed Healing Amplification option tooltips for the
Repair line, per `harvest-method.md`. If the tooltip names a type, that is the
ruling — and if it rules `Competence`, the fix must move the 48 worn rows in the
same commit, not only the crafted ones.

**Note on harvesting this from a cloud session: you cannot.** Claude Code's
remote execution environment denies the whole open web at the egress proxy —
`ddowiki.com` returns 403 at CONNECT, as do `en.wikipedia.org` and
`example.com`; only GitHub, package registries and the Anthropic APIs are
reachable. Real Chromium fails the same way (`ERR_TUNNEL_CONNECTION_FAILED`), so
this is not the Cloudflare block described in `AGENTS.md` and no browser
automation routes around it. This harvest needs a local Claude-in-Chrome session,
which is what the method has always assumed.
