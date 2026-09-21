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
CROSSCHECK_ADJUDICATIONS_PATH = os.path.join(ROOT, "data", "seed", "compendium",
                                             "affix_type_crosscheck_adjudications.json")

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


# ---------------------------------------------------------------------------
# #852 — the bonus-type CROSS-CHECK: the type each carrier stores against the
# type the wiki's rendered tooltip states for that enchantment.
#
# gear-planner stays the source of truth for WHICH affixes a record has. The
# tooltip is the source of truth for the TYPE when the two disagree — that is the
# standing rule affix_type_corrections.json applies, one carrier at a time, after
# a player notices a stacking total that is off (#259, #363, #697 with eighteen
# corrections). #697's own resolution shows the evidence was already on disk:
# "every one of the 18 Exceptional Seeker carriers renders 'Provides a +N Insight
# bonus'" — read from this shard, by hand, after a report. This reads it at build
# time, for every harvested name, before anyone reports anything.
#
# What is compared, exactly. Each shard entry was read from ONE carrier page
# (`carrier` / `wiki_url`), and the sentence lives in the enchantment template,
# so the tooltip is evidence for the (name, engraved label) pair, not for every
# type a name is ever stored under: `Assassinate` is legitimately Enhancement on
# one item and Insight on another. So:
#
#   1. the harvested carrier's own stored type for `name` must equal the stated
#      type (the exact evidence chain), and
#   2. when the engraved label carries a type prefix (`Exceptional Seeker +5`)
#      that DIFFERS from the stated type (`Insight`), no carrier anywhere may
#      still store the name at the label's type — that is the #697 shape, and
#      the count of such carriers is the regression guard. After #697's
#      corrections it is zero; a refresh that re-types one goes red.
#
# A name the carrier stores only as expanded components (`Good Luck` -> Luck
# bonus to every save and skill, tagged `via`) is compared through those
# components' types. A carrier that is not an item record (a set page, the
# Solar/Lunar gem page), a tooltip that states no type (charges, DR, metamagic
# efficiency), and a name the carrier does not store at all are each COUNTED and
# NAMED in the stamp, never silently skipped — the stamp is the population
# ("a count is a claim about a population").
#
# Disagreements must be ruled in affix_type_crosscheck_adjudications.json:
#   * ``mismatched-harvest``      — the tooltip is for a DIFFERENT enchantment
#                                   than the key (`Repair` harvested the item's
#                                   Repair Amplification sentence); evidence is the
#                                   tooltip verbatim, and a re-harvest retires it.
#   * ``tooltip-not-authoritative`` — the wiki sentence is known wrong or stale;
#                                   `why` says so and names the ruling.
#   * ``modelled-differently``     — the wiki is right about the game and the model
#                                   types it otherwise ON PURPOSE (a `-1` weapon's
#                                   Enhancement penalty is stored `Penalty` so a curse
#                                   never competes in a bonus bucket); `why` names the
#                                   ruling that chose that.
# `cross_check` raises on an unruled disagreement, on a ruling whose evidence is
# not the tooltip the shard carries (the sentence moved: re-read), on a stale
# ruling (the name agrees now), and — like `check` — refuses to vouch for a run
# that compared nothing over a populated catalog.
# ---------------------------------------------------------------------------

CROSSCHECK_DISPOSITIONS = ("mismatched-harvest", "tooltip-not-authoritative", "modelled-differently")

# The bonus-type words a tooltip can state, spelled as the catalog stores them.
# `Insightful` and `Natural Armor` are the two spellings the wiki uses that the
# catalog does not. Nothing outside this list is ever read as a type.
_TYPE_WORDS = ("Enhancement", "Insight", "Insightful", "Quality", "Exceptional", "Profane",
               "Sacred", "Artifact", "Competence", "Luck", "Morale", "Legendary", "Festive",
               "Equipment", "Untyped", "Natural Armor", "Deflection", "Shield", "Resistance",
               "Orb", "Implement", "Vitality", "Armor")
