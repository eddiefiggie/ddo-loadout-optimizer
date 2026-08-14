"""#191 — expand `Elemental Resistance` into its per-element resistances.

`{{Elemental Resistance|Elemental|N|...}}` is a bundled template: one invocation
grants +N to Acid, Cold, Electricity, and Fire Resistances — and ALSO Sonic when
its named `4=` parameter is truthy. The visible cell reads `Elemental Resistance
+N` either way, so a player ranking `Fire Resistance` scored nothing from any of
the 58 carriers, and nothing distinguished a four-element carrier from a
five-element one. This is the same shape as `Elemental Absorption`
(`src/absorption_split.py`), and this module deliberately mirrors that module's
rules rather than inventing new ones:

  * **The element set is per-item wiki evidence.** gear-planner stores nothing
    that distinguishes the two renderings, so the Sonic flag lives in
    `data/seed/compendium/elemental_resistance.json`, harvested per carrier from
    the rendered tooltip. A blanket four-way expansion under-credits Sonic on
    six carriers; a blanket five-way over-credits the other 52. Neither is safe.
  * **Expansion is at FULL magnitude per element.** The tooltip states "+N bonus
    to your Acid, Cold, ... Resistances" — N to each, not N split between them.
  * **Quarantine is REMOVAL, not pass-through.** Registering the compound in
    `EXPANDED_AWAY` removes it from the picker globally, so an unexpanded
    carrier would ship an affix no player can rank. An absent entry, a
    non-`stated` entry, or an entry with no flag for this affix's bonus type is
    removed and disclosed via the shared quarantine marker.

One structural difference from the absorption shard: entries here key their
readings by bonus TYPE, because two carriers (Epic Chain of Conviction, Epic
Death's Rampart) bear TWO `Elemental Resistance` affixes with different element
sets — Enhancement 30 with Sonic beside Insight 10 without. A single per-item
flag cannot represent them; a per-type flag joins each dataset affix to exactly
one reading.

Single-element invocations (`{{Elemental Resistance|Cold|51}}`) never reach this
module: gear-planner already stores those under the per-element stat name
(`Cold Resistance` on Sphere of Waves), so no `Elemental Resistance` affix is
produced for them.

No anti-shadow rule, matching absorption: `web/model.js` buckets by stat plus
stacking-equivalent type and keeps the MAX, so a component emitted alongside one
the item already states resolves on its own.
"""
from __future__ import annotations

import re

from src import enchantment_split
from src.enchantment_split import STATED, DEFAULTED, UNSOURCED  # noqa: F401
# The quarantine marker is SHARED with the absorption family: `src/variants.py`
# carries it onto variants, `web/model.js` must-not-prune guards it, and
# `web/solver.js` builds the ranked-stat disclosure from it — all of it keyed on
# the field, none of it absorption-specific. A second field would need all three
# integrations re-made for identical behavior.
from src.absorption_split import QUARANTINE_FIELD, ABSENT, UNCONFIRMED  # noqa: F401
from src.spell_focus import PROVENANCE_KEY

COMPOUND = "Elemental Resistance"

# The component stats, spelled as the DATASET spells them: the registry carries
# `Electric Resistance`, not the tooltip's "Electricity"/"Electrical" wordings.
ACID = "Acid Resistance"
COLD = "Cold Resistance"
FIRE = "Fire Resistance"
ELECTRIC = "Electric Resistance"
SONIC = "Sonic Resistance"

WITHOUT_SONIC = (ACID, COLD, FIRE, ELECTRIC)
WITH_SONIC = WITHOUT_SONIC + (SONIC,)

# The picker drops the compound dataset-wide and redirects to the UNION of what
# it becomes anywhere — six of the 58 carriers include Sonic, so a player
# redirected off the compound must be shown every name it becomes somewhere.
EXPANDED_AWAY = {COMPOUND.lower(): list(WITH_SONIC)}


def is_compound(stat) -> bool:
    return (stat or "").strip().lower() == COMPOUND.lower()


# --- Reading the shard --------------------------------------------------------

# `{{Elemental Resistance|Elemental|45|4=yes}}` / `|30|Insight` / `|5|competence`.
# The type token is the third positional parameter (absent = Enhancement); the
# Sonic switch is the NAMED parameter `4=`, which only Enhancement carriers use.
_INVOCATION = re.compile(
    r"^\{\{\s*elemental resistance\s*\|\s*elemental\s*\|\s*(\d+)\s*"
    r"(?:\|\s*(competence|insight)\s*)?"
    r"(?:\|\s*4\s*=\s*([a-z0-9]+)\s*)?\}\}$",
    re.I)
