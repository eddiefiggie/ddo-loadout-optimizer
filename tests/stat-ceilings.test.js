// #677 — the Advanced panel's read-only ceiling context. Run: node tests/stat-ceilings.test.js
//
// Two kinds that mean opposite things: a CONFIRMED cap is applied to the solve
// whether or not the player types anything, a DISCLOSED one is deliberately
// refused. The tests below are mostly about the boundaries between them, and
// about the one thing neither may ever do — pre-fill the Max box.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");
const W = require("../web/wizard.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const CAPS = { Doublestrike: 100, Strikethrough: 400 };

// ------------------------------------------------------------------ the getter

test("#677 intrinsicCapFor is the accessor, and never reports zero for 'unknown'", () => {
  M.setIntrinsicCaps(CAPS);
  assert.strictEqual(M.intrinsicCapFor("Doublestrike"), 100);
  assert.strictEqual(M.intrinsicCapFor("Melee Power"), null,
    "an unknown stat must be null, not 0 — 0 would render as a real ceiling of zero");
  assert.strictEqual(M.intrinsicCapFor(null), null);
});

test("#677 an older cached dataset yields no confirmed ceiling at all", () => {
  M.setIntrinsicCaps({});
  assert.strictEqual(M.intrinsicCapFor("Doublestrike"), null);
  assert.strictEqual(M.statCeilingHintFor("Doublestrike"), null,
    "pre-#199 datasets must render nothing, not an empty or zero ceiling");
});

// -------------------------------------------------------------------- the hint

test("#677 a confirmed cap says it is ALREADY applied", () => {
  M.setIntrinsicCaps(CAPS);
  const h = M.statCeilingHintFor("Doublestrike");
  assert.strictEqual(h.kind, "confirmed");
  assert.strictEqual(h.ceiling, 100);
  assert.ok(/already applied/i.test(h.line), h.line);
  assert.ok(/100/.test(h.line), h.line);
});

test("#677 a disclosed ceiling says it is NOT applied, and why", () => {
  M.setIntrinsicCaps(CAPS);
  const jump = M.statCeilingHintFor("Jump");
  assert.strictEqual(jump.kind, "disclosed");
  assert.ok(/does not apply it/i.test(jump.line), jump.line);
  const dodge = M.statCeilingHintFor("Dodge");
  assert.strictEqual(dodge.kind, "disclosed");
  assert.strictEqual(dodge.ceiling, null,
    "the armor Dodge limit is per ITEM and unknown — it must carry no number");
  assert.ok(/does not apply it/i.test(dodge.line), dodge.line);
});

test("#677 a stat is never BOTH confirmed and disclosed", () => {
  // The guarantee matters because the two lines contradict each other: one says
  // the ceiling is in force, the other says it deliberately is not.
  M.setIntrinsicCaps({ ...CAPS, Jump: 40 });      // a future harvest confirming Jump
  const h = M.statCeilingHintFor("Jump");
  assert.strictEqual(h.kind, "confirmed",
    "once a ceiling is confirmed and applied, the refusal wording must stop being shown");
  M.setIntrinsicCaps(CAPS);
});

test("#677 a stat with no known ceiling renders nothing", () => {
  M.setIntrinsicCaps(CAPS);
  assert.strictEqual(M.statCeilingHintFor("Melee Power"), null);
  assert.strictEqual(M.statCeilingHintFor("Constitution"), null);
});

// ------------------------------------------------- the drift guard #677 asked for

test("#677 the shared ceiling NUMBER also appears in the post-solve sentence", () => {
  // #677: "Either lift a small shared table that both the wizard and projection.js
  // read, or the two copies will drift — and the drift is silent." This is the loud
  // version. Scoped to the notice FUNCTION BODY, not the whole file: `includes("40")`
  // over 3000 lines matches something regardless, which is a guard that cannot fail.
  const proj = fs.readFileSync(path.join(__dirname, "..", "web", "projection.js"), "utf8");
  const NOTICE_FN = { Jump: "jumpSoftCapLine", Dodge: "dodgeMaxDexLine" };
  let checked = 0;
  for (const [stat, d] of Object.entries(M.CEILING_DISCLOSURES)) {
    if (d.ceiling == null) continue;              // nothing numeric to agree about
    const fnName = NOTICE_FN[stat];
    assert.ok(fnName, `${stat} carries a ceiling but names no post-solve notice to agree with`);
    const start = proj.indexOf(`function ${fnName}(`);
    assert.ok(start > -1, `${fnName} is gone from projection.js`);
    const body = proj.slice(start, proj.indexOf("\n  }", start));
    assert.ok(body.includes(String(d.ceiling)),
      `${stat}: the Advanced panel quotes ${d.ceiling} and ${fnName} does not`);
    checked++;
  }
  assert.ok(checked > 0, "the guard inspected no stat at all — it would pass vacuously");
});

test("#677 every disclosed stat is one the repo actually REFUSED to clamp", () => {
  // A disclosure entry asserts "we know this ceiling and chose not to apply it".
  // If the stat is in the confirmed table, that claim is false.
  M.setIntrinsicCaps(CAPS);
  for (const stat of Object.keys(M.CEILING_DISCLOSURES)) {
    assert.strictEqual(M.intrinsicCapFor(stat), null,
      `${stat} is both disclosed and confirmed — one of the two entries is wrong`);
  }
});

// ------------------------------------------------------------- never pre-filled

test("#677 the panel never writes a ceiling into the Max box", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf8");
  const render = src.slice(src.indexOf("function ceilingHintHTML"),
    src.indexOf("function advancedHTML"));
  assert.ok(!/adv\.cap\s*=/.test(render),
    "the hint renderer must not assign adv.cap — a pre-filled cap turns a guarantee "
    + "into an editable preference (CONCEPTS.md) and a refused ceiling into an inference");
  assert.ok(/data-ceiling=/.test(render), "the line must be identifiable in the DOM");
});

test("#677 the stale Max help text no longer claims the tool cannot verify caps", () => {
  // Asserted on the SHIPPED string, not on the file: the replacement's own comment
  // quotes the old wording, which is worth keeping and would fail a whole-file grep.
  const shipped = W.ADVANCED_PANEL_HELP.max;
  assert.ok(!/can't verify in-game caps for you/.test(shipped),
    "#199 landed the cap table; the tool DOES verify some, and this text said "
    + "otherwise using doublestrike — the one stat where the claim was already untrue");
  assert.ok(!/100% doublestrike/i.test(shipped),
    "the example named the exact stat that disproves the sentence");
  assert.ok(/already applies/i.test(shipped),
    "the replacement must point at the ceiling line that now carries the fact");
});

console.log(`\n${passed} passed`);
