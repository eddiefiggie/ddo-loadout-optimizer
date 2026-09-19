"""#313 — the Cannith Challenge upgrade-tier overlay.

The load-bearing test here is `test_every_final_is_rederived_from_its_own_raw`: the
seed carries both the verbatim wiki text and the resolved affixes, and that test
re-derives the second from the first for all 113 entries. A hand-edited `final` — the
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

def test_an_augment_slot_is_capacity_not_an_affix_and_not_a_quarantine():
    """#591 — the wiki's `Adds Green Augment Slot` is a host slot, the thing an
    augment goes INTO. It has no bonus type to source and no value to verify, so it
    is neither minted as an affix nor dropped as a quarantine: it comes out as the
    exact `crafting[]` label the pipeline's own slot lift reads."""
    out = CT.resolve("Upgradeable - Tier 1 / Seeker +9 / "
                     "Upgradeable - Tier 2 / Adds Colorless Augment Slot / "
                     "Upgradeable - Tier 3 / Adds Green Augment Slot",
                     known_names={"Seeker"})
    _eq(out["slots"], ["Colorless Augment Slot", "Green Augment Slot"],
        "both tier slots, in wiki order, as crafting[] labels")
    _eq(out["quarantined"], [], "a slot is not a quarantine")
    _eq([a["name"] for a in out["affixes"]], ["Seeker"], "and not an affix either")

def test_the_overlay_puts_the_slot_on_the_record_through_the_native_lift():
    """The overlay appends to `crafting[]` and re-runs the planner's own lift, so
    `augment_slots` on the record is derived by the one rule every native slot
    uses. A record that already carries a native slot marker is one upstream has
    started parsing: its overlay slots are skipped wholesale and counted."""
    overlay = {
        "Fresh": {"affixes": [], "slots": ["Green Augment Slot"]},
        "Parsed": {"affixes": [], "slots": ["Green Augment Slot"]},
    }
    fresh = {"name": "Fresh", "affixes": [], "crafting": [], "augment_slots": []}
    parsed = {"name": "Parsed", "affixes": [], "crafting": ["Green Augment Slot"],
              "augment_slots": ["Green"]}
    cov = B.apply_cannith_tiers([fresh, parsed], overlay,
                                known_slots={"Green Augment Slot"})
    _eq(fresh["crafting"], ["Green Augment Slot"])
    _eq(fresh["augment_slots"], ["Green"], "lifted by planner_items._augment_slots")
    _eq(parsed["crafting"], ["Green Augment Slot"], "not doubled")
    _eq(parsed["augment_slots"], ["Green"], "not doubled")
    _eq((cov["items_slotted"], cov["slots_added"], cov["slots_skipped_already_present"]),
        (1, 1, 1))

