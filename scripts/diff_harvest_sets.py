#!/usr/bin/env python3
"""#908 — parity of the wiki's set definitions against gear-planner's set catalog.

Reads a set-page harvest (`load_harvest.py --titles data/harvest_titles/
named-item-sets.json`) through src/wiki_sets.py and compares every gear-planner
set with what the wiki states for it, per source:

  template — `Template:Named item sets`, matched by switch key or a reviewed alias
  page     — `Named item sets`, matched by anchor; a HELstats row is NOT matched by
             name unless an individually evidenced name/tier ruling exists

Each (set, source) lands in one class:

  no-wiki-name       — no usable exact name or reviewed alias match
  threshold-unstated — bonus lines lack an explicit header or reviewed prose count
  threshold-differs  — the stated thresholds are not gear-planner's
  exact              — every line read, and the affixes equal gear-planner's
  partial            — some lines quarantined; every line read agrees with gear-planner
  wiki-disagrees     — the only difference is a recorded WIKI_DISAGREEMENTS line
  upstream-stale     — the only difference is a recorded UPSTREAM_STALE line
  wiki-bug           — an explicit, checked wiki bug note explains the difference
  ours-differs       — a line read to an affix gear-planner does not carry   <- review

`ours-differs` is the switch gate: Phase 3 switches once it is 0 and every
remaining difference is classified. Sets where the two wiki sources disagree are
listed separately — that is a wiki question, not a parser one.

Usage: python3 scripts/diff_harvest_sets.py [HARVEST_ID] [--examples N] [--json]

Both output modes exit 1 when the source-scoped count review, name-alias review,
or explicit wiki bug ruling is stale or incomplete. Review changed wiki text
and unresolved entries before updating their evidence; these reviews never
supply game data.
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from src import wiki_sets as S  # noqa: E402
from src import natural_armor_sets  # noqa: E402
from src.affix_parser import BONUS_TYPES  # noqa: E402
import load_harvest as LH  # noqa: E402

TITLES = os.path.join(ROOT, "data", "harvest_titles", "named-item-sets.json")
GP_SETS = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_sets.json")
PAGE, TEMPLATE = "Named item sets", "Template:Named item sets"
COUNT_REVIEW = os.path.join(ROOT, "docs", "wiki-evidence", "set-count-review.json")


# #953 — the set page and all four member item pages explicitly name these two
# sets. These are individual identity/tier rulings, never a suffix or prefix
# rule. Evidence: docs/wiki-evidence/slice-dice-set-names.md.
REVIEWED_SET_NAMES = {
    "Slice 'n Dice": {"wiki_name": "Slice 'n Dice Set", "page_tier": "Heroic"},
    "Epic Slice 'n Dice": {"wiki_name": "Epic Slice 'n Dice Set", "page_tier": "Epic"},
}


def reviewed_name_matches(template_entries, rows, gp_sets):
    """Match only the two cited identities; reject missing or ambiguous targets.

    This does not read or change a count, clause, bonus type or value. The
    existing full-source hash/revision gate also guards changed source context.
    A small comparison can omit these sets; an empty catalog fails count review.
    """
    matches = {}
    review = {"applicable": [], "applied": {}, "complete": True, "errors": []}
    catalog_names = {n.lower() for n in gp_sets}
    for name, identity in REVIEWED_SET_NAMES.items():
        if name not in gp_sets:
            continue
        review["applicable"].append(name)
        key = identity["wiki_name"].lower()
        page = [r for r in rows if key in {a.lower() for a in r["anchors"]}
                and r["tier"] == identity["page_tier"]]
        old_name_present = name.lower() in template_entries or any(
            name.lower() in {a.lower() for a in r["anchors"]} for r in rows)
        if old_name_present or key in catalog_names:
            review["errors"].append(f"{name}: direct name or catalog alias collision; re-review identity")
        elif key not in template_entries or len(page) != 1:
            review["errors"].append(f"{name}: expected template name and unique {identity['page_tier']} page target are missing or ambiguous")
        else:
            matches[name] = {"template": template_entries[key], "page": page[0]}
            review["applied"][name] = dict(identity)
    review["complete"] = not review["errors"]
    return matches, review


def count_review_status(pages, per_set, review):
    """Invalidate source-scoped findings when the text or unresolved roster moves.

    This checks review coverage only. It never supplies a threshold or an affix.
    Hash the whole sources so changes to section context also require review.
    """
    errors = []
    if review.get("schema_version") != 1:
        errors.append("unsupported count-review schema")
    if not per_set:
        errors.append("no catalog sets inspected")
    sources = {}
    for source, title in (("template", TEMPLATE), ("page", PAGE)):
        expected = review.get("sources", {}).get(source, {})
        actual = pages[title]
        changed = (expected.get("revid") != actual["revid"] or
                   expected.get("sha256") != hashlib.sha256(actual["wikitext"].encode("utf-8")).hexdigest())
        unresolved = {name for name, rec in per_set.items()
                      if rec[source]["class"] == "threshold-unstated"}
        recorded = review.get("records", {}).get(source, {})
        missing = sorted(unresolved - recorded.keys())
        stale = sorted(recorded.keys() - unresolved)
        invalid = sorted(name for name, reason in recorded.items()
                         if reason not in review.get("findings", {}) or not review["findings"][reason])
        sources[source] = {"source_changed": changed, "unresolved": len(unresolved),
                           "missing": missing, "stale": stale, "invalid_findings": invalid}
    complete = not errors and all(not any(r[k] for k in
        ("source_changed", "missing", "stale", "invalid_findings")) for r in sources.values())
    return {"complete": complete, "errors": errors, "sources": sources}


def _num(v):
    try:
        return int(str(v).strip().lstrip("+"))
    except (TypeError, ValueError):
        return v


#: Comparison forms only; the reader's affixes and production data stay intact.
#: Sheltering rev 595036 explicitly grants the same X to both PRR and MRR.
#: Insightful bonus rev 140374 redirects to Insight bonus, and the Double Helix
#: entries link [[Insight bonus|Insightful]]. Evidence: set-comparison-normalization.md.
COMPARISON_EXPANSIONS = {"Sheltering": ("Physical Sheltering", "Magical Sheltering")}
COMPARISON_TYPES = {"Insightful": "Insight"}


def comparison_affixes(affix):
    """Canonical comparison keys, without changing units, amounts or multiplicity."""
    ty = natural_armor_sets.canonical_type(affix.get("name"), affix.get("type"))
    return [(name, COMPARISON_TYPES.get(ty, ty), _num(affix.get("value")))
            for name in COMPARISON_EXPANSIONS.get(affix.get("name"), (affix.get("name"),))]


def gp_tiers(tiers) -> dict:
    """gear-planner's `[{threshold, affixes}]` -> {threshold: Counter((name, type, value))}."""
    out = {}
    for t in tiers or []:
        c = out.setdefault(t.get("threshold"), collections.Counter())
        for a in t.get("affixes") or []:
            c.update(comparison_affixes(a))
    return out


