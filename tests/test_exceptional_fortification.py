"""#862 — "Exceptional Fortification" is a label; the game stacks it as Insight.

Both items' rendered tooltips say "This ability is considered an Insight bonus
when determining stacking with other sources of fortification", and the
Fortification article files the category under Insight. Pinned here because
upstream flipped the sibling Seeker label to an `Exceptional` type once
(docs/wiki-evidence/seeker-bonus-type.md), which silently changed stacking.
Ruling: docs/wiki-evidence/exceptional-fortification.md.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

# Every record in Category:Exceptional Fortification items, by its stated magnitude.
CARRIERS = {
    "10": ["Embrace of the Spider Queen", "Greater Stalwart Trinket", "Leaves of the Forest (level 15)",
           "Leaves of the Forest (level 16)", "Livewood Core (level 15)", "Livewood Core (level 16)",
           "Stalwart Trinket", "Sustaining Symbiont", "The Disciplinator", "Toven's Hammer"],
    "25": ["Leaves of the Forest (level 17)", "Leaves of the Forest (level 22)", "Leaves of the Forest (level 23)",
           "Livewood Core (level 17)", "Livewood Core (level 22)", "Livewood Core (level 23)", "Omniscience"],
    "50": ["Epic Emerald Guard", "Epic Scales of Surety", "Leaves of the Forest (level 24)", "Livewood Core (level 24)"],
}


def _forts():
    with open(DATASET, encoding="utf-8") as fh:
        data = json.load(fh)
    out = {}
    for v in data["items"]:
        for a in v.get("affixes") or []:
            if a.get("name") == "Fortification":
                out.setdefault(v["source_item"], set()).add((a.get("type"), str(a.get("value"))))
    return out


def test_every_exceptional_fortification_carrier_stacks_as_insight():
    if not os.path.exists(DATASET):
        return
    forts = _forts()
    assert sum(len(v) for v in CARRIERS.values()) == 21
    for value, items in CARRIERS.items():
        for item in items:
            assert ("Insight", value) in forts.get(item, set()), (
                f"{item}: Exceptional Fortification +{value}% must store Insight {value} — the wiki tooltip "
                "says it 'is considered an Insight bonus when determining stacking'. A re-type to "
                f"Exceptional would make it stack on top of Insight fortification. Found {sorted(forts.get(item, set()))}")


def test_no_record_stores_fortification_at_exceptional():
    if not os.path.exists(DATASET):
        return
    bad = sorted(n for n, s in _forts().items() if any(t == "Exceptional" for t, _ in s))
    assert bad == [], f"Fortification typed Exceptional on {bad} — the game stacks it as Insight (#862)"
