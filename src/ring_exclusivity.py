"""#566 — which rings may be worn twice, as a blocklist over harvested evidence.

**A ring may be worn twice unless it is Exclusive or a Minor Artifact.** Both
disqualifiers are recorded per item by ddowiki as maintained categories, so this
is a read rather than an inference. Evidence and method:
`docs/wiki-evidence/ring-exclusivity.md`.

This replaces `duplicable_rings.py`, which asked the opposite question. #442
searched every set-member ring page for a per-item `Unique Equipped` flag and
correctly reported that none exists — and, reading free-text `tips` where an
absent sentence really did mean nobody had written one, refused to read the
silence. It shipped an allowlist of two rings.

The absence was structural. Duplicability is not a per-item property; it is the
absence of two others, and both of those are recorded. Restricted to the rings a
second copy can help — those carrying a set bonus — the population is 100
duplicable, 36 Exclusive, 3 Minor Artifact.

**Why reading the negative is sound here, when #442's refusal was also right.**
`Template:Bind` documents its `exclusive` parameter with an explicit default of
false, and all 435 ring pages affirmatively record a binding — 0 missing, 0
without the parameter, 0 blank. So "not in `Category:Exclusive`" means "this page
records a binding, and that binding does not set exclusive": a stated fact, not a
gap. Had any page been silent, that page would need quarantining individually
rather than defaulting, which is what `check` asserts on every build.

**Fail-closed survives the polarity flip.** It moves rather than disappearing: an
item absent from the shard is refused, exactly as before. The difference is that
coverage is now total, so the refusal fires on nothing today — and `check` fails
the build if that ever stops being true, rather than letting rings quietly fall
through to a default. Wrongly allowing a duplicate still produces a loadout the
player cannot equip, which remains this project's worst output.

**Do not re-derive these values by text-matching the bind wikitext.**
`Template:Bind` takes the exclusive flag as a bare positional argument, so only 2
of the 45 Exclusive rings spell the word: a text-match finds 2 and misses 43. The
template-computed category is the only correct read. The first pass of the
harvest made exactly that error.
"""
from __future__ import annotations

import json
import os

#: The legacy #442 allowlist, kept as CORROBORATION rather than as input. Its two
#: rings were confirmed duplicable from a completely different field (verbatim
#: `tips` prose), so the blocklist reproducing them is a standing predictive test
#: of the rule — see `check`. It is not consulted to decide anything.
CORROBORATION_SHARD = "duplicable_rings.json"


def load(path: str) -> dict:
    """Read the shard. Raises if it is missing or has no entries."""
    if not os.path.exists(path):
        raise SystemExit(f"ring exclusivity shard not found: {path}")
    with open(path) as fh:
        shard = json.load(fh)
    if not (shard.get("harvested") or {}):
        raise SystemExit(
            "ring exclusivity shard is empty — refusing to build a gate over zero "
            "records. An empty shard reads as 'no ring is duplicable', which would "
            "silently disable #335 rather than narrow it")
    return shard


def load_corroboration(path: str) -> dict:
    """Read #442's retired allowlist as `name -> verbatim citation`.

    Read for corroboration only — never to decide duplicability. Its two rings
    were confirmed from a different field entirely (free-text `tips` prose), so
    requiring the blocklist to reproduce them is a predictive test of the rule
    against evidence the rule was not derived from.

    Raises if it is missing or names nothing: an empty corroboration set would
    assert nothing while reading as though it had passed.
    """
    if not os.path.exists(path):
        raise SystemExit(f"duplicable-ring corroboration shard not found: {path}")
    with open(path) as fh:
        shard = json.load(fh)
    out = {}
    for name, entry in (shard.get("harvested") or {}).items():
        entry = entry or {}
        if entry.get("provenance") != "stated":
            continue
        if (entry.get("value") or {}).get("duplicable") is True:
            out[name] = entry.get("raw") or ""
    if not out:
        raise SystemExit(
            f"corroboration shard {path} names no duplicable ring — refusing to run a "
            "cross-check that would assert nothing while reporting success")
    return out


def _stated(shard: dict):
    """The entries whose provenance is `stated`, keyed by name."""
    out = {}
    for name, entry in (shard.get("harvested") or {}).items():
        entry = entry or {}
        if entry.get("provenance") == "stated":
            out[name] = entry.get("value") or {}
    return out


def duplicable_names(shard: dict) -> set:
    """Names the wiki's recorded categories leave duplicable.

    Only `stated` provenance counts, and only the boolean True — a stray truthy
    value is unverified input, not a reading.
    """
    return {n for n, v in _stated(shard).items() if v.get("duplicable") is True}


def blocked_names(shard: dict) -> dict:
    """`name -> reason` for every ring the shard disqualifies. Reporting only."""
    out = {}
    for name, v in _stated(shard).items():
        if v.get("exclusive") is True and v.get("minor_artifact") is True:
            out[name] = "Exclusive and a Minor Artifact"
        elif v.get("exclusive") is True:
            out[name] = "Exclusive"
        elif v.get("minor_artifact") is True:
            out[name] = "a Minor Artifact"
    return out


def _rings(variants):
    return [v for v in variants or [] if v.get("slot") == "Ring"]


def _name(rec):
    return rec.get("source_item") or rec.get("variant_id")


