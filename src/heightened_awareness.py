"""U3 (#169) — expand the folded `Heightened Awareness` affix into Armor Class.

`Heightened Awareness` is an enchantment name, not a stat. It grants exactly one
thing — an Insight bonus to AC — so a player ranking `Armor Class` scored
nothing from any of the 26 items carrying it.

Simpler than its sibling `src/parrying_split.py` in two ways, both of which are
properties of this enchantment rather than shortcuts:

  * **One output, not four.** The rendered tooltip says "You gain a +N Insight
    bonus to AC" and nothing else. Parrying's saves clause has no analogue here,
    and inventing one would be exactly the inference this project forbids.
  * **No version branch.** The wiki lists Arabic ranks 1 through 6 and no Roman
    variant, and every rank's stored magnitude equals its rank. That is a
    harvested fact, not an assumption: the guard still asserts each derived
    value against its own rendered tooltip, so a Roman variant appearing in a
    future harvest fails rather than being read as Arabic.

The anti-shadow rule is type-aware for the same reason as Parrying (KTD6): nine
of the 26 items already carry an Armor- or Primal-Natural-typed Armor Class,
which stacks with an Insight one rather than competing with it.

The wiki records a cross-affix interaction on this page: *"Does not stack with
the insight bonus to AC provided by the parrying suffix."* No special case
implements that. Both affixes emit `Armor Class` typed `Insight`, and the
solver's bucket-max core caps each (stat, bonus_type) bucket at one contributor
— so the rule enforces itself for as long as both keep emitting the same stat
under the same type. Retyping either one would silently restore double-counting.
"""
from __future__ import annotations

import re

from src import enchantment_split as _es
from src import vocabulary as _vocab
from src.enchantment_split import (  # noqa: F401
    STATED, DEFAULTED, UNSOURCED, snapshot_key, snapshot_for,
)

FOLDED_NAME = "Heightened Awareness"
AC_NAME = "Armor Class"

EXPANDED_AWAY = {FOLDED_NAME.lower(): [AC_NAME]}


def _bucket(affix_type):
    """An affix type's stacking bucket, mirroring `equivType` in `web/model.js`."""
    return _vocab.stacking_bucket(affix_type)


_CONFIG = _es.SplitConfig(
    folded_name=FOLDED_NAME,
    primary_name=AC_NAME,
    primary_key="armor_class",
    primary_corrected_stat="armor_class_corrected",
    extras=(),
    shadow_key=_es.name_and_bucket(_bucket),
    label="heightened awareness shard",
    dedupe_primary=True,
)

_INVOCATION = re.compile(r"^\{\{\s*heightened awareness\s*\|\s*([0-9ivxlcdm]+)\s*\}\}$", re.I)
_TIP_AC = re.compile(r"\+(\d+)\s+Insight bonus to AC\b", re.I)


def invocation_version(raw: str):
    """The rank token of a `{{Heightened Awareness|N}}` invocation, or None."""
    match = _INVOCATION.match((raw or "").strip())
    return match.group(1).upper() if match else None


def tooltip_armor_class(tooltip: str):
    """The Insight AC a rendered tooltip states, or None when unreadable.

    None means "this text proves nothing", which is not the same claim as zero.
    Conflating them lets a blank or reworded snapshot agree with an
    under-granting entry — the silent pass this guard exists to prevent.
    """
    match = _TIP_AC.search(tooltip or "")
    return int(match.group(1)) if match else None


def audit_snapshots(shard: dict) -> dict:
    return _es.audit_snapshots(shard, label="heightened awareness shard")


def audit_shard(shard: dict) -> dict:
    return _es.audit_shard(shard, label="heightened awareness shard")


def check_against_snapshots(shard: dict) -> dict:
    """Assert every derived value against the wiki's own rendered tooltip.

    Keeps its own guard rather than sharing Parrying's (KTD1): the tooltip
    dialect differs, there is no saves clause, and there is no Roman lookup. A
    generalization covering both would have to drop an assertion one of them
    needs.

    Reports `compared` separately from `checked`. `checked` counts entries the
    guard reached a verdict on, including quarantined ones that were verified to
    grant nothing; `compared` counts only values actually matched against a
    parsed tooltip. A shard whose entries all failed to resolve a snapshot would
    otherwise return a healthy-looking count having verified no magnitude at all.

    Offline — reads only what is already on disk. Raises on an empty shard.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "heightened awareness shard is empty — refusing to report a clean "
            "guard over zero records")

    problems = []
    checked = 0
    compared = 0
    stated = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        raw = entry.get("raw") or ""
        provenance = entry.get("provenance")
        value = entry.get("value") or {}

        if provenance not in (STATED, DEFAULTED, UNSOURCED):
            problems.append(f"{title}: unknown provenance {provenance!r}")
            continue

        if provenance == STATED:
            stated += 1

        # R2: a rank whose tooltip nobody harvested is quarantined. gear-planner's
        # stored number is not evidence — the affix page has to state it.
        if provenance in (DEFAULTED, UNSOURCED):
            checked += 1
            if value.get("armor_class") is not None:
                problems.append(
                    f"{title}: `{provenance}` entries must grant no armor class")
            continue

        version = invocation_version(raw)
        if version is None:
            problems.append(
                f"{title}: {raw!r} is not a parsable Heightened Awareness invocation")
            continue
        if version != str(value.get("version", "")).upper():
            problems.append(
                f"{title}: recorded version {value.get('version')!r} disagrees with "
                f"its own invocation {raw!r}")
            continue

        snapshot = snapshot_for(shard, raw)
        if snapshot is None:
            problems.append(f"{title}: no tooltip snapshot for {raw!r}")
            continue

        stated_ac = tooltip_armor_class(snapshot.get("tooltip"))
        if stated_ac is None:
            problems.append(
                f"{title}: tooltip for {raw!r} matches no known dialect, so it cannot "
                f"verify anything: {(snapshot.get('tooltip') or '')[:80]!r}")
            continue

        checked += 1
        compared += 1
        if value.get("armor_class") != stated_ac:
            problems.append(
                f"{title}: derived armor_class={value.get('armor_class')!r} but the "
                f"tooltip states {stated_ac!r} for {raw!r}")

    if compared < stated:
        problems.append(
            f"{stated - compared} `stated` entr(ies) were never compared against a "
            "tooltip — the guard cannot vouch for them")

    if not compared and not problems:
        raise ValueError(
            "heightened awareness guard compared no derived value against a tooltip "
            "— refusing to pass")

    return {"checked": checked, "compared": compared, "problems": problems}


def apply(records, shard: dict) -> dict:
    """Expand the folded affix on every ITEM record the shard covers, joining by name."""
    return _es.rewrite_all(records, shard, lambda rec: rec.get("name"), _CONFIG)
