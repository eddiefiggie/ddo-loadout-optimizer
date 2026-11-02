"""#951: only retained, explicitly spell-only FIVE-piece Abishai context is read."""
import copy
import hashlib
import json
from pathlib import Path

from src import wiki_sets as W
from src.affix_parser import BONUS_TYPES
from natural_armor_fixture import catalog_rows
from test_natural_armor_sets import sources
from test_set_count_review import D, run_cli

NAMES = ('Might of the Abishai', 'Epic Might of the Abishai', 'Legendary Might of the Abishai')
NOTE = "''('''Note:''' Tactical DCs are not affected, only Spell DCs)''"


def fixture():
    return sources(), catalog_rows()


def invoke(pages, catalog, as_json=True):
    # Refresh the unrelated whole-source gate to prove this guard independently.
    review = {'schema_version': 1, 'findings': {}, 'sources': {},
              'records': {'template': {}, 'page': {}}}
    for source, title in [('template', D.TEMPLATE), ('page', D.PAGE)]:
        review['sources'][source] = {'revid': pages[title]['revid'],
            'sha256': hashlib.sha256(pages[title]['wikitext'].encode()).hexdigest()}
    return run_cli(pages, catalog, review, as_json)


def assert_rejected(pages, catalog):
    for as_json in [True, False]:
        code, output = invoke(pages, catalog, as_json)
        assert code == 1, output
        if as_json:
            assert output['count_review']['complete'] is True
            assert output.get('abishai_dc_review', {}).get('complete') is False, output
            for name in NAMES:
                assert not output['sets'].get(name, {}).get('template', {}).get('spell_dc_rulings')
        else:
            assert 'Abishai DC ruling is stale or unsupported' in output, output


def test_three_exact_five_piece_clauses_read_without_rewriting_either_input():
    pages, catalog = fixture()
    before = copy.deepcopy((pages, catalog))
    code, report = invoke(pages, catalog)
    assert code == 0
    review = report.get('abishai_dc_review', {})
    assert review.get('complete') is True
    assert len(review.get('verified', [])) == review.get('reviewed_clauses') == 3
    for name, amount in zip(NAMES, [2, 2, 3]):
        rec = report['sets'][name]['template']
        assert rec['class'] == 'partial'
        assert rec.get('spell_dc_rulings') == [{'threshold': 5,
            'line': f'+{amount} Profane bonus to DCs',
            'scope': 'Spell DCs only; tactical DCs excluded'}]
        dc = [q for q in rec['quarantined'] if 'DCs' in q['line']]
        assert len(dc) == 1 and dc[0]['threshold'] == 3, dc
        assert report['sets'][name]['page'] == {'class': 'no-wiki-name'}
    assert (pages, catalog) == before


def test_plain_dcs_other_sets_and_added_conditions_remain_uninterpreted():
    # Deliberate unchanged behavior: only the comparison context grants scope.
    vocab = {'Spell Focus Mastery', 'Combat Mastery', 'Assassinate', 'Rune Arm Focus'}
    for phrase in ['DCs', 'DCs while raging', 'DCs for your pet', 'DCs against undead']:
        assert 'quarantine' in W.read_clause('+2 Profane bonus to ' + phrase, BONUS_TYPES, vocab)
    pages, catalog = fixture()
    pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace('| #default',
        '| unrelated = {{#vardefine:set|Unrelated}}5 Pieces Equipped:<br>+2 Profane bonus to DCs\n| #default')
    catalog['Unrelated'] = [{'threshold': 5, 'affixes': [
        {'name': 'Spell Focus Mastery', 'type': 'Profane', 'value': '2'}]}]
    code, report = invoke(pages, catalog)
    assert code == 0
    other = report['sets']['Unrelated']['template']
    assert other['class'] == 'partial' and len(other['quarantined']) == 1
    assert 'spell_dc_rulings' not in other


