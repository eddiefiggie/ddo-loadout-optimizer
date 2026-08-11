# Wiki evidence — compound absorption names (#249)

**Verified:** 2026-08-11 (Chrome-MCP, same-origin from a ddowiki tab)
**Sources:** https://ddowiki.com/page/Template:Absorption ·
https://ddowiki.com/page/Energy_Absorption ·
https://ddowiki.com/page/Item:Crown_of_Ioun ·
https://ddowiki.com/page/Item:Archaic_Device ·
https://ddowiki.com/page/Item:Golden_Orb_of_Death_(level_26)

Three stat names in the dataset name several elements at once, so a player
ranking a single element scores zero from them. This records what each covers
and, for one of the three, why it cannot be expanded from the dataset alone.

## Ruling summary

| Stat | Covers | Status |
|---|---|---|
| `Fire and Cold Absorption` | Fire + Cold, same magnitude each | **CONFIRMED** |
| `Electricity and Acid Absorption` | Electric + Acid, same magnitude each | **CONFIRMED** |
| `Elemental Absorption` | Acid + Cold + Fire + Electric, **and Sonic on some items only** | **CONFIRMED (mechanic and per-item)** |

## `Elemental Absorption` — the sonic parameter is per-item and the data drops it

`Template:Absorption` takes a third parameter that decides whether Sonic is
included, and the tooltip text branches on it:

> `| elemental =` … Passive: N% Enhancement Bonus to
> `{{#switch:` `no|n|0|false =` **Acid, Cold, Fire, and Electrical** ·
> `yes|y|1|true|sonic =` **Acid, Cold, Fire, Electrical, and Sonic** `}}` Absorption.

The template's own documentation states the same:

> `** Elemental ''(Acid, Cold, Electric, Fire, (Sonic))''`
> `*** Specify if sonic is included using '''(Elemental Sonic)'''`

**Two items, same stat name, different coverage.** Rendered tooltips captured
verbatim from the live pages:

| Item | Wikitext | Rendered tooltip |
|---|---|---|
| Archaic Device | `{{Absorption Elemental 5}}` | `Elemental Absorption +5%: Passive: 5% Enhancement Bonus to Acid, Cold, Fire, and Electrical Absorption.` |
| Golden Orb of Death (level 26) | `{{Absorption Elemental 20 yes}}` | `Elemental Absorption +20%: Passive: 20% Enhancement Bonus to Acid, Cold, Fire, Electrical, and Sonic Absorption.` |

The visible cell reads `Elemental Absorption +5%` / `+20%` in both cases. This is
the trap in
`docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`,
on coverage rather than magnitude.

**gear-planner flattens the parameter away.** All 13 records store
`{"name": "Elemental Absorption", "type": "Enhancement", "value": N}` with
nothing distinguishing a 4-element carrier from a 5-element one. So the
expansion cannot be derived from the dataset; it needs a per-item shard sourced
from the wiki.

### Per-item sonic table (all 13 records, harvested 2026-08-11)

| Item | Value | Template | Sonic |
|---|---|---|---|
| Archaic Device | 5 | `{{Absorption Elemental 5}}` | no |
| War Wizard's Robes | 5 | `{{Absorption Elemental 5}}` | no |
| Wizard's Ward (level 16) | 5 | `{{Absorption Elemental 5}}` | no |
| Wizard's Ward (level 17) | 5 | `{{Absorption Elemental 5}}` | no |
| Wizard's Ward (level 18) | 5 | `{{Absorption Elemental 5}}` | no |
| Wizard's Ward (level 23) | 10 | `{{Absorption Elemental 10}}` | no |
| Wizard's Ward (level 24) | 10 | `{{Absorption Elemental 10}}` | no |
| Wizard's Ward (level 25) | 10 | `{{Absorption Elemental 10}}` | no |
| Cyran Guard (level 26) | 18 | `{{Absorption Elemental 18 yes}}` | **yes** |
| Cyran Guard (level 27) | 19 | `{{Absorption Elemental 19 yes}}` | **yes** |
| Cyran Guard (level 28) | 20 | `{{Absorption Elemental 20 yes}}` | **yes** |
| Golden Orb of Death (level 7) | 10 | `{{Absorption Elemental 10 yes}}` | **yes** |
| Golden Orb of Death (level 26) | 20 | `{{Absorption Elemental 20 yes}}` | **yes** |

**All thirteen rows were opened individually and read from their own rendered
tooltip on 2026-08-11.** The four that were originally inferred from sibling tier
rows — Wizard's Ward 17, 18, 24 and Cyran Guard 27 — each confirmed the inferred
state, but they are recorded as `stated` because they were verified, not because
the inference looked safe. The shard is `data/seed/compendium/elemental_absorption.json`;
every entry carries `provenance: "stated"`, so no carrier is currently quarantined.

**Consequence:** a blanket four-element expansion under-credits Sonic on five
records; a blanket five-element expansion over-credits Sonic on eight. Neither
is safe. Expansion is per-item, keyed to the harvested table above.

A new carrier that ships without a shard entry is quarantined and disclosed
rather than defaulted, so the failure mode of an un-harvested item is a visible
gap rather than a wrong number in either direction.

## `Fire and Cold Absorption` and `Electricity and Acid Absorption` — components at full magnitude

The rendered tooltip names the compound rather than its parts, so the
component split comes from the template's own categorization, which is
unambiguous. From the `fireandcold` branch:

> `[[Category:… Fire Absorption +{{{2|0}}}% items]][[Category:… Cold Absorption +{{{2|0}}}% items]]`

One invocation at magnitude N emits membership of **both** the `Fire Absorption
+N%` and `Cold Absorption +N%` categories. The wiki therefore treats the
compound as granting N to each element, not N split between them. The
`electricityandacid` branch does the same for Electric and Acid.

Rendered tooltips, captured verbatim from `Item:Crown of Ioun`:

> `Fire and Cold Absorption +22%: Passive: 22% Enhancement Bonus to Fire and Cold Absorption. (Absorption reduces damage from an element by a percentage, after resistance have been taken into account.)`

> `Electricity and Acid Absorption +22%: Passive: 22% Enhancement Bonus to Electricity and Acid Absorption. (Absorption reduces damage from an element by a percentage, after resistance have been taken into account.)`

Both compounds take the bonus-type parameter (`Insight` renders as
`Insightful`, plus `Quality` and `Artifact`), so expansion must preserve bonus
type exactly as the spell-focus expansion does. Only the four Crown of Ioun
records exist today, all `Enhancement`.

**Carriers:** `Crown of Ioun` (22 each) and `Legendary Crown of Ioun` (40 each).

## `Elemental Absorption` has no page of its own

There is no `Elemental Absorption` wiki article; `Absorption` is a
disambiguation page pointing at `Energy Absorption` and `Spell Absorption`, and
`Energy Absorption` describes the mechanic without ever using the enchantment
name. The authority is `Template:Absorption` and the rendered per-item tooltip,
which is why the ruling is recorded here rather than cited from an article.

## What this does not settle

`Energy Absorption` states that in general only one **item-based** source of
absorption applies, and not always the highest — a rule the current
max-per-(stat, bonus type) bucketing does not model, and which the wiki itself
sources to player testing rather than to a released mechanic. Out of scope for
#249; recorded so a later audit does not re-raise it as a discovery.
