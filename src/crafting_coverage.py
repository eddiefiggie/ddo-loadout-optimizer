"""U1 — the unserved-crafting-slot gate.

An item declares its crafting slots as free-text labels (`crafting: ["Red Augment
Slot", "Claw (Accessory)", "Sealed in Fire", ...]`). A *pool* is what the solver
can actually put into such a slot. When a label no pool serves appears, the slot
is inert: the player sees it in the compendium and the solver crafts nothing into
it. 35 such labels exist today (415 item-slot declarations) — Slaver's crafting,
Cannith crafting, the "One of the following" random-effect wordings — and each is
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
| `dino_inserts` | `dino_type` | as-is (`"Claw"`) |
| `seal` | `seal_type` | `"Sealed in <seal_type>"` |
| `green_steel` | `tier_key` (`"T1 (Equipment)"`) | base label (`"T1"`) |
| `thunder_forged` | `tier` (int) | `"T<tier>"` |

None of `fits_slots`, `dino_type`, `category` or `seal_type` exists in
`gearplanner_crafting.json` — all four are produced downstream by `src/colors.py`,
`src/dino.py`, `src/seal.py` and `src/viktranium.py`. So the gate runs on the
**derived pool records**, late in `build_dataset.py`, after every pool builder.

**Vacuity is per named pool.** A pool that walks zero records raises for that
pool by name. An aggregate "did we inspect anything" check would stay green while
one pool quietly emptied, because a populated sibling vouches for it — and a
retired pool is exactly how a refresh strands slots.
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
    # Cannith crafting — the crafted-blank prefix/suffix/extra menus. No pool.
    "Cannith: Melee - Extra",
    "Cannith: Melee - Prefix",
    "Cannith: Melee - Suffix",
    "Cannith: Ring - Extra",
    "Cannith: Ring - Prefix",
    "Cannith: Ring - Suffix",
    "Cannith: Rune Arm - Extra",
    "Cannith: Rune Arm - Prefix",
    "Cannith: Rune Arm - Suffix",
    "Cannith: Trinket - Extra",
    "Cannith: Trinket - Prefix",
    "Cannith: Trinket - Suffix",
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
    # Per-item Nearly Complete (Nearly Finished / Almost There) — the pool ships
    # as `nearly_complete_per_item`, browse-visible but not solver-wired, so the
    # slot is genuinely unserved for solving purposes.
    "Nearly Finished",
    "Almost There",
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


def _dino_inserts(dataset):
    recs = dataset.get("dino_inserts") or []
    return len(recs), {base_label(r.get("dino_type")) for r in recs
                       if r.get("dino_type")}


def _seal(dataset):
    recs = dataset.get("seal") or []
    return len(recs), {f"Sealed in {r['seal_type']}" for r in recs
                       if r.get("seal_type")}


def _green_steel(dataset):
    recs = dataset.get("green_steel") or []
    return len(recs), {base_label(r.get("tier_key")) for r in recs
                       if r.get("tier_key")}


def _thunder_forged(dataset):
    recs = dataset.get("thunder_forged") or []
    return len(recs), {f"T{r['tier']}" for r in recs if r.get("tier") is not None}


# Ordered so the report reads pool by pool. The keys are POOL names, and the
# gate never compares them against label text.
POOL_READERS = {
    "augments": _augments,
    "augment_set_defs": _augment_set_defs,
    "membership_set_defs": _membership_set_defs,
    "viktranium": _viktranium,
    "nearly_complete": _nearly_complete,
    "dino_inserts": _dino_inserts,
    "seal": _seal,
    "green_steel": _green_steel,
    "thunder_forged": _thunder_forged,
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
        "pools": {name: p["records"] for name, p in per_pool.items()},
        "pool_labels": {name: len(p["labels"]) for name, p in per_pool.items()},
    }
