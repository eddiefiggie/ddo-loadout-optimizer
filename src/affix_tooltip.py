"""#713 (#214 Option B with C) — the rendered-tooltip shard and the conditional detector.

gear-planner stores an affix as ``(name, type, value)`` and never the sentence
the game renders for it, so a bonus that applies only under a condition, or
only after N stacks, is stored as its ceiling, unconditionally. Nothing local
can tell a constant from the cap of a conditional (#214 measured this twice:
zero hits on `raw`, hundreds of false hits on a Roman-rank heuristic). The only
evidence is the tooltip, so ``data/seed/compendium/affix_tooltip.json`` holds
ONE verbatim rendered tooltip per rankable affix name with a numeric carrier,
read from a carrier page (the condition lives in the enchantment TEMPLATE, so
one rendering per name is the evidence for every carrier).

Three things happen over the shard at build time, in the #211 umbrella
detector's shape:

  1. ``candidates(shard)`` flags every stated tooltip that matches a STRONG
     conditional marker — an on-hit / on-cast trigger, a stack ceiling, a
     duration, a cooldown, a "while ..." clause. The markers are deliberately
     narrow: "chance to critical hit" (every Lore), "after resistance" (every
     Absorption) and "does not stack with Haste" (Alacrity) are the stat's own
     definition, not a condition on it, and the first draft of this list
     flagged 49 names on those; the strong list flags 5.
  2. ``check(shard, adjudications, roster)`` raises unless every candidate has
     a ruling in ``conditional_adjudications.json``, every ruling's evidence is
     the tooltip the shard carries verbatim (a refresh that changes the sentence
     trips it), every disposition is in the closed vocabulary, every ruling
     still names a candidate (no stale rulings), and every rankable numeric
     name is either harvested or listed under ``_meta.unharvested`` with a
     reason. It refuses to vouch for zero candidates.
  3. ``disclosures(adjudications)`` is what the web layer installs: the
     ``disclose`` rulings, keyed by stat, each with the sentence the notice
     quotes (Option C).

Dispositions, closed:

  * ``constant``   — the credited magnitude is unconditional; the conditional
                     clause in the tooltip is an EXTRA the catalog does not
                     credit (Dazing's on-hit debuff beside its passive DC).
  * ``quarantine`` — the credited magnitude IS the conditional's ceiling and
                     the wiki states no sustained value; the affix is dropped
                     by ``conditional_affix_quarantine.json`` (Deific Focus).
                     A ``quarantine`` ruling here must be matched by entries
                     there for every carrier, which ``check`` asserts.
  * ``disclose``   — the credit stands and the result names the condition
                     (Orb Bonus: "while actively blocking").
"""
from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD_PATH = os.path.join(ROOT, "data", "seed", "compendium", "affix_tooltip.json")
ADJUDICATIONS_PATH = os.path.join(ROOT, "data", "seed", "compendium",
                                  "conditional_adjudications.json")

DISPOSITIONS = ("constant", "quarantine", "disclose")

#: STRONG conditional markers. Each is a trigger, a ramp, a window or a
#: standing condition — never a stat's own definition. Kept as named pairs so
#: a ruling can say WHICH marker fired.
MARKERS = (
    ("trigger",   re.compile(r"\bon (?:hit|crit(?:ical)?|spell ?cast|kill|vorpal|being hit|damage)\b", re.I)),
    ("ramp",      re.compile(r"\bstacks? up to\b", re.I)),
    ("window",    re.compile(r"\bfor (?:\d+|one|two|three|four|five|six|ten|twenty|thirty) seconds?\b", re.I)),
    ("cooldown",  re.compile(r"\bonce every\b", re.I)),
    ("standing",  re.compile(r"\bwhile (?:you|this|using|wielding|actively|blocking|in|wearing|equipped)\b", re.I)),
    ("standing",  re.compile(r"\bactively blocking\b", re.I)),
    ("trigger",   re.compile(r"\bwhen you (?:are|take|cast|hit|kill|attack)\b", re.I)),
    ("window",    re.compile(r"\bfor a short time\b", re.I)),
)


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_shard(path: str = SHARD_PATH) -> dict:
    return _load(path)


def load_adjudications(path: str = ADJUDICATIONS_PATH) -> dict:
    if not os.path.exists(path):
        return {"_meta": {}, "ruled": {}}
    return _load(path)


def markers_for(tooltip: str) -> list:
    """The strong markers a tooltip matches, in table order, deduped by kind."""
    out = []
    for kind, rx in MARKERS:
        if rx.search(tooltip or "") and kind not in out:
            out.append(kind)
    return out


