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
  exact              — every line read, and the affix multisets are equal
  catalog-unmatched  — every line read, but catalog affix occurrences lack a match
  partial            — some lines quarantined; every line read agrees with gear-planner
  wiki-disagrees     — the only difference is a recorded WIKI_DISAGREEMENTS line
  upstream-stale     — the only difference is a recorded UPSTREAM_STALE line
  wiki-bug           — an explicit, checked wiki bug note explains the difference
  ours-differs       — a line read to an affix gear-planner does not carry   <- review

`ours-differs` and `catalog-unmatched` need review before a source switch. The
latter records missing comparison evidence, not a claim that the Wiki grants
zero or that the catalog is wrong. Phase 3 also requires every other difference
to have a safe disposition. Wiki-to-Wiki disagreements are listed separately.

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
import re
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


# #951 — the page's spell-only note is attached to FIVE pieces, not three.
# These tuples reject source drift; values read by the comparison still come
# from the template clause. No production reader imports this script.
# Direct captures: 2026-11-01 22:07 UTC, page 720202 / template 723530.
# Fresh access was challenged at 23:52 UTC; see abishai-five-piece-dcs.md.
ABISHAI_DCS = {
    "Might of the Abishai": ("Heroic", 1, 2),
    "Epic Might of the Abishai": ("Epic", 2, 2),
    "Legendary Might of the Abishai": ("Legendary", 2, 3),
}
ABISHAI_NOTE = "(Note: Tactical DCs are not affected, only Spell DCs)"


def abishai_dc_review(pages, template_entries, page_rows, gp_sets):
    """Verify all three named five-piece contexts before admitting any of them.

    The three-piece lines are checked for context drift, never interpreted.
    A missing/empty population is a failed review. Full-page hashes are also
    checked by count_review_status; this guard independently checks the ruling.
    """
    review = {"complete": False, "reviewed_clauses": 3, "verified": [], "errors": []}
    review["evidence"] = {
        "page": "https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202",
        "template": "https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530",
        "captured_at_utc": {"page": "2026-11-01T22:07:07.452869+00:00",
                            "template": "2026-11-01T22:07:09.432316+00:00"},
        "scope": "Five-piece Spell DCs only; tactical DCs excluded",
        "note": ABISHAI_NOTE,
        "freshness": "Retained direct captures; fresh access challenged 2026-11-01 23:52 UTC",
    }
    for title, revision in ((PAGE, 720202), (TEMPLATE, 723530)):
        if pages[title].get("revid") != revision:
            review["errors"].append(f"{title}: Abishai source revision changed")

    def dc_lines(tiers):
        return {th: lines for th, raw in tiers.items()
                if (lines := [S.plain(x) for x in raw if re.search(r"\bDCs\b", S.plain(x))])}

    named_rows = [r for r in page_rows if set(r["anchors"]) & ABISHAI_DCS.keys()]
    if len(named_rows) != 3:
        review["errors"].append("Abishai page must have exactly three tier records")
    for name, (tier, three, five) in ABISHAI_DCS.items():
        errors = []
        if name not in gp_sets:
            errors.append("catalog identity is missing")
        entry = template_entries.get(name.lower(), {})
        keys = re.findall(r"(?mi)^\s*\|\s*" + re.escape(name) + r"\s*=", pages[TEMPLATE]["wikitext"])
        expected_template = {3: [f"+{three} Profane bonus to DCs"],
                             5: [f"+{five} Profane bonus to DCs"]}
        if (len(keys) != 1 or entry.get("name") != name
                or set(entry.get("tiers", {})) != {3, 5}
                or dc_lines(entry.get("tiers", {})) != expected_template):
            errors.append("exact template identity, thresholds or DC clauses changed")
        rows = [r for r in named_rows if r["tier"] == tier]
        expected_page = {3: [f"+{three} Profane bonus to DCs."],
                         5: [f"+{five} Profane bonus to DCs {ABISHAI_NOTE}"]}
        if (len(rows) != 1 or rows[0]["anchors"] != list(ABISHAI_DCS)
                or set(rows[0]["tiers"]) - {None} != {3, 5}
                or dc_lines(rows[0]["tiers"]) != expected_page):
            errors.append("exact five-piece page note, tier, identities or DC clauses changed")
        if errors:
            review["errors"].extend(f"{name}: {e}" for e in errors)
        else:
            review["verified"].append({"set": name, "tier": tier, "threshold": 5,
                                       "line": expected_template[5][0]})
    review["complete"] = not review["errors"] and len(review["verified"]) == 3
    return review


