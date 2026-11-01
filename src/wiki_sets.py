"""#908 — set definitions read from our own wiki harvest (own item harvest, #911).

Two wiki sources state set bonuses (docs/wiki-evidence/named-item-sets-structure.md):

  * `Template:Named item sets` — a `#switch` of one entry per set, already split
    by tier, each a `<br />`-joined run of `N Pieces Equipped:` headers and
    bonus lines, closed by `{{#vardefine:set|<display name>}}`.
  * `Named item sets` — wikitable rows of set name, items and bonus cell. A row
    can bundle Heroic / Epic / Legendary values in `{{HELstats}}`, and its anchor
    names at most one of the tiers it describes.

This module turns both into the same shape — per set, per piece threshold, the
bonus lines as plain text — and stops there. Reading a line into a typed affix is
`read_clause`, a closed grammar: a line it does not recognise is quarantined with
a reason, never defaulted. Gear-planner's set catalog stays the build's source
until the parity diff (`scripts/diff_harvest_sets.py`) shows ours-wrong = 0.

NEVER INFER. Two specific temptations this module refuses:
  * A row with no explicit piece header or reviewed prose count has no stated
    threshold, even when its item list has N entries. `threshold` is None and
    the diff reports it.
  * A `HELstats` row's Legendary half has no anchor of its own. Its name is not
    invented (`Legendary <anchor>` is the obvious guess, and it is a guess); the
    row is keyed by its anchor plus the tier the template code assigns.
"""
from __future__ import annotations

import re

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)

# Template:HELstats rev 673386 (2026-02-01), the whole <onlyinclude> body, per tier:
#   {{#if: {{{1|}}} | <Heroic {{{1}}}> | {{#if: {{{H|}}} | <Heroic {{{H}}}> | }}}}
#   {{#if: {{{2|}}} | <Epic {{{2}}}>   | {{#if: {{{E|}}} | <Epic {{{E}}}>   | }}}}
#   {{#if: {{{3|}}} | <Legendary {{{3}}}> | {{#if: {{{L|}}} | <Legendary {{{L}}}> | }}}}
# A positional argument wins over its named one; an empty tier renders nothing.
HELSTATS_TIERS = (("Heroic", "1", "H"), ("Epic", "2", "E"), ("Legendary", "3", "L"))
HELSTATS_REVID = 673386
_HELSTATS_RE = re.compile(r"\{\{\s*HELstats\s*\|([^{}]*)\}\}")

# "3 Pieces Equipped:" alone on a line, or heading the line's first clause
# ("2 Pieces Equipped: +2 Artifact Bonus to Strength", "5 Pieces Equipped - {{…}}").
_PIECES_RE = re.compile(r"^\s*(\d+)\s+Pieces?\s+Equipped\s*[:\-]\s*(.*)$", re.I)
_ANCHOR_RE = re.compile(r"\{\{\s*Anchor\s*\|([^{}|]*)\}\}")
_VARDEFINE_RE = re.compile(r"\{\{\s*#vardefine\s*:\s*set\s*\|([^{}]*)\}\}")
_LINK_RE = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]")

# Template:Artifact rev 674392 (2026-02-07) is cell styling and nothing else:
#   class="bg-color-1" style="background-color:#ebe0a4;" |
# It opens 122 bonus cells on the page and states no bonus, so it is removed
# before the cell is read rather than left as a line with no threshold.
CELL_STYLE_TEMPLATES = ("Artifact",)
_CELL_STYLE_RE = re.compile(r"\{\{\s*(?:%s)\s*\}\}" % "|".join(CELL_STYLE_TEMPLATES))


def _args(argtext: str) -> tuple[list, dict]:
    pos, named = [], {}
    for a in argtext.split("|"):
        if "=" in a:
            k, _, v = a.partition("=")
            named[k.strip()] = v.strip()
        else:
            pos.append(a.strip())
    return pos, named


