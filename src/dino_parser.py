"""U1/U2 — Isle of Dread "Dino crafting" parser (strict wiki provenance).

Dino crafting fills typed slots on Dinosaur Bone items with crafted inserts.
Structurally it is the augment mechanic with a different slot vocabulary, so this
parser mirrors `set_parser` / `colors`: it turns a dedicated, freshly-sourced
seed (``data/seed/dino_crafting.json``) into structured records and QUARANTINES
anything it cannot verify.

Two slot dimensions (KTD1, confirmed from the wiki during M2 sourcing):
  * a **bone type** — Scale / Fang / Claw / Horn, and
  * a **gear category** — Accessory / Armor / Weapon.
A slot accepts only an insert whose ``(category, dino_type)`` both match: a
"Scale (Weapon)" insert fits only a "Scale Slot (Weapon)". The Accessory slice
(shipped first) is the single-category degenerate case (all slots Accessory).

Multi-affix inserts (KTD4). An insert may grant several affixes together (e.g.
"Fang: Deception" = +11 Sneak Attacks AND +17 Sneak Attack Damage). They are
parsed into a single placeable **unit** carrying an ``affixes`` list; the solver
(U4) gives the unit one placement binary that gates every affix all-or-nothing.
A single-affix insert is just a one-element ``affixes`` list, preserving the
Accessory shape.

Strict wiki provenance (KTD5). A unit is solver-eligible only when it carries
  * a canonical ``(category, dino_type)``,
  * a non-empty ``wiki_url``, and
  * at least one ``effect`` clause that resolves to a clean
    ``(stat, bonus_type, value)``.
Typed weapon/armor effects are messy — multi-sentence, with conditionals ("If
this is slotted in a Quarterstaff, it also grants…"), procs, material types, and
bug notes. The clause splitter below rejects any line carrying conditional/flavor
markers and any non-magnitude clause, so a greedy parse never mints a false
affix. Effects are stored VERBATIM; values are parsed here, never hand-structured.
"""
from __future__ import annotations

import re

from src.affix_parser import parse_line
from src import vocabulary
from src.spell_focus import PROVENANCE_KEY, source_label

# The four Isle of Dread Dino bone types. A slot accepts only an insert of its
# own type (a Scale slot takes a Scale insert), exactly like a colored augment
# slot — see src/colors.py for the augment-color analogue.
DINO_TYPES = {"Scale", "Fang", "Claw", "Horn"}

# The gear categories a Dino slot is typed to (KTD1). "Accessory" is the default
# for the original Accessory-slice seed, which carried no explicit category.
DINO_CATEGORIES = {"Accessory", "Armor", "Weapon"}

# A line carrying any of these is CONDITIONAL, PROC, or FLAVOR — not an
# unconditional affix — so the whole line (and every magnitude in it) is dropped
# rather than risk minting a bonus the wiki gates behind a condition or a DOT/
# proc description. Strict provenance: a conditional "+2 to X" is not a
# guaranteed +2 to X, and a "6d6+6 damage every 2 seconds" DOT clause is not a
# "+6" affix. Better to quarantine than to mint a false magnitude.
_LINE_REJECT = re.compile(
    r"\b(if |makes |grants|also |instead|when |chance to|becomes|"
    r"counts as|slotted|on hit|adds|bugged|no benefit|provide no|"
    r"partially|incorporeal|killing blow|over time|per second|"
    r"seconds?|duration|undocumented|stack(s|ing)?)\b|\d+d\d+",
    re.I,
)
# Split a packed line into per-affix clauses at each signed-number that STARTS a
# new value-first clause — a sign+digits followed by a space and a word. So
# "+11 … Sneak Attacks, +17 … Damage" -> two clauses and "…Power+15% Artifact…"
# -> two, while "+30 … Positive, Negative and Repair Amplification" stays one
# (its comma is mid-stat) and a trailing value-last magnitude ("Constitution +7")
# is NOT split off its stat (the +7 is followed by end-of-clause, not a word).
# A single-value affix over comma/and-joined DISTINCT stats is kept as ONE
# compound stat here — deliberately, because comma-splitting would wrongly
# fragment stats whose names contain commas. Reviewed compounds are then split
# into their canonical components by the exact-name _COMPOUND_SPLITS table
# (#293, gear-planner-justified); an UNreviewed compound stays whole and simply
# won't match a target — under-count over fabricating/mis-splitting a stat
# (strict provenance).
_CLAUSE_SPLIT = re.compile(r"(?<=[^+\-\s])\s*(?=[+-]\s?\d+%?\s+\S)")


