---
title: "Drive the real UI against real data — unit tests mask browser-only and shape-mismatch bugs"
module: web-ui
date: 2026-07-29
last_updated: 2026-07-29
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
  - state-persistence
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
- **Reset persisted client state before each run, and read the live DOM — not a screenshot — for ground truth.** A stateful SPA that persists to `sessionStorage`/`localStorage` carries a prior run's state across a plain reload or same-tab navigate, so a "fresh load" is not fresh. Clear storage (or use a fresh/incognito tab) for a deterministic clean-state run, and confirm a claim by querying the live DOM (`document.getElementById(...)`, `document.querySelectorAll(...)`) — a screenshot can capture a mid-navigation frame or stale state and read as a bug that does not exist.

## Why This Matters

The two escaped classes are invisible to the unit layer by construction:

1. **Global-scope collisions.** `web/wizard.js` declared `const isForgedRace = ...` at top level; `web/model.js` already defined `function isForgedRace` (added for the character gate). Under Node, `tests/wizard.test.js` and `tests/model.test.js` `require` each file into its own module scope, so both passed. In the browser both files load as globals into one scope, so wizard.js threw `SyntaxError: Identifier 'isForgedRace' has already been declared` at parse time and the wizard never rendered. Fixed by renaming the wizard's helper to `wizIsForged` (PR #41).

2. **Real-vs-synthetic data shape.** `web/import.js`'s owned-item matcher used `v.name`, and its unit fixtures were synthetic `{name: ...}` objects, so all 8 tests passed. Real variants expose `source_item`/`variant_id` and no `.name`, so against the live dataset the matcher matched zero items. Caught only by matching the parser against `web/data/items.json`; fixed to key on `source_item` (PR #41).

Both would have shipped a broken app with a green suite.

A third class is a hazard *of the browser pass itself*, not a shipped bug: **retained client-side state gives a false reading.** The guided wizard persists its `state` to `sessionStorage`, so navigating/reloading the same tab replayed a prior run's ML and checkbox values and even auto-advanced the step. During the Artifact-checkbox verification, a screenshot showed the box **checked** on what looked like a fresh load — actually retained state from an earlier tab — and `document.getElementById("wz-artifact")` returned `null` because the DOM had already advanced past the character step. Together they manufactured a phantom "the checkbox defaults to checked" bug (R1 says default off). `sessionStorage.clear(); localStorage.clear();` then reload restored a true clean state and confirmed the real default (unchecked). The lesson pairs with the guidance above: the same persistence that makes an SPA pleasant to use makes its manual verification non-deterministic — reset state per run, and trust a live DOM query over a screenshot when the two seem to disagree.

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

Retained state — a plain reload is not a clean load; clear storage and read the live DOM:

```js
// FALSE READING: a same-tab reload replays sessionStorage-persisted wizard state,
// and a screenshot can catch a mid-navigation frame:
//   screenshot -> checkbox appears CHECKED on a "fresh" load  (actually retained)
//   document.getElementById("wz-artifact")  -> null           (DOM already advanced)
//   => phantom "defaults to checked" bug

// CLEAN STATE: reset persisted state, then assert against the live DOM
sessionStorage.clear(); localStorage.clear(); location.reload();
// after load, on the character step:
document.getElementById("wz-artifact").checked   // -> false  (true default, R1)
```

Related: [verify-js-tests-with-full-loop-not-tail](verify-js-tests-with-full-loop-not-tail.md) (the unit suite itself must be run correctly first); [github-pages-deploy-static-site-with-build](github-pages-deploy-static-site-with-build.md) (the dataset is built, and `web/` is the served root).
