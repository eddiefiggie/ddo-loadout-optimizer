---
title: "Loadout Stat Chips and Notice Actions - Plan"
type: feat
date: 2026-08-22
topic: loadout-stat-chips-and-notice-actions
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Loadout Stat Chips and Notice Actions - Plan

## Goal Capsule

**Objective.** Make every stat on a loadout card readable at a glance in one
visual language, say which of them the solve was actually steering toward, and
make the notices panel's resolution controls do something visible when pressed.

**Tracked as** #453.

**Product authority.** This document, from a maintainer brainstorm on
2026-08-22 following a live pass over build `08222026.3`.

**Open blockers.** None.

**Follows #449.** Every item here is downstream of the results-phase UI clarity
work. #449's own Definition of Done requires a live browser pass that was never
performed; this brainstorm is part of that pass, and two of the three findings
are defects in what #449 shipped rather than new scope. #449 stays open on its
remaining checklist.

**Product Contract preservation.** This plan changes **R31** of #449, which
retained the three-contribution chip cap to govern row height at phone width.
R31's *intent* is preserved and restated as R9 below — the cap on what is
displayed at rest survives; what changes is that the overflow is now reachable
rather than discarded. No other #449 requirement is altered.

**Execution profile.** Browser-only. No pipeline, dataset, or seed change.

**Stop conditions.** Stop and surface rather than guessing if "incidental" and
"tracked" cannot be distinguished for a given contribution without a second
source of truth, or if the utility class cannot be derived from the existing
presence/utility model.

**Tail ownership.** This plan does not own the commit, PR, or deploy. Player-facing
behavior changes, so the three build markers move together per `AGENTS.md`.

---

## Product Contract

### Summary

Every stat an equipped item grants becomes a chip, replacing the plain-text affix
run. Three visual classes distinguish a stat the solve is ranking, a stat that
merely comes with the item, and a utility effect. Augment-granted stats stay
grouped beneath the augment that grants them. Separately, the notices panel's
`Adjust & re-solve →` control opens the panel it scrolls to, which it does not
do today.

### Problem Frame

**The card speaks two languages.** #449 U7 turned an item's *ranked* contributions
into a chip row — value, stat, and qualifiers on a sub-label — and it reads well.
Everything else on the same card stayed a comma-run of plain text
(`Armor Class +58 Armor · Enhancement Bonus (Armor) +15 · Accuracy +24
Competence`), and augment-granted stats sit inline beside the augment name in a
third style again. So the card renders the same kind of fact three ways, and the
one styling that means something — *this is what the solve was steering toward* —
is not visually separated from the two that do not.

The player's read of a loadout card is "what am I getting, and which of it did I
ask for." The card currently answers the first question three times in three
voices and the second only if you already know that the chips are the ranked ones.

**A third class is missing entirely.** Utility effects — Ghostly, True Seeing,
Freedom of Movement — are tracked as presence rather than magnitude and fill
slots after the ranked stats are locked. They are neither a ranked contribution
nor an incidental affix; they are the reason an item was chosen once the ranked
stats stopped separating candidates. Nothing on the card says so.

**The notice control is inert.** `jumpFromNotice` scrolls `#wz-adjust-slot` into
view and calls `.focus()` on it. `#wz-adjust-slot` is the wrapper div; the panel
is `<details id="wz-adjust">`, documented in its own emitter as *"Collapsed by
default."* The jump never sets `open`, and the wrapper is not focusable, so the
focus call is a no-op. Pressing the control scrolls the page a little and does
nothing else — which is what was reported.

Three notices route to that anchor, so one defect presents three times, including
on a control labelled `Re-solve now`.

**What is not broken.** The brainstorm also asked for a progress indicator on
notice-button actions. There is one, and it already fires: all four `Re-solve ⚡`
controls call `solve()`, which raises the full-screen overlay and — per #218 —
awaits `yieldToPaint()` before the synchronous MILP blocks the main thread,
specifically so the overlay renders on a re-solve where HiGHS is already cached.
The perceived absence was the inert jump above: the player pressed a control,
nothing happened, and read that as missing feedback. Recorded here so it is not
re-investigated; no requirement follows from it.

### Key Decisions

- KD1. **Chips replace the text run; they do not join it.** Every stat an item
  grants renders as a chip. *(session-settled: user-directed — chosen over
  chipping only ranked and utility stats and leaving incidental ones as text:
  that preserves exactly the two-languages problem the report is about.)*

- KD2. **Three classes, three treatments.** *Tracked* (a contribution to a ranked
  priority), *incidental* (a real affix advancing nothing the player ranked), and
  *utility*. The tracked class carries the vivid treatment; incidental is muted;
  utility is visually distinct from both rather than a shade between them.
  *(session-settled: user-directed.)*

