"""Essence Crafting option pool for the SOLVER — the Gem of Many Facets' three
menus, and every other host family some catalog item declares a menu on (#193,
#599, #764, #843).

An option here becomes a contribution in a finished loadout, so the bar is the
same three-way gate it has always been. An option is offered only when ALL of:

1. **Placement** — which (family, menu) it can go in.
2. **Bonus type** — which bucket it competes in. Without it a crafted effect
   either double-counts against real gear or wrongly collapses with it.
3. **Magnitude** — the ML curve, read at the host's crafted level by the solver.

#843 — what changed is the SOURCE under that gate, not the gate. Until #843 this
module joined three wiki shards (placement table 1b, the bonus-type harvest, the
curve join) and shipped 38 options, the same 38 after the bench moved to
`veteran-software/yourddo` in #839. The two paths then described one crafting
system from two sources, and the solver's was the thinner by an order of
magnitude. Now both read the one catalog `src/essence_source.build_catalog`
emits — `essence_placements["groups"]`, `[group][menu] -> [rows]` — where every
row already carries `sourced` (type AND curve), the catalog's own unit, the
wiki-wins overrides of #840/#841 and the Insight floor. This module only decides
which rows the SOLVER may see, and says why for each it withholds.

A fourth join is inherited rather than repeated: **effect name to catalog stat**.
`essence_stat_join.json` (#837) already maps upstream's names onto the catalog's
(`False Life` -> `Hit Points`, `Insightful Constitution` -> `Constitution` in the
Insight bucket), and a name it could not join is `quarantined` on the row. The
old exclusion-by-name list this module carried is gone with it: `Natural Armor`
stays out because the join quarantines it, not because a second list says so.

Two classes of row are NOT numeric, and both are handled here rather than skipped
so the solver and the bench agree on what a shard does:

* **Presence.** A stat the catalog carries ONLY as an on/off flag (`Holy`,
  `Anarchic`, every `X Bane`; typed `Bool` on every carrier) is minted as a
  presence option — `bonus_type: "Bool"`, value 1 at every ML — exactly as the
  bench mints it (#838). The row's own type or curve, if it has one, is not
  consulted: real items print `Holy` with no number, the solver buckets it on/off,
  and a numeric 6 in that bucket would rank presence six times over. This is the
  rule the bench applies, applied at build time from the same population
  (`catalog_presence`), and `tests/essence-crafting.test.js` checks the two agree
  record by record with the app's own vocabulary.
* **Compound.** A recipe granting several enchantments (`Sheltering`: Physical
  AND Magical Sheltering from one shard) is ONE option carrying every part in
  its `affixes` list (#844), and the container is ATOMIC (see
  `src/container_registry.py`): the solver takes the shard whole, credits each
  part into its own bucket, and can never take half a craft. A part that fails
  the gate withholds the whole shard, named `compound-<reason>`.

`coverage()` says how much of each menu is offered and why the rest is not,
because a short menu with no explanation reads as the whole menu.
"""
from __future__ import annotations

import re

# #764 — the host families whose menus this pool serves, mapped to their group in
# the placement catalog. EXPLICIT, because the join is not pluralisation: the
# label says `Melee` and the catalog says `Melee weapons`. A `+ "s"` rule passed
# for Trinket and would have silently served Melee nothing.
#
# These four are the families some host actually declares in its `crafting[]`.
# The catalog carries 16 groups; the other 12 describe slots no catalog item
# offers an Essence menu on, so serving them would mint options with no host.
HOST_FAMILIES = {
    "Trinket": "Trinkets",
    "Rune Arm": "Rune Arms",
    "Ring": "Rings",
    "Melee": "Melee weapons",
}

HOST_SLOT_TYPE = "Trinket"          # kept: the family whose menus shipped first
MENUS = ("Prefix", "Suffix", "Extra")
TRINKET_MENUS = MENUS               # back-compat alias for existing callers
_LABEL_RE = re.compile(r"^Essence Crafting: (?P<family>.+?) - (?P<menu>Prefix|Suffix|Extra)$")

