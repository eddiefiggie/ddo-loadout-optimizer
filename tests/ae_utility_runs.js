// #91 (U8) — AE1/AE2/AE3 acceptance runs on REAL data (web/data/items.json).
//
// A rerunnable verification script, deliberately NOT named *.test.js: it is
// evidence for the Utility tier's acceptance examples, re-run when the dataset
// or solver changes, not a per-commit suite member (the golden guard owns
// drift detection; the perf gate lives in tests/perf_utility.js).
//
// Run: node tests/ae_utility_runs.js
//
// HONEST DEVIATION from the #91 report's telling, ratified 2026-08-15: the
// report compared Calamitous Warhammer against Echo of Whelm, but on the real
// dataset Calamitous NEVER wins the ML9 warhammer slot — Nightforge Hammer
// (ML8) carries Enhancement Bonus (Weapon) 5 to Calamitous's 4, and the
// Viktranium Miserable Sparks craft's +1 Exceptional Charisma is zero-marginal
// (Charisma 14 is reachable at ML9 without the weapon contributing, so the
// craft displaces nothing). The AE1/AE2 SHAPE holds exactly as specified with
// the proc-poor ranked winner being Nightforge Hammer instead: tier at the
// bottom keeps the ranked winner and surfaces Echo in Alternatives with the
// ranked cost stated; tier above the margin flips the slot to Echo.
"use strict";
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildModel, UTILITY_SENTINEL } = require("../web/model.js");
const S = require("../web/solver.js");
const A = require("../web/alternatives.js");
const { normalizeDataset, buildPickerVocabulary } = require("../web/dataset.js");

const ROOT = path.join(__dirname, "..");
const EB = "Enhancement Bonus (Weapon)";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

(async () => {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
  const dataset = normalizeDataset(JSON.parse(
    fs.readFileSync(path.join(ROOT, "web", "data", "items.json"), "utf8")));
  const vocab = buildPickerVocabulary(dataset);

  // The counting set rides as the buildModel argument, exactly as
  // web/query.js and web/wizard.js pass it (#91 U3, KTD3).
  const solve = async (query) => {
    const model = buildModel(dataset.items, query, dataset.dino_inserts, dataset.nearly_complete,
      dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged,
      dataset.green_steel, dataset.augment_set_defs, vocab.utilityCounting);
    const r = await S.solveLexicographic(model, highs);
    return { model, r };
  };
  const mainHand = (r) => {
    const c = (r.chosen || []).find((x) => x.slot === "Main Hand");
    return c ? (c.variant.variant_id || c.variant.source_item) : null;
  };

  // ---- AE1: tier at the bottom — the ranked winner keeps the slot, the ----
  // ---- Alternatives utility family surfaces Echo of Whelm with the cost ----
  console.log("AE1 — ML9 warhammers, targets [Enhancement Bonus (Weapon), Charisma, Utility effects]");
  const q1 = { mlCap: 9, targets: [EB, "Charisma", UTILITY_SENTINEL],
    weaponTypes: ["War Hammers"], armorType: null, classRace: null };
  const { model: m1, r: r1 } = await solve(q1);
  check("AE1: solve is optimal", () => assert.strictEqual(r1.status, "optimal"));
  check("AE1: the proc-poor ranked winner takes the slot (Nightforge Hammer, EB 5)", () => {
    assert.strictEqual(r1.perTarget[EB], 5, "the ML9 warhammer EB ceiling");
    assert.strictEqual(mainHand(r1), "Nightforge Hammer",
      "the report's Calamitous Warhammer (EB 4) never wins — see the header note");
  });
  const alts1 = S.generateAlternatives(r1, m1, highs);
  const u1 = alts1.find((a) => a.gainAxis === "utility");
  check("AE1: the Alternatives utility family surfaces Echo of Whelm", () => {
    assert.ok(u1, "a 'utility' family entry exists");
    assert.strictEqual(mainHand(u1.sol), "Echo of Whelm");
    assert.ok(u1.meta.to > u1.meta.from, "strictly more counted effects");
  });
  const an1 = u1 && A.analyzeAlternative(r1, u1, { targets: q1.targets });
  check("AE1: the trade states the ranked cost", () => {
    assert.ok(an1.tags.includes("utility effects"));
    assert.ok(an1.cost.some((c) => c.stat === EB && c.delta < 0),
      "the Enhancement Bonus surrendered for the procs is stated");
  });
  if (an1) console.log(`    gainText: "${an1.gainText}" | cost: ${JSON.stringify(an1.cost)}`);

  // ---- AE2: sentinel dragged ABOVE the marginal stat — Echo wins the slot ----
  console.log("AE2 — same query, sentinel above Enhancement Bonus");
  const q2 = { mlCap: 9, targets: [UTILITY_SENTINEL, EB, "Charisma"],
    weaponTypes: ["War Hammers"], armorType: null, classRace: null };
  const { r: r2 } = await solve(q2);
  check("AE2: Echo of Whelm wins the weapon slot", () => {
    assert.strictEqual(r2.status, "optimal");
    assert.strictEqual(mainHand(r2), "Echo of Whelm");
  });
  check("AE2: the stat below the tier reports the cost its position now permits", () => {
    assert.strictEqual(r2.perTarget[EB], 3, "Echo's EB 3, down from the tier-below solve's 5");
    assert.ok(r2.utilityCount > r1.utilityCount,
      `the promoted tier buys more effects (${r1.utilityCount} -> ${r2.utilityCount})`);
  });
  console.log(`    count: ${r2.utilityCount} | effects: ${r2.utilityReport.effects.map((e) => e.name).join(", ")}`);

  // ---- AE3: single-priority saturation — the tier fills empty slots ----
  console.log("AE3 — ML34, [Kinetic Lore] vs [Kinetic Lore, Utility effects]");
  const { r: r3a } = await solve({ mlCap: 34, targets: ["Kinetic Lore"],
    armorType: null, weaponSetup: null, classRace: null });
  const { r: r3b } = await solve({ mlCap: 34, targets: ["Kinetic Lore", UTILITY_SENTINEL],
    armorType: null, weaponSetup: null, classRace: null });
  check("AE3: the ranked stat is untouched (the lexicographic guarantee)", () => {
    assert.strictEqual(r3b.perTarget["Kinetic Lore"], r3a.perTarget["Kinetic Lore"]);
  });
  check("AE3: the tier fills slots the tier-absent solve leaves empty", () => {
    assert.ok(r3b.chosen.length > r3a.chosen.length,
      `${r3a.chosen.length} -> ${r3b.chosen.length} picks`);
    assert.ok(r3b.utilityCount > 0, "and the count is real");
  });
  console.log(`    picks ${r3a.chosen.length} -> ${r3b.chosen.length}, count ${r3b.utilityCount}`);

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
