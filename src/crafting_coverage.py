"""U1 — the unserved-crafting-slot gate.

An item declares its crafting slots as free-text labels (`crafting: ["Red Augment
Slot", "Claw (Accessory)", "Sealed in Fire", ...]`). A *pool* is what the solver
can actually put into such a slot. When a label no pool serves appears, the slot
is inert: the player sees it in the compendium and the solver crafts nothing into
it. 35 such labels exist today (415 item-slot declarations) — Slaver's crafting,
Essence Crafting, the "One of the following" random-effect wordings — and each is
a known, deliberate gap.

This module turns that baseline into a build gate, so a snapshot refresh cannot
quietly strand a pool. It fails in **both** directions:

- a declared label nothing serves that is not on `UNSERVED_ALLOWLIST` — a NEW
  inert slot, i.e. new upstream data the pipeline does not model yet;
- an allowlisted label that is no longer declared by any item, or that a pool has
  since started serving — a stale exception. A one-directional allowlist rots
  silently: it keeps vouching for labels that no longer exist, and the next real
  gap hides behind the noise.

**Served labels come from each pool's real keying, never from its name.** Two
earlier attempts string-matched pool keys against label text and falsely flagged
the Sealed-in and dino pools, both of which are served — the seal pool keys by
`seal_type` (`Fire` -> `"Sealed in Fire"`), the dino pool by `dino_type` (`Claw`).
The mapping per pool:

| pool | keyed by | label |
|---|---|---|
| `augments` | `fits_slots` colors of every `category == "augment"` item | `"<Color> Augment Slot"` |
| `augment_set_defs` | each def's own `fits_slots` (#316: a Set Augment goes in any colour it fits) | `"<Color> Augment Slot"` |
| `membership_set_defs` | each def's `tier`, and membership.dino_pool() for the Dino half | `"Lost Purpose"` / `"Legendary Lost Purpose"` / the Dino Set-Bonus label |
| `viktranium` | `slot_type` | as-is (`"Dolorous"`) |
| `nearly_complete` | `category` | `"Nearly Complete: <category>"` |
| `nearly_complete_per_item` | each option's `pool`, **plus the host name** | `"Nearly Finished"` / `"Almost There"` |
| `dino_inserts` | `dino_type` | as-is (`"Claw"`) |
| `seal` | `seal_type` | `"Sealed in <seal_type>"` |
| `legendary_green_steel` | `tier_key` (`"T1 (Equipment)"` / `"T1 (Weapon)"`) | base label (`"T1"`) |

None of `fits_slots`, `dino_type`, `category` or `seal_type` exists in
`gearplanner_crafting.json` — all four are produced downstream by `src/colors.py`,
`src/dino.py`, `src/seal.py` and `src/viktranium.py`. So the gate runs on the
**derived pool records**, late in `build_dataset.py`, after every pool builder.

**Vacuity is per named pool.** A pool that walks zero records raises for that
pool by name. An aggregate "did we inspect anything" check would stay green while
one pool quietly emptied, because a populated sibling vouches for it — and a
retired pool is exactly how a refresh strands slots.

**A per-item pool needs a second, finer gate (#371).** Every pool above serves a
LABEL: once `Sealed in Fire` is sourced, every item declaring it is served. The
per-item Nearly Complete pools are keyed by HOST NAME instead, so sourcing the
pool serves 43 of the 65 `Nearly Finished` declarers and none of the other 22.
Label-level coverage would call that whole slot "served" and the 22 inert slots
would be invisible again — the exact failure mode of the blanket allowlist entry
this replaced. `per_item_host_coverage` therefore checks membership per host and
names every uncovered one, and `PER_ITEM_UNCOVERED_HOSTS` must match it exactly:
a 23rd uncovered item fails the build, and so does an entry upstream has since
sourced.
"""
from __future__ import annotations

import re

from src import membership

# Strip a label's parenthetical qualifier: an item declares `"Claw (Accessory)"`
# and `"Fang (Armor)"` for one `Claw`/`Fang` pool, and green steel keys its
# records `"T1 (Equipment)"` / `"T1 (Weapon)"` for one `T1` slot. The qualifier
# names the host category, not a different slot, so both sides normalize the
# same way.
_QUALIFIER = re.compile(r"\s*\(.*$")


