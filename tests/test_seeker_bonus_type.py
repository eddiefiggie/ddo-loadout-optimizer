"""Seeker bonus type is wiki-ruled per carrier (#392).

`{{Seeker|N|<type>}}` states the bonus type as its third positional parameter:
`exc`/`Exceptional` -> Exceptional, `ins`/`Insight`/`Insightful` -> Insight,
absent -> Enhancement. The 2026-08-18 refresh (#374) re-typed 18 carriers
Insight -> Exceptional; every one was verified against its own wiki page and
upstream was correct. Ruling: `docs/wiki-evidence/seeker-bonus-type.md`.

Bonus type is the stacking key, so a silent re-type changes what stacks with
what without changing any magnitude. This guard names the carrier when that
happens instead of letting it land as a quiet solve difference.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

RAW = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json")

# Verified individually 2026-08-19; see the ruling's per-item invocation tables.
EXCEPTIONAL = {
    "Bracers of Twisting Shade (level 18)": "3",
    "Bracers of Twisting Shade (level 23)": "4",
    "Bracers of Twisting Shade (level 24)": "4",
    "Bracers of Twisting Shade (level 25)": "5",
    "Steady Handed Armbands (level 23)": "3",
    "Steady Handed Armbands (level 24)": "4",
    "Steady Handed Armbands (level 25)": "5",
    "Souvenir Coin": "3",
    "Golden Souvenir Coin": "3",
    "Legendary Souvenir Coin": "5",
    "Legendary Golden Souvenir Coin": "5",
    "Helm of the Warblade": "3",
    "Legendary Helm of the Warblade": "5",
    "Iron Cloak of the Wolf": "3",
    "Mithral Cloak of the Wolf": "4",
    "Adamantine Cloak of the Wolf": "5",
    "Slice": "3",
    "Horseshoe Crab Shield (level 26)": "5",
}

# The control set: carriers the refresh did NOT move, proving the re-type is
# discriminating rather than a blanket rewrite. The first three pairs sit in the
# same item family as an Exceptional row above.
INSIGHT = {
    "Bracers of Twisting Shade (level 16)": "2",
    "Horseshoe Crab Shield (level 7)": "2",
    "Epic Slice": "6",
    "Vambrace of the Summer Court": "1",
    "Bold Trinket": "2",
    "Dread Stalker's Cloak": "2",
    "Tinker's Gloves": "2",
    "Cloak of Balance": "3",
    "Periapt of Dexterity": "3",
    "Sunken Chains": "3",
    "Burrowing Claws": "2",
}

# `{{Seeker|6}}` with no third parameter, on a page that also carries a typed
# one. Pins the absent-parameter default as observed, not assumed.
ENHANCEMENT_DEFAULT = {"Burrowing Claws": "6"}


def _seeker_by_item():
    with open(RAW, encoding="utf-8") as fh:
        records = json.load(fh)
    out = {}
    for rec in records:
        hits = [a for a in (rec.get("affixes") or []) if a.get("name") == "Seeker"]
        if hits:
            out[rec["name"]] = hits
    return out


def _typed(hits, bonus_type):
    return [a for a in hits if a.get("type") == bonus_type]


def _assert_ruled(table, bonus_type):
    live = _seeker_by_item()
    missing = sorted(set(table) - set(live))
    assert not missing, (
        f"wiki-ruled Seeker carriers absent from the gear-planner dump: {missing} "
        f"— see docs/wiki-evidence/seeker-bonus-type.md")
    for item, value in sorted(table.items()):
        matches = _typed(live[item], bonus_type)
        assert matches, (
            f"{item}: no Seeker affix typed {bonus_type}; dump carries "
            f"{[(a.get('type'), a.get('value')) for a in live[item]]} — the wiki "
            f"rules {bonus_type} (docs/wiki-evidence/seeker-bonus-type.md). If "
            f"upstream re-typed it, re-harvest the invocation before accepting.")
        assert any(a.get("value") == value for a in matches), (
            f"{item}: Seeker {bonus_type} magnitude moved to "
            f"{[a.get('value') for a in matches]}, ruled {value}. A magnitude "
            f"change needs its own wiki read; the type ruling does not carry it.")


def test_the_eighteen_exceptional_carriers_keep_their_ruled_type():
    _assert_ruled(EXCEPTIONAL, "Exceptional")


def test_the_insight_control_set_did_not_move():
    _assert_ruled(INSIGHT, "Insight")


def test_an_untyped_invocation_still_defaults_to_enhancement():
    _assert_ruled(ENHANCEMENT_DEFAULT, "Enhancement")


def test_no_ruled_carrier_is_claimed_by_two_rulings_at_once():
    """A carrier appearing in both tables would make the guard unfalsifiable.

    Three items legitimately appear in both *families* at different levels, and
    one (Burrowing Claws) carries two typed affixes at once — but no single
    record name may be ruled Exceptional and Insight for the same affix."""
    live = _seeker_by_item()
    for item in sorted(set(EXCEPTIONAL) & set(INSIGHT)):
        raise AssertionError(f"{item} is ruled both Exceptional and Insight")
    both = sorted(n for n, hits in live.items()
                  if _typed(hits, "Exceptional") and _typed(hits, "Insight"))
    assert not both, (
        f"records carrying BOTH an Exceptional and an Insight Seeker: {both}. "
        f"The ruling has no evidence for that shape — harvest the page before "
        f"extending either table.")


def test_the_ruled_population_covers_every_exceptional_seeker_in_the_dump():
    """The count is the claim: if upstream adds a 19th, this fires.

    Ruling by sample is what made the pre-refresh Insight typing wrong for
    years — a new Exceptional carrier must be read on its own page, not
    inherited from this table."""
    live = _seeker_by_item()
    found = {n for n, hits in live.items() if _typed(hits, "Exceptional")}
    unruled = sorted(found - set(EXCEPTIONAL))
    assert not unruled, (
        f"Seeker Exceptional carriers with no wiki ruling: {unruled}. Harvest "
        f"{{{{Seeker|N|type}}}} from each page and add it to "
        f"docs/wiki-evidence/seeker-bonus-type.md before accepting.")
    assert len(found) == len(EXCEPTIONAL) == 18
