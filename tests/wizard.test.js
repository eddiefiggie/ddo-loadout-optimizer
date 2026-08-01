// U1 — wizard step-machine pure helpers. Run: node tests/wizard.test.js
const assert = require("assert");
const { WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery, stepAfterLoad, curatedStats } = require("../web/wizard.js");

const baseState = () => ({ ml: 34, race: "Human", armor: "", weapon: "", alignment: "",
  priorities: ["Constitution"], slotConstraints: {} });

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); passed++; }
  catch (e) { console.error("FAIL", name, "\n ", e.message); process.exitCode = 1; }
}

test("WIZARD_STEPS order", () => {
  assert.deepStrictEqual(WIZARD_STEPS, ["intro", "character", "pool", "priorities", "results"]);
});

test("canAdvance(character): needs a race and a positive ML", () => {
  assert.ok(!canAdvance("character", { race: "", ml: 34 }));
  assert.ok(!canAdvance("character", { race: "Human", ml: 0 }));
  assert.ok(canAdvance("character", { race: "Human", ml: 34 }));
});

test("canAdvance(pool): owned mode requires an uploaded inventory", () => {
  assert.ok(canAdvance("pool", { pool: "all" }));
  assert.ok(!canAdvance("pool", { pool: "owned", ownedNames: null }));
  assert.ok(canAdvance("pool", { pool: "owned", ownedNames: new Set() }));
});

test("canAdvance(priorities): needs at least one ranked stat", () => {
  assert.ok(!canAdvance("priorities", { priorities: [] }));
  assert.ok(canAdvance("priorities", { priorities: ["Constitution"] }));
});

test("nextStep / prevStep clamp at the ends", () => {
  assert.strictEqual(nextStep("intro"), "character");
  assert.strictEqual(nextStep("priorities"), "results");
  assert.strictEqual(nextStep("results"), "results");
  assert.strictEqual(prevStep("character"), "intro");
  assert.strictEqual(prevStep("intro"), "intro");
});

test("wizIsForged", () => {
  assert.ok(wizIsForged("Warforged") && wizIsForged("bladeforged"));
  assert.ok(!wizIsForged("Elf") && !wizIsForged(""));
});

test("U4: buildQuery reflects the Include-an-Artifact flag", () => {
  const on = buildQuery({ ...baseState(), includeArtifact: true });
  assert.strictEqual(on.includeArtifact, true);
  const off = buildQuery({ ...baseState(), includeArtifact: false });
  assert.strictEqual(off.includeArtifact, false);
});

test("U4: buildQuery defaults includeArtifact to false when unset", () => {
  // A fresh state with no includeArtifact -> query is false, so the default run
  // excludes Artifacts (R2 default). Coerced boolean, never undefined.
  const q = buildQuery(baseState());
  assert.strictEqual(q.includeArtifact, false);
});

// ---- U1 (Plan B) — load-to-Results routing (AE1, AE8) ----
test("U1: an optimal snapshot lands straight on Results", () => {
  assert.strictEqual(stepAfterLoad({ status: "optimal" }), "results");
});

test("U1: a non-optimal or missing snapshot routes to priorities (never blank Results)", () => {
  assert.strictEqual(stepAfterLoad({ status: "infeasible" }), "priorities");
  assert.strictEqual(stepAfterLoad({ status: "no_solution" }), "priorities");
  assert.strictEqual(stepAfterLoad({}), "priorities", "a snapshot with no status is not optimal");
  assert.strictEqual(stepAfterLoad(null), "priorities", "no saved snapshot");
  assert.strictEqual(stepAfterLoad(undefined), "priorities");
});

test("U1: load routing never targets pool/priorities-skippable intermediate steps", () => {
  // The only two landing steps are results (solved) or priorities (re-solve) —
  // load never drops the user on intro/character/pool.
  const landing = stepAfterLoad({ status: "optimal" });
  assert.ok(landing === "results" || landing === "priorities");
  assert.ok(!["intro", "character", "pool"].includes(stepAfterLoad({ status: "optimal" })));
  assert.ok(!["intro", "character", "pool"].includes(stepAfterLoad(null)));
});

// U4 — priority-picker vocabulary prefers the build's curated rankable list.
test("curatedStats: uses metadata.rankable_affixes when present", () => {
  const ds = {
    metadata: { rankable_affixes: ["Constitution", "Dodge", "Strength"] },
    items: [{ affixes: [{ stat: "Bal" }, { stat: "Strength" }] }],
  };
  assert.deepStrictEqual(curatedStats(ds), ["Constitution", "Dodge", "Strength"]);
  // parser garbage present in items[] must NOT appear (gate came from metadata)
  assert.ok(!curatedStats(ds).includes("Bal"));
});

test("curatedStats: falls back to dataset stats when metadata is absent", () => {
  const ds = { items: [{ affixes: [{ stat: "Dodge" }, { stat: "Accuracy" }] }] };
  assert.deepStrictEqual(curatedStats(ds), ["Accuracy", "Dodge"]);
});

test("curatedStats: returns a copy (mutating it never edits the dataset)", () => {
  const ds = { metadata: { rankable_affixes: ["Strength"] }, items: [] };
  curatedStats(ds).push("Mutated");
  assert.deepStrictEqual(ds.metadata.rankable_affixes, ["Strength"]);
});

console.log(`\n${passed} passed`);
