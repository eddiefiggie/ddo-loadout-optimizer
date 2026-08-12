"""#260 — the wiki-sourced ML36 augment tier, injected into the color pools.

gear-planner's ``crafting.json`` tops out at ML32 in every augment color pool
(verified against upstream master, 2026-08-12), but the wiki's
*Category:Minimum level 36 augments* holds the 63 top-tier sale augments — the
Diamond ability/skill line (+15/+22), the Ruby spell powers (166) and damage
dice (10d6), the Sapphire defenses, the Topaz resistances (50). Without them
every ML36 solve slots one tier low on the most-slotted augments in the game.

The shard (``data/seed/compendium/ml36_augments.json``) is a gap fill, not a
parallel vocabulary: each entry's affix ``(name, type)`` is **anchored to its
highest gear-planner sibling** in the same color pool and asserted against it
at build time, so the emitted records speak exactly the vocabulary the pool
already speaks (``Sapphire of Protection`` emits ``Armor Class``/``Deflection``
like its +11 sibling; the wiki's "Protection bonus" wording *is* the
Deflection bonus that 169 worn affixes already carry). Only the value is new,
and it must appear verbatim in the entry's own recorded tooltip.

Injection happens on the loaded catalog IN MEMORY, before
``crafting_catalog.augment_pool_records`` reads it, so color normalization,
``fits_slots`` expansion, and per-affix verification treat the new records
exactly like natives — no second code path.

Guards, each of which fails the build rather than warning:

* an entry whose name already exists upstream — gear-planner added the tier;
  retire the shard rather than shipping a duplicate (the #207 staleness rule);
* an entry whose sibling vanished or whose sibling's affix vocabulary moved —
  the anchor is broken and the entry must be re-verified;
* an entry whose value token is absent from its own tooltip — the evidence no
  longer supports the number;
* an empty shard, or one that injects nothing — a gap fill that fills nothing
  is a broken join, not a clean pass.
"""
from __future__ import annotations

import json
import os
import re

# The value token an entry's own NAME carries — "(10d6)" names dice, everything
# else names a flat magnitude. Mirrors how the generation derived the values,
# so the guard re-derives rather than trusting the stored number.
_DICE = re.compile(r"\((\d+)d\d+\)\s*$")
_FLAT = re.compile(r"\+?(\d+)%?\s*$")


def load(path: str) -> dict:
    """The shard's harvested entries, `{}` when the file is absent."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("harvested") or {}


def _value_token(name: str):
    m = _DICE.search(name)
    if m:
        return m.group(1), f"{m.group(1)}d6"
    m = _FLAT.search(name)
    return (m.group(1), m.group(1)) if m else (None, None)


def check(entries: dict, crafting: dict) -> dict:
    """Assert every entry against upstream and its own evidence. Offline.

    Raises SystemExit on any violation; returns per-color counts otherwise.
    Refuses to vouch for an empty shard.
    """
    if not entries:
        raise ValueError(
            "ML36 augment shard is empty — refusing to report a clean guard "
            "over zero records")

    pools = {}
    for slot, block in (crafting or {}).items():
        if "Augment Slot" not in slot:
            continue
        color = slot.split()[0]
        for rec in (block or {}).get("*") or []:
            if isinstance(rec, dict):
                pools.setdefault(color, {})[rec.get("name")] = rec

    problems = []
    counts = {}
    for name, e in sorted(entries.items()):
        pool = pools.get(e.get("color")) or {}
        # (a) staleness: upstream grew the tier — retire the shard entry.
        if name in pool:
            problems.append(
                f"{name}: now exists in gear-planner's {e.get('color')} pool — "
                "upstream added the ML36 tier; retire this shard entry")
            continue
        # (b) the sibling anchor: present, same vocabulary.
        sibling = pool.get(e.get("sibling"))
        if sibling is None:
            problems.append(
                f"{name}: sibling {e.get('sibling')!r} is gone from the "
                f"{e.get('color')} pool — the vocabulary anchor is broken; re-verify")
            continue
        sib_vocab = [(a.get("name"), a.get("type")) for a in sibling.get("affixes") or []]
        own_vocab = [(a.get("name"), a.get("type")) for a in e.get("affixes") or []]
        if sib_vocab != own_vocab:
            problems.append(
                f"{name}: affix vocabulary {own_vocab!r} no longer matches its "
                f"sibling's {sib_vocab!r} — upstream re-typed the family; re-verify")
            continue
        # (c) the evidence: the value is derived from the entry's own name and
        # must appear verbatim in its recorded tooltip.
        value, token = _value_token(name)
        if value is None or token not in (e.get("tooltip") or ""):
            problems.append(
                f"{name}: value token {token!r} is not in the recorded tooltip — "
                "the evidence does not support the number")
            continue
        if any(str(a.get("value")) != value for a in e.get("affixes") or []):
            problems.append(
                f"{name}: stored affix value disagrees with the name's own token "
                f"{value!r}")
            continue
        counts[e["color"]] = counts.get(e["color"], 0) + 1

    if problems:
        raise SystemExit("ML36 augment shard guard failed:\n  "
                         + "\n  ".join(problems))
    return counts


def inject(entries: dict, crafting: dict) -> dict:
    """Append the shard's records to the loaded catalog's color pools, in place.

    Records are emitted in the pools' native shape ({name, ml, affixes}), so
    everything downstream of ``augment_pool_records`` treats them as natives.
    Returns the injection coverage for the metadata block.
    """
    injected = 0
    per_color = {}
    for name, e in sorted(entries.items()):
        slot_key = f"{e['color']} Augment Slot"
        block = (crafting or {}).get(slot_key)
        if not isinstance(block, dict) or not isinstance(block.get("*"), list):
            raise SystemExit(
                f"{name}: catalog has no {slot_key!r} pool to inject into — "
                "the catalog shape moved; re-verify the loader")
        block["*"].append({
            "name": name,
            "ml": e["ml"],
            "affixes": [dict(a) for a in e["affixes"]],
            "quests": ["Vendor / loot (wiki: unbound sale augment)"],
        })
        injected += 1
        per_color[e["color"]] = per_color.get(e["color"], 0) + 1
    if not injected:
        raise ValueError("ML36 augment injection touched nothing — broken join")
    return {"injected": injected, "per_color": per_color}
