# Wiki evidence — the Sealed in Fire pool (#195)

**Verified:** 2026-08-11 (Chrome-MCP, same-origin from a ddowiki tab)
**Sources:** https://ddowiki.com/page/Ritual_Table ·
https://ddowiki.com/page/Legendary_Ash · https://ddowiki.com/page/Legendary_Vacuum ·
https://ddowiki.com/page/Legendary_Dust · https://ddowiki.com/page/Legendary_Ooze ·
https://ddowiki.com/page/Legendary_Salt · https://ddowiki.com/page/Legendary_Affirmation

`Sealed in Fire` is a Ritual Table upgrade on Magic of Myth Drannor legendary
weapons. Sixty-six gear-planner items carry the marker — the whole Undying Age
weapon family plus `Aeon, the Blazing Reign` and `Brimstone, the Heart of the
Dracolich` — and the pool sat unsourced, so every one of them had an inert slot.
A player ranking `Legendary Ash` and `Legendary Vacuum` saw Viktranium weapons
respond and Sealed-in-Fire weapons stay silent, which is what surfaced this.

## The pool — CONFIRMED, six options, single-pick

From [Ritual Table](https://ddowiki.com/page/Ritual_Table), the *Sealed in Fire
weapon upgrades* section. Each row reads:

> **Removed:** Any previous added Ritual Table effects
> **Added:** Legendary \<X\>

which states the mutual exclusion outright — this is a select-one choice slot,
the same shape as Sealed in Undeath. Applies to *"Any Sealed in Fire weapons
from: Weaponry of the Undying Age or Threats Old and New raid"*, at 20 Barrier
Fragments.

The six options: **Legendary Affirmation, Legendary Ash, Legendary Dust,
Legendary Ooze, Legendary Salt, Legendary Vacuum.**

## What each grants — CONFIRMED, and none of it is a wearer stat

All six are `{{Unique enchantment}}` pages. Effect text verbatim (the `|effect=`
field of each page; `~` substitutes a character the harvest guard strips):

| Option | Effect |
|---|---|
| Legendary Ash | Attacks and offensive spells have a 50% chance to reduce enemy MRR and Universal Spell Power. This penalty stacks 3 times, -7 MRR and -20 Universal Spell Power each time, 12 seconds duration. Can make MRR negative. |
| Legendary Vacuum | Attacks and offensive spells have a [30%~] chance to inflict multiple [2-4] stacks of Vulnerable. |
| Legendary Dust | Attacks and offensive spells have a 50% chance to reduce enemy PRR and Positive Healing Amplification. This penalty stacks up to 5 times, -7 PRR and -20 Positive Healing Amplification per stack. Duration 11 seconds. |
| Legendary Ooze | Attacks and offensive spells reduce enemy PRR and MRR by 10 each for 12 seconds [100% proc rate.] Attacks and offensive spells have a [~5%] chance to summon a CR 32 Legendary Ooze. |
| Legendary Salt | Attacks and offensive spells have a [100%] chance to greatly reduce enemy movement speed and attack speed [about -90% slowdown]. This inflicts 8 stacks, which all fade at once after 11 seconds. Doesn't affect bosses. |
| Legendary Affirmation | Attacks and offensive spells have a [10~33%] chance to grant 1,000 temporary hitpoints with 1 minute duration. Cooldown is also one minute. |

**Every one is an enemy debuff or a proc.** Five reduce an enemy stat; one grants
temporary hitpoints on a cooldown. Not one grants the wearer a persistent
magnitude the solver could add to a bucket.

So there is no value to source, and recording these as presence is not a
concession — it is the accurate reading. The magnitudes that *do* appear in the
text (`-7 MRR`, `-20 Universal Spell Power`) are penalties applied to the enemy,
conditional on a proc, and stacking over time; treating any of them as a wearer
bonus would invent a number the wiki never states about the player. That is the
`Never infer a value` rule in its original sense.

## Precedent — the same six names already ship as presence

These are not new to the dataset. All six already exist as `Bool` presence
affixes in two independently verified pools:

- **Viktranium** (`Woeful Flames` → Legendary Ash, `Woeful Sparks` → Legendary
  Vacuum, `Woeful Acid` → Legendary Dust, `Woeful Salt` → Legendary Salt,
  `Woeful Dimlight` → Legendary Affirmation)
- **Dino inserts** (`Flamehorn`, `Sparkhorn`, `Melthorn`, `Aspect of Tar`,
  `Black Sands' Desire`, `Brighthorn`)

Sealed in Fire is therefore a **third crafting route to effects the dataset
already models**, not a new modelling decision. Storing them any other way here
would make one effect mean two different things depending on which system
granted it.

## What this does not settle

The proc rates, stack counts, and durations are recorded above but not modelled.
The optimizer has no concept of uptime, so a 100%-proc effect and a 30%-proc one
are indistinguishable to it once both are present. That limitation is
pre-existing and tracked as
[#214](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/214)
(conditional and ramping effects stored as flat constants); this harvest does not
worsen it, but it does add five more effects whose value to a player depends on a
proc rate the solver cannot see.

~~Gloom and Mist remain unharvested. Their native pools exist in the crafting
catalog and stay excluded pending the same treatment.~~ **Resolved 2026-08-15:**
both harvested and verified — see `docs/wiki-evidence/sealed-in-gloom-mist.md`.
The predicted shape held: Mist is the same six unique-enchantment procs
(presence), Gloom is Undeath-shaped stat grants.
