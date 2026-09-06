"""#570 — the all-skills roster, guarded instead of dated.

`docs/wiki-evidence/all-skills-grants.md` rules that an all-skills grant expands
into the 21 skills the DDO wiki's `Skill` page enumerates ("This table describes
all the skills present in DDO"), and claims all 21 are rankable targets today.

Both halves are readable at build time, so they are asserted rather than dated —
per `a-dated-coverage-claim-cannot-notice-its-own-staleness.md`. These are
deliberate no-change guards: they pin a property the tree already has, so that a
later edit cannot quietly move it.

The load-bearing one is `test_umbrella_union_is_the_roster_minus_swim`. The
all-skills roster must NOT be assembled from the six ability umbrellas in
`src/spell_focus.py` — their union is 20, missing `Swim`, because each umbrella
quotes a `{{Skills|<ability>|N}}` enchantment tooltip describing what that
enchantment grants, not what skills exist. This test fails if that relationship
drifts in either direction.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import spell_focus  # noqa: E402

DATASET = os.path.join(ROOT, "web", "data", "items.json")

#: The wiki's own all-skills enumeration — https://ddowiki.com/page/Skills,
#: §"List of Skills", read structurally 2026-08-28. Catalog spelling, which
#: differs from the wiki's rendering in one place: the table's "Use Magic Device
#: (UMD)" is `Use Magic Device` here and throughout the dataset.
ALL_SKILLS = (
    "Balance", "Bluff", "Concentration", "Diplomacy", "Disable Device",
    "Haggle", "Heal", "Hide", "Intimidate", "Jump", "Listen", "Move Silently",
    "Open Lock", "Perform", "Repair", "Search", "Spellcraft", "Spot", "Swim",
    "Tumble", "Use Magic Device",
)

#: The one skill in the roster that no ability umbrella covers. See §3 of the
#: ruling: `SKILLS_STR = ["Jump"]` quotes a rendered tooltip and must not be
#: "fixed" by adding Swim to it.
UNCOVERED_BY_UMBRELLAS = "Swim"

UMBRELLAS = (
    spell_focus.SKILLS_CHA, spell_focus.SKILLS_DEX, spell_focus.SKILLS_INT,
    spell_focus.SKILLS_CON, spell_focus.SKILLS_STR, spell_focus.SKILLS_WIS,
)


def _rankable():
    with open(DATASET, encoding="utf-8") as fh:
        return set(json.load(fh)["metadata"]["rankable_affixes"])


def test_the_module_roster_is_this_roster():
    """#717 — the roster gained its first consumer (`Good Luck` expands into it), so
    it now lives in `src/spell_focus.py`. This file keeps its own copy as the
    wiki citation; the two must be one list, or the expansion drifts from the
    ruling it cites."""
    assert tuple(spell_focus.ALL_SKILLS) == ALL_SKILLS


def test_roster_is_twenty_one_and_distinct():
    """Refuse to inspect nothing: the roster is a fixed, duplicate-free 21."""
    assert len(ALL_SKILLS) == 21, f"roster is {len(ALL_SKILLS)}, expected 21"
    assert len(set(ALL_SKILLS)) == 21, "roster carries a duplicate"


def test_every_skill_in_the_roster_is_rankable():
    """The ruling's claim that the expansion needs no new rankability work."""
    rankable = _rankable()
    assert rankable, "dataset reported zero rankable affixes — nothing was inspected"
    missing = [s for s in ALL_SKILLS if s not in rankable]
    assert not missing, (
        f"all-skills roster names {missing}, which metadata.rankable_affixes does "
        "not carry. Either the catalog dropped a skill or the roster is wrong; see "
        "docs/wiki-evidence/all-skills-grants.md before changing either."
    )


def test_umbrella_union_is_the_roster_minus_swim():
    """The relationship the ruling turns on — see this module's docstring."""
    union = set()
    for group in UMBRELLAS:
        union.update(group)
    assert union, "no ability umbrella yielded a skill — nothing was inspected"
    expected = set(ALL_SKILLS) - {UNCOVERED_BY_UMBRELLAS}
    assert union == expected, (
        "the six ability umbrellas no longer union to the all-skills roster minus "
        f"{UNCOVERED_BY_UMBRELLAS}. Extra: {sorted(union - expected)}; "
        f"absent: {sorted(expected - union)}. The umbrellas quote rendered "
        "{{Skills|<ability>|N}} tooltips and the roster quotes the Skill page's "
        "own table; do not reconcile them by editing an umbrella. See "
        "docs/wiki-evidence/all-skills-grants.md section 3."
    )
