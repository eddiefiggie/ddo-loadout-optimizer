"""U8 semantic invariant guards for the gear-planner native-schema overhaul.

Complements the behavioral golden guard (tests/solver_golden.test.js) with three
structural invariants asserted directly against the built web/data/items.json:

  1. NO legacy affix keys survive at rest — item affixes carry ONLY
     name/type/value (+ the eligible flag); stat/bonus_type/unit are gone.
  2. Ophael's Cincture carries its 6 base-ability +15 Enhancement affixes — the
     one sanctioned KTD4 gap-fill (gap_corrections overlay) is intact.
  3. The stacking-equivalence collapse is embedded (Insight Natural -> Insight,
     Primal Natural -> Primal) so the solver buckets equivalent types as one.
     (Behavioral proof of the collapse lives in solver.test.js U4b-i.)

Discovered + run by tests/run_tests.py.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

sys.path.insert(0, ROOT)
from src import vocabulary  # noqa: E402

_LEGACY_AFFIX_KEYS = {"stat", "bonus_type", "unit", "minimum_level"}
# `via` names the enchantment an EXPANDED affix came from — "Sacred Spell Focus
# Mastery" (#205), and since R12 every other expansion family too ("Profane Well
# Rounded", "Parrying", "Speed", "Heightened Awareness"). It is display
# provenance, not a legacy key: the solver never reads it, but the proof panel
# and share exports must show what is engraved on the item rather than the stat
# the value was credited to. Already allowed here, so R12 needed no widening —
# the coverage test below is what proves every family actually writes it.
_ALLOWED_AFFIX_KEYS = {"name", "type", "value", "eligible", "via"}


def _load():
    with open(DATASET, "r", encoding="utf-8") as fh:
        return json.load(fh)


def test_no_legacy_affix_keys_at_rest():
    """Every item affix carries only native keys; no stat/bonus_type/unit."""
    data = _load()
    items = data["items"]
    # 9108 = 9045 + the 63 wiki-sourced ML36 augments (#260), re-ratified 2026-08-12.
    #
    # #374/U4 — re-ratified 9108 -> 9110. The whole delta is upstream's scraper
    # moving its ROSTER (raw item records 8188 -> 8190); nothing in this repo's
    # pipeline changed how many variants an item yields. Attributed name by name,
    # and each of the 26 moved items yields exactly one variant, so the built
    # delta equals the raw delta:
    #
    #   +14  7 new `Flame Blade (level N)` tiers, and 7 items that upstream
    #        RENAMED into the existing `… of the Oozing Hunger` family
    #        (`… of Doublestrike N` -> `… of the Oozing Hunger`)
    #   -12  the 8 `… of Doublestrike N` names those renames vacated, the
    #        de-duplicated `Legendary Dart of the Oozing Hunger of the Oozing
    #        Hunger`, and 3 retired names (`Allegiance (historic)`,
    #        `Legendary Sceptre`, `Potent 49 Sceptre`)
    #   ----
    #    +2  net
    #
    # The Oozing Hunger renames are a rename, not a loss: every Legendary tier of
    # that family was already in the roster before the refresh.
    # #631 — re-ratified 9110 -> 9191. PLUS 81, and every one is an Epic (ML 20)
    # Lunar/Solar gem the upstream crafting dump does not carry: the wiki lists 103
    # gem families at three tiers, upstream had 103 Heroic, 103 Legendary and 17
    # Epic, and current upstream master carries the same 17 — so this is a hole, not
    # a stale snapshot. Unlike the #374 delta above, NOTHING moved upstream; the
    # roster is unchanged at 8,036 and the whole gain is the tier-gap shard.
    #
    # 81 rather than 86: three families have no Epic tier on the wiki at all
    # (Lunar Accuracy, Lunar Natural Armor, Solar Enduring), `Solar Gem of Arcana`
    # has no upstream record at any tier to derive a shape from, and `Lunar Gem of
    # Weapon Damage` is deliberately excluded — its Heroic value disagrees with the
    # wiki, so it failed the cross-check that validates every other Epic value.
    # #640 — 9,194: +3, the `Solar Gem of Arcana` family. Upstream carries it at NO
    # tier, so unlike #631's Epic-only gap this adds a whole family rather than a
    # missing tier of an existing one.
    assert len(items) == 9194, f"expected 9194 items, saw {len(items)}"
    gems = [it for it in items
            if "(Epic)" in (it.get("source_item") or "")
            and (it.get("source_item", "").startswith("Lunar Gem")
                 or it.get("source_item", "").startswith("Solar Gem"))]
    assert len(gems) == 99, (
        f"expected 99 Epic Lunar/Solar gems (17 upstream + 81 from #631 + 1 from #640) "
        f"shard), saw {len(gems)} — a coincidental count from an unrelated cause "
        "would satisfy the total alone.")
    # the +2 is those 26 items and nothing else — a coincidental +2 from an
    # unrelated cause would satisfy the count alone.
    by_name = {it.get("source_item") for it in items}
    for name in ("Flame Blade (level 1)", "Flame Blade (level 30)",
                 "Buckler of the Oozing Hunger", "Sceptre of the Oozing Hunger"):
        assert name in by_name, name
    for name in ("Buckler of Doublestrike 4", "Legendary Sceptre",
                 "Potent 49 Sceptre", "Allegiance (historic)",
                 "Legendary Dart of the Oozing Hunger of the Oozing Hunger"):
        assert name not in by_name, name
    offenders = []
    extra = set()
    for it in items:
        for a in it.get("affixes") or []:
            keys = set(a.keys())
            if keys & _LEGACY_AFFIX_KEYS:
                offenders.append((it.get("source_item"), sorted(keys)))
            extra |= keys - _ALLOWED_AFFIX_KEYS
    assert not offenders, f"{len(offenders)} item(s) still carry legacy affix keys: {offenders[:5]}"
    assert not extra, f"unexpected non-native affix keys at rest: {sorted(extra)}"


# --------------------------------------------------------------- R12: provenance at rest
#
# An expansion turns one enchantment the player sees engraved on the item into
# several concrete affixes the solver can match. Every build-time expansion
# family stamps the originating name under `via` so a consumer can collapse the
# group back to the one line the item bears — and the stamp has to SURVIVE, past
# `src/variants.py`'s affix rebuild and past `build_dataset._native_affix`.
# Spell focus alone escaped the first of those only because it expands after it.
#
# The two browser-side families (bare Sheltering, boolean composites) expand at
# load time in `web/dataset.js` and so are absent here by construction; they are
# covered by `tests/dataset.test.js`.

_EXPANSION_FAMILIES_AT_REST = {
    # family -> a predicate over the `via` string it stamps
    "spell focus": lambda s: s.endswith("Spell Focus Mastery") or s.endswith("Spell Focus"),
    "umbrella": lambda s: s.endswith("Well Rounded") or s.endswith("All Ability Scores"),
    "parrying": lambda s: s == "Parrying",
    "speed": lambda s: s == "Speed",
    "heightened awareness": lambda s: s == "Heightened Awareness",
    # #249 — the compound absorptions stamp at BIRTH rather than by retrofit, so
    # this entry is the only thing that would catch the stamp being dropped on the
    # newest family. Bare, like parrying and speed: the wiki's visible cell reads
    # "Fire and Cold Absorption +22%" with the bonus type only in the tooltip.
    "compound absorption": lambda s: s in (
        "Fire and Cold Absorption", "Electricity and Acid Absorption",
        "Elemental Absorption"),
}


def test_every_build_time_expansion_family_stamps_provenance_at_rest():
    data = _load()
    seen = {name: 0 for name in _EXPANSION_FAMILIES_AT_REST}
    for it in data["items"]:
        for a in it.get("affixes") or []:
            label = a.get("via")
            if not label:
                continue
            for name, matches in _EXPANSION_FAMILIES_AT_REST.items():
                if matches(label):
                    seen[name] += 1
    missing = sorted(n for n, count in seen.items() if count == 0)
    assert not missing, (
        "these expansion families ship no provenance stamp at rest — the key was "
        f"dropped between the expansion and the built dataset: {missing} (counts: {seen})")


def test_a_native_school_specific_affix_carries_no_provenance():
    """Presence of `via` is what tells an expanded affix from a native one. A
    school focus the item really bears must claim no originating enchantment,
    or the discriminator is worthless."""
    data = _load()
    natives = 0
    for it in data["items"]:
        for a in it.get("affixes") or []:
            if a.get("name") == "Necromancy Focus" and not a.get("via"):
                natives += 1
    assert natives > 0, ("no unstamped native Necromancy Focus affix remains — either "
                         "the dataset changed or the stamp is being applied to natives")


def test_ophaels_cincture_abilities_are_seal_only():
    """Ophael's ability scores are the single-pick 'Sealed in Undeath' pool, NOT flat
    affixes. The prior gap-fill wrongly appended all 18 Undeath seal outcomes as
    all-apply affixes, so a solve credited +15/+7/+3 to EVERY ability score
    (fixed 2026-08-02: the gap-fill was a misread of the seal pool)."""
    data = _load()
    oph = next((it for it in data["items"] if (it.get("source_item") or "") == "Ophael's Cincture"), None)
    assert oph is not None, "Ophael's Cincture must be present in the dataset"
    abilities = {"Strength", "Constitution", "Dexterity", "Intelligence", "Wisdom", "Charisma"}
    have = {(a.get("name"), a.get("type"), str(a.get("value"))) for a in oph.get("affixes") or []}
    leaked = [a for a in have if a[0] in abilities]
    assert not leaked, f"ability scores must come from the seal, not flat affixes: {leaked}"
    # Deception/Seeker (gear-planner native) still present.
    assert ("Seeker", "Enhancement", "15") in have, "native Seeker +15 must remain"
    assert ("Deception", "Enhancement", "12") in have, "native Deception +12 must remain"
    # The single-pick 'Sealed in Undeath' slot (the real source of the ability bonus).
    assert any(s.get("seal_type") == "Undeath" for s in oph.get("seal_slots") or []), \
        "Ophael must keep its 'Sealed in Undeath' single-pick slot"


def test_stacking_equivalence_collapse_embedded():
    """The dataset carries the curated stacking-equivalence map the solver installs."""
    data = _load()
    equiv = data["metadata"].get("stacking_equivalence") or {}
    assert equiv.get("Insight Natural") == "Insight", \
        "Insight Natural must bucket as Insight (stacking-equivalence collapse)"
    assert equiv.get("Primal Natural") == "Primal", \
        "Primal Natural must bucket as Primal (stacking-equivalence collapse)"


# --------------------------------------------------------------- U6: synonym-collision gate
#
# Upstream folds distinct game mechanics under one affix name via its
# affix-synonyms table (`Speed` <- `Striding` is the one that produced #154:
# Striding grants movement only, the Speed enchantment also grants melee/ranged
# attack speed, and collapsing them lost the attack-speed half). The gate diffs
# the vendored upstream table against a frozen registry so a future re-import
# that changes a fold fails the build instead of silently re-merging mechanics.

def test_affix_synonyms_frozen_matches_upstream():
    """The frozen registry matches the vendored upstream table (no drift at rest)."""
    checked = vocabulary.check_affix_synonyms(
        vocabulary.load_live_affix_synonyms(),
        vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH))
    assert checked > 0, "gate must validate at least one mapping"


def test_affix_synonyms_registry_records_the_speed_fold():
    """The Speed <- Striding fold is frozen — the case the gate exists to have caught."""
    frozen = vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH)
    syns = {e["name"]: set(e["synonyms"]) for e in frozen["affix_synonyms"]}
    assert "Striding" in syns.get("Speed", set()), \
        "Speed <- Striding must be frozen; it is the fold that produced #154"


def test_affix_synonyms_gate_flags_added_mapping():
    """A synonym upstream did not fold before fails the build, naming both sides."""
    frozen = vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH)
    live = [dict(e, synonyms=list(e["synonyms"])) for e in frozen["affix_synonyms"]]
    live[0]["synonyms"].append("Zzz Invented Stat")
    try:
        vocabulary.check_affix_synonyms(live, frozen)
    except vocabulary.IntegrityError as exc:
        assert "Zzz Invented Stat" in str(exc) and live[0]["name"] in str(exc), \
            f"message must name both sides of the fold, got: {exc}"
    else:
        raise AssertionError("an added synonym must raise IntegrityError")


def test_affix_synonyms_gate_flags_removed_mapping():
    """A synonym upstream stopped folding fails the build."""
    frozen = vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH)
    live = [dict(e, synonyms=list(e["synonyms"])) for e in frozen["affix_synonyms"]]
    dropped = live[0]["synonyms"].pop()
    try:
        vocabulary.check_affix_synonyms(live, frozen)
    except vocabulary.IntegrityError as exc:
        assert dropped in str(exc), f"message must name the removed synonym, got: {exc}"
    else:
        raise AssertionError("a removed synonym must raise IntegrityError")


def test_affix_synonyms_gate_flags_repointed_synonym():
    """A synonym re-pointed to a different canonical name fails the build.

    The nastiest shape: the mapping count is unchanged, so a count-only check
    would pass while the mechanic quietly moved under a different stat.
    """
    frozen = vocabulary._load(vocabulary.AFFIX_SYNONYMS_REGISTRY_PATH)
    live = [dict(e, synonyms=list(e["synonyms"])) for e in frozen["affix_synonyms"]]
    moved = live[0]["synonyms"].pop()
    live[1]["synonyms"].append(moved)
    try:
        vocabulary.check_affix_synonyms(live, frozen)
    except vocabulary.IntegrityError as exc:
        assert moved in str(exc), f"message must name the re-pointed synonym, got: {exc}"
    else:
        raise AssertionError("a re-pointed synonym must raise IntegrityError")
