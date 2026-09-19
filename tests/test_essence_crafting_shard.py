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
PLACEMENTS_MODULE = os.path.join("src", "essence_placements.py")
COMBINED_MODULE = os.path.join("src", "essence_combined.py")
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
    37 it cannot. A caller is allowed only if it ALSO checks the bonus type and the
    catalog stat before letting a magnitude out; one that does not could take a
    number with neither.

    #795 admitted a second caller, `essence_placements`, which serves the
    player-authored item builder. Admission is not a free pass: the allowlist buys
    nothing on its own, so `test_every_sourced_placement_passed_both_checks` below
    asserts the property the allowlist is standing in for, over the real built
    output. Widening this list without that assertion would be weakening the guard
    to make new code pass, which is the one thing it exists to prevent."""
    importers = []
    for path in _tree_files():
        rel = os.path.relpath(path, ROOT)
        if rel.startswith(TEST_DIR) or rel in (JOIN_MODULE, POOL_MODULE,
                                              PLACEMENTS_MODULE, COMBINED_MODULE):
            continue
        with open(path, encoding="utf-8", errors="ignore") as fh:
            if "essence_curve_join" in fh.read():
                importers.append(rel)
    assert not importers, (
        "something other than the pool builder reaches the curve join: "
        + ", ".join(importers) + ". A magnitude taken there has not been checked for "
        "a sourced bonus type or a catalog stat name.")


def test_only_the_two_empty_essence_menus_remain_unserved():
    """The player-facing half.

    #193 wired the Gem's three Trinket menus; #764 wired the other three families,
    whose placements had been in the seed since 2026-08-27 while only the pipeline
    was Trinket-only. This asserted that NINE labels stayed disclosed, which was
    right then and is wrong now — seven of them are served.

    The two that remain are disclosed for a DIFFERENT reason, and the distinction
    is the whole point of this guard: a pool exists for both, and every effect in
    them is untyped, so the pool's offering for those two menus is empty. That is a
    source gap, not a pipeline gap, and it closes when the wiki states a type — not
    when someone writes code.
    """
    from src import crafting_coverage
    ec = sorted(x for x in crafting_coverage.UNSERVED_ALLOWLIST if x.startswith("Essence Crafting:"))
    assert ec == ["Essence Crafting: Melee - Extra",
                  "Essence Crafting: Rune Arm - Suffix"], ec
    for part in ("Extra", "Prefix", "Suffix"):
        assert f"Essence Crafting: Trinket - {part}" not in ec, (
            f"Trinket {part} is served by the essence_crafting pool now; leaving it "
            "allowlisted makes the gate vouch for a gap that closed (#193).")


def test_every_sourced_placement_passed_both_checks():
    """#795 — the property behind `essence_placements`' place on the curve-join
    allowlist, asserted over the real built table rather than assumed.

    A `sourced` row carries a magnitude read from the curve join. It may only do so
    if BOTH of the pool builder's checks were applied first: the bonus type is
    `stated` in the harvest, and the stat is one the catalog actually uses. A row
    that skipped either would be a number with no bucket, offered to a player as
    though the wiki published it.

    Refuses to pass over zero sourced rows.
    """
    import json as _json
    from src import essence_placements as _ep
    from src import essence_pool as _pool

    bonus_types = _pool._load(_pool.BONUS_TYPE_SHARD)["harvested"]
    with open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8") as fh:
        built = _json.load(fh)
    table = built.get("essence_placements") or {}
    # The written dataset does not carry the in-memory `stat` field the build uses
    # for `catalog_stats` — only `name`. So the check here is against the affix
    # NAMES the catalog actually ships, which is an independent population rather
    # than the builder's own flag, and is what makes this more than a restatement
    # of `rankable`.
    stats = {a.get("name") for v in built.get("items", [])
             for a in (v.get("affixes") or []) if a.get("name")}

    seen, offenders = 0, []
    for group, menus in (table.get("groups") or {}).items():
        for menu, rows in menus.items():
            for row in rows:
                if not row.get("sourced"):
                    continue
                seen += 1
                bt = bonus_types.get(row["effect"])
                where = f"{group}/{menu}/{row['effect']}"
                if not bt or bt.get("provenance") != "stated":
                    offenders.append((where, "bonus type not stated"))
                elif bt["value"]["bonus_type"] != row.get("bonus_type"):
                    offenders.append((where, "bonus type disagrees with the harvest"))
                if row.get("stat") not in stats:
                    offenders.append((where, "stat is not one the catalog uses"))
                if not row.get("rankable"):
                    offenders.append((where, "sourced but not rankable"))
                if len(row.get("values_by_ml") or []) != 36:
                    offenders.append((where, "curve is not 36 rows"))
    assert seen, ("no sourced placement at all — this guard would pass vacuously, and "
                  "the curve-join allowlist would be unearned")
    assert not offenders, (
        f"{len(offenders)} sourced placement(s) took a magnitude without both checks: "
        f"{offenders[:5]}")


def test_every_combined_magnitude_passed_the_checks_that_licence_it():
    """#812 — `essence_combined` now DOES take magnitudes from the curve join, and
    this is the assertion that licences its place on the allowlist.

    The previous version of this test asserted the opposite — that the module took
    no number at all — and it was right until the wiki said otherwise:

        "Scaling effects increase their values when placed in increasingly higher
         minimum level (ML) shard items. Combined Shards also use this scaling for
         their individual effects."
            - `Essence Crafting enchantments`, Bonus by level, Notes

    Updated deliberately rather than deleted, because the allowlist buys nothing
    on its own. What it stands for is that a caller reading a curve has applied
    the checks that make a magnitude safe. Those are:

    - the stat is one the catalog uses (else a private bucket that stacks with
      everything real);
    - the curve is a full 36 rows;
    - the name was resolved by the EXISTING join, never a widened one.

    The bonus type is NOT required, for the reason #810 established: the builder
    asks the player for it and discloses the answer as theirs. Requiring it would
    withhold a magnitude the wiki publishes over an unrelated missing fact.
    """
    import json as _json
    from src import essence_curve_join as _join

    with open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8") as fh:
        built = _json.load(fh)
    combined = (built.get("essence_placements") or {}).get("combined") or {}
    recipes = combined.get("recipes") or []
    assert recipes, "no combined recipe — this guard would pass vacuously"

    stats = {a.get("name") for v in built.get("items", [])
             for a in (v.get("affixes") or []) if a.get("name")}
    mapping = _join.resolve_all()["mapping"]

    seen, offenders = 0, []
    for r in recipes:
        for e in r.get("effects") or []:
            where = f"{r.get('name')}/{e.get('effect')}"
            if not e.get("magnitude_sourced"):
                # Must carry no number either, or the flag is decoration.
                if e.get("values_by_ml") or e.get("curve_row"):
                    offenders.append((where, "unsourced but carries a curve"))
                continue
            seen += 1
            if e.get("stat") not in stats:
                offenders.append((where, "stat is not one the catalog uses"))
            if len(e.get("values_by_ml") or []) != 36:
                offenders.append((where, "curve is not 36 rows"))
            entry = mapping.get(e["effect"])
            if not entry or entry["row"] != e.get("curve_row"):
                offenders.append((where, "row does not match the existing join"))
    assert seen, ("no combined effect carries a magnitude — the allowlist entry "
                  "would be unearned and the wiki's scaling note unapplied")
    assert not offenders, (
        f"{len(offenders)} combined magnitude(s) without the checks that licence "
        f"them: {offenders[:5]}")

    # The join is REUSED, never widened: the recipe table names effects `table 1b`
    # does not carry, and those must keep asking the player.
    unsourced = [e["effect"] for r in recipes for e in r["effects"]
                 if not e.get("magnitude_sourced")]
    assert unsourced, ("every combined effect resolved, which would mean the join "
                       "was widened to reach the recipe table's own vocabulary")


def test_the_slot_join_is_checked_from_both_sides():
    """#806 — `SLOT_GROUPS` relates the APP's slot vocabulary to the WIKI's group
    names. That is not a wiki fact and never can be: the wiki does not know
    gear-planner's slot names. So it is not sourced; it is CHECKED, from two
    directions the wiki cannot reach.

    Run here as well as in the build so a refactor that drops the build-time call
    still fails, rather than leaving the join unverified while everything is green.
    """
    import json as _json
    from src import essence_placements as _ep
    from src.essence_combined import GROUP_OF_SLOT

    with open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8") as fh:
        built = _json.load(fh)
    items = built.get("items") or []
    assert items, "no catalog — this test would pass vacuously"

    # Side one: the anatomical gear-planner type each slot holds.
    assert _ep.assert_slot_groups_match_the_catalog(items) == 12

    # Side two: a second join, written independently against a different wiki
    # table, reaching the same groups but one.
    groups = {g for gs in GROUP_OF_SLOT.values() for g in gs}
    assert _ep.assert_the_two_slot_joins_agree(groups) == 16

    # The one difference, stated rather than tolerated: no combined-prefix recipe
    # lists a rune arm slot.
    ours = {g for gs in _ep.SLOT_GROUPS.values() for g in gs}
    assert sorted(ours - groups) == ["Rune Arms"]


def test_quiver_is_the_only_slot_with_no_group_and_it_holds_real_items():
    """#806 — `Quiver` maps to nothing because `table 1b` has no quiver group, and
    that emptiness is a statement rather than an omission.

    Worth asserting that quivers EXIST in the catalog, or the empty mapping would
    be indistinguishable from a slot nobody has any gear for — and the refusal the
    bench shows a quiver owner would be describing a slot that does not matter.
    """
    import json as _json
    from src import essence_placements as _ep

    with open(os.path.join(ROOT, "web", "data", "items.json"), encoding="utf-8") as fh:
        built = _json.load(fh)
    empties = sorted(s for s, g in _ep.SLOT_GROUPS.items() if not g)
    assert empties == ["Quiver"], f"expected only Quiver to map to nothing; got {empties}"
    quivers = [v for v in built.get("items", []) if v.get("slot") == "Quiver"]
    assert quivers, ("no quiver in the catalog, so the empty mapping proves nothing — "
                     "the refusal would be about a slot the player cannot fill anyway")


def test_the_candidate_rows_are_documentation_and_never_resolve_anything():
    """#812 — `CANDIDATE_ROWS` names the row a future harvester would confirm for
    each unmapped effect. It must never be consumed.

    The whole point of the quarantine is that these joins are NOT established. A
    candidate that leaked into the mapping would be exactly the head-noun guess
    this module refuses — `Spell Resistance` ends in `Resistance` and has its own
    `Spell Resistance (SR)` row.

    So: every name listed is still quarantined, and none of them appears in the
    mapping.
    """
    from src import essence_curve_join as _join
    r = _join.resolve_all()
    assert _join.CANDIDATE_ROWS, "the candidate list is not empty"
    for name in _join.CANDIDATE_ROWS:
        assert name in r["quarantine"], (
            f"{name!r} has a candidate row AND is resolved — either the join was "
            "widened on a guess, or the candidate should have been removed when "
            "the real evidence landed")
        assert name not in r["mapping"], f"{name!r} leaked into the mapping"

