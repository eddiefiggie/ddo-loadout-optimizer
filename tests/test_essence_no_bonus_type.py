"""#832 — the four Essence Crafting effects that have NO bonus type at all.

The bench offered a bonus-type picker for these. That is wrong in the sense
`web/wizard.js::canDeclareCredit` already records for the declared-credit
control: "the credit control asks the player to pick a BONUS TYPE, and this stat
has none. Every choice is wrong — `Untyped` keys a bucket the gear cannot join,
so the two would sum into a double-count, and any other type names a bucket
nothing in the game supplies."

This is DISTINCT from unsourced. Unsourced means the wiki has not told us what
the type is; these have none to tell, for two separately-checkable reasons:

  - `untyped` — every carrier in the catalog spells the affix `Untyped` and not
    one spells it with a type (`Tendon Slice`, 28 carriers).
  - `dice` — the crafting table publishes the magnitude as dice (`6d6`, `3d2`),
    which is an on-hit proc rather than a bonus.

Neither is dated: `assert_no_bonus_type_still_holds` re-derives both from the
built data on every build, so an effect that gains a typed carrier upstream
fails rather than staying silently untyped.
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import essence_placements  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _real():
    """The published placement rows and the catalog's (name, type) affix pairs."""
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    recs = []

    def walk(o):
        if isinstance(o, dict):
            if "effect" in o and ("type_sourced" in o or "bonus_type" in o):
                recs.append(o)
            else:
                for v in o.values():
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(d["essence_placements"])
    affixes = [(a.get("name"), a.get("type"))
               for v in d["items"] for a in (v.get("affixes") or [])]
    return recs, affixes


def test_832_every_roster_entry_names_a_checkable_cause():
    assert essence_placements.NO_BONUS_TYPE, "an empty roster passes every check below"
    for effect, cause in essence_placements.NO_BONUS_TYPE.items():
        assert cause in ("untyped", "dice"), f"{effect!r} has unknown cause {cause!r}"


def test_832_the_real_build_satisfies_the_roster():
    recs, affixes = _real()
    out = essence_placements.assert_no_bonus_type_still_holds(recs, iter(affixes))
    # #835 RE-RATIFIED, and it is a correction rather than a drift. This read
    # {4, 11} while `Tendon Slice` was wrongly on the roster as `untyped`.
    #
    # #837 RE-RATIFIED again: the placement COUNT now tracks the size of the
    # table, which grew from 523 to 1465 when the source of truth changed. The
    # effect count is the stable fact and is pinned; the placement count is
    # asserted against the table rather than a literal, so a bigger table is not
    # a test failure but a SHRINKING one still is.
    assert out["effects"] == 3, out
    expected = sum(1 for r in recs if r["effect"] in essence_placements.NO_BONUS_TYPE)
    assert out["placements"] == expected > 0, (out, expected)


def test_832_the_flagged_rows_ask_for_no_type():
    recs, _ = _real()
    flagged = [r for r in recs if r.get("no_bonus_type")]
    assert flagged, "no row carries the flag at all"
    assert {r["effect"] for r in flagged} == set(essence_placements.NO_BONUS_TYPE)
    for r in flagged:
        # The bench keys its third state on this flag. A flagged row that also
        # claimed a sourced type would render both a reading and a control.
        assert not r.get("type_sourced"), r["effect"]
        assert r.get("no_bonus_type_cause") in ("untyped", "dice")


def test_835_tendon_slice_is_not_on_the_roster_and_slavers_is_why():
    """The ruling this corrects. `Tendon Slice` was admitted as `untyped` on the
    claim that every carrier spells it `Untyped`. `Slaver's Extra Slot` carries
    `Tendon Slice +4 (Enhancement)` and its legendary twin at +10, so the claim
    was false — and a typed carrier in ANOTHER crafting system does not type the
    Essence-crafted effect either, so the right answer is `unsourced`, a third
    state and not this one."""
    assert "Tendon Slice" not in essence_placements.NO_BONUS_TYPE
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    typed = [o["name"] for o in (d.get("slavers") or [])
             if any(a.get("stat") == "Tendon Slice" and a.get("bonus_type")
                    for a in (o.get("affixes") or []))]
    assert len(typed) == 2, typed
    assert all("Enhancement" in n for n in typed), typed