# #951 — only this set's two "all types" clauses have an explicit three-member
# list in the retained page. Pin the local tier context as well as each clause:
# a condition on a separate line must not leave the scoped reading enabled.
ABISHAI_AMP_SET = "Legendary Might of the Abishai"
ABISHAI_AMP_CHANNELS = "Positive, Negative and Repair Amplification"
ABISHAI_AMP_CONTEXT = {
    "template": "4b56e12cbe4479af076f72d59bbc3358c516bcb6fdb52e5095cbd45251b4ab33",
    "page": "7783971e747d88c5970abc3d016923b1e4a74f13cf947d136e84bc3ad3912e75",
}


def abishai_amplification_review(pages, template_entries, page_rows, gp_sets):
    """Validate two exact Legendary contexts; never define 'all types' globally."""
    review = {"complete": False, "reviewed_clauses": 2, "verified": [], "errors": [],
              "evidence": {
                  "page": "https://ddowiki.com/index.php?title=Named_item_sets&oldid=720202",
                  "template": "https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530",
                  "captured_at_utc": {"page": "2026-11-01T22:07:07.452869+00:00",
                                      "template": "2026-11-01T22:07:09.432316+00:00"},
                  "scope": ABISHAI_AMP_CHANNELS,
                  "context_sha256": dict(ABISHAI_AMP_CONTEXT),
                  "freshness": "Retained direct captures; fresh access challenged 2026-11-01 23:52 UTC"}}

    def context_digest(tiers):
        context = {str(th): [S.plain(x) for x in lines] for th, lines in tiers.items()}
        return hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def amplification_lines(tiers):
        return {th: lines for th, raw in tiers.items()
                if (lines := [S.plain(x) for x in raw
                              if re.search(r"\b(?:Amp|Amplification)\b", S.plain(x), re.I)])}

    for title, revision in ((PAGE, 720202), (TEMPLATE, 723530)):
        if pages[title].get("revid") != revision:
            review["errors"].append(f"{title}: amplification source revision changed")
    if ABISHAI_AMP_SET not in gp_sets:
        review["errors"].append("Legendary Abishai catalog identity is missing")
    entry = template_entries.get(ABISHAI_AMP_SET.lower(), {})
    tiers = entry.get("tiers", {})
    keys = re.findall(r"(?mi)^\s*\|\s*" + re.escape(ABISHAI_AMP_SET) + r"\s*=", pages[TEMPLATE]["wikitext"])
    expected_template = {th: [f"+{v} Profane bonus to Heal Amp (all types)"] for th, v in ((3, 10), (5, 30))}
    if (len(keys) != 1 or entry.get("name") != ABISHAI_AMP_SET
            or sum(e.get("name") == ABISHAI_AMP_SET for e in template_entries.values()) != 1
            or set(tiers) != {3, 5} or amplification_lines(tiers) != expected_template
            or context_digest(tiers) != ABISHAI_AMP_CONTEXT["template"]):
        review["errors"].append("Legendary template identity, clauses or surrounding tier context changed")
    rows = [r for r in page_rows if set(r["anchors"]) & ABISHAI_DCS.keys()]
    legendary = [r for r in rows if r["tier"] == "Legendary"]
    page_tiers = legendary[0]["tiers"] if len(legendary) == 1 else {}
    expected_page = {th: [f"+{v} Profane bonus to {ABISHAI_AMP_CHANNELS}"] for th, v in ((3, 10), (5, 30))}
    if (len(rows) != 3 or sorted(r["tier"] or "" for r in rows) != ["Epic", "Heroic", "Legendary"]
            or any(r["anchors"] != list(ABISHAI_DCS) for r in rows)
            or len(legendary) != 1 or amplification_lines(page_tiers) != expected_page
            or context_digest(page_tiers) != ABISHAI_AMP_CONTEXT["page"]
            or any(amplification_lines(r["tiers"]) for r in rows if r["tier"] != "Legendary")):
        review["errors"].append("Legendary page identity, named channels or surrounding tier context changed")
    if not review["errors"]:
        page_lines = amplification_lines(page_tiers)
        template_lines = amplification_lines(tiers)
        review["verified"] = [{"set": ABISHAI_AMP_SET, "threshold": th,
                               "line": template_lines[th][0], "explicit_line": page_lines[th][0]}
                              for th in (3, 5)]
        review["complete"] = len(review["verified"]) == 2
    return review