def helstats_value(argtext: str, tier: str):
    """The value one `{{HELstats|…}}` call renders at `tier`, or None (renders nothing)."""
    pos, named = _args(argtext)
    for name, p, n in HELSTATS_TIERS:
        if name == tier:
            i = int(p) - 1
            v = pos[i] if i < len(pos) and pos[i] else named.get(n, "")
            return v or None
    raise ValueError(f"unknown HELstats tier {tier!r}")


def helstats_tiers(text: str) -> list:
    """The tiers any `HELstats` call in `text` renders, in Heroic/Epic/Legendary order."""
    calls = [m.group(1) for m in _HELSTATS_RE.finditer(text)]
    return [t for t, _, _ in HELSTATS_TIERS if any(helstats_value(c, t) for c in calls)]


def expand_helstats(line: str, tier: str):
    """`line` with every HELstats call replaced by its `tier` value, or None when a
    call in it states no value at that tier (the clause does not exist there)."""
    missing = []

    def sub(m):
        v = helstats_value(m.group(1), tier)
        if v is None:
            missing.append(m.group(0))
            return ""
        return v

    out = _HELSTATS_RE.sub(sub, line)
    return None if missing else out


def plain(line: str) -> str:
    """Wiki markup -> the text a reader sees: links to their label, bold/italic
    quotes and HTML tags dropped. Templates are left in place — expanding one is
    reading it, and that is `read_clause`'s job, not a cleanup."""
    s = COMMENT_RE.sub("", line)
    s = _LINK_RE.sub(lambda m: m.group(1), s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"^\s*\*+\s*", "", s)
    return re.sub(r"\s+", " ", s).strip()


# #952 — exact prose prefixes from Template:Named item sets rev 723530.
# Each count is stated in the prefix itself; set names are part of the match so
# new or conditional wording cannot silently broaden the grammar. Strip only
# these prefixes and preserve the remaining markup for read_clause. Evidence and
# deliberately unsupported forms: docs/wiki-evidence/named-item-sets-structure.md.
PROSE_PIECE_HEADERS = {
    'This item is one of the two pieces of the Air Savant set. When both items are equipped, you gain a ': 2,
    'This item is one of the two pieces of the Archmage set. When both items are equipped, you gain a ': 2,
    'This item is one of the two pieces of the Earth Savant set. When both items are equipped, you gain a ': 2,
    'This item is one of the two pieces of the Fire Savant set. When both items are equipped, you gain a ': 2,
    'This item is one of the two pieces of the Water Savant set. When both items are equipped, you gain a ': 2,
    'When all three items from the set are equipped, you will gain a ': 3,
    "While wearing any five items from the Epic The Devil's Handiwork, you gain:": 5,
    "While wearing any five items from the The Devil's Handiwork, you gain:": 5,
    'While wearing both items from the Brilliant Crescents set, you gain:': 2,
    "While wearing both items from the Captain's Set, you gain:": 2,
    'While wearing both items from the Double Helix Set, you gain:': 2,
    "While wearing both items from the Epic Captain's Set, you gain:": 2,
    'While wearing both items from the Epic Double Helix Set, you gain:': 2,
    'While wearing both items from the Epic Griffon Set, you gain:': 2,
    "While wearing both items from the Epic Slice 'n Dice Set, you gain:": 2,
    'While wearing both items from the Griffon Set, you gain:': 2,
    'While wearing both items from the Mountainskin Set, you gain:': 2,
    "While wearing both items from the Slice 'n Dice Set, you gain:": 2,
    'While wearing three items from the Arcsteel Battlemage set, you gain:': 3,
    'While wearing three items from the Dreadkeeper set, you gain:': 3,
    'While wearing three items from the Esoteric Initiate set, you gain:': 3,
    'While wearing three items from the Feywild Dreamer set, you gain:': 3,
    'While wearing three items from the Flamecleansed Fury set, you gain:': 3,
    'While wearing three items from the Guardian of the Gates set, you gain:': 3,
    "While wearing three items from the Hruit's Influence set, you gain:": 3,
    'While wearing three items from the Part of the Family set, you gain:': 3,
    'While wearing three items from the Wallwatch set, you gain:': 3,
    'While wearing two pieces from the Anger of the Avalanche set, you gain:': 2,
    'While wearing two pieces from the Astute Alchemist set, you gain:': 2,
    'While wearing two pieces from the Chained Elemental set, you gain:': 2,
    'While wearing two pieces from the Conduit of the Titans set, you gain:': 2,
    'While wearing two pieces from the Fastidious Fabricator set, you gain:': 2,
    'While wearing two pieces from the Legacy of Levikk set, you gain:': 2,
    'While wearing two pieces from the Legacy of Lorikk set, you gain:': 2,
    'While wearing two pieces from the Legacy of Tharne set, you gain:': 2,
    'While wearing two pieces from the Mantle of Suulomades set, you gain:': 2,
    'While wearing two pieces from the Masterful Magewright set, you gain:': 2,
    'While wearing two pieces from the Mind and Matter set, you gain:': 2,
    'While wearing two pieces from the One with the Swarm set, you gain:': 2,
    'While wearing two pieces from the Tyrannical Tinkerer set, you gain:': 2,
}