_TYPE_ALIAS = {"Insightful": "Insight", "Natural Armor": "Natural"}
_T = "|".join(re.escape(t) for t in _TYPE_WORDS)
#: The three shapes a tooltip states a type in. Narrow on purpose: "+N <Type>
#: bonus", "<Type> bonus to", and "(<Type> bonus)". Anything else is None.
TYPE_PATTERNS = (
    re.compile(r"[+-]\s*\d+%?\s+(" + _T + r")\s+bonus", re.I),
    re.compile(r"\b(" + _T + r")\s+bonus\s+to\b", re.I),
    re.compile(r"\((" + _T + r")\s+bonus\)", re.I),
)
#: Engraved-label prefixes that name a type. `Exceptional Seeker +5` -> Exceptional.
LABEL_PREFIX = {"Insightful": "Insight", "Quality": "Quality", "Exceptional": "Exceptional",
                "Profane": "Profane", "Sacred": "Sacred", "Legendary": "Legendary"}


def stated_type(tooltip: str):
    """The bonus type a tooltip states, spelled as the catalog stores it, or None.
    Never guesses: a sentence outside the three shapes above returns None."""
    for pat in TYPE_PATTERNS:
        m = pat.search(tooltip or "")
        if m:
            word = m.group(1)
            canon = next(t for t in _TYPE_WORDS if t.lower() == word.lower())
            return _TYPE_ALIAS.get(canon, canon)
    return None


def label_type(label: str):
    """The type an engraved label's prefix names, or None."""
    lab = str(label or "")
    for prefix, t in LABEL_PREFIX.items():
        if lab.startswith(prefix + " "):
            return t
    return None


def _norm_url(u: str) -> str:
    """One spelling for a wiki page URL: the harvest strips `?` (the privacy
    guard), the catalog encodes it as %3F; underscores and spaces are the same
    page; case is not significant."""
    from urllib.parse import unquote
    x = unquote(str(u or ""))
    x = re.sub(r"(%3F|\?)$", "", x, flags=re.I)
    return x.replace("_", " ").strip().lower()


def _aff_name(a):
    return a.get("name") if a.get("name") is not None else a.get("stat")


def _aff_type(a):
    t = a.get("type") if a.get("type") is not None else a.get("bonus_type")
    return "Bool" if t == "boolean" else t


def _strip_label(label: str) -> str:
    """`Exceptional Alluring Skills Bonus` -> `alluring skills bonus`;
    `Good Luck +2` -> `good luck`."""
    lab = re.sub(r"\s*[+-]?\d+%?$", "", str(label or "")).strip()
    for prefix in LABEL_PREFIX:
        if lab.startswith(prefix + " "):
            lab = lab[len(prefix) + 1:]
    return lab.strip().lower()


def load_crosscheck_adjudications(path: str = CROSSCHECK_ADJUDICATIONS_PATH) -> dict:
    if not os.path.exists(path):
        return {"_meta": {}, "ruled": {}}
    return _load(path)


