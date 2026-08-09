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


def _numeric(value) -> float:
    """A comparable magnitude for an affix value, or -inf when unreadable.

    Values arrive as native strings ("6", "15%"). An unreadable value sorts
    lowest so it never wins a magnitude comparison it cannot justify.
    """
    text = str(value if value is not None else "").strip().rstrip("%")
    try:
        return float(text)
    except ValueError:
        return float("-inf")


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
    # When the record ALREADY carries the primary stat in the same stacking
    # bucket, drop the folded affix instead of renaming it into a duplicate.
    # Off for Speed, whose primary (`Movement Speed`) appears on no Speed item —
    # turning it on there would be a behavior change dressed as a default.
    dedupe_primary: bool = False
    # Whether a non-`stated` entry may still be renamed into the primary stat,
    # carrying the upstream magnitude.
    #
    # Off for Speed, ON for the version-bearing affixes, and the difference is
    # the whole point. Speed's upstream number IS its movement percentage, so
    # keeping it on a quarantined entry preserves a real value. Parrying's may
    # be a flattened Roman RANK — `8` means 4 — so renaming a quarantined entry
    # publishes a number the wiki never stated as a scored Armor Class. That is
    # the inference this project forbids, wearing a `quarantined` counter as
    # cover.
    rename_requires_stated: bool = False

    def empty_stats(self) -> dict:
        stats = {"renamed": 0, self.primary_corrected_stat: 0}
        for _key, _name, stat in self.extras:
            stats[stat] = 0
        if self.dedupe_primary:
            stats["primary_suppressed"] = 0
        if self.rename_requires_stated:
            stats["dropped_unstated"] = 0
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

            # A quarantined entry has no wiki-stated magnitude. For an affix whose
            # upstream number may be a rank rather than the granted amount, the
            # only honest outcome is to grant NOTHING — drop the affix rather than
            # rename it into a confidently-typed wrong stat.
            if cfg.rename_requires_stated and not eligible:
                affixes.remove(affix)
                stats["dropped_unstated"] += 1
                stats["quarantined"] += 1
                continue

            # R2a: a same-stat, same-bucket affix already on the record competes
            # rather than stacks, so only the LARGER counts. Suppress on presence
            # alone and a bigger wiki-verified magnitude can be discarded by a
            # smaller pre-existing one.
            suppressed = False
            if cfg.dedupe_primary:
                candidate = {"name": cfg.primary_name, "type": btype}
                rival = None
                for other in affixes:
                    if other is affix:
                        continue
                    if cfg.shadow_key(other) == cfg.shadow_key(candidate):
                        rival = other
                        break
                if rival is not None:
                    stated = value.get(cfg.primary_key)
                    mine = stated if stated is not None else affix.get("value")
                    suppressed = _numeric(rival.get("value")) >= _numeric(mine)
                    if not suppressed:
                        # Ours is larger: drop the rival instead, so the bucket
                        # keeps the higher value rather than the incumbent one.
                        affixes.remove(rival)
                        stats["primary_suppressed"] += 1

            if suppressed:
                affixes.remove(affix)
                stats["primary_suppressed"] += 1
            else:
                affix["name"] = cfg.primary_name
                stats["renamed"] += 1

                primary = value.get(cfg.primary_key)
                if primary is not None and str(primary) != str(affix.get("value")):
                    # The wiki-stated value wins over the upstream magnitude,
                    # which may be a flattened rank rather than the granted amount.
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


def expand_set_bonus_affixes(variants, folded_name: str, magnitudes_for, outputs) -> dict:
    """Expand a folded affix inside `parsed_set_bonuses`, in place.

    A set-bonus tier carries the SAME enchantment under a DIFFERENT field shape:
    `{"stat": ..., "bonus_type": ...}` rather than an item affix's
    `{"name": ..., "type": ...}`. That mismatch is why the item split missed this
    channel entirely — the predicate read `name` while running over records that
    only carry `stat`, the exact two-representations trap
    `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`
    records. `src/umbrella.py:expand_variants` is the working precedent.

    `magnitudes_for(value)` returns `{output_stat: magnitude}` read from the
    shard's own harvested tooltips, or None when the wiki has not stated that
    invocation. None quarantines: the affix is dropped rather than expanded at a
    guessed magnitude, and the caller's build assertion reports it.
    """
    stats = {"expanded": 0, "quarantined": 0}
    for variant in variants or []:
        for tier in variant.get("parsed_set_bonuses") or []:
            affixes = tier.get("affixes")
            if not affixes:
                continue
            out = []
            for affix in affixes:
                if (affix.get("stat") or "") != folded_name:
                    out.append(affix)
                    continue
                resolved = magnitudes_for(affix.get("value"))
                if resolved is None:
                    stats["quarantined"] += 1
                    continue
                for stat in outputs:
                    out.append({**affix, "stat": stat, "value": resolved[stat]})
                stats["expanded"] += 1
            tier["affixes"] = out
    return stats


def set_bonus_orphans(variants, expanded_away_names, allow=()) -> list:
    """Set-bonus affixes still naming an expanded-away stat, minus an allowlist.

    An expanded-away name is removed from the picker dataset-wide, so a set-bonus
    tier still emitting one grants a stat no player can rank. Reported as
    `(set, stat, value)` triples so the build can name them.
    """
    allowed = {str(a).strip().lower() for a in allow}
    away = {str(n).strip().lower() for n in expanded_away_names} - allowed
    found = set()
    for variant in variants or []:
        for tier in variant.get("parsed_set_bonuses") or []:
            for affix in tier.get("affixes") or []:
                stat = (affix.get("stat") or "").strip()
                if stat.lower() in away:
                    found.add((tier.get("set"), stat, str(affix.get("value"))))
    return sorted(found, key=lambda t: (str(t[0]), t[1], t[2]))


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
