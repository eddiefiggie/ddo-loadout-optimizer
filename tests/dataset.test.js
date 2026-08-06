// U2 — load-time dataset normalizer. Run: node tests/dataset.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeItem, buildPickerVocabulary, expandedAwayFor, expandedAwayMessage, normalizeDataset } = require("../web/dataset.js");
// The built catalog, for the whole-vocabulary invariants at the bottom of this file.
const realData = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf-8")));

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

function names(it) { return it.affixes.map((a) => a.name); }
function find(it, n) { return it.affixes.find((a) => a.name === n); }

// U2 — bare "Sheltering" grants BOTH Physical and Magical Resistance Rating
// (https://ddowiki.com/page/Sheltering); expand it into the two named affixes.
test("U2: bare Sheltering expands into Physical + Magical Sheltering, same value + type", () => {
  const it = { affixes: [{ name: "Sheltering", value: 30, unit: "flat", type: "Enhancement" }] };
  normalizeItem(it);
  assert.ok(!names(it).includes("Sheltering"), "the bare Sheltering affix is replaced");
  const phys = find(it, "Physical Sheltering"), mag = find(it, "Magical Sheltering");
  assert.ok(phys && mag, "both Physical and Magical Sheltering are present");
  assert.strictEqual(phys.value, 30); assert.strictEqual(mag.value, 30);
  assert.strictEqual(phys.type, "Enhancement"); assert.strictEqual(mag.type, "Enhancement");
  assert.strictEqual(phys.unit, "flat"); assert.strictEqual(mag.unit, "flat");
});

test("U2: a typed bare Sheltering (Insight) expands preserving the Insight type", () => {
  const it = { affixes: [{ name: "Sheltering", value: 12, type: "Insight" }] };
  normalizeItem(it);
  assert.strictEqual(find(it, "Physical Sheltering").type, "Insight");
  assert.strictEqual(find(it, "Magical Sheltering").type, "Insight");
});

test("U2: 'Magical Sheltering Cap' and already-split Physical/Magical are untouched", () => {
  const it = { affixes: [
    { name: "Magical Sheltering Cap", value: 200, type: "Enhancement" },
    { name: "Physical Sheltering", value: 45, type: "Enhancement" },
  ] };
  normalizeItem(it);
  assert.deepStrictEqual(names(it).sort(), ["Magical Sheltering Cap", "Physical Sheltering"]);
});

test("U2: expansion is idempotent (re-normalizing does not re-expand)", () => {
  const it = { affixes: [{ name: "Sheltering", value: 30, type: "Enhancement" }] };
  normalizeItem(it);
  const after1 = names(it).sort();
  normalizeItem(it);
  assert.deepStrictEqual(names(it).sort(), after1, "second pass is a no-op");
});

test("U2: an item with bare + explicit Physical Sheltering does not get a duplicate", () => {
  const it = { affixes: [
    { name: "Sheltering", value: 30, type: "Enhancement" },
    { name: "Physical Sheltering", value: 45, type: "Enhancement" },
  ] };
  normalizeItem(it);
  const phys = it.affixes.filter((a) => a.name === "Physical Sheltering");
  assert.strictEqual(phys.length, 1, "no duplicate Physical Sheltering (explicit one kept)");
  assert.strictEqual(phys[0].value, 45, "the explicit affix is preserved");
  assert.ok(it.affixes.some((a) => a.name === "Magical Sheltering" && a.value === 30), "Magical still expanded");
});

test("U2: bare 'Sheltering' is not offered as a standalone picker suggestion", () => {
  const ds = { metadata: { rankable_affixes: ["Sheltering", "Physical Sheltering", "Constitution"] } };
  const vocab = buildPickerVocabulary(ds);
  assert.ok(!vocab.suggestions.includes("Sheltering"), "bare Sheltering dropped from suggestions");
  assert.ok(vocab.suggestions.includes("Physical Sheltering"), "Physical Sheltering stays a suggestion");
});

