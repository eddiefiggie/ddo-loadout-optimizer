# Isle of Dread — which Dinosaur Bone blanks carry `The Legendary Dread Isle's Curse`

**Harvested 2026-08-26** from ddowiki, same-origin from a ddowiki tab (see
`harvest-method.md`), via `POST /api.php` for per-item wikitext plus the rendered
`Dinosaur Bone Items` overview.

This is the evidence behind the `src/dino.py` stamp predicate and the #334
correction. It exists because #334 read one sentence of this page as a universal
and stamped the set on all eleven blanks, four of which the same page excludes.

## The ruling

**A Dinosaur Bone blank carries the Curse intrinsically if and only if it has no
`Isle of Dread: Set Bonus Slot` — and no Dinosaur Bone weapon carries it at all.**

| Blank | Set Bonus Slot | Intrinsic Curse |
|---|---|---|
| Belt, Boots, Bracers, Gloves, Necklace, Ring (Minor Artifact accessories) | no | **yes** |
| Rune Arm | no | **yes** |
| Buckler, Small/Large/Tower Shield, Orb | no | **yes** |
| Armor (Robe / Outfit / Mail / Docent / Scale Plate / Plate) | **yes** | no |
| Helmet, Cloak (non-Minor-Artifact accessories) | **yes** | no |
| Weapons (Dinosaur Bone) | no | no |

The three Set-Bonus hosts get exactly **one** set, chosen from six — and the
Curse is one of the six. It is a choice, not an addition.

## What the wiki states

`Dinosaur Bone Items`, rendered, one enchantment list per category. The set name
appears at the end of three lists and is absent from three:

```
All accessories are Minor Artifacts, accepting 4 Filigrees. They are also imbued
with these enchantments:
  ... Blue Augment Slot, Green Augment Slot, Yellow Augment Slot,
  The Legendary Dread Isle's Curse          <- Belt/Boots/Bracers/Gloves/Necklace/Ring

All shields are imbued with these enchantments:
  ... Orange Augment Slot, Purple Augment Slot,
  The Legendary Dread Isle's Curse

The Rune Arm is imbued with these enchantments:
  ... Green Augment Slot, Yellow Augment Slot,
  The Legendary Dread Isle's Curse

All armor is imbued with these enchantments:
  ... Isle of Dread: Set Bonus Slot: Empty, Green Augment Slot, Blue Augment Slot
                                            ^ list ends here — no set

The Cloak and Helmet are imbued with these enchantments:
  ... Isle of Dread: Set Bonus Slot: Empty, Green Augment Slot, Yellow Augment Slot
                                            ^ list ends here — no set

[Weaponry] All weapons are imbued with the same enchantments:
  5.2[W], +15 Enhancement Bonus, ... Orange Augment Slot, Purple Augment Slot
                                            ^ list ends here — no set
```

Per-item wikitext agrees, and is the stronger read because it is the source the
overview renders from. `{{Named item sets|The Legendary Dread Isle's Curse}}` is
present on `Item:Dinosaur Bone Belt`, `Item:Dinosaur Bone Large Shield` and
`Item:Dinosaur Bone Runearm`, and **absent** from `Item:Dinosaur Bone Helmet`,
`Item:Dinosaur Bone Cloak`, `Item:Dinosaur Bone Robe` and
`Item:Dinosaur Bone Longsword`.

## The Set Bonus augment is a six-way choice that includes the Curse

`Dinosaur Bone crafting`, the Set Bonus table — note the header names exactly the
three slots that lack the intrinsic set:

```
! Set Bonus Augment (Armor, Cloak, and Helm) !! Effect
| Dread Stalker                     || Counts as part of the Dread Stalker set
| Devotion of the Firemouth         || Counts as part of the Devotion of the Firemouth set
| Defender of Tanaroa               || Counts as part of the Defender of Tanaroa set
| Deacon of the Auricular Sacrarium || Counts as part of the Deacon of the Auricular Sacrarium set
| Echoes of the Walking Ancestors   || Counts as part of the Echoes of the Walking Ancestors set
| The Legendary Dread Isle's Curse  || Counts as part of The Legendary Dread Isle's Curse set
```

The same page classifies Helmet and Cloak as **"Non-Minor Artifact Accessories"**
with a Set Bonus slot, against **"Minor Artifact Accessories"** (the six that
carry the set) without one. The split is the mechanic, not a listing accident.

## Why the weapon blank is separate

Dinosaur Bone weapons have no set. Their raid-tier counterpart does, and the
crafting page states it as the difference between them:

```
* Attuned Bone Weapons have:
  ** ... Purple Augment Slot
  ** Legendary Dread Isle's Curse set effect      <- Attuned only
```

Our `Dinosaur Bone Weapon` blank models the craftable Dinosaur Bone weapon, so it
carries no set. Attuned Bone weapons are native catalog records and keep theirs.

## What this corrects

#334 fixed a real defect — the blanks were set-less where the wiki gives them the
set — but its citation, "every crafted item's enchantment list, including the Rune
Arm's, ends with it", generalised from the three lists that end with the set to
all six. The four blanks it over-stamped are Armor, Helmet, Cloak and Weapon.

The over-stamp produced the reported double-dip: a Dinosaur Bone Armor whose Set
Bonus augment bought `Defender of Tanaroa` also counted as a `Legendary Dread
Isle's Curse` piece, so two hosts paid for one set apiece and delivered two.
It also cost the hosts a legitimate option — `attach_dino_set_bonus_slots`
filters a host's intrinsic sets out of its own pick pool (correctly, so one item
is never two pieces of one set), so the phantom intrinsic set removed the Curse
from the very pool the wiki puts it in.

**gear-planner agreed with the wiki the whole time.** Every item in
`gearplanner_items.json` carrying `Isle of Dread: Set Bonus Slot: Empty` has no
`sets` field, and every Dinosaur Bone item without that slot lists the Curse. The
synthesized blanks bypassed that data (they are generated, not harvested), which
is why the stamp could contradict the catalog without any gate noticing.

**That bypass is closed (#541).** A blank's membership is no longer stamped from
the rule above — it is DERIVED from the gear-planner records the blank shadows,
joined on the worn slot the synthesis collapses on, so the stamp cannot contradict
the catalog. The table in this ruling survives as the independent cross-check the
build runs against that derivation: the rule reads `dino_set_bonus_slot` from the
hand-written host layout in `src/dino_native.py`, the derivation reads the catalog,
and a disagreement stops the build naming both sides and this file. So if you are
here because the build sent you: **do not change either side to make it green.**
Re-read the wiki text above first — upstream changing a Dinosaur Bone item's `sets`
is a game-data event, and it is equally possible upstream is the one that drifted.
See `docs/solutions/design-patterns/derive-a-synthesized-record-from-the-record-it-shadows.md`.