INSIGHTFUL_PREFIX = "Insightful "

# Verbatim from the Essence Crafting values table (table 3b), Notes:
#   "Effects that grant insight bonuses can be applied to items ML 10 and higher
#    only, regardless of prefix/suffix/extra slot."
# The heroic Gem is ML 5, so this is not hypothetical — it is the difference
# between offering that Gem nine Insight options and offering it none. The
# catalog applies this floor to every Insight row (`essence_source.INSIGHT_MIN_ML`
# is this constant, carried over); this module ASSERTS it rather than re-applying
# it, so a row that arrived without the floor fails the build instead of passing
# through a second copy of the rule.
INSIGHT_MIN_ML = 10

# A SECOND, separate ML-10 rule, from two other sentences:
#   "Extra enchantment slots are not available on items under minimum level 10."
#       — Essence Crafting, Components
#   "If the item is ML 10 or greater, it has a 'Mark of House Cannith Slot'"
#       — Essence Crafting steps
# That gates the SLOT rather than the effect. Until #843 the two coincided —
# every Extra effect offered happened to be Insight-typed — and were kept apart so
# a non-Insight Extra effect could not arrive and quietly skip the slot rule. One
# has now arrived (`Perform`, Competence, Trinket Extra, recipe floor 1), so the
# slot gate is applied in its own right below, and the test that predicted this
# now asserts it.
EXTRA_SLOT_MIN_ML = 10

# The crafted minimum level is the CRAFTER's choice, not a property the item
# arrives with: "This shard determines the minimum level of the item, the power
# level of scaling effect shards crafted onto the item" (Essence Crafting, Steps).
# Shards exist for ML 1-36.
#
# The solver crafts at min(HOST's ml, the player's ML cap) — #611. Not a search:
# exactly one level is ever considered, and that is correct only because of two
# things that are checked rather than assumed:
#
#   1. Every offered option's ML curve is monotonic non-decreasing and peaks at
#      36, so crafting at the highest reachable level is always optimal. Asserted
#      in tests/test_essence_pool.py. The moment one curve peaks mid-range, the
#      single level has to become a search — that test is the tripwire.
#   2. The highest available level for a named item appears to be its own ML — a
#      Legendary Gem (ML 30) refuses an ML 36 shard. That is a PLAYER OBSERVATION
#      (maintainer, 2026-08-30), NOT a wiki statement; see
#      docs/wiki-evidence/essence-crafting.md for where it was searched for. It is
#      the `min`'s upper argument, so the ceiling is enforced by construction.
#
# The cap is the LOWER argument, and it is what lets a Legendary Gem be worn by a
# character capped below 30: "Scaling effects vary their values when placed in
# lower or higher Minimum Level shard items" (Essence Crafting, Notes). A build
# that crafts a host below its printed ML discloses it rather than assuming it.
#
# Both matter beyond the Gem: the Rune Arm, Ring and Melee hosts are blanks with
# no meaningful native ML, and reading a host record's ml will produce ML 1
# values for an item a player would craft at 34.
MAX_SHARD_ML = 36

# Only hosts whose record is `verified` get live slots. `Trinket [Crafted]` — a
# blank craftable trinket — declares the same three menus but is `quarantined`
# ("no solver-eligible affixes") and carries ML 1, which is a placeholder rather
# than a sourced minimum level. Crafting onto an unverified host would build real
# numbers on a record we do not trust.
REQUIRED_VERIFICATION = "verified"

WIKI_URL = "https://ddowiki.com/page/Essence_Crafting"

# The curve a presence affix carries: present at every ML. The same encoding a
# native on/off affix has (`type: "Bool", value: "1"`) and the same one
# `legendary_green_steel` uses for its flags, stretched to the 36 slots the solver
# indexes by crafted ML.
PRESENCE_CURVE = ["1"] * MAX_SHARD_ML


