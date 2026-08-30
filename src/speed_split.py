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

from src import enchantment_split as _es
# Re-exported so existing callers and tests keep importing these from here.
from src.enchantment_split import (  # noqa: F401
    STATED, DEFAULTED, UNSOURCED, title_for, snapshot_key, snapshot_for,
)

# The folded upstream name, and what it actually means.
FOLDED_NAME = "Speed"
MOVEMENT_NAME = "Movement Speed"
MELEE_NAME = "Melee Alacrity"
RANGED_NAME = "Ranged Alacrity"

# `Speed` is not a stat — in game it names an enchantment granting three of them.
# Offering it as a rankable priority guarantees a partial score against what the
# player meant, which is exactly the confusion #154 was reported as. The picker
# drops it and redirects here (metadata.expanded_away_names).
EXPANDED_AWAY = {FOLDED_NAME.lower(): [MOVEMENT_NAME, MELEE_NAME, RANGED_NAME],
                 # `Swiftness` is the same non-stat problem under a third name: it is
                 # an augment's title, not something a player can be given. Redirect it
                 # too, or searching the word that IS on the augment finds nothing.
                 "swiftness": [MOVEMENT_NAME, MELEE_NAME, RANGED_NAME]}

_ALACRITY_KEYS = (("melee", MELEE_NAME), ("ranged", RANGED_NAME))

# How the folded `Speed` affix expands. Speed suppresses on stat name alone,
# which is safe here only because no Speed item carries a `Movement Speed`
# affix; an affix whose output collides with a common stat needs the
# name-and-bucket key instead.
_CONFIG = _es.SplitConfig(
    folded_name=FOLDED_NAME,
    # gear-planner names the three `Topaz of Swiftness` augments' affix `Swiftness`
    # rather than `Speed` or `Striding`, so the splitter passed over them and all
    # three reached the solver crediting nothing — 30% movement, and on the 15% a
    # further 15% melee and 15% ranged alacrity, none of it scored or rankable.
    # Confirmed against the wiki 2026-08-29; see docs/wiki-evidence/speed-and-alacrity.md §4.
    folded_aliases=("Swiftness",),
    primary_name=MOVEMENT_NAME,
    primary_key="movement",
    primary_corrected_stat="movement_corrected",
    extras=(("melee", MELEE_NAME, "melee_added"),
            ("ranged", RANGED_NAME, "ranged_added")),
    shadow_key=_es.name_only,
    label="speed shard",
)


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

    That correction landed in the shard and then did nothing for a year, because the
    join never reached these records: upstream names their affix `Swiftness`, and the
    splitter matched `Speed` alone. Fixed by `folded_aliases`; the guard below now
    asserts every shard entry was actually rewritten, which is what would have caught
    it — `renamed: 4` of `inspected: 7` with `uncovered: 0` read as complete.
    """
    return _rewrite_all(records, shard, lambda rec: rec.get("name"))


def check_augment_coverage(records, shard: dict, coverage: dict) -> None:
    """Every augment the shard names must have been REWRITTEN, not merely inspected.

    The gap this closes: `speed_augment_coverage` reported `renamed: 4` of
    `inspected: 7` with `uncovered: 0`, and that read as complete. It was not — three
    `Topaz of Swiftness` augments were passed over because upstream names their affix
    `Swiftness` and the splitter matched `Speed` alone, so all three credited nothing
    for a year while the numbers looked clean.

    `uncovered` counts records the SHARD does not cover. It cannot see a record the
    shard covers and the matcher missed, which is precisely the failure mode. This
    asserts the other direction.
    """
    named = {k for k in (shard or {}).get("harvested", {}) if not k.startswith("_")}
    if not named:
        raise AssertionError("speed augment coverage: refusing to pass over an empty shard")
    by_name = {r.get("name") for r in records or []}
    present = named & by_name
    if not present:
        raise AssertionError("speed augment coverage: the shard names no augment in the roster")
    if coverage.get("renamed", 0) < len(present):
        raise AssertionError(
            f"speed augment coverage: the shard names {len(present)} augments in the roster "
            f"but only {coverage.get('renamed', 0)} were rewritten — an upstream affix name "
            "the splitter does not recognise (see folded_aliases)")


def _rewrite_all(records, shard: dict, key_of) -> dict:
    """Speed's rewrite, over the shared skeleton."""
    return _es.rewrite_all(records, shard, key_of, _CONFIG)


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
# A Striding tooltip states movement and nothing else. Recognizing it is what
# lets `{}` mean "the wiki says no alacrity" rather than "we could not read it".
_TIP_STRIDING = re.compile(r"striding\s*\+?\d+%", re.I)
# The wiki writes "bonus to movement speed" for Speed and "bonus your movement
# speed" for Striding (its own typo); both forms must read.
_TIP_MOVEMENT = re.compile(r"(\d+)%\s+enhancement bonus (?:to |your )?movement speed", re.I)


