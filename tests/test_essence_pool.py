"""#193 / #843 — the Essence Crafting option pool the SOLVER sees, and what it
refuses to offer.

An option reaches the solver only when its placement, bonus type and ML curve
are all sourced and its stat is one the catalog ranks. #843 moved the SOURCE
under that gate from three wiki shards to the yourddo catalog the bench already
reads (`essence_placements["groups"]`), and these tests pin the consequences:

  the pool is a re-derivation of the shipped catalog, not a second harvest;
  the count is the predicate, re-counted independently, not a number;
  nothing the wiki pool offered was lost;
  a stat the catalog ranks on/off is offered on/off, never as a number;
  a compound shard is ONE atomic option granting every part (#844);
  the Extra slot's ML-10 gate is applied in its own right.

Every record is ATOMIC (#844): `affixes` carries what the shard grants, one entry
per enchantment with its own type, unit and curve. `_affixes()` below is the one
way these tests read a record's grants, so no test can quietly assume a
record-level stat again.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import essence_pool

DATASET = os.path.join(ROOT, "web", "data", "items.json")

# What the wiki-shard pool offered on its last day (2026-09-20, build 09202026.12):
# 38 rows over 12 stats. `Insightful X` rows are spelled by their STAT here, the
# way the pool always keyed them. The switch may add; it may not lose one of these.
WIKI_POOL_ROWS = [
    ("Melee", "Prefix", "Seeker"), ("Melee", "Suffix", "Doublestrike"),
    ("Ring", "Extra", "Charisma"), ("Ring", "Extra", "Constitution"), ("Ring", "Extra", "Dexterity"),
    ("Ring", "Prefix", "Charisma"), ("Ring", "Prefix", "Constitution"), ("Ring", "Prefix", "Spell Resistance"),
    ("Ring", "Suffix", "Dexterity"),
    ("Rune Arm", "Extra", "Haggle"), ("Rune Arm", "Prefix", "Haggle"),
    ("Trinket", "Extra", "Accuracy"), ("Trinket", "Extra", "Charisma"), ("Trinket", "Extra", "Constitution"),
    ("Trinket", "Extra", "Dexterity"), ("Trinket", "Extra", "Haggle"), ("Trinket", "Extra", "Intelligence"),
    ("Trinket", "Extra", "Spell Resistance"), ("Trinket", "Extra", "Strength"), ("Trinket", "Extra", "Wisdom"),
    ("Trinket", "Prefix", "Charisma"), ("Trinket", "Prefix", "Constitution"), ("Trinket", "Prefix", "Dexterity"),
    ("Trinket", "Prefix", "Dodge"), ("Trinket", "Prefix", "Doublestrike"), ("Trinket", "Prefix", "Haggle"),
    ("Trinket", "Prefix", "Intelligence"), ("Trinket", "Prefix", "Seeker"), ("Trinket", "Prefix", "Spell Resistance"),
    ("Trinket", "Prefix", "Strength"), ("Trinket", "Prefix", "Wisdom"),
    ("Trinket", "Suffix", "Charisma"), ("Trinket", "Suffix", "Constitution"), ("Trinket", "Suffix", "Dexterity"),
    ("Trinket", "Suffix", "Dodge"), ("Trinket", "Suffix", "Intelligence"), ("Trinket", "Suffix", "Strength"),
    ("Trinket", "Suffix", "Wisdom"),
]

_DS = None


def _affixes(rec):
    return rec["affixes"]


def _stats(rec):
    return [a["stat"] for a in rec["affixes"]]


def _dataset():
    global _DS
    if _DS is None:
        with open(DATASET) as fh:
            _DS = json.load(fh)
    return _DS


def _catalog():
    """`(stats, presence, types)` off the shipped items — the vocabulary the pool
    gates against, read the way `build_dataset.py` reads it but from the OUTPUT
    (`name`/`type`) rather than the pipeline's `stat`/`bonus_type`."""
    stats, types, by_stat = set(), set(), {}
    for it in _dataset()["items"]:
        for a in it.get("affixes") or []:
            n = a.get("name")
            if not n:
                continue
            stats.add(n)
            t = (a.get("type") or "").strip() or None
            by_stat.setdefault(n, set()).add(t)
            if t and t not in ("Bool", "boolean"):
                types.add(t)
    presence = {s for s, ts in by_stat.items() if ts <= {"Bool", "boolean"}}
    return stats, presence, types


