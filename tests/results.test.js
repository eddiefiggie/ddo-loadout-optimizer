// U8 — build-sheet reconstruction tests (pure functions; no DOM).
const assert = require("assert");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

function chosenItem(id, slot, colors, sets, tiers) {
  return {
    slot,
    variant: {
      variant_id: id, slot,
      augment_slots_norm: { colors: colors || [], quarantined: [] },
      set_bonus: (sets || []).map((s) => ({ set: s })),
      parsed_set_bonuses: (tiers || []).map((t) => ({
        set: t.set, pieces_required: t.n, pieces_label: `${t.n} Pieces`,
        affixes: t.affixes.map(([stat, bonus_type, value]) => ({ stat, bonus_type, value, unit: "flat" })),
        flagged: [],
      })),
    },
  };
}

test("assignAugments drops each placed augment into a matching open slot", () => {
  const chosen = [chosenItem("Ring", "Ring", ["Blue"]), chosenItem("Cloak", "Cloak", ["Red"])];
  const placed = [{ variant_id: "SapphireRes5", color: "Blue" }, { variant_id: "RubyStr", color: "Red" }];
  const out = R.assignAugments(chosen, placed);
  assert.deepStrictEqual(out.byIndex.get(0).map((a) => a.variant_id), ["SapphireRes5"]);
  assert.deepStrictEqual(out.byIndex.get(1).map((a) => a.variant_id), ["RubyStr"]);
  assert.strictEqual(out.unplaced.length, 0);
});

test("assignAugments respects per-item color capacity", () => {
  const chosen = [chosenItem("Ring", "Ring", ["Blue"])]; // one Blue slot only
  const placed = [{ variant_id: "A", color: "Blue" }, { variant_id: "B", color: "Blue" }];
  const out = R.assignAugments(chosen, placed);
  assert.strictEqual(out.byIndex.get(0).length, 1, "only one fits the single Blue slot");
  assert.strictEqual(out.unplaced.length, 1);
});

test("assignAugments places a multi-fit augment into a host with the consumed slot color", () => {
  // The Cataclysmic weapon has an Orange slot; a Ring has only a Blue slot. The
  // solver reports a Red augment consuming an Orange slot (multi-fit). It must land
  // on the weapon (the only Orange-slot host), keyed on `slot_color`, not on color.
  const chosen = [chosenItem("Cataclysmic", "Weapon", ["Orange"]), chosenItem("Ring", "Ring", ["Blue"])];
  const placed = [{ variant_id: "RedStr", slot_color: "Orange", color: "Red" }];
  const out = R.assignAugments(chosen, placed);
  assert.strictEqual((out.byIndex.get(0) || []).length, 1, "assigned to the Orange-slot host (index 0)");
  assert.strictEqual(out.byIndex.get(0)[0].slot_color, "Orange", "carries the consumed slot color");
  assert.ok(!out.byIndex.has(1), "not assigned to the Blue-only item");
  assert.strictEqual(out.unplaced.length, 0);
});


// ---- U5: Dino insert assignment + coverage disclosure ----
// Slots and inserts are keyed by `type||category` (KTD1); an insert is a UNIT
// carrying one or more affixes (KTD4).
function chosenBlank(id, slot, slotKeys) {
  return { slot, variant: { variant_id: id, slot, dino_slots_norm: slotKeys || [] } };
}
function placedUnit(dino_type, category, affixes, name) {
  return { dino_type, category, name, affixes, wiki_url: "wiki" };
}
const one = (stat, bonus_type, value) => [{ stat, bonus_type, value, unit: "flat" }];

test("assignDinoInserts drops each placed insert into a matching (type,category) slot", () => {
  const chosen = [chosenBlank("Boots", "Boots", ["Scale||Accessory", "Claw||Accessory"])];
  const placed = [
    placedUnit("Scale", "Accessory", one("Constitution", "Enhancement", 14)),
    placedUnit("Claw", "Accessory", one("Physical Resistance Rating", "Enhancement", 35)),
  ];
  const out = R.assignDinoInserts(chosen, placed);
  const stats = out.byIndex.get(0).map((d) => d.affixes[0].stat).sort();
  assert.deepStrictEqual(stats, ["Constitution", "Physical Resistance Rating"]);
  assert.strictEqual(out.unplaced.length, 0);
});

