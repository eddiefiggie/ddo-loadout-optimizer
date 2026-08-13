"""#262 — the wiki-confirmed "no known live drop source" flag.

Players report gear the optimizer recommends that no longer drops ("Bracers of
the Spider Queen doesn't drop"). The dataset has ~199 worn variants whose
`location_quest` is empty, but that absence is a candidate signal, not a
verdict — some are event items whose source the harvest simply lacks. So the
flag is stamped ONLY from a curated evidence shard
(``data/seed/compendium/no_drop_source.json``) of per-item verdicts read off
each item's own rendered wiki page.

Three claim strengths stay distinct (KTD5): "Location section empty" is the
observation the shard records, "no known live drop source" is the disclosable
claim, "unobtainable" is never claimed — the wiki proves its page records no
source, not that the item cannot exist.

The verdict vocabulary is CLOSED at two classes: ``confirmed_no_source`` flags
the item; ``wiki_has_source`` is recorded so re-triage skips the item and the
deferred location backfill can find it, and stamps NOTHING. An unverified or
page-missing item is never written to the shard — it lives in the docs tracker
only.

**Deliberate divergence from src/ml36_augments.py's refuse-empty rule** (KTD4):
an absent shard file or an empty ``harvested`` map is FULLY inert — ``load``
returns ``{}``, ``check`` no-ops, nothing is stamped, and no coverage block is
emitted, so the built dataset is byte-identical to a build without the feature.
That is the exclude-until-verified empty-seed exception: disclosure is
fail-safe-absent (a missing flag under-discloses; ml36's missing entries
under-BUILD, which is why that shard refuses empty). Once entries exist, every
guard fires and a zero-inspected pass is refused.

Guards, each failing the build rather than warning (all raised from ``check``):

* a verdict outside the closed vocabulary — a corrupt entry, not a third state;
* an entry naming an item absent from the planner roster (the
  ``assert_all_reached`` anti-orphan pattern) — renamed or dropped upstream;
* a ``confirmed_no_source`` entry missing its evidence snapshot, wiki_url, or
  harvested date — a claim without the reading that proves it;
* STALENESS (R9/AE4): an entry whose item's upstream ``quests`` array is
  non-empty. The raw list on the PLANNER record is the staleness key (KTD8),
  not the derived ``location_quest`` string on variants — which is why
  ``check`` is wired in ``build_dataset.py`` pre-variant-expansion, where the
  planner records are in scope. The wiki/gear-planner now records a source;
  un-flagging is a manual review event, never automatic.

Stamping is ONLY-WHEN-SET (the ``QUARANTINE_FIELD`` precedent in
``src/variants.py`` — its 353KB null-stamping lesson): a flagged variant
carries ``no_drop_source: True``; every other variant carries no key at all.
The solver never reads the field — flagged items remain candidates, and
exclusion stays the player's move via the blocklist (R6).
"""
from __future__ import annotations

import json
import os

# The per-variant field the web layer discloses from. Emitted only when True.
FIELD = "no_drop_source"

# The closed verdict vocabulary (KTD5). Nothing weaker is ever written to the
# shard: unverified / page_missing items live in the docs tracker only.
CONFIRMED = "confirmed_no_source"
WIKI_HAS_SOURCE = "wiki_has_source"
VERDICTS = frozenset({CONFIRMED, WIKI_HAS_SOURCE})

# What a confirmed claim must carry: the verbatim reading, where it was read,
# and when. Corrupting any one of these must go red (proven in tests).
_CONFIRMED_EVIDENCE_FIELDS = ("evidence", "wiki_url", "harvested")


def _reject_duplicate_keys(pairs):
    """``object_pairs_hook`` — a duplicated key in the curated shard silently
    keeps only the last occurrence under plain ``json.load``, discarding a
    verdict before any guard can see it (review finding #1). Fail loudly
    instead: an append-without-delete re-triage is a review event, not a
    silent overwrite."""
    seen = set()
    for k, _ in pairs:
        if k in seen:
            raise SystemExit(
                f"no_drop_source shard: duplicated key {k!r} — json would keep "
                "only the last occurrence, silently discarding a verdict. "
                "Remove the stale entry instead of appending beside it.")
        seen.add(k)
    return dict(pairs)


