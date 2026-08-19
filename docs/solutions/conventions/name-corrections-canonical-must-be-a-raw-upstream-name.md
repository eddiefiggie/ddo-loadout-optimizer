---
title: "A `name_corrections` canonical must be a RAW upstream name, placed upstream of the fold"
module: data-pipeline
date: 2026-08-18
last_updated: 2026-08-19
category: conventions
problem_type: convention
component: tooling
severity: high
tags:
  - data-pipeline
  - name-corrections
  - affix-aliases
  - legendary-fold
  - frozen-registry
  - integrity-gate
  - normalization-seams
  - under-credit
related_components:
  - name_corrections
  - vocabulary
  - legendary_fold
  - affix_aliases
  - build_dataset
applies_when:
  - "Adding or editing an entry in `data/seed/compendium/affix_name_corrections.json`"
  - "Adding an `affix_aliases.json` entry whose variant name appears in the raw gear-planner snapshot"
  - "A test turns red with `src.vocabulary.IntegrityError: unknown affix name ... not in the frozen registry` right after a rename that made the dataset look correct"
  - "One game mechanic is stored under two upstream names and scores zero against a priority that only matches one of them"
  - "Deciding which of the three normalization seams (name_corrections / channel folds / affix_aliases) owns a naming problem"
  - "Adding a correction to a channel (augment pool, item pool) that another channel legitimately never sees"
symptoms:
  - "`src.vocabulary.IntegrityError: unknown affix name 'False Life (%)' in crafting not in the frozen registry (new-name event -- regenerate + adjudicate)`"
  - "The dataset counts look right post-build (bucket 34 -> 36, stale name 2 -> 0) yet exactly one test goes red"
  - "An augment scores ZERO against a priority the identical worn-gear mechanic credits normally"
  - "A bug is reported as an over-stack but measurement shows the mirror image: an under-credit"
---

# A `name_corrections` canonical must be a RAW upstream name, placed upstream of the fold

## Context

Issue #376 (fixed by PR #377, merged to `main`) was reported as an over-stack —
`Conditioning` showing 25% where the game gives 15% — and turned out to be the mirror
defect: an **under**-credit. Both `Solar Gem of Enduring` augment records store "Legendary
Bonus to Maximum Hit Points" upstream under the name `False Life (%)`, while the 34 worn
carriers of the identical mechanic store it as `Legendary Conditioning`. Verified counts in
the raw gear-planner snapshot: `Legendary Conditioning` is referenced 34 times in `items`,
`False Life (%)` twice in `crafting`. One mechanic, two buckets, so the gems scored zero
against a `Conditioning` priority. Measured behaviorally with the worn carriers blocked, the
augment-pool `Conditioning` reachable ceiling was 0 where it should have been 10.

The fix is small. The durable learning is that shipping it correctly required satisfying
**two separate constraints on two separate seed files**, and those constraints fail in
opposite ways — one loudly, one silently. Conflating them into a single rule is what
produced the wrong first attempt.

The relevant seams:

1. **`name_corrections`** (`src/name_corrections.py`) — a pipeline rename. It mutates the
   in-memory record pool during `build_dataset.py`: every occurrence of `source_name`
   becomes `canonical_name`, globally (`apply` at `src/name_corrections.py:81`).
2. **Channel folds** — `src/legendary_fold.py`, `src/helpless_fold.py`,
   `src/dino_parser.py`. These rewrite a raw display name into a player-facing name and
   **nothing else** — `value`, `bonus_type` and `unit` are never touched
   (`src/helpless_fold.py:29`); `legendary_fold` only *asserts* the pre-existing type
   (`src/legendary_fold.py:94`). Rewriting the stat half is what decides which
   `(stat, bonus_type)` bucket a record lands in. (`dino_parser` is the exception: it
   parses `(stat, bonus_type, value)` out of free effect text.) `legendary_fold.apply` rewrites `Legendary Conditioning` to
   name=`Conditioning` (type stays `Legendary`) and stamps the engraved name under
   `PROVENANCE_KEY` — the `via` key (`src/legendary_fold.py:99-102`, key defined at
   `src/spell_focus.py:230`, allowlist at `src/legendary_fold.py:56-62`).
3. **`affix_aliases`** (`data/seed/compendium/affix_aliases.json`) — picker-only with
   respect to stored data, but **not inert with respect to the build**. See below; that
   half-truth is the trap.

## Guidance

### Rule A — `affix_aliases`: the canonical must be in the frozen registry. Fails LOUDLY.

If a variant name appears in the raw upstream sources, the canonical you alias it to must
itself be a name the frozen registry contains — in practice, a raw upstream name. Pointing
a picker alias at a post-fold, player-facing name turns the build red.

