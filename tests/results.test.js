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
  assert.ok(/Dinosaur Bone Set Bonus/.test(note), "discloses the deferred Set Bonus augment pool honestly");
});

test("#316: coverageNote discloses the set-augment placement rule from the defs, incl. the Moon/Sun exclusion", () => {
  const seven = ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"];
  const note = R.coverageNote({
    metadata: {},
    augment_set_defs: { SetX: { tiers: [], fits_slots: seven.slice() } },
  });
  assert.ok(/Set Augments:/.test(note), "the placement-rule line renders");
  assert.ok(/any standard augment color slot/.test(note), "states the any-color rule the defs carry");
  assert.ok(/Lunar\/Solar \(Moon\/Sun\) slots belong to the separate gem system/.test(note), "disclosed exclusion, read from the defs");
  // No defs -> no claim (never fabricate a rule about absent data).
  const bare = R.coverageNote({ metadata: {} });
  assert.ok(!/Set Augments:/.test(bare), "no defs -> no placement-rule line");
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

test("craftChips membership label IS the registry's actionLabel output (no drift)", () => {
  // The chip must render exactly what crafting-systems.js produces, so a
  // terminology edit in the registry can never silently diverge from the UI.
  const CS = require("../web/crafting-systems.js");
  const vec = R.craftChips({ variant_id: "V" },
    0, membershipMaps("V", "Legendary Vol's Influence", "Cannith Repurposing Station")).join(" ");
  assert.ok(vec.includes(R.esc(CS.actionLabel("vecna-lost-purpose", { set_name: "Legendary Vol's Influence" }))),
    "Vecna chip text equals the registry label");
  const dino = R.craftChips({ variant_id: "D" },
    0, membershipMaps("D", "Legendary Dread Stalker", "Dinosaur Bone crafting")).join(" ");
  assert.ok(dino.includes(R.esc(CS.actionLabel("isle-of-dread-set-bonus", { set_name: "Legendary Dread Stalker" }))),
    "Dino chip text equals the registry label");
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

test("U7: craftChips renders a placed Set Augment on its host with the suppression note", () => {
  const v = { variant_id: "Vol Amulet", set_bonus: [{ set: "Vol Set" }] };
  const maps = {
    augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
    jokerByHost: new Map(), membershipByHost: new Map(),
    setAugByHost: new Map([["Vol Amulet", [{ set: "Legendary Prowess", host: "Vol Amulet" }]]]),
  };
  const chips = R.craftChips(v, 0, maps).join(" ");
  assert.ok(/Set Augment: Legendary Prowess/.test(chips), "renders the placed Set Augment");
  assert.ok(/suppresses Vol Set/.test(chips), "names the suppressed own set");
  assert.ok(!/Set Augment:/.test(R.craftChips({ variant_id: "Some Ring" }, 1, maps).join(" ")), "no chip for a non-host item");
});

test("U7: satisfiedSets drops a set whose remaining member hosts a Set Augment", () => {
  const chosen = [
    { variant: { variant_id: "A", set_bonus: [{ set: "S" }], parsed_set_bonuses: [{ set: "S", pieces_required: 2 }] } },
    { variant: { variant_id: "B", set_bonus: [{ set: "S" }], parsed_set_bonuses: [{ set: "S", pieces_required: 2 }] } },
  ];
  assert.ok(R.satisfiedSets(chosen, []).has("S"), "S is complete at 2 pieces with no suppression");
  assert.ok(!R.satisfiedSets(chosen, [], new Set(["B"])).has("S"), "S falls to 1 piece when B hosts a Set Augment");
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
  assert.ok(/Nearly Completed crafting/.test(optimized), "NC is listed under Optimized now that hosts exist");
  assert.ok(/17 item hosts/.test(optimized), "discloses the activated host count");
  assert.ok(/68 options/.test(optimized), "discloses the eligible option count");
  assert.ok(!/no U81 item hosts are published/.test(note), "no longer claims hosts are pending");
});

test("coverageNote discloses Viktranium/Lamordia as optimized once hosts exist", () => {
  const note = R.coverageNote({ metadata: { viktranium_coverage: { options_eligible: 194, hosts_active: 43 } } });
  const optimized = note.split("Coverage:")[0];
  assert.ok(/Viktranium Experiment crafting/.test(optimized), "Viktranium is listed under Optimized once hosts exist");
  assert.ok(/43 item hosts/.test(optimized), "discloses the active host count");
  assert.ok(/194 options/.test(optimized), "discloses the eligible option count");
});

test("coverageNote lists the sourced seal types and drops the pending clause when none remain", () => {
  const note = R.coverageNote({ metadata: { seal_coverage: {
    options_eligible: 48, hosts_active: 95,
    seal_types_sourced: ["Fire", "Gloom", "Mist", "Undeath"], seal_types_pending: [] } } });
  const [optimized, rest] = note.split("Coverage:");
  assert.ok(/Sealed-in-Fire\/Gloom\/Mist\/Undeath seal-slot crafting/.test(optimized),
    "the sourced seal types render dynamically under Optimized");
  assert.ok(/95 item hosts/.test(optimized), "discloses the active seal-host count");
  assert.ok(/48 options/.test(optimized), "discloses the eligible option count");
  assert.ok(!/seal pools \(hosts identified/.test(rest), "no pending-seal clause once every pool is sourced");
});

test("coverageNote still discloses pending seal pools when some remain unsourced", () => {
  const note = R.coverageNote({ metadata: { seal_coverage: {
    options_eligible: 18, hosts_active: 9,
    seal_types_sourced: ["Undeath"], seal_types_pending: ["Fire", "Gloom", "Mist"] } } });
  const [optimized, rest] = note.split("Coverage:");
  assert.ok(/Sealed-in-Undeath seal-slot crafting/.test(optimized), "sourced type listed under Optimized");
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

const ring = (id) => ({ slot: "Ring", variant: { variant_id: id, minimum_level: 20 } });

test("U4/F2: a Ring row badges 'pinned' only when ITS variant is in the pin list", () => {
  const sc = { Ring: { type: "pin", variant_ids: ["R1", "R2"] } };
  assert.ok(/pd-badge pin/.test(R.equippedRow("Ring", ring("R1"), sc)), "R1 pinned -> badge");
  assert.ok(/pd-badge pin/.test(R.equippedRow("Ring", ring("R2"), sc)), "R2 pinned -> badge");
  assert.ok(!/pd-badge pin/.test(R.equippedRow("Ring", ring("R3"), sc)), "R3 not pinned -> no lying badge");
});

test("U4/F2: with only one ring pinned, the other ring row shows no pinned badge", () => {
  const sc = { Ring: { type: "pin", variant_ids: ["R1"] } };
  assert.ok(/pd-badge pin/.test(R.equippedRow("Ring", ring("R1"), sc)));
  assert.ok(!/pd-badge pin/.test(R.equippedRow("Ring", ring("R2"), sc)));
});

test("U4/F1: the Free button targets the row's own variant (frees one ring, not the slot)", () => {
  const sc = { Ring: { type: "pin", variant_ids: ["R1", "R2"] } };
  const r2 = R.equippedRow("Ring", ring("R2"), sc);
  assert.ok(/data-act="free"[^>]*data-variant="R2"/.test(r2), "free carries this ring's variant");
});

test("U4: a single-slot pin badges its row (regression)", () => {
  const sc = { Trinket: { type: "pin", variant_id: "Hydra's Heart" } };
  const html = R.equippedRow("Trinket", { slot: "Trinket", variant: { variant_id: "Hydra's Heart", minimum_level: 30 } }, sc);
  assert.ok(/pd-badge pin/.test(html));
});

// ---- U2 (Plan B) — assigned augments + affixes + craft slots in blocks ----
function blockMaps(o) {
  o = o || {};
  return {
    augAssign: { byIndex: o.byIndex || new Map(), freeByIndex: o.freeByIndex || new Map() },
    dinoAssign: { byIndex: o.dinoByIndex || new Map() },
    ncByItem: o.ncByItem || new Map(), rollByItem: o.rollByItem || new Map(),
    vikByItem: o.vikByItem || new Map(), sealByItem: o.sealByItem || new Map(),
    tfByItem: o.tfByItem || new Map(), gsByItem: o.gsByItem || new Map(),
  };
}

test("U2/AE2: a filled augment slot shows the augment name and the affixes it adds", () => {
  const v = { variant_id: "Ring1", affixes: [{ stat: "Constitution", bonus_type: "Enhancement", value: 10, unit: "flat" }] };
  const maps = blockMaps({ byIndex: new Map([[0, [{ variant_id: "Sapphire of Con", color: "Blue" }]]]) });
  const augById = new Map([["Sapphire of Con", { variant_id: "Sapphire of Con", affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 3, unit: "flat" }] }]]);
  const html = R.equippedBody(v, 0, maps, augById);
  assert.ok(/Sapphire of Con/.test(html), "shows the assigned augment name");
  assert.ok(/Constitution \+3 Insightful/.test(html), "shows the affixes the augment adds");
});

test("U2/AE2: an empty augment slot is shown as open", () => {
  const v = { variant_id: "Ring1", affixes: [] };
  const maps = blockMaps({ freeByIndex: new Map([[0, ["Red"]]]) });
  const html = R.equippedBody(v, 0, maps, new Map());
  assert.ok(/open Red slot/.test(html), "an unfilled augment slot reads as open");
});

test("U2/AE3: an assigned craft slot is declared with its applied value", () => {
  const v = { variant_id: "Cloak1", affixes: [] };
  const maps = blockMaps({ ncByItem: new Map([["Cloak1", [{ stat: "Constitution", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const html = R.equippedBody(v, 0, maps, new Map());
  assert.ok(/Craft/.test(html) && /Nearly Completed: Constitution \+15/.test(html), "declares the craft slot + shows the assignment");
});

test("U2/AE3: an item with no craft assignment renders nothing extra for crafts", () => {
  const v = { variant_id: "Bare1", affixes: [{ stat: "Strength", bonus_type: "Enhancement", value: 8, unit: "flat" }] };
  const html = R.equippedBody(v, 0, blockMaps(), new Map());
  assert.ok(!/<span class="pd-slabel">Craft<\/span>/.test(html), "no Craft row when nothing is assigned (unfilled slots are not enumerated)");
});

test("U2/KTD2: an augment whose affixes can't be resolved renders its name without crashing", () => {
  const v = { variant_id: "Ring1", affixes: [] };
  const maps = blockMaps({ byIndex: new Map([[0, [{ variant_id: "Mystery Aug", color: "Green" }]]]) });
  const html = R.equippedBody(v, 0, maps, new Map());   // empty augById -> no affix lookup
  assert.ok(/Mystery Aug/.test(html), "still names the augment");
  assert.ok(!/aug-affx/.test(html), "no affix span when affixes are unresolvable");
});

test("U2/AE4: filled and bare occupied blocks share the same container (uniform size)", () => {
  const heavy = { slot: "Ring", variant: { variant_id: "Heavy", minimum_level: 34,
    affixes: [{ stat: "Constitution", bonus_type: "Enhancement", value: 10, unit: "flat" }] } };
  const bare = { slot: "Ring", variant: { variant_id: "Bare", minimum_level: 34, affixes: [] } };
  const maps = blockMaps({ byIndex: new Map([[0, [{ variant_id: "A1", color: "Blue" }, { variant_id: "A2", color: "Red" }]]]),
    ncByItem: new Map([["Heavy", [{ stat: "Strength", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const augById = new Map([["A1", { variant_id: "A1", affixes: [] }], ["A2", { variant_id: "A2", affixes: [] }]]);
  const heavyHtml = R.equippedRow("Ring", heavy, {}, undefined, maps, augById);
  const bareHtml = R.equippedRow("Ring", bare, {}, undefined, blockMaps(), new Map());
  // Uniform sizing is enforced by CSS (.pd-row min-height + grid stretch); assert
  // the structural invariant that both are the same occupied container with no
  // inline sizing that would break the grid. Pixel parity is the browser pass.
  assert.ok(/class="pd-row occupied/.test(heavyHtml) && /class="pd-row occupied/.test(bareHtml), "both are occupied blocks");
  assert.ok(!/style=/.test(heavyHtml) && !/style=/.test(bareHtml), "no inline sizing that would defeat the uniform grid");
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

test("#227: an untyped contributor reads \"untyped\", not the literal null", () => {
  const html = R.attributionList(
    [{ bonus_type: null, value: 5, source: "Legendary Webs of the Drow Penitent", sourceKind: "worn", isSet: false, slots: ["Armor"] }]);
  assert.ok(/untyped/.test(html), "names the bucket");
  assert.ok(!/null/.test(html), "the raw value never reaches the receipts");
  assert.ok(/\+5/.test(html), "and it is still a magnitude, not a feature tick");
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

test("whyThisLine names the ranked contribution with its bonus type (R8, R9 + plan 2026-08-12-001 U3)", () => {
  const html = R.whyThisLine(whyResult(), { slot: "Ring", variant_id: "R" });
  assert.ok(/Constitution \+15 Enhancement/.test(html), "states stat, value, and bonus type");
  assert.ok(/pd-prio/.test(html), "renders the contribution-summary line");
  assert.ok(!/at-ceiling/.test(html), "no saturation report, no green");
});

test("#446 U4 (R17a/AE6): a saturated stat's gear-box span carries no ceiling marker, and keeps its label", () => {
  const res = whyResult();
  res.saturationReport = [{ stat: "Constitution", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const html = R.whyThisLine(res, { slot: "Ring", variant_id: "R" });
  assert.ok(!/at-ceiling/.test(html), "one item is not the whole stat, so it makes no claim about one");
  assert.ok(!/at its ceiling of 15/.test(html), "and the stat-level sentence does not ride an item span");
  assert.ok(/Constitution \+15 Enhancement/.test(html), "the contribution itself still renders in full");
  assert.ok(/class="pd-contrib"/.test(html), "as a plain span — the marker went, the span did not");
});

test("plan 2026-08-12-001 U3: same-stat contributions list separately and the cap is three", () => {
  const res = whyResult();
  res.breakdown.Constitution.push(
    { bonus_type: "Insight", value: 7, source: "Topaz", sourceKind: "augment", hostIds: ["R"] });
  res.breakdown.Deadly = [
    { bonus_type: "Quality", value: 4, source: "R", sourceKind: "worn", slot: "Ring", hostIds: ["R"] }];
  res.breakdown.Dodge = [
    { bonus_type: "Enhancement", value: 3, source: "R", sourceKind: "worn", slot: "Ring", hostIds: ["R"] }];
  const html = R.whyThisLine(res, { slot: "Ring", variant_id: "R" });
  assert.ok(/Constitution \+15 Enhancement/.test(html) && /Constitution \+7 Insight/.test(html),
    "both bonus types of the same stat are separate spans — merging would erase the fact");
  assert.strictEqual((html.match(/pd-contrib/g) || []).length, 3, "capped at three contributions");
});

test("plan 2026-08-12-001 U3: a boolean contribution reads as a feature tick", () => {
  const res = whyResult();
  res.breakdown["Ghost Touch"] = [
    { bonus_type: "Bool", value: 1, source: "R", sourceKind: "worn", slot: "Ring", hostIds: ["R"] }];
  const html = R.whyThisLine(res, { slot: "Ring", variant_id: "R" }, null, ["Ghost Touch"]);
  assert.ok(/✓ Ghost Touch/.test(html), "presence, not a magnitude");
  assert.ok(!/\+1/.test(html), "no fake +1");
});

test("#278: a snapshot without effective renders zeroed cards, not a TypeError", () => {
  const build = { status: "optimal", chosen: [], setsActive: [], augmentsPlaced: [], breakdown: {} };
  const v = R.buildViews(build, { worn: [], augments: [] }, { targets: ["Constitution"] });
  assert.ok(/data-final="0"/.test(v.cards), "a missing effective reads as 0 across the receipt cards");
});

test("#278: the stale-save notice fires exactly when an optimal result lacks effective", () => {
  assert.ok(/predates|re-solve/i.test(R.staleSnapshotNotice({ status: "optimal", chosen: [] })),
    "names the fact and the remedy");
  assert.strictEqual(R.staleSnapshotNotice({ status: "optimal", chosen: [], effective: {} }), "",
    "silent on a current-format save");
  assert.strictEqual(R.staleSnapshotNotice({ status: "infeasible" }), "", "silent on a non-optimal result");
});

test("#276: the receipt card marks an at-ceiling stat with the shared sentence", () => {
  const b = satBuild();
  const chip = R.ceilingChip(b, "Kinetic Lore");
  assert.ok(/at ceiling/.test(chip) && /at-ceiling/.test(chip), "green marker in the stat-cap idiom");
  assert.ok(/at its ceiling of 30/.test((chip.match(/title="([^"]*)"/) || [])[1] || ""),
    "the shared sentence rides the chip tooltip");
  assert.strictEqual(R.ceilingChip(b, "Physical Sheltering"), "", "no chip for an unsaturated stat");
  assert.strictEqual(R.ceilingChip(satBuild({ saturation: false }), "Kinetic Lore"), "", "no report, no chip");
});

test("#276: buildViews puts the chip on the saturated stat's card only", () => {
  const b = satBuild();
  b.effective = { "Kinetic Lore": 30, "Physical Sheltering": 12 };
  const v = R.buildViews(b, { worn: [], augments: [] }, { targets: ["Kinetic Lore", "Physical Sheltering"] });
  const cards = v.cards.split("stat-card").filter((c) => /stat-name/.test(c));
  assert.strictEqual(cards.length, 2, "both ranked cards render");
  assert.ok(/stat-ceiling/.test(cards[0]) && /Kinetic Lore/.test(cards[0]), "the saturated stat carries the marker");
  assert.ok(!/stat-ceiling/.test(cards[1]) && /Physical Sheltering/.test(cards[1]), "the unsaturated stat does not");
});

test("#276: no per-stat ceiling claim on a degenerate save whose totals are unavailable", () => {
  const b = satBuild();
  delete b.effective;
  const v = R.buildViews(b, { worn: [], augments: [] }, { targets: ["Kinetic Lore"] });
  assert.ok(!/stat-ceiling/.test(v.cards), "a zeroed card never wears an at-ceiling chip");
});

test("plan 2026-08-12-001 U3/R4 + #446 U4: the Deep Dive block carries the same summary, now without green", () => {
  const res = whyResult();
  res.saturationReport = [{ stat: "Constitution", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const maps = { augAssign: { byIndex: new Map(), freeByIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map() };
  const html = R.loadoutDeepDive(res, { targets: ["Constitution"] }, maps, R.attributionByTarget(res));
  assert.ok(/pd-prio/.test(html), "the Deep Dive block renders the priority summary");
  assert.ok(/Constitution \+15 Enhancement/.test(html), "same contribution content as the Loadout row");
  // #446 U4 — this surface reached the marker independently of the Loadout row,
  // so it needs its own guard that the removal covered it too.
  assert.ok(!/at-ceiling/.test(html), "the Deep Dive reaches the same spans, and they are unmarked here too");
});

test("plan 2026-08-12-001 U3: an untyped contribution reads \"untyped\", never the literal null", () => {
  const res = whyResult();
  res.breakdown.Constitution = [
    { bonus_type: null, value: 5, source: "R", sourceKind: "worn", slot: "Ring", hostIds: ["R"] }];
  const html = R.whyThisLine(res, { slot: "Ring", variant_id: "R" });
  assert.ok(/Constitution \+5 untyped/.test(html), "names the bucket");
  assert.ok(!/null/.test(html), "the raw value never reaches the box");
});

test("plan 2026-08-12-001 U3: a set-carried contribution keeps its (set) marker", () => {
  const res = whyResult();
  res.breakdown.Constitution.push(
    { bonus_type: "Insightful", value: 5, source: "Alpha", sourceKind: "set", setYieldingSlots: ["Ring"], hostIds: ["R"] });
  const html = R.whyThisLine(res, { slot: "Ring", variant_id: "R" });
  assert.ok(/Constitution \+5 Insightful \(set\)/.test(html), "the set provenance stays visible per contribution");
});

test("plan 2026-08-12-001 U3: equippedRow renders the summary only when the context is threaded", () => {
  const res = whyResult();
  res.saturationReport = [{ stat: "Constitution", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const pick = { variant: res.chosen[0].variant, idx: 0 };
  const withCtx = R.equippedRow("Ring", pick, {}, new Set(), null, null, null, null,
    { result: res, attr: R.attributionByTarget(res), targets: ["Constitution"] });
  assert.ok(/pd-prio/.test(withCtx) && /Constitution \+15 Enhancement/.test(withCtx), "summary at the bottom of the box");
  // #446 U4 — the third surface that reached the marker. Guarded separately for
  // the same reason: each threads its own context into whyThisLine.
  assert.ok(!/at-ceiling/.test(withCtx), "and the row path renders no marker either");
  const withoutCtx = R.equippedRow("Ring", pick, {}, new Set(), null, null, null, null);
  assert.ok(!/pd-prio/.test(withoutCtx), "pure-test callers render no summary and no crash");
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

test("activeSetDetail surfaces a membership set's affixes from setsActive (Vecna awaken)", () => {
  // A craftable-membership set (Lost Purpose awaken): the host carries no static
  // parsed_set_bonuses, so the granted affixes exist only on the setsActive entry.
  const result = {
    setsActive: [{ set: "Legendary Devils' Infernal Dance", pieces_required: 3, affixes: [
      { stat: "Intelligence", bonus_type: "Artifact", value: 3, unit: "flat" },
      { stat: "Doublestrike", bonus_type: "Artifact", value: 15, unit: "flat" },
    ] }],
    chosen: [{ slot: "Armor", variant: { set_bonus: [], parsed_set_bonuses: [] } }],
  };
  const set = R.activeSetDetail(result).find((s) => s.set === "Legendary Devils' Infernal Dance");
  assert.strictEqual(set.pieces, 3);
  assert.strictEqual(set.affixes.length, 2, "affixes come from setsActive, not the empty member tiers");
  assert.ok(set.affixes.some((a) => a.stat === "Intelligence" && a.value === 3), "the umbrella-expanded Intelligence shows");
  // and it renders through the Set-tab expander, not just the raw detail
  assert.ok(/Intelligence \+3 Artifact/.test(R.satisfiedSetDetail(result).map((s) => s.affixes.map(R.affixLabel).join(", ")).join(" | ")));
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
  // U4/R10 — a member is {slot, item, kind}, so the tab can name the slot each
  // piece occupies rather than a bare item name.
  assert.deepStrictEqual(d[0].members.slice().sort((a, b) => a.item < b.item ? -1 : 1), [
    { slot: "Necklace", item: "Neck Alpha", kind: "intrinsic" },
    { slot: "Ring", item: "Ring Alpha", kind: "intrinsic" },
  ], "lists the equipped pieces composing the set, each with its slot");
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
  assert.ok(d.some((s) => s.set === "Vol's Influence"), "the chosen-membership/joker set appears in the tab, not dropped");
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

test("U8: buildViews Set Bonuses panel lists active solar/lunar augments as set-like bonuses", () => {
  const mkBuild = (augs) => ({
    chosen: [{ slot: "Goggles", variant: { variant_id: "Specs", affixes: [], augment_slots_norm: { colors: ["blue"] } } }],
    breakdown: {}, effective: {}, setsActive: [], augmentsPlaced: augs,
  });
  const model = { worn: [], augments: [] };
  const withAug = mkBuild([{ variant_id: "Lunar Gem of Negative Amplification", color: "blue", affixes: [{ name: "Negative Amplification", type: "Enhancement", value: 61 }] }]);
  const v1 = R.buildViews(withAug, model, { targets: [] });
  assert.ok(/Other set-like bonuses/.test(v1.setsPanel), "the set-like section renders when a lunar/solar augment is placed");
  assert.ok(/🌙 Lunar/.test(v1.setsPanel) && /Lunar Gem of Negative Amplification/.test(v1.setsPanel), "lists the lunar augment");
  assert.ok(/Negative Amplification \+61/.test(v1.setsPanel),
    "names the NUMBERS it grants, not just the augment name");

  // Regression: the solver's placement record used to carry no `affixes` at all,
  // so this panel rendered name-only in the real app while this test passed on a
  // fixture that invented the field. Pin BOTH shapes — the enriched record above,
  // and a legacy record (no affixes) that must recover them from the catalog.
  const legacy = mkBuild([{ variant_id: "Lunar Gem of Melee Power (Legendary)", color: "Moon" }]);
  const catalog = { worn: [], augments: [
    { variant_id: "Lunar Gem of Melee Power (Legendary)", affixes: [{ name: "Melee Power", type: "Profane", value: 15 }] },
  ] };
  const v3 = R.buildViews(legacy, catalog, { targets: [] });
  assert.ok(/Melee Power \+15 Profane/.test(v3.setsPanel),
    "a build saved before the solver carried affixes still resolves them from the catalog");

  const noAug = mkBuild([{ variant_id: "Ruby of Deadly", color: "red", affixes: [{ name: "Deadly", type: "Insight", value: 9 }] }]);
  const v2 = R.buildViews(noAug, model, { targets: [] });
  assert.ok(!/Other set-like bonuses/.test(v2.setsPanel), "no set-like section when no solar/lunar augment is placed");
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
  // Legacy-shaped input (the fallback path — also covers a pre-overhaul persisted
  // snapshot / the not-yet-native crafting-pool + set-bonus affixes).
  assert.strictEqual(R.affixLabel({ stat: "Salt", bonus_type: "boolean", value: 1, unit: "flat" }), "✓ Salt");
  assert.strictEqual(R.affixLabel({ stat: "Dodge", bonus_type: "Enhancement", value: 5, unit: "pct" }), "Dodge +5%");
});

test("U5: affixLabel reads NATIVE {name,type} (the migrated primary path)", () => {
  // Native item affixes carry {name,type}; the formatter reads them native-first.
  assert.strictEqual(R.affixLabel({ name: "Salt", type: "boolean", value: 1, unit: "flat" }), "✓ Salt");
  assert.strictEqual(R.affixLabel({ name: "Dodge", type: "Enhancement", value: 5, unit: "pct" }), "Dodge +5%");
  assert.strictEqual(R.affixLabel({ name: "Constitution", type: "Insightful", value: 7, unit: "flat" }), "Constitution +7 Insightful");
});

test("U5: boundNotice discloses the ML band, an unmet floor, and a held cap", () => {
  const note = R.boundNotice(
    { mlFloor: 32, targetCaps: { Dodge: 4 } },
    { perTarget: { Dodge: 4 }, floorReport: [{ stat: "PRR", floor: 300, achieved: 274 }] });
  assert.ok(/ML ≥ 32/.test(note), "shows the considered ML band");
  assert.ok(/Couldn't reach your floor of 300 PRR/.test(note), "reports the unmet floor");
  assert.ok(/best achievable was 274/.test(note));
  assert.ok(/Held at your cap: Dodge 4/.test(note), "notes the cap that held");
});

test("U5: boundNotice is empty when nothing bounded the solve", () => {
  assert.strictEqual(R.boundNotice({ mlFloor: 0, targetCaps: {} }, { perTarget: {}, floorReport: [] }), "");
});


// --- U6/U7: empty-slot reason note + owned-vs-recommended marking ----------
test("U6/AE5: an optimizer-left-empty slot shows the improvement reason note", () => {
  const html = R.equippedRow("Goggles", null, {});
  assert.ok(/pd-rnote/.test(html), "renders a reason note");
  assert.ok(/No item here improves your ranked priorities/.test(html));
});

test("U6: a user-locked-empty slot shows NO reason note (only the locked badge)", () => {
  const html = R.equippedRow("Goggles", null, { Goggles: { type: "empty" } });
  assert.ok(/locked empty/.test(html), "shows the locked-empty badge");
  assert.ok(!/pd-rnote/.test(html), "no false 'improves' reason note on a locked slot");
});

test("U6/AE5a: owned mode with no owned item for the slot says 'you own no item'", () => {
  const html = R.equippedRow("Goggles", null, {}, null, null, null, { mode: true, slotsCovered: new Set() });
  assert.ok(/You own no item for this slot/.test(html));
});

test("U6/AE5a: owned mode with owned items that don't help says so distinctly", () => {
  const html = R.equippedRow("Goggles", null, {}, null, null, null, { mode: true, slotsCovered: new Set(["Goggles"]) });
  assert.ok(/No owned item here improves your ranked priorities/.test(html));
});

test("U7/AE6: owned mode marks augment/craft lines as recommended (not owned)", () => {
  const v = { variant_id: "Owned Belt", affixes: [{ stat: "Constitution", bonus_type: "Enhancement", name: "Constitution", type: "Enhancement", value: 20, unit: "flat" }] };
  const maps = {
    augAssign: { byIndex: new Map([[0, [{ variant_id: "Topaz of Con", color: "Yellow", slot_color: "Yellow" }]]]), freeByIndex: new Map() },
    dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
  };
  const owned = R.equippedBody(v, 0, maps, new Map(), true);
  assert.ok(/Recommended \(not owned\)/.test(owned), "owned mode marks the augment block");
  const notOwned = R.equippedBody(v, 0, maps, new Map(), false);
  assert.ok(!/Recommended \(not owned\)/.test(notOwned), "non-owned mode has no marker");
});

// ---------------------------------------------------------------------------
// U3 (plan 2026-08-05-001) — zero-source priority disclosure. A priority NOTHING
// in the active pool can contribute to used to score zero with no explanation.
// ---------------------------------------------------------------------------

const _okResult = { status: "optimal", perTarget: {}, chosen: [] };
const _modelWith = (statNames) => ({
  targets: [],
  worn: [{ slot: "Ring", variants: [{ affixes: statNames.map((n) => ({ name: n, type: "Enhancement", value: 5 })) }] }],
  augments: [], dinoInserts: [], nearlyComplete: [], viktranium: [],
  seal: [], thunderForged: [], greenSteel: [],
  membershipSetDefs: {}, augment_set_defs: {},
});
const _datasetWith = (statNames) => ({
  items: [{ affixes: statNames.map((n) => ({ name: n, type: "Enhancement", value: 5 })) }],
});

test("U3: a priority nothing in the pool supplies is named", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Constitution", "Sonic Lore"] }, _okResult,
    _modelWith(["Constitution"]), _datasetWith(["Constitution"]));
  assert.ok(html, "a notice renders");
  assert.ok(/Sonic Lore/.test(html), "names the unsourced priority");
  assert.ok(!/Constitution/.test(html), "does not name the one that is sourced");
});

test("U3: a priority with sources that merely lost slots does NOT fire", () => {
  // Constitution IS reachable in the pool; it just achieved nothing this solve.
  // That is a different case and must not be conflated.
  const html = R.zeroSourceNotice(
    { targets: ["Constitution"] }, { status: "optimal", perTarget: { Constitution: 0 }, chosen: [] },
    _modelWith(["Constitution"]), _datasetWith(["Constitution"]));
  assert.strictEqual(html, "", "no notice — the stat has sources, it just lost the slots");
});

test("U3: no notice when every priority has a source", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Constitution"] }, _okResult, _modelWith(["Constitution"]), _datasetWith(["Constitution"]));
  assert.strictEqual(html, "");
});

test("U3: multiple unsourced priorities are all named", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Sonic Lore", "Ice Lore"] }, _okResult, _modelWith(["Constitution"]), _datasetWith([]));
  assert.ok(/Sonic Lore/.test(html) && /Ice Lore/.test(html), "both named");
});

test("U3: the two causes are distinguished — dataset-absent vs pool-filtered", () => {
  // Present in the dataset but filtered out of the pool -> the actionable cause.
  const filtered = R.zeroSourceNotice(
    { targets: ["Sonic Lore"], pool: "owned" }, _okResult,
    _modelWith(["Constitution"]), _datasetWith(["Sonic Lore"]));
  assert.ok(/owned-gear pool/.test(filtered), `pool cause: ${filtered}`);
  assert.ok(!/Nothing in the current data/.test(filtered), "not the dataset cause");

  // Outside owned mode the notice must NOT blame one filter: the pool the solver
  // sees is the product of the ML band, character gates AND the dominance prune,
  // and this function cannot tell which removed the last source. Blaming the ML
  // band was wrong for a verified ML-29 item inside a cap of 34 that dominance
  // had pruned.
  const vague = R.zeroSourceNotice(
    { targets: ["Sonic Lore"], mlCap: 34 }, _okResult,
    _modelWith(["Constitution"]), _datasetWith(["Sonic Lore"]));
  assert.ok(/current filters/.test(vague), `unattributed cause: ${vague}`);
  assert.ok(!/ML band survived|survived your ML band/.test(vague), "does not blame the ML band alone");

  // Absent from the dataset entirely -> nothing the player can do about it.
  const absent = R.zeroSourceNotice(
    { targets: ["Sonic Lore"] }, _okResult, _modelWith(["Constitution"]), _datasetWith([]));
  assert.ok(/Nothing in the current data/.test(absent), `dataset cause: ${absent}`);
});

test("U3: the notice carries role=status, matching its sibling notices", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Sonic Lore"] }, _okResult, _modelWith([]), _datasetWith([]));
  assert.ok(/role="status"/.test(html), "announced like artifactNotice and boundNotice");
});

test("U3: a restored snapshot with no MILP program still renders from the model", () => {
  // persist.js drops `program` from a saved loadout; the notice must not depend on it.
  const restored = { status: "optimal", perTarget: {}, chosen: [] };  // no .program
  const html = R.zeroSourceNotice(
    { targets: ["Sonic Lore"] }, restored, _modelWith(["Constitution"]), _datasetWith([]));
  assert.ok(/Sonic Lore/.test(html), "derived from model, not the program");
});

test("U3: nothing renders on a non-optimal solve", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Sonic Lore"] }, { status: "infeasible" }, _modelWith([]), _datasetWith([]));
  assert.strictEqual(html, "");
});

test("U3: set-granted and crafting-pool stats count as sourced", () => {
  const model = _modelWith([]);
  model.worn[0].variants[0].parsed_set_bonuses = [{ affixes: [{ stat: "Sonic Lore", value: 3 }] }];
  model.seal = [{ stat: "Ice Lore", value: 2 }];
  const html = R.zeroSourceNotice(
    { targets: ["Sonic Lore", "Ice Lore"] }, _okResult, model, _datasetWith([]));
  assert.strictEqual(html, "", "a set tier and a crafting pool both count as sources");
});

// #91 (code review fix) — the Utility sentinel is never a pool stat (poolStatNames
// only ever collects real affix/scaling names), so without an exclusion every solve
// with the tier ranked falsely names it here — above an already-populated utility
// card. Mirrors the `stat === _UTILITY_SENTINEL` exclusion the generic stat-card
// loop already applies at its own call site.
const _UTIL_SENTINEL = require("../web/model.js").UTILITY_SENTINEL;

test("#91: the Utility sentinel ranked with a normal pool does not trigger the notice", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Constitution", _UTIL_SENTINEL] }, _okResult,
    _modelWith(["Constitution"]), _datasetWith(["Constitution"]));
  assert.strictEqual(html, "", "the sentinel is never a pool stat but must not read as unsourced");
});

test("#91: a genuinely absent real stat still fires alongside a ranked sentinel", () => {
  const html = R.zeroSourceNotice(
    { targets: ["Sonic Lore", _UTIL_SENTINEL] }, _okResult,
    _modelWith(["Constitution"]), _datasetWith([]));
  assert.ok(/Sonic Lore/.test(html), "the real absent stat is still named");
  assert.ok(!html.includes(_UTIL_SENTINEL), "the sentinel itself is never named");
});

// ---- plan 003 U6 — a declared build discloses BOTH of its limits (R10) ----

const _declared = { mlFloor: 0, targetCaps: {}, style: "one-hand", twoWeaponFighting: true };
const _plainResult = { perTarget: {}, floorReport: [], chosen: [] };
const _withOffHand = (variant) => ({ perTarget: {}, floorReport: [],
  chosen: [{ slot: "Off Hand", variant }] });

test("U6/003 (R10): a declared build discloses the exclusion AND the unscored penalty", () => {
  const note = R.boundNotice(_declared, _withOffHand(
    { source_item: "Longsword", category: "weapon", type: "Long Swords" }));
  assert.ok(/shields, orbs, and rune arms/i.test(note), "names what left off-hand candidacy");
  assert.ok(/pin/i.test(note), "and that a pin restores them");
  assert.ok(/doesn't score|does not score/i.test(note),
    "discloses that the Two Weapon Fighting penalty itself is unscored");
});

test("U6/003 (R10): an UNDECLARED build says neither", () => {
  const note = R.boundNotice({ mlFloor: 0, targetCaps: {}, style: "one-hand" }, _plainResult);
  assert.ok(!/shields, orbs, and rune arms/i.test(note), "no exclusion sentence");
  assert.ok(!/Two Weapon Fighting/i.test(note), "no penalty sentence");
});

test("U6/003: a declared build under another style says neither — the exclusion never fired", () => {
  // The notice must read the SAME authority the pool used (offHandItemsExcluded),
  // not the raw flag: under sword-board nothing was excluded, so claiming it was
  // would be a false disclosure.
  const note = R.boundNotice(Object.assign({}, _declared, { style: "sword-board" }), _plainResult);
  assert.ok(!/shields, orbs, and rune arms/i.test(note), "no exclusion claimed under S&B");
});

test("U6/003 (R8): a pinned shield that overrode the exclusion is stated", () => {
  const note = R.boundNotice(
    Object.assign({}, _declared, { slotConstraints: { "Off Hand": { type: "pin", variant_id: "Tower Shield" } } }),
    _withOffHand({ source_item: "Tower Shield", variant_id: "Tower Shield", type: "Tower shields" }));
  assert.ok(/pinned/i.test(note) && /overr/i.test(note),
    "says the pin overrode the exclusion, so the off-hand item is explained");
});

test("U6/003+U4: an UNPINNED off-hand item must not be reported as a pin", () => {
  // Reachable, not theoretical: a restored snapshot is not re-solved on load, and
  // U4 migrates pre-U1 saves to declared — so a shield can sit in a declared build's
  // off hand with nothing pinned. Inferring a pin from the item's presence would put
  // a flatly false "your pinned Tower Shield" in front of a player who pinned nothing.
  const note = R.boundNotice(
    Object.assign({}, _declared, { slotConstraints: {} }),
    _withOffHand({ source_item: "Tower Shield", variant_id: "Tower Shield", type: "Tower shields" }));
  assert.ok(!/pinned/i.test(note), "no false pin claim");
  assert.ok(/solved before the declaration/i.test(note), "names the real cause");
  assert.ok(/Re-solve/i.test(note), "and the action that fixes it");
});

test("U6/003: the disclosure keeps role=status, like its sibling notices", () => {
  const note = R.boundNotice(_declared, _plainResult);
  assert.ok(/role="status"/.test(note), "announced");
});

test("U6/003: the declared disclosure composes with the existing ML/floor/cap parts", () => {
  const note = R.boundNotice(
    Object.assign({}, _declared, { mlFloor: 32, targetCaps: { Dodge: 4 } }),
    { perTarget: { Dodge: 4 }, floorReport: [], chosen: [] });
  assert.ok(/ML ≥ 32/.test(note), "the ML band still shows");
  assert.ok(/Held at your cap: Dodge 4/.test(note), "the held cap still shows");
  assert.ok(/shields, orbs, and rune arms/i.test(note), "alongside the new disclosure");
});

// ---- U3 — a declared credit renders distinguishably (R8) ---------------------

test("U3: a declared contributor renders its own label, not a bare em-dash", () => {
  // Before U3 a credit resolved to {kind:"other", label: undefined} and rendered
  // as "— · " — an unexplained row the moment U2 made credits reachable.
  const html = R.attributionList([
    { bonus_type: "Insight", value: 7, source: "declared, not from gear",
      sourceKind: "declared", slots: [], hostIds: [], isSet: false },
  ]);
  assert.ok(/is-declared/.test(html), "it carries its own row class");
  assert.ok(/declared, not from gear/.test(html), "and says so in words");
  assert.ok(!/—\s*<\/span>/.test(html), "no empty slot cell");
  assert.ok(!/undefined/.test(html), "and no undefined source");
  assert.ok(/\+7/.test(html) && /Insight/.test(html), "value and bonus type still shown");
});

test("U3: a declared contributor is distinguishable from identical gear", () => {
  const common = { bonus_type: "Insight", value: 7, slots: [], hostIds: [], isSet: false };
  const dec = R.attributionList([{ ...common, source: "declared, not from gear", sourceKind: "declared" }]);
  const gear = R.attributionList([{ ...common, source: "Some Ring", sourceKind: "worn", slots: ["Ring"] }]);
  assert.notStrictEqual(dec, gear, "the two must not render identically");
  assert.ok(/is-declared/.test(dec) && !/is-declared/.test(gear));
  assert.ok(/attrib-declared/.test(dec), "and gets its own span, like a set bonus does");
});

test("U3: the declared row explains itself on hover", () => {
  const html = R.attributionList([
    { bonus_type: "Insight", value: 7, source: "declared, not from gear",
      sourceKind: "declared", slots: [], hostIds: [], isSet: false },
  ]);
  assert.ok(/title="[^"]*not verified[^"]*"/i.test(html),
    "R9 — the player must be able to tell this number was not verified");
});

// ---- U4 — credit-aware disclosure (R9, R10) ---------------------------------

const CR = [{ stat: "CM", bonus_type: "Insight", value: 7, won: true, beatGear: 5, floor: 10, gearInLoadout: 5 }];

test("U4: the bound notice discloses the credit, what it beat, and the floor it carried", () => {
  const note = R.boundNotice({}, { perTarget: { CM: 12 }, creditReport: CR });
  assert.ok(/did not verify/.test(note), "R9 — the number is named as unverified");
  assert.ok(/beat your best Insight CM gear, which is 5/.test(note), "R10 — what it displaced");
  assert.ok(/floor of 10 CM counts the declared 7 Insight/.test(note), "the floor it counts toward");
  assert.ok(/the gear in this loadout supplies 5/.test(note),
    "an attribution of the shown loadout — NOT a claim about what gear alone would reach");
});

test("U4: with no credit declared the bound notice is byte-identical to today's", () => {
  const q = { mlFloor: 32, targetCaps: { Dodge: 4 } };
  const res = { perTarget: { Dodge: 4 }, floorReport: [] };
  const before = R.boundNotice(q, res);
  const after = R.boundNotice(q, { ...res, creditReport: [] });
  assert.strictEqual(after, before, "an empty report adds nothing");
  assert.ok(!/did not verify/.test(before));
});

test("U4: the notice renders from creditReport alone — no live program needed", () => {
  // KTD6 — a restored character is displayed WITHOUT re-solving, and `program` is
  // excluded from the saved snapshot. A notice that read the program at render
  // time would vanish exactly on the load path R11 creates.
  const live = { perTarget: { CM: 12 }, creditReport: CR };
  const restored = JSON.parse(JSON.stringify(live));
  const note = R.boundNotice({}, restored);
  assert.ok(/did not verify/.test(note),
    "the restored result must actually produce a disclosure — two empty strings would match vacuously");
  assert.strictEqual(note, R.boundNotice({}, live),
    "a result read back off the allowlist discloses identically to a live solve");
});

test("U4: a credit that won nothing and carried no floor still discloses the qualifier", () => {
  const note = R.boundNotice({}, { perTarget: { CM: 9 },
    creditReport: [{ stat: "CM", bonus_type: "Insight", value: 4, won: false, beatGear: null, floor: null, gearInLoadout: 9 }] });
  assert.ok(/did not verify/.test(note), "the honesty line is unconditional on a declaration");
  assert.ok(!/beat the best/.test(note), "but no displacement is claimed");
  assert.ok(!/floor of/.test(note), "and no floor is claimed");
});


// ---------------------------------------------------------------------------
// U4 (plan 2026-08-09-002) — wildcard set attribution reaches the three in-app
// surfaces. The solver already counts a Gem of Many Facets toward a set
// (`web/solver.js:776` self-seeds the threshold); every display read the item's
// STATIC `set_bonus` and so denied the piece that made the bonus happen.
// ---------------------------------------------------------------------------

const Pj = require("../web/projection.js");

// A Gem of Many Facets in the Trinket slot taking one wildcard pick from EACH of
// two independent pools, plus an intrinsic Marshwalker ring. Both sets are active.
function gemBuild(over) {
  return Object.assign({
    chosen: [
      { slot: "Ring", variant: { variant_id: "Marsh Ring", affixes: [], set_bonus: [{ set: "Marshwalker" }], parsed_set_bonuses: [] } },
      { slot: "Trinket", variant: { variant_id: "Gem of Many Facets", affixes: [], set_bonus: [], parsed_set_bonuses: [] } },
    ],
    jokerPlaced: [
      { host: "Gem of Many Facets", group: 0, set: "Marshwalker" },
      { host: "Gem of Many Facets", group: 1, set: "Legendary Dread Isle" },
    ],
    membershipPlaced: [], setAugmentsPlaced: [], augmentsPlaced: [],
    setsActive: [{ set: "Marshwalker", pieces_required: 2 }, { set: "Legendary Dread Isle", pieces_required: 2 }],
    breakdown: {}, effective: {},
  }, over || {});
}

test("U4/R7: the gem's row carries the set frame and names BOTH sets it feeds", () => {
  const build = gemBuild();
  const contributors = Pj.setContributors(build);
  const satisfied = R.satisfiedSets(build.chosen, build.setsActive);
  const gem = { variant: build.chosen[1].variant };
  const html = R.equippedRow("Trinket", gem, {}, satisfied, null, null, null, contributors);
  assert.ok(/is-set/.test(html), "a wildcard piece completing a set gets the same frame as any other piece");
  assert.ok(/Marshwalker/.test(html) && /Legendary Dread Isle/.test(html),
    "a Gem takes one membership from each of two pools — BOTH sets are named");
  assert.ok(/wildcard/.test(html), "R8 — it is a contributor, but not shown as interchangeable with an intrinsic member");
  // Discriminator: without the resolver map the same row is unframed and unnamed,
  // which is exactly the bug — so the assertion above is not passing for free.
  const blind = R.equippedRow("Trinket", gem, {}, satisfied, null, null, null, null);
  assert.ok(!/is-set/.test(blind) && !/Marshwalker/.test(blind), "reading set_bonus alone still shows nothing");
});

test("U4/R7+R8: the deep dive frames the gem, names both sets, and keeps its wildcard chip", () => {
  const build = gemBuild();
  const maps = Pj.buildCraftMaps(build);
  const html = R.loadoutDeepDive(build, { targets: [] }, maps, R.attributionByTarget(build));
  const gemBlock = html.split('<div class="dd-item').find((b) => /Gem of Many Facets/.test(b));
  assert.ok(/^ is-set/.test(gemBlock), "the gem's block is framed as a set piece");
  assert.ok(/Part of set: [^<]*Marshwalker/.test(gemBlock) && /Legendary Dread Isle/.test(gemBlock), "names both sets");
  assert.ok(/Wildcard set: Marshwalker/.test(gemBlock), "R8 — the existing wildcard chip is retained alongside the frame");
});

test("U4/R9: Ranked Priorities names the gem's slot among a set bonus's sources", () => {
  // The solver's setYieldingSlots lists x-var (intrinsic) pieces only, so the gem
  // that completed the set was missing from the source list: the player saw "via
  // Ring" and no sign of the piece doing the work.
  const build = gemBuild({ breakdown: { Constitution: [
    { bonus_type: "Insightful", value: 5, source: "Marshwalker", sourceKind: "set", setYieldingSlots: ["Ring"], hostIds: ["Marsh Ring"] },
  ] } });
  const attr = R.attributionByTarget(build);
  assert.deepStrictEqual(attr.Constitution[0].slots, ["Ring", "Trinket"], "the gem's slot joins the intrinsic piece");
  assert.ok(/via Ring, Trinket/.test(R.attributionList(attr.Constitution)), "and it renders in the source line");
  // A build with no runtime pick is untouched — the no-change guard.
  const plain = gemBuild({ jokerPlaced: [], breakdown: build.breakdown });
  assert.deepStrictEqual(R.attributionByTarget(plain).Constitution[0].slots, ["Ring"]);
});

test("U4/R10: a Set Bonuses card names every piece with its slot — never a bare count", () => {
  const build = gemBuild();
  const panel = R.buildViews(build, { worn: [], augments: [] }, { targets: [] }).setsPanel;
  assert.ok(/Marsh Ring \(Ring\)/.test(panel), "the intrinsic piece is named with its slot");
  assert.ok(/Gem of Many Facets \(Trinket\) — wildcard/.test(panel), "so is the wildcard piece");
  const dread = panel.split("<li").find((c) => /Legendary Dread Isle/.test(c));
  assert.ok(/Gem of Many Facets \(Trinket\)/.test(dread), "the gem-only set names the gem rather than nothing");
  assert.ok(!/no contributing piece reported/.test(panel), "no card falls through to the empty disclosure");
});

test("U4/R10: an Augment Set names its copies and the item each is slotted into", () => {
  // An Augment Set has NO worn member: three Set Augment copies sit in three
  // different items, and the set's card had nothing to name at all.
  const build = {
    chosen: [
      { slot: "Ring", variant: { variant_id: "Plain Ring", affixes: [], augment_slots_norm: { colors: ["Colorless"] }, set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Necklace", variant: { variant_id: "Plain Neck", affixes: [], augment_slots_norm: { colors: ["Colorless"] }, set_bonus: [], parsed_set_bonuses: [] } },
      { slot: "Boots", variant: { variant_id: "Plain Boots", affixes: [], augment_slots_norm: { colors: ["Colorless"] }, set_bonus: [], parsed_set_bonuses: [] } },
    ],
    setAugmentsPlaced: [
      { set: "Legendary Prowess", host: "Plain Ring" },
      { set: "Legendary Prowess", host: "Plain Neck" },
      { set: "Legendary Prowess", host: "Plain Boots" },
    ],
    jokerPlaced: [], membershipPlaced: [], augmentsPlaced: [], breakdown: {}, effective: {},
    setsActive: [{ set: "Legendary Prowess", pieces_required: 3, affixes: [] }],
  };
  const panel = R.buildViews(build, { worn: [], augments: [] }, { targets: [] }).setsPanel;
  for (const [item, slot] of [["Plain Ring", "Ring"], ["Plain Neck", "Necklace"], ["Plain Boots", "Boots"]]) {
    assert.ok(new RegExp(`Set Augment in ${item} \\(${slot}\\)`).test(panel),
      `names the copy in ${item} and the slot it occupies`);
  }
  assert.ok(!/no contributing piece reported/.test(panel), "the card is not empty");
});

test("U4: a suppressed host is NOT named as a member of the set it gave up", () => {
  // KTD2 — the solver already dropped the suppressed intrinsic set; naming the host
  // as a member would resurrect a piece the solve removed.
  const build = {
    chosen: [
      { slot: "Trinket", variant: { variant_id: "Vol Amulet", affixes: [], set_bonus: [{ set: "Vol Set" }],
        parsed_set_bonuses: [{ set: "Vol Set", pieces_required: 1, affixes: [{ stat: "Dodge", bonus_type: "Insightful", value: 3, unit: "flat" }] }] } },
    ],
    setAugmentsPlaced: [{ set: "Legendary Might", host: "Vol Amulet" }],
    jokerPlaced: [], membershipPlaced: [], setsActive: [{ set: "Legendary Might", pieces_required: 1, affixes: [] }],
  };
  const d = R.satisfiedSetDetail(build);
  assert.ok(!d.some((s) => s.set === "Vol Set"), "the suppressed set is not active at all");
  const might = d.find((s) => s.set === "Legendary Might");
  assert.deepStrictEqual(might.members, [{ slot: "Trinket", item: "Vol Amulet", kind: "augmentset" }],
    "the host appears only as the Augment Set's copy, never as a Vol Set member");
});

test("U4/Q1: a redundant membership pick still shows — the asymmetry is behavior, not a bug", () => {
  // membershipPlaced is filtered only on the set being active, so a pick on an
  // already-complete set is reported and must be displayed. jokerPlaced is filtered
  // by realShort (web/solver.js:1140-1163), so a redundant joker never gets here.
  const build = {
    chosen: [
      { slot: "Ring", variant: { variant_id: "Marsh Ring", affixes: [], set_bonus: [{ set: "Marshwalker" }], parsed_set_bonuses: [] } },
      { slot: "Belt", variant: { variant_id: "Dino Belt", affixes: [], set_bonus: [], parsed_set_bonuses: [] } },
    ],
    membershipPlaced: [{ host: "Dino Belt", set: "Marshwalker", station: "Dinosaur Bone crafting" }],
    jokerPlaced: [], setAugmentsPlaced: [], augmentsPlaced: [], breakdown: {}, effective: {},
    setsActive: [{ set: "Marshwalker", pieces_required: 2, affixes: [] }],
  };
  const members = R.satisfiedSetDetail(build).find((s) => s.set === "Marshwalker").members;
  assert.deepStrictEqual(members, [
    { slot: "Ring", item: "Marsh Ring", kind: "intrinsic" },
    { slot: "Belt", item: "Dino Belt", kind: "membership" },
  ], "both the intrinsic piece and the runtime membership pick are named");
});

test("U4: a build with no runtime picks renders its sets exactly as before", () => {
  // The no-change guard: attribution for an ordinary build must not move.
  const build = { chosen: [
    chosenItem("Ring Alpha", "Ring", [], ["Alpha"], [{ set: "Alpha", n: 2, affixes: [["Constitution", "Insightful", 3]] }]),
    chosenItem("Neck Alpha", "Necklace", [], ["Alpha"], [{ set: "Alpha", n: 2, affixes: [["Constitution", "Insightful", 3]] }]),
  ], setsActive: [], breakdown: {}, effective: {}, augmentsPlaced: [] };
  const d = R.satisfiedSetDetail(build);
  assert.deepStrictEqual(d[0].members.map((m) => m.kind), ["intrinsic", "intrinsic"]);
  assert.deepStrictEqual(R.activeSetDetail({ chosen: build.chosen, setsActive: [{ set: "Alpha", pieces_required: 2 }] })[0].slots,
    ["Ring", "Necklace"], "yielding slots are unchanged for a purely intrinsic set");
});

// ---- #239 U4: the two notices and the invitation ---------------------------

function satBuild(opts) {
  const o = opts || {};
  return {
    status: "optimal",
    chosen: [
      { slot: "Goggles", variant: { variant_id: "Red Wizard's Sight",
        affixes: [{ name: "Kinetic Lore", type: "Equipment", value: 24 }] } },
      { slot: "Boots", variant: { variant_id: "Filler Boots",
        affixes: o.bareFiller ? [] : [{ name: "Physical Sheltering", type: "Enhancement", value: 30 }] } },
    ],
    breakdown: { "Kinetic Lore": [{ bonus_type: "Equipment", value: 24, source: "Red Wizard's Sight",
      sourceKind: "worn", slot: "Goggles", hostIds: ["Red Wizard's Sight"] }] },
    setsActive: [], augmentsPlaced: [], setAugmentsPlaced: [], membershipPlaced: [],
    saturationReport: o.saturation === false ? [] : [
      { stat: "Kinetic Lore", total: 30, bonusTypes: ["Equipment", "Artifact"], unusedSources: 56 }],
    emptySlots: o.empty === false ? { count: 0, slots: [] }
      : { count: 11, slots: ["Armor", "Helmet", "Cloak", "Belt", "Gloves", "Bracers",
                             "Trinket", "Ring 2", "Main Hand", "Off Hand", "Quiver"] },
  };
}
const satQuery = { targets: ["Kinetic Lore"] };

test("U4/#239 + plan 2026-08-12-001 U2: the saturation notice is a compact count/list", () => {
  const html = R.saturationNotice(satBuild());
  assert.ok(/1 priority at ceiling: Kinetic Lore 30\./.test(html), "count + stat + total, singular form");
  assert.ok(!/ML|level|cap/i.test(html), "attributes no cause — the dominance filter makes that unknowable");
  assert.strictEqual(R.saturationNotice(satBuild({ saturation: false })), "", "silent when nothing saturated");
});

test("#277: the notice is a tap/keyboard-openable disclosure carrying the full sentences", () => {
  const html = R.saturationNotice(satBuild());
  assert.ok(/<details/.test(html) && /<summary/.test(html), "solve-banner details pattern, not hover-only");
  const summary = (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "";
  assert.ok(/1 priority at ceiling: Kinetic Lore 30\./.test(summary), "collapsed line keeps the compact wording");
  assert.ok(!/reaches you as/.test(summary), "the prose stays out of the collapsed line");
  const body = html.replace(/<summary[\s\S]*?<\/summary>/, "").replace(/title="[^"]*"/g, "");
  assert.ok(/at its ceiling of 30/.test(body) && /reaches you as/.test(body),
    "the full sentences are VISIBLE text in the open state — reachable without a pointer");
  const title = (html.match(/title="([^"]*)"/) || [])[1] || "";
  assert.ok(/at its ceiling of 30/.test(title), "the hover fast-path survives");
});

test("plan 2026-08-12-001 U2: two saturated stats pluralize and both are listed", () => {
  const b = satBuild();
  b.saturationReport.push({ stat: "Physical Sheltering", total: 62, bonusTypes: ["Enhancement"], unusedSources: 2 });
  const html = R.saturationNotice(b);
  assert.ok(/2 priorities at ceiling: Kinetic Lore 30, Physical Sheltering 62\./.test(html), "plural + full list");
});

test("U4/#239: the empty-slot notice invites and names an incidentally-supplied stat", () => {
  const html = R.emptySlotNotice(satQuery, satBuild());
  assert.ok(/11 slots are empty/.test(html), "states the fact");
  assert.ok(/Physical Sheltering/.test(html), "names a stat the build already carries");
  assert.ok(/Adjust &amp; re-solve/.test(html), "points at the panel already on this screen");
  assert.ok(!/56/.test(html), "does not speak the unused-source count");
});

test("U4/#239: the invitation still fires when the build supplies nothing extra", () => {
  const html = R.emptySlotNotice(satQuery, satBuild({ bareFiller: true }));
  assert.ok(/11 slots are empty/.test(html), "the fact still renders");
  assert.ok(/Rank another stat/.test(html), "and so does the invitation, with no stat named");
});

test("U6/#249: the app renders the absorption-quarantine disclosure", () => {
  // Carrying a fact through the content model is necessary but not sufficient —
  // each renderer has to print it. That gap already shipped once, for set members.
  const build = satBuild();
  build.absorptionQuarantine = [{
    item: "Cyran Guard (level 26)", stat: "Elemental Absorption", reason: "absent",
    components: ["Acid Absorption", "Cold Absorption", "Fire Absorption",
                 "Electric Absorption", "Sonic Absorption"],
  }];
  const html = R.absorptionQuarantineNotice(build);
  assert.ok(/Elemental Absorption/.test(html), "names the excluded enchantment");
  assert.ok(/Cyran Guard/.test(html), "names the item");
  assert.ok(/scope-note/.test(html), "joins the artifactNotice/boundNotice family");
  assert.strictEqual(R.absorptionQuarantineNotice(satBuild()), "",
    "silent when nothing was quarantined");
});

test("U6/#249: the disclosure escapes item names rather than trusting them", () => {
  const build = satBuild();
  build.absorptionQuarantine = [{
    item: '<img src=x onerror="alert(1)">', stat: "Elemental Absorption",
    reason: "absent", components: ["Fire Absorption"],
  }];
  const html = R.absorptionQuarantineNotice(build);
  assert.ok(!/<img/.test(html), "the item name is escaped");
  assert.ok(/&lt;img/.test(html), "and rendered as text");
});

test("U4/#239: the two notices are independent", () => {
  const noEmpty = satBuild({ empty: false });
  assert.ok(R.saturationNotice(noEmpty) !== "", "saturation renders alone");
  assert.strictEqual(R.emptySlotNotice(satQuery, noEmpty), "", "with no empty-slot notice");
  const noSat = satBuild({ saturation: false });
  assert.strictEqual(R.saturationNotice(noSat), "", "no saturation");
  assert.ok(R.emptySlotNotice(satQuery, noSat) !== "", "empty slots render alone");
});

test("U4/#239: a ranked stat is never offered back as a suggestion", () => {
  const q = { targets: ["Kinetic Lore", "Physical Sheltering"] };
  assert.ok(!R.incidentalStats(q, satBuild()).includes("Physical Sheltering"),
    "suggesting a stat the player already ranked is noise");
});

// ---- U8 (R8) — the two item-centric render paths in results.js -------------
//
// `equippedBody` (the Loadout block) and `loadoutDeepDive` read `v.affixes`
// directly; only the text exporters read the shared content model. Collapsing in
// projection.js alone would fix every export and leave these two — the surfaces
// R8 names first — still printing one line per expanded school.
function focusMasteryAffixes(label, type, value) {
  return ["Abjuration", "Conjuration", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"]
    .map((s) => ({ name: `${s} Focus`, type, value, via: label }));
}

test("U8/R8/AE3: equippedBody shows ONE line naming the enchantment, not seven school lines", () => {
  const v = { variant_id: "A Memento of Mori",
    affixes: focusMasteryAffixes("Sacred Spell Focus Mastery", "Sacred", 3) };
  const html = R.equippedBody(v, 0, blockMaps(), new Map());
  assert.ok(/Sacred Spell Focus Mastery \+3/.test(html), "names the enchantment engraved on the item");
  assert.ok(!/Necromancy Focus/.test(html), "the model's expanded shape does not leak into the UI");
  assert.strictEqual((html.match(/<li>/g) || []).length, 1, "exactly one affix line, not seven");
});

test("U8/R8/AE3: loadoutDeepDive collapses the same expansion the same way", () => {
  const result = {
    chosen: [{ slot: "Trinket", variant: { variant_id: "A Memento of Mori", minimum_level: 32,
      set_bonus: [], affixes: focusMasteryAffixes("Sacred Spell Focus Mastery", "Sacred", 3) } }],
    breakdown: {}, augmentsPlaced: [], effective: {}, perTarget: {},
  };
  const maps = { augAssign: { byIndex: new Map(), freeByIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map() };
  const html = R.loadoutDeepDive(result, { targets: [] }, maps, R.attributionByTarget(result));
  assert.ok(/Sacred Spell Focus Mastery \+3/.test(html));
  assert.ok(!/Abjuration Focus/.test(html) && !/Necromancy Focus/.test(html),
    "no school line survives the collapse");
  assert.strictEqual((html.match(/<li>/g) || []).length, 1, "one affix line in the Deep Dive too");
});

test("U8/R8: a heterogeneous family renders its members inline on the Loadout block", () => {
  const v = { variant_id: "Blackfeather Boots", affixes: [
    { name: "Movement Speed", type: "Enhancement", value: 30, via: "Speed" },
    { name: "Melee Alacrity", type: "Enhancement", value: 15, via: "Speed" },
    { name: "Ranged Alacrity", type: "Enhancement", value: 15, via: "Speed" },
  ] };
  const html = R.equippedBody(v, 0, blockMaps(), new Map());
  assert.ok(/Speed: Movement Speed \+30, Melee Alacrity \+15, Ranged Alacrity \+15/.test(html),
    `member values listed inline; got ${html}`);
  // Anchored to the start of the line: "Movement Speed +30" legitimately contains
  // the substring "Speed +", so a bare /Speed \+/ would reject a correct render.
  assert.ok(!/<li>Speed \+/.test(html), "the line never asserts a single invented magnitude");
  assert.strictEqual((html.match(/<li>/g) || []).length, 1, "still one line");
});

test("U8/R8: an item with no expanded affix renders exactly as before", () => {
  const v = { variant_id: "Ring1", affixes: [
    { stat: "Constitution", bonus_type: "Enhancement", value: 10, unit: "flat" },
    { stat: "Dodge", bonus_type: "Quality", value: 5, unit: "pct" },
  ] };
  const html = R.equippedBody(v, 0, blockMaps(), new Map());
  assert.ok(/Constitution \+10/.test(html) && /Dodge \+5% Quality/.test(html));
  assert.strictEqual((html.match(/<li>/g) || []).length, 2, "both native affixes still listed");
});

// The provenance tooltip is user-facing correctness, not decoration. It once
// claimed the enchantment "raises the DC of every school", which was true while
// only spell focus carried `via` and false the moment the stamp widened to
// Parrying, Speed, Well Rounded and Heightened Awareness. Nothing asserted the
// string, so the wrong claim shipped and the correction could silently revert.
test("the provenance tooltip makes no family-specific claim", () => {
  const html = R.attributionList([
    { source: "Some Item", value: 3, bonus_type: "Insight", slots: ["Bracers"],
      via: "Parrying" },
  ]);
  assert.ok(/as Parrying/.test(html), "the row still names the engraved enchantment");
  assert.ok(!/DC of every school/.test(html),
    "no spell-DC claim on a family that grants Armor Class and saves");
  assert.ok(/grants several effects at once/.test(html),
    "the wording holds for every expansion family");
});

test("a native affix gets no provenance tooltip at all", () => {
  const html = R.attributionList([
    { source: "Some Item", value: 3, bonus_type: "Insight", slots: ["Bracers"], via: null },
  ]);
  assert.ok(!/attrib-via/.test(html), "nothing to attribute when nothing expanded");
});



// ---------------------------------------------------------------------------
// #245 — the craft-carried why-line and the opt-out notice.

test("#245: whyThisLine flags an item picked only for its crafts", () => {
  const res = whyResult();
  res.breakdown.Constitution = [
    { bonus_type: "Insight", value: 1, source: "Slot Melancholic Viktranium augment",
      sourceKind: "vik", slot: "Ring", hostIds: ["R"] },
  ];
  const html = R.whyThisLine(res, { slot: "Ring", variant_id: "R" });
  assert.ok(/pd-carried/.test(html), "renders the caution variant, not a win");
  assert.ok(/here only for its crafts/.test(html) && /Constitution \+1/.test(html)
    && /Viktranium/.test(html), "names the crafted stat, value, and family");
});

test("#245: whyThisLine stays a plain contribution line when the item earns its slot natively", () => {
  const html = R.whyThisLine(whyResult(), { slot: "Ring", variant_id: "R" });
  assert.ok(/Constitution \+15/.test(html) && !/pd-carried/.test(html));
});

test("#346: the ladder notice renders from the shared projection sentence", () => {
  // Called the way renderResults calls it: the SOLVED QUERY first, the bare
  // worker result second. Per
  // docs/solutions/conventions/fixture-shape-must-mirror-the-production-writer.md
  // the worker result carries no `query` key at all, so hiding the rung in the
  // result argument would exercise a branch the live render never takes.
  const bare = { status: "optimal", augmentsPlaced: [], chosen: [] };
  const on = R.craftingExcludedNotice({ craftingRung: "no-niche-crafting" }, bare);
  assert.ok(/crafting-excluded-note/.test(on) && /Niche crafting was excluded/.test(on));
  assert.match(R.craftingExcludedNotice({ craftingRung: "printed-only" }, bare),
    /nothing beyond what is printed/, "the bottom rung has its own sentence");
  assert.strictEqual(R.craftingExcludedNotice({ craftingRung: "everything" }, bare), "",
    "silent on the top rung when the loadout leans on nothing");
});

test("#339: the augment-ceiling notice renders from the shared projection sentence", () => {
  // Called the way the app does: the worker result carries NO query field, so the
  // render forwards the in-scope solved query separately.
  const on = R.augCeilingNotice({ augCeiling: 32 }, { status: "optimal" });
  assert.ok(/aug-ceiling-note/.test(on) && /ML 32 and below/.test(on));
  assert.strictEqual(R.augCeilingNotice({}, { status: "optimal" }), "", "silent when unrestricted");
});

test("U7/#110: the banner qualifies optimality only when a block removed a candidate", () => {
  const on = R.blockNotice({ blockReport: [{ id: "X", name: "X", pool: "Ring", bestAvailable: false }] });
  assert.ok(/block-note/.test(on) && /optimal given those exclusions/.test(on));
  assert.strictEqual(R.blockNotice({ blockReport: [] }), "", "silent when no block applied");
});

// ---------------------------------------------------------------------------
// #262 U3 — the no-drop-source disclosure on the app surfaces: gear box row,
// Deep Dive item block, and the coverage note clause. All read the ONE shared
// wording from projection.js — never a per-surface respelling.

test("#262: equippedRow shows the note for a flagged item", () => {
  const pick = { slot: "Bracers", variant: { variant_id: "Bracers of the Spider Queen",
    minimum_level: 20, no_drop_source: true } };
  const html = R.equippedRow("Bracers", pick, {});
  assert.ok(html.includes(Pj.NO_DROP_SOURCE_WORDING), "the gear box row carries the note");
  assert.ok(/pd-nodrop/.test(html), "rendered as the dedicated note element");
});

test("#262: an unflagged equipped row carries no note", () => {
  const pick = { slot: "Ring", variant: { variant_id: "Plain Ring", minimum_level: 20 } };
  const html = R.equippedRow("Ring", pick, {});
  assert.ok(!html.includes(Pj.NO_DROP_SOURCE_WORDING), "absence is asserted, not implied");
});

test("#262: loadoutDeepDive tags a flagged item beside the Artifact tag position", () => {
  const result = {
    chosen: [{ slot: "Bracers", variant: { variant_id: "Legendary Bracers of the Spider Queen",
      minimum_level: 33, no_drop_source: true, affixes: [] } }],
    breakdown: {}, augmentsPlaced: [], effective: {}, perTarget: {},
  };
  const ddMaps = { augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map() };
  const html = R.loadoutDeepDive(result, { targets: [] }, ddMaps, R.attributionByTarget(result));
  assert.ok(/dd-nodrop/.test(html) && html.includes(Pj.NO_DROP_SOURCE_WORDING),
    "the Deep Dive item block discloses it");
  const clean = { chosen: [{ slot: "Ring", variant: { variant_id: "Plain Ring", minimum_level: 20, affixes: [] } }],
    breakdown: {}, augmentsPlaced: [], effective: {}, perTarget: {} };
  assert.ok(!R.loadoutDeepDive(clean, { targets: [] }, ddMaps, R.attributionByTarget(clean))
    .includes(Pj.NO_DROP_SOURCE_WORDING), "an unflagged item shows nothing");
});

test("#262: coverageNote gains the clause only when the coverage block reports confirmed items", () => {
  const note = R.coverageNote({ metadata: { no_drop_source_coverage: {
    confirmed_no_source: 2, wiki_has_source: 0, triage_universe: 199, unverified: 197, flagged_variants: 2 } } });
  assert.ok(note.includes(Pj.NO_DROP_SOURCE_WORDING), "the clause embeds the shared phrase");
  assert.ok(/2 items/.test(note), "names the confirmed count");
  assert.ok(/197/.test(note), "names the unverified remainder");
  const bare = R.coverageNote({ metadata: {} });
  assert.ok(!bare.includes(Pj.NO_DROP_SOURCE_WORDING), "no coverage block, no clause");
});

// ---------------------------------------------------------------------------
// U3 (#290/#291) — cross-added credit is labeled in the Ranked Priorities rows
// and the per-item why-this. Wording is "from <source stat>" everywhere,
// mirroring the via span ("as <enchantment>"). Parts stay FLAT — never grouped.

test("U3: attributionList labels a cross-added contribution 'from <source stat>'", () => {
  const html = R.attributionList([
    { source: "Universal Torc", value: 50, bonus_type: "Implement", slots: ["Necklace"],
      via: null, crossAdd: "Universal Spell Power" },
  ]);
  assert.ok(/attrib-from/.test(html), "the marker gets its own span");
  assert.ok(/from Universal Spell Power/.test(html), "the label names the SOURCE stat");
  assert.ok(!/attrib-via/.test(html), "crossAdd never renders as the enchantment clause");
});

test("U3: an own (non-cross-added) contribution renders no from-clause", () => {
  const html = R.attributionList([
    { source: "Ember Band", value: 100, bonus_type: "Equipment", slots: ["Ring"],
      via: null, crossAdd: null },
  ]);
  assert.ok(!/attrib-from/.test(html), "nothing to label when nothing cross-added");
});

test("U3: whyThisLine appends (from <source stat>) on a cross-added per-item contribution", () => {
  const result = {
    chosen: [
      { slot: "Ring", variant: { variant_id: "Ember Band",
        affixes: [{ name: "Combustion", type: "Equipment", value: 100 }] } },
      { slot: "Necklace", variant: { variant_id: "Universal Torc",
        affixes: [{ name: "Universal Spell Power", type: "Implement", value: 50 }] } },
    ],
    breakdown: {
      Combustion: [
        { bonus_type: "Equipment", value: 100, source: "Ember Band", sourceKind: "worn",
          slot: "Ring", hostIds: ["Ember Band"], crossAdd: null },
        { bonus_type: "Implement", value: 50, source: "Universal Torc", sourceKind: "worn",
          slot: "Necklace", hostIds: ["Universal Torc"], crossAdd: "Universal Spell Power" },
      ],
    },
    augmentsPlaced: [], setAugmentsPlaced: [], setsActive: [],
  };
  const torc = R.whyThisLine(result, { slot: "Necklace", variant_id: "Universal Torc" }, null, ["Combustion"]);
  assert.ok(/Combustion \+50 Implement \(from Universal Spell Power\)/.test(torc),
    `the compact summary labels the cross-added credit, got: ${torc}`);
  const band = R.whyThisLine(result, { slot: "Ring", variant_id: "Ember Band" }, null, ["Combustion"]);
  assert.ok(!/from Universal Spell Power/.test(band), "the own contribution stays unlabeled");
});

test("U3: a pre-cross-add row (field absent entirely) renders without error and without a clause", () => {
  let html;
  assert.doesNotThrow(() => {
    html = R.attributionList([
      { source: "Old Item", value: 3, bonus_type: "Insight", slots: ["Bracers"] },
    ]);
  });
  assert.ok(!/attrib-from/.test(html), "an old snapshot renders exactly as before");
});

// ---------------------------------------------------------------------------
// #91 (U5, KTD6/R9) — the Utility priority card. Three render states: receipts,
// the plain zero-state sentence, and the report-absent re-solve note (a healed
// pre-feature restore MUST NOT read as "0 effects" — that would be a false
// claim about an unknown count).
// ---------------------------------------------------------------------------
const U_SENT = require("../web/model.js").UTILITY_SENTINEL;
function utilityBuild(report) {
  const b = { status: "optimal", chosen: [], setsActive: [], augmentsPlaced: [],
    breakdown: {}, effective: { A: 10 } };
  if (report !== undefined) b.utilityReport = report;
  return b;
}

test("#91 U5: the utility card renders count + per-effect receipts at the sentinel's rank position", () => {
  const build = utilityBuild({ count: 2, effects: [
    { name: "Ghost Touch", item: "rGT" }, { name: "Feather Falling", item: "tFF" }] });
  const v = R.buildViews(build, { worn: [], augments: [] }, { targets: ["A", U_SENT] });
  assert.ok(/utility-card/.test(v.cards), "the dedicated card renders");
  assert.ok(new RegExp(`<span class="stat-rank">2</span><span class="stat-name">${U_SENT}</span>`).test(v.cards),
    "the rank badge shows the tier's position in the priority list");
  assert.ok(/data-final="2"/.test(v.cards), "the count renders as the card value");
  assert.ok(/Ghost Touch/.test(v.cards) && /— from rGT/.test(v.cards), "each effect names its credited item");
  assert.ok(/Feather Falling/.test(v.cards) && /— from tFF/.test(v.cards));
});

test("#91 U5: the sentinel is EXCLUDED from the generic stat-card loop (no phantom 0-value card)", () => {
  const build = utilityBuild({ count: 1, effects: [{ name: "Ghost Touch", item: "rGT" }] });
  const v = R.buildViews(build, { worn: [], augments: [] }, { targets: ["A", U_SENT] });
  assert.strictEqual((v.cards.match(/class="stat-card"/g) || []).length, 1,
    "exactly one GENERIC stat card (A) — the sentinel never enters the generic loop");
  assert.strictEqual((v.cards.match(/class="stat-card utility-card/g) || []).length, 1,
    "exactly one utility card");
  assert.ok(!new RegExp(`${U_SENT}[^]*?data-final="0"`).test(v.cards),
    "no phantom 0-value rendering for the sentinel");
  // Dragged first, the card renders first with rank 1.
  const v2 = R.buildViews(build, { worn: [], augments: [] }, { targets: [U_SENT, "A"] });
  assert.ok(new RegExp(`<span class="stat-rank">1</span><span class="stat-name">${U_SENT}</span>`).test(v2.cards),
    "the card follows the sentinel's dragged rank");
});

test("#91 U5/R9: count-zero renders the plain sentence, never an empty receipts list", () => {
  const v = R.buildViews(utilityBuild({ count: 0, effects: [] }),
    { worn: [], augments: [] }, { targets: ["A", U_SENT] });
  assert.ok(/0 utility effects on this loadout — no counted on\/off effects are present/.test(v.cards),
    "the zero-state sentence renders");
  assert.ok(!/utility-receipts/.test(v.cards), "no empty receipts list");
  assert.ok(!/re-solve to compute/i.test(v.cards), "the zero-state is not the stale note");
});

test("#91 U5/KTD6: report-absent (healed pre-feature restore) renders the re-solve note, NEVER the zero-state", () => {
  const v = R.buildViews(utilityBuild(undefined),
    { worn: [], augments: [] }, { targets: ["A", U_SENT] });
  assert.ok(/utility-stale/.test(v.cards) && /re-solve to compute utility/i.test(v.cards),
    "the re-solve note renders");
  assert.ok(!/0 utility effects/.test(v.cards),
    "a false '0 effects' claim about an unknown count must not render");
  assert.ok(!/data-final="0"[^]*?utility/.test(v.cards.split("utility-card")[1] || ""),
    "no zero value on the stale card");
});

test("#91 U5/R14: a JSON round-tripped snapshot (restored character) renders receipts without re-solving", () => {
  const build = JSON.parse(JSON.stringify(
    utilityBuild({ count: 1, effects: [{ name: "Ghost Touch", item: "nGT" }] })));
  const v = R.buildViews(build, { worn: [], augments: [] }, { targets: [U_SENT] });
  assert.ok(/Ghost Touch/.test(v.cards) && /— from nGT/.test(v.cards),
    "the persisted report alone is enough to render the receipts");
});

// #332 — the results-panel exclusion note. THIS is the surface the issue names first
// and the one round 1 found dead in the shipped app; it had no test in either branch,
// which is precisely how it shipped dead. Drives the real utilityCard against a build
// shaped like a real solve result (utilityReport.rankedNotCounted plus the breakdown
// entry that proves the loadout carries the stat).
function excludedBuild(report, breakdown) {
  const b = utilityBuild(report);
  b.breakdown = breakdown || {};
  return b;
}

test("#332: the utility card names a ranked-but-uncounted proc", () => {
  const build = excludedBuild(
    { count: 1, effects: [{ name: "Ghostly", item: "Belt" }], rankedNotCounted: ["Undead Bane"] },
    { "Undead Bane": [{ bonus_type: "Untyped", value: 13, source: "Echo", sourceKind: "worn",
      slot: "Main Hand", slots: ["Main Hand"], hostIds: ["E"] }] });
  const html = R.utilityCard(build, 0);
  assert.ok(/Undead Bane is ranked as its own priority/.test(html),
    "the card reconciles a satisfied ranked proc with a count that omits it");
  assert.ok(/utility-note muted/.test(html), "rendered as the muted note, not a receipt row");
});

test("#332: the ZERO-count card discloses too", () => {
  // Ranking only weapon procs is exactly how a player reaches a count of zero while
  // their ranked stats are satisfied — the most confusing version of this gap.
  const build = excludedBuild(
    { count: 0, effects: [], rankedNotCounted: ["Undead Bane"] },
    { "Undead Bane": [{ bonus_type: "Untyped", value: 13, source: "Echo", sourceKind: "worn",
      slot: "Main Hand", slots: ["Main Hand"], hostIds: ["E"] }] });
  const html = R.utilityCard(build, 0);
  assert.ok(/data-final="0"/.test(html), "still a zero count");
  assert.ok(/Undead Bane is ranked as its own priority/.test(html),
    "and the zero-count branch carries the same disclosure");
});

test("#332: the card says NOTHING when no ranked proc was excluded", () => {
  const clean = excludedBuild(
    { count: 1, effects: [{ name: "Ghostly", item: "Belt" }], rankedNotCounted: [] }, {});
  assert.ok(!/ranked as its own priority/.test(R.utilityCard(clean, 0)),
    "no disclosure without an exclusion");
  // And a stat the loadout does not carry is not named (no breakdown entry).
  const unsourced = excludedBuild(
    { count: 1, effects: [{ name: "Ghostly", item: "Belt" }], rankedNotCounted: ["Undead Bane"] }, {});
  assert.ok(!/ranked as its own priority/.test(R.utilityCard(unsourced, 0)),
    "an unsourced stat is left out — 'not counted' would be confusing about a stat with no sources");
});

test("#91 U5: utilityCard takes the build being rendered — an alternative's receipts, not the optimum's", () => {
  const optimum = utilityBuild({ count: 1, effects: [{ name: "Ghost Touch", item: "OPT-ITEM" }] });
  const alt = utilityBuild({ count: 2, effects: [
    { name: "Ghost Touch", item: "ALT-ITEM" }, { name: "Feather Falling", item: "ALT-BOOTS" }] });
  // Direct: the function renders from its argument (never a closed-over optimum).
  const cardAlt = R.utilityCard(alt, 0);
  assert.ok(/ALT-ITEM/.test(cardAlt) && /ALT-BOOTS/.test(cardAlt) && !/OPT-ITEM/.test(cardAlt));
  // Through the generic view path renderBuild uses for select-to-inspect.
  const vOpt = R.buildViews(optimum, { worn: [], augments: [] }, { targets: [U_SENT] });
  const vAlt = R.buildViews(alt, { worn: [], augments: [] }, { targets: [U_SENT] });
  assert.ok(/OPT-ITEM/.test(vOpt.cards) && !/ALT-ITEM/.test(vOpt.cards));
  assert.ok(/ALT-ITEM/.test(vAlt.cards) && /data-final="2"/.test(vAlt.cards) && !/OPT-ITEM/.test(vAlt.cards),
    "selecting an alternative re-renders receipts from THAT build");
});

console.log(`\n${passed} passed`);

// #346 (U5, R12, AE7) — a rung can take a stat's last source out of the pool.
// Twenty targetable stats are augment-only, so telling that player to widen
// their ML band is advice that cannot work. The ladder joins the owned-pool
// carve-out: an explicit, single, reversible choice worth naming.
test("#346: the zero-source notice blames the rung only on evidence", () => {
  const model = { worn: [], augments: [], targets: ["X"] };
  const result = { status: "optimal", perTarget: { X: 0 } };
  const notice = (rung, dataset) =>
    R.zeroSourceNotice({ targets: ["X"], craftingRung: rung }, result, model, dataset);

  // Attribution must be EVIDENCE-based, not rung-based. Keying on the rung value
  // alone told a player whose stat is missing for ML-band reasons to raise the
  // ladder — wrong advice, and it displaced the correct advice to make room.
  const wornOnly = { items: [{ category: "item", affixes: [{ name: "X", value: 5 }] }] };
  const innocent = notice("printed-only", wornOnly);
  assert.match(innocent, /widening the ML band/,
    "an innocent rung keeps the generic advice, which is at least not wrong");
  assert.ok(!/solver assume/.test(innocent), "and is not blamed for a stat it never touched");

  // Guilty: the stat's only source is an augment the rung removed.
  const augOnly = { items: [{ category: "augment", aug_color: { color: "Blue" }, affixes: [{ name: "X", value: 5 }] }] };
  const guilty = notice("printed-only", augOnly);
  assert.match(guilty, /which exclude augments/);
  assert.match(guilty, /raising "What may the solver assume/, "and points at the control");
  assert.ok(!/widening the ML band/.test(guilty));

  // Each rung names only what IT removed: a Blue augment survives the Solar/Lunar
  // rung, so that rung must not claim responsibility for it.
  const sunOnly = { items: [{ category: "augment", aug_color: { color: "Sun" }, affixes: [{ name: "X", value: 5 }] }] };
  assert.match(notice("no-solar-lunar", sunOnly), /which exclude Solar\/Lunar Gems/);
  assert.match(notice("no-solar-lunar", augOnly), /widening the ML band/,
    "a Blue augment is untouched by the Solar/Lunar rung, so that rung is innocent here");

  // R12 covers the craftable half too — a Viktranium-carried stat is attributed
  // to the niche-crafting rung, which previously never named itself at all.
  const vikCarried = { items: [{ category: "item", affixes: [{ name: "X", value: 5 }] }],
    viktranium: [{ affixes: [{ stat: "X", value: 7 }] }] };
  assert.match(notice("no-niche-crafting", vikCarried), /which exclude niche crafting/);
  assert.match(notice("everything", vikCarried), /widening the ML band/,
    "the top rung removed nothing and never claims otherwise");
});

// The owned-gear pool keeps precedence: it is the more specific explicit choice,
// and a player in owned mode needs to hear about the catalog first.
test("#346: the owned-gear pool still wins over the rung in the zero-source notice", () => {
  const model = { worn: [], augments: [], targets: ["Strikethrough"] };
  const result = { status: "optimal", perTarget: { Strikethrough: 0 } };
  const dataset = { items: [{ category: "augment", affixes: [{ name: "Strikethrough", value: 15 }] }] };
  const out = R.zeroSourceNotice({ targets: ["Strikethrough"], pool: "owned", craftingRung: "printed-only" },
    result, model, dataset);
  assert.match(out, /your owned-gear pool/);
  assert.match(out, /the full catalog may have one/);
});

// ---------------------------------------------------------------------------
// U1 (plan 2026-08-17-001, #345) — the OUTBID disclosure. The third zero cause:
// the target is reachable in the pool, and a higher-ranked priority took the
// only slot that could carry it.
//
// Deliberately a separate function from zeroSourceNotice rather than a third
// branch inside it. That function's own test at "a priority with sources that
// merely lost slots does NOT fire" pins the opposite behaviour and states the
// reason — "That is a different case and must not be conflated." Both hold: the
// zero-source notice stays silent here, and this one speaks.
// ---------------------------------------------------------------------------

test("U1: a reachable target that scored zero is disclosed as outbid", () => {
  const html = R.outbidNotice(
    { targets: ["Deadly", "Freedom of Movement"] },
    { status: "optimal", perTarget: { Deadly: 13, "Freedom of Movement": 0 }, chosen: [] },
    _modelWith(["Deadly", "Freedom of Movement"]));
  assert.ok(html, "a notice renders");
  assert.ok(/Freedom of Movement/.test(html), "names the target that got nothing");
  assert.ok(!/>[^<]*Deadly/.test(html.replace(/Freedom of Movement/g, "")),
    "does not name a binding priority it has not proven");
});

test("U1: a target no pool source carries is left to the zero-source notice", () => {
  const html = R.outbidNotice(
    { targets: ["Sonic Lore"] },
    { status: "optimal", perTarget: { "Sonic Lore": 0 }, chosen: [] },
    _modelWith(["Constitution"]));
  assert.strictEqual(html, "", "unreachable is a different cause and already disclosed");
});

test("U1: a free rider produces no outbid disclosure", () => {
  const html = R.outbidNotice(
    { targets: ["Deadly", "Ghostly"] },
    { status: "optimal", perTarget: { Deadly: 13, Ghostly: 1 }, chosen: [] },
    _modelWith(["Deadly", "Ghostly"]));
  assert.strictEqual(html, "", "a satisfied effect cost nothing and is not outbid");
});

test("U1: the Utility sentinel never reports as outbid", () => {
  const html = R.outbidNotice(
    { targets: [_UTIL_SENTINEL] },
    { status: "optimal", perTarget: {}, chosen: [], utilityCount: 0 },
    _modelWith(["Constitution"]));
  assert.strictEqual(html, "", "the sentinel is never a pool stat and must not flag");
});

test("U1: several outbid targets are named together in one disclosure", () => {
  const html = R.outbidNotice(
    { targets: ["Deadly", "Blurry", "Freedom of Movement"] },
    { status: "optimal", perTarget: { Deadly: 13, Blurry: 0, "Freedom of Movement": 0 }, chosen: [] },
    _modelWith(["Deadly", "Blurry", "Freedom of Movement"]));
  assert.ok(/Blurry/.test(html) && /Freedom of Movement/.test(html), "both named");
  assert.strictEqual((html.match(/<p /g) || []).length, 1, "one disclosure, not one per target");
});

test("U1: a non-optimal solve produces no outbid disclosure", () => {
  const html = R.outbidNotice(
    { targets: ["Freedom of Movement"] },
    { status: "infeasible" }, _modelWith(["Freedom of Movement"]));
  assert.strictEqual(html, "");
});

test("U1: renderResults emits the outbid notice — the render, not just the function", () => {
  // #332's lesson: a disclosure that passes its own unit tests and is never
  // called from the render is inert on every surface. Assert the call site.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  const block = src.slice(src.indexOf("container.innerHTML = `"), src.indexOf("active-build-bar"));
  assert.ok(/\$\{outbidNotice\(query, result, model/.test(block),
    "renderResults must emit outbidNotice, or it renders nowhere");
  assert.ok(/canPriceOutbid\(\)/.test(block),
    "and it must pass the pricing capability, or the ask never renders");
});

// ---------------------------------------------------------------------------
// U6 (plan 2026-08-17-001, #345) — an unmet requirement and a lost preference
// are different failures. They must never both speak for the same stat.
// ---------------------------------------------------------------------------

test("U6: a stat with an unmet floor gets the shortfall notice, not the outbid one", () => {
  const res = { status: "optimal", perTarget: { "Freedom of Movement": 0 }, chosen: [],
    floorReport: [{ stat: "Freedom of Movement", floor: 1, achieved: 0 }] };
  const html = R.outbidNotice({ targets: ["Deadly", "Freedom of Movement"] }, res,
    _modelWith(["Deadly", "Freedom of Movement"]));
  assert.strictEqual(html, "", "the requirement failed — boundNotice owns that story");
});

test("U6: one unmet floor and one outbid preference each keep their own notice", () => {
  const res = { status: "optimal", perTarget: { Blurry: 0, "Freedom of Movement": 0 }, chosen: [],
    floorReport: [{ stat: "Blurry", floor: 1, achieved: 0 }] };
  const html = R.outbidNotice({ targets: ["Deadly", "Blurry", "Freedom of Movement"] }, res,
    _modelWith(["Deadly", "Blurry", "Freedom of Movement"]));
  assert.ok(/Freedom of Movement/.test(html), "the outbid preference is still disclosed");
  assert.ok(!/Blurry/.test(html), "the failed requirement is not");
});

test("U6: a satisfied floor produces neither", () => {
  const res = { status: "optimal", perTarget: { "Freedom of Movement": 1 }, chosen: [], floorReport: [] };
  assert.strictEqual(R.outbidNotice({ targets: ["Freedom of Movement"] }, res,
    _modelWith(["Freedom of Movement"])), "");
});

test("U6: a target absent from perTarget is unknown, not outbid", () => {
  // Inventing a zero for a stat the solve never reported is the same class of
  // error as naming a binding priority we have not proven.
  const res = { status: "optimal", perTarget: {}, chosen: [] };
  assert.strictEqual(R.outbidNotice({ targets: ["Deadly"] }, res, _modelWith(["Deadly"])), "",
    "no reported value means no claim");
});

// #369 — when a pin overrides the Artifact opt-in, the player must be told.
// Honoring the pin silently would be its own bug: they left the box unchecked
// and an Artifact is in the build anyway.
test("#369: a pin-included Artifact is disclosed by name", () => {
  const arti = { variant_id: "Baphomet's Reign", source_item: "Baphomet's Reign", artifact: true };
  const plain = { variant_id: "Plain Ring", source_item: "Plain Ring" };
  const result = { chosen: [{ slot: "Ring", variant: arti }, { slot: "Neck", variant: plain }] };
  const query = { includeArtifact: false, slotConstraints: { Ring: { type: "pin", variant_id: "Baphomet's Reign" } } };

  assert.deepStrictEqual(R.artifactsIncludedByPin(result, query), ["Baphomet's Reign"]);
  const html = R.artifactNotice(result, query);
  // The item name is HTML-ESCAPED (`Baphomet&#39;s Reign`) because this returns
  // markup — asserting the raw apostrophe would have been asserting an XSS hole.
  assert.ok(/Baphomet&#39;s Reign/.test(html),
    `names the item, escaped — a bare "an Artifact" leaves them hunting: ${html}`);
  assert.ok(!/Baphomet's Reign/.test(html), "and never unescaped into markup");
  assert.ok(/because you pinned it/.test(html), "and says why it is there");
  assert.ok(/Unpin to exclude it/.test(html), "and how to undo it");
});

test("#369: no disclosure when the opt-in is ON or nothing pinned is an Artifact", () => {
  const arti = { variant_id: "A", source_item: "A", artifact: true };
  const onQuery = { includeArtifact: true, slotConstraints: { Ring: { type: "pin", variant_id: "A" } } };
  const result = { chosen: [{ slot: "Ring", variant: arti }] };
  assert.deepStrictEqual(R.artifactsIncludedByPin(result, onQuery), [],
    "the player already asked for an Artifact — nothing to disclose");

  const plainPin = { includeArtifact: false, slotConstraints: { Ring: { type: "pin", variant_id: "Plain" } } };
  const plainResult = { chosen: [{ slot: "Ring", variant: { variant_id: "Plain", source_item: "Plain" } }] };
  assert.deepStrictEqual(R.artifactsIncludedByPin(plainResult, plainPin), [],
    "a pinned non-Artifact triggers nothing");
});


// ---- #88 U8 (R13/R16) — the rendered contributor label ----------------------
// A correct solver-side marker that no surface renders is a dead feature, and the
// only thing that catches it is asserting on the HTML the player actually sees.
test("#88 U8 (R13/AE16): an overridden contribution renders labelled, naming both types", () => {
  const html = R.attributionList([
    { bonus_type: "Insight", value: 6, source: "Necklace of X", sourceKind: "worn",
      slots: ["Necklace"], hostIds: ["Necklace of X"], isSet: false, via: null,
      crossAdd: null, overriddenFrom: "Enhancement" },
  ]);
  assert.ok(/is-overridden/.test(html), "the row is marked for styling");
  assert.ok(/your Insight/.test(html), "the type the player asserted");
  assert.ok(/catalog says Enhancement/.test(html), "and the type the catalog records");
  assert.ok(/on your word, not the wiki/.test(html), "…with why it is labelled at all");
});

test("#88 U8: an ordinary contribution is not labelled", () => {
  const html = R.attributionList([
    { bonus_type: "Insight", value: 6, source: "Necklace of X", sourceKind: "worn",
      slots: ["Necklace"], hostIds: ["Necklace of X"], isSet: false, via: null,
      crossAdd: null, overriddenFrom: null },
  ]);
  assert.ok(!/is-overridden|your Insight|catalog says/.test(html),
    "a build with no overrides renders exactly as it did before");
});

// ---------------------------------------------------------------------------
// #335 U4 — the two RENDER loops. Both were index- or position-bound and both
// would otherwise emit a second entry for the twin, which reads as the affixes
// applying twice. These exercise the loops themselves rather than the collapse
// helper they call, because the helper being right is not the same as the loops
// using it.
// ---------------------------------------------------------------------------

const _M4 = require("../web/model.js");

function _dupBuild() {
  const id = [...(_M4.DUPLICABLE_RINGS)][0];
  const mk = (vid) => ({ variant_id: vid, source_item: id, slot: "Ring", ml: 31,
    affixes: [{ name: "Charisma", type: "Enhancement", value: 14, unit: "flat" }],
    set_bonus: [{ set: "Legendary Perfected Wrath" }], scaling: [], augment_slots: [] });
  return {
    status: "optimal",
    chosen: [{ slot: "Ring", variant: mk(id) }, { slot: "Ring", variant: mk(_M4.twinIdOf(id)) }],
    effective: { Charisma: 14 }, augmentsPlaced: [], setsActive: [], dinoPlaced: [],
    ncPlaced: [], rollPlaced: [], vikPlaced: [], sealPlaced: [], tfPlaced: [], gsPlaced: [],
    jokerPlaced: [], membershipPlaced: [], setAugmentsPlaced: [],
  };
}

test("#335 U4: the paperdoll renders a doubled ring as ONE row, not two", () => {
  const build = _dupBuild();
  const model = { worn: [{ slot: "Ring", cardinality: 2, variants: [] }], augments: [] };
  const v = R.buildViews(build, model, { targets: ["Charisma"] });
  const html = String(v.paperdoll || "");
  assert.ok(/Katra/.test(html), "the ring is rendered at all");
  // Measured against the pre-U4 tree this emits 2 rows and leaks the suffixed id
  // into markup the player reads. Both are asserted exactly, not with a bound.
  assert.strictEqual((html.match(/class="pd-rname"/g) || []).length, 1,
    "the position-bound loop must not emit a second Ring row for the twin");
  assert.ok(!/::twin/.test(html), "and no suffixed twin id reaches the rendered row");
});

test("#335 U4: the Deep Dive merges the pair into one block", () => {
  const build = _dupBuild();
  const P4 = require("../web/projection.js");
  const html = String(R.loadoutDeepDive(build, { targets: ["Charisma"] }, P4.buildCraftMaps(build), null) || "");
  assert.ok(!/::twin/.test(html), "no suffixed twin id reaches the Deep Dive");
  const blocks = (html.match(/class="dd-item/g) || []).length;
  assert.strictEqual(blocks, 1,
    "one block for the pair — this tab is the only surface showing augments, so a split here is the worst place for the 'affixes apply twice' reading");
});

// ---------------------------------------------------------------------------
// U10 (plan 2026-08-22-001) — the three multi-fact notices are addressable per
// FIRED branch, and render byte-identically to the pre-change tree while doing it.
//
// results.js derives the facts (it owns the model/dataset/pin readers); the
// wording lives in projection.js, the single content source. These tests pin the
// rendered bytes as literals: the sentences are the product, only the addressing
// changed, so any diff here is a player-facing text change.
// ---------------------------------------------------------------------------

const _u10Declared = { mlFloor: 0, targetCaps: {}, style: "one-hand", twoWeaponFighting: true };
const _u10Shield = { source_item: "Tower Shield", variant_id: "Tower Shield", type: "Tower shields" };
const _u10OffHandResult = { perTarget: {}, floorReport: [], chosen: [{ slot: "Off Hand", variant: _u10Shield }] };

test("U10: boundNotice renders exactly its entries' sentences, in order", () => {
  const q = { mlFloor: 32, targetCaps: { Dodge: 4 } };
  const r = { perTarget: { Dodge: 4 }, floorReport: [{ stat: "Combat Mastery", floor: 10, achieved: 7 }] };
  const entries = R.boundNoticeEntries(q, r);
  assert.deepStrictEqual(entries.map((e) => e.id), ["gear-ml-floor", "floor-not-reached", "held-at-your-cap"]);
  assert.strictEqual(R.boundNotice(q, r),
    `<p class="scope-note bound-note" role="status">${entries.map((e) => e.sentence).join(" ")}</p>`,
    "the render is the entries and nothing else");
  // Byte-identical to the pre-change tree for the same input.
  assert.strictEqual(R.boundNotice(q, r),
    '<p class="scope-note bound-note" role="status">Considered gear ML ≥ 32 (your floor). '
    + "Couldn't reach your floor of 10 Combat Mastery — best achievable was 7. "
    + "Held at your cap: Dodge 4.</p>");
});

test("U10: the entry count is the number of fired branches, not the notice function count", () => {
  assert.strictEqual(R.boundNoticeEntries({ mlFloor: 0, targetCaps: {} }, { perTarget: {}, floorReport: [] }).length, 0);
  assert.strictEqual(R.boundNotice({ mlFloor: 0, targetCaps: {} }, { perTarget: {}, floorReport: [] }), "",
    "no fired branch renders nothing at all");
  assert.strictEqual(R.boundNoticeEntries({ mlFloor: 32, targetCaps: {} }, { perTarget: {}, floorReport: [] }).length, 1);
  assert.strictEqual(R.boundNoticeEntries(_u10Declared, _u10OffHandResult).length, 1,
    "the whole off-hand disclosure is one fact, however many branches of it were evaluated");
});

test("U10: an ML-floor-only solve produces GEAR ML FLOOR and claims no declared credit", () => {
  const entries = R.boundNoticeEntries({ mlFloor: 32, targetCaps: {} }, { perTarget: {}, floorReport: [] });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].title, "GEAR ML FLOOR");
  assert.strictEqual(entries[0].class, "qualifying");
  assert.ok(!entries.some((e) => /DECLARED CREDIT/.test(e.title) || /BONUS TYPE/.test(e.title)),
    "a bundled title would assert a credit on a solve that declared none");
});

test("U10: a floor the solve could not reach is classed actionable", () => {
  const entries = R.boundNoticeEntries({ mlFloor: 0, targetCaps: {} },
    { perTarget: {}, floorReport: [{ stat: "Combat Mastery", floor: 10, achieved: 7 }] });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].id, "floor-not-reached");
  assert.strictEqual(entries[0].class, "actionable");
});

test("U10: a build solved before the TWF declaration is actionable; the other two off-hand cases are not", () => {
  const stale = R.boundNoticeEntries(Object.assign({}, _u10Declared, { slotConstraints: {} }), _u10OffHandResult);
  assert.strictEqual(stale[0].id, "re-solve-to-apply");
  assert.strictEqual(stale[0].class, "actionable");
  const pinned = R.boundNoticeEntries(
    Object.assign({}, _u10Declared, { slotConstraints: { "Off Hand": { type: "pin", variant_id: "Tower Shield" } } }),
    _u10OffHandResult);
  assert.strictEqual(pinned[0].id, "off-hand-excluded");
  assert.strictEqual(pinned[0].class, "qualifying");
  const plain = R.boundNoticeEntries(_u10Declared, { perTarget: {}, floorReport: [], chosen: [] });
  assert.strictEqual(plain[0].id, "off-hand-excluded");
  assert.strictEqual(plain[0].class, "qualifying");
  // Same rendered bytes as before the split, in all three cases.
  assert.ok(/solved before the declaration/.test(R.boundNotice(
    Object.assign({}, _u10Declared, { slotConstraints: {} }), _u10OffHandResult)));
});

test("U10: artifactNotice's two branches are never one entry, and render unchanged", () => {
  const plainRing = { chosen: [{ slot: "Ring", variant: { variant_id: "Plain Ring", source_item: "Plain Ring" } }] };
  const missing = R.artifactNoticeEntries(plainRing, { includeArtifact: true });
  assert.deepStrictEqual(missing.map((e) => e.id), ["artifact-unavailable"]);
  assert.strictEqual(missing[0].class, "qualifying");
  assert.strictEqual(R.artifactNotice(plainRing, { includeArtifact: true }),
    '<div class="artifact-notice" role="status">No Artifact could be included — none is flagged in the current data.</div>');

  const arti = { variant_id: "Baphomet's Reign", source_item: "Baphomet's Reign", artifact: true };
  const pinnedResult = { chosen: [{ slot: "Ring", variant: arti }] };
  const pinnedQuery = { includeArtifact: false,
    slotConstraints: { Ring: { type: "pin", variant_id: "Baphomet's Reign" } } };
  const pinned = R.artifactNoticeEntries(pinnedResult, pinnedQuery);
  assert.deepStrictEqual(pinned.map((e) => e.id), ["artifact-pinned-in"]);
  assert.strictEqual(pinned[0].class, "actionable");
  assert.ok(!pinned.some((e) => e.id === "artifact-unavailable"),
    "the none-flagged claim must never ride along with a named, included Artifact");
  assert.strictEqual(R.artifactNotice(pinnedResult, pinnedQuery),
    '<div class="artifact-notice" role="status">Baphomet&#39;s Reign is an Artifact and was included '
    + 'because you pinned it, even though "Include an Artifact" is off. Unpin to exclude it.</div>');
  assert.strictEqual(R.artifactNoticeEntries(plainRing, { includeArtifact: false }).length, 0);
});

test("U10: zeroSourceNotice's absent and filtered branches are separate entries with different classes", () => {
  const q = { targets: ["Sonic Lore", "Ice Lore"] };
  const model = _modelWith(["Constitution"]);
  const dataset = _datasetWith(["Sonic Lore"]);   // Sonic Lore exists but is filtered out
  const entries = R.zeroSourceNoticeEntries(q, _okResult, model, dataset);
  assert.deepStrictEqual(entries.map((e) => e.id), ["stat-not-in-data", "stat-filtered-out"]);
  assert.deepStrictEqual(entries.map((e) => e.class), ["qualifying", "actionable"]);
  assert.strictEqual(R.zeroSourceNotice(q, _okResult, model, dataset),
    '<p class="scope-note zero-source-note" role="status">'
    + "Nothing in the current data carries Ice Lore — ranking it can't change your build. "
    + "No source of Sonic Lore is available in your current filters — "
    + "widening the ML band or character filters may reach it.</p>");
  assert.strictEqual(R.zeroSourceNoticeEntries({ targets: ["Constitution"] }, _okResult,
    _modelWith(["Constitution"]), _datasetWith(["Constitution"])).length, 0);
});

// ---- #446 U3: the ranked-priority card's achieved/ceiling fraction ----------
// No DOM in this suite (see the file header), so the box is asserted on the HTML
// string `buildViews` returns and on the CSS rule text that gives each state its
// treatment. Every assertion pins a specific string so it cannot pass vacuously.

function _reachBuild(rows, opts) {
  const o = opts || {};
  const b = { status: "optimal", chosen: [], setsActive: [], augmentsPlaced: [],
    breakdown: o.breakdown || {}, effective: o.effective || {} };
  if (rows) b.ceilingReport = rows;
  if (o.capped) b.capped = o.capped;
  return b;
}
const _reachModel = { worn: [], augments: [] };
function _reachCss() {
  const fs = require("fs"); const path = require("path");
  return fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
}
function _cssRule(css, sel) {
  const at = css.indexOf(sel);
  assert.ok(at >= 0, `styles.css defines ${sel}`);
  return css.slice(at, css.indexOf("}", at) + 1);
}

test("#446 U3 (R11/R12/R13): a maxed stat renders the fraction, a full green meter and the shared maxed sentence", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 12, ceiling: 12 }], { effective: { Dodge: 12 } });
  const v = R.buildViews(b, _reachModel, { targets: ["Dodge"] });
  assert.ok(/class="stat-reach is-maxed"/.test(v.cards), "the box carries the maxed state class");
  assert.ok(/<span class="reach-fraction">12 \/ 12<\/span>/.test(v.cards), "the fraction renders verbatim");
  assert.ok(/<span class="reach-fill" style="width:100%"><\/span>/.test(v.cards), "the meter is full");
  assert.ok(/no other item in your pool raises it/.test(v.cards),
    "the SHARED maxed short form, not a card-local rewording");
  const css = _reachCss();
  assert.ok(/var\(--optimal\)/.test(_cssRule(css, ".stat-reach.is-maxed {")),
    "the maxed box takes the green border/tint");
  assert.ok(/var\(--optimal\)/.test(_cssRule(css, ".stat-reach.is-maxed .reach-fraction")),
    "and the fraction is green with it");
});

test("#446 U3 (R14/R29): a shortfall renders its fraction, a proportional meter and the whole-track bound treatment", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 30, ceiling: 50 }], { effective: { Dodge: 30 } });
  const v = R.buildViews(b, _reachModel, { targets: ["Dodge"] });
  assert.ok(/class="stat-reach is-shortfall"/.test(v.cards), "the shortfall state class");
  assert.ok(/<span class="reach-fraction">30 \/ 50<\/span>/.test(v.cards), "30 / 50");
  assert.ok(/<span class="reach-fill" style="width:60%"><\/span>/.test(v.cards), "a 60% meter");
  assert.ok(!/is-maxed/.test(v.cards), "no maxed class");
  assert.ok(/the ceiling sums the best source in each bonus type that carries this stat/.test(v.cards),
    "the shared shortfall short form");
  // R29 — the HATCH IS ON THE TRACK, not on a remainder element. There is no
  // remainder element to hatch: the meter's only child is the fill.
  assert.ok(!/reach-(rest|remainder|unfilled|empty)/.test(v.cards),
    "no remainder-only element exists, so the hatch cannot have been scoped to one");
  const css = _reachCss();
  const track = _cssRule(css, ".reach-meter {");
  assert.ok(/repeating-linear-gradient/.test(track), "the whole track carries the hatch");
  // …and the fill is translucent, so the hatch stays visible THROUGH it at every
  // fill level — a 96%-filled bar must still read as a bound.
  assert.ok(/rgba\(/.test(_cssRule(css, ".reach-fill {")),
    "the fill is drawn over the hatch translucently, not as an opaque cover");
});

test("#446 U3 (R14): a shortfall card carries no red or warning colour class", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 30, ceiling: 50 }], { effective: { Dodge: 30 } });
  const box = R.buildViews(b, _reachModel, { targets: ["Dodge"] }).cards;
  const reach = box.slice(box.indexOf('class="stat-reach'));
  assert.ok(!/(is-cap-bound|quarantined|warn|danger|error|invalid)/.test(reach),
    "a shortfall is not a fault");
  const shortfall = _cssRule(_reachCss(), ".stat-reach.is-shortfall .reach-fraction");
  assert.ok(/var\(--accent\)/.test(shortfall), "the neutral accent");
  assert.ok(!/--quarantined|#f0b360|red/.test(shortfall), "and nothing warning-coloured");
});

test("#446 U3 (R19/R17b): a build with no ceilingReport renders no .stat-reach and falls back to ceilingChip", () => {
  const b = satBuild();                       // pre-#446 shape: saturationReport, no ceilingReport
  b.effective = { "Kinetic Lore": 30 };
  let v;
  assert.doesNotThrow(() => { v = R.buildViews(b, _reachModel, { targets: ["Kinetic Lore"] }); });
  assert.ok(!/stat-reach/.test(v.cards), "no box, and no denominator nobody computed");
  assert.ok(/class="stat-ceiling at-ceiling"/.test(v.cards), "the old chip still carries the old data");
  // Positive control, same call shape — the absence above is the missing report,
  // not a box that never renders.
  b.ceilingReport = [{ stat: "Kinetic Lore", achieved: 30, ceiling: 44 }];
  assert.ok(/class="stat-reach is-shortfall"/.test(
    R.buildViews(b, _reachModel, { targets: ["Kinetic Lore"] }).cards),
  "the identical build WITH a report does render the box");
});

test("#446 U3/R19: rendering a restored build invokes no solve entry point", () => {
  const solverPath = require.resolve("../web/solver.js");
  const resultsPath = require.resolve("../web/results.js");
  const solver = require(solverPath);
  const ENTRIES = ["solveLexicographic", "solveConstrained", "readSolution", "generateAlternatives"];
  const calls = {}; const orig = {};
  for (const k of ENTRIES) {
    calls[k] = 0; orig[k] = solver[k];
    // Both bridges results.js could reach the solver through: the module object
    // and the shared browser global. Reloading results.js AFTER installing them
    // is what makes the count load-bearing rather than vacuous.
    solver[k] = function () { calls[k]++; return orig[k].apply(this, arguments); };
    globalThis[k] = solver[k];
  }
  delete require.cache[resultsPath];
  try {
    const R2 = require(resultsPath);
    const b = _reachBuild([{ stat: "Dodge", achieved: 3, ceiling: 9 }], { effective: { Dodge: 3 } });
    const v = R2.buildViews(b, _reachModel, { targets: ["Dodge"] });
    assert.ok(/<span class="reach-fraction">3 \/ 9<\/span>/.test(v.cards),
      "the saved report alone produced the fraction");
    for (const k of ENTRIES) assert.strictEqual(calls[k], 0, `${k} must not run to render a saved build`);
  } finally {
    for (const k of ENTRIES) { solver[k] = orig[k]; delete globalThis[k]; }
    delete require.cache[resultsPath];
    require(resultsPath);
  }
});

test("#446 U3 (R30): a zero ceiling renders no meter, no green, and claims only what this solve found", () => {
  const b = _reachBuild([{ stat: "Doubleshot", achieved: 0, ceiling: 0 }], { effective: { Doubleshot: 0 } });
  const v = R.buildViews(b, _reachModel, { targets: ["Doubleshot"] });
  assert.ok(/class="stat-reach is-zero-ceiling"/.test(v.cards), "its own state class");
  assert.ok(!/reach-meter/.test(v.cards), "no meter for a 0 / 0");
  assert.ok(!/is-maxed/.test(v.cards), "0 === 0 must not read as at-ceiling green");
  assert.ok(/this solve found nothing reachable that carries this stat/.test(v.cards),
    "it claims only what the solve found");
  assert.ok(!/(current data|filters|ranking it)/.test(v.cards),
    "and does NOT defer to zeroSourceNotice, which may not be on screen at all");
});

test("#446 U3 (R33): a capped stat's fraction numerator equals the card's headline number", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 20, ceiling: 20 }],
    { effective: { Dodge: 20 }, capped: { Dodge: 20 } });
  const cards = R.buildViews(b, _reachModel, { targets: ["Dodge"] }).cards;
  const headline = (cards.match(/data-final="(\d+)"/) || [])[1];
  const numerator = (cards.match(/class="reach-fraction">(\d+) \//) || [])[1];
  assert.strictEqual(headline, "20", "the headline is effectiveOf = min(cap, raw)");
  assert.strictEqual(numerator, headline, "the card never states two different totals for one stat");
});

test("#446 U3 (R33/KTD7): a cap-bound card renders neither the green treatment nor the maxed sentence", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 20, ceiling: 20 }],
    { effective: { Dodge: 20 }, capped: { Dodge: 20 } });
  const cards = R.buildViews(b, _reachModel, { targets: ["Dodge"] }).cards;
  assert.ok(/class="stat-reach is-cap-bound"/.test(cards), "its own state, not the maxed one");
  assert.ok(!/is-maxed/.test(cards), "green is reserved for achieved === pool ceiling");
  assert.ok(!/no other item in your pool raises it/.test(cards),
    "the maxed sentence would be false when the cap is the binding limit");
  assert.ok(/clamped to your cap of 20/.test(cards), "it names the cap, agreeing with the capNote idiom");
  const rule = _cssRule(_reachCss(), ".stat-reach.is-cap-bound {");
  assert.ok(!/var\(--optimal\)/.test(rule), "and takes no part of the green treatment");
});

test("#446 U3 (R34): the Utility card renders no fraction sub-container", () => {
  const b = utilityBuild({ count: 2, effects: [{ name: "Ghost Touch", item: "rGT" }] });
  // Even if a sentinel row leaked into the report. The exemption is STRUCTURAL —
  // `buildViews` returns utilityCard before reaching the stat-card template — so a
  // real stat is ranked alongside it as a positive control: the box renders on
  // that card in the same call, and still not on the Utility one.
  b.ceilingReport = [{ stat: U_SENT, achieved: 0, ceiling: 0 }, { stat: "A", achieved: 4, ceiling: 9 }];
  b.effective = { A: 4 };
  const v = R.buildViews(b, _reachModel, { targets: [U_SENT, "A"] });
  assert.ok(/utility-card/.test(v.cards), "the dedicated card still renders");
  assert.strictEqual(v.cards.split("stat-reach").length - 1, 1, "exactly one box across the two cards");
  const utilCard = v.cards.slice(v.cards.indexOf("utility-card"), v.cards.indexOf('class="stat-card"'));
  assert.ok(!/stat-reach/.test(utilCard), "a count of distinct effects is not a summable stat");
  assert.ok(/<span class="reach-fraction">4 \/ 9<\/span>/.test(v.cards), "…while the ranked stat beside it has one");
});

test("#446 U3 (AE6): no stat card carries both a ceilingChip and a .stat-reach box", () => {
  const b = satBuild();                       // carries a saturationReport…
  b.effective = { "Kinetic Lore": 30 };
  b.ceilingReport = [{ stat: "Kinetic Lore", achieved: 30, ceiling: 30 }];   // …and the new one
  const v = R.buildViews(b, _reachModel, { targets: ["Kinetic Lore"] });
  assert.ok(/stat-reach/.test(v.cards), "the fraction wins");
  assert.ok(!/stat-ceiling/.test(v.cards), "and the chip stands down — the two are mutually exclusive");
});

test("#446 U3 (KTD9): a selected alternative renders the fraction from its OWN ceilingReport", () => {
  const optimum = _reachBuild([{ stat: "Dodge", achieved: 41, ceiling: 60 }], { effective: { Dodge: 41 } });
  const alt = _reachBuild([{ stat: "Dodge", achieved: 23, ceiling: 60 }], { effective: { Dodge: 23 } });
  const vOpt = R.buildViews(optimum, _reachModel, { targets: ["Dodge"] });
  const vAlt = R.buildViews(alt, _reachModel, { targets: ["Dodge"] });
  assert.ok(/<span class="reach-fraction">41 \/ 60<\/span>/.test(vOpt.cards), "the optimum states its own");
  assert.ok(/<span class="reach-fraction">23 \/ 60<\/span>/.test(vAlt.cards), "the alternative states its own");
  assert.ok(!/41/.test(vAlt.cards), "the optimum's numerator never appears on an alternative's card");
  // …and structurally: the card loop hands ceilingFor the build being rendered.
  const src = require("fs").readFileSync(require.resolve("../web/results.js"), "utf-8");
  assert.ok(/statReach\(build, stat\)/.test(src),
    "renderBuild is generic over optimum/alternative — it must never close over the optimum");
});

test("#446 U3 (R15): the full statement renders ONCE per readout, above the cards, not once per card", () => {
  const P = require("../web/projection.js");
  const b = _reachBuild([{ stat: "A", achieved: 1, ceiling: 2 }, { stat: "B", achieved: 1, ceiling: 2 }],
    { effective: { A: 1, B: 1 } });
  const v = R.buildViews(b, _reachModel, { targets: ["A", "B"] });
  assert.strictEqual(v.cards.split(P.CEILING_FULL_STATEMENT).length - 1, 1,
    "repeated under every card it reads as boilerplate and stops being read");
  assert.ok(v.cards.indexOf(P.CEILING_FULL_STATEMENT) < v.cards.indexOf("stat-card"),
    "it sits at section level, before the first card, so it is in the same view");
  assert.strictEqual(v.cards.split('class="reach-fraction"').length - 1, 2, "both cards still carry their own fraction");
  const noReport = _reachBuild(null, { effective: { A: 1 } });
  assert.ok(!/ceiling-statement/.test(R.buildViews(noReport, _reachModel, { targets: ["A"] }).cards),
    "a pre-#446 restore prints no orphan sentence");
});

test("#446 U4 (R17a): no stylesheet rule styles a per-item ceiling marker", () => {
  const css = _reachCss();
  // Asserted against the stylesheet directly, not through `_cssRule`: that helper
  // asserts the selector EXISTS and slices its body, so it cannot express absence.
  assert.ok(!css.includes(".pd-prio .at-ceiling"),
    "the rule is removed, not merely unreferenced — a live rule invites the span back");
  assert.ok(/\.pd-prio \.pd-contrib/.test(css), "the span it styled is still styled");
  // The stat-card fallback keeps the class for a pre-#446 restore (R17b), so the
  // name survives in exactly one place. Pin that, or a future sweep deletes it.
  assert.ok(/\.stat-ceiling/.test(css), "the old-save chip keeps its rule");
});

test("#446 U4: whyThisLine no longer consults the saturation report at all", () => {
  // Asserted against the function's own source, in the wizard.test.js idiom.
  // A call-count spy CANNOT measure this: results.js captures `Proj.saturatedStats`
  // into a module-scope binding at load, so patching projection afterwards leaves
  // the captured reference untouched and the spy reads zero either way — a guard
  // that passes on the pre-change tree and therefore checks nothing.
  const src = R.whyThisLine.toString();
  const body = src.slice(0, src.indexOf("pd-prio"));
  assert.ok(!/saturatedStats\s*\(/.test(body), "the lookup went with the marker, not just its output");
  assert.ok(!/saturationLineFor\s*\(/.test(body), "and so did the per-item sentence it fed");
  assert.ok(typeof R.saturatedStats === "function",
    "but the binding stays on the re-export surface projection.test.js pins");
});