#: Lines where the wiki's two sources state different values, so neither is adopted.
#: gear-planner follows the page in every case. Recorded from harvest
#: pages-20261027 (template rev 723530, page rev 720202). The template's values
#: arrived in Cru121's bulk rewrite of 2021-09-02 (rev 499661, "code replaced +
#: added a bunch of new sets"); Legendary Dreadkeeper read +20 before it
#: (rev 438208, 2020-03-19). Nothing on the wiki says which source is right.
#: `diff` reports any entry here that no longer reproduces, so a fix on either
#: side retires it instead of hiding a new difference.
#: Eminence of Spring surfaced once Doublestrike and Doubleshot became readable
#: (#951): the template states +10% at 6 pieces, the page +15%, and Eminence of
#: Summer's template entry states +15% for the same tier. Its template history
#: has not been read.
WIKI_DISAGREEMENTS = [
    {"set": "Legendary Dreadkeeper", "threshold": 3, "name": "Physical Sheltering", "template": 40, "page": 20},
    {"set": "The Desert's Burning Sun", "threshold": 2, "name": "Physical Sheltering", "template": 5, "page": 10},
    {"set": "The Legendary Desert's Burning Sun", "threshold": 2, "name": "Physical Sheltering", "template": 15, "page": 30},
    {"set": "Eminence of Spring", "threshold": 6, "name": "Doublestrike", "template": 10, "page": 15},
    {"set": "Eminence of Spring", "threshold": 6, "name": "Doubleshot", "template": 10, "page": 15},
]


