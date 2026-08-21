---
title: "An overlay keyed on the field it overwrites must read through its own stamp"
module: overrides
date: 2026-08-20
problem_type: design_pattern
component: tooling
severity: high
tags:
  - overlays
  - in-place-mutation
  - identity-keys
  - order-independence
  - serialization
  - overrides
applies_when:
  - "A reversible overlay is applied in place over shared loaded data that has no pristine copy"
  - "The overlay's identity key includes a field the apply step writes"
  - "Two entries in the overlay can chain — one's replacement value is another's recorded value"
  - "A lifecycle or status reader runs against data that may or may not currently be applied"
  - "Per-object bookkeeping is attached to objects that reach JSON.stringify"
---

# An overlay keyed on the field it overwrites must read through its own stamp

## Context

A player bonus-type override (#88, workstream 2) is an assertion that one affix
on one item carries a different bonus type in game than the catalog recorded. It
changes which `stat||type` bucket the affix contributes to; it never changes its
value.

It is applied **in place** over the loaded pool. `normalizeDataset` mutates the
fetched dataset and nothing retains a pristine copy, so a stamp carrying the
catalog's own type is the only route back (`web/overrides.js:32`). And the
override's identity is four fields — variant, affix name, **the type it was
written against**, and the value (`overrideKey`, `web/overrides.js:141`):

```js
{ variant_id, name, from: affix.type, value: String(affix.value) }
```

Apply then writes `affix.type = o.to`. That is the whole shape of what went
wrong: **the key includes the field the write changes.** Three defects came out
of review, and all three are that one sentence wearing different clothes.

**1 — Chained overrides destroyed the catalog type.** Two individually-legal
overrides where one's `to` is the other's `from`. `Artemist's Aegis (level 5)`
carries `Fortitude Save 4` under *both* `Resistance` and `Insight`; override A
retypes Resistance → Insight, then B (recorded `from: Insight`) matches the affix
A just changed, captures it, and overwrites the stamp with A's replacement
instead of the catalog's type. Withdrawal then restores `Insight/Insight` where
the catalog says `Resistance/Insight` — permanently, because nothing keeps a
pristine copy. 35 variants in the catalog carry a same-name, same-value eligible
pair under two types, so the collision is real inventory, not a constructed one.

**2 — The ladder inverted on a live override.** `resolveMatch` classifies an
override as active, satisfied, or suspended. It keyed on `a.type` — the live
value. But applied *is* the steady state that every solve, browse, and export
reads, so an override doing its job read back as `satisfied`: "the catalog
adopted this, you can drop it."

**3 — A second apply over a stamped pool matched nothing**, and reported every
live override as unmatched. The pool stayed correct, so nothing that inspects
pool state could catch it — only the report was wrong.

The existing order-independence test passed throughout. It used two affixes that
did not interact.

## Guidance

**Withdraw before matching, always.** Not "when the pool might be stamped" —
unconditionally, as the first line of apply. It makes the steady state
irrelevant to the matcher, and it makes the result independent of the order the
player added overrides in.

```js
function applyOverrides(pool, overrides) {
  withdrawOverrides(pool);   // ALWAYS, and first
  ...
}
```

**Read the original value through the stamp, never the live field.** One
accessor, used by every reader that asks a question about the catalog rather
than about the current display:

```js
function catalogTypeOrLive(affix) {
  if (!affix) return undefined;
  return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : affix.type;
}
```

That fallback is what makes the ladder's answer independent of whether the pool
happens to be applied right now.

**Exclude, within a single pass, whatever that pass already stamped.** Withdraw
-first guarantees zero stamps on entry, so a stamp seen during the pass can only
be one this pass wrote:

```js
var hits = matchAffixes(pool, o).filter(function (a) { return a[OVERRIDE_FROM] == null; });
```

**Make the stamp non-enumerable.** `solver.js` hands out live pool variant
references, `chosen` is on `persist.js`'s `RESULT_KEEP`, and `saveCharacter`
`JSON.stringify`s the record — so a plain assignment persists bookkeeping into
every character saved while an override is applied, undeclared and with no
override list to explain it. `Object.defineProperty` with `enumerable: false`
keeps direct access and `delete` working while the property stays invisible to
serialization.

**An order-independence test must use interacting inputs.** Two overrides that
cannot touch each other's affixes are order-independent by construction; the
assertion is true and empty. Build the case where one's `to` is the other's
`from`, run both orders, and compare the *withdrawn* state as well as the
applied one — the applied state was identical in both orders here, and only
withdrawal exposed the damage.

## Why This Matters

Every one of these fails with the pool looking right.

A corrupted stamp is not a visible error: the affix still has a plausible bonus
type, it just has the wrong one, so it lands in the wrong `stat||type` bucket
and stacks — or fails to stack — against the wrong siblings. The solve returns a
loadout that is confidently, silently wrong, which is the failure mode this
project spends most of its guards on. And because withdrawal is the only route
back, the corruption survives the player removing the override that caused it.

The inverted ladder is worse than a wrong number, because it is advice: the
disclosure layer would have told the player to delete the override that was
actively doing the work, and deleting it would have looked like it changed
nothing until the next solve.

The enumerable stamp is the quiet one — no wrong answer at all, just an
undeclared field appearing in saved characters and exports, discovered later by
whoever has to decide whether old saves carrying it are corrupt.

## When to Apply

- Any reversible overlay applied in place over shared loaded data — this pool,
  a normalized dataset, anything where "restore" reads bookkeeping rather than a
  pristine copy.
- Any identity key that includes a field the operation writes. Ask immediately:
  can two entries chain, and what does the matcher see on a second pass?
- Any reader of lifecycle or status that can run against data in either state.
  Its answer must not depend on which one.
- Any per-object bookkeeping attached to objects that reach `JSON.stringify` —
  the eligibility cache here needed the same treatment for the same reason.
- Reviewing a test named "order independent", "idempotent", or "reversible":
  check that its inputs can actually interfere. If they cannot, it asserts
  nothing.

## Examples

Before — the ladder reads the live type, and a live override reports itself as
redundant:

```js
var atRecorded = pick.filter(function (a) { return a.type === override.from; });
if (atRecorded.length) return { state: "active", ... };
var atReplacement = pick.filter(function (a) { return a.type === override.to; });
if (atReplacement.length) return { state: "satisfied", ... };   // fires on a WORKING override
```

After — both rungs read through the stamp:

```js
var atRecorded = pick.filter(function (a) { return catalogTypeOrLive(a) === override.from; });
...
var atReplacement = pick.filter(function (a) { return catalogTypeOrLive(a) === override.to; });
```

And the regression test that has interacting inputs, asserting on the restored
state rather than only the applied one:

```js
const A = { ...O.overrideKey(v, at("Resistance")), to: "Insight" };
const B = { ...O.overrideKey(v, at("Insight")),    to: "Quality" };   // B.from === A.to
...
assert.deepStrictEqual(fwd.counts, [1, 1], "neither override captures the other's affix");
assert.deepStrictEqual(fwd.restored, ["Resistance", "Insight"],
  "withdraw restores the CATALOG types, not an intermediate override's");
assert.deepStrictEqual(fwd, rev, "and the result is independent of the order added");
```

Related: `a-test-that-defines-the-rule-it-asserts-proves-nothing.md` and
`a-guard-that-copies-its-parameter-measures-the-copy.md` — this adds a third way
for a green test to be empty, where the assertion is correct but the inputs
cannot exercise it. `suppress-dont-erase-user-constraints-on-transient-invalidity.md`
is the sibling on the state side: an override that cannot apply right now is
suspended with a reason, not dropped.

Found in review and fixed in
[#415](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/415), the first
of three PRs for
[#88](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/88).
