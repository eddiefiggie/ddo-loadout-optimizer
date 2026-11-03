"""#951: one retained Profane Experiment spelling, in comparison only.

The switch entries are verbatim Template:Named item sets rev 723530. The page
bonus cell is verbatim Named item sets rev 720202; surrounding wrappers and the
item cell are synthetic. See docs/wiki-evidence/profane-experiment-comparison.md.
"""
import copy
from unittest.mock import patch

from test_wiki_sets import D, S, _comparison_catalog
from src.affix_parser import BONUS_TYPES


NAME = 'Profane Experiment'
LEGENDARY = 'Legendary Profane Experiment'
CLAUSE = '+1 Artifact bonus to [[Imbue]] dice.'
ENTRY = '| profane experiment = {{#vardefine:set|Profane Experiment}}3 Pieces Equipped: <br />+10% Artifact bonus to Doublestrike and Doubleshot. <br />+2 Artifact bonus to Constitution and Intelligence. <br />+25 Artifact bonus to Universal Spell Power. <br/>+1 Artifact bonus to [[Imbue]] dice.'
LEGENDARY_ENTRY = '| legendary profane experiment = {{#vardefine:set|Legendary Profane Experiment}}3 Pieces Equipped:<br />+3 Artifact bonus to Imbue Dice.<br />+15% Artifact bonus to Doublestrike and Doubleshot.<br />+3 Artifact bonus to Constitution and Intelligence.<br />+25 Artifact bonus to each Spell Power.'
PAGE_BONUS = '\n3 Pieces Equipped:\n* {{HELstats|+10%|L=+15%}} Artifact bonus to Doublestrike and Doubleshot \n* {{HELstats|+2|L=+3}} Artifact bonus to Constitution and Intelligence\n* +25 Artifact bonus to each Spell Power \n* {{HELstats|+1|L=+3}} Artifact bonus to Imbue Dice'


def fixture(entry=ENTRY):
    template = ('<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + entry + '\n'
                + LEGENDARY_ENTRY + '\n| #default = Undefined set\n}}</onlyinclude>')
    page = ('==The Soul Splitter sets==\n{|class="wikitable"\n|-\n'
            '|{{Anchor|Profane Experiment}}{{Anchor|Legendary Profane Experiment}}\n'
            '|Fixture items\n|' + PAGE_BONUS + '\n|}')
    return {D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template},
            D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': page}}, _comparison_catalog()


def target_quarantine(report, name=NAME):
    result = report['sets'][name]['template']
    quarantined = [q for q in result.get('quarantined', []) if 'Imbue' in q['line']]
    assert quarantined, result
    return quarantined


def test_the_retained_entry_reads_all_six_explicit_fields():
    pages, catalog = fixture()
    assert NAME in catalog and LEGENDARY in catalog
    assert D.gp_tiers(catalog[NAME]) == {3: {
        ('Doublestrike', 'Artifact', 10): 1, ('Doubleshot', 'Artifact', 10): 1,
        ('Constitution', 'Artifact', 2): 1, ('Intelligence', 'Artifact', 2): 1,
        ('Universal Spell Power', 'Artifact', 25): 1, ('Imbue Dice', 'Artifact', 1): 1}}
    report = D.diff(pages, catalog)
    assert report['sets'][NAME]['template'] == {'class': 'exact'}
    assert report['sets'][LEGENDARY]['template'] == {'class': 'exact'}
    for name in (NAME, LEGENDARY):
        assert report['sets'][name]['page'] == {'class': 'no-wiki-name'}
    assert report['sources_disagree'] == []


def test_catalog_values_and_types_do_not_supply_the_source_bonus():
    for field, value in (('value', '9'), ('type', 'Quality')):
        pages, catalog = fixture()
        catalog[NAME][0]['affixes'][-1][field] = value
        result = D.diff(pages, catalog)['sets'][NAME]['template']
        assert result['class'] == 'ours-differs', result
        assert result['extra'] == [{'threshold': 3, 'affix': ['Imbue Dice', 'Artifact', 1]}]
        assert result['quarantined'] == []


def test_missing_and_duplicate_catalog_occurrences_stay_visible():
    pages, catalog = fixture()
    catalog[NAME][0]['affixes'].pop()
    result = D.diff(pages, catalog)['sets'][NAME]['template']
    assert result['class'] == 'ours-differs', result
    assert result['extra'] == [{'threshold': 3, 'affix': ['Imbue Dice', 'Artifact', 1]}]
    pages, catalog = fixture()
    catalog[NAME][0]['affixes'].extend([copy.deepcopy(catalog[NAME][0]['affixes'][-1])] * 2)
    assert D.diff(pages, catalog)['sets'][NAME]['template'] == {
        'class': 'catalog-unmatched', 'catalog_unmatched': [
            {'threshold': 3, 'affix': ['Imbue Dice', 'Artifact', 1]}] * 2}