def _disagreement(set_name, th, affix, records):
    name, _, value = affix
    return next((d for d in records if (d["set"], d["threshold"], d["name"], d["template"]) == (set_name, th, name, value)), None)


# #951 — two unconditional paragraphs in Template:Named item sets rev 723530.
# Pin the complete entry text and its display-name metadata before splitting its
# three sentences. These hashes supply no affixes; read_clause still reads every
# value/type/name. Evidence: docs/wiki-evidence/renegade-champion-paragraphs.md.
RENEGADE_PARAGRAPHS = {
    "renegade champion": (None, "b70b36b0396b2f17198b636765d2fb84a537dc42243da6fd45b99b35ae8c95ab"),
    "renegade champion (legendary)": ("Renegade Champion (Legendary)",
                                      "2f9e04420b7305905cb072ab6dad36113b228382cef00f2b6d3803cd857aaa3a"),
}


# #951 — the three Kundarak entries in the same revision also contain three
# explicit sentences. The raw Heroic entry includes the following alphabetic
# section comment; pin that context too. No new stat meaning or type is supplied.
# Evidence: docs/wiki-evidence/kundarak-delving-paragraphs.md.
KUNDARAK_PARAGRAPHS = {
    "kundarak delving equipment": ("Kundarak Delving Equipment",
                                  "d583d0d248bf6e3a2d9f6302ec04f179a3d1c7cb9dde853a8511a248b50534eb"),
    "epic kundarak delving equipment": ("Epic Kundarak Delving Equipment",
                                       "18699c247498aa998ffaac34c5533d5f483c26bd48ccaeb7e592834fcfb31a94"),
    "legendary kundarak delving equipment": ("Legendary Kundarak Delving Equipment",
                                            "3ca06dc6919c9f1da8dbeddcfbfa6d0fd32873aabebd7354a8e02e9e1b1abb1c"),
}


def comparison_template_entry(key, entry):
    """Split only a reviewed full entry, in a comparison copy of its tiers.

    An edited paragraph, count, name, or surrounding entry context receives no
    new parsing. The aggregate source revision/hash gate remains authoritative
    for changed source pages. Neither the shared reader nor raw text is changed.
    """
    reviewed = RENEGADE_PARAGRAPHS.get(key) or KUNDARAK_PARAGRAPHS.get(key)
    if (reviewed is None or entry["name"] != reviewed[0]
            or hashlib.sha256(entry["raw"].encode()).hexdigest() != reviewed[1]):
        return entry
    lines = entry["tiers"].get(3, [])
    raw = entry["raw"]
    if key == "kundarak delving equipment":
        # This exact suffix is already covered by the full raw-text hash above.
        raw = raw.removesuffix("\n<!-- L -->")
    if (set(entry["tiers"]) != {3} or len(lines) != 1
            or raw != "3 Pieces Equipped: " + lines[0]):
        return entry
    return {**entry, "tiers": {3: lines[0].split(". ")}}


