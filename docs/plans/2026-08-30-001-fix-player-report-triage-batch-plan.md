---
title: Player-Report Triage Batch (2026-08-30) - Plan
type: fix
date: 2026-08-30
topic: player-report-triage-batch
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: knowledge-work
---

# Player-Report Triage Batch (2026-08-30)

**Decision record.** Progress lives in git and in the issues; the queue is
GitHub Issues, never this file.

## Goal capsule

- **Objective:** Triage seven player reports in one pass, separate the confirmed
  defects from the already-correct behaviour, and file each outcome — including
  the negative results — so none of them is investigated twice.
- **Product authority:** Project owner, relaying their own play session.
- **Execution:** Knowledge work. No code, no data, no build stamp. Every unit
  below resolves to an issue, not to a diff.
- **Open blockers:** Three items need a paced ddowiki harvest (#618, #619, #617)
  which cannot run from a non-interactive session — `curl` and WebFetch return
  empty behind Cloudflare.

## Why a triage doc and not seven separate investigations

Three of the seven reports turned out to be **already correct**, and one of
those had already been ruled on twice (`docs/wiki-evidence/negative-amplification.md`,
#109). A verdict of "this works" is a result, and the repo's own history says an
unrecorded negative result gets re-raised: `AGENTS.md` cites five issues that
were fixed and shipped without anybody closing them, and one value that has been
ruled on wrongly three times.

So the measurements are written down here even where nothing is broken. The
point of the doc is the **evidence**, not the plan.

## Method

Every claim below was measured against the shipped build, not reasoned about.

- Dataset queries ran over `web/data/items.json` (9,110 items, the gitignored
  build artifact).
- Solve behaviour ran through `tests/parity/capture_golden.js`'s `solveEnv` /
  `solveFixture` seam against the real HiGHS engine — the same `buildModel` +
  `solveLexicographic` path the app uses, with the same picker vocabulary. Using
  the capture harness rather than a hand-built model is deliberate: a fixture
  that prepares its own environment can differ from what a player gets, which is
  the trap `capture_golden.js`'s own comments describe.
- Picker membership was read from `buildPickerVocabulary(normalizeDataset(...))`
  rather than from the raw affix list, because `suggestions` / `magnitude` /
  `presence` / `utilityCounting` are what the player actually sees.

**One methodological correction, recorded because it nearly produced a false
finding.** An early pass reported `Magical Efficiency` as missing from the
`magnitude` set and therefore unrankable. It is in the set; the scan printed
`.slice(0, 8)` of the matches and the name fell past the cut. `Magical
Efficiency` is rankable. A truncated listing read as an absence — the same shape
as a falsy test read as a population (`AGENTS.md`, *a count is a claim about a
population*).

## The seven reports

### R1. An item's penalty to a stat is not modelled (Ring of Baphomet)

**Confirmed, and worse than reported.** Two independent failures.

`web/solver.js:323` gates every worn contribution:

```js
if (targetSet.has(a.name) && a.value > 0 && (!best.has(k) || best.get(k).value < a.value)) {
```

The `a.value > 0` clause repeats at eleven more sites — 478, 599, 746, 820, 875,
906, 957, 1006, 1036, 1061, 1325 — one per contribution channel plus the
dominance pre-filter. Nothing negative reaches `zByBucket` by any path.

This is not the pipeline losing the sign. `src/affix_parser.py:59` keeps it
deliberately, and **36 affixes ship real signed magnitudes** under a `Penalty`
bonus type (Constitution −2, Fortification −25, Concentration −50,
Intelligence −3, and 32 more). `Penalty` is also in `NON_RANKABLE_TYPES`
(`web/dataset.js:569`), so the stat never enters the picker either. Both halves
are silent.

**The structural half is the real work.** Contributions are optional by
construction: `encodeStage` emits `z - gate <= 0` and `Σz <= 1`, with no lower
bound anywhere. A maximizing objective sets a negative `z` to 0, so the penalty
goes unpaid while the item stays equipped. A penalty is a *consequence* of
wearing the item and has to be forced — `z = x`, or folded into the host's
coefficient — never selected. **Any fix that only deletes the `value > 0`
clauses will look like it worked and change nothing**, which is the single most
important sentence in #614.

Baphomet itself is a second shape on top: all four Ring of Baphomet variants
carry `Curse of Foolishness` and `Curse of Repulsiveness` as `Bool | 1`, so even
a sign-aware solver has nothing to subtract. Both names are in the picker's
`suggestions` and `presence` sets, so the app currently offers a curse as
something to seek and Browse renders it as a ✓.

Filed: **#614** (solver/formulation), **#615** (data fidelity + picker).
Commented on **#192**, which asked for exactly this check and can now be closed
as superseded or kept as the narrower `Command` product call.

### R2. Is negative healing amp the same as negative amp, and are both handled?

**Naming: yes, one name, no split.** The dataset carries exactly three
amplification families — `Healing Amplification`, `Negative Amplification`,
`Repair Amplification`. No player's points are divided across two spellings.
`Negative Amplification` is in `rankable_affixes` and in `suggestions` +
`magnitude`, so it can be prioritized today.

**Mechanics: already ruled, do not re-litigate.**
`docs/wiki-evidence/negative-amplification.md` (verified 2026-08-03, resolved
2026-08-04) establishes the channel model: typed stat, same type collapses to
max, different types stack. That ruling closed #109 as already-correct.

**One thing does look wrong.** Same gem family, different bonus type:

| Augment | Affix | Type |
|---|---|---|
| Lunar Gem of Healing Amplification (both tiers) | Healing Amplification | Profane |
| Lunar Gem of Negative Amplification (both tiers) | Negative Amplification | Enhancement |
| Solar Gem of Healing Amplification (both tiers) | Healing Amplification | Artifact |
| Solar Gem of Negative Amplification (both tiers) | Negative Amplification | Artifact |

The Solar pair agrees; the Lunar pair does not. If the neg-amp gem is really
Profane, calling it Enhancement gives it its own bucket and it **stacks
additively with all 37 Profane neg-amp records** instead of collapsing. #363 and
#440 were both this exact shape in this exact stat family, and both were real.

**Second finding: the ruling's own scan sentence has gone stale.** It states a
full type scan shows "no Enhancement, no null". Two Enhancement records exist
today — the Lunar gems. #109 says Enhancement neg-amp is legitimate specifically
on Lunar gems, so the ruling's substance survives and only the parenthetical is
false. That parenthetical is the sentence a future reader would use to decide the
question is settled, which is the failure
`docs/solutions/conventions/a-dated-coverage-claim-cannot-notice-its-own-staleness.md`
names.

Filed: **#616**.

### R3. Are Undying and Legendary Undying selected properly per level band?

**Yes. Measured.** One affix name, always `Enhancement`, 14 carriers ML 5-35.
There is no `Legendary Undying` affix — the Legendary/Heroic split is in the item
names. Solving for `Undying` alone:

| ML cap | Undying | Carrier |
|---|---|---|
| 8 | 65 | Bittersnow hosting Undying Sapphire |
| 20 | 90 | Helm of Eternal Day |
| 30 | 225 | Barovian Nobles' Regalia hosting Legendary Undying Sapphire |
| 34 | 285 | Death's Deferral |
| 36 | 315 | Legendary Lolth's Protection |

Blocking `Legendary Undying Sapphire` at ML30 drops the answer 225 → 195 with no
augment placed, so the augment channel is genuinely doing the work and the ML
gate is genuinely holding.

Nothing is folding silently either: `src/legendary_fold.py` allowlists five names
and raises `SystemExit` on any un-adjudicated numeric `Legendary *` at type
`Legendary`, so a new upstream `Legendary Undying` would fail the build rather
than merge into this bucket.

**The one unbacked assumption:** all records sharing `Enhancement` means an
item's Undying and a Sapphire's never add. Standard, almost certainly right, and
with no citation in `docs/wiki-evidence/`.

Filed: **#617** (validation, not a defect — the measurements above ride along so
nobody re-runs them).

### R4. Legendary Vulnerability is not visible in the app

**Absent from the whole source chain, not hidden by us.** Every
`vulnerab`-matching affix in the dataset: `Acid` / `Cold` / `Electric` / `Fire
Vulnerability` (Bool, on-hit *enemy* debuffs), `Invulnerability`, `Vulnerability
Guard`. No bare `Vulnerability`, no Legendary tier, nothing carrying a magnitude.
The same search over `data/seed/compendium/raw/gearplanner_items.json` — the
declared single source of truth for item affixes — returns the same six names.

Two hiding mechanisms were checked and ruled out: not folded (the
`legendary_fold` guard would have failed the build), and not quarantined (absent
from `untyped_rankable.json` and `vocab_registries.json`).

Three possibilities, in order: it is a Filigree or Sentient Weapon effect, which
are unmodelled entirely (**#196**, open, and the likeliest answer); we carry it
under a different name; or **gear-planner is missing a real gear affix**, which
would be the first known hole in the single-source-of-truth convention and would
matter far beyond this one affix.

Filed: **#618**. Deliberately filed with no value and no carrier claimed —
*never infer* applies to existence too, and the honest state is "the app does not
have this and we do not yet know why".

### R5. Do Drop of Tea and Meridian's metamagic efficiency work, and can I rank it?

**Both modelled, and rankable today.**

| Augment | Colour | ML | Affix | Type | Value |
|---|---|---|---|---|---|
| Crystallized Drop of Tea | Yellow | 28 | Efficient Metamagic - Empower | Enhancement | 4 |
| Meridian Fragment | Orange | 28 | Efficient Metamagic - Maximize | Enhancement | 6 |

(Spelled *Meridian*.) All eight `Efficient Metamagic - X` names are in
`metadata.rankable_affixes` and in `suggestions` + `magnitude`, so they appear in
the priority picker as the player types. This is the state **#230** left things
in — those names were among its 43 quarantined untyped affixes and have since
been typed and admitted.

Two things not settled: all eight share `Enhancement`, so gear and augment
sources never stack and that has no citation; and `Magical Efficiency` carries 8
inert `Bool | 1` records beside 100 magnitude ones, which is an unadjudicated row
from #230's second table.

**A product answer worth stating rather than leaving accidental:** there is no
combined spell-point-cost model. These are nine independent magnitudes, and a
player wanting cheapest casting ranks the ones matching the metamagics they
actually use. Modelling an SP-cost function would need the player's spell list
and metamagic selection, which the app does not have.

Filed: **#619**.

### R6. Find items with Myth Drannor "rare loot rules"

**No such data exists, and the issue that would have carried it was closed
yesterday for want of exactly this request.**

#197 was closed 2026-08-30 with: *"How rare is the drop?" — nothing in the queue
asks for this, and no player has reported wanting it.* That was the right closing
test, and it has now been met. **Reopened**, re-scoped to this narrower question
only — the dead half of its premise ("the shared blocker under every attainability
feature") stays dead, since all four features it named shipped without the field.

**The terminology collision is the substance, not a caveat.** #409 already stamps
augments with the wiki's acquirability taxonomy — `Common` / `Uncommon` / `Rare` /
`Named` — where `Rare` means obtainable from generic loot or Mysterious Remnants,
i.e. **easy**. The player means low drop probability, i.e. **hard**. Near-opposites
sharing one word in one dataset. Whatever field this adds needs its own term,
chosen before code. Also excluded by the player's own framing: rare encounters,
rare chests, and rare filigrees (unmodelled — #196).

What the dataset holds today is **reachability**, never probability:
`location_pack` (421 items on `Magic of Myth Drannor`), `location_kind`,
`location_quest`, `no_drop_source`. The 421 Myth Drannor items carry quest names,
so there is a clean join key if a per-item flag turns out to be the right shape.

**Prerequisite before any design:** nobody here has established what the Myth
Drannor rare-loot rule actually is, which items it governs, or whether the wiki
states it per item or as a blanket policy. That harvest decides whether the shape
is a per-item flag, a per-quest property, or a documented list — three different
builds.

**Scope guardrail:** this lands as a filter and a disclosure, never as a solver
input. *Attainability as a solver input, by default* is a standing non-goal;
opt-in filters that exclude gear (#110, #246) are the permitted shape.

Reopened: **#197**.

### R7. An excluded item still appeared, apparently because it was also required

**Did not reproduce, and the stated mechanism is sound end to end.** Recorded in
detail because the player's conclusion — "a requirement outranked the exclusion"
— is a claim about the solver's contract, and disproving it is worth as much as
fixing it would have been.

- The block filters **candidacy** at `web/model.js:1236`, upstream of
  `dominanceFilter`, across worn slots and augment pools alike. Measured:
  `Undying` at ML30 gives 225 via `Legendary Undying Sapphire`; blocking that
  augment gives 195 with no augment placed.
- `requireOutbidStat` (`web/wizard.js:4300`) writes `targetFloors[stat]` and
  re-solves through the same `buildQuery`, so the blocklist rides along. Floors
  become `>=` locks inside a program built from the already-filtered pool. **A
  floor cannot resurrect a filtered candidate**; an unreachable floor is relaxed
  and reported (#345).
- The named case ran directly: `Legendary Heartshard` (Trinket, ML34,
  `Conditioning | Legendary | 15`), blocked, with `Conditioning` ranked and
  floored at 15. Never placed, blocked or not — it does not win the slot, because
  `Conditioning` at ML34 reaches 20 from elsewhere.

**Exclusions are hard rules and behave as hard rules.**

**But the investigation found a real silent-failure path with the identical
symptom.** `addBlocks` (`web/wizard.js:1312`) refuses any id currently pinned to a
slot; the refusal is written to transient state (`:2938`) and **cleared by the
next render** (`:3202`). The staged selection clears as though the block
succeeded, the item never joins the blocked list, and one warning may already be
gone. From then on the player believes they excluded an item that is fully
placeable.

That refusal also contradicts a decision the code has already made elsewhere.
`blockLoadMessage` (`web/wizard.js:1366`) resolves the both-states case the
opposite way — *"a block wins, so the pin will not be honored"* — and
`web/model.js:1182` agrees. **A block that arrives by import beats a pin; a block
typed by hand is refused by one.** One of those is wrong, and the import path's
answer is the one matching how the player described the rule.

Filed: **#620**, carrying both the defect and the did-not-reproduce findings.

**Still open on the original report:** two readings #620 does not cover, needing
the player's saved build (`blocklist`, `slotConstraints`, `excludedSets`,
`excludedTypes`, `targetFloors`) — a different control was used (the gear-pool
step also hosts *Exclude a set* and the #607 bonus-type skip, and a bonus-type
exclusion legitimately leaves the item placeable on its other affixes), or a
different surface was read (the Farming List and upgrade notices name items that
are not in the loadout).

## The queue

Every outcome is filed. Nothing in this document is a backlog entry.

| Report | Issue | Kind | State |
|---|---|---|---|
| R1 penalties, solver | #614 | bug | filed |
| R1 penalties, Baphomet data + picker | #615 | bug | filed |
| R2 neg-amp Lunar gem type | #616 | bug | filed |
| R3 Undying stacking | #617 | validation | filed |
| R4 Legendary Vulnerability | #618 | investigation | filed |
| R5 Efficient Metamagic stacking | #619 | validation | filed |
| R6 Myth Drannor rare loot | #197 | feature | reopened, re-scoped |
| R7 block on a pinned item | #620 | bug | filed |
| R1 premise check | #192 | product call | commented, left open |

## Dependencies and sequencing

**#615 blocks #614 from reaching the reported item.** Even after the solver
learns to subtract, the Baphomet curses carry no stat and no magnitude. The cheap
half of #615 — a `PRESENCE_DENY` entry so curses stop being offered as priorities
— is independent of the wiki harvest and can ship alone.

**Three items are gated on a paced ddowiki harvest** (#617, #618, #619) per
`docs/wiki-evidence/harvest-method.md`. They can batch into one session; ddowiki
throttles persistently after bursts.

**#197 is gated on establishing the rule** before any field is designed.

Everything else is independent.

## Scope boundaries

- **No code, no data, no build stamp.** Doc-only changes are exempt from the
  three-value bump (`AGENTS.md`); this plan changes nothing player-facing.
- **The neg-amp channel model is settled** and is not reopened here. Only the one
  Lunar gem's bonus type is in question.
- **No attainability in the objective.** R6 lands as a filter, per the standing
  non-goal.
- **No weighted trade-offs.** Nothing here proposes pricing a penalty against a
  priority; R1 is about reporting a number honestly, not about trading one stat
  for another.

## Outstanding questions

1. Does #614 supersede #192, or does the `Command` template stay a separate
   product call once the solver can represent penalties? Owner's call; #192 is
   left open pending it.
2. Does a `Penalty` affix occupy a bonus-type bucket, and does it reduce the real
   bucket's winner or sit beside it? Both are undecided and both are in #614.
3. What does the player's saved build show for R7? Needed to close the original
   report as distinct from #620.
