"""#800 — Essence Crafting COMBINED PREFIX shards: one shard, two effects.

A combined prefix occupies the single prefix slot and grants two effects at once.
That does not contradict the one-per-slot rule #797 sourced — it is still one
shard — but it does mean the #795 bench, which models one EFFECT per menu, could
express only half of what such an item carries.

Three things make this module different from `essence_placements`:

**It is atomic, and that is enforced rather than intended.** A recipe is served
only when BOTH of its effects resolve to a rankable catalog stat. Serving the
half that resolves would hand the player an item granting one effect where the
game grants two, and it is exactly the fan-out shape `src/container_registry.py`
exists to refuse: one option must not become two independently-selectable
records. 78 of 107 recipes clear that bar; the other 29 are withheld whole, with
the reason, rather than served in part.

**Its placement list is its own.** `table 1b` is keyed by one effect and says
nothing about combined shards. The recipe table carries a `Slot` column instead,
in a THIRD vocabulary — singular names (`Weapon`, `Ring`, `Shield`) matching
neither table 1b's plural groups nor the app's slot list. `GROUP_OF_SLOT` below
is that join, written out rather than derived.

**Its `Weapon` is undifferentiated.** The recipe table does not split Melee from
Ranged, so a recipe listing `Weapon` serves both groups. This is the one place
the Melee/Ranged distinction that `essence_placements` refuses to guess does not
arise: the source is not silent here, it is deliberately general.

Bonus types are NOT sourced for these effects, exactly as they are not for most of
`table 1b`. The bench asks the player and discloses the answer as theirs, which is
the same contract #795 already has.

MAGNITUDES ARE, where the name resolves (#812):

    "Scaling effects increase their values when placed in increasingly higher
     minimum level (ML) shard items. Combined Shards ALSO USE THIS SCALING FOR
     THEIR INDIVIDUAL EFFECTS."
        - `Essence Crafting enchantments`, Bonus by level, Notes

This module originally emitted no magnitude at all, and a guard asserted it took
none from the curve join. That guard encoded something true at the time; the
sentence above makes it wrong, so it was updated deliberately rather than
deleted.

The join is reused, NEVER widened. A combined recipe names effects in the recipe
table's own vocabulary, which is not `table 1b`'s roster: `Entropic`, `Anarchic`,
`Acid Absorption` and `Deception` appear here and not there. Only names the
EXISTING mapping already resolves get a magnitude - 51 of 156 instances - and the
rest keep asking the player. Resolving a new vocabulary through a join validated
against a different one is exactly the error `essence_curve_join` exists to
refuse, and its opening example is what that error looks like.
"""
from __future__ import annotations

import json
import os

from src import essence_curve_join as curve_join
from src import spell_focus

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARD = os.path.join(ROOT, "data", "seed", "compendium", "essence_combined_prefixes.json")

#: The menu a combined prefix occupies. It is a PREFIX shard; the name is not
#: decoration and there is no combined suffix or combined extra.
MENU = "Prefix"

#: Prose-sourced, not per-row: the recipe table carries no ML column.
#:
#:   "Update 81 introduced 100 more combined shards with a minimum level of 20.
#:    The old U55 shards now have both Unbound and Bound crafting recipes and are
#:    also now ML20."          - `Essence Crafting`, Combined prefixes
#:
#: So it applies to every row in the table, both waves, and it is a THIRD ML gate
#: alongside the Extra-slot and Insight ones. It gates the OPTION: a combined
#: prefix is simply not craftable below 20, whatever the item or the effect.
MIN_ML = 20

#: Recipe-table slot name -> placement group(s).
#:
#: EXPLICIT, for the same reason `essence_placements.SLOT_GROUPS` is: the join is
#: not pluralisation. `Headgear` is already plural-shaped and `Armor` is not, and
#: a `+ "s"` rule would serve one of them nothing.
#:
#: `Weapon` maps to BOTH weapon groups. The recipe table does not distinguish
#: Melee from Ranged, and that is a statement rather than a silence — unlike
#: `table 1b`, which names the two groups separately and never says which DDO
#: weapon types are in each.
GROUP_OF_SLOT = {
    "Weapon": ["Melee weapons", "Ranged weapons"],
    "Shield": ["Shields"],
    "Orb": ["Orbs"],
    "Armor": ["Armors"],
    "Headgear": ["Headgear"],
    "Belt": ["Belts"],
    "Boots": ["Boots"],
    "Bracers": ["Bracers"],
    "Cloak": ["Cloaks"],
    "Gloves": ["Gloves"],
    "Goggles": ["Goggles"],
    "Necklace": ["Necklaces"],
    "Ring": ["Rings"],
    "Trinket": ["Trinkets"],
}


class CombinedError(RuntimeError):
    pass


