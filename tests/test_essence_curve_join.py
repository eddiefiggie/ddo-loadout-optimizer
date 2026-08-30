"""#599 — the effect-name to curve-row join, and the guards on it.

`essence_crafting.json` holds two vocabularies that do not match: `placements` is
keyed by effect name (157) and `values_by_ml` by curve row (75, a coarser family
vocabulary). Only 22 names match a row literally, so `curves[effect_name]`
returns the wrong row or nothing — **silently**, which is what makes this worse
than the missing bonus type it was found beside.

The bug that earned the issue is pinned first, in
`test_the_reported_bug_does_not_reproduce`.

The other load-bearing test is `test_two_rows_answering_to_one_name_are_refused`:
`Resistance` and `Resistance (save)` are both real rows, and an earlier draft of
the join silently took the first. Refusing is the only honest answer.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import essence_curve_join as join

CRAFTING = os.path.join(ROOT, "data", "seed", "compendium", "essence_crafting.json")
BONUS_TYPES = os.path.join(ROOT, "data", "seed", "compendium", "essence_bonus_type.json")

RULES = {"identity", "gloss", "enumeration", "group", "insightful"}
REASONS = {"non-scaling", "unmapped", "ambiguous", "no-insightful-row"}


def _curves():
    with open(CRAFTING) as fh:
        return json.load(fh)["values_by_ml"]["effects"]


def test_the_reported_bug_does_not_reproduce():
    """#599's worked example. `Insightful Accuracy` has no row of its own; joining
    by effect name lands on `Accuracy` and reads 23 — the BASE competence
    magnitude — where the correct `Ins. Accuracy` row reads 11. The wrong number
    is plausible, which is the whole danger."""
    curves = _curves()
    assert "Insightful Accuracy" not in curves, "the premise changed: it now has its own row"
    assert curves["Accuracy"][33] == "23", "the wrong-row value moved; re-check this test"
    assert join.curve_for("Insightful Accuracy")[33] == "11"
    assert join.resolve_all()["mapping"]["Insightful Accuracy"]["row"] == "Ins. Accuracy"


def test_two_rows_answering_to_one_name_are_refused():
    """`Resistance` and `Resistance (save)` are both rows. Stripping the gloss
    makes them collide, and picking either would record a coin flip as a game
    value. Both `Resistance` and its Insightful twin must be quarantined."""
    res = join.resolve_all()
    assert res["ambiguous_keys"].get("resistance") == ["Resistance", "Resistance (save)"]
    for name in ("Resistance", "Insightful Resistance"):
        assert name not in res["mapping"], f"{name} was mapped despite two rows claiming it"
        assert res["quarantine"][name]["reason"] == "ambiguous"


def test_every_effect_is_either_mapped_or_quarantined_exactly_once():
    """The roster is a population and the join must account for all of it. A
    silently dropped effect reads the same as one that has no curve."""
    res = join.resolve_all()
    roster = set(join.effect_roster(json.load(open(CRAFTING))["placements"]))
    assert len(roster) == 157
    mapped, quarantined = set(res["mapping"]), set(res["quarantine"])
    assert not (mapped & quarantined), sorted(mapped & quarantined)
    assert mapped | quarantined == roster, sorted(roster - (mapped | quarantined))


def test_every_mapping_names_a_row_that_exists_and_a_rule_that_is_known():
    curves = _curves()
    for effect, entry in join.resolve_all()["mapping"].items():
        assert entry["row"] in curves, f"{effect} -> {entry['row']!r}, which is not a curve row"
        assert entry["rule"] in RULES, f"{effect}: unknown rule {entry['rule']!r}"
        assert len(entry.get("evidence") or "") > 10, f"{effect}: no evidence recorded"


def test_every_quarantine_gives_a_known_reason_and_says_why():
    for effect, entry in join.resolve_all()["quarantine"].items():
        assert entry["reason"] in REASONS, f"{effect}: unknown reason {entry['reason']!r}"
        assert len(entry.get("detail") or "") > 40, f"{effect}: reason without an explanation"


def test_insightful_effects_only_ever_land_on_an_ins_row():
    """The failure mode this module exists for is an Insightful effect reading its
    BASE row. Nothing else about the join matters if this can happen."""
    for effect, entry in join.resolve_all()["mapping"].items():
        if effect.startswith("Insightful "):
            assert entry["row"].startswith("Ins. "), \
                f"{effect} -> {entry['row']!r}, a base row: this is the #599 bug"
        else:
            assert not entry["row"].startswith("Ins. "), \
                f"{effect} -> {entry['row']!r}, an Insightful row"


def test_the_uncraftable_rows_are_never_joined_to():
    """Table 3b's footnote: `Enchant bonus`, `Weapon dice mult` and `Spellcasting
    implement` are applied automatically and no shard for them can be crafted. An
    effect mapping to one would be crediting a bonus no player chooses."""
    used = {e["row"] for e in join.resolve_all()["mapping"].values()}
    for row in join.UNCRAFTABLE_ROWS:
        assert row not in used, f"{row!r} is not craftable but something joined to it"


def test_the_join_agrees_with_the_independently_harvested_bonus_type_ranges():
    """A cross-shard check between two separately harvested wiki tables.

    `essence_bonus_type.json` took magnitudes from the SENTENCES that state bonus
    types on effect pages; this join takes them from table 3b's curves. Where both
    have a value they should agree, and for 15 of 17 they do exactly.

    The two exceptions are both Haggle, whose page dates its own numbers "as of
    Update 36 Release Notes" — page staleness, not a join error. They are named
    rather than tolerated by a fuzzy threshold, so a THIRD disagreement fails.
    """
    import re
    known_stale = {"Haggle": (22, 20), "Insightful Haggle": (11, 10)}
    with open(BONUS_TYPES) as fh:
        harvested = json.load(fh)["harvested"]
    res = join.resolve_all()

    checked = disagreed = 0
    for name, rec in harvested.items():
        if rec["provenance"] != "stated":
            continue
        rng = (rec["value"] or {}).get("range")
        if not rng or name not in res["mapping"]:
            continue
        digits = re.findall(r"\d+", rng)
        if not digits:
            continue
        stated = int(digits[-1])
        curve = int(float(join.curve_for(name)[33]))
        checked += 1
        if curve == stated:
            continue
        disagreed += 1
        assert name in known_stale, (
            f"{name}: the curve says {curve} but the bonus-type sentence says {stated}. "
            "Two independent wiki tables disagree — reconcile before trusting either.")
        assert known_stale[name] == (curve, stated), \
            f"{name}: the known disagreement moved, now {curve} vs {stated}"

    assert checked >= 15, f"only {checked} effects were cross-checked; the guard has gone quiet"
    assert disagreed == len(known_stale), \
        f"{disagreed} disagreements, expected exactly {len(known_stale)}"


def test_the_join_refuses_to_resolve_nothing():
    """A join that inspects zero records reports a clean sheet. Make it refuse."""
    real = join.CRAFTING_SHARD
    empty = os.path.join(ROOT, "tests", "_empty_crafting.json")
    try:
        with open(empty, "w") as fh:
            json.dump({"placements": {}, "values_by_ml": {"effects": {}}}, fh)
        join.CRAFTING_SHARD = empty
        try:
            join.resolve_all()
        except join.JoinError:
            pass
        else:
            raise AssertionError("resolve_all accepted empty shards instead of refusing")
    finally:
        join.CRAFTING_SHARD = real
        if os.path.exists(empty):
            os.remove(empty)


def test_the_abbreviation_rule_is_positional_not_fuzzy():
    """`Ins. Ench/Ill resistance` is the twin of `Enchantment/Illusion resistance`
    because each word is a prefix of its counterpart, in order. A rule looser than
    that would start pairing unrelated rows."""
    assert join._abbrev_matches("Ench/Ill resistance", "Enchantment/Illusion resistance")
    assert join._abbrev_matches("Poi/Dis ward", "Poison/Disease ward")
    assert join._abbrev_matches("Spellpower", "Spellpower")
    assert not join._abbrev_matches("Ench resistance", "Enchantment/Illusion resistance")
    assert not join._abbrev_matches("Dodge", "Doubleshot")
    assert not join._abbrev_matches("Seeker", "Sheltering")


def test_the_coverage_numbers_the_ruling_cites_are_what_the_join_produces():
    """A count is a claim about a population; both sides are readable here."""
    stats = join.resolve_all()["stats"]
    assert stats["roster"] == 157
    assert stats["mapped"] == 120
    assert stats["quarantined"] == 37
    assert stats["by_reason"] == {"non-scaling": 21, "unmapped": 14, "ambiguous": 2}
    doc = os.path.join(ROOT, "docs", "wiki-evidence", "essence-crafting-bonus-types.md")
    with open(doc) as fh:
        text = fh.read()
    assert "120 of 157" in text, "the ruling's coverage claim must match the join"