def _groups():
    return _dataset()["essence_placements"]["groups"]


def _pool():
    stats, presence, _ = _catalog()
    return essence_pool.build_essence_pool(_groups(), catalog_stats=stats, catalog_presence=presence)


def _expected(groups, stats, presence):
    """The pool's predicate, written a second time from the catalog rows, so the
    count is a re-derivation and not the builder agreeing with itself.

    Returns `(singles, flags, compound)` as (family, menu, effect) lists. A part
    passes when its stat is in the catalog and either on/off there or fully
    sourced with a scalar curve; a compound passes when EVERY part does."""
    def part_ok(p):
        st = p.get("stat")
        if not st or p.get("quarantined") or st not in stats:
            return False
        if st in presence:
            return True
        return bool(p.get("sourced")) and p.get("unit") != "dice"
    singles, flags, compound = [], [], []
    for family, group in essence_pool.HOST_FAMILIES.items():
        for menu in essence_pool.MENUS:
            for r in groups[group][menu]:
                key = (family, menu, r["effect"])
                if r.get("flag"):
                    if r["stat"] in stats and r["stat"] in presence:
                        flags.append(key)
                elif r.get("parts"):
                    if all(part_ok(p) for p in r["parts"]):
                        compound.append(key)
                elif part_ok(r):
                    (flags if r["stat"] in presence else singles).append(key)
    return singles, flags, compound


# --- the source ------------------------------------------------------------------

def test_the_shipped_pool_is_a_rederivation_of_the_shipped_catalog():
    """#843's whole claim: the solver and the bench read ONE catalog. Rebuilding
    the pool from the catalog the dataset carries must reproduce the pool the
    dataset carries, row for row."""
    ds = _dataset()
    key = lambda r: (r["family"], r["menu"], r["effect"], r["min_ml"], r["presence"], r["compound"],
                     tuple((a["stat"], a["bonus_type"], a["presence"], tuple(a["values_by_ml"]))
                           for a in r["affixes"]))
    shipped = sorted(key(r) for r in ds["essence_crafting"])
    rebuilt = sorted(key(r) for r in _pool()["records"])
    assert shipped == rebuilt
    cov = ds["metadata"]["essence_crafting_coverage"]
    assert cov["source"] == ds["essence_placements"]["source"] == "veteran-software/yourddo"
    assert cov["source_commit"] == ds["essence_placements"]["source_commit"]


def test_the_count_is_the_predicate_recounted_not_a_number():
    stats, presence, _ = _catalog()
    singles, flags, compound = _expected(_groups(), stats, presence)
    pool = _pool()
    recs = pool["records"]
    assert len(recs) == len(singles) + len(flags) + len(compound)
    assert sum(1 for r in recs if r["compound"]) == len(compound)
    # And the numbers, so a drift is a finding to attribute rather than a
    # silent re-count. 38 rows before #843; 356 after (66 presence); #844 serves
    # the compound shards whole: 435, of which 79 compound. `presence` counts
    # records whose EVERY affix is on/off — a compound of flags (the Melee
    # `Aligned`-style shards) is one, a Sheltering is not.
    cov = pool["coverage"]
    assert cov["offered_all"] == 435, cov["offered_all"]
    assert cov["compound"] == 79, cov["compound"]
    assert cov["presence"] == 90, cov["presence"]
    assert cov["total_all"] == 639, cov["total_all"]
    assert {k: v["offered_all"] for k, v in cov["by_family"].items()} == {
        "Trinket": 187, "Rune Arm": 70, "Ring": 82, "Melee": 96}, cov["by_family"]
    assert {k: v["compound"] for k, v in cov["by_family"].items()} == {
        "Trinket": 20, "Rune Arm": 0, "Ring": 34, "Melee": 25}, cov["by_family"]
    assert len(recs) > 300, "the pool is too small for the rest of this file to be measuring anything"


def test_nothing_the_wiki_pool_offered_was_lost():
    have = {(r["family"], r["menu"], a["stat"]) for r in _pool()["records"]
            for a in _affixes(r) if not a["presence"] and not r["compound"]}
    lost = [row for row in WIKI_POOL_ROWS if row not in have]
    assert not lost, f"the switch to yourddo dropped rows the wiki pool offered: {lost}"
    assert len(WIKI_POOL_ROWS) == 38


