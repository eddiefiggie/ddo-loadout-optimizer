"""#908 — set definitions read from the wiki's two set sources.

The fixtures are the wiki's own shapes, copied from `Named item sets` (rev 720202)
and `Template:Named item sets` (rev 723530): see
docs/wiki-evidence/named-item-sets-structure.md."""
import importlib.util
import os

from src import wiki_sets as S
from src.affix_parser import BONUS_TYPES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("diff_harvest_sets", os.path.join(ROOT, "scripts", "diff_harvest_sets.py"))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)

NAMES = {"Spell Power", "Spell Focus Mastery", "Universal Spell Power", "Maximum Spellpoints", "Armor Class (%)",
         "Melee Power", "Ranged Power", "Intelligence", "Wisdom", "Charisma", "Fire Spell Power", "Cold Spell Power"}


# --- HELstats follows Template:HELstats rev 673386 -----------------------------

def test_helstats_positional_wins_over_named():
    assert S.helstats_value("+2|H=+9|L=+4", "Heroic") == "+2"
    assert S.helstats_value("+2|E=+3|L=+4", "Epic") == "+3"
    assert S.helstats_value("+2|L=+4", "Legendary") == "+4"
    assert S.helstats_value("1|2|3|L=9", "Legendary") == "3"


def test_helstats_two_positionals_are_heroic_and_epic_not_heroic_and_legendary():
    assert S.helstats_value("+1|+2", "Epic") == "+2"
    assert S.helstats_value("+1|+2", "Legendary") is None


def test_a_tier_a_call_does_not_state_drops_the_clause_at_that_tier():
    line = "* {{HELstats|L=+4}} [[artifact bonus]] to Deadly"
    assert S.expand_helstats(line, "Heroic") is None
    assert S.expand_helstats(line, "Legendary") == "* +4 [[artifact bonus]] to Deadly"
    assert S.helstats_tiers(line) == ["Legendary"]


# --- piece thresholds are read, never counted -----------------------------------

def test_threshold_header_alone_or_heading_its_first_clause():
    tiers = S._tiers_from_lines(["3 Pieces Equipped:", "* +2 Artifact bonus to Spell Power",
                                 "5 Pieces Equipped: +5 Artifact bonus to Spell Power"])
    assert tiers == {3: ["* +2 Artifact bonus to Spell Power"], 5: ["+5 Artifact bonus to Spell Power"]}


def test_a_prose_threshold_is_not_a_threshold():
    tiers = S._tiers_from_lines(["When both items are equipped, you gain a +2% Artifact bonus to X."])
    assert list(tiers) == [None]


# --- the template ---------------------------------------------------------------

TEMPLATE = """usage notes
<onlyinclude>{{Popup|x|{{#switch:{{lc:{{{1|unknown}}}}}
<!-- A -->
    | adherent of the mists set (legendary) = 5 Pieces Equipped:<br />+30 [[Profane bonus]] to [[Physical Resistance Rating]]<br />+15 Profane bonus to Universal Spell Power{{#vardefine:set|Adherent of the Mists Set (Legendary)}}
    | eminence of autumn = <span><ul><li>2 Pieces Equipped: +25 Artifact bonus to Universal Spell Power</li><li>4 Pieces Equipped: +10% Legendary bonus to Maximum Spellpoints</li></ul></span>
    | this template! = examples
    | #default = Undefined set
}}}}</onlyinclude>"""


def test_template_entries_split_by_tier_and_keep_the_vardefine_name():
    T = S.template_sets(TEMPLATE)
    assert set(T) == {"adherent of the mists set (legendary)", "eminence of autumn"}
    a = T["adherent of the mists set (legendary)"]
    assert a["name"] == "Adherent of the Mists Set (Legendary)"
    assert a["tiers"] == {5: ["+30 [[Profane bonus]] to [[Physical Resistance Rating]]",
                              "+15 Profane bonus to Universal Spell Power"]}
    assert sorted(T["eminence of autumn"]["tiers"]) == [2, 4]


# --- the page -------------------------------------------------------------------

PAGE = """intro
== [[Slave Lords Crafting]] sets ==
{|class="wikitable"
!Set name||Set bonus effect
|-
|{{Anchor|Slave Lord's Sorcery}}'''Slave Lord's Sorcery [ML:8/28]'''
|{{Artifact}}
3 Pieces Equipped:
* {{HELstats|+2|L=+4}} [[artifact bonus]] to Spell Power
5 Pieces Equipped:
* {{HELstats|+5|L=+10}} [[artifact bonus]] to Spell Power
|-
|{{Anchor|Arcane Mind}}'''Arcane Mind'''
|
* {{Item|Arcane Goggles}} - Goggles
| {{SpellPower|Potency|24}}
|}
"""


