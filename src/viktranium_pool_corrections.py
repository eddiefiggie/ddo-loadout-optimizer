"""#365 — curated wiki-sourced Viktranium pool relocations.

gear-planner's ``crafting.json`` is the single source of truth for affix
vocabulary, but it is not the authority on which Viktranium ``(slot_type,
category)`` pool an option belongs to — the DDO wiki's *Viktranium Experiment
crafting* page is. The page splits every slot into a base table and a **Wicked**
table, one pair per item category, and it puts ``Woeful Quality Spell Focus
Mastery`` in the **Accessories** Wicked table. gear-planner files it under
``Woeful (Weapon)`` next to its genuinely-weapon sibling ``Woeful Exceptional
Spell Focus Mastery``, which leaves ``Woeful (Accessory)`` offering spell DCs
only as Profane and Sacred. A caster who slots a Woeful *accessory* can then
never reach the +2 Quality DC the game grants them. The option is **misfiled,
not missing**, so the fix is a relocation, not a gap fill.

This mirrors ``src/ml36_augments.py`` in shape and discipline — a curated shard
under ``data/seed/compendium/`` plus a build-time guard — but moves a record
between pools instead of adding one. The move happens on the loaded catalog IN
MEMORY, immediately before ``viktranium.build_viktranium`` reads it, so there is
no second code path and the vendored snapshot under ``raw/`` is never edited.

The vocabulary that lands in the destination pool is the record that left the
source pool, verbatim: nothing is re-typed, re-valued or invented.

Guards, each of which fails the build rather than warning:

* the option is no longer in its ``from`` pool — upstream fixed the misfiling;
  **retire this shard entry** rather than leave a dead correction behind (#207);
* the option is already in its ``to`` pool — the relocation is a no-op;
* the option's affix vocabulary ``(name, type, value)`` or its ``ml`` has moved
  from what the shard recorded — upstream re-typed or re-valued it; re-verify
  against the wiki;
* a named pool is absent or is not a ``"*"`` menu pool — the catalog shape moved;
* an empty shard, or a relocation pass that moves nothing — a correction that
  corrects nothing is a broken join, not a clean pass.
"""
from __future__ import annotations

import json
import os

# The fields every relocation must carry: the move itself, the recorded
# vocabulary, and the wiki evidence that authorizes it.
REQUIRED_FIELDS = ("option", "from", "to", "ml", "affixes",
                   "wiki_table", "wiki_effect", "wiki_url", "verified")


def load(path: str) -> list:
    """The shard's relocations, `[]` when the file is absent."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("relocations") or []


def _vocab(option: dict) -> list:
    return [(a.get("name"), a.get("type"), str(a.get("value")))
            for a in (option or {}).get("affixes") or []]


def _menu(catalog: dict, key: str, rel: dict, role: str, problems: list):
    """The ``"*"`` option list of pool ``key``, or None with a problem recorded."""
    block = (catalog or {}).get(key)
    if not isinstance(block, dict) or not isinstance(block.get("*"), list):
        problems.append(
            f"{rel.get('option')!r}: the {role} pool {key!r} is absent or is not "
            "a '*' menu pool — the catalog shape moved; re-verify the relocation")
        return None
    return block["*"]


def check(relocations: list, crafting: dict) -> dict:
    """Assert every relocation against upstream and its own evidence. Offline.

    Raises SystemExit on any violation; returns ``{pool_key: moves}`` for the
    destination pools otherwise. Refuses to vouch for an empty shard.
    """
    if not relocations:
        raise ValueError(
            "Viktranium pool-correction shard is empty — refusing to report a "
            "clean guard over zero records")

    problems = []
    counts = {}
    for rel in relocations:
        name = rel.get("option")
        missing = [f for f in REQUIRED_FIELDS if not rel.get(f)]
        if missing:
            problems.append(
                f"{name!r}: relocation is missing {missing!r} — an unevidenced "
                "correction is not a correction")
            continue
        src = _menu(crafting, rel["from"], rel, "source", problems)
        dst = _menu(crafting, rel["to"], rel, "destination", problems)
        if src is None or dst is None:
            continue
        # (a) staleness: upstream fixed the misfiling — retire the shard entry.
        found = [o for o in src if (o or {}).get("name") == name]
        if not found:
            problems.append(
                f"{name!r}: no longer in the {rel['from']!r} pool — upstream "
                "fixed the misfiling; retire this shard entry rather than "
                "leaving a dead correction in the tree")
            continue
        # (b) no-op: the destination already offers it.
        if any((o or {}).get("name") == name for o in dst):
            problems.append(
                f"{name!r}: already present in the {rel['to']!r} pool — this "
                "relocation is a no-op; retire this shard entry")
            continue
        # (c) the vocabulary anchor: gear-planner still emits what we recorded.
        upstream = found[0]
        recorded_vocab = _vocab(rel)
        live_vocab = _vocab(upstream)
        if live_vocab != recorded_vocab:
            problems.append(
                f"{name!r}: affix vocabulary {live_vocab!r} in the "
                f"{rel['from']!r} pool no longer matches the recorded "
                f"{recorded_vocab!r} — upstream re-typed or re-valued the "
                "option; re-verify against the wiki")
            continue
        if upstream.get("ml") != rel["ml"]:
            problems.append(
                f"{name!r}: upstream ml {upstream.get('ml')!r} no longer matches "
                f"the recorded {rel['ml']!r} — the tier moved; re-verify "
                "against the wiki")
            continue
        counts[rel["to"]] = counts.get(rel["to"], 0) + 1

    if problems:
        raise SystemExit("Viktranium pool-correction shard guard failed:\n  "
                         + "\n  ".join(problems))
    return counts


def apply(relocations: list, crafting: dict) -> dict:
    """Move each option from its ``from`` pool to its ``to`` pool, in place.

    The record is moved verbatim — the same dict object leaves one pool's option
    list and joins the other's — so ``build_viktranium`` reads the identical
    vocabulary, ml and quests it would have read from the source pool. Returns
    the relocation coverage for the metadata block.
    """
    moved = 0
    moves = []
    for rel in relocations:
        name = rel["option"]
        src = (crafting or {}).get(rel["from"], {}).get("*")
        dst = (crafting or {}).get(rel["to"], {}).get("*")
        if not isinstance(src, list) or not isinstance(dst, list):
            raise SystemExit(
                f"{name!r}: catalog has no {rel['from']!r} -> {rel['to']!r} "
                "menu pools to relocate between — the catalog shape moved; "
                "re-verify the loader")
        keep = [o for o in src if (o or {}).get("name") != name]
        taken = [o for o in src if (o or {}).get("name") == name]
        if not taken:
            raise SystemExit(
                f"{name!r}: nothing to relocate out of {rel['from']!r} — "
                "check() should have caught this; the guard was bypassed")
        src[:] = keep
        dst.extend(taken)
        moved += len(taken)
        moves.append(f"{name} : {rel['from']} -> {rel['to']}")
    if not moved:
        raise ValueError(
            "Viktranium pool relocation moved nothing — broken join")
    return {"relocated": moved, "moves": moves}
