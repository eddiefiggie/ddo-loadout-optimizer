// U5 browse-filter tests (node, zero-dependency). Run: node tests/browse.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { filterVariants, variantStats, affixText, dinoInsertRow, ncRow, vikRow, compendiumRow, browsableItems } = require("../web/browse.js");
const B = require("../web/browse.js");
const { normalizeDataset, normalizeItem, isNoiseAffix } = require("../web/dataset.js");
const data = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")
));
const items = data.items;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

test("filter by stat returns exactly items carrying that stat", () => {
  const stat = "Intelligence";
  const rows = filterVariants(items, { stat });
  assert.ok(rows.length > 0, "expected some Intelligence items");
  for (const v of rows) assert.ok(variantStats(v).includes(stat));
  // completeness: no Intelligence-bearing item was excluded
  const expected = items.filter((v) => variantStats(v).includes(stat)).length;
  assert.strictEqual(rows.length, expected);
});

test("U4: affixText renders a boolean feature as presence, not a magnitude", () => {
  const v = { affixes: [
    { stat: "Salt", bonus_type: "Bool", value: 1, unit: "flat" },
    { stat: "Intelligence", bonus_type: "Enhancement", value: 10, unit: "flat" },
  ] };
  const parts = affixText(v);
  assert.ok(parts.includes("✓ Salt"), "boolean rendered as presence marker");
  assert.ok(!parts.some((p) => /Salt \+/.test(p)), "no '+N' magnitude for the boolean");
  assert.ok(parts.some((p) => p.includes("Intelligence +10")), "real magnitude still shown");
});

test("U5: affixText / variantStats read NATIVE {name,type} affixes and item `ml`", () => {
  // A live item affix is native ({name,type}); the ML filter reads native `ml`.
  const v = { ml: 30, affixes: [
    { name: "Salt", type: "Bool", value: 1, unit: "flat" },
    { name: "Constitution", type: "Insightful", value: 7, unit: "flat" },
  ] };
  const parts = affixText(v);
  assert.ok(parts.includes("✓ Salt"), "native boolean rendered as presence");
  assert.ok(parts.some((p) => p.includes("Constitution +7 Insightful")), "native name+type render");
  assert.deepStrictEqual(variantStats(v).sort(), ["Constitution", "Salt"], "variantStats reads native names");
  // filter by native `ml` (item carries no legacy minimum_level)
  assert.strictEqual(filterVariants([v], { maxMl: 34 }).length, 1);
  assert.strictEqual(filterVariants([v], { maxMl: 20 }).length, 0);
});

test("ML filter returns only variants at or below the cap", () => {
  const rows = filterVariants(items, { maxMl: 10 });
  assert.ok(rows.length > 0);
  for (const v of rows) assert.ok(Number(v.ml) <= 10);   // U5: native item-level ML
});

test("verification filter returns only quarantined", () => {
  const rows = filterVariants(items, { verification: "quarantined" });
  assert.ok(rows.length > 0);
  for (const v of rows) assert.strictEqual(v.verification, "quarantined");
});

test("empty-match filter returns zero rows (drives empty state)", () => {
  const rows = filterVariants(items, { query: "zzz-no-such-item-xyz" });
  assert.strictEqual(rows.length, 0);
});

test("text query matches item name and affix stat", () => {
  const byName = filterVariants(items, { query: items[0].source_item.slice(0, 5) });
  assert.ok(byName.length > 0);
});

test("affixText renders typed and untyped affixes", () => {
  const withAffix = items.find((v) => (v.affixes || []).length > 0);
  const texts = affixText(withAffix);
  assert.ok(texts.length > 0);
  // #353 — this used to assert EVERY text matched /\+\d/, which was only true
  // because presence rendering was broken: real items carry `Bool` affixes, and
  // a presence affix must render `✓ Name` with NO magnitude. The old assertion
  // encoded the bug, so it went red the moment the bug was fixed. The contract
  // is per-affix: a magnitude affix carries +N, a presence affix carries ✓.
  assert.ok(texts.every((s) => /\+\d/.test(s) || /^✓ /.test(s) || /scales to/.test(s)),
    `every affix text is a magnitude, a presence tick, or a scaling note: ${texts.join(" | ")}`);
});