def base_label(label) -> str:
    """The base form of a crafting-slot label, qualifier stripped."""
    return _QUALIFIER.sub("", str(label or "")).strip()


# The Dinosaur Bone Set-Bonus slot. Served by the membership primitive, NOT by
# `augment_set_defs`: `build_dataset` attaches these hosts a `set_membership_slot`
# over `membership.dino_pool(membership_set_defs)` (see
# `membership.attach_dino_set_bonus_slots`). Set Augments are a different
# mechanism that lands in colour augment slots.
DINO_SET_BONUS_LABEL = "Isle of Dread: Set Bonus Slot: Empty"

# The 35 declared labels no pool serves today (415 item-slot declarations).
# Every entry is an inert slot with a known reason; adding one is a deliberate
# act, and removing a label from the data must remove it from here too.
UNSERVED_ALLOWLIST = frozenset({
    # Essence Crafting — the crafted-blank prefix/suffix/extra menus. No pool.
    #
    # #374 — renamed 1:1 from `Cannith: *` in the 2026-08-18 refresh, and this one
    # ADOPTS upstream rather than defending our spelling. KTD1 says match what the
    # player sees, and the wiki's Essence Crafting page states outright: "Update 79
    # renamed it from Cannith Crafting to Essence Crafting". So `Essence Crafting`
    # is the current in-game name and ours was the stale one — the mirror of the
    # affix-vocabulary case, where the wiki backed us instead.
    #
    # These labels ARE player-visible: web/exporters.js renders each item's crafting
    # labels into every share export. The wiki also notes the system is "still better
    # known as" Cannith Crafting, so an old-name alias would help a player searching
    # the old term — but crafting slots have no alias mechanism (check_crafting_integrity
    # is exact-match set membership), so that needs new machinery and is filed, not
    # invented here.
    "Essence Crafting: Melee - Extra",
    "Essence Crafting: Melee - Prefix",
    "Essence Crafting: Melee - Suffix",
    "Essence Crafting: Ring - Extra",
    "Essence Crafting: Ring - Prefix",
    "Essence Crafting: Ring - Suffix",
    "Essence Crafting: Rune Arm - Extra",
    "Essence Crafting: Rune Arm - Prefix",
    "Essence Crafting: Rune Arm - Suffix",
    # Slaver's crafting — heroic and legendary. No pool.
    "Slaver's Bonus Slot",
    "Slaver's Extra Slot",
    "Slaver's Prefix Slot",
    "Slaver's Suffix Slot",
    "Slaver's Set Bonus",
    "Legendary Slaver's Bonus Slot",
    "Legendary Slaver's Extra Slot",
    "Legendary Slaver's Prefix Slot",
    "Legendary Slaver's Suffix Slot",
    "Legendary Slaver's Set Bonus",
    # #371 — `Nearly Finished` and `Almost There` were here, as "browse-visible
    # but not solver-wired". They are now SERVED by `nearly_complete_per_item`
    # (see POOL_READERS below), so the blanket entry would be a lie. The 22
    # declarers upstream's pool does not cover are disclosed BY NAME in
    # `PER_ITEM_UNCOVERED_HOSTS` instead — a slot-level allowlist cannot tell a
    # covered host from an uncovered one, which is the whole lesson of #195.
    # Random / "one of the following" wordings: the item rolls one effect from a
    # list the catalog states as prose. Not a craftable choice slot.
    "One of the following",
    "One of the following ability bonuses",
    "One of the following bonuses",
    "One of the following combinations",
    "One of the following effects",
    "One of the following Spell Power bonuses",
    "One of the following tactics bonuses",
    "One of the following sets, at random",
    "Random effect",
    "Random set 1",
    "Random set 2",
})


# --- per-pool served labels ---------------------------------------------------
#
# Each reader returns `(records_walked, labels)`. `records_walked` is what the
# per-pool vacuity check judges, so it counts the records the reader actually
# looked at — never a constant, and never a sibling's count.