def tooltip_alacrity(tooltip: str):
    """The melee/ranged magnitudes a rendered tooltip states, as the wiki wrote them.

    Returns `{}` for a Striding tooltip, which states movement only — a real
    reading of "no alacrity". Returns **None** when the text matches no known
    dialect, which is a different thing entirely: we could not read it, so it
    proves nothing. The caller must not treat the two alike. Conflating them
    lets a blank or reworded snapshot silently agree with an under-granting
    entry, which is the precise silent-pass this guard exists to prevent.

    A key is absent when that component is not granted — `{{Speed|XV|Ranged}}`
    yields a ranged entry and no melee entry.
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

    if _TIP_STRIDING.search(text):
        return {}
    return None


def tooltip_movement(tooltip: str):
    """The movement percentage a rendered tooltip states, or None if unreadable."""
    match = _TIP_MOVEMENT.search(tooltip or "")
    return int(match.group(1)) if match else None


def arabic_magnitude(raw: str):
    """The Arabic argument of a Speed invocation, or None for Roman/Striding."""
    if _STRIDING.match(raw or ""):
        return None
    match = _ARABIC.match(raw or "")
    return int(match.group(1)) if match else None


def is_roman(raw: str) -> bool:
    return bool(_ROMAN.match(raw or ""))


# #171 — set-bonus `Speed` is NOT the Speed enchantment, and must not be expanded
# as one. Harvested 2026-08-09 from `Named item sets` wikitext (`action=raw`,
# same-origin): all three Marshwalker tiers render
#
#     {{InlineWht|dark=y|+30% Enhancement bonus to movement speed (all tier)}}
#
# Plain prose, no `{{Speed|N}}` invocation, and **movement only**. gear-planner
# normalizes it to the affix name `Speed`, which collides with the enchantment
# name — a naming collision, not the same mechanic. Reading it as `{{Speed|30}}`
# would grant 15% melee and 15% ranged alacrity the wiki does not state, across
# three sets. See `docs/wiki-evidence/marshwalker-set-speed.md`.
#
# Keyed by the stated value so an unseen one quarantines rather than being
# expanded at a guessed magnitude — a new value has to be harvested first.
SET_BONUS_MOVEMENT_ONLY = {"30": 30}

SET_BONUS_OUTPUTS = (MOVEMENT_NAME,)


def set_bonus_magnitudes(value):
    """What a set-bonus `Speed N` grants, or None when the wiki has not stated it.

    Movement only — see `SET_BONUS_MOVEMENT_ONLY`. Deliberately takes no shard:
    there is no tooltip snapshot to read because the wiki writes this bonus as
    prose rather than as a template invocation, which is exactly why it cannot
    reuse the item path.
    """
    magnitude = SET_BONUS_MOVEMENT_ONLY.get(str(value).strip())
    return None if magnitude is None else {MOVEMENT_NAME: magnitude}


def expand_set_bonuses(variants) -> dict:
    """Expand the folded `Speed` affix inside set-bonus tiers, which the item split misses."""
    return _es.expand_set_bonus_affixes(
        variants, FOLDED_NAME, set_bonus_magnitudes, SET_BONUS_OUTPUTS)


_ROMAN_DIGIT = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman_rank(raw: str):
    """The rank a Roman Speed invocation names, or None when it is not Roman.

    `docs/wiki-evidence/speed-and-alacrity.md` records the rendering rule from
    `Template:Speed`'s own worked examples: `attack speed = rank%` and
    `movement = min(5 x rank, 30)`. The movement cap does not cap attack speed —
    `Speed XIX` renders 30% movement and 19% attack speed.
    """
    match = _ROMAN.match(raw or "")
    if not match:
        return None
    token = match.group(1).upper()
    total = 0
    for i, ch in enumerate(token):
        value = _ROMAN_DIGIT[ch]
        nxt = _ROMAN_DIGIT.get(token[i + 1]) if i + 1 < len(token) else None
        total += -value if nxt is not None and nxt > value else value
    return total


def invocation_type(raw: str):
    """The optional Type parameter (`melee`/`ranged`/`movement`), or None."""
    match = _ROMAN.match(raw or "") or _ARABIC.match(raw or "")
    if not match:
        return None
    tail = match.group(2) or ""
    return tail.lstrip("|").strip().lower() or None


def audit_snapshots(shard: dict) -> dict:
    """Speed's snapshot-coverage audit, over the shared skeleton."""
    return _es.audit_snapshots(shard, label="speed shard")


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
    compared = 0
    stated = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        raw = entry.get("raw") or ""
        provenance = entry.get("provenance")
        value = entry.get("value") or {}

        # Unknown provenance is a defect, not a skip. A one-character retype
        # ("Stated") would otherwise fall past every branch while the classifier
        # quarantines the entry and silently drops its alacrity — the same
        # spelling-mismatch shape that let the material coverage gate pass.
        if provenance not in (STATED, DEFAULTED, UNSOURCED):
            problems.append(f"{title}: unknown provenance {provenance!r}")
            continue

        if provenance == STATED:
            stated += 1

        # `unsourced` means the page states nothing, so there is no tooltip to
        # snapshot. It must still grant nothing, and audit_shard reports it as a
        # harvest suspect — but it does not fail the build.
        if provenance == UNSOURCED:
            checked += 1
            if value.get("melee") is not None or value.get("ranged") is not None:
                problems.append(
                    f"{title}: `unsourced` entries must grant no alacrity")
            continue

        snapshot = snapshot_for(shard, raw)
        if snapshot is None:
            problems.append(f"{title}: no tooltip snapshot for {raw!r}")
            continue

        tooltip = snapshot.get("tooltip")
        stated_tip = tooltip_alacrity(tooltip)
        if stated_tip is None:
            # Unreadable is not "no alacrity". Treating it as {} would let a blank
            # or reworded snapshot agree with an under-granting entry.
            problems.append(
                f"{title}: tooltip for {raw!r} matches no known dialect, so it "
                f"cannot verify anything: {(tooltip or '')[:80]!r}")
            continue

        checked += 1
        compared += 1

        # Bind the snapshot to the key it is filed under. Everything below this
        # point compares a derived value against the tooltip it was read from,
        # which proves the two agree — not that either is right. Move a snapshot
        # and the values that read it together and that comparison passes by
        # construction: swapping `{{Speed|30}}`'s tooltip for `{{Speed|20}}`'s and
        # following it across all 73 entries reported 194 checked, 0 problems
        # while shipping 7% where the switch says 15%. Both branches have a
        # wiki-recorded anchor, so both are checkable.
        _bind_invocation_to_tooltip(title, raw, tooltip, problems)

        expected_movement = tooltip_movement(tooltip)
        if expected_movement is not None and value.get("movement") != expected_movement:
            problems.append(
                f"{title}: derived movement={value.get('movement')!r} but the "
                f"tooltip states {expected_movement!r} for {raw!r}")

        if provenance == STATED:
            magnitude = arabic_magnitude(raw)
            if magnitude is not None and magnitude not in RECORDED_SWITCH:
                # The tooltip renders 5% here because nobody recorded a value.
                # Accepting a matching 5% would launder the placeholder into a
                # sourced number, which is the inference this project forbids.
                problems.append(
                    f"{title}: {raw!r} is an Arabic magnitude outside the recorded "
                    "switch, so its rendered attack speed is the template default — "
                    "it must be labelled `defaulted`, not `stated`")
            for component in ("melee", "ranged"):
                derived = value.get(component)
                expected = stated_tip.get(component)
                if derived != expected:
                    problems.append(
                        f"{title}: derived {component}={derived!r} but the tooltip "
                        f"states {expected!r} for {raw!r}")
        else:  # DEFAULTED
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
            # Confirm against the snapshot that the rendered value really is the
            # 5% placeholder. Without this the `defaulted` claim rests only on our
            # own copy of the switch table, never on the wiki's own output.
            rendered = stated_tip.get("melee")
            if rendered not in (None, 5):
                problems.append(
                    f"{title}: {raw!r} is labelled `defaulted` but its tooltip "
                    f"states {rendered}% attack speed, which is not the 5% default")
            if value.get("melee") is not None or value.get("ranged") is not None:
                problems.append(
                    f"{title}: `defaulted` entries must grant no alacrity, got "
                    f"melee={value.get('melee')!r} ranged={value.get('ranged')!r}")

    # `checked` counts entries the guard reached a verdict on, including
    # `unsourced` ones verified to grant nothing — and that count is incremented
    # before any snapshot is resolved, so it cannot reach zero and is useless as
    # a vacuity tripwire. `compared` counts only values actually matched against
    # a parsed tooltip. Reporting both is what the two newer split modules do;
    # #170 is this module having kept the old single count.
    if compared < stated:
        problems.append(
            f"{stated - compared} `stated` entr(ies) were never compared against a "
            "tooltip — the guard cannot vouch for them")

    # Refuse to report a clean run over nothing — but only when the run is
    # otherwise clean. A shard whose entries all failed to resolve a snapshot
    # has zero gradeable entries AND real problems to report; raising there
    # would bury the actual diagnosis behind a confusing message.
    if not compared and not problems:
        raise ValueError(
            "speed guard compared no derived value against a tooltip — refusing to pass")

    return {"checked": checked, "compared": compared, "problems": problems}


