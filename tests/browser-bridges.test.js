// #855 — the two-runtime bridges, exercised in the runtime players use.
// Run: node tests/browser-bridges.test.js
//
// web/*.js are classic scripts. In the browser they share one global scope and
// there is no `require`; under node every test `require`s them, so a bridge that
// is wrong only in the browser passes every other test in this suite. That is
// how the #713 conditional notice was silent on the live site for its whole life:
// projection.js read `conditionalDisclosureFor` off a helper that, in the
// browser, carries only the two twin-id functions.
//
// So these tests load the files the way web/index.html does — one shared vm
// context, no `require`, no `module` — and call the projection there.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { test } = require("./_harness");

const WEB = path.join(__dirname, "..", "web");
// In web/index.html order. projection.js reaches crafting-systems.js and model.js
// through bridges; the two before model.js are what model.js itself reaches.
const PAGE_ORDER = ["weapon-taxonomy.js", "cross-add.js", "model.js", "crafting-systems.js", "projection.js"];

/** A browser-shaped context: the page's scripts in order, `window` the global,
 *  and no CommonJS. `edit(file, src)` may rewrite a file's source before it runs. */
function page(edit) {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  for (const f of PAGE_ORDER) {
    let src = fs.readFileSync(path.join(WEB, f), "utf8");
    if (edit) src = edit(f, src);
    vm.runInContext(src, ctx, { filename: f });
  }
  assert.strictEqual(vm.runInContext("typeof require", ctx), "undefined", "the context must have no require");
  return ctx;
}

test("#855: the #713 conditional notice renders when the scripts load as the page loads them", () => {
  const ctx = page();
  const lines = vm.runInContext(`
    setConditionalDisclosures({ "Orb Bonus": { sentence: "only while actively blocking" } });
    Projection.conditionalNoticeLines({ query: { targets: ["Orb Bonus", "Strength"] },
      snapshot: { effective: { "Orb Bonus": 4 } } })`, ctx);
  assert.strictEqual(lines.length, 1, "one line for the ranked Orb Bonus, none for Strength");
  assert.ok(/Orb Bonus \(4 here\)/.test(lines[0]) && /only while actively blocking/.test(lines[0]), lines[0]);
});

test("#855: the MRR ceiling line reads model.js's table, not projection.js's fallback copy", () => {
  // The fallback copy holds today's values, so a fresh table is the only way to
  // tell which one was read.
  const ctx = page((f, src) => (f === "model.js"
    ? src.replace("const MRR_CAP_BY_ARMOR = Object.freeze({ cloth: 50, light: 100 });",
      "const MRR_CAP_BY_ARMOR = Object.freeze({ cloth: 50, light: 77 });")
    : src));
  assert.strictEqual(vm.runInContext("MRR_CAP_BY_ARMOR.light", ctx), 77, "the table edit must take effect");
  const line = vm.runInContext(`
    Projection.mrrCapLine({ query: { armorType: "light", targets: ["Magical Sheltering"] },
      snapshot: { effective: { "Magical Sheltering": 120 } } })`, ctx);
  assert.ok(line && /Magical Resistance Rating at 77/.test(line), String(line));
});

test("#855: the twin-id helper is read for twin ids only", () => {
  // In the browser `_twinIdHelpers()` returns { isTwinId, originalIdOf } and
  // nothing else. A new `M.something` read off it would pass under node and be
  // undefined on the site — exactly the #855 defect — so pin the reads.
  const src = fs.readFileSync(path.join(WEB, "projection.js"), "utf8");
  const bound = [...src.matchAll(/const (\w+) = _twinIdHelpers\(\);/g)].map((m) => m[1]);
  assert.ok(bound.length, "expected at least one caller (collapseTwins)");
  for (const name of bound) {
    const reads = new Set([...src.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, "g"))].map((m) => m[1]));
    for (const r of reads) {
      assert.ok(r === "isTwinId" || r === "originalIdOf",
        `${name}.${r} is read off _twinIdHelpers(), which carries only the twin-id helpers in the browser`);
    }
  }
});
