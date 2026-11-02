"""#953 — two sourced identities, without fuzzy names or bonus substitutions."""
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
_spec = importlib.util.spec_from_file_location('slice_diff', os.path.join(ROOT, 'scripts', 'diff_harvest_sets.py'))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)

# Source wording from page rev 720202 / template rev 723530. Table and switch
# wrappers are reduced scaffolding. Do not repair the page's doubled "bonus".
ROW = """|'''Slice 'n Dice [ML:14/28]'''
|{{Anchor|Slice 'n Dice Set}}{{Anchor|Epic Slice 'n Dice Set}}
* {{HELitem|Slice|L=0}} - Dagger
* {{HELitem|Dice|L=0}} - Dagger
|2 Pieces Equipped:
* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Seeker]]
* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Sneak Attack]]
"""
PAGE = '== Update 27 sets ==\n{|class="wikitable"\n|-\n' + ROW + '|}'
TEMPLATE = """<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}
| slice 'n dice set = While wearing both items from the Slice 'n Dice Set, you gain:<br />+1 [[Quality bonus]] to [[Seeker]]<br />+1 Quality bonus to [[Sneak Attack]]<br />They make julienne fries.
| epic slice 'n dice set = While wearing both items from the Epic Slice 'n Dice Set, you gain:<br />+2 [[Quality bonus]] to [[Seeker]]<br />+2 Quality bonus to [[Sneak Attack]]<br />They make julienne fries.
| #default = Undefined set
}}</onlyinclude>"""


PAGE, TEMPLATE = with_abishai_sources(PAGE, TEMPLATE)