# #951 — only the six-piece clause of Seasons of the Feywild in these retained
# sources spells "all spell DCs" with a lower-case s. Pin the complete raw bonus
# context and identity before reusing the existing "all Spell DCs" reader. This
# does not admit the independent maximum-Spell-Points clause or any new mechanic.
# Evidence: docs/wiki-evidence/feywild-six-piece-clause.md.
FEYWILD_NAME = "Seasons of the Feywild"
FEYWILD_CLAUSE = "+1 Artifact bonus to all spell DCs"
FEYWILD_CONTEXT = {
    TEMPLATE: (723530, "652cc329eeb176d820ffad8aaebb6b64b299de196cfadf3faae493c6ec78f987"),
    PAGE: (720202, "24f0b53deb373e34f086e9e0ee18c86376315ba1fe0d1239bb6484a2e2e3f092"),
}


def comparison_feywild_entry(entry, source, key=None):
    """Change one spelling in a comparison copy; preserve all original text."""
    title = source.get("title")
    reviewed = FEYWILD_CONTEXT.get(title)
    if (reviewed is None or source.get("revid") != reviewed[0]
            or hashlib.sha256(entry["raw"].encode()).hexdigest() != reviewed[1]):
        return entry
    if title == TEMPLATE:
        if key != FEYWILD_NAME.lower() or entry["name"] != FEYWILD_NAME:
            return entry
        line = FEYWILD_CLAUSE
    else:
        if (entry["anchors"] != [FEYWILD_NAME] or entry["tier"] is not None
                or entry["section"] != "Fables of the Feywild sets"):
            return entry
        line = "* " + FEYWILD_CLAUSE
    if set(entry["tiers"]) != {2, 3, 4, 5, 6, 7} or entry["tiers"].get(6) != [line]:
        return entry
    return {**entry, "tiers": {**entry["tiers"],
                              6: [line.replace("all spell DCs", "all Spell DCs")]}}


# #951 — these two complete Template rev 723530 entries explicitly introduce
# four bonus clauses with "You gain". Admit only their literal prefixes in a
# comparison copy; all names, units, types and amounts still go to read_clause.
# Evidence and the older Helpless-note value discrepancy are recorded in
# docs/wiki-evidence/silent-avenger-comparison.md. No live-game ruling is made.
SILENT_AVENGER_ENTRIES = {
    "silent avenger set (heroic)": ("Silent Avenger Set (Heroic)",
                                     "dd3981b49bf916991b0c145dd249997513bd4e244f2dd5516956ce2a4413d227"),
    "silent avenger set (legendary)": ("Silent Avenger Set (Legendary)",
                                        "98de6298a004e28f1b70f2927f3d629a3adbc2c75bb58ee7f034c153a27b7f5d"),
}


def comparison_silent_avenger_entry(key, entry, source):
    """Read literal prefixes only inside these two unchanged source entries."""
    reviewed = SILENT_AVENGER_ENTRIES.get(key)
    if (source.get("title") != TEMPLATE or source.get("revid") != 723530
            or reviewed is None or entry["name"] != reviewed[0]
            or hashlib.sha256(entry["raw"].encode()).hexdigest() != reviewed[1]):
        return entry
    lines = entry["tiers"].get(3, [])
    if (set(entry["tiers"]) != {3} or len(lines) != 4
            or entry["raw"] != "3 Pieces Equipped:<br />" + "<br />".join(lines)):
        return entry
    return {**entry, "tiers": {3: [line.removeprefix("You gain a ").removeprefix("You gain ")
                                   for line in lines]}}


