# Litany of the Dead — one template, four affixes, two different grants (#367, #396)

**Ruled:** 2026-08-20 (Ability arm), 2026-08-20 (Combat arm, #396). **Method:** same-origin harvest per `harvest-method.md`;
`Template:Litany of the Dead` and both item pages read via
`action=query&prop=revisions` (POST, paced), corroborated against the rendered
tooltip in `#mw-content-text`. **Shards:** `src/umbrella.py` `_NAMED_UMBRELLA`
(the Ability arm), `src/spell_focus.py` `_UNIVERSAL` + `SELF_NAMED` (the Combat
arm, #396), and `data/seed/compendium/affix_type_corrections.json` (the key-less
base type). **Guards:** `tests/test_umbrella.py`, `tests/test_spell_focus.py`,
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

**The Combat arm is settled too, as of #396** — deliberately *after* the Ability
arm rather than alongside it, because it needed a name-to-concept ruling the
Ability arm did not. The tooltip says "attack bonus and damage"; this project's
stat keys are `Accuracy` and `Deadly`. Three wiki facts close the gap, in order:

1. **`Attack roll`** — "you roll a d20 and add your base attack bonus, relevant
   ability score modifier and other **Attack bonuses**." So an *attack bonus* is
   precisely what feeds an attack roll; the two are not different quantities.

2. **`Lunar_and_Solar_Gems`** — the hub table lists, verbatim:

   ```
   Accuracy        Profane Bonus to Attack Rolls    +1  ...  +4
   Attack          Artifact Bonus to Attack Rolls   +2  +3  +4
   Weapon Damage   Profane Bonus to Damage Rolls    +2  +3  +4
   Damage          Artifact Bonus to Damage Rolls   +2  +3  +4
   ```

   Two **differently named** gems (`Accuracy`, `Attack`) share one effect, and
   the catalog already stores both under the single key `Accuracy`; likewise
   `Weapon Damage` and `Damage` both under `Deadly`. The correspondence is
   therefore established by shipped data the wiki corroborates, not inferred.

3. **The keys are buckets, not one enchantment.** In the built dataset
   `Accuracy` carries six bonus types (Competence 188, Quality 27, Legendary 14,
   Insight 14, **Profane 2**, Artifact 2) and `Deadly` six (Competence 137,
   Quality 37, Insight 33, **Profane 2**, Legendary 3, Artifact 2). A Profane
   entry is not a novel shape being invented for the Litany — `Lunar Gem of
   Accuracy` is already exactly that.

So both Combat affixes expand into `Accuracy` + `Deadly`, preserving the Profane
type and the value. Registered in `spell_focus._UNIVERSAL` (a two-component
family) rather than in `umbrella.py`, whose expansion target is the six
abilities.

**The consequence that made this worth settling first:** the Litany's Profane
now lands in the *same* bucket as `Lunar Gem of Accuracy`'s Profane, so the two
**compete** (highest wins) rather than summing. Guessing the mapping the other
way — leaving it unexpanded, or inventing a separate key — would have silently
handed players attack and damage they do not have. Measured at ML30 with the
Epic trinket pinned: exactly one Profane entry per stat in each breakdown.

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
