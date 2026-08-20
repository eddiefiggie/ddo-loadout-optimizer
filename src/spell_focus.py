"""U1/U2 (#205) — expand universal-stat affixes into their concrete stats.

Two families share this machinery: universal spell-DC names expand into the
seven schools (#205, #289), and the universal spellpower `Potency` expands into
the ten element spellpowers (#290; evidence in
docs/wiki-evidence/spellpower-universal.md). Both reproduce the same wiki rule
— same bonus type collapses to the highest, different types add — through the
existing per-(stat, stacking-type) bucketing, and everything below about the
DC family's rationale applies to both.

`Spell Focus Mastery` raises the DC of EVERY spell, but the optimizer credits an
affix only when its stat exactly matches a ranked target (`web/model.js`), so a
player ranking `Necromancy Focus` scored nothing from any of the 232 items
carrying it — no sacred, quality, or insightful focus could ever be picked. The
reported symptom was a necromancer loadout with none of them.

Wiki (https://ddowiki.com/page/Increasing_spell_DCs, Items):

    Items with Spell Focus Mastery apply to all spells. School-specific effects,
    such as Evocation Focus items, apply only to a single school of spells, but
    they scale faster.
    The effects come in several bonus types. Effects with the same bonus type
    don't stack, only the highest applies.

Expanding each universal affix into the seven school affixes — same bonus type,
same value, same unit — reproduces BOTH rules through machinery that already
exists: `web/model.js` buckets by stat plus stacking-equivalent type and keeps
the max, so a universal and a school-specific source of one type collapse to the
highest ("don't stack") while different types add. **If this expansion ever
seems to require a change to that bucketing, the expansion is wrong** — the
model is not missing a case.

Three DC names expand (plus `Potency`, the spellpower family — see the header
above). `Spell Focus Mastery` is stated outright above. Bare
`Spell Focus` is confirmed by the same page's worked example, which credits
`Stormreaver's Napkin` — stored `Spell Focus | Equipment | 1` — as "+1 to her
DCs", plural. `Spell DCs` (#289) is the augment-set seed's wording for the
Esoterica bonus, recorded as "+3 Artifact ALL Spell DCs" in
docs/wiki-evidence/augment-sets.md and stored by gear-planner's catalog as
`Spell Focus Mastery | Artifact | 3` for the same set.

`_UNIVERSAL` is an explicit allowlist and the single source of truth. A name
joins it only with a wiki quote saying it applies to all spells. Deliberately
out:

  * `Rune Arm Focus` — the same wiki page says it "isn't directly tied to a
    Spell School but to the Rune Arm itself".
  * `Deific Focus` — NOT universal, and the tempting guess. Its own page does not
    exist, but the carriers' tooltips state the mechanic: "On Spell Cast: +1
    Sacred bonus to DC of that school for five seconds. Stacks up to III times.
    Casting a spell from another school clears all stacks." A conditional,
    ramping, single-school buff — expanding it would credit +3 Sacred to all
    seven schools permanently. See docs/wiki-evidence/spell-focus-universal.md.
  * `Universal Spell Lore` — genuinely stacks. Its own page calls it "a separate
    and stacking source of Spell Critical chance modifiers", which is exactly the
    explicit exception that keeps a name OUT of this table. It cross-adds instead.

    Base `Spell Lore` is a different case and IS in this table (below). The
    original #290 ruling excluded "spell lore of any kind" by reading the
    Universal-Spell-Lore sentence as licensing lore-name stacking generally; it
    does not. Corrected 2026-08-18 — see the `spell lore` entry.

This is NOT folded into `src/umbrella.py`. That module's own docstring says its
set "is deliberately NOT extended" for a mechanism with a different expansion
target: abilities expand to six, spell focus expands to seven.

Unlike umbrella, the expansion keeps the ORIGINATING enchantment name on each
emitted affix (`PROVENANCE_KEY`). The proof panel credits the contribution to the
ranked school but must display what is actually engraved on the item — "Sacred
Spell Focus Mastery +3", not "Necromancy Focus +3" — or a player checking the app
against an in-game tooltip finds text that appears nowhere on the item.
"""
from __future__ import annotations

# The seven schools a universal DC affix applies to, in wiki order.
SCHOOLS = [
    "Abjuration Focus",
    "Conjuration Focus",
    "Enchantment Focus",
    "Evocation Focus",
    "Illusion Focus",
    "Necromancy Focus",
    "Transmutation Focus",
]

# The ten element spellpower stats a universal spellpower affix applies to, in
# the wiki's Affected-damage-types table order (#290, U3).
SPELLPOWERS = [
    "Combustion",
    "Corrosion",
    "Devotion",
    "Glaciation",
    "Impulse",
    "Magnetism",
    "Nullification",
    "Radiance",
    "Reconstruction",
    "Resonance",
]