def _canonical_type(raw):
    """Map a raw slot/insert bone type to a canonical Dino type, or None."""
    text = (raw or "").strip().capitalize()
    return text if text in DINO_TYPES else None


def _canonical_category(raw):
    """Map a raw category to a canonical Dino category. Default Accessory."""
    text = (raw or "").strip().capitalize()
    if not text:
        return "Accessory"
    return text if text in DINO_CATEGORIES else None


# Sentence boundary: a period + space before a capital letter starts a new
# sentence (so a proc appended after an affix — "+250 Unconsciousness Range. You
# heal 20 HP…" — separates). It does NOT fire inside "damage vs. the helpless"
# (the next word is lowercase) or "PRR/MRR" (no period).
_SENTENCE_SPLIT = re.compile(r"\.\s+(?=[A-Z])")


def _effect_clauses(effect):
    """Split a verbatim effect string into candidate affix clauses (strict).

    Newline-split, then sentence-split each line (a proc appended after an affix
    is its own sentence), drop any resulting sentence carrying a conditional /
    proc / flavor marker, then split each surviving sentence at signed-number
    boundaries so a sentence packing several affixes yields one clause each.
    Returns cleaned clause strings; the caller parses each.
    """
    clauses = []
    for line in re.split(r"[\n\r]+", effect or ""):
        for sentence in _SENTENCE_SPLIT.split(line):
            sentence = sentence.strip()
            if not sentence:
                continue
            if _LINE_REJECT.search(sentence):
                continue  # conditional / proc / flavor — never mint an affix from it
            for c in _CLAUSE_SPLIT.split(sentence):
                c = c.strip().strip(",").strip()
                if c:
                    clauses.append(c)
    return clauses


# A lowercase letter directly followed by an uppercase one (no space) is always a
# LOST SEPARATOR in this data — a stat name with flavor text concatenated onto it
# ("Attack and DamageThe Isle of Dread beckons you"). Real DDO stat names are
# space-separated, so truncating at that boundary can only SHORTEN a stat, never
# fabricate one. Guards the deferred set-bonus text (and any future concatenation).
_FLAVOR_BLEED = re.compile(r"[a-z][A-Z]")


def _strip_flavor_bleed(stat):
    """Truncate a parsed stat at a lowercase->uppercase boundary (lost separator)."""
    m = _FLAVOR_BLEED.search(stat or "")
    return stat[: m.start() + 1].strip() if m else stat


# #293 — compound stat names the wiki's Dino tier text packs into ONE clause
# with ONE value that DDO actually grants as SEPARATE per-stat bonuses. The
# clause splitter deliberately keeps them whole (splitting on "and"/commas
# would fragment real single stats — see _CLAUSE_SPLIT), so this exact-name
# table splits the survivors into their canonical components at the same parse
# seam as the synonym fold, one entry per reviewed compound.
#
# EVIDENCE RULE: gear-planner is the repo's single source of truth for item
# affixes, and every entry below is justified by the LIVE gear-planner
# membership set def that states the SAME set bonus pre-split
# (membership_set_defs in the built dataset, sourced structurally from the
# gear-planner catalog). Notable canonicalizations proven there:
#   * the wiki's "Positive … Amplification" is the canonical stat
#     "Healing Amplification" (both amplification carriers — Devotion of the
#     Firemouth and Defender of Tanaroa — store Healing/Negative/Repair);
#   * the wiki's "all Tactical DCs" is the canonical stat "Combat Mastery"
#     (Echoes of the Walking Ancestors stores Combat Mastery + Assassinate);
#   * the wiki's "Attack and Damage" is Accuracy + Deadly (The Legendary
#     Dread Isle's Curse stores Accuracy + Deadly).
# The amplification compound appears in two wiki spellings (with and without
# the Oxford comma); both keys map to the same components. Each component
# copies the source clause's bonus_type/value/unit and is stamped with the
# shared PROVENANCE_KEY (`via`, bonus-type-prefixed like umbrella/spell_focus)
# so a consumer can tell a split-derived affix from a native one; the
# record-level ``raw`` stays verbatim wiki text, exactly like the fold.
_AMPLIFICATION = ["Healing Amplification", "Negative Amplification",
                  "Repair Amplification"]
