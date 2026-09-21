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

const { test, atest: testAsync, fail } = require("./_harness");

/** The ASYNC runner (the shared harness's `atest`, #853). Every solve-driven
 *  assertion must go through this.
 *
 *  A sync runner reports PASS the moment its callback returns, so a
 *  callback that merely STARTS a promise is reported green before a single
 *  assertion has run — and a rejection lands in an unhandled catch that prints
 *  after the summary line. Two tests in the first draft of this file did exactly
 *  that and reported PASS against a tree where the feature did not exist. That is
 *  the vacuous-guard failure the repo's own conventions warn about: a test which
 *  cannot fail is worse than no test, because it reads as coverage. */

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
    fail("#742: could not prepare the solve environment", e);
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

})();

// ---- U1: state, the control, and what the control promises ------------------

const W = require("../web/wizard.js");

test("#742 U1: augmentPinnable admits augments and nothing else", () => {
  assert.ok(W.augmentPinnable({ category: "augment" }));
  assert.ok(W.augmentPinnable({ aug_color: { color: "Red" } }));
  assert.ok(!W.augmentPinnable({ category: "item", slot: "Weapon" }));
  assert.ok(!W.augmentPinnable(null));
});

test("#742 U1: add is idempotent and remove is exact", () => {
  assert.deepStrictEqual(W.addAugmentPin([], DECON), [DECON]);
  assert.deepStrictEqual(W.addAugmentPin([DECON], DECON), [DECON], "no duplicate");
  assert.deepStrictEqual(W.addAugmentPin([], ""), [], "an empty id is not a pin");
  assert.deepStrictEqual(W.removeAugmentPin([DECON, "X"], DECON), ["X"]);
});

test("#742 U1: a pin naming an unknown augment is reported stale, not dropped", () => {
  const ds = { items: [{ variant_id: DECON, category: "augment" }] };
  assert.deepStrictEqual(W.augmentPinStale([DECON], ds), []);
  assert.deepStrictEqual(W.augmentPinStale([DECON, "Ghost Augment"], ds), ["Ghost Augment"]);
});

test("#742 U1/R6: the control states that the pin cannot choose a host", () => {
  // The honesty of this whole feature lives in one sentence, and it is the
  // sentence most likely to be softened later by someone reading it as hedging.
  // Issue #742 itself proposed that pinning the weapon AND the augment expresses
  // "Deconstructor in my weapon" — it does not, because placement is aggregate
  // per-colour capacity across every equipped item.
  const note = W.AUGMENT_PIN_NOTE;
  assert.ok(/cannot/i.test(note), "it must say what the pin cannot do");
  assert.ok(!/\b(in your weapon|in this item|choose the slot|that item)\b/i.test(note),
    `the note must not imply host selection: ${note}`);
});

test("#742 U1/R6: the augment row renders the note, not just a tooltip", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "wizard.js"), "utf8");
  const row = src.slice(src.indexOf("data-pin-aug="), src.indexOf("const hands = pinHandsFor(v)"));
  assert.ok(/AUGMENT_PIN_NOTE/.test(row),
    "the note must render in the row where the player commits");
  assert.ok(!/title=/.test(row), "a tooltip is not a disclosure — it must be on screen");
});

test("#742 U1: an augment never enters slotConstraints", () => {
  // A worn pin means 'this item in this slot'. An augment pin cannot mean that,
  // so the two predicates stay separate and a colour can never be slot-keyed.
  const src = fs.readFileSync(path.join(ROOT, "web", "wizard.js"), "utf8");
  const pred = /const isPinnable = \(v\) =>([^;]*);/.exec(src);
  assert.ok(pred, "isPinnable moved — re-find it");
  assert.ok(/category !== "augment"/.test(pred[1]),
    "the WORN pin predicate must still exclude augments");
});

test("#742 U1: buildQuery carries the pins through", () => {
  const q = W.buildQuery({ ml: 30, priorities: [], pinnedAugments: [DECON],
    race: "Human", armor: "Light", pool: "all", ownedNames: new Set(),
    slotConstraints: {}, bounds: {}, credits: {}, exclusions: {} }, { known: new Set() }, []);
  assert.deepStrictEqual(q.pinnedAugments, [DECON]);
});

test("#742 U1: an absent pin list reads as none, not as undefined", () => {
  const q = W.buildQuery({ ml: 30, priorities: [], race: "Human", armor: "Light",
    pool: "all", ownedNames: new Set(), slotConstraints: {}, bounds: {},
    credits: {}, exclusions: {} }, { known: new Set() }, []);
  assert.deepStrictEqual(q.pinnedAugments, [],
    "a build saved before this shipped must reload solving what it solved before");
});

test("#742 U5: the pin is on the saved-field allowlist", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "persist.js"), "utf8");
  assert.ok(/"pinnedAugments"/.test(src),
    "a reload that drops the pin silently widens a constraint the player set");
});

// ---- U3/U5: suppression reporting and the export surface --------------------

