"""#952: exact piece-count phrases; source Template:Named item sets rev 723530."""
from src import wiki_sets as S
from src.affix_parser import BONUS_TYPES


def test_named_two_piece_header_applies_to_following_bonuses():
    # Anger of the Avalanche, verbatim header and one bonus from the template.
    result = S._tiers_from_lines([
        'While wearing two pieces from the Anger of the Avalanche set, you gain:',
        '+30 Artifact bonus to Cold, Sonic, and Electric Spell Power',
    ])
    assert result == {2: ['+30 Artifact bonus to Cold, Sonic, and Electric Spell Power']}


def test_named_three_piece_header_and_inline_both_preserve_effect_markup():
    assert S._tiers_from_lines([
        'While wearing three items from the Dreadkeeper set, you gain:',
        '+2 Artifact bonus to Intelligence',
    ]) == {3: ['+2 Artifact bonus to Intelligence']}
    assert S._tiers_from_lines([
        "While wearing both items from the Captain's Set, you gain: +1 [[Quality bonus]] to [[Strength]]"
    ]) == {2: ['+1 [[Quality bonus]] to [[Strength]]']}


def test_full_sentence_count_does_not_convert_unreadable_effect_to_affix():
    line = ('When all three items from the set are equipped, you will gain a 10% '
            'Enhancement discount to the Spell Point cost of all your spells.')
    tiers = S._tiers_from_lines([line])
    assert tiers == {3: [line]}
    assert 'quarantine' in S.read_clause(tiers[3][0], BONUS_TYPES, {'Spell Power'})


def test_savant_sentence_stating_both_items_is_retained_and_quarantined():
    line = ('This item is one of the two pieces of the Air Savant set. When both items '
            'are equipped, you gain a +2% Artifact bonus to your Electric Spell Critical Chance.')
    tiers = S._tiers_from_lines([line])
    assert tiers == {2: [line]}
    assert 'quarantine' in S.read_clause(tiers[2][0], BONUS_TYPES, {'Electric Lore'})


def test_unknown_phrases_and_item_lists_never_establish_count():
    for line in [
        'While wearing two pieces from the Imaginary set, you gain:',
        'When both items are equipped, you gain a +2% Artifact bonus to X.',
        'When all four items from the set are equipped, you gain a bonus.',
        'Two items: Ring and Cloak',
    ]:
        assert S._tiers_from_lines([line]) == {None: [line]}


def test_unreviewed_count_condition_does_not_inherit_previous_threshold():
    tiers = S._tiers_from_lines([
        '2 Pieces Equipped:', '+2 Artifact bonus to Intelligence',
        'While wearing four pieces from the Imaginary set, you gain:',
        '+4 Artifact bonus to Intelligence',
    ])
    assert tiers == {2: ['+2 Artifact bonus to Intelligence'], None: [
        'While wearing four pieces from the Imaginary set, you gain:',
        '+4 Artifact bonus to Intelligence',
    ]}
    # A different unknown header shape is not silently a continuation either.
    assert S._tiers_from_lines(['2 Pieces Equipped:', 'Equip four pieces:',
                                '+4 Artifact bonus to Intelligence']) == {
        2: [], None: ['Equip four pieces:', '+4 Artifact bonus to Intelligence']}


def test_weapon_and_armor_requirement_is_not_a_bare_two_piece_tier():
    header = ('While wearing both an Elemental Evil Set Item weapon and an Elemental Evil '
              'Set Item armor, you gain:')
    tiers = S._tiers_from_lines([header, '+20 Quality bonus to Melee Power'])
    assert tiers == {None: [header, '+20 Quality bonus to Melee Power']}


def test_synthetic_page_and_template_fixtures_share_reader_without_counting_items():
    # The page fixture is synthetic: the real page uses a numeric header.
    header = 'While wearing two pieces from the Anger of the Avalanche set, you gain:'
    template = '<onlyinclude>{{#switch:x\n | anger of the avalanche = ' + header + '<br />+2 Artifact bonus to Intelligence{{#vardefine:set|Anger of the Avalanche}}\n | #default = Undefined\n}}</onlyinclude>'
    page = '''{| class="wikitable"
|-
|{{Anchor|Anger of the Avalanche}}Anger of the Avalanche
|* {{Item|A}}\n* {{Item|B}}\n* {{Item|C}}
|''' + header + '''\n* +2 Artifact bonus to Intelligence
|}'''
    assert S.template_sets(template)['anger of the avalanche']['tiers'] == {2: ['+2 Artifact bonus to Intelligence']}
    assert S.page_sets(page)[0]['tiers'] == {2: ['* +2 Artifact bonus to Intelligence']}
