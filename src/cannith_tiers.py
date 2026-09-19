"""#313 — Cannith Challenge (Vaults of the Artificers) upgrade-tier enchantments.

WHY THIS EXISTS

gear-planner emits NO enchantments for a Vaults item whose wiki page uses the
`Upgradeable - Tier N` layout. It emits only a marker affix — `VotAU` on worn gear,
`Upgradeable - Tier` on weapons — so 97 of the 140 Vaults variants reach the solver
carrying nothing it can score. The reported symptom was "cannith challenge items
don't have any stats" (data/bug_reports.txt, report 2 of the 2026-08-14 batch).

The wiki DOES carry the numbers, laid out as a base tier plus two upgrade tiers
expressed as transitions. This module resolves that layout to the fully-upgraded
state, so the seed can hold the wiki's own text and the pipeline can hold a value.

THE SHAPE, AND WHY IT IS RESOLVED IN CODE RATHER THAN BY HAND

    Upgradeable - Tier 1 / Combustion +110 / Fire Lore +16% / ...
    Upgradeable - Tier 2 / Combustion +110 -> Combustion +116 / Adds Colorless Augment Slot
    Upgradeable - Tier 3 / Combustion +116 -> Combustion +122 / Adds Green Augment Slot

Tier 1 states the base set. Later tiers either REPLACE a line (`A -> B`) or ADD one
(`Adds X`). Resolving 33 items by hand is 33 chances to fat-finger a number that no
reader could ever catch — a wrong stat is indistinguishable from a right one in a
finished loadout. So the seed stores the verbatim `raw` block, this module derives
`final` from it, and `tests/test_cannith_tiers.py` re-derives every entry and fails on
any disagreement. A hand-edited `final` cannot ship.

WHAT IS ADMITTED, AND WHERE THE BONUS TYPE COMES FROM

Exclude-until-verified, applied twice.

First the NAME: an affix is admitted only if its name is already in the built
dataset's affix registry. A name the catalog has never seen is quarantined rather
than minted — this module must not become a side door for new vocabulary.

Then the TYPE, which is the harder half and the reason this is not a two-line script.
The wiki states magnitudes and never bonus types: it writes `Combustion +122`, not
`Combustion +122 Equipment`. A bonus type cannot be guessed — it decides which
stacking bucket the value lands in, so a wrong one either double-counts against a
real source or silently overwrites it, and neither is visible in a finished loadout.

It also cannot be defaulted to one value for the shard, because within this very
family gear-planner assigns several. On the level-3 siblings it parsed successfully:

    Combustion, Fire Lore, Resonance, Sonic Lore, Magnetism,
    Lightning Lore, Corrosion, Acid Lore, Reconstruction, Repair Lore  -> Equipment
    Wizardry, Deception, Seeker                                        -> Enhancement
    Disable Device, Open Lock                                          -> Competence
    Armor Class (via Heightened Awareness)                             -> Insight

So the type is SOURCED, per affix, from the same item family's parsed sibling — the
lower tier gear-planner did read. That is upstream's own answer for that exact stat on
that exact item line, not our opinion about it. An affix with no such sibling is
quarantined: the Mournlode Docent family has no parsed tier at all, so none of its
enchantments can be typed and none are admitted.

AUGMENT SLOTS ARE CAPACITY, NOT AFFIXES (#591)

`Adds Green Augment Slot` is not an enchantment with a bonus type and a magnitude; it
is a host slot, the thing an augment goes INTO. The pipeline already models that as a
per-variant field — `crafting[]` carries `"<Color> Augment Slot"`, `planner_items`
lifts it to `augment_slots`, `colors` normalizes it, and the solver bounds each
colour's augment placements by that supply. So these lines are routed to a third
output, `slots`, as the exact `crafting[]` label, and the overlay appends them to the
record's own `crafting[]` so they travel the identical path a natively-parsed slot
does. They were quarantined here for two weeks as "not an affix", which was true and
was also the wrong question: the 33 worn items gain 40 slots the wiki states outright,
needing no bonus type and no valuation.

Clickie charges and the one ambiguous line are quarantined by their own rules below.
So is any BUNDLED enchantment — `Heightened Awareness`, `Parrying`,
`Riposte`, `Speed` — for a reason worth stating plainly, because the guards that
caught it are the ones that matter most here.

A bundled enchantment's visible cell names the effect and its TOOLTIP carries the
numbers, and this pipeline splits each one into its real components from a per-item
tooltip shard. Admitting `Riposte +5` or `Heightened Awareness 4` folded does not just
under-report — it inserts an instance the splitter has no evidence for, which is
exactly the state `speed_split.check_against_snapshots()` and its three siblings exist
to make impossible. The build guards refused it on the first attempt, correctly. These
names need their own paced tooltip harvest before any of these items can carry them;
until then the folded value is quarantined rather than admitted at face value.
"""
import re

