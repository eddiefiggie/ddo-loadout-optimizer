"""#765 — randomly-rolled effect groups, sourced STRUCTURALLY from the catalog.

An item that "rolls one of" a list offers several mutually-exclusive effects; the
loot decides which you get. The solver has modelled this since the beginning — a
per-option binary gated by the host, one pick per group, fed into the option's own
(stat, bonus_type) bucket (`web/solver.js`, the roll-group loop) — and every
consumer downstream already reads it: `rollPlaced` is persisted, projected and
reported. **Nothing fed it.** Zero variants carried `roll_groups`.

The reason is archaeology rather than design. `roll_groups` used to come from
`affix_parser.parse_line`, which reads a free-text line beginning "rolls one of".
The gear-planner overhaul (U7) moved items to native affix blocks, so no item's
text reaches that parser any more, and the field quietly went empty while the
machinery behind it stayed.

## What #765 says, and what is actually true

The issue states: *"Every one of these pools is an empty dict in
`gearplanner_crafting.json` (`{"*": []}`) ... the options are not in the catalog
and this is wiki-gated."*

They are not empty and it is not wiki-gated. They are **per-item** pools — the
second shape `crafting_catalog` documents, keyed by host name rather than `"*"` —
and every option is fully typed:

    "One of the following": {
      "Drow Dagger of the Weapon Master": [
        {"affixes": [{"name": "Combat Mastery", "type": "Insight", "value": "5"}]},
        ...

So this module reads them the way every other pool is read: structurally, at the
catalog's single load point, with no free text re-parsed (AGENTS.md).

## Rolled is not crafted, and the record says so

A craft is a choice the player makes at an altar; a roll is one the loot already
made. For a best-in-slot answer the relevant roll is the best one, exactly as a
craft slot is treated — theoretical best-in-slot assumes access to everything, and
attainability is a non-goal. But the two must not READ alike, so every group
carries `source: "roll"` and the raw label it came from, and the result surfaces it
as a drop rather than a crafting step.

## What is refused

An option whose affix cannot be read as (stat, bonus_type, value) is dropped and
counted, never guessed at. A group left with no readable option is not emitted at
all: an empty choice slot is worse than an absent one, because the solver would
gate a host on a group that can never fire.
"""
from __future__ import annotations

from src import crafting_catalog
from src import spell_focus

#: The catalog keys whose pools are random-roll groups. Exact strings, because the
#: gate keys off them too and a prefix match would sweep in a future
#: "One of the following" pool that turns out to be a real craft menu.
ROLL_POOL_KEYS = (
    "One of the following",
    "One of the following ability bonuses",
    "One of the following bonuses",
    "One of the following combinations",
    "One of the following effects",
    "One of the following Spell Power bonuses",
    "One of the following tactics bonuses",
    "One of the following sets, at random",
    "Random effect",
)


class RollGroupError(Exception):
    """The catalog is shaped in a way this module cannot trust."""


def _option(aff) -> dict | None:
    """One catalog affix -> a solver-ready roll option, or None if unreadable."""
    legacy = crafting_catalog.legacy_affix(aff)
    if not legacy:
        return None
    stat = legacy.get("stat")
    btype = legacy.get("bonus_type")
    value = legacy.get("value")
    if not stat or not btype or value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        # The solver skips a non-positive option anyway (`opt.value > 0`); dropping
        # it here means the count says so rather than the group silently shrinking.
        return None
    return {
        "stat": stat,
        "bonus_type": btype,
        "value": legacy.get("value"),
        "unit": legacy.get("unit") or "flat",
    }


