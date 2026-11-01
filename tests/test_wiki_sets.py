"""#908 — set definitions read from the wiki's two set sources.

The fixtures are the wiki's own shapes, copied from `Named item sets` (rev 720202)
and `Template:Named item sets` (rev 723530): see
docs/wiki-evidence/named-item-sets-structure.md."""
import importlib.util
import json
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


def test_an_unreviewed_prose_threshold_is_not_a_threshold():
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


# --- #951: Fortification Bypass -------------------------------------------------

def test_a_percent_fortification_bypass_line_reads_as_armor_piercing():
    names = NAMES | {"Armor-Piercing"}
    for line in ("+30% Artifact bonus to Fortification Bypass", "+10% Artifact Bonus to Fortification Bypass"):
        r = S.read_clause(line, BONUS_TYPES, names)
        assert r["affixes"][0]["name"] == "Armor-Piercing" and r["affixes"][0]["type"] == "Artifact", r
    assert S.read_clause("+30% Artifact bonus to Fortification Bypass", BONUS_TYPES, names)["affixes"][0]["value"] == 30


def test_a_recorded_upstream_stale_value_is_not_ours_differs_and_an_unrecorded_one_still_is():
    names = NAMES | {"Armor-Piercing"}
    gp = D.gp_tiers([{"threshold": 3, "affixes": [{"name": "Armor-Piercing", "type": "Artifact", "value": "15"}]}])
    wiki = {3: ["+30% Artifact bonus to Fortification Bypass"]}
    rec = [{"set": "Truthful Blow", "threshold": 3, "name": "Armor-Piercing", "type": "Artifact",
            "wiki": 30, "gear_planner": 15}]
    assert D.classify(wiki, gp, names, "Truthful Blow", (), rec)[0] == "upstream-stale"
    # A different wiki value, another set, or gear-planner moving off 15 is not covered.
    assert D.classify({3: ["+40% Artifact bonus to Fortification Bypass"]}, gp, names,
                      "Truthful Blow", (), rec)[0] == "ours-differs"
    assert D.classify(wiki, gp, names, "Some Other Set", (), rec)[0] == "ours-differs"
    gp20 = D.gp_tiers([{"threshold": 3, "affixes": [{"name": "Armor-Piercing", "type": "Artifact", "value": "20"}]}])
    assert D.classify(wiki, gp20, names, "Truthful Blow", (), rec)[0] == "ours-differs"


# --- #951: damage against helpless enemies --------------------------------------

def test_every_recorded_helpless_spelling_reads_as_one_stat():
    names = NAMES | {"Damage vs. the Helpless"}
    for phrase in ("damage vs the Helpless", "Damage vs the Helpless", "damage vs. the helpless",
                   "damage vs. helpless", "Damage vs. Helpless", "damage versus the Helpless",
                   "Damage vs. Helpless opponents", "Damage vs. Helpless Opponents",
                   "Helplessness Damage", "Additional Damage to Helpless Targets", "Damage vs. the Helpless"):
        r = S.read_clause(f"+15% Artifact bonus to {phrase}", BONUS_TYPES, names)
        assert r == {"affixes": [{"name": "Damage vs. the Helpless", "type": "Artifact", "value": 15}]}, (phrase, r)


def test_every_helpless_phrase_is_a_spelling_the_synonym_registry_records():
    # The phrase table may not outgrow the reviewed registry: a new spelling needs
    # its evidence recorded there first.
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "seed", "compendium", "affix_synonyms_registry.json")
    with open(path, encoding="utf-8") as fh:
        registry = json.load(fh)
    entry = next(e for e in _registry_entries(registry) if e.get("name") == "Damage to helpless enemies")
    phrases = [p for p, t in S.STAT_PHRASES.items() if t == "Damage vs. the Helpless"]
    assert len(phrases) >= 10, phrases          # refuses to inspect an empty table
    missing = [p for p in phrases if p not in entry["synonyms"]]
    assert not missing, missing


def _registry_entries(o):
    if isinstance(o, dict):
        if "name" in o and "synonyms" in o:
            yield o
        for v in o.values():
            yield from _registry_entries(v)
    elif isinstance(o, list):
        for v in o:
            yield from _registry_entries(v)