def candidates(shard: dict) -> list:
    """`[{name, markers, tooltip}]` for every STATED tooltip that matches a strong marker."""
    out = []
    for name, entry in sorted((shard.get("harvested") or {}).items()):
        if (entry or {}).get("provenance") != "stated":
            continue
        kinds = markers_for(entry.get("tooltip"))
        if kinds:
            out.append({"name": name, "markers": kinds, "tooltip": entry["tooltip"]})
    return out


def disclosures(adjudications: dict) -> dict:
    """`{stat: {label, sentence, tooltip}}` for every `disclose` ruling — the
    map the web layer installs and the post-solve notice reads."""
    out = {}
    for name, r in sorted((adjudications.get("ruled") or {}).items()):
        if (r or {}).get("disposition") == "disclose":
            out[name] = {"label": r.get("label") or name, "sentence": r.get("sentence") or "",
                         "tooltip": r.get("evidence") or ""}
    return out


def check(shard: dict, adjudications: dict, roster, quarantine_names=()) -> dict:
    """Resolve the shard against the rulings and the roster; raise on any gap.

    `roster` is every rankable affix name with a numeric carrier (the build
    computes it from the records it just built, never from a hand list).
    `quarantine_names` is the set of affix NAMES `conditional_affix_quarantine.json`
    drops, so a `quarantine` ruling here is provably carried out there.
    """
    harvested = shard.get("harvested") or {}
    unharvested = (shard.get("_meta") or {}).get("unharvested") or {}
    ruled = adjudications.get("ruled") or {}
    problems = []

    # 1. Coverage: every roster name is harvested or has a recorded reason.
    missing = sorted(n for n in roster if n not in harvested and n not in unharvested)
    if missing:
        problems.append(
            "rankable numeric names with no tooltip on disk and no recorded reason "
            f"(harvest them, or list them under _meta.unharvested with why): {missing}")
    for n, why in unharvested.items():
        if n in harvested and harvested[n].get("provenance") == "stated":
            problems.append(f"{n}: listed as unharvested but the shard carries its tooltip — drop one")
        if not why:
            problems.append(f"{n}: unharvested with no reason")

    # 2. Every candidate has a ruling whose evidence is the tooltip verbatim.
    cands = candidates(shard)
    names = {c["name"] for c in cands}
    for c in cands:
        r = ruled.get(c["name"])
        if not r:
            problems.append(
                f"{c['name']}: tooltip matches a conditional marker ({', '.join(c['markers'])}) "
                "and has no ruling — a latent Deific Focus until ruled")
            continue
        if r.get("disposition") not in DISPOSITIONS:
            problems.append(f"{c['name']}: disposition {r.get('disposition')!r} is outside {DISPOSITIONS}")
        if (r.get("evidence") or "") != c["tooltip"]:
            problems.append(
                f"{c['name']}: the ruling's evidence is not the tooltip the shard carries — "
                "the wiki sentence moved; re-read before trusting the ruling")
        if r.get("disposition") == "disclose" and not r.get("sentence"):
            problems.append(f"{c['name']}: a `disclose` ruling needs the sentence the notice quotes")
        if r.get("disposition") == "quarantine" and c["name"] not in set(quarantine_names):
            problems.append(
                f"{c['name']}: ruled `quarantine` but conditional_affix_quarantine.json drops "
                "no affix by that name — the ruling is not carried out")

    # 3. No stale rulings: every ruling still names a candidate.
    for n in ruled:
        if n not in names:
            problems.append(
                f"{n}: ruling is stale (its tooltip no longer matches any marker, or the name "
                "left the shard) — retire it deliberately")

    if problems:
        raise SystemExit("conditional-effect detector failed:\n  " + "\n  ".join(problems))
    if not cands:
        raise ValueError("the conditional detector flagged zero candidates over a populated shard — "
                         "the marker table is broken, not clean")

    stated = sum(1 for e in harvested.values() if (e or {}).get("provenance") == "stated")
    by_disp = {d: sorted(n for n, r in ruled.items() if r.get("disposition") == d) for d in DISPOSITIONS}
    return {"names": len(harvested), "stated": stated,
            "unmatched": sorted(n for n, e in harvested.items() if (e or {}).get("provenance") != "stated"),
            "unharvested": dict(sorted(unharvested.items())),
            "candidates": [{"name": c["name"], "markers": c["markers"]} for c in cands],
            "by_disposition": by_disp,
            "harvested": (shard.get("_meta") or {}).get("harvested")}
