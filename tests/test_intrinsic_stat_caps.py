"""The intrinsic stat-cap shard must stay sourced, and its refusals must stay recorded (#199, #661, #662).

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

# Every one of these must be ruled — as a cap or as a refusal — so a later reader
# can tell "checked, has no ceiling" from "never looked".
#
# NOT the full roster of what has been harvested, and deliberately so. The
# 2026-09-01 sweep also confirmed ceilings for Jump and off-hand strike chance
# that are deliberately NOT recorded — Jump caps at 40 for jump HEIGHT only and is
# a disclosure question (#663), and off-hand strike chance caps at 100 but is the
# Two Weapon Fighting non-goal. A stat joins this set when the shard is expected
# to rule it, not when the wiki has been read; those two would fail this guard for
# the right reason if added. docs/wiki-evidence/intrinsic-stat-caps.md carries all
# ten stats across both sweeps.
HARVESTED = {
    # 2026-08-28 (#199)
    "Doublestrike", "Doubleshot", "Fortification", "Dodge", "Concealment",
    # 2026-09-01 (#661, #662)
    "Strikethrough", "Incorporeal", "Shield Bashing",
}


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


def test_strikethrough_is_capped_at_400_and_the_reading_stays_intact():
    """The specific right answer, and the specific way it gets rewritten wrong.

    400 is not a clamp. The wiki says higher values "are possible" — the game does
    not truncate them, it stops paying for them, because there is no sixth target
    to buy. That is this table's semantics exactly, and it is also one careless
    paraphrase away from "Strikethrough is hard-capped at 400", which is the
    Fortification error in reverse: a sentence that reads as a ceiling on the
    NUMBER rather than on the BENEFIT.

    So the quote is pinned verbatim, not merely required to exist. `cap` alone
    cannot record the distinction, and the note that carries it is prose nobody
    diffs.
    """
    shard = _shard()
    entry = next((c for c in shard["caps"] if c["stat"] == "Strikethrough"), None)
    assert entry is not None, (
        "Strikethrough has a wiki-stated ceiling of 400 and must stay recorded. See "
        "docs/wiki-evidence/intrinsic-stat-caps.md section 6.")
    assert entry["cap"] == 400, f"the wiki states 400, shard says {entry['cap']}"
    assert entry["wiki_url"] == "https://ddowiki.com/page/Strikethrough"
    assert "effectively caps at 400%" in entry["quote"], (
        "the quote no longer carries the word the whole reading turns on. "
        "'Effectively' is what makes this a benefit ceiling and not a clamp.")
    assert "while higher values are possible" in entry["quote"], (
        "the quote no longer states that values above 400 EXIST. Drop that clause and "
        "the entry reads as a hard ceiling on the number, which the wiki does not say.")


def test_the_two_analogy_refusals_stay_refused():
    """The 2026-09-01 pair, and the reasoning that has to survive with them.

    Both were proposed by ANALOGY — the same shape as `test_doubleshot_stays_refused`
    guards, one sweep later, which is why they get a named guard rather than relying
    on the generic "every refusal carries a quote" rule.

      Incorporeal      <- proposed as sharing Dodge's 95.
      Shield Bashing   <- proposed as sharing off-hand strike chance's 100.

    Neither transfers. The three miss chances are rolled SEPARATELY and combined
    multiplicatively, so there is no shared pool for a shared cap; and the wiki
    states the off-hand ceiling outright on the sibling page while saying nothing
    on the shield bashing page, which is evidence precisely because the wiki writes
    these down where they exist.
    """
    shard = _shard()
    capped = {c["stat"] for c in shard["caps"]}
    by_stat = {r["stat"]: r for r in shard["refused"]}

    for stat, why in (
        ("Incorporeal", "the wiki states no ceiling; Dodge's 95 does not transfer because the "
                        "three miss chances are rolled separately and combined multiplicatively"),
        ("Shield Bashing", "the wiki states no ceiling; off-hand strike chance's 100 is stated on "
                           "the SIBLING page and deliberately not on this one"),
    ):
        assert stat not in capped, f"{stat} must not be capped — {why}. See intrinsic-stat-caps.md."
        assert stat in by_stat, (
            f"{stat}'s refusal is gone. Without it the analogy is one hop away and nothing "
            "records that it was checked and rejected.")


def test_the_shield_bash_refusal_is_not_vacuous():
    """A refusal only protects a stat a player can actually rank.

    `Shield Bashing` is in `metadata.rankable_affixes`, so a wrong cap there would
    silently truncate a real Vanguard build. Asserting that keeps this guard from
    passing on a stat the app stopped offering — at which point the refusal still
    belongs in the shard, but this test is no longer the thing protecting anyone
    and should say so out loud rather than staying quietly green.

    Its sibling `Incorporeal` is deliberately NOT asserted here: it is not rankable
    today, and its refusal is prospective by design. See that entry's note.
    """
    rankable = set(build_dataset.build()["metadata"]["rankable_affixes"])
    assert "Shield Bashing" in rankable, (
        "Shield Bashing is no longer rankable, so its refusal now guards nothing reachable. "
        "Re-read the entry's note before deleting either the stat or this assertion.")


def test_every_harvested_stat_is_ruled_one_way_or_the_other():
    shard = _shard()
    ruled = {c["stat"] for c in shard["caps"]} | {r["stat"] for r in shard["refused"]}
    missing = HARVESTED - ruled
    assert not missing, (
        f"{sorted(missing)} were harvested and ruled once but are now neither capped nor refused. "
        "A stat that drops out of both lists is indistinguishable from one nobody ever checked.")


def test_the_shard_is_actually_populated():
    """Refuse to inspect zero records.

    Every assertion above iterates a list, so an emptied `caps` or `refused` turns
    this whole module green while covering nothing.
    """
    shard = _shard()
    # #888 — one cap now: Doublestrike's 100 was retired by Update 81.4 and moved
    # to `refused` (no hard ceiling) and `soft_caps` (half value above 200).
    assert len(shard["caps"]) >= 1, (
        "fewer than the one recorded cap (Strikethrough 400) — "
        "an emptied list turns every assertion above green while covering nothing")
    assert len(shard["refused"]) >= 7, (
        "fewer than the seven recorded refusals — the half that prevents a re-guess is being lost")
    assert len(shard.get("soft_caps") or []) >= 2, (
        "fewer than the two recorded soft caps (Doublestrike, Doubleshot)")


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


# ---- #888 — the Update 81.4 soft caps ------------------------------------------------

def test_doublestrike_is_no_longer_hard_capped_and_the_retirement_is_recorded():
    """Update 81.4 removed the 100% cap. The wiki page was rewritten on release day,
    and the shard kept quoting the old sentence for eight days. Pin both halves:
    the cap is gone, and the reason it went is on the record next to the data."""
    shard = _shard()
    assert "Doublestrike" not in {c["stat"] for c in shard["caps"]}, (
        "Doublestrike has no hard ceiling since Update 81.4 — re-capping it at 100 tells a "
        "player with declared credits that points the game counts in full buy nothing")
    retired = [r for r in shard.get("retired") or [] if r["entry"]["stat"] == "Doublestrike"]
    assert retired and retired[0]["entry"]["cap"] == 100 and retired[0].get("why"), (
        "the retired 100% entry and the reason it went must stay recorded")
    refusal = next(r for r in shard["refused"] if r["stat"] == "Doublestrike")
    assert "no longer capped at 100%" in refusal["quote"]


def test_both_soft_caps_carry_their_wiki_sentence_and_shape():
    soft = {e["stat"]: e for e in _shard()["soft_caps"]}
    assert set(soft) == {"Doublestrike", "Doubleshot"}, sorted(soft)
    for stat, e in soft.items():
        assert e["at"] == 200 and e["rate"] == 0.5, (stat, e["at"], e["rate"])
        assert "200%" in e["quote"] and "50%" in e["quote"], f"{stat}: the quote must state both numbers"
        assert e["wiki_url"] == f"https://ddowiki.com/page/{stat}"
        assert "Update 81" in e.get("release_note", ""), f"{stat}: no release-note evidence"


def test_the_build_emits_exactly_the_shard_soft_caps():
    built = build_dataset.build()["metadata"]
    expected = {e["stat"]: {"at": e["at"], "rate": e["rate"]} for e in _shard()["soft_caps"]}
    assert built["intrinsic_soft_caps"] == expected
    assert not (set(built["intrinsic_soft_caps"]) & set(built["intrinsic_stat_caps"])), (
        "a stat may not be both hard-capped and soft-capped")