# --- #951: spell power spellings ------------------------------------------------

ELEMENT_SP = {f"{e} Spell Power" for e in ("Acid", "Cold", "Electric", "Fire", "Force",
                                           "Negative", "Positive", "Sonic")}


def test_one_word_spellpower_reads_as_the_catalog_spell_power():
    names = NAMES | ELEMENT_SP
    for phrase, stat in (("Fire Spellpower", "Fire Spell Power"),
                         ("Negative Spellpower", "Negative Spell Power"),
                         ("Universal Spellpower", "Universal Spell Power")):
        r = S.read_clause(f"+30 Artifact bonus to {phrase}.", BONUS_TYPES, names)
        assert r == {"affixes": [{"name": stat, "type": "Artifact", "value": 30}]}, (phrase, r)


def test_a_spellpower_list_reads_each_element():
    names = NAMES | ELEMENT_SP
    r = S.read_clause("+10 Artifact bonus to Fire, Cold, Electric, and Acid Spellpower", BONUS_TYPES, names)
    assert r == {"affixes": [{"name": f"{e} Spell Power", "type": "Artifact", "value": 10}
                             for e in ("Fire", "Cold", "Electric", "Acid")]}, r


def test_a_spellpower_list_naming_an_uncatalogued_element_stays_quarantined():
    names = NAMES | ELEMENT_SP
    for line in ("+10 Artifact bonus to Light, Alignment, and Positive Spellpower",
                 "+10 Artifact bonus to Negative and Poison Spellpower"):
        assert "quarantine" in S.read_clause(line, BONUS_TYPES, names), line


def test_each_spell_power_reads_as_universal_spell_power():
    for phrase in ("each Spell Power", "each Spellpower"):
        r = S.read_clause(f"+25 Artifact bonus to {phrase}", BONUS_TYPES, NAMES)
        assert r == {"affixes": [{"name": "Universal Spell Power", "type": "Artifact", "value": 25}]}, (phrase, r)


def test_every_spellpower_phrase_is_a_fold_the_synonym_registry_records():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "seed", "compendium", "affix_synonyms_registry.json")
    with open(path, encoding="utf-8") as fh:
        registry = json.load(fh)
    folds = {s: e["name"] for e in _registry_entries(registry) for s in e["synonyms"]}
    phrases = {p: t for p, t in S.STAT_PHRASES.items() if p.endswith("Spellpower") and not p.startswith("each")}
    assert len(phrases) >= 9, phrases          # refuses to inspect an empty table
    wrong = {p: t for p, t in phrases.items() if folds.get(p) != t}
    assert not wrong, wrong


# --- #951: spell critical chance and damage ---------------------------------------

LORES = {"Acid Lore", "Fire Lore", "Cold Lore", "Lightning Lore", "Healing Lore", "Kinetic Lore",
         "Radiance Lore", "Repair Lore", "Sonic Lore", "Negative Lore", "Universal Spell Lore"}
CRIT = NAMES | LORES | {"Spell Critical Damage", "Universal Spell Critical Damage"}


def _read(line):
    return S.read_clause(line, BONUS_TYPES, CRIT)


def _crit_names(r):
    return [a["name"] for a in r["affixes"]]


def test_one_damage_types_crit_chance_reads_as_its_lore():
    for line, lore, value in (("+2% Artifact bonus to Fire Spellcrit Chance", "Fire Lore", 2),
                              ("+6 Artifact Bonus to Negative Spell Crit Chance.", "Negative Lore", 6),
                              ("+4% Artifact bonus to Positive Spellcrit Chance", "Healing Lore", 4),
                              ("+2% Artifact bonus to Electric Spellcrit Chance", "Lightning Lore", 2),
                              ("+2% Artifact bonus to Force Spellcrit Chance", "Kinetic Lore", 2)):
        assert _read(line) == {"affixes": [{"name": lore, "type": "Artifact", "value": value}]}, (line, _read(line))


