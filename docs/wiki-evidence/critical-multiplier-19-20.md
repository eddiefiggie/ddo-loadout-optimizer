# Critical Multiplier on a 19-20 — one mechanic, two spellings, stacking CONTESTED

**Issue:** #683 (split from #675, surfaced by PR #676)
**Harvested:** 2026-09-02, from a ddowiki tab
**Status:** naming RESOLVED (one mechanic) · stacking **QUARANTINED** · disclosed to the player, not modelled

---

## The two spellings

| stored stat | bonus type | value | granting sets | pieces |
|---|---|---|---|---|
| `Critical Multiplier on a 19-20` | Artifact | 1 | Renegade Champion, Renegade Champion (Legendary) | 3 |
| `Critical Multiplier on a roll of 19-20` | Artifact | 1 | Fried & Frozen Frenzy, Last Line of Defense, Legendary Fried & Frozen Frenzy | 2 |

Both live **only** in `parsed_set_bonuses`, `stat`-keyed. Neither appears in
`membership_set_defs`, `augment_set_defs` or `dino_sets`. Counts measured from the
built dataset and re-measured on every build by `src/split_mechanics.py`.

## Resolved: they are ONE mechanic

`https://ddowiki.com/page/Critical_hit_multiplier` (`Critical multiplier` redirects
to it) has a section headed **"Ways to increase multiplier on 19 and 20"**. Its
*Items* subsection reads, verbatim:

```
Blunt Trauma weapons: +1
Elasticity bows: +1
Renegade Champion item set: +1
Fried & Frozen Frenzy item set: +1
Last Line of Defense item set: +1
```

All five granting sets of both spellings appear under one mechanic heading. That is
the wiki naming the mechanic once, which is what #683 said would settle the naming
question.

## Why there was no source authority to appeal to

Both spellings are on the **same page**, `Named_item_sets` — already the `wiki_url`
of every one of these tiers:

```
+1 Artifact Bonus to Critical Multiplier on a 19-20          (Renegade Champion, 3 Pieces Equipped)
+1 Artifact Bonus to Critical Multiplier on a roll of 19-20  (Fried & Frozen Frenzy, 2 Pieces Equipped)
+1 Artifact Bonus to Critical Multiplier on a roll of 19-20  (Last Line of Defense, 2 Pieces Equipped)
```

One page, one effect, two wordings. #672 was settled by playing two sources against
each other (wiki names the enchantment, gear-planner spells it differently); that
move is unavailable here because there is only one source.

## QUARANTINED: do they stack?

The mechanics section above opens:

> Multiple ways exist now to increase critical multiplier on the rolls of 19 and 20.
> **All of these fully stack.**

The three item sets are listed *inside* that section. So one wiki page says these
bonuses stack with each other, while another types all three as `Artifact` — and
same-type bonuses do not stack. The two readings give different totals for a player
wearing two of these sets, and no third page adjudicates.

**Ruled 2026-09-02: quarantine the stacking axis.** Neither reading is implemented.

### Why this is not a fold

#683's body proposed folding the spellings, on the reasoning that separate buckets
let them SUM where the game gives 1. That reasoning depends on the Artifact reading
being right. `variantBuckets` (`web/model.js`) takes the max within
`stat||equivType(type)`, so a fold **asserts they do not stack**; `web/cross-add.js`
flat-adds across buckets, so a cross-add entry **asserts they do**. Both are answers
to the open question.

The dataset therefore keeps both spellings exactly as harvested, and the split is
disclosed to the player — the same conservative direction #573 took for the armor
Dodge limit and #663 for the Jump soft cap. `docs/solutions/conventions/exclude-until-verified-data-gates.md`
is the governing rule: a visible gap beats a confident wrong number.

### The consequence, stated plainly

- ranking `Critical Multiplier on a 19-20` alone reaches 2 of the 5 sets;
- ranking `Critical Multiplier on a roll of 19-20` alone reaches 3 of 5;
- ranking both credits the sum — correct under the mechanics page, one too high
  under the Artifact typing.

PR #676 made both spellings *suggested* rather than merely typeable, so the picker
now offers two entries for one mechanic. That raised the exposure and is why the
disclosure ships now.

## The settling test

In-game and cheap. Wear **Renegade Champion** (3 pieces) together with
**Fried & Frozen Frenzy** (2 pieces) and read the critical multiplier on a 19-20.

- **+2** — the mechanics page governs. These must never be folded; the correct fix
  is a `cross_add` entry, and the two names may even be right to keep apart.
- **+1** — the `Named_item_sets` Artifact typing governs. The fold described in
  #683's body is correct as written, at the `src/set_parser.py` parse seam (the
  #305 shape — `name_corrections` does not reach `stat`-keyed set-tier affixes).

Either outcome **deletes** the `split_mechanic_disclosures.json` entry rather than
editing it: the shard exists to hold an unsettled question, not to carry a number.

## Standing note — do not re-raise these

- **`Last Line of Defense` is not missing a member.** One catalog member against
  `pieces_required: 2` is correct: the set completes by wielding two copies of the
  same scimitar ("Kindling, the **Twin** Flames of the City"). Confirmed against
  `Category:Last Line of Defense set items`, gear-planner, and the `Named item sets`
  entry. Recorded on #683 as a comment; repeated here so a later audit does not
  re-open it.
- **`Renegade Champion` requires 3 pieces**, not 2 as #683's body states.
- **The free solve does not discover the 2-piece weapon pair on its own** —
  `Critical Multiplier on a roll of 19-20` scores 0 unless the pair is pinned into
  both hands. That is a separate, undiagnosed question and is **not** evidence about
  stacking. #683's first write-up read a malformed query (`style: "one-handed"`,
  where the taxonomy's token is `"one-hand"`) as proof the affix was unreachable;
  it is reachable.

## What enforces this

`src/split_mechanics.py` re-measures the population on every build and fails when a
declared count moves — including a move into a channel declared empty. The counts
are quoted to the player verbatim, so a refresh that adds a sixth granting set would
otherwise leave the notice quietly wrong. This is the failure mode
`docs/solutions/conventions/a-dated-coverage-claim-cannot-notice-its-own-staleness.md`
describes; the guard is the reason this page carries no dated coverage claim of its own.