#: Lines where BOTH wiki sources agree and gear-planner carries an older value. The
#: wiki is the source of truth, so these are not parser errors; each is already
#: corrected in our own seed, and the build credits the wiki's value. A record that
#: no longer reproduces (the wiki or gear-planner changed) is reported stale.
#:
#: Truthful Blow (#951): template rev 723530 and page rev 720202 both state "+30%
#: Artifact bonus to Fortification Bypass" at 3 pieces; gear-planner carries
#: Armor-Piercing 15. data/seed/compendium/augment_sets.json already carries 30,
#: verified from the Set Augment pages (docs/wiki-evidence/augment-sets.md), and
#: that is the value the built dataset's augment_set_defs credits.
UPSTREAM_STALE = [
    {"set": "Truthful Blow", "threshold": 3, "name": "Armor-Piercing", "type": "Artifact",
     "wiki": 30, "gear_planner": 15},
]


# #956 — Named item sets rev 720202 explicitly says the HEROIC tier grants +1
# INT despite its printed +2. Template rev 723530 still prints +2. This is a
# comparison ruling, never a rewrite of either source or of production data.
# Full evidence and scope: docs/wiki-evidence/arcsteel-intelligence-bug.md.
ARCSTEEL_SET = "Arcsteel Battlemage"
ARCSTEEL_BUG_LINE = "+2 Artifact bonus to Intelligence Bug: Heroic tier only gives +1 INT."
ARCSTEEL_PRINTED = {"threshold": 3, "affix": ["Intelligence", "Artifact", 2]}


def arcsteel_bug_review(template_entries, page_rows, gp_sets):
    """Allow this one exception only while its source context and catalog agree.

    Small comparisons may omit Arcsteel; report that as not applicable, not as
    evidence checked. The existing count-review gate rejects an empty catalog.
    Full-source revision/hash checks remain in count_review_status.
    """
    review = {"applicable": ARCSTEEL_SET in gp_sets, "complete": True, "errors": []}
    if not review["applicable"]:
        return review
    review["evidence"] = {
        "page": "https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202",
        "template": "https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530",
        "note": ARCSTEEL_BUG_LINE,
        "actual": ["Intelligence", "Artifact", 1],
    }
    rows = [r for r in page_rows if ARCSTEEL_SET in r["anchors"] and r["tier"] == "Heroic"]
    if (len(rows) != 1 or set(rows[0]["tiers"]) != {3}
            or [S.plain(x) for x in rows[0]["tiers"][3] if "Intelligence" in S.plain(x)]
            != [ARCSTEEL_BUG_LINE]):
        review["errors"].append("Arcsteel's exact heroic three-piece Intelligence bug note changed or is missing")
    entry = template_entries.get(ARCSTEEL_SET.lower(), {})
    tiers = entry.get("tiers", {})
    intelligence = [S.read_clause(x, BONUS_TYPES, {"Intelligence"})
                    for x in tiers.get(3, []) if "Intelligence" in S.plain(x)]
    if set(tiers) != {3} or intelligence != [{"affixes": [
            {"name": "Intelligence", "type": "Artifact", "value": 2}]}]:
        review["errors"].append("Arcsteel's template no longer states exactly one three-piece +2 Artifact Intelligence bonus")
    catalog = gp_tiers(gp_sets[ARCSTEEL_SET])
    intelligence = collections.Counter({k: v for k, v in catalog.get(3, {}).items() if k[0] == "Intelligence"})
    if set(catalog) != {3} or intelligence != collections.Counter({("Intelligence", "Artifact", 1): 1}):
        review["errors"].append("Arcsteel's catalog no longer carries exactly one three-piece +1 Artifact Intelligence bonus")
    review["complete"] = not review["errors"]
    return review