// ---------------------------------------------------------------------------
// U6 (plan 2026-08-05-001) — characterization guard.
// Pins the picker-vocabulary state that planning research found ALREADY correct,
// so a later vocabulary change cannot silently regress it. These assert current
// shipped behavior; they are not a spec for new work.
// ---------------------------------------------------------------------------

function builtVocab() {
  const fs = require("fs");
  const path = require("path");
  const p = path.join(__dirname, "..", "web", "data", "items.json");
  if (!fs.existsSync(p)) return null; // generated artifact; skip when absent
  return buildPickerVocabulary(JSON.parse(fs.readFileSync(p, "utf8")));
}

// KTD6 — the four boolean composites in scope for U4/U5 are already reachable as
// on/off targets. U5 writes their magnitude ADDITIVELY, so they must STAY here.
test("U6/KTD6: the four in-scope composites are suggested and presence-flagged", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Blurry", "Lesser Displacement", "Greater Heroism", "Crown of Summer"]) {
    assert.ok(v.suggestions.includes(n), `${n} is offered as a suggestion`);
    assert.ok(v.presence.has(n), `${n} is flagged as an on/off presence target`);
  }
});

// KTD6 — R9: these already carry magnitude buckets. The plan must NOT convert
// them to presence-only; that would strip scoring that works today.
test("U6/KTD6: Parrying, Riposte and Good Luck score as magnitude, not presence", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Parrying", "Riposte", "Good Luck"]) {
    assert.ok(v.suggestions.includes(n), `${n} is offered as a suggestion`);
    assert.ok(!v.presence.has(n), `${n} is NOT presence-only — it carries a magnitude bucket`);
  }
});

// R4 — the presence filter still excludes one-off proc/flavor lines. Guards
// against a future change relaxing the filter wholesale (which R5 forbids).
test("U6/R4: a sentence-shaped proc line stays out of suggestions but remains free-typeable", () => {
  const ds = {
    metadata: { rankable_affixes: ["Constitution"] },
    items: [{ affixes: [
      { name: "Ghost Touch", type: "Bool", value: 1 },
      { name: "On a Critical Hit, this weapon applies the Shaken debuff.", type: "Bool", value: 1 },
    ] }],
  };
  const v = buildPickerVocabulary(ds);
  assert.ok(v.suggestions.includes("Ghost Touch"), "a short build-around presence effect is suggested");
  assert.ok(!v.suggestions.some((s) => s.startsWith("On a Critical Hit")), "the proc sentence is not suggested");
  assert.ok(v.known.has("On a Critical Hit, this weapon applies the Shaken debuff."), "but it stays free-typeable");
});

// ---------------------------------------------------------------------------
// U1 (plan 2026-08-05-001, #136) — retire names the build expands away.
// `src/umbrella.py` rewrites "Well Rounded" / "All Ability Scores" into the six
// ability affixes at build time, so NO item can carry them. Offering the name
// gave the player a priority guaranteed to score zero.
// ---------------------------------------------------------------------------

test("U1/R1: an expanded-away name is not offered as a suggestion", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  assert.ok(!v.suggestions.includes("Well Rounded"), "Well Rounded is retired from suggestions");
  assert.ok(!v.suggestions.includes("All Ability Scores"), "All Ability Scores likewise");
});

test("U1/R1: the six ability scores stay rankable — the redirect target exists", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const ab of ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]) {
    assert.ok(v.suggestions.includes(ab), `${ab} is still offered`);
  }
});

test("U1/R1: an expanded-away name is still free-typeable, so the redirect can fire", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  // It stays in `known` via the affix registry. That is WHY addPriority needs its
  // own guard — the known-check alone would accept it.
  assert.ok(v.known.has("Well Rounded"), "still in the free-typed known set");
  assert.ok(expandedAwayFor(v, "Well Rounded"), "and the guard recognizes it");
});

test("U1/R1: the redirect names the six ability scores", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  const msg = expandedAwayMessage(v, "Well Rounded");
  assert.ok(msg, "a redirect message is produced");
  for (const ab of ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]) {
    assert.ok(msg.includes(ab), `the redirect names ${ab}`);
  }
});