def test_a_crit_chance_list_reads_each_damage_types_lore():
    r = _read("+6% Artifact bonus to Electric, Repair, and Force Spell Critical Chance")
    assert _crit_names(r) == ["Lightning Lore", "Repair Lore", "Kinetic Lore"], r
    r = _read("+6% Artifact bonus to Sonic, Force, Light/Alignment, and Acid Spell Critical Chance")
    assert _crit_names(r) == ["Sonic Lore", "Kinetic Lore", "Radiance Lore", "Acid Lore"], r


def test_damage_types_one_lore_covers_collapse_into_one_bonus():
    # Spell Lore: "Void Lore - negative energy and poison spells", "Radiance Lore ...
    # - light and alignment spells". One bonus to that lore, never two.
    assert _crit_names(_read("+2% Artifact bonus to Negative and Poison Spellcrit Chance")) == ["Negative Lore"]
    assert _crit_names(_read("+6% Artifact bonus to Light, Alignment, and Positive Spellcrit Chance")) \
        == ["Radiance Lore", "Healing Lore"]
    assert _crit_names(_read("+6% Artifact bonus to Negative, Poison, and Force Spell Critical Chance")) \
        == ["Negative Lore", "Kinetic Lore"]


def test_a_repeated_member_outside_the_shared_lores_stays_quarantined():
    # Deliberately NOT proven red: it passes on the pre-change tree too. It pins that
    # the SHARED_STATS exception does not widen the duplicate-member rule.
    # Electric and Lightning are both Lightning Lore, but the wiki states no lore
    # covering two of them, so a list naming both is ambiguous text, not one bonus.
    assert "quarantine" in _read("+6% Artifact bonus to Electric and Lightning Spell Crit Chance")


def test_universal_crit_chance_reads_as_universal_spell_lore_and_bare_does_not():
    for line in ("+6% Artifact bonus to Universal Spell Critical Chance",
                 "+6% Artifact bonus to each Spell Critical Chance"):
        assert _read(line) == {"affixes": [{"name": "Universal Spell Lore", "type": "Artifact", "value": 6}]}, line
    # Spell Lore lists the bare-wording sets under "Artifact lore", not "Artifact
    # Universal lore", so the bare phrase has no reviewed meaning yet.
    assert "quarantine" in _read("+6% Artifact Bonus to Spell Critical Chance")


def test_spell_critical_damage_is_read_as_a_percentage():
    assert _read("+15% Legendary bonus to Spell Critical Damage") == \
        {"affixes": [{"name": "Spell Critical Damage", "type": "Legendary", "value": 15}]}
    assert _read("10% Legendary bonus to Spell Critical Damage") == \
        {"affixes": [{"name": "Spell Critical Damage", "type": "Legendary", "value": 10}]}
    assert _crit_names(_read("+15% Legendary bonus to Universal Spell Critical Damage")) == ["Universal Spell Critical Damage"]


def test_every_crit_chance_target_is_a_lore_the_set_catalog_carries_as_a_percentage():
    path = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_sets.json")
    with open(path, encoding="utf-8") as fh:
        catalog = {a["name"] for tiers in json.load(fh).values() for t in tiers for a in t["affixes"]}
    targets = {t for p, t in S.STAT_PHRASES.items() if "Crit" in p}
    assert len(targets) >= 10, targets          # refuses to inspect an empty table
    assert targets <= catalog, targets - catalog
    assert targets <= S.PERCENT_STATS, targets - S.PERCENT_STATS
    assert S.SHARED_STATS <= targets, S.SHARED_STATS - targets


# --- #951: positive, negative, and repair amplification -------------------------

AMP = {"Healing Amplification", "Negative Amplification", "Repair Amplification"}


def test_an_amplification_list_reads_positive_as_healing_amplification():
    names = NAMES | AMP
    for line in ("+30 Profane bonus to Positive, Negative, and Repair Amplification",
                 "+30 Artifact bonus to Positive, Negative and Repair Amplification"):
        r = S.read_clause(line, BONUS_TYPES, names)
        ty = line.split()[1]
        assert r == {"affixes": [{"name": n, "type": ty, "value": 30} for n in
                                 ("Healing Amplification", "Negative Amplification", "Repair Amplification")]}, (line, r)
    r = S.read_clause("+10 Artifact Bonus to Positive and Negative Amplification", BONUS_TYPES, names)
    assert r == {"affixes": [{"name": n, "type": "Artifact", "value": 10} for n in
                             ("Healing Amplification", "Negative Amplification")]}, r


