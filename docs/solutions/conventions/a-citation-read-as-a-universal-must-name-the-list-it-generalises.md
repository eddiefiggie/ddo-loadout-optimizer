---
title: "A quoted source read as a universal is not evidence — count the clauses you generalised across"
module: docs
date: 2026-08-26
problem_type: convention
component: dataset_pipeline
severity: high
related_components:
  - src/dino.py
  - src/membership.py
  - testing_framework
tags:
  - wiki-evidence
  - citations
  - over-generalisation
  - set-bonus
  - dino
  - synthesized-records
  - never-infer-a-value
applies_when:
  - "Writing a code comment or issue that cites a wiki page as justification for a blanket rule"
  - "A source page states a property per category, per table row, or per item, and the fix applies it to all of them"
  - "A citation contains the word every, all, always, or including — check what it was read from"
  - "A synthesized record is being stamped with a property that a harvested record also declares"
---

## Context

`AGENTS.md` says **never infer a value**: if the wiki does not state it outright,
quarantine and disclose. That rule catches an invented *number*. It does not
catch an invented *scope* — a real quoted value applied to more records than the
source gave it to. The citation looks impeccable, because the sentence it quotes
is true.

## What happened (#334 -> #538)

#334 fixed a real defect: the eleven synthesized Dinosaur Bone blanks carried no
set membership, so completing `The Legendary Dread Isle's Curse` required
*avoiding* the crafting blanks — the opposite of the game. The fix stamped the
set on the blanks, citing the page it came from:

> every crafted item's enchantment list, including the Rune Arm's, ends with it
> (wiki: `https://ddowiki.com/page/Dinosaur_Bone_Items`)

The page does not have *an* enchantment list. It has **six**, one per item
category, and the set name ends **three** of them. The three it does not end are
exactly the three whose lists contain `Isle of Dread: Set Bonus Slot: Empty` —
the hosts that *choose* one set from six, the Curse among the six. The
parenthetical "including the Rune Arm's" is the tell: it reaches for the least
obvious list that *does* end with the set, which is what you do when you have
checked some of them.

So four of eleven blanks were stamped with a set the same page withholds. Ten
days later a player reported the visible symptom: a Dinosaur Bone Armor counted
toward `Defender of Tanaroa` (bought at its Set Bonus slot) **and**
`The Legendary Dread Isle's Curse` at the same time.

Two things made it expensive rather than embarrassing:

- **It was load-bearing in a ratified golden.** `endgame-caster-ml32` equipped
  all three Set-Bonus hosts, spent all three slots on Tanaroa, and collected a
  free 5-piece Curse. A blank carries zero base affixes, so a phantom set bonus
  is the *entire* reason to equip one — the pinned "optimal" build was paying
  three gear slots for a set that does not exist. Correcting it raised every
  ranked stat.
- **It also deleted a real option.** `attach_dino_set_bonus_slots` filters a
  host's intrinsic sets out of its own pick pool, correctly, so one item is never
  two pieces of one set. The phantom intrinsic set therefore removed the Curse
  from the six-option pool the wiki puts it in. One over-generalised citation
  produced a free bonus *and* a missing choice, in opposite directions.

## What didn't work

**Trusting that a contradiction would surface.** gear-planner — this repo's
declared single source of truth for item affixes — had it right the whole time:
every item carrying `Isle of Dread: Set Bonus Slot: Empty` has no `sets` field.
The blanks are *synthesized*, so they never pass through the harvested record
they shadow, and no gate compares the two. Being right in the catalog bought
nothing. (Filed as #541.)

## The convention

**When a citation justifies applying a property to a set of records, state how
many source clauses you read and how many records you are applying it to.** If
those two numbers differ, the citation is a generalisation and must say what it
generalised over — or the rule must be narrowed to what was actually read.

Concretely, before writing `every X carries Y (wiki: <page>)`:

1. **Count the clauses.** A wiki page with per-category enchantment lists is six
   claims, not one. A table with a row per item is N claims. Read all of them.
2. **Check the negative cases by name.** Do not confirm the rule on three records
   and assume the rest; open the ones you expect to *fail* it. Here,
   `Item:Dinosaur Bone Helmet` settles it in one look — it has no
   `{{Named item sets|...}}` line at all.
3. **Look for the discriminator.** The exceptions were not arbitrary: they were
   exactly the records with a Set Bonus slot. A rule whose exceptions share a
   visible field is a rule that should be *keyed on that field*, and
   `carries_intrinsic_set` now is.
4. **Cross-read the harvested catalog.** If a native record for the same item
   already declares the property, the synthesized record must agree — and if
   nothing enforces that, say so or file it.

Write the ruling down with the verbatim text on both sides of the split, so the
next reader sees the exceptions without re-harvesting:
`docs/wiki-evidence/dino-set-bonus-hosts.md`.

## Prevention

- A citation containing **every / all / always / including** is a scope claim.
  Treat it with the same suspicion as an unsourced number — `AGENTS.md` already
  bans the second, and this is the first wearing its clothes.
- A property that some records have and others do not needs a **predicate**, not
  a constant. `INTRINSIC_SET` applied to a loop over all blanks had nowhere to
  express the exception; `carries_intrinsic_set(blank)` does, and it is the
  thing a test can pin.
- **Ratified goldens can encode the bug.** A golden that moves after a data fix
  is not automatically a regression — but a golden whose *stats all improve*
  when an option is removed is a red flag pointing at the pinned build, not the
  fix. Chase it: here it meant the pinned loadout had been buying something free.

## Related

- `docs/wiki-evidence/dino-set-bonus-hosts.md` — the ruling and the verbatim text.
- `docs/solutions/logic-errors/synthesized-records-need-the-full-set-field-chain.md`
  — the first lesson from this same synthesis path (a field that is *inert*).
  This is the second (a field that is *wrong*).
- `docs/solutions/conventions/a-dated-coverage-claim-cannot-notice-its-own-staleness.md`
  — the sibling failure: a completeness claim that was true when written.
- #334 (the over-stamp), #538 (the defect), #541 (the missing cross-read gate).