test("assignDinoInserts respects per-(type,category) slot capacity", () => {
  const chosen = [chosenBlank("Boots", "Boots", ["Scale||Accessory"])]; // one Scale slot
  const placed = [
    placedUnit("Scale", "Accessory", one("Constitution", "Enhancement", 14)),
    placedUnit("Scale", "Accessory", one("Strength", "Enhancement", 14)),
  ];
  const out = R.assignDinoInserts(chosen, placed);
  assert.strictEqual(out.byIndex.get(0).length, 1, "only one fits the single Scale slot");
  assert.strictEqual(out.unplaced.length, 1);
});

test("assignDinoInserts distinguishes a Weapon Scale slot from an Accessory Scale slot", () => {
  const chosen = [chosenBlank("Weapon", "Main Hand", ["Scale||Weapon"])];
  const placed = [placedUnit("Scale", "Accessory", one("Constitution", "Enhancement", 14))];
  const out = R.assignDinoInserts(chosen, placed);
  assert.strictEqual(out.unplaced.length, 1, "an Accessory insert does not fit a Weapon slot");
});

test("coverageNote discloses Dino crafting with all pools optimized and Set-Bonus pending", () => {
  const note = R.coverageNote({ metadata: { dino_coverage: { inserts_eligible: 85, blank_hosts: 11 } } });
  assert.ok(/Isle of Dread Dino crafting/.test(note), "names Dino crafting as optimized");
  assert.ok(/85 inserts across Accessory\/Armor\/Weapon\/Raid/.test(note), "shows the eligible count + pools");
  assert.ok(/Set-Bonus/.test(note), "discloses the deferred Set-Bonus pool honestly");
});

test("craftChips renders the Gem's wildcard set assignment, load-bearing only", () => {
  const gem = { variant_id: "Legendary Gem of Many Facets", wiki_url: "https://ddowiki.com/x" };
  const maps = {
    augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
    jokerByHost: new Map([["Legendary Gem of Many Facets",
      [{ host: "Legendary Gem of Many Facets", group: 0, set: "Legendary Draconic Prophecy" }]]]),
  };
  const chips = R.craftChips(gem, 0, maps).join(" ");
  assert.ok(/Wildcard set: Legendary Draconic Prophecy/.test(chips), "renders the assigned set");
  // A non-Gem item with no joker pick renders no wildcard chip.
  const other = { variant_id: "Some Ring" };
  const chips2 = R.craftChips(other, 1, maps).join(" ");
  assert.ok(!/Wildcard set/.test(chips2), "no wildcard chip for a non-joker item");
});

function membershipMaps(host, set, station) {
  return {
    augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
    jokerByHost: new Map(),
    membershipByHost: new Map([[host, [{ host, set, station }]]]),
  };
}

test("craftChips renders Vecna as 'Awaken Set Bonus' (the only place 'awaken' survives)", () => {
  const host = { variant_id: "Legendary University Mage's Hat", wiki_url: "https://ddowiki.com/x" };
  const maps = membershipMaps("Legendary University Mage's Hat", "Legendary Vol's Influence", "Cannith Repurposing Station");
  const chips = R.craftChips(host, 0, maps).join(" ");
  // esc() HTML-escapes the apostrophe in "Vol's", so match around it.
  assert.ok(/Awaken Set Bonus: Legendary Vol/.test(chips) && /Influence/.test(chips), "renders the awakened set");
  assert.ok(/Cannith Repurposing Station/.test(chips), "names the station");
  const other = { variant_id: "Some Ring" };
  assert.ok(!/Awaken Set Bonus:/.test(R.craftChips(other, 1, maps).join(" ")), "no membership chip for a non-host item");
});

test("craftChips renders Isle-of-Dread Set Bonus as 'Slot Set Bonus augment' (not 'awaken')", () => {
  const host = { variant_id: "Legendary Dino Vest" };
  const maps = membershipMaps("Legendary Dino Vest", "The Legendary Dread Isle's Curse", "Dinosaur Bone crafting");
  const chips = R.craftChips(host, 0, maps).join(" ");
  assert.ok(/Slot Set Bonus augment: The Legendary Dread Isle/.test(chips), "renders the crafted Set Bonus augment");
  assert.ok(!/awaken/i.test(chips), "Dino Set Bonus must not say 'awaken'");
});

