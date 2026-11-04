"""#928: independently evidenced compound grants reach exactly their components.

Expected scopes are deliberately written from the retained Wiki definitions, not
read from the implementation table. Whole compounds with a narrower damage scope
stay intact until the model can represent them without widening or losing it.
"""
import copy
import json
from pathlib import Path
from src import spell_focus

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    'Power of Creeping Dust': ['Glaciation', 'Corrosion'],
    'Power of the Dark Restoration': ['Nullification', 'Devotion'],
    'Power of the Firestorm': ['Combustion', 'Magnetism'],
    'Power of the Frozen Depths': ['Nullification', 'Glaciation'],
    'Power of the Frozen Storm': ['Glaciation', 'Magnetism'],
    'Power of the Frozen Thunderstorm': ['Glaciation', 'Resonance', 'Magnetism'],
    'Power of the Silver Flame': ['Devotion', 'Radiance'],
    'Power of the Thunderstorm': ['Resonance', 'Magnetism'],
    'Creeping Dust Lore': ['Ice Lore', 'Acid Lore'],
    'Dark Restoration Lore': ['Void Lore', 'Healing Lore'],
    'Firestorm Lore': ['Fire Lore', 'Lightning Lore'],
    'Frozen Depths Lore': ['Void Lore', 'Ice Lore'],
    'Frozen Storm Lore': ['Ice Lore', 'Lightning Lore'],
    'Silver Flame Lore': ['Healing Lore', 'Radiance Lore'],
    'Thunderstorm Lore': ['Sonic Lore', 'Lightning Lore'],
}
UNCHANGED = [
    'Power of the Blight', 'Blighted Lore',
    'Power of the Moonlit Haunt', 'Moonlit Haunt Lore',
    'Power of the Flames of Purity', 'Purifying Flame Lore',
    'Power of the Flames of Darkness', 'Power of the Sacred Ground',
    'Frozen Thunderstorm Lore', 'Sacred Ground Lore',
]


def affix(name, kind='Equipment', value=111):
    return dict(stat=name, bonus_type=kind, value=value, unit='flat',
                raw='retained engraving', eligible=True)


def test_all_fifteen_compounds_expand_to_exact_independent_scopes():
    for name, expected in EXPECTED.items():
        result = spell_focus.expand_affixes([affix(name)])
        assert [a['stat'] for a in result] == expected, name
        assert all(a['value'] == 111 and a['bonus_type'] == 'Equipment' for a in result), name
        assert all(a['via'] == name for a in result), name
        assert all(a['origin_stat'] == name for a in result), name


def test_insight_and_quality_are_not_overwritten_by_equipment_default():
    # The retained Frozen Storm exemplar is Insight; actual carriers also use Quality.
    for kind, label in [('Insight', 'Insightful'), ('Quality', 'Quality')]:
        result = spell_focus.expand_affixes([affix('Power of the Frozen Storm', kind, 74)])
        assert [a['stat'] for a in result] == ['Glaciation', 'Magnetism']
        assert all(a['bonus_type'] == kind and a['value'] == 74 for a in result)
        assert all(a['via'] == label + ' Power of the Frozen Storm' for a in result)


def test_expansion_does_not_mutate_source_or_revive_ineligible_grants():
    original = affix('Thunderstorm Lore', value=16)
    original.update(eligible=False, unit='pct', raw='original exact tooltip')
    saved = copy.deepcopy(original)
    result = spell_focus.expand_affixes([original])
    assert [a['stat'] for a in result] == ['Sonic Lore', 'Lightning Lore']
    assert original == saved
    for item in result:
        assert item is not original
        assert item['eligible'] is False and item['unit'] == 'pct'
        assert item['raw'] == saved['raw'] and item['value'] == 16
    assert spell_focus.expand_affixes(result) == result


def test_set_channel_expands_without_changing_threshold_or_identity():
    tier = dict(set='Test set', pieces_required=3,
                affixes=[affix('Thunderstorm Lore', value=16)])
    rows = [dict(affixes=[affix('Power of the Thunderstorm')], parsed_set_bonuses=[tier])]
    spell_focus.expand_variants(rows)
    assert [a['stat'] for a in rows[0]['affixes']] == ['Resonance', 'Magnetism']
    assert tier['set'] == 'Test set' and tier['pieces_required'] == 3
    assert [a['stat'] for a in tier['affixes']] == ['Sonic Lore', 'Lightning Lore']


def test_atomic_craft_affixes_remain_one_option_with_all_components():
    option = dict(id='one selectable recipe', cost=1,
                  affixes=[affix('Power of the Frozen Thunderstorm', value=148)])
    option['affixes'] = spell_focus.expand_affixes(option['affixes'])
    assert option['id'] == 'one selectable recipe' and option['cost'] == 1
    assert [a['stat'] for a in option['affixes']] == ['Glaciation', 'Resonance', 'Magnetism']
    assert all(a['value'] == 148 for a in option['affixes'])


def test_excluded_damage_boundaries_and_unverified_lore_remain_unchanged():
    # Deliberate unchanged guards: Evil cannot imply all Radiance; Force cannot
    # imply Physical/Untyped; Light alone cannot imply all Alignment.
    for name in UNCHANGED:
        a = affix(name)
        assert spell_focus.expand_affixes([a]) == [a], name
        assert name.lower() not in spell_focus.expanded_away(), name
    unknown = affix('Power of an unverified new storm')
    assert spell_focus.expand_affixes([unknown]) == [unknown]


def test_universal_sources_remain_separate_from_component_expansion():
    # Deliberately unchanged: these are additive sources, not Equipment components.
    for name in ['Universal Spell Power', 'Universal Spell Lore']:
        a = affix(name, 'Exceptional', 5)
        assert spell_focus.expand_affixes([a]) == [a]


def test_priority_migration_metadata_uses_component_order_and_no_extra_types():
    expanded = spell_focus.expanded_away()
    for name, expected in EXPECTED.items():
        assert expanded.get(name.lower()) == expected, name
    assert 'Impulse' not in expanded['power of the thunderstorm']
    assert 'Radiance' not in expanded['power of the frozen thunderstorm']


def test_real_epic_storm_data_grants_both_components_with_engraving():
    data = json.loads((ROOT / 'web/data/items.json').read_text())
    storm = next(v for v in data['items'] if v['variant_id'] == 'Epic Storm')
    got = {(a['name'], a['type'], float(a['value']), a.get('via')) for a in storm['affixes']}
    for stat in ['Resonance', 'Magnetism']:
        assert (stat, 'Equipment', 111, 'Power of the Thunderstorm') in got
    for stat in ['Sonic Lore', 'Lightning Lore']:
        assert (stat, 'Equipment', 16, 'Thunderstorm Lore') in got
    assert ('Universal Spell Power', 'Implement', 20, None) in got
    assert not any(a['name'] in ['Power of the Thunderstorm', 'Thunderstorm Lore'] for a in storm['affixes'])
    for a in storm['affixes']:
        if a.get('via') in ['Power of the Thunderstorm', 'Thunderstorm Lore']:
            assert a.get('origin_stat') == a['via']
