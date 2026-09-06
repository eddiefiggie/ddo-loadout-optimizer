"""#495 — the curated location_quest -> adventure pack mapping and its coverage guard.

The load-bearing test is `test_no_source_value_is_unmapped`: it measures the shipped
mapping against the LIVE population, so a dataset refresh that introduces a new
`location_quest` cannot silently widen the unknown bucket. A dated claim about coverage
could not notice its own staleness; this fails the build instead.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import adventure_packs as AP  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _eq(a, b, msg=""):    assert a == b, f"{msg}\n  got:  {a!r}\n  want: {b!r}"
def _true(a, msg=""):     assert a, msg
def _in(a, b, msg=""):    assert a in b, f"{msg}: {a!r} not in {b!r}"


def _dataset():
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)


#: #729 — crafting sources whose OWN page states an expansion requirement in prose.
#: One entry, deliberately: each addition is a separate wiki read and a separate
#: widening of what the content filter can exclude.
CRAFTING_MAY_CARRY_A_PACK = {
    "Catalyst Crafting",                    # #729 — Terror of Demogorgon
    "Unholy Defiler of the Hidden Hand",    # #734 — Vecna Unleashed
    "Ritual Table",                         # #734 — Magic of Myth Drannor
}


def test_the_shard_loads_and_every_entry_states_its_evidence():
    m = AP.load()
    _true(m, "refusing to pass over an empty mapping")
    for name, e in m.items():
        _in(e["kind"], AP.KINDS, f"{name}: unknown kind")
        _true(e.get("via"), f"{name}: no wiki signal recorded — never infer a value")
        # #729 — a `crafting` entry may carry a pack, because the #246 filter reads
        # `location_pack` as "content the player must own" and an expansion-gated
        # crafting system fits that exactly. Allowlisted BY NAME rather than opened
        # to the whole kind: the other 16 crafting sources have not been re-read
        # against page prose, and a blanket relaxation would let the next one
        # acquire a pack without anyone stating the evidence.
        if e["kind"] == "crafting" and name in CRAFTING_MAY_CARRY_A_PACK:
            _true(e.get("pack"), f"{name}: allowlisted to carry a pack but carries none")
        elif e["kind"] != "pack-quest":
            _eq(e.get("pack"), None, f"{name}: only a quest can carry an adventure pack")


def test_a_pack_is_never_guessed_from_the_name():
    """The whole reason this is a curated seed rather than a regex.

    `Gianthold Tor` belongs to `Ruins of Gianthold`; no string operation gets there,
    and an entry whose pack merely echoes its own name would be the tell that one had
    been attempted."""
    m = AP.load()
    _eq(m["Gianthold Tor"]["pack"], "Ruins of Gianthold")
    _eq(m["The Chronoscope"]["pack"], "Devil Assault")
    _eq(m["Blue Water Inn"]["pack"], "Mists of Ravenloft")


def test_an_unknown_value_is_recorded_as_unknown_not_as_a_pack():
    m = AP.load()
    for name in ("Random", "N/A", "None", "Advance to level 15"):
        _eq(m[name]["kind"], "unknown", f"{name} is not a place")
        _eq(m[name]["pack"], None)


def test_the_non_quest_kinds_are_told_apart():
    m = AP.load()
    _eq(m["Morten Edgewright"]["kind"], "vendor")
    _eq(m["Ritual Table"]["kind"], "crafting")
    _eq(m["The Night Revels"]["kind"], "event")
    _eq(m["DDO Store"]["kind"], "store")


def test_apply_stamps_both_fields_on_every_record():
    m = {"Q": {"kind": "pack-quest", "pack": "P", "via": "test"}}
    recs = [{"location_quest": "Q"}, {"location_quest": "Unmapped"}, {}]
    AP.apply_to(recs, m)
    _eq((recs[0]["location_pack"], recs[0]["location_kind"]), ("P", "pack-quest"))
    # Absent and unknown are DIFFERENT facts; a renderer that cannot tell them apart
    # is how a silent gap becomes an invisible one.
    _eq((recs[1]["location_pack"], recs[1]["location_kind"]), (None, "unknown"))
    _eq((recs[2]["location_pack"], recs[2]["location_kind"]), (None, None))


def test_the_guard_refuses_to_inspect_zero_records():
    for recs, mapping in (([], {"a": {}}), ([{"location_quest": "x"}], {})):
        try:
            AP.check(recs, mapping)
        except AssertionError:
            continue
        raise AssertionError("the guard passed over an empty population")


def test_coverage_reports_both_populations_separately():
    """A count is a claim about a population — so report which one.

    Values and variants are different claims: the mapping covers 100% of source
    VALUES today and a different share of the gear a player sees."""
    m = AP.load()
    cov = AP.coverage(_dataset()["items"], m)
    _true(cov["distinct_values"] > 0)
    _true(cov["variants_sourced"] > cov["distinct_values"],
          "variants outnumber the values they share")
    _eq(sum(cov["by_kind_variants"].values()), cov["variants_sourced"],
        "every sourced variant lands in exactly one kind")
    _eq(sum(cov["by_kind_values"].values()), cov["distinct_values"])


def test_no_source_value_is_unmapped():
    """The coverage guard. A refresh that adds a new `location_quest` fails here
    rather than silently widening the unknown bucket."""
    cov = AP.check(_dataset()["items"], AP.load())
    _eq(cov["unmapped_values"], [],
        "new location_quest values appeared; add them to quest_adventure_packs.json")


def test_the_mapping_carries_no_entry_the_data_no_longer_has():
    """The other direction: a stale entry is dead weight that reads as coverage."""
    cov = AP.check(_dataset()["items"], AP.load())
    _eq(cov["stale_mapping_entries"], [],
        "the mapping names source values the dataset no longer carries")


def test_the_build_stamps_the_coverage_it_actually_achieved():
    md = _dataset()["metadata"]["adventure_pack_coverage"]
    _eq(md["unmapped_values"], [])
    _eq(md["distinct_mapped"], md["distinct_values"])
    _true(md["distinct_packs"] > 50, "the harvest found the real packs, not a handful")
    _true(md["variants_to_a_named_pack"] > 5000)


def test_every_variant_carries_the_two_fields():
    for v in _dataset()["items"]:
        _true("location_pack" in v and "location_kind" in v,
              f"{v.get('variant_id')}: the stage skipped a record")
