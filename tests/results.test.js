// U8 — build-sheet reconstruction tests (pure functions; no DOM).
const assert = require("assert");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

/** #450 — slice a source region between two markers, with the closing search
 *  ANCHORED to the opening index.
 *
 *  The unanchored form — `src.slice(src.indexOf(A), src.indexOf(B))` — searches
 *  for B from position 0, so any earlier occurrence of B captures the closing
 *  bound, the range inverts, and `slice` returns "" rather than throwing. That
 *  has already cost this repo a confusing red (#348, where an unrelated feature
 *  inverted a guard about focus) and, in four cases, a silent green (#450).
 *
 *  Both markers are asserted present, so a renamed marker fails here naming the
 *  marker, instead of somewhere downstream naming a behaviour that is fine.
 */
const NOTICE_CLASSES = ["actionable", "qualifying", "informational"];

function srcBetween(src, open, close, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `${label || "srcBetween"}: opening marker not found — ${open}`);
  const b = src.indexOf(close, a);
  assert.ok(b >= a, `${label || "srcBetween"}: closing marker not found after the opening — ${close}`);
  return src.slice(a, b);
}

/** #450 — the fixed-window variant: from a marker, forward N characters. Locates
 *  the marker ONCE (the two-call form can disagree with itself) and refuses a
 *  missing marker, which would otherwise make the start negative — and `slice`
 *  reads a negative start as an offset from the END of the string. */
function srcFrom(src, open, len, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `${label || "srcFrom"}: marker not found — ${open}`);
  return src.slice(a, a + len);
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

