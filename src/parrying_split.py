"""U7 (#169) — expand the folded `Parrying` affix into the four stats it grants.

`Parrying` is not a stat. In game it names an enchantment granting an Insight
bonus to Armor Class *and* the same Insight bonus to all three saving throws.
Upstream stores it as a single affix named `Parrying`, so a player ranking
`Armor Class` scores nothing from any of the 139 items that carry it.

Worse, the stored magnitude is not always the granted amount. The enchantment
ships in two versions with the same name:

  * `{{Parrying|N}}`   (Arabic) -> `+N` Insight AC and `+N` Insight saves.
  * `{{Parrying|R}}`   (Roman)  -> a RANK. I -> 1, IV -> 2, VIII -> 4.

Nineteen items store `4` and one of them is Roman IV, so the stored number
carries no signal about which version an item has. That is why the version is
per-item wiki evidence in `data/seed/compendium/parrying_version.json` rather
than something this module derives — see KTD2 and
`docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`.

The Roman mapping is deliberately a three-entry lookup and not a formula. It is
not a uniform halving — I renders 1, not 0.5 or 0 — so any ratio fitted to the
three confirmed points would silently produce a number for a numeral nobody
checked. The shard's stored value is authoritative; the lookup here is the
guard's assertion (KTD5).

**The anti-shadow rule keys on stat plus stacking bucket, not on name** (KTD6).
Speed suppresses on name alone, which is safe there only because no Speed item
carries a `Movement Speed` affix. Here four Parrying items already carry a
Reflex Save typed `Quality` or `Resistance`, and `web/model.js` buckets by stat
plus stacking-equivalent type — so those stack with an Insight save rather than
competing with it, and a name-keyed rule would withhold a real contribution.

Scope note on the AC half: the folded affix is *renamed* into Armor Class rather
than added alongside one, so it is never shadow-checked. The 86 Parrying items
that already carry an Armor-, Shield-, or Deflection-typed Armor Class keep it
and gain a second, Insight-typed one — correct, because those are different
stacking buckets. An earlier reading of KTD6 put that 86 at risk from a
name-keyed rule; it never was, because renaming does not consult the shadow set.
The rule still has to be bucket-keyed for the saves.
"""
from __future__ import annotations

import re

from src import enchantment_split as _es
from src import vocabulary as _vocab
from src.enchantment_split import (  # noqa: F401
    STATED, DEFAULTED, UNSOURCED, snapshot_key, snapshot_for,
)

FOLDED_NAME = "Parrying"
AC_NAME = "Armor Class"
FORTITUDE_NAME = "Fortitude Save"
REFLEX_NAME = "Reflex Save"
WILL_NAME = "Will Save"
SAVE_NAMES = (FORTITUDE_NAME, REFLEX_NAME, WILL_NAME)

# `Parrying` names an enchantment, not a stat. Offering it as a rankable
# priority scores partially against what the player meant, the same confusion
# `Speed` was reported as in #154. The picker drops it and redirects to these.
EXPANDED_AWAY = {FOLDED_NAME.lower(): [AC_NAME, *SAVE_NAMES]}

# Wiki-confirmed individually, one rendered tooltip each. NOT a formula: I -> 1
# breaks every ratio that fits IV -> 2 and VIII -> 4. A numeral absent from this
# map is quarantined by the guard rather than extrapolated (KTD5, R5).
ROMAN_MAGNITUDE = {"I": 1, "IV": 2, "VIII": 4}


def _bucket(affix_type):
    """An affix type's stacking bucket, mirroring `equivType` in `web/model.js`.

    Both sides must agree on what "same bucket" means, or the split would
    suppress a contribution the solver would have stacked (or vice versa).
    """
    return _vocab.stacking_bucket(affix_type)


# All three saves read the same `saves` key — the enchantment grants one
# magnitude to all of them, and the Arabic tooltip does not even enumerate them.
_CONFIG = _es.SplitConfig(
    folded_name=FOLDED_NAME,
    primary_name=AC_NAME,
    primary_key="armor_class",
    primary_corrected_stat="armor_class_corrected",
    extras=(("saves", FORTITUDE_NAME, "fortitude_added"),
            ("saves", REFLEX_NAME, "reflex_added"),
            ("saves", WILL_NAME, "will_added")),
    shadow_key=_es.name_and_bucket(_bucket),
    label="parrying shard",
    dedupe_primary=True,
)

_INVOCATION = re.compile(r"^\{\{\s*parrying\s*\|\s*([0-9ivxlcdm]+)\s*\}\}$", re.I)

# Two tooltip dialects for one enchantment. Arabic collapses the saves into the
# word "Saves"; Roman enumerates all three. Both must read, and a tooltip
# matching neither must return None rather than a falsy zero — "unreadable" and
# "grants nothing" are different claims, and conflating them is what lets a
# reworded snapshot silently agree with an under-granting entry.
_TIP_AC = re.compile(r"\+(\d+)\s+Insight bonus to Armor Class", re.I)
_TIP_SAVES_ARABIC = re.compile(r"\+(\d+)\s+Insight bonus to Saves", re.I)
_TIP_SAVES_ROMAN = re.compile(
    r"\+(\d+)\s+Insight bonus to Fortitude, Reflex, and Will Saving throws", re.I)


def invocation_version(raw: str):
    """The version token of a `{{Parrying|X}}` invocation, or None if unparseable."""
    match = _INVOCATION.match((raw or "").strip())
    return match.group(1).upper() if match else None


def is_roman(raw: str) -> bool:
    version = invocation_version(raw)
    return bool(version) and not version.isdigit()


def tooltip_armor_class(tooltip: str):
    """The Insight AC a rendered tooltip states, or None when unreadable."""
    match = _TIP_AC.search(tooltip or "")
    return int(match.group(1)) if match else None