def _augments(dataset):
    recs = [it for it in dataset.get("items") or []
            if it.get("category") == "augment"]
    labels = {f"{color} Augment Slot"
              for a in recs for color in (a.get("fits_slots") or [])}
    return len(recs), labels


def _augment_set_defs(dataset):
    defs = dataset.get("augment_set_defs") or {}
    labels = {f"{color} Augment Slot"
              for d in defs.values() for color in (d.get("fits_slots") or [])}
    return len(defs), labels


def _membership_set_defs(dataset):
    defs = dataset.get("membership_set_defs") or {}
    dino = set(membership.dino_pool())
    labels = set()
    for name, d in defs.items():
        if name in dino:
            labels.add(DINO_SET_BONUS_LABEL)
            continue
        # The Vecna half: `membership._LOST_PURPOSE_KEY` is the mapping the
        # builder itself reads the pool through, so the label cannot drift away
        # from the menu it is sourced from.
        label = membership._LOST_PURPOSE_KEY.get(d.get("tier"))
        if label:
            labels.add(label)
    return len(defs), labels


def _viktranium(dataset):
    recs = dataset.get("viktranium") or []
    return len(recs), {base_label(r.get("slot_type")) for r in recs
                       if r.get("slot_type")}


def _nearly_complete(dataset):
    recs = dataset.get("nearly_complete") or []
    return len(recs), {f"Nearly Complete: {r['category']}" for r in recs
                       if r.get("category")}


def _nearly_complete_per_item(dataset):
    """#371 — the per-item Nearly Complete pools, keyed by HOST NAME.

    Labels come from each option's own `pool` field, never from the pool's name,
    for the same reason the seal reader keys off `seal_type`. Serving is only
    half the story here: a per-item pool serves the hosts it has entries for, so
    label-level coverage is checked below by `per_item_host_coverage`.
    """
    by_host = dataset.get("nearly_complete_per_item") or {}
    recs = [r for opts in by_host.values() for r in opts or []]
    return len(recs), {r["pool"] for r in recs if r.get("pool")}


def _dino_inserts(dataset):
    recs = dataset.get("dino_inserts") or []
    return len(recs), {base_label(r.get("dino_type")) for r in recs
                       if r.get("dino_type")}


def _seal(dataset):
    recs = dataset.get("seal") or []
    return len(recs), {f"Sealed in {r['seal_type']}" for r in recs
                       if r.get("seal_type")}


def _legendary_green_steel(dataset):
    """#687 — one pool for both blank classes; every record carries its menu key
    (`tier_key`), whose base label is what the blanks' `crafting[]` prints."""
    recs = dataset.get("legendary_green_steel") or []
    return len(recs), {base_label(r.get("tier_key")) for r in recs
                       if r.get("tier_key")}


def _essence_crafting(dataset):
    """Keyed by `menu` -> `"Essence Crafting: Trinket - <menu>"` (#193/#599).

    Serving a label here means the solver can craft SOMETHING into that menu, not
    that it can craft everything: 25 of 170 Trinket placements are offered, and
    the rest are disclosed to the player through
    `metadata.essence_crafting_coverage`. The other nine `Essence Crafting: *`
    labels (Melee, Ring, Rune Arm) stay on UNSERVED_ALLOWLIST because no pool
    fills them at all.
    """
    recs = dataset.get("essence_crafting") or []
    return len(recs), {f"Essence Crafting: Trinket - {r['menu']}" for r in recs
                       if r.get("menu")}


# Ordered so the report reads pool by pool. The keys are POOL names, and the
# gate never compares them against label text.
POOL_READERS = {
    "augments": _augments,
    "augment_set_defs": _augment_set_defs,
    "membership_set_defs": _membership_set_defs,
    "viktranium": _viktranium,
    "nearly_complete": _nearly_complete,
    "nearly_complete_per_item": _nearly_complete_per_item,
    "dino_inserts": _dino_inserts,
    "seal": _seal,
    "legendary_green_steel": _legendary_green_steel,
    "essence_crafting": _essence_crafting,
}


