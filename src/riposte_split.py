"""#546 — expand the folded `Riposte` affix into the four stats it grants.

`Riposte` is not a stat. In game it names a suffix enchantment granting an
Insight bonus to Armor Class *and* an Insight bonus to all three saving throws.
Upstream stores it as a single affix named `Riposte`, so a player ranking
`Armor Class` or any save scored nothing from the 35 records that carry it. That
is the defect #169 fixed for `Parrying`; this is its sibling, reported by a
player who had to rank the literal name `Riposte` as a workaround.

**The two halves are NOT the same number, and that is what makes this different
from Parrying.** The wiki states the passive as:

    +X/2 (round up)   Insight bonus to Armor Class
    +X/2 (round down) Insight bonus to Fortitude, Reflex, and Will Saving Throws

so every odd Roman numeral grants MORE Armor Class than saves — `Riposte IX` is
+5 AC and +4 saves. `src/parrying_split.py` reads one `saves` magnitude equal to
its `armor_class` one because Parrying really does grant the same to both;
copying that assumption across would silently over-grant the saves on V, VII, IX
and XI. The shared `SplitConfig` already supports this: `armor_class` and
`saves` are separate keys inside the shard entry's `value`, so the asymmetry
lives in the harvested data rather than in a second code path.

Like Parrying, the enchantment ships in two dialects under one name:

  * `{{Riposte|N}}`  (Arabic) -> `+N` Insight AC and `+N` Insight saves.
  * `{{Riposte|R}}`  (Roman)  -> a RANK, halved per the rule above.

and the stored magnitude carries no signal about which. `Emerald Twilight`
(Roman VII) and `Legendary Planar Lariat` (Arabic +7) both store `7`; the first
grants 4 AC and 3 saves, the second grants 7 and 7. That is why the version is
per-item wiki evidence in `data/seed/compendium/riposte_version.json` rather
than something this module derives — see
`docs/wiki-evidence/riposte-versions.md`.

The Roman mapping is a lookup, not a formula, for the same reason Parrying's is.
All eleven numerals the catalog uses were rendered individually and all eleven
happen to fit `X/2`, but a numeral nobody has rendered must be quarantined
rather than computed — the shard's stored value is authoritative and the lookup
here is the guard's assertion. There is deliberately **no `I` entry**: the wiki
lists no `Riposte I`, so extrapolating one would invent a value.

**The anti-shadow rule keys on stat plus stacking bucket, not on name.** Sixteen
Riposte records already carry a separate `Armor Class` affix, most of them typed
`Shield` or `Enhancement` — different stacking buckets, which must keep stacking
with an Insight one. A name-keyed rule would withhold a real contribution. This
is `parrying_split.py`'s KTD6 reused verbatim rather than re-derived.

**Nothing here implements "does not stack with Parrying."** The wiki notes
Riposte and Parrying are the same effect and do not stack. No special case is
needed: both emit `Armor Class` and the three saves typed `Insight`, and the
solver's bucket-max core caps every `(stat, bonus_type)` bucket at one
contributor, so the rule enforces itself — exactly as it already does between
Parrying and Heightened Awareness. It holds only while all three keep emitting
the same stats under the same bonus type; retyping any of them would silently
restore double-counting. `tests/test_riposte_split.py` pins the emission and
`tests/solver.test.js` pins the non-stacking against shipped data.

**There is no set-bonus path.** Parrying has `expand_set_bonuses` because a set
tier grants `Parrying N`. No set bonus in the catalog grants `Riposte` — zero
`parsed_set_bonuses` affixes and zero raw `set_bonus` mentions — so adding one
here would be a dormant guard protecting a path the shipping dataset never uses,
which is what #225 is open about. Add it when a set actually grants it.

Scope note: the enchantment also procs damage on a miss ("When Missed by an
attack: Deals X to 4X damage to your attacker"). That is unmodelled and stays
that way — proc valuation is #331, not this split.
"""
from __future__ import annotations

import re

from src import enchantment_split as _es
from src import vocabulary as _vocab
from src.enchantment_split import (  # noqa: F401
    STATED, DEFAULTED, UNSOURCED, snapshot_key, snapshot_for,
)

FOLDED_NAME = "Riposte"
AC_NAME = "Armor Class"
FORTITUDE_NAME = "Fortitude Save"
REFLEX_NAME = "Reflex Save"
WILL_NAME = "Will Save"
SAVE_NAMES = (FORTITUDE_NAME, REFLEX_NAME, WILL_NAME)

# `Riposte` names an enchantment, not a stat. Offering it as a rankable priority
# scores partially against what the player meant — the same confusion `Speed` was
# reported as in #154 and `Parrying` in #169. The picker drops it and redirects to
# these, and a saved character that already ranked the literal name migrates
# through the same `migratePriorities` path every other expanded-away name uses.
EXPANDED_AWAY = {FOLDED_NAME.lower(): [AC_NAME, *SAVE_NAMES]}

