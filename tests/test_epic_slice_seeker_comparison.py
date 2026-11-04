"""#951: jointly evidenced Epic Slice 'n Dice page Seeker, comparison only.

Entries and the full bonus cell are verbatim retained revisions 723530/720202.
The table wrapper and item cell are synthetic, as documented in the evidence note.
"""
import copy
from unittest.mock import patch

from test_wiki_sets import D, S, _comparison_catalog
from src.affix_parser import BONUS_TYPES


NAME = "Epic Slice 'n Dice"
HEROIC = "Slice 'n Dice"
ENTRY = "| slice 'n dice set = While wearing both items from the Slice 'n Dice Set, you gain:<br />+1 [[Quality bonus]] to [[Seeker]]<br />+1 Quality bonus to [[Sneak Attack]]<br />They make julienne fries."
EPIC_ENTRY = "| epic slice 'n dice set = While wearing both items from the Epic Slice 'n Dice Set, you gain:<br />+2 [[Quality bonus]] to [[Seeker]]<br />+2 Quality bonus to [[Sneak Attack]]<br />They make julienne fries."
BONUS = "2 Pieces Equipped:\n* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Seeker]]\n* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Sneak Attack]]\n"
ORIGINAL = '* +2 [[Quality bonus]] bonus to [[Seeker]]'
CORRECTED = '* +2 [[Quality bonus]] to [[Seeker]]'


def fixture():
    template = ('<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + ENTRY + '\n'
                + EPIC_ENTRY + '\n| #default = Undefined set\n}}</onlyinclude>')
    page = ("==The Devil's Gambit sets==\n{|class=\"wikitable\"\n|-\n"
            "|{{Anchor|Slice 'n Dice Set}}{{Anchor|Epic Slice 'n Dice Set}}\n"
            '|Fixture items\n|' + BONUS + '\n|}')
    return {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': page},
            D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template}}, _comparison_catalog()


def page_result(pages, catalog, name=NAME):
    return D.diff(pages, catalog)['sets'][name]['page']


def seeker_unread(result):
    assert any('Seeker' in q['line'] for q in result.get('quarantined', [])), result


def seeker_affix(catalog):
    return next(a for a in catalog[NAME][0]['affixes'] if a['name'] == 'Seeker')


def test_reads_only_the_explicit_quality_seeker_and_stays_partial():
    pages, catalog = fixture()
    r = page_result(pages, catalog)
    assert r['class'] == 'partial'
    assert r['quarantined'] == [{'threshold': 2,
        'line': '+2 Quality bonus bonus to Sneak Attack',
        'reason': "not a typed '+N <Type> bonus to <stat>' clause"}], r
    assert r['name_alias'] == {'wiki_name': "Epic Slice 'n Dice Set", 'page_tier': 'Epic'}
    assert S.read_clause(CORRECTED, BONUS_TYPES, {'Seeker'}) == {
        'affixes': [{'name': 'Seeker', 'type': 'Quality', 'value': 2}]}


def test_catalog_amount_and_type_do_not_supply_the_source_reading():
    for field, value in (('value', '9'), ('type', 'Artifact')):
        pages, catalog = fixture()
        seeker_affix(catalog)[field] = value
        r = page_result(pages, catalog)
        assert r['class'] == 'ours-differs', r
        assert r['extra'] == [{'threshold': 2, 'affix': ['Seeker', 'Quality', 2]}]
        assert len(r['quarantined']) == 1 and 'Sneak Attack' in r['quarantined'][0]['line']


def test_missing_catalog_seeker_is_a_visible_difference():
    pages, catalog = fixture()
    catalog[NAME][0]['affixes'].remove(seeker_affix(catalog))
    r = page_result(pages, catalog)
    assert r['class'] == 'ours-differs', r
    assert r['extra'] == [{'threshold': 2, 'affix': ['Seeker', 'Quality', 2]}]


def test_duplicate_catalog_occurrence_cannot_make_unread_set_exact():
    pages, catalog = fixture()
    catalog[NAME][0]['affixes'].append(copy.deepcopy(seeker_affix(catalog)))
    r = page_result(pages, catalog)
    # Existing classifier keeps catalog remainder uncertain while a clause is
    # unread; do not claim an exact match or infer zero for Sneak Attack.
    assert r['class'] == 'partial' and len(r['quarantined']) == 1, r
    assert 'Sneak Attack' in r['quarantined'][0]['line']


def test_missing_vocabulary_stays_quarantined():
    pages, catalog = fixture()
    for tiers in catalog.values():
        for tier in tiers:
            tier['affixes'] = [a for a in tier['affixes'] if a['name'] != 'Seeker']
    r = page_result(pages, catalog)
    assert r['class'] == 'partial'
    q = next(q for q in r['quarantined'] if 'Seeker' in q['line'])
    assert q['line'] == '+2 Quality bonus to Seeker' and 'vocabulary' in q['reason']


def test_both_source_titles_and_revisions_are_required():
    for source in (D.PAGE, D.TEMPLATE):
        for field, value in (('title', 'Different source'), ('revid', 1)):
            pages, catalog = fixture()
            pages[source][field] = value
            seeker_unread(page_result(pages, catalog))