# The three saving-throw stats the classic `Resistance` bonus applies to (#211).
# Rendered tooltip, read 2026-08-13 from `{{Resistance|6}}`: "Resistance +6:
# Passive: +6 Resistance bonus to Fortitude, Reflex, and Will Saving Throws."
# 245 affix instances credited nothing to any save priority until this entry —
# the largest umbrella found by the #211 detector's first run.
SAVES = [
    "Fortitude Save",
    "Reflex Save",
    "Will Save",
]

# The four elemental spellpowers `Elemental Resonance` applies to (#211), in the
# tooltip's own order. Read 2026-08-13 from `{{SpellPower|Elemental Resonance|70}}`:
# "+70 Equipment bonus to Acid, Fire, Electric and Cold Spell Power." — the
# dataset's names for those four are Corrosion/Combustion/Magnetism/Glaciation.
# A four-element subset of the Potency family, NOT all ten.
ELEMENTAL_SPELLPOWERS = [
    "Corrosion",
    "Combustion",
    "Magnetism",
    "Glaciation",
]

# The three tactical-DC stats `Combat Mastery` applies to (#211). Rendered
# tooltip, read 2026-08-13 from `{{Tactics|Combat Mastery|7}}`: "+7 Enhancement
# bonus to the DC to resist the character's Trip, Improved Trip, Sunder,
# Improved Sunder, Stunning Blow, and Stunning Fist attempts." The dataset's
# per-tactic stats: `Vertigo` (Trip), `Shatter` (Sunder), `Stunning`
# (Stunning Blow/Fist). 136 affix instances.
TACTICS = [
    "Stunning",
    "Vertigo",
    "Shatter",
]

# #396 — the two stat keys this project uses for attack rolls and damage rolls.
# `Accuracy` and `Deadly` are the enchantment names DDO prints, but the catalog
# uses them as the BUCKETS for those two concepts: the wiki's differently-named
# `Solar Gem of Attack` ("Artifact Bonus to Attack Rolls") and `Solar Gem of
# Damage` ("Artifact Bonus to Damage Rolls") are both already stored under them.
COMBAT_ROLLS = ["Accuracy", "Deadly"]

# The ability-keyed skill umbrellas (#211). Rendered tooltips, read 2026-08-13:
# `{{Skills|Charisma|2}}`: "Passive +2 Exceptional bonus to the Charisma based
# skills of: Bluff, Diplomacy, Haggle, Intimidate, Perform and Use Magic Device
# (UMD)"; `{{Skills|Dex|4}}`: "... Balance, Hide, Move Silently, Open Lock, and
# Tumble"; `{{Skills|INT|2}}`: "... Disable Device, Repair, Search, and
# Spellcraft". Each component is a rankable skill stat.
SKILLS_CHA = ["Bluff", "Diplomacy", "Haggle", "Intimidate", "Perform",
              "Use Magic Device"]
SKILLS_DEX = ["Balance", "Hide", "Move Silently", "Open Lock", "Tumble"]
SKILLS_INT = ["Disable Device", "Repair", "Search", "Spellcraft"]
# The remaining three ability umbrellas appear only in the Nearly-Complete
# Skill menus, never on worn gear. Rendered tooltips, read 2026-08-13:
# `{{Skills|Constitution|6}}`: "... Constitution based skills of: Concentration";
# `{{Skills|Strength|6}}`: "... Strength based skills of: Jump";
# `{{Skills|Wisdom|6}}`: "... Wisdom based skills of: Heal, Listen and Spot".
SKILLS_CON = ["Concentration"]
SKILLS_STR = ["Jump"]
SKILLS_WIS = ["Heal", "Listen", "Spot"]

# Lowercased universal stat name -> the concrete stats it becomes. Allowlist;
# see the module docstring for what is deliberately excluded and why.
#
# `spell dcs` (#289) is the augment-set seed's wording for the Esoterica Set
# Augment bonus. Universal by two sources: the wiki-evidence table records the
# bonus as "+3 Artifact ALL Spell DCs" (docs/wiki-evidence/augment-sets.md), and
# gear-planner's own catalog stores the identical bonus as
# `Spell Focus Mastery | Artifact | 3` (raw/gearplanner_sets.json) — a name
# already on this list. No item or insert carries the name, so admitting it
# changes only the def channels that spell it this way.
#
# `potency` (#290) is the universal SPELLPOWER: the Spell Power page's
# Affected-damage-types table states "Potency -> All Spells", and the
# Equipment-bonus page names Potency and Combustion as the same bonus kind with
# the don't-stack rule outright, so the same-type expansion reproduces the
# highest-of-type rule exactly as it does for spell DCs. `Universal Spell
# Power` is the deliberate exclusion: the wiki says it FULLY STACKS ("flat adds
# to all of your other Spell Powers"), so a same-type expansion would wrongly
# put it in max-competition with element sources. Full quotes:
# docs/wiki-evidence/spellpower-universal.md.
# #366 — the `Spell_Lore` page's "Types of spell lore" roster, verbatim, minus
# the universal itself. Shared with src/cross_add.py's LORE_ROSTER (which keeps
# using it for `Universal Spell Lore`); defined here because this module is the
# expansion family's source of truth and the overlap guard reads both.
LORE_TARGETS = [
    "Acid Lore", "Fire Lore", "Ice Lore", "Lightning Lore", "Healing Lore",
    "Kinetic Lore", "Radiance Lore", "Repair Lore", "Sonic Lore", "Void Lore",
]

