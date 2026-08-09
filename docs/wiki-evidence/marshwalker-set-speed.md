# Marshwalker set bonus — `Speed` is a naming collision, not the enchantment

**Harvested 2026-08-09** from ddowiki, same-origin from a ddowiki tab (see
`harvest-method.md`). Read from the page's own wikitext via `action=raw`, and
cross-read against the rendered table on the same page.

This is the evidence behind `speed_split.SET_BONUS_MOVEMENT_ONLY` and the #171
fix. It exists because the obvious reading is wrong, and the obvious reading was
written into the issue before anyone checked the wiki.

## What the wiki states

`Named item sets`, Marshwalker block, verbatim from the page source:

```
|'''Marshwalker [ML:7/20/30]'''
|{{Anchor|Marshwalker}}{{Anchor|Epic Marshwalker}}{{Anchor|Legendary Marshwalker}}
* {{HELitem|Gem of Many Facets}} - Trinket (prefix)
* {{HELitem|Boots of the Mire}} - Boots
* {{HELitem|Ring of the Mire}} - Ring
|{{Artifact}}
2 Pieces Equipped:
* {{InlineWht|dark=y|+30% Enhancement bonus to movement speed (all tier)}}
* {{HELstats|L=+3}} Artifact bonus to Dexterity
* {{HELstats|E=+3|L=+3}} Artifact bonus to all Saving Throws
* {{HELstats|+3|+5|+7}} Artifact bonus to Jump and Tumble
```

Rendered, the same row reads:

> +30% Enhancement bonus to movement speed (all tier)

**Movement speed only.** There is no attack-speed clause, and `(all tier)` means
the three tiers (Marshwalker / Epic / Legendary) all grant the same 30%.

## Why this is not the `Speed` enchantment

Two things that look identical in our data are different on the wiki:

| | Item affix | Marshwalker set bonus |
|---|---|---|
| Wiki form | `{{Speed\|30}}` template invocation | plain prose inside `{{InlineWht}}` |
| Renders | +30% movement **and 15% attack speed** | +30% movement, nothing else |
| Attack speed source | `Template:Speed`'s switch (30 -> 15) | none — not stated |

gear-planner normalizes the set bonus to the affix name `Speed`, which collides
with the enchantment name. It is a **naming collision, not a shared mechanic.**

Reading the set bonus as `{{Speed|30}}` — which is what the issue proposed, and
what reusing the item path would have done — grants **15% melee and 15% ranged
alacrity that the wiki does not state**, on all three Marshwalker sets. That is
the inference this project forbids, and it would have shipped as a silent
over-grant behind a green build.

## What the fix does

Set-bonus `Speed` expands to `Movement Speed` alone, at the stated magnitude:

```
Epic Marshwalker       Speed / Enhancement / 30  ->  Movement Speed / Enhancement / 30
Legendary Marshwalker  Speed / Enhancement / 30  ->  Movement Speed / Enhancement / 30
Marshwalker            Speed / Enhancement / 30  ->  Movement Speed / Enhancement / 30
```

`SET_BONUS_MOVEMENT_ONLY` is keyed by the stated value rather than accepting any
number, so a set bonus appearing at a magnitude nobody has read off the wiki
quarantines and the build's orphan assertion reports it. A new value has to be
harvested, not extrapolated from 30.

## Scope of the check

These three are the only set bonuses that named `Speed`; the build's
`set_bonus_orphans` assertion now runs with an **empty allowlist**, so any future
one fails the build. `Heightened Awareness` and the umbrella names were checked
in the same pass and have no set-bonus channel to expand.

## Watch for

- A Marshwalker tier gaining an attack-speed clause. Today the absence of one is
  the whole finding; if the wiki adds it, `SET_BONUS_MOVEMENT_ONLY` is the wrong
  shape and the outputs tuple has to grow.
- Any other set bonus whose gear-planner affix name matches an enchantment name.
  The collision here was invisible until the name was expanded away dataset-wide,
  which is what turned a harmless duplicate name into an unrankable orphan.

## Related

- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — why an
  unseen magnitude quarantines instead of scaling from a known one.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the
  two-representations trap that hid this channel: a tier affix carries `stat`
  where an item affix carries `name`, so the item split's predicate matched
  nothing here.
- `docs/wiki-evidence/speed-and-alacrity.md` — the enchantment this bonus is
  *not*, including the Arabic switch that would have supplied the wrong 15%.
- GitHub #171, #134 (made `Speed` expanded-away for items only), #169 (built the
  set-bonus expansion path and the orphan assertion).