TIER_HEADER = re.compile(r"^Upgradeable - Tier \d+$")
# `A -> B`: B replaces A. The wiki writes it with an arrow; the seed uses ASCII.
TRANSITION = re.compile(r"^(?P<from>.+?)\s*->\s*(?P<to>.+)$")
ADDS = re.compile(r"^Adds\s+(?P<what>.+)$")

# `Name +12%` / `Name +122` / `Name 4` / `+5 Enhancement Bonus`
#
# The `+` is OPTIONAL on the percent form, and that is not cosmetic. Epic Spare Hand's
# tier-3 line is written `Adds Doublestrike 12%` with no sign, and a `+`-requiring
# pattern turned the whole string into a Bool named "Doublestrike 12%" — silently
# dropping 12% Doublestrike, a ranked CORE_STAT, from the best item that grants it.
# A trailing `%` is an unambiguous magnitude marker on its own; the sign adds nothing.
PCT = re.compile(r"^(?P<name>.+?)\s*\+?(?P<v>\d+)%$")
FLAT = re.compile(r"^(?P<name>.+?)\s*\+(?P<v>\d+)$")
BARE = re.compile(r"^(?P<name>[A-Za-z][A-Za-z '()\-]*?)\s+(?P<v>\d+)$")
LEADING = re.compile(r"^\+(?P<v>\d+)\s+(?P<name>.+)$")

AUGMENT_SLOT = re.compile(r"^(Colorless|Green|Purple|Blue|Red|Yellow|Orange)\s+Augment Slot$")

#: #792 — RETIRED. This set named the one slot-qualified affix somebody found by
#: hand and refused it outright, costing 85 admissions, because a 3,325-to-2
#: majority is a pattern and this repo does not rename on a pattern. `join_type`
#: keys the join on the host's own slot instead, which is a reading rather than a
#: pattern and generalizes to affixes nobody has noticed yet. Kept as an empty set
#: only so a stale import fails loudly rather than silently refusing nothing.
SLOT_QUALIFIED_NAMES = frozenset()


def _quarantine(line, reason):
    return {"raw": line, "reason": reason}

def resolve_lines(raw):
    """Apply the tier transitions in order; return the fully-upgraded line set.

    Order is preserved (a dict, not a set) so the output is deterministic and diffs
    stay readable. A transition whose `from` is absent is kept as a plain add rather
    than dropped: the wiki occasionally upgrades a line it never listed, and silently
    discarding it would lose a real stat.
    """
    lines = [s.strip() for s in raw.split(" / ") if s.strip()]
    cur = {}                                   # line -> None, insertion-ordered
    for line in lines:
        if TIER_HEADER.match(line):
            continue
        if line.startswith("BUG:"):            # the wiki's own defect notes
            continue
        m = TRANSITION.match(line)
        if m:
            cur.pop(m.group("from").strip(), None)
            cur[m.group("to").strip()] = None
            continue
        m = ADDS.match(line)
        if m:
            cur[m.group("what").strip()] = None
            continue
        cur[line] = None
    return list(cur)

