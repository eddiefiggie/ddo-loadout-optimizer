---
title: "GitHub Pages deploy times out at updating_pages — re-run, don't debug your code"
module: deploy
date: 2026-07-25
problem_type: developer_experience
component: tooling
severity: low
tags:
  - github-pages
  - deployment
  - github-actions
  - flaky-ci
  - ddo
applies_when:
  - "A GitHub Pages Actions deploy fails after build and tests already passed"
  - "actions/deploy-pages logs reach 'Current status: updating_pages' then 'Timeout reached, aborting!'"
  - "The site was deploying fine before and no deploy config changed"
---

# GitHub Pages deploy times out at updating_pages — re-run, don't debug your code

## Context

Merging Milestone 3 (PR #1) triggered the `deploy.yml` workflow on `main`. The `build` job — `build_dataset.py`, the 93-test suite, and `upload-pages-artifact` — passed cleanly, and the `deploy` job's `actions/deploy-pages@v4` step **created the deployment and got an ID**. Then the step polled `Getting Pages deployment status...` → `Current status: updating_pages` on a loop for ~10 minutes, hit the action's built-in timeout (`timeout: 600000` ms, `error_count: 10` in the step's `with:` block), logged `Timeout reached, aborting!`, and canceled the deployment. The whole run showed as a red `failure`, which reads exactly like a broken build even though nothing about the code or the workflow was wrong.

## Guidance

**When a Pages deploy fails only at the `updating_pages` polling stage — after build, tests, and artifact upload all succeeded — treat it as a transient GitHub Pages backend hang and just re-run the failed job. Do not start editing the workflow or the site.**

The signature to match before concluding "transient":
- The `build` job is green; the artifact uploaded (`Found 1 artifact(s)`, an `artifact_id`, and a `Created deployment for <sha>` line all appear).
- The failure is inside `actions/deploy-pages`, at `Current status: updating_pages` repeating until `Timeout reached, aborting!`.
- No deploy-related config changed since the last successful deploy.

The remedy is a re-run of the failed job only:

```
gh run rerun <run-id> --failed
gh run watch <run-id> --exit-status --interval 15    # blocks until done
```

Then verify the live site actually served, rather than trusting the green check alone:

```
curl -s -o /dev/null -w "%{http_code}\n" https://<user>.github.io/<repo>/
curl -s -o /dev/null -w "%{http_code}\n" https://<user>.github.io/<repo>/<a-known-asset>
```

The re-run here went green on the first retry and the site (plus `data/items.json` and `solver.js`) returned `200`.

## Why This Matters

The expensive mistake is reading a red Pages deploy as a code or config problem and burning time bisecting a workflow that is actually fine. The tell is *where* it failed: a genuine setup problem fails at `configure-pages`, artifact upload, or with a `404`/permissions error (see the sibling note [github-pages-deploy-static-site-with-build.md](./github-pages-deploy-static-site-with-build.md) for those). A hang at `updating_pages` after a successful upload is GitHub's deployment backend being slow, not your repo — the action's own 10-minute ceiling is what turns the slowness into a hard failure. Re-running is the first move, not the last.

This is not a one-off: an earlier garage project (`sooks-saga-scroll`) also hit a GitHub Pages deploy failure that was a workflow/infra issue rather than a site bug (a `deploy.yml` SIGPIPE fix) *(auto memory [claude])*. Across projects the pattern holds — **a Pages deploy going red is more often infra/workflow than your content; confirm the failure stage before touching code.**

## When to Apply

Any GitHub Pages deploy via `actions/deploy-pages` that fails at the status-polling stage with `updating_pages` → `Timeout reached, aborting!`, on a repo that was deploying fine. If a re-run fails the same way a second or third time, *then* escalate — check the [GitHub status page](https://www.githubstatus.com/) and only after that suspect a genuine regression.

## Examples

The failing tail of the `deploy` job log (transient — note build/upload already succeeded above it):

```
Found 1 artifact(s)
Created deployment for 3917d0c..., ID: 3917d0c...
Getting Pages deployment status...
Current status: updating_pages
... (repeats ~10 min) ...
Current status: updating_pages
##[error]Timeout reached, aborting!
Canceling Pages deployment...
Canceled deployment with ID 3917d0c...
```

Contrast — failures that are **not** transient and do need a fix: a `404` or permissions error at `configure-pages` (Pages not enabled — `gh api -X POST /repos/<owner>/<repo>/pages -f build_type=workflow`), or an artifact-upload error (bad `path:`). Those live in the sibling setup note, not here.
