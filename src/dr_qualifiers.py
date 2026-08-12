"""#223 — a DR bypass qualifier is not a bonus type; stop summing across them.

gear-planner stores `DR 15/Epic` as an affix named ``DR`` whose ``type`` field
carries the bypass qualifier (``Epic``). The solver's bucket core treats every
distinct type token as an independently additive bucket, so a player ranking DR
was credited with the SUM across qualifiers — a total the game never grants.
The wiki ruling (docs/wiki-evidence/damage-reduction-stacking.md) is that DR
does not stack: only the highest DR the attack does not bypass applies.

The ruling also rules out a naive single-bucket max: two DR values with
different qualifiers are not comparable by magnitude, because a qualifier is
the condition under which the number is worth zero (`DR 15/Epic` is worth 0
against the epic raid bosses that bypass it). So the model here, decided in
#223, splits the qualifiers by whether anything in the game bypasses them:

* **Unconditional** — ``-`` (nothing bypasses it, by definition) and the
  material qualifiers (wiki, stated outright: "There are currently no known
  monsters that can bypass material type DR"). These keep their magnitude and
  are retyped into the single ``-`` bucket, so the solver takes the max across
  them — exactly the "highest applicable DR" the wiki describes for a hit
  nothing bypasses. A retyped material affix is stamped with a ``via`` receipt
  (``DR 30/Adamantine``) so the attribution names the engraved enchantment
  rather than pretending the qualifier never existed.

* **Conditional** — alignments (bypassed by the opposite alignment), physical
  damage types (monsters generally deal one, which bypasses the match),
  ``Epic`` (epic raid bosses bypass it) and ``Magic`` (wiki example: Mephits
  bypass it). "How much" is not answerable without naming the attacker, so the
  magnitude is demoted to a presence affix named for the full enchantment
  (``DR 10/Good``, type ``Bool``) — visible, pinnable, never a number.

A qualifier on neither list fails the build. Classifying it silently either
way is an inference about what bypasses it, and this project does not infer
(AGENTS.md); the wiki page has to rule first.

Runs at the planner-record seam, before variant expansion, so the corrected
affix block flows into verify/coverage, the picker vocabulary, the solver,
browse, and the exports from ONE place — the same reasoning as the Speed and
Parrying splits beside it in ``build_dataset.build()``.
"""
from __future__ import annotations

STAT = "DR"

# Nothing bypasses `-` by definition. Materials are the wiki's own list
# (Adamantine is the only one the current roster carries; the rest are listed
# so a future harvest lands on a ruling, not a guess).
UNCONDITIONAL_QUALIFIERS = frozenset({
    "-", "Adamantine", "Byeshk", "Cold Iron", "Crystal", "Mithral", "Silver",
})

# Bypassed by real, common attackers per the ruling. `Magic` appears in the
# wiki's own worked example (Mephits bypass DR/Magic) though no harvested item
# carries it yet.
CONDITIONAL_QUALIFIERS = frozenset({
    "Good", "Evil", "Lawful", "Chaotic",
    "Bludgeoning", "Piercing", "Slashing",
    "Epic", "Magic",
})

# The bucket every unconditional DR magnitude lands in. `-` is the native
# token 18 of the 22 keepers already carry, and the solver's same-bucket rule
# is max — which is the wiki's rule for DR sources nothing bypasses.
CANONICAL_TYPE = "-"

PROVENANCE_KEY = "via"  # same receipt channel as src/spell_focus.py


def enchantment_label(value, qualifier: str) -> str:
    """The engraved enchantment a (value, qualifier) pair renders as in game."""
    return f"DR {value}/{qualifier}"


def apply(records) -> dict:
    """Rewrite every ``DR`` affix on the planner records, in place.

    Returns coverage counts for the metadata block. Raises on an unclassified
    qualifier (never infer) and on a sweep that touched nothing — a transform
    that found zero DR affixes is not evidence the data is clean, it is
    evidence the join broke (prove-a-guard-fails rule).
    """
    kept = 0
    receipts = 0
    demoted = 0
    demoted_names = set()
    problems = []
    for rec in records or []:
        for affix in rec.get("affixes") or []:
            if affix.get("name") != STAT:
                continue
            qualifier = affix.get("type")
            if qualifier in UNCONDITIONAL_QUALIFIERS:
                kept += 1
                if qualifier != CANONICAL_TYPE:
                    # Keep the engraved enchantment visible in receipts; the
                    # retype below is a bucket concern, not a rename.
                    affix[PROVENANCE_KEY] = enchantment_label(
                        affix.get("value"), qualifier)
                    affix["type"] = CANONICAL_TYPE
                    receipts += 1
            elif qualifier in CONDITIONAL_QUALIFIERS:
                name = enchantment_label(affix.get("value"), qualifier)
                affix["name"] = name
                affix["type"] = "Bool"
                affix["value"] = 1
                demoted += 1
                demoted_names.add(name)
            else:
                problems.append(
                    f"{rec.get('name', '<unnamed>')}: DR qualifier {qualifier!r} "
                    "is on neither the unconditional nor the conditional list — "
                    "rule on it (docs/wiki-evidence/damage-reduction-stacking.md) "
                    "before the build may classify it")
    if problems:
        raise SystemExit("DR qualifier gate failed:\n  " + "\n  ".join(problems))
    if not kept and not demoted:
        raise ValueError(
            "DR qualifier sweep touched zero affixes — refusing to report a "
            "clean pass over nothing (the join is broken or the stat renamed)")
    return {
        "kept_numeric": kept,
        "material_receipts": receipts,
        "demoted_presence": demoted,
        "demoted_names": sorted(demoted_names),
    }
