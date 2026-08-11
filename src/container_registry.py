"""U3 (#205) — the single-pick choice-slot container registry and its build gate.

A **choice slot** admits at most one record from its pool. That is the whole
premise of the container, and it is what made the Viktranium defect so quiet: the
pool stored one record per affix, and two expansion passes fanned single
craftable options into several mutually-exclusive records. A craft that grants
seven spell schools delivered exactly one, because the slot could only take one
of the seven records the expansion had produced. Fixed for Viktranium in
`0833d27`; this module stops the class from recurring.

**The defect is option -> record CARDINALITY, not record shape.** The first cut of
this gate modelled it as "FLAT shape plus a declared expansion pass", which is one
way the defect arises but not the defect itself. A container that turns one source
option into two records has already shipped the bug — whatever shape those two
records wear, whether or not an expansion pass is declared, and whether the split
happened in an expansion pass or at construction. Two failures that model missed:

  * a fan-out wrapped in ATOMIC shape (two records, each carrying a ONE-element
    `affixes` list) passed clean, because the declared-ATOMIC test was
    `"affixes" in rec` and a one-element list satisfies it;
  * Green Steel and Thunder-Forged split multi-affix options at construction with
    no expansion pass at all, and were both certified `VERIFIED_SAFE`.

So the rule the gate enforces is a count, taken against what the SOURCE pool
offered:

  * **FLAT** stores one record per affix — the stat and bonus type sit on the
    record itself (`{"stat": ..., "bonus_type": ..., "value": ...}`). A flat
    container is safe only while every source option carries exactly one affix, so
    `len(records) == n_source_options` is required exactly.
  * **ATOMIC** stores one record per *craftable option*, carrying its own
    `affixes` list. An option may be dropped (no affixes) but never split, so
    `len(records) <= n_source_options`.

Each builder reports its own source-option count alongside its records; the gate
refuses to judge a container whose builder reported none, so a new pool cannot
arrive countless and therefore unjudged.

The shape rules survive as corroboration, because a declaration can drift from the
code it describes:

  1. **The declared shape is verified against the real records.** A container
     declared FLAT whose records carry `affixes` (or ATOMIC whose records do not)
     fails, so the registry cannot quietly describe a container that has changed.
  2. **FLAT + any expansion pass is still a build failure.** Expanding across a
     flat pool has nowhere to put the extra affixes except alongside the original,
     as mutually-exclusive siblings.
  3. **A declared expansion pass must actually have RUN.** Every expansion family
     stamps `spell_focus.PROVENANCE_KEY` on each affix it emits (that uniformity
     is deliberate — see `2bc453e`), so a container declaring a pass must carry at
     least one stamped affix. Without this, reverting the Viktranium expansion to
     a no-op would leave the gate green and the seven schools silently gone.
  4. **Record-level provenance is treated as fan-out evidence.** An affix-level
     `via` is normal. A **record-level** `via` means an expander was handed the
     record LIST as if it were an affix list — the Viktranium defect exactly.

**Containers are discovered, not curated.** `check()` walks the built dataset
itself: every top-level key is either a declared container, or a declared
non-container carrying the reason it is not a single-pick pool. A key in neither
fails the build, and a key declared `NOT_A_POOL` that starts carrying
affix-bearing records fails too. The hand-typed call-site list this replaces was
its own hole — `nearly_complete_per_item` shipped 43 hosts and 147 records without
ever being handed to the gate, so no check, including the pinned container count,
could see it.

`reachable` closes the last hole. A container with no records today verifies
nothing, and a vacuous pass is worse than no gate at all. Declaring reachability
turns that silence into an assertion in both directions: a reachable container
that empties fails, and an UNREACHABLE container that starts carrying records
also fails — forcing the re-audit that "we'll check it when it ships" never gets.
For a pool whose records exist but which no item can reach, reachability is keyed
to the HOST marker instead (`host_marker`), because record count is the wrong
trigger: Green Steel has carried 108 records for months while no item carries
`green_steel_slot`, so a record-count trigger was already spent.
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
    "absorption_split",      # src/absorption_split.py — compound absorption -> elements
)

# --- verdicts -----------------------------------------------------------------

CORRECTED = "corrected"          # carried the defect; fixed
VERIFIED_SAFE = "verified-safe"  # audited, never carried it
KNOWN_UNSAFE = "known-unsafe"    # carries it today; held safe only by being unreachable
VERDICTS = (CORRECTED, VERIFIED_SAFE, KNOWN_UNSAFE)

# --- non-container kinds ------------------------------------------------------
# Why a top-level dataset key is not a single-pick pool. `NOT_A_POOL` is checked
# structurally (the key must not start carrying affix-bearing records);
# `GRANTS_ALL` is the semantic exemption — the records are real affix carriers,
# but every one of their affixes applies at once, so there is no Sigma <= 1
# constraint for a split to be measured against.
NOT_A_POOL = "not-a-pool"
GRANTS_ALL = "grants-all"
NON_CONTAINER_KINDS = (NOT_A_POOL, GRANTS_ALL)


def _c(shape, expansions, verdict, reachable, note, *,
       derived=False, host_marker=None, splits_options=False):
    return {"shape": shape, "expansions": tuple(expansions), "verdict": verdict,
            "reachable": reachable, "note": note, "derived": derived,
            "host_marker": host_marker, "splits_options": splits_options}


# Every single-pick choice-slot container in the dataset, with its audit verdict.
# Keys match the top-level dataset keys `build_dataset.build()` emits, except
# `roll_groups`, which is item-level and derived by the gate itself.
REGISTRY = {
    "viktranium": _c(
        ATOMIC, ("spell_focus",), CORRECTED, True,
        "The reported defect. Was flat one-record-per-affix and expanded twice, so a "
        "seven-school craft delivered one school. Now atomic: expansion goes inside "
        "the option's own affix list (build_dataset.py, after build_viktranium). "
        "289 native options -> 289 records."),
    "dino_inserts": _c(
        ATOMIC, ("spell_focus",), VERIFIED_SAFE, True,
        "Already atomic — an insert has always carried its own affix list, and the "
        "spell-focus pass already expanded one level in. Never carried the defect. "
        "Affix-less native options are dropped, so records <= source options."),
    "nearly_complete": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "The six `Nearly Complete: <category>` menus. Flat one-record-per-affix, no "
        "expansion pass, and every source option carries exactly one affix — 68 "
        "options -> 68 records, so no option is split."),
    "nearly_complete_per_item": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "The per-host `Nearly Finished` / `Almost There` pools, keyed by host name: "
        "the item gains ONE effect from its own list, so each host's list is a "
        "single-pick pool. 43 hosts, 147 source options -> 147 records, every option "
        "single-affix. Shipped un-registered and un-gated until this change — the "
        "hand-typed call-site list could not see it, and neither could the pinned "
        "container count, which counted registry entries rather than real pools."),
    "seal": _c(
        FLAT, (), VERIFIED_SAFE, True,
        "Flat one-record-per-affix (seal_type-keyed), no expansion pass, 24 source "
        "options -> 24 records: Undeath's 18 ability-stat options plus Fire's 6 "
        "unique-enchantment procs, every one single-affix. Same treatment."),
    "green_steel": _c(
        FLAT, (), KNOWN_UNSAFE, False,
        "SPLITS OPTIONS, and the solver constrains this pool Sigma <= 1 per host, so a "
        "player crafting a multi-affix Green Steel effect would be told they get one "
        "of its parts — the reported Viktranium symptom verbatim. 81 source options "
        "-> 108 records; 24 of the 81 are genuinely multi-affix (one grants Charisma "
        "Skills +22 Competence, UMD +6 Competence and Wizardry +151 Profane, "
        "flattened into three siblings). Held safe ONLY by being unreachable: no item "
        "carries `green_steel_slot` (#194). Correcting the builder to ATOMIC is a "
        "full-stack change (dataset.js, model.js, solver.js, projection.js and the "
        "exports) to a pool no player can reach and no host exists to test against, "
        "so it is declared honestly instead, with the trigger keyed to the HOST "
        "marker: the first item that carries `green_steel_slot` fails this build "
        "until the builder is made atomic.",
        host_marker="green_steel_slot", splits_options=True),
    "thunder_forged": _c(
        FLAT, (), KNOWN_UNSAFE, False,
        "SPLITS OPTIONS, same reasoning as green_steel and the same Sigma <= 1 "
        "per-tier solver constraint. 35 source options -> 36 records; 1 of the 35 is "
        "multi-affix. Held safe only by being unreachable: no item carries "
        "`thunder_forged_tiers` (#194). Trigger keyed to the HOST marker, not to "
        "record count — the pool has been full and inert for months, so a "
        "record-count trigger was already spent.",
        host_marker="thunder_forged_tiers", splits_options=True),
    "roll_groups": _c(
        FLAT, (), VERIFIED_SAFE, False,
        "Item-level 'rolls one of' groups, derived by the gate from every variant. "
        "Flat per option and no expansion pass reaches it: both expand_variants "
        "passes walk `affixes` and `parsed_set_bonuses` only. The group's own option "
        "list IS the record list, so its source-option count is derived rather than "
        "reported by a builder, and the cardinality assertion is structural. Declared "
        "UNREACHABLE — the affix parser can build these but no current item text "
        "produces one, so the pool is empty and verifying it would be vacuous. If it "
        "ever fills, this gate fails until someone re-audits it against a real record.",
        derived=True),
}

# Every top-level dataset key that is NOT a single-pick choice-slot pool, with the
# reason. Discovery fails on a key in neither table, so a new pool cannot arrive
# unjudged — and a NOT_A_POOL key that starts carrying affix-bearing records fails
# too, rather than quietly becoming an ungated pool under an exempt name.
NON_CONTAINERS = {
    "metadata": (NOT_A_POOL, "build metadata and coverage disclosures; carries no gear records"),
    "compendium": (NOT_A_POOL, "browse index (name/slot/status/wiki_url); carries no affixes"),
    "membership_set_defs": (
        NOT_A_POOL,
        "set definitions keyed by set name; the crafted choice is which SET to join, "
        "and the set's own affixes all apply once its threshold is met"),
    "augment_set_defs": (
        NOT_A_POOL, "the 21 Augment-Set defs, same shape and same reasoning as membership_set_defs"),
    "items": (
        GRANTS_ALL,
        "worn-item variants. A variant carries affixes, but equipping it grants ALL "
        "of them — there is no Sigma <= 1 over its affix list, so option -> record "
        "cardinality does not apply. Its item-LEVEL choice slots are separate "
        "containers: roll_groups (derived here), plus the augment/seal/Lamordia "
        "markers whose pools are registered above."),
    "dino_sets": (
        GRANTS_ALL,
        "Dino set-bonus definitions. A set grants all its affixes at once on reaching "
        "its piece threshold; the single-pick container is the INSERT pool "
        "(dino_inserts), which is registered."),
}

# Pinned so a container added without a declaration fails rather than passing
# unnoticed. Discovery catches an undeclared container that reaches the gate; this
# catches the other direction — a declaration deleted, or a container added to the
# registry without anyone revisiting the count.
EXPECTED_CONTAINER_COUNT = 8


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
    overlap = sorted(set(REGISTRY) & set(NON_CONTAINERS))
    if overlap:
        raise SystemExit(
            f"declared BOTH as a choice-slot container and as a non-container: "
            f"{overlap}. One key, one classification.")
    for name, (kind, reason) in sorted(NON_CONTAINERS.items()):
        if kind not in NON_CONTAINER_KINDS:
            raise SystemExit(f"{name}: unknown non-container kind {kind!r}")
        if not (reason or "").strip():
            raise SystemExit(
                f"{name}: declared a non-container with no reason. An exemption "
                f"nobody justified is how a real pool gets exempted.")
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
        if c["splits_options"] != (c["verdict"] == KNOWN_UNSAFE):
            raise SystemExit(
                f"{name}: `splits_options` and the {KNOWN_UNSAFE!r} verdict must agree. "
                f"A container that splits a source option into several mutually "
                f"exclusive records is not verified-safe, and a container declared "
                f"known-unsafe must say what is unsafe about it.")
        if c["splits_options"] and not c["host_marker"]:
            raise SystemExit(
                f"{name}: declared a known option-splitter with no `host_marker`. "
                f"Such a container is held safe only by being unreachable, so the "
                f"trigger must be keyed to the item field that makes it reachable — "
                f"a record-count trigger is already spent on a full, inert pool.")


# --- discovery ----------------------------------------------------------------

def _records_of(value) -> list:
    """A container's record list. A pool keyed by host (`{host: [records]}`) is
    flattened; the choice is per host, but every record must be judged."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        out = []
        for v in value.values():
            if isinstance(v, list):
                out.extend(v)
        return out
    return []


