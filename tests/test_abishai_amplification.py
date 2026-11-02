"""#951: two retained Legendary clauses, never a global 'all types' alias."""
import copy
import contextlib
import io
import json

from src import wiki_sets as W
from src.affix_parser import BONUS_TYPES
from test_abishai_five_piece_dcs import fixture, invoke, NAMES
from test_set_count_review import D

NAME = NAMES[2]
STATS = ('Healing Amplification', 'Negative Amplification', 'Repair Amplification')
CHANNELS = 'Positive, Negative and Repair Amplification'


def assert_rejected(pages, catalog):
    for as_json in [True, False]:
        code, report = invoke(pages, catalog, as_json)
        assert code == 1, report
        if as_json:
            # The whole-source receipts were refreshed by invoke: this is the
            # scoped guard's rejection, not a stale whole-source hash.
            assert report['count_review']['complete'] is True, report['count_review']
            review = report.get('abishai_amplification_review', {})
            assert review.get('complete') is False and review.get('errors'), review
            assert review.get('verified') == []
            assert not report['sets'].get(NAME, {}).get('template', {}).get('amplification_rulings')
        else:
            line = next(x for x in report.splitlines() if x.startswith('abishai amplification review:'))
            assert json.loads(line.split(': ', 1)[1])['complete'] is False


def test_two_exact_clauses_use_named_channels_without_mutating_inputs():
    pages, catalog = fixture()
    before = copy.deepcopy((pages, catalog))
    code, report = invoke(pages, catalog)
    assert code == 0
    review = report.get('abishai_amplification_review', {})
    assert review.get('complete') is True, review
    assert len(review.get('verified', [])) == review.get('reviewed_clauses') == 2
    rec = report['sets'][NAME]['template']
    assert rec['class'] == 'partial'
    assert [q['threshold'] for q in rec['quarantined'] if 'DCs' in q['line']] == [3]
    assert not [q for q in rec['quarantined'] if 'Amp' in q['line']]
    assert [r['threshold'] for r in rec['spell_dc_rulings']] == [5]
    assert rec['amplification_rulings'] == [
        {'threshold': th, 'line': f'+{v} Profane bonus to Heal Amp (all types)', 'scope': CHANNELS}
        for th, v in [(3, 10), (5, 30)]]
    for ruling, amount in zip(review['verified'], [10, 30]):
        assert W.read_clause(ruling['explicit_line'], BONUS_TYPES, set(STATS)) == {
            'affixes': [{'name': stat, 'type': 'Profane', 'value': amount} for stat in STATS]}
    assert (pages, catalog) == before


def test_both_cli_formats_report_complete_scope_and_capture_provenance():
    for as_json in [True, False]:
        code, report = invoke(*fixture(), as_json)
        assert code == 0
        review = (report.get('abishai_amplification_review', {}) if as_json else json.loads(
            next(x for x in report.splitlines() if x.startswith('abishai amplification review:')).split(': ', 1)[1]))
        assert review.get('complete') is True
        assert len(review['verified']) == 2
        assert review['evidence']['captured_at_utc']['page'] == '2026-11-01T22:07:07.452869+00:00'
        assert 'Retained direct captures' in review['evidence']['freshness']


def test_page_named_channels_values_types_conditions_and_duplicates_fail_both_modes():
    for amount in [10, 30]:
        for kind in ['missing member', 'changed member', 'extra member', 'duplicate member',
                     'value', 'type', 'percent', 'condition', 'separate condition',
                     'missing clause', 'duplicate clause', 'heroic scope', 'both sources value']:
            pages, catalog = fixture()
            line = f'* {{{{HELstats|L=+{amount}}}}} Profane bonus to {CHANNELS}'
            assert line in pages[D.PAGE]['wikitext']
            replacement = line
            if kind == 'missing member': replacement = line.replace('Positive, ', '')
            elif kind == 'changed member': replacement = line.replace('Repair', 'Poison')
            elif kind == 'extra member': replacement = line.replace('Positive, ', 'Positive, Poison, ')
            elif kind == 'duplicate member': replacement = line.replace('Positive, ', 'Positive, Positive, ')
            elif kind in ['value', 'both sources value']: replacement = line.replace(f'L=+{amount}', 'L=+99')
            elif kind == 'type': replacement = line.replace('Profane', 'Artifact')
            elif kind == 'percent': replacement = line.replace(f'L=+{amount}', f'L=+{amount}%')
            elif kind == 'condition': replacement += ' while raging'
            elif kind == 'separate condition': replacement += '\n* Only while raging'
            elif kind == 'missing clause': replacement = ''
            elif kind == 'duplicate clause': replacement += '\n' + line
            elif kind == 'heroic scope': replacement = line.replace(f'L=+{amount}', f'H=+{amount}|L=+{amount}')
            pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace(line, replacement)
            if kind == 'both sources value':
                pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(
                    f'+{amount} Profane bonus to Heal Amp (all types)', '+99 Profane bonus to Heal Amp (all types)')
            assert_rejected(pages, catalog)
    assert invoke(*fixture())[0] == 0


