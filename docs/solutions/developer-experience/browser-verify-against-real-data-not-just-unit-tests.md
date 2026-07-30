---
title: "Drive the real UI against real data — unit tests mask browser-only and shape-mismatch bugs"
module: web-ui
date: 2026-07-29
problem_type: developer_experience
component: tooling
severity: high
related_components:
  - testing_framework
tags:
  - ddo
  - verification
  - browser-testing
  - unit-tests
  - static-site
  - false-green
applies_when:
  - "shipping a change to the client-side web app (web/*.js)"
  - "adding a new global script or a helper that matches against dataset records"
---

# Drive the real UI against real data — unit tests mask browser-only and shape-mismatch bugs

## Context

During the guided-wizard UI re-engineering, the full `node tests/*.test.js` suite was green, yet driving the real page in the browser (Claude-in-Chrome over a localhost `http.server`) immediately surfaced two shipping-risk bugs the unit tests could not see. Both passed CI precisely because the tests exercised code in a shape or scope that differs from the browser.

## Guidance

For this static, client-side app, treat **"unit suite green"** as necessary but not sufficient. Before shipping a UI change, load the real page in a browser against the **built** `web/data/items.json` and:

- Read the console for **load-time `SyntaxError`s** — every `web/*.js` is a plain `<script>` sharing one global scope, so a top-level `const`/`function` that duplicates a name in another already-loaded file aborts the whole file at parse time. Node's per-module `require` scope never sees this collision.
- Match any owned/real-record logic against the **real dataset shape**, not synthetic test objects. Dataset variants are keyed by `source_item` / `variant_id`; they carry **no `.name` field**. A matcher written against `{name: ...}` fixtures passes its tests and silently matches nothing on real data.
- Walk the actual flow end to end (drive to a real solve, open each panel) rather than trusting that rendered output "should" work.

## Why This Matters

The two escaped classes are invisible to the unit layer by construction:

1. **Global-scope collisions.** `web/wizard.js` declared `const isForgedRace = ...` at top level; `web/model.js` already defined `function isForgedRace` (added for the character gate). Under Node, `tests/wizard.test.js` and `tests/model.test.js` `require` each file into its own module scope, so both passed. In the browser both files load as globals into one scope, so wizard.js threw `SyntaxError: Identifier 'isForgedRace' has already been declared` at parse time and the wizard never rendered. Fixed by renaming the wizard's helper to `wizIsForged` (PR #41).

2. **Real-vs-synthetic data shape.** `web/import.js`'s owned-item matcher used `v.name`, and its unit fixtures were synthetic `{name: ...}` objects, so all 8 tests passed. Real variants expose `source_item`/`variant_id` and no `.name`, so against the live dataset the matcher matched zero items. Caught only by matching the parser against `web/data/items.json`; fixed to key on `source_item` (PR #41).

Both would have shipped a broken app with a green suite.

## When to Apply

- Any change to `web/*.js` that renders UI or is loaded as a new global script.
- Any helper that filters, matches, or joins against dataset records — verify against the built `web/data/items.json`, not fixtures alone.
- Before merging a front-end PR: the deploy workflow only runs the unit suite; the browser pass is manual and is the last line of defense.

## Examples

Global collision, caught only in the browser console:

```text
# node tests/wizard.test.js  -> 6 passed   (module scope: no collision)
# node tests/model.test.js   -> 33 passed  (module scope: no collision)
# browser console on load:
SyntaxError: Identifier 'isForgedRace' has already been declared   (web/wizard.js)
```

Shape mismatch — the fixture hid the bug:

```js
// unit fixture (passes) — but real variants never look like this:
ownedMatch(new Set(["X"]), [{ name: "X" }])            // matched: 1

// real dataset row: { source_item: "Saltiron Docent", variant_id: "Saltiron Docent", ... }  (no .name)
// fix: match on source_item || variant_id, verified against web/data/items.json
```

Related: [verify-js-tests-with-full-loop-not-tail](verify-js-tests-with-full-loop-not-tail.md) (the unit suite itself must be run correctly first); [github-pages-deploy-static-site-with-build](github-pages-deploy-static-site-with-build.md) (the dataset is built, and `web/` is the served root).