test("craftChips uses 'Nearly Completed' and 'Viktranium' (not 'Nearly Complete'/'Lamordia')", () => {
  const v = { variant_id: "Legendary Thing" };
  const maps = {
    augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map([["Legendary Thing", [{ stat: "Charisma", value: 4, bonus_type: "Quality" }]]]),
    rollByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map(), membershipByHost: new Map(),
    vikByItem: new Map([["Legendary Thing", [{ slot_type: "Melancholic", stat: "Constitution", value: 15 }]]]),
  };
  const chips = R.craftChips(v, 0, maps).join(" ");
  assert.ok(/Nearly Completed:/.test(chips) && !/Nearly Complete:/.test(chips.replace(/Nearly Completed/g, "")), "Nearly Completed");
  assert.ok(/Slot Melancholic Viktranium augment:/.test(chips), "Viktranium label");
  assert.ok(!/Lamordia [A-Z]/.test(chips), "no 'Lamordia {type}:' label");
});

test("coverageNote discloses set bonuses now applying to enriched gear", () => {
  const note = R.coverageNote({ metadata: { set_enrichment_coverage: {
    enriched_members_with_set_bonus: 602, distinct_enriched_sets: 79,
    membership_only_sets: ["One with the Swarm", "Legendary Deadly Diabolist"],
    known_undefined_sets: ["Legendary Cooking By the Book"],
  } } });
  assert.ok(/Set bonuses on enriched gear/.test(note), "labels the enriched set-bonus coverage");
  assert.ok(/602 enriched set members/.test(note), "reports the covered count");
  assert.ok(/membership only/.test(note), "discloses membership-only sets honestly");
});

test("coverageNote discloses the ML30-36 endgame band coverage per expansion", () => {
  const note = R.coverageNote({ metadata: { band_coverage: { by_slot: {
    "isle_of_dread/Ring": { band_total: 4, enriched: 4, quarantined: 0, pending: 0 },
    "myth_drannor/Ring": { band_total: 20, enriched: 18, quarantined: 0, pending: 2 },
    "u81/Belt": { band_total: 7, enriched: 6, quarantined: 1, pending: 0 },
  } } } });
  assert.ok(/Endgame band \(ML30-36\)/.test(note), "labels the endgame band");
  assert.ok(/Isle of Dread 4\/4 enriched/.test(note), "rolls up IoD per expansion");
  assert.ok(/Myth Drannor 18\/20 enriched, 2 pending/.test(note), "discloses pending honestly");
  assert.ok(/U81 6\/7 enriched, 1 quarantined/.test(note), "discloses quarantined honestly");
});

test("coverageNote discloses Nearly Complete as optimized once item hosts exist", () => {
  const note = R.coverageNote({ metadata: { nc_coverage: { options_eligible: 68, hosts_activated: 17 } } });
  const optimized = note.split("Coverage:")[0];
  assert.ok(/U81 Nearly Complete crafting/.test(optimized), "NC is listed under Optimized now that hosts exist");
  assert.ok(/17 item hosts/.test(optimized), "discloses the activated host count");
  assert.ok(/68 options/.test(optimized), "discloses the eligible option count");
  assert.ok(!/no U81 item hosts are published/.test(note), "no longer claims hosts are pending");
});

test("coverageNote discloses Viktranium/Lamordia as optimized once hosts exist", () => {
  const note = R.coverageNote({ metadata: { viktranium_coverage: { options_eligible: 194, hosts_active: 43 } } });
  const optimized = note.split("Coverage:")[0];
  assert.ok(/U81 Viktranium \/ Lamordia crafting/.test(optimized), "Viktranium is listed under Optimized once hosts exist");
  assert.ok(/43 item hosts/.test(optimized), "discloses the active host count");
  assert.ok(/194 options/.test(optimized), "discloses the eligible option count");
});