def test_the_overlay_refuses_a_slot_label_outside_the_frozen_registry():
    """The overlay runs AFTER assert_crafting_vocab validated the native markers,
    so it must not be the one path a new slot vocabulary skips."""
    rec = {"name": "X", "affixes": [], "crafting": [], "augment_slots": []}
    try:
        B.apply_cannith_tiers([rec], {"X": {"affixes": [], "slots": ["Mauve Augment Slot"]}},
                              known_slots={"Green Augment Slot"})
    except ValueError as e:
        _in("Mauve Augment Slot", str(e))
        _eq(rec["crafting"], [], "nothing appended before the refusal")
        return
    raise AssertionError("an unregistered slot label was admitted")



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
    checked = slots_seen = slots_only_seen = typed_only_seen = 0
    for name, entry in shard["items"].items():
        fam = fam_of(name)
        expected = []
        for line in CT.resolve_lines(entry["raw"]):
            kind, p = CT.parse_line(line)
            if kind != "affix" or p["name"] in BUNDLED or p["name"] not in known:
                continue
            hit = sib.get((p["name"], fam)) or uni.get(p["name"])
            if not hit:
                continue
            rn, ty = hit
            expected.append((rn, ty, p["value"], p["unit"]))
        # #792 — the slot-qualified refusal is a property of the SHARD, not of an
        # `admit` marker: gear-planner spells these per slot while the wiki row
        # states only the bare form, so no entry here may emit one. Applied to the
        # expectation before the marker branches, because the five WORN Mournlode
        # Docents shipped the bare `Enhancement Bonus` on main until this change and
        # carry no marker at all.
        expected = [e for e in expected if e[0] not in CT.SLOT_QUALIFIED_NAMES]
        got = [(a["name"], a["type"], a["value"], a["unit"]) for a in entry["final"]]
        # #591 half B — an entry may declare `admit: "slots_only"`, which admits the
        # tier-granted augment slot and deliberately NOT the enchantments the same
        # `raw` would yield. The issue puts them out of scope twice and asks for a
        # separate follow-up rather than folding them in here.
        #
        # The marker is guarded so it can never be used vacuously. An entry whose
        # `raw` derives NOTHING has no scope to decline, so declaring slots_only on
        # it would be decoration hiding an empty harvest — exactly the "found
        # nothing" / "asked nothing" confusion this repo refuses elsewhere. It must
        # also say why, in its own entry, so the exemption can be retired by reading
        # rather than by archaeology.
        if entry.get("admit") == "slots_only":
            _eq(got, [], f"{name}: slots_only must store no `final`")
            _true(expected, f"{name}: declares slots_only but its `raw` derives "
                            "nothing — the marker is decorating an empty harvest")
            _true((entry.get("admit_reason") or "").strip(),
                  f"{name}: slots_only with no stated reason cannot be retired by review")
            slots_only_seen += 1
        elif entry.get("admit") == "typed_only":
            # #784 — the weapons admit the enchantments whose bonus type is sourced
            # and NOT the bane/proc lines. The cut is by TYPE: `Dragon Bane 3`
            # carries a magnitude and still resolves to `Bool`, because it is bane
            # damage — the family #331 closed as permanently unvalued.
            #
            # Re-derived exactly like an unmarked entry, then filtered by the SAME
            # rule the seed claims to apply. So the marker cannot hide a hand-edited
            # `final`: every admitted affix still has to fall out of its own `raw`.
            # The seed's rule, read from the module that declares it rather than
            # restated here — a second copy is a second thing to drift.
            typed = [e for e in expected if e[1] != "Bool"]
            _eq(got, typed, f"{name}: stored `final` disagrees with the typed half of its `raw`")
            # The marker must be doing work in BOTH directions, or it is decoration:
            # something admitted, and something deliberately left out.
            _true(typed, f"{name}: declares typed_only but its `raw` yields no typed affix")
            _true(len(expected) > len(typed),
                  f"{name}: declares typed_only but nothing was excluded — the marker "
                  "claims a cut it is not making")
            _true((entry.get("admit_reason") or "").strip(),
                  f"{name}: typed_only with no stated reason cannot be retired by review")
            typed_only_seen += 1
        else:
            _eq(got, expected, f"{name}: stored `final` disagrees with its own `raw`")
        # #591 — `slots` is derived too, by the same standard: nothing here trusts
        # the stored list, and a slot line must never ALSO sit in `quarantined`.
        _eq(entry["slots"], CT.resolve_slots(entry["raw"]),
            f"{name}: stored `slots` disagrees with its own `raw`")
        for q in entry["quarantined"]:
            _true(not CT.AUGMENT_SLOT.match(q["raw"]),
                  f"{name}: {q['raw']!r} is a slot and is still quarantined")
        slots_seen += len(entry["slots"])
        checked += 1
    # #591 half B — 113 not 33: the 80 weapon variants joined the 33 worn ones.
    _eq(checked, 113, "every entry re-derived")
    # 120 not 40: +80. The 64 weapons that grant a slot contribute 80 labels, not
    # 64, because the 16 Epic variants add a Colorless slot at Tier 2 AND a Purple
    # at Tier 3. The remaining 16 weapon variants are the level-4 rows, which are
    # not upgradeable at all and correctly derive NO slot — they are kept in the
    # shard rather than dropped so their raw proves the absence.
    _eq(slots_seen, 120, "the 120 wiki-stated slots are all derived, none left on the floor")
    # #784 — the 80 weapon entries moved from slots_only to typed_only when their
    # typed enchantments were admitted. No entry is slots_only today; the branch is
    # kept because it is the correct state for a harvest whose types are not sourced,
    # and `test_the_admit_markers_are_the_declared_vocabulary` pins the closed set.
    # #784 — the marker is PER ENTRY and says what that entry does. 20 weapon
    # variants (the four Elemental families at five levels each) admit an Elemental
    # Resistance; the other 60 have nothing admissible — every typed line on them is
    # a bane/proc `Bool` or the slot-qualified `Enhancement Bonus` — so they stay
    # `slots_only`, which is the honest state rather than a marker claiming a cut it
    # cannot make. 60 + 20 = the 80 weapons; the 33 worn entries carry no marker.
    _eq(slots_only_seen, 60, "the weapon entries with nothing admissible")
    _eq(typed_only_seen, 20, "the weapon entries that admit an Elemental Resistance")
    _true(CT.SLOT_QUALIFIED_NAMES, "the slot-qualified refusal set is not empty")

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
    # #784 — 49 not 33: +16, the Elemental Resistances admitted onto the weapons.
    # 20 are derived but 4 are SKIPPED as already native — gear-planner populates the
    # four level-4 Elemental variants with the same resistance — so the overlay adds
    # 16. That skip is the anti-double-count guard doing its job, and it is the tell
    # that caught the `Enhancement Bonus` spelling defect before it shipped.
    _eq(cov["items_filled"], 49)
    _eq(cov["missing_from_roster"], [],
                     "an overlay entry naming an item the roster lacks is a stale key")
    _gt(cov["affixes_added"], 0)
    _eq(cov["affixes_skipped_already_present"], 4,
        "the four level-4 Elemental variants already carry their resistance natively")
    # #591 — the slot half. Was (32, 40) for the worn shard alone: 32 of the 33
    # entries state a slot (Mournlode Docent (level 4) has no tier block at all).
    # Half B adds the 80 weapon variants: 64 of them state a slot, contributing 80
    # labels because the 16 Epic ones add a Colorless at Tier 2 AND a Purple at
    # Tier 3. 32 + 64 = 96 items, 40 + 80 = 120 labels. The other 16 weapons are
    # the level-4 rows, not upgradeable and correctly slotless.
    # A skip means the wiki half and gear-planner now both claim these slots —
    # worth a look, not a silent pass.
    _eq((cov["items_slotted"], cov["slots_added"]), (96, 120))
    _eq(cov["slots_skipped_already_present"], 0)

