"""#207 — wiki-sourced value corrections and their stale guard.

The guard is the reason this mechanism is safe to have at all: a correction that
silently pins a number over a source that has since moved is how the value being
corrected here went wrong in the first place. These tests prove the guard fires.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import value_corrections  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "item_value_corrections.json")


def _rec(name, affixes):
    return {"name": name, "affixes": affixes}


def _corr(name="Spell Focus Mastery", type_="Equipment", frm="5", to="8"):
    return {"name": name, "type": type_, "from": frm, "to": to}


def test_a_matching_correction_overwrites_the_value():
    records = [_rec("Ring", [{"name": "Spell Focus Mastery", "type": "Equipment", "value": "5"}])]
    cov = value_corrections.apply(records, {"Ring": [_corr()]})
    assert records[0]["affixes"][0]["value"] == "8"
    assert cov == {"items_corrected": 1, "values_changed": 1}


def test_other_affixes_on_the_item_are_untouched():
    records = [_rec("Ring", [
        {"name": "Spell Focus Mastery", "type": "Equipment", "value": "5"},
        {"name": "Wizardry", "type": "Insight", "value": "155"},
    ])]
    value_corrections.apply(records, {"Ring": [_corr()]})
    assert records[0]["affixes"][1]["value"] == "155"


def test_a_different_bonus_type_is_not_corrected():
    # Sacred Spell Focus Mastery is a separate affix and must not be swept up.
    records = [_rec("Ring", [{"name": "Spell Focus Mastery", "type": "Sacred", "value": "3"}])]
    try:
        value_corrections.apply(records, {"Ring": [_corr()]})
    except SystemExit:
        pass          # correct: no Equipment-typed affix to correct
    assert records[0]["affixes"][0]["value"] == "3"


def test_stale_from_value_fails_the_build():
    """The load-bearing guard: upstream moved, so the correction must be re-verified."""
    records = [_rec("Ring", [{"name": "Spell Focus Mastery", "type": "Equipment", "value": "7"}])]
    try:
        value_corrections.apply(records, {"Ring": [_corr(frm="5")]})
    except SystemExit as e:
        assert "re-verify" in str(e), str(e)
        assert records[0]["affixes"][0]["value"] == "7", "nothing was written on a stale entry"
        return
    raise AssertionError("a stale `from` value must fail the build, not pin a number over it")


def test_a_vanished_affix_fails_the_build():
    records = [_rec("Ring", [{"name": "Wizardry", "type": "Insight", "value": "155"}])]
    try:
        value_corrections.apply(records, {"Ring": [_corr()]})
    except SystemExit as e:
        assert "no 'Spell Focus Mastery'" in str(e) or "re-verify" in str(e), str(e)
        return
    raise AssertionError("a correction targeting an absent affix must fail the build")


def test_an_item_absent_from_the_roster_is_a_silent_no_op():
    # The roster varies with the harvest; a correction waiting for an item to
    # reappear is not an error.
    records = [_rec("Other", [{"name": "Wizardry", "type": "Insight", "value": "10"}])]
    cov = value_corrections.apply(records, {"Ring": [_corr()]})
    assert cov == {"items_corrected": 0, "values_changed": 0}


def test_missing_shard_file_yields_no_corrections():
    assert value_corrections.load(os.path.join(ROOT, "does", "not", "exist.json")) == {}


def test_meta_keys_are_stripped_from_the_shard():
    loaded = value_corrections.load(SHARD)
    assert not any(str(k).startswith("_") for k in loaded)


# --- #374/U4: the shard is retired, and a retirement has to prove itself -------
#
# The 2026-08-18 gear-planner refresh ADOPTED every correction in this shard, so
# the live payload is empty and all 17 entries moved into `_retired_2026_08_18`.
# That is the #207 staleness rule working as designed — the corrections' premise
# was "upstream is wrong", and it stopped being true. The tests below keep the
# coverage that the live entries used to carry by asserting it against the
# retirement block instead, which is now the thing that can silently go wrong:
# retirement is the one exit from this shard that no build guard watches.

def _retired():
    with open(SHARD, encoding="utf-8") as fh:
        return json.load(fh).get("_retired_2026_08_18") or {}


def _retired_entries():
    return _retired().get("entries") or {}


def _raw_affixes(record):
    """The `{name, type, value}` dicts on the NAMED record across all three raw
    channels. Scoped deliberately: a global walk finds some other record carrying
    the corrected number and would wave through a bogus retirement."""
    from src import vocabulary

    def _named(obj):
        out = []
        if isinstance(obj, dict):
            if obj.get("name") == record and "affixes" in obj:
                out.append(obj)
            else:
                for v in obj.values():
                    out += _named(v)
        elif isinstance(obj, list):
            for v in obj:
                out += _named(v)
        return out

    seen = []
    for path in (vocabulary.ITEMS_PATH, vocabulary.CRAFTING_PATH, vocabulary.SETS_PATH):
        seen += [a for r in _named(vocabulary._load(path))
                 for a in vocabulary.iter_affixes(r)]
    return seen


def _flip(name):
    """Our canon -> upstream's spelling, from the shipped canon-defence shard.
    Two retired entries are keyed on a name upstream renamed in the same refresh
    (`Impulse`/`Force Spell Power`, `Corrosion`/`Acid Spell Power`), so the
    adoption check has to look for the value under BOTH spellings."""
    shard = os.path.join(ROOT, "data", "seed", "compendium",
                         "affix_name_corrections.json")
    with open(shard, encoding="utf-8") as fh:
        corr = json.load(fh)["corrections"]
    return {c["canonical_name"]: c["source_name"] for c in corr}.get(name)


def _retyped_to(item, affix):
    """The bonus type a RETIRED `affix_type_corrections` entry moved this affix to,
    if any. `Juiblex's Reign / Acid Absorption` was corrected on both axes and
    upstream adopted both, so the value now lives under the corrected TYPE."""
    path = os.path.join(ROOT, "data", "seed", "compendium",
                        "affix_type_corrections.json")
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    pools = [doc, (doc.get("_retired_2026_08_18") or {}).get("entries") or {}]
    for pool in pools:
        for e in pool.get(item) or []:
            if isinstance(e, dict) and e.get("name") == affix:
                return str(e["to"])
    return None


#: #619 — the eight {{Power Store}} carriers, the only live corrections in this
#: shard. Pinned by name rather than by count so a stray entry fails here instead
#: of riding in behind a bumped number.
LIVE_619 = {
    "Cormyrian Green Dragonhide Armor", "Cormyrian Green Dragonplate Armor",
    "Cormyrian Green Dragonscale Armor", "Cormyrian Green Dragonscale Docent",
    "Cormyrian Green Dragonscale Robe", "Green Dragonscale Bracers",
    "Legendary Green Dragonscale Bracers", "Staff of the Petitioner",
}


def test_the_only_live_corrections_are_619_and_the_retirement_is_on_the_record():
    """The #288 payload is still retired; the shard is no longer empty.

    It WAS empty, and this test asserted exactly that. #619 landed the first live
    corrections since the #288 batch retired — eight items whose `Magical
    Efficiency` magnitude gear-planner cannot read, because {{Power Store}} keeps
    its number in the template body rather than a parameter.

    So the assertion moves from "nothing is live" to "these eight are, by name".
    That keeps what the original was protecting — an unexplained correction
    reappearing — while admitting the one that has its evidence recorded.
    """
    live = set(value_corrections.load(SHARD))
    assert live == LIVE_619, (
        f"unexpected live correction(s): {sorted(live - LIVE_619)}; "
        f"missing: {sorted(LIVE_619 - live)}. A live correction needs its own "
        "wiki evidence and its own entry in this set, not a silent arrival.")
    block = _retired()
    assert (block.get("why") or "").strip(), "a retirement with no stated reason"
    assert "767a7f747d0e7d211a702b8c456348e1c36ba699" in (block.get("verified") or ""), \
        "a retirement must name the upstream commit it was verified against"
    assert sum(len(v) for v in _retired_entries().values()) == 17, \
        "all 17 corrections retired together; a partial move loses the evidence"


def test_the_shipped_shard_carries_its_wiki_evidence():
    """Every correction states the rendered tooltip it came from, not just a
    number — asserted over live entries AND retired ones, so retirement cannot be
    used to smuggle an entry past the evidence rule."""
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    live = [(k, v) for k, v in raw.items() if not str(k).startswith("_")]
    seen = 0
    for item, entries in live + list(_retired_entries().items()):
        for e in entries:
            seen += 1
            for field in ("name", "type", "from", "to", "tooltip", "wiki_url", "verified"):
                assert e.get(field), f"{item}: correction is missing {field!r}"
            assert str(e["to"]) in e["tooltip"], (
                f"{item}: the corrected value {e['to']!r} does not appear in the "
                f"recorded tooltip — the evidence does not support the number")
    assert seen == 25, seen   # 17 retired (#288) + 8 live (#619)


def test_a_retired_correction_is_one_upstream_actually_adopted():
    """The claim a retirement makes, checked against the data rather than taken on
    the note's word: upstream must now read our corrected `to` value on that exact
    record, and must no longer read the `from` value we were correcting away.

    This is the guard the retirement itself did not have. Its sibling shard
    (`affix_type_corrections.json`) was retired in the same migration with a note
    that justified one of its three entries; the other two were still live. Nothing
    catches that except a per-entry comparison against raw.
    """
    checked = 0
    for item, entries in _retired_entries().items():
        raw = _raw_affixes(item)
        assert raw, f"{item}: no such record in the refreshed raw to verify against"
        for e in entries:
            names = {e["name"], _flip(e["name"])} - {None}
            # a correction targets ONE (name, type) pair — `Legendary Argonnessen
            # Eye Band` carries both Equipment and Sacred `Spell Focus Mastery`,
            # so matching on name alone reads the wrong affix.
            types = {str(e["type"]), _retyped_to(item, e["name"])} - {None}
            hits = [a for a in raw if a.get("name") in names
                    and str(a.get("type")) in types]
            assert hits, (item, e["name"], e["type"],
                          "affix vanished upstream — not an adoption")
            values = {str(a.get("value")) for a in hits}
            assert values == {str(e["to"])}, (
                f"{item} / {e['name']} / {e['type']}: retired on the premise that "
                f"upstream adopted {e['to']!r}, but raw reads {sorted(values)}. A "
                f"correction upstream has not adopted is still live and must not "
                f"be retired")
            checked += 1
    assert checked == 17, checked


