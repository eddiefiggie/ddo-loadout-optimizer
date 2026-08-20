# Litany of the Dead — one template, four affixes, two different grants (#367)

**Ruled:** 2026-08-20. **Method:** same-origin harvest per `harvest-method.md`;
`Template:Litany of the Dead` and both item pages read via
`action=query&prop=revisions` (POST, paced), corroborated against the rendered
tooltip in `#mw-content-text`. **Shards:** `src/umbrella.py` `_NAMED_UMBRELLA`
(the Ability half) and `data/seed/compendium/affix_type_corrections.json` (the
key-less base type). **Guard:** `tests/test_umbrella.py`,
`tests/test_type_corrections.py`.

## The ruling

Both trinkets invoke one parameterised template. From
`Template:Litany of the Dead`, the coding section verbatim (`|` shown as `~`,
per the harvest method's character-stripping rule):

```
#vardefine:name ~ Litany of the Dead {{#ifeq:{{{1 ~ 1}}} ~ 2 ~ II}} - {{ucfirst:{{lc:{{{2 ~ Ability}}}}}}} Bonus
...
Grants a +{{#ifeq:{{lc:{{{2}}}}} ~ combat ~ {{#expr:{{{1 ~ 1}}}*{{{1 ~ 1}}}}} ~ {{{1 ~ 1}}}}} [[Profane bonus]] to {{
    #switch:{{lc:{{{2 ~ ability}}}}}
      ~  ability  ~  all [[Abilities]].
      ~  attack bonus and damage.
    }}
```

So the second parameter selects the grant, and the magnitude differs per arm:
the Ability arm grants the first parameter, the Combat arm grants its **square**.

| Invocation | Renders as | Grants |
| --- | --- | --- |
| `{{Litany of the Dead\|1\|Ability}}` | `Litany of the Dead - Ability Bonus` | +1 Profane to **all Abilities** |
| `{{Litany of the Dead\|1\|Combat}}` | `Litany of the Dead - Combat Bonus` | +1 Profane to **attack bonus and damage** |
| `{{Litany of the Dead\|2\|Ability}}` | `Litany of the Dead II - Ability Bonus` | +2 Profane to **all Abilities** |
| `{{Litany of the Dead\|2\|Combat}}` | `Litany of the Dead II - Combat Bonus` | +4 Profane to **attack bonus and damage** |

Rendered tooltips, verbatim, confirming each arm independently of the coding:

> Litany of the Dead - Ability Bonus: The Litany of the Dead enhances the physical
> and mental abilities of its owner. Grants a +1 Profane bonus to all Abilities.

> Litany of the Dead - Combat Bonus: The Litany of the Dead enhances the combat
> abilities of its owner. Grants a +1 Profane bonus to attack bonus and damage.

> Litany of the Dead II - Ability Bonus: … Grants a +2 Profane bonus to all Abilities.

> Litany of the Dead II - Combat Bonus: … Grants a +4 Profane bonus to attack bonus and damage.

Sources: `Item:Litany_of_the_Dead` (ML13, Ascension Chamber),
`Item:Epic_Litany_of_the_Dead` (ML26), `Template:Litany_of_the_Dead`.

## What this settles, and what it deliberately does not

**The Ability arm is settled and shipped.** "all Abilities" is verbatim the
grant `src/umbrella.py` already expands, so both Ability affixes are registered
in `_NAMED_UMBRELLA` and expand into the six ability scores, preserving the
Profane type and the value. Their provenance label is the engraved name
**verbatim** — `Litany of the Dead II - Ability Bonus`, not
`Profane Litany of the Dead II - Ability Bonus`: unlike the generic `Well
Rounded`, this name already carries its own identity, and the bundle card's job
is to print the name on the player's gear.

**The Combat arm is NOT settled here** — filed separately. The tooltip says
"attack bonus and damage", and this project's rankable vocabulary carries
`Accuracy` and `Deadly`. The wiki defines those two as *enchantments*:

> **Accuracy** — Passive: +x competence bonus to attack rolls.
> **Deadly** — Passive: +x competence bonus to melee and ranged damage.

That is suggestive, not decisive: it establishes what the Accuracy and Deadly
*enchantments* do, not that our `Accuracy`/`Deadly` stat keys are the canonical
buckets for "attack bonus" and "damage" from an unrelated Profane source. That
name↔concept correspondence is exactly the class of question #366 required to be
settled explicitly rather than assumed, so it gets its own determination rather
than a guess folded into this one. Both Combat affixes stay stored as-is and
credit nothing until it is answered.

## Why the base tier also needed a type correction

Upstream carries `Litany of the Dead - Ability Bonus` with **no `type` key at
all** — one of the ~90 key-less affixes left after the 2026-08-18 re-encoding
(#374) — while its own Combat sibling on the same item and both Epic-tier
affixes are `Profane`. Left untyped, the six abilities it expands into would
land in the untyped bucket and stack with every Profane source instead of
competing with them. The tooltip states Profane outright, so the correction is
recorded in `affix_type_corrections.json` with its stale guard, and runs before
expansion.

## Counterfactual

Measured after the change, ML26, priorities Strength > Constitution > Wisdom,
`Epic Litany of the Dead` pinned to Trinket: the trinket contributes
`Profane +2` to each ranked ability, and the Sets tab renders one
`Litany of the Dead II - Ability Bonus` bundle with six members. Before the
change it contributed nothing to any of them.

At ML13 the base tier's `Profane +1` is correctly **dominated** by
`Lunar Gem of Strength (Heroic)`'s `Profane +2` — same bonus type, highest
wins — so it credits zero there. That is the rule working, not the fix failing.
