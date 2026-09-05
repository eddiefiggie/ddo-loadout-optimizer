"""#192 — expand the folded `Command` affix into what the enchantment grants.

`Command` is not a stat. In game it names an enchantment on armor and shields
that grants a Competence bonus — or, on some items, an Insight bonus — to the
six Charisma-based skill checks, and imposes a flat -6 penalty on Hide. Upstream
stores it as a single affix named `Command`, so a player ranking Use Magic
Device or Intimidate scored nothing from any of the 40 records that carry it
(38 items and the two Brightbane Emerald augments),
and the Hide penalty was invisible everywhere.

Wiki (read 2026-09-04, `docs/wiki-evidence/command.md`):

  * https://ddowiki.com/page/Command_(enchantment) — "grants a +x Competence
    bonus to Charisma-based skill checks ... imposing a -6 penalty on Hide
    checks. Notes: This enchantment provides +x bonus to Bluff, Diplomacy,
    Haggle, Intimidate, Perform, and Use Magic Device and imposes a -6 penalty
    to Hide. Some items have a version of this enchantment that uses an Insight
    bonus, not a Competence bonus."
  * Every carrier's rendered tooltip states the same two clauses with the item's
    own magnitude and type ("Command: Passive: +2 competence bonus on Charisma
    based skill checks ... -6 penalty on Hide checks"; "Insightful Command:
    Passive: +7 Insight bonus ...").

So, unlike Parrying (#169) and Heightened Awareness, no per-item shard is
needed: the stored magnitude IS the granted skill bonus, the stored type IS the
version (Competence or Insight — upstream carries both), and the penalty is a
constant the enchantment page states for every version. The expansion is the
`Charisma Skills` umbrella (`spell_focus.SKILLS_CHA`) with a penalty rider.

The penalty is minted as `Hide | Penalty | -6`, the bucket #614 gave penalties:
penalties always stack and are forced, never max'd, which is exactly what a
flat -6 on every Command item is. The six skill affixes keep the item's own
type and magnitude, so they compete highest-of-type with any other Competence or
Insight source of the same skill, as the game does.

Every minted affix carries the engraved enchantment name on `via`
(`Command` / `Insightful Command`, the wiki's own two spellings), so the card
still names the enchantment and a consumer can tell an expanded skill affix from
a native one by the key's presence — the same contract `spell_focus` and the
curse merges (#615) hold.

A `Command` affix with a non-numeric value, or a type outside the two the wiki
states, is left FOLDED and counted as `unexpanded`, never guessed at — the
built-dataset guard then fails the build naming it, because a folded `Command`
reaching the solver is the defect this module exists to close.

The build applies this to the item channel AND the augment pool (the
Brightbane Emeralds carry `Insightful Command`). Set bonuses, scaling rows and
every crafting pool carry no `Command` today (measured); `Command` joins the
expanded-away map, so the existing set-bonus and set-def orphan guards fire if
one ever arrives there.
"""
from __future__ import annotations

from src.spell_focus import PROVENANCE_KEY, SKILLS_CHA

FOLDED_NAME = "Command"
PENALTY_STAT = "Hide"
PENALTY_TYPE = "Penalty"
PENALTY_VALUE = -6

#: The wiki's two engraved spellings, by the bonus type the item carries.
VERSIONS = {"Competence": "Command", "Insight": "Insightful Command"}

#: The picker drops `Command` and redirects to the six skills it actually
#: raises. Hide is deliberately absent: a redirect names what a player would
#: rank to GET the effect, and nobody ranks Hide to be penalised on it.
EXPANDED_AWAY = {FOLDED_NAME.lower(): list(SKILLS_CHA)}


def _numeric(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v == int(v) else None


def expand_affix(affix: dict):
    """One folded `Command` affix -> the seven affixes it grants, or None when it
    is not a Command affix this module can vouch for (non-Command, non-numeric,
    or a bonus type the wiki does not state)."""
    if not isinstance(affix, dict) or affix.get("name") != FOLDED_NAME:
        return None
    label = VERSIONS.get(affix.get("type"))
    magnitude = _numeric(affix.get("value"))
    if label is None or magnitude is None or magnitude <= 0:
        return None
    out = []
    for skill in SKILLS_CHA:
        a = dict(affix)
        a["name"] = skill
        a[PROVENANCE_KEY] = label
        out.append(a)
    pen = dict(affix)
    pen["name"] = PENALTY_STAT
    pen["type"] = PENALTY_TYPE
    pen["value"] = str(PENALTY_VALUE)
    pen[PROVENANCE_KEY] = label
    out.append(pen)
    return out


def apply(records) -> dict:
    """Rewrite every planner record's `Command` affix in place. Returns coverage:
    records touched, affixes minted, and the folded affixes left standing (each
    named, so the build can refuse them)."""
    records_expanded = 0
    affixes_minted = 0
    by_version = {label: 0 for label in VERSIONS.values()}
    unexpanded = []
    for rec in records or []:
        affixes = rec.get("affixes") or []
        if not any(isinstance(a, dict) and a.get("name") == FOLDED_NAME for a in affixes):
            continue
        new = []
        touched = False
        for a in affixes:
            expanded = expand_affix(a)
            if expanded is None:
                if isinstance(a, dict) and a.get("name") == FOLDED_NAME:
                    unexpanded.append({"record": rec.get("name"), "type": a.get("type"),
                                       "value": a.get("value")})
                new.append(a)
                continue
            new.extend(expanded)
            affixes_minted += len(expanded)
            by_version[expanded[0][PROVENANCE_KEY]] += 1
            touched = True
        if touched:
            rec["affixes"] = new
            records_expanded += 1
    return {"records_expanded": records_expanded, "affixes_minted": affixes_minted,
            "by_version": by_version, "unexpanded": unexpanded,
            "skills": list(SKILLS_CHA),
            "penalty": {"stat": PENALTY_STAT, "type": PENALTY_TYPE, "value": PENALTY_VALUE}}
