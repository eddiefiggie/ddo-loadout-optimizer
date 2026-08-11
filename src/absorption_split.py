"""U5/U6 (#249) — expand the compound absorption names into their elements.

Three stat names in the dataset name several elements at once, so a player
ranking a single element scored nothing from any of the seventeen affix records
that carry one. The reported symptom was ranking `Fire Absorption` and getting
nothing from the Crown of Ioun, whose only absorption affixes are
`Fire and Cold Absorption` and `Electricity and Acid Absorption`.

`docs/wiki-evidence/compound-absorption.md` is the ruling. Two mechanisms:

  * **The two paired names expand unconditionally.** The rendered tooltip names
    the compound rather than its parts, but `Template:Absorption`'s own
    categorization is unambiguous: the `fireandcold` branch emits membership of
    BOTH the `Fire Absorption +N%` and `Cold Absorption +N%` categories from one
    invocation at magnitude N. The wiki therefore treats the compound as
    granting N to *each* element, not N split between them — which is why R4
    expands at the compound's FULL magnitude. Halving it would under-credit
    every carrier, and is the shape of guess this project forbids.
  * **`Elemental Absorption` expands PER ITEM.** The template takes a third
    parameter deciding whether Sonic is included, and the distinction lives in
    the rendered tooltip; the visible cell reads `Elemental Absorption +N%`
    either way. gear-planner stores nothing that distinguishes a four-element
    carrier from a five-element one, so the flag is per-item wiki evidence in
    `data/seed/compendium/elemental_absorption.json`. A blanket four-way
    expansion under-credits Sonic on five records; a blanket five-way
    over-credits it on eight. Neither is safe.

**This family does NOT run through `src/enchantment_split.py`'s shared
rewriter** (KTD6). That rewriter reads each contribution's magnitude out of the
shard entry, and this shard stores only a Sonic flag — the magnitude comes from
the affix itself, which is exactly what R4's full-magnitude rule requires. What
it does reuse is the vocabulary: `STATED`, and the `quarantined` counter.

**Quarantine is REMOVAL, not pass-through** (R7, U6). The shared rewriter's
default for a missing shard entry is "leave the affix alone, count uncovered".
That is precisely the state R7 forbids here: registering this family adds the
compound names to the expanded-away set, and that removal is global by name —
the picker drops them from suggestions and the add-a-priority gate refuses them.
A carrier left unexpanded would therefore ship an affix no player can rank,
which is strictly worse than before the change. So an absent entry, an entry
whose provenance is not `stated`, and an entry with no Sonic flag at all are all
removed and counted; there is deliberately **no `uncovered` counter**, because a
separate counter is where the forbidden state would hide.

No anti-shadow rule, unlike the parrying and speed splits. `web/model.js`
buckets by stat plus stacking-equivalent type and keeps the MAX, so a component
this family emits alongside one the item already states resolves to the larger
of the two on its own. The umbrella and spell-focus families rely on the same
property and suppress nothing; adding a dedupe here would be a behavior change
dressed as a default.
"""
from __future__ import annotations

import re

from src import enchantment_split
from src.enchantment_split import STATED, DEFAULTED, UNSOURCED  # noqa: F401
from src.spell_focus import PROVENANCE_KEY

# --- The compound names, and what each covers --------------------------------

FIRE_AND_COLD = "Fire and Cold Absorption"
ELECTRICITY_AND_ACID = "Electricity and Acid Absorption"
ELEMENTAL = "Elemental Absorption"

# The component stats, spelled as the DATASET spells them. `Electric Absorption`
# is deliberately not "Electricity": the compound's own wording is "Electricity",
# but 63 items carry the affix under `Electric Absorption`, and expanding to the
# compound's spelling would target a name no item bears — trading one invisible
# stat for another.
ACID = "Acid Absorption"
COLD = "Cold Absorption"
FIRE = "Fire Absorption"
ELECTRIC = "Electric Absorption"
SONIC = "Sonic Absorption"