def _bind_invocation_to_tooltip(title, raw, tooltip, problems):
    """Assert the snapshot states what its own invocation names.

    Both dialects have a wiki-recorded anchor (`docs/wiki-evidence/speed-and-alacrity.md`):

      * **Arabic** — the argument IS the movement percent, and the attack speed
        comes from `Template:Speed`'s switch. A magnitude outside the switch
        renders the 5% placeholder, which the `defaulted` branch already polices,
        so only recorded rows are anchored here.
      * **Roman** — the argument is a RANK: `attack speed = rank%` and
        `movement = min(5 x rank, 30)`. The movement cap does not cap attack
        speed, which is the detail an implementer is most likely to get wrong.

    Verified against all 24 shipped snapshots with zero violations before being
    turned into an assertion.
    """
    alacrity = tooltip_alacrity(tooltip) or {}
    movement = tooltip_movement(tooltip)
    kind = invocation_type(raw)

    magnitude = arabic_magnitude(raw)
    if magnitude is not None:
        if movement is not None and movement != magnitude:
            problems.append(
                f"{title}: {raw!r} names {magnitude}% movement but its tooltip states "
                f"{movement}% — the snapshot is paired with the wrong invocation")
        expected = RECORDED_SWITCH.get(magnitude)
        if expected is not None and alacrity.get("melee") not in (None, expected):
            problems.append(
                f"{title}: {raw!r} is a recorded switch row ({magnitude} -> {expected}%) "
                f"but its tooltip states {alacrity.get('melee')}% attack speed — the "
                "snapshot is paired with the wrong invocation")
        return

    rank = roman_rank(raw)
    if rank is None:
        return
    expected_movement = min(5 * rank, 30)
    if movement is not None and movement != expected_movement:
        problems.append(
            f"{title}: {raw!r} is rank {rank}, so it must state {expected_movement}% "
            f"movement, but its tooltip states {movement}% — the snapshot is paired "
            "with the wrong invocation")
    # The Type parameter narrows which component the tooltip carries; absent it,
    # both are stated. Only assert the components this invocation actually names.
    components = ("melee", "ranged") if kind is None else (
        () if kind == "movement" else (kind,))
    for component in components:
        got = alacrity.get(component)
        if got is not None and got != rank:
            problems.append(
                f"{title}: {raw!r} is rank {rank}, so it must state {rank}% {component} "
                f"attack speed, but its tooltip states {got}% — the snapshot is paired "
                "with the wrong invocation")


def audit_shard(shard: dict) -> dict:
    """Speed's harvest-suspect audit, over the shared skeleton."""
    return _es.audit_shard(shard, label="speed shard")


def apply(records, shard: dict) -> dict:
    """Rewrite the folded `Speed` affix on every ITEM record the shard covers.

    Items join the shard by wiki title derived from their page url. Records with
    no `Speed` affix are untouched, as are records absent from the shard (they
    keep the folded affix — the coverage gate is what makes that state visible
    rather than the split silently inventing a reading).
    """
    return _rewrite_all(records, shard, lambda rec: title_for(rec.get("url")))
