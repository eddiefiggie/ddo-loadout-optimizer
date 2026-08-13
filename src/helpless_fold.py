"""#305 — fold the fragmented helpless-damage spellings to their canonical stat.

The wiki's Helpless hub page states ONE gear mechanic — a percent Artifact bonus
to damage against helpless enemies — yet the dataset carried it under ~12
spellings, so a ``Damage to helpless enemies`` priority credited only the two
Solar Gem of Cruelty affixes and every set-tier source scored zero. Evidence and
per-channel census: docs/wiki-evidence/helpless-damage.md.

SEAM CHOICE. The existing global rename channel (``src/name_corrections.py``)
does not structurally fit: it walks ``affixes`` lists keyed by ``name`` on the
PLANNER records before variant expansion, while every fragmented occurrence
lives in ``stat``-keyed set-tier affixes produced later (``src/set_parser.py``
for item-attached ``parsed_set_bonuses`` AND ``membership_set_defs``) or in the
pre-typed augment-set seed. Its already-native guard would also need an
accommodation, for no reach in return. Instead this mirrors the dino channel's
precedent (``src/dino_parser.py`` U4/#293): a reviewed fold applied at each
channel's parse/build seam, with per-channel guards.

SCOPE. Deliberately NOT the full synonym registry: applying upstream's 94 folds
to the set channels would drag unrelated folds (Accuracy<-Attack, AC<-Shield,
PRR, ...) into channels that never had them — mass drift, not a fix. The fold
map here is exactly the helpless family: the ``local_affix_synonyms`` entries of
``data/seed/compendium/affix_synonyms_registry.json`` whose canonical is
``Damage to helpless enemies``. That registry section is the reviewed synonym
record; it also feeds ``vocabulary.registry_synonym_folds()``, which is how the
dino channel (``dino_sets``) folds and guards its own ``damage vs. the
helpless`` spelling without any code here.

NAMES ONLY. ``value``, ``bonus_type``, and ``unit`` are never touched — the
stored unit markers are inconsistent and recorded-not-normalized in the
evidence doc. ``raw`` fields everywhere stay verbatim wiki/planner text.
"""
from __future__ import annotations

from src import vocabulary

CANONICAL = "Damage to helpless enemies"

_FOLD_CACHE = None


def fold_map() -> dict:
    """``{fold_away_spelling: CANONICAL}`` — the helpless family only.

    Sourced from the registry's repo-reviewed ``local_affix_synonyms`` section,
    filtered to this canonical, so the reviewed record stays the single source.
    Raises when the registry no longer carries the family: an empty map would
    turn every fold site AND every guard below into a silent no-op at once.
    """
    global _FOLD_CACHE
    if _FOLD_CACHE is None:
        folds = {syn: canon
                 for syn, canon in vocabulary.registry_synonym_folds().items()
                 if canon == CANONICAL}
        if not folds:
            raise SystemExit(
                "helpless fold: the affix-synonym registry carries no "
                f"local fold to {CANONICAL!r} — the reviewed family was removed, "
                "so the fold and its guards would all no-op silently "
                "(docs/wiki-evidence/helpless-damage.md)")
        _FOLD_CACHE = folds
    return _FOLD_CACHE


def fold_stat(stat):
    """The canonical spelling for a set-tier ``stat`` (non-family names pass through)."""
    return fold_map().get(stat, stat)


def check_channel(label: str, stats) -> int:
    """Per-channel guard: no fold-away helpless spelling survives in ``stats``.

    ``stats`` is an iterable of the channel's emitted stat names, exactly as the
    dataset will carry them. Refuses to vouch for an empty channel — zero stats
    is a guard FAILURE, never a pass (per-channel, never vouched for by a
    sibling; docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md).
    ``raw`` text is deliberately not inspected: it is verbatim provenance and
    keeps the original spelling. Returns the number of stats inspected.
    """
    folds = fold_map()
    checked = 0
    bad = {}
    for s in stats:
        checked += 1
        if s in folds:
            bad[s] = bad.get(s, 0) + 1
    if checked == 0:
        raise SystemExit(
            f"helpless fold guard ({label}): zero stats inspected — an empty "
            "channel is a guard failure, not a pass")
    if bad:
        raise SystemExit(
            f"helpless fold guard ({label}): fold-away helpless spelling(s) "
            f"survived: {sorted(bad.items())} — the channel's fold seam did not "
            f"run or the family gained a spelling this channel never applied "
            "(docs/wiki-evidence/helpless-damage.md)")
    return checked