test("coverageNote discloses Sealed-in-Undeath optimized and Fire/Gloom/Mist pending", () => {
  const note = R.coverageNote({ metadata: { seal_coverage: {
    options_eligible: 18, hosts_active: 9, seal_types_pending: ["Fire", "Gloom", "Mist"] } } });
  const [optimized, rest] = note.split("Coverage:");
  assert.ok(/Sealed-in-Undeath seal-slot crafting/.test(optimized), "Undeath seal listed under Optimized once hosts exist");
  assert.ok(/9 item hosts/.test(optimized), "discloses the active seal-host count");
  assert.ok(/18 options/.test(optimized), "discloses the eligible option count");
  assert.ok(/Sealed-in-Fire\/Gloom\/Mist seal pools/.test(rest), "pending seal pools disclosed under Pending");
});

// ---- U7: paperdoll slot-position mapping + inline set tag (KTD2, KTD10) ----
test("slotPosition maps every model-produced slot; Ring splits; unknown -> misc", () => {
  // Every slot the model can produce: WORN_SLOTS + the separately-pushed weapon
  // slots (Main Hand, Rune Arm). Not just WORN_SLOTS — that omits the weapons.
  const PRODUCED = ["Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak",
    "Belt", "Ring", "Gloves", "Boots", "Bracers", "Quiver", "Main Hand", "Rune Arm"];
  for (const s of PRODUCED) {
    const pos = R.slotPosition(s, 0);
    assert.ok(pos && pos !== "misc", `${s} maps to a real paperdoll position (got ${pos})`);
  }
  assert.strictEqual(R.slotPosition("Ring", 0), "ring1", "first ring -> ring1");
  assert.strictEqual(R.slotPosition("Ring", 1), "ring2", "second ring -> ring2");
  // the weapon-row trio
  assert.strictEqual(R.slotPosition("Main Hand", 0), "mainhand");
  assert.strictEqual(R.slotPosition("Quiver", 0), "quiver");
  assert.strictEqual(R.slotPosition("Rune Arm", 0), "offhand", "a chosen Rune Arm fills the adaptive Off Hand cell, never dropped");
  assert.strictEqual(R.slotPosition("Some New Slot", 0), "misc", "unknown slot falls to misc, never dropped");
});

test("paperdollSlot is uniform: name, ML, set name, and a set-highlight frame (R15)", () => {
  const v = { variant_id: "Kopru Bracers", minimum_level: 31, set_bonus: [{ set: "Dread Isle's Curse" }], affixes: [] };
  const html = R.paperdollSlot("Bracers", "bracers", { variant: v, idx: 0 });
  assert.ok(html.includes("Kopru Bracers"), "shows the item name");
  assert.ok(html.includes("ML 31"), "shows the ML");
  assert.ok(html.includes("Dread Isle&#39;s Curse"), "names the set (escaped)");
  assert.ok(html.includes("is-set"), "a set member gets the highlight-frame class");
  // no full affix/craft detail on the cell face (that lives in the Deep Dive)
  assert.ok(!html.includes("<details"), "the cell no longer expands on the paperdoll");
  // a non-member slot carries no set-highlight
  const plain = R.paperdollSlot("Boots", "boots", { variant: { variant_id: "X", minimum_level: 1, set_bonus: [], affixes: [] }, idx: 0 });
  assert.ok(!plain.includes("is-set"), "no highlight on a non-member");
  // an empty cell reads 'empty' (no em-dash)
  const empty = R.paperdollSlot("Boots", "boots", null);
  assert.ok(/>empty</.test(empty) && !empty.includes("—"), "empty cell has no em-dash");
});

test("loadoutDeepDive renders a per-item block with slot, affixes, and set (R5)", () => {
  const result = {
    chosen: [{ slot: "Bracers", variant: { variant_id: "Kopru Bracers", minimum_level: 31, set_bonus: [{ set: "Dread Isle's Curse" }], affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 3, unit: "flat" }] } }],
    breakdown: {}, augmentsPlaced: [], effective: {}, perTarget: {},
  };
  const maps = { augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map() };
  const html = R.loadoutDeepDive(result, { targets: [] }, maps, R.attributionByTarget(result));
  assert.ok(/dd-slot/.test(html) && /Bracers/.test(html), "shows where the item is worn");
  assert.ok(/Kopru Bracers/.test(html) && /Constitution \+3 Insightful/.test(html), "lists the item's affixes");
  assert.ok(/Part of set/.test(html) && /Dread Isle/.test(html), "shows set membership");
});