_COMPOUND_SPLITS = {
    "Melee and Ranged Power": ["Melee Power", "Ranged Power"],
    "Doublestrike and Doubleshot": ["Doublestrike", "Doubleshot"],
    "Positive, Negative and Repair Amplification": list(_AMPLIFICATION),
    "Positive, Negative, and Repair Amplification": list(_AMPLIFICATION),
    "all Tactical DCs and Assassinate": ["Combat Mastery", "Assassinate"],
    "Attack and Damage": ["Accuracy", "Deadly"],
}


def compound_splits() -> dict:
    """Public, read-only copy of the compound-split table (guards/tests)."""
    return {k: list(v) for k, v in _COMPOUND_SPLITS.items()}


def _parse_effect(effect):
    """Parse one verbatim effect into ``(affixes, rejected)``.

    ``affixes`` are clean ``{stat, bonus_type, value, unit}`` (stat normalized,
    trailing period stripped). ``rejected`` records clauses that carried a
    number but did not resolve to a clean affix, so the quarantine is honest.
    """
    folds = vocabulary.registry_synonym_folds()
    affixes, rejected = [], []
    for clause in _effect_clauses(effect):
        r = parse_line(clause)
        if r["kind"] != "affix":
            # Only note clauses that look like they carried a magnitude; pure
            # descriptive fragments left after the split are not "lost affixes".
            if re.search(r"[+-]?\d", clause):
                rejected.append({"raw": clause, "reason": r.get("reason") or f"non-affix ({r['kind']})"})
            continue
        for a in r["affixes"]:
            stat = _strip_flavor_bleed((a["stat"] or "").rstrip(". ").strip())
            # U4 — fold reviewed spelling synonyms to their canonical stat name
            # (e.g. the wiki's "Universal Spellpower" -> "Universal Spell
            # Power"). Applied at the shared parse seam so EVERY dino channel
            # this parser feeds (inserts, typed inserts, set augments) emits
            # canonical stats; `raw` stays verbatim wiki text, mirroring the
            # pipeline's raw/normalized split.
            stat = folds.get(stat, stat)
            if not stat:
                rejected.append({"raw": clause, "reason": "empty stat after normalization"})
                continue
            # #293 — split reviewed compound stats ("Melee and Ranged Power")
            # into their canonical components at the same shared seam as the
            # fold, so EVERY dino channel this parser feeds emits per-stat
            # affixes. Each component copies bonus_type/value/unit and carries
            # the originating compound name under the shared provenance key.
            components = _COMPOUND_SPLITS.get(stat)
            if components:
                label = source_label(stat, a["bonus_type"])
                for comp in components:
                    affixes.append({
                        "stat": comp,
                        "bonus_type": a["bonus_type"],
                        "value": a["value"],
                        "unit": a.get("unit", "flat"),
                        PROVENANCE_KEY: label,
                    })
                continue
            affixes.append({
                "stat": stat,
                "bonus_type": a["bonus_type"],
                "value": a["value"],
                "unit": a.get("unit", "flat"),
            })
    return affixes, rejected


def _insert_unit(category, dino_type, effect, wiki_url, name=None, raid=False):
    """Build one insert unit from a verbatim effect, or a quarantine dict.

    Returns ``(unit, None)`` when at least one affix parses, else
    ``(None, reason)``. A unit with a mix of parseable and garbage clauses keeps
    the parseable affixes and records the dropped clauses in ``quarantined``.
    """
    affixes, rejected = _parse_effect(effect)
    if not affixes:
        return None, "no parseable affix (proc/material/conditional/flavor)"
    unit = {
        "category": category,
        "dino_type": dino_type,
        "affixes": affixes,
        "wiki_url": wiki_url,
        "raw": effect,
    }
    if name:
        unit["name"] = name
    if raid:
        unit["raid"] = True
    if rejected:
        unit["quarantined_clauses"] = rejected
    return unit, None


