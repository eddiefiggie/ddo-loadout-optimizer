// U6 — the shared content projection. Run: node tests/projection.test.js
const assert = require("assert");
const P = require("../web/projection.js");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

// A rich saved record: a colored augment, a Lunar augment, a Viktranium craft, a
// completed set with a different bonus type, a crafted-membership-only set, and a
// capped priority stat.
function makeRec() {
  return {
    name: "Nightshade",
    stampedBuildId: "08032026.1",
    inputs: { ml: 32, race: "Elf", armor: "light", pool: "all", priorities: ["Deadly", "Dodge"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Goggles", variant: { variant_id: "Epic Spectacles", ml: 32,
          affixes: [{ name: "Deadly", type: "Insightful", value: 9 }],
          augment_slots_norm: { colors: ["red", "yellow"] },
          set_bonus: [{ set: "Vol Set" }],
          parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 3, affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }] } },
        { slot: "Ring", variant: { variant_id: "Moon Ring", ml: 30,
          affixes: [{ name: "Dodge", type: "Enhancement", value: 5, unit: "pct" }],
          augment_slots_norm: { colors: ["blue"] },
          set_bonus: [{ set: "Vol Set" }],
          parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 3, affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }] } },
        { slot: "Trinket", variant: { variant_id: "Vol Amulet", ml: 30, affixes: [],
          set_bonus: [{ set: "Vol Set" }],
          parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 3, affixes: [{ name: "Wizardry", type: "Enhancement", value: 150 }] }] } },
      ],
      effective: { Deadly: 21, Dodge: 20 },
      capped: { Dodge: 20 },
      breakdown: {
        Deadly: [
          { bonus_type: "Insightful", value: 9, source: "Epic Spectacles", sourceKind: "worn", slot: "Goggles", hostIds: ["Epic Spectacles"] },
          { bonus_type: "Insight", value: 9, source: "Deadly Aug", sourceKind: "augment" },
          { bonus_type: "Set", value: 3, source: "Vol Set", sourceKind: "set", setYieldingSlots: ["Goggles", "Ring", "Trinket"] },
        ],
        Dodge: [
          { bonus_type: "Enhancement", value: 15, source: "Moon Ring", sourceKind: "worn", slot: "Ring", hostIds: ["Moon Ring"] },
          { bonus_type: "Quality", value: 10, source: "Dodge Aug", sourceKind: "augment" },
        ],
      },
      augmentsPlaced: [
        { variant_id: "Deadly Aug", color: "red", slot_color: "red", affixes: [{ name: "Deadly", type: "Insight", value: 9 }] },
        { variant_id: "Lunar Insight Aug", color: "yellow", slot_color: "yellow", affixes: [{ name: "Insightful Constitution", type: "Insight", value: 4 }] },
        { variant_id: "Dodge Aug", color: "blue", slot_color: "blue", affixes: [{ name: "Dodge", type: "Quality", value: 10, unit: "pct" }] },
      ],
      setsActive: [],
      dinoPlaced: [], ncPlaced: [], rollPlaced: [],
      vikPlaced: [{ item: "Epic Spectacles", stat: "Resistance", bonus_type: "Enhancement", value: 3, slot_type: "Melancholic" }],
      sealPlaced: [], tfPlaced: [], gsPlaced: [], jokerPlaced: [], membershipPlaced: [],
    },
  };
}

test("project() builds the character header from rec.name/rec.inputs (not snapshot)", () => {
  const v = P.project(makeRec());
  assert.strictEqual(v.character.name, "Nightshade");
  const labels = v.character.constraints.map(([k]) => k);
  assert.ok(labels.includes("Character") && labels.includes("ML") && labels.includes("Priorities"),
    "header carries name + ML + priorities from rec.inputs");
  // A snapshot-only input would produce an empty header — prove name is populated.
  assert.ok(v.character.constraints.some(([k, val]) => k === "Character" && val === "Nightshade"));
});

test("loadout items carry assigned augments (color + Lunar/Solar) and crafting", () => {
  const v = P.project(makeRec());
  const goggles = v.loadout.find((i) => i.slot === "Goggles");
  const colors = goggles.augments.map((a) => a.slotColor);
  assert.deepStrictEqual(colors.sort(), ["red", "yellow"]);
  const lunar = goggles.augments.find((a) => a.lunarSolar);
  assert.strictEqual(lunar.lunarSolar, "Lunar", "the Lunar augment is detected by name");
  assert.ok(goggles.crafting.some((c) => c.family === "vik" && /Viktranium/.test(c.label)), "Viktranium craft present");
});

test("AE2: attribution covers priority stats only, totals equal effective", () => {
  const v = P.project(makeRec());
  assert.deepStrictEqual(Object.keys(v.attribution), ["Deadly", "Dodge"], "only the ranked priorities");
  assert.strictEqual(v.attribution.Deadly.total, 21);
  assert.strictEqual(v.attribution.Deadly.sources.length, 3);
  const setSrc = v.attribution.Deadly.sources.find((s) => s.viaSet);
  assert.strictEqual(setSrc.source, "Vol Set");
  // Each source carries its value + bonus type (the attributed detail R7/AE2 promise).
  const worn = v.attribution.Deadly.sources.find((s) => s.source === "Epic Spectacles");
  assert.strictEqual(worn.value, 9);
  assert.strictEqual(worn.bonusType, "Insightful");
});

test("project() degrades quietly on a malformed snapshot (no chosen) instead of throwing", () => {
  assert.doesNotThrow(() => P.project({}), "empty record projects without throwing");
  assert.doesNotThrow(() => P.project({ name: "X", inputs: {}, snapshot: { setsActive: [{ set: "S", pieces_required: 2, affixes: [] }] } }),
    "a snapshot with setsActive but no chosen still projects (activeSetDetail is guarded)");
  const v = P.project({});
  assert.deepStrictEqual(v.loadout, []);
  assert.deepStrictEqual(v.sets, []);
});

