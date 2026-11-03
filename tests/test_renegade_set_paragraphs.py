"""#951: compare only the two retained Renegade Champion paragraphs.

The two switch entries below are verbatim Template:Named item sets rev 723530.
The outer switch and page tables are synthetic wrappers, not new Wiki evidence.
See docs/wiki-evidence/renegade-champion-paragraphs.md.
"""
import copy

from test_wiki_sets import D, S, _comparison_catalog
from src.affix_parser import BONUS_TYPES


ENTRIES = """  | renegade champion = 3 Pieces Equipped: +1 Artifact Bonus to Critical Multiplier on a 19-20. +2 Artifact Bonus to Rune Arm DCs. +10 Artifact Bonus to Repair Amplification
  | renegade champion (legendary) = 3 Pieces Equipped: +1 Artifact Bonus to Critical Multiplier on a 19-20. +3 Artifact Bonus to Rune Arm DCs. +30 Artifact Bonus to Repair Amplification{{#vardefine:set|Renegade Champion (Legendary)}}"""
NAMES = ('Renegade Champion', 'Renegade Champion (Legendary)')
CRITICAL = 'Critical Multiplier on a 19-20'


def fixture(entries=ENTRIES, page=''):
    template = '<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + entries + '\n| #default = Undefined set\n}}</onlyinclude>'
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': page},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template}}
    catalog = _comparison_catalog()
    return pages, {name: catalog[name] for name in NAMES}


def test_both_retained_paragraphs_compare_exactly_at_three_pieces():
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    assert set(entries) == {name.lower() for name in NAMES}
    assert len(entries) == 2
    report = D.diff(pages, catalog)
    assert set(report['sets']) == set(NAMES)
    assert report['counts']['template'] == {'exact': 2}, report['sets']
    for name, rune, repair in zip(NAMES, (2, 3), (10, 30)):
        assert set(entries[name.lower()]['tiers']) == {3}
        assert len(entries[name.lower()]['tiers'][3]) == 1  # Source stays one paragraph.
        assert set(D.gp_tiers(catalog[name])[3]) == {
            (CRITICAL, 'Artifact', 1), ('Rune Arm DCs', 'Artifact', rune),
            ('Repair Amplification', 'Artifact', repair)}
        assert report['sets'][name]['template'] == {'class': 'exact'}
        assert report['sets'][name]['page'] == {'class': 'no-wiki-name'}


def test_same_split_is_used_for_wiki_to_wiki_comparison():
    # Synthetic named page rows exercise the comparison path. The retained real
    # page lacks these usable identities; this does not change its name matching.
    rows = []
    for name, rune, repair in zip(NAMES, (2, 3), (10, 30)):
        rows.append('|-\n|{{Anchor|' + name + '}}\n|Fixture items\n|3 Pieces Equipped:\n'
                    f'* +1 Artifact Bonus to {CRITICAL}\n'
                    f'* +{rune} Artifact Bonus to Rune Arm DCs\n'
                    f'* +{repair} Artifact Bonus to Repair Amplification')
    page = '{|class="wikitable"\n' + '\n'.join(rows) + '\n|}'
    pages, catalog = fixture(page=page)
    assert D.diff(pages, catalog)['sources_disagree'] == []
    pages[D.PAGE]['wikitext'] = page.replace('+2 Artifact Bonus to Rune Arm DCs',
                                          '+9 Artifact Bonus to Rune Arm DCs')
    disagreements = D.diff(pages, catalog)['sources_disagree']
    assert len(disagreements) == 1, disagreements
    assert disagreements[0]['set'] == NAMES[0].lower()
    assert ('Rune Arm DCs', 'Artifact', 2) in disagreements[0]['template'][3]
    assert ('Rune Arm DCs', 'Artifact', 9) in disagreements[0]['page'][3]