def parse_line(line):
    """One resolved line -> an affix dict, a slot label, or a quarantine dict.

    Returns `("affix", {...})`, `("slot", "<Color> Augment Slot")` or
    `("quarantine", {...})`. Never guesses: anything
    whose shape is not one of the four numeric forms below becomes a Bool presence,
    and anything ambiguous or non-passive is quarantined.
    """
    if AUGMENT_SLOT.match(line):
        # Not an affix — host capacity. `resolve()` routes it to `slots`; a caller
        # that only wants affixes sees it as a quarantine and drops it, as before.
        return "slot", line
    if "Charges" in line:
        # A clickie is an activated ability with a daily charge budget, not a passive
        # stat. Crediting it as one would report a number the player does not wear.
        return "quarantine", _quarantine(line, "clickie charge, not a passive stat")
    if " or " in line:
        # `Mythic Boot Boost +1 or +3` — the wiki states two values and no rule for
        # which applies. Never infer a value.
        return "quarantine", _quarantine(line, "wiki states two values with no rule for which applies")

    m = PCT.match(line)
    if m:
        return "affix", {"name": m.group("name").strip(), "value": int(m.group("v")), "unit": "percent"}
    m = LEADING.match(line)
    if m:
        return "affix", {"name": m.group("name").strip(), "value": int(m.group("v")), "unit": "flat"}
    m = FLAT.match(line)
    if m:
        return "affix", {"name": m.group("name").strip(), "value": int(m.group("v")), "unit": "flat"}
    m = BARE.match(line)
    if m:
        return "affix", {"name": m.group("name").strip(), "value": int(m.group("v")), "unit": "flat"}
    return "affix", {"name": line, "value": 1, "unit": "bool"}

def resolve_slots(raw):
    """raw block -> the `crafting[]` labels of every augment slot the fully-upgraded
    item carries, in wiki order. `["Colorless Augment Slot", "Green Augment Slot"]`
    for an item whose Tier 2 adds one and Tier 3 the other. The label is emitted
    verbatim because it IS the `crafting[]` vocabulary — `planner_items._augment_slots`
    strips the suffix, `colors.normalize_slots` canonicalizes the colour, and an
    unknown colour is disclosed there rather than guessed here."""
    return [line for line in resolve_lines(raw) if AUGMENT_SLOT.match(line)]

def resolve(raw, known_names=None, bundled_names=()):
    """raw block -> {"affixes": [...], "slots": [...], "quarantined": [...]}.

    `known_names` is the admit gate. When supplied, an affix whose name is not in it
    is quarantined rather than minted — the exclude-until-verified rule, applied so
    this shard can never introduce vocabulary the catalog has not seen elsewhere.

    `slots` is the augment-slot capacity (#591): the `crafting[]` labels, not affixes,
    and never quarantined — they carry no bonus type to source and no value to verify.
    """
    affixes, quarantined = [], []
    slots = resolve_slots(raw)
    for line in resolve_lines(raw):
        kind, payload = parse_line(line)
        if kind == "slot":
            continue
        if kind == "quarantine":
            quarantined.append(payload)
            continue
        if payload["name"] in bundled_names:
            quarantined.append(_quarantine(
                line, f"{payload['name']!r} is a bundled enchantment whose numbers live in its "
                      "tooltip; admitting it folded would insert an instance its split shard "
                      "has no evidence for"))
            continue
        if known_names is not None and payload["name"] not in known_names:
            quarantined.append(_quarantine(line, f"affix name {payload['name']!r} is not in the catalog vocabulary"))
            continue
        affixes.append(payload)
    return {"affixes": affixes, "slots": slots, "quarantined": quarantined}


