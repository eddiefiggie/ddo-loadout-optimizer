---
title: A synthesized record must be DERIVED from the harvested record it shadows, not asserted alongside it
module: dataset_pipeline
date: 2026-08-26
problem_type: design_pattern
component: dataset_pipeline
severity: high
tags:
  - synthesized-records
  - dino
  - set-bonus
  - gear-planner
  - derivation-over-assertion
  - build-gate
  - shadowed-record
applies_when:
  - A pipeline synthesizes item records that stand in for records the harvested catalog already carries
  - A hand-written rule decides a field the catalog also states for the same items
  - A synthetic record is appended after the enrichment passes that would otherwise derive its fields
  - Many harvested records collapse into one synthesized record (dedupe by slot, by type, by category)
related_components:
  - src/dino.py
  - build_dataset.py
---

# A synthesized record must be DERIVED from the harvested record it shadows, not asserted alongside it

## Problem

The eleven Dinosaur Bone blank hosts are synthesized by `src/dino.py`. gear-planner
carries the same items as native records, and on the exact field that went wrong it
was **right the whole time**: every `Dinosaur Bone` item with an
`Isle of Dread: Set Bonus Slot` has no `sets`, and every one without that slot lists
`The Legendary Dread Isle's Curse`.

#334 stamped the set on all eleven blanks anyway, from a hand-written predicate. The
stamp contradicted the catalog for four of them for ten days and no gate noticed,
because **nothing compared a synthesized record against the harvested record it
shadows**. A Set-Bonus host counted as a Curse piece *and* spent its Set Bonus slot on
a second set — two hosts paying for one set apiece and delivering two — and the
over-stamp also deleted a real option, because `attach_dino_set_bonus_slots` filters a
host's intrinsic sets out of its own pick pool. A player found it (#538), not the build.

This is the second lesson from the same synthesis path.
`logic-errors/synthesized-records-need-the-full-set-field-chain.md` records the first:
a field being **inert**. This one is a field being **wrong**.

## Symptoms

- A synthesized record ships a value the harvested catalog contradicts, and the whole
  suite is green.
- The defect surfaces as a player-visible arithmetic error (a set counted twice) rather
  than as a data error, because the data layer has no opinion about it.
- The fix, once found, is a one-line predicate change — which is what makes the class
  dangerous: it is easy to fix and impossible to notice.

## What Didn't Work

**Correcting the rule.** #540 fixed the predicate against the wiki and shipped, and the
codebase was then exactly one careless edit away from the same defect. A rule that
happens to be right is not a gate; nothing was watching it.

**A gate that only asserts agreement.** The obvious follow-up — "assert the blank's
stamp matches the natives" — detects the failure but keeps two writable sources of the
same fact. Detection is strictly weaker than making the disagreement unrepresentable.

## Solution

**Derive the field from the shadowed records, so the two cannot disagree by
construction.** `native_set_membership()` reads gear-planner **structurally** (`slot`,
`type`, `sets` — never a free-text re-parse), joins on the worn slot the blank
collapses on, and returns what those natives declare. `_stamp_set_membership` stamps
*that*. The predicate cannot contradict the catalog because it **is** the catalog.

Three build-stopping gates guard the join itself, since a derivation is only as honest
as its inputs:

- **zero records** — the family vanished from the dump or the name prefix drifted. A
  guard handed an empty population reports success forever;
- **a split slot** — two natives collapsing into one blank disagree, so there is no
  single membership the blank could honestly claim. Fail rather than resolve it by
  majority or first-wins;
- **an unshadowed blank** — the join drifted, and an unshadowed synthesized record is
  precisely the unchecked thing this pattern forbids.

**Pin the derived VALUES to what has actually been ruled on, not just their shape.**
Deriving moves the authority to the mirror, and a mirror can move ahead of the
ruling. The first cross-check written here compared only "set or no set" against the
wiki rule — so a refresh that put a Dinosaur Bone Belt in a *different* set would
have sailed through and stamped a name no ddowiki source states. `RATIFIED_SET_NAMES`
closes that: the derivation refuses any name outside what `docs/wiki-evidence/` has
ruled on, compared on the canonical key so a cosmetic `" Set"` suffix is not a false
alarm. A genuinely new set then costs one wiki harvest instead of arriving silently.

That the rejected names in the test are *real* sibling sets, not nonsense, is the
point: the plausible unratified value is the one that gets stamped.

Keep the old rule as an **independent cross-check**, not as the source. The two really
are independent here: the rule reads `dino_set_bonus_slot`, which comes from the
hand-written host layout in `src/dino_native.py`; the derivation reads the catalog.
When they disagree the build stops and names both sides plus the ruling doc, so a human
rules on it — which is what #334 needed and did not get.

## Why This Works

The failure mode is two writable sources for one fact with no comparison between them.
Deriving deletes one source. The cross-check then covers the direction derivation
cannot: a catalog change that silently contradicts a documented wiki ruling stops the
build instead of quietly re-stamping every blank and changing every solve.

The evidence that the derivation is faithful is that it reproduced the shipped values
byte-for-byte: rebuilding after the change altered nothing in `items[]` — only the two
new coverage disclosures. A derivation that changes no output is a derivation that was
always the real rule.

## Prevention

- When a pipeline synthesizes a record that stands in for harvested ones, ask which of
  its fields the harvest already states, and **derive every one of them**. A hand-written
  value for a fact the catalog carries is a defect waiting for a data refresh.
- Join on the same key the synthesis collapses on, and require unanimity across the
  collapsed group — a split is a finding, not a tie to break.
- Make the guard refuse an empty population, and prove it fails: corrupt each input the
  gate exists to reject and watch the real build go red, then restore.
- Deriving from a mirror is not the same as sourcing from the authority. Pin the
  derived values to what the authority has actually been read to say, and make
  widening the pin a harvest — never the edit that turns a red build green.
- Disclose the derivation in build coverage (`blank_intrinsic_sets`,
  `blank_set_shadow_counts`), so "how many carry it, on whose authority" is read off the
  artifact instead of recounted against a rule in someone's head.

## Related Issues

- #538 (the reported double-dip), PR #540 (the value fix), #541 (this gate).
- #334 — the over-stamp, and `logic-errors/synthesized-records-need-the-full-set-field-chain.md`, its sibling lesson.
- `docs/wiki-evidence/dino-set-bonus-hosts.md` — the ruling the cross-check defends.
- `conventions/a-citation-read-as-a-universal-must-name-the-list-it-generalises.md` — how the wrong scope got written in the first place.
