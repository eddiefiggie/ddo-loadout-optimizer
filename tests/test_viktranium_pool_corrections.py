"""#365 — the wiki-sourced Viktranium pool relocation and its guards.

gear-planner misfiles ``Woeful: Quality Spell Focus Mastery`` under ``Woeful
(Weapon)``; the wiki's Viktranium Experiment crafting page puts it in the
Accessories Wicked table. The shard relocates it so a caster wearing a Woeful
accessory can reach the +2 Quality DC the game grants them.

A relocation shard is only safe if it cannot go stale silently, and staleness
here runs in BOTH directions: upstream fixing the misfiling must retire the
shard (the correction becomes a dead edit), and upstream already offering the
option in the destination must fail too (the correction becomes a no-op). These
tests prove every guard fires, that the shipped shard passes against the real
catalog, and that the BUILT dataset carries the relocated option.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import viktranium_pool_corrections as vpc  # noqa: E402
from src import crafting_catalog  # noqa: E402
from src import name_corrections  # noqa: E402
from src import viktranium  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium",
                     "viktranium_pool_corrections.json")
CORRECTIONS = os.path.join(ROOT, "data", "seed", "compendium",
                           "affix_name_corrections.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")

OPTION = "Woeful: Quality Spell Focus Mastery"
FROM_POOL = "Woeful (Weapon)"
TO_POOL = "Woeful (Accessory)"


def _raises(exc, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc as e:
        return e
    raise AssertionError(f"expected {exc.__name__}, nothing raised")


def _rel(**over):
    rel = {
        "option": OPTION, "from": FROM_POOL, "to": TO_POOL, "ml": 34,
        "affixes": [{"name": "Spell Focus Mastery", "type": "Quality", "value": "2"}],
        "wiki_table": "Woeful (Accessories) — Wicked",
        "wiki_effect": "+2 Quality Bonus to spell DCs.",
        "wiki_url": "https://ddowiki.com/page/Viktranium_Experiment_crafting",
        "verified": "2026-08-17",
    }
    rel.update(over)
    return [rel]


def _catalog(src_option=None, dst_extra=None):
    if src_option is None:
        src_option = {"name": OPTION, "ml": 34,
                      "affixes": [{"name": "Spell Focus Mastery",
                                   "type": "Quality", "value": "2"}]}
    src = [{"name": "Woeful: Exceptional Spell Focus Mastery", "ml": 34,
            "affixes": [{"name": "Spell Focus Mastery",
                         "type": "Exceptional", "value": "2"}]}]
    if src_option:
        src.append(src_option)
    dst = [{"name": "Woeful Sacred DCs (legendary)", "ml": 34,
            "affixes": [{"name": "Spell Focus Mastery", "type": "Sacred", "value": "2"}]}]
    if dst_extra:
        dst.extend(dst_extra)
    return {FROM_POOL: {"*": src}, TO_POOL: {"*": dst}}


# ---------------------------------------------------------------------------
# The guards.
# ---------------------------------------------------------------------------

def test_a_clean_relocation_passes_and_counts():
    assert vpc.check(_rel(), _catalog()) == {TO_POOL: 1}


def test_upstream_fixing_the_misfiling_retires_the_shard():
    """Direction one: the option left the `from` pool — a dead correction."""
    err = _raises(SystemExit, vpc.check, _rel(), _catalog(src_option=False))
    assert "no longer in the 'Woeful (Weapon)' pool" in str(err)
    assert "retire this shard entry" in str(err)


def test_a_destination_that_already_offers_it_fails_as_a_no_op():
    """Direction two: upstream added it to the `to` pool — the move is a no-op."""
    cat = _catalog(dst_extra=[{"name": OPTION, "ml": 34,
                               "affixes": [{"name": "Spell Focus Mastery",
                                            "type": "Quality", "value": "2"}]}])
    err = _raises(SystemExit, vpc.check, _rel(), cat)
    assert "already present in the 'Woeful (Accessory)' pool" in str(err)
    assert "no-op" in str(err)


def test_a_moved_affix_vocabulary_fails_the_build():
    cat = _catalog(src_option={"name": OPTION, "ml": 34,
                               "affixes": [{"name": "Spell Focus Mastery",
                                            "type": "Insightful", "value": "2"}]})
    err = _raises(SystemExit, vpc.check, _rel(), cat)
    assert "no longer matches the recorded" in str(err)
    assert "re-verify against the wiki" in str(err)


def test_a_moved_value_fails_the_build():
    """The vocabulary anchor is (name, type, VALUE) — a re-valued option is not
    the option this shard vouched for."""
    cat = _catalog(src_option={"name": OPTION, "ml": 34,
                               "affixes": [{"name": "Spell Focus Mastery",
                                            "type": "Quality", "value": "3"}]})
    err = _raises(SystemExit, vpc.check, _rel(), cat)
    assert "no longer matches the recorded" in str(err)


def test_a_moved_ml_fails_the_build():
    cat = _catalog(src_option={"name": OPTION, "ml": 8,
                               "affixes": [{"name": "Spell Focus Mastery",
                                            "type": "Quality", "value": "2"}]})
    err = _raises(SystemExit, vpc.check, _rel(), cat)
    assert "the tier moved" in str(err)


def test_a_vanished_pool_fails_the_build():
    cat = _catalog()
    del cat[TO_POOL]
    err = _raises(SystemExit, vpc.check, _rel(), cat)
    assert "the catalog shape moved" in str(err)


def test_a_per_host_shaped_pool_fails_the_build():
    """A pool that stopped being a '*' menu is a shape change, not an empty pool."""
    cat = _catalog()
    cat[TO_POOL] = {"Some Host": []}
    err = _raises(SystemExit, vpc.check, _rel(), cat)
    assert "is not a '*' menu pool" in str(err)


def test_a_relocation_missing_its_evidence_fails_the_build():
    err = _raises(SystemExit, vpc.check, _rel(wiki_effect=""), _catalog())
    assert "an unevidenced correction is not a correction" in str(err)


def test_an_empty_shard_refuses_to_pass():
    _raises(ValueError, vpc.check, [], _catalog())


# ---------------------------------------------------------------------------
# The move itself.
# ---------------------------------------------------------------------------

def test_apply_moves_the_record_verbatim():
    cat = _catalog()
    before = dict(cat[FROM_POOL]["*"][-1])
    cov = vpc.apply(_rel(), cat)
    assert cov["relocated"] == 1
    assert cov["moves"] == [f"{OPTION} : {FROM_POOL} -> {TO_POOL}"]
    assert [o["name"] for o in cat[FROM_POOL]["*"]] == [
        "Woeful: Exceptional Spell Focus Mastery"]
    moved = cat[TO_POOL]["*"][-1]
    assert moved["name"] == OPTION
    # Verbatim: the destination gets the record that left the source, not a copy
    # rebuilt from the shard's own recorded vocabulary.
    assert moved == before


def test_apply_refuses_when_there_is_nothing_to_move():
    """apply() never silently no-ops if check() was skipped or bypassed."""
    err = _raises(SystemExit, vpc.apply, _rel(), _catalog(src_option=False))
    assert "the guard was bypassed" in str(err)


def test_apply_refuses_an_empty_shard():
    _raises(ValueError, vpc.apply, [], _catalog())


# ---------------------------------------------------------------------------
# The shipped shard, against the real catalog and the built dataset.
# ---------------------------------------------------------------------------

def test_the_shipped_shard_passes_against_the_real_catalog():
    """The integration fact: every shipped relocation is guarded clean and
    appliable, and the premise each rests on holds against the vendored snapshot
    (the option IS in its `from` pool and is NOT in its `to` pool).

    #386 widened this from one relocation to the shard's full set. A full audit of
    all four Lamordia families found the Woeful pools off by exactly -2 accessory
    and +2 weapon, and the pair is `Quality Spell Focus Mastery` (#365) and
    `Strength of Purpose` (#386) — both in the wiki's Woeful (Accessories) Wicked
    table, both carried by gear-planner under Weapon. Asserting a hard count of 1
    would fail the moment a sibling misfiling is corrected, which is not what this
    test is about; it asserts the shard is non-empty and that EVERY entry holds.
    """
    relocations = vpc.load(SHARD)
    assert relocations, "refusing to pass vacuously over an empty shard"
    catalog = crafting_catalog.load_catalog()
    # The build applies the crafting rename at the catalog's single load point,
    # above every family builder; check() runs against that same renamed state.
    name_corrections.apply(catalog, name_corrections.load(CORRECTIONS))
    for rel in relocations:
        opt, src, dst = rel["option"], rel["from"], rel["to"]
        assert opt in [o.get("name") for o in catalog[src]["*"]], \
            f"premise: upstream still misfiles {opt!r} under {src!r}"
        assert opt not in [o.get("name") for o in catalog[dst]["*"]], \
            f"premise: {dst!r} still lacks {opt!r}"
    expected = {}
    for rel in relocations:
        expected[rel["to"]] = expected.get(rel["to"], 0) + 1
    assert vpc.check(relocations, catalog) == expected
    assert vpc.apply(relocations, catalog)["relocated"] == len(relocations)
    for rel in relocations:
        assert rel["option"] not in [o.get("name") for o in catalog[rel["from"]]["*"]]
        assert rel["option"] in [o.get("name") for o in catalog[rel["to"]]["*"]]


def test_the_relocation_reaches_the_viktranium_builder():
    """What the player actually gets: build_viktranium reads the corrected pools,
    so the Quality DC option is emitted for the Accessory category."""
    catalog = crafting_catalog.load_catalog()
    name_corrections.apply(catalog, name_corrections.load(CORRECTIONS))
    vpc.apply(vpc.load(SHARD), catalog)
    records = viktranium.build_viktranium(catalog)["records"]
    hit = [r for r in records if r["name"] == OPTION]
    assert [r["category"] for r in hit] == ["Accessory"], hit
    assert hit[0]["slot_type"] == "Woeful"
    assert hit[0]["tier"] == "legendary"


def test_the_shipped_shard_carries_its_wiki_evidence_and_stale_guard():
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    meta = raw["_meta"]
    for field in ("title", "note", "vocabulary_rule", "evidence_rule", "stale_guard"):
        assert meta.get(field), f"_meta is missing {field!r}"
    # The stale guard must describe BOTH directions, or half of it is untested
    # prose. The tests above prove the code; this proves the record says so.
    guard = meta["stale_guard"].lower()
    assert "retire" in guard
    assert "no-op" in guard
    for rel in raw["relocations"]:
        for field in vpc.REQUIRED_FIELDS:
            assert rel.get(field), f"{rel.get('option')}: missing {field!r}"
        assert rel["affixes"], f"{rel['option']}: no recorded vocabulary"
        assert rel["wiki_url"].startswith("https://ddowiki.com/"), rel["wiki_url"]


def test_the_built_dataset_offers_the_quality_dc_on_accessories_only():
    """The defect, closed, in the artifact the browser fetches.

    Fails against the pre-change tree: before the relocation the option is
    emitted for the Weapon category, so an accessory host can never craft it.
    """
    with open(DATASET, encoding="utf-8") as fh:
        dataset = json.load(fh)
    hit = [r for r in dataset["viktranium"] if r["name"] == OPTION]
    assert hit, f"{OPTION} is absent from the built Viktranium pool"
    assert [r["category"] for r in hit] == ["Accessory"], \
        f"{OPTION} is still emitted for {[r['category'] for r in hit]}"
    # Its genuinely-weapon sibling must NOT have moved with it.
    sibling = [r for r in dataset["viktranium"]
               if r["name"] == "Woeful: Exceptional Spell Focus Mastery"]
    assert [r["category"] for r in sibling] == ["Weapon"], sibling
    # And the Woeful accessory pool now offers three DC bonus types, not two.
    dc_types = sorted({a["bonus_type"]
                       for r in dataset["viktranium"]
                       if r["slot_type"] == "Woeful" and r["category"] == "Accessory"
                       for a in r.get("affixes") or []
                       if a.get("stat", "").endswith(" Focus")})
    assert dc_types == ["Profane", "Quality", "Sacred"], dc_types


def test_the_build_pins_the_relocation_above_the_viktranium_builder():
    """A source-order pin: the relocation must land between the catalog load and
    build_viktranium, and nothing else in the suite would notice a swap."""
    src = open(os.path.join(ROOT, "build_dataset.py"), encoding="utf-8").read()
    load = src.index("crafting = crafting_catalog_mod.load_catalog()")
    check = src.index("vik_pool_mod.check(_vik_pool_relocations, crafting)")
    apply_ = src.index("vik_pool_mod.apply(_vik_pool_relocations, crafting)")
    build = src.index("vik = vik_mod.build_viktranium(crafting)")
    assert load < check < apply_ < build, \
        "the pool relocation must run below the catalog load and above build_viktranium"
