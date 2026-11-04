// #928 — production dataset -> model -> real HiGHS -> receipts and saved choices.
const assert = require("assert");
const path = require("path");
const { test, fail } = require("./_harness");
const D = require("../web/dataset.js");
const M = require("../web/model.js");
const S = require("../web/solver.js");
const W = require("../web/wizard.js");
const P = require("../web/projection.js");
const R = require("../web/results.js");
const X = require("../web/exporters.js");
const data = D.normalizeDataset(require("../web/data/items.json"));
const vocab = D.buildPickerVocabulary(data);
const original = data.items.find((v) => v.variant_id === "Epic Storm");
assert.ok(original, "the real source item must exist");
const copy = (v) => JSON.parse(JSON.stringify(v));
const power = "Power of the Thunderstorm";
const lore = "Thunderstorm Lore";
const targets = ["Magnetism", "Resonance", "Lightning Lore", "Sonic Lore"];
const aff = (name, type, value) => ({ name, type, value, unit: "flat" });
const excluded = [{ stat: power, bonus_type: "Equipment" }];
const query = (extra = {}) => ({ mlCap: 36, targets, craftingRung: "gear-only", ...extra });
const vendor = path.join(__dirname, "../web/vendor/");

(async () => {
  const H = await require(vendor + "highs.js")({ locateFile: (f) => vendor + f });
  const solve = (items, extra = {}) => S.solveLexicographic(M.buildModel(items, query(extra)), H);

  await test("compound: actual Epic Storm credits both powers and lores with original receipts", async () => {
    const result = await solve([original]);
    assert.strictEqual(result.status, "optimal");
    assert.deepStrictEqual(result.perTarget, { Magnetism: 131, Resonance: 131, "Lightning Lore": 16, "Sonic Lore": 16 });
    for (const stat of targets) {
      const label = stat.includes("Lore") ? lore : power;
      assert.ok(result.breakdown[stat].some((r) => r.via === label && r.source === "Epic Storm"));
    }
    assert.ok(result.breakdown.Magnetism.some((r) => r.crossAdd === "Universal Spell Power" && r.value === 20));
    const html = R.equippedBody(result.chosen[0].variant, -1, null, new Map());
    const md = X.toMarkdown({ name: "Compound regression", inputs: query(), snapshot: result });
    for (const text of [power + " +111", lore + " +16"]) {
      assert.ok(html.includes(text), text);
      assert.ok(md.includes(text), text);
    }
    assert.strictEqual(P.collapseExpansions(original.affixes).filter((a) => P.affixLabel(a) === power + " +111").length, 1);
  });

  await test("compound: same-type native max, different types, Potency and universals keep their arithmetic", async () => {
    const item = copy(original);
    item.affixes.push(aff("Magnetism", "Equipment", 100), aff("Resonance", "Equipment", 120),
      aff("Magnetism", "Insight", 15), aff("Lightning Lore", "Equipment", 18),
      aff("Sonic Lore", "Insight", 3), aff("Universal Spell Lore", "Exceptional", 5));
    // This is the normalized shape emitted for Potency/Spell Lore, not an
    // invented additive channel: same Equipment bucket must keep the maximum.
    item.affixes.push({ ...aff("Magnetism", "Equipment", 110), via: "Potency" },
      { ...aff("Sonic Lore", "Equipment", 14), via: "Spell Lore" });
    const result = await solve([item]);
    assert.deepStrictEqual(result.perTarget, { Magnetism: 146, Resonance: 140, "Lightning Lore": 23, "Sonic Lore": 24 });
  });

  await test("compound: source exclusion preserves lower native same-host fallback and engraved display", async () => {
    const item = copy(original);
    item.affixes.push(aff("Magnetism", "Equipment", 90), aff("Resonance", "Equipment", 80));
    const before = JSON.stringify(item);
    const result = await solve([item], { excludedTypes: excluded });
    assert.strictEqual(result.perTarget.Magnetism, 110);
    assert.strictEqual(result.perTarget.Resonance, 100);
    assert.ok(!result.breakdown.Magnetism.some((r) => r.via === power));
    assert.strictEqual(JSON.stringify(item), before, "catalog is immutable");
    assert.ok(result.chosen[0].variant.affixes.some((a) => a.origin_stat === power));
    assert.ok(R.equippedBody(result.chosen[0].variant, -1, null, new Map()).includes(power + " +111"));
  });

  await test("compound: source exclusion is applied before dominance and keeps native alternative", async () => {
    const native = copy(original);
    native.variant_id = "Native fallback regression";
    native.source_item = native.variant_id;
    native.affixes = [aff("Magnetism", "Equipment", 90), aff("Resonance", "Equipment", 80)];
    const result = await solve([original, native], { targets: ["Magnetism", "Resonance"], excludedTypes: excluded });
    assert.strictEqual(result.perTarget.Magnetism, 90);
    assert.strictEqual(result.chosen[0].variant.variant_id, native.variant_id);
  });

  await test("compound: source exclusion respects bonus type and leaves universal sources", async () => {
    const rain = data.items.find((v) => v.variant_id === "Bottled Rainstorm");
    const result = await solve([original, rain], { excludedTypes: [...excluded,
      { stat: "Power of the Frozen Storm", bonus_type: "Insight" }, { stat: lore, bonus_type: "Equipment" }] });
    assert.strictEqual(result.perTarget.Magnetism, 56, "20 Implement plus 36 Quality; Insight excluded");
    assert.strictEqual(result.perTarget.Resonance, 20);
    assert.strictEqual(result.perTarget["Lightning Lore"], 0);
    assert.strictEqual(result.perTarget["Sonic Lore"], 0);
  });

  await test("compound: direct program entry filters source before max without mutating model", async () => {
    const item = copy(original);
    item.affixes.push(aff("Magnetism", "Equipment", 75));
    const model = { targets: ["Magnetism"], mlCap: 36,
      worn: [{ slot: "Main Hand", cardinality: 1, variants: [item] }], excludedTypes: excluded };
    const before = JSON.stringify(model);
    const result = await S.solveLexicographic(model, H);
    assert.strictEqual(result.perTarget.Magnetism, 95);
    assert.strictEqual(JSON.stringify(model), before);
    assert.ok(result.chosen[0].variant.affixes.some((a) => a.origin_stat === power));
  });

  await test("compound: atomic crafted option preserves original receipt while source is excluded", async () => {
    const item = copy(original);
    item.affixes = []; item.nearly_complete = "Regression"; item.nc_tier = "Legendary";
    const components = original.affixes.filter((a) => a.origin_stat === power).map((a) =>
      ({ ...a, stat: a.name, bonus_type: a.type }));
    const opt = { category: "Regression", tier: "Legendary", name: "Atomic craft",
      affixes: [...components, { stat: "Constitution", bonus_type: "Enhancement", value: 8 }] };
    const result = await S.solveLexicographic({ targets: ["Constitution", "Magnetism"], mlCap: 36,
      worn: [{ slot: "Main Hand", cardinality: 1, variants: [item] }], nearlyComplete: [opt], excludedTypes: excluded }, H);
    assert.strictEqual(result.perTarget.Constitution, 8);
    assert.strictEqual(result.perTarget.Magnetism, 0);
    assert.ok(result.ncPlaced[0].affixes.some((a) => a.via === power));
  });

  await test("compound: saved priorities preserve order, deduplicate and disclose bounds", () => {
    const saved = { affixes: ["Strength", power, "Resonance", lore, "Dexterity"],
      floors: { [power]: 111, Strength: 10 }, caps: { [lore]: 16, Dexterity: 30 } };
    const result = W.applySavedBundle(saved, [], vocab);
    assert.deepStrictEqual(result.priorities, ["Strength", "Resonance", "Magnetism", "Sonic Lore", "Lightning Lore", "Dexterity"]);
    assert.deepStrictEqual(result.targetFloors, { Strength: 10 });
    assert.deepStrictEqual(result.targetCaps, { Dexterity: 30 });
    assert.strictEqual(result.droppedBounds.length, 2);
    const message = D.migrationMessage(result.substitutions, result.droppedBounds);
    assert.ok(message.includes(power) && message.includes(lore));
    assert.strictEqual(D.migratePriorities(result.priorities, vocab).substitutions.length, 0);
  });

  await test("compound: full-value declared credits survive canonical wizard cleanup", () => {
    const map = { old: { stat: power, bonus_type: "Equipment", value: 120 },
      native: { stat: "Magnetism", bonus_type: "Equipment", value: 125 },
      lore: { stat: lore, bonus_type: "Insight", value: 4 } };
    const credits = W.cleanCreditMap(map, vocab);
    assert.strictEqual(credits["Magnetism||Equipment"].value, 125);
    assert.strictEqual(credits["Resonance||Equipment"].value, 120);
    assert.strictEqual(credits["Lightning Lore||Insight"].value, 4);
    assert.strictEqual(credits["Sonic Lore||Insight"].value, 4);
    assert.ok(!Object.values(credits).some((c) => c.stat === power || c.stat === lore));
  });

  await test("compound: source exclusions remain specific and removable across saved reloads", () => {
    const state = { priorities: ["Magnetism", "Resonance"], excludedTypes: { legacy: excluded[0] } };
    const clean = W.cleanExclusionMap(state.excludedTypes, vocab, {});
    assert.deepStrictEqual(Object.values(clean), excluded);
    const reloaded = JSON.parse(JSON.stringify({ ...state, excludedTypes: clean }));
    const row = W.advancedRowModel("Magnetism", reloaded, vocab);
    assert.strictEqual(row.originSkipped.length, 1);
    assert.strictEqual(row.badgeCount, 1);
    assert.strictEqual(row.skipped.length, 0, "native Equipment is not excluded");
    assert.ok(W.originExclusionsHTML(row.originSkipped).includes("Remove exclusion"));
    delete reloaded.excludedTypes[row.originSkipped[0].key];
    assert.strictEqual(W.advancedRowModel("Magnetism", reloaded, vocab).originSkipped.length, 0);
  });

  await test("compound: saved source credit wins its same-source skip, independently declared component does not", async () => {
    const state = { priorities: targets, declaredCredits: { old: { stat: power, bonus_type: "Equipment", value: 100 } },
      excludedTypes: { old: excluded[0] } };
    const migrated = W.migrateSavedBonusChoices(state, vocab);
    assert.deepStrictEqual(migrated.excludedTypes, {});
    const result = await solve([original], migrated);
    assert.strictEqual(result.perTarget.Magnetism, 131);
    const separate = W.migrateSavedBonusChoices({ ...state,
      declaredCredits: { own: { stat: "Magnetism", bonus_type: "Equipment", value: 100 } } }, vocab);
    assert.deepStrictEqual(Object.values(separate.excludedTypes), excluded);
    const suppressed = await solve([original], separate);
    assert.strictEqual(suppressed.perTarget.Magnetism, 120);
  });

  await test("compound: saved-load credit migration runs before orphan removal", () => {
    const source = require("fs").readFileSync(path.join(__dirname, "../web/wizard.js"), "utf8");
    const load = source.slice(source.indexOf("if (_dnMig && _dnMig.migratePriorities)"));
    const split = load.indexOf("migrateSavedBonusChoices(state,");
    const drop = load.indexOf("delete state.declaredCredits[k]");
    assert.ok(split >= 0 && split < drop, "live load must split credits before orphan cleanup");
  });

  await test("compound unchanged guard: narrow and unverified damage scopes stay unexpanded", () => {
    for (const name of ["Power of the Blight", "Power of the Moonlit Haunt", "Power of the Flames of Purity",
      "Blighted Lore", "Moonlit Haunt Lore", "Purifying Flame Lore", "Frozen Thunderstorm Lore", "Sacred Ground Lore"]) {
      assert.strictEqual(D.expandedAwayFor(vocab, name), null, name);
    }
    const blight = data.items.find((v) => v.variant_id === "Blightstaff");
    assert.ok(!blight.affixes.some((a) => a.via === "Power of the Blight" && a.name === "Radiance"));
  });
})().catch((e) => fail("compound-spells: unexpected runner error", e));
