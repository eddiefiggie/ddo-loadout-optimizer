"""U1/U2 — Isle of Dread Dino-crafting parser tests (strict provenance).

Covers the M2 contract: insert UNITS (one unit may carry several affixes,
KTD4), two-key `(category, dino_type)` slot typing (KTD1), weapon/armor/raid
crafted hosts (KTD3), and the strict multi-line clause gate that rejects
conditional/proc/flavor text so a greedy parse never mints a false affix.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import dino_parser  # noqa: E402

_WIKI = "https://ddowiki.com/page/Dinosaur_Bone_crafting"


# --- Accessory insert units (single-affix) -----------------------------------

def test_happy_scale_insert_parses_to_eligible_unit():
    units, quarantined = dino_parser.parse_inserts([
        {"type": "Scale", "effect": "+14 Constitution", "wiki_url": _WIKI},
    ])
    assert quarantined == []
    assert len(units) == 1
    u = units[0]
    assert u["dino_type"] == "Scale"
    assert u["category"] == "Accessory"
    assert len(u["affixes"]) == 1
    assert u["affixes"][0]["stat"] == "Constitution"
    assert u["affixes"][0]["value"] == 14
    assert u["affixes"][0]["bonus_type"] == "Enhancement"
    assert u["wiki_url"] == _WIKI


def test_typed_effect_keeps_its_bonus_type():
    units, _ = dino_parser.parse_inserts([
        {"type": "Fang", "effect": "Insightful Constitution +7", "wiki_url": _WIKI},
    ])
    assert len(units) == 1
    assert units[0]["affixes"][0]["bonus_type"] == "Insightful"
    assert units[0]["affixes"][0]["value"] == 7
    assert units[0]["dino_type"] == "Fang"


def test_missing_wiki_url_is_quarantined_not_emitted():
    units, quarantined = dino_parser.parse_inserts([
        {"type": "Scale", "effect": "+14 Constitution", "wiki_url": ""},
    ])
    assert units == []
    assert quarantined[0]["reason"] == "missing wiki_url"


def test_unparseable_effect_is_quarantined():
    units, quarantined = dino_parser.parse_inserts([
        {"type": "Claw", "effect": "Ghostly", "wiki_url": _WIKI},
    ])
    assert units == []
    assert len(quarantined) == 1


def test_unrecognized_dino_type_is_quarantined():
    units, quarantined = dino_parser.parse_inserts([
        {"type": "Tooth", "effect": "+14 Constitution", "wiki_url": _WIKI},
    ])
    assert units == []
    assert quarantined[0]["reason"] == "unrecognized dino type"


def test_dino_type_is_case_insensitive():
    units, _ = dino_parser.parse_inserts([
        {"type": "horn", "effect": "+30 Physical Resistance Rating", "wiki_url": _WIKI},
    ])
    assert len(units) == 1
    assert units[0]["dino_type"] == "Horn"


# --- Multi-affix inserts are now KEPT as one unit (KTD4) ----------------------

def test_multi_affix_insert_parses_to_one_unit_with_two_affixes():
    # "Fang: Deception" packs two affixes into one insert; the unit model keeps
    # both, gated all-or-nothing by the solver.
    units, quarantined = dino_parser.parse_typed_inserts([
        {"category": "Accessory", "dino_type": "Fang", "name": "Deception",
         "effect": "+11 Enhancement bonus to Sneak Attacks, "
                   "+17 Enhancement bonus to Sneak Attack Damage",
         "wiki_url": _WIKI},
    ])
    assert quarantined == []
    assert len(units) == 1
    affixes = units[0]["affixes"]
    assert len(affixes) == 2
    # The shared parse seam (_parse_effect) folds reviewed spelling synonyms to
    # their canonical stat name: "Sneak Attacks" is a registry synonym of
    # "Deception"; "Sneak Attack Damage" is already canonical.
    assert (affixes[0]["stat"], affixes[0]["value"]) == ("Deception", 11)
    assert (affixes[1]["stat"], affixes[1]["value"]) == ("Sneak Attack Damage", 17)


def test_compound_and_stat_stays_single_affix():
    # A compound stat with ONE value ("Critical Confirmation and Critical
    # Damage") is one affix, not two.
    units, _ = dino_parser.parse_inserts([
        {"type": "Fang", "effect": "+14 Enhancement bonus to Critical Confirmation and Critical Damage",
         "wiki_url": _WIKI},
    ])
    assert len(units) == 1
    assert len(units[0]["affixes"]) == 1
    assert units[0]["affixes"][0]["value"] == 14


def test_stat_with_internal_comma_not_fragmented_then_table_split():
    # "Positive, Negative and Repair Amplification" has a mid-stat comma; the
    # signed-number clause splitter must NOT break it into fragments. The
    # reviewed compound table (#293) then splits the WHOLE name into its three
    # canonical components — each carrying the full bonus_type/value, never a
    # clause fragment like "Negative and Repair Amplification".
    units, _ = dino_parser.parse_typed_inserts([
        {"category": "Armor", "dino_type": "Scale", "name": "X",
         "effect": "+30 Artifact bonus to Positive, Negative and Repair Amplification",
         "wiki_url": _WIKI},
    ])
    assert len(units) == 1
    affixes = units[0]["affixes"]
    assert [(a["stat"], a["bonus_type"], a["value"]) for a in affixes] == [
        ("Healing Amplification", "Artifact", 30),
        ("Negative Amplification", "Artifact", 30),
        ("Repair Amplification", "Artifact", 30),
    ], affixes


def test_conditional_line_is_rejected_but_clean_line_kept():
    # A clean first line + a conditional ("If this is slotted…") second line:
    # keep the clean affix, drop the conditional grant.
    units, _ = dino_parser.parse_typed_inserts([
        {"category": "Weapon", "dino_type": "Fang", "name": "Iridescent Fang",
         "effect": "+7 Equipment bonus to all Spell DCs.\n"
                   "If this is slotted in a Quarterstaff, it also grants +2 Exceptional bonus to Spell DCs.",
         "wiki_url": _WIKI},
    ])
    assert len(units) == 1
    affixes = units[0]["affixes"]
    assert len(affixes) == 1
    # The shared parse seam (_parse_effect) folds reviewed spelling synonyms:
    # "all Spell DCs" is a registry synonym of "Spell Focus Mastery".
    assert affixes[0]["stat"] == "Spell Focus Mastery"
    assert affixes[0]["value"] == 7
    assert affixes[0]["bonus_type"] == "Equipment"


def test_material_type_and_proc_weapon_insert_quarantines():
    units, quarantined = dino_parser.parse_typed_inserts([
        {"category": "Weapon", "dino_type": "Scale", "name": "Flamescale",
         "effect": "Adds Adamantine material type. On hit: 15d6 Fire Damage.",
         "wiki_url": _WIKI},
    ])
    assert units == []
    assert "no parseable affix" in quarantined[0]["reason"]


def test_partial_garbage_keeps_parseable_affix_with_note():
    units, _ = dino_parser.parse_typed_inserts([
        {"category": "Weapon", "dino_type": "Claw", "name": "Mixed",
         "effect": "+2 Exceptional bonus to Strength.\nOn hit: 10d6 Fire Damage.",
         "wiki_url": _WIKI},
    ])
    assert len(units) == 1
    assert units[0]["affixes"][0]["stat"] == "Strength"
    assert units[0]["affixes"][0]["value"] == 2


def test_typed_insert_bad_category_quarantined():
    units, quarantined = dino_parser.parse_typed_inserts([
        {"category": "Trinket", "dino_type": "Scale", "effect": "+14 Constitution", "wiki_url": _WIKI},
    ])
    assert units == []
    assert "unrecognized category" in quarantined[0]["reason"]


# --- Slot layouts now carry type||category keys ------------------------------

def test_accessory_layout_parses_four_typed_slots():
    layouts, quarantined = dino_parser.parse_slot_layouts([
        {"item": "Dinosaur Bone Boots", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}, {"type": "Fang"},
                        {"type": "Claw"}, {"type": "Horn"}],
         "wiki_url": _WIKI},
    ])
    assert quarantined == []
    assert layouts[0]["dino_slots"] == [
        "Scale||Accessory", "Fang||Accessory", "Claw||Accessory", "Horn||Accessory"]


def test_item_without_wiki_url_is_quarantined_whole():
    layouts, quarantined = dino_parser.parse_slot_layouts([
        {"item": "Sketchy Boots", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}], "wiki_url": ""},
    ])
    assert layouts == []
    assert quarantined[0]["reason"] == "missing wiki_url"


def test_slot_multiplicity_preserved():
    layouts, _ = dino_parser.parse_slot_layouts([
        {"item": "Twin Scale Item", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}, {"type": "Scale"}], "wiki_url": _WIKI},
    ])
    assert layouts[0]["dino_slots"] == ["Scale||Accessory", "Scale||Accessory"]


def test_unrecognized_slot_type_dropped_and_quarantined():
    layouts, quarantined = dino_parser.parse_slot_layouts([
        {"item": "Weird Boots", "slot": "accessory",
         "dino_slots": [{"type": "Scale"}, {"type": "Tooth"}], "wiki_url": _WIKI},
    ])
    assert layouts[0]["dino_slots"] == ["Scale||Accessory"]
    assert any(q["reason"].startswith("unrecognized dino slot type") for q in quarantined)


# --- Crafted-host templates (KTD1 two-key, KTD3 hosts) -----------------------

def test_crafted_host_expands_named_items_with_mixed_typing():
    layouts, _ = dino_parser.parse_crafted_hosts([
        {"host_category": "Armors", "items": ["Robe", "Docent"],
         "iod_slots": [{"type": "Scale", "category": "Armor"},
                       {"type": "Fang", "category": "Armor"},
                       {"type": "Claw", "category": "Accessory"},
                       {"type": "Horn", "category": "Accessory"}],
         "set_bonus_slot": True},
    ], _WIKI)
    assert {l["item"] for l in layouts} == {"Robe", "Docent"}
    robe = next(l for l in layouts if l["item"] == "Robe")
    assert robe["dino_slots"] == [
        "Scale||Armor", "Fang||Armor", "Claw||Accessory", "Horn||Accessory"]
    assert robe["set_bonus_slot"] is True


def test_crafted_host_without_items_yields_generic_layout():
    layouts, _ = dino_parser.parse_crafted_hosts([
        {"host_category": "Weapons", "items": [],
         "iod_slots": [{"type": "Scale", "category": "Weapon"}],
         "set_bonus_slot": False},
    ], _WIKI)
    assert len(layouts) == 1
    assert layouts[0]["item"] == "Weapons"
    assert layouts[0]["dino_slots"] == ["Scale||Weapon"]


# --- Set augments (deferred activation; sourced + browsable) -----------------

def test_flavor_bleed_truncated_at_lost_separator():
    # A stat with flavor concatenated (no separator) — "Attack and DamageThe Isle
    # of Dread beckons you" — is truncated at the lowercase->uppercase boundary so
    # only the real stat survives; never mint the flavor into a stat name. The
    # truncated compound then splits via the #293 table (proven by the live
    # Curse membership def: Accuracy + Deadly).
    sets = dino_parser.parse_set_augments([
        {"set_name": "Curse", "threshold": 5,
         "tier_text": "+4 Profane bonus to Attack and DamageThe Isle of Dread beckons you...",
         "wiki_url": _WIKI},
    ])
    affixes = sets[0]["affixes"]
    assert [(a["stat"], a["bonus_type"], a["value"]) for a in affixes] == [
        ("Accuracy", "Profane", 4), ("Deadly", "Profane", 4)], affixes
    assert all(a.get("via") == "Profane Attack and Damage" for a in affixes)


def test_set_augment_splits_concatenated_tier_text():
    sets = dino_parser.parse_set_augments([
        {"set_name": "Dread Stalker", "threshold": 3,
         "tier_text": "+3 Artifact bonus to Sneak Attack Dice"
                      "+15 Artifact bonus to Melee and Ranged Power",
         "wiki_url": _WIKI},
    ])
    assert len(sets) == 1
    assert sets[0]["set"] == "Dread Stalker"
    assert sets[0]["pieces_required"] == 3
    stats = {(a["stat"], a["value"]) for a in sets[0]["affixes"]}
    assert ("Sneak Attack Dice", 3) in stats
    # #293 — the one-value compound is split into its two components (proven by
    # the live Dread Stalker membership def), never kept as a compound key.
    assert ("Melee Power", 15) in stats
    assert ("Ranged Power", 15) in stats
    assert not any(s == "Melee and Ranged Power" for s, _ in stats)


# --- Set-augment spelling fold + per-channel guard (U4) -----------------------

def test_set_augment_stat_folds_synonym_but_raw_stays_verbatim():
    # The wiki tier text spells "Universal Spellpower"; the frozen synonym
    # registry folds it to "Universal Spell Power". The normalized stat folds,
    # the verbatim `raw` does not.
    sets = dino_parser.parse_set_augments([
        {"set_name": "Defender of Tanaroa", "threshold": 3,
         "tier_text": "+25 Artifact bonus to Universal Spellpower",
         "wiki_url": _WIKI},
    ])
    assert len(sets) == 1
    stats = [a["stat"] for a in sets[0]["affixes"]]
    assert stats == ["Universal Spell Power"], stats
    assert sets[0]["raw"] == "+25 Artifact bonus to Universal Spellpower"


def test_shipped_seed_set_records_carry_canonical_spelling_only():
    # End-to-end on the native seed: the three sets that grant spell power carry
    # the canonical name, the misspelling family appears in NO normalized stat,
    # and each raw text is still the verbatim wiki string.
    from src import dino_native
    parsed = dino_parser.parse_dino_crafting(dino_native.native_dino_seed())
    records = parsed["set_records"]
    canonical_sets = {r["set"] for r in records
                     for a in r["affixes"] if a["stat"] == "Universal Spell Power"}
    assert canonical_sets == {"Defender of Tanaroa",
                              "Deacon of the Auricular Sacrarium",
                              "The Legendary Dread Isle's Curse"}, canonical_sets
    assert all(a["stat"] != "Universal Spellpower"
               for r in records for a in r["affixes"])
    raw_carriers = [r["set"] for r in records if "Universal Spellpower" in (r["raw"] or "")]
    assert len(raw_carriers) == 3, raw_carriers  # provenance text untouched


def test_spelling_guard_red_on_fold_away_synonym():
    records = [{"set": "Bad Set", "affixes": [
        {"stat": "Universal Spellpower", "bonus_type": "Artifact", "value": 25, "unit": "flat"},
    ]}]
    try:
        dino_parser.check_set_records_spelling(records)
    except ValueError as e:
        assert "Universal Spellpower" in str(e) and "Universal Spell Power" in str(e), e
    else:
        raise AssertionError("guard passed a fold-away synonym")


def test_spelling_guard_red_on_empty_channel():
    # Zero records is a guard FAILURE, never a pass (per-channel; a sibling
    # channel's coverage vouches for nothing here).
    for empty in ([], None):
        try:
            dino_parser.check_set_records_spelling(empty)
        except ValueError as e:
            assert "zero set records" in str(e), e
        else:
            raise AssertionError("guard passed an empty channel")
    # Records present but affix-less is the same failure.
    try:
        dino_parser.check_set_records_spelling([{"set": "Hollow", "affixes": []}])
    except ValueError as e:
        assert "zero affixes" in str(e), e
    else:
        raise AssertionError("guard passed an affix-less channel")


def test_spelling_guard_green_on_shipped_seed_and_counts():
    from src import dino_native
    parsed = dino_parser.parse_dino_crafting(dino_native.native_dino_seed())
    checked = dino_parser.check_set_records_spelling(parsed["set_records"])
    assert checked > 0


# --- End-to-end on the shipped seed ------------------------------------------


# --- Compound-stat split table (#293) -----------------------------------------

def test_amplification_compound_splits_to_healing_not_positive_both_spellings():
    # The wiki writes the amplification compound in two spellings (with and
    # without the Oxford comma). Both split to the CANONICAL components — the
    # canonical stat is "Healing Amplification", never "Positive Amplification"
    # — proven by both live gear-planner membership defs (Devotion of the
    # Firemouth, Defender of Tanaroa).
    for text in ("+30 Artifact bonus to Positive, Negative and Repair Amplification",
                 "+30 Artifact bonus to Positive, Negative, and Repair Amplification"):
        sets = dino_parser.parse_set_augments([
            {"set_name": "Amp Set", "threshold": 3, "tier_text": text,
             "wiki_url": _WIKI},
        ])
        affixes = sets[0]["affixes"]
        assert [(a["stat"], a["bonus_type"], a["value"]) for a in affixes] == [
            ("Healing Amplification", "Artifact", 30),
            ("Negative Amplification", "Artifact", 30),
            ("Repair Amplification", "Artifact", 30),
        ], (text, affixes)
        assert all("Positive" not in a["stat"] for a in affixes)
        # provenance: the split components carry the originating compound name
        # (bonus-type-prefixed, like umbrella/spell_focus), raw stays verbatim.
        assert all(a.get("via", "").endswith(text.split(" bonus to ")[1]) for a in affixes)
        assert sets[0]["raw"] == text


def test_tactical_dcs_compound_splits_to_combat_mastery():
    # "all Tactical DCs" is the canonical stat "Combat Mastery" — proven by the
    # live Echoes of the Walking Ancestors membership def.
    sets = dino_parser.parse_set_augments([
        {"set_name": "Echoes", "threshold": 3,
         "tier_text": "+3 Artifact bonus to all Tactical DCs and Assassinate",
         "wiki_url": _WIKI},
    ])
    affixes = sets[0]["affixes"]
    assert [(a["stat"], a["value"]) for a in affixes] == [
        ("Combat Mastery", 3), ("Assassinate", 3)], affixes
    assert all(a.get("via") == "Artifact all Tactical DCs and Assassinate"
               for a in affixes)


def test_doublestrike_doubleshot_compound_splits():
    sets = dino_parser.parse_set_augments([
        {"set_name": "Dread Stalker", "threshold": 3,
         "tier_text": "+15 Artifact bonus to Doublestrike and Doubleshot",
         "wiki_url": _WIKI},
    ])
    affixes = sets[0]["affixes"]
    assert [(a["stat"], a["bonus_type"], a["value"]) for a in affixes] == [
        ("Doublestrike", "Artifact", 15), ("Doubleshot", "Artifact", 15)], affixes


def test_unreviewed_compound_stays_whole():
    # A compound NOT in the reviewed table stays one affix (strict provenance:
    # under-count over mis-splitting) — the split is exact-name-keyed.
    sets = dino_parser.parse_set_augments([
        {"set_name": "X", "threshold": 3,
         "tier_text": "+14 Artifact bonus to Critical Confirmation and Critical Damage",
         "wiki_url": _WIKI},
    ])
    affixes = sets[0]["affixes"]
    assert len(affixes) == 1 and affixes[0]["value"] == 14, affixes


# --- Expansion guard: no expanded-away / unsplit-compound survivor (#293) -----

def _rec(stat, bonus_type="Artifact", value=3):
    return [{"set": "Guarded Set", "affixes": [
        {"stat": stat, "bonus_type": bonus_type, "value": value, "unit": "flat"},
    ]}]


def test_expansion_guard_red_on_umbrella_survivor():
    try:
        dino_parser.check_set_records_expanded(_rec("Well Rounded"))
    except ValueError as e:
        assert "Well Rounded" in str(e) and "expanded-away" in str(e), e
    else:
        raise AssertionError("guard passed an unexpanded umbrella name")


def test_expansion_guard_red_on_universal_survivor():
    for stat in ("Spell Focus Mastery", "Potency"):
        try:
            dino_parser.check_set_records_expanded(_rec(stat))
        except ValueError as e:
            assert stat in str(e) and "expanded-away" in str(e), e
        else:
            raise AssertionError(f"guard passed unexpanded universal {stat!r}")


def test_expansion_guard_red_on_unsplit_compound():
    for stat in dino_parser.compound_splits():
        try:
            dino_parser.check_set_records_expanded(_rec(stat))
        except ValueError as e:
            assert stat in str(e) and "unsplit compound" in str(e), e
        else:
            raise AssertionError(f"guard passed unsplit compound {stat!r}")


def test_expansion_guard_red_on_empty_channel():
    # Zero records / zero affixes is a guard FAILURE, never a pass
    # (per-channel; a sibling channel's coverage vouches for nothing here).
    for empty in ([], None):
        try:
            dino_parser.check_set_records_expanded(empty)
        except ValueError as e:
            assert "zero set records" in str(e), e
        else:
            raise AssertionError("guard passed an empty channel")
    try:
        dino_parser.check_set_records_expanded([{"set": "Hollow", "affixes": []}])
    except ValueError as e:
        assert "zero affixes" in str(e), e
    else:
        raise AssertionError("guard passed an affix-less channel")


def test_expansion_guard_green_on_concrete_stats():
    checked = dino_parser.check_set_records_expanded(
        _rec("Melee Power") + _rec("Healing Amplification"))
    assert checked == 2


# --- Built dino_sets channel (#293): reads the generated dataset --------------

def _built_dino_sets():
    path = os.path.join(ROOT, "web", "data", "items.json")
    with open(path) as fh:
        return {s["set"]: s for s in json.load(fh)["dino_sets"]}


_SIX_ABILITIES = ["Strength", "Dexterity", "Constitution",
                  "Intelligence", "Wisdom", "Charisma"]


def test_built_dino_sets_carry_no_umbrella_or_compound_survivor():
    # The whole channel, exactly as emitted: no expanded-away umbrella /
    # universal name and no compound key may survive in any set's stats.
    from src import umbrella, spell_focus
    compounds = set(dino_parser.compound_splits())
    sets = _built_dino_sets()
    assert len(sets) == 6, sorted(sets)
    for name, rec in sets.items():
        for a in rec["affixes"]:
            stat = a["stat"]
            assert not umbrella.is_umbrella(stat), (name, stat)
            assert not spell_focus.is_universal(stat), (name, stat)
            assert stat not in compounds, (name, stat)


def test_built_echoes_and_curse_carry_six_abilities_with_provenance():
    # #293 — the umbrella expansion runs over dino_sets: the six concrete
    # abilities appear at the tier's bonus_type/value, each stamped with the
    # bonus-type-prefixed originating name, matching the live membership defs.
    sets = _built_dino_sets()
    for set_name, btype, value in (
            ("Echoes of the Walking Ancestors", "Artifact", 3),
            ("The Legendary Dread Isle's Curse", "Profane", 2)):
        got = [(a["stat"], a["bonus_type"], a["value"], a.get("via"))
               for a in sets[set_name]["affixes"]
               if a["stat"] in _SIX_ABILITIES]
        want = [(ab, btype, value, f"{btype} Well Rounded")
                for ab in _SIX_ABILITIES]
        assert got == want, (set_name, got)


def test_built_compound_splits_match_live_membership_defs():
    sets = _built_dino_sets()

    def triples(name):
        return {(a["stat"], a["bonus_type"], a["value"])
                for a in sets[name]["affixes"]}

    # Amplification lands Healing (not Positive) Amplification — both carriers.
    for name in ("Devotion of the Firemouth", "Defender of Tanaroa"):
        assert {("Healing Amplification", "Artifact", 30),
                ("Negative Amplification", "Artifact", 30),
                ("Repair Amplification", "Artifact", 30)} <= triples(name), name
    assert {("Melee Power", "Artifact", 15), ("Ranged Power", "Artifact", 15),
            ("Doublestrike", "Artifact", 15), ("Doubleshot", "Artifact", 15),
            } <= triples("Dread Stalker")
    # Re-ratified for #211: `Combat Mastery` is now expanded into its three
    # tactic stats (Stunning/Vertigo/Shatter) at full magnitude — an Artifact
    # Combat Mastery set bonus credited nothing to any tactic priority before.
    assert {("Stunning", "Artifact", 3), ("Vertigo", "Artifact", 3),
            ("Shatter", "Artifact", 3), ("Assassinate", "Artifact", 3),
            } <= triples("Echoes of the Walking Ancestors")
    assert ("Combat Mastery", "Artifact", 3) not in triples(
        "Echoes of the Walking Ancestors")
    assert {("Melee Power", "Profane", 15), ("Ranged Power", "Profane", 15),
            ("Accuracy", "Profane", 4), ("Deadly", "Profane", 4),
            } <= triples("The Legendary Dread Isle's Curse")


def test_built_dino_sets_raw_stays_verbatim():
    # `raw` is wiki provenance and keeps the original umbrella/compound
    # wording even though every normalized stat is expanded/split. The wiki
    # spells the ability umbrella "all Ability Scores" (the registry folds it
    # to "Well Rounded" before umbrella expansion).
    echoes = _built_dino_sets()["Echoes of the Walking Ancestors"]["raw"]
    assert "all Ability Scores" in echoes
    assert "all Tactical DCs and Assassinate" in echoes
    curse = _built_dino_sets()["The Legendary Dread Isle's Curse"]["raw"]
    assert "all Ability Scores" in curse and "Attack and Damage" in curse
    assert "Melee and Ranged Power" in curse
