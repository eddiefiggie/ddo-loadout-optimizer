"""#850 — tier-rename families: a counted presence effect that changes NAME when an
item family upgrades, stamped and guarded instead of re-measured by hand.

The defect this exists for (#746): `Wraithborn Emerald` (ML 8) carries `Ethereal`
and `Legendary Wraithborn Emerald` (ML 30) carries `Ghostly`. A player who ranks
`Ethereal` never reaches the legendary augment — not because it is worse, but
because the upgrade renamed the effect. The 2026-09-10 triage note swept every
item family for this once, by hand, found 58, and recorded that the families
split three ways: joined (Blurry -> Lesser Displacement both mint `Concealment`,
so the rename is invisible to the solver), unjoined (Ethereal -> Ghostly: nothing
joins them), and a third that crossed from an uncounted effect into a counted
one. That sweep lived in a triage note; a refresh could add a 59th family and
nothing would notice. This module is that sweep as a build-time population, with
an adjudication file the build refuses to ship without.

What a FAMILY is: the records whose `source_item` agree once the `Legendary ` /
`Epic ` tier prefix is stripped, within one `category` (an augment and an item
never share a family). Within a family, TIERS are the distinct names, ordered by
their lowest ML. A TRANSITION is each consecutive pair of tiers; it is a RENAME
when at least one counted presence name is present on the lower tier and absent
on the upper, AND at least one is present on the upper and absent on the lower.
A tier that only gains an effect (`Freedom of Movement` appears at legendary) or
only loses one is not a rename — ranking the heroic name excludes nothing there
— and is deliberately not in this population. Counted presence names are
`metadata.utility_counting_set`, the same roster the Utility tier counts, so a
name outside it (the Bane family, `Shadow Striker`) is not a rename here even
when it changes.

The key of a transition is the two sets spelled out — `Ethereal -> Ghostly` and
`Ethereal -> Ghostly + True Seeing` are different keys, adjudicated separately,
because guessing which gained name "is" the rename when a tier gains two is the
inference this repo forbids.

Dispositions, closed:

  * ``joined``  — both sides mint one shared stat (`stat` names it) through
                  `web/dataset.js` COMPOSITE_COMPONENTS, so the solver already
                  ranks the tiers against each other and there is nothing to
                  disclose. The build cannot read that JS table, so
                  `tests/dataset.test.js` asserts each `joined` ruling's names
                  really mint `stat` there — the Python guard requires the
                  field, the JS test proves it.
  * ``distinct`` — the wiki rules the two names different effects (the Ghost
                   Touch family: `Ghostly` is strictly more than `Ethereal`, and
                   Concealment and Incorporeality are separate miss-chance axes).
                   `sentence` is what the result quotes to a player who ranked
                   either name; `evidence` points at the ruling.
  * ``pending-wiki`` — no ruling yet; `sentence` says so and `evidence` names the
                       harvest that would settle it. Disclosed like `distinct`.

`check` raises on a transition with no ruling, a ruling for a transition the
sweep no longer finds (stale), a disposition outside the vocabulary, a `joined`
ruling with no `stat`, an unjoined ruling with no `sentence`, and — like
`affix_tooltip.check` — it refuses to vouch for a sweep that found nothing over
a populated catalog, because an empty population over 9,000 records means the
sweep broke, not that the game stopped renaming things.
"""
from __future__ import annotations

import json
import os
import re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADJUDICATIONS_PATH = os.path.join(
    ROOT, "data", "seed", "compendium", "tier_rename_adjudications.json")

DISPOSITIONS = ("joined", "distinct", "pending-wiki")
UNJOINED = ("distinct", "pending-wiki")

# The tier prefixes a family name drops. Deliberately only these two: `Greater`,
# `Lesser`, `Superior` are parts of enchantment-style item names ("Lesser Bracers
# of ..."), not tier markers, and folding them would invent families.
_TIER_PREFIX = re.compile(r"^(?:Legendary|Epic)\s+")
_CATEGORIES = ("item", "augment")


def family_base(name: str) -> str:
    """`Legendary Wraithborn Emerald` -> `Wraithborn Emerald`; a name with no tier
    prefix is its own base."""
    return _TIER_PREFIX.sub("", str(name or "").strip()).strip()


def _name_type(a: dict):
    """`(name, type)` of one affix in EITHER shape: the at-rest native
    `{name, type}` that items.json carries, or the in-memory pipeline's legacy
    `{stat, bonus_type}` that `build_dataset.py` sweeps before `_native_affix`
    serializes it. Found the hard way: swept in memory with the native keys
    only, every worn family read as carrying nothing and two runs produced two
    different "stale" lists."""
    name = a.get("name") if a.get("name") is not None else a.get("stat")
    t = a.get("type") if a.get("type") is not None else a.get("bonus_type")
    return str(name or "").strip(), ("Bool" if t in ("Bool", "boolean") else t)