# Template:Named item sets rev 723530 states this paired numeric form for
# Glacial Assault, Levik's Defender, Lorikk's Champion and Tharne's Wrath.
# https://ddowiki.com/index.php?title=Template:Named_item_sets&oldid=723530
# Keep the bonus markup and punctuation; recognizing a threshold does not
# establish an effect's stat, value or bonus type.
_NUMERIC_PROSE_PAIR_RE = re.compile(
    r"^With 2 items equipped - (.+\.)\s+With 3 items equipped - (.+)$")
_NUMERIC_PROSE_MENTION_RE = re.compile(r"\bWith \d+ items equipped\b")


def _numeric_prose_pair(raw: str):
    """Read only the reviewed 2/3 sentence pair, outside nested markup."""
    match = _NUMERIC_PROSE_PAIR_RE.fullmatch(raw.strip())
    if not match or len(_NUMERIC_PROSE_MENTION_RE.findall(raw)) != 2:
        return None
    two, three = match.groups()
    # A header inside a link label, template argument or HTML attribute is not
    # another tier. The split must not cut through any of those constructs.
    for opening, closing in (("[[", "]]"), ("{{", "}}"), ("<", ">")):
        if two.count(opening) != two.count(closing):
            return None
    return two.strip(), three.strip()


def _tiers_from_lines(lines) -> dict:
    """Bonus lines -> {threshold: [line, ...]}; unreviewed prefaces stay under None."""
    tiers, cur = {}, None
    for raw in lines:
        m = _PIECES_RE.match(plain(raw))
        if m:
            cur = int(m.group(1))
            tiers.setdefault(cur, [])
            # The header is matched on the plain text; keep the remainder as markup
            # (it may hold a template) by cutting the raw line after its separator.
            rest = re.split(r"Equipped\s*(?:'''|'')?\s*[:\-]", raw, maxsplit=1, flags=re.I)
            if m.group(2) and len(rest) == 2 and plain(rest[1]):
                tiers[cur].append(rest[1].strip())
            continue
        numeric = _numeric_prose_pair(raw)
        if numeric:
            tiers.setdefault(2, []).append(numeric[0])
            tiers.setdefault(3, []).append(numeric[1])
            cur = 3
            continue
        prose = next(((prefix, count) for prefix, count in PROSE_PIECE_HEADERS.items()
                      if raw.strip().startswith(prefix)), None)
        if prose:
            prefix, cur = prose
            tiers.setdefault(cur, [])
            rest = raw.strip()[len(prefix):].strip()
            if plain(rest):
                tiers[cur].append(rest)
            continue
        if plain(raw):
            tiers.setdefault(cur, []).append(raw.strip())
    return tiers


