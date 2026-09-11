"""R18 (#740) — the race gate's two halves are written in different languages.

`race_vocabulary.json` maps each wiki `race_text` to a race label, and Python stamps
that label onto the item. `web/wizard.js` decides which labels a player can pick, and
`web/model.js` compares the two with a string equality. Nothing connects them at
runtime, so a label that exists on only one side does not error — it produces a gate
that can never match, which fails open and silently restores the #740 defect for
every item gated on that race.

Both sides are readable at build time, so the agreement is asserted rather than
claimed. This is the guard the standing rule asks for instead of a dated note that
the vocabulary was once complete.

The read is deliberately against `web/wizard.js` itself rather than a copy of the
list: a copy is what would drift.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

VOCAB_PATH = os.path.join(ROOT, "data", "seed", "compendium", "race_vocabulary.json")
WIZARD = os.path.join(ROOT, "web", "wizard.js")
MODEL = os.path.join(ROOT, "web", "model.js")


def _vocab():
    with open(VOCAB_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _js_string_array(src: str, name: str) -> list:
    """Read `const NAME = [...]` out of the source that actually ships it."""
    match = re.search(r"const %s = \[(.*?)\];" % re.escape(name), src, re.S)
    assert match, f"{name} not found in web/wizard.js — the guard cannot read what it guards"
    body = "\n".join(re.sub(r"//.*$", "", line) for line in match.group(1).splitlines())
    return re.findall(r'"([^"]+)"', body)


def _offered_races() -> list:
    with open(WIZARD, encoding="utf-8") as fh:
        src = fh.read()
    return _js_string_array(src, "RACES_BASIC") + _js_string_array(src, "RACES_ICONIC")


def test_the_guard_can_read_the_race_list():
    """Self-guard: a regex that matches nothing would pass every assertion below."""
    races = _offered_races()
    assert len(races) == 30, f"expected 30 playable races (18 basic + 12 Iconic), read {len(races)}"
    assert "Warforged" in races and "Sun Elf (Morninglord)" in races


def test_every_gate_target_is_a_race_the_wizard_offers():
    """A label only Python knows produces a gate no player can ever satisfy."""
    offered = set(_offered_races())
    unknown = sorted({label for label in _vocab()["gates"].values() if label not in offered})
    assert not unknown, (
        f"race_vocabulary.json maps to {len(unknown)} label(s) the wizard does not offer: "
        f"{unknown}. A gate on a label no player can pick excludes the item from "
        f"everyone. Fix the mapping, or update RACES_BASIC/RACES_ICONIC if a race "
        f"was genuinely renamed.")


def test_sun_elf_stays_unambiguous():
    """The one mapped-rather-than-exact value, and the condition that would break it.

    `Sun Elf` is mapped to `Sun Elf (Morninglord)` because the app's Elf-family
    labels are exactly `Elf`, `Wood Elf` and `Sun Elf (Morninglord)` — one candidate.
    That is a decision about this app's own label spelling, not a claim about DDO. If
    a bare `Sun Elf` race is ever added, there are two candidates and the mapping has
    to be re-ruled rather than silently keeping the old target.
    """
    offered = _offered_races()
    assert "Sun Elf" not in offered, (
        "a bare `Sun Elf` race label now exists, so the `Sun Elf` -> "
        "`Sun Elf (Morninglord)` mapping in race_vocabulary.json is no longer "
        "unambiguous — re-rule it against the wiki rather than leaving it.")
    assert _vocab()["gates"]["Sun Elf"] == "Sun Elf (Morninglord)"


def test_no_race_text_is_classified_twice():
    """`gates` / `no_gate` / `pet_equipment` must partition, or the reading is ambiguous."""
    v = _vocab()
    buckets = [set(v["gates"]), set(v["no_gate"]), set(v["pet_equipment"])]
    for i, a in enumerate(buckets):
        for b in buckets[i + 1:]:
            assert not (a & b), f"values classified in two buckets: {sorted(a & b)}"


def test_the_forged_equivalence_is_sourced_from_the_shipped_set():
    """The one non-strict case must reuse FORGED_RACES, not restate it.

    Strict exact match is the ruling; Bladeforged satisfying a `Warforged`
    requirement is the single exception, and it is only defensible because the
    project already ships that equivalence in the docent rule. If `raceMeets` ever
    spells its own Forged list, the two can drift and the body-slot rule and the
    race gate would disagree about the same character.
    """
    with open(MODEL, encoding="utf-8") as fh:
        src = fh.read()
    match = re.search(r"function raceMeets\(.*?\n\}", src, re.S)
    assert match, "raceMeets not found in web/model.js"
    body = match.group(0)
    assert "FORGED_RACES" in body, "raceMeets must consult the shipped FORGED_RACES set"
    assert not re.search(r'"bladeforged"', body), (
        "raceMeets spells its own Forged membership — reuse FORGED_RACES instead, "
        "or it will drift from the docent rule at variantConflict.")
