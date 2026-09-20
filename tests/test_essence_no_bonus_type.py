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
    assert out == {"effects": 4, "placements": 11}, out


def test_832_the_flagged_rows_ask_for_no_type():
    recs, _ = _real()
    flagged = [r for r in recs if r.get("no_bonus_type")]
    assert len(flagged) == 11, len(flagged)
    assert {r["effect"] for r in flagged} == set(essence_placements.NO_BONUS_TYPE)
    for r in flagged:
        # The bench keys its third state on this flag. A flagged row that also
        # claimed a sourced type would render both a reading and a control.
        assert not r.get("type_sourced"), r["effect"]
        assert r.get("no_bonus_type_cause") in ("untyped", "dice")


def test_832_only_tendon_slice_actually_changes_state_today():
    """Honest accounting, pinned rather than asserted in prose.

    The roster holds four effects and 11 placements, but three of them —
    `Bashing`, `Shield Spikes`, `Vampirism` — were ALREADY showing no control:
    the vocabulary classes them presence-only (a Bool carrier, no numeric
    magnitude anywhere), and the bench tests that branch first. Only
    `Tendon Slice` reaches the new state, over 5 placements.

    Measured with the bench's own predicate rather than a proxy for it. A proxy
    is what produced the wrong count in the first place: classifying "flag" off
    the placement record instead of off the vocabulary put these three in the
    dropdown bucket, where they never were.

    They stay on the roster because the `dice` cause is real and independently
    checked — if a numeric carrier ever appears and the presence branch stops
    firing, the roster is what keeps the control from returning.
    """
    recs, _ = _real()
    by_effect = {}
    for r in recs:
        if r.get("no_bonus_type"):
            by_effect.setdefault(r["effect"], 0)
            by_effect[r["effect"]] += 1
    assert by_effect.get("Tendon Slice") == 5, by_effect
    assert sum(by_effect.values()) == 11, by_effect
    assert set(by_effect) == set(essence_placements.NO_BONUS_TYPE)


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
    recs, affixes = _real()
    try:
        essence_placements.assert_no_bonus_type_still_holds(
            recs, iter(affixes + [("Tendon Slice", "Enhancement")]))
    except SystemExit as e:
        assert "listed `untyped`" in str(e) and "Tendon Slice" in str(e)
    else:
        raise AssertionError("a typed carrier must fail the build")


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