def cross_check(shard: dict, records, adjudications: dict) -> dict:
    """Compare every harvested tooltip's stated type against what its carrier
    stores; raise on any unruled disagreement. Returns the metadata stamp."""
    harvested = (shard or {}).get("harvested") or {}
    ruled = (adjudications or {}).get("ruled") or {}
    records = list(records or [])

    by_url = {}
    stored_at = {}
    for v in records:
        u = _norm_url(v.get("wiki_url"))
        if u:
            by_url.setdefault(u, []).append(v)
        for a in v.get("affixes") or []:
            t = _aff_type(a)
            if t == "Bool":
                continue
            stored_at.setdefault(_aff_name(a), {}).setdefault(t, 0)
            stored_at[_aff_name(a)][t] += 1

    out = {"agree": [], "agree_via_components": [], "label_disagrees_with_tooltip": [],
           "disagree": [], "no_stated_type": [], "carrier_not_an_item": [],
           "affix_not_on_carrier": [], "not_stated": []}
    disagreements = {}
    for name, e in sorted(harvested.items()):
        e = e or {}
        if e.get("provenance") != "stated":
            out["not_stated"].append(name)
            continue
        st = stated_type(e.get("tooltip"))
        if not st:
            out["no_stated_type"].append(name)
            continue
        recs = by_url.get(_norm_url(e.get("wiki_url")), [])
        if not recs:
            out["carrier_not_an_item"].append({"name": name, "carrier": e.get("carrier")})
            continue
        direct = set()
        components = set()
        want = _strip_label(e.get("label")) or name.lower()
        for v in recs:
            for a in v.get("affixes") or []:
                t = _aff_type(a)
                if t == "Bool":
                    continue
                if _aff_name(a) == name:
                    direct.add(t)
                elif a.get("via") and _strip_label(a.get("via")) in (want, name.lower()):
                    components.add(t)
        kinds = direct or components
        if not kinds:
            out["affix_not_on_carrier"].append({"name": name, "label": e.get("label")})
            continue
        lt = label_type(e.get("label"))
        at_label_type = stored_at.get(name, {}).get(lt, 0) if (lt and lt != st) else 0
        if st in kinds and not at_label_type:
            entry = {"name": name, "stated": st}
            if lt and lt != st:
                entry["label_type"] = lt
                out["label_disagrees_with_tooltip"].append(entry)
            (out["agree"] if direct else out["agree_via_components"]).append(name)
            continue
        d = {"name": name, "label": e.get("label"), "stated": st,
             "carrier_stores": sorted(k for k in kinds if k is not None),
             "carrier": e.get("carrier"), "tooltip": e.get("tooltip")}
        if at_label_type:
            d["label_type"] = lt
            d["carriers_at_label_type"] = at_label_type
        disagreements[name] = d

    problems = []
    for name, d in disagreements.items():
        r = ruled.get(name)
        if not r:
            where = (f"{d['carriers_at_label_type']} carrier(s) still store it at the label's type {d['label_type']}"
                     if d.get("carriers_at_label_type") else f"its carrier {d['carrier']} stores {d['carrier_stores']}")
            problems.append(
                f"{name}: the tooltip states {d['stated']} ({d['label']!r}) but {where} — "
                "correct the type (affix_type_corrections.json) or rule it in "
                "affix_type_crosscheck_adjudications.json")
            continue
        if r.get("disposition") not in CROSSCHECK_DISPOSITIONS:
            problems.append(f"{name}: disposition {r.get('disposition')!r} is outside {CROSSCHECK_DISPOSITIONS}")
        if (r.get("evidence") or "") != (d.get("tooltip") or ""):
            problems.append(f"{name}: the ruling's evidence is not the tooltip the shard carries — the wiki sentence moved; re-read before trusting the ruling")
        if not r.get("why"):
            problems.append(f"{name}: a ruling needs a `why`")
        d["disposition"] = r.get("disposition")
        out["disagree"].append(d)
    for name in ruled:
        if name not in disagreements:
            problems.append(f"{name}: ruling is stale — the tooltip and its carrier agree now (or the name left the shard); retire it deliberately")
    if problems:
        raise SystemExit("affix bonus-type cross-check failed:\n  " + "\n  ".join(problems))

    compared = len(out["agree"]) + len(out["agree_via_components"]) + len(out["disagree"])
    if records and harvested and not compared:
        raise ValueError("the bonus-type cross-check compared zero names over a populated catalog — "
                         "the carrier match or the type parser is broken, not clean")
    return {
        "names": len(harvested),
        "compared": compared,
        "agree": len(out["agree"]),
        "agree_via_components": out["agree_via_components"],
        "disagree_ruled": out["disagree"],
        "label_disagrees_with_tooltip": out["label_disagrees_with_tooltip"],
        "no_stated_type": out["no_stated_type"],
        "carrier_not_an_item": out["carrier_not_an_item"],
        "affix_not_on_carrier": out["affix_not_on_carrier"],
        "not_stated": out["not_stated"],
    }