# The template's own switch. Anything outside both sets is unreadable, and
# unreadable must not collapse into a falsy "no sonic".
_SONIC_TRUE = {"yes", "y", "1", "true", "sonic"}
_SONIC_FALSE = {"no", "n", "0", "false"}

# The two rendered dialect families, captured verbatim from action=parse renders
# on 2026-08-13. The modern (Enhancement) dialect says "Electricity ...
# Resistances" and may name Sonic; the legacy (Competence/Insight) dialect says
# "Electrical resistances" and never names Sonic.
_TIP_MODERN_SONIC = re.compile(
    r"Acid,\s*Cold,\s*Electricity,\s*Fire,\s*and\s*Sonic\s+Resistances", re.I)
_TIP_MODERN_NO_SONIC = re.compile(
    r"Acid,\s*Cold,\s*Electricity,\s*and\s*Fire\s+Resistances", re.I)
_TIP_LEGACY = re.compile(
    r"Acid,\s*Cold,\s*Fire,\s*and\s*Electrical\s+resistances", re.I)
# What bonus type the tooltip itself states ("+15 Competence bonus").
_TIP_TYPE = re.compile(r"\+\d+\s+(Enhancement|Competence|Insight)\s+bonus", re.I)
# The magnitude the tooltip echoes.
_TIP_MAGNITUDE = re.compile(r"\+(\d+)\s+(?:Enhancement|Competence|Insight)\s+bonus", re.I)


def parse_invocation(raw: str):
    """`(magnitude, type, sonic)` for a parsable invocation, else None.

    `sonic` is None when the `4=` token is outside the template's own switch —
    never a falsy default. A missing token IS a stated four-element reading
    (the template's default branch), unlike absorption's optional third
    positional: here `4=` is a named parameter, so absence is the no-Sonic arm
    of the switch rather than silence.
    """
    match = _INVOCATION.match((raw or "").strip())
    if not match:
        return None
    magnitude = int(match.group(1))
    type_ = (match.group(2) or "Enhancement").capitalize()
    token = match.group(3)
    if token is None:
        sonic = False
    else:
        token = token.strip().lower()
        if token in _SONIC_TRUE:
            sonic = True
        elif token in _SONIC_FALSE:
            sonic = False
        else:
            sonic = None
    return magnitude, type_, sonic


def invocation_key(raw: str):
    """Normalize an invocation to its snapshot key, or None when unparsable.

    One snapshot per RENDERING, not per magnitude: the magnitude is echoed into
    the tooltip and settles nothing about coverage or type.
    """
    parsed = parse_invocation(raw)
    if parsed is None or parsed[2] is None:
        return None
    _, type_, sonic = parsed
    if type_ != "Enhancement":
        return "{{elemental resistance|elemental|n|%s}}" % type_.lower()
    return ("{{elemental resistance|elemental|n|4=yes}}" if sonic
            else "{{elemental resistance|elemental|n}}")


def snapshot_for(shard: dict, raw: str):
    key = invocation_key(raw)
    if key is None:
        return None
    return ((shard or {}).get("snapshots") or {}).get(key)


def tooltip_reading(tooltip: str):
    """`(sonic, type, magnitude)` stated by a rendered tooltip, or None.

    Legacy-dialect tooltips state four elements by construction; their `type` is
    whatever the prose names. A tooltip matching no dialect verifies nothing.
    """
    text = tooltip or ""
    if _TIP_MODERN_SONIC.search(text):
        sonic = True
    elif _TIP_MODERN_NO_SONIC.search(text):
        sonic = False
    elif _TIP_LEGACY.search(text):
        sonic = False
    else:
        return None
    type_match = _TIP_TYPE.search(text)
    mag_match = _TIP_MAGNITUDE.search(text)
    if not type_match or not mag_match:
        return None
    return sonic, type_match.group(1).capitalize(), int(mag_match.group(1))


def _entry_reading(entry, affix_type):
    """The recorded reading for one dataset affix, or `(None, reason)`.

    R7's clauses, extended by the per-type join: a non-`stated` entry is
    unconfirmed; an entry with no reading for this affix's bonus type, or a
    reading with no Sonic flag, states nothing about this affix.
    """
    if entry is None:
        return None, ABSENT
    if entry.get("provenance") != STATED:
        return None, UNCONFIRMED
    for reading in entry.get("affixes") or []:
        if (reading.get("type") or "").lower() == (affix_type or "").lower():
            sonic = reading.get("sonic")
            if sonic is None:
                return None, ABSENT
            return (WITH_SONIC if sonic else WITHOUT_SONIC), None
    return None, ABSENT


