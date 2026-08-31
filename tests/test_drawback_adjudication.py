"""The five drawback-shaped Bools, ruled (#639).

#615 said the data could not tell three readings apart — a penalty on the wearer,
a debuff applied to enemies, or an activated clicky. The wiki tells all three
apart, and the answer was not two-way:

    Mind Drain          wearer penalty   -5% maximum spell points, while worn
    Power Drain         wearer penalty   -30 maximum spell points (60 Sorc/FvS)
    Cursed Level Drain  wearer drawback  "a small chance" to drain 1 level when hit
    Metal Fatigue       wearer drawback  "a small chance" of Exhausted when damaged
    Critical Weakening  ENEMY debuff     1 Strength damage on each critical hit

## Three dispositions, not two

The first two are recovered: merged into the spell-point pool each drains, typed
`Penalty`, and since #614 subtracted from the total.

The middle two are the category the issue did not anticipate — a real wearer
drawback the wiki declines to QUANTIFY. "A small chance" is not a rate, and the
effect is a status (Exhausted, level drain) rather than a stat magnitude. They
stay presence because inventing a rate is the never-infer violation, and stay
denied from the picker because a drawback offered as a goal misleads either way.

`Critical Weakening` is the reason #622's caution was right. It is weapon-only, so
the on-hit reading stayed open and it was deliberately NOT denied — and it turns
out to damage the enemy, not the wearer. Its sibling `Curse of Weakness` was also
weapon-only and went the other way (#615), so guessing from the name would have
been wrong half the time.

## The disambiguation that could have gone badly

`Power Drain` is a DISAMBIGUATION page on the wiki. One reading is a clicky on
`Vile Blasphemy` that REGENERATES spell points — a benefit. The other is the
enchantment that penalises maximum SP. Merging the wrong one would have turned a
benefit into a -30 penalty.

Upstream already separates them by name (`Power Drain clicky`), and this file
asserts that separation holds, because the merge silently depends on it.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

RECOVERED = {
    "Mind Drain": ("Maximum Spell Points (%)", "-5"),
    "Power Drain": ("Wizardry", "-30"),
}
#: Ruled real, ruled unquantifiable. Presence is the honest encoding.
UNSCOREABLE = ("Cursed Level Drain", "Metal Fatigue")
#: Ruled an enemy debuff — a thing to want, never denied.
ENEMY_DEBUFF = "Critical Weakening"


def _affixes():
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    return [(it.get("source_item"), a) for it in d.get("items", [])
            for a in (it.get("affixes") or [])]


def test_the_recovered_drawbacks_are_penalties_on_the_pool_they_drain():
    if not os.path.exists(DATASET):
        return
    seen = {}
    for item, a in _affixes():
        if a.get("via") in RECOVERED:
            seen.setdefault(a["via"], []).append((item, a.get("name"), a.get("type"), str(a.get("value"))))
    assert set(seen) == set(RECOVERED), (
        f"reached {sorted(seen)}, expected {sorted(RECOVERED)} — a merge stopped reaching its carriers")
    for src, (stat, value) in RECOVERED.items():
        for item, name, typ, val in seen[src]:
            assert (name, typ, val) == (stat, "Penalty", value), (
                f"{item}: {src} reads {name}/{typ}/{val}, expected {stat}/Penalty/{value}")


def test_neither_recovered_name_survives_as_its_own_stat():
    if not os.path.exists(DATASET):
        return
    stray = sorted({f"{n}: {a['name']}" for n, a in _affixes() if a.get("name") in RECOVERED})
    assert not stray, (
        f"still carried as their own affix name: {stray}. Neither is a stat, so each "
        "would take a bucket no ranked priority reads.")


def test_the_beneficial_power_drain_reading_stays_separate():
    """The merge depends on upstream naming the clicky differently, so assert it.

    `Power Drain` disambiguates to a clicky that REGENERATES spell points and an
    enchantment that penalises them. If upstream ever emitted the clicky under the
    bare name, the name correction would rewrite a benefit into a -30 penalty.
    """
    if not os.path.exists(DATASET):
        return
    vile = [a.get("name") for n, a in _affixes() if n == "Vile Blasphemy"
            and "Drain" in str(a.get("name"))]
    assert vile, "Vile Blasphemy no longer carries a Power Drain effect — re-read the disambiguation"
    assert all(x != "Power Drain" for x in vile), (
        f"Vile Blasphemy carries the BARE name {vile}; upstream has stopped separating the "
        "clicky from the enchantment, and the name correction would rewrite a spell-point "
        "REGENERATION effect into a -30 penalty.")


def test_the_unquantifiable_drawbacks_stay_presence():
    """Ruled real, ruled unscoreable. Typing them needs a rate the wiki never states."""
    if not os.path.exists(DATASET):
        return
    for name in UNSCOREABLE:
        rows = [(n, a) for n, a in _affixes() if a.get("name") == name]
        assert rows, f"{name} left the catalog — re-read the ruling rather than dropping the entry"
        for item, a in rows:
            assert a.get("type") in ("Bool", "boolean"), (
                f"{item}: {name} is typed {a.get('type')}. The wiki gives it only "
                '"a small chance" and no magnitude, so a number here was invented.')


def test_the_enemy_debuff_is_not_treated_as_a_drawback():
    if not os.path.exists(DATASET):
        return
    rows = [a for _, a in _affixes() if a.get("name") == ENEMY_DEBUFF]
    assert rows, f"{ENEMY_DEBUFF} left the catalog"
    for a in rows:
        assert (a.get("value") is None) or float(a.get("value")) >= 0, (
            f"{ENEMY_DEBUFF} carries a negative value. It damages the ENEMY's Strength "
            "on a critical hit; it is not a cost to the wearer.")
