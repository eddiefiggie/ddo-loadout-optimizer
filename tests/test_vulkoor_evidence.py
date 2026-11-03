"""#951: keep the Vulkoor source discrepancy visible without changing game data.

These are deliberate unchanged-behavior guards. The own-item popup fixture is
retained evidence, not a substitute set catalog. See vulkoor-sneak-fields.md.
"""
import copy
import json
from html.parser import HTMLParser
from pathlib import Path

from src import set_catalog as SC, wiki_sets as W
from src.affix_parser import BONUS_TYPES
from test_wiki_sets import D

FIXTURE = Path(__file__).parent / 'fixtures' / 'vulkoor_sneak_evidence.json'
SET = "Legendary Vulkoor's Might"
AMBIGUOUS = '+3 Artifact bonus to Sneak Attack'
FLAT = '+3 Artifact bonus to Sneak Attack Damage'


class PopupLines(HTMLParser):
    """Preserve the captured DOM's br boundaries; never execute its markup."""

    def __init__(self):
        super().__init__()
        self.lines = ['']

    def handle_starttag(self, tag, attrs):
        if tag == 'br':
            self.lines.append('')

    def handle_data(self, text):
        self.lines[-1] += text


def popup_tiers():
    fixture = json.loads(FIXTURE.read_text())
    excerpts = [e for b in fixture['bundles'] for e in b['excerpts']
                if e['excerptId'].endswith('-SET-MARKUP')]
    assert {e['sourceId'] for e in excerpts} == {'CLAW-BRACERS-631874', 'CLAW-GLOVES-632339'}
    assert len(excerpts) == 2, 'both own-item popups must be inspected exactly once'
    tiers = []
    for excerpt in excerpts:
        parser = PopupLines()
        parser.feed(excerpt['exactText'])
        assert parser.lines[0] == SET + ': 2 Pieces Equipped:'
        assert len(parser.lines) == 8
        assert parser.lines.count(AMBIGUOUS) == parser.lines.count(FLAT) == 1
        # Read the threshold through the existing reader, not a count of items.
        tiers.append(W._tiers_from_lines([parser.lines[0].removeprefix(SET + ': '), *parser.lines[1:]]))
    assert tiers[0] == tiers[1], 'two copies of one definition, not two set grants'
    return tiers


def catalog_names():
    names = {a['name'] for tiers in SC.load_raw().values()
             for tier in tiers for a in tier['affixes']}
    assert {'Deception', 'Sneak Attack Damage', 'Sneak Attack Dice'} <= names
    return names


def flat_affix(value=3, bonus_type='Artifact'):
    return {'name': 'Sneak Attack Damage', 'type': bonus_type, 'value': value}


def test_both_own_popups_read_flat_damage_without_resolving_the_ambiguous_field():
    names = catalog_names()
    for tiers in popup_tiers():
        assert set(tiers) == {2}
        assert W.read_clause(FLAT, BONUS_TYPES, names) == {'affixes': [flat_affix()]}
        result = W.read_clause(AMBIGUOUS, BONUS_TYPES, names)
        assert 'affixes' not in result and 'vocabulary' in result['quarantine']


def test_known_related_names_do_not_invent_a_dice_or_deception_equivalence():
    names = catalog_names()
    for vocabulary in [names, {'Deception'}, {'Sneak Attack Damage'}, {'Sneak Attack Dice'},
                       {'Deception', 'Sneak Attack Damage', 'Sneak Attack Dice'}]:
        assert 'quarantine' in W.read_clause(AMBIGUOUS, BONUS_TYPES, vocabulary)
        # Adversarial coordinated spelling: the second member must not silently
        # supply the missing meaning of the first (the historical shared-head trap).
        assert 'quarantine' in W.read_clause(
            AMBIGUOUS + ' and Sneak Attack Damage', BONUS_TYPES, vocabulary)
    assert W.read_clause('+3 Artifact bonus to Sneak Attack Dice', BONUS_TYPES, names) == {
        'affixes': [{'name': 'Sneak Attack Dice', 'type': 'Artifact', 'value': 3}]}


def test_literal_fields_stay_distinct_if_a_caller_supplies_both_literal_names():
    # Synthetic vocabulary: admitting the literal name still authorizes no
    # semantic conversion to dice, Deception, or a duplicate flat-damage grant.
    names = catalog_names() | {'Sneak Attack'}
    expected = [{'name': 'Sneak Attack', 'type': 'Artifact', 'value': 3}, flat_affix()]
    assert W.read_clause(AMBIGUOUS + ' and Sneak Attack Damage', BONUS_TYPES, names) == {
        'affixes': expected}
    for affix in expected + [{'name': n, 'type': 'Artifact', 'value': 3}
                             for n in ['Deception', 'Sneak Attack Dice']]:
        assert D.comparison_affixes(affix) == [(affix['name'], 'Artifact', 3)]


def test_current_catalog_discrepancy_remains_visible_for_each_own_popup():
    catalog = SC.load_raw()
    before = copy.deepcopy(catalog)
    for tiers in popup_tiers():
        source = copy.deepcopy(tiers)
        classification, detail = D.classify(tiers, D.gp_tiers(catalog[SET]), catalog_names(), SET)
        assert classification == 'ours-differs'
        assert detail['extra'] == [{'threshold': 2, 'affix': ['Sneak Attack Damage', 'Artifact', 3]}]
        assert any(q['line'] == AMBIGUOUS and q['threshold'] == 2 for q in detail['quarantined'])
        assert tiers == source
    assert catalog == before, 'a comparison must not rewrite either source'


def test_an_exact_flat_field_does_not_discharge_the_other_unresolved_field():
    # Hypothetical comparison input only; it is never written into production.
    candidate = copy.deepcopy(SC.load_raw()[SET])
    candidate[0]['affixes'] = [a for a in candidate[0]['affixes'] if a['name'] != 'Deception']
    candidate[0]['affixes'].append(flat_affix())
    for tiers in popup_tiers():
        classification, detail = D.classify(tiers, D.gp_tiers(candidate), catalog_names(), SET)
        assert classification == 'partial', 'a known flat field does not settle the ambiguous field'
        assert any(q['line'] == AMBIGUOUS for q in detail['quarantined'])
        for field, value in [('value', 4), ('type', 'Enhancement'), ('name', 'Sneak Attack Dice')]:
            changed = copy.deepcopy(candidate)
            changed[0]['affixes'][-1][field] = value
            classification, detail = D.classify(tiers, D.gp_tiers(changed), catalog_names(), SET)
            assert classification == 'ours-differs', (field, value, detail)
            assert detail['extra'] == [{'threshold': 2, 'affix': ['Sneak Attack Damage', 'Artifact', 3]}]
        changed = copy.deepcopy(candidate)
        changed[0]['threshold'] = 3
        assert D.classify(tiers, D.gp_tiers(changed), catalog_names(), SET)[0] == 'threshold-differs'
