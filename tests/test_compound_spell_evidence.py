"""Corruption tests for the evidence gate; no live Wiki access required."""
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def guard():
    # Old-base proof fails by assertion rather than an import/dependency crash.
    assert importlib.util.find_spec('src.compound_spell_evidence'), 'no compound evidence guard'
    from src.compound_spell_evidence import check_compound_evidence
    return check_compound_evidence


def refused(**kwargs):
    try:
        guard()(**kwargs)
    except SystemExit as e:
        assert 'compound spell evidence:' in str(e), e
        return
    raise AssertionError('corrupted input was accepted')


def captures():
    return json.loads((ROOT / 'data/seed/compendium/affix_tooltip.json').read_text())['harvested']


def test_actual_raw_roster_has_reviewed_compounds_and_guard_admits_it():
    # Read actual retained item affixes before the build's spell expansion.
    raw = json.loads((ROOT / 'data/seed/compendium/wiki_item_affixes.json').read_text())
    names = [a[0] for v in raw['records'].values() for a in v['affixes']]
    result = guard()(names)
    # This shard is not the full merged build population (kept-whole fallback differs).
    assert result['compound_names'] == 24
    assert result['admitted'] == 14 and result['retained'] == 10
    assert result['inspected_names'] > 100


def test_zero_population_and_unknown_compound_are_refused():
    for names in [[], ['Strength', 'Fire Lore', 'Universal Spell Power'],
                  ['Power of a New Storm'], ['New Storm Lore']]:
        refused(affix_names=names)


def test_tooltip_scope_bonus_type_and_missing_capture_are_refused():
    for edit in ['scope', 'type', 'missing']:
        source = captures()
        row = source['Thunderstorm Lore']
        if edit == 'scope': row['tooltip'] = row['tooltip'].replace('Sonic and Lightning', 'Sonic and Cold')
        if edit == 'type': row['tooltip'] = row['tooltip'].replace('Equipment', 'Exceptional')
        if edit == 'missing': del source['Thunderstorm Lore']
        refused(affix_names=['Thunderstorm Lore'], tooltips=source)


def test_unstated_or_unattributed_capture_is_refused():
    for key in ['provenance', 'carrier', 'wiki_url', 'harvested']:
        source = captures()
        source['Power of the Thunderstorm'][key] = None
        refused(affix_names=['Power of the Thunderstorm'], tooltips=source)


def test_expansion_cannot_silently_add_or_drop_a_damage_type():
    assert importlib.util.find_spec('src.compound_spell_evidence'), 'no compound evidence guard'
    from src.compound_spell_evidence import REVIEWED
    expected = {k.lower(): copy.deepcopy(v[0]) for k, v in REVIEWED.items()}
    for edit in ['extra', 'missing', 'unknown']:
        values = copy.deepcopy(expected)
        if edit == 'extra': values['power of the thunderstorm'].append('Impulse')
        if edit == 'missing': values['thunderstorm lore'].pop()
        if edit == 'unknown': values['power of the blight'] = ['Radiance']
        refused(affix_names=['Thunderstorm Lore'], expansions=values)


def test_noncompound_names_and_retained_narrow_effects_are_not_expanded():
    out = guard()(['Fire Lore', 'Spell Lore', 'Arcane Lore', 'Power of the Blight', 'Moonlit Haunt Lore'])
    assert out['compound_names'] == 2 and out['admitted'] == 0 and out['retained'] == 2