test("#353: on REAL data, a Bool-typed affix renders as a presence tick", () => {
  // The regression guard that the fixture-based tests could not be: it reads the
  // built dataset, where presence affixes are typed `Bool` (never `boolean`).
  const carrier = items.find((v) => (v.affixes || [])
    .some((a) => ((a.type != null ? a.type : a.bonus_type)) === "Bool"));
  assert.ok(carrier, "the dataset carries at least one Bool-typed affix");
  const texts = affixText(carrier);
  const boolNames = (carrier.affixes || [])
    .filter((a) => ((a.type != null ? a.type : a.bonus_type)) === "Bool")
    .map((a) => (a.name != null ? a.name : a.stat));
  for (const n of boolNames) {
    assert.ok(texts.includes(`✓ ${n}`),
      `${n} is Bool-typed and must render as "✓ ${n}", got: ${texts.join(" | ")}`);
    assert.ok(!texts.some((s) => new RegExp(`^${n} \\+`).test(s)),
      `${n} must not render a magnitude`);
  }
});

// ---- Dino content is browsable (insert pool + blank slots) ----

test("browsableItems appends the Dino insert pool as display rows", () => {
  const list = browsableItems(data);
  const inserts = list.filter((v) => v.dino_insert);
  assert.strictEqual(inserts.length, (data.dino_inserts || []).length);
  assert.ok(inserts.length >= 50, "expected the sourced insert pool");
  // browsable = real variants + every appended display pool (dino inserts,
  // NC options, and the indexed-only compendium index)
  const nc = (data.nearly_complete || []).length;
  const vik = (data.viktranium || []).length;
  const comp = (data.compendium || []).filter((x) => x.status === "indexed").length;
  assert.strictEqual(list.length, items.length + inserts.length + nc + vik + comp);
});

test("a Dino insert is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Constitution" });
  assert.ok(rows.some((v) => v.dino_insert && /^Dinosaur Bone augment \(Scale\b/.test(v.slot)),
    "the Scale Constitution insert should surface under the Constitution stat filter");
});

test("a Dino insert is findable by text search on its type", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { query: "claw" });
  assert.ok(rows.some((v) => v.dino_insert), "searching 'claw' surfaces Claw inserts");
});

test("dinoInsertRow carries a percentage unit for spell-crit inserts", () => {
  const row = dinoInsertRow({ dino_type: "Scale", stat: "Fire Spell Crit Damage",
    bonus_type: "Enhancement", value: 20, unit: "pct", wiki_url: "w" });
  assert.strictEqual(row.affixes[0].unit, "pct");
  assert.ok(affixText(row).some((t) => /\+20%/.test(t)), "renders +20% not +20");
});

test("a Dinosaur Bone blank shows its Isle of Dread slots instead of nothing", () => {
  const blank = items.find((v) => v.source === "dino_crafting_blank");
  assert.ok(blank, "expected a blank host in the dataset");
  const texts = affixText(blank);
  assert.ok(texts.some((t) => /Isle of Dread slots:/.test(t)),
    "blank should surface its typed Dino slots");
});

test("browsableItems appends the U81 Nearly-Complete option pool", () => {
  const list = browsableItems(data);
  const nc = list.filter((v) => v.nc_option);
  assert.strictEqual(nc.length, (data.nearly_complete || []).length);
  assert.ok(nc.length >= 60, "expected the sourced NC option pool");
});

test("a Nearly-Complete option is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Constitution" });
  assert.ok(rows.some((v) => v.nc_option), "Constitution NC craft options surface under the stat filter");
});

test("ncRow tags the tier's ML and renders its value", () => {
  const row = ncRow({ category: "Ability Score", stat: "Constitution", bonus_type: "Enhancement", value: 15, tier: "legendary", wiki_url: "w" });
  // U5: pseudo-rows now carry native item-level `ml` (was legacy `minimum_level`).
  assert.strictEqual(row.ml, 35);
  assert.ok(affixText(row).some((t) => /Constitution \+15/.test(t)));
});

test("browsableItems appends the U81 Viktranium option pool", () => {
  const list = browsableItems(data);
  const vik = list.filter((v) => v.vik_option);
  assert.strictEqual(vik.length, (data.viktranium || []).length);
  assert.ok(vik.length >= 100, "expected the sourced Viktranium option pool");
});

test("a Viktranium option is findable in the browser by stat", () => {
  const list = browsableItems(data);
  const rows = filterVariants(list, { stat: "Charisma" });
  assert.ok(rows.some((v) => v.vik_option), "Charisma Lamordia craft options surface under the stat filter");
});

