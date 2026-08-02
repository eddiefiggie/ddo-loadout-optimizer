---
title: "Shared top-level identifiers across classic scripts must use var, not const (browser global-scope collision node tests can't see)"
module: web
date: 2026-08-02
problem_type: convention
component: frontend_stimulus
severity: high
related_components:
  - testing_framework
  - solver
  - web-ui
applies_when:
  - "Two or more of the app's classic (non-module) scripts need the same top-level helper or cross-module resolver alias"
  - "The same files are also require()'d individually by the zero-dependency node test suite"
  - "A load-time browser crash (blank app) appears while every node test still passes"
tags:
  - ddo
  - browser-only-bug
  - classic-scripts
  - global-scope
  - const-vs-var
  - dual-runtime
  - node-tests-blind-spot
  - cache-bust
---

# Shared top-level identifiers across classic scripts must use `var`, not `const`

## Context

`web/` ships as plain `<script src="...">` classic scripts (no bundler, no ES modules) that share a single global scope in the browser, and the same files are `require()`'d one-at-a-time by the node test suite (`tests/*.test.js`). This dual-runtime shape has one sharp edge: a top-level `const`/`let` in a classic script is a binding in the **global lexical environment**, which is shared across every `<script>` on the page — so declaring the *same* `const` name in two different files is a redeclaration, and the browser aborts the whole script with `SyntaxError: Identifier '<name>' has already been declared`. Node never sees it, because each `require()` gives the file its own module scope, so the two declarations never coexist.

This bit during the pre-solve item-pinning work (PR [#86](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/86)): a shared pin-normalize resolver was declared as `const _pinnedVariantIds = ...` in three files — `web/solver.js`, `web/results.js`, and `web/wizard.js` (each: browser global first, node `require("./model.js")` fallback). All node suites passed (252 Python + every JS file green), but the live app rendered a blank wizard. The console showed `SyntaxError: Identifier '_pinnedVariantIds' has already been declared` against `results.js` and `wizard.js` — the second and third scripts to load. This is a **repeat of a known class**: the same shape previously crashed the app when `const itemMl` was declared at top level in both `browse.js` and `results.js` during the gear-planner native overhaul, also fixed by `const` -> `var`.

## Guidance

**When a top-level identifier must be shared across classic scripts, declare it with `var`, not `const`/`let`.** `var` at the top level of a classic script becomes a property of the global object, and **redeclaring** it across separate `<script>` tags is legal — each declaration just reassigns the same global. When every file assigns the identical value (as a shared resolver does), last-writer-wins is harmless. `const`/`let` create lexical bindings that throw on redeclaration; that is the crash.

```js
// web/solver.js, web/results.js, web/wizard.js — same resolver in all three.
// const here => "already been declared" in the browser (node require() hides it).
var _pinnedVariantIds = (typeof pinnedVariantIds !== "undefined")
  ? pinnedVariantIds                       // browser: global from model.js (loads first)
  : require("./model.js").pinnedVariantIds; // node: per-file require, no global
```

**Prefer NOT sharing the identifier at all when you can.** The cleanest fix is often to declare the thing **once** and let the browser's shared scope hand it to later scripts for free. A `function foo(){}` declaration in the earliest-loading file (e.g. a helper in `model.js`) is already a global every later classic script can call directly — no per-file alias needed. The `var` resolver pattern is only for the case where node tests `require()` the consumer in isolation and therefore need a fallback that reaches the definition via `require()`. Follow the house 2-branch shape (`global : require`) that `solver.js` already uses for `_equivType` and `_lamordiaTier`; do not add a hand-written inline third-branch normalizer (it becomes a divergent dead copy).

**Node's green suite is not evidence the browser will load.** The suite is a blind spot for this class by construction (per-file `require()` isolation). Any change that adds or moves a top-level `const`/`let` shared across scripts must be smoke-tested in an actual browser before it is called done.

## Why This Matters

The failure is maximally deceptive: the entire automated suite is green, so the change reads as verified, while the app is 100% broken (blank screen) for every real user the moment it deploys. Nothing short of loading the page catches it — and because the crash is a load-time parse error, it takes down the whole app, not one feature. This class has now cost two debugging cycles in this repo; treating "shared top-level identifier" as a `var`-only (or declare-once-global) rule removes it permanently.

## When to Apply

- Adding any top-level `const`/`let` to a `web/*.js` classic script that another script also declares (shared helpers, cross-module resolver aliases like `_equivType`, `_pinnedVariantIds`, `_lamordiaTier`, `CraftingReg`).
- Debugging a blank/partial app or a `SyntaxError: Identifier '...' has already been declared` in the browser console when the node suite is fully green.
- Reviewing a diff that introduces a helper used in more than one browser script.

## Examples

**Load-time crash (before) → working (after):**

```js
// BEFORE — three scripts, same const name, shared global scope:
//   solver.js  : const _pinnedVariantIds = ...
//   results.js : const _pinnedVariantIds = ...   // SyntaxError at load
//   wizard.js  : const _pinnedVariantIds = ...   // SyntaxError at load
// Browser console: "Identifier '_pinnedVariantIds' has already been declared"
// Node: `for t in tests/*.test.js; do node "$t"; done` => all green (false confidence)

// AFTER — var allows the cross-script redeclaration; behavior identical:
var _pinnedVariantIds = (typeof pinnedVariantIds !== "undefined")
  ? pinnedVariantIds : require("./model.js").pinnedVariantIds;
```

**Smoke-verify loop that catches it (localhost + a browser):**

```bash
# Serve web/ and open the page; a load-time SyntaxError shows as a blank app.
cd web && python3 -m http.server 8777   # then load http://localhost:8777/index.html
```

Confirm the app actually renders and the console has no `SyntaxError` before shipping. Because browsers cache the classic scripts aggressively, **bump the `?v=NN` cache-bust in `index.html` after every edit round** (and reload) so the smoke test loads the file you just changed, not a stale copy — reusing a `?v=` after editing silently re-serves the old, still-broken script.

## Related

- `docs/solutions/design-patterns/isolate-prototype-styles-when-porting-into-a-project.md` — a sibling "browser reality differs from the isolated/authoring view" lesson.
- Prior occurrence of this exact class: the `const itemMl` collision (`browse.js` + `results.js`) during the gear-planner native-schema overhaul, same `const` -> `var` fix.
