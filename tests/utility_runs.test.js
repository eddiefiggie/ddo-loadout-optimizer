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
const R = require("../web/results.js");
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
      dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.legendary_green_steel, dataset.augment_set_defs, counting || vocab.utilityCounting);
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
  // #443 — the `unreachable` half of the unsecured receipt, at a band where the
  // trimmed roster still produces it: at ML2 the counted toggles whose lowest
  // carrier sits at ML3+ (Ghostly, Blurry, Deathblock, Ethereal) have no carrier
  // at all, which is what `unreachable` means.
  const q1u = { mlCap: 2, targets: [EB, "Charisma", UTILITY_SENTINEL],
    weaponTypes: ["War Hammers"], armorType: null, classRace: null };
  const { r: r1u } = await solve(q1u);
  check("#443: the unreachable reason is still exercised, at a band that has it", () => {
    const uns = (r1u.utilityOrdered && r1u.utilityOrdered.unsecured) || [];
    assert.ok(uns.length, "the container names what it could not secure at ML2");
    assert.ok(uns.some((u) => u.reason === "unreachable"),
      "nothing at ML2 carries the higher-ML toggles, so the receipt must say unreachable");
  });

  const alts1 = S.generateAlternatives(r1, m1, highs);
  // #348 (U4, KTD7) — the Alternatives utility family is RETIRED. It used to
  // surface Echo of Whelm here as a gain ("+2 utility effects"). With the container
  // pinned last and solved lexicographically under ranked-exact locks, a zero-cost
  // strict win is impossible by construction, so every candidate that family could
  // produce costs a ranked stat — and that trade is better stated than offered.
  //
  // The AE1 SHAPE still holds and is still guarded: the proc-poor ranked winner
  // keeps the slot (asserted above), and AE2 below still flips the slot to Echo when
  // the container outranks the marginal stat. What changed is only where the Echo
  // trade is COMMUNICATED — U5's priced disclosure names the unsecured effect and
  // what securing it would cost, in place of a card offering the swap.
  check("AE1: no candidate carries the retired utility gain axis", () => {
    assert.strictEqual(alts1.filter((a) => a.gainAxis === "utility").length, 0);
    for (const a of alts1) {
      const an = A.analyzeAlternative(r1, a, { targets: q1.targets });
      assert.ok(!an.tags.includes("utility effects"), "no candidate is tagged a utility gain");
    }
  });
  check("AE1: the container names what it could not secure, and why", () => {
    // The receipt a player reads instead of the retired card. U5 adds its price.
    // At ML9 both reasons are exercised on real data: Echo of Whelm's procs are
    // `outbid` (a carrier exists in band and lost the slot), while the endgame named
    // effects are `unreachable` (nothing at this ML carries them at all). Asserting
    // BOTH appear is what keeps this from passing on a list that is all one reason.
    const unsecured = (r1.utilityOrdered && r1.utilityOrdered.unsecured) || [];
    assert.ok(unsecured.length, "the container names what it could not secure");
    assert.ok(unsecured.every((u) => u.reason === "outbid" || u.reason === "unreachable"),
      "every unsecured effect says why");
    assert.ok(unsecured.some((u) => u.reason === "outbid"), "the outbid case is exercised");
    // #443 — `unreachable` is no longer exercised AT ML9. The names that produced
    // it were the nine endgame PRESENCE_ALLOW effects, and the counting roster was
    // trimmed back to the sixteen curated worn toggles to bring the measured perf
    // ratio under budget. Every one of those sixteen has a carrier at ML<=9, so
    // nothing here is unreachable any more. The branch is still covered — moved to
    // its own check below at a band where it genuinely applies — because the point
    // of asserting both reasons is that this must not pass on a single-reason list.
    // Echo of Whelm's procs are the reported case: in band, carried, and outbid.
    const outbid = unsecured.filter((u) => u.reason === "outbid").map((u) => u.name);
    assert.ok(outbid.includes("Whelming Shockwave"),
      `Echo's proc is outbid, not unreachable: ${JSON.stringify(outbid)}`);
  });
  console.log(`    unsecured: ${JSON.stringify((r1.utilityOrdered || {}).unsecured || [])}`);

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

  // ---- AE4 (#345 U1): the outbid disclosure fires against REAL data. -------
  // The golden fixture set never produces this condition — 85 ranked targets
  // across 23 fixtures, zero occurrences — so a unit test on a synthetic model
  // proves only that the branch reads its own fixture. This solves the reported
  // build and asserts the disclosure on the result the app would actually show.
  console.log("\nAE4 — ML15 THF, Melee preset + Freedom of Movement ranked last (#345)");
  const MELEE = ["Melee Power", "Doublestrike", "Melee Alacrity", "Accuracy",
                 "Deadly", "Seeker", "Armor-Piercing", "Armor Class"];
  const FOM = "Freedom of Movement";
  const q4 = { mlCap: 15, targets: [...MELEE, FOM], style: "thf", armorType: null, classRace: null };
  const { model: m4, r: r4 } = await solve(q4);
  check("AE4: the solve is optimal and Freedom of Movement is reachable but zero", () => {
    assert.strictEqual(r4.status, "optimal");
    assert.strictEqual(r4.perTarget[FOM] || 0, 0, "the reported symptom: ranked, and nothing");
    assert.ok(R.poolStatNames(m4).has(FOM), "and it IS reachable — otherwise this is the other zero cause");
  });
  check("AE4: the outbid disclosure fires and names it", () => {
    const html = R.outbidNotice(q4, r4, m4);
    assert.ok(html, "a disclosure renders on the real result");
    assert.ok(html.includes(FOM), "names the target that got nothing");
  });
  check("AE4: the zero-source notice stays silent — this is not that cause", () => {
    assert.strictEqual(R.zeroSourceNotice(q4, r4, m4, dataset), "",
      "a reachable target is not unsourced; conflating them was the bug");
  });

  // ---- AE5 (#345 U2): attribution and price, proven against real data. ------
  console.log("\nAE5 — attributing the outbid target (#345)");
  const attr = S.attributeOutbid(r4.program, highs, FOM, q4.targets, r4.perTarget);
  check("AE5: the binding priority is named, and it is Accuracy for this list", () => {
    assert.ok(attr, "attribution succeeded on the reported case");
    // NOT Deadly. Issue #345's table came from the reporter's 13-priority list
    // with aasimar/scourge gating, where the pivot sat lower. Under the plain
    // Melee preset, Accuracy's lock already kills Freedom of Movement, and
    // Deadly sits BELOW Accuracy — by the time Deadly locks, it is long dead.
    // The prefix walk names the FIRST lock that binds, which is the one whose
    // relaxation would actually help. Naming a later stat would be advice that
    // cannot work.
    assert.strictEqual(attr.binding, "Accuracy",
      `expected Accuracy to bind under this list, got ${attr && attr.binding}`);
    const order = q4.targets;
    assert.ok(order.indexOf(attr.binding) < order.indexOf(FOM), "and it outranks the target");
  });
  check("AE5: the price is one point of the binding priority", () => {
    assert.strictEqual(attr.cost, 1, `expected a cost of 1, got ${attr.cost}`);
    assert.strictEqual(attr.bindingValue - attr.bindingHeld, attr.cost, "the cost is the give");
    assert.ok(attr.cost > 0, "a non-positive price would contradict the boundary");
  });
  check("AE5: the binary search agrees with an exhaustive walk", () => {
    // Monotonicity is structural (each lock only shrinks the feasible set), but
    // a binary search over a non-monotone predicate fails silently, so prove it.
    const linear = S.attributeOutbid(r4.program, highs, FOM, q4.targets, r4.perTarget, { linear: true });
    assert.deepStrictEqual(attr, linear, "binary-searched boundary must equal the walked one");
  });
  // Way of the Sun Soul has no source in this ML15 melee pool (measured: ten of
  // the twenty toggles are unreachable here). The probe must decline rather than
  // blame whichever stat happens to sit above it.
  const q5 = { ...q4, targets: [...MELEE, "Way of the Sun Soul"] };
  const { r: r5 } = await solve(q5);
  check("AE5: an unreachable target is refused, not attributed", () => {
    const none = S.attributeOutbid(r5.program, highs, "Way of the Sun Soul", q5.targets, r5.perTarget);
    assert.strictEqual(none, null, "no source means no attribution — that is the other zero cause");
  });
  check("AE5: a target ranked first has nothing above it and is refused", () => {
    const none = S.attributeOutbid(r4.program, highs, q4.targets[0], q4.targets, r4.perTarget);
    assert.strictEqual(none, null, "nothing outranks the first priority, so nothing outbid it");
  });
  console.log(`    ${FOM} bound by ${attr.binding} ${attr.bindingValue} -> ${attr.bindingHeld} (cost ${attr.cost})`);

  // ---- AE6 (#345 U4): accepting the trade pays exactly the priced cost. -----
  console.log("\nAE6 — requiring the outbid effect (#345)");
  const q6 = { ...q4, targetFloors: { [FOM]: 1 } };
  const { r: r6 } = await solve(q6);
  check("AE6: the required effect is secured", () => {
    assert.strictEqual(r6.status, "optimal", "flooring a reachable effect stays solvable");
    assert.ok((r6.perTarget[FOM] || 0) >= 1, `${FOM} is now held, was ${r4.perTarget[FOM] || 0}`);
  });
  check("AE6: the binding priority gives up exactly what pricing said", () => {
    const before = r4.perTarget[attr.binding];
    const after = r6.perTarget[attr.binding];
    assert.strictEqual(before - after, attr.cost,
      `${attr.binding} ${before} -> ${after} should cost exactly the quoted ${attr.cost}`);
  });
  check("AE6: nothing ranked above the binding priority was silently traded away", () => {
    // The quoted price is a promise about ONE stat. Everything above the binding
    // priority must be untouched, or the offer understated what it costs.
    for (const s of q4.targets) {
      if (s === attr.binding) break;
      assert.strictEqual(r6.perTarget[s], r4.perTarget[s],
        `${s} outranks ${attr.binding} and must not move`);
    }
  });
  check("AE6: the outbid disclosure stops firing for the effect once required", () => {
    assert.ok(!(r6.outbidReport || []).includes(FOM),
      "a secured effect is not outbid — the stamped report must drop it");
  });
  console.log(`    ${attr.binding} ${r4.perTarget[attr.binding]} -> ${r6.perTarget[attr.binding]}, ${FOM} ${r6.perTarget[FOM]}`);

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