def test_every_amplification_phrase_is_a_fold_the_synonym_registry_records():
    path = os.path.join(ROOT, "data", "seed", "compendium", "affix_synonyms_registry.json")
    with open(path, encoding="utf-8") as fh:
        registry = json.load(fh)
    folds = {s: e["name"] for e in _registry_entries(registry) for s in e["synonyms"]}
    phrases = {p: t for p, t in S.STAT_PHRASES.items() if p.endswith("Amplification")}
    assert len(phrases) >= 2, phrases          # refuses to inspect an empty table
    wrong = {p: t for p, t in phrases.items() if folds.get(p) != t}
    assert not wrong, wrong


# --- #951: attack and damage ------------------------------------------------------

AD = {"Accuracy", "Deadly", "Sneak Attack Damage"}


def test_attack_and_damage_read_as_accuracy_and_deadly():
    names = NAMES | AD
    for line, ty, v in (("+3 Artifact bonus to Attack and Damage", "Artifact", 3),
                        ("+1 Profane bonus to attack and damage", "Profane", 1)):
        r = S.read_clause(line, BONUS_TYPES, names)
        assert r == {"affixes": [{"name": "Accuracy", "type": ty, "value": v},
                                 {"name": "Deadly", "type": ty, "value": v}]}, (line, r)
    assert S.read_clause("+3 Artifact bonus to Attack", BONUS_TYPES, names) == \
        {"affixes": [{"name": "Accuracy", "type": "Artifact", "value": 3}]}
    assert S.read_clause("+3 Artifact bonus to Damage", BONUS_TYPES, names) == \
        {"affixes": [{"name": "Deadly", "type": "Artifact", "value": 3}]}


def test_a_longer_damage_phrase_is_not_read_as_deadly():
    names = NAMES | AD
    assert S.read_clause("+3 Artifact bonus to Sneak Attack Damage", BONUS_TYPES, names) == \
        {"affixes": [{"name": "Sneak Attack Damage", "type": "Artifact", "value": 3}]}
    for line in ("+3 Artifact bonus to Critical Damage", "+3 Artifact bonus to Attack Speed"):
        assert "quarantine" in S.read_clause(line, BONUS_TYPES, names), line


def test_every_attack_and_damage_phrase_is_a_fold_the_synonym_registry_records():
    path = os.path.join(ROOT, "data", "seed", "compendium", "affix_synonyms_registry.json")
    with open(path, encoding="utf-8") as fh:
        registry = json.load(fh)
    folds = {s.lower(): e["name"] for e in _registry_entries(registry) for s in e["synonyms"]}
    phrases = {p: t for p, t in S.STAT_PHRASES.items() if p.lower() in ("attack", "damage")}
    assert len(phrases) == 4, phrases          # refuses to inspect an empty table
    wrong = {p: t for p, t in phrases.items() if folds.get(p.lower()) != t}
    assert not wrong, wrong


# --- #951: dodge and missile deflection percentages -------------------------------

DODGE = {"Dodge", "Dodge Cap", "Missile Deflection"}


def test_dodge_and_missile_deflection_percent_lines_read_the_bare_catalog_name():
    names = NAMES | DODGE
    for line, stat, ty, v in (("+10% Artifact Bonus to Dodge", "Dodge", "Artifact", 10),
                              ("+3% Legendary bonus to Dodge Cap", "Dodge Cap", "Legendary", 3),
                              ("+2% Artifact Bonus to Missile Deflection.", "Missile Deflection", "Artifact", 2)):
        r = S.read_clause(line, BONUS_TYPES, names)
        assert r == {"affixes": [{"name": stat, "type": ty, "value": v}]}, (line, r)


def test_a_percent_line_to_an_unreviewed_bare_name_stays_quarantined():
    names = NAMES | DODGE | {"Assassinate"}
    assert "quarantine" in S.read_clause("+3% Artifact bonus to Assassinate", BONUS_TYPES, names)


