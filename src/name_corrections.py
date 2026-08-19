"""#227 — wiki-sourced corrections to a gear-planner affix NAME.

gear-planner is the single source of truth for *which* affixes an item has, read
structurally. The DDO Wiki is the source of truth for what the enchantment is
*called*. When gear-planner stores a shortened or divergent name, the wiki wins
and the pipeline mints the wiki's name as the native one.

This is the name-level sibling of `value_corrections` and deliberately a separate
mechanism. `value_corrections` is keyed by item and rewrites one `(name, type)`
pair's value on that item; a name correction is global — every occurrence of the
affix becomes the corrected name, on every item that carries it. Folding a
dataset-wide rename into a per-item value overlay would give one module two
different scopes.

Renaming rather than aliasing is what makes the correction work. The picker
canonicalizes a typed name through `affix_aliases.json`, but the solver matches
item affixes by `a.name`. A canonical name no item carries is a priority that
scores zero, so the canonical must be native. This is the shape already used for
`Movement Speed`, `Physical Sheltering`, and `Armor-Piercing`: mint the real name
in the pipeline, then alias the variant on top so both resolve.

**Two guards, because a rename can rot in two directions.**

- The source name must still be present. When gear-planner stops emitting `Ki`,
  this correction is a silent no-op pinning a rename nobody is applying, and the
  build should say so rather than pass.
- The canonical name must NOT already be present natively. If gear-planner later
  emits `Enhanced Ki` itself, renaming `Ki` on top of it either merges two affixes
  the source considered distinct or masks that the correction is now redundant.
  Either way a human should look before the build proceeds.
"""
from __future__ import annotations

import json
import os


def load(path: str) -> list:
    """The `corrections` list, with `_*` meta keys ignored.

    A missing file yields `[]` — the overlay is optional and the build stays
    deterministic without it.
    """
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, dict):
        return []
    entries = raw.get("corrections") or []
    return [e for e in entries if isinstance(e, dict)]


def _iter_affix_dicts(obj):
    """Yield every affix dict — a member of an ``affixes`` list — anywhere in a
    structure.

    Looser than `vocabulary.iter_affixes`, which requires `name`, `type`, and
    `value` together and therefore cannot see an untyped affix at all: the exact
    blindness that hid this enchantment. But scoped by CONTAINER rather than by
    key shape, because an item record also carries a `name`. A rename matching on
    `name` alone would rewrite the 8,188 item names alongside the affixes, so a
    correction whose source collides with an item name (`Speed`, `Deadly`,
    `Power` are all plausible DDO item names) would silently rename items. It
    would also make the collision guard misfire, failing the build with the wrong
    diagnosis when an ITEM happened to be named like the canonical affix.
    """
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "affixes" and isinstance(value, list):
                for a in value:
                    if isinstance(a, dict) and "name" in a:
                        yield a
            else:
                yield from _iter_affix_dicts(value)
    elif isinstance(obj, list):
        for v in obj:
            yield from _iter_affix_dicts(v)


def apply(records: list, corrections: list) -> dict:
    """Rename corrected affix names in place. Returns a coverage dict.

    Raises `SystemExit` when a correction's source name is absent from the
    records, or when its canonical name is already present natively. Both mean
    the upstream data moved and the correction must be re-verified against the
    wiki rather than reapplied on faith.
    """
    if not corrections:
        return {"names_corrected": 0, "affixes_renamed": 0}

    # A rename must not inspect zero records — an empty roster would let every
    # correction report "source absent" and fail for the wrong reason, or (worse,
    # if the check were inverted) pass vacuously.
    if not records:
        raise SystemExit(
            "affix name corrections cannot be applied to an empty record set")

    affixes = list(_iter_affix_dicts(records))
    present = {a.get("name") for a in affixes}

    problems = []
    for corr in corrections:
        source = corr.get("source_name")
        canonical = corr.get("canonical_name")
        if not source or not canonical:
            problems.append(
                f"malformed correction {corr!r}: both source_name and "
                "canonical_name are required")
            continue
        # #376 — a per-channel miss is EXPECTED once this family has more than one
        # channel: an augment-pool name is absent from the item roster by design,
        # and vice versa. Staleness is "reached no channel at all", which
        # `assert_all_reached` decides after every channel has run — the same
        # split `type_corrections` already uses. Failing here would make the
        # augment channel impossible to add.
        if source not in present:
            continue
        if canonical in present:
            problems.append(
                f"{canonical!r} is already a native gear-planner name, so "
                f"renaming {source!r} onto it would merge two affixes upstream "
                "keeps distinct — adjudicate before reapplying")

    if problems:
        raise SystemExit(
            "affix name corrections are stale — the upstream data moved:\n  "
            + "\n  ".join(problems))

    rename = {c["source_name"]: c["canonical_name"] for c in corrections}
    renamed = 0
    hit_names = set()
    for a in affixes:
        target = rename.get(a.get("name"))
        if target is not None:
            hit_names.add(a["name"])
            a["name"] = target
            renamed += 1

    return {"names_corrected": len(rename), "affixes_renamed": renamed,
            "hit_names": sorted(hit_names)}


