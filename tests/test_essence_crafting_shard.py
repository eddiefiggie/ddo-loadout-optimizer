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

def test_the_shard_declares_what_is_wired_and_what_is_not():
    """The status line is a claim to the next reader, so it is asserted.

    It must name BOTH halves: the Trinket menus that are live and the thirteen
    other equipment slots that are still data-only. A status naming only the first
    would read as "Essence Crafting is done", when 135 of 157 effects still have
    no sourced bonus type."""
    meta = _shard()["_meta"]
    assert "WIRED FOR TRINKETS" in meta["status"]
    assert "data-only" in meta["status"], "the status must name what is still NOT wired"
    blocker = meta["blocker"]
    assert "bonus type" in blocker.lower()
    assert "gear-planner" in blocker
    assert "WHAT IS NOT" in blocker, "the blocker must still name the unserved slots"
    assert "135" in blocker, "the blocker must keep the size of the remaining gap"


# The files allowed to open the shard, and why. Neither is a solver input.
#
#   merge_harvest.py       reads `placements` ONLY, for the effect ROSTER that
#                          drives the bonus-type harvest. Never a magnitude.
#   essence_curve_join.py  reads `values_by_ml` deliberately — resolving the
#                          effect-name -> curve-row join (#599) IS its job. It is
#                          allowed the magnitudes and denied a route into the
#                          build, which the next test enforces.
ROSTER_READER = "scripts/merge_harvest.py"
JOIN_MODULE = os.path.join("src", "essence_curve_join.py")
POOL_MODULE = os.path.join("src", "essence_pool.py")
SHARD_READERS = sorted([ROSTER_READER, JOIN_MODULE, POOL_MODULE])
# Tests may name the shard freely: asserting ON the data is the opposite of
# feeding it to the solver, and a test cannot ship a value into a loadout. The
# allowance is by directory so a new guard file does not have to edit this list.
TEST_DIR = "tests" + os.sep
# The value halves. Reading one of these IS consuming the shard — allowed only in
# the join module, which exists to read them.
VALUE_KEYS = ("values_by_ml", "non_scalar_effects")
# Everything the built dataset is made of. Nothing here may reach the join.
BUILD_SURFACE = ("build_dataset.py", "src" + os.sep, "web" + os.sep)


def _tree_files(exts=(".py", ".js")):
    for dirpath, dirnames, filenames in os.walk(ROOT):
        if any(p in dirpath for p in (".git", "node_modules", "__pycache__", "web/data")):
            continue
        for fn in filenames:
            if fn.endswith(exts):
                yield os.path.join(dirpath, fn)


def test_only_the_named_files_read_the_shard():
    """The shard IS consumed now (#193 wired the Gem's Trinket menus), so this
    stopped being "nothing reads it" and became "exactly these read it".

    The list is the point. Each of the three has a different, bounded job, and a
    fourth reader appearing means the values reached somewhere nobody audited.
    """
    hits = []
    for path in _tree_files():
        if os.path.abspath(path) == os.path.abspath(__file__):
            continue
        rel = os.path.relpath(path, ROOT)
        if rel.startswith(TEST_DIR):
            continue
        with open(path, encoding="utf-8", errors="ignore") as fh:
            if "essence_crafting.json" in fh.read():
                hits.append(rel)
    assert sorted(hits) == SHARD_READERS, (
        "the set of files reading the Essence Crafting shard changed: "
        + ", ".join(sorted(hits)) + f". Expected exactly {SHARD_READERS}. A new reader "
        "means Essence Crafting values reached a surface nobody audited.")


def test_the_browser_never_sees_the_raw_shard_or_the_join():
    """The boundary that replaced "nothing is wired".

    `web/` gets the RESOLVED pool out of `items.json` — options whose placement,
    bonus type and ML curve were all sourced at build time. It must never reach
    the raw shard or the curve join itself, because those carry the 135 effects
    with no sourced bonus type and the 37 with no curve row. The whole point of
    resolving in the pipeline is that the browser cannot see the unresolved ones.
    """
    leaked = []
    for path in _tree_files():
        rel = os.path.relpath(path, ROOT)
        if not rel.startswith("web" + os.sep):
            continue
        with open(path, encoding="utf-8", errors="ignore") as fh:
            body = fh.read()
        if "essence_crafting.json" in body or "essence_curve_join" in body:
            leaked.append(rel)
    assert not leaked, (
        "the browser now reaches Essence Crafting's raw data: " + ", ".join(leaked)
        + ". It must consume only the resolved pool the build emits.")


def test_the_curve_join_is_reached_only_through_the_pool_builder():
    """`essence_curve_join` resolves effect names to ML curve rows and quarantines
    37 it cannot. `essence_pool` is the one module allowed to call it, because it
    is the one that also checks the bonus type and the catalog stat before letting
    an option out. A second caller could take a magnitude without those checks."""
    importers = []
    for path in _tree_files():
        rel = os.path.relpath(path, ROOT)
        if rel.startswith(TEST_DIR) or rel in (JOIN_MODULE, POOL_MODULE):
            continue
        with open(path, encoding="utf-8", errors="ignore") as fh:
            if "essence_curve_join" in fh.read():
                importers.append(rel)
    assert not importers, (
        "something other than the pool builder reaches the curve join: "
        + ", ".join(importers) + ". A magnitude taken there has not been checked for "
        "a sourced bonus type or a catalog stat name.")


def test_nine_essence_labels_remain_unserved_and_the_trinket_three_do_not():
    """The player-facing half, now that #193 wired the Gem's menus.

    Three of the original twelve are SERVED by the `essence_crafting` pool. The
    other nine — Melee, Ring, Rune Arm — have no pool at all and are still
    declared-but-inert, which is what the compendium and every export must keep
    saying about them. The split is the disclosure: a reader must be able to tell
    the wired third from the nine that are not.
    """
    from src import crafting_coverage
    ec = sorted(x for x in crafting_coverage.UNSERVED_ALLOWLIST if x.startswith("Essence Crafting:"))
    assert len(ec) == 9, ec
    for item in ("Melee", "Ring", "Rune Arm"):
        for part in ("Extra", "Prefix", "Suffix"):
            assert f"Essence Crafting: {item} - {part}" in ec, f"{item} {part} stopped being disclosed"
    for part in ("Extra", "Prefix", "Suffix"):
        assert f"Essence Crafting: Trinket - {part}" not in ec, (
            f"Trinket {part} is served by the essence_crafting pool now; leaving it "
            "allowlisted makes the gate vouch for a gap that closed (#193).")