test("vikRow tags the tier's ML, keys the pool, and renders its value (flat legacy record)", () => {
  // Back-compat: a stale cached dataset can still deliver the pre-atomicity
  // one-record-per-affix shape.
  const row = vikRow({ slot_type: "Melancholic", category: "Accessory", stat: "Charisma", bonus_type: "Enhancement", value: 15, tier: "legendary", wiki_url: "w" });
  // U5: pseudo-rows now carry native item-level `ml` (was legacy `minimum_level`).
  assert.strictEqual(row.ml, 34);
  assert.ok(/Melancholic/.test(row.slot) && /Accessory/.test(row.slot), "slot names the (type, category) pool");
  assert.ok(affixText(row).some((t) => /Charisma \+15/.test(t)));
});

test("ncRow renders an atomic option's FULL affix list, not just the first", () => {
  // #211: a Skill-menu craft grants six skills at once; one row per OPTION.
  const skills = ["Bluff", "Diplomacy", "Haggle", "Intimidate", "Perform", "Use Magic Device"];
  const row = ncRow({
    category: "Skill", tier: "legendary", wiki_url: "",
    affixes: skills.map((stat) => ({ stat, bonus_type: "Exceptional", value: 11, unit: "flat" })),
  });
  assert.strictEqual((row.affixes || []).length, 6, "every affix the option grants is on the row");
  const text = affixText(row);
  for (const s of skills) {
    assert.ok(text.some((t) => t.includes(s)), `${s} is rendered on the option row`);
  }
});

test("vikRow renders an atomic option's FULL affix list, not just the first", () => {
  // R1: crafting the universal spell-DC option grants all seven schools at once,
  // so the browse row must show all seven — one row per OPTION, not per affix.
  const schools = ["Abjuration", "Conjuration", "Enchantment", "Evocation",
    "Illusion", "Necromancy", "Transmutation"].map((s) => `${s} Focus`);
  const row = vikRow({
    slot_type: "Dolorous", category: "Armor", tier: "legendary", wiki_url: "w",
    name: "Dolorous Invigorator (legendary)",
    affixes: schools.map((stat) => ({ stat, bonus_type: "Profane", value: 1, unit: "flat" })),
  });
  assert.strictEqual((row.affixes || []).length, 7, "every affix the option grants is on the row");
  const text = affixText(row);
  for (const s of schools) {
    assert.ok(text.some((t) => t.includes(s)), `${s} is rendered on the option row`);
  }
  assert.ok(/Dolorous/.test(row.slot) && /Armor/.test(row.slot), "slot names the (type, category) pool");
  assert.ok(/Dolorous Invigorator/.test(row.variant_id), "the row is titled by the option, not one affix");
});

test("a multi-affix Viktranium option is findable by a NON-FIRST affix (real dataset)", () => {
  // Pick a real multi-affix option and search on its last affix — a row built
  // from only the first affix would hide the rest of the option's grant.
  const multi = (data.viktranium || []).find((o) => (o.affixes || []).length > 2);
  assert.ok(multi, "the real pool carries multi-affix options");
  const last = multi.affixes[multi.affixes.length - 1].stat;
  const rows = filterVariants(browsableItems(data), { stat: last });
  assert.ok(rows.some((v) => v.vik_option), `${last} surfaces from a multi-affix Viktranium option`);
});

test("browsableItems appends only indexed-only compendium rows (collapsed under single-source)", () => {
  // U6: the native roster is the single source of truth — every indexed item is
  // enriched (its own solver-active variant row), so the indexed-only layer has
  // collapsed to empty. browsableItems appends exactly the indexed-only entries,
  // which is now 0: nothing is browse-only-but-unparsed anymore.
  const list = browsableItems(data);
  const idx = list.filter((v) => v.compendium);
  const indexedOnly = (data.compendium || []).filter((x) => x.status === "indexed").length;
  assert.strictEqual(idx.length, indexedOnly, "indexed-only compendium rows are browsable");
  assert.strictEqual(indexedOnly, 0, "single-source completeness: no known-but-unparsed layer");
  // enriched entries are NOT re-listed here (they appear as real variant rows)
  assert.ok(!idx.some((v) => v.verification !== "indexed"));
});

test("compendiumRow renders an indexed, solver-excluded row with a wiki link", () => {
  const row = compendiumRow({ name: "Some Ring", slot: "Ring", wiki_url: "w", status: "indexed" });
  assert.strictEqual(row.verification, "indexed");
  assert.strictEqual(row.slot, "Ring");
  assert.deepStrictEqual(row.affixes, []);
  assert.ok(row.wiki_url);
});