# --- #951: Assassinate difficulty-class wording ---------------------------------

def test_assassinate_dcs_reads_the_flat_stat_and_preserves_value_and_bonus_type():
    names = NAMES | {"Assassinate"}
    for line, ty, value in (("+1 Artifact Bonus to Assassinate DCs", "Artifact", 1),
                            ("+3 Artifact bonus to Assassinate DCs", "Artifact", 3),
                            ("+2 Insight bonus to Assassinate DCs.", "Insight", 2)):
        assert S.read_clause(line, BONUS_TYPES, names) == {
            "affixes": [{"name": "Assassinate", "type": ty, "value": value}]}


def test_subtle_blade_stated_bonus_reaches_exact_catalog_parity():
    with open(D.GP_SETS, encoding="utf-8") as fh:
        catalog = json.load(fh)
    names = {a["name"] for tiers in catalog.values() for tier in tiers for a in tier["affixes"]}
    # Named item sets rev 720202 and its template rev 723530 state this same line.
    classification, detail = D.classify(
        {3: ["+3 Artifact bonus to Assassinate DCs"]},
        D.gp_tiers(catalog["Subtle Blade"]), names, "Subtle Blade")
    assert classification == "exact", (classification, detail)


def test_assassinate_dcs_does_not_admit_percentages_or_ambiguous_dc_phrases():
    names = NAMES | {"Assassinate"}
    for line in ("+3% Artifact bonus to Assassinate DCs",
                 "+3 Artifact bonus to DCs",
                 "+3 Artifact bonus to all Tactical DCs and Assassinate",
                 "+3 Artifact bonus to Assassinate DCs against undead"):
        assert "quarantine" in S.read_clause(line, BONUS_TYPES, names), line
    assert "quarantine" in S.read_clause("+3 Artifact bonus to Assassinate DCs", BONUS_TYPES, NAMES)


# --- #951: maximum hit points retain the flat/percent unit distinction ------------

def test_maximum_hit_points_preserves_flat_and_percent_stats():
    names = NAMES | {"False Life", "False Life (%)"}
    for line, name, ty, value in (
            ("+5% Legendary Bonus to Maximum Hit Points", "False Life (%)", "Legendary", 5),
            ("+10% Legendary bonus to Maximum Hit Points", "False Life (%)", "Legendary", 10),
            ("+10 Artifact bonus to your maximum Hit Points", "False Life", "Artifact", 10),
            ("+10 Artifact bonus to your maximum hit points", "False Life", "Artifact", 10)):
        assert S.read_clause(line, BONUS_TYPES, names) == {
            "affixes": [{"name": name, "type": ty, "value": value}]}


def test_legendary_bulwark_maximum_hit_points_reaches_exact_catalog_parity():
    with open(D.GP_SETS, encoding="utf-8") as fh:
        catalog = json.load(fh)
    names = {a["name"] for tiers in catalog.values() for tier in tiers for a in tier["affixes"]}
    classification, detail = D.classify(
        {3: ["+10% Legendary bonus to Maximum Hit Points"]},
        D.gp_tiers(catalog["Legendary Bulwark"]), names, "Legendary Bulwark")
    assert classification == "exact", (classification, detail)


def test_maximum_hit_points_requires_the_catalog_stat_for_the_stated_unit():
    percent = "+10% Legendary bonus to Maximum Hit Points"
    flat = "+10 Artifact bonus to your maximum hit points"
    assert "quarantine" in S.read_clause(percent, BONUS_TYPES, NAMES | {"False Life"})
    assert "quarantine" in S.read_clause(flat, BONUS_TYPES, NAMES | {"False Life (%)"})
    for line in ("+10 Artifact bonus to temporary hit points",
                 "+10 Artifact bonus to maximum hit points while raging",
                 "+10% Legendary bonus to Maximum Hit Points and Spell Points"):
        assert "quarantine" in S.read_clause(line, BONUS_TYPES, NAMES | {"False Life", "False Life (%)"}), line


# --- #952: exact prose headers from Template:Named item sets rev 723530 ---------

