---
title: "Adding a bonus-type word that is also a bare stat name destroys the stat"
module: data-pipeline
date: 2026-07-25
problem_type: logic_error
component: tooling
severity: high
tags:
  - ddo
  - parsing
  - affix
  - bonus-type
  - vocabulary
  - regression
  - data-pipeline
symptoms:
  - "An affix line parses to stat=\"\" (empty stat) and a shifted bonus_type"
  - "A stat the user targets is silently undercounted; the optimizer picks a worse loadout"
  - "A blank option leaks into the target datalist"
root_cause: "A word added to BONUS_TYPES is also used as a bare stat name, so the leading-type peel consumes the whole token and leaves no stat"
resolution_type: guard-condition
---

# Adding a bonus-type word that is also a bare stat name destroys the stat

## Problem

`src/affix_parser.py` types an affix by peeling a leading bonus-type word off the stat string (`_split_type`). Adding a new word to `BONUS_TYPES` that **also occurs as a bare stat name** makes the parser peel that word as the type and leave `stat=""` — silently mis-bucketing the affix and producing a wrong solver result.

## Symptoms

- Concretely: after adding `Resistance` to `BONUS_TYPES` (needed so the Isle of Dread Dino insert `"+12 Resistance bonus to all Saving Throws"` types correctly), the bare saving-throw lines `"Resistance +3"`, `"Resistance +4 (saves)"`, `"Resistance +5 (saves)"` went from `{stat: "Resistance", bonus_type: "Enhancement"}` to `{stat: "", bonus_type: "Resistance"}` — 3 base-dataset affixes in the built `web/data/items.json`.
- Because the target datalist is built from *distinct dataset affix stats* (`web/query.js`), `Resistance` is still selectable (it survives on `"Insightful Resistance +1"`). A user who ranks **Resistance** as a target then gets those Enhancement-type items contributing 0 → reported total and chosen loadout can both be wrong.
- A blank `""` also leaks in as a selectable target option (inert — `addTarget` guards `!stat` — but visible).

## What Didn't Work

- **Assuming the addition was safe because the words are "legitimate bonus types."** `Equipment` and `Insight` (also added in the same change) caused no regression — no existing value-last line leads with those words. Only `Resistance` collided, because it is also DDO's saving-throw stat name. The three additions looked identical; only one was dangerous.
- **Reading the build-time affix-type counts as a win.** The build showed "3 affixes newly typed `Resistance`" and it was initially misread as a correctness *gain* (types now recognized) rather than the regression it was (bare-stat lines mistyped, stat destroyed). The count alone doesn't distinguish the two.
- **The existing test suite did not catch it** — the bonus-type change had no direct test. It surfaced only in code review (correctness + adversarial reviewers converged on it).

## Solution

Only peel a leading bonus-type word when a stat name remains after peeling — require more than one word (`src/affix_parser.py`, `_split_type`):

```python
# before — peels even when nothing remains, producing stat=""
def _split_type(stat_part):
    words = stat_part.split()
    if words and words[0] in BONUS_TYPES:
        return words[0], " ".join(words[1:]).strip()
    return "Enhancement", stat_part.strip()

# after — keep the word as the stat when it is the whole token
def _split_type(stat_part):
    words = stat_part.split()
    if len(words) > 1 and words[0] in BONUS_TYPES:
        return words[0], " ".join(words[1:]).strip()
    return "Enhancement", stat_part.strip()
```

`"Resistance +3"` → `{stat: "Resistance", bonus_type: "Enhancement"}` again, while `"+12 Resistance bonus to all Saving Throws"` still types as `Resistance` (its stat, `"all Saving Throws"`, is a separate word). Fixed in PR #2 (merged). Base dataset went from 3 empty-stat affixes back to 0.

## Why This Works

`_split_type` receives a stat string that may or may not lead with a type adjective. A single-token string that happens to match a type name is ambiguous: it is *either* a bare stat named that word *or* a typed stat with the stat elided. In DDO the bare-stat reading is the real one (`Resistance`, `Fortification`, etc. are stats), so the safe rule is: never let type-peeling empty the stat. The value-first path already strips `"bonus to"` after peeling, so a genuinely-typed line like `"+12 Resistance bonus to X"` keeps a non-empty remainder and is unaffected.

## Prevention

- **Review heuristic when extending `BONUS_TYPES`:** for each new word, ask "is this word ever used as a bare stat name in the dataset?" If yes, it will collide. Grep the seed/effect strings for the word as a standalone value-last token (`<word> +N`) before adding it.
- **Keep the `len(words) > 1` guard.** It makes `_split_type` safe for *any* future collision, not just `Resistance` — a general fix, not a one-off.
- **Pin the vocabulary with tests.** `tests/test_affix_parser.py` now asserts each added type parses (`Equipment`/`Insight`), the `Resistance`-as-type vs bare-stat split, and that `Insight` ≠ `Insightful` (distinct stacking buckets). A vocabulary change with no test is exactly how this shipped invisibly — every `BONUS_TYPES` edit should carry a parse assertion.
- **Don't read affix-type count deltas as unqualified wins** — a shifted count can mean "correctly typed" or "stat destroyed"; check a sample of the actual `(stat, bonus_type)` tuples.

## Related

- `docs/solutions/design-patterns/parsing-ddo-wiki-affix-text.md` — the broader free-text→tuple parsing design this parser implements (same `src/affix_parser.py`). This entry is the specific vocabulary-extension gotcha within that pattern.
