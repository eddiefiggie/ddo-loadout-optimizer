"""README catalog-count drift guard: what the README claims vs. what the build produces.

The README states the size of the catalog in three places — the opening pitch,
the "What it knows about" capability table, and the `**State (…):**` line in the
resume prompt. Every one of those numbers is a hand-maintained count of a
GENERATED population, and a hand-maintained count cannot notice when the
population moves under it.

It already had not noticed. The pitch and the table said 9,108 variants from
8,034 records while the State line 119 lines below said 9,110 from 8,036; the
build agreed with the State line. A reader who checked the pitch against the
State line found two different answers and no way to tell which was live (#460).

The build stamps every one of these figures into `metadata`, so the disagreement
is checkable from the tree alone — which is what the repo's standing rule asks
for: a completeness claim needs a guard, not a date. Correcting the two stale
numbers fixes this drift; this guard is what makes the next one impossible.

Two properties are pinned, not one:

  * every declared claim matches the build, and
  * every numeric claim in the capability table IS a declared claim —
    so a newly counted row cannot be added without a guard covering it.

Each claim is anchored to the region it lives in, never searched file-wide. The
"Latest work" narrative below the resume prompt quotes counts as they stood at
the time ("675 of 1,063", "1063 → 745 augments", an older "7 Dino inserts" line)
and is deliberately out of scope: it is history, and history is allowed to be
stale.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_BUILT = None


def _build():
    global _BUILT
    if _BUILT is None:
        _BUILT = build_dataset.build()
    return _BUILT


def _figures():
    """The built figures behind each README claim, by the name the claims use."""
    meta = _build()["metadata"]
    return {
        "variants": meta["variant_count"],
        "records": meta["seed_count"],
        "augments": meta["augment_total_count"],
        "membership_sets": meta["membership_coverage"]["sets"],
        "augment_sets": meta["augment_set_coverage"]["sets"],
        "dino_inserts": meta["dino_coverage"]["inserts_eligible"],
    }


def _readme():
    with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as fh:
        return fh.read()


def _headline_region(readme):
    """Everything above the resume prompt: the pitch and the capability table."""
    head, sep, _ = readme.partition("## Resume prompt")
    assert sep, "README.md no longer has a `## Resume prompt` heading — the claim regions are keyed off it"
    return head


def _capability_table(readme):
    """The `## What it knows about` table, where the counted rows live."""
    _, sep, rest = _headline_region(readme).partition("## What it knows about")
    assert sep, "README.md no longer has a `## What it knows about` section"
    return rest


def _state_line(readme):
    """The single `**State (YYYY-MM-DD):**` line in the resume prompt."""
    lines = [ln for ln in readme.splitlines() if re.search(r"\*\*State \(\d{4}-\d{2}-\d{2}\):\*\*", ln)]
    assert len(lines) == 1, (
        f"expected exactly one `**State (YYYY-MM-DD):**` line in README.md, found {len(lines)} — "
        "the resume prompt's live-state claims are guarded by anchoring to that one line")
    return lines[0]


# (label, region, pattern, figure names captured — one per regex group)
CLAIMS = (
    ("opening pitch",
     "headline",
     r"It considers \*\*([\d,]+) gear variants\*\* built from ([\d,]+) wiki-sourced records",
     ("variants", "records")),
    ("capability table — variants",
     "table",
     r"\| ✅ ([\d,]+) variants \|",
     ("variants",)),
    ("capability table — augments",
     "table",
     r"\| ✅ ([\d,]+) augments \(incl\. the ML36 tier\) \|",
     ("augments",)),
    ("capability table — membership sets",
     "table",
     r"\| ✅ ([\d,]+) craftable-membership sets \|",
     ("membership_sets",)),
    ("capability table — augment sets",
     "table",
     r"\| ✅ ([\d,]+) augment sets \|",
     ("augment_sets",)),
    ("capability table — Dino inserts",
     "table",
     r"\| ✅ ([\d,]+) inserts \|",
     ("dino_inserts",)),
    ("State line — variants and records",
     "state",
     r"\*\*State \(\d{4}-\d{2}-\d{2}\):\*\* ([\d,]+) variants from ([\d,]+) gear-planner records",
     ("variants", "records")),
    ("State line — augments",
     "state",
     r"([\d,]+) augments w/ multi-fit colors",
     ("augments",)),
    ("State line — set counts",
     "state",
     r"\(([\d,]+) membership sets, ([\d,]+) augment sets\)",
     ("membership_sets", "augment_sets")),
    ("State line — Dino inserts",
     "state",
     r"([\d,]+) Dino inserts",
     ("dino_inserts",)),
)


def _region(readme, name):
    return {
        "headline": _headline_region,
        "table": _capability_table,
        "state": _state_line,
    }[name](readme)


def _matches(readme, label, region, pattern):
    """The one match for a claim, or a failure naming which claim went unanchored."""
    found = list(re.finditer(pattern, _region(readme, region)))
    assert len(found) == 1, (
        f"README claim {label!r} matched {len(found)} times in the {region} region, expected exactly 1. "
        "Either the sentence was reworded (update the pattern in this guard alongside it) or it moved "
        "out of its region — an unanchored claim is an unguarded one.")
    return found[0]


def test_every_readme_count_matches_the_build():
    """Each stated count equals the figure the pipeline actually produces."""
    readme = _readme()
    figures = _figures()
    for label, region, pattern, names in CLAIMS:
        match = _matches(readme, label, region, pattern)
        assert len(match.groups()) == len(names), (
            f"{label!r}: pattern captures {len(match.groups())} numbers but declares {len(names)}")
        for raw, name in zip(match.groups(), names):
            stated = int(raw.replace(",", ""))
            built = figures[name]
            assert stated == built, (
                f"README {label} says {raw} {name.replace('_', ' ')}, but the build produces {built:,}. "
                "The README states the catalog size in three places and they have drifted apart before "
                "(#460) — correct every one of them, not just the one that failed.")


def test_the_build_figures_are_a_real_population():
    """Refuse to inspect zero records.

    Every assertion above is an equality, so a build that collapsed to nothing
    would still pass the moment the README happened to say zero. These are the
    catalog's headline sizes; none of them is legitimately small.
    """
    figures = _figures()
    floors = {
        "variants": 1000,
        "records": 1000,
        "augments": 100,
        "membership_sets": 10,
        "augment_sets": 10,
        "dino_inserts": 10,
    }
    assert set(floors) == set(figures), (sorted(floors), sorted(figures))
    for name, floor in floors.items():
        assert figures[name] >= floor, (
            f"metadata figure {name!r} is {figures[name]}, below the sanity floor {floor} — "
            "the build lost a population, or the metadata field moved")


def test_every_counted_capability_row_is_a_guarded_claim():
    """The guard's own completeness claim, asserted rather than asserted-in-prose.

    A count guard that only covers the claims someone remembered to declare
    drifts exactly the way the README did. Every numeric ✅ row in the capability
    table must fall inside a span some CLAIM matched.
    """
    readme = _readme()
    table = _capability_table(readme)

    guarded = []
    for label, region, pattern, _names in CLAIMS:
        if region != "table":
            continue
        guarded.append(_matches(readme, label, region, pattern).span())

    counted = list(re.finditer(r"✅ \*?\*?([\d,]+)", table))
    assert counted, "the capability table carries no numeric ✅ claims — did the table change shape?"
    for row in counted:
        start, end = row.span()
        covered = any(gs <= start and end <= ge for gs, ge in guarded)
        assert covered, (
            f"capability-table row claiming {row.group(1)!r} is not covered by any CLAIM in this guard. "
            "A counted row was added without a guard — declare it in CLAIMS with the metadata figure "
            "behind it, or the number is free to drift.")
