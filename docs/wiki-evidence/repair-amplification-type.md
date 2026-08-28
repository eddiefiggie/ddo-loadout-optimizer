# Wiki evidence — Repair Amplification's bonus type on crafted options (issue #440)

**Status:** RULED 2026-08-28 — **`Enhancement` is correct. The catalog is right; no retype.**
**Investigated:** 2026-08-23 (measurement against the built dataset only)
**Harvested:** 2026-08-28 (local session, same-origin per `harvest-method.md`)
**Sources:** the option tooltips on
https://ddowiki.com/page/Item:Sporesphere ·
https://ddowiki.com/page/Item:Legendary_Sporesphere ·
https://ddowiki.com/page/Item:Cowl_of_the_Drow_Devotee ·
and https://ddowiki.com/page/Repair_Amplification

## The ruling

The three options each state their own bonus type in the **tooltip**, and the
three genuinely differ. `Repair Amplification` is an **Enhancement bonus**, as the
catalog already carries it. #440 is closed as already-correct: no data change, no
retype, and the phantom-points trap below was never entered.

**Read this before "correcting" the asymmetry.** It looks like two-fixed-one-missed
and it is not — it is three stats with three conventional types, each stated
outright.

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

## The harvest that settled it (2026-08-28)

The visible cell is what made this look like a defect, and reading it alone would
have got the answer wrong in the other direction. On every carrier the two
siblings render **with** a bonus-type prefix and Repair renders **without** one:

```
Nearly Complete: Healing Amplification
This item can be upgraded with one of the following:
Competence Healing Amplification +24
Profane Negative Amplification +24
Repair Amplification +24
```

That bare third line states no type at all. The type is in the **tooltip layer**,
exactly as `bundled-template-values-live-in-the-tooltip-not-the-cell.md` warns —
here hiding a bonus type rather than a magnitude. Verbatim, from
`span.popup.tooltip` on Item:Sporesphere:

> **Healing Amplification**: This effect amplifies all incoming positive energy healing by +24 (Competence bonus). Includes spells, potions, and other effects.

> **Negative Amplification**: This effect amplifies all incoming negative energy healing by +24 (Profane bonus). Includes spells, potions, and other effects.

> **Repair Amplification**: This effect amplifies all incoming repair healing by +24 (Enhancement bonus). Includes spells, potions, and other effects.

**Checked at both tiers and across three carriers**, not one page: Sporesphere and
Cowl of the Drow Devotee at +24, Legendary Sporesphere at +62. All three read
identically, with only the magnitude changing. The remaining carriers
(Legendary Cowl of the Drow Devotee, Wormwrithe Ring, Legendary Wormwrithe Ring)
were not read — the seed carries byte-identical option lists for all seven pools,
and three independent confirmations at two tiers is where the marginal page stops
telling us anything new. Recorded so the coverage is a known quantity rather than
an implied one.

## Why three different types is ordinary, not a defect

https://ddowiki.com/page/Repair_Amplification lists its own sources carrying
several different types:

> Essence Crafting - enhancement bonus
> Shadowscale Docent upgraded with Shadow Construct - +20 profane
> Adherents of the Mists set: +10 heroic / +20 legendary (Profane)
> Renegade Champion set: +10 heroic / +20 legendary (Artifact)

So Repair Amplification is not a stat with one canonical type that the crafted
rows might have strayed from. Per-source typing is the norm for it, which is why
the sibling-symmetry argument was never evidence — as the measurement section
above independently concluded from the catalog side.

**Note on harvesting this from a cloud session: you cannot.** Claude Code's
remote execution environment denies the whole open web at the egress proxy —
`ddowiki.com` returns 403 at CONNECT, as do `en.wikipedia.org` and
`example.com`; only GitHub, package registries and the Anthropic APIs are
reachable. Real Chromium fails the same way (`ERR_TUNNEL_CONNECTION_FAILED`), so
this is not the Cloudflare block described in `AGENTS.md` and no browser
automation routes around it. This harvest needs a local session, which is what
the method has always assumed.

**Method note — the in-app Browser pane works too.** `harvest-method.md` says
"Only Claude-in-Chrome works". This harvest was run from Claude Code's built-in
Browser pane (`mcp__Claude_Browser__`) and behaved identically: a real navigation
to a `ddowiki.com` page cleared Cloudflare, and `javascript_tool` read
`#mw-content-text` same-origin without trouble. The constraint is *a real browser
on the local machine, same-origin from a ddowiki tab* — not that one specific
tool. Recorded because the narrower wording could send someone looking for an
extension they do not need.

**And the tooltip is in the DOM, not behind a hover.** No mouse simulation was
needed: each option is a `span.popup.has_tooltip` whose last child is a
`span.popup.tooltip` already carrying the full text. Query it directly —
`el.querySelector('span.tooltip').innerText` — rather than trying to hover the
icon and screenshot the result.
