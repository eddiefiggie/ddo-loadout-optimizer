// U1 (#218) — the yield-to-paint contract. Run: node tests/wizard-yield.test.js
//
// Lives in its own file because `tests/wizard.test.js`'s harness is synchronous:
// it calls `fn()` and prints the pass count at module top level, so an async test
// there would have its assertions run after the summary and its failures
// swallowed. Retrofitting that harness would put 40+ passing tests at risk for one
// contract, so this file carries its own awaited harness (the shape
// `tests/solver.test.js` already uses).
//
// The contract under test is narrow and load-bearing: the yield must resolve on a
// MACROTASK. A microtask yield (`queueMicrotask`, `await Promise.resolve()`) reads
// like a fix and changes nothing, because microtasks drain before the browser
// paints — which is the exact mechanism that hid the solve overlay in the first
// place. The microtask scenario below is the one that fails if someone swaps them.
"use strict";
const assert = require("assert");
const { yieldToPaint } = require("../web/wizard.js");

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log("PASS", name); passed++; }
  catch (e) { console.error("FAIL", name, "\n ", e.stack || e.message); process.exitCode = 1; }
}

(async () => {
  await test("is exported and returns a promise", () => {
    assert.strictEqual(typeof yieldToPaint, "function");
    const p = yieldToPaint();
    assert.ok(p && typeof p.then === "function", "returns a thenable");
    return p;
  });

  await test("does not resolve synchronously", async () => {
    let resolved = false;
    const p = yieldToPaint().then(() => { resolved = true; });
    assert.strictEqual(resolved, false, "resolved before the caller could continue");
    await p;
  });

  await test("does not resolve on the microtask queue", async () => {
    // The load-bearing scenario. Ten microtask turns would flush any
    // queueMicrotask/Promise-based implementation many times over; a macrotask
    // yield survives them all. Swap the implementation to a microtask and this
    // fails — which is the whole reason the helper is extracted and exported.
    let resolved = false;
    const p = yieldToPaint().then(() => { resolved = true; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(resolved, false,
      "yieldToPaint resolved on the microtask queue — microtasks drain BEFORE paint, " +
      "so the overlay would still never render");
    await p;
  });

  await test("does resolve on a later macrotask turn", async () => {
    let resolved = false;
    const p = yieldToPaint().then(() => { resolved = true; });
    await p;
    assert.strictEqual(resolved, true, "never resolved");
  });

  await test("needs no DOM or browser global", async () => {
    // It is called from the browser flow but must stay reachable from Node, or the
    // contract above could not be tested at all.
    assert.strictEqual(typeof globalThis.window, "undefined",
      "sanity: this suite runs without a window");
    await yieldToPaint();
  });

  console.log(`\n${passed} passed`);
})();
