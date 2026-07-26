"""U2 — augment-slot color normalization tests."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import colors  # noqa: E402


def test_canonical_color_passes_through():
    assert colors.normalize_color("Blue") == {"color": "Blue", "raw": "Blue", "reason": None}


def test_canonical_is_case_insensitive():
    assert colors.normalize_color("blue")["color"] == "Blue"


def test_moon_and_sun_are_distinct_canonical_colors():
    # Lunar/Solar are real, distinct slot colors — not aliases of Blue.
    assert colors.normalize_color("Moon")["color"] == "Moon"
    assert colors.normalize_color("Sun")["color"] == "Sun"
    assert colors.normalize_color("Moon")["color"] != "Blue"


def test_lamordia_normalizes_within_ravenloft_family():
    n = colors.normalize_color("Lamordia: Dolorous")
    assert n["color"] == "Lamordia: Dolorous"
    assert n["reason"] is None
    # a different type is a different (still valid) color
    assert colors.normalize_color("Lamordia: Woeful")["color"] == "Lamordia: Woeful"


def test_ambiguous_multicolor_is_quarantined_with_reason():
    n = colors.normalize_color("ideally Green + Blue")
    assert n["color"] is None
    assert n["reason"]  # a non-empty reason string


def test_unrecognized_color_is_quarantined():
    assert colors.normalize_color("Chartreuse")["color"] is None


def test_normalize_slots_splits_valid_and_quarantined():
    out = colors.normalize_slots(["Blue", "ideally Green + Blue", "Moon"])
    assert out["colors"] == ["Blue", "Moon"]
    assert len(out["quarantined"]) == 1
    assert out["quarantined"][0]["raw"] == "ideally Green + Blue"


def test_ambiguous_color_contributes_zero_capacity():
    # A quarantined color must not appear in the usable colors list (no phantom slot).
    out = colors.normalize_slots(["ideally Green + Blue"])
    assert out["colors"] == []


def test_annotate_variant_sets_host_and_augment_color():
    worn = {"category": "item", "slot": "Trinket", "augment_slots": ["Blue", "bogus/color"]}
    colors.annotate_variant(worn)
    assert worn["augment_slots_norm"]["colors"] == ["Blue"]
    assert len(worn["augment_slots_norm"]["quarantined"]) == 1

    aug = {"category": "augment", "slot": "Moon", "augment_slots": []}
    colors.annotate_variant(aug)
    assert aug["aug_color"]["color"] == "Moon"


# --- U2: augment color-compatibility matrix -----------------------------------

def test_secondary_slot_accepts_component_primaries():
    assert colors.accepts("Orange") == {"Red", "Yellow", "Orange", "Colorless"}
    assert colors.accepts("Green") == {"Blue", "Yellow", "Green", "Colorless"}
    assert colors.accepts("Purple") == {"Red", "Blue", "Purple", "Colorless"}


def test_primary_slot_accepts_own_plus_colorless():
    assert colors.accepts("Red") == {"Red", "Colorless"}
    assert colors.accepts("Colorless") == {"Colorless"}


def test_fits_multi_fit_and_negatives():
    assert colors.fits("Red", "Orange") and colors.fits("Red", "Purple")
    assert not colors.fits("Red", "Green")


def test_colorless_fits_colored_slots_only_not_lunar_solar():
    for s in ("Red", "Blue", "Yellow", "Orange", "Green", "Purple"):
        assert colors.fits("Colorless", s), s
    assert not colors.fits("Colorless", "Moon")
    assert not colors.fits("Colorless", "Sun")


def test_lunar_solar_do_not_cross_fit():
    assert colors.fits("Moon", "Moon") and colors.fits("Sun", "Sun")
    assert not colors.fits("Moon", "Sun")
    assert not colors.fits("Red", "Moon")


def test_fits_slots_is_the_inverse():
    assert colors.fits_slots("Red") == {"Red", "Purple", "Orange"}
    # Colorless fits every non-Lunar/Solar slot (its own Colorless slot + all colored), never Moon/Sun.
    assert colors.fits_slots("Colorless") == {"Colorless", "Red", "Blue", "Yellow", "Orange", "Green", "Purple"}
    assert "Moon" not in colors.fits_slots("Colorless") and "Sun" not in colors.fits_slots("Colorless")
    assert colors.fits_slots("Moon") == {"Moon"}
