"""U5/U6 (#249) — the compound-absorption expansion family.

Three stat names in the dataset name several elements at once, so a player
ranking a single element scored nothing from them. `docs/wiki-evidence/
compound-absorption.md` is the ruling; this asserts the machinery against it.

Two halves:
  * U5 — expansion. Each compound becomes its component elements at the
    compound's FULL magnitude (the wiki's own categorization emits both
    `+N%` category memberships from one invocation), preserving bonus type
    and stamping the originating compound name.
  * U6 — quarantine. A carrier the shard does not confirm has its compound
    affix REMOVED and counted, never left in place: registering the family
    strips the compound name from the picker dataset-wide, so an unexpanded
    carrier would ship an affix no player can rank.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import absorption_split  # noqa: E402
from src import enchantment_split  # noqa: E402
from src import variants as variants_mod  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "elemental_absorption.json")

FIRE = absorption_split.FIRE
COLD = absorption_split.COLD
ELECTRIC = absorption_split.ELECTRIC
ACID = absorption_split.ACID
SONIC = absorption_split.SONIC


def _rec(name, *affixes):
    return {"name": name, "url": f"/page/Item:{name.replace(' ', '_')}",
            "affixes": [dict(a) for a in affixes]}


def _affix(name, type_, value):
    return {"name": name, "type": type_, "value": str(value)}


def _entry(sonic, provenance="stated", raw=None, magnitude=5):
    value = {} if sonic is None else {"sonic": sonic}
    return {"value": value, "provenance": provenance,
            "raw": raw if raw is not None else (
                "{{Absorption|Elemental|%s%s}}" % (magnitude, "|yes" if sonic else ""))}


def _shard(**entries):
    return {"harvested": entries}


def _by_name(rec):
    out = {}
    for a in rec["affixes"]:
        out.setdefault(a["name"], []).append(a)
    return out


def _real_shard():
    with open(SHARD_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _load_dataset():
    with open(DATASET, "r", encoding="utf-8") as fh:
        return json.load(fh)


# --- R4: components at the compound's FULL magnitude, not a split --------------

def test_ranking_fire_absorption_credits_the_compound_at_full_magnitude():
    """The reported bug. Crown of Ioun's `Fire and Cold Absorption +22%` contributed
    nothing to a Fire Absorption priority; now it contributes the full 22, not 11."""
    rec = _rec("Crown of Ioun", _affix(absorption_split.FIRE_AND_COLD, "Enhancement", 22))
    absorption_split.apply([rec], _shard())

    by = _by_name(rec)
    assert absorption_split.FIRE_AND_COLD not in by, "the compound name is gone"
    assert [a["value"] for a in by[FIRE]] == ["22"], (
        "the fire component carries the compound's FULL magnitude — the wiki emits a "
        "`Fire Absorption +22%` category membership from the one invocation, so "
        "halving it would under-credit every carrier")


def test_cold_component_is_credited_independently_from_the_same_record():
    """One record grants both. Ranking cold must not compete with ranking fire."""
    rec = _rec("Crown of Ioun", _affix(absorption_split.FIRE_AND_COLD, "Enhancement", 22))
    absorption_split.apply([rec], _shard())

    by = _by_name(rec)
    assert [a["value"] for a in by[COLD]] == ["22"]
    assert [a["value"] for a in by[FIRE]] == ["22"]


def test_electricity_and_acid_expands_to_electric_and_acid():
    """The dataset's component stat is `Electric Absorption`, NOT "Electricity" —
    expanding to the compound's own spelling would target a name no item carries."""
    rec = _rec("Legendary Crown of Ioun",
               _affix(absorption_split.ELECTRICITY_AND_ACID, "Enhancement", 40))
    absorption_split.apply([rec], _shard())

    by = _by_name(rec)
    assert sorted(by) == sorted([ACID, ELECTRIC]), by
    assert [a["value"] for a in by[ELECTRIC]] == ["40"]
    assert [a["value"] for a in by[ACID]] == ["40"]


