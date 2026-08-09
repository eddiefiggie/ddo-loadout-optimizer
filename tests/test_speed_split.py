"""U3 (#154) — the Speed/Striding split at the planner-record seam."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import speed_split  # noqa: E402


def _rec(name, url, *affixes):
    return {"name": name, "url": url, "affixes": [dict(a) for a in affixes]}


def _speed(value):
    return {"name": "Speed", "type": "Enhancement", "value": str(value)}


def _shard(**entries):
    return {"harvested": entries}


def _by_name(rec):
    return {a["name"]: a for a in rec["affixes"]}


def test_striding_item_is_renamed_and_gains_no_alacrity():
    rec = _rec("Ash Boots", "/page/Item:Ash_Boots", _speed(30))
    speed_split.apply([rec], _shard(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert "Speed" not in affixes
    assert affixes["Movement Speed"]["value"] == "30"
    assert "Melee Alacrity" not in affixes and "Ranged Alacrity" not in affixes


def test_roman_rank_item_gains_both_alacrities_and_corrects_movement():
    """Speed XI is rank 11: 30% movement (5*11 capped), 11% attack speed.

    gear-planner stored the rank as if it were the movement percentage, so the
    movement value is corrected here too — not only the missing alacrity.
    """
    rec = _rec("Goatskin Boots", "/page/Item:Goatskin_Boots_(level_19)", _speed(11))
    stats = speed_split.apply([rec], _shard(**{
        "Item:Goatskin Boots (level 19)": {
            "value": {"movement": 30, "melee": 11, "ranged": 11},
            "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30", "movement must be corrected 11 -> 30"
    assert affixes["Melee Alacrity"]["value"] == "11"
    assert affixes["Ranged Alacrity"]["value"] == "11"
    assert stats["movement_corrected"] == 1


def test_movement_cap_does_not_cap_alacrity():
    """Speed XIX is 30% movement but 19% alacrity — one cap, not two."""
    rec = _rec("X", "/page/Item:X", _speed(19))
    speed_split.apply([rec], _shard(**{
        "Item:X": {"value": {"movement": 30, "melee": 19, "ranged": 19},
                   "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30"
    assert affixes["Melee Alacrity"]["value"] == "19"


def test_type_parameter_narrows_to_one_alacrity():
    """{{Speed|XV|Ranged}} grants ranged only — melee must not be invented."""
    rec = _rec("Epic Quiver of Alacrity", "/page/Item:Epic_Quiver_of_Alacrity", _speed(15))
    speed_split.apply([rec], _shard(**{
        "Item:Epic Quiver of Alacrity": {
            "value": {"movement": 30, "ranged": 15}, "provenance": "stated"}}))

    affixes = _by_name(rec)
    assert affixes["Ranged Alacrity"]["value"] == "15"
    assert "Melee Alacrity" not in affixes


def test_defaulted_magnitude_keeps_movement_and_grants_no_alacrity():
    """Template:Speed renders 5% for any magnitude nobody recorded, so a 5%
    reading is not evidence of a 5% bonus. Quarantine the alacrity, keep movement."""
    rec = _rec("Boots of the Battlemaster", "/page/Item:Boots_of_the_Battlemaster", _speed(15))
    stats = speed_split.apply([rec], _shard(**{
        "Item:Boots of the Battlemaster": {
            "value": {"movement": 15}, "provenance": "defaulted"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "15"
    assert "Melee Alacrity" not in affixes and "Ranged Alacrity" not in affixes
    assert stats["quarantined"] == 1


def test_unsourced_item_is_renamed_but_gains_nothing():
    """Belt of the Ram used to be the fixture here. It was a bad reading — the
    page renders `Speed +15%` — so this uses a synthetic title instead."""
    rec = _rec("Silent Page", "/page/Item:Silent_Page", _speed(15))
    speed_split.apply([rec], _shard(**{
        "Item:Silent Page": {"value": None, "provenance": "unsourced"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "15", "keep gear-planner's value"
    assert "Melee Alacrity" not in affixes


def test_audit_reports_unsourced_entries_as_harvest_suspects():
    audit = speed_split.audit_shard(_shard(**{
        "Item:Good": {"value": {"movement": 30}, "provenance": "stated",
                      "raw": "{{Striding|30}}"},
        "Item:Suspect": {"value": None, "provenance": "unsourced",
                         "raw": "no Striding/Speed template found (NONE)"}}))

    assert audit["inspected"] == 2
    assert audit["unsourced"] == 1
    assert audit["titles"] == ["Item:Suspect"]


def test_audit_refuses_to_inspect_an_empty_shard():
    """A check that scans nothing passes unconditionally and reads identical to a
    clean run — the exact way the material coverage gate went green on corrupt
    input (docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md)."""
    try:
        speed_split.audit_shard(_shard())
    except ValueError as exc:
        assert "empty" in str(exc)
    else:
        raise AssertionError("audit_shard must raise on an empty shard")


def test_shipped_shard_has_no_unsourced_entries_left():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "speed_enchantment.json")) as fh:
        shard = json.load(fh)

    audit = speed_split.audit_shard(shard)
    assert audit["inspected"] == 194
    assert audit["unsourced"] == 0, f"harvest suspects remain: {audit['titles']}"


def test_belt_of_the_ram_derives_movement_from_a_real_invocation():
    """Regression on the corrected entry: the wiki renders `Speed +15%`, and 15 is
    outside the recorded switch table, so it is `defaulted` — movement only."""
    rec = _rec("Belt of the Ram", "/page/Item:Belt_of_the_Ram", _speed(15))
    speed_split.apply([rec], _shard(**{
        "Item:Belt of the Ram": {"value": {"movement": 15},
                                 "provenance": "defaulted", "raw": "{{Speed|15}}"}}))

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "15"
    assert "Melee Alacrity" not in affixes
    assert "Ranged Alacrity" not in affixes


def test_an_explicit_upstream_alacrity_is_never_shadowed():
    """Jorgundal's Collar carries Melee Alacrity natively; the split must not
    add a second one (the anti-double-count rule the gap overlay also uses)."""
    rec = _rec("Jorgundal's Collar", "/page/Item:Jorgundal%27s_Collar_(level_12)",
               _speed(25), {"name": "Melee Alacrity", "type": "Enhancement", "value": "10"})
    speed_split.apply([rec], _shard(**{
        "Item:Jorgundal's Collar (level 12)": {
            "value": {"movement": 25, "melee": 11, "ranged": 11}, "provenance": "stated"}}))

    melee = [a for a in rec["affixes"] if a["name"] == "Melee Alacrity"]
    assert len(melee) == 1, "must not add a second Melee Alacrity"
    assert melee[0]["value"] == "10", "the item's own value wins"


def test_record_absent_from_the_shard_is_left_folded():
    """Uncovered records keep the folded affix — the coverage gate makes that
    visible rather than the split silently inventing a reading."""
    rec = _rec("Unharvested", "/page/Item:Unharvested", _speed(30))
    stats = speed_split.apply([rec], _shard())

    assert stats["uncovered"] == 1
    assert _by_name(rec)["Speed"]["value"] == "30"


def test_apply_is_idempotent():
    rec = _rec("Goatskin Boots", "/page/Item:Goatskin_Boots_(level_19)", _speed(11))
    shard = _shard(**{"Item:Goatskin Boots (level 19)": {
        "value": {"movement": 30, "melee": 11, "ranged": 11}, "provenance": "stated"}})
    speed_split.apply([rec], shard)
    before = [dict(a) for a in rec["affixes"]]
    speed_split.apply([rec], shard)

    assert rec["affixes"] == before, "a second pass must add nothing"


def test_records_without_a_speed_affix_are_untouched():
    rec = _rec("Plain", "/page/Item:Plain",
               {"name": "Constitution", "type": "Enhancement", "value": "8"})
    speed_split.apply([rec], _shard())
    assert rec["affixes"] == [{"name": "Constitution", "type": "Enhancement", "value": "8"}]


def _shipped_shard():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "speed_enchantment.json")) as fh:
        return json.load(fh)


def _guard_shard(raw, provenance, value, tooltip):
    return {"snapshots": {speed_split.snapshot_key(raw): {"tooltip": tooltip}},
            "harvested": {"Item:Under Test": {"raw": raw, "provenance": provenance,
                                              "value": value}}}


def test_tooltip_alacrity_reads_both_wiki_dialects():
    assert speed_split.tooltip_alacrity(
        "Speed +30%: +30% enhancement bonus to movement speed, 15% bonus to attack speed."
    ) == {"melee": 15, "ranged": 15}
    assert speed_split.tooltip_alacrity(
        "Speed XI: Passive: +30% enhancement bonus to movement speed, "
        "+11% enhancement bonus to melee and ranged attack speed."
    ) == {"melee": 11, "ranged": 11}
    assert speed_split.tooltip_alacrity(
        "Striding +30%: This item makes you more fleet of foot, giving you a "
        "30% Enhancement bonus your movement speed.") == {}


def test_tooltip_alacrity_honors_the_ranged_only_type_parameter():
    """Covers AE5. `melee and ranged` must be matched before the ranged-only
    pattern — the latter is a suffix of the former."""
    assert speed_split.tooltip_alacrity(
        "Speed XV: Passive: +30% enhancement bonus to movement speed, "
        "+15% enhancement bonus to ranged attack speed.") == {"ranged": 15}


def test_guard_passes_on_the_shipped_shard():
    result = speed_split.check_against_snapshots(_shipped_shard())
    assert result["checked"] == 194
    assert result["problems"] == [], result["problems"]


def test_guard_catches_a_derived_value_drifting_from_its_tooltip():
    shard = _guard_shard(
        "{{Speed|30}}", "stated", {"movement": 30, "melee": 14, "ranged": 15},
        "Speed +30%: +30% enhancement bonus to movement speed, 15% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("melee=14" in p for p in problems), problems


def test_guard_accepts_a_defaulted_arabic_entry_granting_nothing():
    """Covers AE4 — the placeholder inversion. The tooltip says 5%; that 5% is
    the template's fallback, so granting nothing is correct and the guard passes."""
    shard = _guard_shard(
        "{{Speed|17}}", "defaulted", {"movement": 17},
        "Speed +17%: +17% enhancement bonus to movement speed, 5% bonus to attack speed.")
    assert speed_split.check_against_snapshots(shard)["problems"] == []


