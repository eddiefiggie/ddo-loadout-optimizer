"""U1 (#290/#291) — the cross-add map: universal sources that ADD to other stats.

Emitted to the dataset as ``metadata.cross_add`` — ``{target_stat:
[source_stats]}`` — and installed into the web layer by ``web/dataset.js``
(``setCrossAdd`` in ``web/model.js``). This module is data plumbing only:
nothing here credits the solver; that is a later unit reading
``crossAddSourcesFor``.

The contract, and how it differs from ``src/spell_focus.py``'s expansion table:

  * **Expansion** (``spell_focus._UNIVERSAL``) reproduces a wiki DON'T-stack
    rule. A universal affix is rewritten into its concrete stats at the SAME
    bonus type, so the existing per-(stat, stacking-type) bucket collapses a
    universal and a specific source of one type to the highest.
  * **Cross-add** (this map) reproduces a wiki DOES-stack rule. The source stat
    keeps its own name and its own buckets; a consumer SUMS the source's bucket
    totals into the target's total ACROSS buckets — never merging names, never
    competing inside a bucket.

  An entry must never be in both: expansion asserts "collapses with", cross-add
  asserts "adds to", and one name cannot do both. ``validate_map`` fails the
  build on any overlap.

Both families are wiki-evidenced; the sweep dispositions live in
``docs/wiki-evidence/universal-name-sweep.md``.

**Universal Spell Power -> the ten element spellpowers** (#291; full quotes in
``docs/wiki-evidence/spellpower-universal.md`` §3). ``Spell_power``, section
Universal Spell Power:

    Fully stacking. It flat adds to all of your other Spell Powers; in the
    summary screen popup ... the Spell Powers you see for specific elements are
    the final value after your Universal Spell Power has been added to all of
    your other enhancements to that power type.

Expanding USP instead (the ``Potency`` treatment) would put it in
max-competition with same-type element sources the wiki says it adds to — which
is exactly why ``spell_focus`` deliberately excludes it and why the overlap
guard exists.

**Spell Lore + Universal Spell Lore -> the ten element lores** (#290; full
quotes in ``docs/wiki-evidence/spell-lore.md`` §#290). ``Universal_Spell_Lore``:

    Universal Spell Lore is a separate and stacking source of Spell Critical
    chance modifiers. As such an item with a Universal Spell Lore Equipment
    bonus will stack with another item with a Spell Lore or Acid Lore Equipment
    bonus,

**Corrected 2026-08-18 (#366).** That sentence names ``Spell Lore`` and
``Acid Lore`` as two separate things Universal Spell Lore stacks *with* — it does
NOT say those two stack with each other, which is how it was originally read. The
``Spell_Lore`` page lists base Spell Lore as a peer of the element lores
("Spell Lore - all spell types") and states no stacking rule anywhere; neither
does ``Spell_critical``. So base ``Spell Lore`` is a same-type umbrella and now
EXPANDS (``spell_focus._UNIVERSAL``), exactly as ``Potency`` does in the
spellpower channel. Only ``Universal Spell Lore`` cross-adds. The ten targets
are the ``Spell_Lore`` page's "Types of spell lore" roster verbatim. Deliberate
exclusions (recorded in ``spell-lore.md`` §#290 and the sweep doc): the
combined/flavored lores (``Blighted Lore``, ``Purifying Flame Lore``, ...) are
separate multi-element enchantments with no wiki statement tying a universal
name to them, and ``Laceration Lore`` was removed from the game pre-U19.

Lore targets are BOUNDED to the dataset vocabulary at build time: a roster name
the vocabulary does not carry is omitted rather than emitted as a dead key.
The spellpower targets are ``spell_focus.SPELLPOWERS`` — already asserted
present by that family's own machinery — so an absent one here fails the build
instead.
"""
from __future__ import annotations

from src import spell_focus

# Sources per family. The map's VALUES — each names a stat whose bucket totals
# flat-add into the target's total.
SPELLPOWER_SOURCES = ["Universal Spell Power"]
# #366 (2026-08-18) — `Spell Lore` REMOVED. It is a same-type umbrella and moved
# to spell_focus._UNIVERSAL (expansion -> highest-of-type), matching Potency in
# the spellpower channel. Only the wiki-declared "separate and stacking" source
# remains here. The overlap guard in validate_map now enforces the split.
LORE_SOURCES = ["Universal Spell Lore"]

# The Spell_Lore page's "Types of spell lore" roster, verbatim order. Targets
# only — bounded against the built vocabulary in cross_add_map().
LORE_ROSTER = [
    "Acid Lore",
    "Fire Lore",
    "Ice Lore",
    "Lightning Lore",
    "Healing Lore",
    "Kinetic Lore",
    "Radiance Lore",
    "Repair Lore",
    "Sonic Lore",
    "Void Lore",
]


def validate_map(cross_add: dict, known_stats) -> None:
    """Per-channel emission guards (never aggregate — one failure, one message).

    Raises ``SystemExit`` when the map is empty, names a target or source the
    dataset vocabulary does not know, carries a sourceless target, or overlaps
    ``spell_focus``'s expansion table (a name cannot both collapse-with and
    add-to its family).
    """
    if not cross_add:
        raise SystemExit(
            "cross_add guard failed: the emitted map is empty — both families "
            "(spellpower + lore) produced nothing, which means the vocabulary "
            "or the rosters are broken, not that there is nothing to say")
    known = set(known_stats)
    unknown_targets = sorted(t for t in cross_add if t not in known)
    if unknown_targets:
        raise SystemExit(
            "cross_add guard failed: target(s) absent from the dataset's known "
            f"stat names: {unknown_targets}")
    unknown_sources = sorted(
        {s for srcs in cross_add.values() for s in srcs if s not in known})
    if unknown_sources:
        raise SystemExit(
            "cross_add guard failed: source(s) absent from the dataset's known "
            f"stat names: {unknown_sources}")
    sourceless = sorted(t for t, srcs in cross_add.items() if not srcs)
    if sourceless:
        raise SystemExit(
            f"cross_add guard failed: target(s) with no sources: {sourceless}")
    overlap = sorted({
        n for n in list(cross_add) + [s for srcs in cross_add.values() for s in srcs]
        if spell_focus.is_universal(n)})
    if overlap:
        raise SystemExit(
            "cross_add guard failed: name(s) in BOTH the cross_add map and "
            f"spell_focus's expansion table: {overlap} — expansion asserts "
            "don't-stack, cross-add asserts does-stack; one name cannot do both")


def cross_add_map(known_stats) -> dict:
    """Build and validate ``{target_stat: [source_stats]}`` for emission.

    ``known_stats`` is the dataset's affix-name vocabulary. Lore targets are
    bounded to it (an absent roster name is omitted, not emitted dead); every
    NAME the returned map does carry is then validated against it — so an
    absent spellpower target or source still fails the build.
    """
    known = set(known_stats)
    out = {sp: list(SPELLPOWER_SOURCES) for sp in spell_focus.SPELLPOWERS}
    for lore in LORE_ROSTER:
        if lore in known:
            out[lore] = list(LORE_SOURCES)
    validate_map(out, known_stats)
    return out
