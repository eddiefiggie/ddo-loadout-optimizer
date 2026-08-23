---
title: "A coverage claim with a date is not a guard — convert it into a check against the population"
module: docs
date: 2026-08-20
last_updated: 2026-08-23
problem_type: convention
component: tooling
related_components:
  - testing_framework
  - build-pipeline
tags:
  - coverage-claims
  - silent-pass
  - staleness
  - evidence-docs
  - guards
applies_when:
  - "Writing a sentence like 'every X was examined', 'all N cases are covered', or 'the sweep is complete'"
  - "An evidence or plan document records a status checked on a date"
  - "A curated list is asserted to cover a population that upstream can grow"
  - "Reading a completeness claim that is older than the last upstream data refresh"
  - "A hand-maintained number in prose restates a figure the build already stamps"
---

## Context

Three separate defects in one day, all the same shape.

**`docs/wiki-evidence/bonus-type-equivalence.md` (#88).** The doc said "every
stacking bucket the built dataset produces was examined, not a sample. There are
40." True on 2026-08-10. On 2026-08-18 a gear-planner refresh introduced a
**31st live type**, `Psionic`, that the sweep had never seen. Nothing failed —
the sentence was prose. The type sitting in that gap turned out to be an
unconditional +24 Universal Spell Power for a buff the wiki says needs you to be
hit repeatedly, cross-adding into all ten element spellpowers. It shipped for two
days.

**`tests/encoding_equivalence.js` (#349).** Same shape one level down: the gate
carried its own copy of a constant, so it reported "size 26, 17 agree" while
comparing 20-effect vectors. Recorded separately as
`a-guard-that-copies-its-parameter-measures-the-copy.md`.

**A plan's gate status (#357).** "Gate status (checked 2026-08-17)" went stale
while the plan sat in a git stash, and the plan itself notes the staleness "went
unnoticed".

The common failure is not carelessness. Each claim was **true when written**, by
someone who had genuinely done the work. What none of them had was a way to stop
being true loudly.

## Guidance

**Write the claim as a check against the thing it claims about.** A completeness
sentence describes a relationship between a curated set and a population. Both
are usually readable at build time, so the relationship is assertable:

```python
undispositioned = sorted(live_types - dispositioned)
assert not undispositioned, (
    f"bonus type(s) with no disposition: {undispositioned}. A new stacking bucket "
    "arrived upstream and no one has ruled on it. Read its carriers against the "
    "wiki and add it — do not add it as 'legitimate' without reading, which is how "
    "Psionic shipped an unconditional +24 Universal Spell Power.")
```

Note what the message does: it names the population that moved, says what to do,
and warns against the shortcut that would silence the check without doing the
work. A guard that only says "assertion failed" invites exactly that shortcut.

**Check both directions.** A stale disposition — an entry for something the data
no longer produces — is a smaller problem than an undispositioned member, but it
makes the count mean something other than what it says. Assert set equality, not
containment, unless you have a reason.

**Keep the curated set as data, not as prose or a literal in the test.** A test
holding its own copy of the answer is the failure recorded in
`a-test-that-defines-the-rule-it-asserts-proves-nothing.md` and
`a-guard-that-copies-its-parameter-measures-the-copy.md`. Put it in a seed file;
let the doc narrate it and the test compare it.

**The date stays — as provenance, not as the guarantee.** "Swept 2026-08-10,
re-surveyed 2026-08-20" is useful history. It is just not a mechanism.

**The trigger for suspicion:** any completeness claim whose date is older than
the last upstream data refresh. In this repo that is the gear-planner snapshot,
and it moves often enough that most such claims are already stale by the time
anyone reads them.

## Why This Matters

A dated coverage claim is worse than no claim, because it is *load-bearing in
review*. A reader who sees "the sweep is complete" stops looking — that is the
sentence's entire purpose. So the gap it leaves is one nobody is watching, in the
exact area someone once cared enough to sweep.

And these claims cluster around the risky work. Nobody writes "every case is
covered" about something trivial; they write it after a hard audit of the thing
that matters most. `Psionic` did not land in a quiet corner — it landed in the
bonus-type population, the mechanism the whole optimizer's correctness rests on,
and it propagated through the cross-add family to every spellpower a caster
ranks.

The conversion is also cheap. The #88 guard is roughly twenty lines against a
seed file that already had to exist for the sweep to be recorded at all.

## When to Apply

- Writing any "every / all / complete / exhaustive" sentence about a population
  the build can enumerate.
- Reviewing an evidence doc whose claim predates the current data snapshot.
- Adding a curated list that must keep pace with upstream — an adjudication set,
  a disposition table, an allowlist over a growing catalog.
- Any time the honest answer to "how would we know if this stopped being true?"
  is "someone would have to re-read it."

## Examples

Before — a sentence, and a date:

```markdown
## Coverage — the sweep is complete

Every stacking bucket the built dataset produces was examined, not a sample.
There are **40**: 39 named types plus the null type.
```

After — the same narration, now backed by `bonus_type_dispositions.json` and
`tests/test_bonus_type_coverage.py`, with the doc saying what changed and why:

```markdown
## Coverage — the sweep, and why it is now guarded rather than dated

… The table above said "every stacking bucket the built dataset produces was
examined". That was true when written. On 2026-08-18 the canon migration
introduced a type the sweep had never seen, and nobody re-ran it — so the claim
quietly stopped being true, with nothing failing.

**The claim is now a guard.** … fails the build when a type appears with no
disposition. A dated completeness claim cannot notice its own staleness; this one
now does.
```

## A second instance: the README's own headline counts (#460)

The same shape, in the most-read file in the repo. `README.md` stated the catalog
size in **three** places — the opening pitch, the capability table, and the
`**State (…):**` line — and two of them had drifted. The pitch and the table said
9,108 variants from 8,034 records; the State line 119 lines below said 9,110 from
8,036. The build agreed with the State line. A reader who checked the product's
opening claim against its own resume prompt found two answers and no way to tell
which was live.

Nothing about this was hard to check. `metadata.variant_count` and
`metadata.seed_count` were stamped in the dataset the whole time. The numbers were
not wrong because they were unknowable — they were wrong because a human had to
retype them and, twice, no one did.

`tests/test_readme_counts.py` converts all ten of those claims into checks against
the built figures. It carries one wrinkle worth reusing: **the guard guards its own
completeness too.** A count guard that only covers the claims someone remembered to
declare drifts exactly the way the README did, so
`test_every_counted_capability_row_is_a_guarded_claim` asserts that every numeric
row in the capability table falls inside a span some declared claim matched. Adding
a counted row without guarding it fails the build. That is the rule applied to the
guard itself: the guard makes a completeness claim, so the guard asserts it.

Two scoping notes that made it tractable. Each claim is anchored to the **region**
it lives in rather than searched file-wide — the "Latest work" narrative quotes
counts as they stood at the time (`675 of 1,063`, an older `7 Dino inserts`), and
history is allowed to be stale. And the guard builds the dataset in-process rather
than reading the gitignored `web/data/items.json`, so it compares the README to what
the pipeline *currently produces*, not to whatever artifact happens to be on disk.

Related: `a-guard-that-copies-its-parameter-measures-the-copy.md` (the same
staleness in a harness rather than a doc),
`a-test-that-defines-the-rule-it-asserts-proves-nothing.md` (why the curated set
belongs in data), and `prove-a-guard-fails-before-trusting-it.md` (having built
the guard, disarm it once and watch it go red).

Found and fixed in [#413](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/413); applied again to the README's headline counts in [#460](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/460).
