"""U3 (#205) — the single-pick choice-slot container registry and its fan-out gate.

The reported defect: the Viktranium pool stored one record per affix, and two
expansion passes fanned single craftable options into several mutually exclusive
records. A choice slot admits one record, so a craft granting seven spell schools
delivered one. Fixed for Viktranium in `0833d27`; these tests cover the gate that
stops the class from recurring.

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


def flat_rec(stat="Charisma", **extra):
    """A FLAT container record: the affix IS the record."""
    return {"stat": stat, "bonus_type": "Enhancement", "value": 6, "unit": "flat", **extra}


def atomic_rec(name="Dolorous Accuracy", affixes=None):
    """An ATOMIC container record: one craftable option carrying its affix list."""
    return {"name": name, "affixes": affixes if affixes is not None else [flat_rec()]}


def raises_systemexit(fn):
    try:
        fn()
    except SystemExit as exc:
        return str(exc)
    raise AssertionError("expected SystemExit, the gate passed")


# --- S1: an expansion pass wired to a flat container ---------------------------

def test_gate_raises_when_an_expansion_pass_runs_over_a_flat_container():
    """S1, the reported defect in the abstract. This is the cross-product rule."""
    with registry(seal=cr._c(cr.FLAT, ("spell_focus",), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check({"seal": [flat_rec()]}))

    assert "FLAT container" in msg
    assert "spell_focus" in msg
    assert "mutually exclusive" in msg


def test_gate_allows_the_same_expansion_pass_over_an_atomic_container():
    """The rule is about SHAPE, not about expansion being forbidden. Atomic is the fix."""
    with registry(viktranium=cr._c(cr.ATOMIC, ("spell_focus",), cr.CORRECTED, True, "")):
        stats = cr.check({"viktranium": [atomic_rec()]})

    assert stats["compared"] == 1


# --- S2: refusing to inspect nothing -------------------------------------------

def test_gate_raises_when_handed_zero_containers():
    """S2a. A gate given nothing must not report a clean run."""
    msg = raises_systemexit(lambda: cr.check({}))
    assert "no containers" in msg


def test_gate_raises_when_it_inspects_zero_records():
    """S2b, the subtler vacuous pass: containers present, every one of them empty.

    Reachability is what makes this fail rather than pass quietly — and the
    `compared == 0` backstop catches it even for a container declared unreachable.
    """
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check({"seal": []}))
    assert "declared reachable but carries no records" in msg

    with registry(roll_groups=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, False, "")):
        msg = raises_systemexit(lambda: cr.check({"roll_groups": []}))
    assert "inspected zero records" in msg
    assert "verified nothing" in msg


def test_gate_raises_on_an_empty_registry():
    """A registry declaring nothing cannot clear anything."""
    with registry():
        msg = raises_systemexit(lambda: cr.check({"seal": [flat_rec()]}))
    assert "registry is empty" in msg


# --- S3: a container the registry does not declare ------------------------------

def test_gate_raises_on_an_undeclared_container():
    """S3. A new choice-slot pool must be audited, not silently admitted."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(
            lambda: cr.check({"seal": [flat_rec()], "brand_new_pool": [flat_rec()]}))

    assert "brand_new_pool" in msg
    assert "not declared" in msg


def test_gate_raises_on_a_declaration_nothing_verifies():
    """The other direction: a declared container never handed to the gate is inert."""
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, ""),
                  ghost=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check({"seal": [flat_rec()]}))

    assert "ghost" in msg
    assert "never handed to the gate" in msg


def test_gate_raises_when_the_pinned_container_count_disagrees():
    """The count pin catches a container added to the registry without a re-audit."""
    saved, saved_count = cr.REGISTRY, cr.EXPECTED_CONTAINER_COUNT
    cr.REGISTRY = {"seal": cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")}
    cr.EXPECTED_CONTAINER_COUNT = 7
    try:
        msg = raises_systemexit(lambda: cr.check({"seal": [flat_rec()]}))
    finally:
        cr.REGISTRY, cr.EXPECTED_CONTAINER_COUNT = saved, saved_count

    assert "pinned at 7" in msg
    assert "without re-auditing" in msg


# --- the declaration cannot drift from the records ------------------------------

def test_gate_raises_when_a_flat_declaration_describes_atomic_records():
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check({"seal": [atomic_rec()]}))
    assert "declared FLAT but record carries an `affixes` list" in msg