ELEMENTAL_WITHOUT_SONIC = (ACID, COLD, FIRE, ELECTRIC)
ELEMENTAL_WITH_SONIC = ELEMENTAL_WITHOUT_SONIC + (SONIC,)

# Compounds settled by the template's categorization alone — no per-item
# evidence is missing, so these can never quarantine.
_STATIC = {
    FIRE_AND_COLD.lower(): (FIRE, COLD),
    ELECTRICITY_AND_ACID.lower(): (ELECTRIC, ACID),
}
# Compounds whose element set is per-item and must be read from the shard.
_SHARD_GATED = {ELEMENTAL.lower()}

# The picker drops these dataset-wide and redirects to what they become. For
# `Elemental Absorption` that is the UNION across the dataset — five of the
# thirteen carriers do include Sonic, so a player redirected off the compound
# must be shown every name it becomes somewhere.
#
# Registering a name here without expanding the set-bonus channel fails the
# build: `build_dataset.py` raises on any set-bonus affix naming an expanded-away
# stat, and its known-orphan allowlist is empty by design. No set-bonus tier
# names one of these today (asserted, not assumed, in tests/test_absorption_split.py),
# and a set bonus carries no per-item shard key to read a Sonic flag from — so a
# future one is meant to fail the build loudly rather than be expanded on a guess.
EXPANDED_AWAY = {
    FIRE_AND_COLD.lower(): [FIRE, COLD],
    ELECTRICITY_AND_ACID.lower(): [ELECTRIC, ACID],
    ELEMENTAL.lower(): list(ELEMENTAL_WITH_SONIC),
}

# The per-record quarantine marker (U6). Stamped on the planner record, carried
# onto the variant by `src/variants.py:_make_variant` exactly as `material` is,
# and read off the worn variants by `web/solver.js` — because quarantine is
# decided here against the seed shard, and neither the solver nor the model ever
# receives dataset metadata.
QUARANTINE_FIELD = "absorption_quarantined"

# Why a carrier was excluded. Named rather than spelled inline: several functions
# and the browser disclosure branch on these, and a bare literal drifting by one
# character in one of them is the failure shape that let the material coverage
# gate pass on corrupted input.
ABSENT = "absent"          # no shard entry, or an entry stating no Sonic flag
UNCONFIRMED = "unconfirmed"  # an entry whose provenance is not `stated`


def is_compound(stat) -> bool:
    """True when this stat name covers more than one element."""
    key = (stat or "").strip().lower()
    return key in _STATIC or key in _SHARD_GATED


# --- Reading the shard --------------------------------------------------------

# `{{Absorption|Elemental|20|yes}}` -> magnitude 20, sonic token "yes".
_INVOCATION = re.compile(
    r"^\{\{\s*absorption\s*\|\s*elemental\s*\|\s*(\d+)\s*(?:\|\s*([a-z0-9]+)\s*)?\}\}$",
    re.I)
# The template's own switch. Anything outside both sets is unreadable, and
# unreadable must not collapse into a falsy "no sonic" — "we cannot read this"
# and "this grants no sonic" are different claims.
_SONIC_TRUE = {"yes", "y", "1", "true", "sonic"}
_SONIC_FALSE = {"no", "n", "0", "false"}

# The two rendered dialects, captured verbatim from the live pages. Neither is a
# substring of the other; the order is explicit to document that both are real
# rather than one being a fallback for a parse failure.
_TIP_WITH_SONIC = re.compile(
    r"Acid,\s*Cold,\s*Fire,\s*Electrical,\s*and\s*Sonic\s+Absorption", re.I)
_TIP_WITHOUT_SONIC = re.compile(
    r"Acid,\s*Cold,\s*Fire,\s*and\s*Electrical\s+Absorption", re.I)


def invocation_sonic(raw: str):
    """Whether a `{{Absorption|Elemental|N|X}}` invocation includes Sonic.

    None when the invocation does not parse or its third parameter is outside the
    template's own switch — never a falsy default.
    """
    match = _INVOCATION.match((raw or "").strip())
    if not match:
        return None
    token = (match.group(2) or "no").strip().lower()
    if token in _SONIC_TRUE:
        return True
    if token in _SONIC_FALSE:
        return False
    return None


