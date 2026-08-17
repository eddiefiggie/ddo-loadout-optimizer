// #91 (U8) — AE1/AE2/AE3 acceptance runs on REAL data (web/data/items.json).
//
// A rerunnable verification script that IS a per-commit suite member.
//
// It was deliberately named `ae_utility_runs.js` (outside the tests/*.test.js
// glob) on the theory that it is evidence rather than a guard, and that the
// golden owns drift detection. #343's review disproved that: re-introducing the
// reported bug (a solver cap that stops the tier securing the late toggles)
// leaves 829/829 Python and 22/23 JS green, and the ONE red — solver_golden —
// reports opaque `chosen` drift naming no utility effect. Re-capturing the
// golden, the documented remedy this very PR performed on 18/23 fixtures, then
// turns the whole per-commit gate green with the bug live. The golden CANNOT
// name it: capture_golden.js snapshots status/perTarget/effective/chosen only,
// with no utility count and no effect names. These assertions are the only
// per-commit guard on the reported behavior, and they cost ~10 seconds.
//
// Run: node tests/utility_runs.test.js
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
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data", "items.json"), "utf8"));
  const dataset = normalizeDataset(raw);
  const vocab = buildPickerVocabulary(dataset);

  // The counting set rides as the buildModel argument, exactly as
  // web/query.js and web/wizard.js pass it (#91 U3, KTD3). AE3 passes the
  // PRE-#343 set explicitly so the two rosters are compared on one dataset
  // rather than against a remembered number.
  const solve = async (query, counting) => {
    const model = buildModel(dataset.items, query, dataset.dino_inserts, dataset.nearly_complete,
      dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged,
      dataset.green_steel, dataset.augment_set_defs, counting || vocab.utilityCounting);
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


  // ---- #343 — the roster change. AE1-AE3 of the default-roster plan. ----
  // These three solves are the evidence the change rests on, run against the
  // real catalog rather than a fixture: without them the plan's claim that the
  // fix works under contention is prose.
  const TOGGLES = ["Ghostly", "True Seeing", "Blurry", "Freedom of Movement",
    "Blindness Immunity", "Deathblock"];
  const secured = (r) => (r.utilityReport && r.utilityReport.effects || []).map((e) => e.name);

  console.log("\n#343/AE1 — ML34, one ranked priority: the reported bug closes");
  const { r: a1 } = await solve({ mlCap: 34, targets: ["Constitution", UTILITY_SENTINEL],
    armorType: null, weaponSetup: null, classRace: null });
  check("AE1: every worn defensive toggle is secured", () => {
    assert.strictEqual(a1.status, "optimal");
    const got = secured(a1);
    for (const t of TOGGLES) assert.ok(got.includes(t), `${t} missing — this is the reported bug`);
  });
  check("AE1: no Bane-family proc is counted any more", () => {
    assert.ok(!secured(a1).some((n) => /Bane$/.test(n)),
      "the weapon procs left the counted set");
  });
  console.log(`    count ${a1.utilityCount}: ${secured(a1).join(", ")}`);

  console.log("\n#343/AE2 — ML34, six contested ranked stats: it survives contention");
  const contested = ["Constitution", "Physical Sheltering", "Magical Sheltering",
    "Healing Amplification", "Dodge", "Fortification"];
  const { r: a2 } = await solve({ mlCap: 34, targets: [...contested, UTILITY_SENTINEL],
    armorType: null, weaponSetup: null, classRace: null });
  check("AE2: toggles are still secured when ranked stats contest the slots", () => {
    assert.strictEqual(a2.status, "optimal");
    const got = secured(a2);
    assert.ok(TOGGLES.some((t) => got.includes(t)),
      "under contention the count falls, but the toggles are what survive — " +
      "the old roster returned five weapon procs and no toggle here");
  });
  // AE3 of the plan's Verification: the tier is pinned last, so it cannot buy an
  // effect with a ranked point. This is the invariant the whole design rests on.
  const { r: a2NoTier } = await solve({ mlCap: 34, targets: contested,
    armorType: null, weaponSetup: null, classRace: null });
  check("AE2: no ranked stat pays for a utility effect", () => {
    for (const t of contested) {
      assert.strictEqual(a2.perTarget[t], a2NoTier.perTarget[t],
        `${t} moved when the tier was added — the tier is not pinned last`);
    }
  });
  console.log(`    count ${a2.utilityCount}: ${secured(a2).join(", ")}`);

  console.log("\n#343/AE3 — a weapon build loses nothing");
  // The style gate reads `style` (web/model.js:210) and wants a style id —
  // "thf". An earlier draft of this run passed `weaponStyle: "Two Handed"`,
  // which NOTHING reads, so it solved unconstrained and picked a one-handed
  // war hammer: the build most exposed to losing the Banes was never actually
  // under test. Both rosters are solved here so the comparison is measured.
  const thf = { mlCap: 34, targets: ["Melee Power", "Doublestrike", UTILITY_SENTINEL],
    armorType: null, weaponSetup: null, style: "thf", classRace: null };
  const oldCounting = new Set([
    ...[...vocab.utilityCounting].filter((n) => !TOGGLES.includes(n)),
    ...(raw.metadata.utility_untyped_admitted || []),
  ]);
  const { r: a3 } = await solve(thf);
  const { r: a3Old } = await solve(thf, oldCounting);
  check("AE3: the count does not fall for the build most exposed to losing the Banes", () => {
    assert.strictEqual(a3.status, "optimal");
    assert.strictEqual(a3Old.status, "optimal");
    assert.ok(a3.utilityCount >= a3Old.utilityCount,
      `a two-handed build should not lose count to the reshaped roster (new ${a3.utilityCount} ` +
      `vs old ${a3Old.utilityCount}); the toggles replace the Banes rather than reducing the total`);
    assert.ok(TOGGLES.some((t) => secured(a3).includes(t)), "and it gains toggles it never had");
    assert.ok(!TOGGLES.some((t) => secured(a3Old).includes(t)),
      "the old roster could not have counted them — otherwise this proves nothing");
  });
  console.log(`    count ${a3.utilityCount} (old roster ${a3Old.utilityCount}): ${secured(a3).join(", ")}`);

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