def parse_inserts(inserts):
    """Parse the ORIGINAL Accessory insert pool into ``(units, quarantined)``.

    Each ``inserts`` entry is ``{type, effect, wiki_url}`` with an implied
    Accessory category. Emitted as insert units (single-affix -> one-element
    ``affixes``), so the Accessory slice and the typed pools share one shape.
    """
    units, quarantined = [], []
    for ins in inserts or []:
        raw = ins.get("effect")
        dino_type = _canonical_type(ins.get("type"))
        wiki_url = (ins.get("wiki_url") or "").strip()
        if dino_type is None:
            quarantined.append({"raw": ins.get("type"), "reason": "unrecognized dino type"})
            continue
        if not wiki_url:
            quarantined.append({"raw": raw, "reason": "missing wiki_url"})
            continue
        unit, reason = _insert_unit("Accessory", dino_type, raw, wiki_url)
        if unit is None:
            quarantined.append({"raw": raw, "reason": reason})
        else:
            units.append(unit)
    return units, quarantined


def parse_typed_inserts(inserts_typed):
    """Parse the typed Weapon/Armor/Raid insert pool into ``(units, quarantined)``.

    Each entry is ``{category, dino_type, name, effect, raid, wiki_url}`` with an
    explicit ``(category, dino_type)`` two-key (KTD1) and possibly multi-affix
    effects (KTD4). Strict gates: canonical category + type, ``wiki_url``, and at
    least one parseable affix.
    """
    units, quarantined = [], []
    for ins in inserts_typed or []:
        raw = ins.get("effect")
        dino_type = _canonical_type(ins.get("dino_type"))
        category = _canonical_category(ins.get("category"))
        wiki_url = (ins.get("wiki_url") or "").strip()
        name = ins.get("name")
        if dino_type is None:
            quarantined.append({"raw": name or raw, "reason": f"unrecognized dino type: {ins.get('dino_type')!r}"})
            continue
        if category is None:
            quarantined.append({"raw": name or raw, "reason": f"unrecognized category: {ins.get('category')!r}"})
            continue
        if not wiki_url:
            quarantined.append({"raw": name or raw, "reason": "missing wiki_url"})
            continue
        unit, reason = _insert_unit(category, dino_type, raw, wiki_url,
                                    name=name, raid=bool(ins.get("raid")))
        if unit is None:
            quarantined.append({"raw": name or raw, "reason": reason})
        else:
            units.append(unit)
    return units, quarantined


def _slot_key(dino_type, category):
    """The ``type||category`` multiset key a slot / insert unit is placed by."""
    return f"{dino_type}||{category}"


def parse_slot_layouts(items):
    """Parse the ORIGINAL Accessory blank layouts into ``(layouts, quarantined)``.

    Each ``items`` entry is ``{item, slot, dino_slots:[{type}], wiki_url}`` with
    an implied Accessory category. ``dino_slots`` becomes a ``type||category``
    multiset (multiplicity preserved — KTD3). A missing ``wiki_url`` quarantines
    the whole item; a non-canonical type is dropped and quarantined.
    """
    layouts, quarantined = [], []
    for it in items or []:
        name = it.get("item")
        wiki_url = (it.get("wiki_url") or "").strip()
        if not wiki_url:
            quarantined.append({"raw": name, "reason": "missing wiki_url"})
            continue
        keys = []
        for slot in it.get("dino_slots") or []:
            raw_type = slot.get("type") if isinstance(slot, dict) else slot
            t = _canonical_type(raw_type)
            if t is None:
                quarantined.append({"raw": name, "reason": f"unrecognized dino slot type: {raw_type!r}"})
            else:
                keys.append(_slot_key(t, "Accessory"))
        layouts.append({
            "item": name,
            "slot": it.get("slot"),
            "dino_slots": keys,
            "set_bonus_slot": False,
            "wiki_url": wiki_url,
        })
    return layouts, quarantined


