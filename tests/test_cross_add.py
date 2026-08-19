"""U1 (#290/#291) — the `metadata.cross_add` table: stats whose bucket totals
ADD into a target stat's total across buckets (wiki fully-stacking universal
sources). This unit is data plumbing only — the map is built in
`src/cross_add.py`, emitted by `build_dataset.py`, and installed into
`web/model.js` by `web/dataset.js`; solver crediting is a later unit.

Evidence: docs/wiki-evidence/spellpower-universal.md §3 (Universal Spell
Power "Fully stacking. It flat adds to all of your other Spell Powers"),
docs/wiki-evidence/spell-lore.md §#290 (Universal Spell Lore is a "separate
and stacking source"), docs/wiki-evidence/universal-name-sweep.md.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402
from src import cross_add as cross_add_mod  # noqa: E402
from src import spell_focus as spell_focus_mod  # noqa: E402

_BUILT = None


def _meta():
    global _BUILT
    if _BUILT is None:
        _BUILT = build_dataset.build()
    return _BUILT["metadata"]


# A known-stat vocabulary sufficient for every entry the module can emit —
# used to exercise cross_add_map() directly without a full build.
_FULL_KNOWN = (list(spell_focus_mod.SPELLPOWERS) + list(cross_add_mod.LORE_ROSTER)
               + list(cross_add_mod.SPELLPOWER_SOURCES) + list(cross_add_mod.LORE_SOURCES))


def _expect_exit(fn, needle):
    """Assert fn() raises SystemExit whose message mentions `needle`."""
    try:
        fn()
    except SystemExit as e:
        assert needle in str(e), f"guard tripped but message lacks {needle!r}: {e}"
        return
    raise AssertionError(f"expected SystemExit mentioning {needle!r}, nothing raised")


# --- emitted shape ----------------------------------------------------------

def test_built_metadata_spellpower_cross_add():
    ca = _meta()["cross_add"]
    for sp in spell_focus_mod.SPELLPOWERS:
        assert ca.get(sp) == ["Universal Spell Power"], (sp, ca.get(sp))
    # exactly the ten spellpowers, no strays
    sp_targets = [t for t in ca if t in set(spell_focus_mod.SPELLPOWERS)]
    assert len(sp_targets) == 10, sp_targets


def test_built_metadata_lore_cross_add():
    ca = _meta()["cross_add"]
    emitted_lore = [t for t in ca if t in set(cross_add_mod.LORE_ROSTER)]
    # Every wiki-roster lore name exists in today's vocabulary, so all ten emit;
    # if the vocabulary ever drops one, cross_add_map must OMIT it (tested
    # below), and this equality is the deliberate signal to re-check the roster.
    assert sorted(emitted_lore) == sorted(cross_add_mod.LORE_ROSTER), emitted_lore
    for lore in emitted_lore:
        # #366 — `Spell Lore` was REMOVED from this family: it is a same-type
        # umbrella and now expands. Only the wiki-declared "separate and
        # stacking" source cross-adds.
        assert ca[lore] == ["Universal Spell Lore"], (lore, ca[lore])
    # nothing beyond the two families
    extras = [t for t in ca
              if t not in set(spell_focus_mod.SPELLPOWERS)
              and t not in set(cross_add_mod.LORE_ROSTER)]
    assert extras == [], extras


def test_cross_add_names_are_in_the_emitted_vocabulary():
    meta = _meta()
    known = set(meta["affix_registry"])
    for target, sources in meta["cross_add"].items():
        assert target in known, target
        for s in sources:
            assert s in known, (target, s)


def test_no_entry_is_both_cross_add_and_expanded_away():
    # The contract split: expansion reproduces a DON'T-stack rule, cross_add a
    # DOES-stack rule — a name in both would assert both at once.
    ca = _meta()["cross_add"]
    for name in list(ca) + [s for srcs in ca.values() for s in srcs]:
        assert not spell_focus_mod.is_universal(name), name


# --- vocabulary bounding ----------------------------------------------------

def test_lore_target_absent_from_vocabulary_is_omitted_not_emitted():
    known = [n for n in _FULL_KNOWN if n != "Healing Lore"]
    m = cross_add_mod.cross_add_map(known)
    assert "Healing Lore" not in m
    assert m.get("Fire Lore") == ["Universal Spell Lore"]
    assert m.get("Combustion") == ["Universal Spell Power"]


# --- guards, one test per channel (never aggregate) -------------------------

def test_guard_empty_map_fails():
    _expect_exit(lambda: cross_add_mod.validate_map({}, _FULL_KNOWN), "empty")


def test_guard_unknown_target_fails():
    m = {"No Such Stat": ["Universal Spell Power"]}
    _expect_exit(lambda: cross_add_mod.validate_map(m, _FULL_KNOWN), "No Such Stat")


def test_guard_unknown_source_fails():
    m = {"Combustion": ["No Such Source"]}
    _expect_exit(lambda: cross_add_mod.validate_map(m, _FULL_KNOWN), "No Such Source")


def test_guard_sourceless_target_fails():
    m = {"Combustion": []}
    _expect_exit(lambda: cross_add_mod.validate_map(m, _FULL_KNOWN), "Combustion")


def test_guard_expansion_overlap_fails():
    # `Potency` is a spell_focus._UNIVERSAL key (expanded away at build time) —
    # it must never appear in the cross_add map, as target or as source.
    m = {"Potency": ["Universal Spell Power"],
         "Combustion": ["Universal Spell Power"]}
    known = _FULL_KNOWN + ["Potency"]
    _expect_exit(lambda: cross_add_mod.validate_map(m, known), "Potency")
    m2 = {"Combustion": ["Potency"]}
    _expect_exit(lambda: cross_add_mod.validate_map(m2, known), "Potency")


# --- #374/KTD5: the refresh must not empty the target rosters ----------------
#
# `cross_add_map` bounds LORE_ROSTER to the dataset vocabulary, so a lore target
# the vocabulary has lost is dropped with NO error, while a lost spellpower
# target raises. Both halves are asserted by COUNT below: a presence-only test
# ("every emitted lore maps to Universal Spell Lore") passes happily on a map
# that emitted eight of ten.

def _refreshed_registry_file(with_local_names=True):
    """The vocab_registries.json U4's re-freeze produces: our canon names gone from
    `affix_names`, upstream's generic spellings in their place. The curated
    `local_affix_names` section is what puts ours back — dropped here when the
    scenario is "the refresh landed without KTD5"."""
    import json
    import tempfile
    from src import vocabulary as V
    table = V._load(V.VOCAB_REGISTRIES_PATH)
    flips = {c["source_name"]: c["canonical_name"]
             for c in V._load(V.AFFIX_NAME_CORRECTIONS_PATH)["corrections"]
             if c.get("canon_defense")}
    table["affix_names"] = sorted(
        (set(table["affix_names"]) - set(flips.values())) | set(flips))
    if not with_local_names:
        table.pop("local_affix_names")
    fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(table, fh)
    fh.close()
    return fh.name


def test_374_refreshed_registry_keeps_every_cross_add_target():
    registry, _ = build_dataset.load_affix_vocabulary(
        path=_refreshed_registry_file(with_local_names=True))
    m = cross_add_mod.cross_add_map(registry)          # must not SystemExit
    assert len([t for t in m if t in set(spell_focus_mod.SPELLPOWERS)]) == 10, m
    assert len([t for t in m if t in set(cross_add_mod.LORE_ROSTER)]) == 10, m


def test_374_without_minting_the_refresh_breaks_both_halves_differently():
    """The predicted failure, reproduced deliberately: the spellpower half raises,
    the lore half goes quiet. Two failure modes, one cause."""
    registry, _ = build_dataset.load_affix_vocabulary(
        path=_refreshed_registry_file(with_local_names=False))
    # loud half — eight of the ten spellpower targets have left the vocabulary
    _expect_exit(lambda: cross_add_mod.cross_add_map(registry), "Combustion")
    # silent half — the lore bounding simply omits, which is why the assertion
    # above this one counts instead of checking presence
    known = set(registry)
    assert len([l for l in cross_add_mod.LORE_ROSTER if l in known]) == 8


def test_374_built_metadata_cross_add_target_counts():
    """Standing count guard on the emitted map, so U4's data landing cannot quietly
    shrink either roster."""
    ca = _meta()["cross_add"]
    assert len([t for t in ca if t in set(spell_focus_mod.SPELLPOWERS)]) == 10
    assert len([t for t in ca if t in set(cross_add_mod.LORE_ROSTER)]) == 10