# --- R5: expansion preserves bonus type ---------------------------------------

def test_expansion_preserves_bonus_type():
    """Both compounds take Insight, Quality and Artifact variants on the wiki even
    though only Enhancement carriers exist today. A hardcoded Enhancement would
    silently retype the first Insight carrier that ships and collapse it into the
    wrong stacking bucket."""
    rec = _rec("Hypothetical Insight Helm",
               _affix(absorption_split.FIRE_AND_COLD, "Insight", 12))
    absorption_split.apply([rec], _shard())

    by = _by_name(rec)
    assert {a["type"] for a in by[FIRE]} == {"Insight"}
    assert {a["type"] for a in by[COLD]} == {"Insight"}


def test_a_non_compound_affix_passes_through_untouched():
    rec = _rec("Archaic Device", _affix("Fire Absorption", "Enhancement", 30))
    stats = absorption_split.apply([rec], _shard())

    assert rec["affixes"] == [_affix("Fire Absorption", "Enhancement", 30)]
    assert stats["expanded"] == 0
    assert stats["carriers"] == 0


# --- R6: `Elemental Absorption` expands per item, off the Sonic flag ----------

def test_a_sonic_carrier_expands_to_five_components():
    rec = _rec("Cyran Guard (level 28)",
               _affix(absorption_split.ELEMENTAL, "Enhancement", 20))
    absorption_split.apply(
        [rec], _shard(**{"Cyran Guard (level 28)": _entry(True, magnitude=20)}))

    by = _by_name(rec)
    assert sorted(by) == sorted([ACID, COLD, FIRE, ELECTRIC, SONIC]), by
    assert all(a["value"] == "20" for group in by.values() for a in group)


def test_a_non_sonic_carrier_expands_to_four_components():
    """The same stat name on a different item covers one element fewer. A blanket
    five-way expansion would over-credit Sonic on eight of the thirteen records."""
    rec = _rec("Archaic Device", _affix(absorption_split.ELEMENTAL, "Enhancement", 5))
    absorption_split.apply([rec], _shard(**{"Archaic Device": _entry(False)}))

    by = _by_name(rec)
    assert sorted(by) == sorted([ACID, COLD, FIRE, ELECTRIC]), by
    assert SONIC not in by, "a four-element carrier must not grant Sonic"


# --- R12: the originating compound name is stamped at birth -------------------

def test_an_expanded_component_carries_the_originating_compound_name():
    """The item is engraved `Fire and Cold Absorption +22%`; the proof panel must
    show that, not a stat line no item bears. Bare, not bonus-type-prefixed: the
    wiki's visible cell carries no type, and the type lives in the tooltip prose."""
    rec = _rec("Crown of Ioun", _affix(absorption_split.FIRE_AND_COLD, "Enhancement", 22))
    absorption_split.apply([rec], _shard())

    key = enchantment_split.PROVENANCE_KEY
    for a in rec["affixes"]:
        assert a[key] == absorption_split.FIRE_AND_COLD, a


def test_the_elemental_family_stamps_its_own_compound_name():
    rec = _rec("Archaic Device", _affix(absorption_split.ELEMENTAL, "Enhancement", 5))
    absorption_split.apply([rec], _shard(**{"Archaic Device": _entry(False)}))

    key = enchantment_split.PROVENANCE_KEY
    assert {a[key] for a in rec["affixes"]} == {absorption_split.ELEMENTAL}


def test_provenance_uses_the_key_spell_focus_writes():
    """One key with two spellings would leave a consumer able to collapse one
    family's expansion and not another's."""
    from src import spell_focus
    assert enchantment_split.PROVENANCE_KEY == spell_focus.PROVENANCE_KEY == "via"


# --- R7: quarantine, and it is REMOVAL rather than pass-through ---------------

