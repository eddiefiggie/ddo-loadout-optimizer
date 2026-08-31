"""Epic (ML 20) Lunar/Solar gems, and the tier counts that must not drift (#631).

The wiki's `Lunar Gem` page documents 103 gem families at three tiers. Upstream
carried 103 Heroic, 103 Legendary and **17** Epic — and current upstream master,
checked 2026-08-30, still carries 17. So it is a hole rather than a stale
snapshot, and `data/seed/compendium/augment_tier_gap.json` fills it additively.

Epic gems are ML 20, the band a mid-level character reaches for, so the effect was
a player being offered a fifth of the augment pool the game gives them with no
disclosure that anything was missing.

**The counts are asserted rather than dated.** A tier that silently stops
matching its siblings is exactly how this went unnoticed for as long as it did:
nothing compared Heroic to Epic, so a whole tier could be four-fifths absent
without any check having an opinion. Per
`a-dated-coverage-claim-cannot-notice-its-own-staleness.md`.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")
SHARD = os.path.join(ROOT, "data", "seed", "compendium", "augment_tier_gap.json")

#: Families the wiki documents with no Epic tier at all — not gaps.
NO_EPIC_TIER = {"Lunar Gem of Accuracy", "Lunar Gem of Natural Armor",
                "Solar Gem of Enduring"}
#: Deliberately excluded from the shard, each for its own recorded reason. These
#: are declared rather than silently tolerated: a family sitting outside the tier
#: check needs a stated cause, or the check quietly stops covering the population
#: it claims to.
#:
#:   Lunar Gem of Weapon Damage  — the wiki's Heroic value (2) disagrees with the
#:       shipped record (Deadly Profane 1), so this family failed the cross-check
#:       that validated every other Epic value. Its Epic value is unverified.
#:   (`Solar Gem of Arcana` was here and is now ADDED — #640. It had no sibling to
#:    derive from, so the shard grew a second entry shape that cites the item's own
#:    wiki page instead. It is deliberately no longer excluded: the tier check now
#:    covers it like any other family.)
#:   Solar Gem of Heal and Listen — RULED (#641), and the first framing was wrong.
#:       The gem is real and fully documented: Item:Solar_Gem_of_Heal_and_Listen_
#:       (Heroic) states "+2 Artifact Bonus to Heal, Listen, and Concentration"
#:       (ML 1, Sun) and (Legendary) states +6 (ML 30), both matching what we ship.
#:       What is missing is the SUMMARY TABLE row on the Lunar Gem page, not the
#:       gem — so upstream did NOT invent it, and the crafting dump's integrity is
#:       intact. That was the reading this file previously implied and it was wrong.
#:
#:       It stays excluded for a different reason than the others: its Epic tier has
#:       NO source. The item page does not exist, which proves nothing (86 of the
#:       103 Epic gem pages are redlinks — that is how #631's whole gap happened),
#:       but neither does a summary-table row, and the table is where #631 read all
#:       81 of its Epic values. The Lunar sibling runs 2/4/6, so 4 is the obvious
#:       guess — which is exactly why it is not written down. Revisit if the table
#:       ever gains the row.
EXCLUDED = {"Lunar Gem of Weapon Damage", "Solar Gem of Heal and Listen"}


def _gems():
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    out = {}
    for it in d.get("items", []):
        n = it.get("source_item") or ""
        if "Gem of" not in n or not (n.startswith("Lunar") or n.startswith("Solar")):
            continue
        for tier in ("Heroic", "Epic", "Legendary"):
            if f"({tier})" in n:
                out.setdefault(n.split(" (")[0], {})[tier] = it
    return out


def test_the_three_tiers_agree_except_where_the_wiki_says_otherwise():
    """The guard proper: Epic must cover every family that has one.

    Failing here means either a family lost its Epic record, or a new family
    arrived upstream without one. Both need a wiki read, not a bumped number.
    """
    if not os.path.exists(DATASET):
        return
    gems = _gems()
    assert len(gems) > 90, f"only {len(gems)} gem families — the guard inspects a real population"
    missing = sorted(b for b, t in gems.items()
                     if "Heroic" in t and "Epic" not in t
                     and b not in NO_EPIC_TIER and b not in EXCLUDED)
    assert not missing, (
        f"gem famil(ies) with a Heroic tier but no Epic: {missing}. Either the wiki "
        "documents no Epic tier for them (add to NO_EPIC_TIER with the evidence) or "
        "the tier-gap shard has stopped reaching them.")


def test_every_epic_gem_matches_its_siblings_shape():
    """An Epic gem's affix names and types come from its Heroic sibling.

    That derivation is the shard's whole method — the wiki row's type text is
    unreliable, so only the VALUE was taken from it. If a shipped Epic record's
    shape ever diverges from its Heroic sibling, the derivation has broken and the
    values it produced can no longer be trusted either.
    """
    if not os.path.exists(DATASET):
        return
    shape = lambda it: sorted((a.get("name"), a.get("type")) for a in it.get("affixes") or [])
    bad = []
    for base, tiers in _gems().items():
        if "Epic" not in tiers or "Heroic" not in tiers:
            continue
        if shape(tiers["Epic"]) != shape(tiers["Heroic"]):
            bad.append(f"{base}: Epic {shape(tiers['Epic'])} vs Heroic {shape(tiers['Heroic'])}")
    assert not bad, "Epic/Heroic shape divergence:\n  " + "\n  ".join(bad)


def test_every_epic_value_sits_between_its_siblings():
    """Heroic <= Epic <= Legendary, per family.

    A weak check by design — it cannot confirm a value is RIGHT, only that a
    transcription did not invert or wildly misplace one. The values themselves are
    wiki-sourced and were validated against 204 shipped Heroic/Legendary records
    before any Epic value was trusted.
    """
    if not os.path.exists(DATASET):
        return
    bad = []
    for base, tiers in _gems().items():
        if not {"Heroic", "Epic", "Legendary"} <= set(tiers):
            continue
        def val(t):
            vs = {float(a["value"]) for a in tiers[t]["affixes"] if a.get("value") is not None}
            return max(vs) if vs else None
        h, e, l = val("Heroic"), val("Epic"), val("Legendary")
        if None in (h, e, l):
            continue
        if not (h <= e <= l):
            bad.append(f"{base}: Heroic {h}, Epic {e}, Legendary {l}")
    assert not bad, "Epic value outside its tier band:\n  " + "\n  ".join(bad)


def test_the_shard_is_additive_and_still_needed():
    """Every addition must still be absent upstream.

    When upstream finally scrapes the Epic tier, `apply()` raises rather than
    shadowing it — this asserts the same thing from the shipped side, so the shard
    cannot quietly outlive its purpose.
    """
    if not os.path.exists(SHARD):
        return
    with open(SHARD, encoding="utf-8") as fh:
        shard = json.load(fh)
    adds = shard.get("additions") or []
    assert adds, "the shard is empty — delete it rather than shipping an inert file"
    assert shard.get("count") == len(adds), "the shard's stated count disagrees with its contents"
    raw = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_crafting.json")
    with open(raw, encoding="utf-8") as fh:
        craft = json.load(fh)
    upstream = {o.get("name") for k in ("Moon Augment Slot", "Sun Augment Slot")
                for o in (craft.get(k, {}).get("*") or []) if isinstance(o, dict)}
    adopted = sorted(e["name"] for e in adds if e["name"] in upstream)
    assert not adopted, (
        f"upstream has adopted {adopted} — remove those entries from the shard. It is "
        "ADDITIVE only, and an entry shadowing a live upstream record is exactly what "
        "its contract forbids.")


def test_a_sibling_less_addition_cites_its_own_wiki_page():
    """#640 — an entry with no `derived_from` must name the page it came from.

    Most additions derive their affix names and types from a shipped Heroic
    sibling, and that derivation IS their stale guard. A family upstream carries at
    no tier has no sibling, so the guard is replaced by two things: the additive
    check (the name must still be absent upstream, asserted above) and a recorded
    wiki page. An entry with neither is indistinguishable from an invented one.
    """
    if not os.path.exists(SHARD):
        return
    with open(SHARD, encoding="utf-8") as fh:
        adds = json.load(fh).get("additions") or []
    sibling_less = [e for e in adds if not e.get("derived_from")]
    assert sibling_less, (
        "no sibling-less additions — if that shape is gone, delete the branch in "
        "src/augment_tier_gap.py that supports it rather than leaving it untested")
    for e in sibling_less:
        assert e.get("wiki_source"), f"{e['name']}: no derivation and no wiki_source"
        assert e.get("verified"), f"{e['name']}: cites a page but records no verified date"
        assert e.get("evidence"), f"{e['name']}: a sibling-less addition must carry its evidence"