def _upstream_stale(set_name, th, affix, gp, records):
    name, ty, value = affix
    return next((u for u in records if (u["set"], u["threshold"], u["name"], u["type"], u["wiki"])
                 == (set_name, th, name, ty, value)
                 and gp.get(th, {}).get((name, ty, u["gear_planner"]))), None)


def _disagreement(set_name, th, affix, records):
    name, _, value = affix
    return next((d for d in records if (d["set"], d["threshold"], d["name"], d["template"]) == (set_name, th, name, value)), None)


def classify(wiki_tiers: dict, gp: dict, stat_names, set_name=None, disagreements=(),
             upstream=()) -> tuple[str, dict]:
    """One source's {threshold: [lines]} against gear-planner's tiers -> (class, detail).

    An extra affix that matches a recorded `WIKI_DISAGREEMENTS` entry is a wiki
    question, not ours-differs: the set lands in `wiki-disagrees` instead. One that
    matches a recorded `UPSTREAM_STALE` entry (and gear-planner still carries the
    recorded older value) lands in `upstream-stale`."""
    if None in wiki_tiers:
        return "threshold-unstated", {"lines": [S.plain(x) for x in wiki_tiers[None]]}
    if set(wiki_tiers) != set(gp):
        return "threshold-differs", {"wiki": sorted(wiki_tiers), "gear-planner": sorted(k for k in gp if k is not None)}
    quarantined, extra = [], []
    for th, lines in wiki_tiers.items():
        read = collections.Counter()
        for line in lines:
            r = S.read_clause(line, BONUS_TYPES, stat_names)
            if "affixes" in r:
                for a in r["affixes"]:
                    read.update(comparison_affixes(a))
            else:
                quarantined.append({"threshold": th, "line": S.plain(line), "reason": r["quarantine"]})
        extra += [{"threshold": th, "affix": list(k)} for k in (read - gp.get(th, collections.Counter()))]
    known = [e for e in extra if _disagreement(set_name, e["threshold"], e["affix"], disagreements)]
    extra = [e for e in extra if e not in known]
    stale_gp = [e for e in extra if _upstream_stale(set_name, e["threshold"], e["affix"], gp, upstream)]
    extra = [e for e in extra if e not in stale_gp]
    if extra:
        return "ours-differs", {"extra": extra, "quarantined": quarantined, "wiki_disagrees": known,
                                "upstream_stale": stale_gp}
    if known:
        return "wiki-disagrees", {"wiki_disagrees": known, "quarantined": quarantined, "upstream_stale": stale_gp}
    if stale_gp:
        return "upstream-stale", {"upstream_stale": stale_gp, "quarantined": quarantined}
    return ("partial", {"quarantined": quarantined}) if quarantined else ("exact", {})