test("indexed-only rows have collapsed under single-source completeness", () => {
  // U6: with every native item enriched, no browse row carries verification
  // "indexed" — the unparsed layer is gone. The status+slot filter still WORKS
  // (compendiumRow keeps rendering a synthetic indexed row, tested above); real
  // data simply has none.
  const list = browsableItems(data);
  const rows = filterVariants(list, { verification: "indexed", slot: "Ring" });
  assert.strictEqual(rows.length, 0, "no indexed-only Rings under single-source");
  // A synthetic indexed row still filters correctly (function-level guarantee).
  const synth = compendiumRow({ name: "Some Ring", slot: "Ring", wiki_url: "w", status: "indexed" });
  const filtered = filterVariants(list.concat(synth), { verification: "indexed", slot: "Ring" });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].verification, "indexed");
});

// --- gear-planner passthrough noise: bare-number / placeholder affixes ---
test("isNoiseAffix flags bare-number and placeholder names, spares real affixes", () => {
  for (const n of ["+14", "+1", "-5", "9", "40%"]) {
    assert.ok(isNoiseAffix({ name: n, type: "Bool", value: 1 }), `${n} is noise`);
  }
  assert.ok(isNoiseAffix({ name: "See the item description page for details.", type: "Bool" }));
  for (const n of ["Wisdom", "Improved Destruction", "Armor Class", "DR", "Ki", "Enhancement Bonus (Armor)"]) {
    assert.ok(!isNoiseAffix({ name: n, type: "Enhancement", value: "14" }), `${n} is a real affix`);
  }
  assert.ok(!isNoiseAffix(null) && !isNoiseAffix({ type: "Bool" }), "no name -> not noise");
});

test("normalizeItem drops noise affixes in place, keeps the real ones", () => {
  const it = { type: "Hand items", ml: 31, affixes: [
    { name: "Wisdom", type: "Enhancement", value: "14" },
    { name: "+14", type: "Bool", value: 1 },
    { name: "See the item description page for details.", type: "Bool", value: 1 },
    { name: "Dark Restoration Lore", type: "Equipment", value: "23" },
  ] };
  normalizeItem(it);
  assert.deepStrictEqual(it.affixes.map((a) => a.name), ["Wisdom", "Dark Restoration Lore"]);
});

test("real dataset carries no bare-number affix names after normalization", () => {
  const bad = [];
  for (const v of data.items) for (const a of (v.affixes || [])) {
    if (isNoiseAffix(a)) bad.push({ item: v.source_item, name: a.name });
  }
  assert.deepStrictEqual(bad, [], `noise affixes survived normalization: ${JSON.stringify(bad.slice(0, 5))}`);
});

// ---------------------------------------------------------------------------
// U3/U4 (plan 2026-08-05-002, #135) — set-granted value in browse.
// An item's worth can route through a set definition instead of its own affixes,
// so a Set Augment read as an empty row and was unfindable by the stat it grants.
// ---------------------------------------------------------------------------

const _ds = { augment_set_defs: { "Perfect Silence": { tiers: [
  { pieces_required: 3, pieces_label: "3 Pieces Equipped",
    affixes: [{ stat: "Sneak Attack Dice", bonus_type: "Artifact", value: 3 }] }] } },
  items: [
    { variant_id: "SA", source_item: "Set Augment: Perfect Silence", slot: "Colorless", set: "Perfect Silence", affixes: [] },
    { variant_id: "PLAIN", source_item: "Plain Ring", slot: "Ring",
      affixes: [{ name: "Sneak Attack Dice", type: "Enhancement", value: 2 }] },
  ] };

test("U3: a set-routed item stops reading as empty", () => {
  const rows = B.browsableItems(_ds);
  const sa = rows.find((r) => r.variant_id === "SA");
  assert.strictEqual((sa.affixes || []).length, 0, "it genuinely carries no affixes");
  assert.strictEqual(sa._setGranted.length, 1, "but its set bonus resolves");
  assert.strictEqual(sa._setGranted[0].stats[0], "Sneak Attack Dice");
});

