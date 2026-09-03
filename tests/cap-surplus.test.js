// #459 — the cap-surplus disclosure. Run: node tests/cap-surplus.test.js
//
// The correctness story is set-consistency. `docs/solutions/design-patterns/
// redundancy-under-a-shared-cap-must-be-judged-set-consistently.md` records the
// same judgment going wrong twice in one day at two aggregation levels, because
// contributors that are each individually slack against the intact total can be
// jointly necessary. These tests pin the property that makes the sentence immune
// to that: it quotes ONE total, never a per-pick verdict.
const assert = require("assert");
const P = require("../web/projection.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

function rec(parts, { cap = 20, shown = 20, intrinsic = {}, stat = "Doublestrike", chosen = [] } = {}) {
  return {
    query: { targets: [stat] },
    snapshot: {
      status: "optimal", chosen, setsActive: [], query: { targets: [stat] },
      effective: { [stat]: shown }, capped: { [stat]: cap }, intrinsicCaps: intrinsic,
      breakdown: { [stat]: parts },
    },
  };
}
const part = (source, value, slot) =>
  ({ source, sourceKind: "augment", bonus_type: "Enhancement", value, slot });

const lines = (r) => P.capSurplusLines(r);

// ------------------------------------------------------------------ the basics

test("#459 names the surplus and the picks carrying it", () => {
  const [l] = lines(rec([part("Topaz", 15, "Necklace"), part("Gem", 9, "Armor")]));
  assert.ok(l, "a stat over its cap must produce a line");
  assert.ok(/supply 24/.test(l), l);
  assert.ok(/surplus of 4/.test(l), l);
  assert.ok(/Topaz \(\+15/.test(l) && /Gem \(\+9/.test(l), l);
});

test("#459 says WHOSE cap it is", () => {
  const mine = lines(rec([part("A", 15), part("B", 9)]))[0];
  assert.ok(/capped by you at 20/.test(mine), mine);
  const game = lines(rec([part("A", 15), part("B", 9)], { intrinsic: { Doublestrike: 20 } }))[0];
  assert.ok(/capped by the game at 20/.test(game), game);
});

test("#459 lists the biggest carrier first, deterministically", () => {
  const l = lines(rec([part("Small", 4), part("Big", 21), part("Mid", 9)], { shown: 20, cap: 20 }))[0];
  assert.ok(l.indexOf("Big") < l.indexOf("Mid"), l);
  assert.ok(l.indexOf("Mid") < l.indexOf("Small"), l);
  const again = lines(rec([part("Small", 4), part("Big", 21), part("Mid", 9)]))[0];
  assert.strictEqual(l, again, "the same input must produce the same sentence");
});

// -------------------------------------------------------------- set-consistency

test("#459 the stated surplus is exact: raw minus surplus is the displayed value", () => {
  for (const parts of [
    [part("A", 15), part("B", 9)],
    [part("A", 12), part("B", 11), part("C", 10)],
    [part("A", 100)],
  ]) {
    const raw = parts.reduce((n, p) => n + p.value, 0);
    const l = lines(rec(parts, { cap: 20, shown: 20 }))[0];
    const m = /surplus of (\d+)/.exec(l);
    assert.ok(m, l);
    assert.strictEqual(raw - Number(m[1]), 20,
      "the surplus must be exactly what can be given up to land ON the cap");
  }
});

test("#459 never calls an individual pick droppable — the trap this issue names", () => {
  // 12 + 11 + 10 = 33 against a cap of 20. A per-item test would rule EACH one
  // droppable (33-12, 33-11, 33-10 all clear 20) and dropping all three leaves 0.
  // The sentence must therefore make a TOTAL claim, not three individual ones.
  const l = lines(rec([part("A", 12), part("B", 11), part("C", 10)], { cap: 20, shown: 20 }))[0];
  assert.ok(/13 in TOTAL/.test(l), l);
  assert.ok(/no single one of these is necessarily droppable/.test(l), l);
  assert.ok(!/drop (A|B|C)\b/i.test(l), `must not prescribe dropping a named pick: ${l}`);
});

test("#459 warns that a pick may be carrying other priorities", () => {
  const l = lines(rec([part("A", 15), part("B", 9)]))[0];
  assert.ok(/other priorities/i.test(l), l);
});

// ------------------------------------------------------------------- staying quiet

test("#459 is silent when there is no surplus, no cap, or nothing ranked", () => {
  assert.deepStrictEqual(lines(rec([part("A", 20)], { cap: 20, shown: 20 })), [],
    "raw exactly at the cap wastes nothing");
  assert.deepStrictEqual(lines(rec([part("A", 12)], { cap: 20, shown: 12 })), [],
    "under the cap wastes nothing");
  const noCap = rec([part("A", 30)]);
  noCap.snapshot.capped = {};
  assert.deepStrictEqual(lines(noCap), []);
  assert.deepStrictEqual(lines({ query: { targets: [] }, snapshot: {} }), []);
});

test("#459 fails OPEN on a partial record rather than throwing", () => {
  // A throw here takes down the projection every surface reads from.
  const r = rec([part("A", 15), part("B", 9)]);
  delete r.snapshot.chosen;
  assert.deepStrictEqual(lines(r), [], "a record with no loadout must yield no line, not an error");
  assert.deepStrictEqual(lines({}), []);
  assert.deepStrictEqual(lines(undefined), []);
});

test("#459 a populated intrinsicCaps map does not break the whose-cap test", () => {
  // Regression: the game-vs-you check read `cap` before it was in scope, and an
  // EMPTY intrinsicCaps short-circuited before evaluating it — so every synthetic
  // fixture passed and only a real solve, which populates the map, threw.
  const l = lines(rec([part("A", 15), part("B", 9)], { intrinsic: { SomethingElse: 5 } }))[0];
  assert.ok(/capped by you at 20/.test(l), l);
});

// ------------------------------------------------------------------- the wiring

test("#459 the notice reaches the shared content model and the exporter roster", () => {
  const view = P.project(rec([part("A", 15), part("B", 9)]));
  assert.ok(Array.isArray(view.character.capSurplusNotice), "must be in the projection bag");
  assert.strictEqual(view.character.capSurplusNotice.length, 1);
  const { CHARACTER_NOTICES } = require("../web/exporters.js");
  assert.ok(CHARACTER_NOTICES.some((n) => n.key === "capSurplusNotice"),
    "#668 — a notice absent from the roster reaches none of the four surfaces");
});

console.log(`\n${passed} passed`);