def is_pending(corr: dict) -> bool:
    """True for an entry declared AHEAD of the upstream data that arms it.

    #374 — the canon-defence entries are written one unit before the refreshed
    gear-planner snapshot is vendored, so their source names do not exist in the
    raw files yet. Such an entry reaches no channel by construction, and
    ``assert_all_reached`` would fail the build on a correction that is right and
    simply early. Marking it exempts it from the staleness guard; the exemption
    is not a hole because ``assert_canon_defense`` fails the moment the entry is
    actually armed and the marker has not been retired.
    """
    return bool(corr.get("pending_upstream"))


def assert_all_reached(corrections: list, *coverages) -> None:
    """Fail the build when a correction reached no record in ANY channel.

    #376 — the per-channel silent no-op is correct (an augment-pool name is
    absent from the item roster by design), but an entry absent from every
    channel means the source was renamed or dropped upstream, which is exactly
    the quiet staleness this family exists to prevent. Mirrors
    ``type_corrections.assert_all_reached``; call once, after every channel.

    #374 — ``pending_upstream`` entries are exempt (see ``is_pending``) and must
    carry a ``pending_reason``, so the exemption is always readable next to the
    entry rather than inferred from a bare boolean.
    """
    unexplained = [c["source_name"] for c in corrections
                   if is_pending(c) and not (c.get("pending_reason") or "").strip()]
    if unexplained:
        raise SystemExit(
            "affix name correction(s) marked pending_upstream without a "
            "pending_reason: " + ", ".join(sorted(repr(m) for m in unexplained))
            + " — an exemption with no stated reason cannot be retired by review")

    reached = set()
    for cov in coverages:
        reached.update((cov or {}).get("hit_names") or [])
    missing = {c["source_name"] for c in corrections
               if not is_pending(c)} - reached
    if missing:
        raise SystemExit(
            "affix name correction(s) reached no record in any channel: "
            + ", ".join(sorted(repr(m) for m in missing))
            + " — renamed or dropped upstream; re-verify against the wiki")


def assert_canon_defense(corrections: list, armed: dict) -> None:
    """KTD3 — the declared canon defence must equal what the raw data has ARMED.

    ``armed`` is ``vocabulary.armed_canon_variants()``: the aliases for which
    upstream now emits the variant and no longer emits our canonical, derived from
    the snapshot on disk rather than hand-listed. The declared side is every
    ``canon_defense`` correction whose ``pending_upstream`` marker has been
    retired — i.e. every defence claiming to be live right now.

    Both directions fail, and each names a different real defect:

      * armed but not declared-live — upstream flipped a name nothing renames
        back, so the stat silently scores zero on one channel and the picker alias
        points at a name the frozen registry cannot contain. This is the
        "a fourteenth arrived" event a hand-list would miss.
      * declared-live but not armed — the defence is inert: either upstream never
        flipped (or reverted) that name, or the entry landed and still carries a
        marker that says it has not.
    """
    declared = {c["source_name"] for c in corrections
                if c.get("canon_defense") and not is_pending(c)}
    live = set(armed)
    problems = []
    for variant in sorted(live - declared):
        problems.append(
            f"{variant!r} is ARMED upstream (canonical {armed[variant]!r} has left "
            "the raw registry) but no live canon_defense correction renames it — "
            "the canon would import as upstream's spelling and score zero")
    for variant in sorted(declared - live):
        problems.append(
            f"{variant!r} declares a live canon_defense but the raw data does not "
            "arm it — upstream still carries our canonical, so the rename is inert; "
            "re-verify, or restore its pending_upstream marker")
    if problems:
        raise SystemExit(
            "canon defence does not match the raw snapshot (KTD3):\n  "
            + "\n  ".join(problems))
