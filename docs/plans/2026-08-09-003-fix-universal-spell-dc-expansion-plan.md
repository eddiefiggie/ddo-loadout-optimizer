---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
execution: code
product_contract_source: ce-brainstorm
title: Universal Spell DC Expansion - Plan
date: 2026-08-09
---

# Universal Spell DC Expansion - Plan

## Goal Capsule

**Objective.** Make a spell-school priority mean *"get the highest Necromancy DC
possible"* rather than *"get the highest Necromancy-specific effects possible"*.
Universal DC sources — Spell Focus Mastery and bare Spell Focus, in every bonus
type they come in — are invisible to school priorities today, so the solver never
picks the sacred, quality, or insightful focus gear that a real DC build is built
around.

**Product authority.** GitHub issue #205 (user-reported, necromancer build).
Mechanics verified directly against the DDO Wiki on 2026-08-09; see Evidence.

**Open blockers.** None. `Deific Focus` is quarantined rather than blocking —
see Scope Boundaries.

## Product Contract

### Problem

A player ranked Nullification, Void Lore, Void Intensity, Necromancy,
Enchantment, Illusion, and Conjuration, and got a loadout with **no sacred,
quality, or insightful focus effects at all**. That is not a data gap. Every one
of those effects is present and correctly typed in the dataset; the solver simply
cannot see them from a school priority.

`web/model.js:51` credits an affix only when its **name** exactly matches a
ranked target:

```js
const put = (stat, type, val) => {
  if (!targetSet.has(stat)) return;
```

So ranking `Necromancy Focus` makes all 232 `Spell Focus Mastery` affixes and all
19 bare `Spell Focus` affixes worth exactly zero. The solver has no reason to
select the item carrying them, and correctly reports a total that is nonetheless
far below the achievable DC.

There is no UI workaround. Ranking both `Necromancy Focus` and `Spell Focus
Mastery` does not help, because strict lexicographic priority maximizes the first
bucket completely before considering the second — it never maximizes the sum.

### Evidence

Verified from the DDO Wiki, 2026-08-09, same-origin from a ddowiki tab.

