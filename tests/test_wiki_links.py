"""Wiki links for where gear and augments come from, and the guard on the harvest."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import wiki_links as wl  # noqa: E402
from src import adventure_packs as packs  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _aug(name, **kw):
    return dict({"variant_id": name, "category": "augment"}, **kw)


def _links(named=None, packs_=("Ruins of Gianthold",)):
    return {"named": named if named is not None else {}, "common_prefix": "Item:",
            "packs": set(packs_), "crafting": {"vik": "Viktranium Experiment crafting"}}


def _raises(fn, needle):
    try:
        fn()
    except AssertionError as e:
        assert needle in str(e), str(e)
        return str(e)
    raise AssertionError("expected the guard to fail")


def test_page_url_encodes_as_the_wiki_does():
    assert wl.page_url("Gianthold Tor") == "https://ddowiki.com/page/Gianthold_Tor"
    assert wl.page_url("Item:Diamond of Constitution +12") \
        == "https://ddowiki.com/page/Item:Diamond_of_Constitution_%2B12"
    assert wl.page_url("Delera's Tomb") == "https://ddowiki.com/page/Delera%27s_Tomb"
    assert wl.page_url("Locked Away (Part One)") == "https://ddowiki.com/page/Locked_Away_(Part_One)"
    # A `?` or `#` in a title would otherwise start a query or a fragment.
    assert "?" not in wl.page_url("Why?") and "#" not in wl.page_url("A#B")


def test_gear_links_only_titles_the_pack_harvest_read():
    mapping = {"Gianthold Tor": {"kind": "pack-quest", "pack": "Ruins of Gianthold", "via": "Quest infobox"},
               "Nowhere Page": {"kind": "unknown", "pack": None, "via": "no wiki page"}}
    recs = [{"variant_id": "A", "location_quest": "Gianthold Tor", "location_pack": "Ruins of Gianthold"},
            {"variant_id": "B", "location_quest": "Nowhere Page", "location_pack": None},
            {"variant_id": "C", "location_quest": "Unmapped", "location_pack": "Unverified Pack"}]
    wl.apply(recs, _links(), mapping)
    assert recs[0]["location_url"] == "https://ddowiki.com/page/Gianthold_Tor"
    assert recs[0]["location_pack_url"] == "https://ddowiki.com/page/Ruins_of_Gianthold"
    assert "location_url" not in recs[1], "the harvest found no page, so there is no link"
    assert "location_url" not in recs[2], "a title the harvest never read is not linked"
    assert "location_pack_url" not in recs[2], "a pack not confirmed to exist is not linked"


def test_augments_are_linked_by_the_ruling_that_covers_them():
    named = {"Legendary Sapphire of Riposte": {"page": "Item:Legendary Sapphire of Riposte", "locations": [
                {"place": "Item:Hunter Rune", "how": "purchasable augments", "detail": "(1250) Hunter Rune"}]},
             "Solar Gem of Attack (Epic)": {"page": None}}
    recs = [_aug("Diamond of Constitution +12", acquirable=True),
            _aug("Legendary Sapphire of Riposte"), _aug("Solar Gem of Attack (Epic)")]
    wl.apply(recs, _links(named), {})
    common, rip, epic = recs
    assert common["augment_page_url"].endswith("Item:Diamond_of_Constitution_%2B12")
    assert "augment_locations" not in common, "a common augment is not farmed from a place"
    assert rip["augment_locations"][0] == {
        "place": "Hunter Rune", "place_url": "https://ddowiki.com/page/Item:Hunter_Rune",
        "how": "purchasable augments", "detail": "(1250) Hunter Rune"}, \
        "an item-as-place reads as the item's name and links to the item's page"
    assert "augment_page_url" not in epic and "augment_locations" not in epic, \
        "no page means no link and no location — never a guessed one"


def test_check_refuses_to_inspect_nothing():
    _raises(lambda: wl.check([], _links({"x": {"page": None}}), {}), "zero records")
    _raises(lambda: wl.check([_aug("x")], _links({}), {}), "harvest is empty")


def test_check_fails_on_a_named_augment_that_was_never_harvested():
    recs = [_aug("Harvested"), _aug("Brand New Augment")]
    msg = _raises(lambda: wl.check(recs, _links({"Harvested": {"page": None}}), {}), "never harvested")
    assert "Brand New Augment" in msg and "Re-harvest" in msg


def test_check_fails_on_a_harvested_name_that_matches_nothing():
    """An upstream rename orphans the entry and the renamed gem goes sourceless."""
    recs = [_aug("Harvested")]
    msg = _raises(lambda: wl.check(recs, _links({"Harvested": {"page": None}, "Old Name": {"page": None}}), {}),
                  "match nothing")
    assert "Old Name" in msg


def test_check_fails_on_a_pack_with_no_verified_page():
    recs = [_aug("A")]
    mapping = {"Q": {"kind": "pack-quest", "pack": "Brand New Pack", "via": "x"},
               "F": {"kind": "pack-quest", "pack": "Free to Play", "via": "x"}}
    msg = _raises(lambda: wl.check(recs, _links({"A": {"page": None}}), mapping), "no verified page")
    assert "Brand New Pack" in msg and "Free to Play" not in msg, \
        "Free to Play is the wiki saying 'no pack', so there is nothing to verify"


def test_the_real_shards_cover_the_real_catalog():
    links = wl.load()
    assert len(links["named"]) == 472, len(links["named"])
    with_page = [n for n, e in links["named"].items() if e.get("page")]
    assert len(with_page) == 390
    no_page = sorted(set(links["named"]) - set(with_page))
    assert all(n.endswith("(Epic)") and n.split(" ")[0] in ("Solar", "Lunar") for n in no_page), \
        "the recorded no-page set is exactly the Epic Solar/Lunar gems"
    assert links["common_prefix"] == "Item:"
    mapping = packs.load()
    wanted = {e["pack"] for e in mapping.values() if e.get("pack") and e["pack"] != "Free to Play"}
    assert wanted <= links["packs"], sorted(wanted - links["packs"])
    for title in links["crafting"].values():
        assert title and "Lamordia" not in title


def test_the_built_dataset_carries_the_links():
    if not os.path.exists(DATASET):
        raise AssertionError("web/data/items.json is missing — build it first; a skip here would read as a pass")
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    cov = d["metadata"]["wiki_link_coverage"]
    assert cov["augments_linked"] == 675 + 390, cov
    assert cov["augments_with_locations"] == 390, cov
    assert len(cov["named_without_page"]) == 82
    assert cov["gear_source_linked"] > 0.9 * cov["gear_sourced"], cov
    rip = next(v for v in d["items"] if v["variant_id"] == "Legendary Sapphire of Riposte")
    assert {l["place"] for l in rip["augment_locations"]} == {
        "ToEE: Depths of the Temple", "ToEE: First Level and Earth Temple", "ToEE: Lower Temple Complex"}
    assert d["metadata"]["wiki_crafting_urls"]["vik"] \
        == "https://ddowiki.com/page/Viktranium_Experiment_crafting"
