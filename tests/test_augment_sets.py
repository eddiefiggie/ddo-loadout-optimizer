"""U1 — Augment Sets (21 "Set Augment: X" Colorless augments). Validates the seed
data/seed/compendium/augment_sets.json builds into the SAME def shape the
membership/intrinsic set path emits: {set_name: {tiers:[{pieces_required, affixes,
...}], tier, wiki_url}} with pre-typed, umbrella-expanded {stat, bonus_type, value}
affixes. Data + defs only; solver wiring is a later unit.

Evidence: docs/wiki-evidence/augment-sets.md (Chrome-MCP DOM read, verified 2026-08-04)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src import membership  # noqa: E402
from src import augment_sets  # noqa: E402
from src import crafting_catalog  # noqa: E402
from src.variants import expand_dataset  # noqa: E402
from src import verify as verify_mod  # noqa: E402
from src.affix_parser import BONUS_TYPES  # noqa: E402

SEED_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed",
                         "compendium", "augment_sets.json")

# The 21 canonical Set Augment names (docs/wiki-evidence/augment-sets.md table).
EXPECTED = {
    "Alluring Elocution", "Arcane Barrier", "Arcane Guardian", "Bold Tactician",
    "Brutal Blows", "Cruel Cut", "Cunning Impact", "Dusk Raider", "Esoterica",
    "Imbued Infusion", "Legendary Bulwark", "Paragon Guard", "Perfect Silence",
    "Piercing Mind", "Quickblade", "Subtle Blade", "Touch of Power",
    "Tough Shields", "Truthful Blow", "Visions of the Beyond", "Wild Fortitude",
}


def test_seed_has_the_21_named_sets():
    seed = json.load(open(SEED_PATH, encoding="utf-8"))["sets"]
    assert set(seed) == EXPECTED, "the seed lists exactly the 21 Set Augments"


def test_all_21_defs_load_with_three_pieces_and_a_typed_affix():
    defs = membership.build_augment_set_defs()
    assert set(defs) == EXPECTED, f"all 21 sets resolve, got {sorted(defs)}"
    for name, d in defs.items():
        # single-tier, always 3 Pieces Equipped
        assert len(d["tiers"]) == 1, f"{name} is single-tier"
        tier = d["tiers"][0]
        assert tier["pieces_required"] == 3, f"{name} fires at 3 pieces"
        assert tier["affixes"], f"{name} carries at least one affix"
        for a in tier["affixes"]:
            assert a["stat"], f"{name} affix has a stat"
            assert isinstance(a["value"], int), f"{name} affix value is numeric"
            # every affix is typed: a known DDO bonus type, or the explicit Untyped marker
            assert a["bonus_type"] in BONUS_TYPES or a["bonus_type"] == "Untyped", \
                f"{name} affix carries a valid bonus type, got {a['bonus_type']!r}"


def test_bonus_values_match_the_wiki_evidence():
    defs = membership.build_augment_set_defs()

    def affix_set(name):
        return {(a["stat"], a["bonus_type"], a["value"])
                for a in defs[name]["tiers"][0]["affixes"]}

    assert ("Charisma", "Artifact", 3) in affix_set("Alluring Elocution")
    assert ("Universal Spell Power", "Artifact", 25) in affix_set("Touch of Power")
    assert ("Physical Sheltering", "Artifact", 30) in affix_set("Tough Shields")
    # multi-stat bonuses split into one affix per stat
    assert ("Melee Power", "Artifact", 15) in affix_set("Dusk Raider")
    assert ("Ranged Power", "Artifact", 15) in affix_set("Dusk Raider")
    assert ("Doublestrike", "Artifact", 15) in affix_set("Quickblade")
    assert ("Doubleshot", "Artifact", 15) in affix_set("Quickblade")


def test_legendary_bulwark_is_a_legendary_bonus_not_artifact():
    defs = membership.build_augment_set_defs()
    affixes = defs["Legendary Bulwark"]["tiers"][0]["affixes"]
    assert len(affixes) == 1
    a = affixes[0]
    assert a["bonus_type"] == "Legendary", "Legendary Bulwark is a LEGENDARY bonus"
    assert (a["stat"], a["value"]) == ("Maximum Hit Points", 10)
    # and nothing else in the roster leaks a Legendary type onto an Artifact set
    for name, d in defs.items():
        if name == "Legendary Bulwark":
            continue
        for a in d["tiers"][0]["affixes"]:
            assert a["bonus_type"] != "Legendary", f"{name} should be Artifact/Untyped, not Legendary"


def test_twenty_of_twentyone_are_artifact():
    defs = membership.build_augment_set_defs()
    artifact = sum(1 for name, d in defs.items()
                   if all(a["bonus_type"] == "Artifact" for a in d["tiers"][0]["affixes"]))
    assert artifact == 20, f"20 Artifact sets (+1 Legendary Bulwark), got {artifact}"


def test_malformed_entry_is_excluded_not_defaulted():
    # A set whose only affix has an unknown bonus type OR a non-numeric value must be
    # DROPPED entirely (exclude-until-verified) — never emitted as an empty/defaulted def.
    raw = {
        "_meta": {"wiki_url": "x"},
        "sets": {
            "Good Set": {"pieces_required": 3,
                         "affixes": [{"stat": "Charisma", "bonus_type": "Artifact", "value": 3}]},
            "Bad Type": {"pieces_required": 3,
                         "affixes": [{"stat": "Charisma", "bonus_type": "Legenary", "value": 3}]},
            "Bad Value": {"pieces_required": 3,
                          "affixes": [{"stat": "Charisma", "bonus_type": "Artifact", "value": "lots"}]},
            "No Stat": {"pieces_required": 3,
                        "affixes": [{"stat": "", "bonus_type": "Artifact", "value": 3}]},
            "No Threshold": {"affixes": [{"stat": "Charisma", "bonus_type": "Artifact", "value": 3}]},
        },
    }
    defs = membership.build_augment_set_defs(raw=raw)
    assert set(defs) == {"Good Set"}, f"only the valid set survives, got {sorted(defs)}"
    assert "Bad Type" not in defs and "Bad Value" not in defs


def test_partial_affix_drop_keeps_the_valid_one():
    # One good + one bad affix -> the bad affix is dropped, the set still resolves on
    # its valid affix (a set is only excluded when NOTHING valid survives).
    raw = {"sets": {"Mixed": {"pieces_required": 3, "affixes": [
        {"stat": "Strength", "bonus_type": "Artifact", "value": 3},
        {"stat": "Dexterity", "bonus_type": "Nonsense", "value": 3},
    ]}}}
    defs = membership.build_augment_set_defs(raw=raw)
    stats = {(a["stat"], a["bonus_type"]) for a in defs["Mixed"]["tiers"][0]["affixes"]}
    assert ("Strength", "Artifact") in stats
    assert ("Dexterity", "Nonsense") not in stats


def test_defs_share_the_membership_def_shape():
    # The augment-set defs resolve through the same def shape/vocabulary as the
    # intrinsic/membership catalog path: {tiers:[{pieces_required, pieces_label,
    # affixes, wiki_url}], tier, wiki_url} with the same affix keys.
    mdefs = membership.build_membership_set_defs()
    adefs = membership.build_augment_set_defs()
    sample_m = next(iter(mdefs.values()))
    sample_a = next(iter(adefs.values()))
    assert set(sample_a) >= {"tiers", "tier", "wiki_url"}
    assert set(sample_a) == set(sample_m), "same top-level def keys as membership defs"
    tier_m = sample_m["tiers"][0]
    tier_a = sample_a["tiers"][0]
    assert set(tier_a) == set(tier_m), "same tier keys as membership defs"
    for a in tier_a["affixes"]:
        assert {"stat", "bonus_type", "value"} <= set(a)


def test_umbrella_expansion_applied_to_augment_affixes():
    # An "all Ability Scores" augment affix umbrella-expands into the six abilities,
    # proving augment defs run through the SAME umbrella path membership defs use.
    raw = {"sets": {"Umb": {"pieces_required": 3, "affixes": [
        {"stat": "all Ability Scores", "bonus_type": "Artifact", "value": 2}]}}}
    defs = membership.build_augment_set_defs(raw=raw)
    stats = {a["stat"] for a in defs["Umb"]["tiers"][0]["affixes"]}
    for ability in ("Strength", "Dexterity", "Constitution",
                    "Intelligence", "Wisdom", "Charisma"):
        assert ability in stats
    assert "all Ability Scores" not in stats


# --- U2: attach + un-quarantine the 21 Set Augment variants -------------------

def _quarantined_set_augment_variants():
    """The 21 native "Set Augment: X" augment variants, expanded and run through
    the verification gate (which quarantines their empty affix list) — the exact
    pre-attach state build_dataset feeds attach_augment_set_slots."""
    pool = crafting_catalog.augment_pool_records(crafting_catalog.load_catalog())
    variants = expand_dataset(pool)
    variants, _cov = verify_mod.apply(variants)
    return variants


def _set_augments(variants):
    return [v for v in variants if augment_sets.is_set_augment(v)]


def test_pre_attach_set_augments_are_quarantined():
    # Baseline: before attach, all 21 are quarantined (empty affixes) with no set data.
    sa = _set_augments(_quarantined_set_augment_variants())
    assert len(sa) == 21, f"exactly 21 Set Augment variants, got {len(sa)}"
    assert all(v.get("verification") == "quarantined" for v in sa)
    assert all("set" not in v for v in sa)


def test_attach_flips_all_21_to_verified_with_set_data():
    variants = _quarantined_set_augment_variants()
    n = augment_sets.attach_augment_set_slots(variants, membership.build_augment_set_defs())
    assert n == 21, f"attach stamps exactly 21, got {n}"
    sa = _set_augments(variants)
    assert len(sa) == 21
    for v in sa:
        assert v["verification"] == "verified", f"{v['source_item']} un-quarantined"
        assert v["set"] == augment_sets.set_name_of(v), "set is the canonical name"
        assert v["set"] in EXPECTED, f"{v['set']} is one of the 21 sets"
        assert v["pieces_required"] == 3, "fires at 3 pieces"
        assert v["set_augment"] is True, "carries the source-family marker"


def test_attach_stamps_exactly_the_21_and_no_dupes():
    # Count is exactly 21, one per canonical set name (no dupes, none dropped).
    variants = _quarantined_set_augment_variants()
    augment_sets.attach_augment_set_slots(variants, membership.build_augment_set_defs())
    stamped = [v for v in _set_augments(variants) if v.get("set_augment")]
    names = [v["set"] for v in stamped]
    assert len(names) == 21
    assert set(names) == EXPECTED, "each of the 21 sets stamped exactly once"
    assert len(set(names)) == len(names), "no duplicate set names"


def test_attach_after_verify_survives_and_is_not_requarantined():
    # Stamping AFTER verify (the Dino-blank pattern) makes the flip stick: the
    # empty affix list must NOT re-quarantine an already-stamped variant.
    variants = _quarantined_set_augment_variants()
    augment_sets.attach_augment_set_slots(variants, membership.build_augment_set_defs())
    # Re-running the verify gate would quarantine empty-affix variants; the point of
    # attaching after verify is that verify is NOT re-run. Confirm the stamped state
    # is the final state seen by the solver.
    sa = _set_augments(variants)
    assert all(v["verification"] == "verified" for v in sa)
    assert all(v.get("set_augment") for v in sa)


def test_def_failing_validation_leaves_variant_quarantined():
    # A Set Augment whose def is excluded (no valid affix survived) must NOT be
    # force-verified — exclude-until-verified, no phantom bonus.
    variants = _quarantined_set_augment_variants()
    partial = membership.build_augment_set_defs()
    dropped = partial.pop("Alluring Elocution")  # simulate a def that failed validation
    assert dropped is not None
    n = augment_sets.attach_augment_set_slots(variants, partial)
    assert n == 20, f"only the 20 resolved sets are stamped, got {n}"
    by_set = {augment_sets.set_name_of(v): v for v in _set_augments(variants)}
    ae = by_set["Alluring Elocution"]
    assert ae["verification"] == "quarantined", "unresolved def stays quarantined"
    assert "set" not in ae and "set_augment" not in ae


## --- #316: forward the color matrix onto the defs + fail-closed join guard ----

SEVEN_COLORS = ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"]


def _matrix_stamped_variants():
    """The pre-attach fixture with the variant-side matrix stamp applied, as
    build_dataset does in its variant loop before attach runs."""
    variants = _quarantined_set_augment_variants()
    for v in variants:
        if augment_sets.is_set_augment(v):
            v[augment_sets.FITS_SLOTS_KEY] = list(SEVEN_COLORS)
    return variants


def test_attach_forwards_fits_slots_onto_defs():
    variants = _matrix_stamped_variants()
    defs = membership.build_augment_set_defs()
    augment_sets.attach_augment_set_slots(variants, defs)
    for name, d in defs.items():
        assert d.get(augment_sets.FITS_SLOTS_KEY) == SEVEN_COLORS, \
            f"{name} def did not receive the forwarded matrix"


def test_def_matrix_join_guard_passes_and_counts_compared():
    variants = _matrix_stamped_variants()
    defs = membership.build_augment_set_defs()
    augment_sets.attach_augment_set_slots(variants, defs)
    assert augment_sets.assert_def_matrix_join(defs) == 21, \
        "guard reports the count it actually compared"


def test_def_matrix_join_guard_red_when_a_variant_is_missing():
    # Corrupt the value and its reference together: remove one variant entirely
    # (the stamp AND its source). The guard must go red naming the set.
    variants = [v for v in _matrix_stamped_variants()
                if augment_sets.set_name_of(v) != "Quickblade"]
    defs = membership.build_augment_set_defs()
    augment_sets.attach_augment_set_slots(variants, defs)
    try:
        augment_sets.assert_def_matrix_join(defs)
    except SystemExit as e:
        assert "Quickblade" in str(e), "failure names the unjoined def"
    else:
        raise AssertionError("guard passed with an unjoined def")


def test_def_matrix_join_guard_refuses_zero_defs():
    # Per-channel vacuity: a zero-record walk is byte-identical to a clean run,
    # so the guard must refuse to inspect nothing.
    try:
        augment_sets.assert_def_matrix_join({})
    except SystemExit as e:
        assert "ZERO" in str(e), "vacuous walk is named as such"
    else:
        raise AssertionError("guard passed a vacuous walk")


def test_augment_set_defs_emitted_with_21_entries():
    # build_augment_set_defs (the source for the top-level augment_set_defs key)
    # resolves exactly the 21 sets.
    defs = membership.build_augment_set_defs()
    assert len(defs) == 21, f"21 augment-set defs, got {len(defs)}"
    assert set(defs) == EXPECTED


# --- U9: canonicalize set-def stat names so the bonuses actually score --------

# The formerly-unreconciled stats that DO have a canonical target in the
# scoring vocabulary. Their raw seed names were rewritten to these canonical
# forms so the bonuses now score (canonical verified against
# data/seed/compendium/affix_aliases.json and vocab_registries.json).
# Cruel Cut joined in #305: the helpless-damage family is one wiki-verified
# mechanic (docs/wiki-evidence/helpless-damage.md), canonical native on the
# Solar Gem of Cruelty affixes.
CANONICALIZED = {
    "Arcane Guardian": "Magical Sheltering",   # was "Magical Resistance Rating"
    "Tough Shields": "Physical Sheltering",    # was "Physical Resistance Rating"
    "Truthful Blow": "Armor-Piercing",         # was "Fortification Bypass"
    "Cruel Cut": "Damage to helpless enemies",  # was "Damage vs. Helpless" (#305)
    # #702: the wiki's wording for the MRR cap; gear-planner (the affix SSOT) spells
    # the same Arcane Barrier bonus `Magical Sheltering Cap`, the name the Solar
    # Gems of MRR Cap and ~16 named-set tiers carry.
    "Arcane Barrier": "Magical Sheltering Cap",  # was "Magical Resistance Rating Cap" (#702)
}

# The former raw names must NOT appear anywhere in the built defs anymore.
FORMER_RAW_NAMES = {
    "Magical Resistance Rating", "Physical Resistance Rating", "Fortification Bypass",
    "Damage vs. Helpless",
    "Magical Resistance Rating Cap", "MRR Cap",
}

# The 4 bonus stats with NO canonical scoring target today. They safely do not
# score and are DISCLOSED in the seed _meta.unscored_stats. Locking this set here
# makes any future vocab addition a DELIBERATE change (update both places).
# `Magical Resistance Rating Cap` left this set in #702: its canonical
# (`Magical Sheltering Cap`) had become rankable and the dated claim never
# noticed — see docs/solutions/conventions/a-dated-coverage-claim-cannot-notice-its-own-staleness.md.
KNOWN_UNSCORED = {
    "Assassinate DCs",
    "Maximum Hit Points", "Spell DCs", "Tactical DCs",
}


def test_aliasable_stats_now_carry_canonical_names():
    # The 3 formerly-unreconciled-but-aliasable stats now use their canonical
    # scoring-vocabulary names (so the set bonuses actually score); the old raw
    # names are gone from every def.
    defs = membership.build_augment_set_defs()
    for set_name, canonical in CANONICALIZED.items():
        stats = {a["stat"] for a in defs[set_name]["tiers"][0]["affixes"]}
        assert canonical in stats, f"{set_name} now carries canonical stat {canonical!r}"
    all_stats = {a["stat"] for d in defs.values() for a in d["tiers"][0]["affixes"]}
    leaked = FORMER_RAW_NAMES & all_stats
    assert not leaked, f"no def still uses a pre-canonical raw stat name: {sorted(leaked)}"


def test_known_unscored_stats_are_the_disclosed_set():
    # The stats with no canonical scoring target are exactly the set disclosed
    # in the seed _meta.unscored_stats, and each still appears verbatim in a built
    # def (left as-is, safely unscored). Any future vocab addition must be a
    # deliberate change to BOTH the seed disclosure and this test.
    seed = json.load(open(SEED_PATH, encoding="utf-8"))
    disclosed = set(seed["_meta"]["unscored_stats"]["stats"])
    assert disclosed == KNOWN_UNSCORED, (
        "seed _meta.unscored_stats.stats matches the documented known-unscored set")
    defs = membership.build_augment_set_defs()
    all_stats = {a["stat"] for d in defs.values() for a in d["tiers"][0]["affixes"]}
    missing = KNOWN_UNSCORED - all_stats
    assert not missing, f"each disclosed unscored stat is still present in a def: {sorted(missing)}"


# --- #289: universal-DC expansion + the def-channel orphan guard -----------------
#
# Esoterica's 3-piece bonus is stored as stat `Spell DCs` — a name no item
# carries and no player can rank. The augment-set-def channel was the one place
# the universal-DC expansion never ran and no orphan guard watched, so the set
# was invisible to every school priority (the Set Bonuses tab could show Tough
# Shields but never Esoterica). The expansion is wired in build_dataset.py where
# the defs are built; these tests pin the mechanism and the guard.

def test_esoterica_tier_expands_to_seven_schools():
    from src import spell_focus
    defs = membership.build_augment_set_defs()
    tier = defs["Esoterica"]["tiers"][0]
    out = spell_focus.expand_affixes(tier["affixes"])
    assert [a["stat"] for a in out] == spell_focus.SCHOOLS
    assert all(a["bonus_type"] == "Artifact" for a in out)
    assert all(a["value"] == 3 for a in out)
    assert all(a[spell_focus.PROVENANCE_KEY] == "Artifact Spell DCs" for a in out)
    assert not any(a["stat"] == "Spell DCs" for a in out)


def test_expansion_is_idempotent_on_an_already_expanded_tier():
    # The membership defs are expanded at a different build_dataset call site;
    # a second pass over expanded affixes must be a no-op, or wiring order
    # changes would silently double affixes.
    from src import spell_focus
    defs = membership.build_augment_set_defs()
    once = spell_focus.expand_affixes(defs["Esoterica"]["tiers"][0]["affixes"])
    twice = spell_focus.expand_affixes(once)
    assert twice == once


def test_set_def_orphans_catches_an_unexpanded_universal_stat():
    from src import enchantment_split
    defs = {"Esoterica": {"tiers": [{"pieces_required": 3, "affixes": [
        {"stat": "Spell DCs", "bonus_type": "Artifact", "value": 3}]}]}}
    away = {"spell dcs": ["Necromancy Focus"]}
    orphans = enchantment_split.set_def_orphans({"augment": defs}, away)
    assert orphans == [("augment:Esoterica", "Spell DCs", "3")]


def test_set_def_orphans_respects_the_allowlist():
    from src import enchantment_split
    defs = {"S": {"tiers": [{"affixes": [
        {"stat": "Speed", "bonus_type": "Enhancement", "value": 30}]}]}}
    away = {"speed": ["Movement Speed"]}
    assert enchantment_split.set_def_orphans({"m": defs}, away, allow=("speed",)) == []


def test_set_def_orphans_refuses_a_vacuous_pass():
    # A guard that inspects zero tiers proves nothing — an empty walk must be an
    # error, not a green light (prove-a-guard-fails convention).
    from src import enchantment_split
    try:
        enchantment_split.set_def_orphans({"augment": {}}, {"spell dcs": []})
    except SystemExit:
        pass
    else:
        raise AssertionError("an empty def walk must raise, not pass")


def test_set_def_orphans_vacuity_is_per_channel_not_aggregate():
    # A populated augment channel must not vouch for a membership channel that
    # quietly emptied: the guard keys on EACH channel walking at least one tier
    # affix, or the real two-channel wiring could go half-dark silently.
    from src import enchantment_split
    populated = {"S": {"tiers": [{"affixes": [
        {"stat": "Strength", "bonus_type": "Artifact", "value": 3}]}]}}
    try:
        enchantment_split.set_def_orphans(
            {"augment": populated, "membership": {}}, {"spell dcs": []})
    except SystemExit as e:
        assert "membership" in str(e)
    else:
        raise AssertionError("one dark channel must raise even when the other walks")


def test_shipped_defs_have_no_orphans_after_expansion():
    from src import enchantment_split, spell_focus, umbrella
    defs = membership.build_augment_set_defs()
    for d in defs.values():
        for tier in d.get("tiers") or []:
            if tier.get("affixes"):
                tier["affixes"] = spell_focus.expand_affixes(tier["affixes"])
    away = {**umbrella.umbrella_expansion(), **spell_focus.expanded_away()}
    assert enchantment_split.set_def_orphans({"augment": defs}, away) == []
