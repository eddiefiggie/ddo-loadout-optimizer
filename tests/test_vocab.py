"""U2 — gear-planner structured-affix type reconciliation (KTD3 / KTD6)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import vocab  # noqa: E402


def test_mapped_types_resolve_to_canonical_bonus_type():
    for token, expected in [
        ("Enhancement", "Enhancement"), ("Competence", "Competence"),
        ("Deflection", "Deflection"), ("Vitality", "Vitality"),
        ("Armor", "Armor"), ("Implement", "Implement"), ("Luck", "Luck"),
    ]:
        assert vocab.map_gearplanner_type(token) == ("emit", expected)


def test_x_natural_maps_to_its_stacking_type():
    assert vocab.map_gearplanner_type("Primal Natural") == ("emit", "Primal")
    assert vocab.map_gearplanner_type("Insight Natural") == ("emit", "Insight")


def test_bool_routes_to_boolean_presence():
    assert vocab.map_gearplanner_type("Bool") == ("boolean", "boolean")


def test_null_type_quarantined_by_default():
    assert vocab.map_gearplanner_type(None, name="Holy") == ("quarantine", None)
    assert vocab.map_gearplanner_type(None, name="Vampirism") == ("quarantine", None)
    assert vocab.map_gearplanner_type("", name="Maiming") == ("quarantine", None)


def test_null_type_allowlist_promotes_verified_reals():
    # KTD6: the handful of genuinely-real typeless stats are emitted, not dropped.
    assert vocab.map_gearplanner_type(None, name="Magical Efficiency") == ("emit", "Enhancement")
    assert vocab.map_gearplanner_type(None, name="Wizardry") == ("emit", "Enhancement")


def test_unmapped_token_quarantined_not_guessed():
    for token in ("-", "Adamantine", "Epic", "SomethingNew"):
        assert vocab.map_gearplanner_type(token) == ("quarantine", None)


def test_phantom_tokens_are_not_in_the_map():
    # These were named in an early draft but do NOT occur in the dump; guard
    # against re-introducing an assumed (wrong) mapping.
    for phantom in ("Psionic", "Artifact Natural", "Profane Natural"):
        assert phantom not in vocab.GEARPLANNER_TYPE_MAP


def test_descriptor_types_emitted_but_marked_non_rankable():
    # Stored verbatim (so nothing is lost) but excluded from the rankable vocab.
    for t in ("Sneak Attack", "Bludgeoning", "Penalty", "Good", "Lawful"):
        disp, bt = vocab.map_gearplanner_type(t)
        assert disp == "emit" and bt == t
        assert t in vocab.NON_RANKABLE_TYPES
