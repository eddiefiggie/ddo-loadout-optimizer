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
// Ratifications:
//   #283 (2026-08-26) — `endgame-dps-ml33` Main Hand: `Dinosaur Bone Weapon` ->
//   `Attuned Bone Quarterstaff`. ONE fixture, ONE slot; `perTarget`, `effective`
//   and `status` are byte-identical, so no ranked target moved. Cause: the two
//   native quarterstaff hosts were the only Dino hosts whose crafting list names
//   a `(quarterstaff)` pool, and they shipped with ZERO insert capacity. The
//   blank (4 insert slots, no affixes) therefore beat the quarterstaff (no
//   slots, +15 Enhancement Bonus). With the capacity stamped the quarterstaff
//   matches the blank's slots AND keeps its affix, so it weakly dominates on
//   this query and the tie resolves to it. The answer now names a real craftable
//   item instead of the generic blank, for the same numbers.
//
// Run: node tests/solver_golden.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { solveAll } = require("./parity/capture_golden.js");

const GOLDEN = path.join(__dirname, "parity", "golden.json");

// The built dataset is ~25 MB; three tests need it, so parse it once.
let _ds;
function dataset() {
  if (!_ds) _ds = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "web", "data", "items.json"), "utf8"));
  return _ds;
}

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

  test("golden guard pins exactly 23 fixtures", () => {
    // 23 = 15 + the #110 blocklist A/B pair (re-ratified 2026-08-12)
    //        + the #254 per-item Sonic-flag fixture
    //        + the #291 cross-add A/B fixture (re-ratified 2026-08-13)
    //        + the #91 utility-tier A/B pair (2026-08-15, the Utility tier ships:
    //          every legacy fixture gained the "Utility effects" sentinel and was
    //          re-ratified per fixture — zero ranked-stat deltas, previously-empty
    //          slots fill with counting-set carriers; the tier-removed twin pins
    //          the byte-identical pre-feature program)
    //        + the #91 review-fix second tier-removed fixture (2026-08-15: the
    //          blocklist twin cloned minus the sentinel, so the pre-feature
    //          program is pinned on a complex query, not only the trivial
    //          single-priority baseline).
    //        + the #339 augment-ML-ceiling fixture (2026-08-16: cap 36 with
    //          augCeiling 32 — pins the augment-only gate end to end).
    assert.strictEqual(count, 23, "23 fixtures run against the live solver");
    assert.strictEqual(golden.fixture_count, 23, "golden.json records 23 fixtures");
    assert.strictEqual(goldenNames.length, 23, "golden.json carries 23 fixture solves");
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
    // 2026-08-15 (#91 U8): the Utility sentinel now rides every fixture's
    // targets; it is not a stat (KTD1 — no perTarget entry), so the
    // every-school-scores sweep iterates the ranked SCHOOLS only.
    const schools = fixtureByName[DC_FIXTURE].query.targets
      .filter((s) => s !== "Utility effects");
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
    const ds = dataset();
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
    const ds = dataset();
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
    // 2026-08-15 (#91 U8): the Utility sentinel rides the aliasTargets list —
    // migratePriorities passes it through untouched, mirroring a healed restore.
    assert.deepStrictEqual(q.aliasTargets, ["Sacred Spell Focus Mastery", "Utility effects"],
      "the fixture must still state the label; rewriting it to the components would " +
      "leave the substitution path unpinned while the guard kept passing");
    assert.ok(!q.targets, "and must NOT also state targets");
    assert.strictEqual(details[ALIAS].substitutions.length, 1,
      "the label actually substituted at solve time");
  });

  test("U10/U11 — a provenance label resolves to its components in declared order", () => {
    assert.deepStrictEqual(details[ALIAS].targets, fixtureByName[COMPONENTS].query.targets,
      "the live vocabulary resolves the label to exactly the twin's ranked list, in order");
    // 2026-08-15 (#91 U8): 8 = the label's seven schools + the Utility sentinel
    // appended after it. The schools still occupy seven strict-lexicographic
    // ranks — never fused into one objective term (the weighted-sum mode the
    // Non-goals list declines) — and the sentinel rides through unresolved.
    assert.strictEqual(details[ALIAS].targets.length, 8,
      "seven schools take seven strict-lexicographic ranks, plus the Utility sentinel");
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

  // #339 — the augment-only ML ceiling fixture. Like the blocklist and sonic
  // guards above, assert the INPUT (the fixture still carries its ceiling —
  // dropping the field would demote it to an ordinary solve the golden would
  // happily re-ratify) and the load-bearing OUTPUT: augments are actually
  // placed, and every one sits at/below the ceiling. The per-augment ML is
  // resolved against the built dataset because placed-augment records don't
  // carry `ml`.
  const CEILING_FIXTURE = "aug-ceiling-32-int-caster-ml36";
  test("#339 — the ceiling fixture carries its ceiling and no placed augment exceeds it", () => {
    const q = fixtureByName[CEILING_FIXTURE].query;
    assert.strictEqual(q.augCeiling, 32, "the fixture must still state its ceiling");
    assert.strictEqual(q.mlCap, 36, "with the cap ABOVE it, or the ceiling is moot");
    const placed = details[CEILING_FIXTURE].augmentsPlaced;
    assert.ok(placed.length >= 1,
      "at least one augment must be placed — a solve placing none would cover the gate vacuously");
    const ds = dataset();
    const mlOf = Object.fromEntries(ds.items
      .filter((i) => i.category === "augment")
      .map((i) => [i.variant_id, i.ml != null ? i.ml : i.minimum_level]));
    for (const id of placed) {
      assert.ok(mlOf[id] != null, `${id} resolves to a catalog augment with a ML`);
      assert.ok(mlOf[id] <= 32, `${id} (ML ${mlOf[id]}) must sit at/below the augment ML 32 ceiling`);
    }
  });

  // #365 — the Viktranium pool relocation, pinned where it landed. gear-planner
  // misfiled `Woeful: Quality Spell Focus Mastery` under `Woeful (Weapon)`; the
  // wiki puts it in the Accessories Wicked table, so the shard moves it and a
  // Woeful ACCESSORY host can finally craft the +2 Quality DC. The provenance
  // twins were the only fixtures whose ratified loadout moved, and they moved
  // identically (which is the pair's whole guarantee). This asserts the OUTPUT
  // the re-ratification was accepted for, so a future regression that quietly
  // put the option back on weapons fails here with a reason rather than as an
  // unexplained loadout diff.
  const DC_TWINS = ["provenance-alias-sacred-dc-ml34",
                    "provenance-components-sacred-dc-ml34"];
  for (const name of DC_TWINS) {
    test(`#365 — ${name} crafts the Quality DC on an ACCESSORY host`, () => {
      const placed = details[name].vikPlaced;
      const quality = placed.filter((v) => v.name === "Woeful: Quality Spell Focus Mastery");
      assert.strictEqual(quality.length, 1,
        "the relocated Quality DC option is crafted exactly once");
      assert.strictEqual(quality[0].category, "Accessory",
        "and on an Accessory host — crafting it on a Weapon means the relocation regressed");
      assert.ok(quality[0].affixes.every((a) => a.bonus_type === "Quality" && a.value === 2),
        "carrying the wiki's +2 Quality bonus on every spell school");
      // Its genuinely-weapon sibling stays a weapon craft in the same solve, so
      // the relocation moved one option and not the family.
      const exceptional = placed.filter(
        (v) => v.name === "Woeful: Exceptional Spell Focus Mastery");
      assert.ok(exceptional.every((v) => v.category === "Weapon"),
        "the Exceptional sibling is still crafted on a Weapon host");
    });
  }

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

// #91 (U8, KTD9) — the utility-tier A/B pair's integrity guard, mirroring the
// blocklist guard above. Two demotions are possible and both must fail loudly:
// dropping the tiered twin's sentinel makes it a twin of its baseline (the
// tier path unpinned, golden still green), and adding a sentinel to the
// baseline destroys the suite's ONLY pre-feature-program fixture — the one
// solve that pins conditional widening to byte-identity (a tier-removed query
// must rebuild the exact pre-feature program; ratified 2026-08-15 against the
// pre-feature golden capture).
test("the utility A/B pair actually carries (and withholds) its sentinel", () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "parity", "fixtures.json"), "utf-8"));
  const tiered = fixtures.find((f) => f.name === "utility-ab-kinetic-ml34");
  const baseline = fixtures.find((f) => f.name === "utility-ab-kinetic-ml34-baseline");
  assert.ok(tiered && baseline, "the A/B pair exists");
  assert.deepStrictEqual(tiered.query.targets, ["Kinetic Lore", "Utility effects"],
    "the tiered twin ranks the sentinel last");
  assert.deepStrictEqual(baseline.query.targets, ["Kinetic Lore"],
    "the baseline carries no sentinel — it is the pre-feature-program pin");
  // Every OTHER fixture must carry the sentinel (on targets, or on aliasTargets
  // where the fixture ranks a provenance label): a silently-dropped sentinel
  // would demote that fixture's tier coverage while the golden kept matching.
  // Exemptions are the deliberate tier-REMOVED fixtures — the pre-feature-
  // program pins (the trivial A/B baseline, plus the complex blocklist clone
  // added in the 2026-08-15 review fix).
  const TIER_REMOVED = new Set([
    "utility-ab-kinetic-ml34-baseline",
    "utility-removed-complex-blocklist-topaz-ml36",
  ]);
  for (const f of fixtures) {
    if (TIER_REMOVED.has(f.name)) continue;
    const list = f.query.aliasTargets || f.query.targets;
    assert.ok(list.includes("Utility effects"),
      `${f.name} must rank the Utility sentinel (2026-08-15 re-ratification)`);
  }
  // And the complex tier-removed clone must stay sentinel-free AND keep the
  // constraints that make it complex — dropping the blocklist would demote it
  // to an unconstrained solve the golden would happily re-ratify.
  const removedComplex = fixtures.find((f) => f.name === "utility-removed-complex-blocklist-topaz-ml36");
  assert.ok(removedComplex, "the complex tier-removed fixture exists");
  assert.deepStrictEqual(removedComplex.query.targets, ["Melee Power", "Balance"],
    "no sentinel — this fixture pins the pre-feature program on a complex query");
  assert.deepStrictEqual(removedComplex.query.blocklist, ["Topaz of Melee Power +14"],
    "and it still carries the block that makes it complex");
  // The ratified outcomes: the tier at the bottom costs zero ranked points and
  // fills previously-empty slots (the AE3 shape, pinned on real data).
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "parity", "golden.json"), "utf-8"));
  const on = golden.solves["utility-ab-kinetic-ml34"];
  const off = golden.solves["utility-ab-kinetic-ml34-baseline"];
  assert.strictEqual(on.perTarget["Kinetic Lore"], off.perTarget["Kinetic Lore"],
    "the bottom tier never costs a ranked point (the lexicographic guarantee)");
  assert.ok(on.chosen.length > off.chosen.length,
    `the tier fills slots the baseline leaves empty (${off.chosen.length} -> ${on.chosen.length} picks)`);
});

