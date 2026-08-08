"""U3 (#154) — split the folded `Speed` affix back into the two game mechanics.

Upstream gear-planner folds `Striding` into `Speed` (its `affix-synonyms.json`),
but DDO has two distinct enchantments here:

  * `{{Striding|N}}`   -> `+N%` movement speed, nothing else.
  * `{{Speed|MAG}}`    -> movement speed AND melee/ranged attack speed.

The fold dropped the attack-speed half, and — for the Roman-numeral form —
corrupted the movement value too: gear-planner converts `{{Speed|XI}}` to the
integer 11 and stores it as if it were a movement percentage, when the argument
is a RANK meaning 30% movement (5*11, capped) plus 11% attack speed.

This module rewrites those affixes from the wiki-harvested shard, at the
planner-record seam so that everything downstream — variant expansion, the
rankable-affix vocabulary, the solver, browse, and the exports — inherits one
corrected affix block rather than each re-deriving it.

Three outcomes, driven entirely by what the wiki states (see
`docs/wiki-evidence/speed-and-alacrity.md`):

  * `stated` + no alacrity keys -> a Striding item. Rename only.
  * `stated` + alacrity keys    -> a Speed item. Rename, correct the movement
    value, and add the alacrity affixes.
  * `defaulted` / `unsourced`   -> `Template:Speed` renders 5% for any magnitude
    nobody recorded, so a 5% reading is not evidence of a 5% bonus. Rename and
    keep the movement bonus; grant NO alacrity.

Two callers share one classifier (`_rewrite_all`), differing only in how a
record resolves to a shard entry: items join by wiki title derived from their
page url, augments by name against a sibling shard. Augments have no item page
and share one `Augment Slot` url, so the title join cannot reach them — and
keeping the two join keys in separate files is deliberate, because a predicate
matching one representation of a field while running over another is how the
material coverage gate passed on deliberately corrupted input.

#134 added the verification half. Every distinct template invocation carries a
verbatim rendered-tooltip snapshot, and `check_against_snapshots()` asserts our
derived magnitudes against them on every build. The load-bearing assertion is
the `defaulted` one: those entries must use an Arabic magnitude outside the
recorded switch and grant nothing, because the 5% their tooltips render is the
template's "nobody recorded one" placeholder. The discriminator is the numeral
system, not the number — `{{Speed|V}}` legitimately states 5%.
"""
from __future__ import annotations

import re
import urllib.parse

# The folded upstream name, and what it actually means.
FOLDED_NAME = "Speed"
MOVEMENT_NAME = "Movement Speed"
MELEE_NAME = "Melee Alacrity"
RANGED_NAME = "Ranged Alacrity"

# `Speed` is not a stat — in game it names an enchantment granting three of them.
# Offering it as a rankable priority guarantees a partial score against what the
# player meant, which is exactly the confusion #154 was reported as. The picker
# drops it and redirects here (metadata.expanded_away_names).
EXPANDED_AWAY = {FOLDED_NAME.lower(): [MOVEMENT_NAME, MELEE_NAME, RANGED_NAME]}

_ALACRITY_KEYS = (("melee", MELEE_NAME), ("ranged", RANGED_NAME))

# Provenance labels, named rather than spelled inline. Four functions branch on
# these; a bare literal drifting by one character in one of them is the failure
# shape that let the material coverage gate pass on corrupted input.
STATED = "stated"
DEFAULTED = "defaulted"
UNSOURCED = "unsourced"


def title_for(url: str) -> str:
    """`/page/Item:Ash_Boots` -> `Item:Ash Boots` (the shard's key)."""
    return urllib.parse.unquote((url or "").replace("/page/", "")).replace("_", " ")


def _bonus_type(affix: dict) -> str:
    # Every observed Striding/Speed affix is Enhancement-typed upstream; preserve
    # whatever the record carries rather than hardcoding, so a future retype rides.
    return affix.get("type") or "Enhancement"