def test_changed_compound_text_stays_whole_and_quarantined():
    # Deliberate unchanged boundaries: splitting these exact entries grants no
    # authority to read a new sentence, condition, alias, value or bonus type.
    for before, after in (
            ('+1 Artifact', '+2 Artifact'), ('+1 Artifact', '+1 Enhancement'),
            ('a 19-20', 'a roll of 19-20'), ('Rune Arm DCs', 'Spell DCs'),
            ('. +', '; +'), ('3 Pieces Equipped: ', '3 Pieces Equipped: While centered, '),
            ('Repair Amplification', 'Repair Amplification while centered'),
            ('Repair Amplification', 'Repair Amplification. Unknown effect'),
            (f'+1 Artifact Bonus to {CRITICAL}. ', ''),
            (f'+1 Artifact Bonus to {CRITICAL}. ', f'+1 Artifact Bonus to {CRITICAL}. ' * 2)):
        pages, catalog = fixture(ENTRIES.replace(before, after))
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        report = D.diff(pages, catalog)
        for name in NAMES:
            result = report['sets'][name]['template']
            assert result['class'] == 'partial', (before, after, name, result)
            assert [q['line'] for q in result['quarantined']] == [
                S.plain(entries[name.lower()]['tiers'][3][0])]


def test_identity_and_threshold_drift_do_not_inherit_the_split():
    for name in NAMES:
        pages, catalog = fixture(ENTRIES.replace(name.lower() + ' =', 'different set ='))
        catalog['Different Set'] = catalog.pop(name)
        assert D.diff(pages, catalog)['sets']['Different Set']['template']['class'] == 'partial'
    pages, catalog = fixture(ENTRIES.replace('set|Renegade Champion (Legendary)', 'set|Different Set'))
    assert D.diff(pages, catalog)['sets'][NAMES[1]]['template']['class'] == 'partial'
    for header, expected in (('2 Pieces Equipped: ', 'threshold-differs'), ('', 'threshold-unstated')):
        pages, catalog = fixture(ENTRIES.replace('3 Pieces Equipped: ', header))
        report = D.diff(pages, catalog)
        assert all(report['sets'][name]['template']['class'] == expected for name in NAMES)


def test_split_keeps_catalog_disagreements_and_vocabulary_quarantine_visible():
    for field, value in (('value', '9'), ('type', 'Enhancement')):
        pages, catalog = fixture()
        for name in NAMES:
            catalog[name][0]['affixes'][1][field] = value
        report = D.diff(pages, catalog)
        for name, rune in zip(NAMES, (2, 3)):
            result = report['sets'][name]['template']
            assert result['class'] == 'ours-differs', result
            assert result['extra'] == [{'threshold': 3, 'affix': ['Rune Arm DCs', 'Artifact', rune]}]
    pages, catalog = fixture()
    for name in NAMES:
        catalog[name][0]['affixes'] = [a for a in catalog[name][0]['affixes'] if a['name'] != 'Rune Arm DCs']
    report = D.diff(pages, catalog)
    for name, rune in zip(NAMES, (2, 3)):
        result = report['sets'][name]['template']
        assert result['class'] == 'partial'
        assert len(result['quarantined']) == 1
        assert result['quarantined'][0]['line'] == f'+{rune} Artifact Bonus to Rune Arm DCs'
        assert 'vocabulary' in result['quarantined'][0]['reason']


def test_comparison_preserves_source_catalog_and_critical_spellings():
    # Deliberate unchanged guard: no production reader or stacking decision.
    pages, catalog = fixture()
    original = copy.deepcopy((pages, catalog))
    names = {a['name'] for tiers in catalog.values() for tier in tiers for a in tier['affixes']}
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    D.diff(pages, catalog)
    assert (pages, catalog) == original
    assert S.template_sets(pages[D.TEMPLATE]['wikitext']) == entries
    for entry in entries.values():
        assert 'quarantine' in S.read_clause(entry['tiers'][3][0], BONUS_TYPES, names)
    for stat in (CRITICAL, 'Critical Multiplier on a roll of 19-20'):
        assert D.comparison_affixes({'name': stat, 'type': 'Artifact', 'value': 1}) == [(stat, 'Artifact', 1)]
