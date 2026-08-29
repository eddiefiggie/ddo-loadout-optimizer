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
const { yieldToPaint, PAINT_STALL_FALLBACK_MS } = require("../web/wizard.js");

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

  // -------------------------------------------------------------------------
  // #578 — the frames are a PREFERENCE, not a precondition.
  //
  // A browser stops delivering requestAnimationFrame to a hidden, minimized, or
  // occluded tab. The pre-#578 implementation called rAF whenever it was a
  // function and awaited it unconditionally, so in that state this promise never
  // settled — and `solve()` parked forever behind it with the overlay already
  // raised and `overlay(false)` stranded in a `finally` it never reached.
  //
  // Every scenario below RACES a deadline rather than simply awaiting, because
  // the defect's signature is "never resolves": a bare await would hang this file
  // instead of failing it, and a hung suite reads as a stuck machine rather than
  // as a red test.
  // -------------------------------------------------------------------------

  // Read through a literal default so this file is runnable against a tree that
  // predates the constant — which is exactly how the three scenarios below were
  // proven red before the fix existed. Without it they would fail on an undefined
  // deadline rather than on the behaviour, and the "nothing changed" guard among
  // them would fail on the old tree too, proving nothing.
  const FALLBACK_MS = PAINT_STALL_FALLBACK_MS || 2000;

  const settlesWithin = (ms, promise) => Promise.race([
    promise.then(() => true),
    new Promise((r) => setTimeout(() => r(false), ms)),
  ]);

  /** Run `fn` with globals installed, and restore whatever was there before —
   *  including deleting keys that did not exist, so the "needs no DOM or browser
   *  global" contract above still holds for anything running after this. */
  async function withGlobals(globals, fn) {
    const had = {};
    Object.keys(globals).forEach((k) => {
      had[k] = Object.prototype.hasOwnProperty.call(globalThis, k)
        ? { present: true, value: globalThis[k] } : { present: false };
      globalThis[k] = globals[k];
    });
    try { return await fn(); }
    finally {
      Object.keys(globals).forEach((k) => {
        if (had[k].present) globalThis[k] = had[k].value; else delete globalThis[k];
      });
    }
  }

  await test("#578 resolves in a hidden tab whose frames never arrive", async () => {
    // The reported hang, reduced. rAF is present (so the pre-change code took the
    // frame path) but never fires — exactly what a backgrounded tab does.
    let framesRequested = 0;
    await withGlobals({
      requestAnimationFrame: () => { framesRequested++; },   // never calls back
      document: { visibilityState: "hidden" },
    }, async () => {
      const settled = await settlesWithin(250, yieldToPaint());
      assert.strictEqual(settled, true,
        "yieldToPaint never resolved in a hidden tab — this is the #578 hang: the " +
        "solve overlay goes up and nothing ever takes it down");
      assert.strictEqual(framesRequested, 0,
        "asked for a frame in a tab that reports itself hidden — there is no paint " +
        "coming to wait for, and waiting on one is the defect");
    });
  });

  await test("#578 resolves when a visible tab's frames stall mid-flight", async () => {
    // The other half, from the warning web/results.js already carries: rAF "can
    // fire once then stall". visibilityState stays "visible", so the hidden
    // short-circuit does NOT cover this — only the fallback timer does.
    await withGlobals({
      requestAnimationFrame: (cb) => setTimeout(() => cb(0), 0),  // outer fires, inner never re-fires
      document: { visibilityState: "visible" },
    }, async () => {
      // One nested frame deep, then nothing: the inner rAF schedules a callback
      // that this stub does deliver, so make only the FIRST call live.
      let calls = 0;
      globalThis.requestAnimationFrame = (cb) => { if (++calls === 1) setTimeout(() => cb(0), 0); };
      const settled = await settlesWithin(FALLBACK_MS + 600, yieldToPaint());
      assert.strictEqual(settled, true,
        "frames stopped after the first one and nothing rescued the promise");
      assert.strictEqual(calls, 2, "sanity: the nested-frame path was the one under test");
    });
  });

  await test("#578 still prefers real frames when they are being delivered", async () => {
    // The #218 contract must survive the fix: when frames DO arrive, they are what
    // resolves this — not the fallback timer. Resolving far inside the fallback
    // window is the observable difference.
    await withGlobals({
      requestAnimationFrame: (cb) => setTimeout(() => cb(0), 0),
      document: { visibilityState: "visible" },
    }, async () => {
      const t0 = Date.now();
      const settled = await settlesWithin(300, yieldToPaint());
      assert.strictEqual(settled, true, "frames were arriving but nothing resolved");
      assert.ok(Date.now() - t0 < FALLBACK_MS,
        "resolved on the fallback timer even though frames were being delivered — " +
        "the #218 paint guarantee has been lost");
    });
  });

  console.log(`\n${passed} passed`);
})();
