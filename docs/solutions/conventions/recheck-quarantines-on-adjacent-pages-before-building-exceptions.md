---
title: Re-check a quarantined or deferred claim on adjacent and hub pages before building an exception or writing a deferral
module: wiki-evidence
date: 2026-08-13
last_updated: 2026-08-14
problem_type: convention
component: development_workflow
severity: medium
category: conventions
tags:
  - quarantine
  - wiki-harvest
  - exclude-until-verified
  - evidence-resolution
  - deferral
  - augment-slot-authority
  - spell-lore
  - solar-gems
applies_when:
  - "A quarantined claim is about to gate or complicate new work (a plan step says 'resolve or disclose the quarantine before shipping')"
  - "The original quarantine ruling cites a missing or silent source (an article-not-found page, an empty template, a page that omits the rule)"
  - "You are about to design a dedicated exception mechanism to model an unverified interaction"
  - "A wiki question is about to be closed out with a deferral to a follow-up issue instead of an answer now — run the one-hop sweep before writing the issue, not after"
---

# Re-check a quarantined or deferred claim on adjacent and hub pages before building an exception or writing a deferral

## Context

The solar-vs-artifact lore stacking claim was quarantined on 2026-08-03 because its
natural source did not exist: `https://ddowiki.com/page/Solar_Gem_of_Spell_Critical_Chance`
returned "We don't currently have an article called...", so only the bonus-type
categorization could be confirmed and the precise stack/no-stack rule was ruled
un-implementable under the never-infer gate (`docs/wiki-evidence/spell-lore.md`,
old §U5 QUARANTINED).