def diff(pages: dict, gp_sets: dict) -> dict:
    page, template = pages[PAGE], pages[TEMPLATE]
    T = S.template_sets(template["wikitext"])
    rows = S.page_sets(page["wikitext"])
    by_anchor = {}
    for r in rows:
        if r["tier"] is None:
            for a in r["anchors"]:
                by_anchor.setdefault(a.lower(), r)
    stat_names = {a.get("name") for t in gp_sets.values() for tier in t for a in tier.get("affixes") or []}
    name_matches, name_review = reviewed_name_matches(T, rows, gp_sets)
    bug_review = arcsteel_bug_review(T, rows, gp_sets)
    bug_applied = False

    per_set, counts = {}, {"template": collections.Counter(), "page": collections.Counter()}
    for name, tiers in gp_sets.items():
        gp = gp_tiers(tiers)
        rec = {}
        entries = (name_matches.get(name, {"template": None, "page": None}) if name in REVIEWED_SET_NAMES
                   else {"template": T.get(name.lower()), "page": by_anchor.get(name.lower())})
        for src, entry in entries.items():
            cls, detail = ("no-wiki-name", {}) if entry is None else classify(
                entry["tiers"], gp, stat_names, name, WIKI_DISAGREEMENTS if src == "template" else (),
                UPSTREAM_STALE)
            if name == ARCSTEEL_SET and src == "template" and bug_review["complete"]:
                if ARCSTEEL_PRINTED in detail.get("extra", []):
                    # Remove only the explained comparison difference. Other
                    # differences and every quarantined clause remain visible.
                    detail["extra"].remove(ARCSTEEL_PRINTED)
                    detail["wiki_bug_rulings"] = [dict(ARCSTEEL_PRINTED, actual=["Intelligence", "Artifact", 1])]
                    if not detail["extra"]:
                        del detail["extra"]
                        cls = "wiki-bug"
                    bug_applied = True
            if name in name_matches:
                detail["name_alias"] = {"wiki_name": REVIEWED_SET_NAMES[name]["wiki_name"]}
                if src == "page":
                    detail["name_alias"]["page_tier"] = REVIEWED_SET_NAMES[name]["page_tier"]
            counts[src][cls] += 1
            rec[src] = {"class": cls, **detail}
        per_set[name] = rec
    if bug_review["applicable"] and bug_review["complete"] and not bug_applied:
        bug_review["complete"] = False
        bug_review["errors"].append("Arcsteel's expected comparison difference is absent; re-review the ruling")
    seen = {(name, e["threshold"], e["affix"][0]) for name, rec in per_set.items()
            for e in rec["template"].get("wiki_disagrees", [])}
    stale = [d for d in WIKI_DISAGREEMENTS if (d["set"], d["threshold"], d["name"]) not in seen]
    seen_up = {(name, e["threshold"], e["affix"][0]) for name, rec in per_set.items()
               for src in rec.values() for e in src.get("upstream_stale", [])}
    stale_up = [u for u in UPSTREAM_STALE if (u["set"], u["threshold"], u["name"]) not in seen_up]

    def readable(entry):
        if entry is None or None in entry["tiers"]:
            return None
        out = {}
        for th, lines in entry["tiers"].items():
            rs = [S.read_clause(x, BONUS_TYPES, stat_names) for x in lines]
            if any("quarantine" in r for r in rs):
                return None
            out[th] = sorted(key for r in rs for a in r["affixes"] for key in comparison_affixes(a))
        return out

    disagree = []
    comparison_pages = dict(by_anchor)
    for name, entries in name_matches.items():
        comparison_pages[REVIEWED_SET_NAMES[name]["wiki_name"].lower()] = entries["page"]
    for key, entry in T.items():
        a, b = readable(entry), readable(comparison_pages.get(key))
        if a is not None and b is not None and a != b:
            disagree.append({"set": entry["name"] or key, "template": a, "page": b})

    with open(COUNT_REVIEW, encoding="utf-8") as fh:
        count_review = count_review_status(pages, per_set, json.load(fh))
    return {
        "harvest_revids": {PAGE: page["revid"], TEMPLATE: template["revid"]},
        "gear_planner_sets": len(gp_sets),
        "template_entries": len(T),
        "page_rows": {"named": sum(1 for r in rows if r["tier"] is None),
                      "helstats_tier_records": sum(1 for r in rows if r["tier"] is not None)},
        "counts": {k: dict(v) for k, v in counts.items()},
        "sources_disagree": disagree,
        "stale_disagreement_records": stale,
        "stale_upstream_records": stale_up,
        "count_review": count_review,
        "name_alias_review": name_review,
        "wiki_bug_review": bug_review,
        "natural_armor_review": natural_armor_sets.catalog_review(gp_sets, require_complete=True),
        "sets": per_set,
    }