_UNIVERSAL = {
    "spell focus mastery": SCHOOLS,
    "spell focus": SCHOOLS,
    "spell dcs": SCHOOLS,
    "potency": SPELLPOWERS,
    # #366 (2026-08-18) — base Spell Lore is Potency's exact analogue, and was
    # the one member of its family filed in the wrong place. `Spell_Lore` types
    # it as "an equipment bonus to your chance to score a spell critical" and
    # lists it as a PEER of the element lores, separated only by coverage:
    # "Void Lore - negative energy and poison spells" / "Spell Lore - all spell
    # types". The page states no stacking rule at all, and neither does
    # `Spell_critical` — so DDO's default applies and a same-type element source
    # competes with it rather than summing.
    #
    # Contrast `Universal Spell Lore`, which the wiki explicitly calls "a
    # separate and stacking source" — that is the documented exception, and its
    # absence here is the whole point. Reported as an over-stack by a player
    # (Void Lore reaching 55 where 50 was correct); expanding restores the max.
    "spell lore": LORE_TARGETS,
    # #211 — found by the umbrella detector's first sweep, each with the
    # rendered-tooltip quote beside its component list above. All three are
    # same-bonus-kind grants (a Resistance bonus to saves, an Equipment bonus to
    # spellpowers, an Enhancement bonus to tactical DCs), so the same-type
    # expansion reproduces the highest-of-type rule exactly as it does for
    # Potency. Evidence: docs/wiki-evidence/umbrella-adjudication-sweep.md.
    "resistance": SAVES,
    "elemental resonance": ELEMENTAL_SPELLPOWERS,
    "combat mastery": TACTICS,
    # Set-channel wordings of the same two families, admitted on the catalog's
    # own self-stating text (the #289 `spell dcs` precedent): the set tiers
    # store "+N Artifact bonus to all Saving Throws" / "Saving Throws" /
    # "Tactical DCs" as the stat name outright. Found by the review pass on the
    # detector's own PR — the set-def channels were outside its first universe.
    "all saving throws": SAVES,
    "saving throws": SAVES,
    "tactical dcs": TACTICS,
    "charisma skills": SKILLS_CHA,
    "dexterity skills": SKILLS_DEX,
    "intelligence skills": SKILLS_INT,
    "constitution skills": SKILLS_CON,
    "strength skills": SKILLS_STR,
    "wisdom skills": SKILLS_WIS,
    # #396 — the Litany of the Dead's Combat arm. `{{Litany of the Dead|N|Combat}}`
    # renders "Grants a +N Profane bonus to attack bonus and damage" (the arm
    # grants the parameter SQUARED, so the Epic tier is +4). Three wiki facts make
    # `Accuracy` + `Deadly` the right components rather than a guess:
    #
    #   1. `Attack roll` — "you roll a d20 and add your base attack bonus,
    #      relevant ability score modifier and other Attack bonuses", so an
    #      attack bonus is exactly what feeds an attack roll.
    #   2. `Lunar_and_Solar_Gems` — "Accuracy: Profane Bonus to Attack Rolls"
    #      and "Attack: Artifact Bonus to Attack Rolls" are two DIFFERENTLY
    #      NAMED gems with one effect, and the catalog already stores both under
    #      `Accuracy`. Same for "Weapon Damage"/"Damage" -> `Deadly`.
    #   3. Those keys already carry six bonus types each, Profane included, so
    #      they are stat buckets rather than one Competence enchantment.
    #
    # The Litany's Profane therefore COMPETES with the Lunar gems' Profane in
    # one bucket (highest wins) rather than stacking beside it, which is the
    # behavior that made this worth settling before expanding.
    # Evidence: docs/wiki-evidence/litany-of-the-dead.md.
    "litany of the dead - combat bonus": COMBAT_ROLLS,
    "litany of the dead ii - combat bonus": COMBAT_ROLLS,
}