- KD3. **Augment-granted stats stay grouped under their augment.** They render as
  chips in the same three classes, nested beneath the augment that grants them,
  rather than merged into one flat row per slot. *(session-settled: user-directed
  — chosen over a flat merged row and over a flat row with per-chip source
  markers: the loadout is a shopping list, so "which gem do I actually go slot"
  must survive; and a hover-only marker is unavailable on touch.)*

- KD4. **The rank-1 accent survives.** #449 R21 distinguishes the top-priority
  chip by a named accent token and by border treatment. Tracked chips are now a
  larger population, which makes the rank-1 distinction more useful, not less.

- KD5. **The jump opens what it scrolls to.** A control that moves the viewport
  and changes nothing else is indistinguishable from a control that failed.

- KD6. **The notice control does not itself solve.** It opens the panel and puts
  focus in it; the player presses `Re-solve ⚡`. *(session-settled: user-directed —
  chosen over having `Re-solve now` solve directly. The smaller change; the panel
  is where the adjustments are, and solving before the player has made any is a
  wasted 3.5 seconds.)* The `Re-solve now` label is corrected to match.

### Requirements

**Chips**

- R1. Every stat an equipped item grants renders as a chip. No plain-text affix
  run remains on the loadout card.
- R2. A chip whose stat is one of the player's ranked priorities is visually
  distinct from one that is not, without relying on hover or color alone.
- R3. A chip for a utility effect is visually distinct from both R2 classes.
- R4. The rank-1 contribution keeps its existing accent treatment (#449 R21).
- R5. Every qualifier #449 R20 preserved survives: the value, the stat, the bonus
  type, `(set)`, `(from <stat>)`, and the #88 player-override disclosure. In
  particular an overridden bonus type is still labelled as the player's call.
- R6. Augment-granted stats render as chips grouped beneath the augment granting
  them, in the same three classes.
- R7. The three classes are derived from the existing model — the ranked target
  list and the existing presence/utility definition — not from a new
  classification stored alongside.
- R8. A chip's class is stable between a fresh solve and a restored snapshot.

**Density**

- R9. The card's resting height at phone width does not regress from today.
  #449 R31's cap on displayed chips is preserved in effect; where an item carries
  more stats than fit, the remainder is reachable rather than discarded.
- R10. Tracked and utility chips are never the ones hidden by R9.

**Ceiling emphasis**

- R11. In the `AT CEILING` notice, each named stat is emphasized — bold, and in
  the existing at-ceiling green — while its total stays in the body treatment.
- R12. R11 reuses the token already carrying "at ceiling" green. No new color is
  minted.
- R13. Emphasis is carried by weight as well as color, so the distinction
  survives a color-vision difference or a monochrome print export.
- R14. The `AT CEILING` sentences in every export are unchanged. `projection`
  stays the single wording source; this is presentation only.

**Notice actions**

- R15. A notice control targeting the `Adjust & re-solve` panel opens that panel.
- R16. It then moves focus to the first control inside the opened panel.
- R17. A control whose anchor cannot be found still fails silently rather than
  throwing, as today.
- R18. The `stale snapshot` notice's control is labelled for what it does under
  KD6 — open the panel — not `Re-solve now`.

### Acceptance Examples

1. **Three classes on one card.** Solve with Melee Power ranked and inspect the
   armor card: `Accuracy +24 Competence` (tracked, ranked), `Enhancement Bonus
   (Armor) +15` (incidental), `Soundproof` (utility) are each visibly a different
   kind of thing.
2. **Augment provenance.** The helmet's `Seeker +4 Artifact` reads as belonging to
   `Solar Gem of Critical Confirmation (Legendary)`, not as a loose card-level
   chip.
3. **Ceiling emphasis.** A solve with two saturated priorities shows both stat
   names bold and green in the `AT CEILING` card; the totals do not change weight.
4. **The jump works.** Press `Adjust & re-solve →` on the empty-slot notice: the
   panel scrolls into view *and opens*, with focus in its first control.
5. **Phone height.** At 375px, a heavy item's card is no taller at rest than it
   is today, and its tracked and utility chips are all still visible.

---

## Outstanding Questions

Deferred to planning; these are `/ce-plan` input, not backlog, and are not filed
as issues.

1. **What is the R9 overflow affordance** — a `+N more` toggle, a per-card fold,
   or the Deep Dive tab absorbing the remainder? The Deep Dive already lists every
   affix, which may make an on-card overflow redundant.
2. **Does "incidental" need a further split** between an affix that advances
   nothing ranked and one that advances a ranked stat but lost its bonus-type
   bucket to a larger contributor? The second is arguably tracked-but-outbid, and
   `outbidNotice` already names that state at the solve level.
3. **Does R1 apply to the Deep Dive tab** as well as the Loadout tab, or is the
   Deep Dive's full affix list deliberately a different surface?
4. **Which existing token is "the at-ceiling green"** — `--optimal`, used by
   `.pd-chip-check`, or the color `.stat-ceiling.at-ceiling` carried before #449
   moved the fact off the gear boxes?