// #472 — these six pinned `craftChips`, which is retired. Every guarantee they
// held is still a guarantee; it is now held on the row renderers the
// card uses. The membership pair is the load-bearing one: "Awaken" is
// correct for exactly one crafting system, and the fork reads the
// crafting-systems.js registry rather than a literal in the renderer (KTD2).
function setMaps(o) {
  o = o || {};
  return {
    augAssign: { byIndex: new Map(), freeByIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
    tfByItem: new Map(), gsByItem: new Map(),
    jokerByHost: o.jokerByHost || new Map(),
    membershipByHost: o.membershipByHost || new Map(),
    setAugByHost: o.setAugByHost || new Map(),
  };
}

test("#472: a wildcard names the set it makes this item a member of", () => {
  const gem = { variant_id: "Legendary Gem of Many Facets", wiki_url: "https://ddowiki.com/x" };
  const maps = setMaps({ jokerByHost: new Map([["Legendary Gem of Many Facets",
    [{ host: "Legendary Gem of Many Facets", group: 0, set: "Legendary Draconic Prophecy" }]]]) });
  const html = R.setMembershipSection(gem, maps, null);
  assert.ok(/<span class="pd-ln-where">Wildcard<\/span><span class="pd-ln-what">Legendary Draconic Prophecy/.test(html),
    "the mechanism on the left, the set it yields on the right");
  // A non-Gem item with no joker pick renders no set-membership section at all.
  assert.strictEqual(R.setMembershipSection({ variant_id: "Some Ring" }, maps, null), "",
    "no wildcard row for a non-joker item");
});

function membershipMaps(host, set, station) {
  return setMaps({ membershipByHost: new Map([[host, [{ host, set, station }]]]) });
}

test("#472: Vecna renders as 'Awaken Set Bonus' — the only place 'awaken' survives", () => {
  const host = { variant_id: "Legendary University Mage's Hat", wiki_url: "https://ddowiki.com/x" };
  const maps = membershipMaps("Legendary University Mage's Hat", "Legendary Vol's Influence", "Cannith Repurposing Station");
  const html = R.setMembershipSection(host, maps, null);
  // esc() HTML-escapes the apostrophe in "Vol's", so match around it.
  assert.ok(/Awaken Set Bonus: Legendary Vol/.test(html) && /Influence/.test(html), "renders the awakened set");
  assert.ok(/Cannith Repurposing Station/.test(html),
    "names the station VISIBLY — 'awaken this set' is useless without where to go");
  assert.strictEqual(R.setMembershipSection({ variant_id: "Some Ring" }, maps, null), "",
    "no membership row for a non-host item");
});

test("#472: Isle-of-Dread renders as 'Slot Set Bonus augment', never 'awaken'", () => {
  const host = { variant_id: "Legendary Dino Vest" };
  const maps = membershipMaps("Legendary Dino Vest", "The Legendary Dread Isle's Curse", "Dinosaur Bone crafting");
  const html = R.setMembershipSection(host, maps, null);
  assert.ok(/Slot Set Bonus augment: The Legendary Dread Isle/.test(html), "renders the crafted Set Bonus augment");
  assert.ok(!/awaken/i.test(html), "Dino Set Bonus must not say 'awaken'");
});

test("#472: the membership row IS the registry's actionLabel output, in both columns", () => {
  // KTD2, unchanged in force. The row must render exactly what
  // crafting-systems.js produces, so a terminology edit in the registry can
  // never silently diverge from the UI. Splitting the label into a hardcoded
  // "Awaken" plus the set name would have read better and would have put the
  // literal back in the renderer — which is the drift this rule exists to stop.
  const CS = require("../web/crafting-systems.js");
  const vec = R.setMembershipSection({ variant_id: "V" },
    membershipMaps("V", "Legendary Vol's Influence", "Cannith Repurposing Station"), null);
  assert.ok(vec.includes(R.esc(CS.actionLabel("vecna-lost-purpose", { set_name: "Legendary Vol's Influence" }))),
    "the Vecna row's value equals the registry label");
  // The system name is registry-sourced too, asserted on the label rather than
  // the rendered row: the row blanks a where-column that only restates what its
  // value column already says (a 6.7em uppercase column truncates it anyway).
  const P472 = require("../web/projection.js");
  assert.strictEqual(
    P472.craftRowLabel({ set: "S", station: "Cannith Repurposing Station" }, "membership").system,
    CS.get("vecna-lost-purpose").system_name, "the system name comes from the registry");
  const dino = R.setMembershipSection({ variant_id: "D" },
    membershipMaps("D", "Legendary Dread Stalker", "Dinosaur Bone crafting"), null);
  assert.ok(dino.includes(R.esc(CS.actionLabel("isle-of-dread-set-bonus", { set_name: "Legendary Dread Stalker" }))),
    "the Dino row's value equals the registry label");
  assert.strictEqual(
    P472.craftRowLabel({ set: "S", station: "Dinosaur Bone crafting" }, "membership").system,
    CS.get("isle-of-dread-set-bonus").system_name, "…for the other station too");
});

// Deliberately NOT proven red: `craftSection` already existed (#471) and already
// said this. It is carried over from the retired `craftChips` test as a
// regression guard — the player-facing names are "Nearly Completed" and
// "Viktranium"; "Lamordia" is the internal one and has leaked before.
test("#472: the craft rows say 'Nearly Completed' and 'Viktranium', not 'Nearly Complete'/'Lamordia'", () => {
  const v = { variant_id: "Legendary Thing" };
  const maps = blockMaps({
    ncByItem: new Map([["Legendary Thing", [{ stat: "Charisma", value: 4, bonus_type: "Quality" }]]]),
    vikByItem: new Map([["Legendary Thing", [{ slot_type: "Melancholic", stat: "Constitution", value: 15 }]]]),
  });
  const html = R.craftSection(v, 0, maps, { keys: new Set(), byStat: new Map(), list: [] }, null, new Set());
  assert.ok(/Nearly Completed/.test(html) && !/Nearly Complete[^d]/.test(html), "Nearly Completed");
  assert.ok(/<span class="pd-ln-where">Melancholic<\/span>/.test(html), "the Viktranium slot is named by its type");
  assert.ok(/Viktranium/.test(html), "and the system is named in the caption");
  assert.ok(!/Lamordia/.test(html), "no 'Lamordia' anywhere — that is the internal name, not the player's");
});

test("#472/U7: a placed Set Augment renders on its host with the suppression note", () => {
  const v = { variant_id: "Vol Amulet", set_bonus: [{ set: "Vol Set" }] };
  const maps = setMaps({ setAugByHost: new Map([["Vol Amulet",
    [{ set: "Legendary Prowess", host: "Vol Amulet", slot_color: "Blue" }]]]) });
  const html = R.setMembershipSection(v, maps, null);
  assert.ok(/Legendary Prowess/.test(html), "renders the placed Set Augment");
  assert.ok(/suppresses Vol Set/.test(html), "names the suppressed own set — what the augment COST");
  assert.ok(/<span class="pd-ln-where">Blue<\/span>/.test(html), "…and the coloured slot it consumed (#316)");
  assert.strictEqual(R.setMembershipSection({ variant_id: "Some Ring" }, maps, null), "",
    "no row for a non-host item");
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
  // no full affix/craft detail on the cell face (that lives on the gear card)
  assert.ok(!html.includes("<details"), "the cell no longer expands on the paperdoll");
  // a non-member slot carries no set-highlight
  const plain = R.paperdollSlot("Boots", "boots", { variant: { variant_id: "X", minimum_level: 1, set_bonus: [], affixes: [] }, idx: 0 });
  assert.ok(!plain.includes("is-set"), "no highlight on a non-member");
  // an empty cell reads 'empty' (no em-dash)
  const empty = R.paperdollSlot("Boots", "boots", null);
  assert.ok(/>empty</.test(empty) && !empty.includes("—"), "empty cell has no em-dash");
});

test("#498: the Loadout card carries slot, affixes and set name on one row", () => {
  // The three facts the retired Deep Dive opened with. They are asserted here as
  // ONE row rather than three separate unit checks because the point is that a
  // player reading a gear card needs no second tab to learn them.
  const result = {
    chosen: [{ slot: "Bracers", variant: { variant_id: "Kopru Bracers", minimum_level: 31, set_bonus: [{ set: "Dread Isle's Curse" }], affixes: [{ stat: "Constitution", bonus_type: "Insightful", value: 3, unit: "flat" }] } }],
    breakdown: {}, augmentsPlaced: [], effective: {}, perTarget: {},
  };
  const maps = { augAssign: { byIndex: new Map() }, dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(), jokerByHost: new Map() };
  const P = require("../web/projection.js");   // `Pj` is declared further down this file
  const pick = { variant: result.chosen[0].variant, idx: 0 };
  const ctx = { result, attr: R.attributionByTarget(result), targets: [] };
  const html = R.equippedRow("Bracers", pick, {}, new Set(), maps, null, null,
    P.setContributors(result), ctx);
  assert.ok(/pd-rlabel">Bracers</.test(html), "shows where the item is worn");
  assert.ok(/Kopru Bracers/.test(html) && /Constitution \+3 Insightful/.test(html), "lists the item's affixes");
  assert.ok(/pd-rset/.test(html) && /Dread Isle/.test(html), "names the set it belongs to");
});

// #614 — the unmodelled-penalty note on the gear card. The sentence itself is
// tested in projection.test.js; what is guarded HERE is the render path, which
// no pure-function test reaches — the weight, the icon, and the silence.
const PEN_RE = /<div class="pd-note pd-rnote pd-penalty[\s\S]*?<\/div>/;

function penRow(targets) {
  const v = { variant_id: "Glass Cannon", affixes: [
    { name: "Intelligence", type: "Enhancement", value: "11" },
    { name: "Fortification", type: "Penalty", value: "-25" }] };
  return R.equippedRow("Off Hand", { variant: v, idx: 0 }, {}, new Set(),
    { setAugByHost: new Map() }, new Map(),
    { mode: false, augments: false, slotsCovered: new Set() }, null,
    { result: null, attr: null, targets });
}

test("#614: the penalty note is muted on every card — nothing here is wrong now", () => {
  // Inverted from what this first asserted. The note carried a warning weight
  // when the penalty landed on a ranked stat, because the solver discarded
  // negatives and that total really was wrong-high. It subtracts them now, so a
  // warning would be telling the player to distrust a correct number. One weight,
  // muted, on both cards.
  for (const targets of [["Fortification"], ["Strength"]]) {
    const note = (penRow(targets).match(PEN_RE) || [""])[0];
    assert.ok(note, `the note renders for targets ${JSON.stringify(targets)}`);
    assert.ok(/muted/.test(note) && !/is-craft/.test(note),
      "no warn weight: the totals above already account for the penalty");
    assert.ok(!note.includes("\u26a0"), "and no warning glyph");
    assert.ok(!/optimistic/.test(note), "the pre-subtraction claim is gone");
  }
});

test("#614: the note still names the magnitude, ranked or not", () => {
  for (const targets of [["Fortification"], ["Strength"]]) {
    const note = (penRow(targets).match(PEN_RE) || [""])[0];
    assert.ok(/-25 Fortification/.test(note),
      "the cost is stated as a number, not merely flagged as existing");
  }
});

test("#614: an item with no penalty renders no note at all", () => {
  const v = { variant_id: "Clean Ring", affixes: [{ name: "Strength", type: "Enhancement", value: "5" }] };
  const html = R.equippedRow("Ring", { variant: v, idx: 0 }, {}, new Set(),
    { setAugByHost: new Map() }, new Map(),
    { mode: false, augments: false, slotsCovered: new Set() }, null,
    { result: null, attr: null, targets: ["Strength"] });
  assert.ok(!PEN_RE.test(html), "no empty note family member on a clean card");
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

// #471 — the card body is one row language: every fact is `<li class="pd-line">`
// with three spans (marker / where it comes from / what it gives). A stat is no
// longer a substring of its own element's text, so these two helpers stand in
// for the substring tests the chip family allowed.
function hasLine(html, cls, text) {
  const re = new RegExp(`<li class="pd-line[^"]*\\b${cls}\\b[^"]*"[^>]*>`
    + `<span class="pd-ln-mark[^"]*"[^>]*>[^<]*</span>`
    + `<span class="pd-ln-where">[^<]*</span>`
    + `<span class="pd-ln-what">${text}`);
  return re.test(html);
}
function countLines(html) { return (html.match(/<li class="pd-line/g) || []).length; }
function countStatLines(html) {
  const sec = html.match(/<div class="pd-sec pd-sec-stats">[\s\S]*?<\/ul>/);
  // The "+N more" expander is a row too; it is not an affix, so it is not counted.
  return sec ? countLines(sec[0]) - (/pd-stat-more/.test(sec[0]) ? 1 : 0) : 0;
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
  // #471 — an open slot is a ROW like every other, stating its colour and that
  // it is empty. The wording is short on purpose: an item with four open colours
  // spent eight wrapped lines at 375px saying nothing happened four times. The
  // full reason rides the row's title.
  assert.ok(/<li class="pd-line is-empty aug-open aug-red"/.test(html), "an unfilled augment slot is its own row");
  assert.ok(/<span class="pd-ln-where">Red<\/span><span class="pd-ln-what">empty<\/span>/.test(html),
    "…naming the colour and saying it is empty, briefly");
  assert.ok(/title="open Red augment slot — no augment in this colour adds to your ranked stats"/.test(html),
    "…with the full reason on the row, not spent on the card");
});

test("U2/AE3: an assigned craft slot is declared with its applied value", () => {
  const v = { variant_id: "Cloak1", affixes: [] };
  const maps = blockMaps({ ncByItem: new Map([["Cloak1", [{ stat: "Constitution", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const html = R.equippedBody(v, 0, maps, new Map());
  // #455 — the instruction and the value are now two chips with two jobs: the
  // craft chip says what to go do, the stat chip says what you get. Both facts
  // are still on the card, which is what this test was always about.
  // #471 — the instruction and the value are ONE row now, in the Craft section:
  // the slot on the left, what it applies on the right. The Stats section no
  // longer restates it — that duplication is what this change removes.
  assert.ok(/pd-slabel">Craft · Nearly Completed</.test(html), "the section names the crafting system");
  assert.ok(/<li class="pd-line[^"]*craft-nc"/.test(html), "the craft slot is a row of its own");
  assert.ok(/<span class="pd-ln-what">Constitution \+15<\/span>/.test(html),
    "…carrying the value it applies, in place");
  assert.strictEqual((html.match(/Constitution \+15/g) || []).length, 1,
    "stated exactly once on the card, not in Stats as well (#471)");
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
  assert.ok(!/pd-sub/.test(html), "no grants list when affixes are unresolvable");
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

test("plan 2026-08-12-001 U3: equippedRow renders the summary only when the context is threaded", () => {
  const res = whyResult();
  res.saturationReport = [{ stat: "Constitution", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const pick = { variant: res.chosen[0].variant, idx: 0 };
  const withCtx = R.equippedRow("Ring", pick, {}, new Set(), null, null, null, null,
    { result: res, attr: R.attributionByTarget(res), targets: ["Constitution"] });
  // #455 — `pd-prio` is retired: it restated 62% of the stat row. The
  // context-threaded signal is now that the stat chips are CLASSIFIED — a
  // credited stat reads tracked only when the solve's attribution is in hand.
  assert.ok(!/pd-prio/.test(withCtx), "the second chip family is gone");
  assert.ok(hasLine(withCtx, "is-tracked", "Constitution \\+15"),
    "the credited stat is chipped and classified");
  // #449 U4 — the third surface that reached the marker. Guarded separately for
  // the same reason: each threads its own context in.
  assert.ok(!/at-ceiling/.test(withCtx), "and the row path renders no marker either");
  const withoutCtx = R.equippedRow("Ring", pick, {}, new Set(), null, null, null, null);
  assert.ok(!/pd-prio/.test(withoutCtx), "pure-test callers render no summary and no crash");
  assert.ok(!/is-tracked/.test(withoutCtx),
    "…and claim nothing about a solve they were not given");
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

test("#498: the set NAME shows one piece short; only the GLOW waits for satisfaction", () => {
  // Two facts that must not collapse into one. `equippedRow gets is-set only for
  // a satisfied-set piece` covers the glow; what it does not cover is that the
  // name is still printed while the set is incomplete — which is precisely the
  // state a player needs it in, because it names the set they are one piece from.
  const tier = [{ set: "Trio", pieces_required: 2, affixes: [{ stat: "Dodge", bonus_type: "Insightful", value: 3, unit: "flat" }] }];
  const mkc = (id, slot) => ({ slot, variant: { variant_id: id, set_bonus: [{ set: "Trio" }], parsed_set_bonuses: tier, affixes: [] } });
  const P = require("../web/projection.js");   // `Pj` is declared further down this file
  const row = (build, slot) => {
    const contributors = P.setContributors(build);
    const satisfied = R.satisfiedSets(build.chosen, build.setsActive);
    return R.equippedRow(slot, { variant: build.chosen[0].variant, idx: 0 }, {}, satisfied,
      null, null, null, contributors);
  };
  const oneShort = { chosen: [mkc("R", "Ring")], breakdown: {}, augmentsPlaced: [], effective: {}, setsActive: [] };
  const html1 = row(oneShort, "Ring");
  assert.ok(!/is-set/.test(html1), "1/2 pieces -> no glow");
  assert.ok(/pd-rset[^>]*>Trio</.test(html1), "…but the set is still named");
  const complete = { chosen: [mkc("R", "Ring"), mkc("N", "Necklace")], breakdown: {}, augmentsPlaced: [], effective: {}, setsActive: [] };
  assert.ok(/is-set/.test(row(complete, "Ring")), "2/2 pieces -> glow");
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
  // #471 — the note moved from inside `pd-rbody` to the card's foot, where the
  // other three notes already were, so it is asserted on `equippedRow` now. It
  // is still gated on there being an augment or craft recommendation to qualify.
  const v = { variant_id: "Owned Belt", affixes: [{ stat: "Constitution", bonus_type: "Enhancement", name: "Constitution", type: "Enhancement", value: 20, unit: "flat" }] };
  const maps = {
    augAssign: { byIndex: new Map([[0, [{ variant_id: "Topaz of Con", color: "Yellow", slot_color: "Yellow" }]]]), freeByIndex: new Map() },
    dinoAssign: { byIndex: new Map() },
    ncByItem: new Map(), rollByItem: new Map(), vikByItem: new Map(), sealByItem: new Map(),
  };
  const pick = { variant: v, idx: 0 };
  const ownedRow = R.equippedRow("Belt", pick, {}, null, maps, new Map(), { mode: true, augments: false, slotsCovered: new Set() });
  assert.ok(/Recommended \(not owned\)/.test(ownedRow), "owned mode marks the augment block");
  assert.ok(/pd-note is-owned/.test(ownedRow), "…as one of the card's uniform foot notes");
  const notOwned = R.equippedRow("Belt", pick, {}, null, maps, new Map(), { mode: false, augments: false, slotsCovered: new Set() });
  assert.ok(!/Recommended \(not owned\)/.test(notOwned), "non-owned mode has no marker");
  // The note is a statement about the augment/craft recommendations; with no
  // augment and no craft on the item there is nothing for it to qualify.
  const bare = R.equippedRow("Belt", pick, {}, null, blockMaps(), new Map(), { mode: true, augments: false, slotsCovered: new Set() });
  assert.ok(!/Recommended \(not owned\)/.test(bare), "…and nothing to qualify means no note");
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

// #453 U5 wraps each stat NAME in `.sat-stat` for the green/bold emphasis, so
// these read the rendered TEXT rather than the markup. The wording is what these
// tests were always about; pinning the tag soup around it made them fragile to a
// presentation change that does not touch a single word.
const satText = (html) => String(html).replace(/<[^>]*>/g, "");

test("U4/#239 + plan 2026-08-12-001 U2: the saturation notice is a compact count/list", () => {
  const html = R.saturationNotice(satBuild());
  assert.ok(/1 priority at ceiling: Kinetic Lore 30\./.test(satText(html)), "count + stat + total, singular form");
  assert.ok(/<span class="sat-stat">Kinetic Lore<\/span>/.test(html),
    "…and the stat name carries the emphasis hook (#453 R11)");
  assert.ok(!/ML|level|cap/i.test(html), "attributes no cause — the dominance filter makes that unknowable");
  assert.strictEqual(R.saturationNotice(satBuild({ saturation: false })), "", "silent when nothing saturated");
});

test("#277: the notice is a tap/keyboard-openable disclosure carrying the full sentences", () => {
  const html = R.saturationNotice(satBuild());
  assert.ok(/<details/.test(html) && /<summary/.test(html), "solve-banner details pattern, not hover-only");
  const summary = (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "";
  assert.ok(/1 priority at ceiling: Kinetic Lore 30\./.test(satText(summary)), "collapsed line keeps the compact wording");
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
  assert.ok(/2 priorities at ceiling: Kinetic Lore 30, Physical Sheltering 62\./.test(satText(html)), "plural + full list");
  // #453 U5 (R11) — BOTH names are emphasized, and neither total is.
  assert.strictEqual((html.match(/class="sat-stat"/g) || []).length, 2, "both stat names carry the emphasis");
  assert.ok(!/<span class="sat-stat">30</.test(html), "the total stays in body treatment");
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
// `equippedBody` (the Loadout block) reads `v.affixes`
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
  assert.strictEqual(countStatLines(html), 1, "exactly one affix line, not seven");
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
  assert.strictEqual(countStatLines(html), 1, "still one line");
});

test("U8/R8: an item with no expanded affix renders exactly as before", () => {
  const v = { variant_id: "Ring1", affixes: [
    { stat: "Constitution", bonus_type: "Enhancement", value: 10, unit: "flat" },
    { stat: "Dodge", bonus_type: "Quality", value: 5, unit: "pct" },
  ] };
  const html = R.equippedBody(v, 0, blockMaps(), new Map());
  assert.ok(/Constitution \+10/.test(html) && /Dodge \+5% Quality/.test(html));
  assert.strictEqual(countStatLines(html), 2, "both native affixes still listed");
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

test("#246: the ownership filter discloses BOTH what it removed and what it could not check", () => {
  // The second half is the one that matters. The filter can only exclude gear whose
  // pack the wiki states; crafted, bought, event and Store gear is not pack-gated at
  // all. Reporting the exclusions alone would read as a complete answer to "only show
  // me what I can farm" when it is a partial one.
  const html = R.packFilterNotice({ status: "optimal", packFilter: {
    owned: ["Ruins of Gianthold"], excluded: 12, uncheckable: 40,
    packsExcluded: ["Mists of Ravenloft", "The Chill of Ravenloft"] } });
  assert.ok(/excluded 12 items/.test(html), "says how much it removed");
  assert.ok(/Mists of Ravenloft/.test(html), "and names the packs, so the player can act");
  assert.ok(/40 candidates could not be checked/.test(html), "and what it could NOT check");
  assert.ok(/may still include something you cannot get/.test(html),
    "with the consequence stated, not left to be inferred");
});

test("#246: the notice is silent when the filter is off, and on a pre-feature snapshot", () => {
  assert.strictEqual(R.packFilterNotice({ status: "optimal" }), "",
    "a solve with no filter says nothing");
  assert.strictEqual(R.packFilterNotice({ status: "optimal", packFilter: null }), "");
});

test("#246: a filter that excluded nothing still reports what it could not check", () => {
  // Owning everything is not the same as the filter having nothing to say: the
  // un-checkable population is a property of the DATA, not of the player's answer.
  const html = R.packFilterNotice({ status: "optimal", packFilter: {
    owned: ["A"], excluded: 0, uncheckable: 40, packsExcluded: [] } });
  assert.ok(!/excluded 0/.test(html), "no empty exclusion sentence");
  assert.ok(/could not be checked/.test(html), "but the caveat still lands");
});

test("#573: the Max Dex Bonus disclosure fires on armor + ranked Dodge, and only then", () => {
  const fire = (q) => R.dodgeMaxDexNotice(q, { status: "optimal" });
  // The whole point of removing ARMOR_DODGE_CAP: the gap is now REAL, so it must be
  // spoken. Silence here would move the wrong answer from "too low" to "too high".
  const on = fire({ armorType: "heavy", targets: ["Dodge"] });
  assert.ok(/Maximum Dexterity Bonus/.test(on), "names the mechanism the wiki names");
  assert.ok(/not reduced by your armor/.test(on), "and says plainly what was NOT applied");
  assert.ok(/heavy/.test(on), "naming the armor the player actually chose");

  assert.strictEqual(fire({ targets: ["Dodge"] }), "", "silent with no armor type");
  assert.strictEqual(fire({ armorType: "heavy", targets: ["Strength"] }), "",
    "silent when Dodge is not ranked — the reduction cannot affect an unranked stat");
  assert.strictEqual(fire({ armorType: "heavy", targets: ["Dodge"], targetCaps: { Dodge: 4 } }), "",
    "and silent once the player set their own Max: they have supplied the limit");
});

test("#663: the Jump soft-cap disclosure fires only when the solve actually cleared 40", () => {
  const fire = (q, jump) => R.jumpSoftCapNotice(q, { status: "optimal", effective: { Jump: jump } });

  const on = fire({ targets: ["Jump"] }, 46);
  assert.ok(/Jump 46/.test(on), "names the total the player actually reached");
  assert.ok(/stops improving at 40/.test(on), "and the ceiling that stopped paying");
  assert.ok(/6 above that/.test(on), "quantifying the surplus rather than leaving it to be worked out");

  // The three escapes are the reason this is a disclosure and not a cap entry in
  // intrinsic_stat_caps.json. Dropping any of them turns an honest note into advice
  // to throw away a stat that is still doing work.
  assert.ok(/falling damage keeps decreasing past 40/i.test(on), "fall damage is uncapped");
  assert.ok(/Sneak applies −20/.test(on) && /needs 60/.test(on), "Sneak moves the target to 60");
  assert.ok(/armor check penalty/i.test(on), "and ACP is subtracted before the cap applies");

  assert.strictEqual(fire({ targets: ["Jump"] }, 38), "",
    "silent under the cap — nothing is being wasted, and a line under every Jump solve is boilerplate");
  assert.strictEqual(fire({ targets: ["Jump"] }, 40), "",
    "silent AT the cap: 40 is the last point that buys height, not the first that does not");
  assert.strictEqual(fire({ targets: ["Strength"] }, 46), "",
    "silent when Jump is not ranked");
  assert.strictEqual(fire({ targets: ["Jump"], targetCaps: { Jump: 40 } }, 46), "",
    "and silent once the player set their own Max: they have already answered this");
});

test("U7/#110: the banner qualifies optimality only when a block removed a candidate", () => {
  const on = R.blockNotice({ blockReport: [{ id: "X", name: "X", pool: "Ring", bestAvailable: false }] });
  assert.ok(/block-note/.test(on) && /optimal given those exclusions/.test(on));
  assert.strictEqual(R.blockNotice({ blockReport: [] }), "", "silent when no block applied");
});

// ---------------------------------------------------------------------------
// #262 U3 — the no-drop-source disclosure on the app surfaces: the gear box row
// and the coverage note clause. Both read the ONE shared wording from
// projection.js — never a per-surface respelling.

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

// ---- #481: where the concession control may appear ----
//
// The gate is the feature's honesty surface: offered on a priority with nothing
// beneath it, or on a stat sitting at zero, the control can only ever answer
// "nothing found" — which teaches the player that the control is noise.
{
  const cQuery = { targets: ["Strength", "Doublestrike", "Deadly"] };
  const cOn = { concessions: true };

  test("#481: the control is offered on a priority with something ranked beneath it", () => {
    const html = R.concessionControl("Strength", 0, 20, cQuery, cOn);
    assert.ok(/class="btn ghost concession-probe"/.test(html), "renders the control");
    assert.ok(/data-stat="Strength"/.test(html), "carries the stat it prices");
  });

  test("#481: the LAST ranked priority is never offered the control", () => {
    assert.strictEqual(R.concessionControl("Deadly", 2, 25, cQuery, cOn), "",
      "nothing is ranked beneath it, so there is nothing a concession could buy");
  });

  test("#481: a priority sitting at zero is never offered the control", () => {
    assert.strictEqual(R.concessionControl("Doublestrike", 1, 0, cQuery, cOn), "",
      "nothing to concede");
  });

  test("#481: the control is withheld without the solver, not offered and then failed", () => {
    assert.strictEqual(R.concessionControl("Strength", 0, 20, cQuery, { concessions: false }), "");
    assert.strictEqual(R.concessionControl("Strength", 0, 20, cQuery, undefined), "",
      "a caller that passes no gate at all gets no control");
  });

  test("#481: the probe handler is bound to a per-render element, not the container", () => {
    // `renderResults` is called again on every solve, load and per-slot constraint
    // change, and it does NOT replace `container` itself — only its innerHTML. A
    // delegated listener bound to `container` therefore accumulates one copy per
    // render and would fire the probe once per stacked copy. `#rp-cards` is minted
    // by each render's template, so binding there gives exactly one live handler.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "web", "results.js"), "utf-8");
    const bind = srcFrom(src, 'q("#rp-cards").addEventListener("click"', 200, "concession handler");
    assert.ok(/concession-probe/.test(bind), "…and it is the concession handler bound there");
    assert.ok(!/container\.addEventListener\("click", \(e\) => \{\s*const btn = e\.target\.closest\("\.concession-probe"\)/.test(src),
      "the handler must not be bound to the long-lived container");
  });

  test("#481: a selected alternative's cards do not offer the control", () => {
    // `renderBuild` computes the gate, so an alternative arrives here with it
    // already false. Guard the SOURCE of that expression: the probe is defined
    // against the OPTIMUM's program, and pricing from an alternative's card would
    // answer a question about a build the player is not looking at.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "web", "results.js"), "utf-8");
    assert.ok(/concessions:\s*build === optimum && canProbeConcession\(\)/.test(src),
      "renderBuild must gate the control on the build being the optimum");
  });
}

// ---- #485/#488 — a bundled enchantment the build is not getting must say so,
// ---- on EVERY surface -------------------------------------------------------
//

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
  // #449 U5 moved the eleven interpolations out of the innerHTML template and
  // into noticeDescriptors, so the slice follows them. The intent is unchanged
  // and now spans two links: the builder must CALL the notice, and renderResults
  // must call the builder. Either one missing and it renders nowhere again.
  // #448 replaced the hand-written push() list with the NOTICES registry, so the
  // call site is now an entry rather than a line of source. Assert it as data —
  // which is stronger, because it checks the thing that actually runs.
  const entry = R.NOTICES.find((n) => n.name === "outbidNotice");
  assert.ok(entry, "outbidNotice must be in the registry, or it renders nowhere");
  assert.strictEqual(typeof entry.render, "function");
  const reg = srcBetween(src, "const NOTICES = [", "\nconst NOTICE_TABLE", "NOTICES");
  assert.ok(/outbidNotice\(c\.query, c\.result, c\.model, c\.canPrice/.test(reg),
    "and it must pass the pricing capability, or the ask never renders");
  const render = srcBetween(src, "function renderResults(", "active-build-bar", "renderResults head");
  assert.ok(/noticeDescriptors\(\{/.test(render) && /canPrice: canPriceOutbid\(\)/.test(render),
    "renderResults must build the descriptors and thread the real pricing capability");
  assert.ok(/\$\{noticePanel\(notices\b/.test(render),
    "and it must render the panel it built");
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

test("#508: TWF declared without a permitting style discloses on the RESULTS page", () => {
  // The reported build: declared, no style, and a shield in the off hand. Before
  // this, the results page produced NOTHING here — its only off-hand entry is
  // gated on the exclusion having fired, and in this state it never does.
  const inert = Object.assign({}, _u10Declared, { style: null });
  const entries = R.boundNoticeEntries(inert, _u10OffHandResult);
  assert.deepStrictEqual(entries.map((e) => e.id), ["twf-not-applied"]);
  assert.strictEqual(entries[0].class, "actionable");
  assert.ok(/Tower Shield is in your off hand/.test(entries[0].sentence),
    "the deriver hands projection the item that actually got in");

  // A style that cannot dual-wield: same entry, the other sentence, by label.
  const thf = R.boundNoticeEntries(Object.assign({}, _u10Declared, { style: "thf" }), _u10OffHandResult);
  assert.deepStrictEqual(thf.map((e) => e.id), ["twf-not-applied"]);
  assert.ok(/Two Handed Fighting doesn't wield a second weapon/.test(thf[0].sentence));

  // Undeclared is silent — this notice is about a declaration being ignored, and
  // a build that never declared has nothing to disclose.
  const undeclared = R.boundNoticeEntries(
    Object.assign({}, _u10Declared, { style: null, twoWeaponFighting: false }), _u10OffHandResult);
  assert.deepStrictEqual(undeclared.map((e) => e.id), [], "no declaration, no notice");
});

test("#508: the inert notice and the off-hand exclusion can never both fire", () => {
  // They are complements over "TWF is declared", read off ONE authority in
  // model.js. If a build could produce both, the results page would tell the
  // player their shields were excluded AND that nothing was excluded.
  const results = [];
  for (const style of [null, "one-hand", "thf", "sword-board", "ranged", "crossbow", "unarmed"]) {
    for (const twoWeaponFighting of [true, false]) {
      const ids = R.boundNoticeEntries(
        Object.assign({}, _u10Declared, { style, twoWeaponFighting }), _u10OffHandResult)
        .map((e) => e.id);
      const inert = ids.includes("twf-not-applied");
      const excluded = ids.includes("off-hand-excluded") || ids.includes("re-solve-to-apply");
      assert.ok(!(inert && excluded), `style=${style} declared=${twoWeaponFighting}: both fired`);
      // Declared is exhaustive: every declared build lands in exactly one of them.
      if (twoWeaponFighting) {
        assert.ok(inert || excluded, `style=${style} declared: a declared build disclosed neither`);
      } else {
        assert.ok(!inert && !excluded, `style=${style} undeclared: disclosed something anyway`);
      }
      results.push([style, twoWeaponFighting, inert ? "inert" : excluded ? "excluded" : "silent"]);
    }
  }
  // one-hand is the ONLY style that applies the feat — pinned here so a taxonomy
  // change that widens or narrows it fails naming the style, not a count.
  assert.deepStrictEqual(results.filter((r) => r[1] && r[2] === "excluded").map((r) => r[0]),
    ["one-hand"], "exactly one style honours the declaration");
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

// ---- #449 U3: the ranked-priority card's achieved/ceiling fraction ----------
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

test("#449 U3 (R11/R12/R13): a maxed stat renders the fraction, a full green meter and the shared maxed sentence", () => {
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

test("#449 U3 (R14/R29): a shortfall renders its fraction, a proportional meter and the whole-track bound treatment", () => {
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

test("#449 U3 (R14): a shortfall card carries no red or warning colour class", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 30, ceiling: 50 }], { effective: { Dodge: 30 } });
  const box = R.buildViews(b, _reachModel, { targets: ["Dodge"] }).cards;
  const reach = box.slice(box.indexOf('class="stat-reach'));
  assert.ok(!/(is-cap-bound|quarantined|warn|danger|error|invalid)/.test(reach),
    "a shortfall is not a fault");
  const shortfall = _cssRule(_reachCss(), ".stat-reach.is-shortfall .reach-fraction");
  assert.ok(/var\(--accent\)/.test(shortfall), "the neutral accent");
  assert.ok(!/--quarantined|#f0b360|red/.test(shortfall), "and nothing warning-coloured");
});

test("#449 U3 (R19/R17b): a build with no ceilingReport renders no .stat-reach and falls back to ceilingChip", () => {
  const b = satBuild();                       // pre-#449 shape: saturationReport, no ceilingReport
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

test("#449 U3/R19: rendering a restored build invokes no solve entry point", () => {
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

test("#449 U3 (R30): a zero ceiling renders no meter, no green, and claims only what this solve found", () => {
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

// ---- #199: the cap chip must name WHICH cap bound -------------------------
// A player who set no cap and watches their top priority stop accruing reads it
// as the solver ignoring their ranking. Saying "the game caps this" is the whole
// reason #199 surfaces intrinsic caps rather than just applying them.

function _capBuild(opts) {
  return { status: "optimal", chosen: [], setsActive: [], augmentsPlaced: [],
    breakdown: { Doublestrike: [{ item: "Ring", value: 103 }] },
    effective: { Doublestrike: 100 },
    capped: { Doublestrike: 100 },
    ...opts };
}

test("#199: an intrinsic cap renders as a GAME cap, not as the player's own", () => {
  const cards = R.buildViews(_capBuild({ intrinsicCaps: { Doublestrike: 100 } }),
    _reachModel, { targets: ["Doublestrike"] }).cards;
  assert.ok(/game cap 100 · raw 103/.test(cards),
    "the chip names the game as the source of the ceiling");
  assert.ok(/no gear can raise it/.test(cards),
    "and the tooltip tells the player why more gear will not help");
  assert.ok(!/>capped at 100/.test(cards),
    "the neutral wording is NOT used when the ceiling is the game's");
});

test("#199: a user cap still renders as the player's own cap", () => {
  const cards = R.buildViews(_capBuild({ capped: { Doublestrike: 60 },
    effective: { Doublestrike: 60 }, intrinsicCaps: { Doublestrike: 100 } }),
    _reachModel, { targets: ["Doublestrike"] }).cards;
  assert.ok(/capped at 60 · raw 103/.test(cards),
    "a hand-set cap tighter than the game's is the player's own, and reads that way");
  assert.ok(!/game cap/.test(cards),
    "naming the game here would blame the game for a limit the player chose");
});

test("#199: a build with no intrinsic table renders exactly as before", () => {
  const cards = R.buildViews(_capBuild({}), _reachModel, { targets: ["Doublestrike"] }).cards;
  assert.ok(/capped at 100 · raw 103/.test(cards), "the pre-#199 wording is untouched");
  assert.ok(!/game cap/.test(cards));
});

test("#449 U3 (R33): a capped stat's fraction numerator equals the card's headline number", () => {
  const b = _reachBuild([{ stat: "Dodge", achieved: 20, ceiling: 20 }],
    { effective: { Dodge: 20 }, capped: { Dodge: 20 } });
  const cards = R.buildViews(b, _reachModel, { targets: ["Dodge"] }).cards;
  const headline = (cards.match(/data-final="(\d+)"/) || [])[1];
  const numerator = (cards.match(/class="reach-fraction">(\d+) \//) || [])[1];
  assert.strictEqual(headline, "20", "the headline is effectiveOf = min(cap, raw)");
  assert.strictEqual(numerator, headline, "the card never states two different totals for one stat");
});

test("#449 U3 (R33/KTD7): a cap-bound card renders neither the green treatment nor the maxed sentence", () => {
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

test("#449 U3 (R34): the Utility card renders no fraction sub-container", () => {
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

test("#449 U3 (AE6): no stat card carries both a ceilingChip and a .stat-reach box", () => {
  const b = satBuild();                       // carries a saturationReport…
  b.effective = { "Kinetic Lore": 30 };
  b.ceilingReport = [{ stat: "Kinetic Lore", achieved: 30, ceiling: 30 }];   // …and the new one
  const v = R.buildViews(b, _reachModel, { targets: ["Kinetic Lore"] });
  assert.ok(/stat-reach/.test(v.cards), "the fraction wins");
  assert.ok(!/stat-ceiling/.test(v.cards), "and the chip stands down — the two are mutually exclusive");
});

test("#449 U3 (KTD9): a selected alternative renders the fraction from its OWN ceilingReport", () => {
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

test("#449 U3 (R15): the full statement renders ONCE per readout, above the cards, not once per card", () => {
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
    "a pre-#449 restore prints no orphan sentence");
});

// ---------------------------------------------------------------------------
// #449 U5 — the notices panel: containment, the settled classification table,
// and the resolution routes.
// ---------------------------------------------------------------------------

/** A result/query pair that fires a chosen set of notices and nothing else. */
function _noticeCtx(over) {
  return Object.assign({
    result: { status: "optimal", chosen: [], perTarget: {}, effective: {}, setsActive: [],
      augmentsPlaced: [], breakdown: {}, computeScale: { variants: 1 }, solveMs: 1 },
    query: { targets: [] }, model: { slots: [] }, dataset: {},
    canPrice: false, canRequire: false,
  }, over || {});
}

test("#449 U5 (R27/AE12): zero non-empty notices render no panel element at all", () => {
  const ds = R.noticeDescriptors(_noticeCtx());
  assert.strictEqual(ds.length, 0, "a clean solve fires nothing");
  assert.strictEqual(R.noticePanel(ds), "", "no empty fold, no zero count, no chevron");
});

test("#449 U5 (KTD5): the classification table is asserted entry by entry", () => {
  // Pinned in full so a reclassification is a deliberate test edit, never silent.
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(R.NOTICE_TABLE).map(([k, v]) => [k, [v.title, v.cls]])),
    {
      staleSnapshotNotice: ["STALE SNAPSHOT", "actionable"],
      emptySlotNotice: ["EMPTY SLOT", "actionable"],
      craftingExcludedNotice: ["EXCLUDED BY CRAFTING OPT-OUT", "actionable"],
      blockNotice: ["BLOCKED GEAR", "actionable"],
      // #246 — actionable, unlike #573's disclosure: the player CAN resolve it, by
      // ticking a pack they do own.
      packFilterNotice: ["CONTENT NOT OWNED", "actionable"],
      // Actionable for the same reason: the player can un-exclude a set.
      setFilterNotice: ["SETS EXCLUDED", "actionable"],
      // #539 — actionable: every line it can print names something the player can
      // change (remove a pin, tick an augment as owned, raise the level cap).
      setPinNotice: ["REQUIRED SETS", "actionable"],
      augCeilingNotice: ["AUGMENT POOL NARROWED", "actionable"],
      outbidNotice: ["PRIORITY SCORED 0", "actionable"],
      absorptionQuarantineNotice: ["AFFIX WITHHELD", "qualifying"],
      // #573 — qualifying, not actionable: the player cannot supply the missing
      // Max Dex Bonus (neither can we, per item), so the card can only disclose
      // that the headline Dodge total is un-reduced.
      dodgeMaxDexNotice: ["DODGE NOT REDUCED BY ARMOR", "qualifying"],
      // #663 — ACTIONABLE where the notice above it is qualifying, and the split is
      // deliberate: there the number is unknown to us AND to the wiki, here the
      // ceiling is known (40) and a Max of 40 fully resolves it. What we cannot
      // decide for the player is whether 40 is right for their character.
      jumpSoftCapNotice: ["JUMP ABOVE 40", "actionable"],
      // #683 — qualifying like the #573 entry two rows up, NOT actionable like the
      // #663 one directly above. The player can press something (rank the other
      // spelling) but whether that is correct is the unverified question itself, so
      // offering it as the fix would take the side the app declined to take.
      splitMechanicNotice: ["ONE MECHANIC, TWO WIKI NAMES", "qualifying"],
      // #459 — ACTIONABLE, unlike the two qualifying entries around it: the player
      // can act and the action is well defined (give up at most the stated surplus
      // ACROSS these picks, or raise the Max).
      capSurplusNotice: ["GEAR ABOVE YOUR CAP", "actionable"],
      // #193/#599 — qualifying for the same reason: there is nothing to press.
      // It reports that the Gem's menus were solved over 25 of the 170 effects
      // the game offers, which is a fact about the DATA, not about the query.
      essenceNotice: ["ESSENCE CRAFTING", "qualifying"],
      // #194 — qualifying for the same reason: it states what the altars did and
      // that matched-aspect bonuses are out of scope, a fact about the model.
      greenSteelNotice: ["LEGENDARY GREEN STEEL", "qualifying"],
      saturationNotice: ["AT CEILING", "informational"],
      upgradeNotice: ["UPGRADES", "informational"],
    });
});

test("#448: the registry is the ONLY source — nothing classifies a notice but its own entry", () => {
  // This replaces a test that grepped the source for `push("…")` calls and checked
  // each name had a row in a parallel table. That test existed because there WERE
  // two places; #448 made it one, so the assertion becomes structural.
  const single = R.NOTICES.filter((n) => !n.split);
  const split = R.NOTICES.filter((n) => n.split);

  assert.deepStrictEqual(Object.keys(R.NOTICE_TABLE), single.map((n) => n.name),
    "NOTICE_TABLE is derived from the registry, in registry order");
  assert.strictEqual(single.length, 18, "the eighteen single-fact notices (#459 added the cap-surplus disclosure, #194 the Legendary Green Steel one)");
  assert.deepStrictEqual(split.map((n) => n.name),
    ["artifactNotice", "boundNotice", "zeroSourceNotice"],
    "and the three multi-fact notices come through their U10 entry functions");

  for (const n of single) {
    assert.strictEqual(typeof n.render, "function", `${n.name}: no render`);
    for (const k of ["id", "title", "subject", "cls"]) {
      assert.ok(n[k], `${n.name}: missing ${k} — the registry entry is the only place it can come from`);
    }
    assert.ok(NOTICE_CLASSES.includes(n.cls), `${n.name}: unknown class ${n.cls}`);
  }
  for (const n of split) {
    assert.strictEqual(typeof n.entries, "function", `${n.name}: no entries()`);
    assert.strictEqual(n.cls, undefined,
      `${n.name}: a split notice must NOT carry a class — projection.js classifies each branch`);
  }
  // Ids are what the jump table and the DOM key on; two cards sharing one would
  // route a player to the wrong control.
  const ids = single.map((n) => n.id);
  assert.strictEqual(new Set(ids).size, ids.length, "ids are unique");
});

test("#448: registry ORDER is the on-screen order within a class, and splits lead", () => {
  // noticeDescriptors sorts by class with the insertion index as a stable tie-break,
  // so the array's order is load-bearing rather than cosmetic. Pinned so a reorder
  // is a deliberate edit.
  assert.deepStrictEqual(R.NOTICES.map((n) => n.name), [
    "artifactNotice", "boundNotice", "zeroSourceNotice",
    "staleSnapshotNotice", "outbidNotice", "saturationNotice", "emptySlotNotice",
    "absorptionQuarantineNotice", "craftingExcludedNotice", "augCeilingNotice",
    "dodgeMaxDexNotice", "jumpSoftCapNotice", "splitMechanicNotice", "capSurplusNotice", "essenceNotice", "greenSteelNotice", "blockNotice", "packFilterNotice", "setFilterNotice", "setPinNotice", "upgradeNotice",
  ]);
});

test("#448: a registry entry with no class renders visibly unclassified, and does not throw", () => {
  // The fallback no longer guards a FORGOTTEN table row — that state is unreachable
  // now, which is the point. It guards a MALFORMED entry: one added to the registry
  // without a class. Such a card must be visible and sort last, never silently take
  // a neighbour's treatment. renderResults sits inside a try/catch whose catch
  // replaces the whole results box, so throwing here would destroy a correct solve.
  const saved = R.NOTICES.find((n) => n.name === "blockNotice");
  const at = R.NOTICES.indexOf(saved);
  R.NOTICES[at] = { name: "blockNotice", render: () => "<p>x</p>" };   // no cls, no id, no title
  try {
    const ds = R.noticeDescriptors({ result: { status: "optimal" }, query: {}, model: {}, dataset: {} });
    const card = ds.find((d) => d.name === "blockNotice");
    assert.ok(card, "it still renders");
    assert.strictEqual(card.unclassified, true, "and it is flagged");
    assert.strictEqual(card.title, "BLOCKNOTICE", "with a fallback title rather than none");
    assert.ok(/is-unclassified/.test(R.noticePanel(ds)), "visibly, in the markup");
  } finally { R.NOTICES[at] = saved; }
});

test("#449 U5 (R5): cards sort actionable, then qualifying, then informational", () => {
  assert.deepStrictEqual(R.NOTICE_CLASS_ORDER, ["actionable", "qualifying", "informational"]);
  const ds = [
    { cls: "informational", id: "i" }, { cls: "qualifying", id: "q" },
    { cls: "actionable", id: "a" }, { cls: "qualifying", id: "q2" },
  ];
  // Sort through the real builder's comparator by round-tripping the descriptors
  // it produces; here the order is asserted on the rendered panel, which is what
  // the player actually sees.
  const html = R.noticePanel(ds.map((d) => Object.assign({ title: d.id, html: "<p>x</p>", jump: null }, d)));
  assert.deepStrictEqual([...html.matchAll(/data-notice="(\w+)"/g)].map((m) => m[1]), ["i", "q", "a", "q2"],
    "noticePanel renders the order it is given — sorting is noticeDescriptors' job");
});

test("#449 U5 (R28/AE11): each card names its class in text, independent of colour", () => {
  assert.deepStrictEqual(R.NOTICE_CLASS_TAG,
    { actionable: "Needs attention", qualifying: "Qualifies", informational: "Note" });
  const html = R.noticePanel([{ id: "x", title: "A THING", cls: "qualifying", html: "<p>s</p>", jump: null }]);
  assert.ok(/<span class="notice-tag">Qualifies<\/span>/.test(html), "its own element…");
  assert.ok(/<span class="notice-title">A THING<\/span>/.test(html), "…not concatenated into the title");
});

test("#449 U5 (R6/KTD5): every actionable route carries a control, and outbid deliberately does not", () => {
  // #448 — asserted as the RULE with its one documented exception, rather than by
  // enumerating every actionable notice. The old form listed all seven and so had to
  // be hand-edited for each new one; that is the drift this issue was about, and the
  // enumeration was carrying no meaning the rule does not.
  //
  // The exception is deliberate and stays named: R6's amendment — outbidNotice already
  // renders Require and price buttons in-card, so a jump beside them would offer a
  // second, worse route to the control the player is looking straight at.
  const ROUTE_EXEMPT = new Set(["outbidNotice"]);
  const unrouted = Object.entries(R.NOTICE_TABLE)
    .filter(([k, v]) => v.cls === "actionable" && !v.jump && !ROUTE_EXEMPT.has(k))
    .map(([k]) => k);
  assert.deepStrictEqual(unrouted, [],
    "an actionable card with no route asks the player to fix something and does not say where");
  for (const k of ROUTE_EXEMPT) {
    assert.ok(R.NOTICE_TABLE[k], `${k} is exempted from routing but is not in the table`);
    assert.strictEqual(R.NOTICE_TABLE[k].jump, null,
      `${k} is exempt because it resolves in-card; giving it a jump means the exemption should go`);
  }
  assert.deepStrictEqual(Object.keys(R.NOTICE_ENTRY_JUMPS).sort(),
    ["artifact-pinned-in", "floor-not-reached", "re-solve-to-apply", "stat-filtered-out",
      "twf-not-applied"],
    "and the actionable cards U10 split out are routed by entry id (#508 added the fifth)");
  for (const j of [...Object.values(R.NOTICE_TABLE).map((v) => v.jump), ...Object.values(R.NOTICE_ENTRY_JUMPS)]) {
    if (!j) continue;
    assert.ok(j.label && /→|now/.test(j.label), `${j.label}: a verb plus a destination`);
    assert.ok(j.step === null || ["character", "pool", "priorities"].includes(j.step),
      `${j.label}: step ${j.step} must be a real wizard step, or null for this screen`);
  }
});

test("#449 U5: a jump control emits its step and anchor as data for the wizard seam", () => {
  const html = R.noticePanel([{ id: "x", title: "T", cls: "actionable", html: "<p>s</p>",
    jump: { label: "Change augment ceiling →", step: "character", anchor: "#wz-augceiling" } }]);
  assert.ok(/data-step="character"/.test(html) && /data-anchor="#wz-augceiling"/.test(html),
    "results.js hands over a target rather than reaching into wizard state");
  assert.ok(/<button class="notice-jump"/.test(html), "a button — it changes state, it does not navigate");
});

test("#449 U5 (R35): the one notice that folds itself is unwrapped inside the panel", () => {
  const ctx = _noticeCtx();
  ctx.result.saturationReport = [{ stat: "Dodge", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const ds = R.noticeDescriptors(ctx);
  const sat = ds.find((d) => d.name === "saturationNotice");
  assert.ok(sat && sat.unwrap, "flagged in the table");
  const html = R.noticePanel(ds);
  const card = html.slice(html.indexOf('data-notice="at-ceiling"'));
  assert.ok(!/<details/.test(card), "no fold inside the fold — the panel is the only one");
  assert.ok(/at ceiling/.test(card), "and its sentence survives as the card body");
});

test("#449 U5 (R2/R3): the panel is a collapsed fold that states its count", () => {
  const html = R.noticePanel([
    { id: "a", title: "A", cls: "actionable", html: "<p>s</p>", jump: null },
    { id: "b", title: "B", cls: "qualifying", html: "<p>s</p>", jump: null }]);
  assert.ok(/<details class="notes-panel">/.test(html) && !/\bopen\b/.test(html), "collapsed on first render");
  assert.ok(/Notes on this solve/.test(html), "labelled");
  assert.ok(/<span class="notes-count">2 notes<\/span>/.test(html), "and states the total without being opened");
  const one = R.noticePanel([{ id: "a", title: "A", cls: "actionable", html: "<p>s</p>", jump: null }]);
  assert.ok(/>1 note</.test(one), "singular for one");
});

test("#449 U5: the count is non-empty notices, not notice functions", () => {
  const ctx = _noticeCtx();
  ctx.result.saturationReport = [{ stat: "Dodge", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const ds = R.noticeDescriptors(ctx);
  assert.strictEqual(ds.length, 1, "ten functions returned empty and are not counted");
  assert.ok(/>1 note</.test(R.noticePanel(ds)));
});

test("#449 U5: the active-build bar stays outside the panel", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  const tpl = srcBetween(src, "container.innerHTML = `\n    ${banner}", "readout-analysis", "results template");
  const panelAt = tpl.indexOf("noticePanel(notices");
  const barAt = tpl.indexOf("active-build-bar");
  // Both indices are asserted PRESENT before they are compared. Written as a bare
  // `panelAt < barAt` this passes when the panel is absent entirely (-1 is less
  // than anything), which is exactly the state it exists to rule out.
  assert.ok(panelAt >= 0, "the panel is in the template");
  assert.ok(barAt >= 0, "and so is the active-build bar");
  assert.ok(panelAt < barAt,
    "the live Return-to-optimum control is a sibling of the panel, never folded inside it");
});

test("#449 U5 (R32): both class tokens resolve to :root, and neither pre-existing --warn site moved", () => {
  const css = _reachCss();
  const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
  assert.ok(/--warn:\s*#d9a441/.test(root), "--warn defined in :root");
  assert.ok(/--qualify:\s*#8fa2c4/.test(root), "--qualify defined in :root");
  assert.ok(css.includes(".pd-why.pd-carried { color: var(--warn, #c9873a); }"),
    "the first pre-existing call site is textually unchanged");
  assert.ok(css.includes("color: var(--warn, #d9a441)"),
    "and so is the second");
  // The slate must not drift back onto the amber ramp.
  assert.ok(/\.notice-card\.is-qualifying \{ border-left-color: var\(--qualify\); \}/.test(css),
    "the qualifying class uses --qualify, not any amber token");
  assert.ok(!/is-qualifying[^}]*--warn/.test(css), "and never reaches for --warn");
});

test("#449 U5 (R37): the panel summary wraps as whole units and keeps its tap target", () => {
  const rule = _cssRule(_reachCss(), ".notes-summary {");
  assert.ok(/flex-wrap:\s*wrap/.test(rule),
    "it is the densest new element and the panel's ONLY tap target — it must wrap, not overflow");
  assert.ok(/min-height:\s*var\(--tap\)/.test(rule),
    "and the tap target survives every wrap state, not just the one-line one");
  // U6 adds the pill and the qualifying marker into this same summary; they are
  // asserted there. What U5 owes is the container that lets them wrap as units.
  assert.ok(/display:\s*flex/.test(rule), "a flex row, so each child wraps whole");
});

// ---------------------------------------------------------------------------
// #449 U6 — the attention pill and the qualifying marker.
// ---------------------------------------------------------------------------

/** Descriptors of a given shape, as noticeDescriptors would hand them over. */
function _marks(spec) {
  return spec.map((cls, i) => ({ id: `n${i}`, title: `N${i}`, cls,
    subject: `subject ${i}`, html: "<p>s</p>", jump: null }));
}

test("#449 U6 (R7/AE1): three actionable notices render a pill reading '3 need attention'", () => {
  const html = R.noticePanel(_marks(["actionable", "actionable", "actionable"]));
  assert.ok(/<span class="notes-pill">3 need attention<\/span>/.test(html));
  assert.ok(/>3 notes</.test(html), "and the total count still speaks for the whole panel");
});

test("#449 U6 (R7): the pill counts cards that RENDERED, not notice functions that could fire", () => {
  // Four notices classified actionable, one of which returns empty: an empty
  // return contributes no descriptor, so it cannot reach the count.
  const ctx = _noticeCtx();
  ctx.result.blockReport = [{ id: "X", name: "Thing", slot: "Ring", stat: "Dodge" }];
  ctx.result.saturationReport = [{ stat: "Dodge", total: 15, bonusTypes: ["Enhancement"], unusedSources: 2 }];
  const ds = R.noticeDescriptors(ctx);
  const actual = ds.filter((d) => d.cls === "actionable").length;
  const html = R.noticePanel(ds);
  if (actual) assert.ok(new RegExp(`>${actual} need`).test(html), "the pill agrees with the cards inside");
  else assert.ok(!/notes-pill/.test(html), "no actionable card, no pill");
  assert.strictEqual(ds.length, (html.match(/class="notice-card/g) || []).length,
    "and the total counts exactly the cards rendered");
});

test("#449 U6 (R10/AE2): zero actionable notices render no pill element", () => {
  const none = R.noticePanel(_marks(["qualifying", "informational"]));
  assert.ok(!/notes-pill/.test(none), "nothing to act on, nothing to pulse");
  // The positive control is what makes the line above mean anything: without it
  // the assertion also passes on a tree that has no pill at all, which is the
  // state it exists to distinguish from.
  const some = R.noticePanel(_marks(["qualifying", "informational", "actionable"]));
  assert.ok(/notes-pill/.test(some), "and adding one actionable card does produce a pill");
});

test("#449 U6 (R26/AE11): qualifying with no actionable renders the marker and no pill", () => {
  const ds = _marks(["qualifying", "qualifying"]);
  ds[0].subject = "affix withheld"; ds[1].subject = "declared credit";
  const html = R.noticePanel(ds);
  assert.ok(!/notes-pill/.test(html), "no pill");
  assert.ok(/<span class="notes-qualify">2 qualify: affix withheld, declared credit<\/span>/.test(html),
    "the marker NAMES its subjects — a bare count would not say the totals rest on unverified input");
});

test("#449 U6 (R26): the marker names up to two subjects, then falls back to a count", () => {
  assert.ok(/1 qualifies: subject 0/.test(R.noticePanel(_marks(["qualifying"]))), "one, named");
  assert.ok(/2 qualify: subject 0, subject 1/.test(R.noticePanel(_marks(["qualifying", "qualifying"]))), "two, named");
  const three = R.noticePanel(_marks(["qualifying", "qualifying", "qualifying"]));
  assert.ok(/>3 qualify</.test(three) && !/subject 0/.test(three),
    "past two, naming stops being an aid and becomes a wall of text");
});

test("#449 U6 (R26): every entry a notice can mint carries a subject", () => {
  // The curation cannot silently fall behind projection.js: every id the three
  // entry functions emit must have a row here, and so must all eight table rows.
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "web", "projection.js"), "utf8");
  // The end marker is searched FROM the start index: `constraintPairs` is also
  // defined ~700 lines earlier, and a bare indexOf returned that one, producing
  // an empty slice and a loop over nothing. The `>= 11` assertion below is what
  // makes such a slice fail loudly instead of passing vacuously.
  const from = src.indexOf("function artifactNoticeEntries");
  const region = src.slice(from, src.indexOf("constraintPairs,", from));
  const ids = [...new Set([...region.matchAll(/\{\s*id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 11, `expected the eleven split branches, saw ${ids.length}`);
  for (const id of ids) {
    assert.ok(R.NOTICE_ENTRY_SUBJECTS[id], `${id} can be minted but has no U6 subject`);
  }
  for (const [name, row] of Object.entries(R.NOTICE_TABLE)) {
    assert.ok(row.subject, `${name} has no subject`);
    assert.strictEqual(row.subject, row.subject.toLowerCase().replace("ml", "ML"),
      `${name}: a subject is lower-case prose, not a shouted title`);
  }
});

test("#449 U6 (R8/KTD3/AE13): the latch is stamped at build time and survives a re-render", () => {
  const ds = _marks(["actionable"]);
  const before = R.noticePanel(ds, { latched: false });
  assert.ok(!/data-notes-seen/.test(before), "unlatched on the first render — the pulse is armed");
  const after = R.noticePanel(ds, { latched: true });
  assert.ok(/<details class="notes-panel" data-notes-seen>/.test(after),
    "a rebuilt panel carries the latch, so the pulse does not re-arm on the next solve");
  // The panel is COLLAPSED in both, which is the whole point: a latch keyed on
  // [open] would be indistinguishable from the unlatched state here.
  assert.ok(!/<details class="notes-panel"[^>]*\bopen\b/.test(after),
    "and collapsing after opening does not restore the pulse");
});

test("#449 U6 (R8/KTD3): the pulse reads the latch attribute, never [open]", () => {
  const css = _reachCss();
  assert.ok(css.includes(".notes-panel:not([data-notes-seen]) .notes-pill { animation:"),
    "the pulse is armed by the ABSENCE of the stamp");
  assert.ok(!/\.notes-panel\[open\][^{]*\{[^}]*animation/.test(css),
    "[open] is a live toggle, not a latch: it re-arms on every collapse and every rebuild");
});

test("#449 U6 (R9/AE3): the pill is legible with no animation at all", () => {
  const base = _cssRule(_reachCss(), ".notes-pill {");
  assert.ok(/background:\s*var\(--warn\)/.test(base), "a static amber FILL carries the signal…");
  assert.ok(/border:\s*1px solid var\(--warn\)/.test(base), "…with a border of its own…");
  assert.ok(!/animation/.test(base), "…and the base rule reaches for no motion");
  // The repo disables every animation under prefers-reduced-motion, so a
  // motion-only signal would vanish for exactly the players who opted out.
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\* \{ animation: none !important/.test(_reachCss()),
    "which the global kill switch makes load-bearing, not theoretical");
});

test("#449 U6 (R9): the pill's ink is the dark ground, not white on amber", () => {
  const base = _cssRule(_reachCss(), ".notes-pill {");
  assert.ok(/color:\s*var\(--bg\)/.test(base),
    "white on #d9a441 measures 2.25:1, below the 4.5:1 floor; --bg measures 8.18:1");
  // Pinned as values, not as a claim: a later palette edit that breaks the pair
  // must fail here rather than ship a pill nobody can read.
  const root = _reachCss().slice(_reachCss().indexOf(":root"));
  assert.ok(/--warn:\s*#d9a441/.test(root) && /--bg:\s*#0f1420/.test(root),
    "the measured pair is the pair actually in the stylesheet");
});

test("#449 U6 (R26): the qualifying marker carries no animation under any state", () => {
  const css = _reachCss();
  assert.ok(!/notes-qualify[^{]*\{[^}]*animation/.test(css), "no rule animates it directly");
  assert.ok(!/animation[^;]*;\s*\}[^{]*\.notes-qualify/.test(css), "and none reaches it sideways");
  const base = _cssRule(css, ".notes-qualify {");
  assert.ok(/var\(--qualify\)/.test(base) && !/--warn/.test(base),
    "slate, deliberately off the amber ramp — it reports a condition, not a task");
});

test("#449 U6 (R37): the pill and the marker each wrap as a unit", () => {
  for (const sel of [".notes-pill {", ".notes-qualify {"]) {
    assert.ok(/white-space:\s*nowrap/.test(_cssRule(_reachCss(), sel)),
      `${sel} must wrap whole rather than breaking internally at 375px`);
  }
});

test("#449 U6: renderResults threads the latch both ways", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  const fn = srcBetween(src, "function renderResults(", "function renderAltCards", "renderResults body");
  assert.ok(/notesSeen, onNotesOpen/.test(fn), "it takes the flag and the way to set it");
  assert.ok(/latched: !!notesSeen/.test(fn), "stamps the panel from it at build time");
  assert.ok(/addEventListener\("toggle"/.test(fn), "and latches on first open");
  assert.ok(/panelEl\.setAttribute\("data-notes-seen", ""\)/.test(fn),
    "stamping the LIVE element too, so the pulse stops now rather than at the next render");
  const wiz = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "wizard.js"), "utf8");
  assert.ok(/let notesSeen = false;/.test(wiz), "the flag is session-scoped…");
  assert.ok(!/state\.notesSeen/.test(wiz), "…and never on `state`, which would carry it into the save record");
  assert.strictEqual((wiz.match(/onNotesOpen: \(\) => \{ notesSeen = true; \}/g) || []).length, 3,
    "wired at all three renderResults call sites, or the latch is arrived-at-dependent");
});

// ---------------------------------------------------------------------------
// #449 U7 — the loadout stat chips. Every disclosure the comma-run carried
// survives; the primary line is the value and the stat, the rest is a sub-label.
// ---------------------------------------------------------------------------

/** A result whose Ring contributes to as many ranked stats as asked for. */
function _chipResult(rows) {
  const breakdown = {};
  for (const r of rows) {
    (breakdown[r.stat] = breakdown[r.stat] || []).push(Object.assign(
      { bonus_type: "Enhancement", value: 10, source: "R", sourceKind: "worn",
        slot: "Ring", setYieldingSlots: null, hostIds: ["R"] }, r));
  }
  return { status: "optimal", augmentsPlaced: [], setAugmentsPlaced: [], setsActive: [],
    chosen: [{ slot: "Ring", variant: { variant_id: "R", set_bonus: [], parsed_set_bonuses: [] } }],
    breakdown, computeScale: { variants: 1 }, solveMs: 1 };
}

// ---------------------------------------------------------------------------
// #449 U8 / #447 — the per-slot constraint control, visible at rest.
// ---------------------------------------------------------------------------

test("#449 U8 (R23/AE7): the slot control has no opacity gate and no hover-gated reveal", () => {
  const css = _reachCss();
  const rule = _cssRule(css, ".pd-ctl {");
  assert.ok(!/opacity/.test(rule), "it was opacity:0 until hover — undiscoverable on desktop, absent on touch");
  assert.ok(!/\.pd-row:hover \.pd-ctl/.test(css), "and the hover-gated reveal is gone with it");
  assert.ok(!/transition:\s*opacity/.test(rule), "including the transition that animated the reveal");
});

test("#449 U8 (R23): it has a resting border, so there is something to see at rest", () => {
  const rule = _cssRule(_reachCss(), ".pd-ctl {");
  assert.ok(/border:\s*1px solid var\(--border\)/.test(rule),
    "a transparent border on a transparent control was two ways of being invisible");
  assert.ok(!/border:\s*1px solid transparent/.test(rule));
});

test("#449 U8 (R24/AE7): the hit area reaches var(--tap) via an overlay that contributes no layout", () => {
  const css = _reachCss();
  const rule = _cssRule(css, ".pd-ctl {");
  assert.ok(/width:\s*34px/.test(rule) && /height:\s*34px/.test(rule), "34px is the settled visual size");
  assert.ok(/position:\s*relative/.test(rule), "which anchors the overlay");
  assert.ok(/padding:\s*0/.test(rule),
    "padding is NOT the mechanism: .pd-ctl is the tallest child of the .pd-rtop flex row, "
    + "so padding to 44px would raise every gear row");
  const over = _cssRule(css, ".pd-ctl::after {");
  assert.ok(/position:\s*absolute/.test(over), "the overlay is out of flow…");
  assert.ok(/inset:\s*-5px/.test(over), "…and negative-inset: 34 + 5 + 5 = 44, the app's own tap floor");
  // Arithmetic, not a guess: var(--tap) is what the rest of the app uses.
  assert.ok(/--tap:\s*44px/.test(css), "and 44px is that floor");
});

test("#449 U8: the constrained-slot signal survives the always-visible control", () => {
  const css = _reachCss();
  // A constrained slot used to be legible from its control being the only
  // visible one in the list. Every control shows now, so that reading is gone
  // and the signal has to be carried explicitly or it is lost.
  assert.ok(/\.pd-row\.constrained \.pd-ctl \{[^}]*var\(--accent\)/.test(css),
    "the control accents on a constrained row");
  assert.ok(/\.pd-row\.constrained \{ border-color: var\(--accent\); \}/.test(css),
    "and the row border rule is untouched by this work");
});

test("#449 U8 (R25): focus can no longer land on a transparent control", () => {
  const css = _reachCss();
  // The focus ring itself is NOT new — the global button:focus-visible rule
  // already shipped. What changes is that it now lands on something rendered.
  assert.ok(/button:focus-visible/.test(css), "the inherited ring is preserved, not added");
  assert.ok(!/opacity/.test(_cssRule(css, ".pd-ctl {")),
    "and the control it draws on is never transparent — WCAG 2.4.11");
});

test("#449 U8: the control is a gear, and keeps its label (regression guard)", () => {
  // Exempt from the red-proof gate BY DESIGN: the aria-label already shipped.
  // This guard exists so the glyph swap cannot quietly take it along.
  const html = R.equippedRow("Ring", null, {}, new Set(), null, null, null, null);
  assert.ok(/aria-label="constrain Ring"/.test(html), "the label survives the glyph swap");
  assert.ok(/&#9881;<\/button>/.test(html), "a gear, not an ellipsis");
  assert.ok(/title="constrain this slot"/.test(html), "and the pointer title is unchanged");
});

// ---------------------------------------------------------------------------
// #453 U2-U6 — the loadout card speaks ONE visual language, and the notices
// panel's jump opens what it scrolls to. Pure-function and source-text
// assertions; this file has no DOM, so the behavioural proof is the browser pass
// named in the plan's Definition of Done.
// ---------------------------------------------------------------------------

// `craftSlotChips` reads six maps unconditionally, so an augment fixture has to
// carry the empty ones too — supplying only `augAssign` throws inside the craft
// section rather than in anything #453 touched.
function chipMaps(augAssign) {
  const empty = new Map();
  return { augAssign, dinoAssign: { byIndex: empty }, ncByItem: empty, rollByItem: empty,
           vikByItem: empty, sealByItem: empty, tfByItem: empty, gsByItem: empty,
           jokerByHost: empty };
}

// A prioCtx whose attribution credits `stat` to `variantId`, in the shape
// itemContributions reads. Built by hand so the classification is exercised
// without standing up a solve.
function chipCtx(variantId, byStat) {
  const attr = {};
  for (const [stat, part] of Object.entries(byStat || {})) {
    attr[stat] = [{ hostIds: [variantId], value: part.value, bonus_type: part.type || "Enhancement",
                    isSet: false, via: part.via || null,
                    // #471 — the channel that credited the point. The solver stamps
                    // it on every breakdown row; the card's residual sweep reads it
                    // to tell "nothing rendered this" from "the Craft section did".
                    sourceKind: part.sourceKind || "worn" }];
  }
  return { result: { chosen: [] }, attr, targets: Object.keys(byStat || {}) };
}

test("#453 U2 (R1/R2/R3): one card, three chip classes", () => {
  const v = { variant_id: "Test Helm", affixes: [
    { name: "Melee Power", value: 10, type: "Enhancement" },   // ranked -> tracked
    { name: "Armor Class", value: 15, type: "Natural" },       // real, unranked -> incidental
    { name: "Ghostly", value: 1, type: "Bool" },               // presence -> utility
  ] };
  const html = R.equippedBody(v, -1, null, null, false, false, chipCtx("Test Helm", { "Melee Power": { value: 10 } }));
  assert.ok(hasLine(html, "is-tracked", "Melee Power"), "the credited stat is tracked");
  assert.ok(hasLine(html, "is-incidental", "Armor Class"), "an uncredited affix is incidental");
  assert.ok(hasLine(html, "is-utility", "Ghostly"), "a presence affix is utility");
  // #487 — the row no longer prints a check beside the name. A presence affix has
  // no magnitude, so its label used to carry `✓`; the row's marker column now
  // draws the filled diamond, and printing both said "present" twice in two
  // vocabularies. The check survives in `affixLabel`'s default, because every
  // EXPORT still needs it — there is no gutter there to carry the fact.
  assert.ok(!/✓ Ghostly/.test(html), "the row does not double up on the marker");
  assert.ok(/<span class="pd-ln-mark[^"]*"[^>]*>◆<\/span><span class="pd-ln-where">[^<]*<\/span><span class="pd-ln-what">Ghostly/.test(html),
    "…because the gutter carries it, filled");
  assert.strictEqual(require("../web/projection.js").affixLabel({ name: "Ghostly", value: 1, type: "Bool" }), "✓ Ghostly",
    "and the shared label keeps the mark for the surfaces with no gutter");
  assert.ok(!/<li>/.test(html), "no bare plain-text affix line survives (R1)");
});

test("#453 U2 (R-a/KTD1): a COLLAPSED bundle with one ranked member is tracked", () => {
  // The silent failure mode. The card looks fine either way; getting this wrong
  // just under-credits the player's own priority. A single-member fixture cannot
  // discriminate, so this one is deliberately multi-member.
  const v = { variant_id: "Focus Ring", affixes: focusMasteryAffixes("Sacred Spell Focus Mastery", "Sacred", 3) };
  const ctx = chipCtx("Focus Ring", { "Evocation Focus": { value: 3, via: "Sacred Spell Focus Mastery" } });
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.strictEqual(countStatLines(html), 1, "still one collapsed entry");
  assert.ok(/is-tracked/.test(html),
    "the bundle is tracked because a MEMBER is ranked — matching the enchantment name alone would miss it");
});

test("#453 U2 (KTD3): a ranked presence affix is tracked, not utility", () => {
  const v = { variant_id: "Ghost Cloak", affixes: [{ name: "Ghostly", value: 1, type: "Bool" }] };
  const plain = R.equippedBody(v, -1, null, null, false, false, chipCtx("Ghost Cloak", {}));
  assert.ok(/is-utility/.test(plain), "unranked, it is a bonus that came along");
  const ranked = R.equippedBody(v, -1, null, null, false, false, chipCtx("Ghost Cloak", { Ghostly: { value: 1 } }));
  assert.ok(/is-tracked/.test(ranked) && !/is-utility/.test(ranked),
    "ranked, it is a REASON the item was picked — order of the three tests is load-bearing");
});

test("#453 U2: with no prioCtx nothing is tracked, and nothing throws", () => {
  const v = { variant_id: "X", affixes: [{ name: "Melee Power", value: 10, type: "Enhancement" }] };
  const html = R.equippedBody(v, -1, null, null, false, false, undefined);
  assert.ok(/is-incidental/.test(html), "the pure/test call path still renders");
  assert.ok(!/is-tracked/.test(html), "…and claims nothing about a solve it was not given");
});

test("#453 U2: an item with no affixes renders no chip row — regression guard", () => {
  // Deliberately NOT proven red: it passed before #453 and must keep passing.
  // An empty chip row would be a new kind of visual noise on exactly the cards
  // that have least to say.
  assert.strictEqual(R.equippedBody({ variant_id: "Bare", affixes: [] }, -1, null, null, false, false, null), "");
});

test("#453 U4 (R9/R10/KTD4): incidental chips cap at 6; tracked and utility never hide", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `Filler ${i}`, value: i + 1, type: "Enhancement" }));
  const v = { variant_id: "Heavy", affixes: many };
  const html = R.equippedBody(v, -1, null, null, false, false, chipCtx("Heavy", {}));
  assert.strictEqual((html.match(/is-overflow/g) || []).length, 3, "9 incidental, 6 shown, 3 hidden");
  assert.ok(/\+3 more/.test(html), "…behind an in-place expander");
  assert.strictEqual(countStatLines(html), 9,
    "the hidden chips are in the DOM, not dropped — the fact stays on the card (R9)");

  // R10 — the cap bounds INCIDENTAL chips only. Capping the total would hide
  // tracked chips on exactly the items where they matter most.
  const ranked = {};
  many.forEach((a) => { ranked[a.name] = { value: a.value }; });
  const all = R.equippedBody(v, -1, null, null, false, false, chipCtx("Heavy", ranked));
  assert.strictEqual((all.match(/is-tracked/g) || []).length, 9, "nine tracked contributions all show");
  assert.strictEqual((all.match(/is-overflow/g) || []).length, 0, "…with no overflow control at all");
});

test("#453 U4: exactly at the cap there is no expander", () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `Filler ${i}`, value: 1, type: "Enhancement" }));
  const html = R.equippedBody({ variant_id: "Six", affixes: six }, -1, null, null, false, false, null);
  // Assert the chips are actually THERE before asserting nothing is hidden —
  // "no overflow control" is trivially true of a tree that has no overflow
  // control at all, and a boundary test that cannot fail is not a boundary test.
  assert.strictEqual(countStatLines(html), 6, "six rows render");
  assert.ok(!/is-overflow/.test(html) && !/more</.test(html), "six shows six and says nothing more");
});

test("#453 U3 (R6): an augment's stats are chips NESTED under that augment", () => {
  const v = { variant_id: "Host", affixes: [{ name: "Armor Class", value: 5, type: "Natural" }] };
  const maps = chipMaps({ byIndex: new Map([[0, [{ variant_id: "Solar Gem of Attack", color: "Colorless" }]]]),
                          freeByIndex: new Map() });
  const augById = new Map([["Solar Gem of Attack", { affixes: [{ name: "Accuracy", value: 4, type: "Artifact" }] }]]);
  const html = R.equippedBody(v, 0, maps, augById, false, false, chipCtx("Host", { Accuracy: { value: 4 } }));
  // #469 — the class list is open-ended now: the row inherits the priority link
  // of whatever it grants. The nesting this test is about is unchanged.
  // #471 — the gem is a row in the shared language now, and its grants are the
  // indented `pd-sub` list under it. The nesting this test is about is unchanged.
  const li = html.match(/<li class="pd-line[^"]*aug-filled[^"]*"[\s\S]*?<\/ul><\/span><\/li>/);
  assert.ok(li, "the augment renders its own row");
  assert.ok(/<ul class="pd-sub">/.test(li[0]), "…carrying its granted stat nested inside it (KD3)");
  assert.ok(/Solar Gem of Attack/.test(li[0]) && /Accuracy/.test(li[0]),
    "which gem grants what survives — the loadout is a shopping list");
});

test("#453 U3: an augment-granted stat is classified like any other", () => {
  const v = { variant_id: "Host", affixes: [] };
  const maps = chipMaps({ byIndex: new Map([[0, [{ variant_id: "Gem", color: "Colorless" }]]]),
                          freeByIndex: new Map() });
  const augById = new Map([["Gem", { affixes: [
    { name: "Accuracy", value: 4, type: "Artifact" },
    { name: "True Seeing", value: 1, type: "Bool" },
  ] }]]);
  const html = R.equippedBody(v, 0, maps, augById, false, false, chipCtx("Host", { Accuracy: { value: 4 } }));
  assert.ok(/<li class="is-tracked[^"]*">Accuracy/.test(html), "a credited augment stat is tracked");
  assert.ok(/<li class="is-utility[^"]*">True Seeing/.test(html), "a presence augment stat is utility");
  assert.ok(!/✓ True Seeing/.test(html), "#487 — the nested line drops the check too; the gutter marks it");
});

test("#453 U6 (R18): the stale-snapshot control is labelled for what it does", () => {
  assert.ok(!/Re-solve now/.test(R.NOTICE_TABLE.staleSnapshotNotice.jump.label),
    "it opens the panel; it does not itself solve (KD6)");
  assert.strictEqual(R.NOTICE_TABLE.staleSnapshotNotice.jump.anchor, "#wz-adjust-slot");
});

test("#453 U4 (R9): a stat chip caps at the row width and wraps its own text", () => {
  // CSS-text assertion — this file has no DOM. The behavioural proof is the
  // 375px browser pass, which measured document.scrollWidth 518 -> 375 and
  // offenders 214 -> 0 on an ML36 caster solve.
  //
  // The run this replaced was `white-space: nowrap` with no width cap, and the
  // BASE tree scrolls to 516px on the same solve — so this is a pre-existing
  // defect the new family had to avoid inheriting, not one #453 introduced.
  const fs = require("fs"); const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf-8");
  // #471 — the value now lives in the row's third column, and the cap is on that
  // column: `min-width: 0` lets a grid track shrink below its content, which is
  // what makes `overflow-wrap` reachable at all. Without it the track floors at
  // max-content and the page scrolls sideways exactly as the old run did.
  const rule = css.slice(css.indexOf(".pd-ln-what {"));
  const body = rule.slice(0, rule.indexOf("}"));
  assert.ok(/min-width:\s*0/.test(body), "the value column may shrink below its content");
  assert.ok(/overflow-wrap:\s*anywhere/.test(body), "…and a long label wraps inside it");
  assert.ok(!/white-space:\s*nowrap/.test(body), "…and does not inherit the run's unbreakable nowrap");
  // `.pd-row {` appears three times (base, layout, position). Slicing the first
  // match is the #450 hazard — indexOf from 0 finds a rule that was never the
  // subject. Check every block that opens that selector instead.
  const rowBlocks = [...css.matchAll(/\.pd-row \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rowBlocks.length >= 2, `the selector's blocks resolve (${rowBlocks.length})`);
  assert.ok(rowBlocks.some((blk) => /min-width:\s*0/.test(blk)),
    "the row may shrink below its longest child, or the chip's max-width never binds");
});

// ---------------------------------------------------------------------------
// #455 — one stat surface. `pd-prio` restated 62% of the chip row (measured, 21
// of 34 chips on an ML34 solve) and its only unique content was the set- and
// craft-sourced contributions. Those are chips now and that row is retired.
// ---------------------------------------------------------------------------

test("#455: the loadout card renders no second chip family", () => {
  // Through `equippedRow`, NOT `equippedBody`: pd-prio was emitted by the ROW,
  // so an equippedBody-only assertion passes against the pre-change tree and
  // proves nothing. (It did, on the first draft of this test.)
  const v = { variant_id: "Solo", affixes: [{ name: "Melee Power", value: 10, type: "Enhancement" }] };
  const res = { chosen: [{ slot: "Ring", variant: v }],
    breakdown: { "Melee Power": [{ bonus_type: "Enhancement", value: 10, source: "Solo", sourceKind: "worn", hostIds: ["Solo"] }] } };
  const html = R.equippedRow("Ring", { variant: v, idx: 0 }, {}, new Set(), null, null, null, null,
    { result: res, attr: R.attributionByTarget(res), targets: ["Melee Power"] });
  assert.ok(!/pd-prio|pd-chip-head|pd-chip-value/.test(html),
    "the pd-prio row and its internals are gone from the gear box");
  assert.ok(/class="pd-line is-tracked/.test(html), "the stat row carries the credited fact instead");
});

test("#455/#471: a craft-granted point is stated in place, once, and classified", () => {
  const v = { variant_id: "Cloak", affixes: [] };
  const maps = chipMaps(new Map() && { byIndex: new Map(), freeByIndex: new Map() });
  maps.vikByItem = new Map([["Cloak", [{ slot_type: "Dolorous", stat: "Seeker", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]);
  const html = R.equippedBody(v, 0, maps, new Map(), false, false,
    chipCtx("Cloak", { Seeker: { value: 15, sourceKind: "vik" } }));
  // #471 — the instruction and the value are ONE row in the Craft section: the
  // slot it goes in on the left, what it applies on the right, credited-to-your
  // -priorities on the row itself. Stats no longer restates it.
  assert.ok(/pd-slabel">Craft · Viktranium</.test(html), "the section names the crafting system");
  assert.ok(hasLine(html, "is-tracked", "Seeker \\+15"), "the crafted point is credited on its own row");
  assert.ok(/<span class="pd-ln-where">Dolorous</.test(html), "…beside the slot it goes in");
  assert.strictEqual(countStatLines(html), 0, "and Stats does not restate it (#471)");
  assert.strictEqual((html.match(/Seeker \+15/g) || []).length, 1, "stated exactly once on the card");
});

test("#455: a set-sourced point is chipped even with no affix record on the item", () => {
  const v = { variant_id: "Piece", affixes: [] };
  const ctx = { result: { chosen: [] },
    attr: { "Melee Power": [{ hostIds: ["Piece"], value: 15, bonus_type: "Artifact", isSet: true }] },
    targets: ["Melee Power"] };
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(hasLine(html, "is-tracked", "Melee Power \\+15"), "the set point gets a row of its own");
  // #471 — the provenance is the row's WHERE column. It was a coloured `pd-src`
  // pill at the end of the chip AND a `(set)` qualifier under it; the column
  // that exists for exactly this fact now carries it, once.
  assert.ok(/<span class="pd-ln-where">set<\/span>/.test(html), "…named as set-granted in the where column");
  assert.strictEqual((html.match(/>set</g) || []).length, 1, "stated once, not three times over");
});

test("#455: the #88 override disclosure survives the move onto the chip", () => {
  // Non-negotiable. It shipped because a gear box stating a bonus type without
  // it "states a bonus type as though the wiki said so"; that is exactly as
  // false on a chip as it was on the retired row.
  const v = { variant_id: "Ovr", affixes: [{ name: "Accuracy", value: 4, type: "Quality" }] };
  const ctx = { result: { chosen: [] },
    attr: { Accuracy: [{ hostIds: ["Ovr"], value: 4, bonus_type: "Quality", overriddenFrom: "Insightful" }] },
    targets: ["Accuracy"] };
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(/your call — catalog says Insightful/.test(html), "the disclosure is on the card");
  assert.ok(/pd-q-override/.test(html), "…in its own marked span");
});

test("#455: a cross-added credit keeps its (from <stat>) label", () => {
  const v = { variant_id: "Cross", affixes: [{ name: "Fire Spell Power", value: 20, type: "Enhancement" }] };
  const ctx = { result: { chosen: [] },
    attr: { "Fire Spell Power": [{ hostIds: ["Cross"], value: 20, bonus_type: "Enhancement", crossAdd: "Universal Spell Power" }] },
    targets: ["Fire Spell Power"] };
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(/from Universal Spell Power/.test(html), "the cross-add source is named (#290/#291)");
});

test("#455: a credited point with no affix record still reaches a chip", () => {
  // The residual sweep, proven non-vacuous. On real data the four source kinds
  // are all covered (worn by printed affixes, the six craft families and set by
  // their own branches, augments never credited to the host) so this fires zero
  // times — but a credited point that renders NOWHERE is an invisible gap, and
  // this is the arm that makes that impossible.
  const v = { variant_id: "Legacy", set_bonus: [], parsed_set_bonuses: [] };  // no affixes at all
  const ctx = { result: { chosen: [] },
    attr: { Constitution: [{ hostIds: ["Legacy"], value: 15, bonus_type: "Enhancement" }] },
    targets: ["Constitution"] };
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(hasLine(html, "is-tracked", "Constitution \\+15"),
    "the point is chipped rather than silently dropped");
});

test("#455: the sweep does not double-chip a collapsed bundle — regression guard", () => {
  // Deliberately NOT proven red: the pre-change tree renders one chip here too,
  // having no sweep to double it. This pins that the sweep added in #455 does
  // not regress it — the bundle is filed under its enchantment while the
  // contribution names a member stat, so a sweep keyed on the entry alone would
  // chip it twice. It caught exactly that during implementation.
  const v = { variant_id: "Focus", affixes: focusMasteryAffixes("Sacred Spell Focus Mastery", "Sacred", 3) };
  const ctx = chipCtx("Focus", { "Evocation Focus": { value: 3, via: "Sacred Spell Focus Mastery" } });
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.strictEqual(countStatLines(html), 1, "exactly one row for the bundle");
});

test("#455: craftLabel is unchanged, and the step label is separate", () => {
  // Mixed: the craftLabel assertions are a regression guard (they pass before
  // and after), the craftStepLabel ones are new API and go red on the pre-change
  // tree. Kept in one test because the POINT is the relationship between them —
  // the exporters render from craftLabel and the goldens pin it, so the trimmed
  // instruction had to be a separate function rather than a flag that could
  // move five formats at once.
  const P = require("../web/projection.js");
  const o = { slot_type: "Dolorous", stat: "Seeker", bonus_type: "Enhancement", value: 15, unit: "flat" };
  assert.strictEqual(P.craftLabel(o, "vik"), "Slot Dolorous Viktranium augment: Seeker +15");
  assert.strictEqual(P.craftStepLabel(o, "vik"), "Slot Dolorous Viktranium augment");
  // vikEmpty is a disclosure that a declared slot went unfilled, not a craft to
  // go apply — shortening it would turn "no option helps you" into an instruction.
  assert.strictEqual(P.craftStepLabel({ slot_type: "X" }, "vikEmpty"), P.craftLabel({ slot_type: "X" }, "vikEmpty"));
});

// ---------------------------------------------------------------------------
// #457 — the gear card's per-item body: printed affixes, craft-granted points
// and augment grants, each stated exactly once.
//
// These were written against the Loadout Deep Dive, the second per-item surface
// #457 brought up to parity with the card. #498 retired that tab, and the
// assertions came with it: what they pin lives in `augmentSection` /
// `craftSection` / `statChipEntries`, which the card calls through
// `equippedBody`. See `itemBody` above.
// ---------------------------------------------------------------------------

function ddMaps(o) {
  o = o || {};
  const m = blockMaps(o);
  m.jokerByHost = o.jokerByHost || new Map();
  return m;
}

/** #498 — the Loadout card's body for one equipped item.
 *
 *  The tests below were written against `loadoutDeepDive`, which is gone. What
 *  they assert was never really about that tab: the Augments and Craft sections,
 *  the stat rows, and the de-duplication between them all come from
 *  `augmentSection` / `craftSection` / `statChipEntries`, which the Loadout card
 *  calls through `equippedBody`. Retiring the second surface must not retire
 *  their coverage, so they follow the behaviour to the surface that kept it.
 *
 *  `<ul class="pd-lines">` becomes `<ul class="pd-lines">` here — the
 *  same list, without the wrapper class the deleted tab put on it. */
function itemBody(res, query, maps, augById, idx) {
  const i = idx || 0;
  const ctx = { result: res, attr: R.attributionByTarget(res), targets: (query && query.targets) || [] };
  return R.equippedBody(res.chosen[i].variant, i, maps, augById, false, false, ctx);
}

test("#457: the item body chips craft-granted points its affix list never had", () => {
  const v = { variant_id: "Shield", affixes: [{ name: "Armor Class", value: 41, type: "Shield" }] };
  const res = { chosen: [{ slot: "Off Hand", variant: v }], augmentsPlaced: [], setsActive: [],
    breakdown: { "Armor-Piercing": [{ bonus_type: "Enhancement", value: 23, source: "Shield",
      sourceKind: "vik", slot: "Off Hand", hostIds: ["Shield"] }] } };
  const maps = ddMaps({ vikByItem: new Map([["Shield", [{ slot_type: "Miserable",
    stat: "Armor-Piercing", bonus_type: "Enhancement", value: 23, unit: "flat" }]]]) });
  const html = itemBody(res, { targets: ["Armor-Piercing"] }, maps);
  assert.ok(hasLine(html, "is-incidental", "Armor Class \\+41"), "the printed affix is a row");
  // #457's guarantee is that the craft-granted point is READABLE on this surface
  // at all — it used to live only in `pd-prio` and inside the fused craft label,
  // so the exhaustive tab showed less than the summary card it details. #472
  // moved WHERE it is read: the Craft section states it beside the slot that
  // yields it, credited to the priority list, instead of the affix list carrying
  // a second copy. Still readable, still classified, now stated once.
  assert.ok(hasLine(html, "is-tracked", "Armor-Piercing \\+23"),
    "and the craft-granted point is a credited row of its own");
  assert.ok(/<span class="pd-ln-where">Miserable<\/span>/.test(html), "…named by the slot that applies it");
  // Stated once as a STAT. The `here only for its crafts` foot note names it a
  // second time, and that is a different statement — a claim about the pick, not
  // a listing of what the item gives — so it is excluded from the count rather
  // than counted as duplication.
  const affixList = html.match(/<ul class="pd-lines">[\s\S]*?<\/ul>/);
  assert.ok(affixList, "the affix list renders");
  assert.ok(!/Armor-Piercing/.test(affixList[0]),
    "the affix list does NOT restate what the craft row already states (#472)");
});

test("#457/#472: the craft row is the slot and what it applies, once", () => {
  // #457 trimmed the craft chip to the instruction alone, because
  // the value was already restated in its affix list. #472 inverts that: the row
  // carries the value beside the slot, and the affix list no longer carries it.
  // Either way the point is stated exactly once, which is the guarantee.
  const v = { variant_id: "Shield", affixes: [] };
  const res = { chosen: [{ slot: "Off Hand", variant: v }], augmentsPlaced: [], setsActive: [], breakdown: {} };
  const maps = ddMaps({ vikByItem: new Map([["Shield", [{ slot_type: "Miserable",
    stat: "Armor-Piercing", bonus_type: "Enhancement", value: 23, unit: "flat" }]]]) });
  const html = itemBody(res, { targets: [] }, maps);
  assert.ok(/<span class="pd-ln-where">Miserable<\/span><span class="pd-ln-what">Armor-Piercing \+23<\/span>/.test(html),
    "the slot on the left, the affix it applies on the right");
  assert.strictEqual((html.match(/Armor-Piercing \+23/g) || []).length, 1,
    "stated once, not in the affix list as well");
  assert.ok(!/Slot Miserable Viktranium augment/.test(html),
    "…and the fused sentence is gone from this surface (the exports keep it)");
});

test("#457: an unfilled Viktranium slot keeps its full disclosure", () => {
  // Regression guard, deliberately NOT proven red. `vikEmpty` is not an
  // instruction but a statement that a declared slot went unfilled; trimming it
  // would turn "no option helps you" into a craft to go apply.
  const v = { variant_id: "Cloak", affixes: [], viktranium_slots: ["Melancholic"] };
  const res = { chosen: [{ slot: "Back", variant: v }], augmentsPlaced: [], setsActive: [], breakdown: {} };
  const html = itemBody(res, { targets: [] }, ddMaps({}));
  if (/Melancholic/.test(html)) {
    assert.ok(/left empty — no option adds to your ranked stats/.test(html),
      "the unfilled slot still says why it is empty");
  }
});

test("#457: the item body says what each augment grants, not just its name", () => {
  const v = { variant_id: "Host", affixes: [] };
  const res = { chosen: [{ slot: "Ring", variant: v }], augmentsPlaced: [], setsActive: [], breakdown: {} };
  const maps = ddMaps({ byIndex: new Map([[0, [{ variant_id: "Solar Gem of Attack", color: "Colorless" }]]]) });
  const augById = new Map([["Solar Gem of Attack", { affixes: [{ name: "Accuracy", value: 4, type: "Artifact" }] }]]);
  const html = itemBody(res, { targets: [] }, maps, augById);
  assert.ok(/Solar Gem of Attack/.test(html), "the augment is named");
  assert.ok(/Accuracy \+4 Artifact/.test(html),
    "and what it grants is shown — the gear box has done this since #453");
});

test("#457: the item body renders without a catalog, naming the augment alone — regression guard", () => {
  // Deliberately NOT proven red: it passes before and after, because augById was
  // not a parameter at all before. It pins that making it optional did not make
  // it required — the pure-test callers and any caller without the catalog must
  // still render rather than throw.
  const v = { variant_id: "Host", affixes: [] };
  const res = { chosen: [{ slot: "Ring", variant: v }], augmentsPlaced: [], setsActive: [], breakdown: {} };
  const maps = ddMaps({ byIndex: new Map([[0, [{ variant_id: "Mystery Gem", color: "Colorless" }]]]) });
  const html = itemBody(res, { targets: [] }, maps);
  assert.ok(/Mystery Gem/.test(html), "the name still renders with no catalog in hand");
});

// ---------------------------------------------------------------------------
// #469 — card structure (head / body / foot), the display name, and the
// priority link on the affix chips, the augment rows and the craft chips.
// ---------------------------------------------------------------------------

const P469 = require("../web/projection.js");

test("#469: the displayed name drops a (level N) that only restates the item's ML", () => {
  assert.strictEqual(
    P469.displayItemName({ variant_id: "Legendary Ship-Chaplain's Sidearm (level 32)", ml: 32 }),
    "Legendary Ship-Chaplain's Sidearm",
    "the parenthetical says exactly what the ML field says");
  assert.strictEqual(
    P469.displayItemName({ variant_id: "Arcing Sky (level 13) [Crafted]", ml: 13 }),
    "Arcing Sky [Crafted]",
    "…and a trailing tag after it survives the strip");
});

test("#469: it is an equality test, not a suffix stripper", () => {
  assert.strictEqual(
    P469.displayItemName({ variant_id: "Odd Thing (level 20)", ml: 34 }),
    "Odd Thing (level 20)",
    "a parenthetical that does NOT restate the ML means something else and stays");
  for (const id of ["Sword of Shadow (Legendary)", "Nightforge Gorget (Heroic)",
                    "Blade (2d6)", "Bauble (legacy)", "Shield (round)"]) {
    assert.strictEqual(P469.displayItemName({ variant_id: id, ml: 30 }), id,
      `every other parenthetical is meaningful and is left alone — ${id}`);
  }
  assert.strictEqual(
    P469.displayItemName({ variant_id: "Mystery (level 20)" }), "Mystery (level 20)",
    "with no ML there is nothing to compare against, so nothing is dropped");
});

test("#469: the card shows the display name but keeps variant_id as its identity", () => {
  const pick = { slot: "Main Hand", idx: 0, variant: { variant_id: "Sidearm (level 32)", ml: 32, affixes: [] } };
  const html = R.equippedRow("Main Hand", pick, {});
  assert.ok(/class="pd-rname" title="Sidearm \(level 32\)">Sidearm<\/div>/.test(html),
    "the rendered name is stripped while the title keeps the full id");
  assert.ok(/data-variant="Sidearm \(level 32\)"/.test(html),
    "and pin/free/override still address the item by its real variant_id");
});

test("#469: the card is three named regions in head/body/foot order", () => {
  const pick = { slot: "Ring", idx: 0, variant: { variant_id: "R1", ml: 34,
    affixes: [{ name: "Melee Power", value: 10, type: "Enhancement" }] } };
  const html = R.equippedRow("Ring", pick, {});
  const order = ["pd-card-head", "pd-rbody", "pd-card-foot"].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), "all three regions are emitted");
  assert.ok(order[0] < order[1] && order[1] < order[2], "…in head -> body -> foot order");
  // The slot, the name and the ML are ONE block: this is what lets the CSS give
  // every card a head of the same height, which is what makes a grid row line up.
  const head = srcBetween(html, `<div class="pd-card-head">`, `<div class="pd-rbody`, "card head");
  for (const part of ["pd-rlabel", "pd-rname", "pd-rmeta"]) {
    assert.ok(head.includes(part), `the head carries ${part}`);
  }
  assert.ok(head.includes("ML 34"), "the ML is in the head, not loose in the body");
});

test("#469: an empty slot still emits all three regions, so the grid stays aligned", () => {
  const html = R.equippedRow("Goggles", null, {});
  assert.ok(/<div class="pd-rmeta"><\/div>/.test(html),
    "the meta line is emitted even with no ML to put in it (CSS reserves its height)");
  assert.ok(/<div class="pd-rbody"><\/div>/.test(html), "and an empty body still spaces the foot to the bottom");
  assert.ok(/<div class="pd-card-foot"><div class="pd-note pd-rnote is-empty">/.test(html),
    "the reason note is in the foot, not interleaved above the body");
});

test("#469: an empty foot is truly empty, so :empty can collapse it", () => {
  const pick = { slot: "Ring", idx: 0, variant: { variant_id: "R1", ml: 34, affixes: [] } };
  assert.ok(/<div class="pd-card-foot"><\/div>/.test(R.equippedRow("Ring", pick, {})),
    "no stray whitespace — a text node would defeat .pd-card-foot:empty");
});

test("#469: a stat on the priority list but NOT credited is ranked, not incidental", () => {
  const v = { variant_id: "Helm", affixes: [
    { name: "Melee Power", value: 10, type: "Enhancement" },     // ranked, credited elsewhere
    { name: "Doublestrike", value: 8, type: "Insight" },         // ranked AND credited here
    { name: "Armor Class", value: 15, type: "Natural" },         // never asked for
  ] };
  const ctx = chipCtx("Helm", { Doublestrike: { value: 8, type: "Insight" } });
  ctx.targets = ["Melee Power", "Doublestrike"];                 // the priority list, not the attribution
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(hasLine(html, "is-ranked", "Melee Power"),
    "an outbid priority reads as linked to the list, not as an unrelated affix");
  assert.ok(hasLine(html, "is-tracked", "Doublestrike"),
    "…and a credited one keeps the stronger class, which still means 'why this item is here'");
  assert.ok(hasLine(html, "is-incidental", "Armor Class"), "a stat nobody ranked is still incidental");
});

// Deliberately NOT proven red — it passes against the pre-change tree, where
// `is-ranked` did not exist at all. That is the point: it pins that adding the
// class did not make an uncontextualised render start claiming things, which is
// the same guarantee #453's "with no prioCtx nothing is tracked" test holds.
test("#469: with no priority list in hand, nothing is marked ranked", () => {
  const v = { variant_id: "Helm", affixes: [{ name: "Melee Power", value: 10, type: "Enhancement" }] };
  assert.ok(!/is-ranked/.test(R.equippedBody(v, -1, null, null, false, false, null)),
    "a caller that was not told what the player ranked claims nothing");
});

test("#469: the Utility sentinel never becomes a ranked stat name", () => {
  const M = require("../web/model.js");
  const set = R.rankedStatSet({ targets: ["Melee Power", M.UTILITY_SENTINEL] });
  assert.ok(set.has("Melee Power"), "real priorities are in the set");
  assert.ok(!set.has(M.UTILITY_SENTINEL), "the sentinel is not a stat and nothing on an item is named after it");
});

test("#469/#471: a craft row carries the priority link of what the craft grants", () => {
  const v = { variant_id: "Cloak1", affixes: [] };
  const maps = blockMaps({ ncByItem: new Map([["Cloak1",
    [{ stat: "Constitution", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const ctx = chipCtx("Cloak1", { Constitution: { value: 15, sourceKind: "nc" } });
  const html = R.equippedBody(v, 0, maps, new Map(), false, false, ctx);
  assert.ok(/<li class="pd-line is-tracked[^"]*craft-nc"/.test(html),
    "the row says which crafting trip actually serves the ranked list");
  const bare = R.equippedBody(v, 0, maps, new Map(), false, false, null);
  assert.ok(/<li class="pd-line is-incidental craft-nc"/.test(bare) && !/is-tracked/.test(bare),
    "…and with no context it is an unmarked instruction, claiming nothing");
});

test("#469: an augment row carries the priority link of what the gem grants", () => {
  const v = { variant_id: "Host", affixes: [] };
  const maps = chipMaps({ byIndex: new Map([[0, [{ variant_id: "Gem", color: "Colorless" }]]]),
                          freeByIndex: new Map() });
  const augById = new Map([["Gem", { affixes: [{ name: "Doublestrike", value: 4, type: "Quality" }] }]]);
  const ctx = chipCtx("Host", { Doublestrike: { value: 4, type: "Quality" } });
  assert.ok(/<li class="pd-line is-tracked aug-filled /.test(
    R.equippedBody(v, 0, maps, augById, false, false, ctx)),
    "eighteen gems down a loadout, the ones that matter are findable without opening each");
  const onlyRanked = chipCtx("Host", {});
  onlyRanked.targets = ["Doublestrike"];
  assert.ok(/<li class="pd-line is-ranked aug-filled /.test(
    R.equippedBody(v, 0, maps, augById, false, false, onlyRanked)),
    "a gem granting a listed-but-outbid stat gets the weaker link, not none");
});

test("#487: the row has TWO states — ON is filled and bold, OFF is hollow and normal", () => {
  // This started as a four-step ramp (filled / hollow / ring / dot) with three
  // text treatments, and the maintainer ruled it out twice: "these little
  // indicators have 2 conditions, off and on". The symptom was a False Life row
  // showing a HOLLOW diamond beside FULL-WHITE text, because `ranked` took `#fff`
  // without the weight — the mark said off and the text said on.
  //
  // What this test guarded before, and still guards, is that neither state is
  // carried by hue alone. Two states, each with a shape AND a weight.
  const css = _reachCss();
  // Comments are stripped once, here: several of them MENTION selectors this test
  // asserts are absent (one records that the rank-1 accent was removed), and a
  // naive scan reads a comment as a rule and passes for the wrong reason.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const R471 = require("../web/results.js");
  const M = R471.LINE_MARK;

  // ON: both classes that mean "doing something" are filled…
  assert.strictEqual(M.tracked, "◆", "credited is filled");
  assert.strictEqual(M.utility, "◆", "a secured utility effect is filled");
  // …and OFF: everything else is the same hollow shape, including a stat that is
  // ON THE LIST but lost its bucket. It is not doing anything, and #469's
  // explanation for that rides the row's title instead of a second visual shade.
  assert.strictEqual(M.ranked, "◇", "outbid is hollow");
  assert.strictEqual(M.incidental, "◇", "and so is an affix that came along with the item");
  assert.strictEqual(new Set(Object.values(M)).size, 2, "TWO glyphs — no third state");

  // The text treatments pair with the shapes, one each way.
  const on = _cssRule(css, ".pd-line.is-tracked .pd-ln-what,");
  assert.ok(/font-weight: 700/.test(on) && /#fff/.test(on), "ON is bold white");
  assert.ok(/is-utility \.pd-ln-what/.test(on), "…for utility as well as tracked");
  assert.ok(!/\.pd-line\.is-ranked \.pd-ln-what/.test(css),
    "OFF takes no text treatment at all — a hollow mark beside white text is the reported bug");
  assert.ok(!/\.pd-line\.is-incidental \.pd-ln-what/.test(css), "…for either OFF class");

  // One level down: a GEM row's two states are occupancy, not whether its stats
  // won their buckets. It carried the same split — `.aug-filled.is-tracked` bold
  // white, `.aug-filled.is-ranked` white-not-bold — which is the reported bug
  // reproduced on the augment row.
  assert.ok(!/aug-filled\.is-(tracked|ranked) \.aug-name/.test(rules),
    "a gem's name is not styled by which of its stats got credited");
  const gem = _cssRule(css, ".pd-line.aug-filled .aug-name {");
  assert.ok(/font-weight: 700/.test(gem) && /#fff/.test(gem),
    "a slotted gem is ON — filled mark, bold name");

  // One filled colour, and nothing keyed to a stat's RANK.
  const filledColour = _cssRule(css, ".pd-line.is-tracked .pd-ln-mark,");
  assert.ok(/var\(--optimal\)/.test(filledColour), "every filled mark is the one filled colour");
  assert.ok(!/\.is-rank1/.test(rules),
    "no rule keys off is-rank1 — a row must not look different for being ranked higher");
});

test("#487: nothing stamps is-rank1 on a row any more", () => {
  // The class was the last place a row's appearance depended on where its stat
  // sat in the priority list: "I suspect your doing weird things based on how
  // high in the priority it is, I do not want that". Asserted on the RENDER, not
  // just on the stylesheet, because an unstyled class in the DOM still misleads
  // anyone reading it.
  const v = { variant_id: "Top", affixes: [
    { name: "Melee Power", value: 10, type: "Enhancement" },
    { name: "Doublestrike", value: 5, type: "Quality" },
  ] };
  const ctx = chipCtx("Top", { "Melee Power": { value: 10 }, Doublestrike: { value: 5 } });
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(hasLine(html, "is-tracked", "Melee Power"), "the top priority is still credited");
  assert.strictEqual((html.match(/is-rank1/g) || []).length, 0,
    "…and carries no rank accent");

  // #515 — the guard used to render only the STAT row, which is one of the four
  // surfaces the retired `rank1` parameter was threaded to. A reintroduction in
  // the augment or craft section would have passed it. Cover them too.
  const withAug = { variant_id: "Aug", augment_slots: ["Colorless"],
    affixes: [{ name: "Constitution", value: 6, type: "Insight" }] };
  const withCraft = { variant_id: "Craft", crafting: ["Green Augment Slot"],
    affixes: [{ name: "Dodge", value: 3, type: "Enhancement" }] };
  for (const variant of [withAug, withCraft, { variant_id: "Bare", affixes: [] }]) {
    const out = R.equippedBody(variant, -1, null, null, false, false,
      chipCtx(variant.variant_id, { Constitution: { value: 6 }, Dodge: { value: 3 } }));
    assert.strictEqual((out.match(/is-rank1/g) || []).length, 0,
      `${variant.variant_id}: no rank accent on any card surface`);
  }
});

test("#515: the retired `rank1` parameter is gone, not merely unused", () => {
  // A parameter still sitting in position 4 of statChipRow and friends is a
  // loaded gun: the next rank-aware feature finds it already named and plumbed,
  // wires it into stackLine's opts, and silently reintroduces exactly what #487
  // removed. Deleting the argument is what makes that impossible rather than
  // merely discouraged.
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  assert.ok(!/\brank1\b/.test(src),
    "no rank1 parameter, derivation, or opts branch survives in web/results.js");
  // The CSS comments stay: they record why the class must never come back, which
  // outlives the parameter that used to stamp it.
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "..", "web", "styles.css"), "utf8");
  assert.ok(/is-rank1/.test(css), "the stylesheet still records why it must not return");
});

test("#469/#472: the crafting system is named in words, not carried by a colour", () => {
  // #469 drew the priority link on a craft chip as a RING outside its border,
  // because the border colour was the only thing saying which crafting system a
  // step belonged to — and that is how the player finds the right station.
  // #472 retires the chips and states the system in the caption instead. The
  // guarantee is the same and stronger: a name survives monochrome, and an
  // eleven-colour scheme keyed to crafting systems never did.
  const v = { variant_id: "Eyes", affixes: [] };
  const maps = blockMaps({ vikByItem: new Map([["Eyes",
    [{ slot_type: "Dolorous", stat: "Seeker", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const idx = { keys: new Set(), byStat: new Map(), list: [] };
  assert.ok(/pd-slabel">Craft · Viktranium</.test(R.craftSection(v, 0, maps, idx, null, new Set())),
    "a single-system item names that system above its rows");
  // A mixed-family item must NOT name one of two systems above rows from both.
  const mixed = blockMaps({
    vikByItem: new Map([["Eyes", [{ slot_type: "Dolorous", stat: "Seeker", value: 15 }]]]),
    tfByItem: new Map([["Eyes", [{ tier: 3, stat: "Melee Power", value: 12 }]]]),
  });
  assert.ok(/pd-slabel">Craft</.test(R.craftSection(v, 0, mixed, idx, null, new Set())),
    "a mixed-family item says just Craft — naming one system would be a false claim");
  assert.ok(!/Craft · /.test(R.craftSection(v, 0, mixed, idx, null, new Set())));
});

test("#469: the card regions are sized to line up, not merely stacked", () => {
  const css = _reachCss();
  assert.ok(/\.pd-card-head \.pd-rname \{[^}]*min-height/.test(css),
    "the name reserves its second line so a wrapping name does not shift the ML off its neighbour's baseline");
  assert.ok(!/\.pd-card-head \.pd-rname \{[^}]*line-clamp/.test(css),
    "…and reserves rather than truncates: this list has shown full item names since it replaced the figure");
  assert.ok(/\.pd-rbody \{[^}]*flex: 1 1 auto/.test(css), "the body absorbs the difference in content");
  assert.ok(/\.pd-card-foot:empty \{ display: none; \}/.test(css),
    "and a card with no note carries no divider under nothing");
});

// ---------------------------------------------------------------------------
// #471 — the card's three chip families become ONE row language, every augment
// and craft slot is stated in place whether or not the solve filled it, and the
// foot's four note shapes become one. Reported directly: the chips read as
// clutter, a slot with no affix beside it says nothing actionable, and the two
// footer notes looked like neither each other nor anything else on the card.
// ---------------------------------------------------------------------------

test("#471: a craft-granted point is stated once — in place, not also in Stats", () => {
  // The de-duplication, at the level that matters: the SAME point, counted.
  // Before this the Craft section said "Slot Dolorous Viktranium augment" with
  // no value and the Stats section said "Seeker +15" with no slot, so the card
  // printed one fact in two halves and the player had to join them.
  const v = { variant_id: "Cloak", affixes: [{ name: "Armor Class", value: 41, type: "Shield" }] };
  const maps = blockMaps({ vikByItem: new Map([["Cloak",
    [{ slot_type: "Dolorous", stat: "Seeker", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const html = R.equippedBody(v, 0, maps, new Map(), false, false,
    chipCtx("Cloak", { Seeker: { value: 15, sourceKind: "vik" } }));
  assert.strictEqual((html.match(/Seeker \+15/g) || []).length, 1, "the crafted point appears exactly once");
  assert.ok(hasLine(html, "is-tracked", "Seeker \\+15"), "…on the craft row, credited to the priority list");
  assert.strictEqual(countStatLines(html), 1, "Stats keeps only what the item itself prints");
  assert.ok(hasLine(html, "is-incidental", "Armor Class \\+41"), "…which is the printed affix");
});

test("#471: a declared craft slot the solve left empty keeps its row, stated briefly", () => {
  // #370's guarantee, in the new language: an item that ships with three slots
  // must never read as a one-slot item. What changed is the WORDING — the full
  // sentence wrapped to two lines per slot at 375px, so the row says "left
  // empty" and the sentence rides its title. The exports keep the full sentence.
  const P = require("../web/projection.js");
  const v = { variant_id: "Eyes", affixes: [],
    lamordia_slots: [{ type: "Dolorous" }, { type: "Melancholic" }, { type: "Miserable" }] };
  const maps = blockMaps({ vikByItem: new Map([["Eyes",
    [{ slot_type: "Dolorous", stat: "Seeker", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const html = R.equippedBody(v, 0, maps, new Map(), false, false, null);
  assert.strictEqual((html.match(/<li class="pd-line[^"]*craft-vik/g) || []).length, 3,
    "all three declared slots are rows — one filled, two not");
  assert.ok(/<span class="pd-ln-where">Melancholic<\/span><span class="pd-ln-what">left empty<\/span>/.test(html),
    "the unfilled slot says so briefly, beside the slot it is");
  const full = P.craftLabel({ slot_type: "Melancholic" }, "vikEmpty");
  assert.ok(/left empty — no option adds to your ranked stats/.test(full),
    "the exports' wording is unchanged — craftLabel is what the goldens pin");
  assert.ok(html.includes(`title="${full}"`), "…and the card carries that full sentence on the row");
});

test("#471: every declared augment colour is a row, filled or not", () => {
  const v = { variant_id: "Host", affixes: [] };
  const maps = blockMaps({
    byIndex: new Map([[0, [{ variant_id: "Gem", color: "Green" }]]]),
    freeByIndex: new Map([[0, ["Blue", "Colorless"]]]),
  });
  const augById = new Map([["Gem", { affixes: [{ name: "Constitution", value: 2, type: "Insight" }] }]]);
  const html = R.equippedBody(v, 0, maps, augById, false, false, null);
  const rows = html.match(/<li class="pd-line[^"]*aug-(filled|open)[^"]*"/g) || [];
  assert.strictEqual(rows.length, 3, "one filled and two open slots, all three on the card");
  assert.ok(/aug-filled aug-green/.test(html) && /aug-open aug-blue/.test(html) && /aug-open aug-colorless/.test(html),
    "each row carries its own slot colour");
});

test("#471: Sun and Moon slots use the SAME glyphs as the Set Bonuses tab", () => {
  // The user asked for exactly this. It is enforced by there being one constant
  // rather than by two literals that happen to match today — the Set Bonuses
  // tab's set-like listing reads `SUN_MOON_GLYPH` too.
  const v = { variant_id: "Host", affixes: [] };
  const maps = blockMaps({
    byIndex: new Map([[0, [{ variant_id: "Solar Gem", color: "Sun" }]]]),
    freeByIndex: new Map([[0, ["Moon"]]]),
  });
  const html = R.equippedBody(v, 0, maps, new Map(), false, false, null);
  assert.ok(html.includes(R.SUN_MOON_GLYPH.sun), "a Sun slot is marked with the shared solar glyph");
  assert.ok(html.includes(R.SUN_MOON_GLYPH.moon), "a Moon slot with the shared lunar one");
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf-8");
  const setLike = src.slice(src.indexOf("const setLike"), src.indexOf("let setsPanel"));
  assert.ok(/SUN_MOON_GLYPH\.moon/.test(setLike) && /SUN_MOON_GLYPH\.sun/.test(setLike),
    "the Set Bonuses tab reads the same constant, so the two cannot drift apart again");
});

test("#471: the card's foot is ONE note family, whatever it is saying", () => {
  // Four shapes lived here: an amber craft-carried line, a muted filler line,
  // the no-drop-source disclosure, and the owned-mode note — which was not even
  // in the foot, it was in the body between two sections.
  const carriedRes = { chosen: [{ slot: "Ring", variant: { variant_id: "Solo" } }],
    breakdown: { Seeker: [{ bonus_type: "Enhancement", value: 15, source: "Solo",
      sourceKind: "vik", hostIds: ["Solo"] }] } };
  const v = { variant_id: "Solo", affixes: [], no_drop_source: true };
  const maps = blockMaps({ vikByItem: new Map([["Solo",
    [{ slot_type: "Dolorous", stat: "Seeker", bonus_type: "Enhancement", value: 15, unit: "flat" }]]]) });
  const html = R.equippedRow("Ring", { variant: v, idx: 0 }, {}, new Set(), maps, new Map(),
    { mode: true, augments: false, slotsCovered: new Set() }, null,
    { result: carriedRes, attr: R.attributionByTarget(carriedRes), targets: ["Seeker"] });
  const foot = html.slice(html.indexOf('<div class="pd-card-foot">'));
  const notes = foot.match(/<div class="pd-note[^"]*"/g) || [];
  assert.strictEqual(notes.length, 3, "no-drop-source, owned-mode and craft-carried, all three in the foot");
  assert.ok(notes.every((n) => /class="pd-note/.test(n)), "every one of them is the same family");
  assert.ok(/pd-note[^"]*is-source/.test(foot) && /pd-note[^"]*is-owned/.test(foot)
    && /pd-note[^"]*is-craft/.test(foot), "…differing only by the role that colours its edge");
  assert.ok(!/pd-rec-note/.test(html), "the owned-mode note is no longer a shape of its own in the body");
});

test("#471/#487: head, body and foot are separated without a rule across the card", () => {
  // The user's report: the bars do not look good. Three devices replace them —
  // a tint that fades out, a spine the rows hang off, and a recessed plate.
  const css = _reachCss();
  const head = _cssRule(css, ".pd-card-head { display: flex");
  assert.ok(/border-bottom: 0/.test(head), "the head's hard rule is gone");
  assert.ok(/linear-gradient/.test(head), "…replaced by a tint that fades into the body");
  assert.ok(/\.pd-card-head::after/.test(css), "with a tapered seam rather than a full-width bar");
  const foot = _cssRule(css, ".pd-card-foot { margin: 0");
  assert.ok(/border-top: 0/.test(foot), "the foot's dashed rule is gone");
  assert.ok(/background: rgba\(0,0,0/.test(foot), "…replaced by a recessed plate");
  // The body's device CHANGED. #471 hung the sections off a left-gutter spine;
  // at the maintainer's direction each section is its own box now (the reasoning
  // and the reversal are recorded on the `.pd-sec` rule). What this test still
  // guards is the property in its own title, which is unchanged: the separation
  // never comes from a rule drawn ACROSS the card.
  const sec = _cssRule(css, ".pd-sec { display: flex");
  assert.ok(/border: 1px solid/.test(sec), "each section is its own box");
  assert.ok(!/\.pd-rbody::before \{ content/.test(css),
    "the spine is retired — a rule behind three bordered boxes is a fourth edge competing with them");
  assert.ok(!/\.pd-sec ~ \.pd-sec \{[^}]*border-top: 1px/.test(css),
    "and no hairline is added BETWEEN the boxes, which would be #471's device back, doubled");
});

// ---------------------------------------------------------------------------
// #472 — one visual language per item body. The affix list is rows, and so are
// the craft, augment and set-membership blocks; the three set-yielding families
// — wildcard, chosen membership, Set Augment — each get a row of their own.
// (Also written against the retired Deep Dive; re-pointed by #498.)
// ---------------------------------------------------------------------------

test("#472: the item body renders the shared section renderers, not a second set", () => {
  // Shared functions, not matching output. Two implementations that agree today
  // is what #457 and #469 each had to re-fix; one implementation cannot drift.
  const v = { variant_id: "Shield", affixes: [{ name: "Armor Class", value: 41, type: "Shield" }] };
  const res = { chosen: [{ slot: "Off Hand", variant: v }], augmentsPlaced: [], setsActive: [], breakdown: {} };
  const maps = ddMaps({
    byIndex: new Map([[0, [{ variant_id: "Gem", color: "Blue" }]]]),
    freeByIndex: new Map([[0, ["Red"]]]),
    vikByItem: new Map([["Shield", [{ slot_type: "Miserable", stat: "Armor-Piercing",
      bonus_type: "Enhancement", value: 23, unit: "flat" }]]]),
  });
  const augById = new Map([["Gem", { affixes: [{ name: "Doublestrike", value: 3, type: "Quality" }] }]]);
  const html = itemBody(res, { targets: [] }, maps, augById);
  assert.ok(/pd-sec pd-sec-aug/.test(html) && /pd-sec pd-sec-craft/.test(html),
    "the body carries the Augments and Craft sections");
  assert.ok(!/class="chip /.test(html), "and no chip survives on this surface");
  // The open slot is stated as a row of its own — placements used to be all the
  // body showed, with open slots surfacing solely as an aggregate upgrade note.
  assert.ok(/aug-open aug-red/.test(html), "an open augment colour is a row here as well");
});

test("#472: the three set-yielding families get rows, and say what you go and do", () => {
  const v = { variant_id: "Host", set_bonus: [{ set: "Own Set" }], affixes: [] };
  const maps = setMaps({
    jokerByHost: new Map([["Host", [{ host: "Host", set: "Wild Set" }]]]),
    membershipByHost: new Map([["Host", [{ host: "Host", set: "Vol Set", station: "Cannith Repurposing Station" }]]]),
    setAugByHost: new Map([["Host", [{ host: "Host", set: "Prowess", slot_color: "Blue" }]]]),
  });
  const html = R.setMembershipSection(v, maps, null);
  assert.strictEqual((html.match(/<li class="pd-line/g) || []).length, 3, "one row per mechanism");
  // The open question this issue named: these wrap a SET, not a slot with a stat
  // in it. The answer is that the where column is the mechanism you go and use
  // and the value column is the membership you get — which is exactly what the
  // `Part of set:` line above them does NOT say.
  assert.ok(/<span class="pd-ln-where">Wildcard<\/span><span class="pd-ln-what">Wild Set/.test(html));
  assert.ok(/Awaken Set Bonus: Vol Set/.test(html) && /Cannith Repurposing Station/.test(html),
    "the membership row carries the registry's instruction and the station, visibly");
  assert.ok(/<span class="pd-ln-where">Blue<\/span><span class="pd-ln-what">Prowess \(suppresses Own Set\)/.test(html));
});

test("#472: a set row lights up only for the set this item was CREDITED through", () => {
  // The precision that matters. An item feeding two sets and credited for one of
  // them must not mark the row for the other — the filled treatment means "this
  // is why the item is here", and that has been the rule since #453.
  const v = { variant_id: "Host", affixes: [] };
  const maps = setMaps({
    jokerByHost: new Map([["Host", [{ host: "Host", set: "Credited Set" }]]]),
    membershipByHost: new Map([["Host", [{ host: "Host", set: "Uncredited Set", station: "Dinosaur Bone crafting" }]]]),
  });
  const res = { chosen: [], breakdown: {} };
  const attr = { "Melee Power": [{ hostIds: ["Host"], value: 10, bonus_type: "Artifact",
    isSet: true, source: "Credited Set", sourceKind: "set" }] };
  const idx = R.itemContribIndex({ result: res, attr, targets: ["Melee Power"] }, "Host");
  const html = R.setMembershipSection(v, maps, idx);
  assert.ok(/<li class="pd-line is-tracked pd-set-line set-joker"/.test(html),
    "the set the solver actually credited is marked");
  assert.ok(/<li class="pd-line is-incidental pd-set-line set-membership"/.test(html),
    "the one it did not is left quiet — matching on viaSet alone would over-claim");
});

test("#472: a caller with NO craft section keeps every credited point in its stat list", () => {
  // The safe direction, and the reason `craftStated` is computed rather than
  // chosen. If the flag were a preference a caller could set it while rendering
  // no Craft section, and a credited point would render nowhere at all — the
  // invisible gap the residual sweep exists to make impossible.
  const v = { variant_id: "Legacy" };
  const ctx = { result: { chosen: [] },
    attr: { Seeker: [{ hostIds: ["Legacy"], value: 15, bonus_type: "Enhancement", sourceKind: "vik" }] },
    targets: ["Seeker"] };
  const html = R.equippedBody(v, -1, null, null, false, false, ctx);
  assert.ok(hasLine(html, "is-tracked", "Seeker \\+15"),
    "with no craft rows to state it, the point stays in the stat list");
});

test("#498: each open augment colour gets its own row, and nothing aggregates them", () => {
  // #472 split this fact in two: a note that counted the open slots, and a row
  // per colour that named them. #498 deleted the surface the note lived on, so
  // the rows are now the whole statement — and there must be no second, vaguer
  // copy of it anywhere on the card.
  const v = { variant_id: "Host", affixes: [] };
  const res = { chosen: [{ slot: "Ring", variant: v }], augmentsPlaced: [], setsActive: [], breakdown: {} };
  const maps = ddMaps({ freeByIndex: new Map([[0, ["Blue", "Colorless"]]]) });
  const html = itemBody(res, { targets: [] }, maps);
  assert.ok(/aug-open aug-blue/.test(html) && /aug-open aug-colorless/.test(html),
    "a row per open colour, each named");
  assert.ok(!/open augment slot/.test(html),
    "and no aggregate count restating them in prose");
});

// ---------------------------------------------------------------------------
// #475 — the Alternatives tab was the last surface still speaking the chip
// idiom: `alt-tag` pills for the trade's axis, a green headline, a comma-run
// cost line. It now takes the card system #471 built, plus the one thing its
// subject earns — an alternative is a TRADE, so its body is Gains and Costs.
// ---------------------------------------------------------------------------

function altFixture(over) {
  return Object.assign({
    tags: ["set bonus"], gainText: "activates Alpha", costText: "-4 Doublestrike",
    activatedSets: [], gains: [], cost: [{ stat: "Doublestrike", delta: -4 }], shedEffects: [],
  }, over || {});
}

test("#475: the trade's axis is the card's head label, not a row of pills", () => {
  const html = R.renderAltCards([altFixture({ tags: ["rebalance", "cheaper crafting"] })]);
  assert.ok(!/alt-tag/.test(html), "the pill family is gone");
  assert.ok(/<div class="alt-axis">rebalance<span class="sep">·<\/span>cheaper crafting<\/div>/.test(html),
    "both axes read as one small-caps label, the way a gear card labels its slot");
  assert.ok(/<div class="alt-headline">activates Alpha<\/div>/.test(html),
    "and the gain text is the headline beneath it");
});

test("#475: gains and costs are rows, and a cost points down", () => {
  const html = R.renderAltCards([altFixture({
    gains: [{ stat: "Melee Power", delta: 18 }],
    cost: [{ stat: "Armor Class", delta: -11 }],
    shedEffects: ["Blunt Trauma"],
  })]);
  assert.ok(/pd-slabel">Gains</.test(html) && /pd-slabel">Costs</.test(html), "two labelled sections");
  assert.ok(/<li class="pd-line is-gain"><span class="pd-ln-mark"[^>]*>▲<\/span><span class="pd-ln-where">stat<\/span><span class="pd-ln-what">Melee Power \+18</.test(html),
    "a gain is an up row");
  assert.ok(/<li class="pd-line is-cost"><span class="pd-ln-mark"[^>]*>▼<\/span><span class="pd-ln-where">stat<\/span><span class="pd-ln-what">Armor Class -11</.test(html),
    "a cost is a down row — the direction is a GLYPH, so it survives monochrome");
  // #348 — a shed effect is NAMED, never counted. One row each, not a comma-run.
  assert.ok(/<span class="pd-ln-where">utility<\/span><span class="pd-ln-what">gives up Blunt Trauma</.test(html),
    "and a shed utility effect is named on a row of its own");
});

test("#475: a set is expanded to the affixes it grants, as set rows", () => {
  // U7's guarantee, carried into the row language: an alternative that says only
  // "activates Alpha" makes the player go and look up what Alpha does.
  const sol = { setsActive: [{ set: "Alpha", pieces_required: 2 }], chosen: [
    { slot: "Necklace", variant: { variant_id: "N", set_bonus: [{ set: "Alpha" }],
      parsed_set_bonuses: [{ set: "Alpha", pieces_required: 2, affixes: [
        { stat: "Melee Power", bonus_type: "Artifact", name: "Melee Power", type: "Artifact", value: 15, unit: "flat" },
      ], flagged: [] }] } },
    { slot: "Ring", variant: { variant_id: "R", set_bonus: [{ set: "Alpha" }], parsed_set_bonuses: [] } },
  ], effective: {} };
  const html = R.renderAltCards([altFixture({ activatedSets: ["Alpha"], sol })]);
  assert.ok(/<span class="pd-ln-where">2 pieces<\/span><span class="pd-ln-what">Melee Power \+15 Artifact</.test(html),
    "the set's granted affix is a row attributed to its piece cost (#240)");
});

test("#475: a costless candidate states it in the foot, with no empty Costs section", () => {
  const html = R.renderAltCards([altFixture({
    tags: ["free upgrade"], gainText: "free +Dodge", costText: "no priority cost",
    cost: [], shedEffects: [],
  })]);
  assert.ok(!/pd-slabel">Costs</.test(html), "no Costs section when there is nothing to put in it");
  assert.ok(/<div class="pd-note is-free">/.test(html), "the claim rides the shared foot-note family");
  assert.ok(/No priority cost/.test(html), "…and says so");
});

test("#475: the rows come from the structured fields, never from re-parsing costText", () => {
  // The precision that matters. Re-splitting a rendered sentence back into data
  // is how two surfaces come to disagree about a number; here the joined string
  // is deliberately WRONG and the rows must follow the structure instead.
  const html = R.renderAltCards([altFixture({
    costText: "-999 Nonsense", cost: [{ stat: "Accuracy", delta: -2 }],
  })]);
  assert.ok(/Accuracy -2/.test(html), "the row reads the structured cost");
  assert.ok(!/Nonsense/.test(html), "and the joined string is not rendered at all");
});

test("#475: the listbox interaction is untouched — regression guard", () => {
  // Deliberately NOT proven red. This was a restyle of the card's CONTENTS; the
  // selection model is what loads an alternative into every shared surface, and
  // breaking it would be the expensive failure here.
  const html = R.renderAltCards([altFixture(), altFixture({ tags: ["rebalance"] })]);
  assert.ok(/role="listbox"/.test(html), "still a listbox");
  assert.strictEqual((html.match(/role="option"/g) || []).length, 2, "one option per candidate");
  assert.ok(/tabindex="0"/.test(html) && /tabindex="-1"/.test(html), "roving tabindex preserved");
  assert.strictEqual((html.match(/aria-selected="false"/g) || []).length, 2, "single-select state preserved");
  assert.ok(/data-idx="0"/.test(html) && /data-idx="1"/.test(html), "and the index the click handler reads");
});
// ---------------------------------------------------------------------------
// #476 — coverage moved off `whyThisLine` before it is deleted.
//
// That renderer had no call sites; it was kept alive by its own tests. Deleting
// it is only safe once each behaviour those tests encode is asserted on a
// surface that actually renders. These four are the ones that were NOT already
// covered live — the rest (presence, cross-add, the rank-1 accent, the absent
// at-ceiling marker, contribution ordering) already had live or projection-level
// guards, which is recorded in the PR rather than duplicated here.
//
// These are BACKFILL, not new behaviour: they pass on the pre-change tree by
// design, because the behaviour they cover already ships. What would have made
// them fail is the deletion happening without them.
// ---------------------------------------------------------------------------

test("#476/#227: an untyped contribution names its bucket, never the literal null", () => {
  // The one genuine gap. `whyThisLine` asserted this and nothing else did — the
  // live surface that states a bonus type per contribution is the Ranked
  // Priorities attribution list, and its untyped branch was untested.
  //
  // #227's ruling is that untyped is a REAL bucket, not missing data: it
  // collides with nothing, so it always adds on top of every typed bonus to the
  // same stat. Printing a raw null was the reported defect; going silent would
  // be a quieter version of the same thing.
  const html = R.attributionList([{ bonus_type: null, value: 5, source: "R",
    sourceKind: "worn", slots: ["Ring"], hostIds: ["R"], isSet: false }]);
  assert.ok(/untyped/.test(html), "names the bucket");
  assert.ok(!/null/.test(html), "and the raw value never reaches the surface");
  const empty = R.attributionList([{ bonus_type: "", value: 5, source: "R",
    sourceKind: "worn", slots: ["Ring"], hostIds: ["R"], isSet: false }]);
  assert.ok(/untyped/.test(empty), "an empty string is the same bucket as a null");
});

test("#476/#245: the craft-carried note names the stat, the value and the family", () => {
  // `whyThisNote` renders this on the live card, but only its CLASS was asserted
  // there. #245's point is the content: a Viktranium slot reaches 126 stats and
  // can win a whole slot on one crafted point, so the note has to say which.
  const res = { chosen: [{ slot: "Ring", variant: { variant_id: "R" } }],
    breakdown: { Constitution: [{ bonus_type: "Insight", value: 1,
      source: "Slot Melancholic Viktranium augment", sourceKind: "vik", slot: "Ring", hostIds: ["R"] }] } };
  const html = R.equippedRow("Ring", { variant: { variant_id: "R", affixes: [] }, idx: 0 }, {},
    new Set(), null, null, null, null,
    { result: res, attr: R.attributionByTarget(res), targets: ["Constitution"] });
  assert.ok(/pd-carried/.test(html), "renders the caution variant, not a win");
  assert.ok(/Here only for its crafts/.test(html), "says the pick depends on crafting");
  assert.ok(/Constitution \+1/.test(html) && /Viktranium/.test(html),
    "and names the crafted stat, its value, and the family that yields it");
});

test("#476: a pick that wins no ranked target reads as filler, in its own markup", () => {
  const res = { chosen: [{ slot: "Boots", variant: { variant_id: "ZZ" } }],
    breakdown: { Constitution: [{ bonus_type: "Enhancement", value: 15, source: "R",
      sourceKind: "worn", slot: "Ring", hostIds: ["R"] }] } };
  const html = R.equippedRow("Boots", { variant: { variant_id: "ZZ", affixes: [] }, idx: 0 }, {},
    new Set(), null, null, null, null,
    { result: res, attr: R.attributionByTarget(res), targets: ["Constitution"] });
  assert.ok(/included to complete the loadout/.test(html), "a pick winning no target says so");
  assert.ok(/class="pd-note pd-why muted"/.test(html), "in the shared foot-note family");
});

test("#476/#88: the override disclosure survives the whole chain, not just a hand-built context", () => {
  // Ported from projection.test.js, which drove this through `whyThisLine`. The
  // existing live test builds its attribution by hand; this one starts from a
  // solver-shaped breakdown and goes through `attributionByTarget` →
  // `itemContributions` → the card, which is the chain that actually has to hold.
  const ovr = {
    breakdown: { Constitution: [
      { bonus_type: "Insight", value: 6, source: "Necklace of X", sourceKind: "worn",
        slot: "Necklace", hostIds: ["Necklace of X"], via: null, crossAdd: null,
        overriddenFrom: "Enhancement" },
      { bonus_type: "Enhancement", value: 10, source: "Ring of Y", sourceKind: "worn",
        slot: "Ring", hostIds: ["Ring of Y"], via: null, crossAdd: null, overriddenFrom: null },
    ] },
    chosen: [], augmentsPlaced: [], setsActive: [],
  };
  const attr = R.attributionByTarget(ovr);
  const ctx = { result: ovr, attr, targets: ["Constitution"] };
  const html = R.equippedBody({ variant_id: "Necklace of X" }, -1, null, null, false, false, ctx);
  assert.ok(/Constitution \+6/.test(html), "the value the player asserted");
  assert.ok(/your call — catalog says Enhancement/.test(html),
    "beside the type the catalog records — a gear box must never state a bonus type as though the wiki said so");
  const plain = R.equippedBody({ variant_id: "Ring of Y" }, -1, null, null, false, false, ctx);
  assert.ok(!/catalog says/.test(plain), "an unoverridden item's card is unchanged");
});

// ---------------------------------------------------------------------------
// #499 — the upgrades notice, which replaced the Alternatives tab. The bar
// itself is tested in tests/alternatives.test.js; these cover the surface.
// ---------------------------------------------------------------------------

test("#499: no solver, no offer — the card withholds rather than showing a dead button", () => {
  // A restored character renders with `highs: null` and no program. The same
  // rule the outbid pricing and concession probe follow (#345, #481): a control
  // that cannot work is not offered and then failed, it is not offered.
  assert.strictEqual(R.upgradeNotice(false, 0), "", "no capability -> no card at all");
  assert.ok(R.upgradeNotice(true, 0), "with the capability, the card renders");
});

test("#499: the bar's current setting is what the select shows", () => {
  // The bar outlives the panel — renderResults destroys and rebuilds it on every
  // solve, load and per-slot constraint change — so the value must be stamped in
  // at render time. A select that always reopened at 0 would silently discard
  // the player's choice and then quietly withhold the trades they asked to see.
  const free = R.upgradeNotice(true, 0);
  assert.ok(/<option value="0" selected>/.test(free), "free-only is selected at the default");
  const wide = R.upgradeNotice(true, 5);
  assert.ok(/<option value="5" selected>/.test(wide), "…and a raised bar comes back raised");
  assert.strictEqual((wide.match(/selected/g) || []).length, 1, "exactly one option is selected");
});

test("#499: the card offers the search rather than claiming a finding", () => {
  const html = R.upgradeNotice(true, 0);
  assert.ok(/upgrade-run/.test(html) && /Find upgrades/.test(html), "it carries its own control");
  assert.strictEqual(R.NOTICE_TABLE.upgradeNotice.cls, "informational",
    "an un-run search has found nothing yet, so it must not inflate the needs-attention pill");
  assert.strictEqual(R.NOTICE_TABLE.upgradeNotice.jump, null,
    "and it needs no jump — the control that resolves it is in the card");
});

test("#499: the result tabs no longer offer Alternatives or a Deep Dive", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  const tablist = srcBetween(src, '<div class="result-tabs"', "</div>", "result tabs");
  const labels = [...tablist.matchAll(/type="button">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(labels, ["Loadout", "Ranked Priorities", "Set Bonuses", "Adjustment Studio", "Farming List", "Share"],
    "the two retired tabs are gone, their replacements sit in their place, and Share stays last");
});

test("#499: the bar filters BEFORE the ranking, not after", () => {
  // `rankAlternatives` caps at five. Filtering after it would let five rejected
  // candidates crowd out a free upgrade sitting sixth, and the card would report
  // "no free upgrade found" against a list that had one — a false negative that
  // looks exactly like a true one. Source-text, because the ordering is not
  // observable from either function's output alone.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  const body = srcBetween(src, "function runUpgrades()", "// The card's two controls", "runUpgrades");
  const filterAt = body.indexOf("filterUpgrades(");
  const rankAt = body.indexOf("rankAlternatives(");
  assert.ok(filterAt >= 0 && rankAt >= 0, "both steps are present");
  assert.ok(filterAt < rankAt, "the bar decides eligibility, then the ranking orders what is left");
});

// ---------------------------------------------------------------------------
// Code-review fixes: the three defects found in the #498-#501 branch. All three
// are wiring, not rendering, so they are asserted against the source of
// `renderResults` — there is no DOM here to drive.
// ---------------------------------------------------------------------------

function _resultsSrc() {
  return require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
}

test("review fix 1: every per-build panel reads the ACTIVE build, not the optimum", () => {
  // The defect: `renderBuild` refreshed the paperdoll, weapons, ranked cards and
  // set panel; the Farming List and Versions tabs were filled once from the
  // optimum and never again. Clicking an upgrade card left a player looking at
  // one build's paperdoll and a DIFFERENT build's farming list — and the farming
  // list is the surface that sends them out of the app for an evening.
  const src = _resultsSrc();
  const body = srcBetween(src, "function renderBuild(build) {", "function setActive(", "renderBuild");
  assert.ok(/activeBuild = build/.test(body),
    "renderBuild records which build is now on screen");
  assert.ok(/fillFarmingPanel\(/.test(body), "…and refreshes the farming list for it");
  assert.ok(/renderVersionDiff\(/.test(body), "…and re-runs the comparison against it");

  const live = srcBetween(src, "function liveRecord() {", "function fillVersionsPanel(", "liveRecord");
  assert.ok(/snapshot: activeBuild/.test(live),
    "and the record both panels read is the ACTIVE build");
  assert.ok(!/snapshot: optimum/.test(live),
    "never the optimum — that is the bug, stated exactly");
});

test("review fix 1: the two panel inputs are declared before renderBuild runs", () => {
  // `renderBuild(optimum)` fires before the Versions and Farming wiring blocks.
  // With `verApi` and `farmCharacter` still declared down beside that wiring,
  // the first render reads two `const`s inside their temporal dead zone and
  // throws — and renderResults sits inside a try/catch whose catch replaces the
  // whole results box with "Solver error", so the failure would present as a
  // broken solver on a perfectly good solve.
  const src = _resultsSrc();
  const verAt = src.indexOf("const verApi = versions");
  const farmAt = src.indexOf("const farmCharacter = String(");
  const renderAt = src.indexOf("renderBuild(optimum);");
  assert.ok(verAt >= 0 && farmAt >= 0 && renderAt >= 0, "all three sites are present");
  assert.ok(verAt < renderAt, "verApi is initialized before the first renderBuild");
  assert.ok(farmAt < renderAt, "and so is farmCharacter");
});

test("review fix 2: the farming panel's wiring is not inside its fill function", () => {
  // `#rp-farmingpanel` is minted once by the container template and then only has
  // its innerHTML replaced, so it outlives every fill. Wiring inside the fill
  // stacked one listener per call: a tick on an unnamed build re-rendered with a
  // message and added a second handler, and the next tick ran both — each
  // flipping `box.checked`, so the box landed back where it started while two
  // more handlers were added.
  const src = _resultsSrc();
  const fill = srcBetween(src, "function fillFarmingPanel(note) {", "function printFarmingList(", "fillFarmingPanel");
  assert.ok(!/addEventListener/.test(fill),
    "the fill function only replaces content — it binds nothing");
  assert.ok(/farmHost\.addEventListener\("change"/.test(src),
    "the tick handler is delegated on the long-lived host instead");
  assert.ok(/farmHost\.addEventListener\("click"/.test(src),
    "…and so are Copy and Print, which are rebuilt with the content");
});

test("review fix 2: Copy recomputes the plan rather than capturing it", () => {
  // The panel is now rebuilt on every build swap. A handler closing over the plan
  // it was wired with would copy the previous build's farming list.
  const src = _resultsSrc();
  const click = srcBetween(src, 'farmHost.addEventListener("click"', "wireResultTabs(", "farm click handler");
  assert.ok(/const plan = currentPlan\(\)/.test(click),
    "the plan is read at click time, not captured at wiring time");
});

test("review fix 3: the farming print rules are scoped to a body class", () => {
  // Unscoped, they applied to every print the page performed: a plain Ctrl+P
  // returned the farming list instead of the page, or a blank sheet when Farming
  // was not the active tab. The Share tab's print has always been scoped this
  // way (`body.printing`); this follows it.
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "styles.css"), "utf8");
  const block = srcBetween(css, "body.farming-printing > *:not(main)", "\n}", "farming print block");
  assert.ok(block.length > 0, "the block exists");
  // Every declaration inside it must carry the scope, or that one leaks to all prints.
  for (const line of block.split("\n")) {
    if (!/[{;]/.test(line) || /^\s*\/?\*/.test(line) || /^\s*$/.test(line)) continue;
    if (!/display|grid-template|break-inside/.test(line)) continue;
    assert.ok(/body\.farming-printing/.test(line) || !/^\s*[.#a-z]/.test(line),
      `unscoped print rule leaks to every print: ${line.trim()}`);
  }
  assert.ok(/body\.farming-printing #wz-printarea \{ display: none/.test(css),
    "the Share tab's print container is suppressed — it is never removed from the DOM "
    + "and its own ID rule forces it visible on any print");
  assert.ok(/body\.farming-printing #rp-farming \{ display: block/.test(css),
    "and the panel is un-hidden, since `hidden` is on it whenever another tab is active");
});

test("review fix 3: the print button sets and clears the scope class", () => {
  const src = _resultsSrc();
  const fn = srcBetween(src, "function printFarmingList() {", "function farmNote(", "printFarmingList");
  assert.ok(/classList\.add\("farming-printing"\)/.test(fn), "the scope is set before printing");
  assert.ok(/classList\.remove\("farming-printing"\)/.test(fn), "…and removed again");
  assert.ok(/afterprint/.test(fn), "on afterprint, the same seam printLoadout uses");
});

test("#500: a slot row's label is a fixed caption, never the version's own name", () => {
  // The reported defect. A version name — "Melee Power, Doublestrike +6 more ·
  // 2026-08-24 14:28" — was used as the per-row label on EVERY changed slot.
  // Measured on a real solve it was 321px against a ~350px column with
  // `flex: none`, so it took the whole row and left the item name 19px to wrap
  // in: "Epic Crisis Plate" rendered 19px wide and 122px tall, one character per
  // line, reading as though the name had been turned on its side.
  //
  // The rule this pins: a label may never be longer than the value it labels, so
  // the row captions are fixed strings and the two builds are named once in a
  // legend above the list.
  const V = require("../web/versions.js");
  const mk = (id, ring) => ({ id, name: id, kind: "auto", query: { targets: [] },
    inputs: { priorities: [] },
    snapshot: { status: "optimal", chosen: [{ slot: "Ring", variant: { variant_id: ring, minimum_level: 30, affixes: [], set_bonus: [] } }],
      effective: {}, perTarget: {}, breakdown: {}, setsActive: [], augmentsPlaced: [] } });
  const diff = V.diffVersions(mk("a", "Short"), mk("b", "Other"));
  const LONG = "Melee Power, Doublestrike +6 more · 2026-08-24 14:28";
  const html = R.versionDiffView(diff, { a: "This build", b: LONG });

  // The long name appears — but only in the legend and the row's title tooltip,
  // never as the label text that has to share a row with the item.
  const rowLabels = [...html.matchAll(/<span class="ver-side-label">([^<]*)</g)].map((m) => m[1]);
  assert.ok(rowLabels.length >= 2, "the row renders both sides");
  for (const l of rowLabels) {
    assert.ok(!l.includes("2026-08-24"), `a version name leaked into a row label: ${l}`);
    assert.ok(l.length <= 20, `row label is too long to sit beside a value: ${l}`);
  }
  assert.ok(/class="ver-legend"/.test(html), "the two builds are named in a legend instead");
  assert.ok(html.includes(LONG), "…and the full name is still stated there");
});

test("#500: the slot row's two tracks cannot starve each other", () => {
  // The flex version had `flex: none` on the label, which is what let it consume
  // the row. Both grid tracks are now `minmax(0, …)`: the label is capped so it
  // cannot grow into the value, and the value cannot be squeezed below its own
  // content box. Asserted in CSS because the failure is a layout property, not
  // markup — the markup was never the problem.
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "styles.css"), "utf8");
  const rule = srcBetween(css, ".ver-side { display: grid", "}", ".ver-side rule");
  assert.ok(/grid-template-columns:\s*minmax\(0,\s*[\d.]+rem\)\s+minmax\(0,\s*1fr\)/.test(rule),
    "a capped label track and a flexible value track, both floored at 0");
  assert.ok(!/flex:\s*none/.test(rule), "the flex-none label that caused this is gone");
  const item = srcBetween(css, ".ver-side-item {", "}", ".ver-side-item rule");
  assert.ok(!/overflow-wrap:\s*anywhere/.test(item),
    "`anywhere` breaks at every opportunity, which is what made a squeezed cell "
    + "render one character per line; `break-word` only breaks what cannot fit");
});

test("#500: the Studio opens on the last change, and never on the build it is showing", () => {
  // `autoSnapshot` runs on the solve path, BEFORE the results render, so the
  // newest stored version IS the build on screen. Defaulting to it would greet
  // every single solve with "these two builds are identical" — technically true
  // and completely useless, and it would make the tab's name a lie.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  const fill = srcBetween(src, "function fillVersionsPanel(note) {", "const save = host.querySelector", "fillVersionsPanel");
  assert.ok(/verApi\.defaultCompare/.test(fill),
    "the panel asks the caller which record to open on");
  assert.ok(/renderVersionDiff\(false\)/.test(fill),
    "…and renders that comparison immediately rather than waiting for a pick");

  // The caller is the only place that knows which snapshot belongs to the build
  // already on screen, which is why the choice lives there and not here.
  const wiz = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "wizard.js"), "utf8");
  const fn = srcBetween(wiz, "function defaultCompareId() {", "\n    }", "defaultCompareId");
  assert.ok(/currentAutoId/.test(fn), "the current build's own snapshot is identified");
  assert.ok(/!==/.test(fn), "…and excluded from the default");
  assert.ok(/if \(res\.ok\) currentAutoId = res\.id;/.test(wiz),
    "and it is recorded when the auto-snapshot actually lands, not assumed");
});

test("#500: the tab is renamed but the store it reads is not", () => {
  // A deliberate split, asserted so it does not read as drift to the next person:
  // the SURFACE is the Adjustment Studio, the STORE is still versions, because
  // what it holds really is point-in-time versions and the Studio is one reading
  // of them. Renaming the store to match would claim the two are the same thing.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  assert.ok(/>Adjustment Studio</.test(src), "the tab reads Adjustment Studio");
  assert.ok(/id="rt-versions"/.test(src), "the internal id still names the store");
  assert.ok(typeof R.versionsPanel === "function", "and so does the renderer");
  const V = require("../web/versions.js");
  assert.strictEqual(V.STORE_KEY, "ddo.versions.v1",
    "the storage key is untouched — a rename here would orphan every saved snapshot");
});

// ---- #532: a solver limit is not a build problem -----------------------------

test("#532: the non-optimal panel tells the player which kind of failure this is", () => {
  // The two cases need opposite advice. Collapsing them sent a player to loosen
  // an ML cap over a solver limit, which no amount of loosening reaches.
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  assert.ok(/result\.failure === "solver" \|\| result\.failure === "unrepresentable"/.test(src),
    "the panel branches on the solver's own failure kind");
  assert.ok(/The solver could not complete this search/.test(src),
    "the solver case says the search did not finish");
  assert.ok(/loosening priorities or filters will not change it/.test(src),
    "…and says plainly that the usual remedy does not apply here");
  assert.ok(/No set satisfies these constraints/.test(src),
    "the genuine-infeasible case keeps its original sentence");
  // An older stored snapshot carries no `failure`, and must keep reading as the
  // constraints case — that is what this panel always said before.
  const constraintsIdx = src.indexOf("No set satisfies these constraints");
  const solverIdx = src.indexOf("The solver could not complete this search");
  assert.ok(solverIdx > 0 && constraintsIdx > solverIdx,
    "the constraints sentence is the fall-through branch, not the guarded one");
});

// ---------------------------------------------------------------------------
// #554 — the set-pin price control. The pin says the requirement was kept; this
// says what it cost. Offered on request, because a pinned solve is already the
// slow arm and pricing must never ride it.

test("#554: the price control is offered only when a pin actually landed", () => {
  const withPin = { setPinReport: [{ set: "Cruel Cut", verdict: "pinned" }] };
  assert.ok(/setpin-probe/.test(R.setPinNotice(withPin, { canPrice: true })),
    "a delivered pin can be priced");
  assert.ok(!/setpin-probe/.test(R.setPinNotice(withPin, { canPrice: false })),
    "no solver, no control — never a button that cannot work");

  // Nothing landed: suppressed pins have no cost to report, because they were
  // never applied.
  const suppressed = { setPinReport: [{ set: "Cruel Cut", verdict: "not-owned" }] };
  assert.ok(!/setpin-probe/.test(R.setPinNotice(suppressed, { canPrice: true })),
    "a suppressed pin changed nothing, so there is nothing to price");
  const conflict = { setPinReport: [{ set: "A", verdict: "conflict" }] };
  assert.ok(!/setpin-probe/.test(R.setPinNotice(conflict, { canPrice: true })));
});

test("#554: the control pluralises, and the notice still renders without it", () => {
  const one = R.setPinNotice({ setPinReport: [{ set: "A", verdict: "pinned" }] }, { canPrice: true });
  assert.ok(/What did this set cost\?/.test(one), one);
  const two = R.setPinNotice({ setPinReport: [
    { set: "A", verdict: "pinned" }, { set: "B", verdict: "pinned" }] }, { canPrice: true });
  assert.ok(/What did these sets cost\?/.test(two), two);

  // The sentences survive with the control absent — the notice is honest without
  // the price, which is why #539 could ship before #554.
  const bare = R.setPinNotice({ setPinReport: [{ set: "A", verdict: "pinned" }] }, {});
  assert.ok(/delivered it: A/.test(bare));
  assert.ok(!/button/.test(bare));
});

test("#554: no pins at all renders nothing, control or otherwise", () => {
  assert.strictEqual(R.setPinNotice({}, { canPrice: true }), "");
  assert.strictEqual(R.setPinNotice({ setPinReport: [] }, { canPrice: true }), "");
});

// --- #482: the concession probe's three terminal states ----------------------
//
// #481 shipped three outcomes and only one of them — the priced branch — was ever
// exercised, by a single live browser pass. The two non-priced ones are exactly
// the pair R5 says must not blur: "no concession changes anything" means the trade
// does not exist, "the probe did not run" means we did not look. A player told the
// first when the second happened has been told a false fact about their build.
//
// This suite is deliberately DOM-free, so the decision was extracted out of the
// DOM writer rather than a DOM harness being introduced (#448's shape).

test("#482: a null probe result says nothing changes, and names the window", () => {
  const o = R.concessionOutcome("Dodge", null, 40);
  assert.strictEqual(o.kind, "none");
  assert.ok(/^No concession of up to \d+ Dodge changes anything ranked beneath it\.$/.test(o.text), o.text);
  assert.ok(o.live && o.live !== o.text,
    "the live region gets its own shorter sentence, not the visible one");
});

test("#482: the window is clamped to the stat's own value", () => {
  // A stat sitting at 2 cannot give up 3, and offering to is nonsense the player
  // would have to decode. `Math.min(window, value)` is the clamp.
  assert.strictEqual(R.concessionOutcome("Dodge", null, 2).window, 2);
  assert.strictEqual(R.concessionOutcome("Dodge", null, 0).window, 0);
  assert.ok(R.concessionOutcome("Dodge", null, 100).window > 3, "and it scales up with the stat");
});

test("#482: a priced concession states the gain AND the price in one sentence", () => {
  // Per `lexicographic-descent-bounds-the-vector-not-each-stat.md` the priority
  // after the one that rises can genuinely fall. A sentence naming only the gain
  // would advertise a trade while hiding what it costs.
  const o = R.concessionOutcome("Dodge", {
    concession: 5, cap: 35,
    deltas: [{ stat: "Dodge", delta: -5 }, { stat: "PRR", delta: 12 }, { stat: "MRR", delta: -3 }],
  }, 40);
  assert.strictEqual(o.kind, "priced");
  assert.ok(o.text.includes("Giving up 5 Dodge"), o.text);
  assert.ok(o.text.includes("+12 PRR"), "the gain");
  assert.ok(/costs .?3 MRR/.test(o.text), `the price: ${o.text}`);
  assert.ok(o.text.includes("Set Max 35 on Dodge"), "and how to take it");
  assert.ok(!/-5 Dodge/.test(o.text.replace("Giving up 5 Dodge", "")),
    "the conceded stat is not also listed as a loss — it is the thing being given up");
});

test("#482: a concession with no losses does not invent a price", () => {
  const o = R.concessionOutcome("Dodge", {
    concession: 3, cap: 37, deltas: [{ stat: "Dodge", delta: -3 }, { stat: "PRR", delta: 8 }],
  }, 40);
  assert.ok(!/costs/.test(o.text), `a free trade must not read as costing something: ${o.text}`);
});

test("#482: the three terminal wordings are mutually distinct", () => {
  // R5 in one assertion. If two of these ever collapse into the same sentence, a
  // player cannot tell "there is no trade" from "we failed to look for one".
  const none = R.concessionOutcome("Dodge", null, 40).text;
  const failed = R.concessionFailedOutcome("Dodge").text;
  const priced = R.concessionOutcome("Dodge", {
    concession: 5, cap: 35, deltas: [{ stat: "Dodge", delta: -5 }, { stat: "PRR", delta: 12 }],
  }, 40).text;
  const all = [none, failed, priced];
  assert.strictEqual(new Set(all).size, 3, all);
  // and each names the stat, so a player with several probes open can tell them apart
  for (const t of all) assert.ok(t.includes("Dodge"), t);
  assert.ok(/did not run/.test(failed), "the failure says we did not look");
  assert.ok(!/did not run/.test(none), "and the empty result does NOT claim that");
});

test("#482: the failure state carries no live-region announcement", () => {
  // The other two speak to the screen reader. A thrown probe is not a result about
  // the build, so it does not get announced as one.
  assert.strictEqual(R.concessionFailedOutcome("Dodge").live, null);
});

// --- #482: renderAltPanel across the three altState shapes --------------------

test("#482: a probed candidate shows when the full analysis NEVER RAN (list null)", () => {
  // The Definition of Done's reason: a control that works only after the
  // Alternatives tab has been opened is worse than no control — and #499 retired
  // that tab, so nothing opens it any more. This is the shape that was verified
  // live; it is pinned here so the other two have a stated baseline.
  assert.deepStrictEqual(R.upgradesList([{ key: "probed" }], null).map((c) => c.key), ["probed"]);
});

test("#482: a probed candidate shows when the analysis RAN AND FOUND NOTHING (list [])", () => {
  // Same answer as `null`, different reason — and this shape had never been
  // verified at all. An empty analysis must not swallow the answer the player
  // asked for by name.
  assert.deepStrictEqual(R.upgradesList([{ key: "probed" }], []).map((c) => c.key), ["probed"]);
});

test("#482: probed candidates LEAD a populated list", () => {
  // The player named this trade and asked what it costs; the rest are volunteered.
  // Order is the whole difference between answering and suggesting.
  const out = R.upgradesList([{ key: "probed" }], [{ key: "found-a" }, { key: "found-b" }]);
  assert.deepStrictEqual(out.map((c) => c.key), ["probed", "found-a", "found-b"]);
});

test("#482: with nothing probed and nothing found, the card has nothing to show", () => {
  // `renderUpgrades` returns false on an empty list rather than painting an empty
  // shell, so the empty case must actually be empty.
  assert.deepStrictEqual(R.upgradesList([], null), []);
  assert.deepStrictEqual(R.upgradesList(null, null), []);
});

test("#482: the DOM writers CONSUME the extracted decisions rather than restating them", () => {
  // An extraction only helps while the writer actually calls it. If `showConcession`
  // kept its own copy of the wording, these tests would pass forever against a
  // function nothing renders — which is the failure mode this whole session has
  // been about: a check that cannot fail.
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "web", "results.js"), "utf-8");

  const show = srcFrom(src, "function showConcession(btn, stat, res) {", 700, "showConcession");
  assert.ok(/concessionOutcome\(/.test(show), "showConcession asks for the outcome");
  assert.ok(!/No concession of up to/.test(show),
    "and does not carry its own copy of the empty-result sentence");

  const handler = srcFrom(src, 'q("#rp-cards").addEventListener("click"', 1400, "probe handler");
  assert.ok(/concessionFailedOutcome\(/.test(handler), "the catch asks for the failure wording");
  assert.ok(!/the probe did not run`/.test(handler),
    "and does not carry its own copy of it");

  const render = srcFrom(src, "function renderUpgrades() {", 300, "renderUpgrades");
  assert.ok(/upgradesList\(/.test(render), "the upgrades card composes through the pure function");
  assert.ok(!/\.\.\.altState\.probed, \.\.\.\(altState\.list/.test(render),
    "and does not re-inline the spread it replaced");
});

// --- #240: a set's PIECE COST is on the alternative card ---------------------
//
// The case: two sets grant the identical bonus on every ranked stat and differ
// only in how many pieces they need. The solver correctly takes the cheaper one —
// same value, one fewer slot — and that needs no solver change. What was missing
// is that a player looking at the pricier alternative had no way to see why it was
// passed over, or to judge whether the freed slot matters to them for reasons the
// ranking does not capture.
//
// Measured before building: the existing machinery ALREADY generates and shows
// ties. Ranking `Kinetic Lore` at ML 34, `generateAlternatives` returns candidates
// with `gains: 0, cost: 0` at the identical ranked value, `tradeVerdict` marks
// them `free`, and `filterUpgrades` keeps them. So no new gain family was needed —
// the issue's open scope question — and the whole gap was that the piece cost was
// never stated.

test("#240: a set gain row states how many pieces the set costs", () => {
  const sol = { setsActive: [{ set: "Cheap", pieces_required: 2 }], chosen: [
    { slot: "Necklace", variant: { variant_id: "N", set_bonus: [{ set: "Cheap" }],
      parsed_set_bonuses: [{ set: "Cheap", pieces_required: 2, affixes: [
        { stat: "Kinetic Lore", bonus_type: "Artifact", name: "Kinetic Lore", type: "Artifact", value: 6, unit: "flat" },
      ], flagged: [] }] } },
    { slot: "Ring", variant: { variant_id: "R", set_bonus: [{ set: "Cheap" }], parsed_set_bonuses: [] } },
  ], effective: {} };
  const html = R.renderAltCards([altFixture({ activatedSets: ["Cheap"], sol })]);
  assert.ok(/pd-ln-where">2 pieces</.test(html), html.slice(0, 400));
});

test("#240: the piece count is the SET's, so a costlier tie reads as costlier", () => {
  // The comparison the issue is about. Same granted affix, same value, different
  // slot commitment — and the card is now where that difference is legible.
  const mk = (name, pieces) => ({
    setsActive: [{ set: name, pieces_required: pieces }],
    chosen: [
      { slot: "Necklace", variant: { variant_id: "N", set_bonus: [{ set: name }],
        parsed_set_bonuses: [{ set: name, pieces_required: pieces, affixes: [
          { stat: "Kinetic Lore", bonus_type: "Artifact", name: "Kinetic Lore", type: "Artifact", value: 6, unit: "flat" },
        ], flagged: [] }] } },
      { slot: "Ring", variant: { variant_id: "R", set_bonus: [{ set: name }], parsed_set_bonuses: [] } },
    ],
    effective: {},
  });
  const cheap = R.renderAltCards([altFixture({ activatedSets: ["Cheap"], sol: mk("Cheap", 2) })]);
  const dear = R.renderAltCards([altFixture({ activatedSets: ["Dear"], sol: mk("Dear", 3) })]);
  assert.ok(/pd-ln-where">2 pieces</.test(cheap));
  assert.ok(/pd-ln-where">3 pieces</.test(dear));
  // Both grant the same thing — the ONLY difference a player can act on is the cost.
  assert.ok(/Kinetic Lore \+6 Artifact/.test(cheap) && /Kinetic Lore \+6 Artifact/.test(dear),
    "the tie is real: identical grant on both sides");
});

test("#240: a set with no recorded piece count falls back rather than printing junk", () => {
  // `pieces_required` is absent on some tiers. "undefined pieces" would be worse
  // than the word it replaced, so the old label survives as the fallback.
  const sol = { setsActive: [{ set: "Alpha" }], chosen: [
    { slot: "Necklace", variant: { variant_id: "N", set_bonus: [{ set: "Alpha" }],
      parsed_set_bonuses: [{ set: "Alpha", pieces_required: null, affixes: [
        { stat: "Dodge", bonus_type: "Artifact", name: "Dodge", type: "Artifact", value: 3, unit: "flat" },
      ], flagged: [] }] } },
  ], effective: {} };
  const html = R.renderAltCards([altFixture({ activatedSets: ["Alpha"], sol })]);
  assert.ok(!/undefined|null|NaN/.test(html), "no placeholder leaks into the row");
});