test("U1/R1: the guard is case-insensitive (a free-typed value may not match casing)", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  assert.ok(expandedAwayFor(v, "well rounded"), "lowercase matches");
  assert.ok(expandedAwayFor(v, "  WELL ROUNDED  "), "uppercase and padded matches");
  assert.strictEqual(expandedAwayFor(v, "Constitution"), null, "a real stat is not caught");
});

test("U1/KTD2: a stale dataset without the metadata field still drops the names", () => {
  // Defense in depth — the hardcoded fallback path.
  const stale = buildPickerVocabulary({ metadata: { rankable_affixes: ["Well Rounded", "Constitution"] } });
  assert.ok(!stale.suggestions.includes("Well Rounded"), "dropped via the fallback constant");
  assert.ok(stale.suggestions.includes("Constitution"), "an ordinary stat is untouched");
});

test("U1/KTD2: `Sheltering` is NOT routed through the expanded-away set", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  // Sheltering expands to Physical/Magical Sheltering, NOT the six abilities.
  // Its own suggest.delete line owns it. If it ever appears here, someone folded
  // it into umbrella handling — which would rewrite every Sheltering affix into
  // ability scores at build time and zero out PRR/MRR.
  assert.strictEqual(expandedAwayFor(v, "Sheltering"), null, "Sheltering is not an umbrella name");
  assert.ok(!v.suggestions.includes("Sheltering"), "but it is still not suggested (its own line)");
  assert.ok(v.suggestions.includes("Physical Sheltering"), "and PRR/MRR remain rankable");
});

// ---------------------------------------------------------------------------
// U5 (plan 2026-08-05-001, #140) — write a boolean composite's wiki-verified
// components onto the item, ADDITIVELY. Evidence:
// docs/wiki-evidence/boolean-composites.md
// ---------------------------------------------------------------------------

test("U5: a composite keeps its boolean AND gains its components (additive)", () => {
  const it = { affixes: [{ name: "Blurry", type: "Bool", value: 1 }] };
  normalizeItem(it);
  assert.ok(names(it).includes("Blurry"), "the boolean survives — still targetable as presence");
  const c = find(it, "Concealment");
  assert.ok(c, "the component is written");
  assert.strictEqual(c.value, 20);
  assert.strictEqual(c.type, "Enhancement");
  assert.strictEqual(c.unit, "flat", "percentages store as bare numbers, like Dodge");
});

test("U5: Crown of Summer writes all three components", () => {
  const it = { affixes: [{ name: "Crown of Summer", type: "Bool", value: 1 }] };
  normalizeItem(it);
  assert.ok(names(it).includes("Crown of Summer"), "boolean survives");
  assert.strictEqual(find(it, "Healing Amplification").value, 15);
  assert.strictEqual(find(it, "Melee Power").value, 10);
  assert.strictEqual(find(it, "Ranged Power").value, 5);
});

test("U5: two composites contributing one stat write it once, at the higher value", () => {
  const it = { affixes: [
    { name: "Blurry", type: "Bool", value: 1 },
    { name: "Lesser Displacement", type: "Bool", value: 1 },
  ] };
  normalizeItem(it);
  const conceal = it.affixes.filter((a) => a.name === "Concealment");
  assert.strictEqual(conceal.length, 1, "one line, not two");
  assert.strictEqual(conceal[0].value, 25, "the higher wins (the solver would max anyway)");
});

test("U5: an explicitly stated component is never shadowed by a derived one", () => {
  const it = { affixes: [
    { name: "Blurry", type: "Bool", value: 1 },
    { name: "Concealment", type: "Insight", value: 7 },
  ] };
  normalizeItem(it);
  const conceal = it.affixes.filter((a) => a.name === "Concealment");
  assert.strictEqual(conceal.length, 1, "no duplicate line");
  assert.strictEqual(conceal[0].type, "Insight", "the item's own affix is preserved");
  assert.strictEqual(conceal[0].value, 7);
});