def test_every_shard_slot_reaches_its_variant_as_host_capacity():
    """#591 end to end: the seed's `slots` come out of the build as the variant's
    normalized `augment_slots_norm.colors` — the field the solver bounds augment
    placements by — with nothing quarantined on the way. Driven through the built
    dataset, not a hand-built record, so it covers the overlay, the planner lift and
    the colour normalization together. Refuses to inspect zero records."""
    ds = _dataset()
    shard = _shard()
    by_id = {v["variant_id"]: v for v in ds["items"]}
    checked = colors_seen = 0
    for name, entry in shard["items"].items():
        want = [lbl[: -len(" Augment Slot")] for lbl in entry["slots"]]
        v = by_id[name]
        norm = v["augment_slots_norm"]
        _eq(norm["colors"], want, f"{name}: slot capacity did not reach the variant")
        _eq(norm["quarantined"], [], f"{name}: a wiki-stated slot colour was quarantined")
        _eq(v["augment_slots"], want, f"{name}: the lifted list disagrees with the seed")
        for lbl in entry["slots"]:
            _in(lbl, v["crafting"], f"{name}: label missing from crafting[]")
        colors_seen += len(want)
        checked += 1
    # #591 half B — 113 entries, 120 colours. Both move together with the shard;
    # the per-entry assertions above are what actually prove the capacity landed.
    _eq(checked, 113, "every shard entry checked against its variant")
    _eq(colors_seen, 120, "refuse to pass over a shard that states no slots")