// #88 U4 — the overlay is inert when no override is in force.
//
// The overlay mutates affix types in place over the shared pool, which is the
// same object every golden solve reads. This asserts the empty case is a true
// no-op: with no overrides, classification plus apply plus withdraw must leave
// the pool byte-identical. Any diff here is a real regression in the overlay,
// not a golden to re-ratify — the fixtures above are the behavioural half of
// the same proof, and they run against an unmodified pool.
test("#88 — classify + apply([]) + withdraw leaves the pool byte-identical", () => {
  const DN = require("../web/dataset.js");
  const O = require("../web/overrides.js");
  const parse = () => JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "web", "data", "items.json"), "utf8"));

  const baseline = JSON.stringify(DN.normalizeDataset(parse()).items);

  const withOverlay = DN.normalizeDataset(parse());
  O.classifyPool(withOverlay);
  const report = O.applyOverrides(withOverlay, []);
  O.withdrawOverrides(withOverlay);

  assert.deepStrictEqual(report, { applied: [], unmatched: [], ineligible: [] },
    "an empty override set reports nothing applied");
  assert.strictEqual(JSON.stringify(withOverlay.items), baseline,
    "the overlay leaves no trace when empty — including the eligibility cache, " +
    "which is non-enumerable precisely so it cannot widen a save or an export");
});
