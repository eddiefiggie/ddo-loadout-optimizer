"""The crafted amplification triple must stay in its worn bucket (#440).

Three amplification stats are minted together by crafting options in three
channels — `nearly_complete`, `viktranium` (Melancholic Converter) and
`dino_inserts` — eight rows each, at the same values (19/24/56/61/62):

    Healing Amplification   Competence
    Repair Amplification    Enhancement
    Negative Amplification  Profane

#440 asks whether `Repair Amplification` should be `Competence` like its Healing
sibling rather than `Enhancement` — whether it is "the third member of the same
set, left behind because nobody reported it". Settling that needs a wiki tooltip
(see `docs/wiki-evidence/repair-amplification-type.md`); this guard does not rule
on it. It exists because of what an edit to that type would do.

## The phantom

The solver buckets contributions by `stat||equivType(type)` and takes the max
within a bucket (`web/solver.js`, `Σz ≤ 1`). `Competence` and `Enhancement` are
distinct buckets — only the three `* Natural` pairs are equivalent — so retyping
a crafted row moves it OUT of the bucket its worn siblings occupy, and the two
then sum instead of collapsing:

  * today: crafted Repair 62 `Enhancement` + worn Adamantine Bracers 53
    `Enhancement` -> one bucket -> credited 62
  * retype the crafted rows alone -> 62 `Competence` + 53 `Enhancement`
    -> two buckets -> credited 115

The same trap applies within the crafted channels: retyping only the
`nearly_complete` rows the issue names by title, and leaving the six in
`viktranium` and `dino_inserts`, credits 123 where the catalog grants 62.

Neither number is a corrected bonus type. Both are points no item grants.

## What is asserted

1. The crafted channels agree with each other, per stat.
2. Each stat's crafted type equals the type its own worn catalog predominantly
   uses for that same stat. This is the arm that matters: `Repair Amplification`
   is `Enhancement` on 48 worn/augment rows, so the crafted rows are not an
   orphan to be aligned with Healing — they are already in the largest bucket
   their own stat has.

A retype ruled by the wiki passes both arms only if the worn rows move with the
crafted ones, which is the correct shape of that fix.

## Why this is scoped to three stat names and not a general rule

A general "a stat carries one bonus type" gate is WRONG and must not be written.
44 of the 154 stats reachable through crafted channels legitimately carry more
than one bonus type — `Accuracy` is Competence and Quality; `Fire Intensity` is
Enhancement, Insight and Quality — because DDO crafting deliberately offers the
same stat in different types so a player can take both and stack them. These
three stats are themselves multi-typed across the whole catalog (Repair
Amplification also appears as Insight, Quality, Profane and Artifact). The
invariant here is narrower: the CRAFTED rows of this one bundled triple sit in
the same bucket as their own worn siblings.
"""
import collections
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_dataset  # noqa: E402

AMPLIFICATION_STATS = ("Healing Amplification", "Repair Amplification", "Negative Amplification")

CRAFTED_CHANNELS = ("nearly_complete", "nearly_complete_per_item", "viktranium",
                    "seal", "dino_inserts", "thunder_forged", "green_steel")

# How dominant the worn type must be before arm 2 treats it as the stat's bucket.
# Measured margins today: Healing 120 vs 55, Repair 48 vs 3, Negative 37 vs 5.
_DOMINANCE = 2.0

_BUILT = None


def _build():
    global _BUILT
    if _BUILT is None:
        _BUILT = build_dataset.build()
    return _BUILT


def _affix_name_and_type(affix):
    """Both affix dialects, because the two artifacts disagree.

    In the IN-PROCESS build this guard reads, every channel speaks
    `stat`/`bonus_type` — items and crafted pools alike (41,789 rows, no
    exceptions). The SHIPPED `web/data/items.json` is different: `items[]` is
    serialized in gear-planner's native `name`/`type` block per the overhaul
    close-out, while the crafted pools keep `stat`/`bonus_type`. Reading both
    spellings costs nothing and keeps this helper correct if it is ever pointed
    at the artifact instead of the build, where a single-dialect scan would
    silently report zero worn rows and make arm 2 vacuous.
    """
    name = affix.get("name") or affix.get("stat")
    bonus_type = affix.get("type") if "type" in affix else affix.get("bonus_type")
    return name, bonus_type


