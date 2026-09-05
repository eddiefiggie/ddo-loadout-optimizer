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
    assert cov["names"] == 198 and cov["stated"] == 197, cov
    assert cov["unmatched"] == ["Minor Spell Penetration"]
    assert len(cov["unharvested"]) == 25
    assert [c["name"] for c in cov["candidates"]] == ["Dazing", "Dragon's Edge", "Improved Deception", "Orb Bonus", "Sundering"]
    assert cov["by_disposition"] == {"constant": ["Dazing", "Dragon's Edge", "Improved Deception", "Sundering"],
                                     "quarantine": [], "disclose": ["Orb Bonus"]}
    for name, e in sh["harvested"].items():
        assert e["provenance"] in ("stated", "unmatched"), name
        if e["provenance"] == "stated":
            assert e["tooltip"] and e["label"] and e["carrier"] and e["wiki_url"].startswith("https://ddowiki.com/page/Item:"), name
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
    assert cov["names"] == 198 and cov["by_disposition"]["disclose"] == ["Orb Bonus"]
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
