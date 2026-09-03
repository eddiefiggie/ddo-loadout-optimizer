"""#683 — DISCLOSED name splits: one wiki mechanic under more than one spelling,
where the stacking axis is unsettled.

The dataset keeps every spelling exactly as harvested. This module measures the
population behind each declared family, fails the build when that population
moves, and stamps what the browser needs to tell the player.

WHY NOT A FOLD. The #305 seam (``src/set_parser.py``) folds fragmented spellings
to one canonical stat, which puts them in one ``stat||type`` bucket — and a
bucket takes the MAX. That is the right answer only if the sources do not stack.
``web/cross-add.js`` is the opposite primitive, flat-adding across buckets, and
is right only if they do. For the `Critical Multiplier on a 19-20` family the
wiki states both readings on two different pages, so this repo picks neither:
the split is disclosed to the player instead. See
``docs/wiki-evidence/critical-multiplier-19-20.md``.

THE GUARD IS THE POINT. The disclosure quotes real counts ("reaches 2 of the 5
granting sets"), so a refresh that adds a granting set would leave the sentence
quietly wrong — the failure mode `a-dated-coverage-claim-cannot-notice-its-own-
staleness.md` describes. Every entry therefore declares its per-channel counts
and the build fails on drift, including drift to a channel declared empty.
"""
from __future__ import annotations

import json
import os


def load(path: str) -> list:
    """The `disclosures` list, with `_*` meta keys ignored.

    A missing file yields `[]` — the shard is optional and the build stays
    deterministic without it.
    """
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, dict):
        return []
    return [e for e in raw.get("disclosures") or [] if isinstance(e, dict)]


def measure(spellings, channels: dict) -> dict:
    """``{channel: {spelling: distinct_set_count}}`` for the given spellings.

    ``channels`` maps a channel label to an iterable of ``(stat, set_name)``
    pairs. Counted by DISTINCT SET, never per occurrence: a set grants its tier
    bonus on every one of its pieces, so a per-occurrence count would report a
    two-piece set as two sources and the disclosure would overstate the
    population it is quoting. This is the same distinct-set rule PR #676 applied
    to `rankable_affixes`, for the same reason.
    """
    want = set(spellings)
    out = {}
    for label, pairs in channels.items():
        seen = {s: set() for s in want}
        for stat, set_name in pairs:
            if stat in want:
                seen[stat].add(set_name)
        out[label] = {s: len(v) for s, v in seen.items()}
    return out


def assert_population(entries: list, measured: dict, *, inspected: int) -> None:
    """Fail the build when a declared population no longer matches the data.

    ``inspected`` is the number of records the channels were drawn from. A guard
    that inspects zero records would report every declared count as a drift to
    zero and fail for the wrong reason — or, were the comparison ever inverted,
    pass vacuously. `prove-a-guard-fails-before-trusting-it.md` asks for this
    explicitly.
    """
    if not entries:
        return
    if inspected <= 0:
        raise SystemExit(
            "split-mechanic disclosures cannot be measured against an empty "
            "record set — the population guard would compare declared counts "
            "against nothing")

    problems = []
    for e in entries:
        mech = e.get("mechanic")
        spellings = e.get("spellings") or []
        if len(spellings) < 2:
            problems.append(
                f"{mech!r} declares {len(spellings)} spelling(s) — a disclosed "
                "split needs at least two, or there is nothing to disclose")
            continue
        for src in ("one_mechanic_evidence", "contested_stacking", "wiki_url",
                    "contested_summary"):
            if not (e.get(src) or "").strip():
                problems.append(
                    f"{mech!r} carries no {src}. An entry asserts BOTH that the "
                    "spellings are one mechanic and that their stacking is "
                    "unsettled; each half needs its wiki text, or this shard is "
                    "the inference it exists to avoid")
        expected = e.get("expected_sets") or {}
        if not expected:
            problems.append(f"{mech!r} declares no expected_sets — nothing to guard")
        for channel, per_spelling in expected.items():
            got = (measured.get(channel) or {})
            for spelling, want in per_spelling.items():
                have = got.get(spelling)
                if have is None:
                    problems.append(
                        f"{mech!r}: channel {channel!r} was not measured, so "
                        f"{spelling!r}'s declared count of {want} is unchecked")
                elif have != want:
                    problems.append(
                        f"{mech!r}: {spelling!r} now reaches {have} distinct set(s) "
                        f"in {channel}, declared {want}. The player-facing "
                        "disclosure quotes this number — re-verify the family "
                        "against the wiki and update the entry")

    if problems:
        raise SystemExit(
            "split-mechanic disclosure population moved:\n  " + "\n  ".join(problems))


def stamp(entries: list, measured: dict) -> list:
    """The browser-facing payload: what the notice needs and nothing else.

    Deliberately carries no value the solver could read. The evidence prose stays
    in the shard and the evidence doc; what ships is the family, the per-spelling
    set counts the sentence quotes, and the issue number.
    """
    out = []
    for e in entries:
        spellings = list(e.get("spellings") or [])
        totals = {}
        for s in spellings:
            totals[s] = sum((measured.get(ch) or {}).get(s, 0)
                            for ch in (e.get("expected_sets") or {}))
        out.append({
            "mechanic": e.get("mechanic"),
            "spellings": spellings,
            "sets_per_spelling": totals,
            "total_sets": sum(totals.values()),
            "contested_summary": e.get("contested_summary"),
            "wiki_url": e.get("wiki_url"),
            "issue": e.get("issue"),
        })
    return out