def test_835_the_roster_is_the_three_dice_effects():
    assert set(essence_placements.NO_BONUS_TYPE) == {"Bashing", "Shield Spikes", "Vampirism"}
    assert set(essence_placements.NO_BONUS_TYPE.values()) == {"dice"}


def test_832_the_bench_renders_no_control_for_them():
    """Source-level, because the alternative is a DOM. The three states must be
    ordered so `no_bonus_type` wins: a row is flagged AND unsourced, so testing
    `type_sourced` first would fall through to the picker."""
    with open(os.path.join(ROOT, "web", "wizard.js"), encoding="utf-8") as fh:
        src = fh.read()
    i = src.index("const typePart = ")
    head = src[i:i + 400]
    assert "row.no_bonus_type" in head, "the bench must check the flag"
    assert head.index("row.no_bonus_type") < head.index("row.type_sourced"), (
        "`no_bonus_type` must be tested BEFORE `type_sourced`, or a flagged row "
        "falls through to the bonus-type picker")


def test_832_a_typed_carrier_retires_the_untyped_claim():
    """The `untyped` branch, which no real effect uses since #835 corrected
    `Tendon Slice` off the roster. Exercised against a synthetic entry so the
    branch stays covered — it is the branch that admitted a wrong ruling once,
    and an uncovered branch is how the next one gets in."""
    recs, affixes = _real()
    probe = dict(essence_placements.NO_BONUS_TYPE)
    probe["Shatter"] = "untyped"
    saved = essence_placements.NO_BONUS_TYPE
    essence_placements.NO_BONUS_TYPE = probe
    try:
        rows = recs + [{"effect": "Shatter", "stat": "Shatter", "values_by_ml": ["7"] * 36}]
        essence_placements.assert_no_bonus_type_still_holds(
            rows, iter(affixes + [("Shatter", "Enhancement")]))
    except SystemExit as e:
        assert "listed `untyped`" in str(e) and "Shatter" in str(e)
    else:
        raise AssertionError("a typed carrier must fail the build")
    finally:
        essence_placements.NO_BONUS_TYPE = saved


def test_832_a_dice_effect_that_stops_being_dice_fails():
    recs, affixes = _real()
    bad = copy.deepcopy(recs)
    for r in bad:
        if r["effect"] == "Bashing":
            r["values_by_ml"] = ["7"] * 36
    try:
        essence_placements.assert_no_bonus_type_still_holds(bad, iter(affixes))
    except SystemExit as e:
        assert "listed `dice`" in str(e) and "Bashing" in str(e)
    else:
        raise AssertionError("a dice effect turned +N must fail the build")


def test_832_an_entry_nothing_publishes_fails():
    recs, affixes = _real()
    thinned = [r for r in recs if r["effect"] != "Vampirism"]
    try:
        essence_placements.assert_no_bonus_type_still_holds(thinned, iter(affixes))
    except SystemExit as e:
        assert "vouches for nothing" in str(e)
    else:
        raise AssertionError("a roster entry nothing publishes must fail the build")


def test_832_the_guard_refuses_to_inspect_nothing():
    recs, affixes = _real()
    try:
        essence_placements.assert_no_bonus_type_still_holds([], iter(affixes))
    except SystemExit as e:
        assert "vacuously" in str(e)
    else:
        raise AssertionError("zero records must not read as success")
    try:
        essence_placements.assert_no_bonus_type_still_holds(recs, iter([]))
    except SystemExit as e:
        assert "vacuously" in str(e)
    else:
        raise AssertionError("zero item affixes must not read as success")


def test_835_the_guard_walks_the_same_population_the_app_does():
    """The defect was the POPULATION, not the logic.

    `web/dataset.js::_craftingAffixTriples` decides `untypedOnly` over the item
    roster AND every crafting pool. The first version of this guard's CALL SITE
    walked `variants` only — and read `a["name"]`/`a["type"]` where pipeline
    affixes are spelled `stat`/`bonus_type`, so it collected nothing whatsoever
    and could not fail in either direction.

    Both halves are pinned here, against the real build: the helper must yield
    real pairs, and it must reach the pools the app reaches.
    """
    import build_dataset
    with open(DATASET, encoding="utf-8") as fh:
        out = json.load(fh)
    pairs = list(build_dataset._every_carrier_affix(out))
    assert pairs, "the helper yielded nothing — the guard would be vacuous"
    named = [(n, t) for n, t in pairs if n]
    assert len(named) > 1000, (
        f"only {len(named)} named affix(es) — the key spelling is wrong again")
    # The exact carriers that caught the wrong ruling must be reachable.
    assert ("Tendon Slice", "Enhancement") in pairs, (
        "Slaver's `Tendon Slice +N (Enhancement)` is not in the walked "
        "population — the guard is back to answering over the item roster alone")
    # And the item-roster half is still there.
    assert ("Tendon Slice", "Untyped") in pairs


