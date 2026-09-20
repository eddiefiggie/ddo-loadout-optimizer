"""#837 — the Essence Crafting recipe table, from `veteran-software/yourddo`.

Adopted 2026-09-20 as the SOURCE OF TRUTH for Essence Crafting, by owner
decision. It replaces the ddowiki `table 1b` / `table 3b` harvest, which carried
523 placements against this table's ~1,330 — about 40% of the crafting system,
with the shortfall concentrated in the slots players craft on most (`Rings`
Prefix 12 against 77; `Bracers` Prefix 2 against 31).

**Why the wiki harvest could not close it, and it is not diligence.** The recipe
name is not the enchantment name. Recipe `False Life` grants the enchantment
`Hit Points (Enhancement)`; `Accuracy` grants `Attack (Competence)`; `Vertigo`
grants `Trip DC (Enhancement)`. Our bonus-type harvest keyed on the RECIPE name
and went looking for it on a page describing something else, which is why 21
effects came back "the wiki does not state a type" across three sweeps (#817,
#819, #820, #832). This table types the enchantment, because it is keyed by it.

**The shape, which is the part that matters.** A recipe occupies ONE menu slot
and may grant SEVERAL enchantments — `Sheltering` grants Magical and Physical
Sheltering together. That is the same one-slot-many-effects structure
`essence_combined` already models for combined prefixes, and it is why this is a
schema change rather than a data top-up: the previous model flattened recipe and
enchantment into a single `effect` key, which cannot express it.

**Trust, and its limits.** 82 of the 87 magnitudes this table shares with our
independent ddowiki harvest agree exactly at ML30 — two sources built from
different material landing on the same numbers. The five that differ are
documented in `raw/YOURDDO_SOURCE.json`; three are a dice-count loss where OUR
value is richer, and two are a sign (`Diversion` is threat REDUCTION, which we
read unsigned). Where the two disagree this module prefers the wiki, and says so
per record, because a source of truth that silently overwrites a better number
is not an improvement.
"""
from __future__ import annotations

import json
import os
import re

from src import spell_focus

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Named `..._recipes` and not `..._crafting`. The latter spelling would contain,
# as a substring, the filename of the WIKI shard —
# `tests/test_essence_crafting_shard.py` greps every file for that name to
# enforce that exactly three modules read it, and this one reads no part of it.
# A substring collision is not a reason to loosen a guard, and `recipes` is the
# more accurate word regardless: a recipe table is what this is.
RAW = os.path.join(ROOT, "data", "seed", "compendium", "raw",
                   "yourddo_essence_recipes.json")
SOURCE = os.path.join(ROOT, "data", "seed", "compendium", "raw",
                      "YOURDDO_SOURCE.json")
STAT_JOIN = os.path.join(ROOT, "data", "seed", "compendium",
                         "essence_stat_join.json")

#: Their menu keys -> ours.
MENUS = {"prefix": "Prefix", "suffix": "Suffix", "extra": "Extra"}

#: Their slot vocabulary -> our 16 placement groups.
#:
#: EXPLICIT, and total by guard. Their table mixes two vocabularies — an
#: anatomical one (`Neck`, `Wrists`, `Eyes`) and an item one (`Necklace`,
#: `Bracers`, `Goggles`) — for the same 14 slots, so no rule derives this.
#:
#: `Fingers` and `Hand` appear exactly once each, in lists whose every other
#: entry is an ordinary slot (`Hide` prefix: Fingers, Cloak, Trinket, Runearm;
#: `Deadly` suffix: Hand, Eyes, Weapon, Trinket). They are singular slips of
#: `Rings` and `Hands`, mapped deliberately and recorded here rather than
#: silently folded.
#:
#: `Weapon` is undifferentiated on their side, so it serves BOTH weapon groups —
#: the same reading `essence_combined.GROUP_OF_SLOT` already takes, and for the
#: same reason: the source is not silent about the split, it is general.
SLOT_GROUPS = {
    "Armor": ["Armors"],
    "Waist": ["Belts"],          "Belt": ["Belts"],
    "Feet": ["Boots"],           "Boots": ["Boots"],
    "Wrists": ["Bracers"],       "Bracers": ["Bracers"],
    "Cloak": ["Cloaks"],
    "Hands": ["Gloves"],         "Gloves": ["Gloves"],   "Hand": ["Gloves"],
    "Eyes": ["Goggles"],         "Goggles": ["Goggles"],
    "Head": ["Headgear"],        "Headgear": ["Headgear"],
    "Neck": ["Necklaces"],       "Necklace": ["Necklaces"],
    "Orb": ["Orbs"],
    "Rings": ["Rings"],          "Ring": ["Rings"],      "Fingers": ["Rings"],
    "Runearm": ["Rune Arms"],
    "Shield": ["Shields"],
    "Trinket": ["Trinkets"],
    "Weapon": ["Melee weapons", "Ranged weapons"],
}

