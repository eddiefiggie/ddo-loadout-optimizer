---
title: User feedback batch — player-authored items, and the per-character state leak
type: feat
date: 2026-09-16
execution: code
artifact_contract: ce-unified-plan/v1
artifact_readiness: shipped
product_contract_source: player-report
---

# User feedback batch — player-authored items, and the per-character state leak

**Issues:** #772 (the leak), #773 (player-authored items).
**Raw reports:** three messages from one player, recorded in `data/bug_reports.txt`
under the 2026-09-16 divider.

Deliberately carries no build status. `AGENTS.md`: a plan is a decision artifact
and progress lives in git, so what has shipped since is readable from the issues
and the log, and this document does not go stale by standing still.

---

## What the batch turned out to be

Three reports, and the surprise is that **two of them are one feature**.

| Report | What it asked for | Kind |
|---|---|---|
| A crafted off-hand dagger, so the solver hunts Quality Assassinate instead of the two buckets the dagger already fills | A way to tell the tool about an item it does not know | Missing capability |
| Pinning an augment on one build pins it on every saved build | A defect | **Bug, and it had three siblings** |
| "Add a few of our own items into the mix … rather than fake them by adding a weak ring and manually adding the effects through advanced priorities" | The same capability, stated outright | Missing capability |

The first and third are the same request seen from two ends, and reading them
together is what made the design obvious. The player is not asking us to model
Cannith crafting. They are asking to **describe an item they already have**. That
is a far smaller thing, and it lands inside the product's grain rather than
against it.

---

## Report 2 — the augment pin leak, and why it was four bugs

### What was verified