test("U5: expansion is idempotent", () => {
  const it = { affixes: [{ name: "Crown of Summer", type: "Bool", value: 1 }] };
  normalizeItem(it);
  const after1 = names(it).sort();
  normalizeItem(it);
  assert.deepStrictEqual(names(it).sort(), after1, "second pass adds nothing");
});

test("U5: Greater Heroism is QUARANTINED — the spell's numbers are not borrowed", () => {
  const it = { affixes: [{ name: "Greater Heroism", type: "Bool", value: 1 }] };
  normalizeItem(it);
  assert.deepStrictEqual(names(it), ["Greater Heroism"],
    "the wiki states a magnitude for the SPELL, not the item enchantment (KTD5)");
});

test("U5: composites remain presence-flagged after decomposition", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Blurry", "Lesser Displacement", "Crown of Summer", "Greater Heroism"]) {
    assert.ok(v.presence.has(n), `${n} is still an on/off target`);
  }
  assert.ok(v.suggestions.includes("Concealment"), "the minted component stat is rankable (KTD4b)");
});

// ---- picker vocabulary: every offered stat must have a real source ----

test("picker: no dropdown suggestion is unsourced (dead-entry guard)", () => {
  // A name in the dropdown that nothing supplies is a priority guaranteed to score
  // zero — the "Profane Well Rounded" failure class. This asserts the invariant over
  // the WHOLE vocabulary rather than blacklisting known offenders, so a future
  // CORE_STATS addition or seed change that reintroduces one fails here.
  const v = buildPickerVocabulary(realData);
  const supplied = new Set();
  const add = (n) => { if (n) supplied.add(String(n).trim().toLowerCase()); };
  for (const it of realData.items || []) {
    for (const a of it.affixes || []) add(a.name || a.stat);
    for (const sc of it.scaling || []) add(sc.stat);
    for (const sb of it.set_bonus || []) for (const a of sb.affixes || []) add(a.name || a.stat);
  }
  // Crafting/insert pools carry their stat under `stat`, or `name` when they also
  // carry a magnitude; walk them generically so a new pool is covered automatically.
  const walk = (o) => {
    if (o == null) return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o === "object") {
      if (o.stat) add(o.stat);
      if (o.name && o.value != null) add(o.name);
      Object.values(o).forEach(walk);
    }
  };
  for (const k of ["dino_inserts", "viktranium", "seal", "thunder_forged",
                   "green_steel", "nearly_complete", "membership_set_defs", "augment_set_defs"]) {
    walk(realData[k]);
  }
  const dead = v.suggestions.filter((s) => !supplied.has(s.trim().toLowerCase()));
  assert.deepStrictEqual(dead, [],
    `every picker suggestion must have a source; unsourced: ${JSON.stringify(dead)}`);
});

test("picker: a bonus TYPE is never offered as a rankable stat", () => {
  // `Vitality` is the canonical case — ~149 occurrences as affixes[].type and zero
  // as an affix name, so ranking it scored nothing. It stays on the curated
  // `distinct` list (never merged into False Life); it is just not a target.
  const v = buildPickerVocabulary(realData);
  const types = new Set();
  for (const it of realData.items || []) for (const a of it.affixes || []) {
    if (a.type) types.add(String(a.type).trim().toLowerCase());
  }
  const names = new Set();
  for (const it of realData.items || []) for (const a of it.affixes || []) {
    const n = a.name || a.stat; if (n) names.add(String(n).trim().toLowerCase());
  }
  const typeOnly = v.suggestions.filter((s) => {
    const k = s.trim().toLowerCase();
    return types.has(k) && !names.has(k);
  });
  assert.deepStrictEqual(typeOnly, [],
    `a name that only ever appears as a bonus type is not rankable; offered: ${JSON.stringify(typeOnly)}`);
});

if (!process.exitCode) console.log(`\n${passed} passed`);