# #951 — one Heroic page clause repeats "bonus". Its own named Template entry
# independently states the same two-piece +1 Quality Seeker clause. Require both
# complete retained contexts; this is no generic grammar or Sneak Attack ruling.
# Evidence: docs/wiki-evidence/slice-dice-seeker-comparison.md.
SLICE_SEEKER_PAGE_CONTEXT = "178ceeaceca14fbae264e99e08ff19f94d54fcfcd6d03f046216f989c19ef47d"
SLICE_SEEKER_TEMPLATE_CONTEXT = "c6bbb2a271eed7a901c5475ef34d28f37db8f5ef2354e004951b917745419573"


def comparison_slice_seeker_row(row, page, template, template_entries):
    """Read one jointly evidenced Seeker clause in a Heroic comparison copy."""
    if (page.get("title") != PAGE or page.get("revid") != 720202
            or template.get("title") != TEMPLATE or template.get("revid") != 723530
            or row["section"] != "The Devil's Gambit sets" or row["tier"] != "Heroic"
            or row["anchors"] != ["Slice 'n Dice Set", "Epic Slice 'n Dice Set"]
            or hashlib.sha256(row["raw"].encode()).hexdigest() != SLICE_SEEKER_PAGE_CONTEXT):
        return row
    original = ["* +1 [[Quality bonus]] bonus to [[Seeker]]",
                "* +1 [[Quality bonus]] bonus to [[Sneak Attack]]"]
    entry = template_entries.get("slice 'n dice set", {})
    expected = ["+1 [[Quality bonus]] to [[Seeker]]",
                "+1 Quality bonus to [[Sneak Attack]]", "They make julienne fries."]
    keys = re.findall(r"(?mi)^\s*\|\s*slice 'n dice set\s*=", template["wikitext"])
    if (row["tiers"] != {2: original} or len(keys) != 1
            or entry.get("name") is not None or entry.get("tiers") != {2: expected}
            or hashlib.sha256(entry.get("raw", "").encode()).hexdigest() != SLICE_SEEKER_TEMPLATE_CONTEXT):
        return row
    return {**row, "tiers": {2: [original[0].replace("]] bonus to", "]] to", 1), original[1]]}}


# #951 — Epic's page Seeker clause repeats "bonus". Its own named Template
# states two items and +2 Quality Seeker; no amount is scaled from Heroic.
# Require both retained contexts and preserve every other quarantined clause.
# Evidence: docs/wiki-evidence/epic-slice-seeker-comparison.md.
EPIC_SLICE_SEEKER_PAGE_CONTEXT = "178ceeaceca14fbae264e99e08ff19f94d54fcfcd6d03f046216f989c19ef47d"
EPIC_SLICE_SEEKER_TEMPLATE_CONTEXT = "836e6bd340db1d81fcd231764e3f1c13c7ddfe0bf2887f0141266617a27ca600"


def comparison_epic_slice_seeker_row(row, page, template, template_entries):
    """Read only Epic's jointly evidenced Seeker clause in a comparison copy."""
    if (page.get("title") != PAGE or page.get("revid") != 720202
            or template.get("title") != TEMPLATE or template.get("revid") != 723530
            or row["section"] != "The Devil's Gambit sets" or row["tier"] != "Epic"
            or row["anchors"] != ["Slice 'n Dice Set", "Epic Slice 'n Dice Set"]
            or hashlib.sha256(row["raw"].encode()).hexdigest() != EPIC_SLICE_SEEKER_PAGE_CONTEXT):
        return row
    original = ["* +2 [[Quality bonus]] bonus to [[Seeker]]",
                "* +2 [[Quality bonus]] bonus to [[Sneak Attack]]"]
    entry = template_entries.get("epic slice 'n dice set", {})
    expected = ["+2 [[Quality bonus]] to [[Seeker]]",
                "+2 Quality bonus to [[Sneak Attack]]", "They make julienne fries."]
    keys = re.findall(r"(?mi)^\s*\|\s*epic slice 'n dice set\s*=", template["wikitext"])
    if (row["tiers"] != {2: original} or len(keys) != 1
            or entry.get("name") is not None or entry.get("tiers") != {2: expected}
            or hashlib.sha256(entry.get("raw", "").encode()).hexdigest() != EPIC_SLICE_SEEKER_TEMPLATE_CONTEXT):
        return row
    return {**row, "tiers": {2: [original[0].replace("]] bonus to", "]] to", 1), original[1]]}}


