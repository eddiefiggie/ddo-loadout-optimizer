"""#411 — the invariant that makes stripping `(level N)` safe.

The Trove import matches an owned name against the catalog's `source_item`, whose
docstring calls it "the base item". For 1,323 variants across 288 base items it is
not: the wiki disambiguates a level-scaled named item by page title, so
`Cloak of Winter's End` arrives as nine records named `… (level 4|8|…|36)`. None
of the 288 appears unsuffixed, so an export writing the in-game name — which
carries no level — missed every one of them.

`web/import.js` therefore strips that suffix when matching. That is only safe
because the suffix is REDUNDANT: the level it names is already `ml`. This asserts
the redundancy rather than assuming it. The moment a name says one level and `ml`
says another, stripping starts throwing away the only copy of a real fact, and the
importer would silently admit the wrong tier.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

DATASET = os.path.join(ROOT, "web", "data", "items.json")
LEVEL_SUFFIX = re.compile(r"^(?P<base>.*?)\s*\(level\s+(?P<level>\d+)\)$", re.I)


def _suffixed():
    with open(DATASET) as fh:
        items = json.load(fh)["items"]
    out = []
    for item in items:
        name = item.get("source_item") or ""
        match = LEVEL_SUFFIX.match(name)
        if match:
            out.append((item, match.group("base"), int(match.group("level"))))
    return out


def test_the_level_in_the_name_is_always_the_item_s_ml():
    rows = _suffixed()
    # Non-vacuity: a rename upstream would empty this and the assertion below would
    # pass by inspecting nothing, which is exactly when the importer would break.
    assert len(rows) > 500, f"only {len(rows)} suffixed names found; the pattern no longer matches"
    # 397c673 — one KNOWN wiki self-contradiction, allowlisted by name so a SECOND
    # one cannot hide behind it. `Item:Legendary Ratkiller (level 36)` is the page's
    # own title, but the infobox on that page states `Minimum Level 32`, and
    # gear-planner scraped both faithfully — so the disagreement is the wiki's, not
    # upstream's and not ours. ml=32 is the sourced value (the infobox states it);
    # the suffix is the page title. Stripping the suffix to match an owned name is
    # still correct here, because the base name `Legendary Ratkiller` is what the
    # importer needs; what is lost is only the suffix's claim about the level, which
    # was already wrong. Verified on the rendered page 2026-09-22.
    WIKI_TITLE_DISAGREES_WITH_ITS_OWN_INFOBOX = {"Legendary Ratkiller (level 36)": 32}
    mismatched = [(i["source_item"], i.get("ml")) for i, _, lvl in rows
                  if i.get("ml") != lvl
                  and WIKI_TITLE_DISAGREES_WITH_ITS_OWN_INFOBOX.get(i["source_item"]) != i.get("ml")]
    # The allowlist must stay live: if upstream or the wiki fixes the page, this
    # entry stops matching anything and should be retired rather than left standing.
    _allowlisted = [i for i, _, lvl in rows
                    if i["source_item"] in WIKI_TITLE_DISAGREES_WITH_ITS_OWN_INFOBOX]
    assert len(_allowlisted) == 1, (
        "the Legendary Ratkiller allowlist entry matches nothing — the page was "
        "probably fixed; retire the entry instead of leaving it asserting a stale claim")
    assert not mismatched, (
        "a `(level N)` suffix disagrees with the item's `ml`: "
        + ", ".join(f"{n} has ml={m}" for n, m in mismatched[:8])
        + ". web/import.js strips that suffix to match an owned name, which is only "
        "lossless while the level is a restatement of `ml`. Fix the data, or stop "
        "stripping and match some other way.")


def test_stripping_the_suffix_never_collides_two_different_items():
    """Two catalog items whose base names collide would make one owned name admit
    both. Measured rather than assumed — the whole fix rests on the base name still
    identifying one item."""
    rows = _suffixed()
    by_base = {}
    for item, base, _ in rows:
        by_base.setdefault(base, set()).add(item.get("source_item"))
    # Every name under one base must itself be that base plus a level — never a
    # second, differently-named item.
    for base, names in by_base.items():
        for name in names:
            assert LEVEL_SUFFIX.match(name).group("base") == base, (base, name)


def test_no_base_name_also_exists_unsuffixed():
    """If a base name existed BOTH ways, an owned name would be ambiguous between
    the plain record and the level-scaled family, and matching would need a rule
    for which wins. It does not today — asserted so the fix's premise is checked,
    not remembered."""
    with open(DATASET) as fh:
        items = json.load(fh)["items"]
    all_names = {i.get("source_item") for i in items if i.get("source_item")}
    bases = {base for _, base, _ in _suffixed()}
    both = sorted(bases & all_names)
    assert not both, (
        f"these exist both plain and level-suffixed: {both[:8]}. An owned name now "
        "matches two different catalog records and the importer has no rule for which.")


def test_the_importer_actually_strips_it():
    """The data invariant above is only worth asserting while something depends on
    it. If the importer stops stripping, these guards are measuring nothing."""
    with open(os.path.join(ROOT, "web", "import.js")) as fh:
        src = fh.read()
    assert "_LEVEL_SUFFIX" in src and "baseItemName" in src, (
        "web/import.js no longer strips `(level N)`, so this file guards an "
        "invariant nothing relies on — retire them together.")
