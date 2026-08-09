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


# --- U1 (#169): the Parrying and Heightened Awareness evidence shards -----------
# Both affixes fold a versioned wiki template into one stored stat. The shard
# records the version because the magnitude is a property of the version, not of
# the number upstream happened to store — so `version` has to survive a merge, and
# a version-only difference has to be a contradiction rather than a silent win.

AFFIX_SHARDS = [("parrying_version", "Parrying"),
                ("heightened_awareness", "Heightened Awareness")]


def _shard(field):
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium", f"{field}.json")) as fh:
        return json.load(fh)


def _raw_items():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium", "raw",
                           "gearplanner_items.json")) as fh:
        return json.load(fh)


def test_version_only_difference_is_a_contradiction_not_a_merge():
    """Proves `version` actually persists. `harvest.merge()` diffs only `value`,
    so a version written beside it would be dropped and this would pass while the
    shard silently held the old version."""
    shard = harvest.new_shard("parrying_version")
    roster = {"Oathblade"}
    base = {"Oathblade": {"value": {"version": "VIII", "armor_class": 4, "saves": 4},
                          "provenance": "stated", "raw": "{{Parrying|VIII}}"}}
    harvest.merge(shard, base, roster, today=TODAY)

    clash = {"Oathblade": {"value": {"version": "IV", "armor_class": 4, "saves": 4},
                           "provenance": "stated", "raw": "{{Parrying|IV}}"}}
    try:
        harvest.merge(shard, clash, roster, today=TODAY)
    except Exception:
        pass
    else:
        raise AssertionError("a version-only change must not merge silently")

    assert shard["harvested"]["Oathblade"]["value"]["version"] == "VIII"


def test_every_folded_instance_resolves_to_a_shard_entry():
    """Coverage of the real catalog, not a fixture — an item carrying the affix
    with no shard entry has no wiki-stated magnitude and would be invented."""
    items = _raw_items()
    for field, affix in AFFIX_SHARDS:
        harvested = _shard(field)["harvested"]
        carrying = {i["name"] for i in items
                    if any(a.get("name") == affix for a in i.get("affixes") or [])}
        assert carrying, f"{affix}: roster is empty — the check would inspect nothing"
        assert not (carrying - set(harvested)), \
            f"{affix}: uncovered items {sorted(carrying - set(harvested))[:5]}"
        assert not (set(harvested) - carrying), \
            f"{affix}: shard entries with no catalog item {sorted(set(harvested) - carrying)[:5]}"


def test_every_shard_entry_is_stated_and_matches_its_snapshot():
    """The magnitude must be readable out of the stored tooltip. A number that
    does not appear in its own snapshot was derived, not harvested."""
    for field, _affix in AFFIX_SHARDS:
        shard = _shard(field)
        snapshots = shard["snapshots"]
        assert snapshots, f"{field}: no snapshots — nothing to verify against"
        for name, entry in shard["harvested"].items():
            assert entry["provenance"] == "stated", f"{field}/{name}"
            snap = snapshots.get(entry["raw"].strip().lower())
            assert snap, f"{field}/{name}: no snapshot for {entry['raw']}"
            value = entry["value"]
            assert f"+{value['armor_class']} Insight" in snap["tooltip"], \
                f"{field}/{name}: AC {value['armor_class']} not stated in its tooltip"
            if "saves" in value:
                assert f"+{value['saves']} Insight bonus to" in snap["tooltip"], \
                    f"{field}/{name}: saves {value['saves']} not stated in its tooltip"


def test_an_item_absent_from_every_wiki_group_is_reported_as_a_suspect():
    from src import enchantment_split
    shard = harvest.new_shard("parrying_version")
    harvest.merge(shard, {
        "Oathblade": {"value": {"version": "VIII", "armor_class": 4, "saves": 4},
                      "provenance": "stated", "raw": "{{Parrying|VIII}}"},
        "Nicked Longsword": {"provenance": "unsourced"},
    }, {"Oathblade", "Nicked Longsword"}, today=TODAY)

    audit = enchantment_split.audit_shard(shard, label="parrying shard")
    assert audit["unsourced"] == 1
    assert audit["titles"] == ["Nicked Longsword"]


