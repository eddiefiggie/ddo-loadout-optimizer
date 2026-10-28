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


# --- #951: resistance-rating phrases (PRR / MRR / MRR cap) -------------------------

SHELTER = NAMES | {"Physical Sheltering", "Magical Sheltering", "Magical Sheltering Cap"}


def test_resistance_rating_phrases_resolve_to_the_catalogs_sheltering_names():
    for phrase, name in [("Physical Resistance Rating", "Physical Sheltering"), ("PRR", "Physical Sheltering"),
                         ("Magical Resistance Rating", "Magical Sheltering"), ("MRR", "Magical Sheltering"),
                         ("Magical Resistance Rating Cap", "Magical Sheltering Cap")]:
        r = S.read_clause(f"+10 Artifact bonus to {phrase}", BONUS_TYPES, SHELTER)
        assert r == {"affixes": [{"name": name, "type": "Artifact", "value": 10}]}, (phrase, r)


def test_a_list_of_mapped_phrases_expands_through_the_table():
    r = S.read_clause("+10 Profane bonus to PRR and MRR", BONUS_TYPES, SHELTER)
    assert [a["name"] for a in r["affixes"]] == ["Physical Sheltering", "Magical Sheltering"]
    r = S.read_clause("+5 Artifact bonus to Physical and Magical Resistance Rating", BONUS_TYPES, SHELTER)
    assert [a["name"] for a in r["affixes"]] == ["Physical Sheltering", "Magical Sheltering"]


def test_a_mapping_applies_only_when_the_catalog_carries_its_target():
    assert "vocabulary" in S.read_clause("+10 Artifact bonus to PRR", BONUS_TYPES, NAMES)["quarantine"]


def test_gear_planners_sheltering_compares_as_both_ratings():
    gp = D.gp_tiers([{"threshold": 3, "affixes": [{"name": "Sheltering", "type": "Artifact", "value": "10"}]}])
    wiki = {3: ["+10 Artifact Bonus to Physical Resistance Rating", "+10 Artifact Bonus to Magical Resistance Rating"]}
    assert D.classify(wiki, gp, SHELTER)[0] == "exact"


def test_a_recorded_wiki_disagreement_is_not_ours_differs_and_a_new_one_still_is():
    gp = D.gp_tiers([{"threshold": 3, "affixes": [{"name": "Physical Sheltering", "type": "Artifact", "value": "20"}]}])
    rec = [{"set": "Legendary Dreadkeeper", "threshold": 3, "name": "Physical Sheltering", "template": 40, "page": 20}]
    wiki40 = {3: ["+40 Artifact bonus to Physical Resistance Rating"]}
    assert D.classify(wiki40, gp, SHELTER, "Legendary Dreadkeeper", rec)[0] == "wiki-disagrees"
    assert D.classify({3: ["+50 Artifact bonus to Physical Resistance Rating"]}, gp, SHELTER,
                      "Legendary Dreadkeeper", rec)[0] == "ours-differs"
    assert D.classify(wiki40, gp, SHELTER, "Some Other Set", rec)[0] == "ours-differs"


# --- #951: spell DCs ------------------------------------------------------------

def test_spell_dc_phrases_resolve_to_spell_focus_mastery():
    for phrase in ("Spell DCs", "all Spell DCs"):
        r = S.read_clause(f"+3 Artifact bonus to {phrase}", BONUS_TYPES, NAMES)
        assert r == {"affixes": [{"name": "Spell Focus Mastery", "type": "Artifact", "value": 3}]}, (phrase, r)


def test_bare_dcs_does_not_say_spell_and_stays_quarantined():
    assert "vocabulary" in S.read_clause("+2 Profane bonus to DCs", BONUS_TYPES, NAMES)["quarantine"]


# --- #951: Doublestrike and Doubleshot ------------------------------------------

DOUBLE = NAMES | {"Doublestrike", "Doubleshot"}


def test_a_percent_line_to_doublestrike_and_doubleshot_reads_both_bare_names():
    r = S.read_clause("+5% Artifact Bonus to Doublestrike and Doubleshot", BONUS_TYPES, DOUBLE)
    assert r == {"affixes": [{"name": "Doublestrike", "type": "Artifact", "value": 5},
                             {"name": "Doubleshot", "type": "Artifact", "value": 5}]}, r
    r = S.read_clause("+15% Artifact bonus to Doublestrike", BONUS_TYPES, DOUBLE)
    assert r == {"affixes": [{"name": "Doublestrike", "type": "Artifact", "value": 15}]}, r


def test_a_percent_line_to_a_bare_name_not_reviewed_as_a_percentage_stays_quarantined():
    # Melee Power is a catalog name, but a "+5%" bonus to it is not a +5 bonus to it.
    assert "vocabulary" in S.read_clause("+5% Artifact bonus to Melee Power", BONUS_TYPES, DOUBLE)["quarantine"]
    # And a percentage stat the catalog does not carry is not minted.
    assert "vocabulary" in S.read_clause("+5% Artifact bonus to Doubleshot", BONUS_TYPES, NAMES)["quarantine"]


# --- #951: all ability scores ---------------------------------------------------

def test_all_ability_score_phrases_resolve_to_well_rounded():
    names = NAMES | {"Well Rounded"}
    for phrase in ("all Ability Scores", "all ability scores", "all of your Ability Scores"):
        r = S.read_clause(f"+2 Profane bonus to {phrase}", BONUS_TYPES, names)
        assert r == {"affixes": [{"name": "Well Rounded", "type": "Profane", "value": 2}]}, (phrase, r)


def test_a_summons_all_ability_scores_line_is_not_the_wearers_well_rounded():
    names = NAMES | {"Well Rounded"}
    r = S.read_clause("Your Summons, Charmed Monsters, and Hirelings gain +4 to all Ability Scores.",
                      BONUS_TYPES, names)
    assert "quarantine" in r, r