def template_sets(wikitext: str) -> dict:
    """`Template:Named item sets` -> {lower-cased key: {name, tiers, raw}}."""
    code = wikitext[wikitext.index("<onlyinclude>"):wikitext.index("</onlyinclude>")]
    body = code[code.index("#switch"):]
    out = {}
    for entry in re.split(r"\n\s*\|\s*(?=[^=\n|]+?\s*=)", body)[1:]:
        key, _, value = entry.partition("=")
        key = key.strip().lower()
        if key.startswith("#") or key in ("this template!", "some off the wall set"):
            continue
        m = _VARDEFINE_RE.search(value)
        name = m.group(1).strip() if m else None
        value = _VARDEFINE_RE.sub("", value).strip()
        lines = re.split(r"<br\s*/?>|</?li[^>]*>|\n", value)
        out[key] = {"name": name, "tiers": _tiers_from_lines(lines), "raw": value}
    return out


def _row_cells(row: str) -> list:
    """A wikitable row's cells, in order. A cell starts at a line beginning `|`
    (or after `||` on one line) and runs until the next."""
    cells, cur = [], None
    for line in row.split("\n"):
        if line.startswith("|") and not line.startswith(("|-", "|}")):
            for part in line[1:].split("||"):
                if cur is not None:
                    cells.append(cur)
                cur = [part]
        elif cur is not None:
            cur.append(line)
    if cur is not None:
        cells.append(cur)
    return ["\n".join(c) for c in cells]


# One typed clause: "+30 Profane bonus to Physical Sheltering", "+6% Artifact bonus to X".
_CLAUSE_RE = re.compile(r"^([+-]?\d+)(%?) ([A-Za-z]+) [Bb]onus to (?:your )?(.+?)\.?$")


_LIST_SPLIT_RE = re.compile(r",\s*(?:and\s+)?|\s+and\s+")

