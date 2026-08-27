"""#547 — the `[Crafted]` twin identity: derivation, and the guards that retire it.

The identity exists so `web/model.js` can treat a block on either half of a pair
as a block on the item. That folding is only correct while the two records really
are one offer, so most of this file is about the ways they could stop being one —
each of which must fail the build rather than quietly keep folding.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import crafted_twins  # noqa: E402
from src import crafting_coverage  # noqa: E402

DATASET_PATH = os.path.join(ROOT, "web", "data", "items.json")
UNSERVED = crafting_coverage.UNSERVED_ALLOWLIST


def _rec(name, **over):
    base = {"source_item": name, "variant_id": name, "slot": "Trinket",
            "category": "item", "type": None, "artifact": False, "armor_type": None,
            "ml": 30, "affixes": [], "augment_slots_norm": {"colors": []},
            "sets": [], "joker_set_groups": [], "crafting": []}
    base.update(over)
    return base


def _pair(**crafted_over):
    """A base and its crafted twin, identical unless the caller diverges one."""
    base = _rec("Widget", affixes=[{"name": "Craftable Widget", "type": "Untyped", "value": "3"}])
    crafted = _rec("Widget [Crafted]",
                   crafting=["Essence Crafting: Trinket - Prefix"])
    crafted.update(crafted_over)
    return [base, crafted]


def _derive(variants, unserved=None):
    return crafted_twins.derive(variants, UNSERVED if unserved is None else unserved)


def _dataset():
    if not os.path.exists(DATASET_PATH):
        return None  # generated artifact; the build itself is the gate
    with open(DATASET_PATH) as fh:
        return json.load(fh)


# --- the happy path ------------------------------------------------------------

def test_a_pair_maps_both_halves_onto_the_base_name():
    r = _derive(_pair())
    assert r["problems"] == []
    assert r["identity"] == {"Widget": "Widget", "Widget [Crafted]": "Widget"}, \
        "both halves resolve to ONE identity, so a lookup need not know which it holds"
    assert r["pairs"] == [("Widget [Crafted]", "Widget")]


def test_a_record_in_no_pair_gets_no_identity():
    """9,020 records are only themselves. Stamping them all would be per-record
    bloat serving 45 pairs, and the consumer already falls back to the record's
    own key."""
    r = _derive(_pair() + [_rec("Unrelated Thing")])
    assert "Unrelated Thing" not in r["identity"]


def test_the_crafted_half_may_drop_affixes_the_base_carries():
    """That IS the relationship: the crafted state has spent its `Craftable`
    marker. Losing affixes is expected; gaining them is not."""
    assert _derive(_pair())["problems"] == []


# --- the ways a pair stops being one offer -------------------------------------

def test_an_orphaned_crafted_record_is_reported():
    r = _derive([_rec("Widget [Crafted]")])
    assert any("has no base record" in p for p in r["problems"]), r["problems"]
    assert "Widget [Crafted]" not in r["identity"], "an unproven pair is not folded"


def test_a_crafted_record_carrying_an_extra_affix_is_reported():
    """If it offers something its base does not, a block folding the two would
    now be removing value the player did not name."""
    r = _derive(_pair(affixes=[{"name": "Constitution", "type": "Insight", "value": "3"}]))
    assert any("carries affixes its base does not" in p for p in r["problems"]), r["problems"]


def test_a_disagreement_on_any_identity_field_is_reported():
    for field, value in (("slot", "Ring"), ("category", "augment"),
                         ("type", "Longswords"), ("artifact", True), ("ml", 32)):
        r = _derive(_pair(**{field: value}))
        assert r["problems"], f"a {field} disagreement must be reported"


def test_a_disagreement_on_augment_colours_sets_or_jokers_is_reported():
    for over, word in (({"augment_slots_norm": {"colors": ["Red"]}}, "augment colours"),
                       ({"sets": ["Some Set"]}, "set membership"),
                       ({"joker_set_groups": [["A", "B"]]}, "joker set groups")):
        r = _derive(_pair(**over))
        assert any(word in p for p in r["problems"]), (word, r["problems"])


def test_multiple_variants_under_one_name_are_reported():
    """The identity is name-to-name. If a base ever expands into tiers, the
    pairing no longer addresses one record and needs a variant-level key — a
    design change, not something to guess at."""
    pair = _pair()
    extra = _rec("Widget", variant_id="Widget (tier 2)")
    r = _derive(pair + [extra])
    assert any("multiple variants" in p for p in r["problems"]), r["problems"]


# --- the self-retiring guard (#193) --------------------------------------------

def test_a_served_crafting_label_retires_the_folding():
    """THE guard that makes this safe to ship. The folding rests on Essence
    Crafting being unmodelled: while its slots are inert the crafted state offers
    nothing extra, so it is the same offer. The day #193 wires those slots to a
    pool, the crafted record starts carrying capacity its base lacks — it becomes
    a genuinely distinct candidate, and the build must say so rather than keep
    silently folding a block across two different things.

    Simulated by removing the label from the unserved set, which is exactly what
    serving it would do."""
    served_now = frozenset(x for x in UNSERVED if x != "Essence Crafting: Trinket - Prefix")
    r = _derive(_pair(), unserved=served_now)
    assert any("now SERVED by a pool" in p and "#193" in p for p in r["problems"]), r["problems"]


def test_the_same_pair_is_clean_while_the_label_stays_inert():
    """The counterfactual for the test above — otherwise it proves only that
    `derive` can emit a problem, not that this specific condition causes it."""
    assert _derive(_pair())["problems"] == []


def test_a_crafting_label_the_base_already_had_is_not_an_addition():
    """Only labels the crafted state ADDS matter. A label both carry is not new
    capacity, so it must not trip the served check even if it were served."""
    base, crafted = _pair()
    base["crafting"] = ["Blue Augment Slot"]
    crafted["crafting"] = ["Blue Augment Slot", "Essence Crafting: Trinket - Prefix"]
    r = _derive([base, crafted], unserved=UNSERVED)
    assert r["problems"] == [], r["problems"]


# --- the shipped dataset --------------------------------------------------------

def test_the_shipped_catalog_derives_a_clean_pairing():
    data = _dataset()
    if data is None:
        return
    r = _derive(data["items"])
    assert r["problems"] == [], r["problems"]
    assert r["inspected"] == 45, f"45 `[Crafted]` records today, saw {r['inspected']}"
    assert len(r["pairs"]) == 45, "every one of them pairs; an orphan would be a problem"
    assert len(r["identity"]) == 90, "both halves of each pair are addressable"


def test_the_built_dataset_publishes_the_identity():
    data = _dataset()
    if data is None:
        return
    meta = data["metadata"]
    assert meta["crafted_twin_coverage"] == {"inspected": 45, "pairs": 45}
    identity = meta["crafted_twin_identity"]
    assert identity["Legendary Gem of Many Facets [Crafted]"] == "Legendary Gem of Many Facets", \
        "the item #547 was reported about"
    assert identity["Legendary Gem of Many Facets"] == "Legendary Gem of Many Facets", \
        "the base maps to itself, so the consumer never has to know which side it holds"
    # Non-vacuity: an absent key must mean "only itself", not "map missing".
    assert len(identity) == 90
    assert "Icon of the Bitterwind" not in identity


def test_every_shipped_pair_is_a_strict_affix_subset():
    """Read straight off the shipped dataset rather than through `derive`, so the
    claim is not just the derivation agreeing with itself."""
    data = _dataset()
    if data is None:
        return
    by_name = {}
    for it in data["items"]:
        by_name.setdefault(it.get("source_item"), []).append(it)
    checked = 0
    for name, recs in by_name.items():
        if not (name or "").endswith(crafted_twins.SUFFIX):
            continue
        base = by_name[name[: -len(crafted_twins.SUFFIX)]][0]
        crafted = recs[0]
        key = lambda a: (a.get("name"), a.get("type"), str(a.get("value")))  # noqa: E731
        assert {key(a) for a in crafted.get("affixes") or []} <= \
               {key(a) for a in base.get("affixes") or []}, name
        checked += 1
    assert checked == 45, f"the loop must actually inspect 45 pairs, saw {checked}"
