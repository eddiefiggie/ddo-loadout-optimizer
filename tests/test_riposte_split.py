"""#546 — the Riposte expansion at the planner-record and augment-pool seams.

Deliberately NOT a copy of `test_parrying_split.py`. The two enchantments share a
skeleton, and the tests that would only re-prove the skeleton are left to that
file. What is pinned here is everything Riposte does that Parrying does not:

  * the two halves DIFFER on odd Roman numerals (AC rounds up, saves round down);
  * the augment channel, which Parrying has no carrier for and which is the
    channel the reporter's own item lives in;
  * a guard that asserts BOTH halves of a Roman numeral, not just the AC one.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import riposte_split  # noqa: E402

SAVES = ("Fortitude Save", "Reflex Save", "Will Save")
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "riposte_version.json")
DATASET_PATH = os.path.join(ROOT, "web", "data", "items.json")


def _rec(name, *affixes):
    return {"name": name, "url": f"/page/Item:{name.replace(' ', '_')}",
            "affixes": [dict(a) for a in affixes]}


def _riposte(value, type_="Insight"):
    return {"name": "Riposte", "type": type_, "value": str(value)}


def _affix(name, type_, value):
    return {"name": name, "type": type_, "value": str(value)}


def _entry(version, armor_class, saves, provenance="stated"):
    return {"value": {"version": version, "armor_class": armor_class, "saves": saves},
            "provenance": provenance, "raw": "{{Riposte|%s}}" % version}


def _by_name(rec):
    out = {}
    for a in rec["affixes"]:
        out.setdefault(a["name"], []).append(a)
    return out


def _shipped_shard():
    from src import harvest
    return harvest.load_shard(SHARD_PATH, "riposte_version")


def _dataset():
    if not os.path.exists(DATASET_PATH):
        return None  # generated artifact; the build itself is the gate
    with open(DATASET_PATH) as fh:
        return json.load(fh)


# --- the asymmetry: the thing that separates Riposte from Parrying --------------

def test_an_odd_roman_numeral_grants_more_armor_class_than_saves():
    """`Riposte IX` is +5 Armor Class and +4 saves. This is THE difference from
    Parrying, whose two halves are always equal — a fix that reused Parrying's
    "one magnitude to four stats" config would emit +5 saves here."""
    rec = _rec("Epic Ethereal Bracers", _riposte(9))
    riposte_split.apply([rec], {"harvested": {"Epic Ethereal Bracers": _entry("IX", 5, 4)}})
    got = _by_name(rec)
    assert "Riposte" not in got, "the folded affix is renamed away"
    assert got["Armor Class"][0]["value"] == "5"
    assert got["Armor Class"][0]["type"] == "Insight"
    for save in SAVES:
        assert got[save][0]["value"] == "4", f"{save} rounds DOWN, unlike the AC"


def test_every_confirmed_roman_numeral_splits_as_harvested():
    """All eleven, each individually rendered. Asserted as a table rather than a
    formula: the lookup is the evidence, and a numeral nobody rendered must not
    be computable from the ones that were."""
    assert riposte_split.ROMAN_MAGNITUDE == {
        "II": {"armor_class": 1, "saves": 1},
        "III": {"armor_class": 2, "saves": 1},
        "IV": {"armor_class": 2, "saves": 2},
        "V": {"armor_class": 3, "saves": 2},
        "VI": {"armor_class": 3, "saves": 3},
        "VII": {"armor_class": 4, "saves": 3},
        "VIII": {"armor_class": 4, "saves": 4},
        "IX": {"armor_class": 5, "saves": 4},
        "X": {"armor_class": 5, "saves": 5},
        "XI": {"armor_class": 6, "saves": 5},
        "XII": {"armor_class": 6, "saves": 6},
    }
    odd = [r for r, m in riposte_split.ROMAN_MAGNITUDE.items()
           if m["armor_class"] != m["saves"]]
    assert sorted(odd) == ["III", "IX", "V", "VII", "XI"], \
        "five numerals split asymmetrically; if this list empties, the halves " \
        "were collapsed and the saves are being over-granted"


def test_no_roman_one_is_offered_even_though_the_pattern_would_allow_it():
    """The wiki lists no `Riposte I`. Extrapolating one from the eleven confirmed
    points is exactly the inference this project forbids."""
    assert "I" not in riposte_split.ROMAN_MAGNITUDE


def test_identical_stored_magnitudes_diverge_on_dialect():
    """The collision that proves the version cannot be read off the number.

    `Emerald Twilight` (Roman VII) and `Legendary Planar Lariat` (Arabic +7) both
    store 7 upstream and grant different amounts. No rule reading the stored
    magnitude can produce both answers."""
    roman = _rec("Emerald Twilight", _riposte(7))
    arabic = _rec("Legendary Planar Lariat", _riposte(7))
    shard = {"harvested": {"Emerald Twilight": _entry("VII", 4, 3),
                           "Legendary Planar Lariat": _entry("7", 7, 7)}}
    riposte_split.apply([roman, arabic], shard)
    assert _by_name(roman)["Armor Class"][0]["value"] == "4"
    assert _by_name(roman)["Fortitude Save"][0]["value"] == "3"
    assert _by_name(arabic)["Armor Class"][0]["value"] == "7"
    assert _by_name(arabic)["Fortitude Save"][0]["value"] == "7"


# --- the augment channel, which Parrying has no carrier for --------------------

def test_the_augment_channel_expands_the_reporters_own_item():
    """`Legendary Sapphire of Riposte` is an AUGMENT. It lives in the `<Color>
    Augment Slot` pools, not the planner item roster, so the item-side apply
    never reaches it — coverage of one channel is not coverage of the other."""
    aug = {"name": "Legendary Sapphire of Riposte", "affixes": [_riposte(6)]}
    riposte_split.apply_to_augments(
        [aug], {"harvested": {"Legendary Sapphire of Riposte": _entry("6", 6, 6)}})
    got = _by_name(aug)
    assert "Riposte" not in got
    assert got["Armor Class"][0]["value"] == "6"
    for save in SAVES:
        assert got[save][0]["value"] == "6"


def test_the_item_apply_does_not_reach_an_augment_record():
    """Both channels join by name today, so this is not a join-key difference —
    it is the reason both calls exist in `build_dataset.py`. If someone deletes
    the augment call believing the item one covers it, the augment pool is a
    different list of records and simply never gets walked."""
    aug = {"name": "Legendary Sapphire of Riposte", "affixes": [_riposte(6)]}
    cov = riposte_split.apply([], {"harvested": {"Legendary Sapphire of Riposte":
                                                 _entry("6", 6, 6)}})
    assert cov["renamed"] == 0
    assert _by_name(aug)["Riposte"], "untouched: it was never in the record list"


# --- the anti-shadow rule, keyed on bucket rather than name --------------------

def test_a_differently_bucketed_armor_class_still_receives_the_insight_one():
    """Sixteen shipped Riposte records already carry an Armor Class. Most are
    Shield- or Enhancement-typed — different stacking buckets, which must keep
    stacking with an Insight one. A name-keyed rule would withhold a real
    contribution from all sixteen."""
    rec = _rec("Emerald Twilight", _riposte(7), _affix("Armor Class", "Shield", 13))
    riposte_split.apply([rec], {"harvested": {"Emerald Twilight": _entry("VII", 4, 3)}})
    got = _by_name(rec)
    assert sorted(a["type"] for a in got["Armor Class"]) == ["Insight", "Shield"]
    assert [a["value"] for a in got["Armor Class"] if a["type"] == "Insight"] == ["4"]


def test_a_same_bucket_armor_class_suppresses_the_primary_but_not_the_saves():
    """When the record already carries an Insight Armor Class, the folded affix is
    dropped rather than renamed into a duplicate — but the three saves are still
    owed and must still arrive."""
    rec = _rec("Already Insighted", _riposte(6), _affix("Armor Class", "Insight", 9))
    riposte_split.apply([rec], {"harvested": {"Already Insighted": _entry("VI", 3, 3)}})
    got = _by_name(rec)
    assert len(got["Armor Class"]) == 1, "no duplicate Insight AC"
    assert got["Armor Class"][0]["value"] == "9", "the larger incumbent is kept"
    for save in SAVES:
        assert got[save][0]["value"] == "3", "the saves are owed regardless"


# --- the guard ------------------------------------------------------------------

def test_the_guard_rejects_the_copy_parrying_mistake():
    """The single likeliest way to get this wrong: give the saves the AC's
    magnitude. Parrying's own guard would NOT catch it — it asserts a Roman
    numeral's AC against its lookup and never checks the saves."""
    shard = {"harvested": {"X": _entry("IX", 5, 5)},
             "snapshots": {"{{riposte|ix}}": {"tooltip": (
                 "Riposte IX: When Missed by an attack: Deals 9 to 36 damage to your "
                 "attacker. Passive: +5 Insight bonus to Armor Class, +4 Insight bonus "
                 "to Fortitude, Reflex, and Will Saving Throws.")}}}
    problems = riposte_split.check_against_snapshots(shard)["problems"]
    assert any("saves" in p for p in problems), problems