#: A magnitude they store as a fraction is a PERCENTAGE. 452 enchantments carry
#: integers, 86 carry fractions below 1 (`Dodge` 0.27), and 2 carry fractions
#: above it (`Fortification` 1.46 — 146%, which our independent wiki harvest
#: also reads as 146). So the test is "is it a float", not "is it below 1".
PCT_SCALE = 100

#: The wiki's Insight floor, carried over from `essence_placements`. Upstream
#: does not encode it: it stores each recipe's own minimum, and the Insight rule
#: is a separate statement about the EFFECT.
INSIGHT_BONUS_TYPE = "Insight"
INSIGHT_MIN_ML = 10

_DICE = re.compile(r"^\s*\d+\s*d\s*\d+\s*$", re.I)


class EssenceSourceError(RuntimeError):
    pass


def load(path: str = RAW) -> list:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def provenance(path: str = SOURCE) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def assert_slot_vocabulary_is_total(recipes) -> dict:
    """Every slot name the table uses maps to a group we publish.

    A slot we do not know serves its recipes to NOBODY, which reads in the bench
    as the game offering less than it does — and it is silent, because an
    unmapped name simply produces no rows. That is exactly the failure this
    adoption exists to fix, so it is the first thing asserted.

    Refuses to pass over an empty table.
    """
    if not recipes:
        raise EssenceSourceError(
            "no recipes — this guard would pass vacuously on a table that "
            "failed to load")
    seen = {s for r in recipes for m in MENUS for s in (r.get(m) or [])}
    if not seen:
        raise EssenceSourceError(
            "no slot names in any recipe — the menu keys changed shape")
    unknown = sorted(seen - set(SLOT_GROUPS))
    if unknown:
        raise EssenceSourceError(
            f"slot name(s) the join does not know: {unknown}. Their recipes "
            "would be served to nobody, which is invisible — the bench would "
            "simply offer less and say nothing.")
    unused = sorted(set(SLOT_GROUPS) - seen)
    return {"slot_names": len(seen), "unused_mappings": unused}


def magnitude(value):
    """`(number, unit)` for one modifier value, or `(None, None)`.

    An int is flat. A float is a percentage, scaled by 100 and rounded — their
    `0.27` is 27%, their `1.46` is 146%, and our independent harvest reads
    Fortification at 146 too.
    """
    if isinstance(value, bool) or value is None:
        return None, None
    if isinstance(value, int):
        return value, "flat"
    if isinstance(value, float):
        return round(value * PCT_SCALE), "pct"
    return None, None


def curve_of(enchantment) -> tuple:
    """`(values_by_ml, unit, min_ml)` — a 36-slot curve indexed by ML-1.

    Their `modifiers` list carries only the levels the recipe is valid at: 36
    entries for an ML1 recipe, 17 for an ML20 one. Levels outside that range are
    `None` rather than zero, because "not craftable here" and "craftable for
    nothing" are different facts and the bench renders them differently.
    """
    mods = enchantment.get("modifiers") or []
    if not mods:
        return None, None, None
    by_level, units = {}, set()
    for m in mods:
        lvl = m.get("level")
        val, unit = magnitude(m.get("value"))
        if not isinstance(lvl, int) or val is None:
            continue
        by_level[lvl] = val
        units.add(unit)
    if not by_level:
        return None, None, None
    if len(units) > 1:
        # A curve that is flat at one level and percent at another cannot be put
        # in one bucket. Refused rather than resolved by majority, exactly as
        # `essence_placements` refuses a stat the catalog spells both ways.
        return None, None, None
    return ([by_level.get(lvl) for lvl in range(1, 37)],
            next(iter(units)), min(by_level))


#: The five records where this table and our independent ddowiki harvest give
#: different numbers at ML30, with a ruling each (#837).
#:
#: "Prefer the wiki" was the first instinct and it is too blunt: on three of the
#: five OUR value is richer, on two THEIRS is. So each is ruled, and the ruling
#: is asserted rather than described — `assert_disagreements_are_still_five`
#: re-derives the set on every build, so a sixth cannot arrive unnoticed.
DISAGREEMENTS = {
    # They store the die COUNT and drop the die size: 6 where the wiki
    # publishes 6d6. Ours is strictly more information, so ours wins and the
    # dice unit (#835) stays.
    "Bashing": "wiki-dice",
    "Shield Spikes": "wiki-dice",
    "Vampirism": "wiki-dice",
    # They store threat reduction NEGATIVE (-21) where our harvest read the
    # magnitude unsigned (21). Diversion reduces threat; the sign is a fact
    # about the effect and we were dropping it. Theirs wins.
    "Diversion": "theirs-signed",
    "Insightful Diversion": "theirs-signed",
}

