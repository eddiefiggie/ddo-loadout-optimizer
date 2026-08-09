"""Affix-agnostic machinery shared by every enchantment split (#134, #168).

A DDO enchantment is sometimes stored upstream as one affix name while the game
grants several stats from it — `Speed` is movement plus two alacrities,
`Parrying` is Armor Class plus three saves. Splitting one back into its parts
always needs the same five things:

  * a shard keyed per record, carrying wiki evidence and provenance,
  * a rendered-tooltip snapshot per distinct template invocation,
  * an audit that reports records the shard does not cover,
  * an audit that reports snapshots the shard has not harvested,
  * a rewrite pass that turns one folded affix into its concrete contributions.

Only those live here. **Value derivation and the guard do NOT** — each affix
reads a different template with different dialects, provenance rules, and
lookup tables, so generalizing them would mean weakening assertions rather than
sharing code, and a Speed suite passing would not prove the generalization still
holds for the next affix. Each affix keeps its own `check_against_snapshots`
behind a common call signature.

`SplitConfig.shadow_key` is the one knob worth explaining. It decides when an
existing affix suppresses a new contribution. Speed keys on name alone, which is
safe there only because no Speed item carries a `Movement Speed` affix. An affix
whose output collides with a common stat needs (name, stacking bucket) instead —
most Parrying items already carry a non-Insight Armor Class, and those stack
with the Insight one rather than replacing it.
"""
from __future__ import annotations

import urllib.parse
from dataclasses import dataclass, field
from typing import Callable

# Provenance labels, named rather than spelled inline. Several functions branch
# on these; a bare literal drifting by one character in one of them is the
# failure shape that let the material coverage gate pass on corrupted input.
STATED = "stated"
DEFAULTED = "defaulted"
UNSOURCED = "unsourced"


def title_for(url: str) -> str:
    """`/page/Item:Ash_Boots` -> `Item:Ash Boots` (an item shard's key)."""
    return urllib.parse.unquote((url or "").replace("/page/", "")).replace("_", " ")


def bonus_type(affix: dict) -> str:
    """Preserve whatever type the record carries so a future retype rides along."""
    return affix.get("type") or "Enhancement"


def name_only(affix: dict):
    """Suppress on stat name alone. Correct only when the output stat cannot
    already appear on the record under a different bonus type."""
    return affix.get("name")


def name_and_bucket(equiv) -> Callable[[dict], tuple]:
    """Suppress only on the same stat in the same stacking bucket.

    `equiv` maps a bonus type to its stacking-equivalence class, mirroring the
    solver's own bucketing. Two same-named affixes in different buckets stack,
    so suppressing on name alone would withhold a real contribution.
    """
    def key(affix: dict):
        return (affix.get("name"), equiv(affix.get("type")))
    return key


@dataclass(frozen=True)
class SplitConfig:
    """How one folded affix expands into concrete contributions.

    `primary_key` and each extra's key name a field inside the shard entry's
    `value`. That nesting is load-bearing: the harvest merge persists and diffs
    only `value`, `provenance`, `raw`, and `harvested`, so a field written
    beside them is silently dropped.
    """
    folded_name: str
    primary_name: str
    primary_key: str
    primary_corrected_stat: str
    # (value key, affix name, stat counter) per additional contribution.
    extras: tuple = ()
    shadow_key: Callable[[dict], object] = field(default=name_only)
    label: str = "shard"

    def empty_stats(self) -> dict:
        stats = {"renamed": 0, self.primary_corrected_stat: 0}
        for _key, _name, stat in self.extras:
            stats[stat] = 0
        stats["quarantined"] = 0
        stats["uncovered"] = 0
        return stats