def test_guard_rejects_a_defaulted_entry_that_granted_alacrity():
    shard = _guard_shard(
        "{{Speed|17}}", "defaulted", {"movement": 17, "melee": 5, "ranged": 5},
        "Speed +17%: +17% enhancement bonus to movement speed, 5% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("must grant no alacrity" in p for p in problems), problems


def test_guard_rejects_a_roman_invocation_labelled_defaulted():
    """The under-grant this guard exists to catch: `{{Speed|V}}` states 5%, it
    does not default to it. Mislabelling it `defaulted` silently drops 5/5."""
    shard = _guard_shard(
        "{{Speed|V}}", "defaulted", {"movement": 25},
        "Speed V: Passive: +25% enhancement bonus to movement speed, "
        "+5% enhancement bonus to melee and ranged attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("Roman invocation labelled" in p for p in problems), problems


def test_guard_rejects_a_recorded_switch_row_labelled_defaulted():
    shard = _guard_shard(
        "{{Speed|28}}", "defaulted", {"movement": 28},
        "Speed +28%: +28% enhancement bonus to movement speed, 13% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("recorded switch row" in p for p in problems), problems


def test_guard_reports_an_entry_with_no_snapshot():
    shard = {"snapshots": {}, "harvested": {
        "Item:Under Test": {"raw": "{{Speed|30}}", "provenance": "stated",
                            "value": {"movement": 30, "melee": 15, "ranged": 15}}}}
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("no tooltip snapshot" in p for p in problems), problems


def test_guard_refuses_to_inspect_nothing():
    try:
        speed_split.check_against_snapshots(_shard())
    except ValueError as exc:
        assert "empty" in str(exc)
    else:
        raise AssertionError("the guard must raise rather than pass over zero records")


def test_every_entry_is_either_graded_or_reported():
    """No entry may pass through silently. `unsourced` rows are graded (they must
    grant nothing) rather than skipped, and anything the guard cannot grade —
    unknown provenance, a missing snapshot, an unreadable tooltip — becomes a
    problem.

    #170 rewrote the assertion. It read `result["checked"] or result["problems"]`,
    which is satisfied by a count incremented before any snapshot is resolved —
    the tripwire endorsing the hole it was meant to catch. A lone `unsourced`
    entry now raises rather than passing with a healthy count, so the cases split
    by whether anything was actually comparable.
    """
    ungradeable = [
        {"raw": "{{Speed|30}}", "provenance": "bogus", "value": None},
        {"raw": "{{Speed|99}}", "provenance": "stated", "value": {"movement": 99}},
    ]
    for entry in ungradeable:
        shard = {"snapshots": {"{{speed|30}}": {"tooltip": "x"}},
                 "harvested": {"Item:X": entry}}
        result = speed_split.check_against_snapshots(shard)
        assert result["problems"], entry

    lone_unsourced = {"snapshots": {"{{speed|30}}": {"tooltip": "x"}},
                      "harvested": {"Item:X": {"raw": "{{Speed|30}}",
                                               "provenance": "unsourced", "value": None}}}
    try:
        speed_split.check_against_snapshots(lone_unsourced)
    except ValueError as exc:
        assert "compared no derived value" in str(exc)
    else:
        raise AssertionError("a shard that compared nothing must not pass")


def test_every_invocation_in_the_shipped_shard_has_a_snapshot():
    audit = speed_split.audit_snapshots(_shipped_shard())
    assert audit["missing"] == 0, f"unsnapshotted invocations: {audit['missing_keys']}"
    assert audit["snapshotted"] == 30


def _aug(name, *affixes):
    return {"name": name, "affixes": [dict(a) for a in affixes]}


def _aug_shard():
    """The shipped augment shard, so these tests assert real seeded evidence."""
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "speed_augment.json")) as fh:
        return json.load(fh)


def test_swiftness_15_gains_both_alacrities():
    """Covers AE1 — the reported defect. The wiki tooltip states 15% attack
    speed, unqualified, so melee and ranged both."""
    rec = _aug("Topaz of Swiftness 15%", _speed(30))
    speed_split.apply_to_augments([rec], _aug_shard())

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30"
    assert affixes["Melee Alacrity"]["value"] == "15"
    assert affixes["Ranged Alacrity"]["value"] == "15"


def test_swiftness_5_gains_no_phantom_ranged_alacrity():
    """Covers AE2 — the double-count trap. Striding grants movement only, so the
    upstream Melee Alacrity 5 stands alone and no ranged component appears."""
    rec = _aug("Topaz of Swiftness 5%", _speed(30),
               {"name": "Melee Alacrity", "type": "Enhancement", "value": "5"})
    speed_split.apply_to_augments([rec], _aug_shard())

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30"
    assert affixes["Melee Alacrity"]["value"] == "5", "upstream value wins"
    assert "Ranged Alacrity" not in affixes, "Striding grants no ranged alacrity"
    assert len([a for a in rec["affixes"] if a["name"] == "Melee Alacrity"]) == 1


def test_snowpeaks_named_speed_is_classified_as_striding():
    """Covers AE3 — the name trap. Classification follows the template in the
    cell, never the augment's name."""
    rec = _aug("Sapphire of Snowpeaks Speed", _speed(30))
    speed_split.apply_to_augments([rec], _aug_shard())

    affixes = _by_name(rec)
    assert affixes["Movement Speed"]["value"] == "30"
    assert "Melee Alacrity" not in affixes
    assert "Ranged Alacrity" not in affixes


def test_striding_augment_tiers_keep_their_own_magnitudes():
    recs = [_aug("Topaz of Striding 10%", _speed(10)),
            _aug("Topaz of Striding 20%", _speed(20))]
    speed_split.apply_to_augments(recs, _aug_shard())

    assert _by_name(recs[0])["Movement Speed"]["value"] == "10"
    assert _by_name(recs[1])["Movement Speed"]["value"] == "20"
    assert all("Melee Alacrity" not in _by_name(r) for r in recs)


def test_augment_absent_from_the_shard_keeps_the_folded_affix():
    rec = _aug("Topaz of Something Unharvested", _speed(30))
    stats = speed_split.apply_to_augments([rec], _aug_shard())

    assert stats["uncovered"] == 1
    assert _by_name(rec)["Speed"]["value"] == "30"


def test_apply_to_augments_is_idempotent():
    rec = _aug("Topaz of Swiftness 15%", _speed(30))
    shard = _aug_shard()
    speed_split.apply_to_augments([rec], shard)
    before = [dict(a) for a in rec["affixes"]]
    speed_split.apply_to_augments([rec], shard)

    assert rec["affixes"] == before, "a second pass must add nothing"


def test_every_folded_augment_in_the_catalog_is_covered_by_the_shard():
    """The shard must cover every augment upstream folds, or the classifier
    silently leaves one behind — the state this whole fix exists to end."""
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium", "raw",
                           "gearplanner_crafting.json")) as fh:
        raw = json.load(fh)

    folded = set()

    def walk(node):
        if isinstance(node, dict):
            if "name" in node and isinstance(node.get("affixes"), list):
                if any(a.get("name") == "Speed" for a in node["affixes"]):
                    folded.add(node["name"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(raw.get("crafting_catalog", {}).get("augment_pool_records", raw))
    covered = set(_aug_shard()["harvested"])
    assert folded, "found no folded augments — the walk is matching nothing"
    assert folded <= covered, f"augments upstream folds but the shard misses: {folded - covered}"


def test_speed_is_declared_expanded_away_to_the_three_concrete_stats():
    assert speed_split.EXPANDED_AWAY["speed"] == [
        "Movement Speed", "Melee Alacrity", "Ranged Alacrity"]


# --- Review-round regressions (#134 code review) -------------------------------
# Each of these encodes a silent-pass hole the guard had on the first pass.

def _aug_shipped():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "speed_augment.json")) as fh:
        return json.load(fh)


