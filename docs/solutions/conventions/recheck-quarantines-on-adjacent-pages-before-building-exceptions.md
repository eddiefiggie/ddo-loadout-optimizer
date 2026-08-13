---
title: Re-check a quarantined claim on adjacent and hub pages before designing an exception mechanism
module: wiki-evidence
date: 2026-08-13
problem_type: convention
component: development_workflow
severity: medium
category: conventions
tags:
  - quarantine
  - wiki-harvest
  - exclude-until-verified
  - evidence-resolution
  - spell-lore
  - solar-gems
applies_when:
  - "A quarantined claim is about to gate or complicate new work (a plan step says 'resolve or disclose the quarantine before shipping')"
  - "The original quarantine ruling cites a missing or silent source (an article-not-found page, an empty template, a page that omits the rule)"
  - "You are about to design a dedicated exception mechanism to model an unverified interaction"
---

# Re-check a quarantined claim on adjacent and hub pages before designing an exception mechanism

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

## Related

- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the gate
  that makes quarantines exist in the first place.
- `docs/solutions/design-patterns/universal-stat-expansion-family.md` — the
  classification pattern whose cross-add arm this resolution un-blocked.
- `docs/wiki-evidence/harvest-method.md` — pacing and transport constraints the
  re-check sweep must respect.
