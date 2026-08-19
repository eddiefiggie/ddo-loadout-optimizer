"""U1 — the unserved-crafting-slot gate (`src/crafting_coverage.py`).

The gate exists because a snapshot refresh can strand a pool silently: upstream
renames a crafting-slot label, our pool keeps keying by the old one, and every
item declaring it ships an inert slot the compendium shows and the solver cannot
craft into. Nothing goes red — the data is still valid, it just buys nothing.

So most of what follows corrupts a configuration and asserts the failure, in both
directions the allowlist can rot (a NEW unserved label; an allowlisted label the
data no longer justifies) plus the per-pool vacuity that a retired pool trips.

The served side is asserted through each pool's REAL keying — `seal_type`,
`dino_type`, `fits_slots` — because two earlier heuristics string-matched pool
names against label text and falsely flagged the Sealed-in and dino pools. The
fixtures below therefore carry real record shapes, not label-shaped keys.

Discovered + run by tests/run_tests.py.
"""
import contextlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

sys.path.insert(0, ROOT)
from src import crafting_coverage as cc  # noqa: E402

# The baseline this unit converts into a gate: 35 declared labels no pool serves,
# across 415 item-slot declarations. A diff here is a finding to attribute, never
# a number to edit into agreement.
BASELINE_UNSERVED_LABELS = 35
BASELINE_UNSERVED_ITEM_SLOTS = 415


# --- helpers ------------------------------------------------------------------

def _built():
    with open(DATASET, "r", encoding="utf-8") as fh:
        return json.load(fh)


@contextlib.contextmanager
def allowlist(*labels):
    """Swap the module allowlist for the duration of a test."""
    saved = cc.UNSERVED_ALLOWLIST
    cc.UNSERVED_ALLOWLIST = frozenset(labels)
    try:
        yield
    finally:
        cc.UNSERVED_ALLOWLIST = saved


def raises_systemexit(fn):
    try:
        fn()
    except SystemExit as exc:
        return str(exc)
    raise AssertionError("expected SystemExit, the gate passed")


def item(name="Some Item", crafting=(), **extra):
    return {"source_item": name, "crafting": list(crafting), **extra}


def augment(name="Augment", colors=("Blue",)):
    return {"source_item": name, "category": "augment", "fits_slots": list(colors)}


def full_dataset(**overrides):
    """A minimal dataset with EVERY pool populated by its real keying, so a test
    can empty exactly one pool and know the failure is about that pool."""
    data = {
        "items": [augment("Topaz", ["Blue", "Colorless"])],
        "augment_set_defs": {"Arcane Barrier": {"fits_slots": ["Red"]}},
        "membership_set_defs": {
            "Forbidden Knowledge": {"tier": "heroic"},
            "Legendary Forbidden Knowledge": {"tier": "legendary"},
            "Dread Stalker": {"tier": "heroic"},
        },
        "viktranium": [{"slot_type": "Dolorous", "category": "Accessory"}],
        "nearly_complete": [{"category": "Ability Score"}],
        "dino_inserts": [{"dino_type": "Claw", "category": "Accessory"}],
        "seal": [{"seal_type": "Fire"}],
        "green_steel": [{"tier_key": "T1 (Equipment)"}],
        "thunder_forged": [{"tier": 1}],
    }
    data.update(overrides)
    return data


# --- scenario 1: the baseline holds -------------------------------------------

def test_baseline_holds_on_the_built_dataset():
    """S1. The gate passes on the current tree at exactly the measured baseline.

    Both halves are pinned: the label count AND the item-slot count. The label
    count alone would stay green while a rename moved 39 declarations from one
    allowlisted label onto another.
    """
    cov = cc.check(_built())

    assert cov["unserved_labels"] == BASELINE_UNSERVED_LABELS, cov["unserved"]
    assert cov["unserved_item_slots"] == BASELINE_UNSERVED_ITEM_SLOTS, cov["unserved"]
    assert cov["allowlisted"] == BASELINE_UNSERVED_LABELS
    assert cov["served_labels"] + cov["unserved_labels"] == cov["declared_labels"]


def test_the_gate_actually_inspected_every_pool():
    """A green run over empty pools would prove nothing. Each pool must have
    walked records AND contributed at least one label of its own."""
    cov = cc.check(_built())

    assert set(cov["pools"]) == set(cc.POOL_READERS)
    for name in cc.POOL_READERS:
        assert cov["pools"][name] > 0, f"{name} walked zero records"
        assert cov["pool_labels"][name] > 0, f"{name} served no label"


