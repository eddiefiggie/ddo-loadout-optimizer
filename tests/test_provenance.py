"""U10 (R13) — the provenance-label set the build emits for the picker vocabulary.

Every expansion family stamps the ORIGINATING enchantment name onto each affix it
emits (`src/spell_focus.py` PROVENANCE_KEY). The item surfaces display that name,
so the picker has to be able to rank it — which means the build must tell the web
layer which names exist and what stats each one becomes.

The set is DERIVED BY SCANNING the built dataset, never declared from a family
list. A hardcoded list silently omits the next expansion family that lands; a scan
picks it up the moment it stamps its first affix. These tests pin that property
directly: the emitted set must equal a fresh independent scan of the same build.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402
from src import provenance as provenance_mod  # noqa: E402
from src import spell_focus as spell_focus_mod  # noqa: E402
from src.affix_parser import BONUS_TYPES  # noqa: E402

_KEY = spell_focus_mod.PROVENANCE_KEY

_BUILT = None


def _build():
    global _BUILT
    if _BUILT is None:
        _BUILT = build_dataset.build()
    return _BUILT


def _independent_scan(variants):
    """A deliberately naive re-implementation: {label: set(stats)} over both
    affix channels. Written differently from `src/provenance.py` on purpose — a
    scan that shares the module's code would only prove the module equals itself."""
    out = {}
    for v in variants:
        for a in v.get("affixes") or []:
            if a.get(_KEY) is not None:
                out.setdefault(a[_KEY], set()).add(a.get("stat"))
        for tier in v.get("parsed_set_bonuses") or []:
            for a in tier.get("affixes") or []:
                if a.get(_KEY) is not None:
                    out.setdefault(a[_KEY], set()).add(a.get("stat"))
    return out


def test_metadata_emits_provenance_labels():
    meta = _build()["metadata"]
    labels = meta.get("provenance_labels")
    assert isinstance(labels, dict), type(labels)
    # Refuse to inspect zero records: an empty emission would pass every
    # assertion below while proving nothing.
    assert len(labels) >= 10, f"only {len(labels)} labels emitted"
    for name, stats in labels.items():
        assert isinstance(name, str) and name.strip(), repr(name)
        assert isinstance(stats, list) and stats, f"{name} -> {stats!r}"
        assert all(isinstance(s, str) and s.strip() for s in stats), f"{name} -> {stats!r}"
        assert len(set(stats)) == len(stats), f"{name} repeats a stat: {stats!r}"


def test_emitted_set_equals_an_independent_scan_of_the_same_build():
    """The generic-derivation guarantee. If this is ever satisfied by a hardcoded
    family list, adding an eighth family breaks it — which is the point."""
    built = _build()
    emitted = built["metadata"]["provenance_labels"]
    scanned = _independent_scan(built["items"])
    assert scanned, "the build stamped no provenance at all — the scan proves nothing"
    assert set(emitted) == set(scanned), (
        f"emitted-only: {sorted(set(emitted) - set(scanned))}; "
        f"scanned-only: {sorted(set(scanned) - set(emitted))}")
    for label, stats in emitted.items():
        assert set(stats) == scanned[label], f"{label}: {sorted(stats)} != {sorted(scanned[label])}"


def test_a_label_maps_to_its_stats_in_the_families_declared_order():
    labels = _build()["metadata"]["provenance_labels"]
    # spell focus: the seven schools, in the wiki order src/spell_focus.py declares.
    assert labels["Sacred Spell Focus Mastery"] == list(spell_focus_mod.SCHOOLS)
    assert labels["Spell Focus Mastery"] == list(spell_focus_mod.SCHOOLS)
    # Parrying's declared order comes from its own module, not from this one.
    from src import parrying_split as parrying_mod
    assert labels["Parrying"] == list(parrying_mod.EXPANDED_AWAY["parrying"])


def test_no_emitted_label_is_a_bare_bonus_type_token():
    """The `Resistance` incident (docs/solutions/logic-errors/
    bonus-type-vocabulary-collides-with-bare-stat.md): a vocabulary entry that is
    also a bonus-type word collides. A label is a full enchantment name, so a
    bare-type label would mean a family emitted a prefix with no base name.

    Re-ratified for #211: bare `Resistance` IS a full enchantment name — the
    classic all-saves item bonus (the incident doc itself rules "the bare-stat
    reading is the real one") — and it is now a registered universal family, so
    its label is a deliberate registration, not the accidental prefix-only
    emission this guard exists to catch. The exemption is exactly the
    registered-family key set; any OTHER bare-type label still fails.
    Browser-side type-peeling does not exist, and the Python parser's
    `len(words) > 1` guard (the incident's fix) keeps the parse safe."""
    labels = _build()["metadata"]["provenance_labels"]
    # Pinned to the ONE proven name, not the growing family table (the
    # close-a-defect-at-the-narrow-control rule): a future family whose key
    # happened to equal a bonus-type word must argue its own exemption here,
    # with evidence, rather than inherit this one silently.
    exempt = {"Resistance"}
    collisions = sorted(n for n in labels
                        if n in BONUS_TYPES and n not in exempt)
    assert not collisions, f"labels that are bare bonus-type tokens: {collisions}"


def test_no_emitted_label_shadows_a_stat_the_build_still_carries():
    """A label the picker will alias must not be a stat real affixes still supply.
    Aliasing such a name would substitute it away and destroy the stat — the same
    shape as the `Resistance` regression, one layer up."""
    built = _build()
    labels = set(built["metadata"]["provenance_labels"])
    native = set()
    for v in built["items"]:
        for a in v.get("affixes") or []:
            if a.get(_KEY) is None and a.get("stat"):
                native.add(a["stat"])
    overlap = sorted(labels & native)
    assert not overlap, (
        "these provenance labels are ALSO carried natively by an item affix, so "
        f"treating them as aliases would destroy a live stat: {overlap}")


def test_scanner_keeps_the_longest_emission_when_a_group_is_partial():
    """An expansion may skip a component the item already states explicitly, so a
    single item can emit a SHORT group. Order must come from a complete emission,
    not from whichever item happened to be scanned first."""
    variants = [
        {"affixes": [{"stat": "Magical Sheltering", _KEY: "Sheltering"}]},
        {"affixes": [{"stat": "Physical Sheltering", _KEY: "Sheltering"},
                     {"stat": "Magical Sheltering", _KEY: "Sheltering"}]},
    ]
    got = provenance_mod.label_expansions(variants)
    assert got == {"Sheltering": ["Physical Sheltering", "Magical Sheltering"]}, got


def test_scanner_reads_both_affix_channels():
    """`Parrying` shipped a set bonus granting an expanded-away stat because one
    channel was missed (see prove-a-guard-fails-before-trusting-it.md). A scanner
    that reads only item affixes repeats it."""
    variants = [{"affixes": [],
                 "parsed_set_bonuses": [{"affixes": [{"stat": "Will Save", _KEY: "Parrying"}]}]}]
    assert provenance_mod.label_expansions(variants) == {"Parrying": ["Will Save"]}


def test_scanner_ignores_a_native_affix():
    """Absence of the key IS the expanded/native discriminator."""
    variants = [{"affixes": [{"stat": "Constitution"}, {"stat": "Dodge", _KEY: None}]}]
    assert provenance_mod.label_expansions(variants) == {}
