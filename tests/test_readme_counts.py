"""README catalog-count drift guard: variant and seed-record claims.

README states the catalog size in several places. Those numbers describe a
GENERATED population — `metadata.variant_count` and `metadata.seed_count` are
stamped into the dataset by every build — but the README copies are maintained
by hand, so nothing stopped them drifting apart from the thing they describe.

They did drift (#460). Two of the three variant claims and one of the two
record claims sat two behind the build, and README contradicted itself 119
lines apart: the opening pitch said 9,108 variants from 8,034 records while
its own State line said 9,110 from 8,036. A reader who checked one against the
other found two answers and no way to tell which was live.

This is the failure mode `a-dated-coverage-claim-cannot-notice-its-own-
staleness.md` describes, and the answer the same: a claim about a population
that is readable at build time gets asserted, not dated. The build already
carries the right numbers — this guard just refuses to let the prose disagree
with them.

SCOPE — variants and seed records only. README also counts augments, and that
word covers at least two different populations in this file (the capability
table's total roster, and a point-in-time figure inside a historical "Latest
work" note). A guard cannot compare a number to a stamped field without first
knowing which population it is a claim about, so augments are deliberately out
until each site is pinned to a field.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# "9,110 variants", "**9,110 gear variants**" — the qualifier between the
# number and the noun is prose that has already been reworded once.
VARIANTS_RE = re.compile(r"([\d,]+)\s+(?:gear\s+)?variants")
# "8,036 gear-planner records", "8,034 wiki-sourced records". The qualifier
# words must start with a LETTER: `[\w-]+` would happily consume a second,
# unformatted number, so "9,110 variants from 8036 records" would report the
# variant count as a record claim and compare the wrong figure to the wrong field.
RECORDS_RE = re.compile(r"([\d,]+)\s+(?:[a-zA-Z][\w-]*\s+){0,3}records")

# How many claim sites each pattern is known to reach. A guard that inspects
# nothing passes; so does one whose regex silently stopped matching two of
# three sites while both stale numbers stayed on the page. If a claim is
# legitimately removed, lower these in the same commit — deliberately.
MIN_VARIANT_SITES = 3
MIN_RECORD_SITES = 2

_METADATA = None


def _metadata():
    """Build once — the dataset takes ~3s and every assertion wants the same one."""
    global _METADATA
    if _METADATA is None:
        _METADATA = build_dataset.build()["metadata"]
    return _METADATA


def _readme_lines():
    with open(os.path.join(ROOT, "README.md"), "r", encoding="utf-8") as fh:
        return fh.read().splitlines()


def _claims(pattern):
    """Every (line_number, claimed_int) the pattern reaches, 1-indexed."""
    found = []
    for lineno, line in enumerate(_readme_lines(), start=1):
        for match in pattern.finditer(line):
            found.append((lineno, int(match.group(1).replace(",", ""))))
    return found


def _assert_claims_match(pattern, field, minimum, noun):
    claims = _claims(pattern)
    assert len(claims) >= minimum, (
        f"README carries {len(claims)} {noun} claim(s); this guard is written against "
        f"at least {minimum}. Either a claim was removed — lower the minimum in the "
        f"same commit — or the prose was reworded past the pattern, which would let a "
        f"stale number sit on the page unchecked. Refusing to pass on an empty read.")
    built = _metadata()[field]
    wrong = [(lineno, claimed) for lineno, claimed in claims if claimed != built]
    assert not wrong, (
        f"README {noun} claim(s) disagree with the built dataset "
        f"(metadata.{field} = {built:,}): "
        + "; ".join(f"README.md:{lineno} says {claimed:,}" for lineno, claimed in wrong)
        + ". These describe a generated population — correct the prose to the build, "
          "not the other way round.")


def test_readme_variant_counts_match_the_built_catalog():
    """Every "N variants" in README is a claim about `metadata.variant_count`."""
    _assert_claims_match(VARIANTS_RE, "variant_count", MIN_VARIANT_SITES, "variant")


def test_readme_seed_record_counts_match_the_built_catalog():
    """Every "N ... records" in README is a claim about `metadata.seed_count`."""
    _assert_claims_match(RECORDS_RE, "seed_count", MIN_RECORD_SITES, "seed-record")


def test_the_two_stamped_counts_are_present_and_plausible():
    """The guard is only as good as the fields it reads — pin that they exist.

    If a pipeline change dropped either field, `_assert_claims_match` would die
    with a KeyError that reads as a broken test rather than a moved contract.
    """
    meta = _metadata()
    for field in ("variant_count", "seed_count"):
        assert isinstance(meta.get(field), int) and meta[field] > 0, (
            f"metadata.{field} is missing or non-positive ({meta.get(field)!r}) — the "
            "README count guard has nothing to compare against")
    assert meta["variant_count"] >= meta["seed_count"], (
        f"variant_count ({meta['variant_count']}) below seed_count ({meta['seed_count']}) "
        "— variants expand from seed records, so this inverts the pipeline's direction")
