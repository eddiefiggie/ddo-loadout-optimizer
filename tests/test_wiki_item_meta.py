"""#906 — item metadata from our own wiki harvest: the infobox parser, the
vocabulary translation, never-infer, and the parity diff's classification."""
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import wiki_item_meta as W  # noqa: E402

_spec = importlib.util.spec_from_file_location("diff_harvest_meta", os.path.join(ROOT, "scripts", "diff_harvest_meta.py"))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)


def _page(body, title="Item:X", ts="2026-01-01T00:00:00Z"):
    return {"title": title, "revid": 1, "ts": ts, "wikitext": body}


WEAPON = """{{Named item|Weapon
  | name      = {{Item|Pick of Endless Light}}
  | type      = Light Pick <!-- a comment | with = signs -->
  | minimum level = 12
  | bind      = {{Bind|BtA|BoA}}
  | quest     = [[The Night Revels|Night Revels]]
  | enhancements =
* {{Enhancement bonus|w|4}}
}}"""


def test_the_infobox_parser_keeps_nested_pipes_and_equals_inside_their_template():
    pos, params = W.infobox(WEAPON)
    assert pos == ["Weapon"]
    assert params["bind"] == "{{Bind|BtA|BoA}}" and params["name"] == "{{Item|Pick of Endless Light}}"
    assert params["type"] == "Light Pick", "comments are stripped before parsing"


def test_a_weapon_reads_level_slot_plural_type_and_a_linked_quest():
    m = W.meta(_page(WEAPON))
    assert (m["ml"], m["slot"], m["type"], m["quests"]) == (12, "Weapon", "Light Picks", ["Night Revels"])
    assert m["problems"] == []


def test_the_old_and_new_level_names_both_read_and_a_disagreement_is_reported():
    assert W.meta(_page("{{Named item|Weapon\n|type=Dagger\n|minlevel=7\n}}"))["ml"] == 7
    m = W.meta(_page("{{Named item|Weapon\n|type=Dagger\n|minlevel=7\n|minimum level=9\n}}"))
    assert m["ml"] == 9 and any("disagree" in p for p in m["problems"])


def test_never_infer_an_unreadable_level_is_none_with_its_raw_text():
    for v in ("???", "{{Some template}}", ""):
        m = W.meta(_page("{{Named item|Weapon\n|type=Dagger\n|minlevel=" + v + "\n}}"))
        assert m["ml"] is None, v


def test_level_zero_is_the_catalogs_level_one():
    assert W.meta(_page("{{Named item|Clothing\n|slot=Head\n|minlevel=0\n}}"))["ml"] == 1


def test_jewelry_and_clothing_take_slot_and_type_from_the_body_slot():
    m = W.meta(_page("{{Named item|Jewelry\n|slot=Finger\n|type=Ring\n|minlevel=3\n}}"))
    assert (m["slot"], m["type"]) == ("Ring", "Finger items")
    m = W.meta(_page("{{Named item|Clothing\n|slot=Eye\n|minlevel=3\n}}"))
    assert (m["slot"], m["type"]) == ("Goggles", "Eye items")


def test_shields_armor_and_irregular_weapon_plurals_use_the_vocabulary():
    assert W.meta(_page("{{Named item|Shield\n|type=Tower\n}}"))["type"] == "Tower shields"
    assert W.meta(_page("{{Named item|Shield\n|type=Tower\n}}"))["slot"] == "Offhand"
    assert W.meta(_page("{{Named item|Armor\n|type=Docent\n}}"))["type"] == "Docents"
    assert W.meta(_page("{{Named item|Weapon\n|type=Khopesh\n}}"))["type"] == "Khopeshes"
    assert W.meta(_page("{{Named item|Weapon\n|type=Handaxe\n}}"))["type"] == "Hand Axes"


def test_a_value_outside_the_vocabulary_is_none_and_reported_never_guessed():
    m = W.meta(_page("{{Named item|Jewelry\n|slot=Tail\n}}"))
    assert m["slot"] is None and m["type"] is None and any("slot not stated" in p for p in m["problems"])
    assert W.meta(_page("no infobox here"))["problems"] == ["no {{Named item}} infobox"]


