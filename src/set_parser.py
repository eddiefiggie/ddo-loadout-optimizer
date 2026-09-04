"""U4 — named-item set-bonus parser.

Turns a set's free-text `piece_bonuses` ({"5 Pieces": "<text>", ...}) into
structured threshold-affixes: (stat, bonus_type, value, pieces_required). The
solver (U5) makes each such affix available only when >= pieces_required pieces
of the set are equipped.

Two real wiki shapes are handled:
  * inline per-clause type:  "+5 Artifact bonus to Physical Resistance Rating"
  * trailing line type:      "+20 PRR/MRR; +2 all Ability Scores (Artifact)"
    — a "(Type)" at the very end applies to every ';'-separated clause.
Untyped clauses default to Enhancement (the affix_parser convention).

Strictly explicit (KTD5): a clause with no parseable magnitude, or a piece tier
whose label carries no number, is FLAGGED (quarantined), never guessed. Compound
stat names ("PRR/MRR", "all Ability Scores") are preserved verbatim, not split —
splitting would invent stats the wiki text does not enumerate.
"""
from __future__ import annotations

import re

from src.affix_parser import parse_line, BONUS_TYPES, MULTI_STAT_TOKENS
from src import set_tier_folds

_PIECES = re.compile(r"(\d+)")
_TRAILING_TYPE = re.compile(r"\(([^)]+)\)\s*$")


def _pieces_required(label: str):
    """First integer in the tier label, but only a real threshold (>= 1)."""
    m = _PIECES.search(label or "")
    n = int(m.group(1)) if m else None
    return n if (n is not None and n >= 1) else None


def _expand_compound(stat: str):
    """Split a "/"-joined multi-stat token (e.g. "PRR/MRR") the value-first parse
    left intact, so the halves match real targets. Non-compound stats pass through."""
    parts = [p.strip() for p in stat.split("/")]
    if len(parts) > 1 and all(p in MULTI_STAT_TOKENS for p in parts):
        return parts
    return [stat]


def parse_piece_text(text: str) -> tuple[list, list]:
    """Parse one piece-bonus string into (affixes, flagged).

    Clauses run through affix_parser.parse_line so the dice/crit/proc/scaling/noise
    guards apply (never mint an affix from non-magnitude text). A trailing "(Type)"
    types the line, but only when it is a single known bonus type (so a membership
    marker like "(Legendary set)" is not fabricated into a type), and only for
    clauses that carry no explicit type of their own (never override a stated one).
    """
    affixes, flagged = [], []
    text = (text or "").strip()
    if not text:
        return affixes, flagged

    line_type = None
    m = _TRAILING_TYPE.search(text)
    if m:
        inner = m.group(1).strip()
        if inner in BONUS_TYPES:
            line_type = inner                       # a real trailing bonus type
            text = text[: m.start()].strip()
        elif inner.lower().endswith("set"):
            text = text[: m.start()].strip()        # a membership marker — strip, don't mint a type

    for clause in re.split(r";|\n", text):
        clause = clause.strip()
        if not clause:
            continue
        r = parse_line(clause)
        if r["kind"] != "affix":
            flagged.append({"raw": clause, "reason": r.get("reason") or f"non-affix ({r['kind']})"})
            continue
        for a in r["affixes"]:
            for part in _expand_compound(a["stat"]):
                b = dict(a)
                # #305/#695 — fold the REPO-REVIEWED local spellings to their
                # canonical stat at the shared parse seam, so BOTH channels this
                # parser feeds (item-attached parsed_set_bonuses and the
                # membership set defs) emit the canonical; tier `raw` stays
                # verbatim. Scoped to `local_affix_synonyms` — never the merged
                # `registry_synonym_folds`, whose upstream half would drag
                # Accuracy<-Attack and AC<-Shield into channels that never had
                # them (see src/set_tier_folds.py's SCOPE note).
                b["stat"] = set_tier_folds.fold_stat(part)
                if line_type and b["bonus_type"] == "Enhancement":
                    b["bonus_type"] = line_type  # apply trailing type only to untyped clauses
                affixes.append(b)
    return affixes, flagged


def parse_set_bonuses(set_bonus_list) -> list:
    """Parse every tier of every set a variant belongs to.

    Returns a list of {set, pieces_required, pieces_label, affixes, flagged,
    wiki_url}. A tier with no numeric piece count is flagged and gets
    pieces_required=None so the solver skips it (cannot threshold).
    """
    out = []
    for s in set_bonus_list or []:
        name = s.get("set")
        wiki_url = s.get("wiki_url")
        for label, text in (s.get("piece_bonuses") or {}).items():
            n = _pieces_required(label)
            affixes, flagged = parse_piece_text(text)
            if n is None:
                flagged = flagged + [{"raw": label, "reason": "no numeric piece count"}]
            out.append({
                "set": name,
                "pieces_required": n,
                "pieces_label": label,
                "affixes": affixes,
                "flagged": flagged,
                "wiki_url": wiki_url,
                "raw": text,
            })
    return out


def annotate_variant(v: dict) -> dict:
    """Attach parsed_set_bonuses to a variant, in place."""
    v["parsed_set_bonuses"] = parse_set_bonuses(v.get("set_bonus"))
    return v


def set_coverage(variants) -> dict:
    """Counts of set threshold-affixes parsed vs flagged across all variants."""
    parsed = flagged = 0
    tiers = 0
    for v in variants:
        for tier in v.get("parsed_set_bonuses") or []:
            tiers += 1
            parsed += len(tier["affixes"])
            flagged += len(tier["flagged"])
    return {"set_tiers": tiers, "set_affixes_parsed": parsed, "set_clauses_flagged": flagged}