class PoolError(Exception):
    """The inputs are shaped in a way the pool cannot trust."""


def _stat_name(effect: str) -> str:
    """The catalog stat an effect contributes to.

    `Insightful Constitution` -> `Constitution`. The Insightful part is the BONUS
    TYPE, not the stat, and conflating them would give the crafted effect a
    private bucket that stacks with everything. The catalog does this join itself
    now (`essence_stat_join.json`); kept for the wiki-side readers that still
    spell effects the wiki's way.
    """
    return effect[len(INSIGHTFUL_PREFIX):] if effect.startswith(INSIGHTFUL_PREFIX) else effect


def essence_slots(crafting, verification=None) -> list:
    """The Essence menus a host declares, or [] when it may not have them.

    Reads the same `crafting` labels the compendium already shows the player, so
    the slots the solver fills are exactly the slots the item is documented to
    have.
    """
    if verification is not None and verification != REQUIRED_VERIFICATION:
        return []
    out, seen = [], set()
    for c in crafting or []:
        if not isinstance(c, str):
            continue
        m = _LABEL_RE.match(c)
        if not m:
            continue
        family, menu = m.group("family"), m.group("menu")
        # #764 — the FAMILY rides on the slot, and the option carries the same
        # pair. Without it the solver's join is `menu` alone, and every Essence
        # option is craftable into every Essence host: a Rune Arm would take a
        # Trinket-only effect. The label already states the family; this is where
        # it stops being thrown away.
        if family not in HOST_FAMILIES:
            continue
        key = (family, menu)
        if key in seen:
            continue
        seen.add(key)
        out.append({"menu": menu, "family": family})
    return sorted(out, key=lambda s: (s["family"], MENUS.index(s["menu"])))


def _classify_part(part, stats, presence, floor):
    """`(kind, reason)` for ONE enchantment: `("numeric", None)`,
    `("presence", None)` or `("skip", reason)`.

    Presence is the CATALOG's classification of the stat, consulted before the
    part's own type or curve because those describe the crafted number and the
    catalog ranks the stat on/off; the rest is the three-way gate. `floor` is
    the option's minimum level, below which a null in the curve is allowed.
    """
    stat = part.get("stat")
    if not stat:
        return "skip", "no-stat"
    if part.get("quarantined"):
        return "skip", "stat-unmatched"
    if stat not in stats:
        return "skip", "stat-not-in-catalog"
    if stat in presence:
        return "presence", None
    if not part.get("type_sourced"):
        return "skip", "no-bonus-type"
    if not part.get("magnitude_sourced"):
        return "skip", "no-curve"
    if part.get("unit") == "dice":
        # #835 — a dice magnitude is its own unit. The solver ranks scalars, and
        # the bench discloses these; here they are named rather than parsed.
        return "skip", "dice-magnitude"
    curve = part.get("values_by_ml")
    if not curve or len(curve) != MAX_SHARD_ML:
        return "skip", "malformed-curve"
    # A curve may be EMPTY below the recipe's own floor — `Armor Destroying`
    # exists from ML 20 and yourddo stores null for 1..19 — and the solver never
    # reads those slots because `hostMl >= min_ml` gates the option first. A
    # null AT or ABOVE the floor is a hole the solver would read as 0 and
    # silently credit nothing for: withheld and named.
    if any(v in (None, "") for v in curve[floor - 1:]):
        return "skip", "curve-hole"
    return "numeric", None


def _affix_of(part, kind):
    if kind == "presence":
        return {"stat": part["stat"], "bonus_type": "Bool", "unit": "flat",
                "values_by_ml": list(PRESENCE_CURVE), "presence": True,
                "magnitude_source": None}
    return {"stat": part["stat"], "bonus_type": part["bonus_type"],
            "unit": part.get("unit") or "flat",
            "values_by_ml": list(part["values_by_ml"]), "presence": False,
            "magnitude_source": part.get("magnitude_from") or "yourddo"}