def page_mutations():
    for kind in ['note missing', 'note changed', 'note moved', 'note duplicated',
                 'value', 'type', 'percent', 'condition', 'threshold', 'anchor', 'duplicate anchor', 'duplicate row']:
        pages, catalog = fixture()
        text = pages[D.PAGE]['wikitext']
        five = '* {{HELstats|+2|+2|+3}} Profane bonus to DCs ' + NOTE
        assert five in text
        if kind == 'note missing': text = text.replace(' ' + NOTE, '')
        elif kind == 'note changed': text = text.replace('only Spell DCs', 'only Tactical DCs')
        elif kind == 'note moved':
            text = text.replace(' ' + NOTE, '').replace('Profane bonus to DCs.', 'Profane bonus to DCs. ' + NOTE)
        elif kind == 'note duplicated': text = text.replace(NOTE, NOTE + ' ' + NOTE)
        elif kind == 'value': text = text.replace(five, five.replace('+2|+2|+3', '+9|+9|+9'))
        elif kind == 'type': text = text.replace(five, five.replace('Profane', 'Artifact'))
        elif kind == 'percent': text = text.replace(five, five.replace('+2|+2|+3', '+2%|+2%|+3%'))
        elif kind == 'condition': text = text.replace(five, five + ' while raging')
        elif kind == 'threshold': text = text.replace('5 Pieces Equipped:', '4 Pieces Equipped:')
        elif kind == 'anchor': text = text.replace('{{Anchor|Might of the Abishai}}', '{{Anchor|Other Abishai}}')
        elif kind == 'duplicate anchor': text = text.replace('{{Anchor|Might of the Abishai}}', '{{Anchor|Might of the Abishai}}' * 2)
        else:
            row = text.split('|-\n', 1)[1].split('\n|-', 1)[0]
            text = text.replace('|-\n', '|-\n' + row + '\n|-\n', 1)
        pages[D.PAGE]['wikitext'] = text
        yield kind, pages, catalog


def test_page_note_and_scope_mutations_fail_both_cli_modes_and_restore():
    for kind, pages, catalog in page_mutations():
        assert_rejected(pages, catalog)
    assert invoke(*fixture())[0] == 0


def template_mutations():
    for kind in ['value', 'type', 'percent', 'condition', 'threshold', 'missing clause',
                 'duplicate clause', 'key', 'identity', 'identity missing', 'missing set',
                 'duplicate key', 'scope', 'both sources value']:
        pages, catalog = fixture()
        text = pages[D.TEMPLATE]['wikitext']
        line = next(x for x in text.splitlines() if x.startswith('| might of the abishai ='))
        head, five = line.split('5 Piece Equipped:', 1)
        clause = '+2 Profane bonus to DCs'
        assert clause in five
        if kind == 'value': five = five.replace(clause, '+9 Profane bonus to DCs')
        elif kind == 'type': five = five.replace(clause, '+2 Artifact bonus to DCs')
        elif kind == 'percent': five = five.replace(clause, '+2% Profane bonus to DCs')
        elif kind == 'condition': five = five.replace(clause, clause + ' while raging')
        elif kind == 'missing clause': five = five.replace(clause, '')
        elif kind == 'duplicate clause': five = five.replace(clause, clause + '<br>' + clause)
        elif kind == 'scope': five = five.replace(clause, '+2 Profane bonus to Spell DCs')
        elif kind == 'both sources value':
            five = five.replace(clause, '+9 Profane bonus to DCs')
            pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace(
                '* {{HELstats|+2|+2|+3}} Profane bonus to DCs', '* {{HELstats|+9|+2|+3}} Profane bonus to DCs')
        changed = head + ('4 Piece Equipped:' if kind == 'threshold' else '5 Piece Equipped:') + five
        if kind == 'key': changed = changed.replace('| might of the abishai =', '| other abishai =')
        elif kind == 'identity': changed = changed.replace('set|Might of the Abishai', 'set|Other Abishai')
        elif kind == 'identity missing': changed = changed.replace('{{#vardefine:set|Might of the Abishai}}', '')
        elif kind == 'missing set': changed = ''
        elif kind == 'duplicate key': changed += '\n' + line
        pages[D.TEMPLATE]['wikitext'] = text.replace(line, changed)
        yield kind, pages, catalog