def components_for(stat, affix_type, item_name, shard: dict):
    """What one compound affix (of one bonus type) on one item becomes."""
    if not is_compound(stat):
        return None, None
    harvested = (shard or {}).get("harvested") or {}
    return _entry_reading(harvested.get(item_name), affix_type)


# --- The expansion ------------------------------------------------------------

def empty_stats() -> dict:
    return {"carriers": 0, "expanded": 0, "components": 0, "quarantined": 0,
            "quarantined_absent": 0, "quarantined_unconfirmed": 0, "excluded": []}


def apply(records, shard: dict) -> dict:
    """Expand every `Elemental Resistance` affix on every ITEM record, in place.

    Joins by item name plus the affix's bonus type. Every other key on the
    source affix is copied verbatim onto each component, so the expansion keeps
    the bonus type and value of the source; the compound name is stamped as the
    provenance label, exactly as the absorption family stamps its compounds.
    """
    stats = empty_stats()

    for rec in records or []:
        affixes = rec.get("affixes") or []
        if not any(is_compound(a.get("name")) for a in affixes):
            continue
        stats["carriers"] += 1

        name = rec.get("name")
        out = []
        excluded = []
        for affix in affixes:
            if not is_compound(affix.get("name")):
                out.append(affix)
                continue

            components, reason = components_for(
                affix["name"], affix.get("type"), name, shard)
            if components is None:
                stats["quarantined"] += 1
                stats["quarantined_absent" if reason == ABSENT
                      else "quarantined_unconfirmed"] += 1
                detail = {"stat": affix["name"], "reason": reason,
                          "components": list(WITH_SONIC)}
                excluded.append(detail)
                stats["excluded"].append({"item": name, **detail})
                continue

            for component in components:
                out.append({**affix, "name": component, PROVENANCE_KEY: affix["name"]})
            stats["expanded"] += 1
            stats["components"] += len(components)

        rec["affixes"] = out
        if excluded:
            existing = rec.get(QUARANTINE_FIELD) or []
            rec[QUARANTINE_FIELD] = existing + excluded

    return stats


# --- Audits and the guard -----------------------------------------------------

def audit_shard(shard: dict) -> dict:
    return enchantment_split.audit_shard(shard, label="elemental resistance shard")


def audit_snapshots(shard: dict) -> dict:
    """Report which invocations still lack a rendered-tooltip snapshot."""
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError("elemental resistance shard is empty — refusing to report "
                         "snapshot coverage over zero records")

    invocations = set()
    unparsable = []
    for title, entry in sorted(harvested.items()):
        for reading in (entry or {}).get("affixes") or []:
            raw = reading.get("raw")
            if not raw:
                continue
            key = invocation_key(raw)
            if key is None:
                unparsable.append(title)
                continue
            invocations.add(key)
    stored = set((shard.get("snapshots") or {}))
    missing = sorted(invocations - stored)
    return {"invocations": len(invocations),
            "snapshotted": len(invocations) - len(missing),
            "missing": len(missing), "missing_keys": missing,
            "unparsable": unparsable}