def test_591b_the_weapons_carry_their_tier_granted_slot_and_nothing_else():
    """#591 half B, end to end on the built dataset.

    The weapons were the half that never shipped: 80 Vaults variants reaching the
    solver with no augment slot at all, while the wiki states one on every
    upgradeable tier. This pins what admitting them did, and — just as important —
    what it deliberately did NOT do."""
    ds = _dataset()
    shard = _shard()
    # #784 — the weapons are identified by CARRYING a marker, not by carrying one
    # PARTICULAR marker: 20 admit an Elemental Resistance (`typed_only`) and 60 have
    # nothing admissible (`slots_only`). Keying on `slots_only` alone silently
    # dropped 20 of them the moment those were admitted.
    weapons = {n: e for n, e in shard["items"].items() if e.get("admit")}
    _eq(len(weapons), 80, "the 80 weapon variants are in the shard")

    by_id = {v["variant_id"]: v for v in ds["items"]}
    slotted = [n for n, e in weapons.items() if e["slots"]]
    _eq(len(slotted), 64, "64 grant a slot; the other 16 are the level-4 rows")

    # Every level-4 row is slotless, and nothing else is. Stated as a partition so a
    # future variant that loses its slot cannot hide inside the count.
    bare = sorted(n for n, e in weapons.items() if not e["slots"])
    _eq(bare, sorted(n for n in weapons if n.endswith("(level 4)")),
        "exactly the level-4 rows are slotless — they are not upgradeable")

    purple = [n for n, e in weapons.items() if "Purple Augment Slot" in e["slots"]]
    _eq(len(purple), 64, "every slotted weapon grants Purple")
    # #591's body named Purple only. The Epic variants also add a Colorless at
    # Tier 2, which is why the label count is 80 and not 64.
    both = sorted(n for n, e in weapons.items() if len(e["slots"]) == 2)
    _eq(len(both), 16, "the 16 Epic variants grant Colorless AND Purple")
    _true(all(n.startswith("Epic ") for n in both),
          "and only the Epic ones do")

    ml8 = by_id["Mournlode Longsword (level 8)"]
    _eq(ml8["augment_slots_norm"]["colors"], ["Purple"])
    _eq(ml8["augment_slots_norm"]["quarantined"], [])
    epic = by_id["Epic Mournlode Longsword"]
    _eq(epic["augment_slots_norm"]["colors"], ["Colorless", "Purple"])

    # The scope boundary, asserted rather than trusted: admitting the slot must not
    # have admitted the weapons' enchantments. `Enhancement Bonus` is on all 80 raw
    # blocks and is the one a later pass is most likely to let slip in.
    for n in weapons:
        entry = shard["items"][n]
        if entry.get("admit") == "slots_only":
            _eq(entry["final"], [], f"{n}: slots_only stores no affixes")
        # #784 — the scope boundary, still asserted and now narrower. The BARE
        # `Enhancement Bonus` must never reach a weapon: gear-planner spells the
        # weapon form `Enhancement Bonus (Weapon)`, and emitting the bare one would
        # name a stat 3,325 weapons do not use. The 16 level-4 variants carry the
        # slot-qualified name NATIVELY, so this checks the bare spelling only.
        names = [a.get("name") for a in by_id[n].get("affixes") or []]
        _notin("Enhancement Bonus", names,
               f"{n}: the bare Enhancement Bonus reached a weapon")
        # And no bane/proc line was admitted (#331).
        for a in entry["final"]:
            _true(a["type"] != "Bool", f"{n}: admitted a Bool-typed line ({a['name']})")


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


