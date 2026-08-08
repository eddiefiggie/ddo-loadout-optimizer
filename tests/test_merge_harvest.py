"""U1 — harvest driver + provenance model (issues #154, #162).

The wiki harvest runs in the browser; this is the repo-side half that turns a raw
dump into a seed shard. Two properties carry the weight:

  * PROVENANCE. Every value records whether the wiki STATED it or fell back to a
    template default. `Template:Speed` says outright that its attack-speed values
    are hand-maintained and unrecorded magnitudes silently render 5%, so a value
    we cannot distinguish from that default must never reach the solver.
  * IDEMPOTENT, DELTA-AWARE MERGE. A re-import must surface only genuinely new
    items, and must never silently overwrite a harvested value with a different
    one — a contradiction is a review event, not a merge.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src import harvest  # noqa: E402


ROSTER = {"Item:Ash Boots", "Item:Brazenband", "Item:Cape of the Roc",
          "Item:Goatskin Boots (level 19)", "Item:Belt of the Ram"}

TODAY = "2026-08-07"


def _empty():
    return harvest.new_shard("speed_enchantment")


def _dump(**records):
    return records


def test_merge_adds_new_records_with_provenance_and_date():
    shard = _empty()
    stats = harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "{{Striding|30}}"},
        "Item:Brazenband": {"value": {"movement": 30, "alacrity": 7}, "provenance": "stated", "raw": "{{Speed|VII}}"},
    }), ROSTER, today=TODAY)

    assert stats["added"] == 2, stats
    assert set(shard["harvested"]) == {"Item:Ash Boots", "Item:Brazenband"}
    for rec in shard["harvested"].values():
        assert rec["provenance"] == "stated"
        assert rec["harvested"] == TODAY
        assert rec["raw"]


def test_remerging_the_same_dump_is_a_noop():
    """Idempotent: no duplicates and no harvest-date churn on a repeat run."""
    shard = _empty()
    dump = _dump(**{"Item:Ash Boots": {"value": {"movement": 30},
                                       "provenance": "stated", "raw": "{{Striding|30}}"}})
    harvest.merge(shard, dump, ROSTER, today=TODAY)
    stats = harvest.merge(shard, dump, ROSTER, today="2026-09-01")

    assert stats["added"] == 0 and stats["unchanged"] == 1, stats
    assert shard["harvested"]["Item:Ash Boots"]["harvested"] == TODAY, \
        "a no-op re-merge must not churn the harvest date"


def test_contradicting_record_raises_rather_than_overwriting():
    shard = _empty()
    harvest.merge(shard, _dump(**{"Item:Ash Boots": {
        "value": {"movement": 30}, "provenance": "stated", "raw": "{{Striding|30}}"}}),
        ROSTER, today=TODAY)
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {
            "value": {"movement": 15}, "provenance": "stated", "raw": "{{Striding|15}}"}}),
            ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "Ash Boots" in str(exc), exc
    else:
        raise AssertionError("a contradicting value must raise, not overwrite")


def test_record_missing_provenance_is_rejected():
    shard = _empty()
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {"value": {"movement": 30}}}),
                      ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "provenance" in str(exc), exc
    else:
        raise AssertionError("a record with no provenance must be rejected")


def test_unknown_provenance_value_is_rejected():
    shard = _empty()
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {
            "value": {"movement": 30}, "provenance": "probably"}}), ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "probably" in str(exc), exc
    else:
        raise AssertionError("an unrecognized provenance value must be rejected")


def test_stated_provenance_requires_a_value():
    """`stated` asserts the wiki said it — an empty value contradicts the claim."""
    shard = _empty()
    try:
        harvest.merge(shard, _dump(**{"Item:Ash Boots": {
            "value": None, "provenance": "stated"}}), ROSTER, today=TODAY)
    except harvest.HarvestError as exc:
        assert "stated" in str(exc), exc
    else:
        raise AssertionError("stated provenance with no value must be rejected")


def test_defaulted_and_unsourced_records_may_carry_no_value():
    """Both are the exclude-until-verified outcomes: recorded, but never solver-fed."""
    shard = _empty()
    stats = harvest.merge(shard, _dump(**{
        "Item:Cape of the Roc": {"value": None, "provenance": "defaulted",
                                 "raw": "{{Speed|21}}"},
        "Item:Belt of the Ram": {"value": None, "provenance": "unsourced"},
    }), ROSTER, today=TODAY)

    assert stats["added"] == 2, stats
    assert harvest.solver_eligible(shard["harvested"]["Item:Cape of the Roc"]) is False
    assert harvest.solver_eligible(shard["harvested"]["Item:Belt of the Ram"]) is False


def test_dump_title_absent_from_the_roster_is_ignored():
    shard = _empty()
    stats = harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "x"},
        "Item:Not In Our Roster": {"value": {"movement": 5}, "provenance": "stated", "raw": "y"},
    }), ROSTER, today=TODAY)

    assert stats["added"] == 1 and stats["off_roster"] == 1, stats
    assert "Item:Not In Our Roster" not in shard["harvested"]


def test_missing_only_lists_the_unharvested_roster_titles():
    """The delta list is the harvest work order — and what makes a re-import cheap."""
    shard = _empty()
    harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "x"},
        "Item:Brazenband": {"value": {"movement": 30}, "provenance": "stated", "raw": "y"},
    }), ROSTER, today=TODAY)

    missing = harvest.missing_titles(shard, ROSTER)
    assert missing == sorted(ROSTER - {"Item:Ash Boots", "Item:Brazenband"}), missing
    assert len(missing) == 3


def test_coverage_counts_split_by_provenance():
    """Coverage is what `metadata` discloses, so results can say what was considered."""
    shard = _empty()
    harvest.merge(shard, _dump(**{
        "Item:Ash Boots": {"value": {"movement": 30}, "provenance": "stated", "raw": "x"},
        "Item:Cape of the Roc": {"value": None, "provenance": "defaulted", "raw": "y"},
        "Item:Belt of the Ram": {"value": None, "provenance": "unsourced"},
    }), ROSTER, today=TODAY)

    cov = harvest.coverage(shard, ROSTER)
    assert cov == {"stated": 1, "defaulted": 1, "unsourced": 1, "missing": 2, "roster": 5}, cov


# --- U5 (#134): tooltip refresher compare-mode ---------------------------------
# Exercised through the CLI because that is the surface a human actually runs,
# and because "never writes" is a property of the whole command, not a helper.

def _run_cli(*args):
    import subprocess
    return subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "merge_harvest.py"), *args],
        capture_output=True, text=True, cwd=ROOT)


def _shipped_snapshots():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium",
                           "speed_enchantment.json")) as fh:
        return {k: v["tooltip"] for k, v in json.load(fh)["snapshots"].items()}


def _write_tmp(payload):
    import json, tempfile
    fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, fh)
    fh.close()
    return fh.name


def test_compare_tooltips_reports_no_drift_on_a_matching_dump():
    import json
    path = _write_tmp(_shipped_snapshots())
    try:
        proc = _run_cli("--field", "speed", "--compare-tooltips", path)
        assert proc.returncode == 0, proc.stderr
        report = json.loads(proc.stdout)
        assert report["drifted"] == 0
        assert report["matched"] == report["compared"] == 30
    finally:
        os.unlink(path)


def test_compare_tooltips_reports_a_changed_tooltip_and_exits_nonzero():
    import json
    payload = _shipped_snapshots()
    payload["{{speed|17}}"] = ("Speed +17%: +17% enhancement bonus to movement "
                               "speed, 6% bonus to attack speed.")
    path = _write_tmp(payload)
    try:
        proc = _run_cli("--field", "speed", "--compare-tooltips", path)
        assert proc.returncode == 1, "drift must not exit clean"
        report = json.loads(proc.stdout)
        assert report["drifted"] == 1
        assert report["drift"][0]["invocation"] == "{{speed|17}}"
        assert "review event" in proc.stderr
    finally:
        os.unlink(path)


def test_compare_tooltips_never_writes_to_the_shard():
    shard_path = os.path.join(ROOT, "data", "seed", "compendium",
                              "speed_enchantment.json")
    with open(shard_path, "rb") as fh:
        before = fh.read()

    payload = _shipped_snapshots()
    payload["{{speed|30}}"] = "something else entirely"
    path = _write_tmp(payload)
    try:
        _run_cli("--field", "speed", "--compare-tooltips", path)
    finally:
        os.unlink(path)

    with open(shard_path, "rb") as fh:
        assert fh.read() == before, "compare-mode must leave the shard byte-identical"


def test_compare_tooltips_flags_an_invocation_it_has_never_seen():
    import json
    payload = _shipped_snapshots()
    payload["{{speed|99}}"] = "Speed +99%: nonsense."
    path = _write_tmp(payload)
    try:
        proc = _run_cli("--field", "speed", "--compare-tooltips", path)
        report = json.loads(proc.stdout)
        assert "{{speed|99}}" in report["unknown"]
    finally:
        os.unlink(path)


def test_tooltip_worklist_is_the_arabic_rows_only():
    proc = _run_cli("--field", "speed", "--tooltip-worklist")
    assert proc.returncode == 0, proc.stderr
    rows = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    assert len(rows) == 14, rows
    assert all("Speed|" in r for r in rows)
    assert not any("Striding" in r for r in rows)
    assert "Roman ranks derive from a stable formula" in proc.stderr


def test_speed_augment_field_resolves_a_roster():
    """The field was registered in FIELDS but roster() had no branch, so every
    mode aborted with `unknown field 'speed_augment'`."""
    proc = _run_cli("--field", "speed_augment", "--coverage")
    assert proc.returncode == 0, proc.stderr
    import json
    assert json.loads(proc.stdout)


def test_compare_tooltips_refuses_to_call_zero_matches_clean():
    """An all-unknown or empty dump compared nothing and exited 0, which reads
    identically to a clean check."""
    path = _write_tmp({"{{speed|999}}": "nonsense"})
    try:
        proc = _run_cli("--field", "speed", "--compare-tooltips", path)
        assert proc.returncode == 1, "zero matches must not exit clean"
        assert "matched none" in proc.stderr
    finally:
        os.unlink(path)

    empty = _write_tmp({})
    try:
        proc = _run_cli("--field", "speed", "--compare-tooltips", empty)
        assert proc.returncode == 1, "an empty dump must not exit clean"
    finally:
        os.unlink(empty)
