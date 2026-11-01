"""#951: reviewed flat AC, exact source boundaries and shared consumers."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile

from src import set_catalog as SC, set_parser as SP, wiki_sets as W, membership
from src.affix_parser import BONUS_TYPES
from natural_armor_fixture import NAMES, catalog_rows
from test_set_count_review import run_cli

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / 'tests/fixtures/natural_armor_sets.json').read_text())
_spec = importlib.util.spec_from_file_location('natural_diff', ROOT / 'scripts/diff_harvest_sets.py')
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)


def sources():
    template = '<onlyinclude>{{#switch:{{lc:{{{1|unknown}}}}}\n' + '\n'.join(
        '| ' + n.lower() + ' = ' + text for n, text in FIXTURE['template_bodies'].items()) + '\n| #default = Undefined set\n}}</onlyinclude>'
    page = '== Reviewed sets ==\n{|class="wikitable"\n' + '\n'.join(
        '|-\n|' + ''.join('{{Anchor|' + a + '}}' for a in r['anchors']) + '\n|Items omitted\n|' + r['raw']
        for r in FIXTURE['page_bodies']) + '\n|}'
    return {D.PAGE: {'title': D.PAGE, 'revid': 720202, 'wikitext': page},
            D.TEMPLATE: {'title': D.TEMPLATE, 'revid': 723530, 'wikitext': template}}


def rejects(call):
    try:
        call()
    except ValueError as e:
        assert 'Natural Armor set source changed' in str(e), str(e)
    else:
        assert False, 'changed source was accepted'


def ac_rows(entry):
    return [(t['pieces_required'], a['bonus_type'], a['value'])
            for t in SP.parse_set_bonuses([entry['set_bonus']])
            for a in t['affixes'] if a['stat'] == 'Armor Class']


def expected(name):
    return [(r['pieces'], r['bonus_type'], r['value']) for r in FIXTURE['clauses'] if r['set'] == name]


def test_catalog_emits_all_eight_reviewed_flat_ac_clauses_without_mutating_source():
    raw = SC.load_raw()
    before = copy.deepcopy(raw)
    cat = SC.catalog_from_raw(raw)
    assert sum(len(expected(n)) for n in NAMES) == 8
    for name in NAMES:
        assert ac_rows(cat[name]) == expected(name), name
        assert not any(f.get('affix', {}).get('name') == 'Armor Class' for f in cat[name]['flagged'])
    assert raw == before


def test_direct_template_and_page_wording_yields_the_same_eight_clauses():
    pages = sources()
    templates = W.template_sets(pages[D.TEMPLATE]['wikitext'])
    rows = W.page_sets(pages[D.PAGE]['wikitext'])
    for r in FIXTURE['clauses']:
        template = templates[r['set'].lower()]
        page = next(row for row in rows if r['set'] in row['anchors'] and row['tier'] == r['tier'])
        for entry in [template, page]:
            lines = [line for line in entry['tiers'][r['pieces']] if 'Natural Armor' in line]
            assert len(lines) == 1
            result = W.read_clause(lines[0], BONUS_TYPES, {'Armor Class'})
            assert result == {'affixes': [{'name': 'Armor Class', 'type': r['bonus_type'], 'value': r['value']}]}, result


def test_comparison_normalizes_only_flat_ac_and_keeps_values_types_and_multiplicity():
    for raw_type, canonical in [('Profane Natural', 'Profane'), ('Artifact Natural', 'Artifact')]:
        a = {'name': 'Armor Class', 'type': raw_type, 'value': 5}
        assert D.comparison_affixes(a) == [('Armor Class', canonical, 5)]
        assert D.gp_tiers([{'threshold': 3, 'affixes': [a, a]}])[3][('Armor Class', canonical, 5)] == 2
        for stat in ['Armor Class (%)', 'Constitution']:
            assert D.comparison_affixes({**a, 'name': stat}) == [(stat, raw_type, 5)]
    assert D.comparison_affixes({'name': 'Armor Class', 'type': 'Natural', 'value': 7}) == [('Armor Class', 'Natural', 7)]
    assert D.comparison_affixes({'name': 'Armor Class', 'type': 'Unreviewed Natural', 'value': 99}) == [('Armor Class', 'Unreviewed Natural', 99)]


def test_percentage_and_conditional_natural_armor_remain_quarantined():
    # Deliberate unchanged guards plus the explicit percentage boundary: never
    # equate an unverified percent of Natural Armor with a percent of total AC.
    vocab = {'Armor Class', 'Armor Class (%)', 'Natural Armor (%)'}
    for line in ['+5% Artifact bonus to Natural Armor', '+5% Profane bonus to Natural Armor',
                 '+5 bonus to Natural Armor', '+5 Unreviewed bonus to Natural Armor',
                 '+5 Profane bonus to Natural Armor while raging',
                 '+5 Profane bonus to Natural Armor for your pet',
                 '+5 Profane bonus to Natural Armor against undead']:
        assert 'quarantine' in W.read_clause(line, BONUS_TYPES, vocab), line
    assert W.read_clause('+5% Artifact bonus to Armor Class', BONUS_TYPES, vocab)['affixes'][0]['name'] == 'Armor Class (%)'
    for stat, ty in [('Constitution', 'Profane Natural'), ('Armor Class (%)', 'Artifact Natural'),
                     ('Armor Class', 'Unreviewed Natural')]:
        text, reason = SC._clause({'name': stat, 'type': ty, 'value': 5})
        assert text is None and reason


def mutations():
    for kind in ['empty', 'missing set', 'missing line', 'duplicate', 'value', 'threshold',
                 'type', 'stat', 'percent', 'upstream repair', 'extra set', 'extra AC', 'extra composite']:
        raw = SC.load_raw()
        tier = raw['Might of the Abishai'][0]
        a = next(a for a in tier['affixes'] if a['name'] == 'Armor Class')
        if kind == 'empty': raw.clear()
        elif kind == 'missing set': del raw['Might of the Abishai']
        elif kind == 'missing line': tier['affixes'].remove(a)
        elif kind == 'duplicate': tier['affixes'].append(copy.deepcopy(a))
        elif kind == 'value': a['value'] = 99
        elif kind == 'threshold': tier['threshold'] = 4
        elif kind == 'type': a['type'] = 'Artifact Natural'
        elif kind == 'stat': a['name'] = 'Constitution'
        elif kind == 'percent': a['name'] = 'Armor Class (%)'
        elif kind == 'upstream repair': a['type'] = 'Profane'
        elif kind == 'extra set': raw['Unreviewed'] = [copy.deepcopy(tier)]
        elif kind == 'extra AC': tier['affixes'].append({'name': 'Armor Class', 'type': 'Natural', 'value': 1})
        elif kind == 'extra composite': raw['Unreviewed'] = [{'threshold': 1, 'affixes': [{'name': 'Constitution', 'type': 'Artifact Natural', 'value': 5}]}]
        yield kind, raw


def test_catalog_load_guard_rejects_every_source_mutation_including_zero_and_restores():
    # Public file-loading entry point used by shared consumers, not only a helper.
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / 'sets.json'
        for kind, raw in mutations():
            p.write_text(json.dumps(raw))
            rejects(lambda: SC.load_catalog(str(p)))
        p.write_text(json.dumps(SC.load_raw()))
        assert ac_rows(SC.load_catalog(str(p))['Might of the Abishai']) == expected('Might of the Abishai')


def test_comparison_cli_requires_complete_review_in_both_modes():
    import hashlib
    pages = sources()
    review = {'schema_version': 1, 'findings': {}, 'sources': {}, 'records': {'template': {}, 'page': {}}}
    for src, title in [('template', D.TEMPLATE), ('page', D.PAGE)]:
        review['sources'][src] = {'revid': pages[title]['revid'], 'sha256': hashlib.sha256(pages[title]['wikitext'].encode()).hexdigest()}
    raw = catalog_rows()
    code, report = run_cli(pages, raw, review)
    assert report.get('natural_armor_review', {}).get('complete') is True, report
    assert report['natural_armor_review']['reviewed_clauses'] == report['natural_armor_review']['observed_clauses'] == 8
    assert code == 0
    for n in ['Wayward Warrior', 'Wayward Warrior (Legendary)']:
        assert report['sets'][n]['template']['class'] == 'exact'
    for kind, changed in mutations():
        # The other sets need no Wiki fixture: this test isolates catalog drift.
        changed = {n: tiers for n, tiers in changed.items() if n in NAMES or n == 'Unreviewed'}
        for as_json in [True, False]:
            code, output = run_cli(pages, changed, review, as_json)
            assert code == 1, kind
            if as_json:
                assert output['natural_armor_review']['complete'] is False, kind
            else:
                assert 'Natural Armor source review is stale' in output, kind
    assert run_cli(pages, raw, review)[0] == 0


def test_wiki_comparison_never_conceals_changed_amounts_or_types():
    tiers = D.gp_tiers(catalog_rows()['Wayward Warrior'])
    for line in ['+9 Artifact bonus to Natural Armor', '+2 Profane bonus to Natural Armor']:
        cls, detail = D.classify({2: [line]}, tiers, {'Armor Class', 'Constitution'})
        assert cls == 'ours-differs' and detail['extra']


def test_built_members_and_wildcard_definitions_carry_canonical_ac():
    data = json.loads((ROOT / 'web/data/items.json').read_text())
    counts = {}
    for name in NAMES:
        members = [i for i in data['items'] if any(s['set'] == name for s in i.get('set_bonus', []))]
        counts[name] = len(members)
        for item in members:
            actual = [(t['pieces_required'], a['bonus_type'], a['value']) for t in item['parsed_set_bonuses']
                      if t['set'] == name for a in t['affixes'] if a['stat'] == 'Armor Class']
            assert actual == expected(name), item['variant_id']
    assert list(counts.values()) == [20, 20, 21, 4, 4]
    # Wildcards use the equipped member's definition; no second bonus catalog.
    for prefix, name in zip(['', 'Epic ', 'Legendary '], NAMES[:3]):
        gem = next(i for i in data['items'] if i['variant_id'] == prefix + 'Gem of Many Facets')
        assert sum(name in group for group in gem['joker_set_groups']) == 1
        assert gem['set_bonus'] == []


def test_unrelated_sets_and_crafting_consumers_preserve_their_catalog_definitions():
    # Deliberate unchanged-behavior guard: complete comparison against direct
    # synthesis for all unaffected sets, with existing Slice/Dice quarantine kept.
    raw = SC.load_raw()
    cat = SC.load_catalog()
    for name, tiers in raw.items():
        if name in NAMES or name in SC.SLICE_DICE_PAIRS:
            continue
        pieces, flags = SC._synthesize(tiers)
        entry = cat[SC.canonical(name)]
        assert (entry['set_bonus']['piece_bonuses'] if entry['set_bonus'] else {}) == pieces
        assert entry['flagged'] == flags
    assert set(NAMES).isdisjoint(membership.build_membership_set_defs(cat))
    data = json.loads((ROOT / 'web/data/items.json').read_text())
    assert set(NAMES).isdisjoint(t['set'] for t in data['dino_sets'])