def test_the_288_batch_is_retired_intact_and_still_names_no_verified_unchanged_item():
    """The #288 U81 Reign pull-back batch, re-ratified onto the retirement block.

    Same two claims as before — the seven drifted Reigns each carry their exact
    entry count, and the artifacts verified as matching the wiki carry none — so
    a retirement that quietly drops or invents an item is still caught.
    """
    entries = _retired_entries()
    reigns = {"Orcus' Reign": 1, "Juiblex's Reign": 3, "Demogorgon's Reign": 2,
              "Fraz-Urb'luu's Reign": 4, "Zuggtmoy's Reign": 4,
              "Lolth's Reign": 1, "Graz'zt's Reign": 1}
    for item, n in reigns.items():
        assert len(entries.get(item) or []) == n, (item, len(entries.get(item) or []))
    # Verified-and-unchanged artifacts must NOT carry entries: Baphomet's and
    # Yeenoghu's Reigns match the wiki, as do all six ML32 Unholy Defiler
    # artifacts (swept 2026-08-13).
    for item in ("Baphomet's Reign", "Yeenoghu's Reign", "Beltstrap of Forbidden Tomes",
                 "Blade-Barbed Bandolier", "Buckle of Assimilation",
                 "Desolation Spectacles", "Eyes of Defilement", "Misery Monocle"):
        assert item not in entries, f"{item} was verified unchanged — no entry belongs"