def apply_to_augments(records, shard: dict) -> dict:
    """Rewrite the folded `Speed` affix on AUGMENT records, from augment evidence.

    Augments have no item page and every augment record shares one
    `Augment Slot` url, so they cannot join the item shard by title the way
    `apply()` does — they join by **name**, against their own sibling shard.
    Keeping the two join keys in separate files is deliberate: a gate whose
    predicate matched one representation of a field while running over the
    other is exactly how the material coverage gate passed on corrupt input
    (`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`).

    The classifier itself is shared with `apply()` — only the resolution step
    differs — so provenance gating, the Roman-rank movement correction, and the
    anti-shadow rule behave identically on both sides.

    This function used to assert that every Swiftness tier rendered
    `Striding +30%` and could therefore never add alacrity. The wiki
    contradicts that: `Topaz of Swiftness 15%` renders `{{Speed|30}}`, which is
    30% movement AND 15% melee/ranged attack speed.
    """
    return _rewrite_all(records, shard, lambda rec: rec.get("name"))


def _rewrite_all(records, shard: dict, key_of) -> dict:
    """Shared classifier. `key_of` maps a record to its shard key."""
    harvested = (shard or {}).get("harvested") or {}
    stats = {"renamed": 0, "movement_corrected": 0, "melee_added": 0,
             "ranged_added": 0, "quarantined": 0, "uncovered": 0}

    for rec in records or []:
        affixes = rec.get("affixes") or []
        folded = [a for a in affixes if a.get("name") == FOLDED_NAME]
        if not folded:
            continue

        entry = harvested.get(key_of(rec))
        if entry is None:
            stats["uncovered"] += 1
            continue

        value = entry.get("value") or {}
        eligible = entry.get("provenance") == STATED
        # Names the record already carries explicitly win — never shadow an
        # upstream affix. Seeded BEFORE the loop so a pre-existing Melee
        # Alacrity blocks the melee add without blocking the ranged one.
        present = {a.get("name") for a in affixes}

        for affix in folded:
            btype = _bonus_type(affix)
            affix["name"] = MOVEMENT_NAME
            stats["renamed"] += 1

            movement = value.get("movement")
            if movement is not None and str(movement) != str(affix.get("value")):
                # The Roman-rank correction: gear-planner stored the rank as if it
                # were a percentage (Speed XI -> 11, actually 30% movement).
                affix["value"] = str(movement)
                stats["movement_corrected"] += 1

            if not eligible:
                stats["quarantined"] += 1
                continue

            for key, name in _ALACRITY_KEYS:
                magnitude = value.get(key)
                if magnitude is None or name in present:
                    continue
                affixes.append({"name": name, "type": btype, "value": str(magnitude)})
                present.add(name)
                stats["melee_added" if key == "melee" else "ranged_added"] += 1

        rec["affixes"] = affixes

    return stats


# The wiki's hand-maintained Arabic switch (Template:Speed). Any Arabic magnitude
# absent from this map renders 5% — the template's "nobody recorded one" default,
# which is not evidence. Verified row-by-row against rendered tooltips 2026-08-08.
RECORDED_SWITCH = {18: 6, 19: 6, 20: 7, 21: 8, 22: 9, 23: 9, 24: 10,
                   25: 11, 26: 12, 27: 12, 28: 13, 30: 15}

_ROMAN = re.compile(r"^\{\{\s*speed\s*\|\s*([ivxlcdm]+)\s*(\|.*)?\}\}$", re.I)
_ARABIC = re.compile(r"^\{\{\s*speed\s*\|\s*(\d+)\s*(\|.*)?\}\}$", re.I)
_STRIDING = re.compile(r"^\{\{\s*striding\s*\|", re.I)