def _looks_like_a_choice_pool(value) -> bool:
    """True if `value` carries affix-bearing records — a list of them, or a dict of
    per-host lists. Deliberately structural: it recognizes a pool by what its
    records ARE, so a new pool cannot hide under a key declared `NOT_A_POOL`."""
    for rec in _records_of(value):
        if not isinstance(rec, dict):
            continue
        if "affixes" in rec or ("stat" in rec and "bonus_type" in rec):
            return True
    return False


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


def discover(dataset: dict) -> dict:
    """Find every single-pick choice-slot container in the built dataset.

    Walks the dataset's own top-level keys rather than accepting a curated list, so
    a pool nobody remembered to hand over cannot go unchecked. Raises on any key it
    cannot classify, and on a key declared `NOT_A_POOL` that has started carrying
    affix-bearing records. Returns `{container_name: records}`, including the
    derived `roll_groups`.
    """
    if not isinstance(dataset, dict) or not dataset:
        raise SystemExit(
            "container fan-out gate was handed no dataset — refusing to report a "
            "clean gate over zero records")
    if "items" not in dataset:
        raise SystemExit(
            "container fan-out gate was handed a dataset with no `items` — it cannot "
            "derive the item-level roll-group pool or count choice-slot hosts, so it "
            "would report a clean gate it never earned")

    undeclared, misfiled = [], []
    found = {}
    for key, value in sorted(dataset.items()):
        if key in REGISTRY:
            found[key] = _records_of(value)
            continue
        kind = (NON_CONTAINERS.get(key) or (None, None))[0]
        if kind is None:
            undeclared.append(
                f"{key} ({'affix-bearing records' if _looks_like_a_choice_pool(value) else 'shape unrecognized'})")
        elif kind == NOT_A_POOL and _looks_like_a_choice_pool(value):
            misfiled.append(key)

    if undeclared:
        raise SystemExit(
            f"top-level dataset key(s) the container gate cannot classify: "
            f"{undeclared}. Every key is either a single-pick choice-slot container "
            f"declared in src/container_registry.py REGISTRY — with its record shape, "
            f"the expansion passes over it, and its audit verdict — or a declared "
            f"NON_CONTAINER carrying the reason it is not a single-pick pool. A key "
            f"in neither is a pool nobody audited.")
    if misfiled:
        raise SystemExit(
            f"declared NOT_A_POOL but now carries affix-bearing records: {misfiled}. "
            f"If it has become a single-pick pool, register it; if its records all "
            f"apply at once, say so with GRANTS_ALL and the reason.")

    for name, c in REGISTRY.items():
        if c["derived"]:
            found[name] = collect_roll_groups(dataset.get("items"))
    return found


