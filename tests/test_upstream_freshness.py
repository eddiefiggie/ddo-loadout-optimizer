"""#899 — the upstream-staleness alarm's decision, without the network.

The 2026-10-14..17 outage is the fixture: four consecutive failed updater runs
while our pin sat at 2026-10-13. The alarm must call that `broken`, call the
day it recovered `ok`, and call a healthy-but-unvendored upstream `behind`.
"""
import datetime as dt
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "check_upstream_freshness", os.path.join(ROOT, "scripts", "check_upstream_freshness.py"))
F = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(F)

TODAY = dt.date(2026, 10, 17)
OUTAGE = [("2026-10-17", "failure"), ("2026-10-16", "failure"), ("2026-10-15", "failure"),
          ("2026-10-14", "failure"), ("2026-10-13", "success")]


def test_the_october_outage_reads_broken():
    v = F.assess("2026-10-13", "2026-10-13", OUTAGE, TODAY)
    assert v["status"] == "broken"
    assert "failed its last 4 runs" in v["reasons"][0] and "last success 2026-10-13" in v["reasons"][0]


def test_one_failure_is_weather_not_an_outage():
    v = F.assess("2026-10-13", "2026-10-13", [("2026-10-14", "failure"), ("2026-10-13", "success")], TODAY)
    assert v["status"] == "ok"


def test_the_recovery_day_reads_ok():
    # The real 2026-10-17 sequence after upstream merged the fix: skipped, success, then the failures.
    runs = [("2026-10-17", "skipped"), ("2026-10-17", "success")] + OUTAGE
    assert F.assess("2026-10-13", "2026-10-17", runs, TODAY)["status"] == "ok"


def test_a_healthy_upstream_we_have_not_vendored_reads_behind():
    runs = [("2026-10-25", "success")]
    v = F.assess("2026-10-13", "2026-10-25", runs, dt.date(2026, 10, 25))
    assert v["status"] == "behind" and "12 days" in v["reasons"][0]


def test_broken_outranks_behind():
    runs = [("2026-10-25", "failure"), ("2026-10-24", "failure")]
    assert F.assess("2026-10-01", "2026-10-23", runs, dt.date(2026, 10, 25))["status"] == "broken"


def test_cancelled_runs_neither_break_nor_extend_a_streak():
    runs = [("2026-10-17", "cancelled"), ("2026-10-16", "failure"), ("2026-10-15", "failure")]
    assert F.assess("2026-10-13", "2026-10-13", runs, TODAY)["status"] == "broken"


def test_the_report_points_a_broken_upstream_at_the_wiki_delta_loop():
    inp = {"pin_commit": "c36b45e", "pin_date": "2026-10-13", "upstream_commit": "c36b45e",
           "upstream_commit_date": "2026-10-13", "updater_runs": OUTAGE}
    body = F.report(inp, F.assess("2026-10-13", "2026-10-13", OUTAGE, TODAY))
    assert "wiki-delta loop" in body and "wiki_supplement" in body


# ---- #932: a held re-vendor is a decision, not an alarm -----------------------------

HELD = {"commit": "0412da1eee3e7b1235273375fd1747307befa8fe", "commit_date": "2026-10-25",
        "held_on": "2026-10-26", "issue": 933}
HEALTHY = [("2026-10-26", "success")]


def test_upstream_still_at_the_held_commit_reads_held():
    v = F.assess("2026-10-13", "2026-10-25", HEALTHY, dt.date(2026, 10, 30), upstream_commit="0412da1", held=HELD)
    assert v["status"] == "held"
    assert "`0412da1` held 2026-10-26 (#933)" in v["reasons"][0] and "still at it" in v["reasons"][0]


def test_upstreams_daily_bot_commit_does_not_undo_a_fresh_hold():
    # 2026-10-26: upstream's [auto-update] moved to 41da3c8 hours after the hold.
    v = F.assess("2026-10-13", "2026-10-26", HEALTHY, dt.date(2026, 10, 26), upstream_commit="41da3c8", held=HELD)
    assert v["status"] == "held" and "re-test due in 5 days" in v["reasons"][0]


def test_past_the_held_commit_after_the_cooldown_asks_for_a_retest():
    today = dt.date(2026, 10, 26) + dt.timedelta(days=F.RETEST_AFTER_DAYS)
    v = F.assess("2026-10-13", "2026-10-31", HEALTHY, today, upstream_commit="9abcdef", held=HELD)
    assert v["status"] == "behind" and v.get("retest")
    assert "moved past held commit `0412da1`" in v["reasons"][0]
    inp = {"pin_commit": "c36b45e", "pin_date": "2026-10-13", "upstream_commit": "9abcdef",
           "upstream_commit_date": "2026-10-31", "updater_runs": HEALTHY}
    body = F.report(inp, v)
    assert "Re-test" in body and "_held_upstream" in body and "re-vendor per" not in body


def test_broken_still_outranks_a_hold():
    runs = [("2026-10-27", "failure"), ("2026-10-26", "failure")]
    v = F.assess("2026-10-13", "2026-10-25", runs, dt.date(2026, 10, 27), upstream_commit="0412da1", held=HELD)
    assert v["status"] == "broken"


def test_no_hold_recorded_reads_behind_as_before():
    v = F.assess("2026-10-13", "2026-10-25", HEALTHY, dt.date(2026, 10, 26), upstream_commit="0412da1", held=None)
    assert v["status"] == "behind" and not v.get("retest") and "re-vendor is due" in v["reasons"][0]


def test_a_hold_never_hides_a_pin_that_is_not_lagging():
    v = F.assess("2026-10-20", "2026-10-25", HEALTHY, dt.date(2026, 10, 26), upstream_commit="0412da1", held=HELD)
    assert v["status"] == "ok"


def test_a_held_verdict_closes_the_open_alarm_once_then_stays_silent():
    calls = []
    saved = F._get, F._send
    F._get = lambda path: [{"number": 932}] if not calls else []
    F._send = lambda method, path, body: calls.append((method, path, body)) or {}
    try:
        F.sync_issue("o/r", {"status": "held", "reasons": ["x"]}, "body")
        assert [(m, p) for m, p, _ in calls] == [("POST", "repos/o/r/issues/932/comments"),
                                                ("PATCH", "repos/o/r/issues/932")]
        assert calls[1][2]["state_reason"] == "not_planned"
        n = len(calls)
        F.sync_issue("o/r", {"status": "held", "reasons": ["x"]}, "body")
        assert len(calls) == n, "a held verdict with no open alarm must not open one"
    finally:
        F._get, F._send = saved


def test_the_committed_source_records_a_hold_the_checker_can_read():
    import json
    with open(os.path.join(ROOT, "data", "seed", "compendium", "raw", "SOURCE.json"), encoding="utf-8") as fh:
        src = json.load(fh)
    held = src.get("_held_upstream")
    if held is None:
        return  # a re-vendor landed and removed the hold: nothing to check
    assert len(held["commit"]) == 40 and held["held_on"] and held["commit_date"]
    assert dt.date.fromisoformat(held["held_on"]) >= dt.date.fromisoformat(src["upstream_commit_date"])