`state.pinnedAugments` had **no assignment anywhere on the load path**. Not a
wrong one — none. `loadCharacter` resets every other saved input explicitly, with
a comment above the block saying why ("the state object outlives a character, so
a field not reset on load stays live from the previous one"), and this key was
simply not in it.

So: pin `Deconstructor` on build A, load build B, and the pin is on B. Worse, it
then **persists** — `pickInputs` writes live state, so the next save of B writes a
pin nobody set for it. The player's "seems to pin the augment to ALL my saved
builds" is exactly right, and it is permanent rather than cosmetic.

### The finding that mattered more than the report

Sweeping `INPUT_KEYS` against the load path found **four** keys with no
assignment, not one:

| Key | What leaks |
|---|---|
| `pinnedAugments` | the reported case |
| `excludedSets` | sets excluded on one build are excluded on the next |
| `ownedPacks` | the content filter carries over between characters |
| `excludedTypes` | bonus types skipped for a stat carry over |

Every one is the same mechanism. The prose above the `#518` farming-notice reset
already **named this family** — "the documented leak family" — and naming it did
not stop the next four. That is the shape `AGENTS.md` has a rule for: *a
completeness claim needs a guard, not a date.* Both sides of "every saved input is
reset on load" are readable at test time, so the fix ships with a guard that reads
`INPUT_KEYS` and asserts an assignment for each, with three explicitly documented
exemptions (two save markers and one read-only legacy key).

The guard proved itself inside this same change: adding `customItems` to
`INPUT_KEYS` for #773 turned it red immediately, before the restore was written.

---

## Reports 1 and 3 — player-authored items

### What was verified first

Against `main` at `0142115`, before designing anything:

- **There is no custom-item mechanism of any kind.** No writer of new records into
  `dataset.items` exists; every pool is built by `build_dataset.py` from
  wiki/gear-planner sources. The Trove import is a pure *filter* — an owned name
  the catalog does not carry is counted `unrecognized` and dropped.
- **The dagger cannot be expressed through Essence Crafting, and that is
  wiki-gated, not a bug.** The seed shard *does* hold
  `placements["Melee weapons"]` including `Assassinate`, `Insightful Assassinate`
  and `Armor-Piercing` — but `src/essence_pool.py` is Trinket-only
  (`HOST_SLOT_TYPE = "Trinket"`), the only hosts are the three
  `Gem of Many Facets [Crafted]` records, and 135 of the 157 effects have **no
  sourced bonus type**. That gap is #764 and needs a wiki harvest.
- **Crafted picks are not pinnable even where they are modelled.** An essence
  option exists only as an LP variable minted inside the solve; its one stable
  identity is a `craft:` block key, and every reader treats those as blocklist
  entries. There is no "pin a craft option" path.
- **The existing workaround costs a slot and cannot place anything.** A declared
  credit is `(stat, bonus_type, value)` with an empty gate list — it can free a
  bucket, but it is slot-agnostic, so it can never occupy the off hand. That is
  the difference the player felt when they described "faking it with a weak ring".

### The key decision: an item, not a solver primitive

The 2026-07-25 crafting roadmap proposed a *"new per-slot wildcard crafted item
solver primitive (a filler that can supply missing effects up to cap value)"* and
deferred it. **That is a different feature and it stays deferred.** It asks the
solver to FABRICATE an item; this asks it to accept one the player already owns.

The second question is much cheaper, because the answer is a record. Mint the
player's description into the catalog's own shape and concatenate it into the
candidate pool, and it inherits pinning, the dominance filter, worn-slot and hand
assignment, augment capacity, the results card and all six exports **with no
change in any of them**. The whole feature is one new pure module, one pool seam,
one panel, and the disclosure.

### What makes it safe to accept unsourced numbers

This tool's claim is that its answer is provable, and `AGENTS.md` says never infer
a value. A player-authored number does not weaken either, because **the tool is
not the one asserting it** — but only for as long as the disclosure is
unconditional. Two existing mechanisms already set this precedent and carry the
same obligation: the declared credit and the bonus-type override.

So the disclosure is built in three layers, deliberately redundant:

1. **Structural.** The item's identity IS its name plus the suffix `(yours)`.
   Every surface that prints an item name prints the provenance with it, including
   surfaces written before this feature existed.
2. **A result notice.** Qualifying class, keyed on the *chosen* loadout rather
   than the declared list — an item described but not placed has not shaped the
   answer, and saying it did would be its own inaccuracy.
3. **A per-item export line**, in all six formats, on the `noDropSource` pattern:
   one shared wording carried by the projected entry, so no format can print a
   different sentence or none.

### Three decisions worth recording, because the obvious choice was wrong

**The id is the name, not an opaque token.** The first implementation used
`custom:<uid>`, which is the safer-looking choice. It rendered the player's dagger
as the literal string `custom:1` on the paperdoll and in every export, because
this app treats `variant_id` as **both** identity and display text — the catalog's
own ids are human-readable (`Hydra's Heart (Tier 3)`). Patching fifteen display
sites to special-case one record shape would have been larger and far more
fragile. The cost is that a rename moves the id, so the rename migrates the pin;
that is a visible, tested operation rather than a permanently unreadable label.

**`verification: "verified"` is not a sourcing claim.** `web/model.js` refuses any
variant whose verification is not `"verified"`, so the record must carry it to be
placeable at all. Conflating that gate with the honesty marker would have meant
either an item that can never be equipped or a widened core gate. The marker is
the separate `player_authored` field, which no catalog record carries.

**Stats and bonus types come from the existing vocabularies, never free text.** A
name outside the picker vocabulary can never be ranked, so admitting one would
accept the item and then score nothing from it — indistinguishable, to the player,
from the tool ignoring what they just typed. The refusals name the field and the
reason, one sentence each.

### Three defects the self-review caught, all of them silent

None of these would have failed a test or thrown. Each is recorded because the
shape repeats.

**The effect picker pointed at a datalist on another step.** The field carried
`list="wz-stats"`, and `wz-stats` is rendered by `stepPriorities()` — a step
renders only its own body, so on the Gear pool step the input had no suggestions
at all while the help text beside it said to "pick the effect name from the
list". The input still accepted typing, so nothing broke; it was simply useless.
`wz-stats2` already existed for exactly this reason on a third step, which is the
precedent that should have been noticed first. The form now renders its own list —
and filters it to names `validateEntry` will accept, which removes **874 of the
1,191** picker names. Offering a name and then refusing it is the worst version of
a picker.

**A described item appeared on the farming checklist.** With no
`location_quest`, it filed under "no source recorded" — telling the player to go
and farm the item they made themselves. True of the catalog, false of them. It is
now excluded, on the same judgement the owned-pool disclosure makes when it
declines to report a described item as "pinned, not owned".

**A half-typed item survived a build switch.** `customDraft` had no reset on the
load path, so a draft open on build A, still on screen under build B, would add
A's item to B on save. That is #772's family exactly, in the one place this
feature could rejoin it, found by asking the question the guard had just taught
us to ask rather than by a report.

### A guard that caught a real defect during implementation

The no-context fallback for "may this stat carry a typed magnitude" was written as
`vocab.presence.has(stat)`, and the test asserting it agrees with wizard.js's
`canDeclareCredit` over the *real* vocabulary went red on four names: `Deception`,
`Smoke Screen`, `Protection from Evil`, `Underwater Action`. All four are in
`presence` **and** carry a real typed magnitude elsewhere — the exact trap
`isPresenceOnly` is written up to avoid. Without the agreement test, custom items
would have silently refused a value on four stats that have one.

---

## Scope boundaries

**In scope and shipped:** the record, its validation, the pool seam, the panel,
persistence and backup round-trip, pin/rename/delete handling, the three
disclosure layers, the farming-list exclusion, and the #772 leak fix with its
guard.

**Deliberately out of scope**, each for a stated reason rather than by omission:

- **Custom augments.** Augments are placed by aggregate per-colour capacity, not
  by worn slot; a player-authored augment is a different model question.
- **Set membership on a custom item.** A described item belongs to no set. Letting
  a player assert membership would let them complete a set bonus out of nothing,
  which is a much larger claim than "this item has these numbers".
- **Crafting slots on a custom item** beyond plain augment colours. The player
  describes the finished item, so there is nothing left to craft into it, and
  offering an Essence menu on a host the tool has never seen would be the tool
  asserting a pool for imaginary gear.
- **On/off (presence) effects.** They have no typed bucket to carry a value. The
  refusal says so by name rather than accepting a number that would mean nothing.
- **Sharing custom items between characters.** They are per-build, like every
  other saved input. Making this one global would be surprising in exactly the way
  #772 was.
- **Modelling the Melee / Ring / Rune Arm Essence menus.** Still #764, still
  wiki-gated, and this feature does not close it — it routes around it for the
  player who has already done the crafting.

**Deferred to follow-up work:** #774 (on/off effects on a described item), filed
before this PR merged per `AGENTS.md` — prose in a plan is not a queue.

### Addendum, 2026-09-17: #774 was three questions and two answered themselves

The deferral listed three things to decide: whether a player may assert an effect
the Utility tier counts, whether it must be on the counting roster, and how the
form should ask for it. A probe through the real solver — a hand-minted record
carrying `Ghost Touch` as a `Bool`, pinned into a Ring — settled the first two
before a line was written:

- **The tier already counts it.** The counting indicator is minted per
  counting-set name with ANY contribution in that name's buckets, and a
  player's `Bool` is a contribution exactly as the catalog's is. No solver
  change, no tier change.
- **The receipt already credits it correctly**, reading `Ghost Touch — from
  My ghostly ring (yours)`. That is #773's structural disclosure doing the work
  unaided: the receipt names the carrier, and a described item's name carries the
  suffix. The disclosure obligation the deferral raised was already met.

So #774 reduced to validation and one form control, and the third question — the
form — answered itself once the first two did: the row's SHAPE follows the
effect, dropping the bonus-type and value controls rather than disabling them,
because a disabled control still reads as a question.

The work that remained was the **third** kind of stat, which the deferral had not
separated out: untyped-only names like `Enhanced Ki`, which carry a real
magnitude and no bonus type anywhere. They are neither a flag nor a typed row and
stay refused, now with their own sentence instead of being lumped in with the
on/off refusal they no longer share.

Worth keeping: **the probe is why this was cheap.** Reasoning from the issue body
would have produced a Utility-tier change and a new receipt field, both of which
the measurement showed were already there.

---

## Verification boundary, stated last because it qualifies everything above

Every behavioural claim was **reproduced through the real solver**, not reasoned
about: `tests/custom-items-solve.test.js` builds the reporter's dagger, pins it to
the off hand through the real `buildQuery` → `buildModel` → `solveLexicographic`
path, and asserts placement, the A/B against the same query without it, the
owned-pool exemption, the notice and all six exports.

**ddowiki was not consulted and nothing here is a wiki ruling.** It did not need to
be: this batch adds no game values. The one report that *would* have needed one —
modelling the Melee Essence menu — is explicitly not what was built, and #764
still holds that question with the harvest it requires.
