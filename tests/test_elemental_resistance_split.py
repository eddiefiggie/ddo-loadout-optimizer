"""#191 — the Elemental Resistance expansion family.

`Elemental Resistance` names four elements on most carriers and five behind the
template's `4=` switch, so a player ranking a single element scored nothing from
any of the 58 carriers. `docs/wiki-evidence/elemental-resistance.md` is the
ruling; this asserts the machinery against it, mirroring the absorption family's
tests (the same trap, one compound over).

The structural difference under test: shard entries key their readings by bonus
TYPE, because two carriers bear two `Elemental Resistance` affixes with
different element sets (Enhancement 30 with Sonic beside Insight 10 without).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import elemental_resistance_split as er  # noqa: E402
from src import variants as variants_mod  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium",
                          "elemental_resistance.json")


def _rec(name, *affixes):
    return {"name": name, "url": f"/page/Item:{name.replace(' ', '_')}",
            "affixes": [dict(a) for a in affixes]}


def _affix(name, type_, value):
    return {"name": name, "type": type_, "value": str(value)}


def _reading(type_="Enhancement", value=45, sonic=False, raw=None, tooltip=None):
    if raw is None:
        if type_ == "Enhancement":
            raw = "{{Elemental Resistance|Elemental|%s%s}}" % (
                value, "|4=yes" if sonic else "")
        else:
            raw = "{{Elemental Resistance|Elemental|%s|%s}}" % (value, type_)
    if tooltip is None:
        if type_ == "Enhancement":
            elements = ("Acid, Cold, Electricity, Fire, and Sonic" if sonic
                        else "Acid, Cold, Electricity, and Fire")
            tooltip = (f"Elemental Resistance +{value}: Passive: +{value} "
                       f"Enhancement bonus to your {elements} Resistances.")
        else:
            tooltip = (f"Competence Elemental Resistance - {value}: This item "
                       f"provides a +{value} {type_} bonus to your Acid, Cold, "
                       f"Fire, and Electrical resistances.")
    return {"type": type_, "value": value, "sonic": sonic, "raw": raw,
            "tooltip": tooltip}


def _entry(*readings, provenance="stated"):
    return {"affixes": list(readings), "provenance": provenance,
            "harvested": "2026-08-13"}


def _shard(**entries):
    return {"harvested": entries}


def _names(rec):
    return [a["name"] for a in rec["affixes"]]


# --- Invocation parsing -------------------------------------------------------

def test_parse_reads_every_observed_invocation_form():
    assert er.parse_invocation("{{Elemental Resistance|Elemental|45|4=yes}}") == (45, "Enhancement", True)
    assert er.parse_invocation("{{Elemental Resistance|elemental|45|4=yes}}") == (45, "Enhancement", True)
    assert er.parse_invocation("{{Elemental Resistance|Elemental|30|4=y}}") == (30, "Enhancement", True)
    assert er.parse_invocation("{{Elemental Resistance|elemental|45|4=1}}") == (45, "Enhancement", True)
    assert er.parse_invocation("{{Elemental Resistance|Elemental|45}}") == (45, "Enhancement", False)
    assert er.parse_invocation("{{Elemental Resistance|Elemental|15|Competence}}") == (15, "Competence", False)
    assert er.parse_invocation("{{Elemental Resistance|elemental|10|insight}}") == (10, "Insight", False)


def test_an_unreadable_sonic_token_is_not_a_falsy_default():
    parsed = er.parse_invocation("{{Elemental Resistance|Elemental|45|4=maybe}}")
    assert parsed == (45, "Enhancement", None)
    assert er.invocation_key("{{Elemental Resistance|Elemental|45|4=maybe}}") is None


def test_a_single_element_invocation_does_not_parse_as_the_compound():
    # {{Elemental Resistance|Cold|51}} grants one element and is stored by
    # gear-planner under the per-element name already — never this module's job.
    assert er.parse_invocation("{{Elemental Resistance|Cold|51}}") is None


def test_snapshot_keys_normalize_magnitude_and_sonic_spelling():
    assert er.invocation_key("{{Elemental Resistance|Elemental|30|4=y}}") == \
        "{{elemental resistance|elemental|n|4=yes}}"
    assert er.invocation_key("{{Elemental Resistance|elemental|45|4=1}}") == \
        "{{elemental resistance|elemental|n|4=yes}}"
    assert er.invocation_key("{{Elemental Resistance|Elemental|30}}") == \
        "{{elemental resistance|elemental|n}}"
    assert er.invocation_key("{{Elemental Resistance|elemental|10|insight}}") == \
        "{{elemental resistance|elemental|n|insight}}"


# --- Tooltip dialects ---------------------------------------------------------

def test_the_modern_dialects_state_the_element_set():
    assert er.tooltip_reading(
        "Elemental Resistance +45: Passive: +45 Enhancement bonus to your "
        "Acid, Cold, Electricity, Fire, and Sonic Resistances.") == (True, "Enhancement", 45)
    assert er.tooltip_reading(
        "Elemental Resistance +30: Passive: +30 Enhancement bonus to your "
        "Acid, Cold, Electricity, and Fire Resistances.") == (False, "Enhancement", 30)


def test_the_legacy_dialect_states_type_and_never_sonic():
    assert er.tooltip_reading(
        "Competence Elemental Resistance - 10: This item provides a +10 Insight "
        "bonus to your Acid, Cold, Fire, and Electrical resistances.") == (False, "Insight", 10)
    assert er.tooltip_reading(
        "Competence Elemental Resistance - 15: This item provides a +15 Competence "
        "bonus to your Acid, Cold, Fire, and Electrical resistances.") == (False, "Competence", 15)


def test_an_unknown_dialect_verifies_nothing():
    assert er.tooltip_reading("Elemental Resistance +45: something else") is None


# --- Expansion ----------------------------------------------------------------

def test_a_sonic_carrier_expands_to_five_at_full_magnitude():
    rec = _rec("Dumathoin's Bracers", _affix("Elemental Resistance", "Enhancement", 45))
    shard = _shard(**{"Dumathoin's Bracers": _entry(_reading(sonic=True))})
    stats = er.apply([rec], shard)
    assert sorted(_names(rec)) == sorted(er.WITH_SONIC)
    assert all(a["value"] == "45" and a["type"] == "Enhancement"
               for a in rec["affixes"])
    assert stats["expanded"] == 1 and stats["components"] == 5


def test_a_non_sonic_carrier_expands_to_four():
    rec = _rec("Draconic Soul Gem", _affix("Elemental Resistance", "Enhancement", 30))
    shard = _shard(**{"Draconic Soul Gem": _entry(_reading(value=30))})
    er.apply([rec], shard)
    assert sorted(_names(rec)) == sorted(er.WITHOUT_SONIC)


def test_two_affixes_on_one_carrier_join_by_bonus_type():
    # The Epic Chain of Conviction shape: Enhancement 30 WITH Sonic beside
    # Insight 10 without. A per-item flag cannot represent this; the per-type
    # join must give each affix its own element set.
    rec = _rec("Epic Chain of Conviction",
               _affix("Elemental Resistance", "Enhancement", 30),
               _affix("Elemental Resistance", "Insight", 10))
    shard = _shard(**{"Epic Chain of Conviction": _entry(
        _reading(type_="Enhancement", value=30, sonic=True),
        _reading(type_="Insight", value=10, sonic=False))})
    stats = er.apply([rec], shard)
    enh = [a for a in rec["affixes"] if a["type"] == "Enhancement"]
    ins = [a for a in rec["affixes"] if a["type"] == "Insight"]
    assert sorted(a["name"] for a in enh) == sorted(er.WITH_SONIC)
    assert sorted(a["name"] for a in ins) == sorted(er.WITHOUT_SONIC)
    assert stats["components"] == 9


def test_expansion_stamps_the_originating_compound_name():
    rec = _rec("Resonation", _affix("Elemental Resistance", "Competence", 15))
    shard = _shard(**{"Resonation": _entry(_reading(type_="Competence", value=15))})
    er.apply([rec], shard)
    from src.spell_focus import PROVENANCE_KEY
    assert all(a[PROVENANCE_KEY] == "Elemental Resistance" for a in rec["affixes"])


def test_a_non_compound_affix_passes_through_untouched():
    rec = _rec("Resonation", _affix("Sheltering", "Enhancement", 20),
               _affix("Elemental Resistance", "Competence", 15))
    shard = _shard(**{"Resonation": _entry(_reading(type_="Competence", value=15))})
    er.apply([rec], shard)
    assert "Sheltering" in _names(rec)


# --- Quarantine ---------------------------------------------------------------

def test_an_absent_carrier_is_removed_and_counted_not_left_in_place():
    rec = _rec("Future Item", _affix("Elemental Resistance", "Enhancement", 45))
    stats = er.apply([rec], _shard())
    assert _names(rec) == []
    assert stats["quarantined"] == 1 and stats["quarantined_absent"] == 1
    assert rec[er.QUARANTINE_FIELD][0]["stat"] == "Elemental Resistance"


def test_a_non_stated_entry_is_quarantined_as_unconfirmed():
    rec = _rec("Future Item", _affix("Elemental Resistance", "Enhancement", 45))
    shard = _shard(**{"Future Item": _entry(_reading(), provenance="unsourced")})
    stats = er.apply([rec], shard)
    assert _names(rec) == []
    assert stats["quarantined_unconfirmed"] == 1


def test_a_reading_for_a_different_bonus_type_does_not_cover_this_affix():
    rec = _rec("Future Item", _affix("Elemental Resistance", "Insight", 10))
    shard = _shard(**{"Future Item": _entry(_reading(type_="Enhancement"))})
    stats = er.apply([rec], shard)
    assert _names(rec) == []
    assert stats["quarantined_absent"] == 1


def test_quarantine_appends_to_an_existing_marker_not_overwrites():
    # The field is shared with the absorption family; a record both families
    # quarantine must keep both disclosures.
    rec = _rec("Future Item", _affix("Elemental Resistance", "Enhancement", 45))
    rec[er.QUARANTINE_FIELD] = [{"stat": "Elemental Absorption",
                                 "reason": "absent", "components": []}]
    er.apply([rec], _shard())
    stats = [d["stat"] for d in rec[er.QUARANTINE_FIELD]]
    assert stats == ["Elemental Absorption", "Elemental Resistance"]


def test_the_quarantine_marker_survives_the_variant_rebuild():
    rec = _rec("Future Item", _affix("Elemental Resistance", "Enhancement", 45))
    er.apply([rec], _shard())
    rec.update({"slot": "Trinket", "category": "named", "minimum_level": 30})
    variant = variants_mod.expand_item(rec)[0]
    assert variant[er.QUARANTINE_FIELD] == rec[er.QUARANTINE_FIELD]


# --- The registered removal ---------------------------------------------------

def test_the_compound_is_expanded_away_to_the_union_of_five():
    assert er.EXPANDED_AWAY == {
        "elemental resistance": list(er.WITH_SONIC)}


def test_the_predicate_is_case_insensitive_and_rejects_components():
    assert er.is_compound("elemental resistance")
    assert er.is_compound("Elemental Resistance")
    assert not er.is_compound("Fire Resistance")
    assert not er.is_compound("Elemental Absorption")


# --- The guard ----------------------------------------------------------------

def _guardable(**overrides):
    reading = _reading(sonic=True)
    reading.update(overrides)
    shard = _shard(**{"Dumathoin's Bracers": _entry(reading)})
    shard["snapshots"] = {
        "{{elemental resistance|elemental|n|4=yes}}": {
            "tooltip": _reading(sonic=True)["tooltip"]},
        "{{elemental resistance|elemental|n}}": {
            "tooltip": _reading(sonic=False)["tooltip"]},
    }
    return shard


def test_the_guard_passes_a_consistent_entry():
    report = er.check_against_snapshots(_guardable())
    assert report["problems"] == []
    assert report["compared"] == 1 and report["independent"] == 1


def test_the_guard_catches_a_flag_disagreeing_with_its_own_invocation():
    shard = _guardable(sonic=False)  # raw + tooltip still say Sonic
    report = er.check_against_snapshots(shard)
    assert any("disagrees with its own invocation" in p for p in report["problems"])


def test_the_guard_catches_a_value_and_its_invocation_wrong_together():
    # The harvester read the wrong row: raw AND recorded flag agree, but the
    # item's own tooltip contradicts them. Only the per-item witness sees it.
    wrong = _reading(sonic=False, value=45)
    wrong["tooltip"] = _reading(sonic=True, value=45)["tooltip"]
    shard = _shard(**{"Dumathoin's Bracers": _entry(wrong)})
    shard["snapshots"] = {
        "{{elemental resistance|elemental|n}}": {
            "tooltip": _reading(sonic=False)["tooltip"]},
    }
    report = er.check_against_snapshots(shard)
    assert any("wrong together" in p for p in report["problems"])


def test_a_stated_reading_without_its_own_tooltip_fails():
    reading = _reading(sonic=True)
    del reading["tooltip"]
    shard = _shard(**{"Dumathoin's Bracers": _entry(reading)})
    shard["snapshots"] = {
        "{{elemental resistance|elemental|n|4=yes}}": {
            "tooltip": _reading(sonic=True)["tooltip"]},
    }
    report = er.check_against_snapshots(shard)
    assert any("no per-item tooltip" in p for p in report["problems"])


def test_the_guard_catches_a_wrong_magnitude():
    shard = _guardable(value=44)  # raw/tooltip render 45
    report = er.check_against_snapshots(shard)
    assert any("disagrees with its own invocation" in p or
               "tooltip states" in p for p in report["problems"])


def test_the_guard_refuses_an_empty_shard():
    try:
        er.check_against_snapshots({"harvested": {}})
    except ValueError:
        return
    raise AssertionError("empty shard must raise")


def test_the_guard_rejects_an_unknown_provenance():
    shard = _load_shard()
    shard["harvested"]["Dumathoin's Bracers"]["provenance"] = "stated?"
    report = er.check_against_snapshots(shard)
    assert any("unknown provenance" in p for p in report["problems"])


def test_the_guard_rejects_an_unparsable_invocation():
    shard = _load_shard()
    shard["harvested"]["Dumathoin's Bracers"]["affixes"][0]["raw"] = \
        "{{Resist Energy|Fire|45}}"
    report = er.check_against_snapshots(shard)
    assert any("not a parsable" in p for p in report["problems"])


def test_the_guard_refuses_to_pass_having_compared_nothing():
    shard = _load_shard()
    for entry in shard["harvested"].values():
        entry["provenance"] = "defaulted"
    try:
        er.check_against_snapshots(shard)
    except ValueError as exc:
        assert "compared" in str(exc)
        return
    raise AssertionError("a guard that compared nothing must refuse to pass")


def test_the_guard_rejects_two_readings_sharing_a_bonus_type():
    # apply()'s per-type join is first-match-wins, so a duplicate type would
    # silently shadow its sibling while every per-reading witness stays
    # self-consistent — the one wrong-shard shape the three witnesses miss.
    shard = _guardable()
    shard["harvested"]["Dumathoin's Bracers"]["affixes"].append(
        _reading(sonic=False, value=30,
                 raw="{{Elemental Resistance|Elemental|30}}",
                 tooltip=_reading(sonic=False, value=30)["tooltip"]))
    report = er.check_against_snapshots(shard)
    assert any("share bonus type" in p for p in report["problems"])


# --- The real shard and the built dataset -------------------------------------

def _load_shard():
    with open(SHARD_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def test_the_real_shard_passes_its_own_guard():
    report = er.check_against_snapshots(_load_shard())
    assert report["problems"] == []
    assert report["compared"] == 60 and report["independent"] == 60


def test_the_real_shard_is_fully_snapshotted():
    report = er.audit_snapshots(_load_shard())
    assert report["missing"] == 0 and report["unparsable"] == []
    assert report["invocations"] == 4


def test_the_built_dataset_has_no_surviving_compound_name():
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    survivors = [it.get("variant_id") for it in data["items"]
                 for a in it.get("affixes") or []
                 if er.is_compound(a.get("name"))]
    assert survivors == []


def test_the_built_dataset_credits_dumathoins_sonic_and_the_gem_without():
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    by_name = {}
    for it in data["items"]:
        by_name.setdefault(it.get("source_item") or it.get("variant_id"), it)
    dum = by_name["Dumathoin's Bracers"]
    names = {a["name"] for a in dum["affixes"]}
    assert set(er.WITH_SONIC) <= names
    gem = by_name["Draconic Soul Gem"]
    gem_names = {a["name"] for a in gem["affixes"]}
    assert set(er.WITHOUT_SONIC) <= gem_names
    assert "Sonic Resistance" not in gem_names


def test_the_only_quarantined_carriers_are_the_six_upstream_retyped():
    """Was `test_today_no_carrier_is_quarantined`, and it caught a real one.

    #374/U4 — the 2026-08-18 gear-planner refresh RE-TYPED `Elemental Resistance`
    from `Insight` to `Competence` on six carriers. This shard keys its readings by
    bonus TYPE (two carriers bear two `Elemental Resistance` affixes with different
    element sets, so a per-item flag cannot represent them), so the `Insight`
    reading no longer joins and the affix is quarantined — REMOVED and disclosed,
    which is the module's designed fail-safe, not a pipeline defect. The visible
    effect is real and solver-facing: those six items no longer contribute their
    four resistance components.

    NOT re-keyed to `Competence` here, deliberately. The shard's own recorded
    evidence is ambiguous on exactly this point — the harvested tooltip reads
    "Competence Elemental Resistance - 10: This item provides a +10 **Insight**
    bonus to your Acid, Cold, Fire, and Electrical resistances" — so the wiki does
    not state the type outright and "never infer a value" applies. Adopting
    upstream's new type, or pinning the old one, would both be guesses. It needs a
    wiki re-read and a ruling.

    So the quarantine is pinned as a DISCLOSED, NAMED and TEMPORARY state, exactly
    two-directional: a seventh quarantined carrier fails, and so does one of these
    six being silently un-quarantined without the ruling landing.
    """
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    cov = data["metadata"]["elemental_resistance_coverage"]
    _RETYPED = ["Barnacled Buckler", "Epic Chain of Conviction",
                "Epic Death's Rampart", "Jeweled Cloak (level 23)",
                "Jeweled Cloak (level 24)", "Jeweled Cloak (level 25)"]
    assert cov["augments"]["quarantined"] == 0, "the augment channel is unaffected"
    assert cov["quarantined"] == 6, cov["quarantined"]
    # every one is the SAME cause — an absent per-type reading, not an unconfirmed
    # or unreadable one, which would be a different defect entirely
    assert cov["quarantined_absent"] == 6 and cov["quarantined_unconfirmed"] == 0
    assert sorted(e["item"] for e in cov["excluded"]) == sorted(_RETYPED), \
        cov["excluded"]
    # ...and the shard still HAS an entry for each: the join broke on the type,
    # not on the item, which is what makes this a ruling and not a harvest gap.
    with open(SHARD_PATH, "r", encoding="utf-8") as fh:
        harvested = json.load(fh)["harvested"]
    for item in _RETYPED:
        assert item in harvested, item
        assert any(a.get("type") == "Insight" for a in harvested[item]["affixes"]), item

    # 54 readings across both channels: 53 item-channel affixes + 1 augment.
    # Re-ratified 60 -> 54 and 246 -> 222: exactly the six quarantined readings and
    # their 6 x 4 = 24 components (all six are `sonic: false`, so four each).
    assert cov["expanded"] + cov["augments"]["expanded"] == 54
    assert cov["components"] + cov["augments"]["components"] == 222
    assert cov["expanded"] + cov["quarantined"] == 59, \
        "expanded + quarantined must still account for every item-channel reading"


def test_the_compound_is_registered_as_expanded_away_in_the_dataset():
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    ea = data["metadata"]["expanded_away_names"]
    assert ea.get("elemental resistance") == list(er.WITH_SONIC)


def test_no_set_bonus_tier_names_the_compound():
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    hits = []
    for name, entry in (data.get("set_bonuses") or {}).items():
        for tier in entry.get("tiers") or []:
            for a in tier.get("affixes") or []:
                if er.is_compound(a.get("name")):
                    hits.append(name)
    assert hits == []


if __name__ == "__main__":
    failures = 0
    for key, fn in sorted(globals().items()):
        if key.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS {key}")
            except AssertionError as exc:
                failures += 1
                print(f"  FAIL {key}: {exc}")
    raise SystemExit(1 if failures else 0)
