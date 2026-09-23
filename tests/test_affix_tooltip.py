"""#713 — the rendered-tooltip shard, the conditional detector, and its guards."""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import affix_tooltip as T  # noqa: E402
from src import conditional_quarantine as Q  # noqa: E402

ITEMS = os.path.join(ROOT, "web", "data", "items.json")
QUAR = os.path.join(ROOT, "data", "seed", "compendium", "conditional_affix_quarantine.json")


def _raises(fn, *a, **k):
    try:
        fn(*a, **k)
    except SystemExit as e:
        return str(e)
    raise AssertionError("expected SystemExit, nothing raised")


def _real():
    sh = T.load_shard(); adj = T.load_adjudications()
    qn = {e["name"] for ents in Q.load(QUAR).values() for e in ents}
    roster = sorted(set(sh["harvested"]) | set(sh["_meta"]["unharvested"]))
    return sh, adj, roster, qn


# --- the markers are STRONG: a stat's own definition is not a condition ---------

def test_markers_flag_triggers_ramps_windows_and_standing_conditions_only():
    assert T.markers_for("Dazing IV: On Hit: Your target suffers a -1 Penalty for 6 seconds. This effect stacks up to 5 times. This effect may only occur on-hit once every three seconds.") == ["trigger", "ramp", "window", "cooldown"]
    assert T.markers_for("+4 Orb Bonus: While this orb is equipped and you are actively blocking, you gain a +4 orb bonus to all saving throws") == ["standing"]
    assert T.markers_for("Deific Focus III: On Spell Cast: +1 Sacred bonus to DC of that school for five seconds. Stacks up to III times.") == ["trigger", "ramp", "window"]
    # The three families the first draft flagged 49 names on, all definitions:
    assert T.markers_for("Fire Lore +11: Passive: Your Fire spells gain a 11% Equipment bonus to their chance to critical hit.") == []
    assert T.markers_for("Fire Absorption +26%: Passive: 26% Enhancement Bonus to Fire Absorption. (Absorption reduces damage from an element by a percentage, after resistance have been taken into account.)") == []
    assert T.markers_for("Melee Alacrity 5%: Gain 5% Enhancement bonus to Melee attack speed. Does not stack with the Haste spell.") == []
    assert T.markers_for("Deception +3: +3 Enhancement bonus to hit and +5 to damage for any hit that would qualify as a sneak attack.") == []


# --- the real seeds resolve, and the population is what the note measured ------