# Two tooltip dialects: the Arabic branch renders "N% bonus to attack speed",
# the Roman branch "+N% enhancement bonus to melee and ranged attack speed".
# The melee-and-ranged pattern must be tried before the ranged-only one — the
# latter is a suffix of the former and would match it.
_TIP_BOTH = re.compile(r"\+?(\d+)%\s+enhancement bonus to melee and ranged attack speed", re.I)
_TIP_RANGED = re.compile(r"\+?(\d+)%\s+enhancement bonus to ranged attack speed", re.I)
_TIP_MELEE = re.compile(r"\+?(\d+)%\s+enhancement bonus to melee attack speed", re.I)
_TIP_ARABIC = re.compile(r"(\d+)%\s+bonus to attack speed", re.I)


def tooltip_alacrity(tooltip: str) -> dict:
    """The melee/ranged magnitudes a rendered tooltip states, as the wiki wrote them.

    Returns `{}` for a Striding tooltip, which states movement only. A key is
    absent when that component is not granted — `{{Speed|XV|Ranged}}` yields a
    ranged entry and no melee entry.
    """
    text = tooltip or ""
    both = _TIP_BOTH.search(text)
    if both:
        return {"melee": int(both.group(1)), "ranged": int(both.group(1))}

    out = {}
    ranged = _TIP_RANGED.search(text)
    if ranged:
        out["ranged"] = int(ranged.group(1))
    melee = _TIP_MELEE.search(text)
    if melee:
        out["melee"] = int(melee.group(1))
    if out:
        return out

    arabic = _TIP_ARABIC.search(text)
    if arabic:
        return {"melee": int(arabic.group(1)), "ranged": int(arabic.group(1))}
    return {}


def arabic_magnitude(raw: str):
    """The Arabic argument of a Speed invocation, or None for Roman/Striding."""
    if _STRIDING.match(raw or ""):
        return None
    match = _ARABIC.match(raw or "")
    return int(match.group(1)) if match else None


def is_roman(raw: str) -> bool:
    return bool(_ROMAN.match(raw or ""))


def snapshot_key(raw: str) -> str:
    """Normalize an invocation to its snapshot key.

    Case only: `{{speed|V}}` appears lowercase in live wikitext alongside
    `{{Speed|V}}`, and they are the same invocation rendering the same tooltip.
    Nothing else is normalized — whitespace or argument differences are real
    differences and must not be collapsed into one snapshot.
    """
    return (raw or "").strip().lower()


def snapshot_for(shard: dict, raw: str):
    """The stored tooltip snapshot for an invocation, or None when unharvested."""
    snapshots = (shard or {}).get("snapshots") or {}
    return snapshots.get(snapshot_key(raw))


