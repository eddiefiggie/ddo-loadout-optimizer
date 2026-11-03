"""#951: read only two retained Silent Avenger entries, in comparison copies.

Entries are verbatim Template:Named item sets revision 723530. The outer switch
wrapper is synthetic; no page identity or live-game mechanic is inferred.
See docs/wiki-evidence/silent-avenger-comparison.md.
"""
import copy
from unittest.mock import patch

from test_wiki_sets import D, S, _comparison_catalog
from src.affix_parser import BONUS_TYPES


ENTRIES = """  | silent avenger set (heroic) = 3 Pieces Equipped:<br />You gain a 5% [[Artifact Bonus]] to [[Doublestrike]] and [[Doubleshot]].<br />You gain +1 Artifact Bonus to Sneak Attack Dice.<br />You gain a 10% Artifact Bonus to Fortification Bypass.<br />You gain +5% Artifact Bonus to Damage vs. Helpless opponents.{{#vardefine:set|Silent Avenger Set (Heroic)}}
  | silent avenger set (legendary) = 3 Pieces Equipped:<br />You gain a 15% [[Artifact Bonus]] to [[Doublestrike]] and [[Doubleshot]].<br />You gain +3 Artifact Bonus to Sneak Attack Dice.<br />You gain a 30% Artifact Bonus to Fortification Bypass.<br />You gain +15% Artifact Bonus to Damage vs. Helpless opponents.{{#vardefine:set|Silent Avenger Set (Legendary)}}"""
CASES = (('Silent Avenger Set (Heroic)', 5, 1, 10),
         ('Silent Avenger Set (Legendary)', 15, 3, 30))


def fixture(entries=ENTRIES):
    template = '<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + entries + '\n| #default = Undefined set\n}}</onlyinclude>'
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': ''},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template}}
    catalog = _comparison_catalog()
    return pages, {name: catalog[name] for name, _, _, _ in CASES}


def assert_whole_entry_quarantined(report, name, entry, threshold=3):
    result = report['sets'][name]['template']
    assert result['class'] == 'partial', result
    assert len(result['quarantined']) == 4
    assert result['quarantined'] == [
        {'threshold': threshold, 'line': S.plain(line),
         'reason': "not a typed '+N <Type> bonus to <stat>' clause"}
        for line in entry['tiers'][threshold]]


def test_both_retained_entries_read_all_five_explicit_fields():
    pages, catalog = fixture()
    report = D.diff(pages, catalog)
    assert report['counts']['template'] == {'exact': 2}
    for name, percent, dice, bypass in CASES:
        assert D.gp_tiers(catalog[name])[3] == {
            ('Doublestrike', 'Artifact', percent): 1,
            ('Doubleshot', 'Artifact', percent): 1,
            ('Sneak Attack Dice', 'Artifact', dice): 1,
            ('Armor-Piercing', 'Artifact', bypass): 1,
            ('Damage vs. the Helpless', 'Artifact', percent): 1}
        assert report['sets'][name] == {
            'template': {'class': 'exact'}, 'page': {'class': 'no-wiki-name'}}
    assert report['sources_disagree'] == []  # No page identity is supplied.


def test_catalog_amount_or_type_does_not_replace_source_fields():
    for field, value in (('value', '99'), ('type', 'Enhancement')):
        pages, catalog = fixture()
        for tiers in catalog.values():
            tiers[0]['affixes'][0][field] = value
        report = D.diff(pages, catalog)
        for name, percent, _, _ in CASES:
            result = report['sets'][name]['template']
            assert result['class'] == 'ours-differs', result
            assert result['extra'] == [{'threshold': 3, 'affix': ['Doublestrike', 'Artifact', percent]}]
            assert result['quarantined'] == []


def test_extra_catalog_occurrences_remain_unmatched():
    pages, catalog = fixture()
    for tiers in catalog.values():
        tiers[0]['affixes'].extend([copy.deepcopy(tiers[0]['affixes'][0])] * 2)
    report = D.diff(pages, catalog)
    for name, percent, _, _ in CASES:
        assert report['sets'][name]['template'] == {
            'class': 'catalog-unmatched', 'catalog_unmatched': [
                {'threshold': 3, 'affix': ['Doublestrike', 'Artifact', percent]}] * 2}


def test_missing_vocabulary_quarantines_the_named_field():
    pages, catalog = fixture()
    for tiers in catalog.values():
        tiers[0]['affixes'] = [a for a in tiers[0]['affixes'] if a['name'] != 'Sneak Attack Dice']
    report = D.diff(pages, catalog)
    for name, _, dice, _ in CASES:
        result = report['sets'][name]['template']
        assert result['class'] == 'partial'
        assert len(result['quarantined']) == 1
        assert result['quarantined'][0]['line'] == f'+{dice} Artifact Bonus to Sneak Attack Dice.'
        assert 'vocabulary' in result['quarantined'][0]['reason']