[Increasing spell DCs](https://ddowiki.com/page/Increasing_spell_DCs), Items:

> Items with Spell Focus Mastery apply to all spells. School-specific effects,
> such as Evocation Focus items, apply only to a single school of spells, but
> they scale faster.
> The effects come in several bonus types. Effects with the same bonus type
> don't stack, only the highest applies.

[Spell Focus Mastery](https://ddowiki.com/page/Spell_Focus_Mastery):

> Spell Focus Mastery adds Equipment bonus to the DC of all your spells. Does
> not stack with other Spell Focus item enchantments, stacks with Spell Focus
> feats.

Two rules follow, and they are the whole mechanic:

1. A universal DC source applies to **every** school.
2. Within one bonus type, universal and school-specific do **not** stack — only
   the highest applies. Across bonus types, they stack.

Bare `Spell Focus` is confirmed universal by the same page's worked example,
which credits `Stormreaver's Napkin` — stored as `Spell Focus | Equipment | 1` —
as "+1 to her DCs", plural.

[I:Legendary Argonnessen Eye Band](https://ddowiki.com/page/Item:Legendary_Argonnessen_Eye_Band)
confirms `Sacred Spell Focus Mastery +3`, matching our stored
`Spell Focus Mastery | Sacred | 3`.

### Requirements

**R1 — Expand universal DC affixes per school at build time.** Each affix named
`Spell Focus Mastery` or `Spell Focus` expands into the seven school focus
affixes — Abjuration, Conjuration, Enchantment, Evocation, Illusion, Necromancy,
Transmutation — at the **same value and the same bonus type**. Expansion happens
once, at the data layer, so the objective, the dominance pre-filter, set
threshold evaluation, browse, and exports all see the real per-school
contribution without any of them knowing this rule exists.

**R2 — Stacking falls out of existing bucketing, not new code.** With R1 in
place, the existing `name||equivType(type)` max-bucketing already produces both
wiki rules: a universal and a school-specific source of the same bonus type
collapse to the highest, and different bonus types stack. No new stacking
primitive is introduced. If a change to stacking logic appears necessary, that is
a signal the expansion is wrong, not that the rule needs an exception.

**R3 — Attribution shows the real enchantment name.** Each expanded affix carries
the originating enchantment name as provenance. The Ranked Priorities proof panel
credits the contribution to the ranked school while **displaying what is actually
on the item** — `Sacred Spell Focus Mastery +3`, not `Necromancy Focus +3`. A
player checking the app against an in-game tooltip or a wiki item page must find
the same text on the item. This is the one place the ability-score precedent is
deliberately not copied: `src/umbrella.py` discards the origin, and here it must
be preserved.

**R4 — Expanded-away names leave the picker and redirect saved builds.**
`Spell Focus Mastery` and `Spell Focus` join `expanded_away_names`, so no player
can rank a name that no item carries any more. Existing saved characters that
ranked either name are redirected to the concrete school stats through the
mechanism already built for #136 — no bespoke migration.

**R5 — Golden re-ratification is deliberate.** This changes the optimal loadout
for every caster build that ranks a school. `solver_golden` will diff. The diff
is re-ratified item by item against the wiki rules above, never blanket-accepted.

### Scope Boundaries

**In:** `Spell Focus Mastery` (232 affixes: Quality 69, Insight 59, Equipment 41,
Profane 39, Sacred 16, Exceptional 6) and bare `Spell Focus` (19 affixes:
Equipment 13, Profane 5, and one Quality).

**Out, with reasons:**

| Excluded | Why |
|---|---|
| `Rune Arm Focus` | The wiki states it "isn't directly tied to a Spell School but to the Rune Arm itself." Expanding it would be a fabricated DC. |
| `Deific Focus` (3 items, Sacred) | https://ddowiki.com/page/Deific_Focus does not exist. Quarantined under the exclude-until-verified gate and disclosed in the coverage note. Ships only if a future lookup states the rule outright. |
| Spell **lore** (`Universal Spell Lore`, `Void Lore`, element lores) | `docs/wiki-evidence/spell-lore.md` already ruled universal and element-specific lore genuinely **stack** — they are different stats, not an umbrella. Expanding lore would collapse two stacking sources and is a regression, not an extension. |
| Non-spell focuses | Breath Weapon, Equipoised, Raging, `Weapon Focus: *`, `Dragonshard Focus: *` — not spell DCs. |
| No-op augment recommendations | Issue #206. Different defect class: the arithmetic is right, the recommendation wastes a slot. Expect it to become **more** visible after this ships, since expansion creates more same-name-same-type collisions. |
| Stale gear-planner values | Issue #207. The Legendary Argonnessen Eye Band reads `Spell Focus Mastery +8` on the wiki and `+5` in gear-planner. Data correction, independent of this fix. |

The expansion set is an explicit allowlist, exactly like `_UMBRELLA`. A name is
added only with a wiki quote stating it applies to all spells.

### Key Decisions

- **A school target absorbs universal sources; the universal name leaves the
  picker.** Ranking `Necromancy Focus` means "maximize my Necromancy DC". Chosen
  over keeping a separate all-schools entry, which would need a mechanism beyond
  the expanded-away path since no item would carry the raw name afterward.
- **Expand at build time, not at solve time or the `dataset.js` load seam.**
  Solve-time target aliasing would require the same knowledge in `variantBuckets`,
  the Pareto pre-filter, set thresholds, browse, and exports — the per-consumer
  duplication `umbrella.py` was written to eliminate, and the exact shape of the
  bug being fixed. The `dataset.js` seam is reserved for `Sheltering`, and
  `web/dataset.js:416-418` warns explicitly against conflating the two.
- **Provenance is carried through expansion.** Required by R3; the only genuinely
  new plumbing in the change.

### Success Criteria

1. A ML 34 solve ranking `Necromancy Focus` selects gear carrying universal DC
   sources wherever they beat school-specific alternatives, including the
   Legendary Argonnessen Eye Band's `Sacred Spell Focus Mastery +3`.
2. The proof panel credits that +3 toward Necromancy while displaying the string
   `Sacred Spell Focus Mastery`.
3. A loadout holding both a universal and a school-specific source of the **same**
   bonus type reports the **higher** of the two, not the sum.
4. A loadout holding sources of **different** bonus types reports the **sum**.
5. `Spell Focus Mastery` and `Spell Focus` are absent from the picker, and a saved
   build that ranked either loads with the school stats instead.
6. `Rune Arm Focus` is unchanged, and spell lore stacking is unchanged — proven by
   a test that fails if either is expanded.
7. The `solver_golden` diff is re-ratified with a written rationale per changed
   build.

### Outstanding Questions

- Is a spell-focus tooltip-snapshot guard worth building — the `speed_split`
  pattern applied to DC values — or is #207 better served by a sampling audit of
  gear-planner values against wiki item pages? Deliberately left to #207.
- `Deific Focus` stays quarantined until a wiki source states its behavior. If
  the article appears, revisit the allowlist.
