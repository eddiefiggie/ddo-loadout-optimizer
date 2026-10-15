"""#879 — the `[Upgraded]` twin: how the record is built, and every way the build
refuses to build it.

The upgraded record is credited from upstream's pool, so the guards here matter
more than the happy path: a pool that drifts from the wiki transcription, a new
upstream host nobody read, or a transcription that no longer reaches its base
must each fail the build rather than ship a record nobody checked.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import planner_items  # noqa: E402
from src import upgraded_items  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _host(name, affixes, crafting=("Upgradeable Item",)):
    return {"name": name, "ml": 13, "slot": "Feet", "url": "/page/Item:" + name,
            "crafting": list(crafting),
            "affixes": [{"name": n, "type": t, "value": v} for n, t, v in affixes]}


def _pool(*affixes):
    return [{"affixes": [{"name": n, "type": t, "value": v} for n, t, v in affixes]}]


BOOTS = _host("Boots", [("Dexterity", "Enhancement", "4"), ("Telekinetic", "Bool", 1),
                        ("Madness", "Bool", 1)])
BOOTS_POOL = _pool(("Dexterity", "Enhancement", "6"), ("Greater Telekinetic", "Bool", 1),
                   ("Dodge", "Enhancement", "4"))
BOOTS_SHARD = {"upgrader": "Stormreaver", "upgrade": [
    {"replace": ["Dexterity", "Enhancement"], "to": ["Dexterity", "Enhancement", "6"]},
    {"replace": ["Telekinetic", "Bool"], "to": ["Greater Telekinetic", "Bool", "1"]},
    {"to": ["Dodge", "Enhancement", "4"]},
], "not_credited": ["Mythic Boot Boost +1 or +3"]}


def _expand(raw=None, pools=None, items=None):
    return upgraded_items.expand(
        raw if raw is not None else [BOOTS],
        pools if pools is not None else {"Boots": BOOTS_POOL},
        {"items": items if items is not None else {"Boots": BOOTS_SHARD}})


def _affixes(rec):
    return sorted((a["name"], a["type"], str(a["value"])) for a in rec["affixes"])


# ---- the record ----------------------------------------------------------------

def test_replacements_overwrite_renames_rename_and_additions_append():
    out = _expand()
    assert out["problems"] == [], out["problems"]
    (rec,) = out["records"]
    assert rec["name"] == "Boots [Upgraded]"
    assert _affixes(rec) == sorted([
        ("Dexterity", "Enhancement", "6"),        # 4 -> 6, never both
        ("Greater Telekinetic", "Bool", "1"),     # renamed, base name gone
        ("Dodge", "Enhancement", "4"),            # added
        ("Madness", "Bool", "1"),                 # untouched base affix kept
    ])
    assert rec["crafting"] == [], "the upgraded state has nothing left to upgrade"
    assert rec["url"] == BOOTS["url"], "one game item, one wiki page"
    assert rec["upgraded_from"]["item"] == "Boots"
    assert rec["upgraded_from"]["not_credited"] == ["Mythic Boot Boost +1 or +3"]


def test_both_records_map_onto_the_base_for_blocking():
    assert _expand()["identity"] == {"Boots": "Boots", "Boots [Upgraded]": "Boots"}


def test_the_base_record_is_not_modified():
    before = json.dumps(BOOTS, sort_keys=True)
    _expand()
    assert json.dumps(BOOTS, sort_keys=True) == before


def test_a_quarantined_pool_affix_is_left_off_and_disclosed():
    pool = _pool(("Dexterity", "Enhancement", "6"), ("Negative Lore", "Equipment", "5"))
    entry = {"upgrade": [{"replace": ["Dexterity", "Enhancement"],
                          "to": ["Dexterity", "Enhancement", "6"]}],
             "quarantined": [{"pool": ["Negative Lore", "Equipment", "5"], "reason": "wiki says 15"}]}
    host = _host("Boots", [("Dexterity", "Enhancement", "4")])
    out = _expand([host], {"Boots": pool}, {"Boots": entry})
    assert out["problems"] == []
    (rec,) = out["records"]
    assert _affixes(rec) == [("Dexterity", "Enhancement", "6")]
    assert any("Negative Lore 5" in n and "wiki says 15" in n for n in rec["upgraded_from"]["not_credited"])


def test_emit_writes_the_wiki_name_for_the_pool_value():
    host = _host("Boots", [("Speed", "Enhancement", "20")])
    entry = {"upgrade": [{"replace": ["Speed", "Enhancement"], "to": ["Speed", "Enhancement", "30"],
                          "emit": ["Movement Speed", "Enhancement", "30"]}]}
    out = _expand([host], {"Boots": _pool(("Speed", "Enhancement", "30"))}, {"Boots": entry})
    assert _affixes(out["records"][0]) == [("Movement Speed", "Enhancement", "30")]


def test_a_no_stat_upgrade_makes_no_record():
    host = _host("Litany", [("Taint of Evil", "Bool", 1)])
    out = _expand([host], {}, {"Litany": {"no_stat_upgrade": "removes a drawback only"}})
    assert out["problems"] == [] and out["records"] == []
    assert out["coverage"]["no_stat_upgrade"] == 1


# ---- the refusals ----------------------------------------------------------------

def test_a_pool_value_that_drifts_from_the_transcription_fails():
    pool = _pool(("Dexterity", "Enhancement", "7"), ("Greater Telekinetic", "Bool", 1),
                 ("Dodge", "Enhancement", "4"))
    out = _expand(pools={"Boots": pool})
    assert out["records"] == []
    assert any("no longer matches the wiki transcription" in p for p in out["problems"])


def test_an_untranscribed_upstream_host_fails():
    other = _host("Gloves", [])
    out = _expand(raw=[BOOTS, other], pools={"Boots": BOOTS_POOL, "Gloves": _pool()})
    assert any("'Gloves' is an upstream" in p for p in out["problems"])


def test_a_transcribed_host_upstream_dropped_fails():
    out = _expand(raw=[_host("Boots", [], crafting=())])
    assert any("no upstream record marks it" in p for p in out["problems"])


def test_a_replace_target_the_base_lacks_fails():
    host = _host("Boots", [("Telekinetic", "Bool", 1)])
    out = _expand(raw=[host])
    assert any("replaces ('Dexterity', 'Enhancement')" in p and "0 times" in p for p in out["problems"])


def test_a_pool_with_more_than_one_option_fails():
    out = _expand(pools={"Boots": BOOTS_POOL + BOOTS_POOL})
    assert any("expected a one-option pool" in p for p in out["problems"])


def test_a_no_stat_ruling_fails_once_upstream_carries_a_pool():
    host = _host("Litany", [])
    out = _expand([host], {"Litany": _pool(("Dodge", "Enhancement", "1"))},
                  {"Litany": {"no_stat_upgrade": "x"}})
    assert any("now carries a pool" in p for p in out["problems"])


# ---- the real shard against the real upstream dump ----------------------------------

def test_the_shipped_shard_matches_upstream_with_no_problems():
    with open(planner_items.RAW_PATH, encoding="utf-8") as fh:
        raw = json.load(fh)
    out = upgraded_items.expand(raw, upgraded_items.load_pools(), upgraded_items.load_shard())
    assert out["problems"] == [], out["problems"]
    assert out["coverage"] == {"hosts": 25, "upgraded_records": 24, "no_stat_upgrade": 1,
                               "quarantined_affixes": 1}


def test_every_transcribed_upgrade_quotes_its_wiki_block():
    shard = upgraded_items.load_shard()
    for name, entry in shard["items"].items():
        assert entry.get("wiki"), f"{name}: no wiki lines recorded"
        assert entry.get("upgrader") in ("Stormreaver", "Black Abbot"), name


# ---- the built dataset ------------------------------------------------------------

def _built():
    if not os.path.exists(DATASET):
        return None
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def _by_source(data):
    return {v["source_item"]: v for v in data["items"]}


def test_the_built_dataset_ships_every_twin_paired_and_verified():
    data = _built()
    if data is None:
        return
    by = _by_source(data)
    ups = [v for n, v in by.items() if n.endswith(" [Upgraded]")]
    assert len(ups) == 24
    assert all(v.get("verification") == "verified" for v in ups)
    ident = data["metadata"]["upgraded_twin_identity"]
    for v in ups:
        base = v["source_item"][: -len(" [Upgraded]")]
        assert base in by, base
        assert ident[v["source_item"]] == base and ident[base] == base
        assert v["upgraded_from"]["item"] == base


def test_the_striding_upgrades_survive_the_page_joined_speed_harvest():
    """The upgraded record shares its base's wiki page, and the speed harvest joins
    by page — without `emit` the base's 20% overwrote the upgraded 30%."""
    data = _built()
    if data is None:
        return
    by = _by_source(data)
    for name in ("Madstone Boots [Upgraded]", "Quiver of Alacrity [Upgraded]"):
        speed = [(a["name"], a["value"]) for a in by[name]["affixes"] if "Speed" in a["name"]]
        assert speed == [("Movement Speed", "30")], (name, speed)


def test_the_quarantined_void_lore_is_not_credited():
    data = _built()
    if data is None:
        return
    v = _by_source(data)["Wretched Twilight [Upgraded]"]
    assert not [a for a in v["affixes"] if "Lore" in a["name"]]


def test_the_twins_carry_the_base_records_corrections():
    data = _built()
    if data is None:
        return
    by = _by_source(data)
    sa = [(a["type"], a["value"]) for a in by["Treason [Upgraded]"]["affixes"]
          if a["name"] == "Deception" and a["type"] != "Bool"]
    assert sa == [("Enhancement", "4")], sa
    me = [(a["type"], a["value"]) for a in by["Staff of the Petitioner [Upgraded]"]["affixes"]
          if a["name"] == "Magical Efficiency"]
    assert me == [("Enhancement", "10")], me
