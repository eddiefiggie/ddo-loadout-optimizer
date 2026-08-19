---
title: "Read the standing ruling first, and walk the evidence hierarchy before declaring a data gap"
module: wiki-evidence
date: 2026-08-19
category: conventions
problem_type: convention
component: development_workflow
severity: high
related_components:
  - docs/wiki-evidence/
  - affix_type_corrections
  - elemental_resistance_split
  - type_corrections
applies_when:
  - "About to file an issue whose ask is 'we need a wiki ruling' or 'the harvested evidence contradicts itself'"
  - "Two representations of the same wiki fact disagree — a cell label versus a tooltip, a stored type versus a rendered sentence — and the instinct is to call it ambiguous"
  - "About to invoke the never-infer-a-value gate to justify a deferral"
  - "An upstream refresh re-types, renames, or re-spells a field that a join or a standing ruling depends on"
  - "A seed shard already stores the source markup for the value in question (a raw template invocation)"
tags:
  - ddo
  - wiki-evidence
  - triage
  - standing-ruling
  - evidence-hierarchy
  - exclude-until-verified
  - never-infer
  - bonus-type
---

# Read the standing ruling first, and walk the evidence hierarchy before declaring a data gap

## Context

The #374 gear-planner refresh (PR #382) re-typed `Elemental Resistance` from
`Insight` to `Competence` on six carriers: Barnacled Buckler, Epic Chain of
Conviction, Epic Death's Rampart, and Jeweled Cloak levels 23/24/25. The
elemental-resistance split module joins its wiki readings by item name **plus
the affix's bonus type** — `src/elemental_resistance_split.py:217-224` states
this outright ("Joins by item name plus the affix's bonus type"), and
`_entry_reading` at `src/elemental_resistance_split.py:182-200` case-folds the
type and returns nothing when no reading matches. With the dataset side now
reading `Competence` and the shard still keyed `Insight`, the join stopped
matching and all six affixes were quarantined — removed and disclosed by
`src/elemental_resistance_split.py:242-251`. That is the module's designed
fail-safe, not a pipeline defect, but it was solver-visible: a player ranking
Acid/Cold/Fire/Electric resistance scored nothing from any of the six.

I filed **#379** claiming the evidence "contradicts itself" and that a fresh
wiki ruling was needed before anything could be fixed. The quoted contradiction
was the harvested tooltip, whose visible label and sentence disagree:

    Competence Elemental Resistance - 10: This item provides a +10 Insight
    bonus to your Acid, Cold, Fire, and Electrical resistances.

I concluded that the repo's "never infer a value" rule (`AGENTS.md:54`) blocked
me. Two things were already true and unread.

**First — a standing ruling had already answered exactly this.**
`docs/wiki-evidence/elemental-resistance.md:40-45`, ruled 2026-08-13 under
#191, reads verbatim:

> **The legacy dialect's visible label lies about the type.** The
> Competence/Insight rendering's visible text reads `Competence Elemental
> Resistance - N` even when the tooltip states an Insight bonus (Barnacled
> Buckler, the Jeweled Cloak epics, the two Epic U-items). The tooltip is the
> authority, per `bundled-template-values-live-in-the-tooltip-not-the-cell.md`;
> gear-planner's stored types already follow the tooltip.

That names the same dialect, the same phenomenon, and the same six carriers.
The "contradiction" I reported was a documented, dated, resolved fact.
`AGENTS.md:16` states the convention I skipped in one bolded sentence: "**Read
the relevant ruling before re-investigating a value.**" (`CLAUDE.md` is a
symlink to `AGENTS.md`, so the rule loads under either name.)

**Second, and sharper — I judged the weakest layer of evidence available.** I
assessed *rendered text* and called it a tie. The wiki's own template
invocation states the bonus type as a parameter, and our shard was already
storing it. Every one of the six records in
`data/seed/compendium/elemental_resistance.json` carries a `raw` field holding
the invocation — `"{{Elemental Resistance|elemental|10|insight}}"` at line 218
(Barnacled Buckler) and lines 231, 244, 257 (the three Jeweled Cloaks), and
`"{{Elemental Resistance|Elemental|10|Insight}}"` at lines 107 and 127 (Epic
Chain of Conviction and Epic Death's Rampart, each beside an
`Enhancement`-typed sibling). The parser treats that token as the type by
construction: `src/elemental_resistance_split.py:78-85` documents "The type
token is the third positional parameter (absent = Enhancement)" and captures
`(competence|insight)` in the invocation regex;
`tests/test_elemental_resistance_split.py:82` pins
`parse_invocation("{{Elemental Resistance|elemental|10|insight}}") == (10,
"Insight", False)`.

That `insight` parameter is the wiki stating the bonus type. It is source
markup, not a rendering to be interpreted. "Never infer a value" was
**satisfied**, not blocked — and the thing that satisfied it was in a file open
in the same session as the tooltip I was busy calling ambiguous.

## Guidance

### The evidence hierarchy

When a wiki-sourced fact appears contested, evidence has three layers and they
are not equal:

1. **Template invocation** — the source markup, e.g.
   `{{Elemental Resistance|elemental|10|insight}}`. Parameters are the page
   author stating the fact. Highest authority.
2. **Rendered tooltip** — what the template expands to. Authoritative over the
   cell, per `bundled-template-values-live-in-the-tooltip-not-the-cell.md`, but
   it is a rendering of layer 1.
3. **Visible cell label** — the enchantment line as displayed. Lowest; known to
   lie in at least the legacy Elemental Resistance dialect.

**Declaring a data gap means having walked all three, not having found two
layers that disagree.** A disagreement between layers 2 and 3 is not
ambiguity — it is the hierarchy doing its job, and the resolution is to read
layer 1. I compared 3 against 2, called it a tie, and never looked at 1.

This also sharpens the never-infer gate. **Never-infer is satisfied or blocked
only after the hierarchy has been walked.** Invoking it at layer 3 to justify a
deferral is a misuse of the gate, not an application of it — the gate exists to
stop guessing, not to excuse stopping.

### The triage rule that catches it earlier and cheaper

Before filing an issue that asks for a wiki ruling, grep `docs/wiki-evidence/`
for the affix name. `AGENTS.md:16` already requires this and gives the reason:
"Several 'obvious' corrections here are recorded as bugs, and at least one
value has been ruled on wrongly three times." An issue asking a question the
repo has already answered is worse than no issue: it converts settled knowledge
back into open work, against the explicit statement at `AGENTS.md:38` that
`docs/solutions/` and `docs/wiki-evidence/` "hold resolved knowledge, never
open work."

Two cheap checks, in this order, before writing the words "this needs a wiki
ruling":

- `grep -ril "<affix name>" docs/wiki-evidence/` — is this already ruled?
- Does the shard record a `raw` invocation for this item? If so, read it before
  judging any rendered string.

### Defend the ruling at the seam built for it

Once the ruling was read, the fix was mechanical and needed no new harvest.
`data/seed/compendium/affix_type_corrections.json:4` is the seam whose own
`_meta.note` states the authority rule: "gear-planner is the single source of
truth for WHICH affixes a record has, read structurally. The DDO Wiki is the
source of truth for the BONUS TYPE when the two disagree and the wiki's
rendered tooltip states it outright." Six entries were added — Barnacled
Buckler (line 33), Epic Chain of Conviction (46), Epic Death's Rampart (59),
and the three Jeweled Cloaks (72, 85, 98) — each `Competence -> Insight` at
value `10`, each carrying the tooltip, the `template` invocation, the wiki URL,
and a `note` citing the #191 ruling.

Upstream's new `Competence` is upstream reading the visible label that #191 had
already documented as lying. Correcting it back is defending a ruling, not
overriding a source.

## Why This Matters

The cost of the delay was measured, not asserted, by rebuilding with and
without the six corrections. `web/data/items.json`
`metadata.elemental_resistance_coverage` now reads `expanded: 59`,
`components: 242`, `quarantined: 0`, `excluded: []`. Before the fix it read
`quarantined: 6`, `expanded: 53`, `components: 218` — exactly the six readings
and their 6 x 4 components, all six `sonic: false`.

So the sequence was: an issue filed asking a question already answered; a fix
deferred as "blocked on a wiki ruling" when nothing was blocked; the user told
twice that a wiki re-read was required; and six real resistance grants missing
from every solve in the meantime. The correction took one grep of
`docs/wiki-evidence/`.

**The answer was recorded in three separate in-repo places before the issue was
filed**, and none of them was read:

| Where | What it already said |
| --- | --- |
| `docs/wiki-evidence/elemental-resistance.md:40-45` | The visible label lies about the type, on these exact six carriers |
| `data/seed/compendium/affix_type_corrections.json` `_meta.note` | The wiki is the authority for BONUS TYPE when the two disagree |
| `data/seed/compendium/elemental_resistance.json` `raw` fields | `{{Elemental Resistance\|elemental\|10\|insight}}` — the type, stated as a parameter |

The failure was not a missing record. It was three unread ones.

The generalisable failure is not "I missed a doc." It is that **I stopped
searching for evidence at the moment the evidence I had became confusing.** A
contradiction feels like an endpoint. It is a signal to go one layer up.

## When to Apply

- Before filing an issue whose ask is "we need a wiki ruling" or "the evidence
  contradicts itself."
- When two representations of the same wiki fact disagree — a cell label versus
  a tooltip, a stored type versus a rendered sentence — and the instinct is to
  call it ambiguous.
- Before invoking never-infer to justify a deferral. Walk the hierarchy first;
  the gate is only reached at layer 1.
- After any upstream refresh re-types, renames, or re-spells a field that a
  standing ruling covers. #374 did exactly this, and
  `a-gate-cascade-is-the-refresh-report-not-an-obstacle.md` covers the broader
  discipline for reading a refresh's gate cascade.
- Any time a seed shard carries a `raw` / `template` / invocation field. Its
  presence means layer 1 is already local; no harvest, no rate limit, no
  Chrome-MCP round trip.

## Examples

### The two double-affix carriers are safe by construction

Epic Chain of Conviction and Epic Death's Rampart each bear TWO
`Elemental Resistance` affixes — `Enhancement 30` with Sonic beside
`Insight 10` without — documented at
`docs/wiki-evidence/elemental-resistance.md:34-38` and visible in the shard at
`data/seed/compendium/elemental_resistance.json:94-113` and `114-133`. A
correction that fired on the wrong one would silently corrupt the Sonic-bearing
reading.

It cannot. `src/type_corrections.py:81-83` builds the match key as
`(corr.get("name"), corr.get("from"))` and compares it against
`(a.get("name"), a.get("type"))` on each affix. With `from: "Competence"`, only
the re-typed reading matches; the `Enhancement 30` sibling has a different type
and is never touched. The `(name, from)` key was designed as a stale guard —
`src/type_corrections.py:21-25` — and disambiguating same-named affixes on one
record is a property it happens to have for free.

The same entry shape also carries `value: "10"`, asserted at
`src/type_corrections.py:89-99`: if upstream changes the magnitude, the build
fails rather than pinning a type onto a record that moved.
`assert_all_reached` (`src/type_corrections.py:115-131`) fails the build if any
entry reaches no record in any channel, so a rename upstream surfaces instead
of no-opping.

### The guard test fired in both directions

`tests/test_elemental_resistance_split.py:393-455` has now caught a real defect
twice and been resolved once, and its docstring keeps the whole history — the
test was originally `test_today_no_carrier_is_quarantined`, became
`test_the_only_quarantined_carriers_are_the_six_upstream_retyped` when the
refresh broke the join, and is now
`test_no_carrier_is_quarantined_and_the_retyped_six_are_restored`.

Two-directional means both edges are asserted: it fails if any carrier is newly
quarantined, and it fails if the restored counts silently regress. It also
checks that the six shard entries still key on `Insight` and that each of the
six correction entries exists and points `Competence -> Insight` — with the
comment "Without this the test would pass on a build that simply dropped the
carriers." That is the design working: the moment the carriers were restored,
the test's previous expectation (six quarantined) went red and forced the
docstring to be rewritten with the ruling rather than the guess.

## Related

- `docs/wiki-evidence/elemental-resistance.md` — the #191 ruling this learning
  failed to read, including the full 58-carrier census.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`
  — **distinct but adjacent**: that learning establishes tooltip over cell
  (layers 2 over 3), scoped to a bundled template's *numbers*. This one adds
  the layer above the tooltip, extends the failure mode to *bonus type*, and is
  mostly about *process* — read the standing ruling, and walk the hierarchy
  before declaring a gap.
- `docs/solutions/conventions/recheck-quarantines-on-adjacent-pages-before-building-exceptions.md`
  — same trigger shape, opposite direction: that doc sweeps outward to the
  wiki's adjacent pages. This one supplies the inward step zero it omits, which
  is also the cheapest step.
- `docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md` —
  the gate that was mis-invoked here.
- `docs/solutions/conventions/a-gate-cascade-is-the-refresh-report-not-an-obstacle.md`
  — the #374 migration discipline this quarantine surfaced under.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the
  quarantine-don't-guess gate whose fail-safe correctly removed the six.
- `docs/solutions/conventions/measure-the-counterfactual-before-crediting-your-fix.md`
  — the with-and-without rebuild that produced the 6 -> 0 / 53 -> 59 /
  218 -> 242 figures above.
- PR #387 (closing #379), against the #374 refresh shipped as PR #382.
