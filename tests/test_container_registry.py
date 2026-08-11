"""U3 (#205) — the single-pick choice-slot container registry and its fan-out gate.

The reported defect: the Viktranium pool stored one record per affix, and two
expansion passes fanned single craftable options into several mutually exclusive
records. A choice slot admits one record, so a craft granting seven spell schools
delivered one. Fixed for Viktranium in `0833d27`; these tests cover the gate that
stops the class from recurring.

The gate's first cut modelled the defect as "FLAT shape plus a declared expansion
pass" and missed the defect itself — one source option becoming more than one
record, whatever shape the records wear and whether or not a pass is declared. The
tests below are written against the CARDINALITY rule, and three of them cover the
holes that model left: an ATOMIC-shaped fan-out, a builder that splits options at
construction, and a pool that never reached the gate at all.

The gate is only worth having if it goes red on the thing it claims to catch, so
most of what follows corrupts a configuration and asserts the failure — including
the two vacuous-pass shapes (`prove-a-guard-fails-before-trusting-it`): a gate
handed nothing, and a gate that inspects zero records.

Discovered + run by tests/run_tests.py.
"""
import contextlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

sys.path.insert(0, ROOT)
from src import container_registry as cr  # noqa: E402
from src import crafting_catalog, dino, nearly_complete, seal  # noqa: E402
from src import green_steel, thunder_forged, viktranium  # noqa: E402
from src.spell_focus import PROVENANCE_KEY  # noqa: E402


# --- helpers ------------------------------------------------------------------

@contextlib.contextmanager
def registry(**declarations):
    """Swap the module registry (and its pinned count) for the duration of a test."""
    saved, saved_count = cr.REGISTRY, cr.EXPECTED_CONTAINER_COUNT
    cr.REGISTRY = dict(declarations)
    cr.EXPECTED_CONTAINER_COUNT = len(declarations)
    try:
        yield
    finally:
        cr.REGISTRY, cr.EXPECTED_CONTAINER_COUNT = saved, saved_count


def ds(items=None, **containers):
    """A minimal built-dataset structure the gate can walk."""
    return {"metadata": {}, "items": list(items or []), **containers}


def flat_rec(stat="Charisma", **extra):
    """A FLAT container record: the affix IS the record."""
    return {"stat": stat, "bonus_type": "Enhancement", "value": 6, "unit": "flat", **extra}


def atomic_rec(name="Dolorous Accuracy", affixes=None):
    """An ATOMIC container record: one craftable option carrying its affix list."""
    return {"name": name, "affixes": affixes if affixes is not None else [flat_rec()]}


def expanded_rec(name="Sacred Spell Focus Mastery", n=7):
    """An ATOMIC record whose affix list carries an EXPANSION's provenance stamps."""
    return atomic_rec(name, [flat_rec(f"School {i} Focus", **{PROVENANCE_KEY: name})
                             for i in range(n)])


def raises_systemexit(fn):
    try:
        fn()
    except SystemExit as exc:
        return str(exc)
    raise AssertionError("expected SystemExit, the gate passed")


# --- the rule: one source option, one record ------------------------------------

def test_gate_raises_when_a_flat_container_splits_a_source_option():
    """The defect itself. One option carrying three affixes becomes three records,
    the slot takes exactly one, and the player gets a third of the craft."""
    with registry(green_steel=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(
            ds(green_steel=[flat_rec("Charisma Skills"), flat_rec("Use Magic Device"),
                            flat_rec("Wizardry")]),
            {"green_steel": 1}))

    assert "FLAT container turned 1 source option(s) into 3 record(s)" in msg
    assert "mutually exclusive siblings" in msg


def test_gate_raises_when_an_atomic_container_splits_a_source_option():
    """The hole the shape-only model left wide open.

    Reintroduce the fan-out and wrap each half in ATOMIC clothing — a ONE-element
    `affixes` list with the provenance stamp at affix level. Every shape test
    passes: `"affixes" in rec` is satisfied, and affix-level provenance is what a
    legitimate expansion looks like. Only the count catches it.
    """
    fanned = [atomic_rec("Sacred Spell Focus Mastery",
                         [flat_rec(f"School {i} Focus",
                                   **{PROVENANCE_KEY: "Sacred Spell Focus Mastery"})])
              for i in range(7)]
    with registry(viktranium=cr._c(cr.ATOMIC, ("spell_focus",), cr.CORRECTED, True, "")):
        msg = raises_systemexit(
            lambda: cr.check(ds(viktranium=fanned), {"viktranium": 1}))

    assert "ATOMIC container turned 1 source option(s) into 7 record(s)" in msg
    assert "same defect in a costume" in msg