def test_the_shipped_shard_covers_the_roster_and_every_candidate_is_ruled():
    sh, adj, roster, qn = _real()
    cov = T.check(sh, adj, roster, qn)
    # 199/198 not 198/197 since #724: +1, the `Mighty Skills Bonus` tooltip read
    # off Item:The_Repulsor_Boots. It is NOT a roster name (2 carriers, below the
    # rankability bar), so it moves this count without moving the roster
    # coverage below — a harvested tooltip and a rankable name are different
    # populations, and this pair is where that shows.
    # 205/204 not 199/198 since #715: +6, the augment-only stats read from the
    # Lunar_and_Solar_Gems table — the table IS their page, one row per gem
    # family. Six of the seven augment-only names; `Max Dex Bonus` stays
    # unharvested because its named carrier has no wiki page at all.
    # 212/211 not 205/204 since #715 half two: +7, the set-tier-only stats read
    # from the Named_item_sets tier text.
    # 213/212 since #715: +1, `Eldritch Blast Dice`, missed by the first Lunar/Solar
    # pass because the table's row label is `Blast Dice` and the search used our
    # canonical name.
    # 214/213 since 397c673: +1, `Power of the Frozen Thunderstorm`, read off
    # Item:The_Volley's_Aria (Terror of the Demon Lords). `Minor Spell Penetration`
    # remains the one unmatched roster name, unchanged from before the refresh.
    assert cov["names"] == 214 and cov["stated"] == 213, cov
    assert cov["unmatched"] == ["Minor Spell Penetration"]
    # 19 not 25 since #715: the six above left the register. The remaining 19 are
    # 12 set-tier-only stats (the Named_item_sets half, still to harvest), the six
    # alias/expansion-minted names whose canonical carries the tooltip — now
    # recorded as explicit pointers rather than vague reasons — and Max Dex Bonus.
    # 12 not 19: the seven above left. The remaining 12 are the 5 augment-SET
    # names (not on Named_item_sets — checked), the 6 pointer names, and
    # Max Dex Bonus.
    assert len(cov["unharvested"]) == 11
    assert [c["name"] for c in cov["candidates"]] == ["Dazing", "Dragon's Edge", "Improved Deception", "Orb Bonus", "Sundering"]
    assert cov["by_disposition"] == {"constant": ["Dazing", "Dragon's Edge", "Improved Deception", "Sundering"],
                                     "quarantine": [], "disclose": ["Orb Bonus"]}
    # #715 — a tooltip's source is not always an item page. The whole reason
    # these stats sat unharvested is that they have NO item carrier: the
    # Lunar_and_Solar_Gems table is the page for the augment-only ones, one row
    # per gem family. So the URL check widens from "an Item: page" to "a ddowiki
    # page" — but the non-item sources are ALLOWLISTED, so it cannot quietly
    # drift to an arbitrary page and call that evidence.
    NON_ITEM_SOURCES = {"https://ddowiki.com/page/Lunar_and_Solar_Gems",
                        "https://ddowiki.com/page/Named_item_sets"}
    for name, e in sh["harvested"].items():
        assert e["provenance"] in ("stated", "unmatched"), name
        if e["provenance"] == "stated":
            assert e["tooltip"] and e["label"] and e["carrier"], name
            url = e["wiki_url"]
            assert url.startswith("https://ddowiki.com/page/Item:") or url in NON_ITEM_SOURCES, (
                f"{name}: {url} is neither an item page nor an allowlisted "
                "non-item source — add it to NON_ITEM_SOURCES deliberately")
    assert T.disclosures(adj) == {"Orb Bonus": {"label": "+4 Orb Bonus",
                                                "sentence": "only while the orb is equipped and you are actively blocking",
                                                "tooltip": sh["harvested"]["Orb Bonus"]["tooltip"]}}


# --- every guard proven red ------------------------------------------------------

def test_an_unruled_candidate_fails():
    sh, adj, roster, qn = _real()
    bad = copy.deepcopy(adj); del bad["ruled"]["Orb Bonus"]
    msg = _raises(T.check, sh, bad, roster, qn)
    assert "Orb Bonus" in msg and "no ruling" in msg


def test_evidence_drift_fails():
    sh, adj, roster, qn = _real()
    bad = copy.deepcopy(sh); bad["harvested"]["Dazing"]["tooltip"] += " (rewritten)"
    msg = _raises(T.check, bad, adj, roster, qn)
    assert "Dazing" in msg and "evidence is not the tooltip" in msg


def test_a_stale_ruling_fails():
    sh, adj, roster, qn = _real()
    bad = copy.deepcopy(adj); bad["ruled"]["Fire Lore"] = dict(bad["ruled"]["Dazing"])
    msg = _raises(T.check, sh, bad, roster, qn)
    assert "Fire Lore" in msg and "stale" in msg


def test_a_roster_name_with_no_tooltip_and_no_reason_fails():
    sh, adj, roster, qn = _real()
    msg = _raises(T.check, sh, adj, roster + ["Brand New Rankable Stat"], qn)
    assert "Brand New Rankable Stat" in msg and "no tooltip on disk" in msg


def test_a_quarantine_ruling_must_be_carried_out():
    sh, adj, roster, qn = _real()
    bad = copy.deepcopy(adj); bad["ruled"]["Orb Bonus"]["disposition"] = "quarantine"
    msg = _raises(T.check, sh, bad, roster, qn)
    assert "Orb Bonus" in msg and "not carried out" in msg


