"""#287 — fold ``Legendary <stat>`` display names into base stat + Legendary type.

gear-planner stores five endgame enchantments under prefixed display names —
``Legendary Accuracy``, ``Legendary Armor-Piercing``, ``Legendary Deadly``,
``Legendary Conditioning``, ``Legendary Spell Penetration`` — each at bonus type
``Legendary``. The wiki models every one as the BASE enchantment with
``Legendary`` as the bonus-type parameter, exactly parallel to its
Quality/Insightful variants:

  * ``{{Accuracy|2|Legendary}}`` (Item:Balorskin Gauntlets, Item:The Bloody
    Boulder); rendered tooltip: "Legendary Accuracy +2: Passive: +2 Legendary
    bonus to attack rolls" — linking to the plain Accuracy concept page.
  * ``{{Deadly|1|Legendary}}`` (Item:The Bloody Boulder); cf.
    ``{{Deadly|4|Quality}}`` on Item:Yeenoghu's Reign — same template.
  * ``{{Armor-Piercing|5|Legendary}}`` (Item:Legendary Docent of the Warblade).
  * ``{{Conditioning|15|Legendary}}`` (Item:Baphomet's Reign),
    ``{{Conditioning|5|Legendary}}`` (Item:Buckler of the Fallen Age).
  * Item:Docent of the Artblade rendered tooltip: "Legendary Spell Penetration
    +2: Passive: +2 Legendary bonus to Spell Penetration checks."

All verified 2026-08-13. ``Legendary`` is a real, distinct stacking bonus type
(docs/wiki-evidence/bonus-type-equivalence.md §2) — the type is untouched; only
the stat name folds. Adopting the prefixed display name as the STAT meant a
plain ``Accuracy`` priority scored zero on every carrier, and the player had to
discover and rank a second stat by hand. Totals do not change for a player who
ranked both names (the affixes occupied their own (stat, type) bucket before and
after); reachability does.

Why not ``name_corrections``: its collision guard hard-fails when the canonical
name is already native — ``Accuracy`` is — and that guard is load-bearing for
its own use case (a rename onto a native name usually means two distinct
upstream affixes are being merged). Here the merge is exactly the point, backed
by per-stat wiki evidence, so the fold is its own mechanism with its own guards.

Why an allowlist, not a prefix rule: a blanket "strip ``Legendary `` when the
type is ``Legendary``" would silently fold a sixth enchantment nobody verified
— never infer. The guard below fails the build in BOTH unverified directions:
a numeric ``Legendary *`` stat at type ``Legendary`` that is not in the
allowlist (new enchantment: adjudicate, then extend the list), and an
allowlisted name arriving at a foreign type (upstream moved: re-verify).

``Legendary <proc>`` Bool affixes (Legendary Slime, guards, ...) are distinct
named effects, out of scope by construction — the guard keys on non-Bool types.

Each folded affix is stamped with ``spell_focus.PROVENANCE_KEY`` carrying the
engraved name, so item surfaces keep displaying what the item actually says
("Legendary Accuracy +2") and the web picker's provenance-label scan makes the
engraved name a redirecting, rankable entry automatically.
"""
from __future__ import annotations

from src.spell_focus import PROVENANCE_KEY

# Lowercased engraved name -> base stat. Membership requires wiki template or
# rendered-tooltip evidence (module docstring); extend only with a new citation.
FOLD = {
    "legendary accuracy": "Accuracy",
    "legendary armor-piercing": "Armor-Piercing",
    "legendary deadly": "Deadly",
    "legendary conditioning": "Conditioning",
    "legendary spell penetration": "Spell Penetration",
}

_PREFIX = "legendary "


def _is_numeric(value) -> bool:
    try:
        float(str(value))
        return True
    except (TypeError, ValueError):
        return False


def apply(records: list) -> dict:
    """Fold prefixed stats in place across ``records[].affixes``. Returns counts.

    Raises ``SystemExit`` when the walk sees an un-adjudicated ``Legendary *``
    numeric stat at type ``Legendary``, an allowlisted name at a foreign type,
    or zero records (a vacuous pass proves nothing).
    """
    if not records:
        raise SystemExit(
            "legendary fold cannot be applied to an empty record set")

    problems = []
    folded = 0
    for rec in records:
        for a in rec.get("affixes") or []:
            name = (a.get("name") or "").strip()
            low = name.lower()
            a_type = a.get("type")
            if low in FOLD:
                if a_type != "Legendary":
                    problems.append(
                        f"{name!r} arrived typed {a_type!r}, not 'Legendary' — "
                        "upstream moved; re-verify against the wiki before "
                        "folding")
                    continue
                a[PROVENANCE_KEY] = name
                a["name"] = FOLD[low]
                folded += 1
            elif (low.startswith(_PREFIX) and a_type == "Legendary"
                    and _is_numeric(a.get("value"))):
                problems.append(
                    f"{name!r} is a numeric Legendary-typed stat not in the "
                    "fold allowlist — a NEW enchantment nobody verified. "
                    "Adjudicate against the wiki (template + rendered tooltip) "
                    "and either extend legendary_fold.FOLD or record why it "
                    "stays distinct")
    if problems:
        raise SystemExit(
            "legendary fold cannot proceed:\n  " + "\n  ".join(problems))
    return {"folded": folded}
