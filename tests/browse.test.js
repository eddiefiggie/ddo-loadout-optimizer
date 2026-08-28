// U5 browse-filter tests (node, zero-dependency). Run: node tests/browse.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { filterVariants, variantStats, affixText, dinoInsertRow, ncRow, vikRow, compendiumRow, browsableItems, affixEntries, presenceMarker } = require("../web/browse.js");
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

test("#545 a stamped native shows its Isle of Dread slots ALONGSIDE its own affixes", () => {
  // The blank's detail line was the only place this text appeared, because the
  // blank was the only weapon host with slots. A stamped native carries both its
  // real affixes and its capacity, and a player browsing it must see the second
  // — an item whose slots are invisible reads as an item that has none.
  const cov = data.metadata.dino_coverage;
  const names = new Set(cov.native_host_names);
  const native = items.find(
    (v) => names.has(v.source_item) && (v.affixes || []).length);
  assert.ok(native, "expected a stamped native carrying affixes");
  const texts = affixText(native);
  assert.ok(texts.some((t) => /Isle of Dread slots:/.test(t)),
    "the stamped native surfaces its typed Dino slots");
  assert.ok(texts.length > 1,
    "and still surfaces the affixes it earned — the slots are additional, not a replacement");
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


// ---- #332: the Utility-tier presence markers ----

test("#332: affixEntries is the structured form and affixText its exact text projection", () => {
  const v = { affixes: [{ name: "Ghostly", type: "Bool", value: 1 },
                        { name: "PRR", type: "Enhancement", value: 15 }] };
  const entries = affixEntries(v);
  assert.deepStrictEqual(entries.map((e) => e.text), affixText(v),
    "affixText must stay the text projection of affixEntries — no caller changes behavior");
  assert.strictEqual(entries[0].presenceName, "Ghostly", "a presence affix carries its name");
  assert.strictEqual(entries[1].presenceName, null, "a magnitude carries none");
});

test("#380: presenceMarker marks ONLY the counted set — there is no second glyph", () => {
  // #380 removed the rankable-only ◇. The not-counted population is 851 names
  // against the counting set's 20, so marking it reached 28% of all chips; the
  // legend states the default in words instead. Absence of ★ IS the answer.
  const sets = { counting: new Set(["Ghostly"]) };
  assert.strictEqual(presenceMarker("Ghostly", sets).cls, "counted");
  assert.strictEqual(presenceMarker("Undead Bane", sets), null,
    "a rankable-but-not-counted effect is deliberately unmarked since #380");
  assert.strictEqual(presenceMarker("Keen", sets), null,
    "and so is every other presence effect outside the counting set");
  assert.strictEqual(presenceMarker(null, sets), null, "a magnitude is never marked");
  // The old shape must not quietly come back through a stale caller: a `sets`
  // object still carrying an `admitted` half marks nothing extra.
  const legacy = { counting: new Set(["Ghostly"]), admitted: new Set(["Undead Bane"]) };
  assert.strictEqual(presenceMarker("Undead Bane", legacy), null,
    "an `admitted` half on the sets object is ignored, not honoured");
});

test("#332: without a vocabulary nothing is marked — Browse renders as before", () => {
  // initBrowse's vocab argument is optional; a host that does not pass one must
  // not get guessed-at membership.
  assert.strictEqual(presenceMarker("Ghostly", null), null);
  assert.strictEqual(presenceMarker("Ghostly", { counting: null }), null);
});

test("#380: the one marker carries BOTH halves of the split, not a symbol alone", () => {
  // With the second glyph gone, the counted marker's own text has to state what
  // the unmarked case means — otherwise dropping ◇ would drop the information
  // rather than relocate it.
  const counted = presenceMarker("Ghostly", { counting: new Set(["Ghostly"]) });
  assert.ok(/counted/i.test(counted.title), "it says the effect IS counted");
  assert.ok(/not count/i.test(counted.title),
    "and says what an unmarked effect means — the #343 split, stated on the one marker");
  assert.ok(/rank/i.test(counted.title),
    "including that an unmarked effect can still be ranked on its own");
});

// RE-POINTED TWICE, and this is the second. It first asserted that the
// rankable-only marker fires on real data; the 2026-08-18 refresh emptied the
// admitted set, so it was re-pointed to assert the emptiness and go red when
// #380 refilled it. #380 refilled the SET but deleted the MARKER — the
// not-counted population is 851 names and marking it reached 10,981 of 41,776
// chips, so the second glyph was dropped and its meaning moved into the legend
// and the counted marker's own title.
//
// So the real-data property under test changed shape: it is no longer "the
// rankable-only marker fires", it is "a populated not-counted set produces NO
// chip marker, and never silently produces the counted one".
test("#380: on REAL data the counted marker fires and the not-counted set marks nothing", () => {
  const { buildPickerVocabulary } = require("../web/dataset.js");
  const vocab = buildPickerVocabulary(data);
  if (!vocab || !vocab.utilityCounting || !vocab.utilityCounting.size) {
    console.log("  (skipped — web/data/items.json not built)"); return;
  }
  const sets = { counting: vocab.utilityCounting };
  assert.strictEqual(presenceMarker("Ghostly", sets).cls, "counted",
    "the reported case is marked as counted");
  // Non-vacuity: the population EXISTS, so "nothing is marked" is a real result
  // rather than an empty loop. This is the assertion that was missing when the
  // set silently collapsed.
  assert.ok(vocab.utilityNotCounted.size > 100,
    `the not-counted set must be populated for this check to mean anything; got ${vocab.utilityNotCounted.size}`);
  assert.ok(vocab.utilityNotCounted.has("Undead Bane"),
    "Undead Bane is in it — the anchor case");
  assert.strictEqual(presenceMarker("Undead Bane", sets), null,
    "and it carries no chip marker: absence of ★ is the not-counted answer");
});

test("#380: every counted chip is marked, and no not-counted chip is", () => {
  // The guard whose absence let the marker reach 75 of 1,656 chips. The isolated
  // presenceMarker tests passed because they fed name strings directly; the defect
  // lived at the affixEntries -> presenceMarker join, where membership is decided
  // on the canonical name.
  const { buildPickerVocabulary } = require("../web/dataset.js");
  const vocab = buildPickerVocabulary(data);
  if (!vocab || !vocab.utilityCounting || !vocab.utilityCounting.size) {
    console.log("  (skipped — web/data/items.json not built)"); return;
  }
  const sets = { counting: vocab.utilityCounting };
  // Select by the CANONICAL name and assert on the RAW one. An earlier draft filtered
  // and asserted on the same raw markName, so a raw-vs-canonical mismatch dropped out
  // of the loop instead of failing — the test could not detect the very join it guards.
  const canon = (n) => (typeof vocab.canonical === "function" ? vocab.canonical(n) : n);
  let countedChips = 0, countedMarked = 0, notCountedChips = 0, strayMarks = 0;
  for (const v of items) {
    for (const e of affixEntries(v)) {
      if (!e.markName) continue;
      const c = canon(e.markName);
      if (vocab.utilityCounting.has(c)) {
        countedChips++;
        if ((presenceMarker(e.markName, sets) || {}).cls === "counted") countedMarked++;
      } else if (vocab.utilityNotCounted.has(c)) {
        notCountedChips++;
        if (presenceMarker(e.markName, sets)) strayMarks++;
      }
    }
  }
  assert.ok(countedChips > 100,
    `the dataset carries many counted chips (got ${countedChips})`);
  assert.strictEqual(countedMarked, countedChips,
    `EVERY counted chip must be marked counted (${countedMarked}/${countedChips})`);
  // Both halves are non-vacuous: the not-counted join has thousands of rows and
  // every one of them must come back unmarked.
  assert.ok(notCountedChips > 1000,
    `the not-counted join must have a real population (got ${notCountedChips})`);
  assert.strictEqual(strayMarks, 0,
    `no not-counted chip may carry a marker (${strayMarks}/${notCountedChips}) — #380`);
});

console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #426 — a synthesized crafted row carries the provenance the override picker
// needs. The row is a DISPLAY projection, so without this it cannot be mapped
// back to the pool entry it was built from; the synthetic title is lossy and is
// not a usable matching rule. Every discriminator the pool key needs is already
// a field on the object each builder receives, so stamping is exact.
// ---------------------------------------------------------------------------

test("#426: dinoInsertRow stamps its channel and discriminators", () => {
  const row = dinoInsertRow({ dino_type: "Claw", category: "Accessory",
    affixes: [{ stat: "Strength", bonus_type: "Profane", value: 4 }] });
  assert.deepStrictEqual(row.pool_provenance, { channel: "dino_inserts", disc: ["Accessory", "Claw"] },
    "channel + [category, dino_type], the discriminators eachPoolAffix keys on");
});

test("#426: ncRow stamps its channel and discriminators", () => {
  const row = ncRow({ category: "Weapon", tier: "legendary",
    affixes: [{ stat: "Doublestrike", bonus_type: "Quality", value: 3 }] });
  assert.deepStrictEqual(row.pool_provenance, { channel: "nearly_complete", disc: ["Weapon", "legendary"] });
});

test("#426: vikRow stamps its channel and discriminators", () => {
  const row = vikRow({ slot_type: "Melancholic", category: "Accessory", tier: "legendary",
    affixes: [{ stat: "Abjuration Focus", bonus_type: "Profane", value: 1 }] });
  assert.deepStrictEqual(row.pool_provenance,
    { channel: "viktranium", disc: ["Melancholic", "Accessory", "legendary"] },
    "slot_type first — the key's discriminator order, not the row's field order");
});

test("#426: the stamp is additive — existing row readers are untouched", () => {
  const row = vikRow({ slot_type: "Woeful", category: "Accessory", tier: "heroic",
    affixes: [{ stat: "Strength", bonus_type: "Sacred", value: 2 }] });
  // The four call sites that already read these rows key on these fields.
  for (const k of ["variant_id", "source_item", "slot", "ml", "affixes", "verification"]) {
    assert.ok(k in row, `${k} still present`);
  }
});

// ---------------------------------------------------------------------------
// #562 — crafting slot labels are player-visible (every share export prints them)
// but were in no search index. A player could read `Essence Crafting: Rune Arm -
// Prefix` on their own exported build, type it into Browse, and get nothing.

test("#562: crafting slots are a match mode of their own, not part of `query`", () => {
  const v = (id, crafting) => ({ variant_id: id, source_item: id, slot: "Ring",
    affixes: [], crafting });
  const items = [v("A", ["Blue Augment Slot"]), v("B", ["Essence Crafting: Ring - Prefix"]), v("C", [])];

  assert.deepStrictEqual(
    B.filterVariants(items, { craftingSlot: "Essence Crafting: Ring - Prefix" }).map((x) => x.variant_id),
    ["B"]);
  // …and the free-text query does NOT reach them, which is the whole design.
  assert.deepStrictEqual(B.filterVariants(items, { query: "Essence Crafting" }), []);
  assert.strictEqual(B.filterVariants(items, { craftingSlot: "" }).length, 3,
    "an empty filter matches everything, like every other mode here");
});

test("#562: folding crafting labels into `query` would wreck name search", () => {
  // The measurement that decided the design, pinned so nobody re-merges them.
  // Against the shipped catalog: `Blue` goes 43 -> 1279 rows because 1,236 items
  // carry a Blue Augment Slot. Same shape as the stat/setStat split's rationale.
  const nameHits = B.filterVariants(items, { query: "Blue" }).length;
  const wouldMatch = items.filter((v) =>
    [v.variant_id, v.source_item, ...(v.crafting || [])].join(" ").toLowerCase().includes("blue")).length;
  assert.ok(nameHits > 0, "non-vacuity: the name search must actually find something");
  assert.ok(wouldMatch > nameHits * 10,
    `merging would take Blue from ${nameHits} to ${wouldMatch} rows — keep the modes separate`);
});

test("#562: the label list is derived from the catalog, never curated", () => {
  const items = [{ crafting: ["Zeta Slot", "Alpha Slot"] }, { crafting: ["Alpha Slot"] }, {}];
  assert.deepStrictEqual(B.craftingSlotNames(items), ["Alpha Slot", "Zeta Slot"],
    "sorted, deduped, and blind to how many items carry each");
  assert.deepStrictEqual(B.craftingSlotNames([]), []);
  assert.deepStrictEqual(B.craftingSlotNames(null), []);
});

test("#562: a dead-end search says the thing typed was a crafting slot", () => {
  const items = [{ crafting: ["Essence Crafting: Ring - Prefix", "Essence Crafting: Ring - Suffix"] }];
  const hint = B.craftingSearchHint("Essence Crafting", items, { hadResults: false });
  assert.ok(/crafting slots, not an item name/.test(hint), hint);
  assert.ok(/Essence Crafting: Ring - Prefix/.test(hint), "it names what to look for");

  const one = B.craftingSearchHint("Ring - Suffix", items, { hadResults: false });
  assert.ok(/That is a crafting slot/.test(one), "singular reads as singular");
});

test("#562: the Cannith rename is bridged at SEARCH time, not in the registry", () => {
  // Update 79 renamed it and we adopted the rename (#374). The old name currently
  // returns 8 items whose NAMES contain "Cannith" — worse than zero, because it
  // looks like an answer. `check_crafting_integrity` is exact-match set membership
  // over a frozen registry, so a second spelling there would be a real second
  // label the build would have to serve. The hint changes what the player is
  // told, never what the catalog contains.
  const items = [{ crafting: ["Essence Crafting: Ring - Prefix"] }];
  const hint = B.craftingSearchHint("cannith", items, { hadResults: false });
  assert.ok(/renamed it to Essence Crafting/.test(hint), hint);
  assert.ok(/Update 79/.test(hint), "the player is told WHEN, so the change is placeable");
  assert.deepStrictEqual(B.CRAFTING_OLD_NAMES, { cannith: "Essence Crafting" },
    "one entry today; adding one is a deliberate edit");

  // THE case this issue is about: `Cannith` returns 8 items whose NAMES contain
  // the word, so the player gets a confident WRONG answer, not an empty one.
  // Gating the rename hint on a dead end would silence it exactly there.
  const withResults = B.craftingSearchHint("cannith", items, { hadResults: true });
  assert.ok(/renamed it to Essence Crafting/.test(withResults),
    "the rename hint must fire even when the search found (the wrong) things");
  assert.ok(!/not an item name/.test(withResults),
    "and must not claim nothing matched, because things did");
});

test("#562: no hint when there is nothing useful to say", () => {
  const items = [{ crafting: ["Essence Crafting: Ring - Prefix"] }];
  assert.strictEqual(B.craftingSearchHint("", items), "", "an empty query is not a dead end");
  assert.strictEqual(B.craftingSearchHint("   ", items), "");
  assert.strictEqual(B.craftingSearchHint("Hydra's Heart", items, { hadResults: false }), "",
    "a real miss stays a plain miss — a hint on every empty search is noise");
  assert.strictEqual(B.craftingSearchHint("cannith", [{ crafting: [] }], { hadResults: false }), "",
    "and the rename bridge stays quiet when the new labels are not present either");
  // The dead-end hint is suppressed once results exist: "that is not an item
  // name" is wrong and confusing with rows on screen.
  assert.strictEqual(B.craftingSearchHint("Essence Crafting", items, { hadResults: true }), "",
    "a dead-end explanation has no place when the search found something");
});