def test_gate_allows_an_atomic_container_to_drop_an_option_but_not_to_split_one():
    """`records <= options` is the atomic rule: an affix-less option may be dropped."""
    with registry(dino_inserts=cr._c(cr.ATOMIC, (), cr.VERIFIED_SAFE, True, "")):
        stats = cr.check(ds(dino_inserts=[atomic_rec()]), {"dino_inserts": 4})
    assert stats["compared"] == 1
    assert stats["source_options"]["dino_inserts"] == 4


def test_gate_raises_when_a_builder_reports_no_source_option_count():
    """A container the gate cannot judge must not pass. Record count alone cannot
    tell a split option from an honest one."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(ds(seal=[flat_rec()]), {}))
    assert "builder reported no source-option count" in msg


def test_gate_raises_on_a_source_option_count_for_an_unknown_container():
    """A typo'd name would leave the real container judged with no count at all."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(
            lambda: cr.check(ds(seal=[flat_rec()]), {"seal": 1, "sealz": 9}))
    assert "sealz" in msg
    assert "not a declared" in msg


# --- S1: an expansion pass wired to a flat container ---------------------------

def test_gate_raises_when_an_expansion_pass_runs_over_a_flat_container():
    """S1, the reported defect in the abstract. The cross-product rule survives."""
    with registry(seal=cr._c(cr.FLAT, ("spell_focus",), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(
            lambda: cr.check(ds(seal=[flat_rec()]), {"seal": 1}))

    assert "FLAT container" in msg
    assert "spell_focus" in msg
    assert "mutually exclusive" in msg


def test_gate_allows_the_same_expansion_pass_over_an_atomic_container():
    """The rule is about the COUNT, not about expansion being forbidden: seven
    schools inside one option's affix list is one record, and correct."""
    with registry(viktranium=cr._c(cr.ATOMIC, ("spell_focus",), cr.CORRECTED, True, "")):
        stats = cr.check(ds(viktranium=[expanded_rec()]), {"viktranium": 1})

    assert stats["compared"] == 1
    assert stats["expanded_affixes"]["viktranium"] == 7


def test_gate_raises_when_a_declared_expansion_pass_left_no_stamp():
    """The registry declared `viktranium: ("spell_focus",)` and nothing checked that
    the pass ran. Reverting it to a no-op would have left the gate green and the
    seven schools silently gone."""
    with registry(viktranium=cr._c(cr.ATOMIC, ("spell_focus",), cr.CORRECTED, True, "")):
        msg = raises_systemexit(
            lambda: cr.check(ds(viktranium=[atomic_rec()]), {"viktranium": 1}))

    assert "declares expansion pass(es) ['spell_focus']" in msg
    assert "did not run" in msg


# --- S2: refusing to inspect nothing -------------------------------------------

def test_gate_raises_when_handed_no_dataset():
    """S2a. A gate given nothing must not report a clean run."""
    msg = raises_systemexit(lambda: cr.check({}, {}))
    assert "no dataset" in msg


def test_gate_raises_when_the_dataset_carries_no_items():
    """Without `items` it can neither derive the roll-group pool nor count hosts."""
    msg = raises_systemexit(lambda: cr.check({"metadata": {}}, {}))
    assert "no `items`" in msg


def test_gate_raises_when_it_inspects_zero_records():
    """S2b, the subtler vacuous pass: containers present, every one of them empty.

    Reachability is what makes this fail rather than pass quietly — and the
    `compared == 0` backstop catches it even for a container declared unreachable.
    """
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(ds(seal=[]), {"seal": 0}))
    assert "declared reachable but carries no records" in msg

    with registry(roll_groups=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, False, "", derived=True)):
        msg = raises_systemexit(lambda: cr.check(ds(), {}))
    assert "inspected zero records" in msg
    assert "verified nothing" in msg


def test_gate_raises_on_an_empty_registry():
    """A registry declaring nothing cannot clear anything."""
    with registry():
        msg = raises_systemexit(lambda: cr.check(ds(seal=[flat_rec()]), {}))
    assert "registry is empty" in msg


# --- S3: discovery — a container the registry does not declare -------------------

