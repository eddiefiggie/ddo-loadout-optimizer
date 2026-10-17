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
