"""Native Dinosaur Bone (Isle of Dread) synthetic-host layout — logic, not data.

KTD8: the Dinosaur Bone blank host BODIES and Dino Set-Bonus records are a
solver-layer craftable-base primitive, not gear-planner item data (gear-planner
carries the *Attuned Bone* items + the Claw/Fang/Horn/Scale insert pools, but not
the synthetic "Dinosaur Bone <slot>" blanks the solver crafts onto). The synthetic
host LAYOUT (which worn slots are Dino hosts, their typed slots, and which carry a
set-bonus slot) is a fixed game-rule structure, so it lives here as code after the
legacy data/seed/dino_crafting.json seed was purged in U7.

native_dino_seed() returns the seed-shaped dict src.dino.build_dino consumes; the
insert OPTION pool is sourced separately + natively from gearplanner_crafting.json
(the <Type> (<Category>) menus), so it is omitted here.
"""
from __future__ import annotations

# The Dinosaur Bone host layout + Dino Set-Bonus records, relocated verbatim from
# the retired seed. Structural game-rule constants (not harvested item data).
_DINO_LAYOUT = {   'metadata': {   'system': 'Isle of Dread — Dino crafting (Accessory + Weapon/Armor/Raid typed '
                              'pools; Set-Bonus sourced)',
                    'note': 'Sourced from ddowiki.com/page/Dinosaur_Bone_crafting (§ Accessories) '
                            'via Claude-in-Chrome; plain fetch returns empty for ddowiki. Insert '
                            "'effect' strings are VERBATIM; documented base value only (the "
                            'undocumented Minor-Artifact +N bump is not encoded). The strict '
                            'parser decides eligibility; nothing here is inferred (KTD2).',
                    'source_pages': ['https://ddowiki.com/page/Dinosaur_Bone_crafting'],
                    'sourcing_status': 'M2 COMPLETE (parser+solver+surface shipped). Pools active: '
                                       'Accessory + typed Weapon/Armor/Raid inserts, keyed by '
                                       '(dino_type, category) — a "Scale (Weapon)" insert fits '
                                       'only a "Scale Slot (Weapon)". Multi-affix inserts '
                                       '(Silverscale, Fang: Deception) are single all-or-nothing '
                                       'placement UNITS. Blank hosts materialized per worn slot (8 '
                                       'accessory + Armor + Main Hand weapon + Rune Arm); '
                                       'shields/orbs deferred (no Off Hand slot in solver). Weapon '
                                       'inserts that are on-hit procs / material types / DOTs are '
                                       'strictly quarantined (no parseable magnitude — never '
                                       'inferred). Dino Set-Bonus: 6 sets sourced + browsable, but '
                                       'solver activation DEFERRED — it is a crafted '
                                       'set-membership choice-slot (only Armor/Helmet/Cloak carry '
                                       'a set-bonus slot, <=3 crafted slots; one set needs 5 '
                                       'pieces), so completion needs intrinsic named/raid set '
                                       'pieces from the IoD named-gear sweep. Raw harvest at '
                                       'data/seed/compendium/raw/dino_crafting.json '
                                       '(reproducibility). Effects verbatim; documented base value '
                                       'only.'},
    'items': [   {   'item': 'Dinosaur Bone Belt',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Dinosaur Bone Boots',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Dinosaur Bone Bracers',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Dinosaur Bone Gloves',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Necklace',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Ring',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Helmet',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                 {   'item': 'Cloak',
                     'slot': 'accessory',
                     'dino_slots': [   {'type': 'Scale'},
                                       {'type': 'Fang'},
                                       {'type': 'Claw'},
                                       {'type': 'Horn'}],
                     'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'}],
    'crafted_hosts': [   {   'host_category': 'Weapons',
                             'items': [],
                             'item_note': 'All weapon types in 2 variants, see below',
                             'iod_slots': [   {'type': 'Scale', 'category': 'Weapon'},
                                              {'type': 'Fang', 'category': 'Weapon'},
                                              {'type': 'Claw', 'category': 'Weapon'},
                                              {'type': 'Horn', 'category': 'Weapon'}],
                             'set_bonus_slot': False},
                         {   'host_category': 'Armors',
                             'items': [   'Robe',
                                          'Outfit',
                                          'Light Armor',
                                          'Medium Armor',
                                          'Heavy Armor',
                                          'Docent'],
                             'item_note': None,
                             'iod_slots': [   {'type': 'Scale', 'category': 'Armor'},
                                              {'type': 'Fang', 'category': 'Armor'},
                                              {'type': 'Claw', 'category': 'Accessory'},
                                              {'type': 'Horn', 'category': 'Accessory'}],
                             'set_bonus_slot': True},
                         {   'host_category': 'Shields',
                             'items': [   'Buckler',
                                          'Small Shield',
                                          'Large Shield',
                                          'Tower Shield',
                                          'Orb',
                                          'Runearm'],
                             'item_note': None,
                             'iod_slots': [   {'type': 'Scale', 'category': 'Weapon'},
                                              {'type': 'Fang', 'category': 'Weapon'},
                                              {'type': 'Scale', 'category': 'Armor'},
                                              {'type': 'Fang', 'category': 'Armor'}],
                             'set_bonus_slot': False},
                         {   'host_category': 'Non-Minor Artifact Accessories',
                             'items': ['Helmet', 'Cloak'],
                             'item_note': None,
                             'iod_slots': [   {'type': 'Scale', 'category': 'Accessory'},
                                              {'type': 'Fang', 'category': 'Accessory'},
                                              {'type': 'Claw', 'category': 'Accessory'},
                                              {'type': 'Horn', 'category': 'Accessory'}],
                             'set_bonus_slot': True},
                         {   'host_category': 'Minor Artifact Accessories',
                             'items': ['Belt', 'Boots', 'Bracers', 'Gloves', 'Necklace', 'Ring'],
                             'item_note': None,
                             'iod_slots': [   {'type': 'Scale', 'category': 'Accessory'},
                                              {'type': 'Fang', 'category': 'Accessory'},
                                              {'type': 'Claw', 'category': 'Accessory'},
                                              {'type': 'Horn', 'category': 'Accessory'}],
                             'set_bonus_slot': False}],
    'set_augments': [   {   'name': 'Dread Stalker',
                            'set_name': 'Dread Stalker',
                            'threshold': 3,
                            'tier_text': '+3 Artifact bonus to Sneak Attack Dice+15 Artifact bonus '
                                         'to Melee and Ranged Power+15% Artifact bonus to '
                                         'Doublestrike and Doubleshot+15% Artifact bonus to damage '
                                         'vs. the helpless',
                            'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                        {   'name': 'Devotion of the Firemouth',
                            'set_name': 'Devotion of the Firemouth',
                            'threshold': 3,
                            'tier_text': '+30 Artifact bonus to Positive, Negative and Repair '
                                         'Amplification+30 Artifact bonus to PRR+15% Artifact '
                                         'bonus to Armor Class+100% Artifact bonus to Threat '
                                         'Generation',
                            'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                        {   'name': 'Defender of Tanaroa',
                            'set_name': 'Defender of Tanaroa',
                            'threshold': 3,
                            'tier_text': '+30 Artifact bonus to Positive, Negative, and Repair '
                                         'Amplification+6% Artifact bonus to Universal Spell '
                                         'Critical Chance+25 Artifact bonus to Universal '
                                         'Spellpower+30 Artifact bonus to MRR',
                            'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                        {   'name': 'Deacon of the Auricular Sacrarium',
                            'set_name': 'Deacon of the Auricular Sacrarium',
                            'threshold': 3,
                            'tier_text': '+6% Artifact bonus to Universal Spell Critical Chance+25 '
                                         'Artifact bonus to Universal Spellpower+15% Legendary '
                                         'bonus to Spell Critical Damage+30 Bonus to Magical '
                                         'Resistance Rating Cap',
                            'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                        {   'name': 'Echoes of the Walking Ancestors',
                            'set_name': 'Echoes of the Walking Ancestors',
                            'threshold': 3,
                            'tier_text': '+3 Artifact bonus to all Spell DCs+3 Artifact bonus to '
                                         'all Tactical DCs and Assassinate+3 Artifact bonus to all '
                                         'Ability Scores+3 Artifact bonus to Imbue Dice',
                            'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'},
                        {   'name': "The Legendary Dread Isle's Curse",
                            'set_name': "The Legendary Dread Isle's Curse",
                            'threshold': 5,
                            'tier_text': '+15 Profane bonus to Melee and Ranged Power+25 Profane '
                                         'bonus to Universal Spellpower+30 Profane bonus to '
                                         'Physical Resistance Rating+2 Profane bonus to Spell '
                                         'DCs+2 Profane bonus to all Ability Scores+4 Profane '
                                         'bonus to Attack and DamageThe Isle of Dread beckons '
                                         'you...',
                            'wiki_url': 'https://ddowiki.com/page/Dinosaur_Bone_crafting'}]}


def native_dino_seed() -> dict:
    """The Dino synthetic-host layout (blank bodies + set records), as the
    seed-shaped dict build_dino expects. Deterministic; no file I/O."""
    return _DINO_LAYOUT
