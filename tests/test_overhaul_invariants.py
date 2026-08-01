"""U8 semantic invariant guards for the gear-planner native-schema overhaul.

Complements the behavioral golden guard (tests/solver_golden.test.js) with three
structural invariants asserted directly against the built web/data/items.json:

  1. NO legacy affix keys survive at rest — item affixes carry ONLY
     name/type/value (+ the eligible flag); stat/bonus_type/unit are gone.
  2. Ophael's Cincture carries its 6 base-ability +15 Enhancement affixes — the
     one sanctioned KTD4 gap-fill (gap_corrections overlay) is intact.
  3. The stacking-equivalence collapse is embedded (Insight Natural -> Insight,
     Primal Natural -> Primal) so the solver buckets equivalent types as one.
     (Behavioral proof of the collapse lives in solver.test.js U4b-i.)

Discovered + run by tests/run_tests.py.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

_LEGACY_AFFIX_KEYS = {"stat", "bonus_type", "unit", "minimum_level"}
_ALLOWED_AFFIX_KEYS = {"name", "type", "value", "eligible"}


def _load():
    with open(DATASET, "r", encoding="utf-8") as fh:
        return json.load(fh)


def test_no_legacy_affix_keys_at_rest():
    """Every item affix carries only native keys; no stat/bonus_type/unit."""
    data = _load()
    items = data["items"]
    assert len(items) == 9045, f"expected 9045 items, saw {len(items)}"
    offenders = []
    extra = set()
    for it in items:
        for a in it.get("affixes") or []:
            keys = set(a.keys())
            if keys & _LEGACY_AFFIX_KEYS:
                offenders.append((it.get("source_item"), sorted(keys)))
            extra |= keys - _ALLOWED_AFFIX_KEYS
    assert not offenders, f"{len(offenders)} item(s) still carry legacy affix keys: {offenders[:5]}"
    assert not extra, f"unexpected non-native affix keys at rest: {sorted(extra)}"


def test_ophaels_cincture_gap_fill_intact():
    """The KTD4 gap overlay restored Ophael's 6 base-ability +15 Enhancement affixes."""
    data = _load()
    oph = next((it for it in data["items"] if (it.get("source_item") or "") == "Ophael's Cincture"), None)
    assert oph is not None, "Ophael's Cincture must be present in the dataset"
    abilities = ["Strength", "Constitution", "Dexterity", "Intelligence", "Wisdom", "Charisma"]
    have = {(a.get("name"), a.get("type"), str(a.get("value"))) for a in oph.get("affixes") or []}
    for ab in abilities:
        assert (ab, "Enhancement", "15") in have, \
            f"Ophael's Cincture missing base-ability {ab} Enhancement +15 (gap-fill lost)"
    # Deception/Seeker (gear-planner native, NOT part of the overlay) still present.
    assert ("Seeker", "Enhancement", "15") in have, "native Seeker +15 must remain"
    assert ("Deception", "Enhancement", "12") in have, "native Deception +12 must remain"


def test_stacking_equivalence_collapse_embedded():
    """The dataset carries the curated stacking-equivalence map the solver installs."""
    data = _load()
    equiv = data["metadata"].get("stacking_equivalence") or {}
    assert equiv.get("Insight Natural") == "Insight", \
        "Insight Natural must bucket as Insight (stacking-equivalence collapse)"
    assert equiv.get("Primal Natural") == "Primal", \
        "Primal Natural must bucket as Primal (stacking-equivalence collapse)"