#: #951 — wiki stat phrases that name a catalog stat in other words. Each entry is
#: one reviewed mapping, and the comment above its family cites the evidence. A
#: phrase reaches its catalog name only through this table; nothing is fuzzy-matched.
STAT_PHRASES = {
    # Resistance ratings. ddowiki `Physical Resistance Rating` rev 673201: "Physical
    # Resistance Rating (abbreviated PRR)", and `PRR` redirects there.
    # `Magical Resistance Rating` rev 708082: "(abbreviated MRR)", `MRR` redirects
    # there, and its "MRR cap" section is the cap. The catalog's names for them are
    # docs/wiki-evidence/sheltering.md (Physical / Magical Sheltering) and
    # intrinsic-stat-caps.md (Magical Sheltering Cap, "the wiki's MRR Cap").
    "Physical Resistance Rating": "Physical Sheltering",
    "PRR": "Physical Sheltering",
    "Magical Resistance Rating": "Magical Sheltering",
    "MRR": "Magical Sheltering",
    "Magical Resistance Rating Cap": "Magical Sheltering Cap",
    "MRR Cap": "Magical Sheltering Cap",
    # Spell DCs. ddowiki `Spell Focus Mastery` rev 612763: "adds ... to the DC of all
    # your spells"; `Spell DC` redirects to `Increasing spell DCs` rev 719694, whose
    # Items section lists "Set effects: artifact bonus, profane bonus" for it
    # (docs/wiki-evidence/spell-focus-universal.md). Bare "DCs" is NOT here: it does
    # not say spell, and tactical DCs are DCs too.
    "Spell DCs": "Spell Focus Mastery",
    "all Spell DCs": "Spell Focus Mastery",
    # Assassinate. Template:Assassinate rev 401923 renders Assassinate N as an
    # "N ... bonus to the DC of character's Assassinate attempts". The reviewed
    # synonym registry folds this exact set spelling into the same flat stat.
    # Neither bare "DCs" nor a percentage denotes this specific bonus.
    "Assassinate DCs": "Assassinate",
    # Maximum hit points. False Life (enchantment) rev 718160 calls its amounts
    # "maximum health"; the reviewed synonym registry folds Maximum Hit Points
    # into False Life. The set sources state both flat and percent bonuses.
    # resolve keeps the percent suffix: +10% requires False Life (%), never the
    # flat False Life stat. These are the spellings in the two set sources.
    "Maximum Hit Points": "False Life",
    "maximum Hit Points": "False Life",
    "maximum hit points": "False Life",
    # All ability scores. ddowiki `Template:Stat` rev 678248: its `well rounded`
    # case renders "... bonus to all abilities", and gear-planner's catalog carries
    # each of these set lines as `Well Rounded` at the same type and value. The
    # local synonym registry already folds `all Ability Scores` into Well Rounded
    # (affix_synonyms_registry.json, #374). Only these spellings: the summon lines
    # ("Your Summons ... gain +4 to all Ability Scores") buff someone else.
    "all Ability Scores": "Well Rounded",
    "all ability scores": "Well Rounded",
    "all of your Ability Scores": "Well Rounded",
    # Fortification Bypass. ddowiki `Template:Armor-Piercing` rev 678284 renders
    # "Armor-Piercing N%" as "+N% ... bonus to Fortification Bypass", so the
    # catalog's Armor-Piercing IS the Fortification Bypass stat (a percentage; see
    # PERCENT_STATS).
    "Fortification Bypass": "Armor-Piercing",
    # Damage against helpless enemies. ddowiki `Helpless` ("Increasing extra damage
    # vs helpless opponents") lists every one of these sets in ONE table as a
    # percent bonus (docs/wiki-evidence/helpless-damage.md, #305). Each spelling
    # below is a recorded wiki wording in the reviewed synonym registry
    # (affix_synonyms_registry.json, `Damage to helpless enemies`). The target is
    # gear-planner's set-catalog name for the stat.
    "damage vs the Helpless": "Damage vs. the Helpless",
    "Damage vs the Helpless": "Damage vs. the Helpless",
    "damage vs. the helpless": "Damage vs. the Helpless",
    "damage vs. helpless": "Damage vs. the Helpless",
    "Damage vs. Helpless": "Damage vs. the Helpless",
    "damage versus the Helpless": "Damage vs. the Helpless",
    "Damage vs. Helpless opponents": "Damage vs. the Helpless",
    "Damage vs. Helpless Opponents": "Damage vs. the Helpless",
    "Helplessness Damage": "Damage vs. the Helpless",
    "Additional Damage to Helpless Targets": "Damage vs. the Helpless",
    # Spell power written as one word. Each "<Element> Spellpower" is a fold the
    # reviewed synonym registry records under the catalog's "<Element> Spell Power"
    # (affix_synonyms_registry.json; ddowiki `Spell power` names the stat both ways).
    # Only the elements the set catalog carries: Light and Poison have no catalog
    # spellpower, so a line naming them stays quarantined.
    "Acid Spellpower": "Acid Spell Power",
    "Cold Spellpower": "Cold Spell Power",
    "Electric Spellpower": "Electric Spell Power",
    "Fire Spellpower": "Fire Spell Power",
    "Force Spellpower": "Force Spell Power",
    "Negative Spellpower": "Negative Spell Power",
    "Positive Spellpower": "Positive Spell Power",
    "Sonic Spellpower": "Sonic Spell Power",
    "Universal Spellpower": "Universal Spell Power",
    # "each Spell Power". ddowiki `Update 81 Patch 4 Release Notes`: set bonuses that
    # "say they grant bonuses to Universal Spell Power ... will now instead say what
    # they are actually doing, which is to grant bonuses to each Spell power"
    # (docs/wiki-evidence/set-bonus-universal-per-element.md, #870). The set pages
    # are being relabelled to this wording; the catalog still names the stat
    # Universal Spell Power, which the build expands per element for set bonuses.
    "each Spell Power": "Universal Spell Power",
    "each Spellpower": "Universal Spell Power",
    # Positive amplification. ddowiki `Template:Fleshmaker` rev 479947 links
    # "[[Healing Amplification#Positive Healing Amplification|Positive Healing
    # Amplification]]": the positive kind is a section of the `Healing Amplification`
    # page, the catalog's name for it. The reviewed synonym registry folds both
    # spellings there (affix_synonyms_registry.json). Negative and Repair
    # Amplification are already catalog names, so "Positive, Negative, and Repair
    # Amplification" expands member by member.
    "Positive Amplification": "Healing Amplification",
    "Positive Healing Amplification": "Healing Amplification",
    # Attack and damage. ddowiki `Template:Accuracy` rev 644332 renders Accuracy N as
    # "N ... bonus to [[attack roll]]s", and `Template:Deadly` rev 402602 renders
    # Deadly N as "N ... bonus to weapon damage" ("Melee and Ranged damage" for a
    # Roman amount). The reviewed synonym registry folds "Attack" into Accuracy and
    # "Damage" into Deadly (affix_synonyms_registry.json). Only the bare words: any
    # longer phrase ("Sneak Attack Damage", "Critical Damage") is its own stat.
    "Attack": "Accuracy",
    "attack": "Accuracy",
    "Damage": "Deadly",
    "damage": "Deadly",
    # Universal spell critical chance. ddowiki `Spell Lore` rev 682774 lists exactly
    # the sets that say "Universal Spell Critical Chance" (template) or "each Spell
    # Critical Chance" (page) under its "Artifact Universal lore" heading: Eminence
    # of Autumn, Defender of Tanaroa, Deacon of the Auricular Sacrarium, each +6%.
    # "each" is the U81.4 relabelling, as for "each Spell Power" above.
    # Bare "Spell Critical Chance" is NOT here: the page lists those sets (Elder's
    # Knowledge, Vol's Influence, Delight of the Devourer, Cooking by the Book) under
    # a separate "Artifact lore" heading, with the Solar Gem, not as universal lore.
    "Universal Spell Critical Chance": "Universal Spell Lore",
    "each Spell Critical Chance": "Universal Spell Lore",
}