def _count_hosts(items, marker) -> int:
    """Variants carrying a choice-slot host marker (`green_steel_slot`, …)."""
    return sum(1 for it in items or [] if isinstance(it, dict) and it.get(marker))


def check(dataset: dict, source_options: dict) -> dict:
    """Assert no single-pick choice-slot option was split into several records.

    `dataset` is the built-dataset structure (`build_dataset.build()`'s output), so
    the gate discovers its own containers and judges the real records rather than a
    declaration or a hand-typed call-site list. `source_options` maps each
    container to the number of SOURCE options its builder read; the gate refuses to
    judge a container whose builder reported none, because record count alone
    cannot tell a split option from an honest one.

    Reports `compared` separately from `checked`, and refuses to pass when it is
    zero. `checked` counts containers the gate reached a verdict on, including the
    ones declared unreachable and verified to be empty; only `compared` counts
    records whose shape was actually inspected. Counting an unreachable container's
    zero records as coverage is exactly the vacuous pass this gate exists to avoid
    — `src/parrying_split.py:check_against_snapshots` is the pattern.

    Raises `SystemExit` on any violation. Returns the coverage counts.
    """
    _validate_registry()

    containers = discover(dataset)
    items = dataset.get("items") or []

    missing = sorted(set(REGISTRY) - set(containers))
    if missing:
        raise SystemExit(
            f"container(s) declared in src/container_registry.py but absent from the "
            f"built dataset: {missing}. A declaration nothing verifies is not a gate.")

    source_options = dict(source_options or {})
    stray = sorted(set(source_options) - set(REGISTRY))
    if stray:
        raise SystemExit(
            f"source-option count(s) reported for something that is not a declared "
            f"container: {stray}. Either the name is a typo — in which case the real "
            f"container is being judged with no count — or the pool needs declaring.")

    problems = []
    checked = 0
    compared = 0
    per_container = {}
    per_source = {}
    per_expanded = {}
    per_hosts = {}

    for name, c in sorted(REGISTRY.items()):
        records = containers.get(name) or []
        checked += 1
        per_container[name] = len(records)

        # --- option -> record cardinality. This is the rule; the rest corroborates.
        if c["derived"]:
            # The group's own option list IS the record list (collect_roll_groups
            # returns the options), so the count is derived, not reported.
            n_source = len(records)
        else:
            n_source = source_options.get(name)
        per_source[name] = n_source
        if not isinstance(n_source, int) or isinstance(n_source, bool) or n_source < 0:
            problems.append(
                f"{name}: builder reported no source-option count (got {n_source!r}). "
                f"The gate cannot tell a split option from an honest record without "
                f"knowing how many options the source pool offered, and a container "
                f"it cannot judge must not pass.")
        elif c["splits_options"]:
            # Declared to split. That is only tolerable while unreachable, and the
            # declaration must still be true — a corrected builder must not keep a
            # known-unsafe label that silences the cardinality rule for good.
            if len(records) <= n_source:
                problems.append(
                    f"{name}: declared a known option-splitter but {n_source} source "
                    f"option(s) now produce {len(records)} record(s) — it no longer "
                    f"splits. If the builder was corrected, drop `splits_options`, "
                    f"restore the {VERIFIED_SAFE!r} verdict, and let the cardinality "
                    f"rule hold it there.")
        elif c["shape"] == FLAT and len(records) != n_source:
            problems.append(
                f"{name}: FLAT container turned {n_source} source option(s) into "
                f"{len(records)} record(s). A flat pool stores one record per affix, "
                f"so a multi-affix option becomes several mutually exclusive siblings "
                f"— and the slot takes exactly one, so the craft delivers a fraction "
                f"of what it grants in game. Either store one record per OPTION "
                f"carrying its own `affixes` list (make it ATOMIC), or drop the "
                f"multi-affix options rather than splitting them.")
        elif c["shape"] == ATOMIC and len(records) > n_source:
            problems.append(
                f"{name}: ATOMIC container turned {n_source} source option(s) into "
                f"{len(records)} record(s). Atomic shape is not a licence to split: "
                f"one option must stay one record, expanded INSIDE its own `affixes` "
                f"list. Wrapping each half of a split option in a one-element "
                f"`affixes` list is the same defect in a costume — the slot still "
                f"takes exactly one.")

        # --- the cross-product rule: expanding a flat pool is always the bug.
        if c["shape"] == FLAT and c["expansions"]:
            problems.append(
                f"{name}: FLAT container (one record per affix) with expansion "
                f"pass(es) {list(c['expansions'])} declared over it. Expanding a flat "
                f"choice-slot pool turns one craftable option into several mutually "
                f"exclusive ones, and the slot takes exactly one — so the craft "
                f"delivers a fraction of what it grants in game. Either expand inside "
                f"each record's own `affixes` list (make it ATOMIC), or do not expand "
                f"this container.")

        # --- reachability, asserted in both directions.
        if c["reachable"] and not records:
            problems.append(
                f"{name}: declared reachable but carries no records — the gate would "
                f"verify nothing. Either the pool broke or the declaration is stale.")
        if not c["reachable"] and records and not c["host_marker"]:
            problems.append(
                f"{name}: declared UNREACHABLE but now carries {len(records)} record(s). "
                f"It was never audited against a real record. Audit it for the fan-out "
                f"defect, then flip `reachable` to True.")

        # --- host-keyed reachability. For a pool that is full but inert, record
        # count is the wrong trigger: it fired long ago and was spent. The live
        # trigger is the first ITEM that can reach the pool.
        if c["host_marker"]:
            hosts = _count_hosts(items, c["host_marker"])
            per_hosts[name] = hosts
            if hosts and c["splits_options"]:
                problems.append(
                    f"{name}: {hosts} item variant(s) now carry `{c['host_marker']}`, so "
                    f"this pool is REACHABLE — and it splits {per_source.get(name)} source "
                    f"option(s) into {len(records)} mutually exclusive records while the "
                    f"solver takes exactly one per host. Correct the builder to emit one "
                    f"record per option carrying its own `affixes` list, then drop "
                    f"`splits_options` and set `reachable`, before a host ships.")
            elif hosts and not c["reachable"]:
                problems.append(
                    f"{name}: {hosts} item variant(s) now carry `{c['host_marker']}` but the "
                    f"container is declared unreachable. Re-audit it against a real host, "
                    f"then flip `reachable` to True.")

        # --- a declared expansion pass must actually have run.
        expanded = 0
        for rec in records:
            if not isinstance(rec, dict):
                continue
            for aff in rec.get("affixes") or []:
                if isinstance(aff, dict) and PROVENANCE_KEY in aff:
                    expanded += 1
        per_expanded[name] = expanded
        if c["expansions"] and records and expanded == 0:
            problems.append(
                f"{name}: declares expansion pass(es) {list(c['expansions'])} but not one "
                f"of its {len(records)} record(s) carries an affix stamped "
                f"{PROVENANCE_KEY!r}. Every expansion family stamps what it emits, so a "
                f"declared pass that left no stamp did not run. Reverting the pass to a "
                f"no-op would leave this gate green and the expanded affixes silently "
                f"gone — which is the defect it was written to fix.")

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
            "containers": len(REGISTRY), "records": per_container,
            "source_options": per_source, "expanded_affixes": per_expanded,
            "hosts": per_hosts,
            "non_containers": {k: v[0] for k, v in sorted(NON_CONTAINERS.items())}}