def test_the_pools_earlier_heuristics_falsely_flagged_are_served():
    """The regression the record-shape reading exists to prevent: `Sealed in Fire`
    is served by a pool keyed `Fire`, and `Claw` by one keyed `dino_type`."""
    served, _ = cc.served_labels(_built())

    assert served.get("Sealed in Fire") == "seal"
    assert served.get("Sealed in Undeath") == "seal"
    assert served.get("Claw") == "dino_inserts"
    assert served.get("Scale") == "dino_inserts"
    assert served.get("Nearly Complete: Ability Score") == "nearly_complete"
    assert served.get("Dolorous") == "viktranium"
    assert served.get("Red Augment Slot") == "augments"
    assert served.get("Lost Purpose") == "membership_set_defs"
    assert served.get("Legendary Lost Purpose") == "membership_set_defs"
    assert served.get(cc.DINO_SET_BONUS_LABEL) == "membership_set_defs"


def test_a_qualified_label_normalizes_to_the_pool_it_names():
    """`Claw (Accessory)` and `Fang (Armor)` are one slot each, not four, and
    green steel's `T1 (Equipment)` / `T1 (Weapon)` keys are one `T1` slot."""
    assert cc.base_label("Claw (Accessory)") == "Claw"
    assert cc.base_label("T1 (Equipment)") == "T1"
    assert cc.base_label("Red Augment Slot") == "Red Augment Slot"

    counts = cc.declared_labels({"items": [
        item(crafting=["Claw (Accessory)", "Fang (Armor)"]),
        item(crafting=["Claw (Armor)"]),
    ]})
    assert counts == {"Claw": 2, "Fang": 1}


# --- scenario 2: a new unserved label fails, by name --------------------------

def test_a_new_unserved_label_fails_and_names_it():
    """S2. Upstream ships a slot no pool fills — the exact drift a refresh causes."""
    data = full_dataset(items=[
        augment("Topaz", ["Blue"]),
        item("Legendary Whatsit", ["Blue Augment Slot", "Mysterious New Slot"]),
    ])

    msg = raises_systemexit(lambda: cc.check(data))

    assert "Mysterious New Slot" in msg
    assert "NO pool serves" in msg
    assert "Legendary Whatsit" in msg, "the failure must name a host to look at"


def test_a_renamed_pool_key_strands_its_slots_and_fails():
    """The refresh failure mode itself: the pool still walks records, but keys
    them by a name nothing declares, so every slot keyed to it goes inert."""
    data = full_dataset(
        items=[augment("Topaz", ["Blue"]), item("Sealed Blade", ["Sealed in Fire"])],
        seal=[{"seal_type": "Flame"}],   # upstream renamed Fire -> Flame
    )

    msg = raises_systemexit(lambda: cc.check(data))

    assert "'Sealed in Fire'" in msg
    assert "NO pool serves" in msg


def test_a_label_the_allowlist_covers_does_not_fail():
    """The allowlist is what keeps the 35 known gaps from being noise."""
    data = full_dataset(items=[
        augment("Topaz", ["Blue"]),
        item("Chains", ["Blue Augment Slot", "Slaver's Prefix Slot"]),
    ])

    with allowlist("Slaver's Prefix Slot"):
        cov = cc.check(data)

    assert cov["unserved"] == {"Slaver's Prefix Slot": 1}
    assert cov["unserved_item_slots"] == 1


# --- scenario 3+4: a retired pool, per named pool ------------------------------

def test_each_pool_raises_distinguishably_when_it_walks_zero_records():
    """S3 + S4. Vacuity is PER POOL: emptying any one pool must raise naming that
    pool, even though eight populated siblings are still walking records. An
    aggregate zero-inspection check passes every one of these."""
    empty = {
        "augments": {"items": []},
        "augment_set_defs": {"augment_set_defs": {}},
        "membership_set_defs": {"membership_set_defs": {}},
        "viktranium": {"viktranium": []},
        "nearly_complete": {"nearly_complete": []},
        "dino_inserts": {"dino_inserts": []},
        "seal": {"seal": []},
        "green_steel": {"green_steel": []},
        "thunder_forged": {"thunder_forged": []},
    }
    assert set(empty) == set(cc.POOL_READERS), "a pool was added without a vacuity case"

    for name, override in empty.items():
        msg = raises_systemexit(lambda: cc.check(full_dataset(**override)))
        assert "walked ZERO records" in msg, name
        # Distinguishable: the failure names THIS pool and no healthy sibling.
        named = msg.split("walked ZERO records: ")[1].split(" — ")[0]
        assert [n.strip() for n in named.split(",")] == [name], msg