def test_reviewed_prose_headers_assign_the_stated_piece_counts():
    for header, count in (
            ("While wearing two pieces from the Anger of the Avalanche set, you gain:", 2),
            ("While wearing three items from the Dreadkeeper set, you gain:", 3),
            ("While wearing both items from the Brilliant Crescents set, you gain:", 2),
            ("While wearing any five items from the The Devil's Handiwork, you gain:", 5),
            ("When all three items from the set are equipped, you will gain a ", 3)):
        clause = "+2 Artifact bonus to Spell Power"
        assert S._tiers_from_lines([header + clause]) == {count: [clause]}, header


def test_prose_header_preserves_inline_templates_and_links():
    clause = "+1 [[Quality bonus]] to [[Strength]]"
    assert S._tiers_from_lines([
        "While wearing both items from the Captain's Set, you gain: " + clause
    ]) == {2: [clause]}
    # Unexpanded bonus templates must still reach the clause reader's quarantine.
    assert S._tiers_from_lines([
        "While wearing both items from the Captain's Set, you gain: {{Mystery|2}}"
    ]) == {2: ["{{Mystery|2}}"]}


def test_prose_header_reads_the_savant_context_sentence_without_a_stray_none_tier():
    line = ("This item is one of the two pieces of the Air Savant set. "
            "When both items are equipped, you gain a "
            "+2% Artifact bonus to your Electric Spell Critical Chance.")
    assert S._tiers_from_lines([line]) == {
        2: ["+2% Artifact bonus to your Electric Spell Critical Chance."]}


def test_prose_threshold_flows_through_template_reader_and_catalog_parity():
    code = ("<onlyinclude>{{#switch:x|unused\n| captain's set = "
            "While wearing both items from the Captain's Set, you gain: "
            "+1 [[Quality bonus]] to [[Strength]]"
            "{{#vardefine:set|Captain's Set}}\n| #default = Undefined set}}</onlyinclude>")
    entry = S.template_sets(code)["captain's set"]
    with open(D.GP_SETS, encoding="utf-8") as fh:
        catalog = json.load(fh)
    classification, detail = D.classify(
        entry["tiers"], D.gp_tiers(catalog["Captain's Set"]), {"Strength"})
    assert classification == "exact", (classification, detail)


def test_prose_header_changes_tiers_without_reassigning_earlier_lines():
    tiers = S._tiers_from_lines([
        "Unreviewed preface", "While wearing both items from the Captain's Set, you gain:",
        "+1 Quality bonus to Strength", "3 Pieces Equipped: +2 Artifact bonus to Spell Power"])
    assert tiers == {None: ["Unreviewed preface"], 2: ["+1 Quality bonus to Strength"],
                     3: ["+2 Artifact bonus to Spell Power"]}


def test_unreviewed_or_conditional_prose_never_supplies_a_count():
    # Deliberate unchanged boundaries: a word 'both', a near-match, or an item
    # list is not permission to discard conditions or infer an equip threshold.
    for line in (
            "While wearing both items from the Captain's Set and raging, you gain: +1 Quality bonus to Strength",
            "While wearing both items from an unknown set, you gain: +1 Quality bonus to Strength",
            "When all three items from the set are equipped and you are centered, you will gain a +3 Artifact bonus to Strength",
            "When some items from the set are equipped, you gain a +3 Artifact bonus to Strength",
            "This set has three items.", "{{Item|One}} {{Item|Two}}"):
        assert S._tiers_from_lines([line]) == {None: [line]}, line


# Numeric paired headers quoted from Template:Named item sets rev 723530.
# https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530
NUMERIC_PROSE_FIXTURES = {'glacial assault': 'With 2 items equipped - [[Glaciation|Glaciation +72]].  With 3 items equipped '
                    '- [[Glaciation|Glaciation +78]]',
 "levik's defender": 'With 2 items equipped - +3 [[Insight bonus]] to AC, 20% Additional Melee '
                     'Threat, Unlisted Fortitude and Will Save +1 (Stacks with most but not '
                     'Parrying/Greater Parrying).  With 3 items equipped - +5 insight AC, 30% '
                     'Additional Melee Threat (Threat stacks, but only with non-like amounts)',
 "lorikk's champion": 'With 2 items equipped - Provides a +72 [[Equipment bonus]] to healing spell '
                      'power. With 3 items equipped - Provides a +78 Equipment bonus to healing '
                      'spell '
                      'power.{{#ifeq:{{NAMESPACE}}|Item|{{#ifeq:{{IO|{{{nocat|0}}}}}|1||[[Category:Nonstandard '
                      'Spell Power items]]}}</includeonly>}}',
 "tharne's wrath": 'With 2 items equipped - [[Ghost Touch]] and -20% Melee Threat.  With 3 items '
                   'equipped - [[Feather Falling]].'}


