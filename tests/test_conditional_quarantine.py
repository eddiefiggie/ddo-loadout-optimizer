"""#88 — the conditional/ramping affix quarantine and its stale guards."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import conditional_quarantine as cq  # noqa: E402

SEED = os.path.join(ROOT, "data", "seed", "compendium", "conditional_affix_quarantine.json")


def _rec(name, affixes):
    return {"name": name, "affixes": list(affixes)}


def test_seed_carries_its_wiki_evidence():
    q = cq.load(SEED)
    assert set(q) == {"Meridian Fragment", "Crystallized Drop of Tea"}
    for record, entries in q.items():
        for e in entries:
            for field in ("name", "type", "from_value", "reason", "wiki_text", "wiki_url", "verified"):
                assert e.get(field), f"{record}: entry missing {field!r}"
            # The evidence must actually state the conditionality it claims.
            assert "stack" in e["wiki_text"].lower() or "when you" in e["wiki_text"].lower(), \
                f"{record}: the recorded wiki text does not state a trigger or a ramp"


def test_apply_drops_only_the_quarantined_affix():
    recs = [_rec("Meridian Fragment", [
        {"name": "Universal Spell Power", "type": "Psionic", "value": "24"},
        {"name": "Efficient Metamagic - Maximize", "type": "Enhancement", "value": "6"},
    ])]
    cov = cq.apply(recs, cq.load(SEED))
    names = [a["name"] for a in recs[0]["affixes"]]
    assert names == ["Efficient Metamagic - Maximize"], names
    assert cov["dropped"] == 1


def test_apply_fails_when_upstream_changed_the_value():
    """The stale guard: 24 is the number the ruling was made against. A different
    number means upstream re-encoded the affix and the wiki must be re-read."""
    recs = [_rec("Meridian Fragment", [
        {"name": "Universal Spell Power", "type": "Psionic", "value": "12"}])]
    try:
        cq.apply(recs, cq.load(SEED))
    except SystemExit as e:
        assert "re-verify" in str(e)
    else:
        raise AssertionError("a changed upstream value must fail the build")


def test_apply_fails_when_the_affix_is_gone():
    recs = [_rec("Meridian Fragment", [{"name": "Something Else", "type": "Enhancement", "value": "1"}])]
    try:
        cq.apply(recs, cq.load(SEED))
    except SystemExit as e:
        assert "no 'Universal Spell Power' affix" in str(e) or "to quarantine" in str(e)
    else:
        raise AssertionError("a vanished affix must fail rather than silently no-op")


def test_assert_all_reached_catches_an_entry_that_reached_nothing():
    q = cq.load(SEED)
    try:
        cq.assert_all_reached(q, {"hit_names": ["Meridian Fragment"]})
    except SystemExit as e:
        assert "Crystallized Drop of Tea" in str(e)
    else:
        raise AssertionError("an unreached entry must fail the build")


def test_a_record_absent_from_this_channel_is_a_silent_no_op():
    """Per-channel silence is correct — an augment is absent from the item roster
    by design. `assert_all_reached` is what closes the gap across channels."""
    cov = cq.apply([_rec("Unrelated", [])], cq.load(SEED))
    assert cov["dropped"] == 0 and cov["hit_names"] == []


def test_missing_file_is_an_empty_overlay():
    assert cq.load(os.path.join(ROOT, "nope.json")) == {}
