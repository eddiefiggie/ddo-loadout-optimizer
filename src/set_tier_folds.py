"""#695 — the REPO-REVIEWED local folds, applied at the set-tier parse seam.

Generalises `src/helpless_fold.py` from one hard-coded family to every family in
the registry's `local_affix_synonyms` section, which is the section this repo
curates and reviews itself.

SCOPE — read this before widening it further. `vocabulary.registry_synonym_folds()`
is NOT what this applies. That function merges upstream's `affix_synonyms` table
(134 spellings: `Accuracy` <- Attack, `Armor Class` <- Shield, PRR, ...) with the
local section, and applying upstream's half to the set channels is the mass drift
`src/helpless_fold.py`'s own SCOPE note declined. This module reads
`_local_synonym_folds` ONLY — 13 spellings across 3 canonicals today.

That distinction is easy to get wrong: a note on #683 described widening this seam
"to every `local_affix_synonyms` family" while pointing at `registry_synonym_folds`,
which would have shipped exactly the drift the note believed it was avoiding.

WHY HERE and not `affix_name_corrections.json`. The sets channel round-trips
through synthesized TEXT: `catalog_from_raw` rebuilds a tier's text from its raw
affixes and `set_parser` re-parses it. A rename there is therefore laundered
through the parser — a `(%)`-suffixed canonical comes back as the *different* name
`X` with `unit="pct"`, so the declared canonical is not what the tier ends up
carrying, and the paired alias then resolves a typed name to a string no tier has.
Measured on #695. This seam sets `stat` directly and never touches the text.

NAMES ONLY. `value`, `bonus_type` and `unit` are untouched, and tier `raw` stays
verbatim wiki/planner text — the same contract `helpless_fold` holds.
"""
from __future__ import annotations

from src import vocabulary

#: The canonicals this seam applies. An ALLOW-LIST, not "every local family".
#:
#: `Well Rounded` is a reviewed local family and is deliberately ABSENT. Folding
#: `all Ability Scores` here changes what `parse_piece_text` returns — a behaviour
#: `tests/test_set_parser.py` pins — while making no difference to the built
#: dataset, because a later pass already canonicalises and expands it. Taking
#: behaviour off a pinned seam for no dataset-level gain is not a trade worth
#: making, so this seam stays scoped to the families that need it HERE.
#:
#: Adding a canonical is therefore a deliberate act: it must be a family whose
#: fold must happen at PARSE time, before the tier's stat reaches a bucket.
SET_TIER_CANONICALS = frozenset({
    "Damage to helpless enemies",   # #305
    "Maximum Spell Points (%)",     # #695
})

_FOLD_CACHE = None


def fold_map() -> dict:
    """`{fold_away_spelling: canonical}` — the local section only.

    Raises when the section is empty: an empty map would turn the fold site AND
    every guard below into a silent no-op at once, which is the failure mode
    `helpless_fold.fold_map` documents for its own family.
    """
    global _FOLD_CACHE
    if _FOLD_CACHE is None:
        table = vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH)
        folds = {syn: canon
                 for syn, canon in vocabulary._local_synonym_folds(table).items()
                 if canon in SET_TIER_CANONICALS}
        if not folds:
            raise SystemExit(
                "set-tier folds: the affix-synonym registry carries no "
                "local_affix_synonyms fold for any canonical in "
                "SET_TIER_CANONICALS — the reviewed families were renamed or "
                "removed, so every fold site and guard would no-op silently")
        _FOLD_CACHE = dict(folds)
    return _FOLD_CACHE


def fold_stat(stat):
    """The canonical spelling for a set-tier `stat` (non-family names pass through)."""
    return fold_map().get(stat, stat)


def check_channel(label: str, stats) -> int:
    """Per-channel guard: no fold-away spelling survives in `stats`.

    Refuses to vouch for an empty channel — zero stats inspected is a FAILURE,
    never a pass, and never vouched for by a sibling channel
    (docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md).
    `raw` is deliberately not inspected: it is verbatim provenance and keeps the
    original spelling on purpose.
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
            f"set-tier fold guard ({label}): zero stats inspected — an empty "
            "channel is a guard failure, not a pass")
    if bad:
        raise SystemExit(
            f"set-tier fold guard ({label}): fold-away spelling(s) survived: "
            f"{sorted(bad.items())} — the channel's fold seam did not run, or a "
            "reviewed family gained a spelling this channel never applied")
    return checked