def test_template_clauses_missing_duplicate_conditional_or_changed_fail_both_modes():
    for amount in [10, 30]:
        for kind in ['value', 'type', 'percent', 'condition', 'separate condition', 'missing', 'duplicate', 'scope']:
            pages, catalog = fixture()
            line = f'+{amount} Profane bonus to Heal Amp (all types)'
            replacement = line
            if kind == 'value': replacement = line.replace(str(amount), '99')
            elif kind == 'type': replacement = line.replace('Profane', 'Artifact')
            elif kind == 'percent': replacement = line.replace(str(amount), str(amount) + '%')
            elif kind == 'condition': replacement += ' while raging'
            elif kind == 'separate condition': replacement += '<br>Only while raging'
            elif kind == 'missing': replacement = ''
            elif kind == 'duplicate': replacement += '<br>' + line
            elif kind == 'scope': replacement = line.replace('all types', 'Positive only')
            assert line in pages[D.TEMPLATE]['wikitext']
            pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(line, replacement)
            assert_rejected(pages, catalog)
    assert invoke(*fixture())[0] == 0


def test_template_identity_threshold_and_duplicate_definition_fail_both_modes():
    for kind in ['key', 'identity', 'missing identity', 'missing entry', 'duplicate key',
                 'duplicate declared identity', 'three threshold', 'five threshold']:
        pages, catalog = fixture()
        text = pages[D.TEMPLATE]['wikitext']
        line = next(x for x in text.splitlines() if x.startswith('| legendary might of the abishai ='))
        replacement = line
        if kind == 'key': replacement = line.replace('legendary might of the abishai =', 'another set =')
        elif kind == 'identity': replacement = line.replace('{{#vardefine:set|' + NAME + '}}', '{{#vardefine:set|Another set}}')
        elif kind == 'missing identity': replacement = line.replace('{{#vardefine:set|' + NAME + '}}', '')
        elif kind == 'missing entry': replacement = ''
        elif kind == 'duplicate key': replacement += '\n' + line
        elif kind == 'duplicate declared identity': replacement += '\n' + line.replace('legendary might of the abishai =', 'another set =')
        elif kind == 'three threshold': replacement = line.replace('3 Piece Equipped:', '2 Piece Equipped:')
        elif kind == 'five threshold': replacement = line.replace('5 Piece Equipped:', '4 Piece Equipped:')
        assert replacement != line, kind
        pages[D.TEMPLATE]['wikitext'] = text.replace(line, replacement)
        assert_rejected(pages, catalog)
    assert invoke(*fixture())[0] == 0


def test_page_identity_threshold_preamble_and_duplicate_row_fail_both_modes():
    for kind in ['anchor', 'duplicate anchor', 'duplicate row', 'three threshold', 'five threshold', 'preamble condition']:
        pages, catalog = fixture()
        text = pages[D.PAGE]['wikitext']
        if kind == 'anchor': text = text.replace('{{Anchor|' + NAME + '}}', '{{Anchor|Another set}}')
        elif kind == 'duplicate anchor': text = text.replace('{{Anchor|' + NAME + '}}', ('{{Anchor|' + NAME + '}}') * 2)
        elif kind == 'duplicate row':
            row = text.split('|-\n', 1)[1].split('\n|-', 1)[0]
            text = text.replace('|-\n', '|-\n' + row + '\n|-\n', 1)
        elif kind == 'three threshold': text = text.replace('3 Pieces Equipped:', '2 Pieces Equipped:')
        elif kind == 'five threshold': text = text.replace('5 Pieces Equipped:', '4 Pieces Equipped:')
        elif kind == 'preamble condition': text = text.replace('{{Profane}}', '{{Profane}} while raging', 1)
        assert text != pages[D.PAGE]['wikitext'], kind
        pages[D.PAGE]['wikitext'] = text
        assert_rejected(pages, catalog)
    assert invoke(*fixture())[0] == 0