test("U5/R5: equippedRow tags an Artifact slot with a badge + is-artifact frame", () => {
  const pick = { slot: "Trinket", variant: { variant_id: "Family Blade", minimum_level: 32, artifact: true } };
  const html = R.equippedRow("Trinket", pick, {});
  assert.ok(/pd-badge artifact/.test(html), "renders the Artifact badge");
  assert.ok(/is-artifact/.test(html), "carries the is-artifact frame class");
});

test("U5/R5: a non-Artifact equipped row has no Artifact cue", () => {
  const pick = { slot: "Ring", variant: { variant_id: "Plain Ring", minimum_level: 20 } };
  const html = R.equippedRow("Ring", pick, {});
  assert.ok(!/artifact/i.test(html), "no Artifact badge or frame on ordinary gear");
});

test("U5/R5: Deep Dive mirrors the Artifact cue on its item block", () => {
  const result = {
    chosen: [{ slot: "Trinket", variant: { variant_id: "Family Blade", minimum_level: 32, artifact: true, affixes: [] } }],
    breakdown: {}, augmentsPlaced: [], effective: {}, perTarget: {},
  };
  const maps = { augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map() };
  const html = R.loadoutDeepDive(result, { targets: [] }, maps, R.attributionByTarget(result));
  assert.ok(/dd-artifact/.test(html) && /is-artifact/.test(html), "Deep Dive flags the Artifact item too");
});

test("U5/R6: disclosure fires when box on and no Artifact equipped", () => {
  const result = { chosen: [{ slot: "Ring", variant: { variant_id: "Plain Ring" } }] };
  const html = R.artifactNotice(result, { includeArtifact: true });
  assert.ok(/artifact-notice/.test(html) && /No Artifact could be included/.test(html));
});

test("U5/R6: no disclosure when an Artifact WAS equipped", () => {
  const result = { chosen: [{ slot: "Trinket", variant: { variant_id: "Family Blade", artifact: true } }] };
  assert.strictEqual(R.artifactNotice(result, { includeArtifact: true }), "");
});

test("U5/R6: no disclosure when the box is off", () => {
  const result = { chosen: [{ slot: "Ring", variant: { variant_id: "Plain Ring" } }] };
  assert.strictEqual(R.artifactNotice(result, { includeArtifact: false }), "");
  assert.strictEqual(R.artifactNotice(result, {}), "");
});

test("attributionList shows a set contributor with its yielding slots, no bar (R11,R12)", () => {
  const html = R.attributionList(
    [{ bonus_type: "Insightful", value: 2, source: "Legendary Set", sourceKind: "set", isSet: true, slots: ["Necklace", "Trinket"] }]);
  assert.ok(/set: Legendary Set/.test(html), "set is attributed with a 'set:' prefix");
  assert.ok(/via Necklace, Trinket/.test(html), "lists the equipped slots yielding the set");
  assert.ok(/is-set/.test(html), "carries the is-set styling hook");
  assert.ok(/\+2/.test(html), "states the value");
  assert.ok(!/bar-fill|bar-track/.test(html), "no progress-bar element is emitted");
});

test("attributionList shows a worn contributor with its slot", () => {
  const html = R.attributionList(
    [{ bonus_type: "Enhancement", value: 10, source: "Legendary Ring", sourceKind: "worn", isSet: false, slots: ["Ring"] }]);
  assert.ok(/Ring/.test(html), "names the equipped slot");
  assert.ok(/\+10/.test(html));
});

test("attributionList escapes hostile source text (no raw HTML injection)", () => {
  const html = R.attributionList(
    [{ bonus_type: "Enhancement", value: 5, source: "<img src=x>", sourceKind: "worn", isSet: false, slots: ["<b>x</b>"] }]);
  assert.ok(!/<img/.test(html), "raw tag is escaped");
  assert.ok(/&lt;img/.test(html), "escaped form present");
  assert.ok(!/<b>x<\/b>/.test(html), "slot text is escaped too");
});