#: Recipes whose magnitude this module takes from the wiki rather than the
#: source of truth. Derived from DISAGREEMENTS so the two cannot drift.
WIKI_MAGNITUDE = {k for k, v in DISAGREEMENTS.items() if v == "wiki-dice"}


def stat_join(path: str = STAT_JOIN) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def assert_stat_join_is_honest(join, catalog_stats, recipes) -> dict:
    """The join maps upstream's ENCHANTMENT names onto our stat vocabulary.

    Three ways this rots, and each fails:

    * **a joined target that does not exist.** `Hit Points -> False Life` is
      only useful while this catalog carries `False Life`; if it stops, the
      mapping silently produces a stat nothing can rank, and the placement
      goes quiet rather than wrong — which is harder to notice.
    * **a quarantined name that upstream stopped using.** An entry vouching for
      nothing reads as a known gap that is no longer there.
    * **a name that is neither joined nor quarantined.** That is the actual
      danger: it means a new upstream enchantment slipped in unclassified, and
      the default for unclassified is "drop it", which shrinks the table in
      exactly the way #837 exists to stop.

    What it deliberately does NOT check is whether a mapping is *right*. A wrong
    stat name is a wrong stacking bucket and no guard here can see that, which is
    why `unmatched` is quarantined rather than guessed.

    Refuses to pass over empty input.
    """
    joined = join.get("joined") or {}
    unmatched = join.get("unmatched") or {}
    if not joined:
        raise EssenceSourceError("empty join — this guard would pass vacuously")
    if not catalog_stats:
        raise EssenceSourceError(
            "no catalog stats — every joined target would read as missing")
    if not recipes:
        raise EssenceSourceError("no recipes — nothing to classify")

    names = {e.get("name") for r in recipes
             for e in (r.get("enchantments") or []) if e.get("name")}
    problems = []
    dead = sorted(k for k, v in joined.items() if v["stat"] not in catalog_stats)
    if dead:
        problems.append(
            f"joined target(s) this catalog no longer carries: {dead}. The "
            "placement would resolve to a stat nothing can rank and go quiet.")
    stale = sorted(k for k in list(joined) + list(unmatched) if k not in names)
    if stale:
        problems.append(
            f"join entr(ies) upstream no longer uses: {stale} — each vouches "
            "for nothing")
    loose = sorted(n for n in names
                   if n not in catalog_stats and n not in joined and n not in unmatched)
    if loose:
        problems.append(
            f"upstream enchantment(s) neither joined nor quarantined: {loose}. "
            "Unclassified means dropped, which is how the table shrank in the "
            "first place — map it or quarantine it with a reason.")
    if problems:
        raise EssenceSourceError("stat-join gate failed:\n  " + "\n  ".join(problems))
    return {"joined": len(joined), "quarantined": len(unmatched),
            "native": len(names & set(catalog_stats))}


#: yourddo bonus-type spelling -> this catalog's. A wrong bonus type is a wrong
#: STACKING BUCKET, invisible once solved, so this is explicit and guarded.
BONUS_TYPE_JOIN = {
    # 149 catalog affixes typed `Natural`, none typed `Natural Armor`; the wiki's
    # own stated type for the effect is `Natural`.
    "Natural Armor": "Natural",
}


def assert_every_minted_type_has_a_bucket(groups, catalog_types) -> dict:
    """No published part carries a sourced bonus type the catalog has no bucket
    for (#837 audit).

    Such a type forms a bucket of its own, so the crafted affix stacks with every
    native bonus of the same stat instead of competing with the typed ones. That
    is a double-count that looks like a correct loadout. Refuses an empty table
    and an empty type vocabulary.
    """
    if not groups:
        raise EssenceSourceError("no groups — this guard would pass vacuously")
    if not catalog_types:
        raise EssenceSourceError("no catalog types — every minted type would read as strayed")
    for src, dst in BONUS_TYPE_JOIN.items():
        if dst not in catalog_types:
            raise EssenceSourceError(
                f"BONUS_TYPE_JOIN maps {src!r} to {dst!r}, which the catalog no "
                "longer carries — the join would mint a bucket of its own")
    stray = set()
    for menus in groups.values():
        for rows in menus.values():
            for r in rows:
                for p in (r.get("parts") or [r]):
                    if p.get("type_sourced") and p.get("bonus_type") not in catalog_types:
                        stray.add((r.get("effect"), p.get("bonus_type")))
    if stray:
        raise EssenceSourceError(
            f"minted bonus type(s) with no catalog bucket: {sorted(stray)[:8]}. "
            "Each would stack with every native bonus of its stat. Join the "
            "spelling in BONUS_TYPE_JOIN or leave the type unsourced.")
    return {"joined_types": len(BONUS_TYPE_JOIN)}


