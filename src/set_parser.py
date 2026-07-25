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

from src.affix_parser import _parse_value_bearing, _norm_type
from src import vocab

_PIECES = re.compile(r"(\d+)")
_TRAILING_TYPE = re.compile(r"\(([^)]+)\)\s*$")


def _pieces_required(label: str):
    m = _PIECES.search(label or "")
    return int(m.group(1)) if m else None


def parse_piece_text(text: str) -> tuple[list, list]:
    """Parse one piece-bonus string into (affixes, flagged)."""
    affixes, flagged = [], []
    text = (text or "").strip()
    if not text:
        return affixes, flagged

    # a trailing "(Type)" applies to every clause on the line
    line_type = None
    m = _TRAILING_TYPE.search(text)
    if m and _norm_type(m.group(1)):
        line_type = _norm_type(m.group(1))
        text = text[: m.start()].strip()

    for clause in re.split(r";|\n", text):
        clause = clause.strip()
        if not clause:
            continue
        got = _parse_value_bearing(clause, clause, forced_type=line_type)
        if got:
            for a in got:
                a["stat"] = vocab.normalize_stat(a["stat"])
            affixes.extend(got)
        else:
            flagged.append({"raw": clause, "reason": "no parseable magnitude"})
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
