// U8 behavioral-parity regression guard (the FORWARD golden test).
//
// Loads the CURRENT web/data/items.json, runs every parity fixture through the
// real HiGHS solver (via the shared capture machinery), and asserts each
// fixture's perTarget map and sorted `chosen` loadout EXACTLY equal the ratified
// values in tests/parity/golden.json. Any future change that alters an optimal
// loadout fails here, loudly. Deterministic; part of the node suite convention.
//
// If a change is intentionally accepted, regenerate the fixture:
//   node tests/parity/capture_golden.js
//
// Run: node tests/solver_golden.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { solveAll } = require("./parity/capture_golden.js");

const GOLDEN = path.join(__dirname, "parity", "golden.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

(async () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const goldenNames = Object.keys(golden.solves);
  const { solves, count, details } = await solveAll();
  const fixtures = JSON.parse(fs.readFileSync(
    path.join(__dirname, "parity", "fixtures.json"), "utf8"));
  const fixtureByName = Object.fromEntries(fixtures.map((f) => [f.name, f]));

  test("golden guard pins exactly 19 fixtures", () => {
    // 19 = 15 + the #110 blocklist A/B pair (re-ratified 2026-08-12)
    //        + the #254 per-item Sonic-flag fixture
    //        + the #291 cross-add A/B fixture (re-ratified 2026-08-13).
    assert.strictEqual(count, 19, "19 fixtures run against the live solver");
    assert.strictEqual(golden.fixture_count, 19, "golden.json records 19 fixtures");
    assert.strictEqual(goldenNames.length, 19, "golden.json carries 19 fixture solves");
    assert.deepStrictEqual(Object.keys(solves).sort(), goldenNames.slice().sort(),
      "the same fixture names are solved and pinned");
  });

  // U1 — the credited fixtures must still DECLARE credits. Without this, deleting
  // `declaredCredits` from a fixture silently demotes it to an ordinary solve: the
  // guard keeps passing (it would re-ratify against whatever it produces) while
  // covering none of the credit path. A guard that can stop checking without
  // failing is the shape this repo has been bitten by; assert the input, not just
  // the output.
  test("the credited fixtures actually carry declared credits", () => {
    const fixtures = JSON.parse(fs.readFileSync(
      path.join(__dirname, "parity", "fixtures.json"), "utf8"));
    const credited = fixtures.filter((f) => f.query && f.query.declaredCredits
      && Object.keys(f.query.declaredCredits).length);
    assert.strictEqual(credited.length, 2,
      "2 fixtures must declare credits; a dropped declaration would leave the credit path unpinned");

    const byName = Object.fromEntries(credited.map((f) => [f.name, f]));
    const displaces = byName["trance-credit-displaces-ml34"];
    assert.ok(displaces, "the displacement fixture is present");
    assert.deepStrictEqual(displaces.query.declaredCredits["Combat Mastery||Insight"],
      { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
      "Insight Combat Mastery caps at 6 in the catalog, so 7 is what makes this fixture displace");

    const additive = byName["trance-credit-additive-ml32"];
    assert.ok(additive, "the additive fixture is present");
    assert.deepStrictEqual(additive.query.declaredCredits["Devotion||Sacred"],
      { stat: "Devotion", bonus_type: "Sacred", value: 12 },
      "no item carries Sacred-typed Devotion, so this credit must sit in an empty bucket");
  });

  // Each credited fixture is paired with an identical uncredited twin, so the
  // guard asserts the credit's EFFECT rather than two absolute numbers. A drift
  // that moved both halves together would keep the per-fixture equality tests
  // green; these deltas would not survive it.
  //
  // SCOPE LIMIT, verified by corruption: deleting buildProgram's credit bucket
  // floor (`sum(value_i * z_i) >= creditValue`) leaves all 10 fixtures green.
  // These solve the OPTIMUM path, where each stage maximizes its stat and the
  // objective pulls the credit's binary to 1 on its own. The floor only bites on
  // `tieBreak:false` paths — every Alternatives generator — so it is pinned in
  // tests/solver.test.js, not here. Do not read a green golden run as evidence
  // that the floor is intact.
  test("R5/R6 — a displacing credit raises its stat and frees capacity", () => {
    // Re-ratified for #211: `Combat Mastery` is expanded away, so the fixture
    // ranks it via aliasTargets (-> Stunning/Vertigo/Shatter) and the Battle
    // Trance credit migrates per-component through migrateCredits. The
    // displacement claim survives per component: the declared Insight 7 beats
    // the catalog's capped Insight Vertigo source (+1), while Stunning and
    // Shatter already carry Insight sources >= 7 and stay put. The freed
    // capacity serves the LAST priority (Physical Sheltering +2) — a gain a
    // lexicographic solve may only take below every credited rank, which is
    // exactly what pins the credit as a displacement rather than an add-on.
    const on = golden.solves["trance-credit-displaces-ml34"];
    const off = golden.solves["trance-credit-displaces-ml34-baseline"];
    assert.strictEqual(off.perTarget["Vertigo"], 34,
      "uncredited, the best Insight-typed Vertigo the catalog offers is capped");
    assert.strictEqual(on.perTarget["Vertigo"], 35,
      "the declared 7 beats the capped Insight item, netting +1");
    for (const stat of ["Stunning", "Shatter", "Constitution"]) {
      assert.strictEqual(on.perTarget[stat], off.perTarget[stat],
        `${stat} must be untouched (${off.perTarget[stat]} -> ${on.perTarget[stat]})`);
    }
    assert.strictEqual(on.perTarget["Physical Sheltering"] -
      off.perTarget["Physical Sheltering"], 2,
      "the freed capacity serves the last priority, with attribution");
    assert.deepStrictEqual(
      Object.keys(on.perTarget).filter((k) => on.perTarget[k] !== off.perTarget[k]).sort(),
      ["Physical Sheltering", "Vertigo"],
      "exactly the credited component and the freed-capacity beneficiary move");
  });

  test("AE4 — an empty-bucket credit adds its full value and disturbs nothing", () => {
    const on = golden.solves["trance-credit-additive-ml32"];
    const off = golden.solves["trance-credit-additive-ml32-baseline"];
    assert.strictEqual(on.perTarget.Devotion - off.perTarget.Devotion, 12,
      "no item carries Sacred-typed Devotion, so the credit is purely additive");
    assert.deepStrictEqual(on.chosen, off.chosen,
      "and the loadout is byte-identical — a credit that competes with nothing must move nothing");
    assert.strictEqual(on.perTarget.Wisdom, off.perTarget.Wisdom);
    assert.strictEqual(on.perTarget["Universal Spell Power"], off.perTarget["Universal Spell Power"]);
  });

  // ---------------------------------------------------------------------------
  // The newly-reachable paths. Each of the four fixtures below exists because the
  // eleven fixtures above did NOT move when the path was opened — which is the
  // documented tell that they do not cover it, not that it is safe (see
  // docs/solutions/conventions/close-a-defect-at-the-narrow-control-not-the-shared-rule.md).
  // ---------------------------------------------------------------------------

  // U2 — a Viktranium craftable option is ATOMIC: one record carrying its whole
  // affix list, gated on one binary. Before atomicity the same option was one record
  // PER affix competing inside a single `Σ n <= 1` choice slot, so one Lamordia slot
  // could buy exactly ONE of the seven schools a universal spell-DC craft grants.
  //
  // The unit suite proves this at buildProgram level over a hand-built model. That
  // model is downstream of BOTH the pool filter (`vikAdvances`, which had to learn
  // to read `affixes` instead of a flat `stat`) and the dominance pre-filter, so it
  // cannot see a host pruned before the solve or an option dropped before the
  // program is built. This is the end-to-end half.
  //
  // The fixture is chosen so the craft is LOAD-BEARING, not merely present: a
  // zero-marginal craft binary can float to 1 for free (the optimum's tie-break
  // minimizes item picks, not craft placements), and a fixture that only asserts
  // "a craft was placed" would pass on a solve where the craft bought nothing.
  // Exploding these options back to one-record-per-affix drops Illusion 31->29 and
  // Necromancy 30->28, which is the delta these assertions stand on.
  const DC_FIXTURE = "viktranium-multi-affix-dc-ml34";
  test("U2 — ONE atomic Viktranium craft credits every ranked spell school", () => {
    const schools = fixtureByName[DC_FIXTURE].query.targets;
    assert.ok(schools.length >= 2, "the fixture must rank two or more schools to prove anything");
    const g = golden.solves[DC_FIXTURE];
    for (const s of schools) {
      assert.ok(g.perTarget[s] > 0, `${s} must actually score (got ${g.perTarget[s]})`);
    }
    const placed = details[DC_FIXTURE].vikPlaced;
    const covering = placed.filter((p) => schools.every(
      (s) => p.affixes.some((a) => a.stat === s && a.value > 0)));
    assert.ok(covering.length >= 1,
      `a craft must carry EVERY ranked school at once; placed = ${JSON.stringify(
        placed.map((p) => [p.name, p.affixes.map((a) => a.stat)]))}`);
    for (const c of covering) {
      assert.strictEqual(c.affixes.length, 7,
        `${c.name} must ride through as the whole universal spell-DC option (7 schools), not one affix of it`);
      assert.strictEqual([...new Set(c.affixes.map((a) => a.bonus_type))].length, 1,
        "one craft, one bonus type — the seven schools share a bucket family, which is why " +
        "splitting them into competing records lost six of them");
    }
    // The load-bearing half, stated as the numbers the pre-atomicity shape cannot
    // reach. Both are strictly above the exploded-pool optimum; neither ranked stat
    // gives anything up, so this is a gain and not a lexicographic re-ranking.
    assert.strictEqual(g.perTarget["Illusion Focus"], 31,
      "Illusion Focus 31 — the one-record-per-affix pool reaches only 29");
    assert.strictEqual(g.perTarget["Necromancy Focus"], 30,
      "Necromancy Focus 30 — the one-record-per-affix pool reaches only 28");
  });

  // U5/U6 — a compound absorption enchantment ("Fire and Cold Absorption") expands
  // into its component affixes, so a player may rank a single element. 65 component
  // affixes became rankable; none of the eleven ratified fixtures ranks one.
  const ABS_FIXTURE = "absorption-compound-crown-ml35";
  test("U5/U6 — a compound absorption expansion is credited in a real solve", () => {
    const g = golden.solves[ABS_FIXTURE];
    const crown = "Legendary Crown of Ioun";
    assert.ok(g.chosen.some((c) => c.slot === "Helmet" && c.variant === crown),
      "the pinned compound carrier is worn — without it the fixture proves nothing");

    // The two ranked elements come from TWO DIFFERENT compounds on that one item.
    // Asserted against the built dataset, so a build-time regression that stopped
    // expanding (or stopped stamping provenance) fails here and not just silently
    // in a number that happens to still be reachable from other gear.
    const ds = JSON.parse(fs.readFileSync(
      path.join(__dirname, "..", "web", "data", "items.json"), "utf8"));
    const item = ds.items.find((i) => i.variant_id === crown);
    assert.ok(item, `${crown} is in the built dataset`);
    const viaOf = (stat) => {
      const a = (item.affixes || []).find((x) => (x.name != null ? x.name : x.stat) === stat);
      return a ? a.via : undefined;
    };
    assert.strictEqual(viaOf("Fire Absorption"), "Fire and Cold Absorption");
    assert.strictEqual(viaOf("Electric Absorption"), "Electricity and Acid Absorption");

    // Both components are Enhancement 40 on the Crown, and the Crown is the only
    // Enhancement-typed source of either element in this loadout — so each ranked
    // total has to contain that 40, or the expansion was not credited.
    // Fire 57 = Crown 40 (Enhancement) + 7 (Quality cloak) + 10 (Artifact Sun augment).
    // Electric 64 = Crown 40 (Enhancement) + 14 (Insight boots) + 10 (Artifact).
    assert.ok(g.perTarget["Fire Absorption"] >= 40,
      `Fire Absorption ${g.perTarget["Fire Absorption"]} must include the Crown's Enhancement 40`);
    assert.ok(g.perTarget["Electric Absorption"] >= 40,
      `Electric Absorption ${g.perTarget["Electric Absorption"]} must include the Crown's Enhancement 40`);
  });

  // #254 — the PER-ITEM Sonic flag. The crown fixture above covers only the STATIC
  // compounds ("Fire and Cold Absorption"), which expand unconditionally and never
  // read the elemental_absorption shard. The risky mechanism — {{Absorption|Elemental
  // |N|yes}} vs without deciding five elements vs four, per item — had zero parity
  // coverage: a regression expanding every carrier four-way (or five-way) would have
  // left all prior fixtures green while mis-crediting Sonic on thirteen items.
  //
  // The fixture pins one shard-gated carrier of each kind and locks EMPTY the three
  // slots holding every rival Sonic source at ML 26 (Malicia's Crown Enhancement 30
  // dominates the orb's 20 — unlocked, the orb's Sonic is zero-marginal and the
  // fixture proves nothing; the U2 load-bearing rule). Locked, the ranked Sonic
  // total is the orb's shard-gated expansion and nothing else.
  const SONIC_FIXTURE = "absorption-sonic-flag-ml26";
  test("#254 — the per-item Sonic flag decides five elements vs four", () => {
    const g = golden.solves[SONIC_FIXTURE];
    const orb = "Golden Orb of Death (level 26)";
    const robes = "War Wizard's Robes";
    assert.ok(g.chosen.some((c) => c.slot === "Off Hand" && c.variant === orb),
      "the sonic:true carrier is worn");
    assert.ok(g.chosen.some((c) => c.slot === "Armor" && c.variant === robes),
      "the sonic:false carrier is worn");

    // Dataset level — this is the only place the FIVE-way blanket direction is
    // detectable: a Sonic affix wrongly stamped onto the Robes shares the orb's
    // Enhancement bucket, so no solve total can see it.
    const ds = JSON.parse(fs.readFileSync(
      path.join(__dirname, "..", "web", "data", "items.json"), "utf8"));
    const FOUR = ["Acid Absorption", "Cold Absorption", "Fire Absorption", "Electric Absorption"];
    const expanded = (variantId) => ds.items
      .find((i) => i.variant_id === variantId).affixes
      .filter((a) => a.via === "Elemental Absorption")
      .map((a) => a.name)
      .sort();
    assert.deepStrictEqual(expanded(orb), FOUR.concat("Sonic Absorption").sort(),
      "sonic:true expands five-way");
    assert.deepStrictEqual(expanded(robes), FOUR.slice().sort(),
      "sonic:false expands four-way — a Sonic component here is the five-way blanket regression");

    // Solve level — the FOUR-way blanket direction. Sonic 20 is the orb's
    // Enhancement 20 and NOTHING else: Armor is pinned to a sonic:false carrier and
    // every other ML-26 Sonic source sits in a slot the fixture locks empty, so a
    // regression dropping the orb's fifth element reads 0 here, not a masked delta.
    assert.strictEqual(g.perTarget["Sonic Absorption"], 20,
      "the ranked Sonic total IS the shard-gated fifth element");
  });

  // The fixture's distinguishing power rests on its constraints, so — like the
  // declared-credit and blocklist guards — assert the INPUT too: dropping a pin or
  // an empty-lock would demote the fixture to an ordinary solve the golden would
  // happily re-ratify, while covering nothing.
  test("#254 — the sonic-flag fixture still carries its pins and locks", () => {
    const q = fixtureByName[SONIC_FIXTURE].query;
    const sc = q.slotConstraints || {};
    assert.strictEqual((sc["Off Hand"] || {}).variant_id, "Golden Orb of Death (level 26)");
    assert.strictEqual((sc["Armor"] || {}).variant_id, "War Wizard's Robes");
    for (const slot of ["Helmet", "Cloak", "Necklace"]) {
      assert.strictEqual((sc[slot] || {}).type, "empty",
        `${slot} must stay locked empty — it holds a rival Sonic source that would ` +
        "dominate the orb's Enhancement 20 and zero out the assertion above");
    }
    assert.deepStrictEqual(q.targets.slice(0, 1), ["Sonic Absorption"],
      "Sonic Absorption must stay the ranked stat under test");
  });

  // U10/U11 — a provenance label (the enchantment name the item surfaces print) is
  // rankable, and selecting it substitutes its component stats as CONSECUTIVE
  // priorities in the expansion's declared order. The claim under test is an
  // equivalence, so it is asserted between two live solves rather than against two
  // separately-ratified numbers that could drift together.
  const ALIAS = "provenance-alias-sacred-dc-ml34";
  const COMPONENTS = "provenance-components-sacred-dc-ml34";
  test("U10/U11 — the alias fixture still ranks a LABEL, not its expansion", () => {
    const q = fixtureByName[ALIAS].query;
    assert.deepStrictEqual(q.aliasTargets, ["Sacred Spell Focus Mastery"],
      "the fixture must still state the label; rewriting it to the components would " +
      "leave the substitution path unpinned while the guard kept passing");
    assert.ok(!q.targets, "and must NOT also state targets");
    assert.strictEqual(details[ALIAS].substitutions.length, 1,
      "the label actually substituted at solve time");
  });

  test("U10/U11 — a provenance label resolves to its components in declared order", () => {
    assert.deepStrictEqual(details[ALIAS].targets, fixtureByName[COMPONENTS].query.targets,
      "the live vocabulary resolves the label to exactly the twin's ranked list, in order");
    assert.strictEqual(details[ALIAS].targets.length, 7,
      "seven schools take seven strict-lexicographic ranks — they are never fused " +
      "into one objective term (the weighted-sum mode the Non-goals list declines)");
  });

  test("U10/U11 — ranking the label solves identically to ranking its components", () => {
    const a = solves[ALIAS];
    const b = solves[COMPONENTS];
    assert.strictEqual(a.status, b.status);
    assert.deepStrictEqual(a.perTarget, b.perTarget,
      "substitution is a rename of the priority list, not a different optimization");
    assert.deepStrictEqual(a.chosen, b.chosen,
      "and it yields the byte-identical loadout, tie-break included");
  });

  for (const name of goldenNames) {
    test(`golden solve unchanged: ${name}`, () => {
      const cur = solves[name];
      const want = golden.solves[name];
      assert.ok(cur, `fixture ${name} was solved`);
      assert.strictEqual(cur.status, want.status, "status matches");
      assert.deepStrictEqual(cur.perTarget, want.perTarget,
        `perTarget for ${name} must equal the ratified golden values`);
      assert.deepStrictEqual(cur.chosen, want.chosen,
        `chosen loadout (sorted slot+variant) for ${name} must equal the ratified golden loadout`);
    });
  }

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });

// #110 (U10) — the blocklist A/B pair's integrity guard, mirroring the
// declared-credit guard above: deleting the `blocklist` field would demote the
// blocked fixture to a twin of its baseline, and the golden would go on
// matching while covering none of the block path.
test("the blocklist fixture actually carries its block", () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "parity", "fixtures.json"), "utf-8"));
  const blocked = fixtures.find((f) => f.name === "blocklist-topaz-ml36");
  const baseline = fixtures.find((f) => f.name === "blocklist-topaz-ml36-baseline");
  assert.ok(blocked && baseline, "the A/B pair exists");
  assert.deepStrictEqual(blocked.query.blocklist, ["Topaz of Melee Power +14"],
    "the blocked twin still names its exclusion");
  assert.ok(!baseline.query.blocklist, "the baseline carries none");
  // The ratified outcomes must differ on the blocked stat and ONLY there.
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "parity", "golden.json"), "utf-8"));
  const a = golden.solves["blocklist-topaz-ml36-baseline"].perTarget;
  const b = golden.solves["blocklist-topaz-ml36"].perTarget;
  assert.ok(b["Melee Power"] < a["Melee Power"], "the block costs Melee Power");
  assert.strictEqual(b.Balance, a.Balance, "and touches nothing else");
});
