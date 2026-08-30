# Gem of Many Facets — are the two set pools independent? Ruled: yes, and re-rollable

**Verified:** 2026-08-29 (same-origin from a ddowiki tab) · **Issue:** #446
**Sources:** `Item:Epic_Gem_of_Many_Facets`, `Item:Gem_of_Many_Facets`

## The question

The Gem grants one set membership from each of two pools (13 and 9 sets). #446 asked whether the two rolls are **independent per dropped Gem**, or **correlated** — because if some combinations never drop, the solver could prescribe a Gem that cannot exist. That is the #442 class, and it is not covered by the attainability non-goal: theoretical BiS licenses prescribing a *rare* item, never an *impossible* one.

The optimizer assumes full independence by construction — one `sum(picks) <= 1` per group, no cross-group constraint — so all 117 combinations are treated as obtainable.

## The answer: independent per instance, and freely re-rollable

Both item pages state, verbatim:

> This item will randomly choose from available set bonuses **whenever it is re-acquired or upgraded to a higher level version.**

And the Epic page's Tips:

> **You can reroll the sets for free at Legacy Altar of Epic Rituals.** (This destroys all augments, adamantine rituals, Curses or Essence Crafting enhancements.)

The heroic page adds three statements that confirm the same shape rather than qualifying it:

- "each new Gem will have a different **pair** of sets"
- "the preview window shows a **random pair** of set bonuses"
- "when you do upgrade the item, you will get a **different random pair**"

"Pair" throughout means *the two sets this instance happens to carry* — not a fixed pairing rule. **No statement on either page correlates a pool-1 set with a pool-2 set.**

## Verdict: the model is correct, and confirmed rather than merely unchallenged

Two independent facts settle it, and the second is stronger than the question needed:

1. The assignment is **per instance**, so it is not a fixed property of a variant.
2. It is **freely re-rollable** at an in-game altar, so a player who wants a particular combination can obtain it without even re-farming the Gem.

So every one of the 117 combinations is reachable, and the solver's independence assumption stands. **No code change.** Recorded explicitly, per #446's own instruction, so this is not re-asked — the previous state was "assumed correct because nobody had checked".

## Note

The build that surfaced #446 was correct under either answer, for a reason the issue already recorded: its two sets were one from each pool, and its third was composed entirely of real items with no Gem credit.