def served_labels(dataset: dict):
    """`(served, per_pool)` — the labels every pool can fill, by its own keying.

    Raises `SystemExit` naming any pool that walked zero records: a retired or
    empty pool strands every slot keyed to it, and an aggregate zero-inspection
    check would let a populated sibling vouch for it.
    """
    served = {}
    per_pool = {}
    empty = []
    for name, reader in POOL_READERS.items():
        walked, labels = reader(dataset)
        per_pool[name] = {"records": walked, "labels": sorted(labels)}
        if walked == 0:
            empty.append(name)
            continue
        for label in labels:
            served.setdefault(label, name)
    if empty:
        raise SystemExit(
            "crafting-slot coverage: pool(s) walked ZERO records: "
            + ", ".join(sorted(empty))
            + " — every crafting slot keyed to a retired pool is stranded, and a "
            "gate that inspects nothing cannot vouch for anything. Re-source the "
            "pool or retire its slots deliberately.")
    return served, per_pool


def declared_labels(dataset: dict) -> dict:
    """`{base label: item-slot declarations}` across every item's `crafting` list."""
    counts = {}
    for it in dataset.get("items") or []:
        for entry in it.get("crafting") or []:
            label = base_label(entry)
            if label:
                counts[label] = counts.get(label, 0) + 1
    return counts


def declared_examples(dataset: dict) -> dict:
    """`{base label: first item that declares it}` — so a failure names a host."""
    example = {}
    for it in dataset.get("items") or []:
        for entry in it.get("crafting") or []:
            example.setdefault(base_label(entry), it.get("source_item"))
    return example


# --- per-item pool host coverage (#371) ---------------------------------------

# The labels whose pool is keyed by HOST NAME rather than by a shared menu. Both
# are served by `nearly_complete_per_item`; both need the per-host gate below.
PER_ITEM_POOL_LABELS = ("Nearly Finished", "Almost There")

# The `Nearly Finished` declarers upstream's pool carries NO entry for. Named
# rather than allowlisted at the slot level, because the slot IS served for the
# other 43 and a label-level exception cannot tell the two apart.
#
# Reason, one shared cause: gear-planner's `data-builder/nearly-finished.json`
# (merged into `gearplanner_crafting.json`) enumerates the option list per item,
# and these 22 are not in it. That is an upstream sourcing gap, not a modelling
# decision of ours — every one of them is an item whose in-game slot exists. We
# do NOT infer the options (`Never infer a value`): the four Fire Over Morgrave
# heroics would be a plausible tier-down of their Legendary twins and a plausible
# number is still a guess. Their Legendary counterparts ARE covered, which is why
# the reporter's ML29 case is fixed and their ML18 case is not.
#
# The gate below fails in BOTH directions, so this list cannot rot: a new
# uncovered declarer must be added deliberately, and one upstream later sources
# must be removed.
PER_ITEM_UNCOVERED_HOSTS = frozenset({
    # Fire Over Morgrave — heroic tier (the Legendary twins are covered).
    "Alchemist's Crown",
    "Alchemist's Pendant",
    "Fabricator's Bracers",
    "Fabricator's Gauntlets",
    "Magewright's Cloak",
    "Magewright's Spectacles",
    "Tinker's Gloves",
    "Tinker's Goggles",
    # Weapons and accessories whose per-item option list upstream never filled in.
    "Baz'Morath, the Curator of Decay",
    "Constellation, Cursed Blade",
    "Fetters of the Forgewraith",
    "Hoarfrost, Herald of the Bitter Ice",
    "Stickerclick, the Bitter Hail of Bolts",
    "The Broken Blade of Constellation",
    "The Eclipse Itself",
    "The Everstorm, Maelstrom Courser",
    "The Fractured Elegance",
    "The Hallowed Splinters",
    "The Labrythine Edge",
    "The Shattered Hilt of Constellation",
    "The Wide Open Sky",
    "Untold, Crack in the Sky",
})