def load(path: str) -> dict:
    """The shard's harvested entries, ``{}`` when the file is absent.

    An empty result is the DELIBERATE inert path (the empty-seed exception in
    the module docstring), not an error. A duplicated key anywhere in the
    document fails the build (``_reject_duplicate_keys``).
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh, object_pairs_hook=_reject_duplicate_keys).get("harvested") or {}


def confirmed_names(entries: dict) -> set:
    """The item source names carrying a ``confirmed_no_source`` verdict."""
    return {n for n, e in (entries or {}).items()
            if (e or {}).get("verdict") == CONFIRMED}


def check(entries: dict, planner_records: list) -> dict:
    """Assert every entry against the roster and its own evidence. Offline.

    Runs against the PLANNER records (pre-variant-expansion) because the raw
    ``quests`` array — the staleness key — lives only there. Raises SystemExit
    on any violation, naming the entry; returns
    ``{"checked", "confirmed", "wiki_has_source"}`` otherwise.

    An empty ``entries`` is the labeled deliberate no-op (the empty-seed
    exception): nothing to vouch for, nothing to flag, so it reports having
    inspected nothing rather than failing. Once entries exist, a pass that
    inspected zero of them is refused.
    """
    if not entries:
        return {"checked": 0, "confirmed": [], "wiki_has_source": []}

    by_name = {}
    for r in planner_records or []:
        by_name.setdefault(r.get("name"), r)  # first wins, matching loader dedup

    problems = []
    checked = 0
    confirmed = []
    has_source = []
    for name, e in sorted(entries.items()):
        e = e or {}
        verdict = e.get("verdict")
        # (a) closed vocabulary — an unknown verdict is a corrupt entry.
        if verdict not in VERDICTS:
            problems.append(
                f"{name}: unknown verdict {verdict!r} — the vocabulary is closed "
                f"at {sorted(VERDICTS)}; unverified/page_missing items are never "
                "written to the shard")
            continue
        # (b) anti-orphan — the entry must name an item the roster carries.
        rec = by_name.get(name)
        if rec is None:
            problems.append(
                f"{name}: names no item in the planner roster — renamed or "
                "dropped upstream; re-verify the entry against the wiki")
            continue
        # (c) a confirmed claim must carry the reading that proves it.
        if verdict == CONFIRMED:
            missing = [f for f in _CONFIRMED_EVIDENCE_FIELDS if not e.get(f)]
            if missing:
                problems.append(
                    f"{name}: confirmed_no_source entry is missing "
                    f"{', '.join(repr(m) for m in missing)} — a claim without "
                    "its evidence snapshot cannot be vouched for")
                continue
        # (d) staleness (R9/AE4) — keyed off the RAW quests list, not the
        # derived location_quest string. Fires for BOTH verdicts: for a
        # confirmed entry the data now records a source and un-flagging is a
        # manual review event; for a wiki_has_source entry the backfill landed
        # and the entry has left the triage universe — retire it deliberately.
        quests = [q for q in rec.get("quests") or [] if q]
        if quests:
            problems.append(
                f"{name}: upstream `quests` now records a source "
                f"({quests[0]!r}) — the entry is stale; re-verify against the "
                "wiki and retire or re-record it (un-flagging is a manual "
                "review event, never automatic)")
            continue
        checked += 1
        (confirmed if verdict == CONFIRMED else has_source).append(name)

    if problems:
        raise SystemExit("no-drop-source shard guard failed:\n  "
                         + "\n  ".join(problems))
    # Belt-and-braces: entries exist, so a pass that inspected none of them is
    # a broken loop, not a clean run (the refuse-to-inspect-zero discipline).
    if not checked:
        raise ValueError(
            "no-drop-source guard inspected zero entries while the shard has "
            "entries — refusing to report a clean pass over nothing")
    return {"checked": checked, "confirmed": confirmed,
            "wiki_has_source": has_source}


def stamp(variants: list, entries: dict) -> int:
    """Stamp ``no_drop_source: True`` onto confirmed variants, ONLY-WHEN-SET.

    Matches by ``source_item`` — the shard is keyed by the item's SOURCE name
    exactly as the roster spells it (heroic and legendary tiers are distinct
    wiki pages and distinct entries). Never writes False/null: absent is the
    default and the signal (the QUARANTINE_FIELD / 353KB lesson in
    src/variants.py).

    Returns the number of variants stamped. Confirmed entries that reach zero
    variants raise — the join key moved, and a zero-stamped pass with entries
    present must be impossible.
    """
    names = confirmed_names(entries)
    if not names:
        return 0  # wiki_has_source-only shard stamps nothing, by design
    stamped = 0
    reached = set()
    for v in variants or []:
        if v.get("source_item") in names:
            v[FIELD] = True
            stamped += 1
            reached.add(v["source_item"])
    # Per-entry, not aggregate (review finding #3): an 18-of-19 join miss must
    # fail naming the missing name, or one item's disclosure vanishes silently
    # while coverage still counts it as confirmed.
    missing = names - reached
    if missing:
        raise SystemExit(
            "no-drop-source stamp reached no variant for "
            + ", ".join(sorted(repr(n) for n in missing))
            + " — the source_item join is broken; re-verify the entry names")
    return stamped


def coverage(variants: list, entries: dict) -> dict:
    """The ``metadata.no_drop_source_coverage`` block, derived AT BUILD TIME.

    Counts come from the dataset, never hardcoded, so harvest refreshes cannot
    drift them. The triage universe is selected strictly by
    ``location_quest == ""`` (the empty STRING — a worn item whose harvest
    recorded no quest): the ~1,063 augment records carry ``location_quest:
    null`` and the 11 synthetic Dino crafting blanks carry no key at all, so
    both fall outside by construction (R3).

    Only called when the shard has entries — an empty seed emits NO coverage
    block at all (AE2 byte-identity), which the caller gates.
    """
    universe = {v.get("source_item") for v in variants or []
                if v.get("location_quest") == ""}
    confirmed = sorted(confirmed_names(entries))
    has_source = sorted(n for n, e in (entries or {}).items()
                        if (e or {}).get("verdict") == WIKI_HAS_SOURCE)
    flagged = sum(1 for v in variants or [] if v.get(FIELD))
    return {
        "confirmed_no_source": len(confirmed),
        "confirmed_items": confirmed,
        "wiki_has_source": len(has_source),
        "triage_universe": len(universe),
        "unverified": len(universe - set(entries or {})),
        "flagged_variants": flagged,
        "note": ("verdicts are wiki-harvested per item from the rendered page; "
                 "an empty location_quest alone never flags an item, and an "
                 "unverified item shows nothing player-facing. 'no known live "
                 "drop source' is the claim; 'unobtainable' is never claimed."),
    }
