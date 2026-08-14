"""U2 — Augment-Set attach. Wires the 21 "Set Augment: X" Colorless augment
variants into the solve.

The augment pool (src.crafting_catalog.augment_pool_records) surfaces each Set
Augment as a category "augment" variant named ``Set Augment: <SetName>`` with an
EMPTY affix list (its sole in-game effect is a 3-piece Set Bonus, carried by the
augment-set defs, not an always-on stat). Because the affix list is empty, the
verification gate (src.verify) quarantines these variants, and the JS solver
rejects any non-"verified" variant — so today they never enter the solve.

This module stamps each such variant with its set linkage — the canonical set
name (``set``), the piece threshold (``pieces_required``, from the def), and a
source-family marker (``set_augment: True``) — and flips it to
``verification: "verified"``. Like the Dinosaur-Bone blanks, it MUST run AFTER
src.verify.apply so the flip-to-verified is not undone by the empty-affix
quarantine. A Set Augment whose def failed validation (excluded from ``defs``) is
left quarantined — never force-verified with no backing bonus (exclude-until-
verified). The solver wiring that reads ``set`` + the top-level
``augment_set_defs`` (bounded 0..3 duplicate placement, host-set suppression) is
a later unit.
"""
from src import membership

# Native pool name prefix (src.crafting_catalog surfaces each Set Augment as
# ``Set Augment: <canonical set name>``). The remainder IS the augment-set def key
# and the raw crafting ``set`` field, so it is the join key onto the defs.
SET_AUGMENT_PREFIX = "Set Augment: "

# #316 — key forwarded from the variant onto its def: the baked wiki color
# matrix (stamped by build_dataset via src.colors.fits_slots). web/solver.js
# reads this key off the EMITTED DEF, because the copy family iterates the defs
# — the stat-less variant that natively carries the matrix is dominance-pruned
# out of the augment pool the solver receives. The two sites must agree on this
# exact string.
FITS_SLOTS_KEY = "fits_slots"

# Every Set Augment fires at exactly 3 Pieces Equipped; the value is read from the
# resolved def tier (single source of truth) rather than hardcoded here.


def is_set_augment(v: dict) -> bool:
    """True for a native "Set Augment: X" augment variant."""
    return (v.get("category") == "augment"
            and str(v.get("source_item") or v.get("variant_id") or "")
            .startswith(SET_AUGMENT_PREFIX))


def set_name_of(v: dict) -> str:
    """The canonical set name a Set Augment variant belongs to (its name minus the
    ``Set Augment: `` prefix), or "" when the variant is not a Set Augment."""
    name = str(v.get("source_item") or v.get("variant_id") or "")
    if not name.startswith(SET_AUGMENT_PREFIX):
        return ""
    return name[len(SET_AUGMENT_PREFIX):].strip()


def attach_augment_set_slots(variants, defs: dict = None) -> int:
    """In place: stamp every "Set Augment: X" augment variant whose set resolves to
    an augment-set def, and flip it verified so it enters the solve. Returns the
    count stamped.

    Stamps, per matched variant:
      - ``set``             : the canonical set name (also the def key)
      - ``pieces_required`` : the def's single-tier threshold (always 3)
      - ``set_augment``     : True (source-family marker the solver keys off)
      - ``verification``    : "verified" (un-quarantines the empty-affix variant)

    MUST run AFTER src.verify.apply (mirrors the Dino-blank pattern): a Set Augment
    carries no base affixes, so passing back through verify would re-quarantine it.
    A set whose def failed validation (absent from ``defs``) is left quarantined —
    never force-verified with no bonus.
    """
    if defs is None:
        defs = membership.build_augment_set_defs()
    n = 0
    for v in variants:
        if not is_set_augment(v):
            continue
        set_name = set_name_of(v)
        d = defs.get(set_name)
        if d is None:
            continue  # def failed validation -> leave quarantined (no phantom bonus)
        v["set"] = set_name
        v["pieces_required"] = d["tiers"][0]["pieces_required"]
        v["set_augment"] = True
        v["verification"] = "verified"
        # #316 — forward the variant's baked color matrix onto the def. This is
        # the only route the matrix reaches the placement encoder; a def left
        # without it hosts no copies (fail-closed), and the build guard below
        # turns that state into a build failure rather than a silent solve gap.
        fits = v.get(FITS_SLOTS_KEY) or []
        if fits:
            d[FITS_SLOTS_KEY] = sorted(fits)
        n += 1
    return n


def assert_def_matrix_join(defs: dict, variants=None) -> int:
    """#316 fail-closed build guard: every emitted augment-set def must carry the
    color matrix forwarded from its ``Set Augment: <name>`` variant by
    attach_augment_set_slots. A def with no matrix silently hosts no copies —
    a regression from Colorless-only placement — so join drift is a build
    failure, not a runtime branch. Refuses to inspect nothing (a zero-def walk
    is byte-identical to a clean run) and returns the count actually compared.

    Pass ``variants`` when available so the failure names the right seam: a
    matrix-less def can mean the variant never joined (join drift) OR that the
    variant joined but carried an empty matrix (color annotation failed
    upstream, e.g. aug_color unset by a pool-key rename) — two different
    subsystems to debug during a blocked build.
    """
    if not defs:
        raise SystemExit(
            "augment-set def/matrix join guard walked ZERO defs — the channel "
            "is empty or was not built (vacuous pass refused)")
    missing = sorted(n for n, d in defs.items() if not d.get(FITS_SLOTS_KEY))
    if missing:
        joined = None
        if variants is not None:
            joined = {set_name_of(v) for v in variants if is_set_augment(v)}

        def _why(n):
            if joined is None:
                return n
            if n not in joined:
                return f"{n} — no matching 'Set Augment: {n}' variant (join drift)"
            return (f"{n} — variant joined but forwarded no {FITS_SLOTS_KEY} "
                    "(color annotation failed upstream, e.g. aug_color unset)")
        raise SystemExit(
            "augment-set defs missing the baked color matrix:\n  "
            + "\n  ".join(_why(n) for n in missing))
    return len(defs)
