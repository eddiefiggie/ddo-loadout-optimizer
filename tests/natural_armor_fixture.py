"""Complete reviewed source population for small comparison-CLI fixtures."""
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
