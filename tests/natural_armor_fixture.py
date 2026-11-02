"""Complete reviewed source populations for small comparison-CLI fixtures."""
import json
from pathlib import Path
from src import set_catalog as SC

NAMES = ("Might of the Abishai", "Epic Might of the Abishai",
         "Legendary Might of the Abishai", "Wayward Warrior", "Wayward Warrior (Legendary)")


def catalog_rows(*, ac_only=False):
    raw = SC.load_raw()
    rows = {name: raw[name] for name in NAMES}
    if ac_only:
        # Old CLI fixtures isolate other phrases. Supply the complete guarded
        # population without making unrelated DC/ability phrases readable there.
        for tiers in rows.values():
            for tier in tiers:
                tier['affixes'] = [a for a in tier['affixes'] if a['name'] == 'Armor Class']
    return rows


def with_abishai_sources(page, template):
    """Add retained verbatim Abishai context to older unrelated CLI fixtures.

    Called when constructing their initial constants, never while checking a
    mutated source. Catalog vocabulary stays narrow so their old assertions do
    not accidentally admit unrelated spell-DC/ability clauses.
    """
    fixture = json.loads((Path(__file__).parent / 'fixtures/natural_armor_sets.json').read_text())
    row = fixture['page_bodies'][0]
    page += '\n{|class="wikitable"\n|-\n|' + ''.join('{{Anchor|' + a + '}}' for a in row['anchors'])
    page += '\n|Items omitted\n|' + row['raw'] + '\n|}'
    entries = '\n'.join('| ' + name.lower() + ' = {{#vardefine:set|' + name + '}}' + fixture['template_bodies'][name]
                        for name in NAMES[:3]) + '\n'
    assert '| #default' in template
    template = template.replace('| #default', entries + '| #default', 1)
    return page, template