#: #951 — spell critical chance for one damage type -> the catalog's lore for it.
#: ddowiki `Spell Lore` rev 682774, "Types of spell lore": "For each type of damage,
#: there is a specific lore type": "Acid Lore, Fire Lore, Ice Lore, Lightning Lore,
#: - matching elemental spells", "Healing Lore, - positive energy spells", "Kinetic -
#: force, physical and untyped", "Radiance Lore ... - light and alignment spells",
#: "Repair Lore - repair and rust spells", "Sonic Lore - sonic damage spells", "Void
#: Lore - negative energy and poison spells". The catalog's names for Ice and Void
#: are Cold Lore and Negative Lore (`wiki_enchantments.LORE`; the synonym registry
#: folds Ice Lore and Void Lore there), and Electric's lore is Lightning (the
#: registry folds Electric Lore into Lightning Lore).
_CRIT_CHANCE_LORE = {
    "Acid": "Acid Lore", "Fire": "Fire Lore", "Cold": "Cold Lore",
    "Electric": "Lightning Lore", "Lightning": "Lightning Lore",
    "Positive": "Healing Lore", "Force": "Kinetic Lore",
    "Light": "Radiance Lore", "Alignment": "Radiance Lore", "Light/Alignment": "Radiance Lore",
    "Repair": "Repair Lore", "Sonic": "Sonic Lore",
    "Negative": "Negative Lore", "Poison": "Negative Lore",
}
#: The three spellings the set sources use for the stat.
_CRIT_CHANCE_HEADS = ("Spell Critical Chance", "Spell Crit Chance", "Spellcrit Chance")
STAT_PHRASES.update({f"{dt} {head}": lore for dt, lore in _CRIT_CHANCE_LORE.items()
                     for head in _CRIT_CHANCE_HEADS})