def test_a_non_stated_entry_has_its_affix_removed_and_counted():
    rec = _rec("Wizard's Ward (level 17)",
               _affix(absorption_split.ELEMENTAL, "Enhancement", 5))
    stats = absorption_split.apply(
        [rec], _shard(**{"Wizard's Ward (level 17)": _entry(False, provenance="defaulted")}))

    assert rec["affixes"] == [], "the unconfirmed compound affix is removed"
    assert stats["quarantined"] == 1
    assert stats["quarantined_unconfirmed"] == 1
    assert stats["expanded"] == 0


def test_a_carrier_absent_from_the_shard_is_removed_and_counted_not_left_in_place():
    """The shared rewriter's default for a missing entry is "leave the affix alone,
    count uncovered". That is exactly the state R7 forbids: registering the family
    strips the compound name from the picker dataset-wide, so a carrier left
    unexpanded ships an affix no player can rank — strictly worse than before."""
    rec = _rec("Brand New Ward", _affix(absorption_split.ELEMENTAL, "Enhancement", 7))
    stats = absorption_split.apply([rec], _shard())

    assert rec["affixes"] == [], "an absent carrier is removed, not passed through"
    assert stats["quarantined"] == 1
    assert stats["quarantined_absent"] == 1
    assert "uncovered" not in stats, (
        "this family has no uncovered counter by design — an uncovered carrier is a "
        "quarantined one, and a separate counter would let the forbidden state hide")


def test_an_entry_whose_sonic_flag_is_absent_is_quarantined():
    """`stated` provenance is not enough. An entry with no Sonic flag states nothing
    about coverage, and defaulting either way is the inference this repo forbids."""
    rec = _rec("Flagless Ward", _affix(absorption_split.ELEMENTAL, "Enhancement", 5))
    stats = absorption_split.apply(
        [rec], _shard(**{"Flagless Ward": _entry(None, provenance="stated")}))

    assert rec["affixes"] == []
    assert stats["quarantined"] == 1


def test_the_static_compounds_never_quarantine():
    """`Fire and Cold Absorption` needs no shard: the wiki's category emission
    settles both components unconditionally, so no per-item evidence is missing."""
    rec = _rec("Unharvested Helm",
               _affix(absorption_split.FIRE_AND_COLD, "Enhancement", 22))
    stats = absorption_split.apply([rec], _shard())

    assert stats["quarantined"] == 0
    assert len(rec["affixes"]) == 2


def test_quarantine_removes_only_the_compound_affix():
    rec = _rec("Brand New Ward",
               _affix(absorption_split.ELEMENTAL, "Enhancement", 7),
               _affix("Constitution", "Enhancement", 3))
    absorption_split.apply([rec], _shard())

    assert rec["affixes"] == [_affix("Constitution", "Enhancement", 3)]


# --- R7: the exclusion is disclosed ------------------------------------------

def test_a_quarantined_carrier_is_named_in_the_coverage_block():
    stats = absorption_split.apply(
        [_rec("Brand New Ward", _affix(absorption_split.ELEMENTAL, "Enhancement", 7))],
        _shard())

    assert stats["excluded"] == [{
        "item": "Brand New Ward",
        "stat": absorption_split.ELEMENTAL,
        "reason": absorption_split.ABSENT,
        "components": list(absorption_split.ELEMENTAL_WITH_SONIC),
    }], stats["excluded"]


def test_the_quarantine_marker_is_stamped_on_the_record():
    """Quarantine is decided in Python against the seed shard; neither the solver
    nor the model receives dataset metadata, so the exclusion has to ride on the
    record itself — the way `material` does."""
    rec = _rec("Brand New Ward", _affix(absorption_split.ELEMENTAL, "Enhancement", 7))
    absorption_split.apply([rec], _shard())

    marker = rec[absorption_split.QUARANTINE_FIELD]
    assert marker == [{"stat": absorption_split.ELEMENTAL,
                       "reason": absorption_split.ABSENT,
                       "components": list(absorption_split.ELEMENTAL_WITH_SONIC)}]


