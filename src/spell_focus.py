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
  * Spell **lore** of any kind. `docs/wiki-evidence/spell-lore.md` ruled that
    universal and element-specific lore genuinely STACK — different stats, not
    an umbrella. Expanding lore would collapse two stacking sources, which is a
    regression, not an extension of this module.

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
_UNIVERSAL = {
    "spell focus mastery": SCHOOLS,
    "spell focus": SCHOOLS,
    "spell dcs": SCHOOLS,
    "potency": SPELLPOWERS,
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
    if bonus_type in _UNPREFIXED_TYPES:
        return base
    prefix = _TYPE_PREFIX.get(bonus_type, bonus_type)
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