def test_template_amount_identity_and_condition_mutations_fail_both_modes():
    for kind, pages, catalog in template_mutations():
        assert_rejected(pages, catalog)
    assert invoke(*fixture())[0] == 0


def test_three_piece_mutations_invalidate_context_without_borrowing_five_piece_scope():
    for old, new in [('+1 Profane bonus to DCs', '+1 Profane bonus to Spell DCs'),
                     ('3 Piece Equipped:', '2 Piece Equipped:')]:
        pages, catalog = fixture()
        pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(old, new)
        assert_rejected(pages, catalog)


def test_empty_source_populations_and_changed_revisions_cannot_pass_vacuously():
    for title in [D.PAGE, D.TEMPLATE]:
        for kind in ['empty', 'revision']:
            pages, catalog = fixture()
            if kind == 'revision': pages[title]['revid'] += 1
            elif title == D.PAGE: pages[title]['wikitext'] = '{|\n|}'
            else: pages[title]['wikitext'] = '<onlyinclude>{{#switch:x\n| #default = Undefined set\n}}</onlyinclude>'
            assert_rejected(pages, catalog)
    pages, _ = fixture()
    code, report = invoke(pages, {})
    assert code == 1 and report.get('abishai_dc_review', {}).get('complete') is False


def test_catalog_disagreement_is_exposed_rather_than_used_to_choose_wiki_value():
    for field, value in [('value', '9'), ('type', 'Artifact')]:
        pages, catalog = fixture()
        affix = next(a for t in catalog[NAMES[0]] if t['threshold'] == 5
                     for a in t['affixes'] if a['name'] == 'Spell Focus Mastery')
        affix[field] = value
        code, report = invoke(pages, catalog)
        assert code == 0  # This is an ordinary visible comparison disagreement.
        assert report.get('abishai_dc_review', {}).get('complete') is True
        rec = report['sets'][NAMES[0]]['template']
        assert rec['class'] == 'ours-differs'
        assert rec['extra'] == [{'threshold': 5, 'affix': ['Spell Focus Mastery', 'Profane', 2]}]
        assert len(rec.get('spell_dc_rulings', [])) == 1


def test_unrelated_clauses_and_page_name_reconciliation_are_preserved():
    pages, catalog = fixture()
    # The Legendary healing wording and multi-tier identity gate stay unresolved.
    _, report = invoke(pages, catalog)
    rec = report['sets'][NAMES[2]]['template']
    assert len([q for q in rec['quarantined'] if 'Heal Amp (all types)' in q['line']]) == 2
    assert all(report['sets'][n]['page'] == {'class': 'no-wiki-name'} for n in NAMES)
    assert report['sets']['Wayward Warrior']['template'] == {'class': 'exact'}
    assert report['sets']['Wayward Warrior (Legendary)']['template'] == {'class': 'exact'}


def test_both_cli_formats_report_the_complete_ruling_and_restore_after_corruption():
    pages, catalog = fixture()
    for as_json in [True, False]:
        code, result = invoke(pages, catalog, as_json)
        assert code == 0
        if as_json:
            assert result.get('abishai_dc_review', {}).get('complete') is True
        else:
            assert 'abishai DC review:' in result
            assert 'Spell DCs only; tactical DCs excluded' in result


def test_a_missing_stat_vocabulary_stays_quarantined_even_with_verified_context():
    pages, _ = fixture()
    code, report = invoke(pages, catalog_rows(ac_only=True))
    assert code == 0
    assert report.get('abishai_dc_review', {}).get('complete') is True
    for name in NAMES:
        rec = report['sets'][name]['template']
        assert 'spell_dc_rulings' not in rec
        assert len([q for q in rec['quarantined'] if 'DCs' in q['line']]) == 2
