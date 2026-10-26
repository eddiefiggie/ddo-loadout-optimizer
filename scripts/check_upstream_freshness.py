#!/usr/bin/env python3
"""#899 — notice when upstream gear-planner stops feeding this catalog.

gear-planner's daily `Data Auto Updater` failed from 2026-10-14 and nothing here
noticed; every item the wiki gained was blocked until someone went looking. This
script is the alarm. `assess` is the decision and is pure (tested in
tests/test_upstream_freshness.py); `main` only gathers its inputs from the GitHub
API and, with --open-issue, keeps ONE labelled issue in step with the verdict —
opening or updating it while upstream is unhealthy or our pin lags, and closing
it once both recover.

Usage:
  python3 scripts/check_upstream_freshness.py              # print the verdict
  python3 scripts/check_upstream_freshness.py --open-issue # also sync the issue (CI)
Exit: 0 always for a verdict (an alarm is an issue, not a red build); 2 if the
inputs could not be read.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "data", "seed", "compendium", "raw", "SOURCE.json")
UPSTREAM = "illusionistpm/ddo-gear-planner"
UPDATER = "Data Auto Updater"
LABEL = "upstream-stale"
TITLE = "Upstream gear-planner data is stale"

#: Consecutive failed updater runs (newest first) that count as "broken". One
#: failure is weather; two in a row is an outage worth a look.
BROKEN_AFTER = 2
#: Days our pin may trail a HEALTHY upstream before it is called behind. Upstream
#: commits near-daily, so a week means a re-vendor is due.
BEHIND_AFTER_DAYS = 7
#: #932 — after a re-vendor is evaluated and HELD (SOURCE.json `_held_upstream`),
#: days before upstream's newer commits ask for a re-test. Upstream's bot commits
#: `[auto-update] Latest data` near-daily, so "any commit past the held one" alone
#: would undo a hold the next morning.
RETEST_AFTER_DAYS = 5


def _date(s):
    return dt.date.fromisoformat(str(s)[:10])


def assess(pin_date, upstream_commit_date, updater_runs, today, upstream_commit=None, held=None):
    """The verdict. `updater_runs` is newest-first `[(date, conclusion), ...]`.

    Returns `{"status": "ok"|"broken"|"behind"|"held", "reasons": [...]}`. `broken`
    wins over the rest: when upstream itself is down, re-vendoring cannot help, and
    the remedy is the wiki-delta loop (docs/wiki-evidence/harvest-method.md).

    `held` is SOURCE.json's `_held_upstream` (`commit`, `held_on`, `issue`): the
    last upstream commit evaluated and declined. A pin that lags only because of
    that decision is `held`, quiet, while upstream is still at the held commit or
    within RETEST_AFTER_DAYS of the hold. After that, newer upstream commits make
    it `behind` again, with a reason that asks for a re-test."""
    reasons = []
    failed = 0
    for _, conclusion in updater_runs:
        if conclusion == "failure":
            failed += 1
        elif conclusion in ("success", "skipped"):
            break
        # cancelled / in progress / None: neither breaks nor extends the streak
    last_ok = next((d for d, c in updater_runs if c == "success"), None)
    if failed >= BROKEN_AFTER:
        since = f"; last success {last_ok}" if last_ok else ""
        reasons.append(f"upstream's {UPDATER} failed its last {failed} runs{since}")
        return {"status": "broken", "reasons": reasons}
    lag = (_date(upstream_commit_date) - _date(pin_date)).days
    if lag > BEHIND_AFTER_DAYS:
        if held and held.get("commit"):
            hc = held["commit"][:7]
            at_held = bool(upstream_commit) and held["commit"].startswith(upstream_commit[:7])
            since = (today - _date(held["held_on"])).days
            ref = f" (#{held['issue']})" if held.get("issue") else ""
            if at_held or since < RETEST_AFTER_DAYS:
                state = ("upstream is still at it" if at_held else
                         f"upstream has moved on, re-test due in {RETEST_AFTER_DAYS - since} days")
                reasons.append(f"our pin ({pin_date}) lags by decision: re-vendor to `{hc}` held "
                               f"{held['held_on']}{ref}; {state}")
                return {"status": "held", "reasons": reasons}
            reasons.append(f"upstream ({upstream_commit_date}) has moved past held commit `{hc}` "
                           f"(held {held['held_on']}{ref}) — re-test the re-vendor with the held method")
            return {"status": "behind", "reasons": reasons, "retest": True}
        reasons.append(f"our pin ({pin_date}) trails upstream's latest commit "
                       f"({upstream_commit_date}) by {lag} days — a re-vendor is due")
        return {"status": "behind", "reasons": reasons}
    age = (today - _date(pin_date)).days
    reasons.append(f"pin {pin_date} ({age} days old); upstream {upstream_commit_date}; "
                   f"updater healthy")
    return {"status": "ok", "reasons": reasons}


# ---- inputs (network) -------------------------------------------------------------

def _get(path):
    req = urllib.request.Request(f"https://api.github.com/{path}",
                                 headers={"Accept": "application/vnd.github+json"})
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _send(method, path, body):
    req = urllib.request.Request(f"https://api.github.com/{path}", method=method,
                                 data=json.dumps(body).encode(),
                                 headers={"Accept": "application/vnd.github+json",
                                          "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def gather():
    with open(SOURCE, encoding="utf-8") as fh:
        pin = json.load(fh)
    commits = _get(f"repos/{UPSTREAM}/commits?per_page=1")
    runs = _get(f"repos/{UPSTREAM}/actions/runs?per_page=30")["workflow_runs"]
    updater = [(r["created_at"][:10], r.get("conclusion")) for r in runs if r.get("name") == UPDATER]
    return {"pin_date": pin["upstream_commit_date"], "pin_commit": pin["upstream_commit"][:7],
            "upstream_commit_date": commits[0]["commit"]["committer"]["date"][:10],
            "upstream_commit": commits[0]["sha"][:7], "updater_runs": updater,
            "held": pin.get("_held_upstream")}


def report(inp, verdict):
    lines = [f"**Status: {verdict['status']}** (checked {dt.date.today().isoformat()})", ""]
    lines += [f"- {r}" for r in verdict["reasons"]]
    lines += ["", f"Our pin: `{inp['pin_commit']}` ({inp['pin_date']}). "
              f"Upstream: `{inp['upstream_commit']}` ({inp['upstream_commit_date']}).",
              "Recent updater runs: " + ", ".join(f"{d} {c}" for d, c in inp["updater_runs"][:6])]
    if verdict["status"] == "broken":
        lines += ["", "Upstream is down, so a re-vendor cannot help. Run the wiki-delta loop "
                  "(`docs/wiki-evidence/harvest-method.md`, *When upstream is stale*) to bring "
                  "new items in through `src/wiki_supplement.py`."]
    elif verdict["status"] == "behind" and verdict.get("retest"):
        lines += ["", "A re-vendor was held, and upstream has moved on since. Re-test it with the "
                  "held method (scratch build, junk names, lost `location_quest`, vocabulary gate) "
                  "before adopting; record the result and update `_held_upstream` in `raw/SOURCE.json`."]
    elif verdict["status"] == "behind":
        lines += ["", "Upstream is healthy and ahead: re-vendor per `raw/SOURCE.json` `_vendoring`."]
    return "\n".join(lines)


def sync_issue(repo, verdict, body):
    open_issues = _get(f"repos/{repo}/issues?state=open&labels={LABEL}&per_page=5")
    if verdict["status"] == "held":
        # A decision, not an alarm: close any open issue once, then stay silent. The
        # next `behind` (a re-test due) opens a fresh one.
        for iss in open_issues:
            _send("POST", f"repos/{repo}/issues/{iss['number']}/comments", {"body": "Held by decision.\n\n" + body})
            _send("PATCH", f"repos/{repo}/issues/{iss['number']}", {"state": "closed", "state_reason": "not_planned"})
        return
    if verdict["status"] == "ok":
        for iss in open_issues:
            _send("POST", f"repos/{repo}/issues/{iss['number']}/comments", {"body": "Recovered.\n\n" + body})
            _send("PATCH", f"repos/{repo}/issues/{iss['number']}", {"state": "closed", "state_reason": "completed"})
        return
    if open_issues:
        _send("POST", f"repos/{repo}/issues/{open_issues[0]['number']}/comments", {"body": body})
    else:
        _send("POST", f"repos/{repo}/issues", {"title": TITLE, "body": body, "labels": [LABEL]})


def main(argv):
    try:
        inp = gather()
    except Exception as e:  # noqa: BLE001 — any read failure is "could not tell"
        print(f"could not read upstream state: {e}")
        return 2
    verdict = assess(inp["pin_date"], inp["upstream_commit_date"], inp["updater_runs"], dt.date.today(),
                     upstream_commit=inp.get("upstream_commit"), held=inp.get("held"))
    body = report(inp, verdict)
    print(body)
    if "--open-issue" in argv:
        sync_issue(os.environ["GITHUB_REPOSITORY"], verdict, body)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
