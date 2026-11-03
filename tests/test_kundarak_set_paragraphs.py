"""#951: compare three retained Kundarak paragraphs without inferring mechanics.

The switch entries and section comment are verbatim Template:Named item sets
revision 723530. Outer wrappers and page rows below are synthetic test inputs.
See docs/wiki-evidence/kundarak-delving-paragraphs.md.
"""
import copy

from test_wiki_sets import D, S, _comparison_catalog
from src.affix_parser import BONUS_TYPES


ENTRIES = """  | epic kundarak delving equipment = {{#vardefine:set|Epic Kundarak Delving Equipment}}3 Pieces Equipped: +2 Artifact bonus to Sneak Attack Dice. +10% Artifact bonus to Helplessness Damage. +10% Artifact bonus to Doublestrike and Doubleshot
  | kundarak delving equipment = {{#vardefine:set|Kundarak Delving Equipment}}3 Pieces Equipped: +1 Artifact bonus to Sneak Attack Dice. +5% Artifact bonus to Helplessness Damage. +5% Artifact bonus to Doublestrike and Doubleshot
<!-- L -->
  | legendary kundarak delving equipment = {{#vardefine:set|Legendary Kundarak Delving Equipment}}3 Pieces Equipped: +3 Artifact bonus to Sneak Attack Dice. +15% Artifact bonus to Helplessness Damage. +15% Artifact bonus to Doublestrike and Doubleshot"""
CASES = (('Kundarak Delving Equipment', 1, 5),
         ('Epic Kundarak Delving Equipment', 2, 10),
         ('Legendary Kundarak Delving Equipment', 3, 15))


def fixture(entries=ENTRIES, page=''):
    template = '<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + entries + '\n| #default = Undefined set\n}}</onlyinclude>'
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': page},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template}}
    catalog = _comparison_catalog()
    return pages, {name: catalog[name] for name, _, _ in CASES}


def test_all_three_retained_paragraphs_compare_exactly():
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    assert set(entries) == {name.lower() for name, _, _ in CASES}
    assert len(entries) == 3
    report = D.diff(pages, catalog)
    assert report['counts']['template'] == {'exact': 3}, report['sets']
    for name, dice, percent in CASES:
        assert set(entries[name.lower()]['tiers']) == {3}
        assert len(entries[name.lower()]['tiers'][3]) == 1  # Retain source structure.
        assert D.gp_tiers(catalog[name])[3] == {
            ('Sneak Attack Dice', 'Artifact', dice): 1,
            ('Damage vs. the Helpless', 'Artifact', percent): 1,
            ('Doublestrike', 'Artifact', percent): 1,
            ('Doubleshot', 'Artifact', percent): 1}
        assert report['sets'][name] == {
            'template': {'class': 'exact'}, 'page': {'class': 'no-wiki-name'}}


def test_wiki_to_wiki_comparison_uses_the_same_reading():
    # These synthetic page identities exercise comparison only. The real page's
    # missing usable identities remain missing; this fixture supplies no alias.
    rows = []
    for name, dice, percent in CASES:
        rows.append('|-\n|{{Anchor|' + name + '}}\n|Fixture items\n|3 Pieces Equipped:\n'
                    f'* +{dice} Artifact bonus to Sneak Attack Dice\n'
                    f'* +{percent}% Artifact bonus to Helplessness Damage\n'
                    f'* +{percent}% Artifact bonus to Doublestrike and Doubleshot')
    pages, catalog = fixture(page='{|class="wikitable"\n' + '\n'.join(rows) + '\n|}')
    assert D.diff(pages, catalog)['sources_disagree'] == []
    pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace(
        '+1 Artifact bonus to Sneak Attack Dice', '+9 Artifact bonus to Sneak Attack Dice')
    disagreements = D.diff(pages, catalog)['sources_disagree']
    assert len(disagreements) == 1, disagreements
    assert disagreements[0]['set'] == CASES[0][0]
    assert ('Sneak Attack Dice', 'Artifact', 1) in disagreements[0]['template'][3]
    assert ('Sneak Attack Dice', 'Artifact', 9) in disagreements[0]['page'][3]


def test_catalog_disagreement_does_not_replace_the_source_amount_or_type():
    for field, value in (('value', '9'), ('type', 'Enhancement')):
        pages, catalog = fixture()
        for tiers in catalog.values():
            tiers[0]['affixes'][0][field] = value
        report = D.diff(pages, catalog)
        for name, dice, _ in CASES:
            result = report['sets'][name]['template']
            assert result['class'] == 'ours-differs', result
            assert result['extra'] == [
                {'threshold': 3, 'affix': ['Sneak Attack Dice', 'Artifact', dice]}], result
            assert result['quarantined'] == []


