"""#956 — an explicit heroic bug note is a scoped comparison ruling, not new data."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import tempfile
from natural_armor_fixture import catalog_rows

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location('arcsteel_diff', os.path.join(ROOT, 'scripts', 'diff_harvest_sets.py'))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)

# Verbatim bonus wording from Named item sets rev 720202 and template rev 723530.
# Only the table/switch wrappers and omitted item-list cells are test scaffolding.
PAGE = """== Masterminds of Sharn sets ==
{|class="wikitable"
|-
|{{Anchor|Arcsteel Battlemage}}{{Anchor|Legendary Arcsteel Battlemage}}'''Arcsteel Battlemage'''
|Items omitted in this test fixture
|3 Pieces Equipped:
* {{HELstats|+25|L=+30}} Artifact bonus to Electric, Fire, Force, and Repair Spell Power
* {{HELstats|+5%|L=+6%}} Artifact bonus to Electric, Fire, Force, and Repair Spell Crit Chance
* {{HELstats|+2|L=+3}} Artifact bonus to Intelligence '''Bug:''' Heroic tier only gives +1 INT.
* {{HELstats|+1|L=+3}} Artifact bonus to Spell DCs
|}"""
TEMPLATE = """<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}
| arcsteel battlemage = {{#vardefine:set|Arcsteel Battlemage}}While wearing three items from the Arcsteel Battlemage set, you gain:<br />+25% Artifact bonus to Electric, Fire, Force, and Repair Spell Power<br />+5% Artifact bonus to Electric, Fire, Force, and Repair Spell Crit Chance<br />+2 Artifact bonus to Intelligence<br />+1 Artifact bonus to Spell DCs.
| legendary arcsteel battlemage = {{#vardefine:set|Legendary Arcsteel Battlemage}}3 Pieces Equipped:<br />+3 Artifact bonus to Intelligence
| epic double helix set = While wearing both items from the Epic Double Helix Set, you gain: +4 [[Insight bonus|Insightful]] bonus to [[Sheltering]]
| #default = Undefined set
}}</onlyinclude>"""


def fixture():
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': PAGE},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': TEMPLATE}}
    # Restrict the comparator population and fields to the stated cases.
    catalog = {
        'Arcsteel Battlemage': [{'threshold': 3, 'affixes': [
            {'name': 'Intelligence', 'type': 'Artifact', 'value': '1'}]}],
        'Legendary Arcsteel Battlemage': [{'threshold': 3, 'affixes': [
            {'name': 'Intelligence', 'type': 'Artifact', 'value': '3'}]}],
        'Epic Double Helix Set': [{'threshold': 2, 'affixes': [
            {'name': 'Sheltering', 'type': 'Insight', 'value': '5'}]}],
    }
    catalog.update(catalog_rows(ac_only=True))  # unrelated complete source guard population
    return pages, catalog


def run_cli(pages, catalog, as_json=True):
    # Refresh only the unrelated count-review fixture's hashes. The new ruling
    # must reject changed evidence independently of that existing whole-page gate.
    review = {'schema_version': 1, 'findings': {}, 'sources': {},
              'records': {'template': {}, 'page': {}}}
    for source, title in (('template', D.TEMPLATE), ('page', D.PAGE)):
        review['sources'][source] = {'revid': pages[title]['revid'],
            'sha256': hashlib.sha256(pages[title]['wikitext'].encode()).hexdigest()}
    with tempfile.TemporaryDirectory() as tmp:
        gp_path, review_path = os.path.join(tmp, 'catalog.json'), os.path.join(tmp, 'review.json')
        for path, data in ((gp_path, catalog), (review_path, review)):
            with open(path, 'w') as fh:
                json.dump(data, fh)
        old = D.GP_SETS, D.COUNT_REVIEW, D.LH.load_pages
        try:
            D.GP_SETS, D.COUNT_REVIEW = gp_path, review_path
            D.LH.load_pages = lambda _: list(pages.values())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = D.main(['fixture-harvest'] + (['--json'] if as_json else []))
            return code, json.loads(output.getvalue()) if as_json else output.getvalue()
        finally:
            D.GP_SETS, D.COUNT_REVIEW, D.LH.load_pages = old


def test_heroic_bug_is_explained_without_rewriting_either_input():
    pages, catalog = fixture()
    before = copy.deepcopy((pages, catalog))
    code, report = run_cli(pages, catalog)
    assert code == 0, report
    rec = report['sets']['Arcsteel Battlemage']['template']
    assert rec['class'] == 'wiki-bug', rec
    assert rec.get('wiki_bug_rulings') == [{'threshold': 3,
        'affix': ['Intelligence', 'Artifact', 2], 'actual': ['Intelligence', 'Artifact', 1]}]
    assert report.get('wiki_bug_review', {}).get('complete') is True
    assert report['wiki_bug_review']['applicable'] is True
    assert (pages, catalog) == before


def test_legendary_and_other_disputed_values_are_not_covered_by_the_heroic_ruling():
    _, report = run_cli(*fixture())
    assert report['sets']['Arcsteel Battlemage']['template']['class'] == 'wiki-bug'
    assert report['sets']['Legendary Arcsteel Battlemage']['template'] == {'class': 'exact'}
    epic = report['sets']['Epic Double Helix Set']['template']
    assert epic['class'] == 'ours-differs', epic
    assert epic['extra'] == [
        {'threshold': 2, 'affix': ['Physical Sheltering', 'Insight', 4]},
        {'threshold': 2, 'affix': ['Magical Sheltering', 'Insight', 4]},
    ]
    assert 'wiki_bug_rulings' not in epic
    assert report['sets']['Arcsteel Battlemage']['page']['class'] == 'no-wiki-name'


def test_missing_changed_or_mis_scoped_bug_note_fails_both_cli_modes():
    replacements = [
        (" '''Bug:''' Heroic tier only gives +1 INT.", ''),
        ('only gives +1 INT.', 'only gives +2 INT.'),
        ('Heroic tier only', 'Legendary tier only'),
        ('{{HELstats|+2|L=+3}}', '{{HELstats|+3|L=+3}}'),
        ('3 Pieces Equipped:', '2 Pieces Equipped:'),
    ]
    for old, new in replacements:
        pages, catalog = fixture()
        assert old in pages[D.PAGE]['wikitext']
        pages[D.PAGE]['wikitext'] = pages[D.PAGE]['wikitext'].replace(old, new)
        for as_json in (True, False):
            code, result = run_cli(pages, catalog, as_json)
            assert code == 1, (old, new, as_json, result)
            if as_json:
                assert result['count_review']['complete'] is True
                assert result.get('wiki_bug_review', {}).get('complete') is False
                assert result['sets']['Arcsteel Battlemage']['template']['class'] == 'ours-differs'
            else:
                assert 'Wiki bug ruling is stale or unsupported' in result
    assert run_cli(*fixture())[0] == 0


def test_changed_template_or_catalog_cannot_be_hidden_by_the_exception():
    for kind in ('template value', 'template type', 'template duplicate',
                 'catalog value', 'catalog type', 'catalog duplicate', 'catalog missing'):
        pages, catalog = fixture()
        text = pages[D.TEMPLATE]['wikitext']
        clause = '+2 Artifact bonus to Intelligence'
        if kind == 'template value':
            pages[D.TEMPLATE]['wikitext'] = text.replace(clause, '+3 Artifact bonus to Intelligence')
        elif kind == 'template type':
            pages[D.TEMPLATE]['wikitext'] = text.replace(clause, '+2 Quality bonus to Intelligence')
        elif kind == 'template duplicate':
            pages[D.TEMPLATE]['wikitext'] = text.replace(clause, clause + '<br />' + clause)
        else:
            affs = catalog['Arcsteel Battlemage'][0]['affixes']
            if kind == 'catalog value': affs[0]['value'] = '2'
            elif kind == 'catalog type': affs[0]['type'] = 'Quality'
            elif kind == 'catalog duplicate': affs.append(dict(affs[0]))
            else: affs.clear()
        code, report = run_cli(pages, catalog)
        assert code == 1, (kind, report)
        assert report['count_review']['complete'] is True
        assert report.get('wiki_bug_review', {}).get('complete') is False
        assert 'wiki_bug_rulings' not in report['sets']['Arcsteel Battlemage']['template']
    assert run_cli(*fixture())[0] == 0


def test_an_unrelated_extra_and_unread_spellpower_remain_visible():
    pages, catalog = fixture()
    # Deliberately corrupted input: not an assertion about another game bonus.
    pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(
        '+2 Artifact bonus to Intelligence', '+2 Artifact bonus to Intelligence<br />+2 Artifact bonus to Constitution')
    catalog['Arcsteel Battlemage'][0]['affixes'].append(
        {'name': 'Constitution', 'type': 'Artifact', 'value': '1'})
    code, report = run_cli(pages, catalog)
    assert code == 0
    rec = report['sets']['Arcsteel Battlemage']['template']
    assert rec['class'] == 'ours-differs'
    assert rec['extra'] == [{'threshold': 3, 'affix': ['Constitution', 'Artifact', 2]}]
    assert len(rec.get('wiki_bug_rulings', [])) == 1
    assert any('+25%' in q['line'] for q in rec['quarantined'])