def test_gate_discovers_an_undeclared_pool_in_the_dataset():
    """S3. Discovery replaces the hand-typed call-site list: a new choice-slot pool
    in the built dataset must be audited, not silently admitted — and it no longer
    depends on somebody remembering to hand it over."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(
            ds(seal=[flat_rec()], brand_new_pool=[flat_rec()]), {"seal": 1}))

    assert "brand_new_pool" in msg
    assert "affix-bearing records" in msg
    assert "cannot classify" in msg


def test_gate_raises_when_a_not_a_pool_key_starts_carrying_affix_records():
    """The exemption is checked, not taken on trust: a declared non-pool that fills
    with affix-bearing records is a pool nobody audited, under a safe name."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(
            ds(seal=[flat_rec()], compendium=[flat_rec()]), {"seal": 1}))

    assert "declared NOT_A_POOL but now carries affix-bearing records" in msg
    assert "compendium" in msg


def test_gate_raises_on_a_declaration_nothing_verifies():
    """The other direction: a declared container absent from the dataset is inert."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, ""),
                  ghost=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(ds(seal=[flat_rec()]), {"seal": 1}))

    assert "ghost" in msg
    assert "absent from the built dataset" in msg


def test_gate_raises_when_the_pinned_container_count_disagrees():
    """The count pin catches a container added to the registry without a re-audit."""
    saved, saved_count = cr.REGISTRY, cr.EXPECTED_CONTAINER_COUNT
    cr.REGISTRY = {"seal": cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")}
    cr.EXPECTED_CONTAINER_COUNT = 8
    try:
        msg = raises_systemexit(lambda: cr.check(ds(seal=[flat_rec()]), {"seal": 1}))
    finally:
        cr.REGISTRY, cr.EXPECTED_CONTAINER_COUNT = saved, saved_count

    assert "pinned at 8" in msg
    assert "without re-auditing" in msg


# --- the declaration cannot drift from the records ------------------------------

def test_gate_raises_when_a_flat_declaration_describes_atomic_records():
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(ds(seal=[atomic_rec()]), {"seal": 1}))
    assert "declared FLAT but record carries an `affixes` list" in msg


def test_gate_raises_when_an_atomic_declaration_describes_flat_records():
    """Viktranium's pre-0833d27 state: declared atomic, still one record per affix."""
    with registry(viktranium=cr._c(cr.ATOMIC, (), cr.CORRECTED, True, "")):
        msg = raises_systemexit(
            lambda: cr.check(ds(viktranium=[flat_rec()]), {"viktranium": 1}))
    assert "declared ATOMIC but record carries no `affixes`" in msg


def test_gate_raises_on_record_level_expansion_provenance():
    """Fan-out evidence that does not depend on the declaration being honest.

    Every expansion family stamps PROVENANCE_KEY on each affix it emits. Finding
    it on the RECORD means an expander was handed the record list as if it were an
    affix list — the Viktranium defect, caught structurally.
    """
    fanned = [flat_rec("Necromancy Focus", **{PROVENANCE_KEY: "Sacred Spell Focus Mastery"})]
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(ds(seal=fanned), {"seal": 1}))

    assert "at RECORD level" in msg
    assert "fanned one craftable option into several" in msg


def test_gate_raises_when_an_unreachable_container_starts_carrying_records():
    """`roll_groups` is empty today. If it fills, it gets audited before it ships."""
    with registry(roll_groups=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, False, "")):
        msg = raises_systemexit(
            lambda: cr.check(ds(roll_groups=[flat_rec()]), {"roll_groups": 1}))

    assert "declared UNREACHABLE but now carries 1 record" in msg