def audit_snapshots(shard: dict) -> dict:
    """Report which invocations still lack a rendered-tooltip snapshot.

    The snapshot store is exclude-until-verified: it ships empty and fills in as
    invocations are rendered. While an invocation is unsnapshotted the guard has
    nothing to compare against for it, so a green suite would otherwise imply a
    coverage that does not exist
    (`docs/solutions/conventions/exclude-until-verified-empty-seed-masks-consuming-bugs.md`).
    This makes the shortfall a reported number rather than a silent pass.

    Raises on an empty shard, for the same reason `audit_shard` does.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "speed shard is empty — refusing to report snapshot coverage over zero records")

    invocations = {snapshot_key(entry.get("raw")) for entry in harvested.values()
                   if (entry or {}).get("raw")}
    stored = set((shard.get("snapshots") or {}))
    missing = sorted(invocations - stored)
    return {"invocations": len(invocations), "snapshotted": len(invocations) - len(missing),
            "missing": len(missing), "missing_keys": missing}


def check_against_snapshots(shard: dict) -> dict:
    """Assert every derived value against the wiki's own rendered tooltip.

    Two assertions, and the second is the one that matters. For a `stated`
    entry the derived melee/ranged must equal what the tooltip says. For a
    `defaulted` entry the invocation must be an Arabic magnitude *outside* the
    recorded switch, and it must grant nothing — because the 5% such a tooltip
    renders is `Template:Speed`'s "nobody recorded one" placeholder, not a
    measurement. A guard that only compared tooltip-to-value would demand we
    grant that 5% and would quietly reintroduce inference.

    The discriminator is the numeral system, not the rendered number:
    `{{Speed|V}}` legitimately *states* 5%. Labelling a Roman invocation
    `defaulted` is therefore a defect, and this reports it.

    Offline — reads only what is already on disk. Raises on an empty shard.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "speed shard is empty — refusing to report a clean guard over zero records")

    problems = []
    checked = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        raw = entry.get("raw") or ""
        provenance = entry.get("provenance")
        value = entry.get("value") or {}
        snapshot = snapshot_for(shard, raw)

        if snapshot is None:
            problems.append(f"{title}: no tooltip snapshot for {raw!r}")
            continue

        stated_tip = tooltip_alacrity(snapshot.get("tooltip"))

        if provenance == STATED:
            checked += 1
            for component in ("melee", "ranged"):
                derived = value.get(component)
                expected = stated_tip.get(component)
                if derived != expected:
                    problems.append(
                        f"{title}: derived {component}={derived!r} but the tooltip "
                        f"states {expected!r} for {raw!r}")
        elif provenance == DEFAULTED:
            checked += 1
            magnitude = arabic_magnitude(raw)
            if is_roman(raw):
                problems.append(
                    f"{title}: {raw!r} is a Roman invocation labelled `defaulted` — "
                    "the 5% default belongs to the Arabic branch only")
            elif magnitude is None:
                problems.append(
                    f"{title}: {raw!r} is labelled `defaulted` but is not an Arabic "
                    "Speed invocation")
            elif magnitude in RECORDED_SWITCH:
                problems.append(
                    f"{title}: {raw!r} is a recorded switch row "
                    f"({magnitude} -> {RECORDED_SWITCH[magnitude]}%) and must not be "
                    "labelled `defaulted`")
            if value.get("melee") is not None or value.get("ranged") is not None:
                problems.append(
                    f"{title}: `defaulted` entries must grant no alacrity, got "
                    f"melee={value.get('melee')!r} ranged={value.get('ranged')!r}")

    # Refuse to report a clean run over nothing — but only when the run is
    # otherwise clean. A shard whose entries all failed to resolve a snapshot
    # has zero gradeable entries AND real problems to report; raising there
    # would bury the actual diagnosis behind a confusing message.
    if not checked and not problems:
        raise ValueError(
            "guard inspected no stated or defaulted entries — refusing to pass")

    return {"checked": checked, "problems": problems}


def audit_shard(shard: dict) -> dict:
    """Report `unsourced` entries as harvest suspects rather than accepting them.

    An `unsourced` reading claims the page carries no Striding/Speed template.
    That is sometimes true and sometimes a miss: `Item:Belt of the Ram` sat
    `unsourced` through a whole harvest cycle while its page plainly renders
    `Speed +15%`, and `harvest-method.md` had recorded the correct reading the
    entire time. Nothing compared the two, so nothing noticed.

    Raises on an empty shard. A check that inspects nothing passes
    unconditionally and is indistinguishable from a clean run — the failure
    mode `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`
    exists to prevent.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            "speed shard is empty — refusing to report a clean audit over zero records")

    suspects = sorted(title for title, entry in harvested.items()
                      if (entry or {}).get("provenance") == UNSOURCED)
    return {"inspected": len(harvested), "unsourced": len(suspects), "titles": suspects}


def apply(records, shard: dict) -> dict:
    """Rewrite the folded `Speed` affix on every ITEM record the shard covers.

    Items join the shard by wiki title derived from their page url. Records with
    no `Speed` affix are untouched, as are records absent from the shard (they
    keep the folded affix — the coverage gate is what makes that state visible
    rather than the split silently inventing a reading).
    """
    return _rewrite_all(records, shard, lambda rec: title_for(rec.get("url")))
