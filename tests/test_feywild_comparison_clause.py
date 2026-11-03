"""#951: the retained Feywild six-piece spelling, in comparison only.

Bonus text is verbatim Named item sets rev 720202 / Template rev 723530.
The surrounding table, item cell and switch wrapper are synthetic fixtures.
See docs/wiki-evidence/feywild-six-piece-clause.md.
"""
import copy
from unittest.mock import patch

from test_wiki_sets import D, S, _comparison_catalog
from src.affix_parser import BONUS_TYPES


NAME = 'Seasons of the Feywild'
CLAUSE = '+1 Artifact bonus to all spell DCs'
TEMPLATE_ENTRY = '| seasons of the feywild =<span style="text-align:left;"><ul><li>2 Pieces Equipped: +10 Artifact bonus to your maximum Hit Points</li><li>3 Pieces Equipped: +50 Artifact bonus to your maximum Spell Points.</li><li>4 Pieces Equipped: +1 Artifact bonus to all of your Ability Scores</li><li>5 Pieces Equipped: +1% Artifact bonus to Dodge</li><li>6 Pieces Equipped: +1 Artifact bonus to all spell DCs</li><li>7 Pieces Equipped: +5 Artifact bonus to Physical and Magical Resistance Rating</li></ul></span>{{#vardefine:set|Seasons of the Feywild}}'
PAGE_BONUS = '\n2 Pieces Equipped: \n* +10 Artifact bonus to your maximum hit points\n\n3 Pieces Equipped:\n* +50 Artifact bonus to your maximum Spell Points\n\n4 Pieces Equipped:\n* +1 Artifact bonus to all of your Ability Scores\n\n5 Pieces Equipped:\n* +1% Artifact bonus to Dodge\n\n6 Pieces Equipped:\n* +1 Artifact bonus to all spell DCs\n\n7 Pieces Equipped:\n* +5 Artifact bonus to Physical and Magical Resistance Rating\n'
SOURCES = ((D.TEMPLATE, 'template'), (D.PAGE, 'page'))


def fixture():
    template = '<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + TEMPLATE_ENTRY + '\n| #default = Undefined set\n}}</onlyinclude>'
    page = ('==Fables of the Feywild sets==\n{|class="wikitable"\n|-\n'
            '|{{Anchor|Seasons of the Feywild}}\n|Fixture items\n|' + PAGE_BONUS + '\n|}')
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': page},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template}}
    # Preserve the real catalog's complete stat vocabulary (including the two
    # resistance ratings); its other sets have no source entries in this fixture.
    return pages, _comparison_catalog()


def quarantined(report, source, name=NAME):
    result = report['sets'][name][source]
    assert result['class'] == 'partial', result
    return {q['threshold']: q['line'] for q in result['quarantined']}


def test_both_retained_sources_read_only_the_six_piece_clause():
    pages, catalog = fixture()
    report = D.diff(pages, catalog)
    assert D.gp_tiers(catalog[NAME])[6] == {('Spell Focus Mastery', 'Artifact', 1): 1}
    for source, label in SOURCES:
        expected = '+50 Artifact bonus to your maximum Spell Points' + ('.' if label == 'template' else '')
        assert quarantined(report, label) == {3: expected}
        assert report['counts'][label]['partial'] == 1
    assert report['sources_disagree'] == []  # The independent unread tier remains.


def test_catalog_amount_and_type_never_supply_the_source_bonus():
    for field, value in (('value', '9'), ('type', 'Enhancement')):
        pages, catalog = fixture()
        catalog[NAME][4]['affixes'][0][field] = value
        report = D.diff(pages, catalog)
        for _, label in SOURCES:
            result = report['sets'][NAME][label]
            assert result['class'] == 'ours-differs', result
            assert result['extra'] == [{'threshold': 6, 'affix': ['Spell Focus Mastery', 'Artifact', 1]}]
            assert [q['threshold'] for q in result['quarantined']] == [3]


def test_each_source_has_independent_positive_and_negative_coverage():
    for source, label in SOURCES:
        pages, catalog = fixture()
        pages[source]['wikitext'] = pages[source]['wikitext'].replace(CLAUSE, 'While centered, ' + CLAUSE)
        report = D.diff(pages, catalog)
        other = 'page' if label == 'template' else 'template'
        assert set(quarantined(report, label)) == {3, 6}
        assert set(quarantined(report, other)) == {3}