def test_an_unknown_disposition_fails():
    sh, adj, roster, qn = _real()
    bad = copy.deepcopy(adj); bad["ruled"]["Dazing"]["disposition"] = "ignore"
    msg = _raises(T.check, sh, bad, roster, qn)
    assert "Dazing" in msg and "outside" in msg


def test_zero_candidates_is_a_broken_detector_not_a_clean_one():
    sh, adj, roster, qn = _real()
    empty = {"_meta": sh["_meta"], "harvested": {k: v for k, v in sh["harvested"].items() if k == "Fire Lore"}}
    try:
        T.check(empty, {"ruled": {}}, ["Fire Lore"], qn)
    except ValueError as e:
        assert "zero candidates" in str(e)
    else:
        raise AssertionError("a shard with no candidate must not pass silently")


# --- the built dataset carries the coverage and the disclosure map --------------

def test_built_dataset_stamps_coverage_and_the_disclose_map():
    if not os.path.exists(ITEMS):
        return
    data = json.load(open(ITEMS, encoding="utf-8"))
    cov = data["metadata"]["affix_tooltip_coverage"]
    assert cov["names"] == 214 and cov["by_disposition"]["disclose"] == ["Orb Bonus"]  # #724, #715
    assert set(data["metadata"]["conditional_disclosures"]) == {"Orb Bonus"}
    assert "actively blocking" in data["metadata"]["conditional_disclosures"]["Orb Bonus"]["sentence"]
    # The roster the build computed is covered: no rankable numeric item stat is
    # missing from the shard and the unharvested register together.
    sh = T.load_shard()
    covered = set(sh["harvested"]) | set(sh["_meta"]["unharvested"])
    rank = set(data["metadata"]["rankable_affixes"])
    for it in data["items"]:
        if not it.get("wiki_url") or "/page/Item:" not in it["wiki_url"]:
            continue
        for a in it.get("affixes") or []:
            if a["name"] in rank and a.get("type") != "Bool" and not a.get("via"):
                try:
                    float(a.get("value"))
                except (TypeError, ValueError):
                    continue
                assert a["name"] in covered, a["name"]


# --- #852: the bonus-type cross-check ------------------------------------------

def test_stated_type_reads_the_three_shapes_and_nothing_else():
    assert T.stated_type("Strength +3: This item gives the wearer the power of Ogre Strength, granting a +3 Enhancement bonus to Strength.") == "Enhancement"
    assert T.stated_type("Exceptional Seeker +5: Provides a +5 Insight bonus to confirm critical hits") == "Insight"
    assert T.stated_type("Fire Lore +11: Passive: Your Fire spells gain a 11% Equipment bonus to their chance to critical hit.") == "Equipment"
    assert T.stated_type("Healing Amplification: amplifies all incoming positive energy healing by +8 (Exceptional bonus).") == "Exceptional"
    assert T.stated_type("Good Luck +2: This item gives a +2 Luck bonus to all saves and skill checks.") == "Luck"
    assert T.stated_type("Insightful Dexterity +3: +3 Insightful bonus to Dexterity") == "Insight", "the wiki's spelling maps to the catalog's"
    assert T.stated_type("Rage Charges: This item has 3 charges of Rage.") is None
    assert T.stated_type("Damage Reduction 5/-: reduces damage by 5") is None
    assert T.stated_type("a +3 Mysterious bonus to nothing") is None, "an unknown type word is never read as a type"
    assert T.stated_type("") is None and T.stated_type(None) is None


def test_label_type_and_strip_label():
    assert T.label_type("Exceptional Seeker +5") == "Exceptional"
    assert T.label_type("Insightful Alluring Skills Bonus") == "Insight"
    assert T.label_type("Seeker +5") is None
    assert T._strip_label("Exceptional Alluring Skills Bonus") == "alluring skills bonus"
    assert T._strip_label("Good Luck +2") == "good luck"
    assert T._strip_label("Dodge +8%") == "dodge"


def _shard(**entries):
    return {"_meta": {}, "harvested": {k: {"provenance": "stated", "carrier": f"Item:{k}", "wiki_url": f"https://ddowiki.com/page/Item:{k.replace(' ', '_')}", **v}
                                       for k, v in entries.items()}}


