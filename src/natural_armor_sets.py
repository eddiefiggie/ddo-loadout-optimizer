"""#951: eight Wiki-verified flat AC clauses, not a second bonus catalog.

These expectations reject source drift; values still come from the raw catalog.
Named item sets rev 720202 / template rev 723530 agree on all eight entries.
Natural armor bonus rev 682710 and Stack rev 669682 establish their AC/type
meaning. See docs/wiki-evidence/natural-armor-sets.md.
"""
from collections import Counter


TYPES = {"Profane Natural": "Profane", "Artifact Natural": "Artifact"}
REVIEWED = {
    "Might of the Abishai": [(3, "Profane Natural", 3), (5, "Profane Natural", 5)],
    "Epic Might of the Abishai": [(3, "Profane Natural", 5), (5, "Profane Natural", 8)],
    "Legendary Might of the Abishai": [(3, "Profane Natural", 10), (5, "Profane Natural", 10)],
    "Wayward Warrior": [(2, "Artifact Natural", 2)],
    "Wayward Warrior (Legendary)": [(2, "Artifact Natural", 5)],
}


def canonical_type(stat, bonus_type):
    """Only flat Armor Class: never infer from an arbitrary 'X Natural' suffix."""
    return TYPES.get(bonus_type, bonus_type) if stat == "Armor Class" else bonus_type


def catalog_review(raw, *, require_complete=False):
    """Guard the reviewed rows plus any new occurrence of either native type.

    Small synthetic consumers can omit entire reviewed sets. Production callers
    require all five sets, so zero/missing populations cannot pass the build.
    Present sets must always carry their complete reviewed rows, verbatim.
    """
    applicable = sorted(REVIEWED if require_complete else set(raw).intersection(REVIEWED))
    expected = Counter((name, count, "Armor Class", ty, str(value))
                       for name in applicable for count, ty, value in REVIEWED[name])
    actual = Counter((name, tier.get("threshold"), a.get("name"), a.get("type"), str(a.get("value")))
                     for name, tiers in raw.items() for tier in tiers or []
                     for a in tier.get("affixes") or []
                     if a.get("type") in TYPES or (name in REVIEWED and a.get("name") == "Armor Class"))
    missing = sorted((expected - actual).elements(), key=repr)
    extra = sorted((actual - expected).elements(), key=repr)
    return {"complete": not missing and not extra, "applicable": applicable,
            "reviewed_clauses": sum(expected.values()), "observed_clauses": sum(actual.values()),
            "missing": missing, "extra": extra}


def check_catalog(raw, *, require_complete=False):
    review = catalog_review(raw, require_complete=require_complete)
    if not review["complete"]:
        raise ValueError("Natural Armor set source changed; recheck Wiki evidence: " + repr(review))
