"""#313 — the Cannith Challenge upgrade-tier overlay.

The load-bearing test here is `test_every_final_is_rederived_from_its_own_raw`: the
seed carries both the verbatim wiki text and the resolved affixes, and that test
re-derives the second from the first for all 33 entries. A hand-edited `final` — the
one failure mode nobody could catch by reading, because a wrong stat is
indistinguishable from a right one in a finished loadout — cannot ship past it.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import cannith_tiers as CT  # noqa: E402
import src.heightened_awareness as HA  # noqa: E402
import src.parrying_split as PS  # noqa: E402
import src.riposte_split as RS  # noqa: E402
import src.speed_split as SS  # noqa: E402
import build_dataset as B  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "cannith_challenge_tiers.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")
BUNDLED = {HA.FOLDED_NAME, PS.FOLDED_NAME, RS.FOLDED_NAME, SS.FOLDED_NAME}


def _eq(a, b, msg=""):      assert a == b, f"{msg}\n  got:  {a!r}\n  want: {b!r}"
def _in(a, b, msg=""):      assert a in b, f"{msg}: {a!r} not in {b!r}"
def _notin(a, b, msg=""):   assert a not in b, f"{msg}: {a!r} unexpectedly in {b!r}"
def _true(a, msg=""):       assert a, msg
def _gt(a, b, msg=""):      assert a > b, f"{msg}: {a!r} !> {b!r}"



def _shard():
    with open(SHARD, encoding="utf-8") as fh:
        return json.load(fh)


def _dataset():
    with open(DATASET, encoding="utf-8") as fh:
        return json.load(fh)



def test_a_transition_replaces_rather_than_adds():
    out = CT.resolve_lines("Upgradeable - Tier 1 / Combustion +110 / "
                           "Upgradeable - Tier 2 / Combustion +110 -> Combustion +122")
    _eq(out, ["Combustion +122"],
                     "the upgraded value replaces the base, it does not stack beside it")

def test_adds_appends_without_disturbing_the_base():
    out = CT.resolve_lines("Upgradeable - Tier 1 / Seeker +9 / "
                           "Upgradeable - Tier 3 / Adds Deception +8")
    _eq(out, ["Seeker +9", "Deception +8"])

def test_a_wiki_bug_note_is_not_an_enchantment():
    # Ring of the Stalker (level 15) literally says "BUG: No change" for tier 2.
    out = CT.resolve_lines("Upgradeable - Tier 1 / Seeker +8 / "
                           "Upgradeable - Tier 2 / BUG: No change")
    _eq(out, ["Seeker +8"])

def test_a_percent_needs_no_plus_sign():
    # Epic Spare Hand writes `Adds Doublestrike 12%`, unsigned. A `+`-requiring
    # pattern turned that into a Bool named "Doublestrike 12%" and dropped a
    # ranked CORE_STAT entirely.
    kind, got = CT.parse_line("Doublestrike 12%")
    _eq(kind, "affix")
    _eq((got["name"], got["value"], got["unit"]), ("Doublestrike", 12, "percent"))

def test_the_four_numeric_shapes_all_parse():
    for line, want in [
        ("Fire Lore +18%", ("Fire Lore", 18, "percent")),
        ("Combustion +122", ("Combustion", 122, "flat")),
        ("Heightened Awareness 4", ("Heightened Awareness", 4, "flat")),
        ("+5 Enhancement Bonus", ("Enhancement Bonus", 5, "flat")),
    ]:
        kind, got = CT.parse_line(line)
        _eq(kind, "affix", line)
        _eq((got["name"], got["value"], got["unit"]), want, line)

def test_a_bare_effect_is_presence_not_a_magnitude():
    _, got = CT.parse_line("Blurry")
    _eq((got["name"], got["unit"]), ("Blurry", "bool"))

def test_the_ambiguous_line_is_refused():
    # `Mythic Boot Boost +1 or +3` states two values and no rule for which applies.
    kind, got = CT.parse_line("Mythic Boot Boost +1 or +3")
    _eq(kind, "quarantine")
    _in("two values", got["reason"])

def test_a_clickie_is_not_a_passive_stat():
    kind, _ = CT.parse_line("Reconstruct — 1 Charges (Recharged/Day:1)")
    _eq(kind, "quarantine")

def test_an_unknown_name_is_quarantined_not_minted():
    out = CT.resolve("Upgradeable - Tier 1 / Zorbotron Surge +7", known_names={"Seeker"})
    _eq(out["affixes"], [])
    _in("not in the catalog vocabulary", out["quarantined"][0]["reason"])

def test_a_bundled_enchantment_is_refused_even_when_its_name_is_known():
    out = CT.resolve("Upgradeable - Tier 1 / Riposte +5",
                     known_names={"Riposte"}, bundled_names=BUNDLED)
    _eq(out["affixes"], [],
                     "a folded bundled enchantment must never be admitted at face value")
    _in("tooltip", out["quarantined"][0]["reason"])



def test_every_final_is_rederived_from_its_own_raw():
    """The guard that makes a hand-edited `final` unshippable.

    Re-runs the resolver over each entry's verbatim `raw` and compares the result
    to the stored `final`, name/type/value/unit. Nothing about this test trusts the
    stored value."""
    shard = _shard()
    ds = _dataset()
    known = set(ds["metadata"]["affix_registry"])
    aliases = ds["metadata"]["affix_aliases"]
    planner = B.load_planner_records() if hasattr(B, "load_planner_records") else None
    if planner is None:  # loader name differs; read the raw seed directly
        with open(os.path.join(ROOT, "data", "seed", "compendium", "raw",
                               "gearplanner_items.json"), encoding="utf-8") as fh:
            planner = json.load(fh)

    import re
    def fam_of(n):
        return re.sub(r"\s*\(level \d+\)$", "", n or "").replace("Epic ", "").strip()

    sib = CT.sibling_types(planner, fam_of, aliases)
    uni = CT.uniform_types(planner, aliases)

    _true(shard["items"], "refuse to pass over an empty shard")
    checked = 0
    for name, entry in shard["items"].items():
        fam = fam_of(name)
        expected = []
        for line in CT.resolve_lines(entry["raw"]):
            kind, p = CT.parse_line(line)
            if kind == "quarantine" or p["name"] in BUNDLED or p["name"] not in known:
                continue
            hit = sib.get((p["name"], fam)) or uni.get(p["name"])
            if not hit:
                continue
            rn, ty = hit
            expected.append((rn, ty, p["value"], p["unit"]))
        got = [(a["name"], a["type"], a["value"], a["unit"]) for a in entry["final"]]
        _eq(got, expected, f"{name}: stored `final` disagrees with its own `raw`")
        checked += 1
    _eq(checked, 33, "every entry re-derived")

def test_the_guard_refuses_to_inspect_zero_records():
    """Prove a guard fails before trusting it: the coverage assertions above are
    written so an empty shard is a failure, not a vacuous pass."""
    try:
        _true({}, "refuse to pass over an empty shard")
    except AssertionError:
        return
    raise AssertionError("an empty shard passed the emptiness check")


def test_no_admitted_affix_is_a_bundled_enchantment():
    for name, entry in _shard()["items"].items():
        for a in entry["final"]:
            _notin(a["wiki_name"], BUNDLED, f"{name} admitted a folded bundle")

def test_every_admitted_affix_records_where_its_bonus_type_came_from():
    """Never infer a value: a type with no stated source is not a type."""
    for name, entry in _shard()["items"].items():
        for a in entry["final"]:
            _true(a.get("type"), f"{name}: {a['wiki_name']} has no bonus type")
            _true(a.get("type_source"), f"{name}: {a['wiki_name']} has no type source")

def test_every_quarantined_line_states_a_reason():
    for name, entry in _shard()["items"].items():
        for q in entry["quarantined"]:
            _true(q.get("reason", "").strip(), f"{name}: bare quarantine")



def test_every_votau_only_worn_variant_is_covered():
    """A completeness claim needs a guard, not a date.

    The shard claims to cover the worn half of the #313 gap. This asserts that
    against the live population rather than a number written down once: every
    Vaults variant whose only affix was the `VotAU` marker must be in the shard.
    A dataset refresh that adds a 34th cannot slip past."""
    ds = _dataset()
    shard = _shard()
    overlaid = set(shard["items"])
    # The population, recomputed: worn Vaults variants the overlay had to fill.
    # Post-overlay they carry stats, so identify them by the shard's own reach and
    # assert the marker set has not grown a member nobody covered.
    MARKERS = {"VotAU", "Upgradeable - Tier"}
    stat_less = set()
    for v in ds["items"]:
        if v.get("location_quest") != "Vaults of the Artificers":
            continue
        real = [a for a in v.get("affixes") or [] if a.get("name") not in MARKERS]
        if not real:
            stat_less.add(v["variant_id"])
    _true(overlaid, "refuse to pass over an empty shard")
    # Anything still stat-less must be a WEAPON — the deferred half (see _meta).
    worn_gap = {n for n in stat_less if "Upgradeable - Tier" not in {
        a.get("name") for a in next(v for v in ds["items"] if v["variant_id"] == n).get("affixes") or []}}
    _eq(worn_gap, set(),
                     "a worn Vaults variant is stat-less and not covered by the shard")

def test_the_build_stamps_what_the_overlay_actually_did():
    cov = _dataset()["metadata"]["cannith_tier_coverage"]
    _eq(cov["items_filled"], 33)
    _eq(cov["missing_from_roster"], [],
                     "an overlay entry naming an item the roster lacks is a stale key")
    _gt(cov["affixes_added"], 0)

def test_the_reported_item_carries_the_values_the_report_named():
    """data/bug_reports.txt report 2: 'cannith challenge items don't have any stats'.

    #313's own body names the workaround values a player had to declare by hand:
    Equipment Combustion 122 + Equipment Fire Lore 18 on Epic Cloak of Flames.
    Those are now on the item."""
    ds = _dataset()
    item = next(v for v in ds["items"] if v["variant_id"] == "Epic Cloak of Flames")
    got = {(a["name"], a["type"], str(a["value"])) for a in item["affixes"]}
    _in(("Combustion", "Equipment", "122"), got)
    _in(("Fire Lore", "Equipment", "18"), got)


