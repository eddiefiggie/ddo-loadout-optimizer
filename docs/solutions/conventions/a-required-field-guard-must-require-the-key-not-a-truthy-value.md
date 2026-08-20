---
title: "A required-field guard that tests truthiness cannot express a legitimately-null value"
module: seed-corrections
date: 2026-08-20
problem_type: convention
component: tooling
severity: medium
tags:
  - guards
  - seed-data
  - falsy-collapse
  - corrections-family
  - evidence
applies_when:
  - A guard asserts that every entry in a curated seed carries its required fields
  - One of those fields records what UPSTREAM carries, and upstream can legitimately carry nothing
  - The guard is written as a truthiness test over the field's value
  - A new seed entry is rejected by a guard whose stated purpose it does not actually violate
---

## Context

`affix_type_corrections.json` records, per entry, the type gear-planner carries
today (`from`), the wiki-verified type to write (`to`), and the tooltip proving
it. Its evidence guard required every field to be present:

```python
for field in ("name", "from", "to", "value", "tooltip", "wiki_url", "verified"):
    assert e.get(field), f"{record}: correction is missing {field!r}"
```

That held for eight entries because every one of them corrected a *typed*
affix — `from: "Untyped"`, `from: "Competence"`. Then #367 needed to correct an
affix upstream carries with **no `type` key at all** (one of the ~90 key-less
affixes left after the 2026-08-18 re-encoding). The faithful record of that is
`"from": null`, and it is not merely faithful but *load-bearing*: `apply()`
matches on `(name, from)` against `(a.get("name"), a.get("type"))`, so `None` is
exactly what makes a key-less affix correctable at all.

The guard rejected it. Nothing about the entry violated the guard's purpose —
it carried its tooltip, its wiki URL, its verification date. The guard was
asserting "this field is non-empty" while meaning "this field was filled in."

## Guidance

**Separate the two questions the guard is actually asking.** "Did the author
supply this field?" is `"field" in entry`. "Is the supplied value non-empty?" is
truthiness. They coincide only for fields whose empty value is meaningless.

```python
for field in ("name", "to", "value", "tooltip", "wiki_url", "verified"):
    assert e.get(field), f"{record}: correction is missing {field!r}"
# `from` is the one field whose legitimate value can be falsy: upstream carries
# some affixes with no `type` key, and None is the faithful record of that.
assert "from" in e, f"{record}: correction is missing 'from'"
```

**The signal that this is the bug, not your data:** a new entry is rejected by a
guard whose *stated purpose* it plainly satisfies. Read the guard's docstring
against the entry. If the entry does everything the docstring asks and the
assertion still fires, the assertion is narrower than its own intent — widen the
assertion rather than distorting the entry. The tempting distortions here were
both wrong: writing `"from": "Untyped"` would have been a false claim about
upstream (and would have made `apply()` match nothing, silently no-opping the
correction), and writing `"from": ""` would have been the same lie in a
different spelling.

**Audit the sibling guards in the same family when you touch one.** The
corrections family (`gap`, `value`, `name`, `type`) shares this shape
deliberately, so the same latent narrowing may sit in the others — each is
one truthiness test away from refusing a legitimate empty string or null.

## Why This Matters

A guard that refuses valid data trains people to work around it, and every
available workaround here writes something false into an evidence file. That is
strictly worse than no guard: the shard's whole value is that each entry states
what upstream carries so the stale check can fail when upstream moves. An entry
claiming `"from": "Untyped"` about a key-less affix would have made the stale
guard fire on the *next* refresh for the wrong reason — or worse, silently match
nothing and no-op.

This is the inverse of the failure recorded in
`docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md`,
and worth holding as a pair. There, a falsy test **over-counted** a population by
merging empty, null, and absent. Here, a falsy test **rejected** a legitimate
null by merging "absent from the entry" with "recording an absent upstream
value." Same root — empty, null, and key-absent are three different facts — with
opposite symptoms, which is why the second one is not obvious once you have
internalised the first.

## When to Apply

- Writing or reviewing any "every entry has its required fields" guard over
  curated seed data.
- Adding the first seed entry whose field records an *absence* — a null type, an
  empty location, a missing tier.
- Any time a guard blocks an entry that satisfies the guard's documented intent.

## Examples

The entry the widened guard now accepts, from `affix_type_corrections.json`:

```json
"Litany of the Dead": [
  {
   "name": "Litany of the Dead - Ability Bonus",
   "from": null,
   "to": "Profane",
   "value": "1",
   "tooltip": "Litany of the Dead - Ability Bonus: … Grants a +1 Profane bonus to all Abilities.",
   "template": "{{Litany of the Dead|1|Ability}}",
   "wiki_url": "https://ddowiki.com/page/Item:Litany_of_the_Dead",
   "verified": "2026-08-20"
  }
]
```

Shipped in [#397](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/397),
closing [#367](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/367).