def test_augment_shard_is_covered_by_the_same_guard_as_items():
    """The augment shard once stored tooltips inline while the guard read a
    `snapshots` block — two representations of one field, so the guard checked
    zero augment entries and reported them all as unsnapshotted."""
    shard = _aug_shipped()
    assert speed_split.audit_snapshots(shard)["missing"] == 0
    result = speed_split.check_against_snapshots(shard)
    assert result["checked"] == 7, result
    assert result["problems"] == [], result["problems"]


def test_unknown_provenance_is_reported_not_skipped():
    """A one-character retype fell through both branches unreported while the
    classifier quarantined the entry and dropped its alacrity."""
    shard = _guard_shard(
        "{{Speed|30}}", "Stated", {"movement": 30},
        "Speed +30%: +30% enhancement bonus to movement speed, 15% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("unknown provenance" in p for p in problems), problems


def test_unreadable_tooltip_cannot_verify_anything():
    """A blank snapshot used to parse as {} — indistinguishable from 'the wiki
    says no alacrity' — so an under-granting entry agreed with it and passed."""
    shard = _guard_shard("{{Speed|30}}", "stated", {"movement": 30}, "")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("matches no known dialect" in p for p in problems), problems
    assert speed_split.tooltip_alacrity("") is None
    assert speed_split.tooltip_alacrity("Striding +30%: ...movement speed.") == {}


def test_stated_arabic_outside_the_switch_must_be_defaulted():
    """The stated branch only compared tooltip-to-value, so labelling a
    placeholder-5% entry `stated` with melee 5 matched and passed."""
    shard = _guard_shard(
        "{{Speed|17}}", "stated", {"movement": 17, "melee": 5, "ranged": 5},
        "Speed +17%: +17% enhancement bonus to movement speed, 5% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("must be labelled `defaulted`" in p for p in problems), problems


def test_guard_asserts_movement_against_the_tooltip():
    shard = _guard_shard(
        "{{Speed|30}}", "stated", {"movement": 25, "melee": 15, "ranged": 15},
        "Speed +30%: +30% enhancement bonus to movement speed, 15% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("derived movement=25" in p for p in problems), problems


def test_defaulted_entry_whose_tooltip_is_not_the_placeholder_is_reported():
    """The defaulted branch never read the snapshot, so its placeholder claim
    rested only on our own copy of the switch table."""
    shard = _guard_shard(
        "{{Speed|17}}", "defaulted", {"movement": 17},
        "Speed +17%: +17% enhancement bonus to movement speed, 9% bonus to attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("not the 5% default" in p for p in problems), problems


def test_an_arabic_snapshot_paired_with_the_wrong_tooltip_is_reported():
    """#170's second, unlisted hole — the binding shape from #173, found in Speed
    while fixing the vacuity one.

    Move the snapshot AND every value that reads it together and the plain
    comparison passes by construction: on the shipped shard, swapping
    `{{Speed|30}}`'s tooltip for `{{Speed|20}}`'s and following it across all 73
    entries reported `checked=194, problems=0` while shipping 7% attack speed
    where the switch says 15%. The Arabic argument IS the movement percent and
    the switch names the attack speed, so both are anchored to the key.
    """
    shard = _guard_shard(
        "{{Speed|30}}", "stated", {"movement": 20, "melee": 7, "ranged": 7},
        "Speed +20%: +20% enhancement bonus to movement speed, 7% bonus to attack speed.")
    result = speed_split.check_against_snapshots(shard)

    assert any("names 30% movement but its tooltip states 20%" in p
               for p in result["problems"]), result["problems"]
    assert any("recorded switch row (30 -> 15%)" in p
               for p in result["problems"]), result["problems"]
    assert result["compared"] == 1, "it must still count as compared, not skipped"


def test_a_roman_snapshot_paired_with_the_wrong_tooltip_is_reported():
    """The Roman branch is anchored too: `attack speed = rank%` and
    `movement = min(5 x rank, 30)`, per Template:Speed's worked examples."""
    shard = _guard_shard(
        "{{Speed|XI}}", "stated", {"movement": 25, "melee": 5, "ranged": 5},
        "Speed V: +25% enhancement bonus to movement speed, "
        "+5% enhancement bonus to melee and ranged attack speed.")
    problems = speed_split.check_against_snapshots(shard)["problems"]

    assert any("rank 11, so it must state 30% movement" in p for p in problems), problems
    assert any("must state 11% melee attack speed" in p for p in problems), problems


def test_the_roman_movement_cap_does_not_cap_attack_speed():
    """Speed XIX is 30% movement but 19% attack speed. Assuming one cap governs
    both is the mistake the evidence doc singles out as most likely."""
    assert speed_split.roman_rank("{{Speed|XIX}}") == 19
    shard = _guard_shard(
        "{{Speed|XIX}}", "stated", {"movement": 30, "melee": 19, "ranged": 19},
        "Speed XIX: +30% enhancement bonus to movement speed, "
        "+19% enhancement bonus to melee and ranged attack speed.")
    assert speed_split.check_against_snapshots(shard)["problems"] == []


def test_a_ranged_only_invocation_is_bound_on_ranged_alone():
    """`{{Speed|XV|ranged}}` states ranged only; asserting melee too would
    manufacture a problem on a correct snapshot."""
    shard = _guard_shard(
        "{{Speed|XV|ranged}}", "stated", {"movement": 30, "ranged": 15},
        "Speed XV: +30% enhancement bonus to movement speed, "
        "+15% enhancement bonus to ranged attack speed.")
    assert speed_split.check_against_snapshots(shard)["problems"] == []


def test_every_shipped_snapshot_states_what_its_own_invocation_names():
    """The whole-shard invariant. Verified at zero violations across all 24
    Speed snapshots before the assertion was written."""
    for shard in (_shipped_shard(), _aug_shipped()):
        for raw, snap in shard["snapshots"].items():
            if raw.startswith("{{striding"):
                continue
            problems = []
            speed_split._bind_invocation_to_tooltip(
                "shipped", raw, snap.get("tooltip"), problems)
            assert not problems, (raw, problems)


def test_unsourced_entry_needs_no_snapshot_and_does_not_fail_the_build():
    """An `unsourced` entry is graded, not skipped, and is not itself a problem.

    It must sit alongside something the guard actually compared. #170: this test
    used to assert a lone `unsourced` entry passed with `checked == 1`, which is
    precisely the vacuous pass — the guard reported a healthy count having
    verified no magnitude at all. See the companion test below.
    """
    shard = _guard_shard(
        "{{Speed|30}}", "stated", {"movement": 30, "melee": 15, "ranged": 15},
        "Speed +30%: +30% enhancement bonus to movement speed, 15% bonus to attack speed.")
    shard["harvested"]["Item:Silent"] = {
        "raw": "", "provenance": "unsourced", "value": None}

    result = speed_split.check_against_snapshots(shard)
    assert result["problems"] == [], result["problems"]
    assert result["checked"] == 2, "the unsourced entry is graded"
    assert result["compared"] == 1, "but only the stated one was compared"


def test_a_shard_of_only_unsourced_entries_refuses_to_pass():
    """#170. `checked` counts an `unsourced` entry before any snapshot lookup, so
    it can never reach zero and is useless as a vacuity tripwire. `compared`
    counts only values matched against a parsed tooltip."""
    shard = {"snapshots": {}, "harvested": {
        "Item:Silent": {"raw": "", "provenance": "unsourced", "value": None},
        "Item:Quiet": {"raw": "", "provenance": "unsourced", "value": None}}}
    try:
        speed_split.check_against_snapshots(shard)
    except ValueError as exc:
        assert "compared no derived value" in str(exc)
        return
    raise AssertionError("a shard that compared nothing must not report a clean guard")


def test_a_stated_entry_that_never_reached_a_comparison_is_reported():
    shard = {"snapshots": {}, "harvested": {
        "Item:Under Test": {"raw": "{{Speed|30}}", "provenance": "stated",
                            "value": {"movement": 30, "melee": 15, "ranged": 15}}}}
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("never compared against a tooltip" in p for p in problems), problems


def test_unsourced_entry_granting_alacrity_is_reported():
    shard = {"snapshots": {}, "harvested": {
        "Item:Silent": {"raw": "", "provenance": "unsourced",
                        "value": {"melee": 5}}}}
    problems = speed_split.check_against_snapshots(shard)["problems"]
    assert any("must grant no alacrity" in p for p in problems), problems