def build(catalog: dict = None) -> dict:
    """`{host_name: [group, ...]}` plus coverage.

    A group is `{"raw", "source", "options"}` — the shape `variants` attaches as
    `roll_groups` and `web/solver.js` already consumes.
    """
    catalog = crafting_catalog.load_catalog() if catalog is None else catalog

    present = [k for k in ROLL_POOL_KEYS if k in catalog]
    if not present:
        raise RollGroupError(
            "no random-roll pools in the catalog at all: every key in ROLL_POOL_KEYS "
            "is absent, which is a shape change rather than an empty game")

    by_host: dict[str, list] = {}
    dropped = 0
    compound = 0
    universal = 0
    groups = 0
    options = 0
    by_label: dict[str, dict] = {}

    for label in present:
        pool = catalog[label]
        if not isinstance(pool, dict):
            raise RollGroupError(f"roll pool {label!r} is {type(pool).__name__}, expected a dict")
        if "*" in pool:
            # A menu pool under a roll label would mean the catalog reclassified it;
            # serving it as a per-host roll would attach one item's options to all.
            raise RollGroupError(
                f"roll pool {label!r} is a `*` MENU pool, not per-item — it is no "
                "longer a roll group and must be re-adjudicated, not auto-served")
        label_groups = label_options = 0
        for host, opts in pool.items():
            readable = []
            for opt in opts or []:
                affs = list(crafting_catalog.iter_affixes(opt))
                if len(affs) > 1:
                    # NEVER SPLIT. One roll grants every affix in its option, so
                    # emitting them as separate options would let the solver take
                    # `Negative Energy Absorption +12` off a Shield of Morning roll
                    # WITHOUT the `Deathblock` that comes with it — and would count
                    # one roll as several competing choices. That is the fan-out
                    # defect `container_registry` documents, and the FLAT contract
                    # this container declares is only safe while every source option
                    # carries exactly one affix. The solver's roll loop is
                    # one-stat-per-option too, so the multi-affix ones are refused
                    # and counted rather than modelled wrong.
                    compound += 1
                    continue
                for aff in affs:
                    o = _option(aff)
                    if o is None:
                        dropped += 1
                        continue
                    # An UMBRELLA stat — `Resistance` (31 options), `Combat
                    # Mastery` (16), `Good Luck` (1) — is expanded into its
                    # components everywhere else in the pipeline, so leaving one
                    # here would
                    # name a stat no player can rank — the option would be dead,
                    # and `test_no_universal_stat_survives_anywhere_in_the_built_dataset`
                    # says so. Expanding it is not the fix either: one roll grants
                    # every component, and a flat one-stat-per-option pool would
                    # turn that into several competing choices, so the solver could
                    # take ONE and the item would read weaker than it is. Refused
                    # for the same reason a compound option is.
                    if spell_focus.is_universal(o["stat"]):
                        universal += 1
                        continue
                    readable.append({**o, "raw": label})
            if not readable:
                continue
            by_host.setdefault(host, []).append({
                "raw": label,
                "source": "roll",
                "options": readable,
            })
            label_groups += 1
            label_options += len(readable)
        groups += label_groups
        options += label_options
        by_label[label] = {"groups": label_groups, "options": label_options}

    if not groups:
        raise RollGroupError(
            "refusing to emit an empty roll-group pool: the catalog carries "
            f"{len(present)} roll pools and none produced a readable option, which "
            "means the affix shape moved rather than that the game changed")

    # #765 — the same options, flattened per host. The grouped form above is what
    # a variant carries (the solver needs the group boundary: one pick per group);
    # this is the census the coverage gate and the container gate read, and it is a
    # SEPARATE audit rather than a duplicate one — `roll_groups_per_item` judges
    # what the builder produced, the derived `roll_groups` container judges what
    # actually landed on items, and the two disagreeing is exactly how a broken
    # attach step would show itself.
    per_item = {host: [dict(o) for g in gs for o in g["options"]]
                for host, gs in by_host.items()}

    return {
        "by_host": by_host,
        "per_item": per_item,
        "source_options": sum(len(v) for v in per_item.values()),
        "coverage": {
            "labels": sorted(present),
            "labels_absent": sorted(set(ROLL_POOL_KEYS) - set(present)),
            "hosts": len(by_host),
            "groups": groups,
            "options": options,
            "options_dropped_unreadable": dropped,
            "options_refused_compound": compound,
            "options_refused_universal": universal,
            "by_label": by_label,
            "note": ("Rolled, not crafted: the loot picks one option per group, so the "
                     "solver takes the best one for the player's priorities the way it "
                     "treats a craft slot, and the result labels it a drop rather than "
                     "a crafting step. Attainability is not a solver input. "
                     "`options_refused_compound` counts source options granting MORE "
                     "than one affix: one roll grants them all, so splitting them "
                     "into separate choices would offer half a roll. They are refused "
                     "rather than split, and the group keeps its other options."),
        },
    }