def _classify(row, stats, presence, min_ml):
    """`(kind, reason, affixes)` for one catalog row.

    A row is one craftable OPTION: a flag, a single enchantment, or a compound
    recipe carrying `parts`. Whatever its shape it becomes one record carrying
    an `affixes` list (#844) — never several, which would let the solver take
    half a craft. A compound recipe is offered only when EVERY part clears the
    gate; one failing part withholds the whole shard, named.
    """
    if row.get("flag"):
        stat = row.get("stat")
        if not stat:
            return "skip", "no-stat", []
        if stat not in stats:
            return "skip", "stat-not-in-catalog", []
        # An on/off recipe whose stat the catalog carries WITH magnitudes
        # (`Efficient Metamagic - Empower` is Enhancement-typed on every native
        # carrier). Minting a `Bool` 1 beside those would put a presence and a
        # number in two buckets that add. Never infer a value: withheld.
        if stat not in presence:
            return "skip", "flag-in-a-magnitude-stat", []
        return "presence", None, [_affix_of(row, "presence")]
    parts = row.get("parts") or [row]
    affixes = []
    for part in parts:
        kind, reason = _classify_part(part, stats, presence, min_ml)
        if kind == "skip":
            return "skip", (f"compound-{reason}" if row.get("parts") else reason), []
        affixes.append(_affix_of(part, kind))
    if row.get("parts"):
        return "compound", None, affixes
    return ("presence" if affixes[0]["presence"] else "numeric"), None, affixes