def fixture():
    pages = {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': PAGE},
             D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': TEMPLATE}}
    catalog = {name: [{'threshold': 2, 'affixes': [
        {'name': 'Seeker', 'type': 'Quality', 'value': str(value)},
        {'name': 'Deception', 'type': 'Quality', 'value': str(value)}]}]
        for name, value in (("Slice 'n Dice", 1), ("Epic Slice 'n Dice", 2))}
    catalog.update(catalog_rows(ac_only=True))  # unrelated complete source guard population
    return pages, catalog


def run_cli(pages, catalog, as_json=True):
    # Updated count-review fixture hashes make the new identity guard reject
    # corrupted names/tier targets independently of the whole-source hash gate.
    review = {'schema_version': 1, 'findings': {}, 'sources': {},
              'records': {'template': {}, 'page': {}}}
    for source, title in (('template', D.TEMPLATE), ('page', D.PAGE)):
        review['sources'][source] = {'revid': pages[title]['revid'],
            'sha256': hashlib.sha256(pages[title]['wikitext'].encode()).hexdigest()}
    with tempfile.TemporaryDirectory() as tmp:
        gp_path, review_path = os.path.join(tmp, 'catalog.json'), os.path.join(tmp, 'review.json')
        for path, value in ((gp_path, catalog), (review_path, review)):
            with open(path, 'w') as fh:
                json.dump(value, fh)
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


def test_both_sources_match_the_two_exact_identities_without_rewriting_inputs():
    pages, catalog = fixture()
    before = copy.deepcopy((pages, catalog))
    code, report = run_cli(pages, catalog)
    assert code == 0
    for name, tier, amount in (("Slice 'n Dice", 'Heroic', 1), ("Epic Slice 'n Dice", 'Epic', 2)):
        rec = report['sets'][name]
        assert rec['template']['class'] == 'partial', rec
        assert rec['page']['class'] == 'partial', rec
        assert rec['template']['name_alias'] == {'wiki_name': name + ' Set'}
        assert rec['page']['name_alias'] == {'wiki_name': name + ' Set', 'page_tier': tier}
        assert f'+{amount} Quality bonus to Sneak Attack' in [q['line'] for q in rec['template']['quarantined']]
        assert 'They make julienne fries.' in [q['line'] for q in rec['template']['quarantined']]
        assert all('Quality bonus bonus' in q['line'] for q in rec['page']['quarantined'])
    assert report['name_alias_review']['complete'] is True
    assert len(report['name_alias_review']['applied']) == 2
    assert (pages, catalog) == before


def test_unreviewed_suffixes_prefixes_and_helstats_rows_remain_unmatched():
    pages, catalog = fixture()
    # Synthetic names test boundaries; they assert no additional game identity.
    catalog["Slice 'n Dice Extra"] = copy.deepcopy(catalog["Slice 'n Dice"])
    catalog['Legendary Other Set'] = copy.deepcopy(catalog["Slice 'n Dice"])
    pages[D.TEMPLATE]['wikitext'] = TEMPLATE.replace('| #default',
        "| slice 'n dice extra set = 2 Pieces Equipped:<br />+1 Quality bonus to Seeker\n| #default")
    pages[D.PAGE]['wikitext'] = PAGE.replace('|}',
        "|-\n|{{Anchor|Other Set}}Other Set\n|Items\n|2 Pieces Equipped:\n* {{HELstats|+1|L=+2}} Quality bonus to Seeker\n|}")
    _, report = run_cli(pages, catalog)
    assert report['sets']["Slice 'n Dice"]['template']['class'] == 'partial'
    for name in ("Slice 'n Dice Extra", 'Legendary Other Set'):
        assert report['sets'][name] == {'template': {'class': 'no-wiki-name'}, 'page': {'class': 'no-wiki-name'}}
    assert set(report['name_alias_review']['applied']) == {"Slice 'n Dice", "Epic Slice 'n Dice"}


def test_name_match_does_not_hide_a_changed_amount_type_or_activation_count():
    for old, new, expected in (
        ('+1 [[Quality bonus]] to [[Seeker]]', '+7 [[Quality bonus]] to [[Seeker]]', 'ours-differs'),
        ('+1 [[Quality bonus]] to [[Seeker]]', '+1 Artifact bonus to [[Seeker]]', 'ours-differs'),
        ("While wearing both items from the Slice 'n Dice Set, you gain:", '3 Pieces Equipped:', 'threshold-differs'),
    ):
        pages, catalog = fixture()
        pages[D.TEMPLATE]['wikitext'] = TEMPLATE.replace(old, new)
        before = copy.deepcopy((pages, catalog))
        code, report = run_cli(pages, catalog)
        rec = report['sets']["Slice 'n Dice"]['template']
        assert rec['class'] == expected, rec
        assert code == 0 and report['name_alias_review']['complete']
        assert rec['name_alias'] == {'wiki_name': "Slice 'n Dice Set"}
        if expected == 'ours-differs':
            assert rec['extra'] == [{'threshold': 2, 'affix': ['Seeker', 'Artifact' if 'Artifact' in new else 'Quality', 1 if 'Artifact' in new else 7]}]
        else:
            assert rec['wiki'] == [3] and rec['gear-planner'] == [2]
        assert (pages, catalog) == before


def test_missing_ambiguous_or_colliding_targets_fail_both_cli_modes():
    code, good = run_cli(*fixture())
    assert good['sets']["Slice 'n Dice"]['template']['class'] == 'partial'
    assert code == 0
    for kind in ('missing template', 'missing anchor', 'missing tier', 'duplicate row',
                 'direct template collision', 'direct anchor collision', 'catalog collision'):
        pages, catalog = fixture()
        if kind == 'missing template':
            pages[D.TEMPLATE]['wikitext'] = TEMPLATE.replace("| slice 'n dice set =", '| unreviewed name =')
        elif kind == 'missing anchor':
            pages[D.PAGE]['wikitext'] = PAGE.replace("{{Anchor|Slice 'n Dice Set}}", '{{Anchor|Unreviewed name}}')
        elif kind == 'missing tier':
            pages[D.PAGE]['wikitext'] = PAGE.replace('{{HELstats|+1|+2}}', '{{HELstats|L=+2}}')
        elif kind == 'duplicate row':
            pages[D.PAGE]['wikitext'] = PAGE.replace('|}', '|-\n' + ROW + '|}')
        elif kind == 'direct template collision':
            pages[D.TEMPLATE]['wikitext'] = TEMPLATE.replace('| #default',
                "| slice 'n dice = 2 Pieces Equipped:<br />+1 Quality bonus to Seeker\n| #default")
        elif kind == 'direct anchor collision':
            pages[D.PAGE]['wikitext'] = PAGE.replace("{{Anchor|Slice 'n Dice Set}}",
                "{{Anchor|Slice 'n Dice Set}}{{Anchor|Slice 'n Dice}}")
        else:
            catalog["Slice 'n Dice Set"] = copy.deepcopy(catalog["Slice 'n Dice"])
        for as_json in (True, False):
            code, result = run_cli(pages, catalog, as_json)
            assert code == 1, (kind, as_json, result)
            if as_json:
                assert result['count_review']['complete'] is True
                assert result['name_alias_review']['complete'] is False
                assert 'name_alias' not in result['sets']["Slice 'n Dice"]['template']
            else:
                assert 'Name alias review is stale or ambiguous' in result
    assert run_cli(*fixture())[0] == 0


def test_readable_source_disagreements_stay_visible_after_name_matching():
    pages, catalog = fixture()
    # A reduced synthetic comparison isolates source-disagreement routing from
    # the real sources' quarantined clauses; it is not a bonus-data correction.
    for amount in (1, 2):
        pages[D.TEMPLATE]['wikitext'] = pages[D.TEMPLATE]['wikitext'].replace(
            f'<br />+{amount} Quality bonus to [[Sneak Attack]]<br />They make julienne fries.', '')
    pages[D.PAGE]['wikitext'] = PAGE.replace(
        '* {{HELstats|+1|+2}} [[Quality bonus]] bonus to [[Sneak Attack]]\n', '').replace(
        '[[Quality bonus]] bonus to', '[[Quality bonus]] to').replace('{{HELstats|+1|+2}}', '{{HELstats|+7|+2}}')
    for name in ("Slice 'n Dice", "Epic Slice 'n Dice"):
        tiers = catalog[name]
        tiers[0]['affixes'] = [a for a in tiers[0]['affixes'] if a['name'] == 'Seeker']
    code, report = run_cli(pages, catalog)
    assert report['sets']["Slice 'n Dice"]['template']['class'] == 'exact'
    assert code == 0
    assert report['sets']["Slice 'n Dice"]['page']['extra'] == [
        {'threshold': 2, 'affix': ['Seeker', 'Quality', 7]}]
    assert report['sources_disagree'] == [{
        'set': "slice 'n dice set", 'template': {'2': [['Seeker', 'Quality', 1]]},
        'page': {'2': [['Seeker', 'Quality', 7]]}}]
    assert report['sets']["Epic Slice 'n Dice"]['page']['class'] == 'exact'