// ---- U6: trust story (why-this line + proof panel) ----
function whyResult() {
  return {
    effective: { Constitution: 15 }, perTarget: { Constitution: 15 },
    chosen: [{ slot: "Ring", variant: { variant_id: "R", set_bonus: [], parsed_set_bonuses: [] } }],
    augmentsPlaced: [], setsActive: [],
    breakdown: { Constitution: [{ bonus_type: "Enhancement", value: 15, source: "R", sourceKind: "worn", slot: "Ring", setYieldingSlots: null, hostIds: ["R"] }] },
    computeScale: { variants: 42 }, solveMs: 7,
  };
}

test("whyThisLine names the ranked target an item wins (R8, R9)", () => {
  const html = R.whyThisLine(whyResult(), { slot: "Ring", variant_id: "R" });
  assert.ok(/wins/.test(html) && /Constitution \+15/.test(html), "states the winning target and value");
});

test("whyThisLine has an explicit empty state for a filler pick", () => {
  const html = R.whyThisLine(whyResult(), { slot: "Boots", variant_id: "ZZ" });
  assert.ok(/complete the loadout/.test(html), "a pick winning no target reads as filler, not blank");
});

test("whyThis does not cross-attribute a set win between the two rings (host-id match)", () => {
  // Set "Alpha" is yielded by Ring1 + Necklace only; Ring2 is a non-member.
  const result = {
    effective: { Constitution: 15 }, perTarget: { Constitution: 15 },
    chosen: [
      { slot: "Ring", variant: { variant_id: "R1", set_bonus: [{ set: "Alpha" }], parsed_set_bonuses: [] } },
      { slot: "Ring", variant: { variant_id: "R2", set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Necklace", variant: { variant_id: "N", set_bonus: [{ set: "Alpha" }], parsed_set_bonuses: [] } },
    ],
    augmentsPlaced: [], setsActive: [],
    breakdown: { Constitution: [
      { bonus_type: "Enhancement", value: 10, source: "R1", sourceKind: "worn", slot: "Ring", setYieldingSlots: null, hostIds: ["R1"] },
      { bonus_type: "Insightful", value: 5, source: "Alpha", sourceKind: "set", setYieldingSlots: ["Ring", "Necklace"], hostIds: ["R1", "N"] },
    ] },
  };
  assert.deepStrictEqual(R.whyThis(result, { slot: "Ring", variant_id: "R2" }), [],
    "the non-member ring must NOT claim the set win that only Ring1 yields");
  const r1 = R.whyThis(result, { slot: "Ring", variant_id: "R1" });
  assert.strictEqual(r1[0].value, 15, "Ring1: worn 10 + set 5");
  assert.strictEqual(r1[0].viaSet, true);
  const n = R.whyThis(result, { slot: "Necklace", variant_id: "N" });
  assert.strictEqual(n[0].value, 5, "the necklace contributes via the set only");
});

test("activeSetDetail reports granted stats + yielding slots per active set (R16)", () => {
  const result = {
    setsActive: [{ set: "Alpha", pieces_required: 2 }, { set: "Beta", pieces_required: 3 }],
    chosen: [
      { slot: "Necklace", variant: { set_bonus: [{ set: "Alpha" }], parsed_set_bonuses: [{ set: "Alpha", pieces_required: 2, affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 2, unit: "flat" }] }] } },
      { slot: "Trinket", variant: { set_bonus: [{ set: "Alpha" }], parsed_set_bonuses: [] } },
    ],
  };
  const d = R.activeSetDetail(result);
  const alpha = d.find((s) => s.set === "Alpha");
  assert.deepStrictEqual([...alpha.slots].sort(), ["Necklace", "Trinket"], "yielding slots are both Alpha members");
  assert.strictEqual(alpha.affixes.length, 1, "resolves the 2-piece tier affixes");
  assert.strictEqual(alpha.affixes[0].stat, "Constitution");
  const beta = d.find((s) => s.set === "Beta");
  assert.deepStrictEqual(beta.affixes, [], "an active set with no parsed tier affixes yields []");
});