def invocation_key(raw: str):
    """Normalize an invocation to its snapshot key, or None when unparsable.

    The snapshot store holds ONE tooltip per distinct rendering, not per
    magnitude — `{{absorption|elemental|n}}` and `{{absorption|elemental|n|yes}}`
    — because the magnitude is echoed into the tooltip and settles nothing about
    coverage. So the magnitude normalizes to `n` and the sonic token normalizes
    to the canonical `yes`, which is why a future `|true` carrier resolves
    against the snapshot already harvested rather than reading as unsnapshotted.
    """
    sonic = invocation_sonic(raw)
    if sonic is None:
        return None
    return "{{absorption|elemental|n|yes}}" if sonic else "{{absorption|elemental|n}}"


def snapshot_for(shard: dict, raw: str):
    """The stored tooltip snapshot for an invocation, or None when unharvested."""
    key = invocation_key(raw)
    if key is None:
        return None
    return ((shard or {}).get("snapshots") or {}).get(key)


def tooltip_includes_sonic(tooltip: str):
    """Whether a rendered tooltip names Sonic, or None when it matches no dialect."""
    text = tooltip or ""
    if _TIP_WITH_SONIC.search(text):
        return True
    if _TIP_WITHOUT_SONIC.search(text):
        return False
    return None


def _entry_components(entry):
    """`(components, None)` for a confirmed entry, `(None, reason)` otherwise.

    R7's two clauses, in order: an entry that is not `stated` is unconfirmed, and
    an entry whose Sonic flag is absent states nothing about coverage — defaulting
    either way would be the inference this project forbids, wearing a `stated`
    provenance as cover.
    """
    if entry is None:
        return None, ABSENT
    if entry.get("provenance") != STATED:
        return None, UNCONFIRMED
    sonic = (entry.get("value") or {}).get("sonic")
    if sonic is None:
        return None, ABSENT
    return (ELEMENTAL_WITH_SONIC if sonic else ELEMENTAL_WITHOUT_SONIC), None


def components_for(stat, item_name, shard: dict):
    """What one compound affix on one item becomes.

    Returns `(components, None)` when the expansion is confirmed, or
    `(None, reason)` when the carrier must be quarantined. A non-compound stat
    returns `(None, None)` — neither expanded nor quarantined.
    """
    key = (stat or "").strip().lower()
    if key in _STATIC:
        return _STATIC[key], None
    if key not in _SHARD_GATED:
        return None, None
    harvested = (shard or {}).get("harvested") or {}
    return _entry_components(harvested.get(item_name))


# --- The expansion ------------------------------------------------------------

def empty_stats() -> dict:
    """The counter vocabulary. `quarantined` is the parrying spelling.

    There is deliberately NO `uncovered` counter — see the module docstring.
    """
    return {"carriers": 0, "expanded": 0, "components": 0, "quarantined": 0,
            "quarantined_absent": 0, "quarantined_unconfirmed": 0, "excluded": []}