# Wiki-confirmed individually, one rendered tooltip each (2026-08-27). NOT a
# formula: a numeral absent from this map is quarantined by the guard rather than
# extrapolated. `armor_class` and `saves` differ on every odd numeral, which is
# the whole reason this table stores a pair instead of one number.
ROMAN_MAGNITUDE = {
    "II":   {"armor_class": 1, "saves": 1},
    "III":  {"armor_class": 2, "saves": 1},
    "IV":   {"armor_class": 2, "saves": 2},
    "V":    {"armor_class": 3, "saves": 2},
    "VI":   {"armor_class": 3, "saves": 3},
    "VII":  {"armor_class": 4, "saves": 3},
    "VIII": {"armor_class": 4, "saves": 4},
    "IX":   {"armor_class": 5, "saves": 4},
    "X":    {"armor_class": 5, "saves": 5},
    "XI":   {"armor_class": 6, "saves": 5},
    "XII":  {"armor_class": 6, "saves": 6},
}


def _bucket(affix_type):
    """An affix type's stacking bucket, mirroring `equivType` in `web/model.js`.

    Both sides must agree on what "same bucket" means, or the split would
    suppress a contribution the solver would have stacked (or vice versa).
    """
    return _vocab.stacking_bucket(affix_type)


# All three saves read the same `saves` key — the enchantment grants one save
# magnitude to all of them. The AC half reads its own `armor_class` key, because
# on this enchantment the two genuinely differ.
_CONFIG = _es.SplitConfig(
    folded_name=FOLDED_NAME,
    primary_name=AC_NAME,
    primary_key="armor_class",
    primary_corrected_stat="armor_class_corrected",
    extras=(("saves", FORTITUDE_NAME, "fortitude_added"),
            ("saves", REFLEX_NAME, "reflex_added"),
            ("saves", WILL_NAME, "will_added")),
    shadow_key=_es.name_and_bucket(_bucket),
    label="riposte shard",
    dedupe_primary=True,
    rename_requires_stated=True,
)

_INVOCATION = re.compile(r"^\{\{\s*riposte\s*\|\s*([0-9ivxlcdm]+)\s*\}\}$", re.I)

# Two tooltip dialects for one enchantment, and unlike Parrying they are not
# merely two spellings of the same grant. Arabic collapses BOTH halves into one
# number ("to AC and to Saves"); Roman states the two halves separately, and they
# differ. A tooltip matching neither must return None rather than a falsy zero —
# "unreadable" and "grants nothing" are different claims, and conflating them is
# what lets a reworded snapshot silently agree with an under-granting entry.
_TIP_ARABIC_BOTH = re.compile(
    r"granting a \+(\d+)\s+Insight bonus to AC and to Saves", re.I)
_TIP_ROMAN_AC = re.compile(r"\+(\d+)\s+Insight bonus to Armor Class", re.I)
_TIP_ROMAN_SAVES = re.compile(
    r"\+(\d+)\s+Insight bonus to Fortitude, Reflex, and Will Saving throws", re.I)


def invocation_version(raw: str):
    """The version token of a `{{Riposte|X}}` invocation, or None if unparseable."""
    match = _INVOCATION.match((raw or "").strip())
    return match.group(1).upper() if match else None


def is_roman(raw: str) -> bool:
    version = invocation_version(raw)
    return bool(version) and not version.isdigit()


def tooltip_armor_class(tooltip: str):
    """The Insight AC a rendered tooltip states, or None when unreadable.

    Tries the Roman dialect before the Arabic collapse. Neither is a substring of
    the other, but keeping the order explicit documents that both are real rather
    than one being a fallback for a parse failure.
    """
    text = tooltip or ""
    roman = _TIP_ROMAN_AC.search(text)
    if roman:
        return int(roman.group(1))
    arabic = _TIP_ARABIC_BOTH.search(text)
    return int(arabic.group(1)) if arabic else None


def tooltip_saves(tooltip: str):
    """The Insight save bonus a rendered tooltip states, or None when unreadable."""
    text = tooltip or ""
    roman = _TIP_ROMAN_SAVES.search(text)
    if roman:
        return int(roman.group(1))
    arabic = _TIP_ARABIC_BOTH.search(text)
    return int(arabic.group(1)) if arabic else None


def audit_snapshots(shard: dict) -> dict:
    """Riposte's snapshot-coverage audit, over the shared skeleton."""
    return _es.audit_snapshots(shard, label="riposte shard")


def audit_shard(shard: dict) -> dict:
    """Riposte's harvest-suspect audit, over the shared skeleton."""
    return _es.audit_shard(shard, label="riposte shard")