def classify(wiki_tiers: dict, gp: dict, stat_names, set_name=None, disagreements=(),
             upstream=(), clause_rulings=(), amplification_rulings=()) -> tuple[str, dict]:
    """One source's {threshold: [lines]} against gear-planner's tiers -> (class, detail).

    An extra affix that matches a recorded `WIKI_DISAGREEMENTS` entry is a wiki
    question, not ours-differs: the set lands in `wiki-disagrees` instead. One that
    matches a recorded `UPSTREAM_STALE` entry (and gear-planner still carries the
    recorded older value) lands in `upstream-stale`.

    Only a fully read, otherwise matching comparison can be catalog-unmatched.
    Quarantined text may contain the unmatched fields; a scoped value ruling
    already explains a difference. Neither case is a claim of exact parity.
    """
    if None in wiki_tiers:
        return "threshold-unstated", {"lines": [S.plain(x) for x in wiki_tiers[None]]}
    if set(wiki_tiers) != set(gp):
        return "threshold-differs", {"wiki": sorted(wiki_tiers), "gear-planner": sorted(k for k in gp if k is not None)}
    quarantined, extra, catalog_unmatched, applied, amplification_applied = [], [], [], [], []
    for th, lines in wiki_tiers.items():
        read = collections.Counter()
        for line in lines:
            r = S.read_clause(line, BONUS_TYPES, stat_names)
            # Only a complete cross-source review can supply these exact keys.
            # Reuse the existing explicit Spell DCs reader and its vocabulary
            # gate; never add a global meaning for the bare word DCs.
            ruling = next((x for x in clause_rulings if x["set"] == set_name
                           and x["threshold"] == th and x["line"] == S.plain(line)), None)
            if ruling is not None:
                r = S.read_clause(S.plain(line).removesuffix("DCs") + "Spell DCs", BONUS_TYPES, stat_names)
                if "affixes" in r:
                    applied.append({"threshold": th, "line": S.plain(line),
                                    "scope": "Spell DCs only; tactical DCs excluded"})
            amplification = next((x for x in amplification_rulings if x["set"] == set_name
                                  and x["threshold"] == th and x["line"] == S.plain(line)), None)
            if amplification is not None:
                # Read the page's exact explicit list through the existing reader,
                # including its vocabulary gate. Neither input is rewritten.
                r = S.read_clause(amplification["explicit_line"], BONUS_TYPES, stat_names)
                if "affixes" in r:
                    amplification_applied.append({"threshold": th, "line": S.plain(line),
                                                  "scope": ABISHAI_AMP_CHANNELS})
            if "affixes" in r:
                for a in r["affixes"]:
                    read.update(comparison_affixes(a))
            else:
                quarantined.append({"threshold": th, "line": S.plain(line), "reason": r["quarantine"]})
        catalog = gp.get(th, collections.Counter())
        extra += [{"threshold": th, "affix": list(k)} for k in (read - catalog).elements()]
        catalog_unmatched += [{"threshold": th, "affix": list(k)} for k in (catalog - read).elements()]
    known = [e for e in extra if _disagreement(set_name, e["threshold"], e["affix"], disagreements)]
    extra = [e for e in extra if e not in known]
    stale_gp = [e for e in extra if _upstream_stale(set_name, e["threshold"], e["affix"], gp, upstream)]
    extra = [e for e in extra if e not in stale_gp]
    ruling_detail = {"spell_dc_rulings": applied} if applied else {}
    if amplification_applied:
        ruling_detail["amplification_rulings"] = amplification_applied
    if extra:
        return "ours-differs", {"extra": extra, "quarantined": quarantined, "wiki_disagrees": known,
                                "upstream_stale": stale_gp, **ruling_detail}
    if known:
        return "wiki-disagrees", {"wiki_disagrees": known, "quarantined": quarantined, "upstream_stale": stale_gp, **ruling_detail}
    if stale_gp:
        return "upstream-stale", {"upstream_stale": stale_gp, "quarantined": quarantined, **ruling_detail}
    if quarantined:
        return "partial", {"quarantined": quarantined, **ruling_detail}
    if catalog_unmatched:
        return "catalog-unmatched", {"catalog_unmatched": catalog_unmatched, **ruling_detail}
    return "exact", ruling_detail


