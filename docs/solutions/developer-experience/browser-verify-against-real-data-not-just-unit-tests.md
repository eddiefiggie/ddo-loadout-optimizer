---
title: "Verify at the production entry point — unit tests mask browser-only, shape-mismatch, and wrong-call-site bugs"
module: web-ui
date: 2026-07-29
last_updated: 2026-08-17
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
  - fixture-shape
  - synthetic-input
  - verification-topology
  - wrong-call-site
  - wiring-guard
applies_when:
  - "shipping a change to the client-side web app (web/*.js)"
  - "adding a new global script or a helper that matches against dataset records"
  - "a unit test hand-builds the structure the system under test consumes, rather than driving a real run"
  - "a plan or spec asserts what some component emits, and the tests are written to that assertion"
  - "a feature is green on its whole suite but has never been run against the built dataset"
  - "a module or call site was edited but you have not confirmed the app actually loads or invokes it"
  - "code compares against a type name, slot name, or other string constant that crosses a pipeline seam"
  - "a change is verified by calling the function that was just edited, with arguments the verifier supplied"
---

# Verify at the production entry point — unit tests mask browser-only, shape-mismatch, and wrong-call-site bugs

## Context

During the guided-wizard UI re-engineering, the full `node tests/*.test.js` suite was green, yet driving the real page in the browser (Claude-in-Chrome over a localhost `http.server`) immediately surfaced two shipping-risk bugs the unit tests could not see. Both passed CI precisely because the tests exercised code in a shape or scope that differs from the browser.

## Guidance

**If your verification calls the function you just edited, it is not evidence about production.** That is the whole rule; everything below is how it fails in practice. You supplied both sides of that call, so it is satisfiable with an input production never produces, through a file production never loads, at a join production never takes. This doc was originally titled around *real data* and the browser, which undersold it — the 2026-08-17 addendum below is four instances in one session that were verified at the edited seam, passed, and were broken anyway.

**The browser is one way to get real data in front of the code; it is not the only one, and it is not the point.** The point is that some run of the real production path, over the built `web/data/items.json`, produced the output you are asserting on. For UI, that means the browser. For a solver, exporter, or projection change, driving the real modules in Node against the built dataset does the same job and works when a browser is unavailable. See "A fixture can be wrong in a way no test discipline catches" below, where exactly that substitution caught a shipped-shape error with the browser blocked.

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

## A fixture can be wrong in a way no test discipline catches

The two cases above are fixtures written from convenience. A worse variant is a fixture written from a **document** — and it survives every check this corpus otherwise recommends.