def test_835_the_pools_the_app_walks_are_the_pools_we_walk():
    """Named explicitly, so a pool added to `web/dataset.js` and not here fails
    rather than quietly narrowing the population again."""
    import build_dataset
    import inspect
    src = inspect.getsource(build_dataset._every_carrier_affix)
    for pool in ("seal", "viktranium", "dino_inserts", "nearly_complete",
                 "legendary_green_steel", "slavers", "essence_crafting",
                 "nearly_complete_per_item"):
        assert pool in src, f"{pool!r} is not in the walked population"


# --- #835 — a dice magnitude is its own unit, and is disclosed --------------

def test_835_dice_effects_carry_the_dice_unit():
    recs, _ = _real()
    dice = [r for r in recs if r.get("unit") == "dice"]
    assert {r["effect"] for r in dice} == {"Bashing", "Shield Spikes", "Vampirism"}
    assert dice, "no dice records at all"
    for r in dice:
        assert r["magnitude_sourced"], r["effect"]
        assert r["values_by_ml"], r["effect"]


def test_835_no_record_claims_a_number_over_a_non_number():
    recs, _ = _real()
    out = essence_placements.assert_unit_matches_the_magnitude(recs)
    # Pinned to the table rather than a literal, for the #837 reason above.
    assert out["dice"] == sum(1 for r in recs if r.get("unit") == "dice") > 0, out
    assert out["checked"] > 0, out


def test_835_a_dice_curve_filed_as_flat_fails():
    """The original defect, exactly: `unit: flat` over `6d6`. The value stays a
    string through normalizeAffix, the solver drops it on `value > 0`, and
    nothing tells the player."""
    import copy
    recs, _ = _real()
    bad = copy.deepcopy(recs)
    for r in bad:
        if r["effect"] == "Bashing":
            r["unit"] = "flat"
    try:
        essence_placements.assert_unit_matches_the_magnitude(bad)
    except SystemExit as e:
        assert "carries dice magnitudes" in str(e) and "Bashing" in str(e)
    else:
        raise AssertionError("a dice curve filed as flat must fail the build")


def test_835_a_numeric_curve_filed_as_dice_fails():
    """The other direction: it would disclose an unrankable craft that ranks."""
    import copy
    recs, _ = _real()
    bad = copy.deepcopy(recs)
    for r in bad:
        if r["effect"] == "Seeker":
            r["unit"] = "dice"
    try:
        essence_placements.assert_unit_matches_the_magnitude(bad)
    except SystemExit as e:
        assert "is unit `dice`" in str(e) and "Seeker" in str(e)
    else:
        raise AssertionError("a numeric curve filed as dice must fail the build")


def test_835_the_unit_gate_refuses_to_inspect_nothing():
    for empty in ([], [{"effect": "X", "unit": "flat"}]):
        try:
            essence_placements.assert_unit_matches_the_magnitude(empty)
        except SystemExit as e:
            assert "vacuously" in str(e)
        else:
            raise AssertionError("empty input must not read as success")


def test_835_the_bench_shows_the_dice_value_and_says_it_cannot_rank():
    """Source-level: the dice branch must be tested BEFORE the on/off branch,
    or these fall through to "no bonus type or value" — which is what they did.
    And it must read the VERBATIM value, because the numeric accessor returns
    null for `3d2` by design."""
    with open(os.path.join(ROOT, "web", "wizard.js"), encoding="utf-8") as fh:
        src = fh.read()
    i = src.index('let tail = "";')
    head = src[i:i + 2200]
    assert 'row.unit === "dice"' in head, "the bench must recognise a dice row"
    assert head.index('row.unit === "dice"') < head.index("isPresenceOnly("), (
        "the dice branch must precede the on/off branch, or a dice effect "
        "renders as having no value")
    assert "sourcedRawValueAt" in head, (
        "the dice branch must read the verbatim value; sourcedValueAt returns "
        "null for a dice string by design")
    assert "cannot" in head and "rank" in head, (
        "an unrankable craft must say so where the player chooses it")
