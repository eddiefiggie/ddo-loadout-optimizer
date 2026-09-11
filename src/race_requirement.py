"""R18 (#740) — attach the wiki-sourced race requirement the catalog has no field for.

gear-planner transcribes the enchantment list from a wiki item page and takes only
minimum level, slot, and item type from the header block. Race locks live in the
half nobody copied — the same gap `src/material.py` describes, and this is the same
shape of fix.

The defect this closes: `restrictions` was the literal string `"unknown"` on every
one of 9,194 records, no consumer read it, and the only race predicate in the
project was the Forged-vs-docent body-slot rule. So 173 items across 13 slots were
recommendable to races that cannot equip them, while the wizard's Race field told
the player it "determines body-slot and race-locked gear" — a filter that did not
exist anywhere.

Two evidence layers, deliberately separate:

  data/seed/compendium/race_requirement.json   the wiki's string, verbatim (#749)
  data/seed/compendium/race_vocabulary.json    what each string MEANS to the solver

The harvest records what the wiki says; the vocabulary records the reading. Keeping
them apart is what lets a refreshed harvest add a value and fail the build loudly
instead of falling through a classifier that guessed.

Exclude-until-verified, with one inversion worth naming: for `material` an
unclassified value fails OPEN and the druid keeps an option they should not have.
Here an unclassified value would ALSO fail open, which is the original defect — so
an unclassified `race_text` fails the BUILD instead (`assert_vocabulary`). The
quarantine is applied to the vocabulary, not to the item.
"""
from __future__ import annotations

import urllib.parse


def title_for(url: str) -> str:
    """`/page/Item:Adherence` -> `Item:Adherence` (the shard's key).

    NOTE the input: planner RECORDS carry a relative `/page/...` url, which is what
    this joins on. Built VARIANTS carry an absolute `https://ddowiki.com/page/...`
    in `wiki_url`, and passing one of those here yields `https://ddowiki.comItem:X`
    — a title that matches nothing, silently. Measured before this module was
    written: joining on the variant URL stamps 0 of 542 entries and every guard
    below still passes, because "nothing was gated" is indistinguishable from
    "nothing needed gating" once the join is already broken. Stamp on records.
    """
    return urllib.parse.unquote((url or "").replace("/page/", "")).replace("_", " ")


def classify(vocabulary: dict) -> dict:
    """`{race_text: canonical_label_or_None}` — None meaning "classified, no gate".

    A value absent from the returned map is UNCLASSIFIED, which is a different fact
    from a classified non-gate and is what `assert_vocabulary` fails on. Callers
    must not use `.get(x)` to conflate the two.
    """
    out = {}
    for raw, label in ((vocabulary or {}).get("gates") or {}).items():
        out[raw] = label
    for raw in (vocabulary or {}).get("no_gate") or []:
        out[raw] = None
    for raw in (vocabulary or {}).get("pet_equipment") or []:
        out[raw] = None
    return out


class RaceVocabularyError(Exception):
    """A harvested race_text nobody classified — the vocabulary work order grew."""


def assert_vocabulary(shard: dict, vocabulary: dict) -> int:
    """Fail the build when the harvest carries a `race_text` the vocabulary omits.

    This is the completeness guard the standing rule asks for, rather than a dated
    claim that the vocabulary was once complete: both sides are readable at build
    time, so the agreement is asserted on every build. A refreshed harvest that
    introduces a 23rd value stops the build and names it.

    Returns the number of entries inspected. Inspecting zero is itself a failure —
    an empty or mis-keyed shard would otherwise pass this gate unconditionally,
    which is how a gate becomes inert without anyone noticing.
    """
    harvested = (shard or {}).get("harvested") or {}
    known = classify(vocabulary)
    unclassified = {}
    checked = 0
    for title, entry in harvested.items():
        text = ((entry or {}).get("value") or {}).get("race_text")
        if text is None:
            continue
        checked += 1
        if text not in known:
            unclassified.setdefault(text, []).append(title)

    if not checked:
        raise RaceVocabularyError(
            "race vocabulary guard inspected 0 entries — the shard is empty or its "
            "`harvested[].value.race_text` shape has drifted, and the gate is inert. "
            "Expected entries from data/seed/compendium/race_requirement.json.")

    if unclassified:
        lines = "\n  ".join(
            f"{text!r} on {len(t)} page(s), e.g. {sorted(t)[0]}"
            for text, t in sorted(unclassified.items()))
        raise RaceVocabularyError(
            f"{len(unclassified)} harvested race_text value(s) are not classified in "
            f"data/seed/compendium/race_vocabulary.json:\n  {lines}\n"
            f"Add each to `gates` (with the app race label it means), `no_gate`, or "
            f"`pet_equipment`. Do NOT leave one unclassified — it fails open, which "
            f"is the #740 defect itself.")
    return checked


def apply(records, shard: dict, vocabulary: dict) -> dict:
    """Stamp `race_req` onto every record the wiki gates on a race, in place.

    Only a `stated` provenance yields a gate. A classified non-gate (`none`, `Any`,
    pet equipment) and an absent entry both leave the field absent, so every
    downstream consumer fails open on them — absence of a gate is the correct
    reading for the ~7,800 records the wiki says nothing about.
    """
    harvested = (shard or {}).get("harvested") or {}
    known = classify(vocabulary)
    stats = {"gated": 0, "stated_no_gate": 0, "unsourced": 0, "uncovered": 0}

    for rec in records or []:
        entry = harvested.get(title_for(rec.get("url")))
        if entry is None:
            stats["uncovered"] += 1
            continue
        if entry.get("provenance") != "stated":
            stats["unsourced"] += 1
            continue
        text = (entry.get("value") or {}).get("race_text")
        # `text not in known` cannot happen once assert_vocabulary has run; the
        # membership test is here so this function is safe called on its own.
        label = known.get(text) if text in known else None
        if label:
            rec["race_req"] = label
            stats["gated"] += 1
        else:
            stats["stated_no_gate"] += 1

    return stats


def coverage(records) -> dict:
    """Per-race counts of what actually got stamped, for the build metadata.

    This is the number the gate acts on, counted AFTER the join — which is the
    population claim worth publishing, rather than the shard's own entry count.
    The two differ, and the shard's is the wrong one to quote.
    """
    by_race = {}
    for rec in records or []:
        label = rec.get("race_req")
        if not label:
            continue
        by_race[label] = by_race.get(label, 0) + 1
    return {"gated_records": sum(by_race.values()),
            "distinct_races": len(by_race),
            "by_race": dict(sorted(by_race.items()))}
