// U6 — the shared content projection. Run: node tests/projection.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const P = require("../web/projection.js");
const R = require("../web/results.js");
const Craft = require("../web/crafting-systems.js");

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

// ---- #316 — slot-color reservation + read-time canonicalization --------------

test("#316: reservation decrements the color the copy consumed, not hardcoded Colorless", () => {
  const chosen = [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless", "Yellow"] } } }];
  const augmentsPlaced = [{ variant_id: "aug1", color: "Colorless" }];
  const setAugmentsPlaced = [{ set: "Quickblade", host: "Belt1", slot_color: "Yellow" }];
  const r = P.assignAugments(chosen, augmentsPlaced, setAugmentsPlaced);
  assert.strictEqual(r.byIndex.has(0), true, "the Colorless slot is still free for the ordinary augment");
  assert.deepStrictEqual(r.freeByIndex.get(0), undefined, "Yellow consumed by the copy, Colorless by the augment");
});

test("#316/legacy: a restored placement without slot_color still reserves one Colorless slot", () => {
  const chosen = [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless"] } } }];
  const augmentsPlaced = [{ variant_id: "aug1", color: "Colorless" }];
  const setAugmentsPlaced = [{ set: "Quickblade", host: "Belt1" }]; // pre-#316 snapshot shape
  const r = P.assignAugments(chosen, augmentsPlaced, setAugmentsPlaced);
  assert.strictEqual(r.byIndex.has(0), false, "legacy copy defaults to Colorless and reserves it");
  assert.deepStrictEqual(r.unplaced, augmentsPlaced, "no new unplaced beyond the genuinely displaced augment");
});

test("#316/AE5: canonicalization keeps the solved color when Colorless is already consumed", () => {
  // Alternatives-path shape: the host's Colorless slot is needed by an ordinary
  // Colorless augment and the copy legitimately sits in Yellow. Recoloring the
  // copy to Colorless would displace the ordinary augment — the trial-assignment
  // guard must refuse, keep Yellow, and grow no unplaced set.
  const build = {
    chosen: [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless", "Yellow"] } } }],
    augmentsPlaced: [{ variant_id: "aug1", color: "Colorless", slot_color: "Colorless" }],
    setAugmentsPlaced: [{ set: "Quickblade", host: "Belt1", slot_color: "Yellow" }],
  };
  const canon = P.canonicalSetAugments(build);
  assert.strictEqual(canon[0].slot_color, "Yellow", "solved color kept — no feasible recolor");
  const r = P.assignAugments(build.chosen, build.augmentsPlaced, canon);
  assert.strictEqual(r.unplaced.length, 0, "no ordinary augment displaced by canonicalization");
  assert.ok(["Colorless", "Yellow"].includes(canon[0].slot_color), "reported color is host-exposed");
});

test("#316: a feasible recolor re-reports the copy as Colorless and moves the reservation", () => {
  const build = {
    chosen: [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless", "Yellow"] } } }],
    augmentsPlaced: [],
    setAugmentsPlaced: [{ set: "Quickblade", host: "Belt1", slot_color: "Yellow" }],
  };
  const canon = P.canonicalSetAugments(build);
  assert.strictEqual(canon[0].slot_color, "Colorless", "free Colorless slot -> Colorless-first recolor");
  const r = P.assignAugments(build.chosen, [], canon);
  assert.deepStrictEqual(r.freeByIndex.get(0), ["Yellow"], "the Yellow slot is released");
  assert.strictEqual(build.setAugmentsPlaced[0].slot_color, "Yellow", "the persisted snapshot is never mutated");
});

test("#316: canonicalization is idempotent on a tie-broken primary solve", () => {
  const build = {
    chosen: [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Colorless", "Yellow"] } } }],
    augmentsPlaced: [],
    setAugmentsPlaced: [{ set: "Quickblade", host: "Belt1", slot_color: "Colorless" }],
  };
  const canon = P.canonicalSetAugments(build);
  assert.strictEqual(canon[0].slot_color, "Colorless", "already-canonical placement is unchanged");
});

test("#316: canonicalization never yields a color the host lacks", () => {
  const build = {
    chosen: [{ slot: "Belt", variant: { variant_id: "Belt1", augment_slots_norm: { colors: ["Green", "Yellow"] } } }],
    augmentsPlaced: [],
    setAugmentsPlaced: [{ set: "Quickblade", host: "Belt1", slot_color: "Yellow" }],
  };
  const canon = P.canonicalSetAugments(build);
  assert.strictEqual(canon[0].slot_color, "Yellow", "no Colorless slot on the host -> solved color kept");
});

test("#316: the projected crafting entry (the export path) carries slot_color and the label clause", () => {
  // Exports render cr.label verbatim from craftingForItem — the chip path
  // alone showing the color is exactly the solve-visible-but-share-invisible
  // gap the exports invariant forbids.
  const rec = makeRec();
  rec.snapshot.setAugmentsPlaced = [{ set: "Legendary Might", host: "Vol Amulet", slot_color: "Yellow" }];
  const v = P.project(rec);
  const trinket = v.loadout.find((i) => i.item === "Vol Amulet");
  const sa = trinket.crafting.find((c) => c.family === "augmentset");
  assert.strictEqual(sa.slot_color, "Yellow", "the entry carries the consumed color");
  assert.ok(/— in Yellow slot/.test(sa.label), `label names the slot: ${sa.label}`);
});

test("#316: the augmentset label names the consumed slot color for every surface", () => {
  assert.strictEqual(
    P.craftLabel({ set: "Quickblade", slot_color: "Yellow", suppresses: [] }, "augmentset"),
    "Set Augment: Quickblade — in Yellow slot");
  assert.strictEqual(
    P.craftLabel({ set: "Quickblade", slot_color: "Colorless", suppresses: ["Vol Set"] }, "augmentset"),
    "Set Augment: Quickblade — in Colorless slot (suppresses Vol Set)");
  // Without a slot_color (callers outside the canonical list) the label is unchanged.
  assert.strictEqual(
    P.craftLabel({ set: "Quickblade", suppresses: [] }, "augmentset"),
    "Set Augment: Quickblade");
});

test("#316/R8: setAugmentSlotRule reads the rule off the actual defs", () => {
  const seven = ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"];
  const full = P.setAugmentSlotRule({ augment_set_defs: { A: { fits_slots: seven.slice() } } });
  assert.deepStrictEqual(full, { anyStandardColor: true, moonSunIncluded: false });
  const narrow = P.setAugmentSlotRule({ augment_set_defs: { A: { fits_slots: ["Colorless"] } } });
  assert.strictEqual(narrow.anyStandardColor, false, "a narrower matrix is reported, not papered over");
  const moon = P.setAugmentSlotRule({ augment_set_defs: { A: { fits_slots: seven.concat(["Moon"]) } } });
  assert.strictEqual(moon.moonSunIncluded, true, "a future Moon/Sun ruling flips the disclosure off");
  assert.strictEqual(P.setAugmentSlotRule({}), null, "no defs -> no claim");
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

// ---- U9 — Viktranium crafts render in their in-game order, not host-item emission order ----
// R16: a player reported the four Viktranium slots (Melancholic, Dolorous, Miserable,
// Woeful) rendering alphabetically (Dolorous, Melancholic, Miserable, Woeful) instead of
// the in-game slot order the registry already declares. buildCraftMaps groups vikPlaced
// by host in solver-emission order; it must instead sort each host's list by the
// registry's declared slot_types order.

test("U9: buildCraftMaps orders one item's Viktranium crafts by in-game slot order, not emission order", () => {
  // Emitted Woeful-before-Melancholic (solver/emission order); expect Melancholic first.
  const build = {
    chosen: [],
    vikPlaced: [
      { item: "Epic Spectacles", stat: "Resistance", bonus_type: "Enhancement", value: 3, slot_type: "Woeful" },
      { item: "Epic Spectacles", stat: "Constitution", bonus_type: "Insight", value: 4, slot_type: "Melancholic" },
    ],
  };
  const maps = P.buildCraftMaps(build);
  const order = maps.vikByItem.get("Epic Spectacles").map((n) => n.slot_type);
  assert.deepStrictEqual(order, ["Melancholic", "Woeful"], "Melancholic renders before Woeful, matching in-game order");
});

test("U9: the sorted order matches the registry's declared slot_types order across all four types", () => {
  const declared = Craft.get("viktranium").slot_types;
  assert.deepStrictEqual(declared, ["Melancholic", "Dolorous", "Miserable", "Woeful"], "registry order is the in-game order");
  // Emit all four, reverse of declared order, on one host.
  const build = {
    chosen: [],
    vikPlaced: [...declared].reverse().map((slot_type, i) => (
      { item: "Cloak of Sorrow", stat: `Stat${i}`, bonus_type: "Enhancement", value: i + 1, slot_type }
    )),
  };
  const maps = P.buildCraftMaps(build);
  const order = maps.vikByItem.get("Cloak of Sorrow").map((n) => n.slot_type);
  assert.deepStrictEqual(order, declared, "sorted list matches the registry's declared order exactly");
});

test("U9: the in-game order holds through project() (the exporters' path) as well as buildCraftMaps directly", () => {
  const rec = makeRec();
  // makeRec's Epic Spectacles already carries one Melancholic craft; add a Dolorous
  // and a Woeful craft on the SAME host, emitted out of order, to prove project()'s
  // loadout[].crafting — what every exporter and results.js's craftSlotChips reads —
  // reflects the sorted order, not the emission order.
  rec.snapshot.vikPlaced.push(
    { item: "Epic Spectacles", stat: "Deception", bonus_type: "Insight", value: 2, slot_type: "Woeful" },
    { item: "Epic Spectacles", stat: "Fortification", bonus_type: "Enhancement", value: 10, slot_type: "Dolorous" },
  );
  const v = P.project(rec);
  const goggles = v.loadout.find((i) => i.item === "Epic Spectacles");
  const vikLabels = goggles.crafting.filter((c) => c.family === "vik").map((c) => c.label);
  assert.deepStrictEqual(vikLabels, [
    "Slot Melancholic Viktranium augment: Resistance +3",
    "Slot Dolorous Viktranium augment: Fortification +10",
    "Slot Woeful Viktranium augment: Deception +2 Insight",
  ], "Melancholic, then Dolorous, then Woeful — in-game order, not emission order");
});

// ---- #370 — a declared Lamordia slot the solve left empty is DISCLOSED --------
//
// Chips were built from PLACEMENTS, so a slot whose pool holds no option that
// advances the ranked stats simply vanished: a 4-slot item rendered as a 3-slot
// item, which is indistinguishable from "this tool has no data for that slot".
// That is how #365 was reported ("it didn't put anything in the Woeful slot").
// A Lamordia slot is part of the item's identity, so declared == placed + empty,
// always, on every surface.

const LAM4 = ["Melancholic", "Dolorous", "Miserable", "Woeful"]
  .map((type) => ({ type, category: "Weapon" }));

test("#370: declared Lamordia slots always equal placed plus disclosed-empty", () => {
  const v = { variant_id: "Sorrowblade", lamordia_slots: LAM4 };
  const placed = [{ item: "Sorrowblade", slot_type: "Miserable", stat: "Deadly", bonus_type: "Insight", value: 4 }];
  const unfilled = P.unfilledVikSlots(v, placed);
  assert.strictEqual(placed.length + unfilled.length, LAM4.length, "no slot is dropped");
  assert.deepStrictEqual(unfilled.map((u) => u.slot_type), ["Melancholic", "Dolorous", "Woeful"],
    "the empty three are named, in the registry's in-game order");
  assert.strictEqual(unfilled[0].category, "Weapon", "the pool category rides along");
});

test("#370: the empty set is a MULTISET difference — one fill does not account for two same-type slots", () => {
  // An item declaring the same slot type twice must still show one open slot
  // after one craft lands. A plain set difference would silently show none.
  const v = { variant_id: "Twice Woeful", lamordia_slots: [
    { type: "Woeful", category: "Accessory" }, { type: "Woeful", category: "Accessory" },
  ] };
  const unfilled = P.unfilledVikSlots(v, [{ item: "Twice Woeful", slot_type: "Woeful" }]);
  assert.strictEqual(unfilled.length, 1, "one filled, one still open");
});

test("#370: an item with no Lamordia slots discloses nothing", () => {
  assert.deepStrictEqual(P.unfilledVikSlots({ variant_id: "Plain Ring" }, []), []);
  assert.deepStrictEqual(P.unfilledVikSlots({ variant_id: "Plain Ring", lamordia_slots: [] }, []), []);
});

test("#370: a fully crafted item discloses nothing (the notice is not unconditional)", () => {
  const v = { variant_id: "Sorrowblade", lamordia_slots: LAM4 };
  const placed = LAM4.map((s) => ({ item: "Sorrowblade", slot_type: s.type }));
  assert.deepStrictEqual(P.unfilledVikSlots(v, placed), []);
});

test("#370: the empty slots ride project() — every export states the item's real slot count", () => {
  const rec = makeRec();
  // makeRec's Epic Spectacles already carries a Melancholic craft; declare all
  // four slots on it so three are left open.
  rec.snapshot.chosen[0].variant.lamordia_slots = LAM4;
  const v = P.project(rec);
  const goggles = v.loadout.find((i) => i.item === "Epic Spectacles");
  const empties = goggles.crafting.filter((c) => c.family === "vikEmpty");
  assert.deepStrictEqual(empties.map((c) => c.slot_type), ["Dolorous", "Miserable", "Woeful"],
    "the three unfilled slots follow the one filled Melancholic slot");
  assert.ok(empties[0].label.includes("left empty"), "the label says the slot is empty");
  assert.ok(empties[0].label.includes("no option adds to your ranked stats"),
    "and WHY — so it reads as an open slot, not as missing data");
});

test("#370/#472: the app row states the same slots the exports do, and carries their sentence", () => {
  // #472 retired `craftSlotChips`; the app renders `craftSection` now, on both
  // the gear card. #370's guarantee is untouched: a declared
  // slot the solve left empty must still appear, or a 4-slot item reads as a
  // 3-slot item and that is indistinguishable from missing data.
  //
  // What changed is the DISPLAY wording — the row says "left empty" and carries
  // the full sentence in its title, because the clause wrapped to two lines per
  // slot at 375px. The exports' sentence is unchanged, which is why this test
  // still compares against `craftLabel`.
  const rec = makeRec();
  rec.snapshot.chosen[0].variant.lamordia_slots = LAM4;
  const maps = P.buildCraftMaps(rec.snapshot);
  const v = rec.snapshot.chosen[0].variant;
  const rows = R.craftRowsFor(v, 0, maps).filter((r) => r.family === "vikEmpty");
  assert.strictEqual(rows.length, 3, "three open slots, three rows");
  const html = R.craftSection(v, 0, maps, { keys: new Set(), byStat: new Map(), list: [] }, null, new Set());
  assert.strictEqual((html.match(/is-empty/g) || []).length, 3,
    "each rendered as an open slot, not as a craft to apply");
  // Same sentence on both surfaces — the app and the share cannot disagree about
  // how many slots an item has. Built from the ROW the app is rendering rather
  // than from a hand-written slot object: the hand-written one omitted the
  // category and so pinned a sentence neither surface produces (#484). Derived,
  // this still proves the property it is here for — that the app renders the
  // exports' label instead of inventing its own wording.
  const dolorous = rows.find((r) => r.o.slot_type === "Dolorous");
  assert.ok(dolorous, "the Dolorous slot is one of the open rows");
  const label = P.craftLabel(dolorous.o, "vikEmpty");
  assert.ok(label.includes("(Weapon)"), "…and the sentence names the slot's category");
  assert.ok(html.includes(`title="${label}"`), "the exports' full sentence rides the row");
});

// ---- #484 — two slots of one type must be tellable apart, and every slot must
// ---- appear once, in in-game order, filled or not ---------------------------
//
// Reported against Legendary Frozen Contraption, which declares THREE slots:
// Dolorous (Weapon), Melancholic (Armor), Melancholic (Weapon). One Melancholic
// filled and one empty is CORRECT, and the card made it unreadable two ways: the
// category was never rendered, so the two rows were identical; and placements
// and gaps were sorted as separate blocks, so the concatenation was not slot
// order.

const CONTRAPTION = [
  { type: "Dolorous", category: "Weapon" },
  { type: "Melancholic", category: "Armor" },
  { type: "Melancholic", category: "Weapon" },
];

test("#484: every declared slot appears once, in in-game order, filled and empty interleaved", () => {
  const v = { variant_id: "Legendary Frozen Contraption", lamordia_slots: CONTRAPTION };
  const placed = [{ item: "Legendary Frozen Contraption", slot_type: "Melancholic",
    category: "Armor", stat: "Fortification", bonus_type: "Quality", value: 160 }];
  const rows = P.vikSlotRows(v, placed);
  assert.deepStrictEqual(rows.map((r) => `${r.slot_type}/${r.category}`),
    ["Melancholic/Armor", "Melancholic/Weapon", "Dolorous/Weapon"],
    "Melancholic before Dolorous, and the two Melancholics in declaration order");
  assert.deepStrictEqual(rows.map((r) => !!r.placement), [true, false, false],
    "the filled slot sits in its own position, not ahead of the empty ones");
  assert.strictEqual(rows.length, CONTRAPTION.length, "no slot is dropped or duplicated");
});

test("#484: the placement pairs by (type, category), not by type alone", () => {
  const v = { variant_id: "Legendary Frozen Contraption", lamordia_slots: CONTRAPTION };
  // The craft went into the WEAPON Melancholic slot. Pairing on type alone would
  // hand it to the Armor slot — the first match — and tell the player to craft in
  // a slot whose option pool does not even offer it.
  const placed = [{ item: "Legendary Frozen Contraption", slot_type: "Melancholic",
    category: "Weapon", stat: "Fortification", bonus_type: "Quality", value: 160 }];
  const rows = P.vikSlotRows(v, placed);
  assert.deepStrictEqual(rows.map((r) => !!r.placement), [false, true, false],
    "the Weapon Melancholic is the one shown as filled");
});

test("#484: a placement with no category still pairs, rather than reading as a dropped craft", () => {
  // A snapshot saved before the category rode along. Degrading to the old
  // type-only behaviour is right; showing a filled slot as empty is not.
  const v = { variant_id: "Legendary Frozen Contraption", lamordia_slots: CONTRAPTION };
  const rows = P.vikSlotRows(v, [{ item: "Legendary Frozen Contraption", slot_type: "Melancholic" }]);
  assert.strictEqual(rows.filter((r) => r.placement).length, 1, "the placement is paired, not lost");
  assert.strictEqual(rows.length, CONTRAPTION.length, "and no slot is invented for it");
  // …and the row does NOT borrow the slot's category. Which of the two Melancholic
  // slots this craft went into is genuinely unknown here, so stamping one on it
  // would present a guess as a fact — and the guess is actionable, since the two
  // slots draw from different option pools.
  const filled = rows.find((r) => r.placement);
  assert.ok(!filled.placement.category, "no category is invented for a snapshot that never carried one");
  assert.ok(!P.craftLabel(filled.placement, "vik").includes("("),
    "so the exported sentence names the type alone");
});

test("#484: a placement matching no declared slot is reported, never silently dropped", () => {
  const v = { variant_id: "Odd Item", lamordia_slots: [{ type: "Woeful", category: "Accessory" }] };
  const rows = P.vikSlotRows(v, [{ item: "Odd Item", slot_type: "Miserable", category: "Accessory" }]);
  assert.strictEqual(rows.length, 2, "the declared slot AND the unmatched placement");
  assert.ok(rows.some((r) => r.slot_type === "Miserable" && r.placement),
    "the craft the solve told the player to apply still appears");
});

test("#484: the card renders one interleaved list, and the two Melancholic rows differ", () => {
  const rec = makeRec();
  rec.snapshot.chosen[0].variant.lamordia_slots = CONTRAPTION;
  // The solver stamps `category` on every placement (`vikMeta`), so this is the
  // live shape. The fixture's default placement omits it — that is the legacy
  // snapshot shape, covered by its own test above.
  rec.snapshot.vikPlaced = [{ item: "Epic Spectacles", stat: "Resistance",
    bonus_type: "Enhancement", value: 3, slot_type: "Melancholic", category: "Armor" }];
  const maps = P.buildCraftMaps(rec.snapshot);
  const v = rec.snapshot.chosen[0].variant;
  const rows = R.craftRowsFor(v, 0, maps).filter((r) => r.family === "vik" || r.family === "vikEmpty");
  assert.deepStrictEqual(rows.map((r) => `${r.o.slot_type}/${r.o.category}`),
    ["Melancholic/Armor", "Melancholic/Weapon", "Dolorous/Weapon"],
    "one list in slot order — not every placement followed by every gap");
  const html = R.craftSection(v, 0, maps, { keys: new Set(), byStat: new Map(), list: [] }, null, new Set());
  assert.ok(/· Armor/.test(html) && /· Weapon/.test(html),
    "the category is on the row, so the two Melancholic slots are not identical");
});

// ---- U6/#249: the compound-absorption quarantine, as sentences --------------
//
// ONE source for the app notice and every export, the contract
// `saturationNoticeLines` holds. Reads `absorptionQuarantine` (plain JSON on the
// result), never the pool, so a restored character discloses identically without
// re-solving.

const QUARANTINE_ABSENT = [{
  item: "Cyran Guard (level 26)", stat: "Elemental Absorption", reason: "absent",
  components: ["Acid Absorption", "Cold Absorption", "Fire Absorption",
               "Electric Absorption", "Sonic Absorption"],
}];

test("U6/#249: the notice names the item, the excluded enchantment, and the reason", () => {
  const [line] = P.absorptionQuarantineNoticeLines({ absorptionQuarantine: QUARANTINE_ABSENT });
  assert.ok(/Elemental Absorption/.test(line), "names what was excluded");
  assert.ok(/Cyran Guard \(level 26\)/.test(line), "names which item it was excluded from");
  assert.ok(/Fire Absorption/.test(line) && /Sonic Absorption/.test(line),
    "names the stats it was not credited to");
});

test("U6/#249: the two reasons read differently", () => {
  const absent = P.absorptionQuarantineNoticeLines({ absorptionQuarantine: QUARANTINE_ABSENT })[0];
  const unconfirmed = P.absorptionQuarantineNoticeLines({
    absorptionQuarantine: [{ ...QUARANTINE_ABSENT[0], reason: "unconfirmed" }],
  })[0];
  assert.notStrictEqual(absent, unconfirmed,
    "an unharvested carrier and an unconfirmed one are different facts");
  assert.ok(/wiki/i.test(absent) && /wiki/i.test(unconfirmed), "both cite the wiki record");
});

test("U6/#249: the notice asserts nothing about what the build would have scored", () => {
  const line = P.absorptionQuarantineNoticeLines({ absorptionQuarantine: QUARANTINE_ABSENT })[0];
  // docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md —
  // stating what a credit-free build "would" have reached is a claim about a
  // solve that was never run.
  for (const forbidden of [/would have/i, /could have/i, /higher/i, /better/i,
                           /instead of/i, /missing out/i, /\bloss\b/i]) {
    assert.ok(!forbidden.test(line), `speculates: ${forbidden} in ${line}`);
  }
});

test("U6/#249: silent when nothing was quarantined", () => {
  assert.deepStrictEqual(P.absorptionQuarantineNoticeLines({ absorptionQuarantine: [] }), []);
  assert.deepStrictEqual(P.absorptionQuarantineNoticeLines({}), []);
  assert.deepStrictEqual(P.absorptionQuarantineNoticeLines(null), []);
});

test("U6/#249: the disclosure rides on the shared content model", () => {
  const rec = makeRec();
  rec.snapshot.absorptionQuarantine = QUARANTINE_ABSENT;
  const view = P.project(rec);
  assert.strictEqual(view.character.absorptionQuarantineNotice.length, 1,
    "every export reads it from here, so a renderer cannot invent a second wording");
});


// ---- U8 (R8, R9, R10) — collapse expanded affixes on item-centric surfaces ----
//
// One enchantment expands into several concrete affixes so the solver can match a
// ranked stat. The player must read the name engraved on the item, not the model's
// shape: a Woeful Viktranium craft reported "+2 Enchantment" on one item and "+2
// Necromancy" on the off-hand, which is the same craft described by whichever
// school happened to be ranked. Every expansion member carries `via` (the key
// `src/spell_focus.py` exposes as PROVENANCE_KEY); these pin the collapse.

// A typed universal spell-focus enchantment: seven schools, one magnitude.
function focusMastery(label, type, value) {
  return ["Abjuration", "Conjuration", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"]
    .map((s) => ({ name: `${s} Focus`, type, value, via: label }));
}
// A heterogeneous family: Armor Class at one magnitude, three saves at another.
const PARRYING = [
  { name: "Armor Class", type: "Insight", value: 5, via: "Parrying" },
  { name: "Fortitude Save", type: "Insight", value: 2, via: "Parrying" },
  { name: "Reflex Save", type: "Insight", value: 2, via: "Parrying" },
  { name: "Will Save", type: "Insight", value: 2, via: "Parrying" },
];

test("U8/R8: a uniform expansion collapses to ONE entry naming the enchantment", () => {
  const out = P.collapseExpansions(focusMastery("Sacred Spell Focus Mastery", "Sacred", 3));
  assert.strictEqual(out.length, 1, "seven school affixes render as one line, not seven");
  assert.strictEqual(P.affixLabel(out[0]), "Sacred Spell Focus Mastery +3",
    "names the enchantment engraved on the item, carrying the shared magnitude");
});

test("U8/R8: a collapsed typed enchantment does NOT repeat its bonus type as a suffix", () => {
  // affixLabel appends a non-Enhancement bonus type. Emitting the collapsed entry
  // with `type: "Sacred"` would render "Sacred Spell Focus Mastery +3 Sacred".
  const line = P.affixLabel(P.collapseExpansions(focusMastery("Sacred Spell Focus Mastery", "Sacred", 3))[0]);
  assert.ok(!/Sacred.*Sacred/.test(line), `bonus type named twice: ${line}`);
  assert.strictEqual(line, "Sacred Spell Focus Mastery +3");
});

// ---- #252 — the SET-centric surfaces collapse too ----
//
// R8 scoped the #250 collapse to item-centric surfaces, so a set engraved with one
// enchantment still rendered as its expanded parts everywhere a SET was read: the Set
// Bonuses panel, the alternatives cards, and every export. `Forbidden Knowledge` grants
// `Profane Well Rounded +1` and printed six ability lines for it.

// A set tier in the shape the dataset actually stores: legacy `{stat,bonus_type}` keys,
// six umbrella members under one `via`, plus two native affixes with none.
const WELL_ROUNDED_TIER = [
  ...["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]
    .map((s) => ({ stat: s, bonus_type: "Profane", value: 1, via: "Profane Well Rounded" })),
  { stat: "Accuracy", bonus_type: "Profane", value: 1 },
  { stat: "Deadly", bonus_type: "Profane", value: 1 },
];

function wellRoundedBuild() {
  const v = { variant_id: "A", set_bonus: [{ set: "FK" }],
    parsed_set_bonuses: [{ set: "FK", pieces_required: 1, affixes: WELL_ROUNDED_TIER }] };
  return { chosen: [{ slot: "Ring 1", variant: v }], jokerPlaced: [], membershipPlaced: [],
    setAugmentsPlaced: [], setsActive: [] };
}

test("#252: satisfiedSetDetail names the engraved enchantment, not its expansion", () => {
  const d = P.satisfiedSetDetail(wellRoundedBuild()).find((x) => x.set === "FK");
  assert.strictEqual(d.affixes.length, 3,
    "eight stored affixes read as three lines: the enchantment plus the two native grants");
  assert.deepStrictEqual(d.affixes.map(P.affixLabel),
    ["Profane Well Rounded +1", "Accuracy +1 Profane", "Deadly +1 Profane"]);
});

test("#252: a native set affix passes through BY IDENTITY, untouched", () => {
  // The collapse must not rewrite an affix that was never expanded — an effect
  // already engraved under its own name is its own line.
  const d = P.satisfiedSetDetail(wellRoundedBuild()).find((x) => x.set === "FK");
  assert.strictEqual(d.affixes[1], WELL_ROUNDED_TIER[6], "same object, not a copy");
  assert.strictEqual(d.affixes[2], WELL_ROUNDED_TIER[7]);
});

test("#252: activeSetDetail collapses on the alternatives path too", () => {
  // altGainSection reads this one. An alternative that offers a set was listing the
  // same six ability lines as its reason to switch.
  const out = P.activeSetDetail({ chosen: [], setsActive: [
    { set: "FK", pieces_required: 4, affixes: WELL_ROUNDED_TIER }] });
  assert.deepStrictEqual(out[0].affixes.map(P.affixLabel),
    ["Profane Well Rounded +1", "Accuracy +1 Profane", "Deadly +1 Profane"]);
});

test("#252: a heterogeneous set grant lists its members rather than inventing a number", () => {
  // The `parts` shape has to survive the set surface as it does the item one: a
  // Parrying-style grant has no single magnitude and must never be reduced to one.
  const tier = PARRYING.map((a) => ({ stat: a.name, bonus_type: a.type, value: a.value, via: a.via }));
  const build = { chosen: [{ slot: "Ring 1", variant: { variant_id: "A", set_bonus: [{ set: "P" }],
      parsed_set_bonuses: [{ set: "P", pieces_required: 1, affixes: tier }] } }],
    jokerPlaced: [], membershipPlaced: [], setAugmentsPlaced: [], setsActive: [] };
  const d = P.satisfiedSetDetail(build).find((x) => x.set === "P");
  assert.strictEqual(d.affixes.length, 1);
  const line = P.affixLabel(d.affixes[0]);
  assert.ok(line.startsWith("Parrying: "), `names the enchantment: ${line}`);
  assert.ok(/Armor Class \+5/.test(line) && /Fortitude Save \+2/.test(line),
    `and lists the members it could not reduce: ${line}`);
});

test("#252: the projected content model carries the collapsed form, so no export can disagree", () => {
  // The solve-visible-but-share-invisible invariant, in its other direction: the app
  // and a shared build must not describe one set two ways.
  const rec = { snapshot: wellRoundedBuild(), inputs: {} };
  const view = P.project(rec);
  const fk = (view.sets || []).find((s) => s.set === "FK");
  assert.ok(fk, "the set reaches the content model");
  assert.deepStrictEqual(fk.affixes.map(P.affixLabel),
    ["Profane Well Rounded +1", "Accuracy +1 Profane", "Deadly +1 Profane"]);
});

test("#252: classification must read the RAW tier, never the collapsed output", () => {
  // The boundary R11 draws, restated for the set surface, and the trap a future
  // reader is most likely to walk into — adding stat chips to the Set Bonuses panel
  // by classifying the list `satisfiedSetDetail` now hands back.
  //
  // A collapsed entry's `stat` is an ENCHANTMENT name. #453 records what happens if
  // you match that against ranked targets: every collapsed bundle files as incidental,
  // "including one carrying the player's rank-1 stat, silently, on a card that looks
  // fine". Both halves are pinned so the difference is impossible to miss.
  const raw = P.affixStatCoverage(WELL_ROUNDED_TIER);
  assert.deepStrictEqual(raw.get("Profane Well Rounded").stats.slice().sort(),
    ["Charisma", "Constitution", "Dexterity", "Intelligence", "Strength", "Wisdom"],
    "on the raw tier the six abilities underneath are reachable");

  const d = P.satisfiedSetDetail(wellRoundedBuild()).find((x) => x.set === "FK");
  assert.deepStrictEqual(P.affixStatCoverage(d.affixes).get("Profane Well Rounded").stats,
    ["Profane Well Rounded"],
    "on the collapsed output they are NOT — which is why no set surface classifies it");
});

// This change is safe because all four consumers of these two producers only ever
// label-and-join: the Set Bonuses panel, altGainSection, `project()`'s content model,
// and exporters' setBonusDetail. None classifies, none does arithmetic. A consumer that
// needs to classify must reach for the raw `parsed_set_bonuses` tier and
// `affixStatCoverage`, per the test above.

test("U8/R8: a heterogeneous family lists its member values, inventing no single number", () => {
  const out = P.collapseExpansions(PARRYING);
  assert.strictEqual(out.length, 1, "still one line");
  const line = P.affixLabel(out[0]);
  assert.strictEqual(line,
    "Parrying: Armor Class +5 Insight, Fortitude Save +2 Insight, Reflex Save +2 Insight, Will Save +2 Insight");
  assert.ok(!/Parrying \+/.test(line), "never asserts a single magnitude the data does not have");
});

test("U8/R8: a native school-specific affix (no provenance) is untouched", () => {
  const native = [{ name: "Necromancy Focus", type: "Equipment", value: 13 }];
  const out = P.collapseExpansions(native);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0], native[0], "passed through by identity — not rebuilt");
  assert.strictEqual(P.affixLabel(out[0]), "Necromancy Focus +13 Equipment");
});

test("U8/R8: a partially-relevant expansion still collapses to one line, beside its native neighbours", () => {
  const affixes = [
    { name: "Constitution", type: "Insightful", value: 7 },
    ...focusMastery("Quality Spell Focus Mastery", "Quality", 2),
    { name: "PRR", value: 15 },
  ];
  const out = P.collapseExpansions(affixes);
  assert.deepStrictEqual(out.map(P.affixLabel), [
    "Constitution +7 Insightful",
    "Quality Spell Focus Mastery +2",
    "PRR +15",
  ], "the group collapses in place; unrelated affixes keep their order and text");
});

test("U8/R8: two different expansions on one item stay two distinct lines", () => {
  const out = P.collapseExpansions([
    ...focusMastery("Quality Spell Focus Mastery", "Quality", 2),
    ...focusMastery("Insightful Spell Focus Mastery", "Insight", 1),
  ]);
  assert.deepStrictEqual(out.map(P.affixLabel),
    ["Quality Spell Focus Mastery +2", "Insightful Spell Focus Mastery +1"],
    "grouped by originating enchantment, not merged into one");
});

test("U8/R10: project()'s loadout affixes are collapsed, so no export can show the expanded shape", () => {
  const rec = makeRec();
  rec.snapshot.chosen[0].variant.affixes = [
    { name: "Deadly", type: "Insightful", value: 9 },
    ...focusMastery("Sacred Spell Focus Mastery", "Sacred", 3),
  ];
  const view = P.project(rec);
  const goggles = view.loadout.find((i) => i.item === "Epic Spectacles");
  assert.deepStrictEqual(goggles.affixes.map(P.affixLabel),
    ["Deadly +9 Insightful", "Sacred Spell Focus Mastery +3"],
    "the shared content model — the single source the exports read — is already collapsed");
});

test("U8/R9/AE5: a Viktranium craft of a universal option reads as the enchantment, not one school", () => {
  // The reported symptom: the same craft described itself by whichever school was
  // ranked, so one item said "+2 Enchantment" and the off-hand said "+2 Necromancy".
  const opt = {
    slot_type: "Woeful", item: "Cloak of Sorrow", name: "Woeful Invigorator (legendary)",
    affixes: focusMastery("Profane Spell Focus Mastery", "Profane", 2)
      .map((a) => ({ stat: a.name, bonus_type: a.type, value: a.value, unit: "flat", via: a.via })),
    // vikMeta's legacy flat fields name the leading ON-TARGET affix — the very
    // fields that made the label differ per item.
    stat: "Enchantment Focus", bonus_type: "Profane", value: 2, unit: "flat",
  };
  assert.strictEqual(P.craftLabel(opt, "vik"),
    "Slot Woeful Viktranium augment: Profane Spell Focus Mastery +2");
});

test("U8/R9: a single-affix Viktranium craft is unchanged", () => {
  const opt = { slot_type: "Melancholic", stat: "Resistance", bonus_type: "Enhancement", value: 3, unit: "flat" };
  assert.strictEqual(P.craftLabel(opt, "vik"), "Slot Melancholic Viktranium augment: Resistance +3");
});

test("U8/R9: a Dino insert whose affixes come from one expansion collapses the same way", () => {
  const ins = {
    dino_type: "Primal", name: "Ancient Insight",
    affixes: focusMastery("Quality Spell Focus Mastery", "Quality", 2)
      .map((a) => ({ stat: a.name, bonus_type: a.type, value: a.value, unit: "flat", via: a.via })),
  };
  assert.strictEqual(P.craftLabel(ins, "dino"),
    "Primal: Ancient Insight, Quality Spell Focus Mastery +2");
});

test("U8/R9: a multi-affix craft with no provenance still lists each affix", () => {
  const ins = {
    dino_type: "Primal", name: "Mixed",
    affixes: [
      { stat: "Constitution", bonus_type: "Quality", value: 3, unit: "flat" },
      { stat: "Dodge", bonus_type: "Quality", value: 2, unit: "pct" },
    ],
  };
  assert.strictEqual(P.craftLabel(ins, "dino"),
    "Primal: Mixed, Constitution +3 Quality, Dodge +2% Quality");
});


// ---------------------------------------------------------------------------
// #614 — the unmodelled-penalty disclosure. The solver discards every negative
// affix at twelve `value > 0` gates, so an item is scored on its upside alone.
// Until the LP can subtract them (blocked on a wiki ruling on penalty stacking),
// the honest move is to say so where the player reads the number.

test("#614: itemPenalties finds signed Penalty affixes, worst first, sign coerced", () => {
  const v = { affixes: [
    { name: "Intelligence", type: "Enhancement", value: "11" },
    { name: "Constitution", type: "Penalty", value: "-2" },
    { name: "Fortification", type: "Penalty", value: "-25" }] };
  assert.deepStrictEqual(P.itemPenalties(v), [
    { stat: "Fortification", value: -25 },
    { stat: "Constitution", value: -2 },
  ], "worst first, and the catalog's STRING values are coerced to numbers");
  assert.deepStrictEqual(P.itemPenalties({ affixes: [{ name: "Strength", type: "Enhancement", value: "5" }] }), []);
  assert.deepStrictEqual(P.itemPenalties(null), [], "a missing variant carries none");
});

test("#614: a penalty on a RANKED stat says the displayed total is optimistic", () => {
  const v = { affixes: [{ name: "Fortification", type: "Penalty", value: "-25" }] };
  const t = P.penaltyDisclosure(v, ["Fortification", "Strength"]);
  assert.ok(t.includes("-25 Fortification"), "the magnitude is named, not just the stat");
  assert.ok(t.includes(P.PENALTY_NOT_COUNTED_WORDING), "the one shared wording");
  assert.ok(/is ranked, so its total above is optimistic/.test(t),
    "the player is told which displayed number is wrong-high");
});

test("#614: a penalty on an UNRANKED stat claims no number is wrong", () => {
  const v = { affixes: [{ name: "Fortification", type: "Penalty", value: "-25" }] };
  const t = P.penaltyDisclosure(v, ["Strength"]);
  assert.ok(t.includes("-25 Fortification"), "still disclosed — it is a real drawback");
  assert.ok(/no total above is affected/.test(t),
    "and NOT claimed to corrupt a total, which would overstate");
  assert.ok(!/optimistic/.test(t));
});

test("#614: several ranked penalties are named together, in plural", () => {
  const v = { affixes: [
    { name: "Fortification", type: "Penalty", value: "-25" },
    { name: "Constitution", type: "Penalty", value: "-2" }] };
  const t = P.penaltyDisclosure(v, ["Fortification", "Constitution"]);
  assert.ok(/Fortification and Constitution are ranked/.test(t));
  assert.ok(/those totals above are optimistic/.test(t));
});

test("#614: an item with no penalty produces no sentence at all", () => {
  assert.strictEqual(P.penaltyDisclosure({ affixes: [{ name: "Strength", type: "Enhancement", value: "5" }] }, ["Strength"]), "",
    "only-when-set: no surface can render a note the data lacks");
  assert.strictEqual(P.penaltyDisclosure(null, ["Strength"]), "");
});

test("#614: the wording is defined ONCE, so no surface can respell it", () => {
  const R_SRC = fs.readFileSync(path.join(__dirname, "..", "web", "results.js"), "utf8");
  assert.ok(/Proj\.penaltyDisclosure\(/.test(R_SRC),
    "the card reads the sentence from projection rather than building its own");
  assert.ok(!/not subtracted by the solver/.test(R_SRC),
    "the phrase itself appears only in projection.js");
});

if (!process.exitCode) console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #245 — the craft-carried disclosure. An item whose every ranked contribution
// is a craftable option must say so; an item with any native or set win must not.

function carriedResult() {
  return {
    effective: { Charisma: 12 }, perTarget: { Charisma: 12 },
    chosen: [
      { slot: "Weapon", variant: { variant_id: "Calamitous Sword", set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Ring", variant: { variant_id: "Cha Ring", set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Boots", variant: { variant_id: "Filler Boots", set_bonus: [], parsed_set_bonuses: [] } },
    ],
    augmentsPlaced: [], setsActive: [],
    breakdown: {
      Charisma: [
        { bonus_type: "Enhancement", value: 11, source: "Cha Ring", sourceKind: "worn", slot: "Ring", hostIds: ["Cha Ring"] },
        { bonus_type: "Insight", value: 1, source: "Slot Melancholic Viktranium augment", sourceKind: "vik", slot: "Weapon", hostIds: ["Calamitous Sword"] },
      ],
    },
  };
}

test("#245: an item whose only ranked contribution is a craft is craft-carried", () => {
  const parts = P.craftCarried(carriedResult(), { slot: "Weapon", variant_id: "Calamitous Sword" });
  assert.ok(parts && parts.length === 1);
  assert.deepStrictEqual(parts[0], { stat: "Charisma", value: 1, family: "Viktranium" });
});

test("#245: a native win means NOT craft-carried, even beside a craft", () => {
  const res = carriedResult();
  // give the sword a native contribution too
  res.breakdown.Charisma.push({ bonus_type: "Quality", value: 2, source: "Calamitous Sword",
    sourceKind: "worn", slot: "Weapon", hostIds: ["Calamitous Sword"] });
  assert.strictEqual(P.craftCarried(res, { slot: "Weapon", variant_id: "Calamitous Sword" }), null);
});

test("#245: a set-completing item is not craft-carried, and a filler is null", () => {
  const res = carriedResult();
  res.breakdown.Charisma.push({ bonus_type: "Set", value: 3, source: "Alpha", sourceKind: "set",
    setYieldingSlots: ["Weapon"], hostIds: ["Calamitous Sword"] });
  assert.strictEqual(P.craftCarried(res, { slot: "Weapon", variant_id: "Calamitous Sword" }), null,
    "set contribution suppresses the badge");
  assert.strictEqual(P.craftCarried(carriedResult(), { slot: "Boots", variant_id: "Filler Boots" }), null,
    "a filler pick has no craft story");
});

test("#346: project() carries craftCarried on the loadout and the ladder notice", () => {
  const rec = makeRec();
  rec.snapshot.query = { craftingRung: "no-niche-crafting" };
  const view = P.project(rec);
  assert.ok(view.loadout.every((it) => "craftCarried" in it),
    "every loadout entry carries the field (null when not carried)");
  assert.ok(/Niche crafting was excluded/.test(view.character.craftingExcludedNotice),
    "the scope disclosure rides the shared content model");
  assert.ok(!/Regular augments/.test(view.character.craftingExcludedNotice),
    "the old carve-out sentence is gone — the ladder now owns augments");
});

// #346 (U4) — ONE notice covers the whole ladder, with a distinct sentence per
// rung. A second notice appearing beside this one is the failure mode the merge
// exists to prevent.
test("#346: each rung produces its own single notice sentence", () => {
  const rec = makeRec();
  const noticeAt = (rung) => {
    rec.snapshot.query = { craftingRung: rung };
    return P.project(rec).character.craftingExcludedNotice;
  };
  assert.match(noticeAt("no-niche-crafting"), /Niche crafting was excluded/);
  assert.match(noticeAt("no-solar-lunar"), /Solar\/Lunar Gems were excluded/);
  assert.match(noticeAt("no-solar-lunar"), /colour augments were still considered/);
  assert.match(noticeAt("printed-only"), /nothing beyond what is printed/);
  assert.ok(!/Solar/.test(noticeAt("printed-only")),
    "the bottom rung does not enumerate what a higher rung would have excluded");
});

// #346 (U4, R9) — the top rung speaks too: the notice is the discovery path for
// the control, so a player who never opens the section still learns the ladder
// exists. It reports what the SOLVE placed, not what the query asked for.
test("#346: the top rung names what the loadout leans on, or stays silent", () => {
  const rec = makeRec();
  rec.snapshot.query = { craftingRung: "everything" };

  // Silence requires nothing to give up AT ALL — no augments and no crafted
  // options. The base fixture carries a craft, which the notice now counts.
  rec.snapshot.augmentsPlaced = [];
  const craftKeys = ["vikPlaced", "sealPlaced", "ncPlaced", "dinoPlaced", "tfPlaced",
    "gsPlaced", "membershipPlaced", "setAugmentsPlaced"];
  const stashed = {};
  for (const k of craftKeys) { stashed[k] = rec.snapshot[k]; rec.snapshot[k] = []; }
  assert.strictEqual(P.project(rec).character.craftingExcludedNotice, null,
    "nothing placed at all: nothing to give up, so no advice");
  for (const k of craftKeys) rec.snapshot[k] = stashed[k];
  for (const k of craftKeys) rec.snapshot[k] = [];

  rec.snapshot.augmentsPlaced = [{ variant_id: "Solar Gem of X", color: "Sun" },
    { variant_id: "Lunar Gem of Y", color: "Moon" },
    { variant_id: "Sapphire of Z", color: "Blue" }];
  const leaning = P.project(rec).character.craftingExcludedNotice;
  assert.match(leaning, /leans on 2 Solar\/Lunar Gems/, "the farm-gated family is named and counted");
  assert.match(leaning, /1 other augment/, "the rest are counted without being named");
  assert.match(leaning, /lower "What may the solver assume/, "and it points at the control");

  rec.snapshot.augmentsPlaced = [{ variant_id: "Sapphire of Z", color: "Blue" }];
  const plain = P.project(rec).character.craftingExcludedNotice;
  assert.match(plain, /uses 1 augment/, "no gems: a plain count, no Solar/Lunar claim");
  assert.ok(!/Solar/.test(plain));
});

// #346 (U4) — a snapshot saved before the ladder still discloses correctly
// without re-solving, which is the restore contract the whole notice family
// keeps. The legacy boolean speaks only when no rung is stored.
test("#346: a pre-ladder snapshot falls back to the legacy boolean", () => {
  const rec = makeRec();
  rec.snapshot.query = { excludeCraftingSystems: true };
  assert.match(P.project(rec).character.craftingExcludedNotice, /Niche crafting was excluded/,
    "an old save discloses without re-solving");
  rec.snapshot.query = { craftingRung: "printed-only", excludeCraftingSystems: true };
  assert.match(P.project(rec).character.craftingExcludedNotice, /nothing beyond what is printed/,
    "a stored rung beside a stale boolean wins");
});

test("#339: project() carries the augment-ceiling disclosure from the solved query", () => {
  const rec = makeRec();
  // serializeCharacter stores the solved query as a SIBLING of snapshot, never inside it.
  rec.query = { augCeiling: 32 };
  const view = P.project(rec);
  assert.ok(/ML 32 and below/.test(view.character.augCeilingNotice),
    "the ceiling scope disclosure rides the shared content model");
  delete rec.query;
  assert.strictEqual(P.project(rec).character.augCeilingNotice, null,
    "silent when the solve was unrestricted");
});

test("#339: augCeilingLine reads the SOLVED query only, never a live input", () => {
  assert.strictEqual(
    P.augCeilingLine({ snapshot: { query: {} }, inputs: { augCeiling: 32, ml: 36 } }), null,
    "a restored pre-ceiling snapshot stays silent even when a ceiling input exists");
  assert.strictEqual(
    P.augCeilingLine({ snapshot: {}, inputs: { augCeiling: 32, ml: 36 } }), null,
    "no rec.query and no snap.query means unrestricted — inputs never speak");
  assert.ok(/ML 32/.test(P.augCeilingLine({ query: { augCeiling: 32 }, snapshot: {} })),
    "the saved-record shape (query as a sibling of snapshot) renders");
  assert.ok(/ML 30/.test(P.augCeilingLine({ snapshot: { query: { augCeiling: 30 } } })),
    "the legacy/synthetic snap.query shape still renders as a fallback");
});

// ---------------------------------------------------------------------------
// #110 U7 — the blocklist disclosure sentences: attribution, never counterfactual.

test("U7/#110: blockNoticeLines names the exclusions and qualifies optimality", () => {
  const res = { blockReport: [
    { id: "Gem A", name: "Gem A", pool: "Moon-augment", bestAvailable: false },
    { id: "Ring B", name: "Ring B", pool: "Ring", bestAvailable: true },
  ] };
  const lines = P.blockNoticeLines(res);
  assert.ok(/excluded 2 candidates/.test(lines[0]) && /Gem A, Ring B/.test(lines[0]));
  assert.ok(/optimal given those exclusions/.test(lines[0]), "the claim is qualified");
  assert.strictEqual(lines.length, 2, "only the dominating block earns a second sentence");
  assert.ok(/Ring B out-valued every remaining Ring candidate/.test(lines[1]),
    "the superlative is asserted only where the comparator proved it");
  const all = lines.join(" ");
  assert.ok(!/would have/.test(all) && !/would be/.test(all), "never a counterfactual");
});

test("U7/#110: a block that changed nothing produces no notice at all", () => {
  assert.deepStrictEqual(P.blockNoticeLines({ blockReport: [] }), []);
  assert.deepStrictEqual(P.blockNoticeLines({}), []);
});

test("U7/U9/#110: project() carries the block notice on the shared content model", () => {
  const rec = makeRec();
  rec.snapshot.blockReport = [{ id: "X", name: "X", pool: "Ring", bestAvailable: false }];
  const view = P.project(rec);
  assert.ok(view.character.blockNotice.length === 1 && /X/.test(view.character.blockNotice[0]));
  delete rec.snapshot.blockReport;
  assert.deepStrictEqual(P.project(rec).character.blockNotice, []);
});

test("U8/#110: a block-emptied slot reads differently from an ordinary empty one", () => {
  const both = P.emptySlotNoticeLines({ emptySlots: { count: 1, slots: ["Trinket"], blockedSlots: ["Necklace"] } });
  assert.strictEqual(both.length, 2);
  assert.ok(/Trinket/.test(both[0]) && /nothing available/.test(both[0]), "the ordinary wording is unchanged");
  assert.ok(/Necklace/.test(both[1]) && /your blocklist removed every eligible candidate/.test(both[1]));
  const legacy = P.emptySlotNoticeLines({ emptySlots: { count: 1, slots: ["Trinket"] } });
  assert.strictEqual(legacy.length, 1, "a pre-#110 snapshot (no blockedSlots key) still renders");
});

// ---- Gear-box priority summaries (plan 2026-08-12-001, U1) ------------------
// Per-item ranked contributions with bonus types, the saturated-stat set, and
// the per-stat sentence accessor the tooltips reuse.

function contribResult() {
  return {
    status: "optimal",
    chosen: [
      { slot: "Ring", variant: { variant_id: "R1", set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Ring", variant: { variant_id: "R2", set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Necklace", variant: { variant_id: "N", set_bonus: [], parsed_set_bonuses: [] } },
    ],
    augmentsPlaced: [], setsActive: [], setAugmentsPlaced: [], membershipPlaced: [],
    breakdown: {
      Intelligence: [
        { bonus_type: "Insight", value: 22, source: "R1", sourceKind: "worn", slot: "Ring", hostIds: ["R1"] },
        { bonus_type: "Enhancement", value: 8, source: "Topaz of Power", sourceKind: "augment", hostIds: ["R1"] },
        { bonus_type: "Quality", value: 0, source: "R1", sourceKind: "worn", slot: "Ring", hostIds: ["R1"] },
      ],
      Doublestrike: [
        { bonus_type: "Enhancement", value: 5, source: "R1", sourceKind: "worn", slot: "Ring", hostIds: ["R1"] },
        { bonus_type: "Profane", value: 4, source: "Alpha", sourceKind: "set", setYieldingSlots: ["Ring", "Necklace"], hostIds: ["R1", "N"] },
      ],
      "Ghost Touch": [
        { bonus_type: "boolean", value: 1, source: "N", sourceKind: "worn", slot: "Necklace", hostIds: ["N"] },
      ],
    },
    saturationReport: [
      { stat: "Intelligence", total: 37, bonusTypes: ["Insight", "Enhancement"], unusedSources: 3 }],
  };
}
const contribTargets = ["Doublestrike", "Intelligence", "Ghost Touch"];

test("U1: itemContributions keeps bonus types and ranked-target order", () => {
  const c = P.itemContributions(contribResult(), { slot: "Ring", variant_id: "R1" }, null, contribTargets);
  assert.deepStrictEqual(c.map((e) => [e.stat, e.value, e.bonus_type]), [
    ["Doublestrike", 5, "Enhancement"],
    ["Doublestrike", 4, "Profane"],
    ["Intelligence", 22, "Insight"],
    ["Intelligence", 8, "Enhancement"],
  ], "ranked order first (Doublestrike outranks the bigger Intelligence values), value-descending within a stat");
  assert.strictEqual(c[1].viaSet, true, "the set contribution is marked");
});

test("U1: same-stat contributions stay separate entries — merging would erase the bonus-type fact", () => {
  const c = P.itemContributions(contribResult(), { slot: "Ring", variant_id: "R1" }, null, ["Intelligence"]);
  assert.strictEqual(c.length, 2, "worn Insight and augment Enhancement both listed");
  assert.notStrictEqual(c[0].bonus_type, c[1].bonus_type);
});

test("U1: a zero-value contribution is dropped unless boolean", () => {
  const c = P.itemContributions(contribResult(), { slot: "Ring", variant_id: "R1" }, null, ["Intelligence"]);
  assert.ok(!c.some((e) => e.value === 0), "the Quality 0 row never renders");
  const g = P.itemContributions(contribResult(), { slot: "Necklace", variant_id: "N" }, null, ["Ghost Touch"]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].boolean, true, "a presence affix survives as a feature tick");
});

test("U1: contributions match by host variant_id — the other ring gets nothing (rings gotcha)", () => {
  const c = P.itemContributions(contribResult(), { slot: "Ring", variant_id: "R2" }, null, contribTargets);
  assert.deepStrictEqual(c, [], "R2 is not cross-attributed the set or worn wins");
});

test("U1: saturatedStats is the report's stat set, empty on a bare result", () => {
  const s = P.saturatedStats(contribResult());
  assert.ok(s.has("Intelligence") && s.size === 1);
  assert.strictEqual(P.saturatedStats({}).size, 0, "a pre-#239 snapshot renders neutral, not broken");
});

test("U1: saturationLineFor returns the exact shared sentence, keyed by stat not index", () => {
  const r = contribResult();
  assert.strictEqual(P.saturationLineFor(r, "Intelligence"), P.saturationNoticeLines(r)[0],
    "one wording — the tooltip reuses the export sentence verbatim");
  assert.strictEqual(P.saturationLineFor(r, "Doublestrike"), null, "no sentence for an unsaturated stat");
});

test("U1: the new helpers ride the results.js re-export surface (KTD2 parity)", () => {
  for (const fn of ["itemContributions", "saturatedStats", "saturationLineFor"]) {
    assert.strictEqual(typeof R[fn], "function", `results.js re-exports ${fn}`);
  }
});

// ---------------------------------------------------------------------------
// #262 U3 — the no-drop-source disclosure. ONE wording constant, carried on the
// shared content model only-when-set (the dataset's only-when-set precedent):
// an unverified item carries no key at all, so no surface can render a note the
// wiki evidence lacks.

test("#262: the shared wording constant is exactly the disclosable claim", () => {
  assert.strictEqual(P.NO_DROP_SOURCE_WORDING, "no known live drop source");
});

test("#262: project() carries noDropSource on a flagged entry, and ONLY there", () => {
  const rec = makeRec();
  rec.snapshot.chosen[0].variant.no_drop_source = true;   // flag the Goggles
  const view = P.project(rec);
  const goggles = view.loadout.find((i) => i.slot === "Goggles");
  // The literal, not the constant: comparing against P.NO_DROP_SOURCE_WORDING
  // passed vacuously against the pre-change tree (undefined === undefined).
  assert.strictEqual(goggles.noDropSource, "no known live drop source",
    "a flagged variant's entry carries the one shared wording");
  const ringEntry = view.loadout.find((i) => i.slot === "Ring");
  assert.ok(!("noDropSource" in ringEntry),
    "an unflagged variant's entry carries NO field at all (absence is the signal)");
});

// ---------------------------------------------------------------------------
// U3 (#290/#291) — cross-added credit flows through projection.
//
// U2 stamps every cross-added breakdown part with `crossAdd: "<source stat>"`
// (a Universal Spell Power contribution appearing under a Combustion target;
// lore targets credit "Spell Lore" / "Universal Spell Lore"). Own parts carry
// null/absent. Mirrors `via` (#205): provenance projection must forward, or the
// credit is solve-visible but share-invisible.
function crossAddRec() {
  return {
    name: "Pyro",
    inputs: { ml: 34, pool: "all", priorities: ["Combustion"] },
    snapshot: {
      status: "optimal",
      chosen: [
        { slot: "Ring", variant: { variant_id: "Ember Band", ml: 34,
          affixes: [{ name: "Combustion", type: "Equipment", value: 100 }] } },
        { slot: "Necklace", variant: { variant_id: "Universal Torc", ml: 34,
          affixes: [{ name: "Universal Spell Power", type: "Implement", value: 50 }] } },
      ],
      effective: { Combustion: 150 },
      breakdown: {
        Combustion: [
          { bonus_type: "Equipment", value: 100, source: "Ember Band", sourceKind: "worn",
            slot: "Ring", hostIds: ["Ember Band"], via: null, crossAdd: null },
          { bonus_type: "Implement", value: 50, source: "Universal Torc", sourceKind: "worn",
            slot: "Necklace", hostIds: ["Universal Torc"], via: null,
            crossAdd: "Universal Spell Power" },
        ],
      },
      augmentsPlaced: [], setAugmentsPlaced: [], setsActive: [],
    },
  };
}

test("U3: attributionByTarget forwards crossAdd beside via (own parts stay null)", () => {
  const attr = P.attributionByTarget(crossAddRec().snapshot);
  const rows = attr.Combustion;
  assert.strictEqual(rows.length, 2);
  const own = rows.find((r) => r.bonus_type === "Equipment");
  assert.strictEqual(own.crossAdd, null, "the target's own part carries no marker");
  const xa = rows.find((r) => r.bonus_type === "Implement");
  assert.strictEqual(xa.crossAdd, "Universal Spell Power",
    "the cross-added part names its SOURCE stat, exactly as via names an enchantment");
  assert.strictEqual(xa.via, null, "crossAdd is its own field, not folded into via");
});

test("U3: itemContributions carries crossAdd so the per-item why-this can label it", () => {
  const snap = crossAddRec().snapshot;
  const c = P.itemContributions(snap, { slot: "Necklace", variant_id: "Universal Torc" }, null, ["Combustion"]);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].crossAdd, "Universal Spell Power");
  const own = P.itemContributions(snap, { slot: "Ring", variant_id: "Ember Band" }, null, ["Combustion"]);
  assert.strictEqual(own[0].crossAdd, null, "an own contribution carries null, not undefined-drift");
});

test("U3: whyThis counts the cross-added part toward the carrying item", () => {
  const snap = crossAddRec().snapshot;
  const wins = P.whyThis(snap, { slot: "Necklace", variant_id: "Universal Torc" });
  assert.deepStrictEqual(wins, [{ stat: "Combustion", value: 50, viaSet: false, boolean: false }]);
});

test("U3: project() attribution sources carry the raw crossAdd field (portable JSON inherits it)", () => {
  const v = P.project(crossAddRec());
  const sources = v.attribution.Combustion.sources;
  const xa = sources.find((s) => s.source === "Universal Torc");
  assert.strictEqual(xa.crossAdd, "Universal Spell Power");
  const own = sources.find((s) => s.source === "Ember Band");
  assert.strictEqual(own.crossAdd, null);
});

test("U3: a pre-cross-add snapshot (no crossAdd on any part) projects without error, marker null", () => {
  const rec = crossAddRec();
  for (const p of rec.snapshot.breakdown.Combustion) delete p.crossAdd;   // old saved record
  let v;
  assert.doesNotThrow(() => { v = P.project(rec); });
  for (const s of v.attribution.Combustion.sources) assert.strictEqual(s.crossAdd, null);
  const c = P.itemContributions(rec.snapshot, { slot: "Necklace", variant_id: "Universal Torc" }, null, ["Combustion"]);
  assert.strictEqual(c[0].crossAdd, null);
});

test("U3: cross-added parts stay FLAT in attribution — collapseExpansions never groups by crossAdd", () => {
  // collapseExpansions groups by PROVENANCE_KEY ("via") only. A breakdown part's
  // crossAdd must not cause item-surface grouping: the Universal affix IS the name
  // engraved on the item, so the item surfaces keep printing it under its own name.
  const affixes = [
    { name: "Universal Spell Power", type: "Implement", value: 50 },
    { name: "Combustion", type: "Equipment", value: 100 },
  ];
  const out = P.collapseExpansions(affixes);
  assert.strictEqual(out.length, 2, "no grouping without via");
  assert.strictEqual(out[0], affixes[0], "passed through by identity");
});

// ---- #91 (U6) — the Utility tier through the shared content projection ----

function utilityRec() {
  const rec = makeRec();
  rec.inputs.priorities = ["Deadly", "Dodge", "Utility effects"];
  rec.snapshot.utilityReport = { count: 2, effects: [
    { name: "Ghost Touch", item: "Moon Ring" },
    { name: "Feather Falling", item: null },
  ] };
  return rec;
}

test("U6 (#91): project() emits the utility block from the snapshot's utilityReport", () => {
  const v = P.project(utilityRec());
  assert.ok(v.utility, "the utility block is present when the snapshot carries a report");
  assert.strictEqual(v.utility.count, 2);
  assert.deepStrictEqual(v.utility.effects, [
    { name: "Ghost Touch", item: "Moon Ring" },
    { name: "Feather Falling", item: null },
  ], "effects carry {name, item} — item null when no carrier was credited");
  assert.strictEqual(v.utility.line, "2 utility effects on this loadout",
    "the one canonical sentence rides on the block");
});

test("U6 (#91): the sentinel is EXCLUDED from the generic per-priority attribution", () => {
  const v = P.project(utilityRec());
  assert.deepStrictEqual(Object.keys(v.attribution), ["Deadly", "Dodge"],
    "no phantom zero-total attribution row for the sentinel");
  assert.ok(!("Utility effects" in v.attribution));
  // The sentinel name comes from model.js (single definition), re-exported here.
  assert.strictEqual(P.UTILITY_SENTINEL, require("../web/model.js").UTILITY_SENTINEL);
});

test("U6 (#91): absent utilityReport → utility block ABSENT (never a fabricated zero)", () => {
  const v = P.project(makeRec());
  assert.ok(!("utility" in v), "a pre-feature snapshot projects no utility block at all");
});

test("U6 (#91): the zero-count line matches results.js's zero-state wording verbatim", () => {
  const rec = makeRec();
  rec.snapshot.utilityReport = { count: 0, effects: [] };
  const v = P.project(rec);
  assert.strictEqual(v.utility.count, 0);
  assert.deepStrictEqual(v.utility.effects, []);
  assert.strictEqual(v.utility.line,
    "0 utility effects on this loadout — no counted on/off effects are present.");
  // The wording source itself: singular for one effect, plural otherwise.
  assert.strictEqual(P.utilityLine(1), "1 utility effect on this loadout");
  assert.strictEqual(P.utilityLine(7), "7 utility effects on this loadout");
});

// #346 (U5, R11, AE3) — a mechanic the rung made UNREACHABLE is named, not
// silently omitted. Augment Sets are the case: they are set-bonus crafting, so
// every rung from no-niche-crafting down clears them. Only a player whose own
// ownership opt-in was overridden needs to hear it.
test("#346: owned Augment Sets are reported unavailable, not silently dropped", () => {
  const rec = makeRec();
  rec.snapshot.query = { craftingRung: "printed-only" };

  rec.inputs = Object.assign({}, rec.inputs, { ownedSetAugments: [] });
  assert.ok(!/Augment Set/.test(P.project(rec).character.craftingExcludedNotice),
    "a player who marked none owned is not told about a mechanic they never opted into");

  rec.inputs = Object.assign({}, rec.inputs, { ownedSetAugments: ["Some Set"] });
  const one = P.project(rec).character.craftingExcludedNotice;
  assert.match(one, /Augment Set you marked as owned was unavailable/);
  assert.match(one, /not merely outscored/, "unavailable and outscored are different facts");

  rec.inputs = Object.assign({}, rec.inputs, { ownedSetAugments: ["A", "B"] });
  assert.match(P.project(rec).character.craftingExcludedNotice, /2 Augment Sets you marked as owned were unavailable/);

  // It rides every restrictive rung, because all of them clear set-bonus crafting.
  rec.snapshot.query = { craftingRung: "no-niche-crafting" };
  assert.match(P.project(rec).character.craftingExcludedNotice, /unavailable at this setting/);
  // ...but never the top rung, where the sets were genuinely available.
  rec.snapshot.query = { craftingRung: "everything" };
  rec.snapshot.augmentsPlaced = [{ variant_id: "Sapphire", color: "Blue" }];
  assert.ok(!/unavailable at this setting/.test(P.project(rec).character.craftingExcludedNotice));
});

// #346 (U5, R11) — the live call path. results.js forwards the SOLVED QUERY
// straight in as `inputs`, where ownedSetAugments is a Set; the saved path hands
// over a plain array because pickInputs converts it for JSON. Counting only
// `.length` made this clause render in every export and never in the app. The
// original tests missed it by building records in the saved shape only, so this
// one asserts BOTH shapes through the same function.
test("#346: the owned-set clause counts a Set and an array identically", () => {
  const line = (owned) => P.craftingExcludedLine({
    inputs: { ownedSetAugments: owned },
    snapshot: { query: { craftingRung: "printed-only" }, augmentsPlaced: [] },
  });
  const asSet = line(new Set(["A", "B"]));
  const asArray = line(["A", "B"]);
  assert.match(asSet, /2 Augment Sets you marked as owned were unavailable/,
    "the live Set shape renders the clause");
  assert.strictEqual(asSet, asArray,
    "the live and saved shapes produce the identical sentence — that is the whole contract");
  assert.strictEqual(line(new Set()), line([]), "both empty shapes agree too");
  assert.ok(!/Augment Set/.test(line(new Set())), "and neither invents a clause");
  // A hand-edited backup must not kill the projection five surfaces read from.
  for (const junk of [null, undefined, 0, "two", { A: 1 }]) {
    assert.ok(!/Augment Set/.test(line(junk)), `${JSON.stringify(junk)} counts as none, does not throw`);
  }
});

// #346 — the ladder notice, read from a record built by the REAL production
// writer rather than a hand-shaped fixture.
//
// docs/solutions/conventions/fixture-shape-must-mirror-the-production-writer.md
// (2026-08-16, from #339's postmortem): serializeCharacter stores `query` as a
// top-level SIBLING of `snapshot`, and RESULT_KEEP never admits a `query` key
// into the snapshot, so the nested shape cannot exist on a real saved character.
// Every other #346 test here hand-builds `snapshot.query` and therefore only
// ever exercises the fallback branch — the same blind spot that let the #339
// disclosure ship rendering nowhere while four dedicated tests passed. This one
// goes through serializeCharacter so the `rec.query` read is actually guarded.
test("#346: the notice reads a record built by serializeCharacter, not a hand-shaped fixture", () => {
  const Store = require("../web/persist.js");
  const W = require("../web/wizard.js");
  const state = { ml: 34, race: "Human", armor: "", oath: "", alignment: "", style: "",
    weaponTypes: [], offHand: [], offHandWeapons: [], priorities: ["Constitution"],
    slotConstraints: {}, craftingRung: "printed-only",
    ownedSetAugments: new Set(["Perfect Silence"]) };
  const query = W.buildQuery(state);
  const rec = Store.serializeCharacter("Real", state,
    { query, result: { status: "optimal", chosen: [], perTarget: {}, breakdown: {}, augmentsPlaced: [] } }, "b1");

  assert.ok(!("query" in rec.snapshot),
    "the real writer never nests query inside the snapshot — if this flips, the other fixtures became valid and this test is moot");
  assert.strictEqual(typeof rec.query, "object", "it is a top-level sibling");

  const line = P.craftingExcludedLine(rec);
  assert.match(line, /nothing beyond what is printed/, "the rung is read from rec.query");
  assert.match(line, /Augment Set you marked as owned was unavailable/,
    "and the owned-set count survives the real save path's Set-to-array conversion");
});

// #346 (U4, R9) — the top-rung notice must count everything a lower rung would
// take away, not just augments. A build leaning entirely on Viktranium or seals
// is precisely the player who needs to learn the ladder exists, and counting
// augments alone left them with no notice at all.
test("#346: the top-rung notice counts crafted options, not just augments", () => {
  const rec = (extra) => ({ inputs: {},
    snapshot: Object.assign({ query: { craftingRung: "everything" }, augmentsPlaced: [] }, extra) });

  assert.strictEqual(P.craftingExcludedLine(rec({})), null,
    "a loadout leaning on nothing still says nothing");

  const craftOnly = P.craftingExcludedLine(rec({ vikPlaced: [{}, {}], sealPlaced: [{}] }));
  assert.match(craftOnly, /uses 3 crafted options/, "crafted options are counted and named");
  assert.match(craftOnly, /lower "What may the solver assume/, "and the control is named");

  const mixed = P.craftingExcludedLine(rec({
    augmentsPlaced: [{ color: "Sun" }, { color: "Blue" }], dinoPlaced: [{}] }));
  assert.match(mixed, /leans on 1 Solar\/Lunar Gem, 1 other augment and 1 crafted option/,
    "all three families are listed in one sentence");

  const singular = P.craftingExcludedLine(rec({ ncPlaced: [{}] }));
  assert.match(singular, /uses 1 crafted option\./, "singular reads correctly");
});


// ---- #88 U8/U9 (R14/R15/R16) — override disclosure and export carriage ------
const OVR_REPORT = {
  inForce: [
    { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor", to: "Enhancement", count: 1 },
    { pool_key: "seal||Gloom||equipment/accessories||Charisma||Insight||7",
      name: "Charisma", from: "Insight", to: "Quality", count: 3 },
  ],
  contributions: [
    { stat: "Armor Class", from: "Armor", to: "Enhancement", host: "Aberrant Robe", value: 5 },
  ],
};

test("#88 U9 (R15/R16): the export header names every override in force, and both types", () => {
  const line = P.overridesLine(OVR_REPORT);
  assert.ok(/Armor Class on Aberrant Robe: Enhancement — catalog says Armor/.test(line));
  assert.ok(!/[()]/.test(line), "no parentheses — markdown escapes them in pasted text");
  assert.ok(/Charisma on a crafting option: Quality — catalog says Insight/.test(line),
    "a pool-keyed override has no item name and must not print undefined");
  assert.ok(!/undefined/.test(line));
});

test("#88 U9: the header line is empty when nothing was in force", () => {
  assert.strictEqual(P.overridesLine(null), "");
  assert.strictEqual(P.overridesLine({ inForce: [], contributions: [] }), "");
});

test("#88 U9 (KTD6): a declared-but-unapplied override never reaches the header", () => {
  // The report is the SOLVER's output, so a suspended, unmatched, or ineligible
  // override — present in the player's saved list, doing nothing — is absent here.
  assert.strictEqual(P.overridesLine({ inForce: [], contributions: [] }), "",
    "the saved declaration is not what this line reads");
});

test("#88 U9: two exports of the same build compare byte-for-byte whatever the order", () => {
  const flipped = { inForce: OVR_REPORT.inForce.slice().reverse(), contributions: [] };
  assert.strictEqual(P.overridesLine(OVR_REPORT), P.overridesLine(flipped));
});

test("#88 U8 (R14/AE12): the optimality claim is qualified whenever an override was in force", () => {
  const lines = P.overrideNoticeLines({ overrideReport: OVR_REPORT });
  assert.ok(lines.length >= 1);
  assert.ok(/not proven against the catalog/.test(lines[0]), "the claim is explicitly weakened");
  assert.ok(lines.some((l) => /Armor Class/.test(l) && /Enhancement/.test(l) && /Armor/.test(l)),
    "R16 — a contribution that reached the loadout names both types");
});

test("#88 U8 (R14): a solve with no override in force says nothing", () => {
  assert.deepStrictEqual(P.overrideNoticeLines({}), []);
  assert.deepStrictEqual(P.overrideNoticeLines({ overrideReport: null }), []);
  assert.deepStrictEqual(P.overrideNoticeLines({ overrideReport: { inForce: [], contributions: [] } }), []);
});


// ---- review #6 (R13/R16) — the gear-box summary must label an override too ---
// attributionByTarget threads `overriddenFrom`; itemContributions rebuilds rows
// from the same parts with its own fixed field list, and results.js renders the
// gear box from THAT shape. A marker named in one mapper and not the other is
// correct in the solver and invisible where the player reads it.
const OVR_RESULT = {
  breakdown: {
    Constitution: [
      { bonus_type: "Insight", value: 6, source: "Necklace of X", sourceKind: "worn",
        slot: "Necklace", hostIds: ["Necklace of X"], via: null, crossAdd: null,
        overriddenFrom: "Enhancement" },
      { bonus_type: "Enhancement", value: 10, source: "Ring of Y", sourceKind: "worn",
        slot: "Ring", hostIds: ["Ring of Y"], via: null, crossAdd: null, overriddenFrom: null },
    ],
  },
  chosen: [], augmentsPlaced: [], setsActive: [],
};

test("#88 review #6: itemContributions carries overriddenFrom to the gear box", () => {
  const attr = P.attributionByTarget(OVR_RESULT);
  const rows = P.itemContributions(OVR_RESULT, { variant_id: "Necklace of X" }, attr, ["Constitution"]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].overriddenFrom, "Enhancement",
    "the row the per-item summary renders from knows the catalog's type");
  const plain = P.itemContributions(OVR_RESULT, { variant_id: "Ring of Y" }, attr, ["Constitution"]);
  assert.strictEqual(plain[0].overriddenFrom, null, "an ordinary contribution is unmarked");
});

// #476 — "the rendered gear-box line names both types" moved to
// tests/results.test.js. It drove `whyThisLine`, which is deleted; the same
// chain — a solver-shaped breakdown through attributionByTarget and
// itemContributions to the rendered card — is asserted there against
// `equippedBody`, the surface that actually renders. The row-level guarantee
// above (itemContributions carries overriddenFrom) stays here, where it belongs.

// ---- #88 U12 (R16-R19) — the catalog-correction report ----------------------
// Generated text only (KTD10): the app is client-side and stays that way. The
// report's job is to identify its subject unambiguously to a maintainer who has
// never seen the player's screen, and to be honest that the claim has no wiki
// backing — that is the whole reason the override exists.
const ITEM_OVR = { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor",
                   value: "5", to: "Enhancement", note: "measured on my own robe at ML 12" };
const POOL_OVR = { pool_key: "seal||Gloom||equipment/accessories||Charisma||Insight||7",
                   name: "Charisma", from: "Insight", value: "7", to: "Quality" };

test("#88 U12 (R17/AE17): an item report names item, affix, both types, URL and the note", () => {
  const txt = P.correctionReport(ITEM_OVR, { variant_id: "Aberrant Robe",
    wiki_url: "https://ddowiki.com/page/Item:Aberrant_Robe" });
  assert.ok(/Aberrant Robe/.test(txt), "the item");
  assert.ok(/Armor Class/.test(txt), "the affix");
  assert.ok(/Armor/.test(txt) && /Enhancement/.test(txt), "both types (R16)");
  assert.ok(/ddowiki\.com\/page\/Item:Aberrant_Robe/.test(txt), "the wiki URL");
  assert.ok(/measured on my own robe/.test(txt), "the note (R19)");
  assert.ok(/no wiki backing|not backed by the wiki|in-game observation/i.test(txt),
    "and the explicit statement that this is an observation, not a citation");
});

test("#88 U12: the note is optional and its absence leaves no empty line", () => {
  const txt = P.correctionReport({ ...ITEM_OVR, note: "" },
    { variant_id: "Aberrant Robe", wiki_url: "https://ddowiki.com/page/Item:Aberrant_Robe" });
  assert.ok(!/Note:/.test(txt), "no orphan label");
  assert.ok(!/\n\n\n/.test(txt), "and no hole where it would have been");
});

test("#88 U12: a pool-keyed report omits the URL line entirely and names the channel", () => {
  const txt = P.correctionReport(POOL_OVR, null);
  assert.ok(!/http/.test(txt), "no crafted pool row carries a wiki_url, so no URL line at all");
  assert.ok(!/Wiki:/.test(txt), "…not even an empty label");
  assert.ok(/seal/.test(txt), "the channel");
  assert.ok(/Gloom/.test(txt) && /equipment\/accessories/.test(txt),
    "and the entry's own discriminators, which are all that identify it");
  assert.ok(/Charisma/.test(txt) && /Insight/.test(txt) && /Quality/.test(txt));
});

test("#88 U12: a report is reproducible from a restored character", () => {
  // The report is a pure function of the override plus the catalog row, and the
  // override persists — so a reload produces byte-identical text.
  const a = P.correctionReport(ITEM_OVR, { variant_id: "Aberrant Robe", wiki_url: "https://x/y" });
  const restored = JSON.parse(JSON.stringify(ITEM_OVR));
  const b = P.correctionReport(restored, { variant_id: "Aberrant Robe", wiki_url: "https://x/y" });
  assert.strictEqual(a, b);
});

test("#88 U12: an item override with no catalog row still identifies its subject", () => {
  const txt = P.correctionReport(ITEM_OVR, null);
  assert.ok(/Aberrant Robe/.test(txt), "the variant id is on the override itself");
  assert.ok(!/Wiki:/.test(txt), "the URL line is omitted rather than emitted empty");
});

// ---------------------------------------------------------------------------
// #335 U4 (KTD7) — the ×2 collapse is a RENDER-layer pass over already-assigned
// data. Augment and insert assignment fills by chosen INDEX and set-augment
// reservation matches on host === variant_id, so the twin's distinct id is what
// gives it its own index and its own slot supply. Collapsing before assignment
// would halve the ring's slots and orphan every twin-keyed record.
// ---------------------------------------------------------------------------

const _M335 = require("../web/model.js");
function _ring335(extra) {
  const id = [...(_M335.DUPLICABLE_RINGS)][0];
  return Object.assign({ variant_id: id, source_item: id, slot: "Ring",
    set_bonus: [{ set: "Perfected Wrath" }], augment_slots_norm: { colors: ["Blue"] } }, extra || {});
}

test("#335 U4: a twin pair collapses to one entry marked x2, keeping both indices", () => {
  const ring = _ring335();
  const twin = Object.assign({}, ring, { variant_id: _M335.twinIdOf(ring.variant_id) });
  const chosen = [{ slot: "Ring", variant: ring }, { slot: "Ring", variant: twin },
                  { slot: "Neck", variant: { variant_id: "N", slot: "Neck" } }];
  const g = P.collapseTwins(chosen);
  assert.strictEqual(g.length, 2, "three chosen entries render as two items");
  assert.strictEqual(g[0].count, 2, "the ring is marked x2");
  assert.deepStrictEqual(g[0].indices, [0, 1],
    "both chosen indices are carried, so each copy's own augments stay reachable");
  assert.strictEqual(g[1].count, 1, "an ordinary item is unaffected");
});

test("#335 U4 (KTD2): the collapsed entry never carries a suffixed twin id", () => {
  const ring = _ring335();
  const twin = Object.assign({}, ring, { variant_id: _M335.twinIdOf(ring.variant_id) });
  const g = P.collapseTwins([{ slot: "Ring", variant: ring }, { slot: "Ring", variant: twin }]);
  assert.strictEqual(_M335.isTwinId(g[0].variant.variant_id), false,
    "a suffixed id must never reach a receipt or an export");
  assert.strictEqual(g[0].variant.variant_id, ring.variant_id);
});

test("#335 U4: an uncollapsed list is returned unchanged, one entry per item", () => {
  const chosen = [{ slot: "Ring", variant: { variant_id: "A" } }, { slot: "Ring", variant: { variant_id: "B" } }];
  const g = P.collapseTwins(chosen);
  assert.strictEqual(g.length, 2, "two DIFFERENT rings stay two entries");
  assert.ok(g.every((e) => e.count === 1));
});

test("#335 U4 (R6): the second-copy receipt is derived, not a fixed sentence", () => {
  const withAug = P.collapseTwins([{ slot: "Ring", variant: _ring335() },
    { slot: "Ring", variant: Object.assign({}, _ring335(), { variant_id: _M335.twinIdOf(_ring335().variant_id) }) }]);
  const line = P.secondCopyContribution(withAug[0]);
  assert.ok(/second piece toward Perfected Wrath/.test(line), "names the set it counts toward");
  assert.ok(/own augment slots/.test(line), "names the capacity it carries");
  assert.ok(/does not apply this item's own affixes a second time/.test(line),
    "and states plainly what it does NOT do — the misreading this wording exists to prevent");

  // A ring with no augment slots must not claim to carry any.
  const noAug = _ring335({ augment_slots_norm: { colors: [] } });
  const g2 = P.collapseTwins([{ slot: "Ring", variant: noAug },
    { slot: "Ring", variant: Object.assign({}, noAug, { variant_id: _M335.twinIdOf(noAug.variant_id) }) }]);
  assert.ok(!/augment slots/.test(P.secondCopyContribution(g2[0])),
    "derived means it stops claiming what the item does not have");
});

test("#335 U4: a single copy gets no second-copy receipt at all", () => {
  const g = P.collapseTwins([{ slot: "Ring", variant: _ring335() }]);
  assert.strictEqual(P.secondCopyContribution(g[0]), null);
});

// ---------------------------------------------------------------------------
// U10 (plan 2026-08-22-001) — the three multi-fact notices expose ONE addressable
// entry per FIRED branch, each carrying its KTD5 title and class.
//
// The point of the split is a claim, not a layout: a single title such as
// "DECLARED CREDIT APPLIED" over a notice that fired for its ML-floor branch
// would assert a declared credit was applied on a solve that declared none —
// instance 3 in docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md.
//
// The sentences are the product; only their addressing changed. Every sentence
// below is byte-identical to what the pre-change tree emitted for the same input,
// which is why they are pinned as literals rather than matched by regex.
// ---------------------------------------------------------------------------

const _escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const _CLASSES = ["actionable", "qualifying"];
function _wellFormed(entries, where) {
  for (const e of entries) {
    assert.ok(e && typeof e.id === "string" && e.id, `${where}: every entry has an id`);
    assert.ok(typeof e.title === "string" && e.title, `${where}: every entry has a title`);
    assert.ok(_CLASSES.indexOf(e.class) !== -1, `${where}: ${e.id} has a known class, got ${e.class}`);
    assert.ok(typeof e.sentence === "string" && e.sentence.trim(), `${where}: ${e.id} carries a sentence`);
  }
}

test("U10: artifactNoticeEntries never bundles the pinned branch with the none-flagged one", () => {
  const none = P.artifactNoticeEntries({ missing: true, pinnedArtifacts: [] });
  assert.strictEqual(none.length, 1);
  assert.strictEqual(none[0].id, "artifact-unavailable");
  assert.strictEqual(none[0].title, "ARTIFACT UNAVAILABLE");
  assert.strictEqual(none[0].class, "qualifying");
  assert.strictEqual(none[0].sentence,
    "No Artifact could be included — none is flagged in the current data.");

  const pinned = P.artifactNoticeEntries({ missing: false, pinnedArtifacts: ["Baphomet's Reign"] });
  assert.strictEqual(pinned.length, 1);
  assert.strictEqual(pinned[0].id, "artifact-pinned-in");
  assert.strictEqual(pinned[0].title, "ARTIFACT PINNED IN");
  assert.strictEqual(pinned[0].class, "actionable");

  // The two ids can never appear in one array — they classify differently, and a
  // shared card would put "no Artifact could be included" over a named Artifact.
  const ids = none.map((e) => e.id).concat(pinned.map((e) => e.id));
  assert.strictEqual(new Set(ids).size, ids.length, "distinct entries, never one");
  assert.strictEqual(P.artifactNoticeEntries({ missing: false, pinnedArtifacts: [] }).length, 0);
  _wellFormed(none.concat(pinned), "artifact");
});

test("U10: the pinned-Artifact sentence is byte-identical, escaped by the caller's escaper", () => {
  const two = P.artifactNoticeEntries(
    { pinnedArtifacts: ["Baphomet's Reign", "<Sook> & \"Co\""] }, _escHtml);
  assert.strictEqual(two[0].sentence,
    "Baphomet&#39;s Reign, &lt;Sook&gt; &amp; &quot;Co&quot; are Artifacts and were included because "
    + "you pinned them, even though \"Include an Artifact\" is off. Unpin to exclude them.");
  // No escaper -> plain text, so an export can print the same wording unescaped.
  const plain = P.artifactNoticeEntries({ pinnedArtifacts: ["Baphomet's Reign"] });
  assert.strictEqual(plain[0].sentence,
    "Baphomet's Reign is an Artifact and was included because you pinned it, even though "
    + "\"Include an Artifact\" is off. Unpin to exclude it.");
});

test("U10: zeroSourceNoticeEntries splits absent from filtered, with different classes", () => {
  const both = P.zeroSourceNoticeEntries({ absent: ["Ice Lore"], filtered: ["Sonic Lore"] });
  assert.strictEqual(both.length, 2, "two facts, two entries");
  assert.deepStrictEqual(both.map((e) => e.id), ["stat-not-in-data", "stat-filtered-out"]);
  assert.deepStrictEqual(both.map((e) => e.title), ["STAT NOT IN DATA", "STAT FILTERED OUT"]);
  assert.deepStrictEqual(both.map((e) => e.class), ["qualifying", "actionable"],
    "one has a control that resolves it and one does not — they cannot share a class");
  assert.strictEqual(both[0].sentence,
    "Nothing in the current data carries Ice Lore — ranking it can't change your build.");
  assert.strictEqual(both[1].sentence,
    "No source of Sonic Lore is available in your current filters — "
    + "widening the ML band or character filters may reach it.");
  _wellFormed(both, "zero-source");

  assert.strictEqual(P.zeroSourceNoticeEntries({ absent: ["Ice Lore"], filtered: [] }).length, 1);
  assert.strictEqual(P.zeroSourceNoticeEntries({ absent: [], filtered: ["Sonic Lore"] }).length, 1);
  assert.strictEqual(P.zeroSourceNoticeEntries({}).length, 0);
});

test("U10: the filtered sentence keeps all three of its cause wordings verbatim", () => {
  const owned = P.zeroSourceNoticeEntries({ filtered: ["Sonic Lore"], owned: true });
  assert.strictEqual(owned[0].sentence,
    "No source of Sonic Lore is available in your owned-gear pool — the full catalog may have one.");
  const rung = P.zeroSourceNoticeEntries(
    { filtered: ["X"], rungRestricts: true, removed: "augments" });
  assert.strictEqual(rung[0].sentence,
    "No source of X is available in your current filters, which exclude augments — "
    + "raising \"What may the solver assume beyond the printed item?\" may reach it.");
  const many = P.zeroSourceNoticeEntries({ filtered: ["X", "Y"] });
  assert.strictEqual(many[0].sentence,
    "No source of X, Y is available in your current filters — "
    + "widening the ML band or character filters may reach them.");
});

// --- boundNotice: the large one. Six branches, seven ids (the off-hand branch
// resolves to a different id when the declaration post-dates the solve). ---

const _boundAll = {
  mlFloor: 30,
  floorReport: [{ stat: "Combat Mastery", floor: 10, achieved: 7 }],
  heldCaps: [{ stat: "Dodge", cap: 4 }],
  creditLines: ["credit line one.", "credit line two."],
  overrideLines: ["override line."],
  offHand: { mode: "none", name: "" },
};

test("U10: boundNoticeEntries emits one entry per fired branch, each with its KTD5 title and class", () => {
  const all = P.boundNoticeEntries(_boundAll);
  assert.deepStrictEqual(all.map((e) => e.id),
    ["gear-ml-floor", "floor-not-reached", "held-at-your-cap",
      "declared-credit", "bonus-type-override", "off-hand-excluded"]);
  assert.deepStrictEqual(all.map((e) => e.title),
    ["GEAR ML FLOOR", "FLOOR NOT REACHED", "HELD AT YOUR CAP",
      "DECLARED CREDIT APPLIED", "BONUS TYPE OVERRIDDEN", "OFF-HAND EXCLUDED"]);
  assert.deepStrictEqual(all.map((e) => e.class),
    ["qualifying", "actionable", "qualifying", "qualifying", "qualifying", "qualifying"]);
  _wellFormed(all, "bound");
});

test("#508: a declared-but-inert Two Weapon Fighting says so, and names what got in", () => {
  // The reported case: declared, no style set, and a tower shield in the off hand.
  const [e] = P.boundNoticeEntries({
    twfInert: { style: null, styleLabel: null, name: "Legendary Cataclysmic Tower Shield" } });
  assert.strictEqual(e.id, "twf-not-applied");
  assert.strictEqual(e.title, "TWO WEAPON FIGHTING NOT APPLIED");
  assert.strictEqual(e.class, "actionable", "there is a control that fixes it");
  assert.ok(/no combat style is set/.test(e.sentence), "names the cause");
  assert.ok(/Legendary Cataclysmic Tower Shield is in your off hand/.test(e.sentence),
    "names the item the player is looking at — that is what makes the notice land");
  assert.ok(/Pick One-hand \/ Dual-wield and re-solve/.test(e.sentence), "names the fix");

  // A style that simply does not dual-wield gets the other sentence, by LABEL.
  const [t] = P.boundNoticeEntries({
    twfInert: { style: "thf", styleLabel: "Two Handed Fighting", name: "" } });
  assert.ok(/Two Handed Fighting doesn't wield a second weapon/.test(t.sentence),
    "the settled style label, not the raw id");
  assert.ok(!/thf/.test(t.sentence), "the raw taxonomy id never reaches the player");
  assert.ok(/no off-hand item was excluded, and no second weapon was offered/.test(t.sentence),
    "with no off-hand item to name, it still says what did not happen");
  // The exclusion notice's vocabulary is RESERVED. A U6/003 test asserts a build
  // under a non-dual-wielding style never reads as though something was excluded,
  // and this notice fires in exactly that state — so it must not borrow the phrase.
  for (const sentence of [e.sentence, t.sentence]) {
    assert.ok(!/shields, orbs, and rune arms/i.test(sentence),
      "the inert notice must not speak the exclusion's words — it makes the opposite claim");
  }

  // It never fires on a build that is not in the inert state.
  assert.deepStrictEqual(P.boundNoticeEntries({ mlFloor: 30 }).map((x) => x.id), ["gear-ml-floor"],
    "no twfInert fact -> no entry");
  _wellFormed([e, t], "bound");
});

test("#508: the inert notice and the exclusion notice are mutually exclusive", () => {
  // They are complements over "TWF is declared", so a build can be in exactly one
  // state. A build showing both would mean the authority disagreed with itself.
  const both = P.boundNoticeEntries({
    twfInert: { style: null, styleLabel: null, name: "" },
    offHand: { mode: "none", name: "" },
  }).map((x) => x.id);
  assert.ok(both.includes("twf-not-applied") && both.includes("off-hand-excluded"),
    "projection renders whatever facts it is handed — the mutual exclusion is upstream");
  // ...which is why the derivation is what must guarantee it. That is asserted
  // against the real deriver in tests/results.test.js, not here.
});

test("U10: a solve bounded only by the ML floor claims no declared credit", () => {
  const only = P.boundNoticeEntries({ mlFloor: 32 });
  assert.strictEqual(only.length, 1, "one fired branch, one entry");
  assert.strictEqual(only[0].id, "gear-ml-floor");
  assert.strictEqual(only[0].title, "GEAR ML FLOOR");
  assert.strictEqual(only[0].sentence, "Considered gear ML ≥ 32 (your floor).");
  assert.ok(!only.some((e) => /DECLARED CREDIT/.test(e.title)),
    "no entry may claim a declared credit was applied on a solve that declared none");
  assert.ok(!only.some((e) => /declared/i.test(e.sentence)));
});

test("U10: the floor-miss branch is actionable and keeps its sentence verbatim", () => {
  const miss = P.boundNoticeEntries({
    floorReport: [{ stat: "Combat Mastery", floor: 10, achieved: 7 },
      { stat: "Dodge", floor: 5, achieved: 3 }] });
  assert.strictEqual(miss.length, 1);
  assert.strictEqual(miss[0].class, "actionable", "the player has priorities to change");
  assert.strictEqual(miss[0].sentence,
    "Couldn't reach your floor of 10 Combat Mastery — best achievable was 7. "
    + "Couldn't reach your floor of 5 Dodge — best achievable was 3.");
});

test("U10: the held-cap, credit and override branches keep their sentences verbatim", () => {
  assert.strictEqual(
    P.boundNoticeEntries({ heldCaps: [{ stat: "Dodge", cap: 4 }, { stat: "A&B", cap: 9 }] }, _escHtml)[0].sentence,
    "Held at your cap: Dodge 4, A&amp;B 9.");
  assert.strictEqual(
    P.boundNoticeEntries({ creditLines: ["one.", "two."] })[0].sentence, "one. two.");
  assert.strictEqual(
    P.boundNoticeEntries({ overrideLines: ["one.", "two."] })[0].sentence, "one. two.");
});

test("U10: the off-hand branch resolves to three sentences under two titles", () => {
  const caveat = " The optimizer doesn't score the Two Weapon Fighting penalty "
    + "(or a shield's defense), so the off-hand pick was compared on ranked-stat value alone.";
  const none = P.boundNoticeEntries({ offHand: { mode: "none" } })[0];
  assert.strictEqual(none.id, "off-hand-excluded");
  assert.strictEqual(none.class, "qualifying");
  assert.strictEqual(none.sentence, "You declared Two Weapon Fighting, so shields, orbs, and rune "
    + "arms left off-hand candidacy — pin one to bring it back." + caveat);

  const pinned = P.boundNoticeEntries({ offHand: { mode: "pinned", name: "Tower Shield" } })[0];
  assert.strictEqual(pinned.id, "off-hand-excluded", "a pin override is still the exclusion fact");
  assert.strictEqual(pinned.class, "qualifying");
  assert.strictEqual(pinned.sentence, "You declared Two Weapon Fighting, so shields, orbs, and rune "
    + "arms left off-hand candidacy — your pinned Tower Shield overrode that and is equipped." + caveat);

  // A build solved before the declaration is the one off-hand case the player can
  // actually resolve, so it is the one that classifies actionable.
  const stale = P.boundNoticeEntries({ offHand: { mode: "stale", name: "Tower Shield" } })[0];
  assert.strictEqual(stale.id, "re-solve-to-apply");
  assert.strictEqual(stale.title, "RE-SOLVE TO APPLY");
  assert.strictEqual(stale.class, "actionable");
  assert.strictEqual(stale.sentence, "You declared Two Weapon Fighting, so shields, orbs, and rune "
    + "arms leave off-hand candidacy — but this build still shows Tower Shield in the off hand, so "
    + "it was solved before the declaration. Re-solve to apply it." + caveat);
});

test("U10: the entry count is the number of FIRED branches, not the number of notice functions", () => {
  assert.strictEqual(P.boundNoticeEntries({}).length, 0, "nothing bounded the solve");
  assert.strictEqual(P.boundNoticeEntries({ mlFloor: 0, floorReport: [], heldCaps: [] }).length, 0);
  assert.strictEqual(P.boundNoticeEntries({ mlFloor: 30 }).length, 1);
  assert.strictEqual(P.boundNoticeEntries({ mlFloor: 30, heldCaps: [{ stat: "Dodge", cap: 4 }] }).length, 2);
  assert.strictEqual(P.boundNoticeEntries(_boundAll).length, 6);
  // Three notice FUNCTIONS, but a solve that fires every branch of all three
  // yields one entry per fact — that is the whole point of the split.
  const total = P.artifactNoticeEntries({ missing: true }).length
    + P.zeroSourceNoticeEntries({ absent: ["A"], filtered: ["B"] }).length
    + P.boundNoticeEntries(_boundAll).length;
  assert.strictEqual(total, 9);
});

test("U10: no branch of any of the three notices falls through unclassified", () => {
  const every = []
    .concat(P.artifactNoticeEntries({ missing: true }))
    .concat(P.artifactNoticeEntries({ pinnedArtifacts: ["A"] }))
    .concat(P.zeroSourceNoticeEntries({ absent: ["A"], filtered: ["B"] }))
    .concat(P.zeroSourceNoticeEntries({ filtered: ["B"], owned: true }))
    .concat(P.zeroSourceNoticeEntries({ filtered: ["B"], rungRestricts: true, removed: "augments" }))
    .concat(P.boundNoticeEntries(_boundAll))
    .concat(P.boundNoticeEntries({ offHand: { mode: "pinned", name: "S" } }))
    .concat(P.boundNoticeEntries({ offHand: { mode: "stale", name: "S" } }));
  _wellFormed(every, "all branches");
  assert.strictEqual(new Set(every.map((e) => e.id)).size, 11,
    "eleven distinct branch identities across the three notices");
  // One title per id, one class per id — a reclassification must be a deliberate edit.
  const byId = new Map();
  for (const e of every) {
    if (byId.has(e.id)) assert.deepStrictEqual([e.title, e.class], byId.get(e.id), `${e.id} is stable`);
    else byId.set(e.id, [e.title, e.class]);
  }
});

// ---------------------------------------------------------------------------
// #449 U2 — the achieved/ceiling fraction as shared content.
//
// The wording assertions here are the mechanical half of the review question
// docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md
// prescribes. They cannot prove a sentence honest; they can only prove that the
// specific counterfactual constructions that produced five prior instances are
// absent. The review question stays the real guard.
// ---------------------------------------------------------------------------

// Trip-words from that convention, plus KTD2's own list. `\b` on both ends so
// "canned"/"alonely" style substrings cannot false-positive, and the whole
// sentence is lowercased first.
const _COUNTERFACTUAL = /\b(would|could|otherwise|alone|instead|without)\b/;

function _ceilRec(rows, capped) {
  return { ceilingReport: rows, capped: capped || {} };
}

test("#449 U2: a maxed stat returns maxed:true and the maxed sentence", () => {
  const r = _ceilRec([{ stat: "Dodge", achieved: 12, ceiling: 12, bonusTypes: ["Enhancement"], allFilled: true }]);
  const c = P.ceilingFor(r, "Dodge");
  assert.strictEqual(c.maxed, true, "achieved === ceiling, uncapped");
  assert.strictEqual(c.capBound, false);
  assert.strictEqual(c.zeroCeiling, false);
  assert.strictEqual(c.achieved, 12);
  assert.strictEqual(c.ceilingUpperBound, 12);
  assert.strictEqual(c.fraction, "12 / 12");
  assert.ok(/no other item in your pool raises it/.test(c.short), `maxed sentence: ${c.short}`);
  assert.ok(c.line.startsWith("12 / 12 — "), "the line pairs the fraction with the short form");
});

test("#449 U2: a shortfall stat returns maxed:false and the shortfall sentence", () => {
  const r = _ceilRec([{ stat: "Dodge", achieved: 30, ceiling: 50, bonusTypes: ["Enhancement", "Insightful"], allFilled: false }]);
  const c = P.ceilingFor(r, "Dodge");
  assert.strictEqual(c.maxed, false);
  assert.strictEqual(c.capBound, false);
  assert.strictEqual(c.zeroCeiling, false);
  assert.strictEqual(c.fraction, "30 / 50");
  assert.ok(/sums the best source in each bonus type/.test(c.short), `shortfall sentence: ${c.short}`);
});

test("#449 U2 (KTD2): no ceiling sentence carries a counterfactual construction", () => {
  // Every state, not just the shortfall one — a counterfactual is as wrong on a
  // capped stat as on a short one.
  const cases = [
    P.ceilingFor(_ceilRec([{ stat: "A", achieved: 30, ceiling: 50 }]), "A"),
    P.ceilingFor(_ceilRec([{ stat: "A", achieved: 12, ceiling: 12 }]), "A"),
    P.ceilingFor(_ceilRec([{ stat: "A", achieved: 0, ceiling: 0 }]), "A"),
    P.ceilingFor(_ceilRec([{ stat: "A", achieved: 4, ceiling: 4 }], { A: 4 }), "A"),
  ];
  for (const c of cases) {
    assert.ok(!_COUNTERFACTUAL.test(c.short.toLowerCase()),
      `short form asserts a solve nobody ran: ${c.short}`);
    assert.ok(!_COUNTERFACTUAL.test(c.line.toLowerCase()), `line: ${c.line}`);
  }
  assert.ok(!_COUNTERFACTUAL.test(P.CEILING_FULL_STATEMENT.toLowerCase()),
    `full statement: ${P.CEILING_FULL_STATEMENT}`);
});

test("#449 U2 (KTD2): the shortfall sentence never asserts the ceiling was reachable", () => {
  const c = P.ceilingFor(_ceilRec([{ stat: "A", achieved: 30, ceiling: 50 }]), "A");
  const s = c.line.toLowerCase();
  // Attainability phrasings, and cause-attribution for the shortfall. No solve
  // establishes either; the second is the exact "higher priorities took the
  // slots" shape KTD2 rules out.
  for (const bad of ["reachable target", "you can reach", "attainable", "still available",
    "room to grow", "headroom", "took the slot", "higher priorit", "remaining", "short by"]) {
    assert.ok(!s.includes(bad), `shortfall line implies attainability or a cause: "${bad}" in ${c.line}`);
  }
  // The upper-bound qualification lives in the full statement, once per document.
  assert.ok(/upper bound/.test(P.CEILING_FULL_STATEMENT),
    "the full statement names the ceiling as an upper bound");
  assert.ok(/no loadout is claimed to reach it/.test(P.CEILING_FULL_STATEMENT),
    "and refuses the reachability claim outright");
});

test("#449 U2: a result with no ceilingReport returns null for every stat and throws nothing", () => {
  // The restored-pre-#449-save path. Three shapes of absence, all silent.
  for (const r of [undefined, {}, { ceilingReport: [] }, { ceilingReport: null }]) {
    assert.strictEqual(P.ceilingFor(r, "Dodge"), null, "no row, no fraction");
    assert.strictEqual(P.ceilingStatement(r), null, "and no orphan full statement");
  }
  // A report that simply lacks THIS stat is the same case.
  assert.strictEqual(P.ceilingFor(_ceilRec([{ stat: "Dodge", achieved: 1, ceiling: 2 }]), "Wisdom"), null);
});

test("#449 U2: a zero ceiling reports itself without claiming the pool lacks the stat", () => {
  const c = P.ceilingFor(_ceilRec([{ stat: "Doubleshot", achieved: 0, ceiling: 0, bonusTypes: [], allFilled: true }]), "Doubleshot");
  assert.strictEqual(c.zeroCeiling, true);
  assert.notStrictEqual(c.maxed, true, "0 / 0 is not a maxed stat");
  const s = c.short.toLowerCase();
  // It may say what THIS solve found. It may not assert a property of the pool,
  // and it must not defer to zeroSourceNotice — that notice tests a pre-gating
  // population and can be absent exactly when the ceiling reads zero.
  for (const bad of ["your pool", "the pool", "no item", "nothing in your", "does not exist", "no source exists"]) {
    assert.ok(!s.includes(bad), `zero-ceiling sentence claims a pool property: "${bad}" in ${c.short}`);
  }
  assert.ok(/this solve/.test(s), `it must scope the claim to this solve: ${c.short}`);
});

test("#449 U2 (KTD7): a stat pinned at its cap is capBound, never maxed", () => {
  const c = P.ceilingFor(_ceilRec([{ stat: "Dodge", achieved: 4, ceiling: 4, allFilled: true }], { Dodge: 4 }), "Dodge");
  assert.strictEqual(c.capBound, true);
  assert.strictEqual(c.maxed, false, "green is reserved for achieved === pool ceiling");
  assert.strictEqual(c.cap, 4);
  const s = c.short.toLowerCase();
  assert.ok(s.includes("cap of 4"), `the sentence names the cap: ${c.short}`);
  // It must NOT carry the maxed claim, which would be false (the pool can raise
  // the stat; the cap will not let it land) and would contradict the capNote
  // rendered inches away on the same card.
  assert.ok(!/no other item in your pool raises it/.test(c.short),
    `cap-bound stat inherited the maxed claim: ${c.short}`);
});

test("#449 U2 (KTD7): a capped stat BELOW its cap does not misname its denominator", () => {
  // min(cap, Σ best) === cap means Σ best >= cap, so the number on screen is the
  // CAP, not the summed per-bucket best. The plain shortfall wording would name
  // the wrong source for its own denominator.
  const c = P.ceilingFor(_ceilRec([{ stat: "Dodge", achieved: 30, ceiling: 100 }], { Dodge: 100 }), "Dodge");
  assert.strictEqual(c.capBound, false, "still short of the cap");
  assert.strictEqual(c.maxed, false);
  assert.strictEqual(c.fraction, "30 / 100");
  assert.ok(/cap of 100/.test(c.short), `the sentence names the cap: ${c.short}`);
  assert.ok(!/sums the best source/.test(c.short),
    `denominator is the cap, but the sentence calls it the summed best: ${c.short}`);
  // And it must not claim the pool could go higher — the clamped report cannot
  // tell "Σ best exceeded the cap" from "Σ best landed exactly on it".
  assert.ok(!/gear pool/.test(c.short), `unprovable claim about the pool: ${c.short}`);
});

test("#449 U2 (KTD7): the maxed sentence is emitted only when capBound is false", () => {
  const MAXED = "at the ceiling: every bonus type carrying this stat holds its best available source, "
    + "so no other item in your pool raises it.";
  assert.strictEqual(P.ceilingFor(_ceilRec([{ stat: "A", achieved: 9, ceiling: 9 }]), "A").short, MAXED);
  // Same numbers, plus a cap that binds them: the maxed sentence must disappear.
  for (const capped of [{ A: 9 }, { A: 5 }]) {
    const c = P.ceilingFor(_ceilRec([{ stat: "A", achieved: 9, ceiling: 9 }], capped), "A");
    assert.strictEqual(c.capBound, true, `cap ${capped.A} binds an achieved of 9`);
    assert.notStrictEqual(c.short, MAXED, `cap ${capped.A} still emitted the maxed sentence`);
  }
  // A cap the stat has not reached leaves the ordinary states intact.
  const under = P.ceilingFor(_ceilRec([{ stat: "A", achieved: 3, ceiling: 9 }], { A: 20 }), "A");
  assert.strictEqual(under.capBound, false);
  assert.strictEqual(under.maxed, false);
});

test("#449 U2: ceilingFor is keyed by stat, never by report order", () => {
  const rows = [
    { stat: "Dodge", achieved: 1, ceiling: 9 },
    { stat: "Wisdom", achieved: 7, ceiling: 7 },
  ];
  assert.strictEqual(P.ceilingFor(_ceilRec(rows), "Wisdom").fraction, "7 / 7");
  assert.strictEqual(P.ceilingFor(_ceilRec(rows.slice().reverse()), "Wisdom").fraction, "7 / 7",
    "a reordered (or filtered) report cannot misalign a sentence to a stat");
});

test("#449 U2 (R18): the denominator field is named for its scope", () => {
  const c = P.ceilingFor(_ceilRec([{ stat: "A", achieved: 30, ceiling: 50 }]), "A");
  assert.ok("ceilingUpperBound" in c, "the number a consumer reads states that it is a bound");
  assert.strictEqual(c.ceilingUpperBound, 50);
  assert.ok(!("ceiling" in c),
    "one name only — a second `ceiling` key is the drift this unit exists to prevent");
});

test("#449 U2 (R15): the full statement is one shared constant, not per-stat text", () => {
  const r = _ceilRec([{ stat: "A", achieved: 1, ceiling: 2 }, { stat: "B", achieved: 2, ceiling: 2 }]);
  assert.strictEqual(P.ceilingStatement(r), P.CEILING_FULL_STATEMENT);
  // The qualification lives ONLY there: repeating it under every card down an
  // eight-priority build turns it into boilerplate nobody reads.
  for (const stat of ["A", "B"]) {
    assert.ok(!P.ceilingFor(r, stat).short.includes("upper bound"),
      `${stat}'s short form duplicated the full statement`);
  }
});

test("#449 U2: project() carries the fraction and the once-per-document statement", () => {
  const rec = {
    name: "C", inputs: { ml: 34, priorities: ["Dodge", "Wisdom"] },
    snapshot: { status: "optimal", chosen: [], setsActive: [],
      effective: { Dodge: 30, Wisdom: 7 }, capped: {},
      ceilingReport: [{ stat: "Dodge", achieved: 30, ceiling: 50 },
        { stat: "Wisdom", achieved: 7, ceiling: 7 }] },
  };
  const v = P.project(rec);
  assert.strictEqual(v.attribution.Dodge.ceiling.fraction, "30 / 50");
  assert.strictEqual(v.attribution.Wisdom.ceiling.maxed, true);
  assert.strictEqual(v.character.ceilingStatement, P.CEILING_FULL_STATEMENT);
  // Pre-#449 restore: no rows, no fraction, no statement — never a zero nobody computed.
  const old = P.project({ name: "C", inputs: { priorities: ["Dodge"] },
    snapshot: { chosen: [], effective: { Dodge: 30 } } });
  assert.strictEqual(old.attribution.Dodge.ceiling, null);
  assert.strictEqual(old.character.ceilingStatement, null);
});

// ---------------------------------------------------------------------------
// #453 U1 — affixStatCoverage. collapseExpansions folds an expansion back to the
// enchantment and deliberately drops the member stat names; this carries them in
// a parallel shape so a collapsed entry can be classified.
// ---------------------------------------------------------------------------

test("#453 U1 (R7/KTD1): a uniform collapsed entry reports every member stat", () => {
  const affixes = [
    { name: "Abjuration", value: 3, type: "Sacred", via: "Sacred Spell Focus Mastery" },
    { name: "Conjuration", value: 3, type: "Sacred", via: "Sacred Spell Focus Mastery" },
    { name: "Evocation", value: 3, type: "Sacred", via: "Sacred Spell Focus Mastery" },
  ];
  const cover = P.affixStatCoverage(affixes);
  const e = cover.get("Sacred Spell Focus Mastery");
  assert.ok(e, "the entry is filed under the key collapseExpansions uses");
  assert.deepStrictEqual(e.stats, ["Abjuration", "Conjuration", "Evocation"]);
  // The collapsed ENTRY carries only the enchantment name, which is exactly why
  // this map has to exist: matching that name against ranked solver stats would
  // file the whole bundle as incidental.
  const collapsed = P.collapseExpansions(affixes);
  assert.strictEqual(collapsed.length, 1);
  assert.strictEqual(collapsed[0].name, "Sacred Spell Focus Mastery");
  assert.ok(!("stats" in collapsed[0]) || collapsed[0].stats === "Sacred Spell Focus Mastery",
    "the collapsed entry still does not carry its members");
});

test("#453 U1: a NON-uniform collapsed entry reports member stats, not its parts strings", () => {
  const affixes = [
    { name: "Armor Class", value: 4, type: "Untyped", via: "Parrying" },
    { name: "Fortitude", value: 2, type: "Untyped", via: "Parrying" },
  ];
  const e = P.affixStatCoverage(affixes).get("Parrying");
  assert.deepStrictEqual(e.stats, ["Armor Class", "Fortitude"]);
  const collapsed = P.collapseExpansions(affixes);
  assert.ok(Array.isArray(collapsed[0].parts), "this is the parts-shaped collapse");
  // parts are pre-rendered LABELS ("Armor Class +4"), not stat names — unusable
  // for classification, which is the other half of why this map exists.
  assert.ok(collapsed[0].parts.some((p) => /\+/.test(p)), "parts carry magnitudes, not bare names");
});

test("#453 U1: a native affix with no via covers its own stat", () => {
  const e = P.affixStatCoverage([{ name: "Constitution", value: 7, type: "Insight" }]).get("Constitution");
  assert.deepStrictEqual(e.stats, ["Constitution"]);
  assert.strictEqual(e.presence, false);
});

test("#453 U1: presence rides along, because a collapsed entry has no bonus type", () => {
  const affixes = [
    { name: "Ghostly", value: 1, type: "Bool", via: "Ghostly Bundle" },
    { name: "Blurry", value: 1, type: "Bool", via: "Ghostly Bundle" },
  ];
  const e = P.affixStatCoverage(affixes).get("Ghostly Bundle");
  assert.strictEqual(e.presence, true, "the group is presence-typed");
  // Proven necessary: the collapsed entry itself reads as NOT presence, so a
  // classifier asking the entry would file a utility bundle as incidental.
  const collapsed = P.collapseExpansions(affixes)[0];
  assert.strictEqual(P.isPresence(collapsed), false,
    "the collapsed entry drops the bonus type, so presence is unreadable from it");
});

test("#453 U1: the coverage key matches what a displayed entry is filed under", () => {
  const affixes = [
    { name: "Abjuration", value: 3, type: "Sacred", via: "Sacred Spell Focus Mastery" },
    { name: "Constitution", value: 7, type: "Insight" },
  ];
  const cover = P.affixStatCoverage(affixes);
  for (const entry of P.collapseExpansions(affixes)) {
    assert.ok(cover.has(P.affixCoverageKey(entry)),
      `the displayed entry ${JSON.stringify(P.affixCoverageKey(entry))} resolves in the coverage map`);
  }
});

test("#453 U1: collapseExpansions is untouched — regression guard", () => {
  // Deliberately NOT proven red. KTD1 forbids widening the collapse: its output
  // feeds affixLabel, the exports and the goldens. This pins that #453 added a
  // parallel shape rather than changing this one.
  const affixes = [
    { name: "Abjuration", value: 3, type: "Sacred", via: "Sacred Spell Focus Mastery" },
    { name: "Conjuration", value: 3, type: "Sacred", via: "Sacred Spell Focus Mastery" },
  ];
  const out = P.collapseExpansions(affixes);
  assert.strictEqual(out.length, 1);
  // No bonus type: the collapse deliberately drops it, because a name like
  // "Sacred Spell Focus Mastery" already speaks it and appending would render
  // the type twice. That omission is also why presence has to ride on the
  // coverage map instead of being read off the entry.
  assert.strictEqual(P.affixLabel(out[0]), "Sacred Spell Focus Mastery +3");
});

// ---------------------------------------------------------------------------
// #539 — the set-pin disclosure. One source of sentences, so the results page
// and every export say the same thing about whether a pin landed.

test("#539: a delivered pin is stated, not left for the player to infer", () => {
  const lines = P.setPinNoticeLines({ setPinReport: [{ set: "Cruel Cut", verdict: "pinned" }] });
  assert.strictEqual(lines.length, 1);
  assert.ok(/delivered it: Cruel Cut/.test(lines[0]), lines[0]);
  assert.ok(/best build that keeps that requirement/.test(lines[0]),
    "a pin costs something, so the optimality claim must be qualified by it");
});

test("#539: each suppression names the set AND what to do about it", () => {
  const lines = P.setPinNoticeLines({ setPinReport: [
    { set: "Quickblade", verdict: "not-owned" },
    { set: "Old Set", verdict: "unreachable", why: "only 1 slot in this pool can carry a piece, and the set needs 2" },
    { set: "Ghost", verdict: "unknown", why: "no set by that name carries a piece threshold in this dataset" },
  ] });
  assert.strictEqual(lines.length, 3, "every suppressed pin gets its own sentence");
  assert.ok(/Set Augments I own/.test(lines[0]), "the unowned case names the control that fixes it");
  assert.ok(/only 1 slot/.test(lines[1]) && /level cap/.test(lines[1]));
  assert.ok(/Ghost/.test(lines[2]));
});

test("#539: a conflict says the pins were dropped and the build still solved", () => {
  const lines = P.setPinNoticeLines({ setPinReport: [
    { set: "A", verdict: "conflict" }, { set: "B", verdict: "conflict" }] });
  assert.strictEqual(lines.length, 1, "one sentence for the whole conflicting group");
  assert.ok(/cannot all be delivered together/.test(lines[0]));
  assert.ok(/dropped so a build could still be solved/.test(lines[0]),
    "the player must know they got an answer, not a refusal");
  assert.ok(/Remove one/.test(lines[0]));
});

test("#539: no pins says nothing at all", () => {
  assert.deepStrictEqual(P.setPinNoticeLines({}), []);
  assert.deepStrictEqual(P.setPinNoticeLines({ setPinReport: [] }), []);
});