def _rec(name, wiki, affixes):
    return {"source_item": name, "variant_id": name, "wiki_url": wiki,
            "affixes": [{"name": a[0], "type": a[1], "value": "1", **({"via": a[2]} if len(a) > 2 else {})} for a in affixes]}


def _xraises(fn, *a):
    try:
        fn(*a)
    except SystemExit as e:
        return str(e)
    raise AssertionError("expected SystemExit, nothing raised")


def _fixture():
    sh = _shard(**{
        "Strength": {"label": "Strength +3", "tooltip": "Strength +3: +3 Enhancement bonus to Strength."},
        "Seeker": {"label": "Exceptional Seeker +5", "tooltip": "Exceptional Seeker +5: Provides a +5 Insight bonus to confirm critical hits."},
        "Good Luck": {"label": "Good Luck +2", "tooltip": "Good Luck +2: This item gives a +2 Luck bonus to all saves and skill checks."},
        "Repair": {"label": "Repair Amplification", "tooltip": "Repair Amplification: +10 Enhancement bonus to repair healing."},
        "Rage Charges": {"label": "Rage Charges", "tooltip": "Rage Charges: 3 charges."},
        "Sneak Attack": {"label": "Sneak Attack", "tooltip": "+2 Artifact bonus to sneak attack dice."},
    })
    sh["harvested"]["Sneak Attack"]["wiki_url"] = "https://ddowiki.com/page/Set:Not_An_Item"
    recs = [
        _rec("Strength", "https://ddowiki.com/page/Item:Strength", [("Strength", "Enhancement")]),
        _rec("Seeker", "https://ddowiki.com/page/Item:Seeker", [("Seeker", "Insight")]),
        _rec("Good Luck", "https://ddowiki.com/page/Item:Good_Luck", [("Fortitude Save", "Luck", "Good Luck"), ("Bluff", "Luck", "Good Luck")]),
        _rec("Repair", "https://ddowiki.com/page/Item:Repair", [("Repair", "Competence")]),
        _rec("Rage Charges", "https://ddowiki.com/page/Item:Rage_Charges", [("Rage Charges", "Enhancement")]),
    ]
    adj = {"ruled": {"Repair": {"disposition": "mismatched-harvest", "why": "captured the amplification tooltip",
                                "evidence": "Repair Amplification: +10 Enhancement bonus to repair healing."}}}
    return sh, recs, adj


def test_cross_check_classifies_every_entry_and_stamps_the_population():
    sh, recs, adj = _fixture()
    st = T.cross_check(sh, recs, adj)
    assert st["names"] == 6 and st["compared"] == 4, st
    assert st["agree"] == 2 and st["agree_via_components"] == ["Good Luck"]
    assert [d["name"] for d in st["disagree_ruled"]] == ["Repair"] and st["disagree_ruled"][0]["disposition"] == "mismatched-harvest"
    assert st["label_disagrees_with_tooltip"] == [{"name": "Seeker", "stated": "Insight", "label_type": "Exceptional"}]
    assert st["no_stated_type"] == ["Rage Charges"]
    assert st["carrier_not_an_item"] == [{"name": "Sneak Attack", "carrier": "Item:Sneak Attack"}]


def test_an_unruled_disagreement_fails_and_names_the_fix():
    sh, recs, adj = _fixture()
    msg = _xraises(T.cross_check, sh, recs, {"ruled": {}})
    assert "Repair" in msg and "states Enhancement" in msg and "stores ['Competence']" in msg and "affix_type_corrections.json" in msg


def test_the_697_shape_a_carrier_re_typed_back_to_the_labels_type_fails():
    sh, recs, adj = _fixture()
    # A refresh re-types one Seeker carrier to Exceptional — the label's type,
    # which the tooltip contradicts. The harvested carrier still agrees; the
    # guard is the count of carriers at the label's type.
    recs.append(_rec("Other Helm", "https://ddowiki.com/page/Item:Other_Helm", [("Seeker", "Exceptional")]))
    msg = _xraises(T.cross_check, sh, recs, adj)
    assert "Seeker" in msg and "1 carrier(s) still store it at the label's type Exceptional" in msg