#: #951 — catalog stats that one wiki phrase list may name more than once, because
#: the `Spell Lore` page states that one lore covers several damage types (Radiance:
#: light and alignment; Void: negative energy and poison; Kinetic: force, physical
#: and untyped). "Negative and Poison Spellcrit Chance" is ONE bonus to Void Lore,
#: so its two members collapse. Any other repeated member stays ambiguous.
SHARED_STATS = frozenset({"Radiance Lore", "Negative Lore", "Kinetic Lore"})

#: #951 — stats the catalog names WITHOUT " (%)" because the stat is itself a
#: percentage. A "+N%" line to one of these is a bonus of N to the bare name. The
#: catalog writes " (%)" only where a stat has a flat form too (`Armor Class (%)`),
#: so dropping the "%" is right ONLY for a stat reviewed here; any other "+N%" line
#: to a bare catalog name stays quarantined. Each entry cites the wiki stating the
#: stat in percent.
PERCENT_STATS = frozenset({
    # ddowiki `Doublestrike` and `Doubleshot` (revisions of 2026-10-07): "a
    # Doublestrike value of 230% ... would only provide 215% chance", and the same
    # for Doubleshot (docs/wiki-evidence/intrinsic-stat-caps.md, #888).
    # `Template:Doublestrike` takes "String value (1% - 100%)", which the item
    # mapper already reads as Doublestrike N (src/wiki_enchantments.py `_percent`).
    "Doublestrike",
    "Doubleshot",
    # `Template:Armor-Piercing` rev 678284: "Armor-Piercing {{{1}}}%" grants
    # "+{{{1}}}% ... bonus to Fortification Bypass".
    "Armor-Piercing",
    # ddowiki `Helpless`: "5% / 15%" per set, a percent extra damage
    # (docs/wiki-evidence/helpless-damage.md).
    "Damage vs. the Helpless",
    # Spell critical chance. ddowiki `Spell critical` rev 725105: "Magical Training
    # ... increases the chance by 5% for all damage types"; `Spell Lore` rev 682774
    # tabulates "<Type> Lore %" and lists each set's lore as "+6%".
    "Acid Lore", "Fire Lore", "Cold Lore", "Lightning Lore", "Healing Lore", "Kinetic Lore",
    "Radiance Lore", "Repair Lore", "Sonic Lore", "Negative Lore", "Universal Spell Lore",
    # Spell critical damage. ddowiki `Spell critical` rev 725105: "Spell criticals
    # usually deal double damage, or +100% extra damage", and its items are percents.
    "Spell Critical Damage", "Universal Spell Critical Damage",
    # Dodge. ddowiki `Template:Dodge` rev 537055 renders Dodge N as "N% ... bonus to
    # Dodge". Its cap is a percent too: ddowiki `Dodge bonus` states "The Maximum Dodge
    # Bonus begins at 25%" (docs/wiki-evidence/intrinsic-stat-caps.md §4).
    "Dodge", "Dodge Cap",
    # ddowiki `Missile Deflection` rev 691737: "This grants a chance to have Missiles
    # or Eldritch Blasts miss you", and its counter is listed as "+5% Bypass".
    "Missile Deflection",
})


def resolve(phrase: str, stat_names, suffix: str = ""):
    """A stat phrase (+ its " (%)" suffix) -> its catalog name, or None: exactly a
    catalog name, a `STAT_PHRASES` entry whose target the catalog carries, or a
    `PERCENT_STATS` name (directly or through `STAT_PHRASES`) stated with "%"."""
    if phrase + suffix in stat_names:
        return phrase + suffix
    target = STAT_PHRASES.get(phrase)
    if target and target + suffix in stat_names:
        return target + suffix
    bare = target or phrase
    if suffix and bare in PERCENT_STATS and bare in stat_names:
        return bare
    return None