def sibling_types(records, family_of, aliases=None):
    """canonical affix name + family -> (raw name, bonus type), from the tiers
    gear-planner DID parse.

    Two vocabularies meet here and the join is the whole point. The wiki writes the
    DISPLAY name (`Combustion +122`); gear-planner's raw record writes its own
    (`Fire Spell Power`, `Equipment`, `54`), and the pipeline canonicalizes one to the
    other via `metadata.affix_aliases`. Keying the map on the raw name alone silently
    matches nothing for exactly the stats that matter most here — every elemental
    spell power on every one of these items — so the key is the CANONICAL name and the
    value keeps the raw one.

    Emitting the raw name (not the canonical one) is deliberate: the overlay is applied
    to the native records upstream of normalization, so a raw-vocabulary affix travels
    the identical path a natively-parsed one does. Emitting the canonical name would
    hand normalization a name it has already resolved and make this shard the one
    input that skips a pipeline stage.

    Only records carrying real affixes contribute — a stat-less one has no type to
    lend. When a family's siblings disagree on a name the entry is DROPPED rather than
    picked between, so a genuine upstream inconsistency quarantines the affix instead
    of resolving to whichever record happened to sort first.
    """
    aliases = aliases or {}
    seen, conflict = {}, set()
    for rec in records:
        fam = family_of(rec.get("name") or "")
        for a in rec.get("affixes") or []:
            nm, ty = a.get("name"), a.get("type")
            if nm in ("VotAU", "Upgradeable - Tier") or not ty:
                continue
            key = (aliases.get(nm, nm), fam)
            val = (nm, ty)
            if key in seen and seen[key] != val:
                conflict.add(key)
            seen.setdefault(key, val)
    for k in conflict:
        seen.pop(k, None)
    return seen


_QUALIFIED = re.compile(r"^(?P<base>.+?) \((?P<qual>[^()]+)\)$")

#: The catalog's marker for a debuff. Every affix carrying it is negative.
PENALTY_TYPE = "Penalty"


def assert_penalty_is_negative(records) -> int:
    """#792 — `slot_qualified_types` skips `Penalty` records when deciding whether a
    slot's spelling is unanimous, on the grounds that a debuff is not a competing
    answer for a row stating a bonus. That is only true while every Penalty affix IS
    a debuff.

    Measured 2026-09-19: 39 of 39 negative. Asserted rather than dated, because the
    day a positive Penalty arrives is the day the skip above starts hiding a real
    disagreement — and it would hide it silently, by resolving to the other type.

    Returns the count inspected; refuses to pass over zero.
    """
    seen = 0
    offenders = []
    for rec in records or []:
        for a in rec.get("affixes") or []:
            if a.get("type") != PENALTY_TYPE:
                continue
            seen += 1
            if not str(a.get("value", "")).strip().startswith("-"):
                offenders.append((rec.get("name"), a.get("name"), a.get("value")))
    if not seen:
        raise ValueError(
            "no Penalty-typed affix in the catalog at all — the sign premise behind "
            "slot_qualified_types cannot be checked, so it must not be trusted")
    if offenders:
        raise SystemExit(
            "Penalty-typed affixes that are NOT negative: " + repr(offenders[:5])
            + " — `slot_qualified_types` skips Penalty records as debuffs; a positive "
            "one means that skip is now hiding a real type disagreement")
    return seen


