"""U10 (R13) — the provenance-label set, derived by SCANNING the built dataset.

Every expansion family stamps the originating enchantment name onto each affix it
emits, under `src/spell_focus.py`'s ``PROVENANCE_KEY``. The item surfaces display
that name — "Sacred Spell Focus Mastery +3", not "Necromancy Focus +3" — so the
priority picker has to be able to rank it. Otherwise the app prints a name its own
picker refuses, and a player who reads it off the results can do nothing with it.

This module answers one question for the web layer: **which enchantment names does
the build stamp, and what stats does each become?**

**It is a scan, deliberately, and must stay one.** The obvious alternative — union
the families' own declarations (``spell_focus.expanded_away()``,
``parrying_split.EXPANDED_AWAY``, …) — is wrong twice over:

  * Those declarations emit BARE keys (``spell focus mastery``). The names the
    surfaces display are bonus-type PREFIXED (``Sacred Spell Focus Mastery``), and
    are not enumerable from a family's declaration without re-deriving every
    bonus type that family happens to occur with. The dataset already knows.
  * A hardcoded family list silently omits the next family that lands. A scan
    picks it up the moment it stamps its first affix — no registration step, so
    no registration step to forget.

Ordering matters: the picker inserts the components as consecutive priorities in
"the expansion's declared order", so the order recorded here is the order the
player gets. Each expansion emits its group contiguously and in declared order, so
per-item first-appearance order IS the declared order — with one wrinkle. An
expansion may SKIP a component the item already states explicitly (bare
``Sheltering`` on an item that also carries an explicit ``Physical Sheltering``),
which yields a SHORT group whose order is an accident of what was skipped. So the
longest emission observed for a label wins; ties keep the first seen, which makes
the result deterministic for a given build.
"""
from __future__ import annotations

from src.spell_focus import PROVENANCE_KEY


def _stat_of(affix: dict):
    """The affix's stat name across both storage shapes.

    Item affixes are legacy-shaped (`stat`) in the in-memory build and native
    (`name`) once serialized; set-bonus tiers stay legacy in both. Reading both
    keys means this scanner works on `build()`'s dict AND on a loaded items.json.
    """
    stat = affix.get("stat")
    if stat is None:
        stat = affix.get("name")
    return stat


def _affix_channels(variant: dict):
    """Both channels an expansion reaches: item affixes and set-bonus tier affixes.

    Reading only the first is exactly how `Parrying` shipped a set bonus granting
    an expanded-away stat — see
    docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md.
    """
    yield variant.get("affixes") or []
    for tier in variant.get("parsed_set_bonuses") or []:
        yield tier.get("affixes") or []


def label_expansions(variants) -> dict:
    """``{originating enchantment name: [stats it becomes, in declared order]}``.

    Scanned from `variants`; a label appears only because some affix carries it.
    Absence of ``PROVENANCE_KEY`` is the expanded/native discriminator, so an affix
    the item states itself never contributes.
    """
    best: dict = {}
    for v in variants or []:
        # Per item, per label, the ordered de-duplicated group that item emitted.
        groups: dict = {}
        for affixes in _affix_channels(v):
            for a in affixes:
                if not isinstance(a, dict):
                    continue
                label = a.get(PROVENANCE_KEY)
                if label is None:
                    continue
                label = str(label).strip()
                stat = _stat_of(a)
                if not label or not stat:
                    continue
                group = groups.setdefault(label, [])
                if stat not in group:
                    group.append(stat)
        for label, group in groups.items():
            # Longest wins; ties keep the first seen (see the module docstring on
            # partial groups). Deterministic for a given build.
            if len(group) > len(best.get(label, ())):
                best[label] = group
    return {label: list(group) for label, group in sorted(best.items())}