Mechanism, verified at source:

- `check_referential_integrity` iterates affixes in the **raw** `items` / `crafting` /
  `sets` structures (`src/vocabulary.py:349-375`). It never reads the built dataset.
- `resolve_affix_name` applies the alias map **first**, then requires the result to be in
  `baseline["affix_names"]`: `if name in alias_map: name = alias_map[name]` then `return
  name if name in registry_names else None` (`src/vocabulary.py:332-340`; the inline
  comment reads "curated rewrite wins").
- Without an alias, `False Life (%)` resolves to itself, and it **is** in the registry, so
  it passes. With an alias pointing at `Conditioning` — a name only produced *after*
  `legendary_fold` runs — it resolves to a name the registry cannot contain, and the gate
  raises.

Reproduced directly against the current tree:

```python
V.resolve_affix_name('False Life (%)', names, {})                              # 'False Life (%)'
V.resolve_affix_name('False Life (%)', names, {'False Life (%)': 'Conditioning'})   # None
```

Measured membership in the shipped frozen registry
(`data/seed/compendium/vocab_registries.json`). **Re-measured 2026-08-19 after the #374
gear-planner refresh (PR #382), which moved two of these rows** — the registry grew
1441 → 1483 `affix_names`, with 102 added and 60 removed:

| name | in registry (2026-08-18) | now (2026-08-19) |
| --- | --- | --- |
| `Conditioning` | no | no |
| `Legendary Conditioning` | yes | **no** — upstream stopped emitting it; folded into `False Life (%)` |
| `False Life (%)` | yes | yes |
| `False Life` | yes | yes |
| `Ki` | no | **yes** — upstream started emitting a `type` key, so the gate can see it |
| `Enhanced Ki` | no | no |

Both moves are the same event seen twice: a refresh can take a canonical *out* of the raw
registry and put a variant *in*, so this table is a snapshot, not a constant. Re-measure it
against the current snapshot rather than trusting the column — the check below is the
durable form of the question.

Check before you write the alias:

```
python3 -c "
import src.vocabulary as V
b = V.generate_registries(*[V._load(p) for p in (V.ITEMS_PATH, V.CRAFTING_PATH, V.SETS_PATH)])
print('CANONICAL' in set(b['affix_names']))"
```

`False` means the canonical is a fold output, not a raw name — Rule A will fail **unless the
name is minted** (below).

**Amendment (#374, PR #382): there is now a curated way to satisfy Rule A without the name
being raw.** `check_referential_integrity` accepts `baseline` UNIONED with a
`local_affix_names` section it loads from the registry file itself
(`src/vocabulary.py:587-609`) — deliberately loaded there rather than taken from `baseline`,
because the only caller builds its baseline with `generate_registries()` over raw, which
cannot carry a repo-minted name, so a caller-side union would be a no-op at the one call
site that matters. This exists because a refresh can drop our canonical from raw while every
shipped alias still points at it (see the table above), which would raise on data that is
perfectly correct.

The widening stops there: each entry is mechanically joined back to either a
`name_corrections` canonical or a `local_affix_synonyms` name, so a genuinely new upstream
name still raises. So Rule A now reads: **the canonical must be in the frozen registry, or
minted into `local_affix_names` with that join.** Thirteen names are minted today.

### Rule B — `name_corrections`: rename to the raw name, upstream of the fold. Fails SILENTLY.

Rename to the **raw upstream name** and position the correction **before** the fold that
normalizes it, so the record joins the existing fold chain and lands in one bucket with its
siblings, owned by one piece of code.

This rule is **not** gate-enforced. `name_corrections` mutates the in-memory pool inside
`build_dataset.py`; the gate reads the raw files on disk. A correction is therefore
invisible to `check_referential_integrity` and cannot by itself turn it red. Getting Rule B
wrong produces no error at all — it produces a second bucket, which is exactly the #376
under-credit that started this.

The shipped shape, `build_dataset.py:767-770`:

```python
_name_coverage_augments = name_corrections_mod.apply(aug_pool, _name_corrections)
name_corrections_mod.assert_all_reached(
    _name_corrections, _name_coverage, _name_coverage_augments)
legendary_fold_mod.apply(aug_pool)
```

Why upstream-of-the-fold rather than hand-writing the fold's output:

- The fold is the only thing that stamps `PROVENANCE_KEY` (`src/legendary_fold.py:100`,
  carried into emitted variants at `src/variants.py:92-93`). A record renamed straight to
  the post-fold name skips that stamp and silently diverges from its 34 siblings on the
  item surfaces and the picker's provenance-label scan.
- Hand-writing `Conditioning` duplicates the fold's mapping in a second file. A future wiki
  re-adjudication that changes what `Legendary Conditioning` folds to moves the 34 siblings
  and leaves the hand-written canonical behind — re-splitting the bucket with nothing
  failing.

## Why This Matters

**The asymmetry is the whole point: Rule A fails loudly, Rule B fails silently.** That is
what makes them worth separating rather than remembering as one rule.

Rule A's loud failure is still hard to trace, for two reasons:

- **It is test-time, not build-time.** `check_referential_integrity` is called only from
  `tests/test_vocabulary.py` (lines 56, 60 and 63); `build_dataset.py:195` merely mentions it in a
  comment. On the wrong first attempt the build succeeded and the dataset looked correct
  (`Conditioning` 34 -> 36, `False Life (%)` 2 -> 0). Right numbers, red test.
- **The error names the variant, not the canonical you edited.** The raise interpolates
  `nm`, the raw pre-alias name (`src/vocabulary.py:367-370`):

```
src.vocabulary.IntegrityError: unknown affix name 'False Life (%)' in crafting
  not in the frozen registry (new-name event — regenerate + adjudicate)
```

Nothing in that text mentions aliases, folds, or the file you changed. It reads as
"upstream emitted something new", which sends you to the wrong place.

Rule B has no message at all. Its only signal is a stat that quietly scores zero, which is
what a player eventually reports as a stacking bug.

The `affix_aliases` half-truth is the underlying confusion. Aliases **are** picker-only
with respect to stored data: the map is emitted into dataset metadata
(`build_dataset.py:1423`), read at `web/dataset.js:381`, and consumed by
`buildPickerVocabulary` (`web/dataset.js:729-736`) purely to canonicalize a name the player
types or selects. It never rewrites a stored affix name. But it is **not** inert with
respect to the build, because the integrity gate resolves through it. "Picker-only" is true
of data and false of the build. A related consequence of the same confusion: a claim in
merged PR #375 that `affix_aliases` translates imported upstream data — it does not — which
was publicly corrected on PR #375 and issue #374. That claim's root cause is worth naming
separately: it was "verified" in a build where nothing could have changed the canon, so the
check was tautological and could only pass.

## When to Apply

- Adding an entry to `data/seed/compendium/affix_aliases.json` whose variant is a name that
  appears in the raw gear-planner sources — check the canonical against the registry first
  (Rule A).
- Adding an entry to `data/seed/compendium/affix_name_corrections.json`, especially when the
  correct player-facing name is produced by a fold rather than stored upstream (Rule B).
- Any time you add both together — the shard's `_README` instructs you to pair them, and the
  pairing is precisely what routes the raw name through `resolve_affix_name` into the gate.
- Diagnosing an `IntegrityError` that names a raw upstream affix you did not touch, right
  after editing an alias.
- Deciding where a correction call belongs relative to `legendary_fold` / `helpless_fold` /
  `dino_parser` in `build_dataset.py`: before the fold that owns the raw name.

## Examples

### Wrong — alias canonical is a post-fold name (Rule A violation, loud)

```json
{ "variant": "False Life (%)", "canonical": "Conditioning" }
```

Bare `Conditioning` exists only after `legendary_fold` runs and is absent from the registry.
Running the gate with this alias against the real crafting file reproduces the failure
exactly:

```
IntegrityError: unknown affix name 'False Life (%)' in crafting not in the frozen registry
  (new-name event — regenerate + adjudicate)
```

### Right — both rules satisfied

`data/seed/compendium/affix_aliases.json`:

```json
{ "variant": "False Life (%)", "canonical": "Legendary Conditioning" }
```

`data/seed/compendium/affix_name_corrections.json`:

```json
{ "source_name": "False Life (%)", "canonical_name": "Legendary Conditioning" }
```

`Legendary Conditioning` is in the registry, so Rule A passes — verified,
`resolve_affix_name('False Life (%)', names, alias_map)` returns `'Legendary Conditioning'`
against the live map. The renamed gem then enters the fold allowlist
(`src/legendary_fold.py:60`) and lands as name=`Conditioning`, type=`Legendary`, stamped,
from the same owner as the 34 worn carriers — Rule B satisfied. The deliberately moved count —
legendary_fold total 85 -> 87, whose documented breakdown carries `Conditioning` 34 -> 36
(`tests/test_legendary_fold.py`, lines 130 and 137) — is the visible evidence that the gem joined the
existing chain rather than a parallel one. Only the total is an `assert`; the per-stat
figure lives in the comment breakdown beside it.

### The `Ki` entry was NOT a precedent — and its prediction has since fired

**Updated 2026-08-19.** This section originally read: *"If upstream ever attaches a bonus
type to `Ki`, that alias raises the same `IntegrityError` with no other change on our side."*
That is exactly what happened, four months earlier than anyone expected — on 2026-08-18, in
the #374 refresh (PR #382). It is preserved here because a prediction that fires is the
strongest evidence a rule is real.

**What it said, and why it was true then.** `Ki -> Enhanced Ki` had shipped since #227 and
never tripped the gate, which made it look like a passing example of Rule A. It was not:
neither `Ki` nor `Enhanced Ki` was in the registry, and the alias was live, so by Rule A's
mechanism it should have raised. It did not, because `resolve_affix_name` was never called
on `Ki` at all — every raw `Ki` record was untyped (`{'name': 'Ki', 'value': '3'}`), and
`iter_affixes` yields only dicts carrying `name`, `type`, **and** `value` together, so the
gate walked exactly 0 of the 20. `src/name_corrections.py` documents the same blindness in
`_iter_affix_dicts`, calling it *"the exact blindness that hid this enchantment"*.

**What changed.** The refresh re-encoded upstream's type field wholesale: it had been
omitting `type` for an untyped affix and began emitting a literal marker instead. Measured
now, all 20 `Ki` records carry `name` + `type` + `value`, and the gate walks all 20 (19
items, 1 crafting) where it previously walked none. `Ki` is consequently *in* the registry;
`Enhanced Ki` still is not, so the alias armed exactly as predicted and was resolved by
minting `Enhanced Ki` into `local_affix_names` during the migration.

Note the marker itself is still `Untyped` — the affix did not become typed in any meaningful
sense. What changed is that upstream now *writes the key at all*, which is all `iter_affixes`
needs. **The cause is structural, not a per-name decision**, which is why it armed a whole
class of dormant aliases at once rather than just this one.

**The boundary rule still stands, and is the durable part:** Rule A only bites when the
variant name is actually referenced in the gate-checked sources. `Ki` illustrated the
boundary; it never was evidence that a post-fold canonical is acceptable.

**On #229.** This section used to warn that #229's gap was *masking* a live Rule A violation,
and that whoever closed #229 would have to re-point the canonical in the same commit. The
refresh answered that instead: the mask is gone because upstream started emitting the key, so
the re-pointing happened during the migration rather than during a fix to #229. #229 itself
remains open and is now narrower than its title suggests — re-read it before acting on it.

### Supporting shape: a per-channel miss is silent, "reached nothing" is fatal

Adding the augment channel required relaxing the staleness guard, because the item channel
legitimately never sees these augment-only gems (and `Ki` is the mirror case). `apply` now
`continue`s on a per-channel source miss (`src/name_corrections.py:111-118`), and honesty is
restored by `assert_all_reached`, which fails the build when an entry matched in **no**
channel at all (`src/name_corrections.py:144-161`), backed by a new `hit_names` key in the
coverage dict. The other staleness guard is unchanged: a canonical that is already a native
upstream name still fails, because renaming onto it would merge two affixes upstream keeps
distinct.

If you add a third channel, call `apply` per channel and `assert_all_reached` exactly once
after all of them — the same split `type_corrections` already uses.

## Related

- [`docs/solutions/conventions/data-at-rest-can-look-inert-while-runtime-normalizes-it.md`](data-at-rest-can-look-inert-while-runtime-normalizes-it.md) — the same trap from the other direction: something that looks inert at rest is made live by a later stage. Here it is `affix_aliases`, genuinely picker-only with respect to *stored data* and still not inert with respect to the *build*. "Inert" is always a claim about a specific stage, never about a file.
- [`docs/solutions/conventions/golden-fixtures-resolve-aliases-like-saved-builds.md`](golden-fixtures-resolve-aliases-like-saved-builds.md) — the other place alias resolution must be modelled deliberately rather than assumed.
- [`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`](prove-a-guard-fails-before-trusting-it.md) — why the `Ki` boundary case is worth naming: a gate never observed to fail on a class of input is not known to cover it.
- [`docs/solutions/conventions/a-test-that-defines-the-rule-it-asserts-proves-nothing.md`](a-test-that-defines-the-rule-it-asserts-proves-nothing.md) — the tautological-verification mode that produced the wrong PR #375 claim described above.
- [`docs/solutions/conventions/a-gate-cascade-is-the-refresh-report-not-an-obstacle.md`](a-gate-cascade-is-the-refresh-report-not-an-obstacle.md) — the migration that fired this doc's `Ki` prediction, and the adjudication discipline for the cascade of gates it set off. Read it alongside this one when a refresh turns several guards red at once.
- Issue #229 — the untyped-affix blindness currently masking the `Ki` Rule A violation.
- Issue #376 / PR #377 — the defect this learning came out of; shipped in build `08182026.5`.
