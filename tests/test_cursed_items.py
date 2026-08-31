"""A cursed item's curse is a -1 Penalty to a named ability (#615).

The wiki's `Cursed` page states the whole family in one list:

    Equipping a cursed item bestows a -1 penalty to one of your ability scores:
      Curse of Clumsiness:    Passive: -1 Penalty to Dexterity.
      Curse of Dullness:      Passive: -1 Penalty to Intelligence.
      Curse of Foolishness:   Passive: -1 Penalty to Wisdom.
      Curse of Frailty:       Passive: -1 Penalty to Constitution.
      Curse of Repulsiveness: Passive: -1 Penalty to Charisma.
      Curse of Weakness:      Passive: -1 Penalty to Strength.

Named carriers use the same definition, not a per-item variant: `Item:Ring of
Baphomet` renders `Curse of Foolishness` and `Curse of Repulsiveness` with
tooltips linking that same page.

So a curse is not a build-around presence effect. It is a signed penalty on the
ability a player ranks, and since #614 the solver subtracts it.

## Why the names are merged rather than typed in place

Bucket keys are ``stat||equivType(type)``. `Curse of Foolishness` is not a stat —
`Wisdom` is. Typing the curse in place would have created a `Curse of Foolishness`
bucket that no ranked priority reads, so the penalty would score nothing while
looking modelled. The merge puts it in the Wisdom total, and `via` keeps the
engraved curse name on the card.

## What this replaced

Four of these names were in `PRESENCE_DENY` (#622), hidden from the priority
picker because a drawback offered as a goal is misleading. That was a stopgap for
a penalty we could not score. Scoring it is the cure, and the deny entries are
gone — a name that no longer exists cannot be denied, and a dead deny entry is a
guard that can never fail.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "web", "data", "items.json")

#: The wiki's mapping, verbatim. `Curse of Frailty` is included for completeness
#: and is deliberately NOT asserted to exist: no carrier ships it today, and
#: asserting an absent name would fail on a population the wiki merely documents.
RULING = {
    "Curse of Clumsiness": "Dexterity",
    "Curse of Dullness": "Intelligence",
    "Curse of Foolishness": "Wisdom",
    "Curse of Repulsiveness": "Charisma",
    "Curse of Weakness": "Strength",
}


def _affixes():
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    return [(it.get("source_item"), a) for it in d.get("items", [])
            for a in (it.get("affixes") or [])]


def test_no_curse_survives_as_its_own_affix_name():
    """A surviving `Curse of X` scores nothing: no priority is named after it."""
    if not os.path.exists(DATASET):
        return
    stray = sorted({f"{n}: {a['name']}" for n, a in _affixes()
                    if str(a.get("name", "")).startswith("Curse of")})
    assert not stray, (
        f"curse(s) still carried as their own affix name: {stray}. The bucket key "
        "is stat||type and a curse is not a stat, so this one contributes to no "
        "ranked total while looking modelled.")


def test_every_curse_is_a_minus_one_penalty_on_its_ruled_ability():
    if not os.path.exists(DATASET):
        return
    seen = {}
    for item, a in _affixes():
        via = a.get("via")
        if via in RULING:
            seen.setdefault(via, []).append((item, a.get("name"), a.get("type"), str(a.get("value"))))
    assert len(seen) == len(RULING), (
        f"only {sorted(seen)} of {sorted(RULING)} reached any record — the merge "
        "has stopped reaching a curse, or upstream dropped its carriers.")
    for curse, stat in RULING.items():
        for item, name, typ, val in seen[curse]:
            assert (name, typ, val) == (stat, "Penalty", "-1"), (
                f"{item}: {curse} reads {name}/{typ}/{val}, expected "
                f"{stat}/Penalty/-1 from the wiki's Cursed page.")


def test_the_curses_are_no_longer_denied_from_the_picker():
    """A dead PRESENCE_DENY entry is a guard that can never fail.

    The deny list existed because a drawback offered as a goal is misleading. Once
    the drawback is scored on the ability instead, the name is gone and denying it
    is meaningless — so the entries must go with it.
    """
    src = os.path.join(ROOT, "web", "dataset.js")
    with open(src, encoding="utf-8") as fh:
        text = fh.read()
    start = text.index("const PRESENCE_DENY = new Set([")
    body = text[start:text.index("]);", start)]
    for curse in RULING:
        assert curse not in body, (
            f"{curse} is still in PRESENCE_DENY, but no affix carries that name any "
            "more — the entry can never fire and hides that the merge happened.")


def test_the_unscoreable_drawbacks_stay_denied():
    """#639 ruled all five, and two of them are ruled UNSCOREABLE rather than unread.

    `Mind Drain` and `Power Drain` left this list because they were ruled real
    penalties and merged into the spell-point pools they drain — a name that no
    longer exists cannot be denied. `Critical Weakening` was never here: it is an
    enemy debuff, a thing to want.

    What remains is a third category the original issue did not anticipate — a
    genuine wearer drawback the wiki declines to quantify. "A small chance" is not
    a rate, and inventing one would be the never-infer violation. So these two stay
    presence AND stay denied: unscoreable is not the same as harmless, and a
    drawback offered as a goal is misleading either way.
    """
    src = os.path.join(ROOT, "web", "dataset.js")
    with open(src, encoding="utf-8") as fh:
        text = fh.read()
    start = text.index("const PRESENCE_DENY = new Set([")
    body = text[start:text.index("]);", start)]
    for name in ("Cursed Level Drain", "Metal Fatigue"):
        assert name in body, (
            f"{name} left PRESENCE_DENY. The wiki states no rate for it, so it cannot "
            "be scored — and an unscoreable drawback offered as a goal is still "
            "misleading. Remove it only if the wiki starts stating a magnitude.")
