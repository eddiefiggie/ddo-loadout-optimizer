"""U3 (#205) — the single-pick choice-slot container registry and its build gate.

A **choice slot** admits at most one record from its pool. That is the whole
premise of the container, and it is what made the Viktranium defect so quiet: the
pool stored one record per affix, and two expansion passes fanned single
craftable options into several mutually-exclusive records. A craft that grants
seven spell schools delivered exactly one, because the slot could only take one
of the seven records the expansion had produced. Fixed for Viktranium in
`0833d27`; this module stops the class from recurring.

The defect is a **shape mismatch between a container and the passes that run over
it**, so the fix is declared at that level rather than at each call site:

  * A **FLAT** container stores one record per affix — the stat and bonus type sit
    on the record itself (`{"stat": ..., "bonus_type": ..., "value": ...}`).
    Expanding an affix here has nowhere to put the extra affixes except *alongside*
    the original, as sibling records. Since siblings in a choice slot are mutually
    exclusive, expansion across a flat container is always the bug.
  * An **ATOMIC** container stores one record per *craftable option*, carrying its
    own `affixes` list. Expansion goes one level IN, inside that list, and the
    option stays one option. This is the only shape an expansion pass may run over.

So the rule the gate enforces is a cross-product: **FLAT + any expansion pass is a
build failure.** A flat container is safe only while nothing expands over it, and
the gate is what keeps it that way — no container has to be refactored to
atomic just to be safe, which matters because several of them are currently
unreachable and refactoring unreachable code buys nothing.

Two checks give the gate teeth beyond the declaration itself, because a
declaration can drift from the code it describes:

  1. **The declared shape is verified against the real records.** A container
     declared FLAT whose records carry `affixes` (or ATOMIC whose records do not)
     fails, so the registry cannot quietly describe a container that has changed.
  2. **Record-level provenance is treated as fan-out evidence.** Every expansion
     family in this repo stamps `spell_focus.PROVENANCE_KEY` on each affix it
     emits (that uniformity is deliberate — see `2bc453e`). An affix-level `via`
     is normal and expected. A **record-level** `via` means an expander was handed
     the record LIST as if it were an affix list and fanned records into siblings
     — the Viktranium defect exactly. That is caught structurally, whatever the
     declaration says.

`reachable` closes the last hole. A container with no records today verifies
nothing, and a vacuous pass is worse than no gate at all. Declaring reachability
turns that silence into an assertion in both directions: a reachable container
that empties fails, and an UNREACHABLE container that starts carrying records
also fails — forcing the re-audit that "we'll check it when it ships" never gets.
"""
from __future__ import annotations

from src.spell_focus import PROVENANCE_KEY

# --- shapes -------------------------------------------------------------------

FLAT = "flat"        # one record per affix; stat/bonus_type on the record itself
ATOMIC = "atomic"    # one record per craftable option, carrying an `affixes` list
SHAPES = (FLAT, ATOMIC)

# --- expansion passes ---------------------------------------------------------
# Every affix-expansion family in the repo. Naming a pass that is not here is a
# typo, and a typo that silently reads as "no expansion" would hand a flat
# container a clean bill of health. Validated on every run.
EXPANSION_PASSES = (
    "spell_focus",           # src/spell_focus.py  — universal spell DC -> 7 schools
    "umbrella",              # src/umbrella.py     — Well Rounded -> 6 abilities
    "parrying_split",        # src/parrying_split.py
    "heightened_awareness",  # src/heightened_awareness.py
    "speed_split",           # src/speed_split.py
)

# --- verdicts -----------------------------------------------------------------

CORRECTED = "corrected"          # carried the defect; fixed
VERIFIED_SAFE = "verified-safe"  # audited, never carried it
VERDICTS = (CORRECTED, VERIFIED_SAFE)


def _c(shape, expansions, verdict, reachable, note):
    return {"shape": shape, "expansions": tuple(expansions), "verdict": verdict,
            "reachable": reachable, "note": note}