def test_a_helstats_row_becomes_one_record_per_tier_keyed_by_its_anchor_only():
    rows = S.page_sets(PAGE)
    sorc = [r for r in rows if r["anchors"] == ["Slave Lord's Sorcery"]]
    assert [r["tier"] for r in sorc] == ["Heroic", "Legendary"]
    assert sorc[1]["tiers"] == {3: ["* +4 [[artifact bonus]] to Spell Power"], 5: ["* +10 [[artifact bonus]] to Spell Power"]}


def test_the_artifact_cell_style_template_is_not_a_bonus_line():
    sorc = [r for r in S.page_sets(PAGE) if r["anchors"] == ["Slave Lord's Sorcery"]][0]
    assert None not in sorc["tiers"]


def test_a_row_with_no_header_has_no_threshold():
    mind = [r for r in S.page_sets(PAGE) if r["anchors"] == ["Arcane Mind"]][0]
    assert mind["tier"] is None and list(mind["tiers"]) == [None]


# --- the clause reader is closed -------------------------------------------------

def test_read_clause_reads_an_exact_vocabulary_clause():
    r = S.read_clause("* +4 [[artifact bonus]] to Spell Power", BONUS_TYPES, NAMES)
    assert r == {"affixes": [{"name": "Spell Power", "type": "Artifact", "value": 4}]}
    r = S.read_clause("+10% Legendary bonus to Maximum Spellpoints", BONUS_TYPES, NAMES | {"Maximum Spellpoints (%)"})
    assert r["affixes"][0]["name"] == "Maximum Spellpoints (%)"


def test_read_clause_quarantines_a_phrase_it_would_have_to_translate():
    for line, why in [("+30 Profane bonus to Physical Resistance Rating", "vocabulary"),
                      ("{{SpellPower|Potency|24}}", "template"),
                      ("To-Hit Bonus +2 (untyped, fully stacks)", "typed"),
                      ("+2 Mystery bonus to Spell Power", "bonus type")]:
        r = S.read_clause(line, BONUS_TYPES, NAMES)
        assert "affixes" not in r and why in r["quarantine"], (line, r)


# --- the parity classes -----------------------------------------------------------

def test_classify_exact_partial_differs_and_threshold_questions():
    gp = D.gp_tiers([{"threshold": 3, "affixes": [{"name": "Spell Power", "type": "Artifact", "value": "2"}]}])
    ok = {3: ["+2 Artifact bonus to Spell Power"]}
    assert D.classify(ok, gp, NAMES)[0] == "exact"
    assert D.classify({3: ok[3] + ["+1 Artifact bonus to PRR"]}, gp, NAMES)[0] == "partial"
    assert D.classify({3: ["+3 Artifact bonus to Spell Power"]}, gp, NAMES)[0] == "ours-differs"
    assert D.classify({None: ok[3]}, gp, NAMES)[0] == "threshold-unstated"
    assert D.classify({5: ok[3]}, gp, NAMES)[0] == "threshold-differs"


# --- #951: coordinated lists expand only into exact catalog names -----------------

def _names(line):
    r = S.read_clause(line, BONUS_TYPES, NAMES)
    return [a["name"] for a in r["affixes"]] if "affixes" in r else r["quarantine"]


def test_a_list_with_a_shared_head_expands_into_each_member():
    assert _names("+15 Profane bonus to Melee and Ranged Power") == ["Melee Power", "Ranged Power"]
    assert _names("+2 Artifact bonus to Fire and Cold Spell Power") == ["Fire Spell Power", "Cold Spell Power"]


def test_a_list_of_whole_names_expands_with_no_head():
    assert _names("+3 Artifact bonus to Intelligence, Wisdom, and Charisma") == ["Intelligence", "Wisdom", "Charisma"]


def test_every_member_carries_the_lines_type_and_value():
    r = S.read_clause("+15 Profane bonus to Melee and Ranged Power", BONUS_TYPES, NAMES)
    assert {(a["type"], a["value"]) for a in r["affixes"]} == {("Profane", 15)}


def test_a_list_with_one_member_in_other_words_stays_quarantined():
    assert "vocabulary" in _names("+6% Artifact bonus to Fire and Cold Spellcrit Chance")
    assert "vocabulary" in _names("+10 Profane bonus to PRR and MRR")


def test_two_readings_of_one_list_is_ambiguous_and_quarantined():
    names = {"A Power", "B Power", "A", "B Power"}  # "A and B Power" reads with and without the head
    assert S.expand_list("A and B Power", "", names | {"A"}) is None


def test_a_head_that_makes_two_members_one_name_is_not_a_reading():
    # Legendary Raven's Eye (Template:Named item sets rev 723530):
    # "+3 Artifact bonus to Sneak Attack and Sneak Attack Damage".
    assert S.expand_list("Sneak Attack and Sneak Attack Damage", "", {"Sneak Attack Damage"}) is None