def parse_crafted_hosts(crafted_hosts, wiki_url):
    """Parse the M2 crafted-host templates into blank layout records.

    Each host is ``{host_category, items:[name…], iod_slots:[{type,category}],
    set_bonus_slot}``. One layout is produced per named host item, carrying its
    ``type||category`` slot multiset and whether it has a Set-Bonus slot. A host
    with no explicit item names (e.g. "Weapons: all weapon types") yields one
    generic layout named for the category. Non-canonical slot types quarantine.
    """
    layouts, quarantined = [], []
    for host in crafted_hosts or []:
        keys = []
        for slot in host.get("iod_slots") or []:
            t = _canonical_type(slot.get("type"))
            c = _canonical_category(slot.get("category"))
            if t is None or c is None:
                quarantined.append({"raw": host.get("host_category"),
                                    "reason": f"bad crafted-host slot: {slot!r}"})
            else:
                keys.append(_slot_key(t, c))
        names = host.get("items") or [host.get("host_category")]
        for name in names:
            layouts.append({
                "host_category": host.get("host_category"),
                "item": name,
                "dino_slots": list(keys),
                "set_bonus_slot": bool(host.get("set_bonus_slot")),
                "wiki_url": wiki_url,
            })
    return layouts, quarantined


def parse_set_augments(set_augments):
    """Parse Dino Set-Bonus augment definitions into structured set tiers.

    Each entry is ``{name, set_name, threshold, tier_text, wiki_url}`` where
    ``tier_text`` is the concatenated, separator-less clause blob the wiki
    renders. Returns ``[{set, pieces_required, affixes, flagged, wiki_url,
    raw}]`` — the same shape ``set_parser.parse_set_bonuses`` emits, so the set
    machinery can consume Dino sets unchanged once wired (deferred; see
    coverage disclosure).
    """
    out = []
    for s in set_augments or []:
        name = s.get("set_name") or s.get("name")
        # U4 — the synonym fold to canonical stat names happens inside
        # _parse_effect (the shared parse seam), so this channel's `stat`
        # fields arrive already canonical.
        affixes, flagged = _parse_effect(s.get("tier_text"))
        out.append({
            "set": name,
            "pieces_required": s.get("threshold"),
            "affixes": affixes,
            "flagged": flagged,
            "wiki_url": (s.get("wiki_url") or "").strip(),
            "raw": s.get("tier_text"),
        })
    return out


def check_set_records_spelling(set_records):
    """Per-channel spelling guard for the ``dino_sets`` channel (U4).

    Every normalized ``stat`` in the channel must be canonical — none may appear
    as a fold-away SYNONYM key in the frozen affix-synonym registry (that is how
    "Universal Spellpower" survived here while every live channel spelled it
    "Universal Spell Power"). Refuses to vouch for an empty channel: zero set
    records or zero affixes is a guard FAILURE, never a pass (per-channel, never
    vouched for by a sibling — see
    docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md).
    ``raw`` text is deliberately NOT inspected: it is verbatim wiki provenance
    and keeps the original spelling. Returns the number of affixes inspected."""
    if not set_records:
        raise ValueError(
            "dino_sets spelling guard: zero set records — an empty channel is a "
            "guard failure, not a pass")
    folds = vocabulary.registry_synonym_folds()
    checked = 0
    for rec in set_records:
        for a in rec.get("affixes") or []:
            stat = a.get("stat")
            if stat in folds:
                raise ValueError(
                    f"dino_sets spelling guard: set {rec.get('set')!r} carries "
                    f"fold-away synonym {stat!r} (canonical: {folds[stat]!r}) — "
                    f"the parse-time synonym fold did not run or the registry "
                    f"grew a new fold this channel never applied")
            checked += 1
    if checked == 0:
        raise ValueError(
            "dino_sets spelling guard: set records carry zero affixes — an "
            "affix-less channel is a guard failure, not a pass")
    return checked


