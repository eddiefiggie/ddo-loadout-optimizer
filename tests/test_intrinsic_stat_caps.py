"""The intrinsic stat-cap shard must stay sourced, and its refusals must stay recorded (#199).

Two halves, and the second is the one that is easy to lose.

**Every cap traces to a wiki sentence.** A cap silently truncates a real stat and
the loadout still looks correct afterwards, so an unsourced entry is exactly the
"a wrong number is indistinguishable from a right one" failure the project exists
to avoid. `build_dataset.py` refuses to build without a `quote` and `wiki_url`;
this pins the same rule at the shard so it is visible next to the data.

**Every refusal stays recorded, with its quote.** Four of the five stats harvested
for #199 have NO ceiling, and three of them look like they should — which makes
the refusal list load-bearing rather than commentary. `Doubleshot` is the sharp
case: it is `Doublestrike`'s documented sibling, described in parallel language one
click away, and it WRAPS past 100% into extra shots where Doublestrike stops dead.
Delete the refusal list and the next reader has no record that the analogy was
checked and rejected, so the cheap wrong answer is one edit away.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402

SHARD_PATH = build_dataset.INTRINSIC_STAT_CAPS_PATH

# The stats harvested on 2026-08-28. Every one must be ruled — as a cap or as a
# refusal — so a later reader can tell "checked, has no ceiling" from "never looked".
HARVESTED = {"Doublestrike", "Doubleshot", "Fortification", "Dodge", "Concealment"}


def _shard():
    with open(SHARD_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def test_every_cap_carries_its_wiki_sentence():
    for entry in _shard()["caps"]:
        stat = entry.get("stat")
        assert entry.get("quote"), f"{stat}: no verbatim wiki quote — an unsourced cap truncates a real stat"
        assert str(entry.get("wiki_url", "")).startswith("https://ddowiki.com/"), (
            f"{stat}: no ddowiki URL. Every game value traces to the wiki (AGENTS.md).")
        assert isinstance(entry.get("cap"), (int, float)), f"{stat}: cap is not a number"
        assert entry.get("verified"), f"{stat}: no verification date"


def test_every_refusal_carries_its_reason_and_quote():
    for entry in _shard()["refused"]:
        stat = entry.get("stat")
        assert entry.get("reason"), f"{stat}: refused with no reason recorded"
        assert entry.get("quote"), (
            f"{stat}: refused with no quote. A refusal without the sentence behind it reads as "
            "an oversight, and the next reader re-guesses it.")
        assert str(entry.get("wiki_url", "")).startswith("https://ddowiki.com/"), f"{stat}: no ddowiki URL"


def test_doubleshot_stays_refused():
    """The specific wrong answer this shard exists to prevent.

    Not a general rule — a named guard for a named trap. If Doubleshot ever gains
    a cap it must come with a wiki sentence stating one, which means deleting this
    test deliberately rather than editing the shard past a silent gate.
    """
    shard = _shard()
    capped = {c["stat"] for c in shard["caps"]}
    refused = {r["stat"] for r in shard["refused"]}
    assert "Doubleshot" not in capped, (
        "Doubleshot has NO in-game ceiling — the wiki states it wraps past 100% into extra "
        "shots. Capping it deletes every point a ranged build earned above 100. See "
        "docs/wiki-evidence/intrinsic-stat-caps.md section 2.")
    assert "Doubleshot" in refused, "and the refusal must stay recorded, with its quote"


def test_every_harvested_stat_is_ruled_one_way_or_the_other():
    shard = _shard()
    ruled = {c["stat"] for c in shard["caps"]} | {r["stat"] for r in shard["refused"]}
    missing = HARVESTED - ruled
    assert not missing, (
        f"{sorted(missing)} were harvested for #199 but are now neither capped nor refused. "
        "A stat that drops out of both lists is indistinguishable from one nobody ever checked.")


def test_the_shard_is_actually_populated():
    """Refuse to inspect zero records.

    Every assertion above iterates a list, so an emptied `caps` or `refused` turns
    this whole module green while covering nothing.
    """
    shard = _shard()
    assert len(shard["caps"]) >= 1, "no caps in the shard — the guard would assert nothing"
    assert len(shard["refused"]) >= 4, (
        "fewer than the four recorded refusals — the half that prevents a re-guess is being lost")


def test_the_build_emits_exactly_the_shard_caps():
    """The emitted metadata is the shard, not a subset or a stale copy."""
    built = build_dataset.build()["metadata"]
    expected = {c["stat"]: c["cap"] for c in _shard()["caps"]}
    assert built["intrinsic_stat_caps"] == expected, (
        f"emitted {built['intrinsic_stat_caps']} but the shard says {expected}")
    assert built["intrinsic_stat_caps_refused"] == sorted(r["stat"] for r in _shard()["refused"])
    # The refused stats must NOT reach the solver-facing table.
    assert not (set(built["intrinsic_stat_caps"]) & set(built["intrinsic_stat_caps_refused"])), (
        "a stat is both capped and refused — the two lists have drifted")
