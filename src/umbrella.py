"""U-umbrella — expand umbrella ability affixes into concrete ability affixes.

Some affixes buff *every* ability score at once — "All Ability Scores +15",
"Well Rounded +2" (any casing). The optimizer credits an affix only when its
stat exactly matches a ranked target, so an umbrella affix contributed NOTHING
to a single-ability build (a Constitution target ignored "All Ability Scores
+15"). Expanding each umbrella affix into the six concrete ability affixes —
same bonus type, value, and unit — fixes it at the data layer, so the objective,
the dominance pre-filter (variantBuckets), set thresholds, and browse all see the
real per-ability contribution with correct bonus-type stacking. Done once here;
no per-consumer umbrella logic needed downstream.
"""
from __future__ import annotations

ABILITIES = ["Strength", "Dexterity", "Constitution",
             "Intelligence", "Wisdom", "Charisma"]
# lowercased stat names that mean "+X to all six abilities"
_UMBRELLA = {"all ability scores", "all ability score", "well rounded"}


def is_umbrella(stat: str) -> bool:
    return (stat or "").strip().lower() in _UMBRELLA


def umbrella_expansion() -> dict:
    """Public, read-only: ``{lowercased umbrella name: [the six ability names]}``.

    Emitted to the dataset so the picker can (a) stop offering a name this module
    expands away — no item can ever carry it, so ranking it scores nothing — and
    (b) redirect the player to the concrete stats it becomes.

    ``_UMBRELLA`` is the single source of truth and is deliberately NOT extended
    for picker purposes: it drives :func:`_expand_affix`, so adding a name here
    rewrites every matching affix into the six ability scores at build time. Bare
    ``Sheltering`` is a different mechanism with a different expansion target
    (Physical + Magical Sheltering, expanded at the web/dataset.js seam) and must
    never be added to this set.
    """
    return {name: list(ABILITIES) for name in sorted(_UMBRELLA)}


def _expand_affix(affix: dict) -> list:
    if is_umbrella(affix.get("stat", "")):
        return [{**affix, "stat": ab} for ab in ABILITIES]
    return [affix]


def _expand_list(affixes):
    out = []
    for a in affixes or []:
        out.extend(_expand_affix(a))
    return out


def expand_affixes(affixes):
    """Public: expand umbrella affixes in a standalone affix list (e.g. a
    membership set-def tier), returning a new list. Same rule as expand_variants
    applies to worn/set affixes."""
    return _expand_list(affixes)


def expand_variants(variants):
    """In place: expand umbrella affixes in each variant's worn affixes and in its
    parsed set-bonus threshold affixes. Returns the same list."""
    for v in variants:
        if v.get("affixes"):
            v["affixes"] = _expand_list(v["affixes"])
        for tier in v.get("parsed_set_bonuses", []) or []:
            if tier.get("affixes"):
                tier["affixes"] = _expand_list(tier["affixes"])
    return variants
