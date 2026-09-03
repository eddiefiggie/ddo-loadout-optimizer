"""U1/U2/U3 (#205) — universal spell-DC expansion.

The load-bearing cases are the exclusions and the set-bonus channel. A test that
only proves "Spell Focus Mastery expands" would pass against a module that also
expanded Rune Arm Focus or spell lore, both of which would be real regressions.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import spell_focus  # noqa: E402

VIA = spell_focus.PROVENANCE_KEY


def _aff(stat, bt="Equipment", val=3, **extra):
    """An in-memory pipeline affix: `{stat, bonus_type, ...}`, not the at-rest shape."""
    return {"stat": stat, "bonus_type": bt, "value": val,
            "unit": "flat", "raw": "", "eligible": True, **extra}


# ---- what counts as universal -------------------------------------------------

def test_both_universal_names_are_recognized():
    assert spell_focus.is_universal("Spell Focus Mastery")
    assert spell_focus.is_universal("Spell Focus")


def test_detection_is_case_and_whitespace_insensitive():
    assert spell_focus.is_universal("  spell focus mastery ")


def test_rune_arm_focus_is_not_universal():
    # Wiki: "isn't directly tied to a Spell School but to the Rune Arm itself."
    assert not spell_focus.is_universal("Rune Arm Focus")


def test_deific_focus_is_not_universal():
    # Its carriers' tooltips: "On Spell Cast: +1 Sacred bonus to DC of that school
    # for five seconds. Stacks up to III times. Casting a spell from another school
    # clears all stacks." Conditional, ramping, single-school — expanding it would
    # credit +3 Sacred to all seven schools permanently.
    assert not spell_focus.is_universal("Deific Focus")


def test_school_specific_names_are_not_universal():
    for school in spell_focus.SCHOOLS:
        assert not spell_focus.is_universal(school), school


def test_base_spell_lore_is_universal_but_universal_spell_lore_is_not():
    # #366 (2026-08-18) — the two lore universals sit in DIFFERENT families, and
    # which one goes where is the whole ruling.
    #
    # Base `Spell Lore` IS an umbrella: Spell_Lore types it as "an equipment
    # bonus to your chance to score a spell critical" and lists it as a peer of
    # the element lores separated only by coverage ("Spell Lore - all spell
    # types"). No page states a stacking rule for it, so DDO's default applies
    # and a same-type element source competes with it — which is what expansion
    # reproduces. This inverts the original #290 reading; see the module
    # docstring.
    assert spell_focus.is_universal("Spell Lore")

    # `Universal Spell Lore` is the documented EXCEPTION — "a separate and
    # stacking source of Spell Critical chance modifiers" — so it must stay out
    # of this family and cross-add instead. Expanding it would collapse a source
    # the wiki says outright does stack.
    assert not spell_focus.is_universal("Universal Spell Lore")

    # Element lores are targets, never sources.
    for name in ("Void Lore", "Fire Lore"):
        assert not spell_focus.is_universal(name), name


def test_unrelated_focus_names_are_not_universal():
    for name in ("Breath Weapon Focus", "Equipoised Focus", "Raging Focus",
                 "Weapon Focus: Falchion", "Dragonshard Focus: Sentinel"):
        assert not spell_focus.is_universal(name), name


# ---- item channel -------------------------------------------------------------

def test_universal_affix_becomes_seven_schools():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Sacred", 3)])
    assert [a["stat"] for a in out] == spell_focus.SCHOOLS
    assert len(out) == 7


def test_expansion_preserves_bonus_type_and_value():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Sacred", 3)])
    assert all(a["bonus_type"] == "Sacred" for a in out)
    assert all(a["value"] == 3 for a in out)


def test_expansion_preserves_unrelated_keys():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", eligible=False)])
    assert all(a["eligible"] is False for a in out)
    assert all(a["unit"] == "flat" for a in out)


def test_original_universal_name_is_gone():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery")])
    assert not any(spell_focus.is_universal(a["stat"]) for a in out)


def test_bare_spell_focus_expands_identically():
    # Stormreaver's Napkin shape: the wiki's worked example credits it as
    # "+1 to her DCs", plural.
    out = spell_focus.expand_affixes([_aff("Spell Focus", "Equipment", 1)])
    assert [a["stat"] for a in out] == spell_focus.SCHOOLS


def test_excluded_affixes_pass_through_untouched():
    source = [_aff("Rune Arm Focus", "Equipment", 4),
              _aff("Void Lore"), _aff("Universal Spell Lore", "Exceptional", 5),
              _aff("Necromancy Focus"), _aff("Deific Focus", "Sacred", 3)]
    assert spell_focus.expand_affixes(source) == source


def test_expander_does_not_mutate_its_input():
    source = [_aff("Spell Focus Mastery")]
    snapshot = [dict(a) for a in source]
    spell_focus.expand_affixes(source)
    assert source == snapshot


# ---- set-bonus channel (the one `Parrying` missed) ----------------------------

def test_set_bonus_tier_expands():
    variants = [{"affixes": [], "parsed_set_bonuses": [
        {"affixes": [_aff("Spell Focus Mastery", "Profane", 1)]}]}]
    spell_focus.expand_variants(variants)
    tier = variants[0]["parsed_set_bonuses"][0]["affixes"]
    assert [a["stat"] for a in tier] == spell_focus.SCHOOLS
    assert all(a["bonus_type"] == "Profane" for a in tier)


def test_artifact_typed_set_bonus_expands():
    variants = [{"affixes": [], "parsed_set_bonuses": [
        {"affixes": [_aff("Spell Focus Mastery", "Artifact", 2)]}]}]
    spell_focus.expand_variants(variants)
    tier = variants[0]["parsed_set_bonuses"][0]["affixes"]
    assert len(tier) == 7
    assert all(a["value"] == 2 for a in tier)


def test_school_specific_set_bonus_is_untouched():
    source = [_aff("Evocation Focus", "Artifact", 2)]
    variants = [{"affixes": [], "parsed_set_bonuses": [{"affixes": list(source)}]}]
    spell_focus.expand_variants(variants)
    assert variants[0]["parsed_set_bonuses"][0]["affixes"] == source


def test_reports_both_channels_separately():
    # A zero here after a refactor means one channel stopped being reached — the
    # failure mode that shipped a set bonus granting an expanded-away stat.
    variants = [{
        "affixes": [_aff("Spell Focus Mastery")],
        "parsed_set_bonuses": [{"affixes": [_aff("Spell Focus Mastery", "Profane", 1)]}],
    }]
    stats = spell_focus.expand_variants(variants)
    assert stats["items"] == 1
    assert stats["set_bonuses"] == 1


def test_variant_with_no_set_bonuses_is_safe():
    variants = [{"affixes": [_aff("Spell Focus Mastery")]}]
    assert spell_focus.expand_variants(variants)["set_bonuses"] == 0


# ---- provenance ---------------------------------------------------------------

def test_expanded_affix_names_its_source_enchantment():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Sacred", 3)])
    assert all(a[VIA] == "Sacred Spell Focus Mastery" for a in out)


def test_equipment_type_uses_the_unprefixed_name():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Equipment", 5)])
    assert out[0][VIA] == "Spell Focus Mastery"


def test_insight_type_renders_as_insightful():
    out = spell_focus.expand_affixes([_aff("Spell Focus Mastery", "Insight", 4)])
    assert out[0][VIA] == "Insightful Spell Focus Mastery"


def test_native_school_affix_carries_no_provenance():
    out = spell_focus.expand_affixes([_aff("Necromancy Focus", "Sacred", 3)])
    assert VIA not in out[0]


# ---- expanded-away registration ----------------------------------------------

def test_all_universal_names_map_to_their_family_targets():
    away = spell_focus.expanded_away()
    # Re-ratified for #211: the detector's first sweep added three families,
    # then the six ability-skills umbrellas (three worn, three NC-menu-only).
    assert set(away) == {"spell focus mastery", "spell focus", "spell dcs",
                         "potency", "resistance", "elemental resonance",
                         "combat mastery", "charisma skills",
                         "dexterity skills", "intelligence skills",
                         "constitution skills", "strength skills",
                         "wisdom skills",
                         # set-channel wordings of the same families (#289
                         # catalog-wording precedent)
                         "all saving throws", "saving throws", "tactical dcs",
                         # #366 — base Spell Lore joins as Potency's analogue.
                         "spell lore",
                         # #396 — the Litany of the Dead's Combat arm, the first
                         # SELF-NAMED members of this table: their engraved name
                         # is the affix name itself, so `source_label` returns it
                         # unprefixed. Two components, not a school/element set.
                         "litany of the dead - combat bonus",
                         "litany of the dead ii - combat bonus"}
    assert away["litany of the dead ii - combat bonus"] == spell_focus.COMBAT_ROLLS
    assert away["litany of the dead - combat bonus"] == spell_focus.COMBAT_ROLLS
    assert away["spell lore"] == spell_focus.LORE_TARGETS
    # ...and its stacking twin stays OUT, or the expansion would collapse a
    # source the wiki explicitly calls separate and stacking.
    assert "universal spell lore" not in away
    for name in ("spell focus mastery", "spell focus", "spell dcs"):
        assert away[name] == spell_focus.SCHOOLS, name
    assert away["potency"] == spell_focus.SPELLPOWERS
    assert away["resistance"] == spell_focus.SAVES
    assert away["elemental resonance"] == spell_focus.ELEMENTAL_SPELLPOWERS
    assert away["combat mastery"] == spell_focus.TACTICS
    assert away["charisma skills"] == spell_focus.SKILLS_CHA
    assert away["dexterity skills"] == spell_focus.SKILLS_DEX
    assert away["intelligence skills"] == spell_focus.SKILLS_INT
    assert away["constitution skills"] == spell_focus.SKILLS_CON
    assert away["strength skills"] == spell_focus.SKILLS_STR
    assert away["wisdom skills"] == spell_focus.SKILLS_WIS
    assert away["all saving throws"] == spell_focus.SAVES
    assert away["saving throws"] == spell_focus.SAVES
    assert away["tactical dcs"] == spell_focus.TACTICS


def test_expanded_away_keys_are_lowercased():
    assert all(k == k.lower() for k in spell_focus.expanded_away())


def test_expanded_away_returns_independent_lists():
    away = spell_focus.expanded_away()
    away["spell focus"].append("Tampered")
    assert spell_focus.expanded_away()["spell focus"] == spell_focus.SCHOOLS


# ---- built-dataset invariant (the review catch) --------------------------------

def test_no_universal_stat_survives_anywhere_in_the_built_dataset():
    """Every pool, not just the two the variant pass reaches.

    Crafting and choice pools (dino inserts, Viktranium, membership set defs) live
    in their own top-level arrays rather than on a variant, so the variant pass
    cannot see them. Once the universal names leave the picker, an unexpanded
    option in ANY pool targets a stat no player can rank — reachable before the
    expansion, unreachable after. The set-bonus orphan guard does not cover these
    pools, so this is the check that does.
    """
    import json
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return  # generated artifact; the build job asserts it
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    offenders = []

    def walk(node, trail):
        if isinstance(node, dict):
            stat = node.get("stat")
            if isinstance(stat, str) and spell_focus.is_universal(stat):
                offenders.append(trail)
                return
            name = node.get("name")
            if isinstance(name, str) and spell_focus.is_universal(name):
                offenders.append(trail)
                return
            for k, v in node.items():
                walk(v, f"{trail}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{trail}[{i}]")

    for key, value in data.items():
        if key == "metadata":
            continue        # expanded_away_names legitimately NAMES them
        walk(value, key)

    # #194 — green_steel is REACHABLE now (48 Legendary Green Steel blanks), so
    # it is walked like every other pool: the exemption that once stood here was
    # valid only while no host could reach the channel, and its tripwire fired
    # the day the hosts shipped. The pool is ATOMIC, so any universal name it
    # ever carries is expanded INSIDE the option, never across the record list.
    from src import container_registry as _cr
    assert _cr.REGISTRY["green_steel"]["reachable"] is True, (
        "green_steel is declared unreachable again — if the hosts really went "
        "away, the walk above is still correct; if not, the registry is stale")

    assert not offenders, (
        f"{len(offenders)} affix(es) still name an expanded-away universal spell "
        f"focus, so no player can rank them: {offenders[:5]}")


def test_viktranium_universal_option_expands_inside_one_record():
    """R1/R2 — the expansion happens INSIDE a choice-slot option, never across it.

    A Viktranium slot crafting a universal spell-DC option grants that option's
    bonus type and value to all seven schools at once, so a player ranking two
    schools spends ONE slot, not two. Expanding across records made the seven
    schools seven competing options for the same slot — the solver could take
    exactly one, and a two-school ranking needed two Viktranium slots to reach
    what one option already grants in game.
    """
    import json
    path = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(path):
        return  # generated artifact; the build job asserts it
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    records = data.get("viktranium") or []
    assert records, "expected Viktranium pool records in the built dataset"

    universal = []
    for rec in records:
        affixes = rec.get("affixes")
        assert isinstance(affixes, list), (
            "a Viktranium pool record must carry its option's affix LIST — a "
            f"choice-slot option is atomic; got keys {sorted(rec)}")
        expanded = [a for a in affixes if a.get(VIA)]
        if expanded:
            universal.append((rec, expanded))

    assert universal, "expected Viktranium options granting a universal spell DC"
    # #290 widened the machinery to two families, so group each option's stamped
    # affixes by their source label: every label's group must be COMPLETE — all
    # seven schools for a DC source, all ten element spellpowers for Potency —
    # from the one option, at one type and value per label.
    for rec, expanded in universal:
        by_label = {}
        for a in expanded:
            by_label.setdefault(a[VIA], []).append(a)
        for label, group in by_label.items():
            stats = [a["stat"] for a in group]
            # Re-ratified for #211: three more family shapes are legal.
            assert stats in (spell_focus.SCHOOLS, spell_focus.SPELLPOWERS,
                             spell_focus.SAVES,
                             spell_focus.ELEMENTAL_SPELLPOWERS,
                             spell_focus.TACTICS), (
                f"{rec.get('name')} / {label} must grant its full family from "
                f"one option, got {stats}")
            assert len({a["bonus_type"] for a in group}) == 1
            assert len({a["value"] for a in group}) == 1
    # The collapse, measured: 10 universal options, not the 70 flat records the
    # across-records expansion produced. #282 raised it to 18: the eight
    # quarterstaff-variant records (Dolorous Focus x2 tiers, and Melancholic
    # Arcana/Dimlight/Shadows x2 tiers) each carry a universal spell-DC source
    # too, so they expand into the seven schools inside their own record. #290's
    # Potency family raises it further — pin the exact count so a channel that
    # stops expanding shows up as a drop. Re-ratified 20 -> 24 for #211: the
    # Resistance and Combat Mastery families make four more Viktranium options
    # universal (each credited nothing to save/tactic priorities before).
    assert len(universal) == 24, (
        f"expected 24 universal Viktranium options, got {len(universal)}")


# ---- #289: "Spell DCs" is a third universal name -------------------------------
#
# The Esoterica Set Augment's 3-piece bonus is stored as stat `Spell DCs` in the
# wiki-harvested augment-set seed. The wiki-evidence table records the bonus as
# "+3 Artifact ALL Spell DCs" (docs/wiki-evidence/augment-sets.md), and
# gear-planner's own catalog stores the identical bonus as
# `Spell Focus Mastery | Artifact | 3` (raw/gearplanner_sets.json) — a name this
# module already expands. The name is universal by both sources; joining the
# allowlist makes any channel that carries it school-creditable.

def test_spell_dcs_is_universal():
    assert spell_focus.is_universal("Spell DCs")
    assert spell_focus.is_universal("  spell dcs ")


def test_spell_dcs_expands_to_seven_schools_with_provenance():
    out = spell_focus.expand_affixes([_aff("Spell DCs", "Artifact", 3)])
    assert [a["stat"] for a in out] == spell_focus.SCHOOLS
    assert all(a["bonus_type"] == "Artifact" for a in out)
    assert all(a["value"] == 3 for a in out)
    # The receipt names the source the wiki-facing surfaces can display.
    assert all(a[VIA] == "Artifact Spell DCs" for a in out)


def test_spell_dcs_is_registered_as_expanded_away():
    away = spell_focus.expanded_away()
    assert "spell dcs" in away
    assert away["spell dcs"] == spell_focus.SCHOOLS


# ---- #290 (U3): universal SPELLPOWER expansion — Potency --------------------------
#
# The Spell Power page's Affected-damage-types table states "Potency -> All
# Spells", and the Equipment-bonus page names Potency and Combustion as the same
# bonus kind with the don't-stack rule outright. Expanding Potency into the ten
# element spellpowers at the same bonus type reproduces both rules through the
# existing bucketing. `Universal Spell Power` is the deliberate exclusion: the
# wiki says it FULLY STACKS ("flat adds to all of your other Spell Powers"), so
# same-type expansion would wrongly put it in max-competition.
# Evidence: docs/wiki-evidence/spellpower-universal.md.

def test_potency_is_universal():
    assert spell_focus.is_universal("Potency")
    assert spell_focus.is_universal("  potency ")


def test_potency_expands_to_the_ten_element_spellpowers():
    out = spell_focus.expand_affixes([_aff("Potency", "Equipment", 25)])
    assert [a["stat"] for a in out] == spell_focus.SPELLPOWERS
    assert len(out) == 10
    assert all(a["bonus_type"] == "Equipment" for a in out)
    assert all(a["value"] == 25 for a in out)
    assert all(a[VIA] == "Potency" for a in out)


def test_insight_potency_labels_as_insightful():
    out = spell_focus.expand_affixes([_aff("Potency", "Insight", 36)])
    assert all(a[VIA] == "Insightful Potency" for a in out)
    assert all(a["bonus_type"] == "Insight" for a in out)


def test_universal_spell_power_is_not_expanded():
    source = [_aff("Universal Spell Power", "Implement", 31),
              _aff("Universal Spell Power", "Exceptional", 5)]
    out = spell_focus.expand_affixes([dict(a) for a in source])
    assert out == source, "USP fully stacks — it must stay its own bucket"
    assert not spell_focus.is_universal("Universal Spell Power")


def test_element_spellpowers_are_not_universal():
    for name in spell_focus.SPELLPOWERS:
        assert not spell_focus.is_universal(name), name


def test_potency_expanded_away_maps_to_spellpowers_not_schools():
    away = spell_focus.expanded_away()
    assert away["potency"] == spell_focus.SPELLPOWERS
    assert away["spell focus mastery"] == spell_focus.SCHOOLS, \
        "the DC family still maps to the seven schools"


# --- #211: the detector's first-sweep families --------------------------------
#
# Three umbrellas found by the umbrella detector, each with its rendered-tooltip
# quote in the module beside its component list.
# Evidence: docs/wiki-evidence/umbrella-adjudication-sweep.md.

def test_resistance_expands_to_the_three_saves():
    out = spell_focus.expand_affixes([_aff("Resistance", "Resistance", 8)])
    assert [a["stat"] for a in out] == spell_focus.SAVES
    assert all(a["bonus_type"] == "Resistance" for a in out)
    assert all(a["value"] == 8 for a in out)


def test_resistance_label_is_never_doubled():
    # The classic enchantment CARRIES the Resistance bonus type; the engraved
    # name is bare "Resistance", never "Resistance Resistance".
    out = spell_focus.expand_affixes([_aff("Resistance", "Resistance", 8)])
    assert all(a[VIA] == "Resistance" for a in out)


def test_elemental_resonance_expands_to_the_four_elements():
    out = spell_focus.expand_affixes([_aff("Elemental Resonance", "Equipment", 70)])
    assert [a["stat"] for a in out] == spell_focus.ELEMENTAL_SPELLPOWERS
    assert len(out) == 4, "four elements, NOT the ten-power Potency family"
    assert all(a[VIA] == "Elemental Resonance" for a in out)


def test_combat_mastery_expands_to_the_three_tactics():
    out = spell_focus.expand_affixes([_aff("Combat Mastery", "Insight", 6)])
    assert [a["stat"] for a in out] == spell_focus.TACTICS
    assert all(a[VIA] == "Insightful Combat Mastery" for a in out)


def test_the_tactic_components_are_not_universal():
    for name in spell_focus.TACTICS + spell_focus.SAVES:
        assert not spell_focus.is_universal(name), name


# --- #396: the Litany of the Dead's Combat arm ------------------------------
#
# "+N Profane bonus to attack bonus and damage" — wiki-settled onto the
# `Accuracy` / `Deadly` buckets (docs/wiki-evidence/litany-of-the-dead.md), and
# the first SELF-NAMED members of `_UNIVERSAL`: the affix name IS the engraved
# name, so no bonus-type prefix may be added to it.

COMBAT = "Litany of the Dead II - Combat Bonus"


def test_combat_arm_expands_into_accuracy_and_deadly_preserving_type_and_value():
    out = spell_focus.expand_affixes([_aff(COMBAT, "Profane", 4)])
    assert sorted(a["stat"] for a in out) == ["Accuracy", "Deadly"]
    assert all(a["bonus_type"] == "Profane" and a["value"] == 4 for a in out)


def test_combat_arm_provenance_is_the_engraved_name_verbatim():
    """The SELF_NAMED rule: no type prefix on an already-complete name."""
    out = spell_focus.expand_affixes([_aff(COMBAT, "Profane", 4)])
    assert {a[VIA] for a in out} == {COMBAT}
    # ...while every generic family member still gets its prefix. Without this
    # arm, dropping the prefix wholesale would pass the assertion above.
    generic = spell_focus.expand_affixes([_aff("Combat Mastery", "Insight", 7)])
    assert {a[VIA] for a in generic} == {"Insightful Combat Mastery"}


def test_self_named_covers_every_named_umbrella_member():
    """The two registries live in different modules and must not drift.

    `umbrella._NAMED_UMBRELLA` decides WHICH names expand into the six
    abilities; `spell_focus.SELF_NAMED` decides which names take no type
    prefix. Every named umbrella is self-named by construction — if one is ever
    added to the first without the second, its label silently regains a prefix
    and prints a name no item bears.
    """
    from src import umbrella
    assert umbrella._NAMED_UMBRELLA <= spell_focus.SELF_NAMED
    assert umbrella._NAMED_UMBRELLA, "the guard inspects a non-empty set"


def test_self_named_does_not_leak_onto_generic_names():
    for name, bt, expected in [
        ("Well Rounded", "Profane", "Profane Well Rounded"),
        ("Spell Focus Mastery", "Insight", "Insightful Spell Focus Mastery"),
        ("Potency", "Quality", "Quality Potency"),
    ]:
        assert spell_focus.source_label(name, bt) == expected, name


def test_shipped_dataset_expands_both_combat_tiers():
    """Behavior against the real dataset, including the value the wiki squares."""
    import json
    p = os.path.join(ROOT, "web", "data", "items.json")
    if not os.path.exists(p):
        return
    d = json.load(open(p, encoding="utf-8"))
    by_id = {v.get("variant_id"): v for v in d["items"]}
    # The Combat arm grants the template's first parameter SQUARED, so the Epic
    # tier is +4 and not +2 — pinned here so a re-read of the template that
    # dropped the #expr would be caught.
    expected = {
        "Litany of the Dead": ("Litany of the Dead - Combat Bonus", "1"),
        "Epic Litany of the Dead": ("Litany of the Dead II - Combat Bonus", "4"),
    }
    checked = 0
    for variant_id, (label, value) in expected.items():
        v = by_id.get(variant_id)
        assert v is not None, f"{variant_id} left the roster — re-verify the ruling"
        members = [a for a in v.get("affixes", []) or [] if a.get("via") == label]
        assert sorted(a["name"] for a in members) == ["Accuracy", "Deadly"], \
            f"{variant_id}: expected Accuracy + Deadly under {label!r}, got {members}"
        for a in members:
            assert a.get("type") == "Profane", f"{variant_id}: {a['name']} is {a.get('type')!r}"
            assert str(a.get("value")) == value, f"{variant_id}: {a['name']} = {a.get('value')!r}"
        checked += 1
    assert checked == 2, "the guard inspected fewer than both tiers"
