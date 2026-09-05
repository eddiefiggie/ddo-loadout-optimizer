---
title: Conditional and ramping effects stored as flat constants - Design note
type: design
date: 2026-09-04
topic: conditional-effects-stored-as-constants
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: issue-triage
execution: decision
---

# Conditional and ramping effects stored as flat constants (#214)

**Decision record, not a build plan.** #214 was filed as "one confirmed
instance; unknown others" and deliberately claimed no count. This note
measures what can be measured locally, records what was done about the one
live case, and states the choice the rest of the issue turns on — because
that choice is a harvest question, not a parse fix, and three patches in three
weeks were this class in disguise.

## The shape, stated once

gear-planner stores an affix as `(name, type, value)`. It has no field for
"only while a trigger keeps firing", "only against these enemies" or "only
after N stacks", so a buff that ramps to a ceiling, or applies under a
condition, is stored AS its ceiling, unconditionally. The optimizer then credits
permanently what the game grants during a window. A wrong number of this kind
is indistinguishable from a right one in a finished loadout, which is the
failure the never-infer rule exists to prevent.

The tooltip prose that states the condition is never captured. `raw` holds the
parsed statement (`"+1 Profane bonus to Spell Focus Mastery"`), not the
tooltip, so nothing local can tell a constant from the cap of a conditional.

## Three patches that were this class, and what each taught

| when | what | mechanism | evidence layer |
|---|---|---|---|
| #88 (2026-08-20) | Meridian Fragment, Crystallized Drop of Tea: `Universal Spell Power \| Psionic \| 24` is 8 × 3 stacks, on being hit, 20 s each | `conditional_affix_quarantine.json` — per-record, per-affix DROP with the verbatim wiki sentence; stale-guarded on `from_value` | rendered tooltip |
| #694 (2026-09-04) | Crypt Raider 3-piece: "+5 … hit and damage vs. Evil creatures", "+2 Saves vs. Evil Creatures" | `set_parser` flags a `vs. <creatures>` clause at the parse seam; build discloses the count | set-tier text (the condition is IN the stat name) |
| #205 / #214 | Deific Focus: "On Spell Cast: +1 Sacred … Stacks up to III times" stored as `3` | ruled, not quarantined — it was inert at the time | rendered tooltip |

Two lessons. First, **the item-record quarantine and the set-channel flag are
the same disposition** (drop, disclose, never re-value) reached through two
seams because the two channels carry the condition in different places.
Second, **"inert today" does not stay true**: Deific Focus was inert on
2026-08-10 because no target carried the name; by build `09042026.7` it is in
`rankable_affixes` and offered by the picker, so a player who ranked it was
credited a permanent +3 Sacred that the game grants for five seconds after a
cast. That is the same drift #702 recorded for `Magical Resistance Rating Cap`
and `a-dated-coverage-claim-cannot-notice-its-own-staleness.md` is about.

## What was done in this PR

Deific Focus moved from "ruled" to "quarantined": three entries in
`conditional_affix_quarantine.json` (Morion of the Undying, Epic Deific
Diadem, Staff of Irian), each with its own page's tooltip, so the name leaves
the rankable set and the picker. That closes the one live case with the
existing mechanism and no new machinery.

## What can be measured locally, and what cannot

| population | count | note |
|---|---|---|
| distinct affix names in the built dataset | 1,413 | |
| rankable names | 224 | the only names that can be credited toward a priority |
| rankable names with a numeric carrier | 214 | the population that can cause harm |
| numeric affix instances behind them | 29,487 | |
| rankable names whose values never exceed 3 and carry no `Bool` | 12 | the Roman-rank shape; 11 of the 12 are genuine small counts (charges, dice, caps) — the signal is too weak to act on |
| names with rendered-tooltip evidence on disk | 9 families | speed, parrying, riposte, heightened awareness, elemental absorption/resistance, ML36 augments, command, essence bonus types |

The 12-name heuristic was tried again for this note and gives the same answer
#214 recorded: it finds Action Boost Charges, Imbue Dice, Dodge Cap and their
kin, which are exactly what they say. **There is no local signal.** The only
way to know whether a stored magnitude is conditional is to read the sentence
the wiki renders for it.

## The choice

### Option A — do nothing general; keep quarantining per report

Cost: zero until the next report. Risk: each case is found by a player after
it has shaped their loadout, and each costs an investigation (#88 took a day,
#694 half a day). This is where the repo is today.

### Option B — harvest every rankable name's rendered tooltip once, then rule

Harvest unit: the **template**, not the item. A tooltip's conditional prose
comes from the enchantment template (`Deific Focus III` renders the same
sentence on all three carriers), so the roster is one page per rankable name
that has a template — well under 214, since many rankable names are plain
stat lines (`Strength +N`) with no template prose. Method: the existing
`harvest-method.md` loop, one shard `affix_tooltip.json` keyed by affix name,
`{raw, tooltip, provenance, harvested}` exactly like `speed_enchantment.json`.

Then a detector over the shard, not over the dataset: flag any tooltip
matching the conditional markers #214 lists (`on spell cast`, `on hit`,
`stacks up to`, `for N seconds`, `chance to`, `while`, `when you`, `vs.`), and
rule on each flagged name the way `umbrella_adjudications.json` rules on
umbrella candidates — `constant`, `quarantine`, or `disclose` — with the
sentence as evidence. Unruled candidates fail the build, as #211's detector
does. A refresh that changes a tooltip trips the stale guard.

Cost: one harvest session (the loop is paced at ~1.5 s per request; 214 titles
is under fifteen minutes of wall clock plus the reading), one small detector,
one adjudication seed. Ongoing: a candidate appears only when a new rankable
name arrives.

### Option C — disclose instead of model

A per-result note: "N effects in this loadout are stored at their best-case
value; the game grants them only under a condition." This is the cheap half of
#214's own suggestion, and it is honest — but it needs Option B's shard to know
which N, so it is not an alternative to the harvest, only to the quarantine
disposition for cases where dropping is too lossy (a +30 that is up 80% of the
time is not nothing).

### Recommendation

**Option B, with C as one of its three dispositions.** The harvest is the
whole cost, and it is bounded: 214 names, one page each, one session. Without
it every future case is found by a player. With it the class becomes what
umbrella names became under #211 — a detector with a curated ruling per
candidate, where a new name cannot ship unruled.

Not recommended: modelling uptime or trigger rates numerically. Proc valuation
is #331's question, and any number not stated by the wiki is the inference
the data gate forbids.

## What this note does not decide

- The harvest session itself, and the rulings. That is a work item, filed when
  this note is accepted, not before (the #214 issue is the tracker until then).
- Whether `Deific Focus` and its kin should instead expand to a school-scoped,
  disclosed effect. The wiki gives no sustained value, so today's answer is
  drop-and-disclose; a later playstyle-aware model is #331 territory.