def test_a_quest_given_only_as_a_template_is_unread():
    assert W.meta(_page("{{Named item|Weapon\n|type=Dagger\n|quest={{Night Revels recipe|x}}\n}}"))["quests"] is None


def test_the_diff_classifies_equal_ruled_unread_wiki_changed_and_review():
    raw = [{"name": n, "url": "/page/Item:" + n, "ml": ml, "slot": "Weapon", "type": "Daggers", "quests": None}
           for n, ml in (("A", 5), ("B", 5), ("C", 5), ("E", 5), ("F", 5))]
    page = lambda n, lvl, ts="2026-01-01T00:00:00Z": _page(  # noqa: E731
        "{{Named item|Weapon\n|type=Dagger\n|minlevel=" + lvl + "\n}}", "Item:" + n, ts)
    pages = {"Item:A": page("A", "5"), "Item:B": page("B", "9"), "Item:C": page("C", "???"),
             "Item:E": page("E", "9", "2026-10-15T00:00:00Z"), "Item:F": page("F", "9")}
    rows, counts = D.diff(raw, pages, "2026-10-13T23:59:59Z", {}, {("B", "ml"): "wiki"})
    cls = {r["name"]: r["class"] for r in rows if r["field"] == "ml"}
    assert counts["ml:equal"] == 1
    assert cls == {"B": "ruled-wiki", "C": "ours-unread", "E": "wiki-changed", "F": "review"}


def test_every_committed_ruling_names_a_record_and_a_compared_field():
    with open(os.path.join(ROOT, "data", "seed", "compendium", "harvest_meta_rulings.json"), encoding="utf-8") as fh:
        rul = json.load(fh)["rulings"]
    with open(os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json"), encoding="utf-8") as fh:
        names = {r["name"] for r in json.load(fh)}
    assert rul, "a guard over zero rulings asserts nothing"
    for r in rul:
        assert r["name"] in names, f"ruling for {r['name']!r} names no record — stale"
        assert r["field"] in D.FIELDS and r["ruling"] in ("wiki", "gp") and r["why"]


DUAL = """{{Named item|Jewelry
  | type = Necklace
  | slot = Neck
  | minlevel = 8
  | tips = This unusual item can be worn in the Neck slot ''or'' the Waist slot - it will default to the Neck if both slots are empty when you equip it.
}}"""


def test_915_the_tips_state_a_second_worn_slot_in_catalog_vocabulary():
    m = W.meta(_page(DUAL))
    assert m["worn_slots"] == ["Necklace", "Belt"] and m["problems"] == []
    ring = DUAL.replace("Necklace", "Ring").replace("= Neck", "= Finger").replace(
        "in the Neck slot ''or'' the Waist slot", "in either Finger slot ''or'' the Trinket slot")
    assert W.meta(_page(ring))["worn_slots"] == ["Ring", "Trinket"]


def test_915_a_page_without_the_tip_states_one_slot():
    m = W.meta(_page(DUAL.replace("can be worn in the Neck slot ''or'' the Waist slot", "is damaged when found")))
    assert "worn_slots" not in m and m["problems"] == []


def test_915_a_reworded_second_slot_tip_is_refused_not_skipped():
    m = W.meta(_page(DUAL.replace("can be worn in the Neck slot ''or'' the Waist slot",
                                   "can be equipped in your Neck or Waist")))
    assert "worn_slots" not in m and any("second worn slot" in p for p in m["problems"])


def test_915_tips_that_do_not_include_the_infobox_slot_are_refused():
    m = W.meta(_page(DUAL.replace("= Neck", "= Wrist").replace("= Necklace", "= Bracers")))
    assert "worn_slots" not in m and any("infobox slot" in p for p in m["problems"])


def test_915_the_diff_classifies_the_other_slots_record_as_dual_slot():
    raw = [{"name": "Chains", "url": "/page/Item:Chains", "ml": 8, "slot": s, "type": t, "quests": None}
           for s, t in (("Belt", "Waist items"), ("Necklace", "Neck items"))]
    rows, counts = D.diff(raw, {"Item:Chains": _page(DUAL, "Item:Chains")}, "2026-10-13T23:59:59Z", {}, {})
    assert counts["slot:dual-slot"] == 1 and counts["type:dual-slot"] == 1 and counts["slot:equal"] == 1
    assert not any(r["class"] == "review" for r in rows)