def test_page_section_anchor_order_tier_and_threshold_are_exact():
    for field, value in (('section', 'Different section'), ('anchors', ["Epic Slice 'n Dice Set", "Slice 'n Dice Set"]),
                         ('anchors', ["Epic Slice 'n Dice Set"]), ('tier', 'Legendary')):
        pages, catalog = fixture()
        rows = S.page_sets(pages[D.PAGE]['wikitext'])
        rows[1][field] = value
        with patch.object(S, 'page_sets', return_value=rows):
            r = page_result(pages, catalog)
        if field == 'tier':
            assert r['class'] == 'no-wiki-name', r
        else:
            seeker_unread(r)
    pages, catalog = fixture()
    pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace('2 Pieces Equipped:', '3 Pieces Equipped:')
    catalog[NAME][0]['threshold'] = 3
    seeker_unread(page_result(pages, catalog))


def test_page_raw_context_values_types_units_and_conditions_refuse_repair():
    mutations = [('+1|+2', '+1|+3'), ('Quality bonus', 'Artifact bonus'),
                 ('+1|+2', '+1|+2%'), ('+1|+2', '+1|+2d6'),
                 ('[[Seeker]]', '[[Seeker]] while centered'),
                 ('* {{HELstats', '* On Vorpal: {{HELstats'),
                 ('* {{HELstats', '* Your summons gain {{HELstats'),
                 ('[[Sneak Attack]]\n', '[[Sneak Attack]]\n* Unknown effect.\n'),
                 ('2 Pieces Equipped:', '2 Pieces Equipped: ')]
    for old, new in mutations:
        pages, catalog = fixture()
        pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace(old, new)
        seeker_unread(page_result(pages, catalog))


def test_template_corroboration_full_context_and_unique_identity_are_required():
    mutations = [('epic slice \'n dice set =', 'different set ='),
                 ('+2 [[Quality bonus]]', '+9 [[Quality bonus]]'),
                 ('+2 [[Quality bonus]]', '+2 [[Artifact bonus]]'),
                 ('+2 [[Quality bonus]]', '+2% [[Quality bonus]]'),
                 ('[[Seeker]]<br', '[[Seeker]] while centered<br'),
                 ('They make julienne fries.', 'Unknown condition.'),
                 ('both items', 'three items'), ('<br />', '<br/>')]
    for old, new in mutations:
        pages, catalog = fixture()
        pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(old, new)
        r = page_result(pages, catalog)
        if old == "epic slice 'n dice set =":
            assert r['class'] == 'no-wiki-name', r
        else:
            seeker_unread(r)
    pages, catalog = fixture()
    pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(EPIC_ENTRY, EPIC_ENTRY + '\n' + EPIC_ENTRY)
    seeker_unread(page_result(pages, catalog))


def test_parsed_drift_cannot_hide_behind_unchanged_raw_context():
    for source in ('page', 'template'):
        pages, catalog = fixture()
        if source == 'page':
            parsed = S.page_sets(pages[D.PAGE]['wikitext'])
            parsed[1]['tiers'][2].append('While centered.')
            target = 'page_sets'
        else:
            parsed = S.template_sets(pages[D.TEMPLATE]['wikitext'])
            parsed["epic slice 'n dice set"]['tiers'][2][0] = '+9 [[Quality bonus]] to [[Seeker]]'
            target = 'template_sets'
        with patch.object(S, target, return_value=parsed):
            seeker_unread(page_result(pages, catalog))


def test_epic_helper_rejects_heroic_and_unrelated_rows_stay_unread():
    pages, catalog = fixture()
    rows = S.page_sets(pages[D.PAGE]['wikitext'])
    heroic = next(row for row in rows if row['tier'] == 'Heroic')
    before = copy.deepcopy(heroic)
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    assert D.comparison_epic_slice_seeker_row(
        heroic, pages[D.PAGE], pages[D.TEMPLATE], entries) is heroic
    assert heroic == before
    # A lookalike row with a different anchor cannot borrow this identity.
    rows[1]['anchors'] = ['Different Set']
    catalog['Different Set'] = catalog.pop(NAME)
    rows[1]['tier'] = None
    with patch.object(S, 'page_sets', return_value=rows):
        seeker_unread(page_result(pages, catalog, 'Different Set'))


def test_raw_sources_parsed_inputs_and_shared_reader_are_unchanged():
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    rows = S.page_sets(pages[D.PAGE]['wikitext'])
    original = copy.deepcopy((pages, catalog, entries, rows))
    with patch.object(S, 'template_sets', return_value=entries), patch.object(S, 'page_sets', return_value=rows):
        D.diff(pages, catalog)
    assert (pages, catalog, entries, rows) == original
    assert 'quarantine' in S.read_clause(ORIGINAL, BONUS_TYPES, {'Seeker'})


def test_epic_uses_its_own_template_not_a_scaled_heroic_amount():
    pages, catalog = fixture()
    pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(
        ENTRY, ENTRY.replace('+1 [[Quality bonus]]', '+9 [[Quality bonus]]'))
    result = page_result(pages, catalog)
    assert result['class'] == 'partial' and len(result['quarantined']) == 1
    assert 'Sneak Attack' in result['quarantined'][0]['line']
    seeker_unread(page_result(pages, catalog, HEROIC))
    assert D.diff(pages, catalog)['sets'][HEROIC]['template']['class'] == 'ours-differs'


def test_both_tiers_require_the_complete_shared_page_context():
    pages, catalog = fixture()
    for name in (NAME, HEROIC):
        result = page_result(pages, catalog, name)
        assert result['class'] == 'partial' and len(result['quarantined']) == 1
        assert 'Sneak Attack' in result['quarantined'][0]['line']
    pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace(
        '[[Seeker]]', '[[Seeker]] while centered')
    for name in (NAME, HEROIC):
        seeker_unread(page_result(pages, catalog, name))
