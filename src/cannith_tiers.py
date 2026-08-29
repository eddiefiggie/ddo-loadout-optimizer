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

Augment slots, clickie charges, and the one ambiguous line are quarantined by their
own rules below. So is any BUNDLED enchantment — `Heightened Awareness`, `Parrying`,
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
    """One resolved line -> an affix dict, or a quarantine dict.

    Returns `("affix", {...})` or `("quarantine", {...})`. Never guesses: anything
    whose shape is not one of the four numeric forms below becomes a Bool presence,
    and anything ambiguous or non-passive is quarantined.
    """
    if AUGMENT_SLOT.match(line):
        return "quarantine", _quarantine(line, "augment slot, not an affix")
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

def resolve(raw, known_names=None, bundled_names=()):
    """raw block -> {"affixes": [...], "quarantined": [...]}.

    `known_names` is the admit gate. When supplied, an affix whose name is not in it
    is quarantined rather than minted — the exclude-until-verified rule, applied so
    this shard can never introduce vocabulary the catalog has not seen elsewhere.
    """
    affixes, quarantined = [], []
    for line in resolve_lines(raw):
        kind, payload = parse_line(line)
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
    return {"affixes": affixes, "quarantined": quarantined}


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
