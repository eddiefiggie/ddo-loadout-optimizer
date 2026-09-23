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


# A label NO pool serves. Read from the authority instead of hardcoded, because a
# hardcoded one has now rotted twice in the same way: the fixture said
# `Essence Crafting: Trinket - Prefix` until #193 wired those menus, then
# `Essence Crafting: Rune Arm - Prefix` until #764 wired the other three families.
# Each time, every "the pair is clean" test silently flipped to asserting the
# DIVERGENT case — green, and testing the opposite of its name.
#
# `UNSERVED_ALLOWLIST` is the set of labels the build asserts no pool fills, so
# taking one from it cannot drift from what the gate believes. Sorted for
# determinism, and `test_the_inert_label_is_really_inert` fails loudly if the
# allowlist ever empties rather than leaving these tests vacuous.
INERT_LABEL = sorted(crafting_coverage.UNSERVED_ALLOWLIST)[0]


def _pair(**crafted_over):
    """A base and its crafted twin, identical unless the caller diverges one."""
    base = _rec("Widget", affixes=[{"name": "Craftable Widget", "type": "Untyped", "value": "3"}])
    crafted = _rec("Widget [Crafted]", crafting=[INERT_LABEL])
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
    r = _derive(_pair())
    assert r["problems"] == []
    assert r["capacity_divergent"] == [], "an inert label is not divergence"


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

def test_a_served_crafting_label_marks_the_pair_capacity_divergent():
    """THE guard, and it has now FIRED (#193 wired the Gem's Trinket menus).

    It used to fail the build, on the reasoning that a crafted record carrying
    capacity its base lacks is no longer "the same offer". That is true, and it
    changed nothing about what this module does — because the clause conflated two
    questions and only one of them turned:

      * interchangeable to the SOLVER? No longer. The crafted Gem has three
        craftable menus and can beat its own base, so it must stay a distinct
        candidate. This module never touched candidacy or dominance.
      * ONE GAME ITEM to the player? Still yes — and that is the only question
        `block_identity` answers. Someone blocking the Gem does not own it, and
        does not own the version they would have crafted from it either. Dropping
        the fold would hand them the twin, which IS the #547 report.

    So it is recorded rather than raised. Every other clause still fails the build.
    """
    served_now = frozenset(x for x in UNSERVED if x != INERT_LABEL)
    r = _derive(_pair(), unserved=served_now)
    assert r["problems"] == [], "a served label is no longer a build failure"
    assert len(r["capacity_divergent"]) == 1, r["capacity_divergent"]
    entry = r["capacity_divergent"][0]
    assert entry["served_labels"] == [INERT_LABEL]
    # The fold SURVIVES: this is the property the whole module exists for.
    assert r["identity"][entry["crafted"]] == entry["base"], \
        "the block identity must survive divergence — losing it re-opens #547"


def test_the_same_pair_is_clean_while_the_label_stays_inert():
    """The counterfactual for the test above — otherwise it proves only that
    `derive` can emit a problem, not that this specific condition causes it."""
    r = _derive(_pair())
    assert r["problems"] == []
    assert r["capacity_divergent"] == [], "an inert label is not divergence"


def test_a_crafting_label_the_base_already_had_is_not_an_addition():
    """Only labels the crafted state ADDS matter. A label both carry is not new
    capacity, so it must not trip the served check even if it were served."""
    base, crafted = _pair()
    base["crafting"] = ["Blue Augment Slot"]
    crafted["crafting"] = ["Blue Augment Slot", INERT_LABEL]
    r = _derive([base, crafted], unserved=UNSERVED)
    assert r["problems"] == [], r["problems"]
    assert r["capacity_divergent"] == [], "a shared label is not added capacity"



# --- 397c673: the `[Crafted]` family is GONE from upstream -----------------------
#
# The refresh collapsed all 45 `X [Crafted]` records onto their base name, keeping
# the base name and the SMALLER pre-craft affix block. There is no twin to pair
# with any more, so every population below is 0.
#
# The machinery is NOT deleted: `web/model.js` still folds a block on either half,
# and upstream may restore the split. What the zeros must not become is a vacuous
# green — "0 pairs" is exactly the shape a broken derivation also produces. So each
# zero here is paired with an INDEPENDENT proof of its premise read from the raw
# snapshot (`_raw_crafted_names()`): the family is absent because upstream stopped
# emitting it, not because `derive` stopped finding it. If upstream brings the
# suffix back, that helper goes non-empty and these tests go red for re-ratification.
EXPECTED_PAIRS = 0