def check_against_snapshots(shard: dict) -> dict:
    """Assert every recorded reading against the wiki's own rendered text.

    Per `stated` reading: the invocation must parse; the recorded Sonic flag is
    asserted against the invocation-keyed snapshot's dialect, and the recorded
    Sonic flag, bonus type, AND magnitude are each asserted against the
    invocation itself and against the item's own per-item tooltip. (The shared
    snapshot is magnitude-normalized and keyed by the invocation, so it can
    state neither type nor magnitude independently — and it can never disagree
    with the invocation that selected it.) The per-item tooltip is the only
    witness independent of `raw`. See absorption's guard for the incident shape.

    Also rejects an entry carrying two readings whose case-folded bonus type
    collides: `_entry_reading` joins first-match-wins on type, so a duplicate
    would silently shadow its sibling while every per-reading witness stays
    self-consistent — the one wrong-shard shape the three witnesses cannot see.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError("elemental resistance shard is empty — refusing to report "
                         "a clean guard over zero records")

    problems = []
    checked = 0
    compared = 0
    independent = 0
    stated = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        provenance = entry.get("provenance")
        if provenance not in (STATED, DEFAULTED, UNSOURCED):
            problems.append(f"{title}: unknown provenance {provenance!r}")
            continue
        if provenance != STATED:
            checked += 1
            continue

        readings = entry.get("affixes") or []
        if not readings:
            problems.append(f"{title}: `stated` but records no readings")
            continue

        # The join-uniqueness invariant: apply()'s per-type join is
        # first-match-wins, so two readings sharing a bonus type would let one
        # silently shadow the other with every per-reading witness green.
        types_seen = {}
        for reading in readings:
            key = (reading.get("type") or "").lower()
            types_seen[key] = types_seen.get(key, 0) + 1
        for key, count in sorted(types_seen.items()):
            if count > 1:
                problems.append(
                    f"{title}: {count} readings share bonus type {key!r} — the "
                    "per-type join is first-match-wins, so a duplicate silently "
                    "shadows its sibling; one reading per type, per item")

        for reading in readings:
            stated += 1
            raw = reading.get("raw") or ""
            label = f"{title} [{reading.get('type')}]"

            parsed = parse_invocation(raw)
            if parsed is None or parsed[2] is None:
                problems.append(
                    f"{label}: {raw!r} is not a parsable Elemental Resistance invocation")
                continue
            inv_mag, inv_type, inv_sonic = parsed

            snapshot = snapshot_for(shard, raw)
            if snapshot is None:
                problems.append(f"{label}: no tooltip snapshot for {raw!r}")
                continue
            snap_reading = tooltip_reading(snapshot.get("tooltip"))
            if snap_reading is None:
                problems.append(
                    f"{label}: snapshot tooltip matches no known dialect")
                continue

            checked += 1
            compared += 1

            recorded_sonic = reading.get("sonic")
            recorded_type = reading.get("type")
            recorded_value = reading.get("value")
            if recorded_sonic is None:
                problems.append(f"{label}: `stated` but records no `sonic` flag")
                continue
            if bool(recorded_sonic) != snap_reading[0]:
                problems.append(
                    f"{label}: recorded sonic={recorded_sonic!r} but the snapshot "
                    f"for {raw!r} states {snap_reading[0]!r}")
            if bool(recorded_sonic) != inv_sonic:
                problems.append(
                    f"{label}: recorded sonic={recorded_sonic!r} disagrees with its "
                    f"own invocation {raw!r}")
            if (recorded_type or "").capitalize() != inv_type:
                problems.append(
                    f"{label}: recorded type={recorded_type!r} disagrees with its "
                    f"own invocation {raw!r}")
            if recorded_value != inv_mag:
                problems.append(
                    f"{label}: recorded value={recorded_value!r} disagrees with its "
                    f"own invocation {raw!r}")

            # The independent witness: this item's OWN rendered tooltip.
            per_item = reading.get("tooltip")
            if not per_item:
                problems.append(
                    f"{label}: `stated` but carries no per-item tooltip — the shared "
                    "snapshot is keyed by the invocation, so without this the flag "
                    "is verified only against itself")
                continue
            by_item = tooltip_reading(per_item)
            if by_item is None:
                problems.append(
                    f"{label}: per-item tooltip matches no known dialect: "
                    f"{per_item[:80]!r}")
                continue
            independent += 1
            item_sonic, item_type, item_mag = by_item
            if bool(recorded_sonic) != item_sonic:
                problems.append(
                    f"{label}: recorded sonic={recorded_sonic!r} but this item's own "
                    f"tooltip states {item_sonic!r} — the value and its cited "
                    "invocation are wrong together")
            if (recorded_type or "").capitalize() != item_type:
                problems.append(
                    f"{label}: recorded type={recorded_type!r} but this item's own "
                    f"tooltip states {item_type!r}")
            if recorded_value != item_mag:
                problems.append(
                    f"{label}: recorded value={recorded_value!r} but this item's own "
                    f"tooltip states {item_mag!r}")

    if compared < stated:
        problems.append(
            f"{stated - compared} `stated` reading(s) were never compared against "
            "a snapshot — the guard cannot vouch for them")
    if independent < stated:
        problems.append(
            f"{stated - independent} `stated` reading(s) were never checked against "
            "their own item tooltip — only against a snapshot their own invocation "
            "selected, which cannot contradict them")
    if not compared and not problems:
        raise ValueError(
            "elemental resistance guard compared no recorded reading against a "
            "tooltip — refusing to pass")

    return {"checked": checked, "compared": compared, "independent": independent,
            "stated": stated, "problems": problems}