def per_item_host_coverage(dataset: dict) -> dict:
    """`{covered, uncovered, by_pool}` for the host-keyed pools — and the gate.

    Two independent facts are checked, because they can break independently:

    * **pool coverage** — every item declaring a per-item label either has an
      entry in `nearly_complete_per_item` or is named in
      `PER_ITEM_UNCOVERED_HOSTS`. Fails on a new uncovered host (the slot would
      ship inert and unnamed) and on a stale one (upstream sourced it, or the
      item was renamed, and the exception now vouches for nothing).
    * **marker threading** — a covered host carries the `nc_per_item_slots`
      marker the solver reads. Pool coverage alone does not prove the solver can
      see it: the pool shipped for two builds while every slot stayed inert
      precisely because nothing joined pool to host.

    Raises `SystemExit` on either. Refuses to pass on an empty universe.
    """
    by_host = dataset.get("nearly_complete_per_item") or {}
    declarers = {}          # pool label -> {item name}
    marked = {}             # pool label -> {item name carrying the marker}
    for it in dataset.get("items") or []:
        name = it.get("source_item")
        slots = {s.get("pool") for s in it.get("nc_per_item_slots") or []}
        for entry in it.get("crafting") or []:
            label = base_label(entry)
            if label not in PER_ITEM_POOL_LABELS:
                continue
            declarers.setdefault(label, set()).add(name)
            if label in slots:
                marked.setdefault(label, set()).add(name)

    if not declarers:
        raise SystemExit(
            "per-item crafting coverage: no item declares any of "
            f"{', '.join(PER_ITEM_POOL_LABELS)} — the gate refuses to pass on an "
            "empty universe. Either the labels were renamed upstream (follow the "
            "rename) or the pools were retired (drop this gate deliberately).")

    all_declarers = {n for names in declarers.values() for n in names}
    uncovered = {n for n in all_declarers if n not in by_host}
    problems = []

    new_uncovered = sorted(uncovered - PER_ITEM_UNCOVERED_HOSTS)
    if new_uncovered:
        problems.append(
            f"{len(new_uncovered)} item(s) declare a per-item Nearly Complete slot "
            f"that the pool has NO entry for:\n  "
            + "\n  ".join(repr(n) for n in new_uncovered)
            + "\n  Their slot ships inert — visible in the compendium, and the "
              "solver can craft nothing into it. Either the pool gained/lost hosts "
              "upstream, or these are a new sourcing gap: add each one to "
              "PER_ITEM_UNCOVERED_HOSTS in src/crafting_coverage.py with the reason.")

    stale = sorted(PER_ITEM_UNCOVERED_HOSTS - uncovered)
    if stale:
        problems.append(
            f"{len(stale)} named per-item exception(s) are no longer uncovered: "
            + ", ".join(repr(n) for n in stale)
            + " — either upstream sourced the pool for them (good news, drop the "
              "entry) or the item was renamed/retired (follow it). A one-"
              "directional exception list keeps vouching for names that no longer "
              "mean anything, and the next real gap hides in the noise.")

    unthreaded = sorted(
        n for label, names in declarers.items()
        for n in names
        if n in by_host and n not in (marked.get(label) or set()))
    if unthreaded:
        problems.append(
            f"{len(unthreaded)} item(s) the pool DOES cover carry no "
            f"`nc_per_item_slots` marker: {', '.join(repr(n) for n in unthreaded[:8])}"
            + (" …" if len(unthreaded) > 8 else "")
            + " — the pool is sourced but the solver cannot reach it, which is the "
              "inert slot with extra steps. Check the host gate threaded through "
              "src/planner_items.py and src/variants.py.")

    if problems:
        raise SystemExit("per-item crafting coverage gate failed:\n"
                         + "\n".join(problems))

    return {
        "pools": list(PER_ITEM_POOL_LABELS),
        "declaring_items": len(all_declarers),
        "covered_items": len(all_declarers) - len(uncovered),
        "uncovered_items": len(uncovered),
        "pool_hosts": len(by_host),
        "by_pool": {label: {"declared": len(names),
                            "covered": len(marked.get(label) or ()),
                            "uncovered": len(names - set(by_host))}
                    for label, names in sorted(declarers.items())},
        # By NAME, in the dataset itself — the disclosure a slot-level allowlist
        # could not make.
        "uncovered": sorted(uncovered),
    }


