---
title: "One concept stored under two field names needs one accessor, reached for by every caller"
module: overrides
date: 2026-08-21
problem_type: convention
component: tooling
severity: high
tags:
  - accessors
  - data-shapes
  - silent-failure
  - crafted-pools
  - overrides
applies_when:
  - One domain concept is stored under different field names in two data shapes the same code must handle
  - A feature written against one shape is being widened to reach the other
  - An accessor pair exists but some code still names one of the raw fields directly
  - A fixture carries BOTH field names while production records carry only one each
---

# One concept stored under two field names needs one accessor, reached for by every caller

## Context

An affix's bonus type has two spellings in this dataset. An item affix records it
as `type`; a crafted pool row records it as `bonus_type`. Nothing is wrong with
that — they are different record shapes from different producers, and the solver
has always read the right field in the right place.

Widening the bonus-type override from items to the seven crafted channels meant
one body of code now had to handle both. An accessor pair was written for exactly
that:

```js
function typeKeyOf(affix) { … }              // "type" or "bonus_type"
function readType(affix) { return affix ? affix[typeKeyOf(affix)] : undefined; }
```

Two defects followed anyway, and neither announced itself.

**The accessor existed and a sibling function did not use it.**
`catalogTypeOrLive` — the function whose entire job is "the catalog's type,
through the stamp when one is applied" — fell back to `affix.type` directly:

```js
return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : affix.type;
```

For every unstamped crafted row that returns `undefined`. The pool key composed
from it named the type `"undefined"`, matched nothing, and the override reported
itself applied to zero rows while the whole suite stayed green — the failure was
in a string built from the value, not in a throw.

**The accessor's own tie-break was wrong, and only a fixture could show it.**
`typeKeyOf` preferred `bonus_type` when both keys were present. In the built
dataset they are never both present — 0 of 42,088 item affixes carry
`bonus_type`, 0 crafted rows carry `type` — so the preference looked arbitrary
and safe. But `tests/solver.test.js`'s `item()` helper writes both, and the
solver reads `.type` for a worn affix. The overlay wrote the override into
`bonus_type`, reported success, left the pool looking changed, and the solve was
untouched.

## Guidance

**Give the concept one accessor and route every reader through it**, including
the ones that look like they already know which shape they hold. The two defects
above were in a function *named for the concept* and in the accessor itself — the
places most likely to be trusted and least likely to be re-read.

```js
// through readType, not affix.type
return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : readType(affix);
```

**Break the tie toward what the consumer reads, not toward the newer shape.**
When both fields are present the accessor must resolve to whichever one the code
downstream will act on. Here the solver reads `.type` for a worn affix, so `type`
wins; anything else writes into a field nothing reads.

```js
if (affix && Object.prototype.hasOwnProperty.call(affix, "type")) return "type";
return (affix && Object.prototype.hasOwnProperty.call(affix, "bonus_type")) ? "bonus_type" : "type";
```

**State the population the tie-break is defending against, and check it.** "In
the built dataset they are never both present, 0 of 42,088 and 0 of 1,109" is a
measurement; "they should never both be present" is a hope. The measurement is
what tells you the tie-break exists for fixtures rather than for data — which is
exactly when it will be exercised.

**A composed string is a silent sink.** A key, a label, a cache index — anything
that concatenates a read value will happily embed `undefined` and fail later,
somewhere else, as a mismatch rather than an error. When an accessor feeds a
composed string, the composition is where a missing value has to be caught.

## Why This Matters

Both failures are of the shape this project spends its guards on: the code
reports success, the data structure looks plausible, and the wrong answer is
downstream. An override that silently applied to nothing would have shipped as
"crafted overrides do not work for some players and we do not know which."

The second one is worse, because the fixture *hid* it. A test fixture generous
enough to carry both field names is trying to be compatible with everything, and
that generosity is what let the accessor's wrong tie-break pass every existing
test. It only surfaced because a new test asserted a solve TOTAL — a number that
could not be produced unless the override reached the field the solver reads.

Note what did not catch either one: 26 green test files, and a code comment
asserting the opposite of the truth. The first was found by widening a feature
into new data; the second by writing an end-to-end assertion that no unit test
could have replaced.

## When to Apply

- Widening any feature from one record shape to a sibling shape — ask first which
  field names differ between them, and write the accessor before the feature.
- Reviewing a function named for a domain concept: check that it reads the
  concept through the accessor rather than through one shape's field.
- Writing an accessor with a tie-break: name the consumer the tie-break is
  serving, and measure how often both inputs actually occur.
- Reading a test fixture helper that populates more fields than any production
  record carries. That is not harmless compatibility; it is a shape no writer
  produces, and assertions made against it are weaker than they look.
- Any value that flows into a composed key or label rather than into a
  comparison.

## Examples

Before — the accessor exists, and the function most responsible for the concept
bypasses it:

```js
function catalogTypeOrLive(affix) {
  return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : affix.type;
}
// crafted row -> undefined -> key "seal||Gloom||…||Charisma||undefined||7" -> no match
```

After — one accessor, and the composed key can no longer name a field that was
never read:

```js
function catalogTypeOrLive(affix) {
  return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : readType(affix);
}
```

Related: `fixture-shape-must-mirror-the-production-writer.md` is the closest
sibling and the inverse case — there a fixture was too *narrow* to exercise the
real writer's shape; here one was too *wide*, carrying a field combination no
writer produces and making a wrong tie-break look correct. Hold them as a pair:
a fixture that does not mirror production fails in both directions.
`an-overlay-keyed-on-the-field-it-overwrites-must-read-through-its-own-stamp.md`
records why `catalogTypeOrLive` exists at all.

Found and fixed in
[#421](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/421), the second
of three PRs for
[#88](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/88).
