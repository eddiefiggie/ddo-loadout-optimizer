"""#953/#951 — explicit Wiki memberships, Seeker-only definitions and drift guards."""
import copy
import json
from pathlib import Path

from src import planner_items as PI, set_catalog as SC, set_parser as SP, membership

ROOT = Path(__file__).resolve().parents[1]
PAIRS = {"Slice 'n Dice": (['Slice', 'Dice'], 1), "Epic Slice 'n Dice": (['Epic Slice', 'Epic Dice'], 2)}


def raw_items():
    return json.loads((ROOT / 'data/seed/compendium/raw/gearplanner_items.json').read_text())


def rejects(fn, phrase):
    try:
        fn()
    except ValueError as exc:
        assert phrase in str(exc), str(exc)
    else:
        assert False, 'corrupted input was accepted'


def test_shared_catalog_only_admits_the_verified_seeker_line():
    raw = SC.load_raw()
    before = copy.deepcopy(raw)
    cat = SC.catalog_from_raw(raw)
    for name, (members, amount) in PAIRS.items():
        entry = cat[name]
        parsed = SP.parse_set_bonuses([entry['set_bonus']])
        assert len(parsed) == 1
        tier = parsed[0]
        assert [(a['stat'], a['bonus_type'], a['value']) for a in tier['affixes']] == [('Seeker', 'Quality', amount)]
        assert tier['pieces_required'] == 2
        assert tier['required_items'] == members
        assert len(tier['flagged']) == len(entry['flagged']) == 1
        assert tier['flagged'][0]['raw'] == f'+{amount} Quality bonus to Sneak Attack'
        assert 'unverified' in tier['flagged'][0]['reason']
        assert 'unverified' in tier['verification_note']
        assert 'Deception' not in entry['set_bonus']['piece_bonuses']['2 Pieces']
    assert raw == before, 'the vendor evidence must remain intact'
    # Nothing changed guard: these are not craftable membership choices.
    assert set(PAIRS).isdisjoint(membership.build_membership_set_defs(cat))


def test_reader_restores_only_four_memberships_and_preserves_other_item_fields():
    items = raw_items()
    actual = []
    for item in items:
        before = copy.deepcopy(item)
        rec = PI._record(item, set())
        for name, (members, _) in PAIRS.items():
            if item['name'] not in members:
                continue
            actual.append(item['name'])
            marker = name + ' Set'
            assert rec['sets'] == item['sets'] + [marker]
            assert marker + ' (set)' in rec['enhancements']
            expected = PI._native_affixes([a for a in item['affixes'] if a['name'] != marker])
            assert rec['affixes'] == expected
        assert item == before
    assert sorted(actual) == ['Dice', 'Epic Dice', 'Epic Slice', 'Slice']


def test_built_dataset_carries_exact_pairs_and_quarantine():
    data = json.loads((ROOT / 'web/data/items.json').read_text())
    for name, (members, amount) in PAIRS.items():
        carriers = [it for it in data['items'] if any(s['set'] == name for s in it.get('set_bonus', []))]
        assert sorted(it['source_item'] for it in carriers) == sorted(members)
        for it in carriers:
            assert it['duplicable_weapon'] is True, 'copies remain legal equipment'
            assert all(a['name'] != name + ' Set' for a in it['affixes'])
            tier = next(t for t in it['parsed_set_bonuses'] if t['set'] == name)
            assert tier['required_items'] == members
            assert [(a['stat'], a['bonus_type'], a['value']) for a in tier['affixes']] == [('Seeker', 'Quality', amount)]
            assert len(tier['flagged']) == 1
            other = "Epic The Devil's Handiwork" if name.startswith('Epic') else "The Devil's Handiwork"
            assert any(t['set'] == other and t['pieces_required'] == 5 for t in it['parsed_set_bonuses'])


def test_catalog_drift_is_rejected_instead_of_guessing_or_silently_dropping():
    for name in PAIRS:
        for mutation in ['seeker value', 'deception value', 'threshold', 'extra tier', 'missing line', 'extra line']:
            raw = SC.load_raw()
            tiers = raw[name]
            if mutation == 'seeker value': tiers[0]['affixes'][0]['value'] = '99'
            if mutation == 'deception value': tiers[0]['affixes'][1]['value'] = '99'
            if mutation == 'threshold': tiers[0]['threshold'] = 1
            if mutation == 'extra tier': tiers.append(copy.deepcopy(tiers[0]))
            if mutation == 'missing line': tiers[0]['affixes'].pop()
            if mutation == 'extra line': tiers[0]['affixes'].append({'name': 'Strength', 'type': 'Quality', 'value': 99})
            rejects(lambda: SC.catalog_from_raw(raw), 'Slice/Dice set source changed')
        SC.catalog_from_raw(SC.load_raw())  # restore goes green


def test_item_source_drift_and_upstream_repair_require_review():
    item = next(i for i in raw_items() if i['name'] == 'Slice')
    for mutation in ['missing', 'duplicate', 'wrong type', 'wrong value', 'already fixed']:
        changed = copy.deepcopy(item)
        flag = next(a for a in changed['affixes'] if a['name'] == "Slice 'n Dice Set")
        if mutation == 'missing': changed['affixes'].remove(flag)
        if mutation == 'duplicate': changed['affixes'].append(copy.deepcopy(flag))
        if mutation == 'wrong type': flag['type'] = 'Quality'
        if mutation == 'wrong value': flag['value'] = 2
        if mutation == 'already fixed': changed['sets'].append("Slice 'n Dice Set")
        rejects(lambda: PI._record(changed, set()), 'membership source changed')
    assert "Slice 'n Dice Set" in PI._record(item, set())['sets']
    unrelated = {'name': 'Unreviewed', 'affixes': [{'name': "Slice 'n Dice Set", 'type': 'Bool', 'value': 1}], 'sets': []}
    assert PI._record(unrelated, set())['sets'] == [], 'never promote arbitrary Boolean markers'


def test_catalog_population_guard_rejects_zero_missing_duplicate_or_extra_members():
    # Reach the build's check through its public owner; base lacks this contract.
    check = getattr(SC, 'check_slice_dice_members', None)
    assert callable(check), 'membership population needs a non-vacuous build guard'
    records = [PI._record(i, set()) for i in raw_items() if i['name'] in ['Slice','Dice','Epic Slice','Epic Dice']]
    check(records)
    for changed in [[], records[1:], records + [records[0]], records + [{**records[0], 'name': 'Unreviewed'}]]:
        rejects(lambda: check(changed), 'membership population changed')
    check(records)