def diff(pages: dict, gp_sets: dict) -> dict:
    page, template = pages[PAGE], pages[TEMPLATE]
    T = {}
    for key, entry in S.template_sets(template["wikitext"]).items():
        entry = comparison_template_entry(key, entry)
        entry = comparison_feywild_entry(entry, template, key)
        T[key] = comparison_silent_avenger_entry(key, entry, template)
    rows = [comparison_epic_slice_seeker_row(
                comparison_slice_seeker_row(comparison_feywild_entry(row, page), page, template, T),
                page, template, T)
            for row in S.page_sets(page["wikitext"])]
    by_anchor = {}
    for r in rows:
        if r["tier"] is None:
            for a in r["anchors"]:
                by_anchor.setdefault(a.lower(), r)
    stat_names = {a.get("name") for t in gp_sets.values() for tier in t for a in tier.get("affixes") or []}
    name_matches, name_review = reviewed_name_matches(T, rows, gp_sets)
    bug_review = arcsteel_bug_review(T, rows, gp_sets)
    dc_review = abishai_dc_review(pages, T, rows, gp_sets)
    amplification_review = abishai_amplification_review(pages, T, rows, gp_sets)
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
                UPSTREAM_STALE, dc_review["verified"] if src == "template" and dc_review["complete"] else (),
                amplification_review["verified"] if src == "template" and amplification_review["complete"] else ())
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
        "abishai_dc_review": dc_review,
        "abishai_amplification_review": amplification_review,
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
                     and report["abishai_dc_review"]["complete"]
                     and report["abishai_amplification_review"]["complete"]
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
    print(f"\nabishai DC review: {json.dumps(report['abishai_dc_review'], ensure_ascii=False)}")
    print(f"\nabishai amplification review: {json.dumps(report['abishai_amplification_review'], ensure_ascii=False)}")
    print(f"\nname alias review: {json.dumps(report['name_alias_review'], ensure_ascii=False)}")
    if not report["name_alias_review"]["complete"]:
        print("Name alias review is stale or ambiguous: recheck the named template, page anchor and tier before accepting this comparison.")
        return 1
    print(f"\nwiki bug review: {json.dumps(report['wiki_bug_review'], ensure_ascii=False)}")
    if not report["wiki_bug_review"]["complete"]:
        print("Wiki bug ruling is stale or unsupported: recheck Arcsteel's heroic Intelligence note, "
              "template and catalog before accepting this comparison.")
        return 1
    if not report["abishai_dc_review"]["complete"]:
        print("Abishai DC ruling is stale or unsupported: recheck the three exact five-piece spell-only notes and clauses.")
        return 1
    if not report["abishai_amplification_review"]["complete"]:
        print("Abishai amplification ruling is stale or unsupported: recheck the two exact Legendary clauses and named channels.")
        return 1
    if not report["count_review"]["complete"]:
        print("Count review is stale or incomplete: check the changed sources and named entries "
              "against DDO Wiki before updating set-count-review.json. Never infer counts.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
