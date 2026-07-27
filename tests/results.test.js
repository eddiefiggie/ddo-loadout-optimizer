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

test("nearMissSetHints flags a set one piece short that would advance a target", () => {
  // Two equipped pieces of "Elite"; its 3-piece tier gives Dodge and would help.
  const tiers = [{ set: "Elite", n: 3, affixes: [["Dodge", "Insightful", 3]] }];
  const chosen = [
    chosenItem("A", "Ring", [], ["Elite"], tiers),
    chosenItem("B", "Cloak", [], ["Elite"], tiers),
  ];
  const hints = R.nearMissSetHints(chosen, ["Dodge"]);
  assert.strictEqual(hints.length, 1);
  assert.strictEqual(hints[0].set, "Elite");
  assert.strictEqual(hints[0].have, 2);
  assert.strictEqual(hints[0].need, 3);
});

test("nearMissSetHints stays silent when the next tier helps no target", () => {
  const tiers = [{ set: "Elite", n: 3, affixes: [["Dodge", "Insightful", 3]] }];
  const chosen = [
    chosenItem("A", "Ring", [], ["Elite"], tiers),
    chosenItem("B", "Cloak", [], ["Elite"], tiers),
  ];
  assert.strictEqual(R.nearMissSetHints(chosen, ["Strength"]).length, 0);
});

test("nearMissSetHints stays silent when not exactly one short", () => {
  const tiers = [{ set: "Elite", n: 3, affixes: [["Dodge", "Insightful", 3]] }];
  const chosen = [chosenItem("A", "Ring", [], ["Elite"], tiers)]; // only 1 of 3
  assert.strictEqual(R.nearMissSetHints(chosen, ["Dodge"]).length, 0);
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

test("slotDetailChips renders the Gem's wildcard set assignment, load-bearing only", () => {
  const gem = { variant_id: "Legendary Gem of Many Facets", wiki_url: "https://ddowiki.com/x" };
  const maps = {
    augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
    jokerByHost: new Map([["Legendary Gem of Many Facets",
      [{ host: "Legendary Gem of Many Facets", group: 0, set: "Legendary Draconic Prophecy" }]]]),
  };
  const html = R.slotDetailChips(gem, 0, { targets: ["Universal Spell Power"] }, maps);
  assert.ok(/Wildcard set: Legendary Draconic Prophecy/.test(html), "renders the assigned set");
  // A non-Gem item with no joker pick renders no wildcard chip.
  const other = { variant_id: "Some Ring" };
  const html2 = R.slotDetailChips(other, 1, { targets: ["Universal Spell Power"] }, maps);
  assert.ok(!/Wildcard set/.test(html2), "no wildcard chip for a non-joker item");
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

// ---- U4: paperdoll slot-position mapping (KTD2) ----
test("slotPosition maps every worn slot; Ring splits by index; unknown -> misc", () => {
  const WORN = ["Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak",
    "Belt", "Ring", "Gloves", "Boots", "Bracers", "Quiver", "Main Hand", "Rune Arm"];
  for (const s of WORN) {
    const pos = R.slotPosition(s, 0);
    assert.ok(pos && pos !== "misc", `${s} maps to a real paperdoll position (got ${pos})`);
  }
  assert.strictEqual(R.slotPosition("Ring", 0), "ring1", "first ring -> ring1");
  assert.strictEqual(R.slotPosition("Ring", 1), "ring2", "second ring -> ring2");
  assert.strictEqual(R.slotPosition("Main Hand", 0), "mainhand");
  assert.strictEqual(R.slotPosition("Rune Arm", 0), "offhand", "rune arm shares the off-hand cell");
  assert.strictEqual(R.slotPosition("Some New Slot", 0), "misc", "unknown slot falls to misc, never dropped");
});

test("breakdownBars attributes a set contribution and marks it (R7)", () => {
  const html = R.breakdownBars(
    [{ bonus_type: "Insightful", value: 2, source: "Legendary Set", sourceKind: "set" }], 2);
  assert.ok(/set: Legendary Set/.test(html), "set source is attributed with a 'set:' prefix");
  assert.ok(/is-set/.test(html), "set contribution carries the is-set styling hook");
  assert.ok(/\+2/.test(html), "shows the folded value");
});

test("breakdownBars escapes hostile source text (no raw HTML injection)", () => {
  const html = R.breakdownBars(
    [{ bonus_type: "Enhancement", value: 5, source: "<img src=x>", sourceKind: "worn" }], 5);
  assert.ok(!/<img/.test(html), "raw tag is escaped");
  assert.ok(/&lt;img/.test(html), "escaped form present");
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

console.log(`\n${passed} passed`);