# Every single-pick choice-slot container in the dataset, with its audit verdict.
# Keys match the top-level dataset keys `build_dataset.build()` emits, except
# `roll_groups`, which is item-level and flattened across every variant.
REGISTRY = {
    "viktranium": _c(
        ATOMIC, ("spell_focus",), CORRECTED, True,
        "The reported defect. Was flat one-record-per-affix and expanded twice, so a "
        "seven-school craft delivered one school. Now atomic: expansion goes inside "
        "the option's own affix list (build_dataset.py, after build_viktranium)."),
    "dino_inserts": _c(
        ATOMIC, ("spell_focus",), VERIFIED_SAFE, True,
        "Already atomic — an insert has always carried its own affix list, and the "
        "spell-focus pass already expanded one level in. Never carried the defect."),
    "nearly_complete": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "Flat one-record-per-affix, and no expansion pass runs over it. Safe as long "
        "as that stays true, which is what this gate enforces."),
    "seal": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "Flat one-record-per-affix (seal_type-keyed), no expansion pass. Same treatment."),
    "green_steel": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "Flat one-record-per-affix (tier_key-keyed), no expansion pass. Same treatment."),
    "thunder_forged": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "Flat one-record-per-affix (tier-keyed), no expansion pass. Same treatment."),
    "roll_groups": _c(
        FLAT, (), VERIFIED_SAFE, False,
        "Item-level 'rolls one of' groups, flattened across every variant. Flat per "
        "option and no expansion pass reaches it: both expand_variants passes walk "
        "`affixes` and `parsed_set_bonuses` only. Declared UNREACHABLE — the affix "
        "parser can build these but no current item text produces one, so the pool is "
        "empty and verifying it would be vacuous. If it ever fills, this gate fails "
        "until someone re-audits it against a real record."),
}

# Pinned so a container added without a declaration fails rather than passing
# unnoticed. Discovery catches an undeclared container that reaches the gate; this
# catches the other direction — a declaration deleted, or a container added to the
# registry without anyone revisiting the count.
EXPECTED_CONTAINER_COUNT = 7


def describe() -> list:
    """Every declared container as `(name, shape, expansions, verdict, reachable)`."""
    return [(name, c["shape"], c["expansions"], c["verdict"], c["reachable"])
            for name, c in sorted(REGISTRY.items())]


def _validate_registry():
    """The registry must describe itself coherently before it can judge anything."""
    if not REGISTRY:
        raise SystemExit(
            "container registry is empty — refusing to report a clean fan-out gate "
            "over zero declared containers")
    if len(REGISTRY) != EXPECTED_CONTAINER_COUNT:
        raise SystemExit(
            f"container registry declares {len(REGISTRY)} containers, pinned at "
            f"{EXPECTED_CONTAINER_COUNT}. A single-pick choice-slot container was "
            f"added or removed without re-auditing it for the fan-out defect. "
            f"Audit it, declare it, then update EXPECTED_CONTAINER_COUNT.")
    for name, c in sorted(REGISTRY.items()):
        if c["shape"] not in SHAPES:
            raise SystemExit(f"{name}: unknown container shape {c['shape']!r}")
        if c["verdict"] not in VERDICTS:
            raise SystemExit(f"{name}: unknown audit verdict {c['verdict']!r}")
        unknown = [p for p in c["expansions"] if p not in EXPANSION_PASSES]
        if unknown:
            raise SystemExit(
                f"{name}: unknown expansion pass {unknown!r}. An unrecognized name "
                f"reads as 'no expansion' and would clear a flat container that is "
                f"actually being expanded. Known passes: {list(EXPANSION_PASSES)}")