def build_catalog(catalog_stats=None, wiki_curves=None, catalog_units=None,
                  catalog_types=None) -> dict:
    """The placement catalog, keyed `[group][menu] -> [options]`.

    One option per (recipe, group, menu). A recipe occupies ONE slot whatever it
    grants, so a multi-enchantment recipe is one option carrying `parts` — never
    several options, which would let the solver take half a craft and is the
    fan-out `src/container_registry.py` exists to refuse.

    Three shapes come out, matching what the source distinguishes:

    * **flag** — no enchantments at all (27 recipes: `Deathblock`, `Everbright`,
      `Eternal Faith`). On/off, no type, no magnitude. These are exactly the
      records our own vocabulary already classed presence-only, which is a
      pleasing independent agreement rather than a coincidence.
    * **single** — one enchantment, flattened to the record for the bench.
    * **compound** — several, in `parts`. `Sheltering` grants Magical AND
      Physical Sheltering from one craft.
    """
    recipes = load()
    assert_slot_vocabulary_is_total(recipes)
    stats = set(catalog_stats or ())
    join = stat_join()
    if stats:
        assert_stat_join_is_honest(join, stats, recipes)
    mapping = {k: v["stat"] for k, v in (join.get("joined") or {}).items()}
    quarantined = set(join.get("unmatched") or {})
    wiki_curves = wiki_curves or {}

    groups, coverage = {}, {"recipes": len(recipes), "placements": 0,
                            "flags": 0, "single": 0, "compound": 0,
                            "unrankable": 0, "wiki_magnitude": 0,
                            "umbrella_withheld": 0,
                            "umbrella_only_withheld": 0,
                            "unit_ambiguous_withheld": 0,
                            "type_no_bucket_withheld": 0}
    umbrella_effects = set()
    no_bucket_types = set()
    for r in recipes:
        name = r.get("name")
        ench = r.get("enchantments") or []
        parts = []
        for e in ench:
            curve, unit, min_ml = curve_of(e)
            raw_stat = e.get("name")
            # #837 audit — the UNIT comes from the catalog where the catalog
            # carries the stat, and from the float heuristic only where it does
            # not. The heuristic alone labelled 20 stats `pct` that this catalog
            # stores as plain numbers under `flat` (`Fortification` 146,
            # `Doublestrike` 17), so a crafted affix and a native one for the
            # same stat wore different units over the same number. The old wiki
            # builder read `catalog_units` for exactly this, and its rule is
            # kept: a stat the catalog spells BOTH ways is left unvalued rather
            # than resolved by vote, because a percentage and a flat number in
            # one bucket compare directly.
            _cu = (catalog_units or {}).get(mapping.get(raw_stat, raw_stat))
            if _cu:
                if len(_cu) == 1:
                    unit = next(iter(_cu))
                else:
                    curve, unit = None, None
                    coverage["unit_ambiguous_withheld"] += 1
            # #837 — upstream names the mechanic, this catalog names the affix.
            stat = mapping.get(raw_stat, raw_stat)
            source_bonus = (e.get("bonus") or "").strip() or None
            # #837 audit — a BONUS TYPE is a stacking bucket, and a bucket the
            # catalog does not carry is worse than no type at all: it stacks with
            # everything. yourddo spells the natural-armor bonus `Natural Armor`;
            # the catalog carries 149 affixes typed `Natural` and none typed
            # `Natural Armor`, and the wiki states `Natural`. Joined explicitly.
            # Any other spelling with no catalog bucket is left UNSOURCED and
            # disclosed rather than minted — `Unique` is the one such today —
            # and `assert_every_minted_type_has_a_bucket` fails the build on the
            # next one.
            bonus = BONUS_TYPE_JOIN.get(source_bonus, source_bonus)
            if bonus is not None and catalog_types is not None and bonus not in catalog_types:
                coverage["type_no_bucket_withheld"] += 1
                no_bucket_types.add(bonus)
                bonus = None
            # An UMBRELLA stat is expanded away before anything ranks it, so a
            # placement naming one offers the player a stat no priority can
            # reach (`tests/test_spell_focus.py` walks the whole dataset for
            # exactly this). `Potency` is upstream's only one: it stands for
            # every spell power at once, and the recipes granting it — `Impulse`,
            # `Slaying`, `Potency` — also grant a specific spell power, which it
            # would double-count on top of.
            #
            # Withheld rather than published unrankable, and COUNTED, because
            # the recipe does grant it and dropping it understates that craft.
            if stat and spell_focus.is_universal(stat):
                coverage["umbrella_withheld"] += 1
                umbrella_effects.add(name)
                continue
            # #837 — two wiki rules the new source does not encode, carried
            # over rather than lost with the harvest:
            #
            # `sourced` is the CONJUNCTION the bench reads to mean "this row
            # asks the player for nothing". It is not a third fact; it is the
            # two halves together, and #810 split them deliberately.
            #
            # The ML10 floor on Insight effects is the wiki's: "Effects that
            # grant insight bonuses can be applied to items ML 10 and higher
            # only, regardless of prefix/suffix/extra slot". Upstream stores the
            # RECIPE's own floor, which for `Insightful Charisma` is 1 — taking
            # it verbatim would offer a craft the game refuses.
            floor = min_ml or 1
            if bonus == INSIGHT_BONUS_TYPE:
                floor = max(floor, INSIGHT_MIN_ML)
            part = {"stat": stat, "source_stat": raw_stat,
                    "source_bonus_type": source_bonus,
                    "quarantined": raw_stat in quarantined,
                    "bonus_type": bonus,
                    "type_sourced": bonus is not None,
                    "magnitude_sourced": curve is not None,
                    "sourced": bonus is not None and curve is not None,
                    "unit": unit, "min_ml": floor}
            if curve is not None:
                part["values_by_ml"] = curve
            parts.append(part)

        # The three dice effects keep the wiki's richer magnitude.
        if name in WIKI_MAGNITUDE and name in wiki_curves:
            for part in parts:
                part.update({"values_by_ml": list(wiki_curves[name]),
                             "unit": "dice", "magnitude_sourced": True,
                             "magnitude_from": "ddowiki"})
            coverage["wiki_magnitude"] += 1

        # A recipe whose every enchantment was withheld as an umbrella is NOT an
        # on/off flag — upstream gave it effects and we dropped them. Publishing
        # it as a flag would name the umbrella as the stat, which is the very
        # thing the withholding above is for. It is withheld whole.
        if ench and not parts:
            coverage["umbrella_only_withheld"] += 1
            umbrella_effects.add(name)
            continue
        rankable = (not parts) or any(p["stat"] in stats for p in parts)
        for key, menu in MENUS.items():
            for slot in (r.get(key) or []):
                for group in SLOT_GROUPS[slot]:
                    rec = {"effect": name, "recipe": name, "menu": menu,
                           # The recipe cannot be crafted below the highest
                           # floor any of its enchantments carries.
                           "min_ml": max([r.get("minItemLevel") or 1]
                                         + [p["min_ml"] for p in parts]),
                           "rankable": rankable}
                    if not parts:
                        rec["flag"] = True
                        rec["stat"] = name
                    elif len(parts) == 1:
                        rec.update({k: v for k, v in parts[0].items()
                                    if v is not None})
                    else:
                        rec["parts"] = parts
                        rec["stat"] = parts[0]["stat"]
                    groups.setdefault(group, {}).setdefault(menu, []).append(rec)
                    coverage["placements"] += 1
                    coverage["flags" if not parts else
                             "single" if len(parts) == 1 else "compound"] += 1
                    if not rankable:
                        coverage["unrankable"] += 1

    for group in groups:
        for menu in MENUS.values():
            groups[group].setdefault(menu, [])
            groups[group][menu].sort(key=lambda x: x["effect"])

    if not coverage["placements"]:
        raise EssenceSourceError(
            "refusing to emit an empty placement catalog: 368 recipes produced "
            "no placement, which means the join broke rather than that the game "
            "changed")
    coverage["umbrella_effects"] = sorted(umbrella_effects)
    coverage["type_no_bucket"] = sorted(no_bucket_types)
    if catalog_types is not None:
        assert_every_minted_type_has_a_bucket(groups, catalog_types)
    return {"groups": groups, "coverage": coverage,
            "source": provenance()["source"],
            "source_commit": provenance()["upstream_commit"]}