def build_essence_pool(placements, catalog_stats=None, catalog_presence=None,
                       source=None, source_commit=None) -> dict:
    """Every craftable Essence option the catalog fully supports, across every
    host family some catalog item declares a menu on.

    `placements` is `essence_placements["groups"]` — the yourddo catalog after
    `essence_source.build_catalog`, `[group][menu] -> [rows]`. It is a PARAMETER
    rather than rebuilt here so the solver's pool and the bench's picker are
    provably the same rows: `build_dataset.py` builds the catalog once and hands
    it to both.

    `catalog_stats` is the set of affix stat names the built dataset actually
    uses. REQUIRED in the real build: an option naming a stat nothing else uses
    gets a bucket to itself and therefore stacks with every real item, which is
    the double-count the whole bonus-type harvest exists to prevent.

    `catalog_presence` is the subset of those stats the catalog carries ONLY as
    on/off flags — every native carrier typed `Bool`. Parts naming one are minted
    as presence affixes whatever their own type or curve says (see the module
    docstring). Absent, no part is presence and the flags are withheld.

    Every record is ATOMIC (#844): `affixes` carries what the shard grants, one
    entry per enchantment, each with its own type, unit and 36-slot curve. There
    is no record-level stat, because a compound shard has none.
    """
    stats = set(catalog_stats or ())
    presence = set(catalog_presence or ())
    if not isinstance(placements, dict):
        raise PoolError("placements must be the catalog's `groups` mapping")
    missing = [g for g in HOST_FAMILIES.values() if g not in placements]
    if missing:
        raise PoolError(
            f"no placements for {missing}: the placement catalog changed shape")

    records, skipped = [], {}
    for family, group in HOST_FAMILIES.items():
        menus = placements[group]
        for menu in MENUS:
            for row in menus.get(menu, []) or []:
                effect = row.get("effect") or row.get("recipe") or row.get("stat")
                min_ml = int(row.get("min_ml") or 1)
                if menu == "Extra":
                    min_ml = max(min_ml, EXTRA_SLOT_MIN_ML)
                kind, reason, affixes = _classify(row, stats, presence, min_ml)
                if kind == "skip":
                    skipped.setdefault(reason, set()).add(effect)
                    continue
                for a in affixes:
                    if a["bonus_type"] == "Insight" and min_ml < INSIGHT_MIN_ML:
                        raise PoolError(
                            f"{effect} ({family} {menu}) grants an Insight bonus with min_ml "
                            f"{min_ml}: the catalog stopped applying the wiki's ML-10 "
                            "floor and this module does not re-apply it")
                records.append({
                    "family": family,
                    "menu": menu,
                    "effect": effect,
                    "name": f"Essence Crafting: {effect}",
                    # The label the host declares, so a reader can join an option back
                    # to the slot it fills without reconstructing the family name.
                    "slot_label": f"Essence Crafting: {family} - {menu}",
                    # Carried per option rather than derived in the solver: the
                    # Insight floor rides on the row from the catalog, the Extra slot
                    # gate is applied above, and the solver enforces `hostMl >= min_ml`
                    # for both without knowing which rule it is honouring.
                    "min_ml": min_ml,
                    "compound": kind == "compound",
                    "presence": all(a["presence"] for a in affixes),
                    "affixes": affixes,
                    "wiki_url": WIKI_URL,
                })

    if not records:
        raise PoolError(
            "refusing to emit an empty Essence Crafting pool: the catalog produced no "
            "option at all, which means a join broke rather than that the game changed")

    def _n(rows, menu=None):
        return sum(1 for r in rows if menu is None or r["menu"] == menu)

    offered = {m: _n(records, m) for m in MENUS}
    total = {m: sum(len(placements[g].get(m, []) or []) for g in HOST_FAMILIES.values())
             for m in MENUS}
    # #764 — per family as well as per menu. The aggregate alone hid the thing
    # worth seeing: which family is actually empty.
    by_family = {}
    for family, group in HOST_FAMILIES.items():
        fam_recs = [r for r in records if r["family"] == family]
        by_family[family] = {
            "offered": {m: _n(fam_recs, m) for m in MENUS},
            "total": {m: len(placements[group].get(m, []) or []) for m in MENUS},
            "offered_all": len(fam_recs),
            "total_all": sum(len(placements[group].get(m, []) or []) for m in MENUS),
            "presence": sum(1 for r in fam_recs if r["presence"]),
            "compound": sum(1 for r in fam_recs if r["compound"]),
        }
    return {
        "records": records,
        "coverage": {
            "source": source,
            "source_commit": source_commit,
            "offered": offered,
            "total": total,
            "offered_all": len(records),
            "total_all": sum(total.values()),
            "presence": sum(1 for r in records if r["presence"]),
            # #844 — compound shards offered, one record each, and the partially
            # sourced ones withheld whole (reasons prefixed `compound-`).
            "compound": sum(1 for r in records if r["compound"]),
            "compound_withheld": sum(len(v) for k, v in skipped.items() if k.startswith("compound-")),
            "by_family": by_family,
            "skipped": {k: sorted(v) for k, v in skipped.items()},
            "insight_min_ml": INSIGHT_MIN_ML,
            "extra_slot_min_ml": EXTRA_SLOT_MIN_ML,
            "note": ("The four host families some catalog item declares a menu on "
                     "(Trinket, Rune Arm, Ring, Melee), read from the same "
                     "veteran-software/yourddo catalog the item bench uses (#843). "
                     "A shard is offered when its placement, every enchantment's "
                     "bonus type and ML curve are all sourced and every stat is one "
                     "the catalog ranks; a stat the catalog carries only as an on/off "
                     "flag is offered as presence, the way the bench mints it. A "
                     "compound shard (Sheltering: Physical AND Magical Sheltering) is "
                     "one option granting every part at once (#844). Withheld and "
                     "named: names the stat join could not match, enchantments "
                     "missing a type or a curve, dice magnitudes, flags on stats the "
                     "catalog values, and compound shards with any part in those "
                     "states."),
        },
    }