def check(dataset: dict) -> dict:
    """Fail the build on a newly-unserved crafting slot or a stale allowlist entry.

    `dataset` is the assembled build output, so the gate reads the DERIVED pool
    records. Returns the coverage counts to stamp into `metadata`; the stamped
    `labels_validated` is the number of declared labels that reached a verdict
    (served, or allowlisted-unserved), not the number of declarations walked.
    """
    served, per_pool = served_labels(dataset)
    declared = declared_labels(dataset)
    if not declared:
        raise SystemExit(
            "crafting-slot coverage: no item declared a crafting slot at all — "
            "the gate refuses to pass on an empty universe.")

    unserved = {label: n for label, n in declared.items() if label not in served}
    problems = []

    new_unserved = sorted(set(unserved) - UNSERVED_ALLOWLIST)
    if new_unserved:
        example = declared_examples(dataset)
        lines = "\n  ".join(
            f"{label!r} ({unserved[label]} item-slot(s), e.g. {example.get(label)!r})"
            for label in new_unserved)
        problems.append(
            f"{len(new_unserved)} crafting slot(s) are declared but NO pool serves "
            f"them:\n  {lines}\n  The slot is inert: it shows in the compendium and "
            "the solver crafts nothing into it. Either source a pool, or add the "
            "label to UNSERVED_ALLOWLIST in src/crafting_coverage.py with the reason.")

    stale_undeclared = sorted(UNSERVED_ALLOWLIST - set(declared))
    if stale_undeclared:
        problems.append(
            f"{len(stale_undeclared)} allowlisted crafting slot(s) are no longer "
            f"declared by any item: {', '.join(repr(s) for s in stale_undeclared)}"
            " — a stale exception. The label was renamed or dropped upstream; "
            "drop it from UNSERVED_ALLOWLIST (or follow the rename) so the "
            "allowlist keeps meaning what it says.")

    stale_now_served = sorted(
        label for label in UNSERVED_ALLOWLIST
        if label in declared and label in served)
    if stale_now_served:
        problems.append(
            f"{len(stale_now_served)} allowlisted crafting slot(s) are now SERVED: "
            + ", ".join(f"{label!r} (by {served[label]})" for label in stale_now_served)
            + " — good news, and a stale exception all the same. Drop it from "
              "UNSERVED_ALLOWLIST so the list keeps naming only real gaps.")

    if problems:
        raise SystemExit("crafting-slot coverage gate failed:\n"
                         + "\n".join(problems))

    validated = {label for label in declared if label in served} | (
        set(declared) & UNSERVED_ALLOWLIST)
    if len(validated) != len(declared):
        raise SystemExit(
            "crafting-slot coverage: internal — "
            f"{len(declared) - len(validated)} declared label(s) reached no verdict.")

    # #371 — the finer, per-HOST gate for the host-keyed pools. Runs after the
    # label gate, so a per-item label reaches this only once a pool serves it.
    per_item = per_item_host_coverage(dataset)

    return {
        "declared_labels": len(declared),
        # Labels the gate reached a VERDICT on. Equal to `declared_labels` when
        # the gate passes, and deliberately not the declaration count (415+
        # item-slots) — that is what it walked, not what it validated.
        "labels_validated": len(validated),
        "served_labels": len(declared) - len(unserved),
        "unserved_labels": len(unserved),
        "unserved_item_slots": sum(unserved.values()),
        "unserved": dict(sorted(unserved.items(), key=lambda kv: (-kv[1], kv[0]))),
        "allowlisted": len(UNSERVED_ALLOWLIST),
        # The host-keyed pools' own coverage, uncovered hosts named.
        "per_item": per_item,
        "pools": {name: p["records"] for name, p in per_pool.items()},
        "pool_labels": {name: len(p["labels"]) for name, p in per_pool.items()},
    }
