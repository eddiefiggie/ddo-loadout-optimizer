"""DDO named-item compendium — browse index over the NATIVE roster (U6).

Re-homed onto the gear-planner NATIVE roster (the single source of truth). The
browse index is derived directly from the built item records — each carries its
own `source_item` (name), `slot`, and `wiki_url` — instead of the legacy
`roster_*.json` wiki-harvest shards. Those shards remain on disk (U7 purges
them); this module no longer reads them, and `load_roster` is retired.

Single-source completeness collapses the old two-layer split. Previously the
index disclosed:
  - **indexed** — the wiki roster knew a name/slot/link but its stats were not
    parsed (browse-only, never solver-fed), and
  - **enriched** — stats parsed, solver-active.
Under single-source, gear-planner provides COMPLETE data for every item it lists,
so every native item is solver-active. There is no "known but unparsed" layer
anymore: every indexed item is enriched. `indexed_only` is reported as 0 to mean
single-source COMPLETENESS, not lost coverage — the native roster (~8,997 names)
is a SUPERSET of the old ~7,658-name wiki roster.
"""
from __future__ import annotations


def wiki_url(name: str) -> str:
    """Derive an item's wiki page URL from its name (spaces -> underscores).

    Fallback only: native items carry their own `wiki_url`; this reconstructs one
    when a record lacks it.
    """
    return "https://ddowiki.com/page/Item:" + name.replace(" ", "_")


def build_compendium(items):
    """Build the browse index records + coverage from the NATIVE roster.

    `items` is the built variant list; each record carries `source_item` (the
    item name), `slot`, `wiki_url`, and a native sub-type in `type`. Names are
    de-duplicated by (name, slot) so tier variants of one item index once.

    Under single-source completeness every native item is solver-active, so every
    record is `enriched` — the legacy indexed-vs-enriched split has collapsed.
    Returns (records, coverage).
    """
    records = []
    by_slot = {}
    seen = set()
    for it in items or []:
        name = it.get("source_item")
        if not name:
            continue
        slot = it.get("slot") or ""
        key = (name, slot)
        if key in seen:
            continue
        seen.add(key)
        rec = {
            "name": name,
            "slot": slot,
            "wiki_url": it.get("wiki_url") or wiki_url(name),
            # Single-source: gear-planner gives complete data for every listed
            # item, so it is solver-active. No "indexed-only" (unparsed) layer.
            "status": "enriched",
        }
        # Carry the native sub-type (gear-planner's `type`) into the slot-specific
        # field the browse row reads, so the index keeps its display fidelity.
        typ = it.get("type")
        if typ:
            if it.get("category") == "weapon" or slot == "Weapon":
                rec["weapon_type"] = typ
            elif slot == "Off Hand":
                rec["offhand_type"] = typ
            elif slot == "Armor":
                rec["armor_type"] = typ
        records.append(rec)
        by_slot[slot] = by_slot.get(slot, 0) + 1
    coverage = {
        "total_indexed": len(records),
        # Every indexed item is enriched under single-source completeness.
        "enriched_matched": len(records),
        # 0 = single-source COMPLETENESS (there is no known-but-unparsed layer),
        # NOT lost coverage: the native roster is a superset of the old wiki roster.
        "indexed_only": 0,
        "by_slot": by_slot,
        "source": "native gear-planner roster (single source of truth)",
    }
    return records, coverage