def test_gate_raises_on_an_unrecognized_expansion_pass_name():
    """A typo'd pass name must not read as 'no expansion' and clear a flat container."""
    with registry(seal=cr._c(cr.FLAT, ("spell_focuss",), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check(ds(seal=[flat_rec()]), {"seal": 1}))
    assert "unknown expansion pass" in msg


# --- known-unsafe-but-unreachable: the trigger must be live ----------------------

def test_gate_raises_the_moment_a_host_reaches_a_splitting_pool():
    """Green Steel / Thunder-Forged are held safe ONLY by being unreachable, so the
    trigger is keyed to the HOST marker. A record-count trigger was already spent —
    the pool has carried 108 records for months with no host to use them."""
    known_unsafe = cr._c(cr.FLAT, (), cr.KNOWN_UNSAFE, False, "",
                         host_marker="green_steel_slot", splits_options=True)
    with registry(green_steel=known_unsafe):
        stats = cr.check(ds(green_steel=[flat_rec(), flat_rec()]), {"green_steel": 1})
        assert stats["hosts"]["green_steel"] == 0

        msg = raises_systemexit(lambda: cr.check(
            ds(items=[{"name": "Legendary Green Steel Ring", "green_steel_slot": True}],
               green_steel=[flat_rec(), flat_rec()]),
            {"green_steel": 1}))

    assert "now carry `green_steel_slot`" in msg
    assert "REACHABLE" in msg
    assert "solver takes exactly one per host" in msg


def test_gate_raises_when_a_known_unsafe_container_no_longer_splits():
    """A corrected builder must not keep a known-unsafe label that would silence the
    cardinality rule for that container permanently."""
    with registry(green_steel=cr._c(cr.FLAT, (), cr.KNOWN_UNSAFE, False, "",
                                    host_marker="green_steel_slot", splits_options=True)):
        msg = raises_systemexit(
            lambda: cr.check(ds(green_steel=[flat_rec()]), {"green_steel": 1}))

    assert "no longer splits" in msg
    assert "restore the 'verified-safe' verdict" in msg


def test_registry_rejects_a_splitter_dressed_as_verified_safe():
    """The declaration that shipped: FLAT, splitting options, certified safe."""
    with registry(green_steel=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, False, "",
                                    host_marker="green_steel_slot", splits_options=True)):
        msg = raises_systemexit(lambda: cr.check(ds(green_steel=[flat_rec()]), {}))
    assert "must agree" in msg


def test_registry_rejects_a_splitter_with_no_host_marker():
    """Without a host marker there is nothing left to trip when the pool goes live."""
    with registry(green_steel=cr._c(cr.FLAT, (), cr.KNOWN_UNSAFE, False, "",
                                    splits_options=True)):
        msg = raises_systemexit(lambda: cr.check(ds(green_steel=[flat_rec()]), {}))
    assert "no `host_marker`" in msg


# --- S5: the registry names every single-pick container with its verdict --------