def check(containers: dict) -> dict:
    """Assert no expansion pass can fan a choice-slot option into siblings.

    `containers` maps each registered name to its actual record list, so the gate
    judges the built dataset rather than the declaration alone.

    Reports `compared` separately from `checked`, and refuses to pass when it is
    zero. `checked` counts containers the gate reached a verdict on, including the
    ones declared unreachable and verified to be empty; only `compared` counts
    records whose shape was actually inspected. Counting an unreachable container's
    zero records as coverage is exactly the vacuous pass this gate exists to avoid
    — `src/parrying_split.py:check_against_snapshots` is the pattern.

    Raises `SystemExit` on any violation. Returns the coverage counts.
    """
    _validate_registry()

    if not containers:
        raise SystemExit(
            "container fan-out gate was handed no containers — refusing to report a "
            "clean gate over zero records")

    undeclared = sorted(set(containers) - set(REGISTRY))
    if undeclared:
        raise SystemExit(
            f"single-pick choice-slot container(s) not declared in "
            f"src/container_registry.py: {undeclared}. Every choice-slot pool must "
            f"declare its record shape (flat/atomic) and the expansion passes that "
            f"run over it, or the fan-out defect can recur unnoticed.")

    missing = sorted(set(REGISTRY) - set(containers))
    if missing:
        raise SystemExit(
            f"container(s) declared in src/container_registry.py but never handed to "
            f"the gate: {missing}. A declaration nothing verifies is not a gate.")

    problems = []
    checked = 0
    compared = 0
    per_container = {}

    for name, c in sorted(REGISTRY.items()):
        records = containers.get(name) or []
        checked += 1
        per_container[name] = len(records)

        # The cross-product. This is the rule; everything below is corroboration.
        if c["shape"] == FLAT and c["expansions"]:
            problems.append(
                f"{name}: FLAT container (one record per affix) with expansion "
                f"pass(es) {list(c['expansions'])} declared over it. Expanding a flat "
                f"choice-slot pool turns one craftable option into several mutually "
                f"exclusive ones, and the slot takes exactly one — so the craft "
                f"delivers a fraction of what it grants in game. Either expand inside "
                f"each record's own `affixes` list (make it ATOMIC), or do not expand "
                f"this container.")

        # Reachability, asserted in both directions.
        if c["reachable"] and not records:
            problems.append(
                f"{name}: declared reachable but carries no records — the gate would "
                f"verify nothing. Either the pool broke or the declaration is stale.")
        if not c["reachable"] and records:
            problems.append(
                f"{name}: declared UNREACHABLE but now carries {len(records)} record(s). "
                f"It was never audited against a real record. Audit it for the fan-out "
                f"defect, then flip `reachable` to True.")

        for i, rec in enumerate(records):
            compared += 1
            has_affixes = isinstance(rec, dict) and "affixes" in rec
            if c["shape"] == ATOMIC and not has_affixes:
                problems.append(
                    f"{name}[{i}]: declared ATOMIC but record carries no `affixes` "
                    f"list. An expansion pass over it would fan records into siblings.")
            elif c["shape"] == FLAT and has_affixes:
                problems.append(
                    f"{name}[{i}]: declared FLAT but record carries an `affixes` list. "
                    f"The declaration no longer describes this container.")

            # Fan-out evidence, independent of the declaration. Every expansion
            # family stamps PROVENANCE_KEY on the affixes it emits; finding it on
            # the RECORD means an expander was handed the record list as an affix
            # list and split one option into several.
            if isinstance(rec, dict) and PROVENANCE_KEY in rec:
                problems.append(
                    f"{name}[{i}]: record carries the expansion provenance key "
                    f"{PROVENANCE_KEY!r} at RECORD level (via="
                    f"{rec.get(PROVENANCE_KEY)!r}). An expansion pass ran across the "
                    f"option boundary and fanned one craftable option into several "
                    f"mutually exclusive records.")

    if problems:
        raise SystemExit(
            "single-pick choice-slot containers failed the fan-out gate:\n  " +
            "\n  ".join(problems))

    if compared == 0:
        raise SystemExit(
            "container fan-out gate inspected zero records across "
            f"{checked} container(s) — refusing to report a clean gate that verified "
            "nothing")

    return {"checked": checked, "compared": compared,
            "containers": len(REGISTRY), "records": per_container}


def collect_roll_groups(variants) -> list:
    """Flatten every item-level roll-group OPTION across all variants.

    A roll group is `{"raw": ..., "options": [...]}` on a variant; the choice slot
    picks one option, so the options are the records the gate must judge.
    """
    out = []
    for v in variants or []:
        for group in v.get("roll_groups") or []:
            out.extend(group.get("options") or [])
    return out
