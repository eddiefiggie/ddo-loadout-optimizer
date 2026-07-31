---
title: "A `__proto__` guard key in an object literal is inert — the reviver silently skips it"
module: web-ui
date: 2026-07-30
problem_type: security_issue
component: data-import
severity: high
related_components:
  - json-import
tags:
  - ddo
  - prototype-pollution
  - json-parse
  - reviver
  - security
  - object-literal
  - false-green-test
symptoms:
  - "A JSON.parse reviver meant to drop __proto__/constructor/prototype does not drop __proto__"
  - "A prototype-pollution unit test passes even though the reviver is inert"
root_cause: "The pollution-key set was written as an object literal, where `__proto__:` is prototype-setter syntax and defines no own `__proto__` key, so a `hasOwnProperty` membership test never matches it"
resolution_type: code_fix
---

# A `__proto__` guard key in an object literal is inert — the reviver silently skips it

## Problem

A `JSON.parse` reviver built to strip prototype-pollution keys (`__proto__`, `constructor`, `prototype`) from an imported backup silently let `__proto__` — the single most important key — pass through, because the key set it checked against was written as a JavaScript object literal. Found in code review of the backup importer (`web/backup.js`), fixed in PR #58.

## Symptoms

- The reviver stripped `constructor` and `prototype` but **not** `__proto__`.
- The unit test asserting "prototype pollution is stripped" was **green** — giving false assurance that the defense worked.
- Observable only by inspecting the key set at runtime: `Object.keys(POLLUTION_KEYS)` returned `["constructor", "prototype"]` — no `__proto__` — and `Object.prototype.hasOwnProperty.call(POLLUTION_KEYS, "__proto__")` was `false`.

## What Didn't Work

The original guard looked obviously correct:

```js
const POLLUTION_KEYS = { __proto__: true, constructor: true, prototype: true };

function safeReviver(key, value) {
  if (Object.prototype.hasOwnProperty.call(POLLUTION_KEYS, key)) return undefined;
  return value;
}
```

It reads as "a set of three keys to reject," but in an **object literal**, `__proto__:` is not an ordinary key — it is the prototype-setter syntax. Writing `__proto__: true` tries to set the object's prototype to the non-object `true` (a silent no-op), and defines **no own `__proto__` property**. So `POLLUTION_KEYS` ends up as `{ constructor: true, prototype: true }`, and the `hasOwnProperty(..., "__proto__")` test never matches — the reviver passes `__proto__` straight through.

The accompanying test passed for the wrong reason: its hostile payload placed `__proto__` at the **character level**, where a separate field-allowlist rebuild (`sanitizeCharacter`) dropped it — so the test exercised the allowlist, never the reviver. A green test on the wrong layer masked the inert guard.

## Solution

Test the key with an explicit comparison (or a `Set` / `Object.create(null)` map), never an object literal — and add a test whose payload nests `__proto__` where **only the reviver** can catch it. See `web/backup.js:14-27` (current tree):

```js
// NB: written as an explicit comparison, NOT an object literal — `{ __proto__: … }`
// is prototype-setter syntax, so a literal would define no own "__proto__" key.
function isPollutionKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function safeReviver(key, value) {
  if (isPollutionKey(key)) return undefined;
  return value;
}
```

The regression test nests the key inside app-produced data (`snapshot`) that the field-allowlist passes through by reference, so it can only be caught by the reviver:

```js
const hostile = '{"schema_version":1,"characters":{"Sook":{"name":"Sook",'
  + '"snapshot":{"status":"optimal","chosen":[],"__proto__":{"polluted":true}}}}}';
const res = parseBackup(hostile, { current: 1, window: 3 });
assert.strictEqual(({}).polluted, undefined);                 // Object.prototype not polluted
assert.ok(!Object.prototype.hasOwnProperty.call(res.characters.Sook.snapshot, "__proto__"));
```

## Why This Works

The bug is entirely about **object-literal key semantics**: `{ __proto__: x }` invokes the `[[Prototype]]` setter and creates no own key, so any membership test (`hasOwnProperty`, `in`, `key in POLLUTION_KEYS`) misses `__proto__`. An explicit `key === "__proto__"` comparison compares the string value and is immune to that quirk. (`constructor` and `prototype` are ordinary own keys in a literal, which is why they worked and hid half the bug.)

Separately, the guard was one layer of defense-in-depth: even inert, no live `Object.prototype` pollution reached through the three files, because `JSON.parse` creates `__proto__` via define-semantics (an inert own data property, not assignment), the character allowlist rebuilt records field-by-field, and merges used `Object.create(null)` maps. But "the other layers happened to hold" is not a reason to ship a broken primary defense — and the by-reference `snapshot`/`query`/`slotConstraints` fields could carry an inert own-`__proto__` property downstream to consumers that *do* recursive-merge with attacker keys.

## Prevention

- **Never build a set of "keys to reject" as an object literal** when `__proto__` (or `constructor`/`prototype`) can be a member. Use an explicit `key === "..."` comparison, a `Set` (`new Set(["__proto__", ...])` — `Set` stores values, not object keys, so `__proto__` is fine), or an `Object.create(null)` map.
- **Test the layer you think is protecting you.** A green prototype-pollution test proves nothing if its payload is caught by a *different* layer. Put the hostile key where only the guard under test can catch it (here: nested in app-produced data the allowlist passes by reference), and assert both `({}).pollutedKey === undefined` **and** that the guard's own output lacks the key.
- **Grep for the smell:** `\{[^}]*__proto__\s*:` in source — an object literal with a `__proto__:` member is almost always either an accidental prototype set or an inert guard key.
- Prefer **defense in depth** (reviver + field allowlist rebuild + null-proto merge maps), so a single inert layer is not the only thing between an imported file and `Object.prototype`.