def test_registry_declares_every_single_pick_container_with_a_verdict():
    """S5. The audit itself, as a record. Each entry is the prior research's finding."""
    expected = {
        "viktranium":               (cr.ATOMIC, ("spell_focus",), cr.CORRECTED,     True),
        "dino_inserts":             (cr.ATOMIC, ("spell_focus",), cr.VERIFIED_SAFE, True),
        "nearly_complete":          (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "nearly_complete_per_item": (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "seal":                     (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "green_steel":              (cr.FLAT,   (),               cr.KNOWN_UNSAFE,  False),
        "thunder_forged":           (cr.FLAT,   (),               cr.KNOWN_UNSAFE,  False),
        "roll_groups":              (cr.FLAT,   (),               cr.VERIFIED_SAFE, False),
    }
    actual = {name: (shape, exps, verdict, reachable)
              for name, shape, exps, verdict, reachable in cr.describe()}

    assert actual == expected
    assert cr.EXPECTED_CONTAINER_COUNT == len(expected)
    # Every declaration carries a rationale — the verdict alone is not the audit.
    for name, c in cr.REGISTRY.items():
        assert c["note"].strip(), f"{name} declares no rationale"
    # And every non-container exemption carries the reason it is exempt.
    for name, (kind, reason) in cr.NON_CONTAINERS.items():
        assert kind in cr.NON_CONTAINER_KINDS, name
        assert reason.strip(), f"{name} declares no reason for its exemption"


def test_no_flat_container_has_an_expansion_pass_declared():
    """The shipped configuration satisfies the cross-product rule."""
    offenders = [n for n, c in cr.REGISTRY.items()
                 if c["shape"] == cr.FLAT and c["expansions"]]
    assert offenders == []


def test_every_known_unsafe_container_is_unreachable_and_host_triggered():
    """A KNOWN_UNSAFE verdict is only tolerable while no host can reach the pool."""
    for name, c in cr.REGISTRY.items():
        if c["verdict"] != cr.KNOWN_UNSAFE:
            continue
        assert c["splits_options"], name
        assert c["host_marker"], name
        assert not c["reachable"], name


# --- S4: the gate passes on the shipped configuration ---------------------------

def _shipped_source_options():
    """Recompute each builder's SOURCE option count from the crafting catalog.

    Deliberately recomputed rather than read back out of the dataset metadata: a
    count the gate itself wrote down would make this test agree with whatever the
    build did.
    """
    catalog = crafting_catalog.load_catalog()
    nc = nearly_complete.build_nearly_complete(catalog)
    _, dino_inserts_source = dino._native_insert_records(catalog)
    return {
        "viktranium": viktranium.build_viktranium(catalog)["source_options"],
        "dino_inserts": dino_inserts_source,
        "nearly_complete": nc["source_options"],
        "nearly_complete_per_item": nc["per_item_source_options"],
        "seal": seal.build_seal(catalog)["source_options"],
        "green_steel": green_steel.build_green_steel(catalog)["source_options"],
        "thunder_forged": thunder_forged.build_thunder_forged(catalog)["source_options"],
    }


def test_gate_passes_on_the_built_dataset():
    """S4, against the real artifact rather than a fixture.

    Also pins that the gate actually inspected records — a green run over an empty
    pool would prove nothing.
    """
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    stats = cr.check(data, _shipped_source_options())

    assert stats["checked"] == 8
    assert stats["compared"] > 700, stats
    assert stats["records"]["viktranium"] > 0
    assert stats["records"]["dino_inserts"] > 0
    # The pool the hand-typed call-site list never handed over.
    assert stats["records"]["nearly_complete_per_item"] == 147, stats


def test_the_shipped_dataset_holds_one_record_per_option_wherever_it_claims_to():
    """Every container the registry does NOT declare a splitter is 1:1 (flat) or
    lossy-but-unsplit (atomic), measured against the live catalog."""
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    source = _shipped_source_options()

    for name, c in cr.REGISTRY.items():
        if c["derived"] or c["splits_options"]:
            continue
        records = cr._records_of(data[name])
        assert records, f"{name} carries no records to compare"
        if c["shape"] == cr.FLAT:
            assert len(records) == source[name], name
        else:
            assert len(records) <= source[name], name


def test_green_steel_and_thunder_forged_split_options_and_say_so():
    """The declaration is measured, not asserted: both pools really do split, and
    both really are unreachable. If either fact changes the gate fires."""
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    source = _shipped_source_options()

    for name in ("green_steel", "thunder_forged"):
        assert cr.REGISTRY[name]["verdict"] == cr.KNOWN_UNSAFE
        assert len(data[name]) > source[name], name
        marker = cr.REGISTRY[name]["host_marker"]
        assert not [it for it in data["items"] if it.get(marker)], name

    # The measured split, so a change in the catalog shows up as a diff here.
    assert (len(data["green_steel"]), source["green_steel"]) == (108, 81)
    assert (len(data["thunder_forged"]), source["thunder_forged"]) == (36, 35)


def test_build_metadata_discloses_the_gate_coverage():
    """`compared` is reported separately from `checked` so the disclosure is honest."""
    with open(DATASET, "r", encoding="utf-8") as fh:
        cov = json.load(fh)["metadata"]["container_registry_coverage"]

    assert cov["containers"] == cr.EXPECTED_CONTAINER_COUNT
    assert cov["checked"] == cr.EXPECTED_CONTAINER_COUNT
    assert cov["compared"] > 700, cov
    # roll_groups is the declared-unreachable one; its zero must not read as coverage.
    assert cov["records"]["roll_groups"] == 0
    assert cov["compared"] == sum(cov["records"].values())
    # The split is disclosed rather than buried in a VERIFIED_SAFE verdict.
    assert cov["records"]["green_steel"] > cov["source_options"]["green_steel"]
    assert cov["hosts"] == {"green_steel": 0, "thunder_forged": 0}
    # And every declared expansion pass left evidence it ran.
    assert cov["expanded_affixes"]["viktranium"] > 0
    assert cov["expanded_affixes"]["dino_inserts"] > 0


def test_viktranium_spell_focus_craft_is_one_option_carrying_seven_schools():
    """The defect's ground truth, asserted on the shipped data.

    Before `0833d27` this craft was seven mutually exclusive records and the slot
    took one. It must be ONE record whose affix list carries all seven schools.
    """
    with open(DATASET, "r", encoding="utf-8") as fh:
        vik = json.load(fh)["viktranium"]

    expanded = [r for r in vik
                if sum(1 for a in r.get("affixes") or [] if PROVENANCE_KEY in a) >= 7]
    assert expanded, "no Viktranium option carries an expanded universal spell-DC affix"

    schools = {a["stat"] for a in expanded[0]["affixes"] if PROVENANCE_KEY in a}
    assert len(schools) == 7, schools
    # And the fan-out signature is absent: no record-level provenance anywhere.
    assert not [r for r in vik if PROVENANCE_KEY in r]
