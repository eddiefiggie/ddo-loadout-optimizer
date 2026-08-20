"""#259 — wiki-sourced bonus-type corrections and their stale guards.

Same safety argument as its #207 sibling: the guards are what make the
mechanism safe to have. A type correction that silently pins over a moved
source — or silently reaches nothing after an upstream rename — recreates the
staleness it exists to fix. These tests prove every guard fires.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import type_corrections  # noqa: E402

SHARD = os.path.join(ROOT, "data", "seed", "compendium", "affix_type_corrections.json")


def _rec(name, affixes):
    return {"name": name, "affixes": affixes}


def _corr(name="Action Boost Charges", frm="Untyped", to="Enhancement", value="3"):
    return {"name": name, "from": frm, "to": to, "value": value}


def _moment(type_="Untyped", value="3"):
    return _rec("Legendary Moment to Legendary Moment",
                [{"name": "Action Boost Charges", "type": type_, "value": value}])


def test_a_matching_correction_overwrites_the_type_and_only_the_type():
    records = [_moment()]
    cov = type_corrections.apply(
        records, {"Legendary Moment to Legendary Moment": [_corr()]})
    (affix,) = records[0]["affixes"]
    assert affix["type"] == "Enhancement"
    assert affix["value"] == "3"          # the magnitude is not this module's field
    assert affix["name"] == "Action Boost Charges"
    assert cov["records_corrected"] == 1
    assert cov["types_changed"] == 1


def test_an_affix_already_carrying_another_type_is_not_swept_up():
    # An Enhancement-typed sibling is a different stacking bucket; correcting it
    # from `Untyped` must not touch it.
    records = [_moment(type_="Enhancement")]
    try:
        type_corrections.apply(
            records, {"Legendary Moment to Legendary Moment": [_corr()]})
    except SystemExit:
        pass          # correct: no Untyped affix left to correct — upstream moved
    assert records[0]["affixes"][0]["type"] == "Enhancement"


def test_a_stale_from_type_fails_the_build():
    """Upstream already retyped the affix; reapplying on faith must fail."""
    records = [_moment(type_="Insight")]
    try:
        type_corrections.apply(
            records, {"Legendary Moment to Legendary Moment": [_corr()]})
    except SystemExit as e:
        assert "re-verify" in str(e), str(e)
        assert records[0]["affixes"][0]["type"] == "Insight", \
            "nothing may be written on a stale entry"
        return
    raise AssertionError("a stale `from` type must fail the build")


def test_a_moved_value_fails_the_build():
    """The value binds the entry to the tooltip that proved it. A different
    magnitude upstream means the record is no longer the one verified."""
    records = [_moment(value="5")]
    try:
        type_corrections.apply(
            records, {"Legendary Moment to Legendary Moment": [_corr(value="3")]})
    except SystemExit as e:
        assert "re-verify" in str(e), str(e)
        assert records[0]["affixes"][0]["type"] == "Untyped"
        return
    raise AssertionError("a moved value must fail the build, not retype on faith")


def test_a_record_absent_from_this_channel_is_a_silent_no_op():
    # The entry may live in the other channel (item vs augment pool).
    records = [_rec("Other", [{"name": "Wizardry", "type": "Insight", "value": "10"}])]
    cov = type_corrections.apply(
        records, {"Legendary Moment to Legendary Moment": [_corr()]})
    assert cov["records_corrected"] == 0
    assert cov["types_changed"] == 0


def test_an_entry_reaching_no_channel_fails_the_build():
    """The cross-channel guard: a renamed record upstream must not turn the
    correction into a silent no-op everywhere."""
    corrections = {"Legendary Moment to Legendary Moment": [_corr()]}
    empty = type_corrections.apply([], corrections)
    try:
        type_corrections.assert_all_reached(corrections, empty, empty)
    except SystemExit as e:
        assert "no record in any channel" in str(e), str(e)
        return
    raise AssertionError("an unreached entry must fail the build")


def test_all_reached_passes_when_any_channel_carries_the_record():
    corrections = {"Legendary Moment to Legendary Moment": [_corr()]}
    items_cov = type_corrections.apply([], corrections)          # silent no-op
    augments_cov = type_corrections.apply([_moment()], corrections)
    type_corrections.assert_all_reached(corrections, items_cov, augments_cov)


def test_missing_shard_file_yields_no_corrections():
    assert type_corrections.load(os.path.join(ROOT, "does", "not", "exist.json")) == {}


def test_the_shipped_shard_carries_its_wiki_evidence():
    """Every correction states the rendered tooltip it came from, and the
    tooltip must state the corrected type — evidence, not assertion."""
    with open(SHARD, encoding="utf-8") as fh:
        raw = json.load(fh)
    entries_seen = 0
    for record, entries in raw.items():
        if str(record).startswith("_"):
            continue
        for e in entries:
            entries_seen += 1
            for field in ("name", "to", "value", "tooltip", "wiki_url",
                          "verified"):
                assert e.get(field), f"{record}: correction is missing {field!r}"
            # #367 — `from` is the one field whose legitimate value can be falsy.
            # Upstream carries some affixes with NO `type` key at all, and `None`
            # is the faithful record of that: `apply()` matches it against
            # `a.get("type")`, so a null `from` is what makes a key-less affix
            # correctable. A truthiness check conflated "field absent from the
            # entry" with "entry recording an absent upstream type" — the same
            # falsy-is-not-a-population trap AGENTS.md records. Require the KEY.
            assert "from" in e, f"{record}: correction is missing 'from'"
            assert str(e["to"]) in e["tooltip"], (
                f"{record}: the corrected type {e['to']!r} does not appear in the "
                f"recorded tooltip — the evidence does not support it")
            assert str(e["value"]) in e["tooltip"], (
                f"{record}: the binding value {e['value']!r} does not appear in "
                f"the recorded tooltip")
    assert entries_seen >= 2, "the shipped shard lost its Moment to Moment entries"


def test_the_moment_corrections_are_the_ones_we_verified():
    loaded = type_corrections.load(SHARD)
    legendary = loaded["Legendary Moment to Legendary Moment"][0]
    assert (legendary["name"], legendary["from"], legendary["to"],
            legendary["value"]) == ("Action Boost Charges", "Untyped",
                                    "Enhancement", "3")
    heroic = loaded["Moment to Moment"][0]
    assert (heroic["from"], heroic["to"], heroic["value"]) == (
        "Untyped", "Enhancement", "1")


# --- #374/U4: retirement, and what a retirement must prove -------------------

def _retired(shard_path=SHARD):
    with open(shard_path, encoding="utf-8") as fh:
        return json.load(fh).get("_retired_2026_08_18") or {}


def _raw_affixes(record=None):
    """The ``{name, type, value}`` dicts in the refreshed raw, across all three
    channels — the corpus a retirement's premise has to be true of.

    ``record`` scopes the walk to the named item/augment. Scoping matters: a
    global walk finds SOME record carrying the corrected pair and would wave
    through a retirement whose own target still carries the bug.
    """
    from src import vocabulary
    seen = []
    for path in (vocabulary.ITEMS_PATH, vocabulary.CRAFTING_PATH, vocabulary.SETS_PATH):
        raw = vocabulary._load(path)
        if record is None:
            seen += list(vocabulary.iter_affixes(raw))
        else:
            seen += [a for r in _records_named(raw, record)
                     for a in vocabulary.iter_affixes(r)]
    return seen


def _records_named(obj, name):
    """Every dict in a raw structure whose ``name`` is ``name`` and which owns an
    ``affixes`` block — i.e. the record a correction is keyed on."""
    out = []
    if isinstance(obj, dict):
        if obj.get("name") == name and "affixes" in obj:
            out.append(obj)
        else:
            for v in obj.values():
                out += _records_named(v, name)
    elif isinstance(obj, list):
        for v in obj:
            out += _records_named(v, name)
    return out


def test_374_the_retirement_block_records_evidence_for_every_retired_entry():
    """A correction may only leave this shard with its reason on the record.

    Retirement is the one exit that is not a guard firing, so nothing in the
    pipeline checks it — it has to be checked here or a live correction can be
    deleted with a sentence that describes a different entry.
    """
    block = _retired()
    assert block, "the #374 retirement block must stay as the record"
    assert (block.get("why") or "").strip(), "a retirement with no stated reason"
    assert "767a7f747d0e7d211a702b8c456348e1c36ba699" in (block.get("verified") or ""), \
        "a retirement must name the upstream commit it was verified against"
    entries = block.get("entries") or {}
    assert entries, "an empty retirement block records nothing"
    for record, corrections in entries.items():
        for e in corrections:
            for field in ("name", "from", "to", "value", "tooltip", "wiki_url",
                          "verified"):
                assert e.get(field), f"{record}: retired entry is missing {field!r}"


def test_374_a_retired_correction_is_one_upstream_actually_adopted():
    """The invariant a retirement asserts, checked against the data rather than
    taken on the note's word: upstream must now carry the corrected ``to`` type at
    the recorded value, so the correction really is a no-op.

    This is the guard the migration needed and did not have. The same edit that
    retired the (genuinely adopted) `Juiblex's Reign` entry also retired both
    `Moment to Moment` entries, which upstream has NOT adopted — it still emits
    ('Action Boost Charges', 'Untyped') on both stones. They are restored to the
    live shard; this test is what stops the same silent deletion happening again.
    """
    checked = 0
    for record, corrections in (_retired().get("entries") or {}).items():
        raw = _raw_affixes(record)
        assert raw, f"{record}: no such record in the refreshed raw to verify against"
        for e in corrections:
            adopted = [a for a in raw
                       if a.get("name") == e["name"]
                       and str(a.get("type")) == str(e["to"])
                       and str(a.get("value")) == str(e["value"])]
            assert adopted, (
                f"{record}: retired on the premise that upstream adopted "
                f"({e['name']!r}, {e['to']!r}, {e['value']!r}) — but no affix in the "
                f"refreshed raw carries it. A correction upstream has not adopted is "
                f"still live and must not be retired")
            still_wrong = [a for a in raw
                           if a.get("name") == e["name"]
                           and str(a.get("type")) == str(e["from"])
                           and str(a.get("value")) == str(e["value"])]
            assert not still_wrong, (
                f"{record}: upstream still emits the uncorrected "
                f"({e['name']!r}, {e['from']!r}, {e['value']!r}) — the retype is not "
                f"a no-op and the entry must stay live")
            checked += 1
    assert checked, "no retired entry was compared — the check must not pass vacuously"


def test_374_the_moment_corrections_are_still_live_because_upstream_kept_the_bug():
    """Both #259 entries are load-bearing after the refresh, stated as the fact
    that makes them so: the augment pool still types the charges `Untyped`.

    Asserts PRESENCE, not exclusivity. This used to pin the shard's whole key set,
    which was accurate while the #259 pair were the only survivors of the #374
    retirement — but #379 added six `Elemental Resistance` corrections, and an
    exclusivity assertion would have failed for a reason that has nothing to do
    with what this test is about."""
    loaded = type_corrections.load(SHARD)
    assert {"Moment to Moment", "Legendary Moment to Legendary Moment"} <= set(loaded), \
        sorted(loaded)
    raw = _raw_affixes()
    for value in ("1", "3"):
        assert [a for a in raw if a.get("name") == "Action Boost Charges"
                and str(a.get("type")) == "Untyped" and str(a.get("value")) == value], \
            f"expected an Untyped Action Boost Charges +{value} still in raw"