def test_each_entry_has_independent_positive_and_negative_coverage():
    for name, _, dice, _ in CASES:
        pages, catalog = fixture(ENTRIES.replace(f'+{dice} Artifact Bonus to Sneak Attack Dice',
                                                '+99 Artifact Bonus to Sneak Attack Dice'))
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        report = D.diff(pages, catalog)
        assert_whole_entry_quarantined(report, name, entries[name.lower()])
        other = next(n for n, _, _, _ in CASES if n != name)
        assert report['sets'][other]['template'] == {'class': 'exact'}


def test_changed_identity_metadata_and_revision_do_not_inherit_reading():
    # Unchanged boundaries: a name miss alone would not test the allowlist.
    for name, _, _, _ in CASES:
        pages, catalog = fixture(ENTRIES.replace('| ' + name.lower() + ' =', '| different set ='))
        catalog['Different Set'] = catalog.pop(name)
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        assert_whole_entry_quarantined(D.diff(pages, catalog), 'Different Set', entries['different set'])
        pages, catalog = fixture(ENTRIES.replace('set|' + name + '}', 'set|Different Set}'))
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        assert_whole_entry_quarantined(D.diff(pages, catalog), name, entries[name.lower()])
    for field, value in (('title', 'Different source'), ('revid', 1)):
        pages, catalog = fixture()
        pages[D.TEMPLATE][field] = value
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        report = D.diff(pages, catalog)
        for name, _, _, _ in CASES:
            assert_whole_entry_quarantined(report, name, entries[name.lower()])


def test_changed_values_units_types_and_conditional_or_proc_words_stay_whole():
    # Unchanged boundaries: no generic prefix stripping or sneak-field alias.
    for before, after in (
            ('Artifact', 'Enhancement'), ('5%', '6%'), ('10%', '11%'), ('30%', '31%'),
            ('+1 Artifact', '+9 Artifact'), ('+3 Artifact', '+9 Artifact'),
            ('% ', ' '), ('Sneak Attack Dice.', 'Sneak Attack.'),
            ('Sneak Attack Dice.', 'Sneak Attack Damage.'), ('Sneak Attack Dice.', 'Deception.'),
            ('Sneak Attack Dice.', 'Sneak Attack Dice while centered.'),
            ('You gain a ', 'You gain On Vorpal: '), ('You gain +', 'While centered, you gain +'),
            ('You gain', 'Your summons gain'), ('You gain', 'you gain')):
        pages, catalog = fixture(ENTRIES.replace(before, after))
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        original = S.template_sets(fixture()[0][D.TEMPLATE]['wikitext'])
        report = D.diff(pages, catalog)
        for name, _, _, _ in CASES:
            if entries[name.lower()] != original[name.lower()]:
                assert_whole_entry_quarantined(report, name, entries[name.lower()])


def test_changed_threshold_or_surrounding_raw_context_stays_unreviewed():
    # Unchanged boundary: agreeing catalog counts do not supply authorization.
    pages, catalog = fixture(ENTRIES.replace('3 Pieces Equipped:', '2 Pieces Equipped:'))
    for tiers in catalog.values():
        tiers[0]['threshold'] = 2
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    report = D.diff(pages, catalog)
    for name, _, _, _ in CASES:
        assert_whole_entry_quarantined(report, name, entries[name.lower()], threshold=2)
    for before, after in (('<br />You gain', '<br /> You gain'),
                          ('3 Pieces Equipped:', '3 Pieces Equipped:<!-- Changed context -->')):
        pages, catalog = fixture(ENTRIES.replace(before, after))
        entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
        report = D.diff(pages, catalog)
        for name, _, _, _ in CASES:
            assert_whole_entry_quarantined(report, name, entries[name.lower()])


def test_comparison_preserves_inputs_and_shared_reader_boundaries():
    # Unchanged boundary: a comparison copy must not mutate parsed source either.
    pages, catalog = fixture()
    entries = S.template_sets(pages[D.TEMPLATE]['wikitext'])
    original = copy.deepcopy((pages, catalog, entries))
    with patch.object(S, 'template_sets', return_value=entries):
        D.diff(pages, catalog)
    assert (pages, catalog, entries) == original
    names = {a['name'] for ts in catalog.values() for t in ts for a in t['affixes']}
    for entry in entries.values():
        assert len(entry['tiers'][3]) == 4
        assert all('quarantine' in S.read_clause(line, BONUS_TYPES, names) for line in entry['tiers'][3])
