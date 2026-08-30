"""#285 — the crafted-predecessor backfill and its guards."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import crafting_lineage as CL  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _eq(a, b, msg=""):  assert a == b, f"{msg}\n  got:  {a!r}\n  want: {b!r}"
def _true(a, msg=""):   assert a, msg
def _in(a, b, msg=""):  assert a in b, f"{msg}: {a!r} not in {b!r}"


def _dataset():
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


def test_every_entry_names_a_kind_and_a_predecessor():
    m = CL.load()
    _true(m, "refusing to pass over an empty shard")
    for name, e in m.items():
        _in(e["kind"], CL.KINDS, f"{name}: unknown kind")
        _true(e.get("from"), f"{name}: no predecessor recorded")
        _true(e["from"] != name, f"{name}: points at itself")


def test_the_naming_pattern_holds_for_every_entry():
    """Asserted so a future entry that BREAKS it is caught — not to derive from.

    The wiki's own values are what ship; this checks they stay regular, because an
    irregular one is far more likely a transcription slip than a real exception. If
    a genuine exception ever appears, this test is where the decision gets made."""
    m = CL.load()
    for name, e in m.items():
        if e["kind"] == "epic-crafted":
            _true(name.startswith("Epic "), f"{name}: epic-crafted but not an Epic item")
            _eq(e["from"], name[len("Epic "):], f"{name}: predecessor is not its base")
        else:
            _true(name.startswith("Legendary "), f"{name}: legendary-crafted but not Legendary")
            _eq(e["from"], "Epic " + name[len("Legendary "):],
                f"{name}: a Legendary item's predecessor is its Epic tier")


def test_no_entry_came_from_a_template_flag():
    """#262's triage recorded that `epic = no` was initially misread as lineage."""
    for name, e in CL.load().items():
        _true(e["from"].strip().lower() not in ("no", "none", "yes"),
              f"{name}: predecessor is a template flag, not an item")


def test_the_predecessor_is_real_gear():
    """A disclosure naming an item the catalog lacks sends the player nowhere."""
    cov = CL.check(_dataset()["items"], CL.load())
    _eq(cov["dangling_predecessors"], [], "predecessors must resolve in the roster")


def test_the_guard_refuses_zero_records_and_an_empty_shard():
    for recs, shard in (([], {"a": {}}), ([{"variant_id": "x"}], {})):
        try:
            CL.check(recs, shard)
        except AssertionError:
            continue
        raise AssertionError("the guard passed over an empty population")


def test_a_stale_entry_fails_the_build():
    recs = [{"variant_id": "Real"}]
    try:
        CL.check(recs, {"Real": {"kind": "epic-crafted", "from": "Real"},
                        "Gone": {"kind": "epic-crafted", "from": "Real"}})
    except AssertionError as e:
        _in("Gone", str(e))
        return
    raise AssertionError("a shard entry naming an absent item passed")


def test_it_never_writes_location_quest():
    """The predecessor is an ITEM. Writing it into a quest field would make every
    surface that groups by source render a lie."""
    recs = [{"variant_id": "Epic X"}]
    CL.apply_to(recs, {"Epic X": {"kind": "epic-crafted", "from": "X"}})
    _eq(recs[0].get("location_quest"), None)
    _eq(recs[0]["location_lineage"], {"kind": "epic-crafted", "from": "X"})
    _eq(recs[0]["location_kind"], "crafting")


def test_an_item_that_already_has_a_source_keeps_its_kind():
    """The lineage is extra information about such an item, not a replacement."""
    recs = [{"variant_id": "Epic X", "location_quest": "Some Quest", "location_kind": "pack-quest"}]
    CL.apply_to(recs, {"Epic X": {"kind": "epic-crafted", "from": "X"}})
    _eq(recs[0]["location_kind"], "pack-quest", "an existing source is not overwritten")
    _true(recs[0]["location_lineage"], "but the lineage is still recorded")


def test_the_chain_composes_one_step_at_a_time():
    """Legendary -> Epic -> base -> a real quest. Each link is one wiki statement;
    collapsing them here would publish a claim no single page makes."""
    d = _dataset()
    by = {v["variant_id"]: v for v in d["items"]}
    leg = by["Legendary Chimera's Crown"]
    _eq(leg["location_lineage"]["from"], "Epic Chimera's Crown")
    epic = by[leg["location_lineage"]["from"]]
    _eq(epic["location_lineage"]["from"], "Chimera's Crown")
    base = by[epic["location_lineage"]["from"]]
    _true(base.get("location_quest"), "and the base carries a real quest")
    _eq(base.get("location_lineage"), None, "which is where the chain stops")


def test_the_build_stamps_what_it_reached():
    cov = _dataset()["metadata"]["crafting_lineage_coverage"]
    _eq(cov["unmatched_entries"], [])
    _eq(cov["stamped"], cov["entries"])
    _true(cov["kind_set_to_crafting"] > 100)


def test_the_backfilled_items_left_the_no_source_population():
    d = _dataset()
    lin = CL.load()
    for v in d["items"]:
        if v["variant_id"] in lin:
            _eq(v.get("location_kind"), "crafting",
                f"{v['variant_id']}: still unclassified after the backfill")
