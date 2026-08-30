"""#193 — the Essence Crafting harvest, and the guard that keeps it honest.

The shard is DATA ONLY: nothing consumes it, because no source records a crafted
effect's bonus type (see `docs/wiki-evidence/essence-crafting.md`). These tests
pin the harvest's shape so it does not rot, and — more importantly — pin the
claims the evidence document makes, so a future reader cannot quietly start
using the shard without noticing the type dimension is still missing.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "essence_crafting.json")
EVIDENCE_PATH = os.path.join(ROOT, "docs", "wiki-evidence", "essence-crafting.md")
COVERAGE_PATH = os.path.join(ROOT, "src", "crafting_coverage.py")

AFFIX_SLOTS = ("Prefix", "Suffix", "Extra")


def _shard():
    with open(SHARD_PATH) as fh:
        return json.load(fh)


def test_every_effect_curve_covers_minimum_level_one_through_thirtysix():
    shard = _shard()
    effects = shard["values_by_ml"]["effects"]
    assert shard["values_by_ml"]["ml_range"] == [1, 36]
    assert len(effects) == 75, f"75 effect rows were harvested, saw {len(effects)}"
    for name, vals in effects.items():
        assert len(vals) == 36, f"{name} has {len(vals)} values, not one per ML"
        assert all(str(v).strip() for v in vals), f"{name} has an empty cell"


def test_the_placement_table_covers_sixteen_slots_and_three_affix_slots():
    placements = _shard()["placements"]
    assert len(placements) == 16, f"16 equipment slots, saw {len(placements)}"
    for slot, by_affix in placements.items():
        assert set(by_affix) == set(AFFIX_SLOTS), (slot, sorted(by_affix))
        for affix, effects in by_affix.items():
            assert effects, f"{slot}/{affix} is empty — the cell failed to parse"
            assert len(effects) == len(set(effects)), f"{slot}/{affix} has duplicates"


def test_the_reported_placement_total_is_what_the_shard_holds():
    """The evidence document cites 708 placements. A count is a claim about a
    population, so it is asserted against the population rather than trusted."""
    placements = _shard()["placements"]
    total = sum(len(v) for by_affix in placements.values() for v in by_affix.values())
    assert total == 708, total
    with open(EVIDENCE_PATH) as fh:
        assert "708" in fh.read(), "the evidence doc's count must match the shard"


def test_the_rune_arm_slot_is_present_because_it_is_the_reported_case():
    """The player asked about crafting an off-hand so it stops being dead weight.
    Rune Arms are that slot, and 39 of the 45 `[Crafted]` catalog records are
    rune arms."""
    ra = _shard()["placements"]["Rune Arms"]
    for affix in AFFIX_SLOTS:
        assert ra[affix], f"Rune Arms/{affix} is empty"
    assert "Spell Power" in ra["Suffix"]


def test_non_scalar_effects_are_flagged_rather_than_silently_ranked():
    """Five effects have dice values, not numbers. The solver ranks scalars, so
    these must be visibly separated rather than parsed into a wrong number."""
    shard = _shard()
    flagged = set(shard["non_scalar_effects"])
    assert flagged == {"Bashing", "Bane", "Effect (dmg)", "Shield spikes", "Vampirism"}, flagged
    effects = shard["values_by_ml"]["effects"]
    for name in flagged:
        assert any("d" in str(v) for v in effects[name]), f"{name} is flagged but has no dice"
    for name, vals in effects.items():
        if name in flagged:
            continue
        assert not any("d" in str(v) for v in vals), \
            f"{name} carries dice values but is not flagged non-scalar"


def test_parse_artifacts_are_recorded_rather_than_silently_dropped():
    """Two cells produced entries that are not effects. Dropping them quietly
    would leave the next reader unable to tell a parse decision from wiki data."""
    q = _shard()["parse_quarantine"]
    assert "Orbs/Prefix/Abilities" in q
    assert "Orbs/Extra/Category:Essence Crafting" in q
    for reason in q.values():
        assert len(reason) > 40, "a quarantine entry must say WHY, not just name the cell"


# --- the blocker, pinned so it cannot be forgotten ----------------------------

def test_the_shard_declares_that_it_is_not_wired():
    """#193's remaining work is a TYPE problem, not a volume problem. If someone
    starts consuming this shard, they must first delete this assertion — which is
    the point of it."""
    meta = _shard()["_meta"]
    assert "NOT WIRED" in meta["status"]
    assert "bonus type" in meta["blocker"].lower()
    assert "gear-planner" in meta["blocker"]


# The one file allowed to open the shard, and why. It reads `placements` ONLY to
# learn WHICH effect names exist, so the bonus-type harvest has a work order and a
# denominator. It never reads a magnitude and never emits anything into the
# dataset. Anything else touching this file is the failure this guard exists for.
ROSTER_READER = "scripts/merge_harvest.py"
# Tests may name the shard freely: asserting ON the data is the opposite of
# feeding it to the solver, and a test cannot ship a value into a loadout. The
# allowance is by directory so a new guard file does not have to edit this list.
TEST_DIR = "tests" + os.sep
# The value halves. Reading one of these IS consuming the shard, even from the
# allowlisted file — the allowance is for the roster, not for the numbers.
VALUE_KEYS = ("values_by_ml", "non_scalar_effects")


def test_nothing_in_the_tree_consumes_the_shard_yet():
    """The honest state: harvested, disclosed, unused by the solver. A build that
    started reading it without sourcing bonus types would be shipping inferred
    game values.

    #193 reopened this: `merge_harvest.py` now reads `placements` for the effect
    ROSTER driving the bonus-type harvest (`essence_bonus_type.json`). That is a
    work order, not a solver input, so it is allowlisted by name — and the
    allowance is checked to be exactly that, by asserting the file never touches
    the magnitude halves.
    """
    hits = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        if any(p in dirpath for p in (".git", "node_modules", "__pycache__", "web/data")):
            continue
        for fn in filenames:
            if not fn.endswith((".py", ".js")):
                continue
            path = os.path.join(dirpath, fn)
            if os.path.abspath(path) == os.path.abspath(__file__):
                continue
            with open(path, encoding="utf-8", errors="ignore") as fh:
                if "essence_crafting.json" in fh.read():
                    rel = os.path.relpath(path, ROOT)
                    if not rel.startswith(TEST_DIR):
                        hits.append(rel)
    assert hits == [ROSTER_READER], (
        "something now reads the Essence Crafting shard: " + ", ".join(hits)
        + f". Only {ROSTER_READER} may, and only for the effect roster. Before wiring "
        "the values, source the bonus types — see docs/wiki-evidence/essence-crafting.md.")


def test_the_allowlisted_reader_takes_the_roster_and_not_the_magnitudes():
    """Proves the allowance above is as narrow as it claims. If the roster reader
    ever reaches for a magnitude, the allowlist is silently covering a solver
    input and this fails rather than waving it through."""
    with open(os.path.join(ROOT, ROSTER_READER), encoding="utf-8") as fh:
        src = fh.read()
    assert "placements" in src, f"{ROSTER_READER} no longer reads the roster it is allowlisted for"
    for key in VALUE_KEYS:
        assert f'"{key}"' not in src and f"'{key}'" not in src, (
            f"{ROSTER_READER} now reads {key!r}. That is a magnitude, not a roster: "
            "the allowlist covers the effect NAMES only.")


def test_the_twelve_labels_are_still_declared_unserved():
    """The player-facing half of the honest position: the slots show in the
    compendium and every export as declared-but-inert, rather than being modelled
    wrongly. If this list changes, the disclosure changed with it."""
    from src import crafting_coverage
    ec = sorted(x for x in crafting_coverage.UNSERVED_ALLOWLIST if x.startswith("Essence Crafting:"))
    assert len(ec) == 12, ec
    for item in ("Melee", "Ring", "Rune Arm", "Trinket"):
        for part in ("Extra", "Prefix", "Suffix"):
            assert f"Essence Crafting: {item} - {part}" in ec