def test_numeric_prose_preserves_each_wiki_bonus_under_its_explicit_threshold():
    for name, raw in NUMERIC_PROSE_FIXTURES.items():
        tiers = S._tiers_from_lines([raw])
        assert set(tiers) == {2, 3}, (name, tiers)
        assert len(tiers[2]) == len(tiers[3]) == 1
        # Reconstruct the source including links, templates and punctuation.
        # Only the two stated headers and separator whitespace may be removed.
        reconstructed = ("With 2 items equipped - " + tiers[2][0] +
                         " With 3 items equipped - " + tiers[3][0])
        assert " ".join(reconstructed.split()) == " ".join(raw.split()), name
    assert S._tiers_from_lines([NUMERIC_PROSE_FIXTURES["glacial assault"]]) == {
        2: ["[[Glaciation|Glaciation +72]]."], 3: ["[[Glaciation|Glaciation +78]]"]}


def test_numeric_thresholds_reach_parity_without_inventing_affix_meanings():
    raw = NUMERIC_PROSE_FIXTURES["glacial assault"]
    template = ("<onlyinclude>{{#switch:x|unused\n| glacial assault = " + raw +
                "{{#vardefine:set|Glacial Assault}}\n| #default = Undefined}}</onlyinclude>")
    tiers = S.template_sets(template)["glacial assault"]["tiers"]
    with open(D.GP_SETS, encoding="utf-8") as fh:
        catalog = json.load(fh)
    classification, detail = D.classify(
        tiers, D.gp_tiers(catalog["Glacial Assault"]), {"Cold Spell Power"})
    assert classification == "partial", (classification, detail)
    assert {q["threshold"] for q in detail["quarantined"]} == {2, 3}
    assert len(detail["quarantined"]) == 2  # No stat or bonus type inferred from Glaciation.


def test_numeric_prose_keeps_prior_unknown_text_and_following_explicit_headers():
    tiers = S._tiers_from_lines([
        "Unreviewed preface", NUMERIC_PROSE_FIXTURES["tharne's wrath"],
        "3 Pieces Equipped: +2 Artifact bonus to Spell Power"])
    assert tiers == {None: ["Unreviewed preface"],
                     2: ["[[Ghost Touch]] and -20% Melee Threat."],
                     3: ["[[Feather Falling]].", "+2 Artifact bonus to Spell Power"]}


def test_unreviewed_numeric_prose_or_embedded_headers_remain_unread():
    # Unchanged rejection boundaries: do not invent additional grammar or remove
    # a condition just because a sentence contains the digits 2 and 3.
    for raw in (
            "With 2 items equipped while raging - +2 Artifact bonus to Strength. With 3 items equipped - +3 Artifact bonus to Strength",
            "With 2 items equipped - +2 Artifact bonus to Strength. With 3 items equipped while centered - +3 Artifact bonus to Strength",
            "With 2 items equipped - +2 Artifact bonus to Strength. With 4 items equipped - +4 Artifact bonus to Strength",
            "With 2 items equipped - +2 Artifact bonus to Strength. With 3 items equipped - +3 Artifact bonus to Strength. With 4 items equipped - +4 Artifact bonus to Strength",
            "With 2 items equipped - [[Example|A description. With 3 items equipped - more description]]",
            "With 2 items equipped - {{Example|A description. With 3 items equipped - more description}}",
            'With 2 items equipped - <span title="A description. With 3 items equipped - more description">Text</span>',
            "These 2 items are listed, with 3 bonuses."):
        assert S._tiers_from_lines([raw]) == {None: [raw]}, raw