def test_a_populated_sibling_cannot_vouch_for_a_dark_pool():
    """The aggregate-coverage trap, stated directly: the augment pool walks 1,000
    records and the seal pool walks none. Any total-inspection check is green."""
    data = full_dataset(
        items=[augment(f"Aug {i}", ["Blue", "Red"]) for i in range(1000)],
        seal=[],
    )

    msg = raises_systemexit(lambda: cc.check(data))

    assert "seal" in msg and "walked ZERO records" in msg


def test_an_empty_universe_of_declarations_refuses_to_pass():
    """No item declaring any crafting slot at all is not 'zero unserved slots'."""
    msg = raises_systemexit(lambda: cc.check(full_dataset(items=[augment()])))

    assert "no item declared a crafting slot" in msg


# --- scenario 5: the allowlist rots in the other direction --------------------

def test_a_stale_allowlist_entry_fails_when_the_label_is_no_longer_declared():
    """S5. The label was renamed or dropped upstream. A one-directional allowlist
    keeps vouching for it forever, and the next real gap hides in the noise."""
    data = full_dataset(items=[
        augment("Topaz", ["Blue"]),
        item("Chains", ["Blue Augment Slot", "Slaver's Prefix Slot"]),
    ])

    with allowlist("Slaver's Prefix Slot", "Slaver's Retired Slot"):
        msg = raises_systemexit(lambda: cc.check(data))

    assert "Slaver's Retired Slot" in msg
    assert "no longer declared by any item" in msg
    assert "stale exception" in msg


def test_an_allowlisted_label_a_pool_started_serving_fails():
    """The happy version of the same rot: we sourced a pool for a known gap and
    left the exception behind. Good news, still a stale entry."""
    data = full_dataset(items=[
        augment("Topaz", ["Blue"]),
        item("Sealed Blade", ["Sealed in Fire"]),
    ])

    with allowlist("Sealed in Fire"):
        msg = raises_systemexit(lambda: cc.check(data))

    assert "now SERVED" in msg
    assert "Sealed in Fire" in msg
    assert "seal" in msg


def test_the_shipped_allowlist_carries_no_stale_entry():
    """Measured against the live artifact rather than asserted: every allowlisted
    label is still declared by some item, and still unserved."""
    data = _built()
    declared = cc.declared_labels(data)
    served, _ = cc.served_labels(data)

    for label in cc.UNSERVED_ALLOWLIST:
        assert label in declared, f"{label!r} is allowlisted but nothing declares it"
        assert label not in served, f"{label!r} is allowlisted but {served[label]} serves it"


# --- scenario 6: the stamped count means validated ----------------------------

def test_the_stamped_count_is_the_validated_universe_not_the_walked_one():
    """S6. `labels_validated` counts declared labels that reached a VERDICT — not
    the 415+ declarations walked, and not the pool records read."""
    cov = cc.check(_built())

    assert cov["labels_validated"] == cov["declared_labels"]
    assert cov["labels_validated"] == cov["served_labels"] + cov["unserved_labels"]
    # The walked populations are strictly larger; conflating them would inflate
    # the claim about what was validated.
    assert cov["labels_validated"] < cov["unserved_item_slots"]
    assert cov["labels_validated"] < sum(cov["pools"].values())


def test_the_build_stamps_the_guards_own_numbers():
    """The metadata a reader trusts is the gate's own verdict, recomputed here
    rather than re-derived by a different predicate."""
    data = _built()
    stamped = data["metadata"]["crafting_slot_coverage"]

    assert stamped == cc.check(data)
    assert stamped["unserved_labels"] == BASELINE_UNSERVED_LABELS
    assert stamped["unserved_item_slots"] == BASELINE_UNSERVED_ITEM_SLOTS
    assert stamped["labels_validated"] == stamped["declared_labels"]