def _crafted_rows():
    """{stat: {bonus_type: [(channel, value), ...]}} over the crafted channels."""
    data = _build()
    rows = {s: collections.defaultdict(list) for s in AMPLIFICATION_STATS}
    for channel in CRAFTED_CHANNELS:
        value = data.get(channel)
        records = []
        if isinstance(value, list):
            records = [r for r in value if isinstance(r, dict)]
        elif isinstance(value, dict):
            for group in value.values():
                if isinstance(group, list):
                    records += [r for r in group if isinstance(r, dict)]
        for record in records:
            for affix in record.get("affixes") or []:
                if not isinstance(affix, dict):
                    continue
                name, bonus_type = _affix_name_and_type(affix)
                if name in rows:
                    rows[name][bonus_type].append((channel, affix.get("value")))
    return rows


def _worn_types():
    """{stat: Counter(bonus_type)} over worn items and augment variants."""
    counts = {s: collections.Counter() for s in AMPLIFICATION_STATS}
    for variant in _build()["items"]:
        for affix in variant.get("affixes") or []:
            if not isinstance(affix, dict):
                continue
            name, bonus_type = _affix_name_and_type(affix)
            if name in counts:
                counts[name][bonus_type] += 1
    return counts


def test_each_crafted_amplification_stat_carries_one_bonus_type():
    """A stat retyped in one crafted channel but not the others stacks with itself."""
    rows = _crafted_rows()
    for stat in AMPLIFICATION_STATS:
        by_type = rows[stat]
        if len(by_type) <= 1:
            continue
        detail = "; ".join(
            f"{bonus_type!r} in {sorted({c for c, _ in occ})}"
            for bonus_type, occ in sorted(by_type.items(), key=lambda kv: str(kv[0])))
        raise AssertionError(
            f"{stat} carries {len(by_type)} bonus types across crafted channels: {detail}. "
            "These channels mint one bundled effect, so two types are two solver buckets and the "
            "values SUM instead of collapsing to the max. If a wiki ruling retypes this stat (#440), "
            "retype every crafted channel AND its worn rows in the same commit. See "
            "docs/wiki-evidence/repair-amplification-type.md.")


def test_crafted_amplification_sits_in_the_same_bucket_as_its_worn_siblings():
    """The arm that protects the real bucket: 48 worn rows, not just the 8 crafted."""
    crafted = _crafted_rows()
    worn = _worn_types()
    for stat in AMPLIFICATION_STATS:
        types = list(crafted[stat])
        if len(types) != 1:
            continue   # arm 1 owns the cross-channel split and reports it properly
        crafted_type = types[0]
        ranked = worn[stat].most_common()
        assert ranked, f"{stat}: no worn or augment rows found — see the dialect note in this module"
        dominant, dominant_n = ranked[0]
        runner_n = ranked[1][1] if len(ranked) > 1 else 0
        if runner_n and dominant_n < runner_n * _DOMINANCE:
            continue   # no clear worn convention; arm 1 still applies
        assert crafted_type == dominant, (
            f"{stat}: the crafted channels grant it as {crafted_type!r}, but the worn catalog grants "
            f"it as {dominant!r} on {dominant_n} rows. The crafted rows have left the bucket their "
            "own worn siblings occupy, so a player taking both is credited the SUM rather than the "
            f"higher of the two. Retyping the crafted rows alone does not correct a bonus type — it "
            "invents points. Move the worn rows too, or leave both alone (#440).")


def test_the_triple_is_actually_present_to_inspect():
    """Refuse to inspect zero records.

    Both assertions above are vacuous for a stat with no rows, so a renamed stat,
    a moved channel key, or a build that stopped emitting the crafted pools would
    turn this guard green while covering nothing.
    """
    crafted = _crafted_rows()
    worn = _worn_types()
    for stat in AMPLIFICATION_STATS:
        occurrences = [o for occ in crafted[stat].values() for o in occ]
        assert len(occurrences) >= 6, (
            f"{stat}: only {len(occurrences)} crafted rows found, expected at least 6 — the stat was "
            "renamed, or a CRAFTED_CHANNELS key no longer matches the dataset. This guard cannot "
            "protect a population it cannot see.")
        assert len({c for c, _ in occurrences}) >= 3, (
            f"{stat}: crafted rows found in only {sorted({c for c, _ in occurrences})} — the triple "
            "spans three channels, and a guard reading one would miss the cross-channel split.")
        assert sum(worn[stat].values()) >= 20, (
            f"{stat}: only {sum(worn[stat].values())} worn/augment rows found. Arm 2 compares against "
            "that population; if the affix dialect moves again this reads zero and asserts nothing.")
