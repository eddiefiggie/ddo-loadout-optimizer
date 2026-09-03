---
title: Legendary Green Steel hosts, and the crafted-option identity handle - Plan
type: feat
date: 2026-09-03
topic: legendary-green-steel-hosts
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: issue-triage
execution: code
---

# Legendary Green Steel hosts (#194), and the crafted-option identity handle (#270)

**Decision record.** Progress lives in git and in the two issues, not here.

## The ask

#194: 116 Legendary Green Steel recipes ship in the dataset and no item can reach
them — present-but-inert, which `exclude-until-verified-empty-seed-masks-consuming-bugs.md`
calls worse than honestly absent. #270: the blocklist cannot name a crafted
option, so once those recipes are live a player has no way to say "never craft
this one". The README judged the two cheaper together because the second becomes
urgent the moment the first lands.

## The premise that was stale

Every prior write-up of #194 (PR #652's body, the registry notes, the README's
next-up line) said its remaining half "needs a wiki harvest" — which items are
hosts. Measured against the dump before writing any code: **it does not.** All
48 `Legendary Green Steel *` records name their altar menus in their own
`crafting[]` (`T1 (Equipment)` … / `T1 (Weapon)` …), the same structural field
`essence_slots` is read from. The harvest that was assumed to be the blocker was
never needed, and the hosts had been declaring themselves the whole time.

The 2026-07-28 best-practice doc's "zero LGS blanks in the catalog" finding was
true of the catalog it measured and is not true of the 2026-08-18 refresh; the
registry's #653 note had already corrected the count to 48 but still framed the
markers as harvest work.

## Key decisions

- **Markers are read from `crafting[]`, never from a name.** `_lgs_tiers` in
  `planner_items` matches `^T([123]) \((Equipment|Weapon)\)$` and stamps one slot
  per DECLARED tier. A real Thunder-Forged item declares no such label and cannot
  be stamped — the failure #653 was filed to prevent needs no allowlist.
- **Both halves are per-tier single-pick.** The accessory pool was a single pick
  over all three tiers behind a truthy `green_steel_slot`; a blank takes one
  effect at each altar, so that under-credited every host by two effects. The
  marker is now `green_steel_tiers` (a list, like the weapon half's), each
  accessory record carries an integer `tier`, and the solver loop mirrors the
  weapon one. The rename is deliberate: the shape changed, and one field name
  carrying two shapes is the trap `one-concept-under-two-field-names` records.
- **The weapon pool keeps its `thunder_forged` key.** #654 declined the rename as
  34 files of churn for a pool nobody could reach; reachability does not change
  that arithmetic. What changed is every player-facing label: both halves read
  "Legendary Green Steel T<n>", the export cue is one shared entry, and the
  registry note says what the key is. Filed as #687.
- **Matched-tier aspects are disclosed, not modelled.** `AGENTS.md` lists the
  exhaustive combinatorial space as a non-goal. The `LEGENDARY GREEN STEEL`
  notice fires whenever a blank is equipped and says so in words. Nothing on disk
  states the aspect effects or the matching rule, so there is no value to infer.
- **Declared altars render, filled or empty.** The `render-declared-structure`
  rule: a blank that ships with three altars must never read as a two-altar item.
  `tierSlotRows` is the `vikSlotRows` rule on a per-tier marker; `tfEmpty` /
  `gsEmpty` rows say why an altar stayed empty, on the card and in every export.
- **Reachability ended two exemptions.** The accessory pool's 18 ability-skills
  umbrellas now expand INSIDE each option (the `spell_focus` pass the Nearly
  Complete Skill menus use), and the pool is walked by the universal-name guard
  like every other. The picker vocabulary also stopped reading both pools as flat
  records — a pre-existing bug that cost nothing while no host existed.

## Measured against the shipped data

| | before | after |
|---|---|---|
| hosts carrying a marker | 0 | 8 accessories + 40 weapons |
| accessory options a host can take | 1 of 81 | up to 3 (one per altar) |
| golden fixtures moved | — | 11 of 24, all strict lexicographic gains or a value-neutral tie re-order |

The golden re-ratification is recorded in the PR body fixture by fixture. The
largest single move is `absorption-compound-crown-ml35`: Wizardry 720 → 871, the
T1 accessory option `Wizardry +151 Profane` (crafted through the `Competence Wisdom Skills` recipe, whose second affix is the Wizardry) on Legendary Green Steel Goggles.

## Scope boundaries

- No aspect / dual-shard / triple-shard modelling (non-goal, disclosed).
- No heroic Green Steel: the ML 11–12 blanks have no menu in the catalog.
- No rename of the `thunder_forged` container (see below).
- #270's UI half is not in this PR (see below).

## #270 — the identity handle, designed here, built next

The blocklist gate (`web/model.js`, #110/KTD1) filters CANDIDACY by
`variant_id`. Crafted options have none: 554 option rows across six pools, and
`seal` / `nearly_complete` rows carry no name either. The design, so the next PR
does not re-derive it:

- **One composite key per option, stamped at build time**, so the browser never
  synthesises it: `craft:<pool>:<pool key>:<option>` where `<pool key>` is the
  pool's own discriminator (`seal_type`, `(slot_type, category)`, `tier`,
  `(dino_type, category)`, `category`, `menu`) and `<option>` is the option
  `name`, or `<stat>|<bonus_type>|<value>` for the two pools whose rows have
  none. Stable across refreshes as long as upstream's names are; a refresh that
  renames an option makes the entry stale, which the existing stale-entry report
  (R7 of the blocklist plan) already discloses.
- **Same gate, widened, not a second one.** `query.blocklist` keeps its id array;
  ids with the `craft:` prefix are applied to the option pools at the same seam
  the item filter runs, before `vikAdvances` and the per-family pool filters, and
  the removed options are retained for the disclosure exactly as removed
  variants are.
- **The picker is the real work.** The block picker searches `web/browse.js`'s
  variant filter, which has no crafted-option source. Adding one means a second
  search index over the six pools with a row shape the picker can tick, and a
  label per family that says which host class the option is for.

**Deferred to the next PR, tracked on #270** (the issue stays open and already
carries the identity question; this section replaces its "has to be designed"
clause).

## Deferred, filed before this merges

- Rename the `thunder_forged` container and its `tf` family key to what it is,
  now that a player-facing pool carries the name — #654 declined it while inert.
  Filed as #687.
