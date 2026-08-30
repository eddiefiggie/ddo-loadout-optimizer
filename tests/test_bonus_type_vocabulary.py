"""#225-adjacent — the player-facing bonus-type list, checked against the wiki.

`CREDIT_BONUS_TYPES` in `web/model.js` is what a player picks from twice: the
Advanced panel's skip picker ("do not use this bonus type for this stat") and the
bonus-type override ("the game disagrees with the wiki"). Both let the player
assert something about a BUCKET, so a name in that list is a claim that the bucket
exists.

The list had grown by absorbing whatever `type` values the built dataset happened
to carry, which is a circular test — the data justified the vocabulary and the
vocabulary described the data. That is how `Sneak Attack` got in: the wiki's
`Sneak attack` page splits the mechanic into Dice and Bonus Damage and gives every
source an ARTIFACT bonus, so `Sneak Attack Bonus` is the affix and `Artifact` is
its type. Offering it let a player skip a bucket the game does not have.

So the list is now checked against the wiki's own `Category:Bonus types`,
harvested into `bonus_type_vocabulary.json`. Three members are real but
uncategorised and are allowed BY NAME with their reason recorded; anything else
has to be in the category.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "bonus_type_vocabulary.json")
MODEL = os.path.join(ROOT, "web", "model.js")
DATASET = os.path.join(ROOT, "web", "data", "items.json")


def _shard():
    with open(SHARD) as fh:
        return json.load(fh)


def _offered():
    """`CREDIT_BONUS_TYPES`, read from the source that actually ships it."""
    with open(MODEL) as fh:
        src = fh.read()
    match = re.search(r"const CREDIT_BONUS_TYPES = \[(.*?)\];", src, re.S)
    assert match, "CREDIT_BONUS_TYPES not found — the guard cannot read what it guards"
    return [m for m in re.findall(r'"([^"]+)"', match.group(1))]


def _wiki_names():
    shard = _shard()
    # `Natural armor` is the wiki's page title; the catalog and equivType both use
    # the plain `Natural`, so compare on the leading word rather than the title.
    return {n.split()[0] if n == "Natural armor" else n
            for n in shard["category_members"] + shard["armor_class_subcategory"]}


def test_every_offered_type_is_a_wiki_bonus_type_or_a_reasoned_exception():
    offered = _offered()
    assert len(offered) > 15, f"only {len(offered)} types offered; the read is not working"
    allowed = _wiki_names()
    shard = _shard()
    exceptions = shard["offered_but_not_categorised"]
    pending = shard["offered_pending_data_fix"]
    stray = [t for t in offered
             if t not in allowed and t not in exceptions and t not in pending]
    assert not stray, (
        f"offered as a bonus type but not one the wiki names: {stray}. Either it is in "
        "Category:Bonus types (re-harvest the shard), or it is real-but-uncategorised "
        "(add it to `offered_but_not_categorised` WITH the wiki sentence that says so), "
        "or it is not a bonus type at all — in which case it belongs in "
        "`offered_pending_data_fix` with the issue that will retype the affixes, and "
        "leaves the picker when that issue closes.")


def test_each_uncategorised_exception_carries_its_evidence():
    """An exception without a reason is just an exemption, and the next reader
    cannot tell a sourced one from a convenient one."""
    for name, reason in _shard()["offered_but_not_categorised"].items():
        if name.startswith("_"):
            continue
        assert len(reason) > 80, f"{name}: no reasoning recorded"


def test_sneak_attack_is_recorded_as_not_a_type_but_stays_offered_until_the_data_is_fixed():
    """The worked case, and the reason `offered_pending_data_fix` exists.

    `Sneak Attack` is the STAT being bonused; the wiki gives its sources an
    Artifact bonus. But 20 affixes still RECORD it as their type, and removing the
    name from the picker does not remove the bucket from the dataset — it removes
    the player's ability to name or correct it. So the truth is recorded here and
    the name stays offered until #608 retypes the affixes.
    """
    entry = _shard()["offered_pending_data_fix"]["Sneak Attack"]
    assert "Artifact" in entry["why_not_a_type"], \
        "the record must keep the type the wiki actually assigns"
    assert entry["issue"] == 608
    assert "Sneak Attack" in _offered(), (
        "dropped from the picker while affixes still record it — that hides the defect "
        "from the one person who could work around it. Fix #608 first, then remove it.")


def test_nothing_sits_in_pending_without_an_issue_to_retire_it():
    """A name offered on the promise of a future fix, with no fix filed, is just an
    exemption. Every entry cites the issue that removes it."""
    for name, entry in _shard()["offered_pending_data_fix"].items():
        if name.startswith("_"):
            continue
        assert isinstance(entry.get("issue"), int), f"{name}: no issue number"
        assert len(entry.get("why_not_a_type") or "") > 80, f"{name}: no evidence it is not a type"
        assert len(entry.get("why_still_offered") or "") > 80, f"{name}: no reason it is still offered"


# A fourth guard was written here and removed. It asserted that every offered type
# is carried by some affix in the catalog, on the reasoning that skipping an
# uncarried type does nothing. The premise does not hold for THIS list, and the
# test said so by failing on three names:
#
#   Primal      — a false positive. `Primal Natural` collapses onto `Primal` through
#                 metadata.stacking_equivalence, so it IS reachable; the test was
#                 matching type names by string suffix instead of applying the map.
#   Morale      — real and uncarried by gear. Greater Heroism's +4 Morale arrives as
#                 a declared CREDIT, not an item affix.
#   Alchemical  — real and uncarried today.
#
# The list is shared with the bonus-type OVERRIDE, where the player corrects an
# affix the game and the wiki disagree about. A correction target legitimately may
# not be carried yet — that is the situation being corrected. So "uncarried" is not
# evidence of "wrong", and a gate on it would fail every time the catalog shifts.
#
# What actually caught `Sneak Attack` is the wiki check above, and that is the one
# worth having: it separates "no gear carries this" (a coverage fact, changes with
# every refresh) from "the game has no such bucket" (a correctness fact).
