"""#984: exact parity means equal multisets, not a one-way subset.

These small fixtures are synthetic comparison inputs, not DDO Wiki evidence or
proposed game values. The complete retained-source comparison is checked separately.
"""
import copy
import hashlib

from test_wiki_sets import D
from test_set_count_review import fixture as review_fixture, run_cli


NAMES = {'Strength', 'Dexterity'}
STRENGTH = '+3 Artifact bonus to Strength'
DEXTERITY = '+3 Artifact bonus to Dexterity'


def catalog(*names):
    return D.gp_tiers([{'threshold': 2, 'affixes': [
        {'name': name, 'type': 'Artifact', 'value': 3} for name in names]}])


def unmatched(*names):
    return {'catalog_unmatched': [
        {'threshold': 2, 'affix': [name, 'Artifact', 3]} for name in names]}


def test_catalog_only_stat_is_unmatched_evidence_not_exact():
    result = D.classify({2: [STRENGTH]}, catalog('Strength', 'Dexterity'), NAMES)
    assert result == ('catalog-unmatched', unmatched('Dexterity')), result
    # The report names what the reading lacks; it invents no Wiki zero or value.
    assert result[1]['catalog_unmatched'][0]['affix'][2] == 3


def test_missing_catalog_occurrences_preserve_multiset_multiplicity():
    gp = catalog('Strength', 'Strength', 'Strength')
    result = D.classify({2: [STRENGTH]}, gp, NAMES)
    assert result == ('catalog-unmatched', unmatched('Strength', 'Strength')), result
    assert D.classify({2: [STRENGTH] * 3}, gp, NAMES) == ('exact', {})


def test_empty_wiki_tier_cannot_verify_a_populated_catalog():
    result = D.classify({2: []}, catalog('Strength', 'Dexterity'), NAMES)
    assert result == ('catalog-unmatched', unmatched('Strength', 'Dexterity')), result


def test_wiki_only_occurrences_are_reported_with_their_multiplicity():
    result = D.classify({2: [STRENGTH] * 3}, catalog('Strength'), NAMES)
    assert result[0] == 'ours-differs', result
    assert result[1]['extra'] == [
        {'threshold': 2, 'affix': ['Strength', 'Artifact', 3]}] * 2, result


def test_exact_comparison_is_order_independent_and_checks_each_threshold():
    # Deliberate unchanged boundary: reordering never changes a multiset.
    gp = catalog('Strength', 'Dexterity')
    assert D.classify({2: [DEXTERITY, STRENGTH]}, gp, NAMES) == ('exact', {})
    gp[3] = catalog('Strength')[2]
    result = D.classify({2: [DEXTERITY, STRENGTH], 3: []}, gp, NAMES)
    assert result == ('catalog-unmatched', {
        'catalog_unmatched': [{'threshold': 3, 'affix': ['Strength', 'Artifact', 3]}]}), result


def test_quarantined_text_does_not_turn_an_unread_stat_into_a_source_omission():
    # Deliberate unchanged boundary: an unread clause may contain the catalog
    # field. No reverse difference can certify that the source omits it.
    for unknown in ('An unreviewed effect', 'While centered, ' + DEXTERITY,
                    '+3 Artifact bonus to an unreviewed stat'):
        result = D.classify({2: [STRENGTH, unknown]}, catalog('Strength', 'Dexterity'), NAMES)
        assert result[0] == 'partial', result
        assert len(result[1]['quarantined']) == 1, result
        assert 'catalog_unmatched' not in result[1], result
    assert D.classify({None: [STRENGTH]}, catalog('Strength'), NAMES)[0] == 'threshold-unstated'
    assert D.classify({3: [STRENGTH]}, catalog('Strength'), NAMES)[0] == 'threshold-differs'


def test_wiki_only_differences_and_recorded_value_rulings_keep_their_classes():
    # Deliberate unchanged boundaries: a reviewed differing value is not exact,
    # and the reverse side of that same difference must not erase its ruling.
    gp = catalog('Strength')
    result = D.classify({2: [STRENGTH, DEXTERITY]}, gp, NAMES)
    assert result[0] == 'ours-differs'
    assert result[1]['extra'] == [{'threshold': 2, 'affix': ['Dexterity', 'Artifact', 3]}]
    wiki = {2: ['+4 Artifact bonus to Strength']}
    disagreement = [{'set': 'Fixture', 'threshold': 2, 'name': 'Strength', 'template': 4, 'page': 3}]
    stale = [{'set': 'Fixture', 'threshold': 2, 'name': 'Strength', 'type': 'Artifact',
              'wiki': 4, 'gear_planner': 3}]
    assert D.classify(wiki, gp, NAMES, 'Fixture', disagreement)[0] == 'wiki-disagrees'
    assert D.classify(wiki, gp, NAMES, 'Fixture', (), stale)[0] == 'upstream-stale'
    assert D.classify(wiki, gp, NAMES, 'Unreviewed', disagreement, stale)[0] == 'ours-differs'


def comparison_fixture():
    pages, gp, review = review_fixture()
    name = 'Comparison equality fixture'
    pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(
        '| #default =', '| comparison equality fixture = 2 Pieces Equipped: ' + STRENGTH + '\n| #default =')
    pages[D.PAGE]['wikitext'] += '\n{|class="wikitable"\n|-\n|{{Anchor|' + name + '}}\n|Fixture items\n|2 Pieces Equipped:\n* ' + STRENGTH + '\n|}\n'
    gp[name] = [{'threshold': 2, 'affixes': [
        {'name': stat, 'type': 'Artifact', 'value': 3} for stat in ('Strength', 'Dexterity')]}]
    for source, title in (('template', D.TEMPLATE), ('page', D.PAGE)):
        review['sources'][source]['sha256'] = hashlib.sha256(pages[title]['wikitext'].encode()).hexdigest()
    return pages, gp, review, name


def test_both_source_reports_and_cli_formats_expose_catalog_unmatched():
    pages, gp, review, name = comparison_fixture()
    code, report = run_cli(pages, gp, review)
    assert code == 0, report  # Complete evidence review is distinct from parity.
    assert name in report['sets']
    for source in ('template', 'page'):
        result = report['sets'][name][source]
        assert result == {'class': 'catalog-unmatched', **unmatched('Dexterity')}, (source, result)
        assert report['counts'][source]['catalog-unmatched'] == 1
    code, text = run_cli(pages, gp, review, as_json=False)
    assert code == 0, text
    assert text.count('catalog-unmatched') == 2, text
    assert text.count(name + ':') == 2, text
    assert text.count('catalog_unmatched') == 2, text


def test_classification_does_not_rewrite_either_comparison_input():
    # Deliberate unchanged boundary: comparison never supplies game data.
    wiki, gp = {2: [STRENGTH]}, catalog('Strength', 'Dexterity')
    before = copy.deepcopy((wiki, gp))
    D.classify(wiki, gp, NAMES)
    assert (wiki, gp) == before
