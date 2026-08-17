// U6 — the shared content projection. Run: node tests/projection.test.js
const assert = require("assert");
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
