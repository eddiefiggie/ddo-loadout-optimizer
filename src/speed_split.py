"""U3 (#154) — split the folded `Speed` affix back into the two game mechanics.

Upstream gear-planner folds `Striding` into `Speed` (its `affix-synonyms.json`),
but DDO has two distinct enchantments here:

  * `{{Striding|N}}`   -> `+N%` movement speed, nothing else.
  * `{{Speed|MAG}}`    -> movement speed AND melee/ranged attack speed.

The fold dropped the attack-speed half, and — for the Roman-numeral form —
corrupted the movement value too: gear-planner converts `{{Speed|XI}}` to the
integer 11 and stores it as if it were a movement percentage, when the argument
is a RANK meaning 30% movement (5*11, capped) plus 11% attack speed.

This module rewrites those affixes from the wiki-harvested shard, at the
planner-record seam so that everything downstream — variant expansion, the
rankable-affix vocabulary, the solver, browse, and the exports — inherits one
corrected affix block rather than each re-deriving it.

Three outcomes, driven entirely by what the wiki states (see
`docs/wiki-evidence/speed-and-alacrity.md`):

  * `stated` + no alacrity keys -> a Striding item. Rename only.
  * `stated` + alacrity keys    -> a Speed item. Rename, correct the movement
    value, and add the alacrity affixes.
  * `defaulted` / `unsourced`   -> `Template:Speed` renders 5% for any magnitude
    nobody recorded, so a 5% reading is not evidence of a 5% bonus. Rename and
    keep the movement bonus; grant NO alacrity.
"""
from __future__ import annotations

import urllib.parse

# The folded upstream name, and what it actually means.
FOLDED_NAME = "Speed"
MOVEMENT_NAME = "Movement Speed"
MELEE_NAME = "Melee Alacrity"
RANGED_NAME = "Ranged Alacrity"

# `Speed` is not a stat — in game it names an enchantment granting three of them.
# Offering it as a rankable priority guarantees a partial score against what the
# player meant, which is exactly the confusion #154 was reported as. The picker
# drops it and redirects here (metadata.expanded_away_names).
EXPANDED_AWAY = {FOLDED_NAME.lower(): [MOVEMENT_NAME, MELEE_NAME, RANGED_NAME]}

_ALACRITY_KEYS = (("melee", MELEE_NAME), ("ranged", RANGED_NAME))


def title_for(url: str) -> str:
    """`/page/Item:Ash_Boots` -> `Item:Ash Boots` (the shard's key)."""
    return urllib.parse.unquote((url or "").replace("/page/", "")).replace("_", " ")


def _bonus_type(affix: dict) -> str:
    # Every observed Striding/Speed affix is Enhancement-typed upstream; preserve
    # whatever the record carries rather than hardcoding, so a future retype rides.
    return affix.get("type") or "Enhancement"


def apply_to_augments(records) -> dict:
    """Rename the folded `Speed` affix on AUGMENT records (no shard lookup).

    Augments have no item page, so they are not in the harvest shard — but the
    wiki's own augment table (`Raw data/Item augments`, the page gear-planner
    scrapes) states the effect for every augment carrying this affix, and in
    every case it is **Striding**, i.e. movement only:

        Topaz of Striding 10/20/30%   -> "Striding +N%"
        Sapphire of Snowpeaks Speed   -> "Striding +30%"
        Topaz of Swiftness 5/10/15%   -> "Striding +30%" (+ Melee Alacrity, which
                                          upstream already carries separately)

    So this is a pure rename with no alacrity ever added — doing otherwise would
    double-count the Swiftness family's existing Melee Alacrity. Without this pass
    the augments would keep the old name and stop matching a `Movement Speed`
    target that their host items now satisfy: a rename that reached items but not
    augments would be worse than no rename at all.
    """
    stats = {"renamed": 0}
    for rec in records or []:
        for affix in rec.get("affixes") or []:
            if affix.get("name") == FOLDED_NAME:
                affix["name"] = MOVEMENT_NAME
                stats["renamed"] += 1
    return stats


def audit_shard(shard: dict) -> dict:
    """Report `unsourced` entries as harvest suspects rather than accepting them.

    An `unsourced` reading claims the page carries no Striding/Speed template.
    That is sometimes true and sometimes a miss: `Item:Belt of the Ram` sat
    `unsourced` through a whole harvest cycle while its page plainly renders
    `Speed +15%`, and `harvest-method.md` had recorded the correct reading the
    entire time. Nothing compared the two, so nothing noticed.

    Raises on an empty shard. A check that inspects nothing passes
    unconditionally and is indistinguishable from a clean run — the failure
    mode `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`
    exists to prevent.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "speed shard is empty — refusing to report a clean audit over zero records")

    suspects = sorted(title for title, entry in harvested.items()
                      if (entry or {}).get("provenance") == "unsourced")
    return {"inspected": len(harvested), "unsourced": len(suspects), "titles": suspects}


def apply(records, shard: dict) -> dict:
    """Rewrite the folded `Speed` affix on every record the shard covers, in place.

    Returns coverage stats. Records with no `Speed` affix are untouched, as are
    records absent from the shard (they keep the folded affix — the coverage gate
    is what makes that state visible rather than silent).
    """
    harvested = (shard or {}).get("harvested") or {}
    stats = {"renamed": 0, "movement_corrected": 0, "melee_added": 0,
             "ranged_added": 0, "quarantined": 0, "uncovered": 0}

    for rec in records or []:
        affixes = rec.get("affixes") or []
        folded = [a for a in affixes if a.get("name") == FOLDED_NAME]
        if not folded:
            continue

        entry = harvested.get(title_for(rec.get("url")))
        if entry is None:
            stats["uncovered"] += 1
            continue

        value = entry.get("value") or {}
        eligible = entry.get("provenance") == "stated"
        # Names the item already carries explicitly win — never shadow an upstream
        # affix (Jorgundal's Collar and the Mithral Full Plate Striding version both
        # carry Melee Alacrity natively). Same anti-double-count rule the
        # gap-correction overlay uses.
        present = {a.get("name") for a in affixes}

        for affix in folded:
            btype = _bonus_type(affix)
            affix["name"] = MOVEMENT_NAME
            stats["renamed"] += 1

            movement = value.get("movement")
            if movement is not None and str(movement) != str(affix.get("value")):
                # The Roman-rank correction: gear-planner stored the rank as if it
                # were a percentage (Speed XI -> 11, actually 30% movement).
                affix["value"] = str(movement)
                stats["movement_corrected"] += 1

            if not eligible:
                stats["quarantined"] += 1
                continue

            for key, name in _ALACRITY_KEYS:
                magnitude = value.get(key)
                if magnitude is None or name in present:
                    continue
                affixes.append({"name": name, "type": btype, "value": str(magnitude)})
                present.add(name)
                stats["melee_added" if key == "melee" else "ranged_added"] += 1

        rec["affixes"] = affixes

    return stats