Ten days later, the cross-add work (#290, PR #301) had to either resolve that
quarantine or ship its lore crediting disclosed-as-unverified — and the early
design assumption was that resolving it might require a dedicated exception
mechanism in the solver (a same-type-across-names collapse for the solar case).

The re-harvest resolved it in two page reads, with **no code at all**:

- The item's own article was *still* missing — the original justification held.
- But the **crafting-system hub page** (`Lunar_and_Solar_Gems`, reached via a
  redirect from the "Sun and Moon Augments" link on the `Spell_critical` page)
  stated both halves outright: "As usual, multiple effects with the same bonus
  type don't stack," and its Solar table typed the gem as "Artifact Bonus to
  Spell Critical Chance" (universal, no element qualifier).
- The stated rule turned out to be exactly what the existing per-(stat,
  bonus-type) max bucketing already implements by data identity — the feared
  exception mechanism was never needed (`docs/wiki-evidence/spell-lore.md` §#290).

## Guidance

Before designing around a quarantined claim — and especially before building an
exception mechanism to model the unverified interaction — spend one harvest pass
re-checking sources *adjacent* to the one that failed:

1. **Re-try the original source first** (it may have been written since; here it
   had not — record the re-check date either way).
2. **Walk one hop out from the missing page**: the hub page for the system the
   item belongs to (crafting system, set catalog, mechanic overview), the pages
   that *link to* the missing article, and redirects (the working page here was
   only reachable via a redirect from the link text on a third page).
3. **Prefer system pages over item pages** for stacking rules: an item article
   states what one item grants; the system page states the rule for the whole
   class ("Solar Gems primarily provide Artifact bonuses... same bonus type
   don't stack"), which is what a solver actually needs.
4. **Only then** decide the KTD6-style fork: quote found → implement (often the
   existing machinery already encodes the rule — check before adding code);
   still no quote → ship the evidenced part with the residual disclosed, and
   re-date the quarantine note so the next reader knows when it was last checked.

## Why This Matters

A quarantine records *why a claim could not be verified at a point in time* — it
is not a permanent fact about the wiki. The wiki grows, and the article-not-found
page that justified the original ruling was never the only possible source. The
cost asymmetry is stark: the re-check cost two page reads; designing, testing,
and disclosing a speculative exception mechanism would have cost a unit of
solver work — and would have been *wrong to ship at all* under the never-infer
gate while the rule stayed unquoted. The resolution also demonstrated the common
happy ending: the stated rule matched what name+type bucketing already does, so
resolution meant deleting a worry, not writing code.

## When to Apply

- At plan time, when a unit says "resolve or disclose quarantine X" — budget the
  adjacent-page sweep as the *first* step of that unit, before any mechanism design.
- When a quarantine is older than a content update or two — DDO wiki editors
  document new systems on hub pages before item articles catch up.
- Not a license to widen a harvest indefinitely: the sweep is the original
  source plus its one-hop neighborhood (hub page, inbound links, redirects),
  paced per `docs/wiki-evidence/harvest-method.md`. If that neighborhood is
  silent, the quarantine stands — re-date it and move on.

## Examples

The resolved case, end to end, lives in `docs/wiki-evidence/spell-lore.md` §#290:
the 2026-08-03 quarantine (missing article, categorization-only), the 2026-08-13
re-check path (`Spell_critical` → "Sun and Moon Augments" link → redirect →
`Lunar_and_Solar_Gems`), the verbatim quotes, and the no-code-needed ruling. The
same harvest pass also produced the lore-additivity quote on
`Universal_Spell_Lore` — a page that had not been consulted in the original
2026-08-03 session at all — which un-blocked the lore half of the cross-add map
(`docs/wiki-evidence/universal-name-sweep.md`).

## Also run the sweep before writing a deferral (2026-08-14)

The body of this doc covers the sweep's original trigger: a quarantined claim is
about to force a dedicated **exception mechanism**, so re-check adjacent pages
before designing one. The #316 work (set augments in any color slot, PR #318,
merged 2026-08-14) showed the same sweep pays off at a second, earlier trigger:
**before writing a deferral at all**.

### Context

While planning #316, the Moon/Sun (Lunar/Solar) slot-eligibility question was
deferred rather than resolved. The plan
(`docs/plans/2026-08-14-001-fix-set-augment-any-slot-plan.md`) baked the
deferral into a requirement — R3: "Moon/Sun slots are ineligible for set-augment
copies until a rendered-tooltip wiki ruling confirms them" — plus a disclosure
requirement (R8), a hedged player-facing coverage note in the interim
implementation ("excluded until a wiki ruling confirms them", superseded within
the same PR once the ruling landed), and a Definition-of-Done clause ordering a
follow-up GitHub issue filed before the PR merged. That is the full apparatus of a
deferral: a scheduled issue, hedged UI copy, and a revisit nobody has done yet.

The plan's closing unit (U6) also ordered — per this convention — the one-hop
sweep of the `Lunar_and_Solar_Gems` hub neighborhood as the *first* step,
"resolving the deferral without a new harvest" if the hub stated the rule.

### What the sweep found

Executing the sweep during implementation resolved the deferral the same day.
The Augment Slot system page states the whole rule, rendered:

1. **Set augments fit any standard slot** — verbatim: "These level 30 Set
   augments can be slotted in any augment color slot."
2. **The color system is exactly seven colors** — the Color types table has no
   Moon/Sun rows and admits Colorless everywhere ("It's good to mentally add
   the words '…and Colorless' to the description").
3. **Moon/Sun are ruled OUT, not pending** — the Special augment slots section
   lists "Moon and Sun Augment Slots" among special-system slots that "will not
   interact with standard colored augments (nor vice versa)", corroborated by
   the `Lunar_and_Solar_Gems` hub (those slots hold Lunar/Solar Gems only).

So the exclusion the plan had framed as *conservative-pending-evidence* is in
fact **wiki-ruled exact**. The outcome inverted every piece of the deferral
apparatus: the dated ruling landed in `docs/wiki-evidence/augment-sets.md`
("Placement ruling (2026-08-14)" — "Moon/Sun (Lunar/Solar) slots are ruled OUT,
not pending … the 'pending Moon/Sun ruling' deferral raised while planning #316
is resolved by this reading and no follow-up remains open"), superseding the
earlier conservative "Colorless slots" reading; **no follow-up issue was ever
filed**, because there was nothing left to follow up (the plan's Scope
Boundaries records "Resolved during implementation (U6, 2026-08-14 — no issue
needed)"); and the player-facing note shipped un-hedged
(`web/results.js:114`): "Lunar/Solar (Moon/Sun) slots belong to the separate
gem system and accept no standard augments (wiki-ruled)."

### The generalized rule: sweep before deferring

A deferral is not free — it is a **scheduled cost**: a follow-up issue that
occupies future triage, a hedged player-facing disclosure that undersells a
correct behavior as provisional, plan prose that must be revisited and
re-anchored, and a quarantine someone must eventually re-litigate. A
15-minute rendered-page read of the system's authority page can often delete
that entire tail.

So the sweep has two triggers, not one:

- **Before designing an exception mechanism** (the original body of this doc) —
  the sweep may show the machinery already encodes the rule.
- **Before writing a deferral** (this addendum) — the sweep may show there is
  nothing to defer. Run it at requirements/plan time if possible, and at the
  latest as the *first* step of the unit that would file the follow-up issue,
  so a resolved question dies before the issue exists rather than after.

As in the original guidance, **prefer system/authority pages over item pages**
for placement and stacking rules: the Moon/Sun answer never lived on any Set
Augment item page — it lived on the Augment Slot system page, in the sections
that define the color system itself (the color table's closed enumeration plus
the special-slots non-interaction clause). Placement rules are class-level
facts, and the wiki states them at class level.

### Boundary: when the sweep does NOT resolve it

Sweep-before-deferring does not abolish deferrals. If the one-hop neighborhood
(original source, hub page, inbound links, redirects — same bounded scope and
pacing as the original guidance) is silent or ambiguous, the deferral proceeds
exactly as planned: file the follow-up issue, keep the hedged disclosure, and
**record the sweep's negative result in the quarantine note, re-dating it** —
so the next reader knows the neighborhood was checked on that date and the
deferral survived contact with the evidence rather than merely predating it.
The sweep changes the deferral's justification from "we did not look" to "we
looked and the wiki does not say", which is the only kind of deferral the
never-infer gate should ever produce.

## Related

- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the gate
  that makes quarantines exist in the first place.
- `docs/solutions/design-patterns/universal-stat-expansion-family.md` — the
  classification pattern whose cross-add arm this resolution un-blocked.
- `docs/wiki-evidence/harvest-method.md` — pacing and transport constraints the
  re-check sweep must respect.