def main(argv) -> int:
    hid = next((a for a in argv if not a.startswith("--") and not a.isdigit()), None)
    n_ex = int(argv[argv.index("--examples") + 1]) if "--examples" in argv else 3
    titles = LH.explicit_titles(json.load(open(TITLES, encoding="utf-8")))
    hid = hid or LH.latest_id(prefix="pages-") if hasattr(LH, "latest_id") else hid
    if not hid:
        print("usage: diff_harvest_sets.py HARVEST_ID", file=sys.stderr)
        return 2
    loaded = LH.load_pages(hid)
    loaded = loaded.values() if isinstance(loaded, dict) else loaded
    pages = {p["title"]: p for p in loaded}
    missing = [t for t in titles if t not in pages]
    if missing:
        print(f"harvest {hid} lacks {missing} — re-run the set-page harvest", file=sys.stderr)
        return 2
    with open(GP_SETS, encoding="utf-8") as fh:
        gp_sets = json.load(fh)
    report = diff(pages, gp_sets)
    if "--json" in argv:
        print(json.dumps(report, indent=1, ensure_ascii=False))
        return 0 if (report["count_review"]["complete"] and report["wiki_bug_review"]["complete"]
                     and report["name_alias_review"]["complete"]
                     and report["natural_armor_review"]["complete"]) else 1
    print(f"harvest {hid}: revids {report['harvest_revids']}")
    print(f"gear-planner sets {report['gear_planner_sets']}, template entries {report['template_entries']}, "
          f"page rows {report['page_rows']}")
    for src in ("template", "page"):
        print(f"\n{src}:")
        for cls, n in sorted(report["counts"][src].items(), key=lambda kv: -kv[1]):
            print(f"  {cls:20} {n}")
            ex = [k for k, v in report["sets"].items() if v[src]["class"] == cls][:n_ex]
            for k in ex:
                d = {x: y for x, y in report["sets"][k][src].items() if x != "class"}
                print(f"      {k}: {json.dumps(d, ensure_ascii=False)[:220]}")
    if report["stale_disagreement_records"]:
        print(f"\nSTALE WIKI_DISAGREEMENTS (no longer reproduce — retire or re-record): "
              f"{json.dumps(report['stale_disagreement_records'], ensure_ascii=False)}")
    if report["stale_upstream_records"]:
        print(f"\nSTALE UPSTREAM_STALE (no longer reproduce — retire or re-record): "
              f"{json.dumps(report['stale_upstream_records'], ensure_ascii=False)}")
    print(f"\nsources disagree (both fully read): {len(report['sources_disagree'])}")
    for d in report["sources_disagree"][:n_ex]:
        print(f"  {json.dumps(d, ensure_ascii=False)[:300]}")
    print(f"\nnatural armor review: {json.dumps(report['natural_armor_review'], ensure_ascii=False)}")
    if not report["natural_armor_review"]["complete"]:
        print("Natural Armor source review is stale: recheck the eight Wiki-supported flat AC clauses.")
        return 1
    print(f"\ncount review: {json.dumps(report['count_review'], ensure_ascii=False)}")
    print(f"\nname alias review: {json.dumps(report['name_alias_review'], ensure_ascii=False)}")
    if not report["name_alias_review"]["complete"]:
        print("Name alias review is stale or ambiguous: recheck the named template, page anchor and tier before accepting this comparison.")
        return 1
    print(f"\nwiki bug review: {json.dumps(report['wiki_bug_review'], ensure_ascii=False)}")
    if not report["wiki_bug_review"]["complete"]:
        print("Wiki bug ruling is stale or unsupported: recheck Arcsteel's heroic Intelligence note, "
              "template and catalog before accepting this comparison.")
        return 1
    if not report["count_review"]["complete"]:
        print("Count review is stale or incomplete: check the changed sources and named entries "
              "against DDO Wiki before updating set-count-review.json. Never infer counts.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