def transition_key(dropped, gained) -> str:
    return f"{' + '.join(sorted(dropped))} -> {' + '.join(sorted(gained))}"


def sweep(records, counting) -> list:
    """Every rename transition in `records`, sorted by key then family.

    `records` are the built item/augment variants (`category`, `source_item`,
    `ml`, `affixes`); `counting` is the counted presence roster. Returns
    `[{key, dropped, gained, families: [{category, base, from, from_ml, to,
    to_ml}]}]`. Pure; reads nothing from disk.
    """
    counted = set(counting or ())
    fam = defaultdict(dict)
    for v in records or []:
        if v.get("category") not in _CATEGORIES:
            continue
        name = str(v.get("source_item") or "").strip()
        if not name:
            continue
        present = {n for n, t in map(_name_type, v.get("affixes") or [])
                   if t == "Bool" and n in counted}
        tiers = fam[(v["category"], family_base(name))]
        row = tiers.setdefault(name, {"ml": None, "present": set()})
        ml = v.get("ml")
        if ml is not None and (row["ml"] is None or ml < row["ml"]):
            row["ml"] = ml
        row["present"] |= present

    by_key = defaultdict(list)
    for (category, base), tiers in fam.items():
        if len(tiers) < 2:
            continue
        seq = sorted(tiers.items(), key=lambda kv: ((kv[1]["ml"] is None), kv[1]["ml"] or 0, kv[0]))
        for (lo_name, lo), (hi_name, hi) in zip(seq, seq[1:]):
            dropped = lo["present"] - hi["present"]
            gained = hi["present"] - lo["present"]
            if not (dropped and gained):
                continue
            by_key[(tuple(sorted(dropped)), tuple(sorted(gained)))].append({
                "category": category, "base": base,
                "from": lo_name, "from_ml": lo["ml"], "to": hi_name, "to_ml": hi["ml"],
            })
    out = []
    for (dropped, gained), families in by_key.items():
        out.append({
            "key": transition_key(dropped, gained),
            "dropped": list(dropped), "gained": list(gained),
            "families": sorted(families, key=lambda f: (f["category"], f["base"])),
        })
    out.sort(key=lambda t: t["key"])
    return out


def load_adjudications(path: str = ADJUDICATIONS_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def check(transitions: list, adjudications: dict, record_count: int) -> dict:
    """Resolve the sweep against the rulings; raise on any gap. Returns the
    metadata stamp: every transition with its ruling attached."""
    ruled = (adjudications or {}).get("ruled") or {}
    problems = []
    keys = {t["key"] for t in transitions}

    for t in transitions:
        r = ruled.get(t["key"])
        if not r:
            problems.append(
                f"{t['key']}: {len(t['families'])} item famil{'y' if len(t['families']) == 1 else 'ies'} "
                f"rename a counted effect on upgrade and no ruling covers it "
                f"({', '.join(f['base'] for f in t['families'][:4])}"
                f"{', ...' if len(t['families']) > 4 else ''}) — rule it joined, distinct, or pending-wiki")
            continue
        d = r.get("disposition")
        if d not in DISPOSITIONS:
            problems.append(f"{t['key']}: disposition {d!r} is outside {DISPOSITIONS}")
        elif d == "joined" and not r.get("stat"):
            problems.append(f"{t['key']}: a `joined` ruling must name the shared stat both sides mint")
        elif d in UNJOINED and not r.get("sentence"):
            problems.append(f"{t['key']}: a `{d}` ruling needs the sentence the result quotes")
        if not r.get("evidence"):
            problems.append(f"{t['key']}: no evidence recorded")
    for k in ruled:
        if k not in keys:
            problems.append(
                f"{k}: ruling is stale — the sweep finds no family with that transition any more; "
                "retire it deliberately")

    if problems:
        raise SystemExit("tier-rename guard failed:\n  " + "\n  ".join(problems))
    if record_count and not transitions:
        raise ValueError(
            f"the tier-rename sweep found zero transitions over {record_count} records — "
            "the sweep is broken (empty counting set? renamed fields?), not clean")

    stamped = []
    for t in transitions:
        r = ruled[t["key"]]
        entry = {
            "key": t["key"], "dropped": t["dropped"], "gained": t["gained"],
            "disposition": r["disposition"],
            "families": t["families"],
        }
        if r.get("stat"):
            entry["stat"] = r["stat"]
        if r.get("sentence"):
            entry["sentence"] = r["sentence"]
        entry["evidence"] = r.get("evidence")
        stamped.append(entry)
    counts = {d: sum(1 for e in stamped if e["disposition"] == d) for d in DISPOSITIONS}
    return {
        "transitions": stamped,
        "transition_count": len(stamped),
        "family_count": sum(len(e["families"]) for e in stamped),
        "by_disposition": counts,
        "families_by_disposition": {
            d: sum(len(e["families"]) for e in stamped if e["disposition"] == d) for d in DISPOSITIONS},
    }