def test_missing_vocabulary_stays_unknown_not_zero_or_exact():
    # Unchanged boundary: even reviewed text must pass the existing vocabulary gate.
    pages, catalog = fixture()
    for tiers in catalog.values():
        for tier in tiers:
            tier['affixes'] = [a for a in tier['affixes'] if a['name'] != 'Spell Focus Mastery']
    report = D.diff(pages, catalog)
    for _, label in SOURCES:
        assert set(quarantined(report, label)) == {3, 6}
        assert 'vocabulary' in report['sets'][NAME][label]['quarantined'][1]['reason']


def test_unreviewed_values_types_units_words_and_conditions_stay_quarantined():
    # Unchanged boundaries: these are not new aliases or generic case folding.
    for replacement in ('+9 Artifact bonus to all spell DCs',
                        '+1 Enhancement bonus to all spell DCs',
                        '+1% Artifact bonus to all spell DCs',
                        '+1 Artifact bonus to all DCs',
                        '+1 Artifact bonus to all tactical DCs',
                        '+1 Artifact bonus to ALL SPELL DCS',
                        'While centered, ' + CLAUSE,
                        CLAUSE + ' while centered',
                        CLAUSE + '. Unknown effect'):
        pages, catalog = fixture()
        for source, _ in SOURCES:
            pages[source]['wikitext'] = pages[source]['wikitext'].replace(CLAUSE, replacement)
        report = D.diff(pages, catalog)
        for _, label in SOURCES:
            assert quarantined(report, label).get(6) == replacement


def test_identity_revision_and_page_context_do_not_inherit_the_reading():
    # Unchanged boundaries; match the altered catalog identity to avoid a vacuous name miss.
    pages, catalog = fixture()
    for source, _ in SOURCES:
        pages[source]['wikitext'] = pages[source]['wikitext'].replace(NAME, 'Different Set').replace(NAME.lower(), 'different set')
    catalog['Different Set'] = catalog.pop(NAME)
    report = D.diff(pages, catalog)
    for _, label in SOURCES:
        assert quarantined(report, label, 'Different Set').get(6) == CLAUSE
    for source, label in SOURCES:
        for field, value in (('title', 'Different source'), ('revid', 1)):
            pages, catalog = fixture()
            pages[source][field] = value
            assert quarantined(D.diff(pages, catalog), label).get(6) == CLAUSE
    for source, label, before, after in (
            (D.TEMPLATE, 'template', 'set|' + NAME, 'set|Different Set'),
            (D.PAGE, 'page', 'Fables of the Feywild sets', 'Different section'),
            (D.PAGE, 'page', '{{Anchor|' + NAME + '}}', '{{Anchor|' + NAME + '}}{{Anchor|Another name}}')):
        pages, catalog = fixture()
        pages[source]['wikitext'] = pages[source]['wikitext'].replace(before, after)
        assert quarantined(D.diff(pages, catalog), label).get(6) == CLAUSE


def test_changed_threshold_and_other_raw_text_do_not_inherit_the_reading():
    # Unchanged boundary: matching catalog counts do not authorize an eight-piece reading.
    pages, catalog = fixture()
    for source, _ in SOURCES:
        pages[source]['wikitext'] = pages[source]['wikitext'].replace('6 Pieces Equipped:', '8 Pieces Equipped:')
    catalog[NAME][4]['threshold'] = 8
    report = D.diff(pages, catalog)
    for _, label in SOURCES:
        assert quarantined(report, label).get(8) == CLAUSE
    for before, after in (('+50 Artifact', '+51 Artifact'), (CLAUSE, CLAUSE + ' ')):
        pages, catalog = fixture()
        for source, _ in SOURCES:
            pages[source]['wikitext'] = pages[source]['wikitext'].replace(before, after)
        report = D.diff(pages, catalog)
        for _, label in SOURCES:
            assert quarantined(report, label).get(6) == CLAUSE


def test_comparison_preserves_sources_entries_and_shared_reader():
    # Unchanged boundary: the comparison copy must not mutate even parsed input.
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    rows = S.page_sets(pages[D.PAGE]['wikitext'])
    original = copy.deepcopy((pages, catalog, entries, rows))
    with patch.object(S, 'template_sets', return_value=entries), patch.object(S, 'page_sets', return_value=rows):
        D.diff(pages, catalog)
    assert (pages, catalog, entries, rows) == original
    names = {a['name'] for ts in catalog.values() for t in ts for a in t['affixes']}
    for entry in (entries[NAME.lower()], rows[0]):
        assert 'quarantine' in S.read_clause(entry['tiers'][6][0], BONUS_TYPES, names)
