"""`Magical Efficiency` is a percentage, never a presence flag (#619).

The wiki documents exactly two variants — "You take a 5%/10% Enhancement
discount to the Spell Point cost of your spells" — so every record carries a
magnitude and a bonus type. Eight did not.

## The cause, which is worth knowing because it will recur

Those eight items engrave `{{Power Store}}`, whose page states a fixed
"enhancement bonus of -10% spell point cost". gear-planner maps the name to
`Magical Efficiency` correctly, and then reads it as presence — because the
template is called with **no parameters**. Its magnitude lives in the template
BODY, not in the call, so a structural read has nothing to read and emits a Bool.

That is `bundled-template-values-live-in-the-tooltip-not-the-cell.md` one level
deeper: not the tooltip behind the cell, but the definition behind the call. The
same shape produced #613's `Sneak Attack` defect from the opposite direction —
there a missing parameter minted a phantom TYPE, here it erases a MAGNITUDE.

## Why a Bool here is a defect and not merely a gap

A presence-typed record is unrankable: `NON_RANKABLE_TYPES` and the picker both
exclude it, so a player who ranks spell-point efficiency is silently offered
99 of the 107 carriers. It is not a wrong number — it is a missing option, which
is the harder kind to notice.

The correction is split across the two mechanisms that own the two fields, in
build order: `item_value_corrections.json` (1 -> 10), then
`affix_type_corrections.json` (Bool -> Enhancement). Each carries its own stale
guard, so an upstream fix that supplies the parameter fails the build here rather
than being silently overwritten.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

AFFIX = "Magical Efficiency"
#: The two variants the wiki documents, plus the one anomaly recorded below.
WIKI_VARIANTS = {"5", "10"}


def _records():
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    return [(it.get("source_item"), a.get("type"), str(a.get("value")))
            for it in d.get("items", [])
            for a in (it.get("affixes") or [])
            if a.get("name") == AFFIX]


def test_no_magical_efficiency_record_is_presence_typed():
    """The guard proper: a Bool here means a template whose value was not read."""
    if not os.path.exists(DATASET):
        return
    rows = _records()
    assert len(rows) > 50, (
        "the guard inspects a real population, not an empty one — "
        f"found {len(rows)} {AFFIX} records")
    presence = sorted({n for n, t, _ in rows if t in ("Bool", "boolean")})
    assert not presence, (
        f"{AFFIX} is presence-typed on: {presence}. A Bool here is an unread "
        "template magnitude, not a real on/off effect — the wiki documents only "
        "5% and 10% variants. Read the engraved enchantment's own page (the "
        "eight known carriers engrave {{Power Store}}, a fixed -10%) and correct "
        "it through item_value_corrections.json + affix_type_corrections.json.")


def test_every_magical_efficiency_record_is_enhancement():
    """One bucket, so the solver takes the max rather than summing carriers."""
    if not os.path.exists(DATASET):
        return
    rows = _records()
    stray = sorted({(n, t) for n, t, _ in rows if t != "Enhancement"})
    assert not stray, (
        f"{AFFIX} carries a non-Enhancement type on: {stray}. The wiki states an "
        "Enhancement discount for both documented variants; a second type splits "
        "the bucket and the carriers would sum.")


def test_the_power_store_eight_carry_the_full_ten():
    """The specific correction #619 landed, pinned by item rather than by count.

    A count alone would stay green if a correction silently stopped reaching its
    item — the exact staleness the two `from` guards exist to prevent, asserted
    here from the shipped side as well as the seed side.
    """
    if not os.path.exists(DATASET):
        return
    expected = {
        "Cormyrian Green Dragonhide Armor", "Cormyrian Green Dragonplate Armor",
        "Cormyrian Green Dragonscale Armor", "Cormyrian Green Dragonscale Docent",
        "Cormyrian Green Dragonscale Robe", "Green Dragonscale Bracers",
        "Legendary Green Dragonscale Bracers", "Staff of the Petitioner",
    }
    by_item = {n: (t, v) for n, t, v in _records()}
    for name in sorted(expected):
        assert name in by_item, (
            f"{name} no longer carries {AFFIX} — the correction reached nothing. "
            "Re-verify against the wiki rather than deleting the entry.")
        t, v = by_item[name]
        assert (t, v) == ("Enhancement", "10"), (
            f"{name}: {AFFIX} reads {t}/{v}, expected Enhancement/10 from "
            "{{Power Store}}'s stated -10% enhancement bonus.")


def test_values_outside_the_documented_variants_are_declared():
    """`Facet of Condensed Power` carries 1, which matches neither variant.

    Recorded rather than silently tolerated: the augment does not resolve on the
    wiki under that name (a 2026-08-30 search returned nothing, and it is absent
    from Augment Slot), so this is an open question, not a ruling. The assertion
    is that it stays the ONLY such record — a second one means a new defect
    rather than a known one.
    """
    if not os.path.exists(DATASET):
        return
    odd = sorted({n for n, _, v in _records() if v not in WIKI_VARIANTS})
    assert odd == ["Facet of Condensed Power"], (
        f"unexpected {AFFIX} magnitudes on: {odd}. The wiki documents 5% and 10% "
        "only; anything else needs its own wiki reading before it ships.")
