---
title: "A pending promise does not keep Node alive — account for unfinished tests at exit"
module: tests
date: 2026-11-04
problem_type: developer_experience
component: testing_framework
tags: [async, promises, false-green, harness, subprocess-testing]
applies_when:
  - "A test harness reports promise-returning callbacks only when they settle"
  - "Node exits successfully with fewer reported tests than were started"
  - "Changing exit-time test accounting or the fail-fast suite runner"
---

# A returned promise can vanish from a green summary

At `f6d46c89078f404db82135c2b7e20ff2e42c56ae`, on Node 20.20.2:

```sh
node -e 'const {test} = require("./tests/_harness"); test("pending", () => new Promise(() => {}));'
```

The process exited **0**, printing `0 passed, 0 failed`. The callback ran, but
its promise never settled and created no active event-loop work. Node was free
to exit. Attaching fulfillment and rejection handlers prevented a premature
PASS, but did not prevent the missing result from making the file appear green.
The shell runner then proceeded to later files and printed its success banner.

The shared harness introduced by #853 / PR #860 already owned settlement and
exit-time totals. The earlier #782 and #826 fixes addressed missing failure
counts and summaries printed before later tests ran; they did not track
unfinished promises. This is internal test reliability work, found by code
inspection, with no change to the optimizer or game data.

## Keep outstanding invocations until settlement

Track each promise-returning invocation with its own object, remove that entry
in either settlement handler, and report remaining entries through the existing
`fail` function **before** printing the exit summary. Names are labels, not
identities: two simultaneous tests with the same name must remain two tests.

Use `exit`, not `beforeExit`. A `beforeExit` listener can schedule more work and
finish the test. By `exit`, the harness must give its final synchronous verdict.
This does not add a timeout or keep-alive. A test holding an active handle can
still hang; work outside `test`/`atest` is not registered; and a killed process
that cannot emit `exit` cannot print a harness summary. Tests never started are
not counted as failures or passes.

The explicit `pass`, `fail`, and `skip` APIs remain independent result reporters.
They do not settle a pending invocation that happens to have the same name.
Filtered-out callbacks never start and never enter the pending set; a filter
matching nothing retains the existing `0 passed, 0 failed` result.

## Observe the process from outside

`tests/harness.test.js` launches the actual harness through fixtures under
`tests/fixtures/harness/`. It asserts exit statuses, named results, and exact
summary counts, including successes, rejections, duplicate labels, mixed pending
and settled work, filters, explicit reports, and work resumed by `beforeExit`.
Throwaway trees run the actual `scripts/run_js_tests.sh` to verify both its
fail-fast path and its all-success path without recursively running the suite.

The six accounting tests covering the new behavior failed on the real archived base tree:
the no-handle promise, mixed outcomes, duplicate names, independent explicit
reports, forced zero exit, and shell fail-fast cases. The ten compatibility
checks passed there. This distinguishes new coverage from preservation checks.

Independent review found a second exit-time trap: buffered console writes to a
pipe could lose pending names and the summary even with a correct nonzero exit.
The harness therefore writes results synchronously through one reporter, using
a UTF-8 buffer and byte offsets to finish partial writes. Only temporary
backpressure and interrupted-system-call errors are retried; other write errors
remain fatal. A slow downstream reader can block reporting and consume CPU in
the retry loop until it reads; there is no test timeout or keep-alive handle.
This follows Node's [process I/O behavior](https://nodejs.org/docs/latest-v20.x/api/process.html#a-note-on-process-io)
and uses the public [synchronous write API](https://nodejs.org/docs/latest-v20.x/api/fs.html#fswritesyncfd-buffer-offset-length-position).

Two additional subprocess checks exercise 4,000 pending names through a pipe
and injected temporary write errors plus partial writes splitting Unicode bytes.
Together the final tests report **10 passed, 8 failed** on the archived base,
and **18 passed, 0 failed** on the fixed harness.

Deliberate mutations must also produce failed assertions: omit registration or
settlement cleanup, merge identities by name, report only one pending test,
lose the pending failure's exit code, move the verdict to `beforeExit`, buffer
exit output, discard partial writes, or refuse temporary backpressure.
When mutating a harness, keep the observer's failure-reporting path intact;
breaking that path too can produce red assertions with a zero outer exit code.

Both language suites inspect the shared harness: Python's
`test_js_suite_reporting.py` pins the summary emitter, counters, and exit
handler even though the Python tests contain no JavaScript runtime. When the
emitter moved from `console.log` to the synchronous `report` helper, that exact
source expectation needed to move too, retaining both-count and exit-handler
requirements. A Python pass obtained before the final harness edit is stale
evidence even if no Python file changed. Finish the edit before running both
full suites, then verify the tested files did not change during the runs.

See [the aborted-run lesson](an-aborted-test-run-reads-as-a-pass.md) and
[the pre-change test rule](../conventions/prove-a-test-fails-against-the-pre-change-tree.md).