def slot_qualified_types(records, aliases=None):
    """`(bare name, host slot) -> (raw QUALIFIED name, type)`.

    #792 — the type source between the family sibling and the catalog-wide uniform
    type, and the one that fixes a defect the other two cannot see.

    Upstream spells some affixes with a slot qualifier while a wiki row states only
    the bare form. `Enhancement Bonus` is the case that shipped wrong: gear-planner
    carries `(Weapon)` on 3,325 records and `(Armor)` on 1,234, against exactly TWO
    bare ones, both Offhand. The family lookup misses (the siblings carry the
    qualified name), so resolution fell through to `uniform_types` — which does not
    consider slot — and answered with the two-record spelling. Five Mournlode
    Docents shipped it on live ARMOR from #762 until #784 withdrew them.

    THE RULE IS STRUCTURAL, not a slot-to-qualifier table. For a bare name on a host
    in slot `S`, look at the qualified spellings of that name which upstream actually
    carries ON SLOT `S`. Exactly one, with one type there, resolves. Zero or several
    resolves nothing, and the caller falls through as before.

    Deriving it from the records rather than declaring it is what makes it cover
    `(Armor)` on an Offhand host — a shield's enhancement bonus is spelled `(Armor)`
    upstream, which a hand-written `slot -> "(" + slot + ")"` rule would miss and a
    census-of-the-day would freeze. Nothing here is chosen between competing
    answers; ambiguity refuses.
    """
    aliases = aliases or {}
    # (bare, slot) -> {qualified raw name -> {types}}
    seen = {}
    # (bare, slot) where the BARE spelling occurs natively on that same slot.
    #
    # These are the ones that must NOT resolve. A qualifier is only a slot
    # qualifier for a name when the slot uses it instead of the bare form; when the
    # slot carries both, the two are DISTINCT STATS and the parenthesis is part of
    # the name. `False Life` and `False Life (%)` are flat and percentage HP, and
    # Cloak, Necklace, Offhand, Ring and Trinket all carry both — renaming a wiki
    # row's flat `False Life` to the percentage one would be exactly the silent
    # mis-typing this whole function exists to stop, committed in the other
    # direction. Same for `Radiance` / `(enchantment)` on Weapon and
    # `Transmuted Platinum` / `(Epic)`.
    #
    # It also takes out `('Enhancement Bonus', 'Offhand')`: those two bare records
    # ARE the Offhand ones, so that slot genuinely uses the bare spelling and has no
    # business being rewritten to `(Armor)`. Weapon and Armor, the two slots the
    # Cannith rows actually land on, carry no bare form and are unaffected.
    native_bare = set()
    for rec in records:
        slot = rec.get("slot")
        for a in rec.get("affixes") or []:
            nm = a.get("name")
            if nm and not _QUALIFIED.match(nm):
                native_bare.add((aliases.get(nm, nm), slot))
    for rec in records:
        slot = rec.get("slot")
        if not slot:
            continue
        for a in rec.get("affixes") or []:
            nm, ty = a.get("name"), a.get("type")
            if not nm or not ty:
                continue
            # A DEBUFF is not a competing answer for a row stating a bonus.
            # `Enhancement Bonus (Weapon)` carries `Enhancement` on 3,322 records
            # and `Penalty` on 3 — the cursed `-1` weapons — and counting those as
            # disagreement would refuse the whole slot over three curses.
            #
            # Safe because it is CHECKED, not assumed: every Penalty-typed affix in
            # the catalog is negative, 39 of 39, and `assert_penalty_is_negative`
            # fails the build the moment that stops being true. Without that guard
            # this line would be exactly the kind of convenient assumption the
            # provenance model exists to refuse.
            if ty == PENALTY_TYPE:
                continue
            m = _QUALIFIED.match(nm)
            if not m:
                continue
            bare = aliases.get(m.group("base"), m.group("base"))
            seen.setdefault((bare, slot), {}).setdefault(nm, set()).add(ty)
    out = {}
    for key, spellings in seen.items():
        if key in native_bare:
            continue
        if len(spellings) != 1:
            continue                      # two qualified spellings on one slot
        name, types = next(iter(spellings.items()))
        if len(types) != 1:
            continue                      # the spelling itself is not unanimous here
        out[key] = (name, next(iter(types)))
    return out


def uniform_types(records, aliases=None):
    """canonical affix name -> (raw name, type), but ONLY where the catalog is unanimous.

    The second and weaker type source, tried after the family sibling. It admits a name
    only when every single record carrying it agrees on the type, so nothing is chosen
    between competing answers — that would be the inference this repo forbids.

    The split it produces is the evidence that it is safe. Measured over the shipped
    catalog, the presence flags this shard needs are unanimous — `Manslayer`, `Ghostly`,
    `Ethereal`, `Staggering Blow`, `Anthem`, `Air Guard`, `Sonic Guard`,
    `Fire Shield (Hot)`, `Undead Guard` are `Bool` everywhere — while every numeric stat
    it would otherwise reach for carries three competing types:

        Dodge            Enhancement / Insight / Quality
        Fire Absorption  Enhancement / Insight / Quality
        Doublestrike     Enhancement / Insight / Quality
        Use Magic Device Competence  / Insight / Quality

    So this rule hands back the effects whose type was never in question and refuses
    exactly the ones a careless pass would have guessed at — including the 12%
    Doublestrike on Epic Spare Hand, which stays quarantined precisely because it is
    valuable enough that a wrong bucket would matter.
    """
    aliases = aliases or {}
    seen, conflict = {}, set()
    for rec in records:
        for a in rec.get("affixes") or []:
            nm, ty = a.get("name"), a.get("type")
            if not ty or nm in ("VotAU", "Upgradeable - Tier"):
                continue
            key = aliases.get(nm, nm)
            val = (nm, ty)
            if key in seen and seen[key] != val:
                conflict.add(key)
            seen.setdefault(key, val)
    for k in conflict:
        seen.pop(k, None)
    return seen