def test_the_guard_rejects_a_roman_numeral_outside_the_confirmed_lookup():
    """Even with a self-consistent tooltip. An unrendered numeral is quarantined,
    never computed from the pattern the rendered ones happen to fit."""
    shard = {"harvested": {"Made Up Blade": _entry("XIII", 7, 6)},
             "snapshots": {"{{riposte|xiii}}": {"tooltip": (
                 "Riposte XIII: When Missed by an attack: Deals 13 to 52 damage to your "
                 "attacker. Passive: +7 Insight bonus to Armor Class, +6 Insight bonus "
                 "to Fortitude, Reflex, and Will Saving Throws.")}}}
    problems = riposte_split.check_against_snapshots(shard)["problems"]
    assert any("outside the confirmed" in p for p in problems), problems


def test_an_arabic_snapshot_paired_with_the_wrong_tooltip_is_reported():
    """Otherwise the guard only proves a tooltip agrees with itself."""
    shard = {"harvested": {"X": _entry("2", 2, 2)},
             "snapshots": {"{{riposte|2}}": {"tooltip": (
                 "Riposte +6: This item enchants its user with incredible awareness "
                 "and speed, granting a +6 Insight bonus to AC and to Saves.")}}}
    problems = riposte_split.check_against_snapshots(shard)["problems"]
    assert any("wrong invocation" in p for p in problems), problems