def test_the_argonnessen_correction_is_the_one_we_verified():
    """Re-ratified onto the retirement block: the entry is unchanged, it has simply
    moved, and the wiki value it established (Equipment Spell Focus Mastery 8) is
    what upstream now ships natively."""
    entry = _retired_entries()["Legendary Argonnessen Eye Band"][0]
    assert (entry["name"], entry["type"], entry["from"], entry["to"]) == (
        "Spell Focus Mastery", "Equipment", "5", "8")
    assert [a for a in _raw_affixes("Legendary Argonnessen Eye Band")
            if a.get("name") == "Spell Focus Mastery"
            and a.get("type") == "Equipment" and str(a.get("value")) == "8"]


def test_the_built_reigns_score_the_wiki_values():
    path = os.path.join(os.path.dirname(__file__), "..", "web", "data", "items.json")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        items = {i["variant_id"]: i for i in json.load(fh)["items"]}

    def aff(item, name, type_):
        return next(a for a in items[item]["affixes"]
                    if a["name"] == name and a["type"] == type_)

    assert aff("Orcus' Reign", "Necromancy Focus", "Insight")["value"] == "8"
    # The gap entry: the pull-back ADDED Quality False Life +15 to Orcus.
    assert aff("Orcus' Reign", "False Life", "Quality")["value"] == "15"
    # ... and rebuilding is idempotent about it: exactly one such affix.
    assert sum(1 for a in items["Orcus' Reign"]["affixes"]
               if a["name"] == "False Life") == 1
    assert aff("Juiblex's Reign", "Sheltering", "Insight")["value"] == "21"
    assert aff("Juiblex's Reign", "False Life", "Profane")["value"] == "56"
    # Value AND type corrected, in that order (16->15 at Enhancement, then
    # Enhancement->Insight): the tooltip states an Insight bonus.
    assert aff("Juiblex's Reign", "Acid Absorption", "Insight")["value"] == "15"
    assert not any(a["name"] == "Acid Absorption" and a["type"] == "Enhancement"
                   for a in items["Juiblex's Reign"]["affixes"])
    assert aff("Demogorgon's Reign", "Fortification", "Insight")["value"] == "87"
    assert aff("Fraz-Urb'luu's Reign", "Command", "Competence")["value"] == "8"
    assert aff("Fraz-Urb'luu's Reign", "Evocation Focus", "Equipment")["value"] == "16"
    assert aff("Zuggtmoy's Reign", "Corrosion", "Quality")["value"] == "43"
    assert aff("Lolth's Reign", "Sheltering", "Insight")["value"] == "21"
    assert aff("Graz'zt's Reign", "Armor Class", "Natural")["value"] == "16"
    # Demogorgon's Potency 31->30 lands pre-expansion, so it surfaces as the ten
    # element spellpowers at the corrected value (#290 interaction).
    assert aff("Demogorgon's Reign", "Nullification", "Quality")["value"] == "30"
    # The verified-unchanged control pair really is unchanged.
    assert aff("Baphomet's Reign", "Sheltering", "Quality")["value"] == "11"
    assert aff("Yeenoghu's Reign", "Deadly", "Quality")["value"] == "4"