def join_type(name, slot, fam, slotq, sib, uni):
    """#792 — THE join. One rule, one place, most-specific first.

    A wiki row states a display name and a magnitude; it never states a bonus type,
    so the type is joined from gear-planner. Three keys can answer, and before this
    they were tried in two of the three orders that matter:

    1. `slotq` — (bare name, HOST SLOT). gear-planner spells some affixes per slot:
       `Enhancement Bonus (Weapon)` on 3,325 weapons, `(Armor)` on 1,234, against
       exactly two bare `Enhancement Bonus`, both Offhand. The wiki row for a weapon
       says only "+2 Enhancement Bonus", so this key is the only one that can tell
       which spelling the host actually uses.
    2. `sib` — (name, item family). The item's own other tiers.
    3. `uni` — (name). Catalog-wide, and SLOT-BLIND, which is the defect: asked for
       a weapon's `Enhancement Bonus` it answered with the two-record Offhand
       spelling and named a stat 3,325 weapons do not use.

    Ordering 1 before 3 is what retires `SLOT_QUALIFIED_NAMES`. That set named the
    one affix found by hand and refused it outright — 85 admissions on 80 weapons
    and 5 docents — because a 3,325-to-2 majority is a pattern and this repo does not
    rename on a pattern. A slot-keyed join is not a pattern: it reads the spelling
    from the host's own slot, and it generalizes to the next such affix (`Life
    Shield (Weapon)` is already in the map) without anyone noticing it by hand.

    Returns `(raw name, bonus type, type_source)` or None. The source travels with
    the answer because the shard stores it per affix and
    `test_every_admitted_affix_records_where_its_bonus_type_came_from` re-derives it
    — a type whose provenance is only asserted, never recomputed, is a type nobody
    is checking.
    """
    if slot:
        hit = slotq.get((name, slot))
        if hit:
            return (hit[0], hit[1], f"{slot} slot-qualified spelling")
    hit = sib.get((name, fam))
    if hit:
        return (hit[0], hit[1], f"{fam} family sibling")
    hit = uni.get(name)
    if hit:
        return (hit[0], hit[1], "catalog-wide uniform type")
    return None


def assert_no_bare_slot_qualified(items, slotq):
    """#792 — the property, asserted; not the one name, pinned.

    No entry may emit a BARE affix name onto a host whose slot has a qualified
    spelling for it. That is the defect `SLOT_QUALIFIED_NAMES` was standing in for,
    and stating it this way means the next slot-qualified affix upstream is caught by
    the build instead of by a player reading a loadout that scores nothing.

    Refuses to pass over an empty map or an empty shard — a guard that inspects zero
    records is green for the wrong reason.
    """
    if not slotq:
        raise ValueError("empty slot-qualified map — this guard would pass vacuously")
    if not items:
        raise ValueError("empty shard — this guard would pass vacuously")
    bad = []
    for nm, entry in items.items():
        slot = entry.get("slot")
        if not slot:
            continue
        for a in entry.get("final") or []:
            qualified = slotq.get((a.get("name"), slot))
            if qualified:
                bad.append((nm, slot, a.get("name"), qualified[0]))
    if bad:
        raise SystemExit(
            "entries emitting a bare name onto a slot that spells it qualified: "
            + repr(bad[:5]) + " — join with `join_type`, which keys on the host slot")
    return len(items)