test("AE3: a capped priority stat carries its cap alongside the raw contribution sum", () => {
  const v = P.project(makeRec());
  const dodge = v.attribution.Dodge;
  assert.strictEqual(dodge.total, 20);
  assert.strictEqual(dodge.cap, 20);
  const raw = dodge.sources.reduce((s, p) => s + p.value, 0);
  assert.strictEqual(raw, 25, "raw sum exceeds the clamped total");
});

test("AE5: a crafted-membership-only set (no static tiers) still lists its granted affixes", () => {
  const rec = makeRec();
  // A host with a Set Bonus membership, no static parsed_set_bonuses; solver marks it active.
  rec.snapshot.chosen.push({ slot: "Belt", variant: { variant_id: "Dino Belt", ml: 32, affixes: [] } });
  rec.snapshot.membershipPlaced = [{ host: "Dino Belt", set: "Delight of the Devourer", station: "Dinosaur Bone crafting" }];
  rec.snapshot.setsActive = [{ set: "Delight of the Devourer", pieces_required: 3, affixes: [{ name: "Devourer's Might", type: "Enhancement", value: 20 }] }];
  const v = P.project(rec);
  const set = v.sets.find((s) => s.set === "Delight of the Devourer");
  assert.ok(set, "the crafted-membership set appears");
  assert.ok(set.affixes.some((a) => a.name === "Devourer's Might"), "its granted affix is present");
});

test("craftLabel routes membership through the registry, keeps literals for other families", () => {
  assert.strictEqual(P.craftLabel({ set: "X", station: "Cannith Repurposing Station" }, "membership"), "Awaken Set Bonus: X");
  assert.strictEqual(P.craftLabel({ set: "X", station: "Dinosaur Bone crafting" }, "membership"), "Slot Set Bonus augment: X");
  assert.strictEqual(P.craftLabel({ stat: "Resistance", bonus_type: "Enhancement", value: 3, slot_type: "Melancholic" }, "vik"),
    "Slot Melancholic Viktranium augment: Resistance +3");
  assert.strictEqual(P.craftLabel({ stat: "Con", bonus_type: "Insight", value: 4 }, "nc"), "Nearly Completed: Con +4 Insight");
});

test("assignAugments reconstructs a deterministic augment->item host assignment", () => {
  const chosen = [{ variant: { augment_slots_norm: { colors: ["red"] } } }, { variant: { augment_slots_norm: { colors: ["red"] } } }];
  const placed = [{ variant_id: "A", slot_color: "red" }, { variant_id: "B", slot_color: "red" }];
  const { byIndex } = P.assignAugments(chosen, placed);
  assert.strictEqual(byIndex.get(0)[0].variant_id, "A");
  assert.strictEqual(byIndex.get(1)[0].variant_id, "B");
});

test("craftLabel augmentset names the set and any suppressed host set", () => {
  assert.strictEqual(P.craftLabel({ set: "Vecna" }, "augmentset"), "Set Augment: Vecna");
  assert.strictEqual(P.craftLabel({ set: "Vecna", suppresses: ["Legendary Might"] }, "augmentset"),
    "Set Augment: Vecna (suppresses Legendary Might)");
});

test("U7: a placed Set Augment is emitted on its solver-decided host with the suppression note", () => {
  const rec = makeRec();
  rec.snapshot.setAugmentsPlaced = [{ set: "Legendary Might", host: "Vol Amulet", wiki_url: "https://ddowiki.com/x" }];
  const v = P.project(rec);
  const trinket = v.loadout.find((i) => i.item === "Vol Amulet");
  const sa = trinket.crafting.find((c) => c.family === "augmentset");
  assert.ok(sa, "the placed Set Augment rides in the host's crafting");
  assert.strictEqual(sa.set, "Legendary Might");
  assert.strictEqual(sa.host, "Vol Amulet", "host is the solver-decided host, read verbatim (KTD-6)");
  assert.ok(/Set Augment: Legendary Might/.test(sa.label));
  assert.ok(/suppresses Vol Set/.test(sa.label), "the host's own set is named suppressed inline");
  assert.deepStrictEqual(trinket.suppressedSets, ["Vol Set"]);
  // A non-host item carries no augmentset entry and nothing suppressed.
  const goggles = v.loadout.find((i) => i.item === "Epic Spectacles");
  assert.ok(!goggles.crafting.some((c) => c.family === "augmentset"));
  assert.deepStrictEqual(goggles.suppressedSets, []);
});

test("U7: a host's suppressed set is dropped from the active sets output (shown suppressed, not active)", () => {
  const rec = makeRec();
  assert.ok(P.project(rec).sets.some((s) => s.set === "Vol Set"), "Vol Set is active with no suppression");
  rec.snapshot.setAugmentsPlaced = [{ set: "Legendary Might", host: "Vol Amulet" }];
  const v = P.project(rec);
  assert.ok(!v.sets.some((s) => s.set === "Vol Set"), "Vol Set falls out once one member hosts a Set Augment");
});

test("results.js re-export surface is intact after the extraction (KTD2)", () => {
  for (const fn of ["attributionByTarget", "whyThis", "assignAugments", "satisfiedSetDetail", "affixLabel"]) {
    assert.strictEqual(typeof R[fn], "function", `results.js still exports ${fn}`);
  }
  // And the bound copy behaves identically to the projection's definition.
  assert.strictEqual(R.affixLabel({ name: "Con", type: "Insight", value: 4 }), P.affixLabel({ name: "Con", type: "Insight", value: 4 }));
});

if (!process.exitCode) console.log(`\n${passed} passed`);