While building the saturation/empty-slot disclosure ([#239](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/239), PR [#241](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/241)), the plan asserted that a short priority list leaves the solver filling leftover gear slots with deterministic tie-break picks. It does not. `chosen` carries only slots where an item actually contributes, so a single-priority `Kinetic Lore` solve at ML 34 fills **3 of 14** worn slots and leaves the other eleven **empty** — there is no filler to count.

A counter was written to count that filler, with five unit tests driving hand-built `chosen` arrays that contained filler items. All five passed. The counter returned **0** on the exact scenario the feature existed for.

**It cleared both of the checks this project already documents:**

- It passed the base-tree gate in [prove-a-test-fails-against-the-pre-change-tree](../conventions/prove-a-test-fails-against-the-pre-change-tree.md). The tests were run red before implementing, and they went red honestly — the assertions genuinely depended on the new code.
- It would pass that doc's mutation check too. Break the counter's body and the tests redden, because they really do constrain it. The tests were not vacuous; they were *pointed at a shape the system never emits*.

Both of those checks ask questions about the **test**: is it new, does it constrain the code. Neither asks the question that mattered: **does the fixture look like what the system actually produces?** Only real output answers that.

The plan supplied the wrong shape and the fixture encoded the plan, so the two agreed with each other. Mutual confirmation between a specification and a fixture built from it is not evidence — it is the same claim written twice.

The same real-data run, in the same minute, also caught a copy defect no unit test asserted on: the notice read "**a** Equipment bonus and **a** Artifact bonus". Reading actual output finds the class of error you did not think to assert on, which is the class that reaches users.

A third class is a hazard *of the browser pass itself*, not a shipped bug: **retained client-side state gives a false reading.** The guided wizard persists its `state` to `sessionStorage`, so navigating/reloading the same tab replayed a prior run's ML and checkbox values and even auto-advanced the step. During the Artifact-checkbox verification, a screenshot showed the box **checked** on what looked like a fresh load — actually retained state from an earlier tab — and `document.getElementById("wz-artifact")` returned `null` because the DOM had already advanced past the character step. Together they manufactured a phantom "the checkbox defaults to checked" bug (R1 says default off). `sessionStorage.clear(); localStorage.clear();` then reload restored a true clean state and confirmed the real default (unchecked). The lesson pairs with the guidance above: the same persistence that makes an SPA pleasant to use makes its manual verification non-deterministic — reset state per run, and trust a live DOM query over a screenshot when the two seem to disagree.

## Two more ways the isolated call lies (2026-08-17)

The section above is about a fixture's **shape**. This one is about where the verification *stood*. One session produced four instances of that: a write-side key no reader reads (`weaponStyle`) and a hand-built record of the wrong shape, both already banked in [fixture-shape-must-mirror-the-production-writer](../conventions/fixture-shape-must-mirror-the-production-writer.md), plus the two mechanisms below — which are new here and account for three shipped defects between them.

**A constant compared across a pipeline seam.** Six presence checks on the render and export surfaces compared an affix's type against `"boolean"` — `projection.js` (three), `browse.js`, `results.js`, and `exporters.js`. (Two sites already accepted `"Bool"`: `results.js:808` and `dataset.js:435`. PR #354's own body calls the former "the lone correct site." The claim is *six of eight*, not all of them — a sweeping version of this sentence is falsifiable in ten seconds and would discredit the analysis around it.)

Counted from the shipped catalog: **8,104** of the 40,649 affixes reachable as `items[].affixes` across the 9,108 records in `items[]` are typed `"Bool"`, and **zero** `"boolean"`. A further **96** carry the same value under the legacy `bonus_type` key, in the crafting sections (`dino_inserts`, `viktranium`, `seal`, `thunder_forged`, `green_steel`) — which is why the predicate reads both keys. Whole-file total: **8,200**. State the population when you cite this: a naive `grep -c '"Bool"'` returns 8,200 and would read as a contradiction. The presence branch was therefore dead on every surface at once — Browse rendered `Ghostly +1 Bool` instead of `✓ Ghostly`, and the defect reached every share export. Five tests pinned the correct output and passed, each on a hand-built fixture typed `"boolean"` — a value no writer produces. Fixed in PR [#354](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/354) by consolidating to one predicate (`web/projection.js:66-72`) rather than one check per surface.

This class already has an ancestor here: [prove-a-guard-fails-before-trusting-it](../conventions/prove-a-guard-fails-before-trusting-it.md) records a build gate written against the raw `"Offhand"` spelling while records carry the normalized `"Off Hand"`. That makes it **three for three** — a build gate, a solver query key, and a render predicate — all inert because a string identifier did not match across a pipeline seam. Twice as a *read* compared against a spelling the writer never produces (`"Offhand"`, `"boolean"`); once as a *write* under a key no reader reads (`weaponStyle`, recorded in [fixture-shape-must-mirror-the-production-writer](../conventions/fixture-shape-must-mirror-the-production-writer.md)). **Grep every identifier you pass or compare, in both directions** — the write side fails more quietly, because dropping a constraint only ever makes the feasible set larger.

**The wired file is not the loaded file.** A results-panel disclosure was verified by calling `buildModel` directly in Node with a new argument shape. It worked. In the shipped app it never rendered at all: `web/query.js` — the file that had been wired, and which contains its own `buildModel` call — is **not** in `web/index.html`'s script list, and the live solve path is `web/wizard.js`'s **two** `buildModel` calls, both still passing the old argument. `web/model.js`'s own comment had named `query.js` as "the reference site," and that comment is what sent the change to a file the app never runs. Found by code review, not by the author. Fixed in PR [#355](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/355).

A sibling in the same change: the Browse marker was verified by calling `presenceMarker(name, sets)` directly, which passed, while the real `affixEntries -> presenceMarker` join marked only **75 of 1,656** target chips. `f` correct and `g` correct says nothing about `f -> g` when the field they exchange is optional or untyped. **Test the join, not the two functions either side of it.**

### The permanent half of the remedy

A real-data run is a one-time check; it does not stop the next instance. What changed behavior here was a **source-text wiring guard on the live call site** — because no unit test can observe whether the *app's own* call passes the right thing, since a unit test supplies the arguments itself. Three now exist in `tests/wizard.test.js`: one asserting both `buildModel` call sites pass the new shape **and that there are exactly two of them**, so a third cannot appear unguarded; one pinning that `initBrowse` receives the picker vocabulary; and one pinning the loading fact itself, that `index.html` must not load `query.js`. Their verification status differs, and saying so matters in a doc about verifying properly: the `initBrowse` guard was proven red by reverting its fix; the call-site guard is red by construction against the superseded form it names verbatim; and the `index.html` guard is a deliberate nothing-changed pin, which [prove-a-guard-fails-before-trusting-it](../conventions/prove-a-guard-fails-before-trusting-it.md) explicitly exempts — there is no fix to revert, because the app never loaded that file.

**A documented rule is not a guard.** A convention doc for the adjacent fixture-shape failure already existed and was extended the same morning (PR #350, merged 05:53Z); the next instance shipped roughly six and a half hours later (PR #354, 12:29Z) and the one after that at 15:31Z (PR #355). Discovery time is not in any committed artifact, so the interval between *writing* the rule and *breaking* it again is not something a later reader can check — the merge gap is. That is evidence about the rule's *shape*, not about diligence: prose describing a property of the fixture only fires if you already suspect the fixture. A test that fails the build fires whether you suspect anything or not.

## When to Apply

- Any change to `web/*.js` that renders UI or is loaded as a new global script.
- Any helper that filters, matches, or joins against dataset records — verify against the built `web/data/items.json`, not fixtures alone.
- **Any unit test that hand-builds the structure under test.** Print one real run of that structure and diff it against the fixture by eye, once. This is minutes, and it is the only check that catches a fixture whose shape is simply wrong.
- **Especially when a plan or spec states what a component emits.** That sentence is a claim, not a fact; the fixture written from it inherits whatever the claim got wrong.
- **Before trusting that you changed live code:** read `web/index.html`'s script list and confirm the file you edited is loaded, then grep every call site of the function you verified. A comment naming "the reference site" is not evidence.
- Before merging a front-end PR: the deploy workflow only runs the unit suite; the real-data pass is manual and is the last line of defense. When a browser is unavailable, drive the real modules in Node against the built dataset — that covers shape mismatch, though not DOM rendering or global-scope collisions.

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

A fixture that encodes a plan's wrong premise — green suite, zero real coverage:

```js
// The plan said leftover slots hold tie-broken filler, so the fixture held filler:
chosen: [ { slot: "Goggles", variant: {/* contributes */} },
          { slot: "Ring",    variant: {/* filler     */} } ]   // 5 tests pass

// One real solve, printed:
//   worn slots defined in model : 14
//   chosen entries              : 3     <- the other 11 are ABSENT, not filler
//   => the counter returns 0 on the flagship case
```

Related: [prove-a-test-fails-against-the-pre-change-tree](../conventions/prove-a-test-fails-against-the-pre-change-tree.md) (the base-tree and mutation checks this case clears while still being worthless); [verify-js-tests-with-full-loop-not-tail](verify-js-tests-with-full-loop-not-tail.md) (the unit suite itself must be run correctly first); [github-pages-deploy-static-site-with-build](github-pages-deploy-static-site-with-build.md) (the dataset is built, and `web/` is the served root).