def check_set_records_expanded(set_records):
    """Per-channel expansion guard for the ``dino_sets`` channel (#293).

    Runs AFTER the build applies the umbrella + spell-focus expansions to the
    channel (unlike :func:`check_set_records_spelling`, which is also valid on
    freshly parsed records). Every normalized ``stat`` must be a concrete,
    rankable name:

      * no umbrella / universal EXPANDED-AWAY name may survive ("Well
        Rounded", "Spell Focus Mastery", …) — a survivor means an expansion
        pass never ran over this channel, which is exactly how "Well Rounded"
        shipped unexpanded here while every live channel expanded it;
      * no key of the compound-split table may survive ("Melee and Ranged
        Power", …) — a survivor means the parse-time split did not run or the
        table grew a spelling this channel never applied.

    Refuses to vouch for an empty channel: zero set records or zero affixes is
    a guard FAILURE, never a pass (per-channel, never vouched for by a sibling
    — see docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md).
    ``raw`` is verbatim wiki provenance and deliberately not inspected.
    Returns the number of affixes inspected."""
    from src import umbrella as umbrella_mod
    from src import spell_focus as spell_focus_mod
    if not set_records:
        raise ValueError(
            "dino_sets expansion guard: zero set records — an empty channel is "
            "a guard failure, not a pass")
    checked = 0
    for rec in set_records:
        for a in rec.get("affixes") or []:
            stat = a.get("stat")
            if umbrella_mod.is_umbrella(stat) or spell_focus_mod.is_universal(stat):
                raise ValueError(
                    f"dino_sets expansion guard: set {rec.get('set')!r} carries "
                    f"expanded-away name {stat!r} unexpanded — the umbrella/"
                    f"spell-focus expansion did not run over this channel")
            if stat in _COMPOUND_SPLITS:
                raise ValueError(
                    f"dino_sets expansion guard: set {rec.get('set')!r} carries "
                    f"unsplit compound {stat!r} (components: "
                    f"{_COMPOUND_SPLITS[stat]}) — the parse-time compound split "
                    f"did not run over this channel")
            checked += 1
    if checked == 0:
        raise ValueError(
            "dino_sets expansion guard: set records carry zero affixes — an "
            "affix-less channel is a guard failure, not a pass")
    return checked


def parse_dino_crafting(seed):
    """Parse a ``dino_crafting`` seed dict into structured records + coverage.

    Handles both the original Accessory keys (``items``, ``inserts``) and the M2
    typed keys (``inserts_typed``, ``crafted_hosts``, ``set_augments``). Returns
    ``{slot_layouts, insert_records, set_records, quarantined, coverage}``.
    """
    seed = seed or {}
    page = ((seed.get("metadata") or {}).get("source_pages") or ["https://ddowiki.com/page/Dinosaur_Bone_crafting"])[0]

    acc_layouts, acc_item_q = parse_slot_layouts(seed.get("items"))
    host_layouts, host_q = parse_crafted_hosts(seed.get("crafted_hosts"), page)
    layouts = acc_layouts + host_layouts

    acc_units, acc_ins_q = parse_inserts(seed.get("inserts"))
    typed_units, typed_ins_q = parse_typed_inserts(seed.get("inserts_typed"))
    records = acc_units + typed_units

    set_records = parse_set_augments(seed.get("set_augments"))

    by_key = {}
    for r in records:
        by_key[_slot_key(r["dino_type"], r["category"])] = by_key.get(_slot_key(r["dino_type"], r["category"]), 0) + 1

    coverage = {
        "items_sourced": len(layouts),
        "inserts_eligible": len(records),
        "inserts_quarantined": len(acc_ins_q) + len(typed_ins_q),
        "items_quarantined": len(acc_item_q) + len(host_q),
        "by_type": {t: sum(1 for r in records if r["dino_type"] == t) for t in sorted(DINO_TYPES)},
        "by_key": dict(sorted(by_key.items())),
        "set_records": len(set_records),
    }
    return {
        "slot_layouts": layouts,
        "insert_records": records,
        "set_records": set_records,
        "quarantined": {"inserts": acc_ins_q + typed_ins_q, "items": acc_item_q + host_q},
        "coverage": coverage,
    }
