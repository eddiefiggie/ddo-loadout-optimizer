"""Fail closed when the reviewed compound population or retained evidence changes.

This guard licenses exact component mappings, not live Wiki freshness. The
retained tooltip captures have dates/URLs but no definition revision IDs.
See docs/wiki-evidence/compound-spell-attribution.md for the scoped ruling.
"""
import hashlib
import json
from pathlib import Path

# Independently reviewed exact tooltip text digests, not a heuristic text parser.
REVIEWED = {'Creeping Dust Lore': (['Ice Lore', 'Acid Lore'],
                        'f23ebc4dd97487c44a5d9c426d03107aa88f20ed98e05af5c7a761a66d16dff6'),
 'Dark Restoration Lore': (['Void Lore', 'Healing Lore'],
                           '15d887a4acfea347cc771a57159c2b17f51ef5ff7426d25a80189ae4fb623612'),
 'Firestorm Lore': (['Fire Lore', 'Lightning Lore'],
                    '07fcaa1dac781e0743265a614afbaee668c4a50f8e1777dff84b31888cbfe433'),
 'Frozen Depths Lore': (['Void Lore', 'Ice Lore'],
                        '6e498e7559eb3a7036485f2b410c5c02d0dd7daebb34e1b66746d27c3d97b81c'),
 'Frozen Storm Lore': (['Ice Lore', 'Lightning Lore'],
                       '32c78644ba4284d31f0f41b461d5c5c4e9b1dd5f87a51d4eb3fcc97d7a655fbb'),
 'Power of Creeping Dust': (['Glaciation', 'Corrosion'],
                            '71917a400e21adee3ae15f95d6743bf130b45cd5af52dec06bbe365fe5f7d813'),
 'Power of the Dark Restoration': (['Nullification', 'Devotion'],
                                   '0f8d6fdd968868b44c7ea0763c3a256bfd8aaceff73e9d7b66f0e2bfda0672e1'),
 'Power of the Firestorm': (['Combustion', 'Magnetism'],
                            '5308756187194decf93ba9406f2409551809098770dc9d4664c734313de8c452'),
 'Power of the Frozen Depths': (['Nullification', 'Glaciation'],
                                'e1e2a373c9eba20015914515a181c6a780536638156ee8c1d88b1019ef9486dd'),
 'Power of the Frozen Storm': (['Glaciation', 'Magnetism'],
                               'ab4b855539537371a5ef794e8f49001d0870a71876fd9f662986e20e03106222'),
 'Power of the Frozen Thunderstorm': (['Glaciation', 'Resonance', 'Magnetism'],
                                      '844815ac1eb0cee71d53a1d4b14f8d67ee3445ed52144bec05c426b8f56c6033'),
 'Power of the Silver Flame': (['Devotion', 'Radiance'],
                               '4170084fbe8ac496a881be8cc745856c47bf6a52db06ce55ac6ba7556a24259b'),
 'Power of the Thunderstorm': (['Resonance', 'Magnetism'],
                               'b0ae1ac2187e4e7e58d35eaf31b0d6f41bef0f1b5120c573bf899e49fadc0a61'),
 'Silver Flame Lore': (['Healing Lore', 'Radiance Lore'],
                       '255778f9852c6d68b9f5a5826abd0ca90b82c084c111e29cfb8d2ed80bad431b'),
 'Thunderstorm Lore': (['Sonic Lore', 'Lightning Lore'],
                       '8ca013a41fba780efa48ebe2e307470d7ba298bc445fbd97d2a42dc65bfca1de')}
RETAINED = ['Blighted Lore', 'Frozen Thunderstorm Lore', 'Moonlit Haunt Lore', 'Power of the Blight', 'Power of the Flames of Darkness', 'Power of the Flames of Purity', 'Power of the Moonlit Haunt', 'Power of the Sacred Ground', 'Purifying Flame Lore', 'Sacred Ground Lore']
# These are elementary, universal or separately modelled legacy lore names;
# an unrecognized compound cannot be excused by a generic "ends in Lore" rule.
OTHER_LORES = {
    'acid lore', 'fire lore', 'ice lore', 'cold lore', 'lightning lore',
    'healing lore', 'kinetic lore', 'radiance lore', 'repair lore', 'sonic lore',
    'void lore', 'negative lore', 'spell lore', 'universal spell lore',
    'arcane lore', 'laceration lore',
}


def check_compound_evidence(affix_names, *, tooltips=None, expansions=None):
    """Check an actual affix-name census before expansion; reject empty input."""
    from src import spell_focus
    names = {str(n).strip().lower() for n in affix_names if n and str(n).strip()}
    if not names:
        raise SystemExit('compound spell evidence: zero affix names inspected')
    candidates = {n for n in names if n.startswith('power of ')
                  or (n.endswith(' lore') and n not in OTHER_LORES)}
    if not candidates:
        raise SystemExit('compound spell evidence: zero compound names inspected')
    reviewed = {n.lower(): (targets, digest) for n, (targets, digest) in REVIEWED.items()}
    retained = {n.lower() for n in RETAINED}
    unknown = candidates - reviewed.keys() - retained
    if unknown:
        raise SystemExit('compound spell evidence: unreviewed names ' + repr(sorted(unknown)))
    if expansions is None:
        expansions = {**spell_focus.COMPOUND_SPELLPOWERS, **spell_focus.COMPOUND_LORES}
    expected = {n: targets for n, (targets, _) in reviewed.items()}
    if expansions != expected:
        raise SystemExit('compound spell evidence: expansion scope differs from reviewed definitions')
    if tooltips is None:
        path = Path(__file__).resolve().parents[1] / 'data/seed/compendium/affix_tooltip.json'
        tooltips = json.loads(path.read_text())['harvested']
    for name, (targets, digest) in REVIEWED.items():
        record = tooltips.get(name, {})
        if (record.get('provenance') != 'stated'
                or not all(record.get(k) for k in ['carrier', 'wiki_url', 'harvested'])
                or hashlib.sha256(record.get('tooltip', '').encode()).hexdigest() != digest):
            raise SystemExit('compound spell evidence: missing or changed direct tooltip for ' + name)
    return {'inspected_names': len(names), 'compound_names': len(candidates),
            'admitted': len(candidates & reviewed.keys()), 'retained': len(candidates & retained)}