def apply(records, shard: dict) -> dict:
    """Expand every compound absorption affix on every ITEM record, in place.

    Joins by item **name**, matching the parrying and heightened-awareness shards:
    the thirteen `Elemental Absorption` carriers are tier variants whose names
    carry the level, so a name join is unambiguous.

    Every other key on the source affix — `type`, `value`, and anything a later
    stage added — is copied verbatim onto each component, so the expansion keeps
    the bonus type and unit semantics of the source (R5).
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

            compound = affix["name"]
            components, reason = components_for(compound, name, shard)
            if components is None:
                # R7 — removed, not left in place. The compound name has left the
                # picker, so passing it through would ship an affix no player can
                # rank.
                stats["quarantined"] += 1
                stats["quarantined_absent" if reason == ABSENT
                      else "quarantined_unconfirmed"] += 1
                # The candidate set is what the compound COULD have become. That
                # is a fact about the name, not a claim about this item — it is
                # what lets the browser disclosure fire only for a player who
                # ranked a stat the exclusion could bear on.
                detail = {"stat": compound, "reason": reason,
                          "components": list(ELEMENTAL_WITH_SONIC)}
                excluded.append(detail)
                stats["excluded"].append({"item": name, **detail})
                continue

            for component in components:
                # R12 — the emitted affix names the enchantment engraved on the
                # item, bare. The wiki's visible cell reads "Fire and Cold
                # Absorption +22%" with the bonus type only in the tooltip prose,
                # so a type-prefixed label would print text no player can find.
                out.append({**affix, "name": component, PROVENANCE_KEY: compound})
            stats["expanded"] += 1
            stats["components"] += len(components)

        rec["affixes"] = out
        if excluded:
            rec[QUARANTINE_FIELD] = excluded

    return stats


# --- Audits and the guard -----------------------------------------------------

def audit_shard(shard: dict) -> dict:
    """Report `unsourced` entries as harvest suspects rather than accepting them.

    Thin wrapper over the shared implementation, which was already parameterised
    on `label` for exactly this reuse. Kept as a named function so call sites read
    in this module's vocabulary; the body must not be re-inlined — a second copy
    is a place a fix to the shared logic silently would not reach.
    """
    return enchantment_split.audit_shard(shard, label="elemental absorption shard")


def audit_snapshots(shard: dict) -> dict:
    """Report which invocations still lack a rendered-tooltip snapshot.

    Keyed through `invocation_key`, not the shared `snapshot_key`: this store
    holds one tooltip per RENDERING rather than per magnitude, so the shared
    key — which normalizes case only — would report all thirteen raw invocations
    as unsnapshotted and turn a real gap into noise nobody reads.

    Raises on an empty shard, for the same reason `audit_shard` does.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError("elemental absorption shard is empty — refusing to report "
                         "snapshot coverage over zero records")

    invocations = set()
    unparsable = []
    for title, entry in sorted(harvested.items()):
        raw = (entry or {}).get("raw")
        if not raw:
            continue
        key = invocation_key(raw)
        if key is None:
            unparsable.append(title)
            continue
        invocations.add(key)
    stored = set((shard.get("snapshots") or {}))
    missing = sorted(invocations - stored)
    return {"invocations": len(invocations), "snapshotted": len(invocations) - len(missing),
            "missing": len(missing), "missing_keys": missing, "unparsable": unparsable}


