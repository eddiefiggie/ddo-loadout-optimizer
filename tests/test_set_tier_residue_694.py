"""#694 — three set-tier names that reached the picker as raw prose, and what
the built dataset must carry instead.

  1. `all Dexterity based Skills` (Mechanic 2-piece) is an UMBRELLA and expands
     to the five Dexterity skills, the way `Dexterity Skills` already does.
  2/3. `hit and damage vs. Evil creatures` and `Saves vs. Evil Creatures`
     (Crypt Raider 3-piece) are TARGET-CONDITIONAL and are flagged at the parse
     seam, never emitted as stats — tier `raw` keeps the wording verbatim.

Reads the BUILT dataset, because the parse-seam tests in test_set_parser.py
prove the mechanism and not that the channels actually went through it.
Refuses to inspect zero records. Ruling: docs/wiki-evidence/target-conditional-set-bonuses.md.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import set_parser, spell_focus  # noqa: E402

BUILT = os.path.join(ROOT, "web", "data", "items.json")


def _load():
    if not os.path.exists(BUILT):
        return None
    with open(BUILT, encoding="utf-8") as fh:
        return json.load(fh)


def _tiers(data, set_name):
    seen = {}
    for it in data["items"]:
        for t in it.get("parsed_set_bonuses") or []:
            if t.get("set") == set_name:
                seen.setdefault(t.get("pieces_required"), t)
    return seen


def test_694_mechanic_two_piece_expands_to_the_five_dexterity_skills():
    data = _load()
    if data is None:
        return
    tiers = _tiers(data, "Mechanic")
    assert 2 in tiers, "the Mechanic 2-piece is gone from the built dataset"
    affixes = tiers[2]["affixes"]
    stats = {a["stat"] for a in affixes}
    assert "all Dexterity based Skills" not in stats, "the umbrella survived unexpanded"
    for skill in spell_focus.SKILLS_DEX:
        rows = [a for a in affixes if a["stat"] == skill]
        assert rows, f"{skill}: missing from the expanded Mechanic tier"
        assert any(a["bonus_type"] == "Exceptional" and a["value"] == 2 for a in rows), \
            f"{skill}: expected Exceptional 2, got {[(a['bonus_type'], a['value']) for a in rows]}"
    # The two Competence lines on the same tier are untouched.
    assert ("Open Lock", "Competence", 15) in {(a["stat"], a["bonus_type"], a["value"]) for a in affixes}
    assert "all Dexterity based Skills" in tiers[2]["raw"], "tier raw must stay verbatim"


def test_694_crypt_raider_vs_evil_clauses_are_flagged_and_never_scored():
    data = _load()
    if data is None:
        return
    tiers = _tiers(data, "Crypt Raider (Legendary)")
    assert 3 in tiers, "the Crypt Raider (Legendary) 3-piece is gone from the built dataset"
    tier = tiers[3]
    stats = {a["stat"] for a in tier["affixes"]}
    assert not any(set_parser.is_target_conditional(s) for s in stats), stats
    assert "Melee Power" in stats and "Ranged Power" in stats, "the unconditional lines still score"
    flagged = {f["raw"]: f["reason"] for f in tier.get("flagged") or []}
    for raw in ("+5 Artifact bonus to hit and damage vs. Evil creatures",
                "+2 Artifact bonus to Saves vs. Evil Creatures"):
        assert flagged.get(raw) == set_parser.TARGET_CONDITIONAL_REASON, (raw, flagged)
    # Stale guard: the wording this ruling was read against. If the wiki or
    # upstream rewrites it, re-read the set before trusting the regex.
    assert "vs. Evil creatures" in tier["raw"] and "vs. Evil Creatures" in tier["raw"]


def test_694_no_set_channel_emits_a_target_conditional_stat():
    data = _load()
    if data is None:
        return
    checked = 0
    bad = []
    for it in data["items"]:
        for t in it.get("parsed_set_bonuses") or []:
            for a in t.get("affixes") or []:
                checked += 1
                if set_parser.is_target_conditional(a.get("stat")):
                    bad.append((t.get("set"), a.get("stat")))
    for name, d in (data.get("membership_set_defs") or {}).items():
        for t in d.get("tiers") or []:
            for a in t.get("affixes") or []:
                checked += 1
                if set_parser.is_target_conditional(a.get("stat")):
                    bad.append((name, a.get("stat")))
    assert checked > 1000, "refuse to inspect zero records"
    assert not bad, sorted(set(bad))
    cov = data["metadata"].get("target_conditional_set_coverage") or {}
    assert cov.get("clauses_flagged") == 2, cov
    assert cov.get("sets") == ["Crypt Raider (Legendary)"], cov