def test_a_stale_ruling_evidence_drift_and_a_bad_disposition_fail():
    sh, recs, adj = _fixture()
    stale = {"ruled": dict(adj["ruled"], Strength={"disposition": "mismatched-harvest", "why": "x", "evidence": "y"})}
    assert "Strength: ruling is stale" in _xraises(T.cross_check, sh, recs, stale)
    drift = {"ruled": {"Repair": dict(adj["ruled"]["Repair"], evidence="something else")}}
    assert "evidence is not the tooltip" in _xraises(T.cross_check, sh, recs, drift)
    bad = {"ruled": {"Repair": dict(adj["ruled"]["Repair"], disposition="ignore")}}
    assert "outside" in _xraises(T.cross_check, sh, recs, bad)


def test_zero_comparisons_over_a_populated_catalog_is_a_broken_check():
    sh, recs, adj = _fixture()
    # Break the carrier match: no record's URL resolves.
    for r in recs:
        r["wiki_url"] = "https://ddowiki.com/page/Nowhere"
    try:
        T.cross_check(sh, recs, {"ruled": {}})
    except ValueError as e:
        assert "compared zero names" in str(e)
    else:
        raise AssertionError("a run that compared nothing must not pass")
    assert T.cross_check(sh, [], {"ruled": {}})["compared"] == 0, "an empty catalog is the one honest zero"


def test_cross_check_reads_the_in_memory_affix_shape_too():
    sh, recs, adj = _fixture()
    for r in recs:
        r["affixes"] = [{"stat": a["name"], "bonus_type": a["type"], "value": 1, **({"via": a["via"]} if "via" in a else {})} for a in r["affixes"]]
    assert T.cross_check(sh, recs, adj)["compared"] == 4


def test_the_shipped_adjudications_cover_the_built_dataset_and_the_stamp_matches():
    if not os.path.exists(ITEMS):
        return
    data = json.load(open(ITEMS, encoding="utf-8"))
    st = T.cross_check(T.load_shard(), data["items"], T.load_crosscheck_adjudications())
    assert data["metadata"]["affix_type_cross_check"] == st, "the stamp is the check — rebuild after changing either"
    assert st["compared"] >= 170 and st["agree"] >= 160, st
    # The three rulings shipped: two harvest defects (the wrong tooltip was
    # captured for the key), one deliberate model divergence (#614 types a
    # cursed -1 as Penalty). None is a type defect in the catalog.
    by = {d["name"]: d["disposition"] for d in st["disagree_ruled"]}
    assert by == {"Armor Class": "mismatched-harvest", "Repair": "mismatched-harvest",
                  "Enhancement Bonus (Weapon)": "modelled-differently"}, by
    # #697, as a field: the label says Exceptional, the tooltip says Insight, and
    # no carrier stores Seeker at Exceptional any more.
    assert {"name": "Seeker", "stated": "Insight", "label_type": "Exceptional"} in st["label_disagrees_with_tooltip"]
    assert not any(a["name"] == "Seeker" and a.get("type") == "Exceptional" for it in data["items"] for a in it["affixes"])


def test_the_guard_fails_on_a_corrupted_type_in_the_real_data():
    if not os.path.exists(ITEMS):
        return
    data = json.load(open(ITEMS, encoding="utf-8"))
    sh = T.load_shard()
    url = sh["harvested"]["Strength"]["wiki_url"]
    items = copy.deepcopy(data["items"])
    flipped = 0
    for it in items:
        if T._norm_url(it.get("wiki_url")) == T._norm_url(url):
            for a in it["affixes"]:
                if a["name"] == "Strength":
                    a["type"] = "Quality"; flipped += 1
    assert flipped, "the harvested Strength carrier is in the dataset"
    msg = _xraises(T.cross_check, sh, items, T.load_crosscheck_adjudications())
    assert "Strength: the tooltip states Enhancement" in msg