def check_against_snapshots(shard: dict) -> dict:
    """Assert every recorded Sonic flag against the wiki's own rendered tooltip.

    Three things are checked per `stated` entry, and the third is the one that
    matters: the invocation must parse; the recorded flag must equal what the
    rendered tooltip states; and the flag must ALSO equal what the invocation's
    own third parameter states. Without that last assertion the tooltip only
    proves a snapshot agrees with itself — a snapshot filed under the wrong key
    would compare clean and ship the wrong element set with the build green,
    which is the green-while-red failure the parrying guard was extended to close.

    Reports `compared` separately from `checked`, and refuses to pass when it is
    zero. `checked` counts entries the guard reached a verdict on, including
    non-`stated` ones that are simply not solver-eligible; only `compared` counts
    a flag actually matched against a parsed tooltip. A shard whose entries all
    failed to resolve would otherwise return a healthy-looking count having
    verified nothing.

    Offline — reads only what is already on disk. Raises on an empty shard.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError("elemental absorption shard is empty — refusing to report "
                         "a clean guard over zero records")

    problems = []
    checked = 0
    independent = 0
    compared = 0
    stated = 0
    for title, entry in sorted(harvested.items()):
        entry = entry or {}
        raw = entry.get("raw") or ""
        provenance = entry.get("provenance")

        # Unknown provenance is a defect, not a skip. A one-character retype would
        # otherwise fall past every branch while `apply` quarantines the entry and
        # silently drops its contribution.
        if provenance not in (STATED, DEFAULTED, UNSOURCED):
            problems.append(f"{title}: unknown provenance {provenance!r}")
            continue

        if provenance != STATED:
            # Not solver-eligible, so there is no derived element set to verify.
            # `audit_shard` reports an unsourced one as a harvest suspect without
            # failing the build.
            checked += 1
            continue
        stated += 1

        stated_by_invocation = invocation_sonic(raw)
        if stated_by_invocation is None:
            problems.append(
                f"{title}: {raw!r} is not a parsable Elemental Absorption invocation")
            continue

        snapshot = snapshot_for(shard, raw)
        if snapshot is None:
            problems.append(f"{title}: no tooltip snapshot for {raw!r}")
            continue

        tooltip = snapshot.get("tooltip")
        stated_by_tooltip = tooltip_includes_sonic(tooltip)
        if stated_by_tooltip is None:
            problems.append(
                f"{title}: tooltip for {raw!r} matches no known dialect, so it "
                f"cannot verify anything: {(tooltip or '')[:80]!r}")
            continue

        checked += 1
        compared += 1

        recorded = (entry.get("value") or {}).get("sonic")
        if recorded is None:
            problems.append(
                f"{title}: `stated` but records no `sonic` flag — a `stated` entry "
                "must carry the reading it claims to have made")
        elif bool(recorded) != stated_by_tooltip:
            problems.append(
                f"{title}: recorded sonic={recorded!r} but the tooltip for {raw!r} "
                f"states {stated_by_tooltip!r}")

        if recorded is not None and bool(recorded) != stated_by_invocation:
            problems.append(
                f"{title}: recorded sonic={recorded!r} disagrees with its own "
                f"invocation {raw!r} — the snapshot is paired with the wrong invocation")

        # The only witness independent of `raw`.
        #
        # Everything above traces back to `raw`: `snapshot_for` KEYS the shared
        # snapshot on the invocation, so `stated_by_tooltip` is a pure function of
        # `stated_by_invocation` and the two can never disagree. An entry whose
        # value and cited invocation were captured together from the same wrong
        # place — the harvester read the neighbouring tier row, or dropped the
        # `|yes` — agrees with itself all the way down and the guard goes green
        # while a player silently loses (or gains) a whole element.
        #
        # A per-item tooltip is a second reading of THAT item's own rendered page,
        # so it is the one field that can contradict `raw`. It is required for a
        # `stated` entry: a flag that rests only on a snapshot the invocation
        # itself chose has not actually been verified against anything.
        # See docs/solutions/conventions/corrupt-the-value-and-its-reference-together.md.
        per_item = entry.get("tooltip")
        if not per_item:
            problems.append(
                f"{title}: `stated` but carries no per-item tooltip — the shared "
                "snapshot is keyed by the invocation, so without this the flag is "
                "verified only against itself")
        else:
            by_item = tooltip_includes_sonic(per_item)
            if by_item is None:
                problems.append(
                    f"{title}: per-item tooltip matches no known dialect, so it "
                    f"cannot verify anything: {per_item[:80]!r}")
            else:
                independent += 1
                if recorded is not None and bool(recorded) != by_item:
                    problems.append(
                        f"{title}: recorded sonic={recorded!r} but this item's own "
                        f"tooltip states {by_item!r} — the value and its cited "
                        "invocation are wrong together")

    # Every `stated` entry must have reached a comparison. Each failure path above
    # already appends a problem, so this is belt-and-braces — it catches a future
    # branch that skips an entry without recording why.
    if compared < stated:
        problems.append(
            f"{stated - compared} `stated` entr(ies) were never compared against a "
            "tooltip — the guard cannot vouch for them")

    # The same belt-and-braces for the independent witness: a future branch that
    # skips the per-item check without recording why must not read as verified.
    if independent < stated:
        problems.append(
            f"{stated - independent} `stated` entr(ies) were never checked against "
            "their own item tooltip — only against a snapshot their own invocation "
            "selected, which cannot contradict them")

    # Refuse to report a clean run that verified no flag — but only when the run is
    # otherwise clean, so a real diagnosis is never buried behind this.
    if not compared and not problems:
        raise ValueError(
            "elemental absorption guard compared no recorded flag against a tooltip "
            "— refusing to pass")

    return {"checked": checked, "compared": compared, "independent": independent, "problems": problems}