def test_an_expanded_record_gets_no_quarantine_marker():
    rec = _rec("Archaic Device", _affix(absorption_split.ELEMENTAL, "Enhancement", 5))
    absorption_split.apply([rec], _shard(**{"Archaic Device": _entry(False)}))

    assert absorption_split.QUARANTINE_FIELD not in rec, (
        "a clean carrier must carry no marker, or every worn item would disclose")


def test_the_quarantine_marker_survives_the_variant_rebuild():
    """`src/variants.py:_native_parsed` rebuilds affixes from a WHITELIST and
    `_make_variant` rebuilds the variant from one too. A field not named there is
    destroyed silently, long before the serializer sees it."""
    rec = _rec("Brand New Ward", _affix(absorption_split.ELEMENTAL, "Enhancement", 7))
    absorption_split.apply([rec], _shard())
    rec.update({"slot": "Helmet", "category": "named", "minimum_level": 20})

    variant = variants_mod.expand_item(rec)[0]
    assert variant[absorption_split.QUARANTINE_FIELD] == rec[absorption_split.QUARANTINE_FIELD]


# --- Registration -------------------------------------------------------------

def test_all_three_compound_names_are_expanded_away():
    away = absorption_split.EXPANDED_AWAY
    assert set(away) == {absorption_split.FIRE_AND_COLD.lower(),
                         absorption_split.ELECTRICITY_AND_ACID.lower(),
                         absorption_split.ELEMENTAL.lower()}
    assert away[absorption_split.FIRE_AND_COLD.lower()] == [FIRE, COLD]
    assert away[absorption_split.ELECTRICITY_AND_ACID.lower()] == [ELECTRIC, ACID]
    # The union across the dataset: five carriers do include Sonic, so a player
    # redirected off the compound must see every name it becomes somewhere.
    assert away[absorption_split.ELEMENTAL.lower()] == list(
        absorption_split.ELEMENTAL_WITH_SONIC)


def test_the_predicate_is_case_insensitive_and_rejects_components():
    assert absorption_split.is_compound("fire and cold absorption")
    assert absorption_split.is_compound("  Elemental Absorption ")
    assert not absorption_split.is_compound(FIRE)
    assert not absorption_split.is_compound(SONIC)
    assert not absorption_split.is_compound(None)


# --- The guard, and proof it can fail ----------------------------------------

def test_the_guard_refuses_an_empty_shard():
    """A check that inspects nothing passes unconditionally and is
    indistinguishable from a clean run."""
    for fn in (absorption_split.check_against_snapshots,
               absorption_split.audit_shard, absorption_split.audit_snapshots):
        try:
            fn({"harvested": {}})
        except ValueError:
            continue
        raise AssertionError(f"{fn.__name__} passed over zero records")


def test_the_guard_refuses_to_pass_having_compared_nothing():
    """Every entry non-`stated`: the guard reaches a verdict on each, so `checked`
    looks healthy while no Sonic flag was ever matched against a tooltip. That is
    the vacuous pass `compared` exists to catch."""
    shard = _real_shard()
    for entry in shard["harvested"].values():
        entry["provenance"] = "defaulted"
    try:
        absorption_split.check_against_snapshots(shard)
    except ValueError as exc:
        assert "compared" in str(exc), exc
        return
    raise AssertionError("the guard passed having compared no flag against a tooltip")


def test_the_guard_catches_a_flag_disagreeing_with_its_tooltip():
    shard = _real_shard()
    shard["harvested"]["Archaic Device"]["value"]["sonic"] = True
    result = absorption_split.check_against_snapshots(shard)

    assert any("Archaic Device" in p for p in result["problems"]), result["problems"]