test("#742 U3: an unsatisfiable pin is reported, never silently dropped", () => {
  // The `continue` that skips an augment with no compatible open slot is the one
  // path where the pin genuinely cannot be honoured. Before this it dropped the
  // pin in total silence: a build with no augment and no reason.
  const src = fs.readFileSync(path.join(ROOT, "web", "solver.js"), "utf8");
  // Anchor forward from the branch's OPENING, not backward from a comment inside
  // it — the first draft of this guard sliced backwards from the comment and so
  // looked at everything except the branch it meant to check.
  const open = src.indexOf("const fits = (aug.fits_slots || [])");
  assert.ok(open > 0, "the unplaceable branch moved — re-find it");
  const close = src.indexOf("-> unplaceable", open);
  assert.ok(close > open, "the branch's closing marker moved");
  const branch = src.slice(open, close);
  assert.ok(/augPinReport\.push/.test(branch),
    "a pinned augment that cannot be placed must be reported");
  assert.ok(/pinnedAugs\.has/.test(branch),
    "and only when it is actually pinned — an unplaceable unpinned augment is not news");
});

test("#742 U3: the report reaches the result", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "solver.js"), "utf8");
  assert.ok(/augPinReport: program\.augPinReport/.test(src),
    "the report must travel on the result, or nothing can render it");
});

test("#742 U5: the pin appears in the shared inputs every export reads", () => {
  // projection.js is the single content source for all five outputs, so landing
  // it here is what makes 'every export' automatic rather than five edits.
  const src = fs.readFileSync(path.join(ROOT, "web", "projection.js"), "utf8");
  assert.ok(/"Pinned augments"/.test(src),
    "a pinned augment can be the only reason a loadout looks as it does — a share that omits it is unreproducible");
});

test("#742 U5: a build with no augment pin exports exactly as before", () => {
  // The omit-when-unset filter. Without it every pinless export grows a blank row.
  const src = fs.readFileSync(path.join(ROOT, "web", "projection.js"), "utf8");
  const row = src.slice(src.indexOf('["Pinned augments"'), src.indexOf('["Priorities"'));
  assert.ok(/length\)/.test(row) && /: ""/.test(row),
    "the row must collapse to an empty string when nothing is pinned");
});

// ---- Browser-pass regressions: the pin was invisible once set ---------------
//
// #742 shipped with every unit test green and TWO defects that only a rendered
// page showed. Both are the same root cause: the pin was written to a NEW list
// that two existing readers did not know about.
//
//   1. the section summary counted only `slotConstraints`, so it read
//      "nothing pinned" while the player was looking at a pinned augment;
//   2. the pinned-items list rendered only `slotConstraints`, so it said "No
//      pinned items yet" — and there was NO WAY TO REMOVE an augment pin.
//
// The lesson is narrow and repeatable: when a feature adds a parallel state
// list, every reader of the original list is a candidate defect, and a unit test
// that asserts the WRITE will not find them. These guards assert the READS.

test("#742 regression: the pool summary counts augment pins", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "wizard.js"), "utf8");
  const open = src.indexOf('case "pin": {');
  assert.ok(open > 0, "the pin summary moved — re-find it");
  const body = src.slice(open, src.indexOf('case "block"', open));
  assert.ok(/pinnedAugments/.test(body),
    'the summary read "nothing pinned" while an augment was pinned');
});

test("#742 regression: the pinned list renders augment pins with a remove control", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "wizard.js"), "utf8");
  const open = src.indexOf("function renderPinList()");
  assert.ok(open > 0, "renderPinList moved — re-find it");
  const body = src.slice(open, open + 4000);
  assert.ok(/data-unpin-aug/.test(body),
    "an augment pin with no remove control cannot be undone by the player");
  assert.ok(/removeAugmentPin/.test(body), "the remove control must actually unpin");
});

test("#742 regression: the augment rows render even when item pins exist", () => {
  // The first fix only handled the augments-ONLY branch, so a build with both
  // kinds of pin would have shown the item pins and silently dropped the
  // augment rows — the same invisibility, one branch over.
  const src = fs.readFileSync(path.join(ROOT, "web", "wizard.js"), "utf8");
  const open = src.indexOf("function renderPinList()");
  const body = src.slice(open, open + 6000);
  assert.ok(/box\.innerHTML = augRows \+ /.test(body),
    "the item-pin render must include the augment rows, not replace them");
});

test("#742 regression: the remove handler is re-bound after every render", () => {
  // innerHTML replaces the nodes, so a handler bound once is dead after the next
  // write. Both write sites must re-bind.
  const src = fs.readFileSync(path.join(ROOT, "web", "wizard.js"), "utf8");
  const open = src.indexOf("function renderPinList()");
  const body = src.slice(open, open + 6000);
  assert.ok((body.match(/bindAugUnpin\(\)/g) || []).length >= 2,
    "each innerHTML write needs its own re-bind, or the ✕ stops working");
});