def rewrite_all(records, shard: dict, key_of, cfg: SplitConfig) -> dict:
    """Rewrite every folded affix the shard covers, in place.

    `key_of` maps a record to its shard key — items join by wiki title derived
    from their page url, augments and named-item shards by name. Records the
    shard does not cover keep the folded affix and increment `uncovered`, so the
    gap is visible rather than silently invented.
    """
    harvested = (shard or {}).get("harvested") or {}
    stats = cfg.empty_stats()

    for rec in records or []:
        affixes = rec.get("affixes") or []
        folded = [a for a in affixes if a.get("name") == cfg.folded_name]
        if not folded:
            continue

        entry = harvested.get(key_of(rec))
        if entry is None:
            stats["uncovered"] += 1
            continue

        value = entry.get("value") or {}
        eligible = entry.get("provenance") == STATED
        # Contributions the record already carries win — never shadow an
        # upstream affix. Seeded BEFORE the loop so one pre-existing extra
        # blocks only its own add.
        present = {cfg.shadow_key(a) for a in affixes}

        for affix in folded:
            btype = bonus_type(affix)
            affix["name"] = cfg.primary_name
            stats["renamed"] += 1

            primary = value.get(cfg.primary_key)
            if primary is not None and str(primary) != str(affix.get("value")):
                # The wiki-stated value wins over the upstream magnitude, which
                # may be a flattened rank rather than the granted amount.
                affix["value"] = str(primary)
                stats[cfg.primary_corrected_stat] += 1

            if not eligible:
                stats["quarantined"] += 1
                continue

            for key, name, stat in cfg.extras:
                magnitude = value.get(key)
                if magnitude is None:
                    continue
                candidate = {"name": name, "type": btype}
                if cfg.shadow_key(candidate) in present:
                    continue
                affixes.append({"name": name, "type": btype, "value": str(magnitude)})
                present.add(cfg.shadow_key(candidate))
                stats[stat] += 1

        rec["affixes"] = affixes

    return stats


def snapshot_key(raw: str) -> str:
    """Normalize an invocation to its snapshot key.

    Case only: live wikitext mixes `{{Speed|V}}` and `{{speed|V}}`, and they are
    the same invocation rendering the same tooltip. Nothing else is normalized —
    whitespace or argument differences are real differences.
    """
    return (raw or "").strip().lower()


def snapshot_for(shard: dict, raw: str):
    """The stored tooltip snapshot for an invocation, or None when unharvested."""
    snapshots = (shard or {}).get("snapshots") or {}
    return snapshots.get(snapshot_key(raw))


def audit_snapshots(shard: dict, label: str = "shard") -> dict:
    """Report which invocations still lack a rendered-tooltip snapshot.

    The snapshot store is exclude-until-verified: it fills in as invocations are
    rendered. While an invocation is unsnapshotted the guard has nothing to
    compare for it, so a green suite would otherwise imply coverage that does
    not exist. Raises on an empty shard, for the same reason `audit_shard` does.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            f"{label} is empty — refusing to report snapshot coverage over zero records")

    invocations = {snapshot_key(entry.get("raw")) for entry in harvested.values()
                   if (entry or {}).get("raw")}
    stored = set((shard.get("snapshots") or {}))
    missing = sorted(invocations - stored)
    return {"invocations": len(invocations), "snapshotted": len(invocations) - len(missing),
            "missing": len(missing), "missing_keys": missing}


def audit_shard(shard: dict, label: str = "shard") -> dict:
    """Report `unsourced` entries as harvest suspects rather than accepting them.

    An `unsourced` reading claims the page carries no relevant template. That is
    sometimes true and sometimes a miss — one entry sat `unsourced` through a
    whole harvest cycle while its page plainly rendered the enchantment, and the
    harvest method doc had recorded the correct reading the entire time. Nothing
    compared the two, so nothing noticed.

    Raises on an empty shard. A check that inspects nothing passes
    unconditionally and is indistinguishable from a clean run.
    """
    harvested = (shard or {}).get("harvested") or {}
    if not harvested:
        raise ValueError(
            f"{label} is empty — refusing to report a clean audit over zero records")

    suspects = sorted(title for title, entry in harvested.items()
                      if (entry or {}).get("provenance") == UNSOURCED)
    return {"inspected": len(harvested), "unsourced": len(suspects), "titles": suspects}