def check_against_snapshots(shard: dict) -> dict:
    """Assert every derived value against the wiki's own rendered tooltip.

    Riposte keeps its own guard rather than sharing Parrying's, for the reason
    Parrying does not share Speed's (KTD1): the dialects differ, and Parrying's
    guard checks only that a Roman numeral's *AC* matches its lookup. Reusing it
    here would leave the saves half — the half that differs — unasserted on every
    Roman entry, which is precisely the value most likely to be wrong.

    Four things are checked per entry:
      * the derived AC and saves each equal what the tooltip states;
      * the invocation parses and agrees with the recorded version;
      * an **Arabic** invocation's tooltip states its own numeral for BOTH halves,
        so a snapshot filed under the wrong key cannot compare clean;
      * a **Roman** invocation's AC *and* saves both equal the confirmed lookup.

    Reports `compared` separately from `checked`, and refuses to pass when it is
    zero. `checked` counts entries the guard reached a verdict on, including
    quarantined ones verified to grant nothing; only `compared` counts a value
    actually matched against a parsed tooltip.

    Offline — reads only what is already on disk. Raises on an empty shard.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "riposte shard is empty — refusing to report a clean guard over zero records")

    problems = []
    checked = 0
    compared = 0
    stated = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        raw = entry.get("raw") or ""
        provenance = entry.get("provenance")
        value = entry.get("value") or {}

        # Unknown provenance is a defect, not a skip. A one-character retype would
        # otherwise fall past every branch while the classifier quarantines the
        # entry and silently drops its contribution.
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
            problems.append(f"{title}: {raw!r} is not a parsable Riposte invocation")
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

        if version.isdigit():
            # Arabic states its own magnitude for both halves: `{{Riposte|4}}`
            # renders "+4 ... to AC and to Saves". Tie the two together, or the
            # guard only proves a tooltip agrees with itself. Without this, a
            # snapshot harvested under the wrong key compares clean and ships the
            # wrong number to every item at that rank with the build green.
            if stated_ac != int(version):
                problems.append(
                    f"{title}: {raw!r} is Arabic, so it must state +{version}, but "
                    f"its tooltip states +{stated_ac} armor class — the snapshot is "
                    "paired with the wrong invocation")
            if stated_saves != int(version):
                problems.append(
                    f"{title}: {raw!r} is Arabic, so it must state +{version} saves, "
                    f"but its tooltip states +{stated_saves}")
        else:
            expected = ROMAN_MAGNITUDE.get(version)
            if expected is None:
                problems.append(
                    f"{title}: Roman version {version!r} is outside the confirmed "
                    f"{'/'.join(ROMAN_MAGNITUDE)} lookup — quarantine it rather "
                    "than extrapolating")
            else:
                # BOTH halves, not just AC. The saves half is the one that differs
                # from the AC half on odd numerals, so leaving it unasserted would
                # leave the likeliest error unguarded.
                if stated_ac != expected["armor_class"]:
                    problems.append(
                        f"{title}: Riposte {version} must grant "
                        f"{expected['armor_class']} armor class, but its tooltip "
                        f"states {stated_ac}")
                if stated_saves != expected["saves"]:
                    problems.append(
                        f"{title}: Riposte {version} must grant {expected['saves']} "
                        f"saves, but its tooltip states {stated_saves}")

    # Every `stated` entry must have reached a comparison. Each failure path above
    # already appends a problem, so this is belt-and-braces — it catches a future
    # branch that skips an entry without recording why.
    if compared < stated:
        problems.append(
            f"{stated - compared} `stated` entr(ies) were never compared against a "
            "tooltip — the guard cannot vouch for them")

    # Refuse to report a clean run that verified no magnitude — but only when the
    # run is otherwise clean, so a real diagnosis is never buried behind this.
    if not compared and not problems:
        raise ValueError(
            "riposte guard compared no derived value against a tooltip — refusing to pass")

    return {"checked": checked, "compared": compared, "problems": problems}


def apply(records, shard: dict) -> dict:
    """Expand the folded `Riposte` affix on every ITEM record the shard covers.

    Joins by item **name**: the affix page groups its items by version, and the
    name is the key that grouping publishes. Records with no `Riposte` affix are
    untouched, as are records absent from the shard — they keep the folded affix
    and increment `uncovered`, so the gap stays visible rather than the split
    inventing a reading.
    """
    return _es.rewrite_all(records, shard, lambda rec: rec.get("name"), _CONFIG)


def apply_to_augments(records, shard: dict) -> dict:
    """Expand the folded `Riposte` affix on AUGMENT records.

    Two augments carry it — `Sapphire of Riposte` and `Legendary Sapphire of
    Riposte`, the item the #546 reporter actually named. They live in the
    `<Color> Augment Slot` crafting pools, NOT in the planner item roster, so
    `apply()` above never reaches them: coverage of the item channel is not
    coverage of this one (#293's lesson, the same reason Speed and Elemental
    Resistance each run both channels).

    Both augments are Arabic and share the item shard's tooltip snapshots, so
    unlike Speed they need no sibling shard — the join key is the same `name`,
    and one file holding one enchantment's evidence is easier to keep honest than
    two that must agree. The coverage counters are reported separately so a
    regression in either channel is still visible on its own.
    """
    return _es.rewrite_all(records, shard, lambda rec: rec.get("name"), _CONFIG)
