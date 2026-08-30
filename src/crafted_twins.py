"""#547 — the `[Crafted]` twin: one game item the catalog carries as two records.

A player blocked `Legendary Gem of Many Facets`, solved again, and got
`Legendary Gem of Many Facets [Crafted]` in the same slot with a byte-identical
`perTarget`. Same name, same numbers, and the block disclosure truthfully
reporting an exclusion — the block read as ignored.

The blocklist was not wrong. The catalog carries **one item in two states**:

  * the base record — the item as it drops, carrying a `Craftable <thing>` marker
    affix;
  * the `[Crafted]` record — the same item AFTER its Essence Crafting slots are
    used, which drops that marker and gains the `Essence Crafting: *` slot menus.

Those slots WERE all inert when this was written, because Essence Crafting was
unmodelled (#193). Three no longer are: `Essence Crafting: Trinket - Prefix /
Suffix / Extra` are served by the `essence_crafting` pool, so the four Trinket
hosts — the three Gem of Many Facets tiers and the blank craftable trinket — now
gain real capacity when crafted and can beat their own base. Every other
`Essence Crafting: *` label (Melee, Ring, Rune Arm) is still unserved.

That does NOT dissolve the pairing, because the pairing answers a different
question — see the self-retiring clause in `derive` for why. For the still-inert
majority the crafted state remains a strict affix-SUBSET of the base with nothing
gained, it can never beat its own base, and `dominanceFilter` prunes it — right
up until the base is blocked.
The blocklist deliberately runs UPSTREAM of dominance so that blocking a winner
leaves the genuine runner-up standing, and here the "runner-up" is the same item
under a different name.

**This module does not suppress anything.** It derives the identity a player
means when they block one of these, so `web/model.js` can treat a block on either
name as a block on the item. Candidacy, pins, browse and the exports are all left
alone: the crafted record is still a real thing to look at, and the day #193
models Essence Crafting it becomes a real thing to solve for.

WHY THE IDENTITY IS DERIVED AND ASSERTED RATHER THAN MATCHED ON THE NAME. A bare
` [Crafted]` suffix test in the solver would be a string heuristic sitting in the
one place this project cannot afford one, and it would keep passing after the
relationship it assumes stops being true. So the pairing is derived here, against
the catalog, and every pair must still satisfy the property that makes collapsing
them correct:

  * the base exists;
  * the two agree on every solver-relevant field;
  * the crafted record's affixes are a SUBSET of the base's;
  * every crafting label the crafted record adds is one nothing serves.

A pair that fails any of the first three FAILS THE BUILD, naming the record.

The fourth is the self-retiring half, and it has now fired (#193). It is recorded
as `capacity_divergent` rather than raised, because it turned out to be the wrong
trigger for THIS identity: block-folding is about one game item, not about two
interchangeable offers. The reasoning is at the clause itself. The pairs it names
are surfaced in `metadata.crafted_twin_identity_divergent` so the change is
visible rather than absorbed.
"""
from __future__ import annotations

SUFFIX = " [Crafted]"

# Fields that decide whether two records are interchangeable to the SOLVER. If
# the pair agrees on all of these and the crafted one adds no affix and no served
# crafting label, a block on either is a block on the same thing.
#
# `crafting` is deliberately NOT here — it is the one field the two are SUPPOSED
# to differ on, and the difference is checked separately (and more strictly) by
# the served-label clause below.
_IDENTITY_FIELDS = ("slot", "category", "type", "artifact", "armor_type")


def _name(rec):
    return rec.get("source_item") or rec.get("variant_id") or ""


def _affix_multiset(rec):
    out = {}
    for a in rec.get("affixes") or []:
        k = (a.get("name"), a.get("type"), str(a.get("value")))
        out[k] = out.get(k, 0) + 1
    return out


def _colors(rec):
    norm = rec.get("augment_slots_norm") or {}
    return tuple(sorted(norm.get("colors") or []))


def _sets(rec):
    return tuple(sorted(rec.get("sets") or []))


def _jokers(rec):
    return tuple(tuple(sorted(g)) for g in (rec.get("joker_set_groups") or []))


def _ml(rec):
    return rec.get("ml") if rec.get("ml") is not None else rec.get("minimum_level")