def tooltip_saves(tooltip: str):
    """The Insight save bonus a rendered tooltip states, or None when unreadable.

    Tries the Roman enumeration before the Arabic collapse; neither is a
    substring of the other, but keeping the order explicit documents that both
    dialects are real rather than one being a fallback for a parse failure.
    """
    text = tooltip or ""
    roman = _TIP_SAVES_ROMAN.search(text)
    if roman:
        return int(roman.group(1))
    arabic = _TIP_SAVES_ARABIC.search(text)
    return int(arabic.group(1)) if arabic else None


def audit_snapshots(shard: dict) -> dict:
    """Parrying's snapshot-coverage audit, over the shared skeleton."""
    return _es.audit_snapshots(shard, label="parrying shard")


def audit_shard(shard: dict) -> dict:
    """Parrying's harvest-suspect audit, over the shared skeleton."""
    return _es.audit_shard(shard, label="parrying shard")


def check_against_snapshots(shard: dict) -> dict:
    """Assert every derived value against the wiki's own rendered tooltip.

    Parrying keeps its own guard rather than sharing Speed's (KTD1): the
    dialects, the provenance rules, and the Roman lookup are all different, and
    a generalization that made both pass would have to drop assertions one of
    them needs.

    Three things are checked per entry, and the third is the one that matters:
    the derived AC and saves must equal what the tooltip states; the invocation
    must parse; and a **Roman** invocation's magnitude must equal the confirmed
    three-entry lookup. Without that last assertion "no fallback formula" is
    aspirational — a numeral outside I/IV/VIII would ride through on whatever
    number the harvest happened to record.

    Reports `compared` separately from `checked`, and refuses to pass when it is
    zero. `checked` counts entries the guard reached a verdict on, including
    quarantined ones verified to grant nothing; only `compared` counts a value
    actually matched against a parsed tooltip. Speed's guard increments its
    counter for an `unsourced` entry before any snapshot lookup, so a shard whose
    entries all failed to resolve returns a healthy-looking count having verified
    no magnitude at all — that is the vacuous pass this split avoids.

    Offline — reads only what is already on disk. Raises on an empty shard.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "parrying shard is empty — refusing to report a clean guard over zero records")

    problems = []
    checked = 0
    compared = 0
    stated = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        raw = entry.get("raw") or ""
        provenance = entry.get("provenance")
        value = entry.get("value") or {}

        # Unknown provenance is a defect, not a skip. A one-character retype
        # would otherwise fall past every branch while the classifier quarantines
        # the entry and silently drops its contribution.
        if provenance not in (STATED, DEFAULTED, UNSOURCED):
            problems.append(f"{title}: unknown provenance {provenance!r}")
            continue

        if provenance == STATED:
            stated += 1

        # Nothing on the wiki page to snapshot. Must grant nothing; audit_shard
        # reports it as a harvest suspect without failing the build.
        if provenance in (DEFAULTED, UNSOURCED):
            checked += 1
            if value.get("armor_class") is not None or value.get("saves") is not None:
                problems.append(
                    f"{title}: `{provenance}` entries must grant no armor class or saves")
            continue

        version = invocation_version(raw)
        if version is None:
            problems.append(f"{title}: {raw!r} is not a parsable Parrying invocation")
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

        tooltip = snapshot.get("tooltip")
        stated_ac = tooltip_armor_class(tooltip)
        stated_saves = tooltip_saves(tooltip)
        if stated_ac is None or stated_saves is None:
            problems.append(
                f"{title}: tooltip for {raw!r} matches no known dialect, so it "
                f"cannot verify anything: {(tooltip or '')[:80]!r}")
            continue

        checked += 1
        compared += 1

        if value.get("armor_class") != stated_ac:
            problems.append(
                f"{title}: derived armor_class={value.get('armor_class')!r} but the "
                f"tooltip states {stated_ac!r} for {raw!r}")
        if value.get("saves") != stated_saves:
            problems.append(
                f"{title}: derived saves={value.get('saves')!r} but the tooltip "
                f"states {stated_saves!r} for {raw!r}")

        if not version.isdigit():
            expected = ROMAN_MAGNITUDE.get(version)
            if expected is None:
                problems.append(
                    f"{title}: Roman version {version!r} is outside the confirmed "
                    "I/IV/VIII lookup — quarantine it rather than extrapolating")
            elif stated_ac != expected:
                problems.append(
                    f"{title}: Parrying {version} must grant {expected}, but its "
                    f"tooltip states {stated_ac}")

    # Every `stated` entry must have reached a comparison. Each failure path
    # above already appends a problem, so this is belt-and-braces — it catches a
    # future branch that skips an entry without recording why.
    if compared < stated:
        problems.append(
            f"{stated - compared} `stated` entr(ies) were never compared against a "
            "tooltip — the guard cannot vouch for them")

    # Refuse to report a clean run that verified no magnitude — but only when the
    # run is otherwise clean, so a real diagnosis is never buried behind this.
    if not compared and not problems:
        raise ValueError(
            "parrying guard compared no derived value against a tooltip — refusing to pass")

    return {"checked": checked, "compared": compared, "problems": problems}


def apply(records, shard: dict) -> dict:
    """Expand the folded `Parrying` affix on every ITEM record the shard covers.

    Joins by item **name**: both affix pages group their items by version, and
    the name is the key that grouping publishes. Records with no `Parrying`
    affix are untouched, as are records absent from the shard — they keep the
    folded affix and increment `uncovered`, so the gap stays visible rather than
    the split inventing a reading.
    """
    return _es.rewrite_all(records, shard, lambda rec: rec.get("name"), _CONFIG)