def test_gate_raises_when_an_atomic_declaration_describes_flat_records():
    """Viktranium's pre-0833d27 state: declared atomic, still one record per affix."""
    with registry(viktranium=cr._c(cr.ATOMIC, ("spell_focus",), cr.CORRECTED, True, "")):
        msg = raises_systemexit(lambda: cr.check({"viktranium": [flat_rec()]}))
    assert "declared ATOMIC but record carries no `affixes`" in msg


def test_gate_raises_on_record_level_expansion_provenance():
    """Fan-out evidence that does not depend on the declaration being honest.

    Every expansion family stamps PROVENANCE_KEY on each affix it emits. Finding
    it on the RECORD means an expander was handed the record list as if it were an
    affix list — the Viktranium defect, caught structurally.
    """
    fanned = [flat_rec("Necromancy Focus", **{PROVENANCE_KEY: "Sacred Spell Focus Mastery"})]
    with registry(seal=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check({"seal": fanned}))

    assert "at RECORD level" in msg
    assert "fanned one craftable option into several" in msg


def test_gate_raises_when_an_unreachable_container_starts_carrying_records():
    """`roll_groups` is empty today. If it fills, it gets audited before it ships."""
    with registry(roll_groups=cr._c(cr.FLAT, (), cr.VERIFIED_SAFE, False, "")):
        msg = raises_systemexit(lambda: cr.check({"roll_groups": [flat_rec()]}))

    assert "declared UNREACHABLE but now carries 1 record" in msg


def test_gate_raises_on_an_unrecognized_expansion_pass_name():
    """A typo'd pass name must not read as 'no expansion' and clear a flat container."""
    with registry(seal=cr._c(cr.FLAT, ("spell_focuss",), cr.VERIFIED_SAFE, True, "")):
        msg = raises_systemexit(lambda: cr.check({"seal": [flat_rec()]}))
    assert "unknown expansion pass" in msg


# --- S5: the registry names every single-pick container with its verdict --------

def test_registry_declares_every_single_pick_container_with_a_verdict():
    """S5. The audit itself, as a record. Each entry is the prior research's finding."""
    expected = {
        "viktranium":      (cr.ATOMIC, ("spell_focus",), cr.CORRECTED,     True),
        "dino_inserts":    (cr.ATOMIC, ("spell_focus",), cr.VERIFIED_SAFE, True),
        "nearly_complete": (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "seal":            (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "green_steel":     (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "thunder_forged":  (cr.FLAT,   (),               cr.VERIFIED_SAFE, True),
        "roll_groups":     (cr.FLAT,   (),               cr.VERIFIED_SAFE, False),
    }
    actual = {name: (shape, exps, verdict, reachable)
              for name, shape, exps, verdict, reachable in cr.describe()}

    assert actual == expected
    assert cr.EXPECTED_CONTAINER_COUNT == len(expected)
    # Every declaration carries a rationale — the verdict alone is not the audit.
    for name, c in cr.REGISTRY.items():
        assert c["note"].strip(), f"{name} declares no rationale"


def test_no_flat_container_has_an_expansion_pass_declared():
    """The shipped configuration satisfies the cross-product rule."""
    offenders = [n for n, c in cr.REGISTRY.items()
                 if c["shape"] == cr.FLAT and c["expansions"]]
    assert offenders == []


# --- S4: the gate passes on the shipped configuration ---------------------------

def test_gate_passes_on_the_built_dataset():
    """S4, against the real artifact rather than a fixture.

    Also pins that the gate actually inspected records — a green run over an empty
    pool would prove nothing.
    """
    with open(DATASET, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    containers = {name: (data.get(name) or []) for name in cr.REGISTRY}
    containers["roll_groups"] = cr.collect_roll_groups(data["items"])

    stats = cr.check(containers)

    assert stats["checked"] == 7
    assert stats["compared"] > 500, stats
    assert stats["records"]["viktranium"] > 0
    assert stats["records"]["dino_inserts"] > 0


def test_build_metadata_discloses_the_gate_coverage():
    """`compared` is reported separately from `checked` so the disclosure is honest."""
    with open(DATASET, "r", encoding="utf-8") as fh:
        cov = json.load(fh)["metadata"]["container_registry_coverage"]

    assert cov["containers"] == cr.EXPECTED_CONTAINER_COUNT
    assert cov["checked"] == cr.EXPECTED_CONTAINER_COUNT
    assert cov["compared"] > 500, cov
    # roll_groups is the declared-unreachable one; its zero must not read as coverage.
    assert cov["records"]["roll_groups"] == 0
    assert cov["compared"] == sum(cov["records"].values())


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