def test_missing_vocabulary_stays_quarantined_not_zero_or_exact():
    pages, catalog = fixture()
    for tiers in catalog.values():
        for tier in tiers:
            tier['affixes'] = [a for a in tier['affixes'] if a['name'] != 'Imbue Dice']
    result = D.diff(pages, catalog)['sets'][NAME]['template']
    assert result['class'] == 'partial'
    assert len(result['quarantined']) == 1
    q = result['quarantined'][0]
    assert q['line'] == '+1 Artifact bonus to Imbue Dice.'
    assert 'vocabulary' in q['reason']


def test_identity_revision_and_display_name_do_not_inherit_the_reading():
    # Keep a matching catalog name so name-mismatch alone cannot pass this guard.
    for entry in (ENTRY.replace('profane experiment =', 'different set ='),
                  ENTRY.replace(NAME, 'Different Set').replace(NAME.lower(), 'different set')):
        pages, catalog = fixture(entry)
        catalog['Different Set'] = catalog.pop(NAME)
        assert target_quarantine(D.diff(pages, catalog), 'Different Set')[0]['line'] == S.plain(CLAUSE)
    for field, value in (('title', 'Different source'), ('revid', 1)):
        pages, catalog = fixture()
        pages[D.TEMPLATE][field] = value
        assert target_quarantine(D.diff(pages, catalog))[0]['line'] == S.plain(CLAUSE)
    pages, catalog = fixture(ENTRY.replace('set|' + NAME, 'set|Different Set'))
    assert target_quarantine(D.diff(pages, catalog))[0]['line'] == S.plain(CLAUSE)


def test_changed_threshold_and_full_raw_context_refuse_the_reading():
    pages, catalog = fixture(ENTRY.replace('3 Pieces Equipped:', '4 Pieces Equipped:'))
    catalog[NAME][0]['threshold'] = 4
    q = target_quarantine(D.diff(pages, catalog))
    assert q[0]['threshold'] == 4 and q[0]['line'] == S.plain(CLAUSE)
    for before, after in (('+10% Artifact', '+11% Artifact'),
                          (' <br/>', '  <br/>'),
                          ('<br/>', '<br />'),
                          (CLAUSE, CLAUSE + '<br/>Unknown effect.')):
        pages, catalog = fixture(ENTRY.replace(before, after))
        assert target_quarantine(D.diff(pages, catalog))[0]['line'] == S.plain(CLAUSE)


def test_changed_values_types_units_and_conditional_or_proc_words_stay_unread():
    for replacement in ('+2 Artifact bonus to [[Imbue]] dice.',
                        '+1 Quality bonus to [[Imbue]] dice.',
                        '+1% Artifact bonus to [[Imbue]] dice.',
                        '+1d6 Artifact bonus to [[Imbue]] dice.',
                        '+1 Artifact bonus to [[Imbue]] dice (d6).',
                        '+1 Artifact bonus to [[Imbue]] dice while centered.',
                        'While centered, ' + CLAUSE,
                        'On Vorpal: ' + CLAUSE,
                        'Your summons gain ' + CLAUSE,
                        'You gain ' + CLAUSE):
        pages, catalog = fixture(ENTRY.replace(CLAUSE, replacement))
        q = target_quarantine(D.diff(pages, catalog))
        assert q and q[0]['line'] == S.plain(replacement), (replacement, q)


def test_legendary_and_other_entries_receive_no_generic_case_rule():
    pages, catalog = fixture()
    pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(
        '+3 Artifact bonus to Imbue Dice.', '+3 Artifact bonus to Imbue dice.')
    report = D.diff(pages, catalog)
    assert report['sets'][NAME]['template'] == {'class': 'exact'}
    assert target_quarantine(report, LEGENDARY)[0]['line'] == '+3 Artifact bonus to Imbue dice.'


def test_parsed_tier_drift_cannot_hide_behind_an_unchanged_raw_hash():
    # Unchanged boundary: the full raw hash is not enough if parsed lines drift.
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    entries[NAME.lower()]['tiers'][3][0] = '+11% Artifact bonus to Doublestrike and Doubleshot.'
    with patch.object(S, 'template_sets', return_value=entries):
        assert target_quarantine(D.diff(pages, catalog))[0]['line'] == S.plain(CLAUSE)


def test_comparison_preserves_sources_inputs_and_the_shared_reader():
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    rows = S.page_sets(pages[D.PAGE]['wikitext'])
    original = copy.deepcopy((pages, catalog, entries, rows))
    with patch.object(S, 'template_sets', return_value=entries), patch.object(S, 'page_sets', return_value=rows):
        D.diff(pages, catalog)
    assert (pages, catalog, entries, rows) == original
    names = {a['name'] for tiers in catalog.values() for tier in tiers for a in tier['affixes']}
    assert 'quarantine' in S.read_clause(CLAUSE, BONUS_TYPES, names)