def _raw_crafted_names():
    """`[Crafted]` item names in the vendored raw dump — the premise, read at source."""
    raw_path = os.path.join(ROOT, "data", "seed", "compendium", "raw",
                            "gearplanner_items.json")
    with open(raw_path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return sorted(i["name"] for i in raw
                  if isinstance(i.get("name"), str)
                  and i["name"].endswith(crafted_twins.SUFFIX))


def test_the_crafted_suffix_really_is_absent_upstream():
    """The premise every zero below rests on, asserted once and at source."""
    assert _raw_crafted_names() == [], (
        "upstream carries `[Crafted]` records again — the 397c673 collapse has been "
        "reverted. Re-ratify EXPECTED_PAIRS and the coverage block deliberately; the "
        "pairing tests below are currently pinned at zero.")


# --- the shipped dataset --------------------------------------------------------

def test_the_shipped_catalog_derives_a_clean_pairing():
    data = _dataset()
    if data is None:
        return
    r = _derive(data["items"])
    assert r["problems"] == [], r["problems"]
    assert r["inspected"] == EXPECTED_PAIRS, (
        f"expected {EXPECTED_PAIRS} `[Crafted]` records, saw {r['inspected']}")
    assert len(r["pairs"]) == EXPECTED_PAIRS
    assert len(r["identity"]) == 2 * EXPECTED_PAIRS
    assert _raw_crafted_names() == [], "the zero above must be upstream's, not the derivation's"


def test_the_built_dataset_publishes_the_identity():
    data = _dataset()
    if data is None:
        return
    meta = data["metadata"]
    # #193 — four pairs are now capacity-divergent: the three Gem of Many Facets
    # tiers and the blank `Trinket [Crafted]`, all of which declare the three
    # Trinket Essence menus the `essence_crafting` pool now serves. They are still
    # ONE ITEM for blocking, which is what `crafted_twin_identity` is for.
    assert meta["crafted_twin_coverage"] == {
        # #764 — 45 not 4. Every `[Crafted]` Rune Arm, Ring and Melee twin now
        # carries a SERVED label its base does not, which is precisely what
        # capacity divergence means. +41, matching the 41 hosts the Essence pool
        # started serving. Recorded rather than raised, by this module's design.
        # 397c673 — 0 not 45: upstream collapsed the whole `[Crafted]` family onto
        # the base names, so there is nothing left to pair or to diverge.
        "inspected": 0, "pairs": 0, "capacity_divergent": 0}
    assert _raw_crafted_names() == [], "the zeros above must be upstream's"
    divergent = {d["crafted"] for d in meta["crafted_twin_identity_divergent"]}
    # #764 — the set was the four Trinket declarers; it is now every crafted twin
    # that declares a served Essence menu, across all four families. Naming all 45
    # would pin a roster that moves whenever a blank is added, so this pins the
    # PROPERTY instead: the original four are still in it, and every member's
    # divergence is an Essence label rather than something unrelated that crept in.
    assert divergent == set(), sorted(divergent)
    for d in meta["crafted_twin_identity_divergent"]:
        assert d["served_labels"], f"{d['crafted']} is divergent for no stated label"
        assert all(l.startswith("Essence Crafting: ") for l in d["served_labels"]), d
    identity = meta["crafted_twin_identity"]
    # #547's own item survives the collapse under its base name alone, so the map
    # is empty rather than self-mapping: an absent key already means "only itself".
    assert "Legendary Gem of Many Facets [Crafted]" not in identity
    assert identity == {}
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
    assert checked == EXPECTED_PAIRS, (
        f"the loop inspected {checked} pairs, expected {EXPECTED_PAIRS}")
    assert _raw_crafted_names() == [], "the zero above must be upstream's, not this loop's"


def test_the_inert_label_is_really_inert():
    """#764 — the fixture's INERT_LABEL is only useful while nothing serves it, and
    it has silently stopped being inert twice. Reading it from UNSERVED_ALLOWLIST
    removes the hardcoded drift; this pins the rest:

      * the allowlist is non-empty, so INERT_LABEL is a real label and these tests
        are not asserting against `None`;
      * the built dataset agrees the label is unserved, so the allowlist itself has
        not gone stale in the other direction.

    A test whose fixture quietly starts exercising the opposite case is worse than a
    missing test, because it reports success for it."""
    assert crafting_coverage.UNSERVED_ALLOWLIST, "no unserved label left to build the fixture from"
    assert INERT_LABEL
    with open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8") as fh:
        meta = json.load(fh)["metadata"]
    unserved = (meta.get("crafting_slot_coverage") or {}).get("unserved") or {}
    served_somewhere = INERT_LABEL not in unserved
    assert not served_somewhere, (
        f"{INERT_LABEL!r} is on UNSERVED_ALLOWLIST but the build does not report it "
        "unserved — the fixture would be exercising the divergent case again")
