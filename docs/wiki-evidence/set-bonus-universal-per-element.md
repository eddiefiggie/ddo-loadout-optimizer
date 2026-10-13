# Set-bonus "Universal" spell power and lore are per-element (U81.4)

**Established:** 2026-10-13 (#870, part of the U81.4 + U82 rollout #875)
**Read through:** the in-app Browser pane, same-origin `action=parse` on ddowiki
**Supersedes, for set bonuses only:** `spellpower-universal.md` §3, and the
`Universal Spell Lore` row of `universal-name-sweep.md`

---

## 1. The statement

DDO Wiki, `Update 81 Patch 4 Release Notes`, section *Miscellaneous Balance
Changes*. The page opens "Here are the release notes for Update 81.4, released on
Wednesday, October 7th 2026."

> We are fixing the mismatch between Universal Spell Power/crit/crit damage and
> global spell power/crit/crit damage in Set Bonuses. All item Set Bonuses that
> say they grant bonuses to Universal Spell Power/crit/crit damage will now
> instead say what they are actually doing, which is to grant bonuses to each
> Spell power/crit/crit damage mod, and any Set Bonus that actually grants
> Universal Spell power/crit/crit damage will change to follow this expected
> pattern.
>
> We're also adjusting the Solar Augment of Spell Crit Damage to follow this
> pattern, which means it will no longer stack erroneously with other Set
> Bonuses providing that modifier.

The same text is on ddo.com (`update-notes/ddo-update-81-4-release-notes`) and in
the Lamannia preview threads, where it was unchanged across previews 1 to 3.

## 2. What it says, clause by clause

1. **"say they grant … Universal … will now instead say what they are actually
   doing"** — the label was wrong and the behavior was not. A set bonus
   engraved "Universal Spell Power" has been a bonus to each element spellpower
   all along.
2. **"any Set Bonus that actually grants Universal … will change to follow this
   expected pattern"** — the few that really did grant Universal are brought
   into line. After 81.4, **no set bonus grants Universal anything.**
3. **Scope is "Set Bonuses".** Item enchantments are not mentioned:
   `Implement` USP on spellcasting implements, `Exceptional` USP and USL, and
   potions keep the Universal mechanic.
4. **"each Spell power / crit / crit damage mod"** — three families: spellpower
   (the ten element spellpowers), crit chance (the ten element lores), and crit
   damage (the ten element Intensities).

A per-element bonus of one type is exactly what `Potency` is
(`spellpower-universal.md` §1–2): it competes with same-type element sources and
the highest applies. So the faithful model is the **same-type expansion**, not
the cross-add.

## 3. Why this is not a third re-litigation

`universal-name-sweep.md` closes its #402 section with: "Do not re-open the
crediting question without a new wiki statement." This **is** the new wiki
statement. It is dated, on the wiki, and it describes the mechanic directly
rather than by an absent table row.

The earlier rulings were right about what the wiki said then. `Spell_power`
still states that Universal Spell Power is "Fully stacking. It flat adds to all
of your other Spell Powers", and that remains true **for item enchantments**.
What changed is that set bonuses no longer belong to that mechanic, if they ever
did.

The set pages themselves (`Named_item_sets` and the set articles) still print
"Universal" at 2026-10-13, and so does upstream gear-planner's `sets.json` (35
occurrences at `c36b45e1`). This ruling does not wait for them: the behavior is
stated, and only the label lags. #872 tracks the label.

## 4. Exposure, measured at `main` `5bcd51d`

Set-bonus carriers of a Universal name:

| stat | type | sets |
|---|---|---|
| Universal Spell Power | Artifact | 17 |
| Universal Spell Power | Profane | 6 |
| Universal Spell Lore | Artifact | 7 |
| Universal Spell Critical Chance (dino-set wording of USL) | Artifact | 2 |
| Universal Spell Critical Damage | Legendary | 1 |
| Spell Critical Damage | Legendary | 4 + 5 membership defs |

They collide with Artifact element-spellpower and element-lore set bonuses on
dozens of sets: Arcsteel Battlemage, Dreadkeeper, Chained Elementals, Shaman's
Fury, Feywild Dreamer, Divine Blessing, and others. Under cross-add, a Draconic
Prophecy set (Artifact USP) beside Arcsteel Battlemage (Artifact Combustion) was
credited the **sum**. In game, the higher Artifact bonus to Combustion applies.

## 5. Ruling

**Spellpower and crit chance — applied (#870).** In every set-bonus channel —
variant `parsed_set_bonuses`, `dino_sets`, `membership_set_defs`, and
`augment_set_defs` — these names expand at their own bonus type:

| set-bonus name | becomes |
|---|---|
| `Universal Spell Power` | the ten element spellpowers (`spell_focus.SPELLPOWERS`) |
| `Universal Spell Lore` | the ten element lores (`spell_focus.LORE_TARGETS`) |
| `Universal Spell Critical Chance` | the ten element lores |

The expansion lives in a **set-channel-only** table
(`spell_focus._SET_UNIVERSAL`), separate from `_UNIVERSAL`. That separation is
the point:

- Item-affix USP and USL are still Universal and keep the cross-add.
- Both names stay rankable, so they must **not** enter `expanded_away()`, which
  would remove them from the picker.
- The `cross_add` overlap guard reads `_UNIVERSAL` only, so it is unaffected.

A per-channel build guard fails if any set channel still carries one of these
names after expansion, and it refuses to vouch for an empty channel.

**Crit damage — ruled, implementation deferred (#876).** The same statement puts
`Universal Spell Critical Damage` (set-only) and `Spell Critical Damage` (the
Solar Augment, plus set tiers) onto the ten element Intensities at Legendary.
Doing that removes `Spell Critical Damage` from the picker and retires the #404
companion hint, which is a vocabulary change with its own web surface. It ships
separately, so the spellpower fix is not held behind it.

## 6. What would overturn this

A later release note restoring Universal on set bonuses, or an in-game tooltip
reading showing a set "Universal" bonus summing with a same-type element bonus.
Not a set page that still prints "Universal" — that is the lagging label §3
describes.