def _wiki_name(rec, identity):
    """The name whose ddowiki page this record describes.

    A `X [Crafted]` record is one game item's second state, not a second item —
    it has no page of its own, so its exclusivity is its base's. Resolution goes
    through the identity map `crafted_twins.derive` already built, NOT through a
    suffix test: that module refuses a bare string heuristic for the reason it
    would keep passing after the relationship it assumes stops holding, and a
    second copy of the rule here would be exactly that.
    """
    n = _name(rec)
    return (identity or {}).get(n, n)


def check(shard: dict, variants, corroboration: dict | None = None,
          identity: dict | None = None) -> dict:
    """Validate the shard against the catalog it will be stamped onto.

    Four assertions, each of which has a specific way of going wrong:

    * **Coverage.** Every Ring in the catalog appears in the shard. This is the
      assertion that keeps the evidence doc's "426 of 426" from going stale
      silently: both sides are readable at build time, so a new ring arriving
      from an upstream refresh fails the build instead of quietly inheriting a
      default. (`a-dated-coverage-claim-cannot-notice-its-own-staleness`.)
    * **Artifact agreement.** The shard's Minor Artifact set must equal the set of
      catalog rings flagged `artifact`. Two independent sources — the wiki's
      categories and gear-planner's own boolean — agree exactly today. Drift
      between them is a review event, not something to reconcile automatically.
    * **Corroboration.** Every ring the retired #442 allowlist named must still
      come out duplicable. Those two were confirmed from unrelated evidence, so
      this is the rule's predictive test, standing rather than hand-run.
    * **Shape.** A named entry that resolves to a non-Ring is a stale claim.

    Problems are returned rather than raised so the caller reports them all at
    once.
    """
    problems = []
    stated = _stated(shard)
    rings = _rings(variants)

    # Coverage — a Ring the harvest never saw must not fall through to a default.
    uncovered = sorted({_wiki_name(r, identity) for r in rings
                        if _wiki_name(r, identity) not in stated})
    for n in uncovered[:10]:
        problems.append(
            f"{n!r} is a Ring in the catalog with no entry in the exclusivity shard. "
            "It cannot be read as duplicable or as blocked, so the harvest is stale — "
            "re-harvest rather than letting it inherit a default")
    if len(uncovered) > 10:
        problems.append(f"... and {len(uncovered) - 10} more uncovered Ring(s)")

    # Artifact agreement between two independent sources.
    shard_artifacts = {n for n, v in stated.items() if v.get("minor_artifact") is True}
    catalog_names = {_wiki_name(r, identity) for r in rings}
    shard_artifacts_here = shard_artifacts & catalog_names
    catalog_artifacts = {_wiki_name(r, identity) for r in rings if r.get("artifact")}
    for n in sorted(shard_artifacts_here - catalog_artifacts):
        problems.append(
            f"{n!r} is a Minor Artifact per the wiki categories but is not flagged "
            "`artifact` in the catalog — the two sources have drifted")
    for n in sorted(catalog_artifacts - shard_artifacts_here):
        problems.append(
            f"{n!r} is flagged `artifact` in the catalog but is not a Minor Artifact "
            "per the wiki categories — the two sources have drifted")

    # Corroboration: the retired allowlist's rings must survive the new rule.
    dup = duplicable_names(shard)
    for n in sorted(corroboration or {}):
        if n not in stated:
            problems.append(
                f"{n!r} was confirmed duplicable by #442's independent evidence but is "
                "absent from the exclusivity shard")
        elif n not in dup:
            problems.append(
                f"{n!r} was confirmed duplicable by #442's independent evidence "
                f"(verbatim wiki tips) but this shard blocks it — the blocklist "
                "contradicts a reading it must reproduce")

    # Shape: a named entry that is in the catalog must still be a Ring.
    by_name = {}
    for v in variants or []:
        by_name.setdefault(_name(v), []).append(v)
    for n in sorted(stated):
        for rec in by_name.get(n) or []:
            if rec.get("slot") != "Ring":
                problems.append(
                    f"{n!r} is named in the exclusivity shard but is no longer a Ring "
                    f"(slot {rec.get('slot')!r}) — the duplicate-wear rule is specific "
                    "to the two-Ring slot")
                break

    return {
        "rings_in_catalog": len(rings),
        "covered": len(catalog_names & set(stated)),
        "uncovered": len(uncovered),
        "duplicable": len(dup & catalog_names),
        "blocked": len(catalog_names) - len(dup & catalog_names),
        "corroborated": len(corroboration or {}),
        "problems": problems,
    }


def apply(variants, shard: dict, identity: dict | None = None) -> dict:
    """Stamp `duplicable_ring: True` on every ring the rule leaves duplicable.

    Three conditions, all required: the Ring slot, a `set_bonus`, and a duplicable
    reading. The set-bonus condition is not a duplicability claim — a second copy
    of a set-less ring simply buys nothing, because duplicate affixes at the same
    name and bonus type collapse to a max rather than summing, so stamping one
    would add a solver variable that can never pay for itself.

    Only the true case is stamped. An absent field is the fail-closed default, and
    writing `False` on nine thousand records would carry no more information while
    inviting a reader to treat the flag as harvested for all of them.
    """
    names = duplicable_names(shard)
    stamped = 0
    setless = 0
    for v in variants or []:
        if v.get("slot") != "Ring" or _wiki_name(v, identity) not in names:
            continue
        if not (v.get("set_bonus") or []):
            setless += 1
            continue
        v["duplicable_ring"] = True
        stamped += 1
    return {"names": len(names), "stamped": stamped, "duplicable_but_setless": setless}
