"""U1/U2 (#205) — expand universal spell-DC affixes into the seven schools.

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

Two names expand. `Spell Focus Mastery` is stated outright above. Bare
`Spell Focus` is confirmed by the same page's worked example, which credits
`Stormreaver's Napkin` — stored `Spell Focus | Equipment | 1` — as "+1 to her
DCs", plural.

`_UNIVERSAL` is an explicit allowlist and the single source of truth. A name
joins it only with a wiki quote saying it applies to all spells. Deliberately
out:

  * `Rune Arm Focus` — the same wiki page says it "isn't directly tied to a
    Spell School but to the Rune Arm itself".
  * `Deific Focus` — https://ddowiki.com/page/Deific_Focus does not exist, so it
    is quarantined and disclosed rather than inferred from its name.
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

# Lowercased stat names meaning "+X to the DC of every spell". Allowlist; see
# the module docstring for what is deliberately excluded and why.
_UNIVERSAL = {"spell focus mastery", "spell focus"}

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
    """``{lowercased universal name: [the seven schools]}``.

    Emitted to the dataset so the picker can stop offering a name this module
    expands away — after expansion no item carries one, so ranking it would score
    zero — and redirect the player to the concrete stats it becomes.

    Registering a name here without expanding the set-bonus channel fails the
    build: `build_dataset.py` raises on any set-bonus affix naming an
    expanded-away stat, and its known-orphan allowlist is empty by design.
    """
    return {name: list(SCHOOLS) for name in sorted(_UNIVERSAL)}


def source_label(stat, bonus_type) -> str:
    """The enchantment name as the wiki writes it, e.g. "Sacred Spell Focus Mastery"."""
    base = (stat or "").strip()
    if bonus_type in _UNPREFIXED_TYPES:
        return base
    prefix = _TYPE_PREFIX.get(bonus_type, bonus_type)
    return f"{prefix} {base}"


def _expand_affix(affix: dict) -> list:
    """One universal affix becomes seven school affixes; anything else passes through.

    Every other key — bonus_type, value, unit, raw, eligible — is copied verbatim,
    so the expanded affixes keep the eligibility and unit semantics of the source.
    """
    if not is_universal(affix.get("stat")):
        return [affix]
    label = source_label(affix.get("stat"), affix.get("bonus_type"))
    return [{**affix, "stat": school, PROVENANCE_KEY: label} for school in SCHOOLS]


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