def _with_curve(effect, stat, mapping, curves):
    """One half of a combined shard, with its ML curve when the EXISTING join
    already resolves the name.

    A missing curve is not a gap to fill by other means: the recipe table names
    effects `table 1b` does not carry, and those keep asking the player.
    """
    rec = {"effect": effect, "stat": stat, "magnitude_sourced": False}
    entry = mapping.get(effect)
    curve = curves.get(entry["row"]) if entry else None
    if curve and len(curve) == 36:
        rec.update({"magnitude_sourced": True,
                    "values_by_ml": list(curve),
                    "curve_row": entry["row"]})
    return rec


def load(path: str = SHARD) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def assert_slot_join_is_total(recipes, placements) -> int:
    """A completeness claim needs a guard.

    Two directions, and both have cost a defect elsewhere in this repo:

    - a recipe slot the join does not know would silently serve that recipe to
      nobody, which reads as the game offering less than it does;
    - a group the join invents has no placement table behind it, so the bench
      would offer a menu with nothing in it.

    Refuses to pass over an empty input.
    """
    if not recipes:
        raise CombinedError("no recipes — this guard would pass vacuously")
    if not placements:
        raise CombinedError("no placement groups — this guard would pass vacuously")
    seen = {s for r in recipes for s in (r.get("slots") or [])}
    unknown = sorted(seen - set(GROUP_OF_SLOT))
    if unknown:
        raise CombinedError(
            f"recipe slot name(s) the join does not know: {unknown}. Serving them "
            "to nobody would read as the game offering less than it does")
    invented = sorted({g for gs in GROUP_OF_SLOT.values() for g in gs} - set(placements))
    if invented:
        raise CombinedError(
            f"GROUP_OF_SLOT names group(s) the placement table lacks: {invented}")
    return len(seen)


def build_combined_pool(catalog_stats=None, placements=None, curves=None) -> dict:
    """Recipes joined to catalog stats and keyed by placement group.

    `catalog_stats` is REQUIRED in the real build, for the reason it is required
    in `essence_pool`: an effect naming a stat nothing else uses gets a bucket to
    itself and therefore stacks with every real item.

    Name resolution reuses `essence_curve_join._norm`, the repo's existing rule
    for folding case and punctuation. That is deliberate rather than convenient —
    it is what turns the wiki's own `holy Blast` typo into `Holy Blast` and its
    `Armor Piercing` into the catalog's `Armor-Piercing`, without this module
    inventing a second normalisation anybody would have to keep in step.
    """
    data = load()
    recipes = data["recipes"]
    resolved = curve_join.resolve_all()
    mapping = resolved["mapping"]
    # `curves` comes from the CALLER, which already has the crafting shard open.
    # Opening it here would make this a second reader of a file whose readers are
    # a named, tested set (`test_only_the_named_files_read_the_shard`) — a guard
    # that caught exactly this on the first attempt.
    curves = curves or {}
    placements = placements or {}
    assert_slot_join_is_total(recipes, placements)

    lookup = {}
    for name in (catalog_stats or ()):
        lookup.setdefault(curve_join._norm(name), name)

    def resolve(effect):
        hit = lookup.get(curve_join._norm(effect))
        if not hit:
            return None, "not a stat this catalog carries"
        if spell_focus.is_universal(hit):
            # Expanded away before a player sees a picker, so nothing could rank
            # it - the same exclusion `essence_placements` applies.
            return None, "an umbrella stat, expanded away before ranking"
        return hit, None

    served, withheld = [], []
    for r in recipes:
        s1, why1 = resolve(r["effect_1"])
        s2, why2 = resolve(r["effect_2"])
        if not (s1 and s2):
            withheld.append({
                "name": r["name"],
                "effects": [r["effect_1"], r["effect_2"]],
                "reason": (f"{r['effect_1']!r}: {why1}" if why1 else "")
                          + ("; " if why1 and why2 else "")
                          + (f"{r['effect_2']!r}: {why2}" if why2 else ""),
                "atomic": "withheld whole - serving the half that resolves would "
                          "grant one effect where the game grants two",
            })
            continue
        groups = sorted({g for s in r["slots"] for g in GROUP_OF_SLOT[s]})
        served.append({
            "name": r["name"],
            "menu": MENU,
            "min_ml": MIN_ML,
            "groups": groups,
            "effects": [
                _with_curve(r["effect_1"], s1, mapping, curves),
                _with_curve(r["effect_2"], s2, mapping, curves),
            ],
            "update": r.get("update"),
        })

    if not served:
        raise CombinedError(
            "refusing to emit an empty combined pool: 107 recipes produced no "
            "servable one, which means the stat join broke rather than that the "
            "game changed")

    by_group = {}
    for rec in served:
        for g in rec["groups"]:
            by_group.setdefault(g, []).append(rec["name"])

    return {
        "recipes": served,
        "menu": MENU,
        "min_ml": MIN_ML,
        "wiki_url": "https://ddowiki.com/page/Essence_Crafting",
        "coverage": {
            "harvested": len(recipes),
            "served": len(served),
            "withheld": withheld,
            "by_group": {g: len(v) for g, v in sorted(by_group.items())},
            "by_update": {
                str(u): sum(1 for r in served if r.get("update") == u)
                for u in sorted({r.get("update") for r in recipes if r.get("update")})
            },
        },
    }