def test_remerging_an_affix_shard_dump_changes_nothing():
    import copy
    for field, _affix in AFFIX_SHARDS:
        shard = _shard(field)
        roster = set(shard["harvested"])
        before = copy.deepcopy(shard)
        dump = {name: {k: entry[k] for k in ("value", "provenance", "raw")}
                for name, entry in shard["harvested"].items()}
        stats = harvest.merge(shard, dump, roster, today="2099-01-01")
        assert stats["added"] == 0, f"{field}: {stats}"
        assert shard == before, f"{field}: re-merge mutated the shard"


def test_affix_coverage_runs_without_aborting():
    import json
    for field, _affix in AFFIX_SHARDS:
        proc = _run_cli("--field", field, "--coverage")
        assert proc.returncode == 0, f"{field}: {proc.stderr}"
        cov = json.loads(proc.stdout)
        assert cov["missing"] == 0, f"{field}: {cov}"
        assert cov["defaulted"] == 0 and cov["unsourced"] == 0, f"{field}: {cov}"
        assert cov["stated"] == cov["roster"] > 0, f"{field}: {cov}"


# --- U6 (#169): the tooltip worklist is per-field -------------------------------
# It used to filter EVERY field through a `speed`-anchored regex, so any other
# shard printed an empty list and exited 0 — indistinguishable from "no work".

def test_the_worklist_emits_every_parrying_invocation_including_roman():
    proc = _run_cli("--field", "parrying_version", "--tooltip-worklist")
    assert proc.returncode == 0, proc.stderr
    lines = [l for l in proc.stdout.splitlines() if l.strip()]

    assert len(lines) == 9, lines
    for roman in ("{{Parrying|I}}", "{{Parrying|IV}}", "{{Parrying|VIII}}"):
        assert roman in lines, f"{roman} must be refreshed — the lookup is not a formula"


def test_the_worklist_covers_heightened_awareness():
    proc = _run_cli("--field", "heightened_awareness", "--tooltip-worklist")
    assert proc.returncode == 0, proc.stderr
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    assert len(lines) == 6, lines


def test_speed_still_skips_its_derivable_roman_rows():
    """Speed's Roman ranks DO derive from a documented formula, so its narrower
    scope is correct and must not be swept up by the generalization."""
    proc = _run_cli("--field", "speed", "--tooltip-worklist")
    assert proc.returncode == 0, proc.stderr
    lines = [l for l in proc.stdout.splitlines() if l.strip()]

    assert lines, "speed must still produce work"
    assert all("{{Speed|" in l for l in lines)
    assert not [l for l in lines if any(c in l for c in "IVXLCDM")], \
        "Roman Speed rows derive from a formula and are skipped"


def test_an_empty_worklist_exits_nonzero_rather_than_printing_nothing():
    """A shard with no invocations cannot be refreshed. Printing an empty list and
    exiting 0 is the inspect-nothing shape this repo bans."""
    import json
    import shutil
    import tempfile
    shard_path = os.path.join(ROOT, "data", "seed", "compendium", "parrying_version.json")
    backup = tempfile.NamedTemporaryFile(suffix=".json", delete=False).name
    shutil.copy(shard_path, backup)
    try:
        with open(shard_path) as fh:
            shard = json.load(fh)
        for entry in shard["harvested"].values():
            entry["raw"] = ""
        with open(shard_path, "w") as fh:
            json.dump(shard, fh, indent=2)

        proc = _run_cli("--field", "parrying_version", "--tooltip-worklist")
        assert proc.returncode == 1, "an empty worklist must not exit clean"
        assert "refusing to report an empty worklist" in proc.stderr
    finally:
        shutil.copy(backup, shard_path)
        os.unlink(backup)


def test_compare_tooltips_works_on_the_new_fields():
    import json
    for field in ("parrying_version", "heightened_awareness"):
        shard = _shard(field)
        path = _write_tmp({k: v["tooltip"] for k, v in shard["snapshots"].items()})
        try:
            proc = _run_cli("--field", field, "--compare-tooltips", path)
            assert proc.returncode == 0, f"{field}: {proc.stderr}"
            report = json.loads(proc.stdout)
            assert report["drifted"] == 0 and report["compared"] > 0, f"{field}: {report}"
        finally:
            os.unlink(path)