# --- the gate -----------------------------------------------------------------------

def test_every_numeric_option_buckets_into_a_type_some_native_affix_uses():
    """A type nothing native carries is a bucket of its own, so the crafted effect
    stacks with everything. `Natural Armor` (yourddo's spelling of `Natural`) was
    exactly that before the catalog joined it (#837 audit)."""
    _, _, types = _catalog()
    for rec in _pool()["records"]:
        for a in _affixes(rec):
            if a["presence"]:
                continue
            assert a["bonus_type"] in types, f"{rec['effect']}: {a['bonus_type']!r} has no native bucket"


def test_every_option_names_a_stat_the_catalog_already_uses():
    stats, _, _ = _catalog()
    for rec in _pool()["records"]:
        for st in _stats(rec):
            assert st in stats, f"{rec['effect']} -> {st!r}, unknown to the catalog"


def test_an_unknown_stat_is_dropped_rather_than_offered():
    """Prove the catalog gate bites. With an empty catalog nothing may pass, and
    the builder must refuse rather than emit an unbucketable pool."""
    try:
        essence_pool.build_essence_pool(_groups(), catalog_stats=set(), catalog_presence=set())
    except essence_pool.PoolError:
        return
    raise AssertionError("an empty catalog produced options instead of refusing")


def test_natural_armor_is_absent_because_the_join_quarantines_it():
    """The one effect the old pool excluded BY NAME. The exclusion list is gone;
    the stat join (`essence_stat_join.json`) quarantines the name instead, and
    that is the only reason it is out — one owner, not two."""
    pool = _pool()
    assert not hasattr(essence_pool, "EXCLUDED_EFFECTS")
    assert "Natural Armor" in pool["coverage"]["skipped"]["stat-unmatched"]
    assert not [r for r in pool["records"] if "Natural Armor" in _stats(r)]


def test_insightful_effects_contribute_to_the_base_stat_not_a_stat_of_their_own():
    """`Insightful Constitution` is Constitution in the Insight bucket. Treating
    the name as a stat would give it a private bucket that stacks with every
    Constitution item in the game. The join does this now, not this module."""
    seen = 0
    for rec in _pool()["records"]:
        if rec["effect"].startswith("Insightful ") and not rec["compound"]:
            seen += 1
            a = _affixes(rec)[0]
            assert not a["stat"].startswith("Insightful "), rec["effect"]
            assert a["bonus_type"] == "Insight", rec
    assert seen > 20, seen


# --- presence -----------------------------------------------------------------------

def test_a_stat_the_catalog_ranks_on_off_is_offered_on_off_never_as_a_number():
    """`Holy`, `Anarchic`, every `X Bane`: real items print them with no number and
    the solver buckets them `Bool`. yourddo carries a curve for some of them; the
    bench ranks the effect present or absent (#838) and so does this pool. A
    numeric 6 in that bucket would rank presence six times over."""
    _, presence, _ = _catalog()
    pool = _pool()
    flagged = [(r, a) for r in pool["records"] for a in _affixes(r) if a["presence"]]
    assert flagged, "no presence affixes at all"
    for r, a in flagged:
        assert a["bonus_type"] == "Bool" and a["unit"] == "flat", r["effect"]
        assert a["values_by_ml"] == ["1"] * 36, r["effect"]
        assert a["stat"] in presence, f"{r['effect']} is presence-minted on a valued stat"
        assert a["magnitude_source"] is None
    for r in pool["records"]:
        for a in _affixes(r):
            if not a["presence"]:
                assert a["stat"] not in presence, f"{r['effect']} is a number on an on/off stat"
        assert r["presence"] == all(a["presence"] for a in _affixes(r)), r["effect"]
    stats = {a["stat"] for _, a in flagged}
    for name in ("Holy", "Anarchic", "Eternal Faith", "Undead Bane", "Blindness Immunity"):
        assert name in stats, name


def test_a_flag_on_a_valued_stat_is_withheld_not_guessed():
    """yourddo says `Efficient Metamagic - Empower` grants nothing numeric; the
    catalog types it Enhancement on every native carrier. A `Bool` 1 beside those
    would be a presence and a number in two buckets that ADD. Never infer."""
    pool = _pool()
    skipped = pool["coverage"]["skipped"]["flag-in-a-magnitude-stat"]
    assert "Efficient Metamagic - Empower" in skipped, skipped
    assert not [r for r in pool["records"] if r["effect"].startswith("Efficient Metamagic")]