def test_both_tooltip_dialects_read():
    arabic = ("Riposte +6: This item enchants its user with incredible awareness and "
              "speed, granting a +6 Insight bonus to AC and to Saves.")
    roman = ("Riposte IX: When Missed by an attack: Deals 9 to 36 damage to your "
             "attacker. Passive: +5 Insight bonus to Armor Class, +4 Insight bonus to "
             "Fortitude, Reflex, and Will Saving Throws.")
    assert (riposte_split.tooltip_armor_class(arabic),
            riposte_split.tooltip_saves(arabic)) == (6, 6)
    assert (riposte_split.tooltip_armor_class(roman),
            riposte_split.tooltip_saves(roman)) == (5, 4)
    assert riposte_split.tooltip_armor_class("nothing like a tooltip") is None
    assert riposte_split.tooltip_saves("nothing like a tooltip") is None


def test_the_guard_refuses_to_pass_over_an_empty_shard():
    try:
        riposte_split.check_against_snapshots({"harvested": {}})
    except ValueError as e:
        assert "empty" in str(e)
    else:
        raise AssertionError("an empty shard must raise, not report a clean run")


def test_the_shipped_shard_compares_every_entry():
    report = riposte_split.check_against_snapshots(_shipped_shard())
    assert report["problems"] == []
    assert report["compared"] == report["checked"] == 35, report
    assert report["compared"] > 0, "a clean run that compared nothing is vacuous"


def test_the_guard_makes_no_network_call():
    """Offline by construction — it reads a dict. Pinned so a future 'just fetch
    the tooltip' convenience cannot make the build depend on a throttled wiki."""
    import socket
    shard = _shipped_shard()
    real = socket.socket

    def _forbidden(*a, **k):
        raise AssertionError("the guard must not open a socket")

    socket.socket = _forbidden
    try:
        riposte_split.check_against_snapshots(shard)
    finally:
        socket.socket = real


# --- the shipped dataset --------------------------------------------------------

def test_riposte_is_expanded_away_to_exactly_the_four_stats():
    assert riposte_split.EXPANDED_AWAY == {
        "riposte": ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]}


def test_the_built_dataset_carries_the_split_on_both_channels():
    data = _dataset()
    if data is None:
        return

    assert not [1 for it in data["items"]
                for a in it.get("affixes") or [] if a.get("name") == "Riposte"], \
        "no folded affix survives anywhere"
    assert "Riposte" not in data["metadata"]["rankable_affixes"]
    assert data["metadata"]["expanded_away_names"]["riposte"] == [
        "Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]

    coverage = data["metadata"]["riposte_split_coverage"]
    assert coverage["uncovered"] == 0 and coverage["quarantined"] == 0
    assert coverage["augment_channel"]["renamed"] == 2, \
        "both Sapphires expand; a zero here means the augment call was dropped"

    # Read out of the shipped dataset rather than a fixture: one Roman-asymmetric
    # item, one Arabic item that stores the SAME number and grants more, and the
    # augment the #546 reporter actually named.
    want = {
        "Emerald Twilight": ("4", "3"),                 # Roman VII
        "Epic Ethereal Bracers": ("5", "4"),            # Roman IX
        "Legendary Planar Lariat": ("7", "7"),          # Arabic +7 — same stored 7
        "Legendary Sapphire of Riposte": ("6", "6"),    # the reported augment
    }
    seen = {}
    for it in data["items"]:
        name = it.get("source_item")
        if name not in want:
            continue
        ac = saves = None
        for a in it.get("affixes") or []:
            if a.get("type") != "Insight":
                continue
            if a.get("name") == "Armor Class":
                ac = a["value"]
            elif a.get("name") == "Fortitude Save":
                saves = a["value"]
        seen[name] = (ac, saves)
    assert seen == want, seen


def test_no_set_bonus_grants_riposte_so_the_missing_path_stays_deliberate():
    """`src/riposte_split.py` has no `expand_set_bonuses` because nothing needs
    one. That is a claim about the shipped catalog, so it is asserted rather than
    written down — the moment a set tier grants `Riposte`, this fails and names
    the work instead of silently dropping the tier's contribution."""
    data = _dataset()
    if data is None:
        return
    offenders = []
    for it in data["items"]:
        for tier in it.get("parsed_set_bonuses") or []:
            for a in tier.get("affixes") or []:
                if "riposte" in str(a.get("stat") or a.get("name") or "").lower():
                    offenders.append((tier.get("set"), a))
    assert not offenders, (
        "a set bonus now grants Riposte — add the set-bonus expansion path "
        f"(see parrying_split.expand_set_bonuses): {offenders[:3]}")
