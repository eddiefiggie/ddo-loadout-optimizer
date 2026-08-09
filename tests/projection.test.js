// U6 — the shared content projection. Run: node tests/projection.test.js
const assert = require("assert");
const P = require("../web/projection.js");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); if (!process.exitCode) console.log(`PASS ${name}`); passed++; }
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

test("U7/P2: a Colorless slot filled by a set-augment copy is reserved (no double-book, no phantom free slot)", () => {
  const chosen = [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless"] } } }];
  const augmentsPlaced = [{ variant_id: "aug1", color: "Colorless" }];
  const setAugmentsPlaced = [{ set: "Quickblade", host: "Belt1", wiki_url: "x" }];
  const r = P.assignAugments(chosen, augmentsPlaced, setAugmentsPlaced);
  assert.strictEqual(r.byIndex.has(0), false, "ordinary augment not double-booked onto the full item");
  assert.deepStrictEqual(r.unplaced, augmentsPlaced, "ordinary augment reported unplaced, not on a taken slot");
  assert.strictEqual(r.freeByIndex.has(0), false, "no phantom free Colorless slot on the fully-occupied item");
  // discriminator: a spare Colorless slot still admits the ordinary augment
  const chosen2 = [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless", "Colorless"] } } }];
  assert.strictEqual(P.assignAugments(chosen2, augmentsPlaced, setAugmentsPlaced).byIndex.has(0), true, "with a spare Colorless slot the ordinary augment lands");
});

// ---- U3 — the set-contributor resolver ---------------------------------------
// CONCEPTS.md "Set contributor": three kinds, only the first in item data. A
// display reading `set_bonus` alone omits a piece the solve counted.

const _sc = (over) => Object.assign({
  chosen: [
    { slot: "Ring 1", variant: { variant_id: "RingA", set_bonus: [{ set: "Marshwalker" }] } },
    { slot: "Trinket", variant: { variant_id: "Gem", set_bonus: [] } },
  ],
  membershipPlaced: [], jokerPlaced: [], setAugmentsPlaced: [],
}, over || {});

test("U3: an intrinsic member reports its static set", () => {
  const m = P.setContributors(_sc());
  assert.deepStrictEqual(m.get("Ring 1||RingA"), [{ set: "Marshwalker", kind: "intrinsic" }]);
  assert.deepStrictEqual(m.get("Trinket||Gem"), []);
});

test("U3: a wildcard pick is attributed to its slot", () => {
  const m = P.setContributors(_sc({ jokerPlaced: [{ host: "Gem", group: 0, set: "Marshwalker" }] }));
  assert.deepStrictEqual(m.get("Trinket||Gem"), [{ set: "Marshwalker", kind: "wildcard" }]);
});

test("U3: a membership pick is attributed to its slot", () => {
  const m = P.setContributors(_sc({ membershipPlaced: [{ host: "Gem", set: "Lost Purpose", station: "vecna" }] }));
  assert.deepStrictEqual(m.get("Trinket||Gem"), [{ set: "Lost Purpose", kind: "membership" }]);
});

test("U3: one Gem feeds TWO sets — the resolver returns a list", () => {
  // The Gem takes one membership from EACH of two independent pools, so a singular
  // "the set it is feeding" is wrong on the common case.
  const m = P.setContributors(_sc({
    jokerPlaced: [{ host: "Gem", group: 0, set: "Marshwalker" }, { host: "Gem", group: 1, set: "Dino" }],
  }));
  assert.deepStrictEqual(m.get("Trinket||Gem").map((e) => e.set).sort(), ["Dino", "Marshwalker"]);
});

test("U3: suppression drops the INTRINSIC set but keeps a runtime pick", () => {
  // A Set Augment suppresses its host's own sets and the solver already dropped
  // them; re-adding here resurrects a piece the solve removed. A runtime pick on
  // the same host is a separate decision and survives.
  const m = P.setContributors(_sc({
    setAugmentsPlaced: [{ set: "Vecna Unleashed", host: "RingA" }],
    membershipPlaced: [{ host: "RingA", set: "Lost Purpose", station: "vecna" }],
  }));
  assert.deepStrictEqual(m.get("Ring 1||RingA"), [{ set: "Lost Purpose", kind: "membership" }],
    "the suppressed intrinsic Marshwalker is gone; the runtime pick remains");
});

test("U3: a duplicate variant reports the pick once, not on both slots", () => {
  const build = _sc({
    chosen: [
      { slot: "Ring 1", variant: { variant_id: "RingA", set_bonus: [] } },
      { slot: "Ring 2", variant: { variant_id: "RingA", set_bonus: [] } },
    ],
    membershipPlaced: [{ host: "RingA", set: "Lost Purpose", station: "cannith" }],
  });
  const m = P.setContributors(build);
  const hits = [...m.values()].filter((l) => l.length > 0);
  assert.strictEqual(hits.length, 1, "the pick exists once and is reported once");
});

test("U3: with no runtime picks the resolver agrees with slotSetNames", () => {
  // The no-change guard: an ordinary build must attribute exactly as before.
  const build = _sc();
  const m = P.setContributors(build);
  for (const c of build.chosen) {
    assert.deepStrictEqual(m.get(`${c.slot}||${c.variant.variant_id}`).map((e) => e.set),
      P.slotSetNames(c.variant));
  }
});

test("U3: a build with nothing equipped does not throw", () => {
  assert.doesNotThrow(() => P.setContributors({}));
  assert.doesNotThrow(() => P.setContributors(null));
  assert.strictEqual(P.setContributors({}).size, 0);
});

test("U4: a wildcard-completed set reports the tier its members prove", () => {
  // counts was static-only while members unioned runtime picks, so a set completed
  // BY a wildcard reported the LOWER tier's grant beside a member list proving the
  // higher one — and every export printed that contradiction as a shared number.
  const mk = (id, slot, set) => ({ slot, variant: { variant_id: id, set_bonus: set ? [{ set }] : [],
    parsed_set_bonuses: set ? [{ set, pieces_required: 2, affixes: [{ stat: "Strength", value: 2 }] },
                               { set, pieces_required: 3, affixes: [{ stat: "Strength", value: 10 }] }] : [] } });
  const build = { chosen: [mk("A", "Ring 1", "S3"), mk("B", "Goggles", "S3"), mk("Gem", "Trinket", null)],
    jokerPlaced: [{ host: "Gem", group: 0, set: "S3" }], membershipPlaced: [], setAugmentsPlaced: [],
    setsActive: [{ set: "S3", pieces_required: 3, affixes: [{ stat: "Strength", value: 10 }] }] };
  const d = P.satisfiedSetDetail(build).find((x) => x.set === "S3");
  assert.strictEqual(d.pieces, 3, "the wildcard counts toward the threshold, as the solver counted it");
  assert.strictEqual(d.members.length, 3);
  assert.deepStrictEqual(d.affixes, [{ stat: "Strength", value: 10 }], "and the grant is the tier actually active");
});

test("U4: one host holding two picks for the same set counts once", () => {
  const build = { chosen: [{ slot: "Trinket", variant: { variant_id: "Gem", set_bonus: [],
      parsed_set_bonuses: [{ set: "S2", pieces_required: 1, affixes: [] }, { set: "S2", pieces_required: 2, affixes: [] }] } }],
    jokerPlaced: [{ host: "Gem", group: 0, set: "S2" }, { host: "Gem", group: 1, set: "S2" }],
    membershipPlaced: [], setAugmentsPlaced: [], setsActive: [] };
  const d = P.satisfiedSetDetail(build).find((x) => x.set === "S2");
  assert.strictEqual(d.pieces, 1, "one host is one piece, not two");
});

console.log(`\n${passed} passed`);