# --- compound (#844) -----------------------------------------------------------------

def test_a_compound_shard_is_one_atomic_option_granting_every_part():
    """`Sheltering` grants Physical AND Magical Sheltering from one shard. It is
    ONE record carrying both in `affixes`, never two records the solver could
    take separately; and every record, single or not, is atomic — there is no
    record-level stat for a reader to key on."""
    pool = _pool()
    recs = pool["records"]
    for r in recs:
        assert "stat" not in r and "values_by_ml" not in r and "bonus_type" not in r, r["effect"]
        assert r["affixes"], r["effect"]
        assert r["compound"] == (len(r["affixes"]) > 1), r["effect"]
        for a in r["affixes"]:
            assert len(a["values_by_ml"]) == 36, (r["effect"], a["stat"])
    sh = [r for r in recs if r["effect"] == "Sheltering" and r["family"] == "Trinket"]
    assert sh, "Sheltering is offered on the Trinket"
    for r in sh:
        assert sorted(_stats(r)) == ["Magical Sheltering", "Physical Sheltering"]
        assert all(a["bonus_type"] == "Enhancement" and not a["presence"] for a in r["affixes"])
    assert not hasattr(essence_pool, "COMPOUND_ISSUE"), "the deferral is served, not carried"


def test_a_compound_shard_with_one_failing_part_is_withheld_whole_and_named():
    """One part the join could not match withholds the shard — never a record
    carrying the half that passed. The reason names the part's failure with a
    `compound-` prefix so the disclosure says what class of thing it was."""
    pool = _pool()
    skipped = pool["coverage"]["skipped"]
    assert skipped.get("compound-stat-unmatched"), skipped.keys()
    withheld = {k: v for k, v in skipped.items() if k.startswith("compound-")}
    assert pool["coverage"]["compound_withheld"] == sum(len(v) for v in withheld.values()) == 43
    for reason, effects in withheld.items():
        for e in effects:
            for r in pool["records"]:
                assert not (r["effect"] == e and r["compound"] and len(r["affixes"]) < 2), (reason, e)
    # Prove the whole-shard rule bites: corrupt ONE part of an offered compound.
    stats, presence, _ = _catalog()
    groups = json.loads(json.dumps(_groups()))
    row = next(r for r in groups["Trinkets"]["Prefix"] if r["effect"] == "Sheltering")
    row["parts"][1]["quarantined"] = True
    again = essence_pool.build_essence_pool(groups, catalog_stats=stats, catalog_presence=presence)
    assert "Sheltering" in again["coverage"]["skipped"]["compound-stat-unmatched"]
    assert not [r for r in again["records"] if r["effect"] == "Sheltering" and r["family"] == "Trinket"
                and r["menu"] == "Prefix"]


# --- the two ML-10 rules ------------------------------------------------------------

def test_insight_options_carry_the_wiki_minimum_level():
    """"Effects that grant insight bonuses can be applied to items ML 10 and
    higher only." Applied by the catalog; ASSERTED here, and the assertion is
    proved live by handing the builder a row without the floor."""
    for rec in _pool()["records"]:
        if any(a["bonus_type"] == "Insight" for a in _affixes(rec)):
            assert rec["min_ml"] >= essence_pool.INSIGHT_MIN_ML, (rec["effect"], rec["min_ml"])
    stats, presence, _ = _catalog()
    groups = json.loads(json.dumps(_groups()))
    # On the Extra menu the SLOT gate would raise the floor to 10 first and mask
    # the check, so the corrupted row is placed on Prefix, where only the effect
    # gate applies.
    row = dict(next(r for r in groups["Trinkets"]["Extra"] if r.get("bonus_type") == "Insight"
                    and r.get("sourced") and not r.get("parts") and r["stat"] in stats))
    row["min_ml"] = 1
    groups["Trinkets"]["Prefix"].append(row)
    try:
        essence_pool.build_essence_pool(groups, catalog_stats=stats, catalog_presence=presence)
    except essence_pool.PoolError as e:
        assert "ML-10" in str(e)
        return
    raise AssertionError("an Insight row without the floor was offered")