test("U3: the chip's visible TEXT carries the set and its piece condition", () => {
  const rows = B.browsableItems(_ds);
  const text = B.setChipText(rows.find((r) => r.variant_id === "SA")._setGranted[0]);
  assert.ok(text.includes("Perfect Silence"), "names the set");
  assert.ok(/with 3 pieces/i.test(text), "states the condition, not a bare label");
  assert.ok(!text.startsWith("\u2713"), "does not reuse the boolean-presence checkmark");
  // Distinguishable from an item-carried chip by TEXT, not only by CSS class.
  assert.notStrictEqual(text, B.affixText(rows.find((r) => r.variant_id === "PLAIN"))[0]);
});

test("U3: a wildcard renders one chip per pool, not one per candidate set", () => {
  const ds = { items: [{ variant_id: "GEM", slot: "Trinket", affixes: [],
    joker_set_groups: [["A", "B", "C"], ["D", "E"]] }] };
  const gem = B.browsableItems(ds)[0];
  assert.strictEqual(gem._setGranted.length, 2, "two groups, two chips — never five");
  const t = B.setChipText(gem._setGranted[0]);
  assert.ok(/1 of 3/.test(t), `states the choice: ${t}`);
});

test("U4: the two filter modes stay separate — an item-affix search is unchanged", () => {
  const rows = B.browsableItems(_ds);
  const affix = B.filterVariants(rows, { stat: "Sneak Attack Dice" });
  const set = B.filterVariants(rows, { setStat: "Sneak Attack Dice" });
  assert.deepStrictEqual(affix.map((r) => r.variant_id), ["PLAIN"], "affix mode: only the carrier");
  assert.deepStrictEqual(set.map((r) => r.variant_id), ["SA"], "set mode: only the set-routed row");
});

test("U4: free text matches the set's own name", () => {
  const rows = B.browsableItems(_ds);
  const hits = B.filterVariants(rows, { query: "perfect silence" });
  assert.deepStrictEqual(hits.map((r) => r.variant_id), ["SA"]);
});

test("U4: variantSetStats is empty for an item with no set involvement", () => {
  const rows = B.browsableItems(_ds);
  assert.deepStrictEqual(B.variantSetStats(rows.find((r) => r.variant_id === "PLAIN")), []);
});

// ---------------------------------------------------------------------------
// U4 (plan 2026-08-12-003, #262) — no-drop-source disclosure in browse.
// A wiki-confirmed sourceless item must be list-visible at pick time: its row
// carries a badge beside the verification badge; unflagged rows carry nothing.
// ---------------------------------------------------------------------------

test("U4/262: a flagged item's row carries the no-drop-source badge", () => {
  const html = B.noDropBadge({ variant_id: "X", no_drop_source: true });
  assert.ok(html.includes("no known live drop source"), "badge carries the shared wording");
  assert.ok(/class="badge/.test(html), "renders as a badge, matching the status-cell DOM pattern");
  assert.ok(!/unobtainable/i.test(html), "the word 'unobtainable' appears nowhere (R5)");
});

test("U4/262: an unflagged row carries NO badge (assert absence)", () => {
  assert.strictEqual(B.noDropBadge({ variant_id: "X" }), "");
  assert.strictEqual(B.noDropBadge({ variant_id: "X", no_drop_source: false }), "");
  assert.strictEqual(B.noDropBadge(null), "");
});

test("U4/262: the flag survives into the browse row projection (real dataset)", () => {
  // The browse-visibility lesson: a non-affix fact is invisible unless it is on
  // the row struct the renderer reads. browsableItems must carry it through.
  const list = browsableItems(data);
  const flagged = list.filter((v) => v.no_drop_source === true);
  assert.ok(flagged.length >= 2, "the wiki-confirmed items reach the browse rows");
  assert.ok(flagged.some((v) => /Bracers of the Spider Queen/.test(v.variant_id)));
  for (const v of flagged) {
    assert.ok(B.noDropBadge(v).includes("no known live drop source"));
  }
  // and an unflagged real row renders no badge
  const plain = list.find((v) => !v.no_drop_source);
  assert.strictEqual(B.noDropBadge(plain), "");
});

test("U4/262: the render template composes the badge into the status cell", () => {
  // Source-text wiring guard (the wizard-test pattern): the DOM render is
  // browser-only, so assert the row template actually calls the helper — a pure
  // helper nobody renders would pass every other test while staying invisible.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "browse.js"), "utf-8");
  const i = src.indexOf("const badge =");
  const row = src.slice(i, src.indexOf("</tr>", i));
  assert.ok(/noDropBadge\(v\)/.test(row), "the status-cell badge string appends noDropBadge(v)");
});

console.log(`\n${passed} passed`);