def expand_list(stat: str, suffix: str, stat_names):
    """#951 — a coordinated list of stats -> its members, or None.

    "Melee and Ranged Power", "Intelligence, Wisdom, and Charisma",
    "Fire and Cold Spell Power". The last member carries a shared head ("Power",
    "Spell Power", or none); every earlier member takes that head. A reading is
    accepted only when EVERY member is exactly a name in `stat_names`, and only when
    exactly one head length does that — two readings means the text is ambiguous,
    and it stays quarantined. A member resolves only as `resolve` allows: exactly a
    catalog name, or a reviewed `STAT_PHRASES` entry ("PRR and MRR"). Any other
    member ("Amp") makes the whole line unreadable.
    """
    parts = [p.strip() for p in _LIST_SPLIT_RE.split(stat) if p.strip()]
    if len(parts) < 2:
        return None
    words = parts[-1].split()
    readings = set()
    for k in range(len(words)):
        head = " ".join(words[len(words) - k:]) if k else ""
        members = [f"{p} {head}".strip() for p in parts[:-1]] + [parts[-1]]
        members = [resolve(m, stat_names, suffix) for m in members]
        # A head that turns two members into one name is not a shared head: "Sneak
        # Attack and Sneak Attack Damage" is two stats, never Sneak Attack Damage twice.
        # The exception is a `SHARED_STATS` name, which the wiki states covers both.
        repeated = {m for m in members if members.count(m) > 1}
        if all(m in stat_names for m in members) and repeated <= SHARED_STATS:
            readings.add(tuple(dict.fromkeys(members)))
    return list(readings.pop()) if len(readings) == 1 else None


def read_clause(line: str, bonus_types, stat_names) -> dict:
    """One bonus line -> {"affixes": [{name, type, value}, ...]} or {"quarantine": reason}.

    A closed grammar. The bonus type must be one the build knows, and the stat must
    be EXACTLY a name in `stat_names` (the set catalog's vocabulary), a reviewed
    `STAT_PHRASES` entry, or a coordinated list whose every member is one of those
    (`expand_list`). Any other wording is quarantined, not translated: each phrase
    is a reviewed mapping with its own evidence, added family by family.
    """
    text = plain(line)
    if "{{" in text:
        return {"quarantine": "unexpanded template"}
    m = _CLAUSE_RE.match(text)
    if not m:
        return {"quarantine": "not a typed '+N <Type> bonus to <stat>' clause"}
    value, pct, ty, stat = int(m.group(1)), m.group(2), m.group(3).capitalize(), m.group(4).strip()
    if ty not in bonus_types:
        return {"quarantine": f"unknown bonus type {m.group(3)!r}"}
    suffix = " (%)" if pct else ""
    one = resolve(stat, stat_names, suffix)
    names = [one] if one else expand_list(stat, suffix, stat_names)
    if not names:
        return {"quarantine": f"stat phrase not in the vocabulary: {stat + suffix!r}"}
    return {"affixes": [{"name": n, "type": ty, "value": value} for n in names]}


def page_sets(wikitext: str) -> list:
    """`Named item sets` -> one record per (row, tier).

    Each record: {anchors, section, tier, tiers, raw}. `tier` is None for a row with
    no HELstats; otherwise each tier the row's HELstats render gets its own record,
    its lines expanded by the template code above. A line whose HELstats state no
    value at that tier is dropped from that tier — the page renders nothing there.
    """
    out, section = [], None
    text = COMMENT_RE.sub("", wikitext)
    for block in re.split(r"(?m)^(==[^=].*?==)\s*$", text):
        if block.startswith("=="):
            section = plain(block.strip("= "))
            continue
        for row in re.split(r"\n\|-[^\n]*", block)[1:]:
            row = row.split("\n|}")[0]
            anchors = [a.strip() for a in _ANCHOR_RE.findall(row)]
            if not anchors:
                continue
            cells = _row_cells(row)
            bonus = _CELL_STYLE_RE.sub("", cells[-1] if cells else "")
            lines = bonus.split("\n")
            tiers = helstats_tiers(bonus)
            for tier in tiers or [None]:
                kept = lines if tier is None else [x for x in (expand_helstats(l, tier) for l in lines) if x is not None]
                out.append({"anchors": anchors, "section": section, "tier": tier,
                            "tiers": _tiers_from_lines(kept), "raw": bonus})
    return out