def derive(variants, unserved_labels) -> dict:
    """Map every `X [Crafted]` and its base `X` onto one identity.

    Returns `{"identity": {name: identity}, "pairs": [(crafted, base)],
    "inspected": n, "problems": [...]}`. `identity` carries BOTH members of each
    pair, each mapped to the base name, so a lookup never has to know which side
    it is holding. Records in no pair are absent — the consumer treats a miss as
    "this record is only itself", which is the correct reading for 9,020 of them.

    `unserved_labels` is the set of crafting labels nothing serves, passed in
    rather than imported so the caller owns the one definition
    (`crafting_coverage.UNSERVED_ALLOWLIST`) and this module cannot drift into
    holding a second copy of it.

    Problems are RETURNED, not raised, so the caller can report every broken pair
    at once instead of one per build.
    """
    by_name = {}
    for v in variants or []:
        by_name.setdefault(_name(v), []).append(v)

    identity = {}
    pairs = []
    problems = []
    capacity_divergent = []
    inspected = 0

    for name in sorted(by_name):
        if not name.endswith(SUFFIX):
            continue
        inspected += 1
        base_name = name[: -len(SUFFIX)]

        base_recs = by_name.get(base_name)
        if not base_recs:
            problems.append(
                f"{name!r} has no base record {base_name!r} — the crafted state is "
                "orphaned, so nothing establishes it is the same item")
            continue

        # One variant each today. More than one would mean the pairing is no
        # longer name-to-name and the identity needs a variant-level key, which
        # is a design change rather than something to guess at here.
        if len(base_recs) != 1 or len(by_name[name]) != 1:
            problems.append(
                f"{base_name!r} now expands into multiple variants "
                f"({len(base_recs)} base, {len(by_name[name])} crafted) — the "
                "name-to-name identity no longer addresses one record")
            continue

        base, crafted = base_recs[0], by_name[name][0]

        for field in _IDENTITY_FIELDS:
            if base.get(field) != crafted.get(field):
                problems.append(
                    f"{name!r} and its base disagree on {field!r} "
                    f"({crafted.get(field)!r} vs {base.get(field)!r}) — they are "
                    "not interchangeable, so one block must not cover both")
        if _ml(base) != _ml(crafted):
            problems.append(
                f"{name!r} and its base disagree on minimum level "
                f"({_ml(crafted)!r} vs {_ml(base)!r})")
        for label, a, b in (("augment colours", _colors(crafted), _colors(base)),
                            ("set membership", _sets(crafted), _sets(base)),
                            ("joker set groups", _jokers(crafted), _jokers(base))):
            if a != b:
                problems.append(
                    f"{name!r} and its base disagree on {label} ({a!r} vs {b!r})")

        # The crafted state must add no affix. It is the same item after using
        # slots the solver cannot use, so anything it carries that the base does
        # not is value a block would now be wrongly folding away.
        extra = {k: n for k, n in _affix_multiset(crafted).items()
                 if n > _affix_multiset(base).get(k, 0)}
        if extra:
            problems.append(
                f"{name!r} carries affixes its base does not ({sorted(extra)!r}) — "
                "it is no longer a strict subset, so it is not the same offer")

        # The self-retiring clause, RECONSIDERED (#193 wired Essence Crafting for
        # Trinkets). It used to fail the build. It now records the pair as
        # capacity-divergent and keeps the block identity, because the clause
        # conflated two different questions and only one of them changed:
        #
        #   "are these interchangeable to the SOLVER?"  -> no longer. The crafted
        #       Gem carries three craftable menus its base does not, so it can beat
        #       its own base and must stay a distinct candidate. Nothing here
        #       suppressed that: this module never touched candidacy or dominance.
        #   "are these ONE GAME ITEM to the player?"    -> still yes, and that is
        #       the only question `block_identity` answers. A player blocking the
        #       Gem does not own it, and does not own the version they would have
        #       crafted from it either. Dropping the fold here would hand them the
        #       twin — the exact #547 report.
        #
        # So a served added label is expected for these pairs, and only for these:
        # it is recorded and surfaced, never silently absorbed. Every other clause
        # above still FAILS the build.
        added = [c for c in (crafted.get("crafting") or [])
                 if c not in (base.get("crafting") or [])]
        served = [c for c in added if c not in unserved_labels]
        if served:
            capacity_divergent.append({"crafted": name, "base": base_name,
                                       "served_labels": sorted(served)})

        identity[name] = base_name
        identity[base_name] = base_name
        pairs.append((name, base_name))

    return {"identity": identity, "pairs": pairs, "inspected": inspected,
            "problems": problems, "capacity_divergent": capacity_divergent}
