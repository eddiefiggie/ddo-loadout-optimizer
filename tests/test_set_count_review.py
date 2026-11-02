"""Exercise the count-review gate through the parity CLI, including JSON mode."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import tempfile
from natural_armor_fixture import catalog_rows, with_abishai_sources

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location('count_review_diff', os.path.join(ROOT, 'scripts', 'diff_harvest_sets.py'))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)

# Small source wrappers around Anger's Wrath's checked bonus wording:
# Named item sets rev 720202 / Template:Named item sets rev 723530.
PAGE = """== Korthos Island sets ==
{|class="wikitable"
|-
|{{Anchor|Anger's Wrath}}'''Anger's Wrath'''
|Items omitted in this test fixture
|To-Hit Bonus +2 (untyped, fully stacks)
|}"""
TEMPLATE = """<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}
| anger's wrath = To-Hit Bonus +2 (Untyped, stacks with competence)
| #default = Undefined set
}}</onlyinclude>"""


PAGE, TEMPLATE = with_abishai_sources(PAGE, TEMPLATE)


def fixture():
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': PAGE},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': TEMPLATE}}
    review = {'schema_version': 1, 'findings': {'fixture': 'No activation count in this fixture.'},
              'sources': {}, 'records': {s: {"Anger's Wrath": 'fixture'} for s in ('template', 'page')}}
    for source, title in (('template', D.TEMPLATE), ('page', D.PAGE)):
        review['sources'][source] = {'revid': pages[title]['revid'],
            'sha256': hashlib.sha256(pages[title]['wikitext'].encode()).hexdigest()}
    return pages, {"Anger's Wrath": [], **catalog_rows(ac_only=True)}, review


def run_cli(pages, catalog, review, as_json=True):
    with tempfile.TemporaryDirectory() as tmp:
        gp_path, review_path = os.path.join(tmp, 'catalog.json'), os.path.join(tmp, 'review.json')
        for path, data in ((gp_path, catalog), (review_path, review)):
            with open(path, 'w') as fh:
                json.dump(data, fh)
        old_gp, old_load = D.GP_SETS, D.LH.load_pages
        old_review = getattr(D, 'COUNT_REVIEW', None)
        try:
            D.GP_SETS, D.COUNT_REVIEW = gp_path, review_path
            D.LH.load_pages = lambda _: list(pages.values())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = D.main(['fixture-harvest'] + (['--json'] if as_json else []))
            return code, json.loads(output.getvalue()) if as_json else output.getvalue()
        finally:
            D.GP_SETS, D.LH.load_pages = old_gp, old_load
            if old_review is None:
                del D.COUNT_REVIEW
            else:
                D.COUNT_REVIEW = old_review


def test_reviewed_sources_pass_without_changing_the_unresolved_counts():
    code, report = run_cli(*fixture())
    assert code == 0
    assert report.get('count_review', {}).get('complete') is True, report
    for source in ('template', 'page'):
        assert report['sets']["Anger's Wrath"][source]['class'] == 'threshold-unstated'
        assert report['count_review']['sources'][source]['unresolved'] == 1


def test_missing_and_stale_review_entries_fail_for_each_source():
    pages, catalog, review = fixture()
    for source in ('template', 'page'):
        for change in ('missing', 'stale'):
            broken = copy.deepcopy(review)
            if change == 'missing':
                del broken['records'][source]["Anger's Wrath"]
            else:
                broken['records'][source]['Unreviewed example'] = 'fixture'
            code, report = run_cli(pages, catalog, broken)
            assert code == 1, (source, change, report)
            assert report['count_review']['sources'][source][change]
    assert run_cli(pages, catalog, review)[0] == 0


def test_source_revision_or_context_change_requires_review_even_with_same_roster():
    pages, catalog, review = fixture()
    for source, title in (('template', D.TEMPLATE), ('page', D.PAGE)):
        for change in ('revision', 'context'):
            broken = copy.deepcopy(pages)
            if change == 'revision':
                broken[title]['revid'] += 1
            else:
                broken[title]['wikitext'] += '\n<!-- changed section context -->'
            code, report = run_cli(broken, catalog, review)
            assert code == 1, (source, change, report)
            status = report['count_review']['sources'][source]
            assert status['source_changed'] and not status['missing'] and not status['stale']
    assert run_cli(pages, catalog, review)[0] == 0


def test_empty_catalog_cannot_produce_a_complete_review():
    pages, _, review = fixture()
    review['records'] = {'template': {}, 'page': {}}
    code, report = run_cli(pages, {}, review)
    assert code == 1, report
    assert 'no catalog sets inspected' in report['count_review']['errors']


def test_invalid_review_findings_and_schema_are_rejected():
    pages, catalog, review = fixture()
    for change in ('unknown finding', 'empty finding', 'schema'):
        broken = copy.deepcopy(review)
        if change == 'unknown finding':
            broken['records']['page']["Anger's Wrath"] = 'not-reviewed'
        elif change == 'empty finding':
            broken['findings']['fixture'] = ''
        else:
            broken['schema_version'] = 2
        code, report = run_cli(pages, catalog, broken)
        assert code == 1, (change, report)
        assert not report['count_review']['complete']


def test_text_cli_fails_with_actionable_review_message():
    pages, catalog, review = fixture()
    review['records']['template'].clear()
    code, output = run_cli(pages, catalog, review, as_json=False)
    assert code == 1, output
    assert 'Count review is stale or incomplete' in output
    assert "Anger's Wrath" in output
    assert 'Never infer counts' in output