def test_empty_populations_changed_revisions_and_missing_catalog_fail_closed():
    for title in [D.PAGE, D.TEMPLATE]:
        for kind in ['empty', 'revision']:
            pages, catalog = fixture()
            if kind == 'revision': pages[title]['revid'] += 1
            elif title == D.PAGE: pages[title]['wikitext'] = '{|\n|}'
            else: pages[title]['wikitext'] = '<onlyinclude>{{#switch:x\n| #default = Undefined set\n}}</onlyinclude>'
            assert_rejected(pages, catalog)
    for empty in [False, True]:
        pages, catalog = fixture()
        if empty: catalog.clear()
        else: del catalog[NAME]
        code, report = invoke(pages, catalog)
        assert code == 1 and report.get('abishai_amplification_review', {}).get('complete') is False
        assert report['abishai_amplification_review']['verified'] == []


def test_missing_harvest_pages_are_rejected_in_both_cli_modes():
    # Existing CLI guard: missing inputs never reach scoped interpretation.
    for title in [D.PAGE, D.TEMPLATE]:
        for as_json in [True, False]:
            pages, _ = fixture()
            del pages[title]
            old = D.LH.load_pages
            D.LH.load_pages = lambda _: list(pages.values())
            try:
                with contextlib.redirect_stderr(io.StringIO()) as err:
                    assert D.main(['fixture-harvest'] + (['--json'] if as_json else [])) == 2
                assert 'lacks' in err.getvalue()
            finally:
                D.LH.load_pages = old


def test_catalog_disagreements_remain_visible_for_every_channel_and_threshold():
    for th, amount in [(3, 10), (5, 30)]:
        for stat in STATS:
            for kind in ['value', 'type', 'missing']:
                pages, catalog = fixture()
                tier = next(t for t in catalog[NAME] if t['threshold'] == th)
                affix = next(a for a in tier['affixes'] if a['name'] == stat)
                if kind == 'missing': tier['affixes'].remove(affix)
                else: affix[kind] = '99' if kind == 'value' else 'Artifact'
                code, report = invoke(pages, catalog)
                assert code == 0
                assert report.get('abishai_amplification_review', {}).get('complete') is True
                rec = report['sets'][NAME]['template']
                assert rec['class'] == 'ours-differs', (th, stat, kind, rec)
                assert rec['extra'] == [{'threshold': th, 'affix': [stat, 'Profane', amount]}]


def test_missing_vocabulary_never_silently_drops_one_channel():
    for stat in STATS:
        pages, catalog = fixture()
        for tiers in catalog.values():
            for tier in tiers:
                tier['affixes'] = [a for a in tier['affixes'] if a['name'] != stat]
        code, report = invoke(pages, catalog)
        assert code == 0
        assert report.get('abishai_amplification_review', {}).get('complete') is True
        rec = report['sets'][NAME]['template']
        assert not rec.get('amplification_rulings')
        assert len([q for q in rec['quarantined'] if 'Heal Amp' in q['line']]) == 2


def test_other_sets_and_shared_reader_keep_all_types_quarantined():
    # Deliberate preservation guards. No global alias and no scope borrowed by
    # Heroic, Epic, another set, or a conditionally worded clause.
    for line in ['+10 Profane bonus to Heal Amp (all types)',
                 '+10 Profane bonus to Heal Amp (all types) while raging']:
        assert 'quarantine' in W.read_clause(line, BONUS_TYPES, set(STATS))
    for name in NAMES[:2] + ('Unrelated',):
        pages, catalog = fixture()
        if name == 'Unrelated':
            pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace('| #default',
                '| unrelated = {{#vardefine:set|Unrelated}}3 Pieces Equipped:<br>+10 Profane bonus to Heal Amp (all types)\n| #default')
            catalog[name] = [{'threshold': 3, 'affixes': [{'name': s, 'type': 'Profane', 'value': '10'} for s in STATS]}]
        else:
            text = pages[D.TEMPLATE]['wikitext']
            line = next(x for x in text.splitlines() if x.startswith('| ' + name.lower() + ' ='))
            pages[D.TEMPLATE]['wikitext'] = text.replace(line, line + '<br>+10 Profane bonus to Heal Amp (all types)')
        code, report = invoke(pages, catalog)
        assert code == 0
        rec = report['sets'][name]['template']
        assert not rec.get('amplification_rulings')
        assert len([q for q in rec['quarantined'] if 'Heal Amp' in q['line']]) == 1


def test_unrelated_sets_dc_quarantine_and_page_identity_are_preserved():
    code, report = invoke(*fixture())
    assert code == 0
    for name in NAMES:
        rec = report['sets'][name]['template']
        assert rec['class'] == 'partial'
        assert [q['threshold'] for q in rec['quarantined'] if 'DCs' in q['line']] == [3]
        assert report['sets'][name]['page'] == {'class': 'no-wiki-name'}
    for name in ['Wayward Warrior', 'Wayward Warrior (Legendary)']:
        assert report['sets'][name]['template'] == {'class': 'exact'}
