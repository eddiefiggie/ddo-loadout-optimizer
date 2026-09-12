// #742 — the augment pin. Run: node tests/augment-pin.test.js
//
// A player asked to force `Deconstructor` into their build and found no lever:
// items pin, sets pin, augments do not, and a `min 1` floor on one of its Bool
// affixes is satisfied by any of 111 other carriers.
//
// THE LOAD-BEARING TEST IN THIS FILE IS THE END-TO-END ONE. A pinned augment must
// survive THREE independent gates, none of which knew about pins before this:
//
//   1. the pool filter   — filterEligiblePool(eligible(...))  (ML cap, augment
//                          ceiling, crafting rung, blocklist, packs)
//   2. the dominance prune — the augment pool called dominanceFilter WITHOUT the
//                          pinnedIds that every worn slot passes
//   3. augBest (solver)  — `if (best.size)`, so an augment advancing no ranked
//                          target never gets a placement variable at all
//
// Gate 3 is fatal for this exact augment: Deconstructor's affixes are
// `Adamantine` (Bool), `Destruction` (Bool), and a Rust-damage line that is not
// rankable at all, so a player who pins it without ALSO ranking one of the first
// two would hit an unsatisfiable pin with nothing on screen.
//
// Three gate-local tests can each pass while the chain is broken — that is exactly
// how #721 dropped a pin in silence
// (docs/solutions/design-patterns/an-override-exemption-only-covers-the-gates-downstream-of-it.md).
// The end-to-end test is the only one that fails if a single gate forgets.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");
const { solveEnv } = require("./parity/capture_golden.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

/** The ASYNC runner. Every solve-driven assertion must go through this.
 *
 *  The sync `test()` above reports PASS the moment its callback returns, so a
 *  callback that merely STARTS a promise is reported green before a single
 *  assertion has run — and a rejection lands in an unhandled catch that prints
 *  after the summary line. Two tests in the first draft of this file did exactly
 *  that and reported PASS against a tree where the feature did not exist. That is
 *  the vacuous-guard failure the repo's own conventions warn about: a test which
 *  cannot fail is worse than no test, because it reads as coverage. */
async function testAsync(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const ROOT = path.join(__dirname, "..");
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data", "items.json"), "utf8"));

// The reporter's augment, read from the catalog rather than hand-described, so a
// dataset change that moves it fails here naming the augment.
const DECON = "Deconstructor";
const decon = raw.items.find((x) => (x.variant_id || x.source_item) === DECON);

test("#742 premise: Deconstructor is a Red augment whose affixes are all Bool", () => {
  assert.ok(decon, "Deconstructor is absent from the catalog");
  assert.strictEqual(decon.category, "augment");
  assert.strictEqual((decon.aug_color || {}).color, "Red");
  const types = new Set((decon.affixes || []).map((a) => a.type));
  assert.deepStrictEqual([...types], ["Bool"],
    "the whole problem is that nothing here carries a magnitude");
});

test("#742 premise: a floor on Destruction does not single out the augment", () => {
  // Why the existing lever cannot reach it: the floor is satisfiable from far
  // too many places for the solver to have any reason to prefer the augment.
  const carriers = raw.items.filter((x) =>
    (x.affixes || []).some((a) => a.name === "Destruction"));
  assert.ok(carriers.length > 50,
    `expected many Destruction carriers, found ${carriers.length}`);
  const augs = carriers.filter((x) => x.category === "augment");
  assert.deepStrictEqual(augs.map((x) => x.variant_id), [DECON],
    "Deconstructor is the only AUGMENT carrying it — but 'only augment' is not a constraint the model can express");
});

// ---- the three gates, individually ------------------------------------------

test("#742 gate 2: the augment pool prunes without a pin exemption today", () => {
  // A source-level guard on the asymmetry this feature closes. Worn slots pass
  // pinnedIds to dominanceFilter; the augment pool does not. When U2 lands this
  // assertion flips to REQUIRE the exemption — it is written against the seam so
  // it cannot pass vacuously either way.
  const src = fs.readFileSync(path.join(ROOT, "web", "model.js"), "utf8");
  const augCall = /dominanceFilter\(group, targetSet, mlCap([^)]*)\)/.exec(src);
  assert.ok(augCall, "the augment pool's dominanceFilter call moved — re-find it");
  assert.ok(/pinned/i.test(augCall[1]),
    "the augment pool must pass the pinned set, as every worn slot already does");
});

test("#742 gate 3: augBest admits a pinned augment that advances nothing", () => {
  // Pins the PROPERTY — the admission test consults the pin set — not the shape of
  // the condition. The first draft of this guard matched `if (best.size([^)]*))`,
  // which cannot span a nested call, so the very code that satisfies it turned it
  // red. Same trap as the ontoggle guard in tests/wizard.test.js, same fix:
  // docs/solutions/conventions/a-source-guard-must-pin-the-property-not-the-syntax-beside-it.md
  const src = fs.readFileSync(path.join(ROOT, "web", "solver.js"), "utf8");
  const idx = src.indexOf("augBest.set(aug, best)");
  assert.ok(idx > 0, "the augBest admission moved — re-find it");
  const condition = src.slice(src.lastIndexOf("if (", idx), idx);
  assert.ok(/best\.size/.test(condition), "the target-advancing case still admits");
  assert.ok(/pinnedAugs/.test(condition),
    "an augment advancing no ranked target must still enter augBest when pinned");
});

// ---- the end-to-end guard ---------------------------------------------------

(async () => {
  let env;
  try {
    env = await solveEnv();
  } catch (e) {
    console.error(`FAIL #742: could not prepare the solve environment\n  ${e.message}`);
    process.exitCode = 1;
    return;
  }
  const { dataset } = env;

  /** Solve with the app's own argument order, as tests/parity/capture_golden.js
   *  does. A hand-assembled buildModel call that drops a pool would prove nothing
   *  about what the app does. */
  const solve = async (query) => {
    const model = M.buildModel(
      dataset.items, query,
      dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
      dataset.seal, dataset.membership_set_defs, dataset.legendary_green_steel,
      {}, null, dataset.nearly_complete_per_item, dataset.essence_crafting,
    );
    // eslint-disable-next-line global-require
    const { solveLexicographic } = require("../web/solver.js");
    return solveLexicographic(model, env.highs);
  };

  /** Placed augments come from `augmentsPlaced`, NOT `chosen`. `chosen` carries
   *  worn items; an augment is a placement into a colour slot and is reported on
   *  its own channel — which is also the channel that silently dropped a pinned
   *  zero-value augment until #742 taught it about pins. */
  const placedAugments = (res) => new Set(((res && res.augmentsPlaced) || [])
    .map((a) => a.variant_id).filter(Boolean));

  // The reporter's case, exactly: pin the augment, rank NOTHING it carries.
  const REPORTER_QUERY = {
    mlCap: 30,
    targets: ["Melee Power"],
    pinnedAugments: [DECON],
  };

  const res = await solve(REPORTER_QUERY);

  await testAsync("#742 END-TO-END: a pinned augment advancing no ranked target is placed", async () => {
    assert.ok(res, "no result");
    assert.strictEqual(res.status, "optimal", `expected an optimal solve, got ${res.status}`);
    assert.ok(placedAugments(res).has(DECON),
      "Deconstructor was pinned and advances nothing — if any of the three gates "
      + "forgot the exemption, it is absent here and only here");
  });

  await testAsync("#742: the exemption is scoped to pins — an unpinned scoreless augment stays out", async () => {
    // The other half of gate 3. Without this, "fixing" the gate by admitting every
    // augment would satisfy the test above and quietly widen the whole program.
    const r = await solve({ mlCap: 30, targets: ["Melee Power"] });
    assert.strictEqual(r.status, "optimal", `expected an optimal solve, got ${r.status}`);
    assert.ok(!placedAugments(r).has(DECON),
      "Deconstructor is not pinned here and scores nothing, so it must not be placed");
  });

  await testAsync("#742: a blocked augment is not placed even when pinned", async () => {
    // Precedence: block is a hard rule and displaces a pin. Asserted through the
    // SOLVE rather than the UI confirm, so a dialog-only implementation fails here.
    const r = await solve({ ...REPORTER_QUERY, blocklist: [DECON] });
    assert.ok(!placedAugments(r).has(DECON),
      "a block is a hard rule — it must win at the solver, not just in the dialog");
  });

  console.log(`\n${passed} passed`);
})();
