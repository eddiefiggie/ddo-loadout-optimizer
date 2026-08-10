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
    """Yield every dict carrying a `name` key anywhere in a raw structure.

    Deliberately looser than `vocabulary.iter_affixes`, which requires `name`,
    `type`, and `value` together and therefore cannot see an untyped affix at all
    — the exact blindness that hid this affix. A rename must reach the records
    that gate misses, so it matches on `name` alone and lets the caller scope
    which structures it walks.
    """
    if isinstance(obj, dict):
        if "name" in obj:
            yield obj
        for v in obj.values():
            yield from _iter_affix_dicts(v)
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
        if source not in present:
            problems.append(
                f"{source!r} is no longer present upstream, so the rename to "
                f"{canonical!r} is a silent no-op — re-verify against the wiki "
                "and drop the entry if gear-planner fixed it")
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
    for a in affixes:
        target = rename.get(a.get("name"))
        if target is not None:
            a["name"] = target
            renamed += 1

    return {"names_corrected": len(rename), "affixes_renamed": renamed}