test("attributionList renders the empty state and the is-augment class", () => {
  assert.ok(/stat-empty|no contributing gear/.test(R.attributionList([])), "empty contributor list shows the no-gear affordance");
  const aug = R.attributionList([{ bonus_type: "Quality", value: 3, source: "Topaz", sourceKind: "augment", isSet: false, slots: ["Ring"] }]);
  assert.ok(/is-augment/.test(aug), "an augment contributor carries the is-augment styling hook");
});

test("safeUrl passes http(s) but neutralizes hostile schemes", () => {
  assert.strictEqual(R.safeUrl("https://ddowiki.com/page/Item"), "https://ddowiki.com/page/Item");
  assert.strictEqual(R.safeUrl("http://example.com"), "http://example.com");
  assert.strictEqual(R.safeUrl("javascript:alert(1)"), "#", "javascript: scheme blocked");
  assert.strictEqual(R.safeUrl("data:text/html,<script>"), "#", "data: scheme blocked");
  assert.strictEqual(R.safeUrl(""), "#");
  assert.strictEqual(R.safeUrl(null), "#");
  // an http(s) url carrying a quote is still escaped (no attribute breakout)
  assert.ok(!/[<>"]/.test(R.safeUrl('https://x/"onmouseover=alert(1)')), "quotes/brackets escaped");
});

test("U8: satisfiedSetDetail lists only satisfied sets with grants and member pieces", () => {
  const build = { chosen: [
    chosenItem("Ring Alpha", "Ring", [], ["Alpha", "Beta"], [
      { set: "Alpha", n: 2, affixes: [["Constitution", "Insightful", 3]] },
      { set: "Beta", n: 3, affixes: [["Dexterity", "Enhancement", 5]] },
    ]),
    chosenItem("Neck Alpha", "Necklace", [], ["Alpha"], [
      { set: "Alpha", n: 2, affixes: [["Constitution", "Insightful", 3]] },
    ]),
  ] };
  const d = R.satisfiedSetDetail(build);
  assert.strictEqual(d.length, 1, "only Alpha (2/2) is satisfied; Beta (1/3) is excluded");
  assert.strictEqual(d[0].set, "Alpha");
  assert.strictEqual(d[0].pieces, 2);
  assert.deepStrictEqual(d[0].members.slice().sort(), ["Neck Alpha", "Ring Alpha"], "lists the equipped pieces composing the set");
  assert.deepStrictEqual(d[0].affixes.map((a) => a.stat), ["Constitution"], "carries the satisfied tier's granted affixes");
});

test("U8: satisfiedSetDetail reports the highest satisfied tier", () => {
  const build = { chosen: [
    chosenItem("A", "Ring", [], ["S"], [
      { set: "S", n: 2, affixes: [["Strength", "Enhancement", 5]] },
      { set: "S", n: 4, affixes: [["Strength", "Enhancement", 10]] }]),
    chosenItem("B", "Necklace", [], ["S"], []),
    chosenItem("C", "Cloak", [], ["S"], []),
    chosenItem("D", "Boots", [], ["S"], []),
  ] };
  const d = R.satisfiedSetDetail(build);
  assert.strictEqual(d[0].pieces, 4, "4 pieces worn -> the 4-piece tier");
  assert.strictEqual(d[0].affixes[0].value, 10, "grants the higher tier's affixes");
});

test("U6: satisfiedSets includes only sets whose piece count meets the threshold", () => {
  const chosen = [
    chosenItem("R", "Ring", [], ["TwoSet", "ThreeSet"], [
      { set: "TwoSet", n: 2, affixes: [["Strength", "Enhancement", 10]] },
      { set: "ThreeSet", n: 3, affixes: [["Dexterity", "Enhancement", 10]] },
    ]),
    chosenItem("N", "Necklace", [], ["TwoSet"], [
      { set: "TwoSet", n: 2, affixes: [["Strength", "Enhancement", 10]] },
    ]),
  ];
  const sat = R.satisfiedSets(chosen);
  assert.ok(sat.has("TwoSet"), "2/2 pieces -> satisfied");
  assert.ok(!sat.has("ThreeSet"), "1/3 pieces -> not satisfied");
});

test("U6: satisfiedSets also counts runtime-completed sets from setsActive", () => {
  // A build with NO static set members but a solver-active set (a Vecna awaken or
  // Gem-of-Facets joker completes it from runtime pieces) must still be satisfied.
  const chosen = [chosenItem("Host", "Ring", [], [], [])];
  const sat = R.satisfiedSets(chosen, [{ set: "Vol's Influence", pieces_required: 3 }]);
  assert.ok(sat.has("Vol's Influence"), "a solver-active set with no static pieces still counts as satisfied");
});

test("U8: satisfiedSetDetail recovers a runtime-completed set from setsActive", () => {
  const build = {
    chosen: [chosenItem("Host", "Ring", [], [], [])],
    setsActive: [{ set: "Vol's Influence", pieces_required: 3 }],
  };
  const d = R.satisfiedSetDetail(build);
  assert.ok(d.some((s) => s.set === "Vol's Influence"), "the awakened/joker set appears in the tab, not dropped");
});

test("U6: loadoutDeepDive glows only satisfied-set pieces, not mere membership", () => {
  const maps = { augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
    jokerByHost: new Map(), membershipByHost: new Map() };
  const tier = [{ set: "Trio", pieces_required: 2, affixes: [{ stat: "Dodge", bonus_type: "Insightful", value: 3, unit: "flat" }] }];
  const mkc = (id, slot) => ({ slot, variant: { variant_id: id, set_bonus: [{ set: "Trio" }], parsed_set_bonuses: tier, affixes: [] } });
  const oneShort = { chosen: [mkc("R", "Ring")], breakdown: {}, augmentsPlaced: [], effective: {}, setsActive: [] };
  const html1 = R.loadoutDeepDive(oneShort, { targets: [] }, maps, R.attributionByTarget(oneShort));
  assert.ok(!/class="dd-item is-set/.test(html1), "1/2 pieces -> no glow");
  assert.ok(/Part of set: Trio/.test(html1), "membership label still shows for a one-short set");
  const complete = { chosen: [mkc("R", "Ring"), mkc("N", "Necklace")], breakdown: {}, augmentsPlaced: [], effective: {}, setsActive: [] };
  const html2 = R.loadoutDeepDive(complete, { targets: [] }, maps, R.attributionByTarget(complete));
  assert.ok(/class="dd-item is-set/.test(html2), "2/2 pieces -> glow");
});

test("U6: a single-piece set (threshold 1) is satisfied when worn", () => {
  const chosen = [chosenItem("R", "Ring", [], ["Solo"],
    [{ set: "Solo", n: 1, affixes: [["Strength", "Enhancement", 5]] }])];
  assert.ok(R.satisfiedSets(chosen).has("Solo"));
});

test("U6: slotSetNames glows only satisfied sets when given the satisfied set", () => {
  const v = { set_bonus: [{ set: "TwoSet" }, { set: "ThreeSet" }] };
  assert.deepStrictEqual(R.slotSetNames(v, new Set(["TwoSet"])), ["TwoSet"], "only the satisfied set glows");
  assert.deepStrictEqual(R.slotSetNames(v).sort(), ["ThreeSet", "TwoSet"], "no filter -> raw membership");
});

test("U6: equippedRow gets is-set only for a satisfied-set piece", () => {
  const pick = { variant: { variant_id: "R", set_bonus: [{ set: "ThreeSet" }] } };
  assert.ok(!/is-set/.test(R.equippedRow("Ring", pick, undefined, new Set())),
    "an unsatisfied set piece does not glow");
  assert.ok(/is-set/.test(R.equippedRow("Ring", pick, undefined, new Set(["ThreeSet"]))),
    "a satisfied set piece glows");
});

test("U4: affixLabel renders a boolean feature as presence, not a magnitude", () => {
  assert.strictEqual(R.affixLabel({ stat: "Salt", bonus_type: "boolean", value: 1, unit: "flat" }), "✓ Salt");
  // a real magnitude affix is unaffected
  assert.strictEqual(R.affixLabel({ stat: "Dodge", bonus_type: "Enhancement", value: 5, unit: "pct" }), "Dodge +5%");
});

console.log(`\n${passed} passed`);