def test_the_extra_slot_gate_is_applied_in_its_own_right():
    """`EXTRA_SLOT_MIN_ML` gates the SLOT; `INSIGHT_MIN_ML` gates the EFFECT.
    Until #843 they coincided — every Extra option was Insight-typed — and the
    old version of this test predicted that a non-Insight Extra effect would one
    day arrive and the slot gate would have to be applied on its own. `Perform`
    (Competence, recipe floor 1) is that effect."""
    assert essence_pool.INSIGHT_MIN_ML == essence_pool.EXTRA_SLOT_MIN_ML == 10
    pool = _pool()
    extra = [r for r in pool["records"] if r["menu"] == "Extra"]
    assert extra
    for r in extra:
        assert r["min_ml"] >= essence_pool.EXTRA_SLOT_MIN_ML, (r["effect"], r["min_ml"])
    non_insight = [r for r in extra if all(a["bonus_type"] != "Insight" for a in _affixes(r))]
    assert non_insight, "no non-Insight Extra option — the slot gate is untested"
    perform = next(r for r in non_insight if r["effect"] == "Perform")
    catalog_row = next(r for r in _groups()["Trinkets"]["Extra"] if r["effect"] == "Perform")
    assert catalog_row["min_ml"] < 10 and perform["min_ml"] == 10, (catalog_row["min_ml"], perform["min_ml"])
    # And the Prefix/Suffix menus do NOT get the slot gate.
    assert [r for r in pool["records"] if r["menu"] != "Extra" and r["min_ml"] == 1]


def test_every_curve_covers_all_thirty_six_minimum_levels():
    """The solver reads `values_by_ml[ml - 1]`. A short curve would index
    undefined and silently credit nothing, or credit the wrong level."""
    for rec in _pool()["records"]:
        for a in _affixes(rec):
            assert len(a["values_by_ml"]) == 36, f"{rec['effect']}/{a['stat']}: {len(a['values_by_ml'])} values"


# --- hosts ---------------------------------------------------------------------------

def test_only_verified_hosts_get_live_menus():
    """`Trinket [Crafted]` declares the same three menus, is quarantined, and
    carries a placeholder ML 1. Crafting real numbers onto a record we do not
    trust is how an unverified item becomes a recommendation."""
    labels = ["Essence Crafting: Trinket - Prefix"]
    assert essence_pool.essence_slots(labels, "verified") == [
        {"menu": "Prefix", "family": "Trinket"}]
    assert essence_pool.essence_slots(labels, "quarantined") == []
    assert essence_pool.essence_slots(labels, "indexed") == []


def test_the_built_dataset_gives_every_essence_host_its_menus():
    """End of the pipeline: every verified host that declares a menu — 3 Gem tiers
    plus 39 Rune Arm, 1 Ring and 1 Melee blank — with slots naming its OWN family
    and all three menus, so nothing can craft across families."""
    hosts = {it["source_item"]: it for it in _dataset()["items"] if it.get("essence_slots")}
    assert len(hosts) == 44, sorted(hosts)
    # 397c673 — the `[Crafted]` suffix is gone: upstream collapsed each twin onto its
    # base name. The host POPULATION is unchanged (44, same family split), only the
    # names are. See tests/test_crafted_twins.py for the family's retirement.
    for gem in ("Gem of Many Facets", "Epic Gem of Many Facets",
                "Legendary Gem of Many Facets"):
        assert gem in hosts, gem
    by_family = {}
    for name, it in hosts.items():
        fams = {s["family"] for s in it["essence_slots"]}
        assert len(fams) == 1, f"{name} declares menus in more than one family: {fams}"
        fam = fams.pop()
        by_family[fam] = by_family.get(fam, 0) + 1
        assert [s["menu"] for s in it["essence_slots"]] == ["Prefix", "Suffix", "Extra"], name
    assert by_family == {"Trinket": 3, "Rune Arm": 39, "Ring": 1, "Melee": 1}, by_family