def test_the_guard_catches_a_flag_disagreeing_with_its_own_invocation():
    """The tooltip alone only proves a snapshot agrees with itself. `{{Absorption|
    Elemental|18|yes}}` states its own coverage, so the recorded flag must match
    the invocation independently — otherwise a snapshot filed under the wrong key
    compares clean and ships the wrong element set with the build green."""
    shard = _real_shard()
    entry = shard["harvested"]["Cyran Guard (level 26)"]
    entry["raw"] = "{{Absorption|Elemental|18}}"          # invocation says NO sonic
    result = absorption_split.check_against_snapshots(shard)

    assert any("Cyran Guard (level 26)" in p for p in result["problems"]), result["problems"]


def test_the_guard_rejects_an_unknown_provenance():
    """A one-character retype would otherwise fall past every branch while the
    classifier quarantines the entry and silently drops its contribution."""
    shard = _real_shard()
    shard["harvested"]["Archaic Device"]["provenance"] = "statd"
    result = absorption_split.check_against_snapshots(shard)

    assert any("statd" in p for p in result["problems"]), result["problems"]


def test_the_guard_rejects_an_unparsable_invocation():
    shard = _real_shard()
    shard["harvested"]["Archaic Device"]["raw"] = "{{Absorption|Fire|5}}"
    result = absorption_split.check_against_snapshots(shard)

    assert any("Archaic Device" in p for p in result["problems"]), result["problems"]


def test_the_real_shard_passes_its_own_guard():
    shard = _real_shard()
    result = absorption_split.check_against_snapshots(shard)

    assert result["problems"] == [], result["problems"]
    assert result["compared"] == 13, (
        "all thirteen `stated` flags must be matched against a rendered tooltip", result)
    assert result["compared"] <= result["checked"]


def test_the_real_shard_is_fully_snapshotted_and_carries_no_suspect():
    shard = _real_shard()
    assert absorption_split.audit_snapshots(shard)["missing"] == 0
    assert absorption_split.audit_shard(shard)["unsourced"] == 0


def test_today_no_carrier_is_quarantined():
    """All thirteen shard entries are `stated`. The quarantine path is the safety
    net for the NEXT carrier that ships without one, not a live condition."""
    shard = _real_shard()
    records = [_rec(name, _affix(absorption_split.ELEMENTAL, "Enhancement", 5))
               for name in shard["harvested"]]
    stats = absorption_split.apply(records, shard)

    assert stats["quarantined"] == 0, stats["excluded"]
    assert stats["expanded"] == 13


# --- Against the built dataset ------------------------------------------------

def test_the_built_dataset_has_no_surviving_compound_name():
    """The whole-dataset walk. Every channel — item affixes, set-bonus tiers, and
    every crafting/augment pool — must be free of the three compound names, or a
    player can be shown a stat the picker has stopped offering."""
    data = _load_dataset()
    compounds = {n.lower() for n in absorption_split.EXPANDED_AWAY}
    survivors = []

    def walk(node, where):
        if isinstance(node, dict):
            name = node.get("name") if "name" in node else node.get("stat")
            if isinstance(name, str) and name.strip().lower() in compounds:
                survivors.append((where, name))
            for k, v in node.items():
                walk(v, f"{where}.{k}")
        elif isinstance(node, list):
            for v in node:
                walk(v, where)

    for key, value in data.items():
        if key == "metadata":
            continue
        walk(value, key)

    assert not survivors, survivors[:10]


def test_the_expansion_made_the_seventeen_records_visible():
    data = _load_dataset()
    cov = data["metadata"]["compound_absorption_coverage"]

    assert cov["expanded"] == 17, cov
    assert cov["quarantined"] == 0, cov
    assert cov["excluded"] == []
    # 2 carriers x 2 components x 2 compounds, plus 8 four-way and 5 five-way.
    assert cov["components"] == (2 * 2 * 2) + (8 * 4) + (5 * 5), cov


