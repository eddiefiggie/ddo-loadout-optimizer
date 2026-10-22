"""Junk affix names: an upstream parse artifact the build refuses to ship.

gear-planner `f202487` (2026-10-22, held in #933) was measured with a scratch
build against `main`. Its parse had broken on a wiki template migration and
emitted two kinds of affix that are not effects at all:

  * a **bare dice expression** as the whole name: `{"name": "7d6", "type":
    "Bool"}`. 457 such affixes on 312 items in `items.json`, and 170 more in
    `crafting.json` (Red Augment Slot, Dolorous, Prison Break and other pools).
    The dice belonged to a damage line whose effect name the parse lost.
  * a sentence ending `??`: `This is working as intended??` on Colethenis's Belt
    and Ring of the Ravager. Text an editor left on the page, read as an effect.

Both arrived `eligible: true`. They come from templates no harvest mapper reads
(#907), so gear-planner's record passes straight through and nothing else
stops them.

The match is deliberately narrow. Dice inside a longer name are real and
shipped today: `Venomed Ammunition - 1d6`, `Burning Ammunition - 1d8`,
`On each hit, deals 10d6 extra Law damage ...`. Only a name that is NOTHING but
a dice expression is junk, because it names no effect.

This sweeps the ASSEMBLED dataset, not the vendored files, so it catches junk
from any source (upstream, the wiki supplement, our own harvest mappers) and
does not hold a re-vendor for junk the harvest overlay already replaced. It
reads both affix shapes: the in-memory pipeline's `{stat, bonus_type}` and the
at-rest `{name, type}`. A sweep keyed on one shape reads nothing in the other
and cannot fail (see `tier_rename._name_type`).
"""
from __future__ import annotations

import re

#: A name that is nothing but a dice expression, e.g. `7d6` or `13d10`.
DICE_ONLY = re.compile(r"\d+d\d+")

#: The shipped dataset carries tens of thousands of affixes. A sweep that finds
#: fewer than this read the wrong shape or the wrong keys.
MIN_INSPECTED = 1000


def junk_reason(name) -> str | None:
    """Why `name` is junk, or None when it is a plausible effect name."""
    if not isinstance(name, str):
        return None
    s = name.strip()
    if DICE_ONLY.fullmatch(s):
        return "a bare dice expression, not an effect"
    if "??" in s:
        return "contains '??', editor text rather than an effect"
    return None


def _affix_name(o: dict):
    """The affix name of `o` in either shape, or None when `o` is not an affix."""
    if "stat" in o and "bonus_type" in o:
        return o["stat"]
    if "name" in o and "type" in o and "value" in o:
        return o["name"]
    return None


def _walk(o, path, found):
    if isinstance(o, dict):
        name = _affix_name(o)
        if name is not None:
            found.append((path, name))
        for k, v in o.items():
            _walk(v, f"{path}.{k}", found)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            label = v.get("variant_id") or v.get("source_item") if isinstance(v, dict) else None
            _walk(v, f"{path}[{label!r}]" if label else f"{path}[{i}]", found)


def sweep(out: dict) -> list:
    """`(path, name)` for every affix in every section of `out` except metadata."""
    found = []
    for key, section in out.items():
        if key != "metadata":
            _walk(section, key, found)
    return found


def check(out: dict, min_inspected: int = MIN_INSPECTED) -> dict:
    """Raise on any junk affix name; return the coverage stamp otherwise."""
    affixes = sweep(out)
    if len(affixes) < min_inspected:
        raise SystemExit(
            f"junk-affix guard inspected only {len(affixes)} affixes (expected at "
            f"least {min_inspected}). It is reading the wrong shape or keys, and a "
            "sweep over nothing cannot fail.")
    junk = [(p, n, r) for p, n in affixes if (r := junk_reason(n))]
    if junk:
        lines = [f"{p}: {n!r} ({r})" for p, n, r in junk[:40]]
        more = f"\n  ... and {len(junk) - 40} more" if len(junk) > 40 else ""
        raise SystemExit(
            f"junk-affix guard failed: {len(junk)} affix name(s) are parse "
            "artifacts, not effects. Usually an upstream parse regression; hold the "
            "re-vendor (#933) rather than ship them:\n  " + "\n  ".join(lines) + more)
    return {"inspected": len(affixes), "junk": 0}