def test_extra_catalog_occurrences_remain_unmatched():
    pages, catalog = fixture()
    for tiers in catalog.values():
        tiers[0]['affixes'].extend([copy.deepcopy(tiers[0]['affixes'][0])] * 2)
    report = D.diff(pages, catalog)
    for name, dice, _ in CASES:
        result = report['sets'][name]['template']
        assert result == {'class': 'catalog-unmatched', 'catalog_unmatched': [
            {'threshold': 3, 'affix': ['Sneak Attack Dice', 'Artifact', dice]}] * 2}, result


def test_a_missing_vocabulary_entry_stays_quarantined():
    pages, catalog = fixture()
    for tiers in catalog.values():
        tiers[0]['affixes'] = [a for a in tiers[0]['affixes'] if a['name'] != 'Sneak Attack Dice']
    report = D.diff(pages, catalog)
    for name, dice, _ in CASES:
        result = report['sets'][name]['template']
        assert result['class'] == 'partial', result
        assert len(result['quarantined']) == 1, result
        assert result['quarantined'][0]['line'] == f'+{dice} Artifact bonus to Sneak Attack Dice'
        assert 'vocabulary' in result['quarantined'][0]['reason']


def test_unreviewed_words_units_conditions_and_sentences_stay_whole():
    # Unchanged boundaries: no generic sentence splitter or new sneak alias.
    for before, after in (
            ('Artifact', 'Enhancement'), ('Sneak Attack Dice', 'Sneak Attack'),
            ('Sneak Attack Dice', 'Sneak Attack Damage'), ('Sneak Attack Dice', 'Deception'),
            ('+1 Artifact', '+9 Artifact'), ('+2 Artifact', '+9 Artifact'),
            ('+3 Artifact', '+9 Artifact'), ('% Artifact', ' Artifact'),
            ('. +', '; +'), ('3 Pieces Equipped: ', '3 Pieces Equipped: While centered, '),
            ('Doublestrike and Doubleshot', 'Doublestrike and Doubleshot while centered'),
            ('Doublestrike and Doubleshot', 'Doublestrike and Doubleshot. Unknown effect'),
            ('Sneak Attack Dice.', 'Sneak Attack Dice. +1 Artifact bonus to Sneak Attack Dice.')):
        pages, catalog = fixture(ENTRIES.replace(before, after))
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        report = D.diff(pages, catalog)
        for name, _, _ in CASES:
            original = S.template_sets(fixture()[0][D.TEMPLATE]['wikitext'])[name.lower()]
            entry = entries[name.lower()]
            if entry == original:
                continue
            result = report['sets'][name]['template']
            assert result['class'] == 'partial', (before, after, name, result)
            assert [q['line'] for q in result['quarantined']] == [S.plain(entry['tiers'][3][0])]


def test_identity_count_and_section_comment_changes_do_not_inherit_parsing():
    # Unchanged boundaries, including the exact non-rendered section marker.
    for name, _, _ in CASES:
        pages, catalog = fixture(ENTRIES.replace('| ' + name.lower() + ' =', '| different set ='))
        catalog['Different Set'] = catalog.pop(name)
        assert D.diff(pages, catalog)['sets']['Different Set']['template']['class'] == 'partial'
        pages, catalog = fixture(ENTRIES.replace('set|' + name + '}', 'set|Different Set}'))
        assert D.diff(pages, catalog)['sets'][name]['template']['class'] == 'partial'
    for header, expected in (('2 Pieces Equipped: ', 'threshold-differs'), ('', 'threshold-unstated')):
        pages, catalog = fixture(ENTRIES.replace('3 Pieces Equipped: ', header))
        report = D.diff(pages, catalog)
        assert all(report['sets'][name]['template']['class'] == expected for name, _, _ in CASES)
    for comment in ('', '<!-- Changed section context -->'):
        pages, catalog = fixture(ENTRIES.replace('<!-- L -->', comment))
        assert D.diff(pages, catalog)['sets'][CASES[0][0]]['template']['class'] == 'partial'


def test_comparison_preserves_inputs_and_the_shared_reader_boundary():
    # Unchanged behavior: parsing a comparison copy supplies no production data.
    pages, catalog = fixture()
    original = copy.deepcopy((pages, catalog))
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    names = {a['name'] for ts in catalog.values() for t in ts for a in t['affixes']}
    D.diff(pages, catalog)
    assert (pages, catalog) == original
    assert S.template_sets(pages[D.TEMPLATE]['wikitext']) == entries
    before_entries = copy.deepcopy(entries)
    for key, entry in entries.items():
        D.comparison_template_entry(key, entry)
        assert 'quarantine' in S.read_clause(entry['tiers'][3][0], BONUS_TYPES, names)
    assert entries == before_entries