# #367/#396 — engraved names that are ALREADY the complete name the item prints,
# so `source_label` must not prefix a bonus type onto them. The generic family
# names above are words a type completes ("Potency" + Profane -> "Profane
# Potency"); these carry their own identity, and prefixing would invent
# "Profane Litany of the Dead II - Combat Bonus", a name no item bears, on the
# surface whose job is showing what is engraved on the player's gear.
SELF_NAMED = {
    "litany of the dead - ability bonus",
    "litany of the dead ii - ability bonus",
    "litany of the dead - combat bonus",
    "litany of the dead ii - combat bonus",
}

# Field carrying the originating enchantment name on an expanded affix. Absent on
# a native school affix, so a consumer can tell expanded from native by presence.
PROVENANCE_KEY = "via"

# How the wiki names each typed variant. Equipment is the base name with no
# prefix; Insight renders as "Insightful"; the rest use the bonus type verbatim
# ("Sacred Spell Focus Mastery", "Quality Spell Focus Mastery"). Matching the
# wiki's own wording is the point — this string is what the player is told to
# look for on the item.
_TYPE_PREFIX = {"Insight": "Insightful"}
_UNPREFIXED_TYPES = {"Equipment", None, ""}


def is_universal(stat) -> bool:
    """True when this stat name raises the DC of every school."""
    return (stat or "").strip().lower() in _UNIVERSAL


def expanded_away() -> dict:
    """``{lowercased universal name: the concrete stats it becomes}``.

    Emitted to the dataset so the picker can stop offering a name this module
    expands away — after expansion no item carries one, so ranking it would score
    zero — and redirect the player to the concrete stats it becomes.

    Registering a name here without expanding the set-bonus channel fails the
    build: `build_dataset.py` raises on any set-bonus affix naming an
    expanded-away stat, and its known-orphan allowlist is empty by design.
    """
    return {name: list(targets) for name, targets in sorted(_UNIVERSAL.items())}


def source_label(stat, bonus_type) -> str:
    """The enchantment name as the wiki writes it, e.g. "Sacred Spell Focus Mastery"."""
    base = (stat or "").strip()
    # #367/#396 — a self-named enchantment IS the engraved name already.
    if base.lower() in SELF_NAMED:
        return base
    if bonus_type in _UNPREFIXED_TYPES:
        return base
    prefix = _TYPE_PREFIX.get(bonus_type, bonus_type)
    # #211 — the classic `Resistance` enchantment CARRIES the Resistance bonus
    # type; prefixing would print "Resistance Resistance", a name no item bears.
    # The wiki engraves the bare name whenever the type IS the name.
    if prefix.strip().lower() == base.lower():
        return base
    return f"{prefix} {base}"


def _expand_affix(affix: dict) -> list:
    """One universal affix becomes its family's concrete affixes (seven schools
    for a DC name, ten element spellpowers for Potency); anything else passes
    through.

    Every other key — bonus_type, value, unit, raw, eligible — is copied verbatim,
    so the expanded affixes keep the eligibility and unit semantics of the source.
    """
    targets = _UNIVERSAL.get((affix.get("stat") or "").strip().lower())
    if not targets:
        return [affix]
    label = source_label(affix.get("stat"), affix.get("bonus_type"))
    return [{**affix, "stat": stat, PROVENANCE_KEY: label} for stat in targets]


def _expand_list(affixes):
    out = []
    for a in affixes or []:
        out.extend(_expand_affix(a))
    return out


def expand_affixes(affixes):
    """Expand a standalone affix list (e.g. a membership set-def tier), returning a new list."""
    return _expand_list(affixes)


def expand_variants(variants) -> dict:
    """In place: expand both affix channels on every variant. Returns counts.

    Both channels are handled here because the in-memory pipeline carries item
    affixes and set-bonus tier affixes in the SAME `{stat, bonus_type, ...}`
    shape (`build_dataset.py` converts to `{name, type}` only at serialization).
    That uniformity is why one pass suffices — but it must not be assumed:
    `Parrying` reached only one channel and shipped a set bonus granting an
    expanded-away stat, the trap recorded in
    `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`. The
    set-bonus counter below exists so a future refactor that breaks this
    uniformity shows up as a zero rather than as silence.
    """
    stats = {"items": 0, "set_bonuses": 0}
    for v in variants or []:
        if v.get("affixes"):
            before = sum(1 for a in v["affixes"] if is_universal(a.get("stat")))
            v["affixes"] = _expand_list(v["affixes"])
            stats["items"] += before
        for tier in v.get("parsed_set_bonuses") or []:
            if tier.get("affixes"):
                before = sum(1 for a in tier["affixes"] if is_universal(a.get("stat")))
                tier["affixes"] = _expand_list(tier["affixes"])
                stats["set_bonuses"] += before
    return stats