def test_the_built_dataset_credits_the_crown_of_ioun_at_full_magnitude():
    """End to end, on the item from the report."""
    data = _load_dataset()
    crown = next(it for it in data["items"] if it["variant_id"] == "Crown of Ioun")
    by = {}
    for a in crown["affixes"]:
        by.setdefault(a["name"], []).append(a)

    for stat in (FIRE, COLD, ELECTRIC, ACID):
        assert stat in by, (stat, sorted(by))
        assert any(a["value"] == "22" for a in by[stat]), by[stat]
    assert all(a.get("via") for stat in (FIRE, COLD) for a in by[stat]), by


def test_the_set_bonus_orphan_guard_now_covers_the_compound_names():
    """Proof the registration is a live gate rather than decoration. Feeding it a
    set-bonus tier naming a compound must go red — otherwise the "no orphans
    today" assertion below is vacuous, which is exactly how `Parrying` shipped a
    set bonus granting an expanded-away stat."""
    variants = [{"parsed_set_bonuses": [
        {"set": "Synthetic Set",
         "affixes": [{"stat": absorption_split.ELEMENTAL, "bonus_type": "Enhancement",
                      "value": 10}]}]}]
    orphans = enchantment_split.set_bonus_orphans(
        variants, absorption_split.EXPANDED_AWAY, allow=())

    assert orphans == [("Synthetic Set", absorption_split.ELEMENTAL, "10")], orphans


def test_the_marker_survives_serialization_to_the_dataset():
    """The last seam. `build_dataset._serialize_item` rebuilds each variant, and a
    field it drops would die between the variant and items.json — after every
    Python test that inspects `build()`'s in-memory dict has already passed."""
    import build_dataset

    rec = _rec("Brand New Ward", _affix(absorption_split.ELEMENTAL, "Enhancement", 7))
    absorption_split.apply([rec], _shard())
    rec.update({"slot": "Helmet", "category": "named", "minimum_level": 20})
    variant = variants_mod.expand_item(rec)[0]

    serialized = build_dataset._serialize_item(variant)
    assert serialized[absorption_split.QUARANTINE_FIELD] == [{
        "stat": absorption_split.ELEMENTAL, "reason": absorption_split.ABSENT,
        "components": list(absorption_split.ELEMENTAL_WITH_SONIC)}]


def test_the_browser_reads_the_same_marker_field_name():
    """A cross-language contract with no compiler behind it. `web/solver.js` reads
    this field off the worn variants; a rename on either side would silently stop
    every quarantine from ever being disclosed, with both suites green."""
    with open(os.path.join(ROOT, "web", "solver.js"), "r", encoding="utf-8") as fh:
        solver = fh.read()

    assert absorption_split.QUARANTINE_FIELD in solver, (
        f"web/solver.js does not read {absorption_split.QUARANTINE_FIELD!r} — the "
        "build would stamp a marker nothing consumes")
    for reason in (absorption_split.ABSENT, absorption_split.UNCONFIRMED):
        assert reason in _projection_source(), (
            f"web/projection.js does not branch on the {reason!r} reason")


def _projection_source():
    with open(os.path.join(ROOT, "web", "projection.js"), "r", encoding="utf-8") as fh:
        return fh.read()


def test_no_set_bonus_tier_names_a_compound_absorption_stat():
    """The orphan guard's known-orphan allowlist is empty by design, so this is
    what the build already enforces — asserted rather than assumed, because a set
    bonus is a channel the item pass cannot reach (`stat`, not `name`)."""
    data = _load_dataset()
    compounds = {n.lower() for n in absorption_split.EXPANDED_AWAY}
    orphans = []
    for it in data["items"]:
        for tier in it.get("parsed_set_bonuses") or []:
            for a in tier.get("affixes") or []:
                stat = (a.get("stat") or a.get("name") or "").strip().lower()
                if stat in compounds:
                    orphans.append((tier.get("set"), stat))

    assert not orphans, orphans