def test_the_heroic_gem_can_reach_no_insight_option_and_no_extra_menu():
    """ML 5 against two minimums of 10. Its Extra menu is empty in game, and the
    notice says so rather than letting it read as missing data."""
    ds = _dataset()
    heroic = next(it for it in ds["items"]
                  if it["source_item"] == "Gem of Many Facets" and it.get("essence_slots"))
    assert heroic["ml"] < essence_pool.INSIGHT_MIN_ML
    reachable = [o for o in ds["essence_crafting"] if heroic["ml"] >= o["min_ml"]]
    assert reachable, "the heroic Gem must still reach the non-Insight options"
    assert not [o for o in reachable for a in o["affixes"] if a["bonus_type"] == "Insight"]
    assert not [o for o in reachable if o["menu"] == "Extra"]


# --- the ML premise (2026-08-30) -----------------------------------------------

def test_every_ml_curve_is_monotonic_and_peaks_at_the_top():
    """The whole reason reading the host's `ml` is correct: crafting at the
    highest available level is always optimal, and that is only true while every
    curve rises. The moment one option peaks mid-range, "take the top" stops being
    optimal and the solver has to search the ML instead. This fails then."""
    records = _pool()["records"]
    for rec in records:
        for a in _affixes(rec):
            # A curve is allowed to be empty BELOW the option's floor (`Armor
            # Destroying` exists from ML 20; yourddo stores null for 1..19) because
            # `min_ml` gates the option before the solver reads a slot. Never at or
            # above it — the builder withholds those as `curve-hole`.
            curve = a["values_by_ml"][rec["min_ml"] - 1:]
            assert all(v not in (None, "") for v in curve), (rec["effect"], a["stat"])
            vals = [float(str(v).strip().rstrip("%")) for v in curve]
            drops = [(i + 1, x, y) for i, (x, y) in enumerate(zip(vals, vals[1:])) if y < x]
            assert not drops, (
                f"{rec['effect']}/{a['stat']} ({rec['family']} {rec['menu']}) falls at ML {drops[0][0]}: "
                f"{drops[0][1]} -> {drops[0][2]}. Crafting at the highest ML is no longer "
                "always optimal, so the solver can no longer read the host's ml and take "
                "the top — it has to choose an ML. See docs/wiki-evidence/essence-crafting.md.")
            assert vals[-1] == max(vals), f"{rec['effect']}/{a['stat']}: peak is not at ML 36"
    assert any(v is None for r in records for a in _affixes(r) for v in a["values_by_ml"]), (
        "no option carries a null below its floor any more — the allowance above is untested")


def test_a_hole_in_a_curve_above_the_floor_is_withheld_not_read_as_zero():
    """Prove the guard bites: a null at ML 30 on a floor-1 option."""
    stats, presence, _ = _catalog()
    groups = json.loads(json.dumps(_groups()))
    row = next(r for r in groups["Trinkets"]["Prefix"] if r.get("sourced") and not r.get("parts")
               and r["stat"] in stats and r["stat"] not in presence and r.get("min_ml", 1) == 1)
    row["values_by_ml"][29] = None
    pool = essence_pool.build_essence_pool(groups, catalog_stats=stats, catalog_presence=presence)
    assert row["effect"] in pool["coverage"]["skipped"]["curve-hole"]
    # And through a compound part, where it withholds the whole shard.
    groups2 = json.loads(json.dumps(_groups()))
    sh = next(r for r in groups2["Trinkets"]["Prefix"] if r["effect"] == "Sheltering")
    sh["parts"][0]["values_by_ml"][29] = None
    pool2 = essence_pool.build_essence_pool(groups2, catalog_stats=stats, catalog_presence=presence)
    assert "Sheltering" in pool2["coverage"]["skipped"]["compound-curve-hole"]
    assert not [r for r in pool["records"] if r["effect"] == row["effect"] and r["family"] == "Trinket"
                and r["menu"] == "Prefix"]


def test_the_shard_ceiling_is_recorded_as_a_player_observation():
    """The ceiling — a named item cannot be crafted above its own ML — is the one
    input here that is NOT from the wiki. It has to stay labelled as such, or a
    later reader will treat it as sourced and build on it."""
    doc = os.path.join(ROOT, "docs", "wiki-evidence", "essence-crafting.md")
    with open(doc) as fh:
        text = fh.read()
    assert "The ceiling is NOT wiki-sourced" in text
    assert "player observation" in text.lower()
    assert "Mysterious Ring" in text, "the nearest contrary signal must stay recorded"
    assert str(essence_pool.MAX_SHARD_ML) in text or "ML 1 through 36" in text
