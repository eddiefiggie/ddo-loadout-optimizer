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

// R12 — the two browser-side expansions stamp the originating enchantment name
// under the same `via` key the Python expansions write (src/spell_focus.py
// PROVENANCE_KEY), so a consumer can collapse an expanded group back to the one
// line the item actually bears. Sheltering is a TYPED family: the wiki lists
// "Insightful Sheltering" and "Quality Sheltering" categories, and states that a
// bare Sheltering "is usually an enhancement bonus unless otherwise stated" — so
// the Enhancement variant is engraved bare (docs/wiki-evidence/sheltering.md).
test("R12: bare Sheltering's halves name the enchantment they came from", () => {
  const it = { affixes: [{ name: "Sheltering", value: 30, type: "Enhancement" }] };
  normalizeItem(it);
  assert.strictEqual(find(it, "Physical Sheltering").via, "Sheltering");
  assert.strictEqual(find(it, "Magical Sheltering").via, "Sheltering");
});

test("R12: a typed Sheltering is stamped with the wiki's typed name", () => {
  const insight = { affixes: [{ name: "Sheltering", value: 12, type: "Insight" }] };
  normalizeItem(insight);
  assert.strictEqual(find(insight, "Physical Sheltering").via, "Insightful Sheltering",
    "the wiki writes the Insight variant 'Insightful', never 'Insight'");
  const quality = { affixes: [{ name: "Sheltering", value: 8, type: "Quality" }] };
  normalizeItem(quality);
  assert.strictEqual(find(quality, "Magical Sheltering").via, "Quality Sheltering");
});

test("R12: an affix the item states itself carries no provenance", () => {
  const it = { affixes: [
    { name: "Sheltering", value: 30, type: "Enhancement" },
    { name: "Physical Sheltering", value: 45, type: "Enhancement" },
  ] };
  normalizeItem(it);
  const phys = it.affixes.find((a) => a.name === "Physical Sheltering");
  assert.ok(!("via" in phys), "the item's own affix must not claim an originating enchantment");
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
//
// Re-ratified for #169. `Parrying` left this list because it is now EXPANDED
// AWAY, not because it became presence-only. The original intent — that its
// magnitude keeps scoring — is preserved and strengthened: the enchantment
// grants Insight Armor Class and three Insight saves, and it now scores against
// those four real stats instead of against its own name. The assertion below
// pins that replacement, so dropping the expansion would fail here too.
test("U6/KTD6: Riposte and Good Luck score as magnitude, not presence", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Riposte", "Good Luck"]) {
    assert.ok(v.suggestions.includes(n), `${n} is offered as a suggestion`);
    assert.ok(!v.presence.has(n), `${n} is NOT presence-only — it carries a magnitude bucket`);
  }
});

test("#169: Parrying's magnitude still scores, via its four expanded stats", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  // Parrying still names an enchantment rather than a stat, and still must not score
  // against its own name. U10 changed only how the picker SAYS so: it was removed from
  // the dropdown, and is now offered as an alias that substitutes into the four stats.
  // Removal was wrong once the item surfaces began printing "Parrying" as an affix's
  // origin — the app named something its own picker refused.
  assert.ok(v.suggestions.includes("Parrying"),
    "Parrying is offered, because the results print it as an expansion's origin");
  assert.deepStrictEqual(expandedAwayFor(v, "Parrying"),
    ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"],
    "and it resolves to the four stats rather than being rankable as itself");
  assert.ok(!v.presence.has("Parrying"), "and it must not have become presence-only");
  assert.ok(!v.magnitude.has("Parrying"),
    "it has no bucket of its own — the expansion, not the name, is what scores");
  for (const n of ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]) {
    assert.ok(v.suggestions.includes(n), `${n} is rankable — the redirect target exists`);
    assert.ok(!v.presence.has(n), `${n} scores as a magnitude`);
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

// R12 — a derived component names the composite it was derived from. The
// composite name takes no bonus-type prefix: it is stored as `Bool` presence,
// which is not a bonus type, and the wiki writes the enchantment bare.
test("R12: a derived component names the composite it came from", () => {
  const it = { affixes: [{ name: "Crown of Summer", type: "Bool", value: 1 }] };
  normalizeItem(it);
  for (const n of ["Healing Amplification", "Melee Power", "Ranged Power"]) {
    assert.strictEqual(find(it, n).via, "Crown of Summer", `${n} names its source`);
  }
  assert.ok(!("via" in find(it, "Crown of Summer")), "the boolean itself is native, not derived");
});

test("R12: when two composites contribute one stat, the surviving line names the winner", () => {
  const it = { affixes: [
    { name: "Blurry", type: "Bool", value: 1 },
    { name: "Lesser Displacement", type: "Bool", value: 1 },
  ] };
  normalizeItem(it);
  const conceal = it.affixes.filter((a) => a.name === "Concealment");
  assert.strictEqual(conceal.length, 1);
  assert.strictEqual(conceal[0].via, "Lesser Displacement", "the 25% source, not the 20% one");
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

test("picker: a stat reachable only through a MULTI-AFFIX Viktranium option is offered", () => {
  // A Viktranium option is atomic: one record carrying an `affixes` list. Reading
  // only a singular `o.stat` leaves every affix of a multi-affix option
  // unrankable — the player can never name the school the craft would grant.
  const ds = {
    metadata: { rankable_affixes: ["Constitution"] },
    viktranium: [{
      slot_type: "Dolorous", category: "Armor", tier: "legendary",
      name: "Dolorous Invigorator (legendary)",
      affixes: [
        { stat: "Abjuration Focus", bonus_type: "Profane", value: 1, unit: "flat" },
        { stat: "Necromancy Focus", bonus_type: "Profane", value: 1, unit: "flat" },
        { stat: "Assassinate", bonus_type: "Profane", value: 1, unit: "flat" },
      ],
    }],
  };
  const v = buildPickerVocabulary(ds);
  for (const stat of ["Abjuration Focus", "Necromancy Focus", "Assassinate"]) {
    assert.ok(v.suggestions.includes(stat), `${stat} is offered as a rankable suggestion`);
    assert.ok(v.known.has(stat), `${stat} is free-typeable`);
  }
});

test("picker: a FLAT legacy Viktranium record still contributes its stat (back-compat)", () => {
  const v = buildPickerVocabulary({
    metadata: { rankable_affixes: ["Constitution"] },
    viktranium: [{ slot_type: "Melancholic", category: "Accessory", tier: "legendary",
      stat: "Necromancy Focus", bonus_type: "Profane", value: 1 }],
  });
  assert.ok(v.suggestions.includes("Necromancy Focus"), "the flat shape still sources its stat");
});

test("picker: every affix of every real multi-affix Viktranium option is known", () => {
  const multi = (realData.viktranium || []).filter((o) => (o.affixes || []).length > 1);
  assert.ok(multi.length > 0, "the real pool carries multi-affix options");
  const v = buildPickerVocabulary(realData);
  for (const o of multi) {
    for (const a of o.affixes) {
      assert.ok(v.known.has(a.stat), `${a.stat} (from ${o.name}) is in the picker vocabulary`);
    }
  }
});

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
  // U10 — a provenance label is deliberately unsourced AS A STAT: it is the
  // enchantment name the item shows, and no affix carries it after expansion. It is
  // still not a dead entry, because selecting it never produces a priority of that
  // name — it substitutes into its components. So the invariant tightens rather than
  // relaxes: a suggestion must be supplied, OR resolve to components that all are.
  // An alias pointing at a stat nothing supplies is the same dead priority wearing a
  // different name, and still fails here.
  const dead = [];
  for (const s of v.suggestions) {
    if (supplied.has(s.trim().toLowerCase())) continue;
    const to = expandedAwayFor(v, s);
    if (!to) { dead.push(s); continue; }
    for (const c of to) if (!supplied.has(String(c).trim().toLowerCase())) dead.push(`${s} -> ${c}`);
  }
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


// --- #169: saved-character priority migration ---------------------------------
// loadCharacter() restored `priorities` verbatim and never consulted the
// expanded-away map, so a character who ranked `Parrying` before it expanded
// would load a priority matching no item — scoring zero, indistinguishable from
// a target nothing happens to carry.

const AWAY_VOCAB = { expandedAway: {
  "parrying": ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"],
  "heightened awareness": ["Armor Class"],
  "speed": ["Movement Speed", "Melee Alacrity", "Ranged Alacrity"],
} };

test("#169: an expanded-away priority is substituted, preserving rank order", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Strength", "Parrying", "Dodge"], AWAY_VOCAB);
  assert.deepStrictEqual(out.priorities,
    ["Strength", "Armor Class", "Fortitude Save", "Reflex Save", "Will Save", "Dodge"]);
  assert.deepStrictEqual(out.substitutions,
    [{ from: "Parrying", to: ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"] }]);
});

test("#169: two names expanding to the same stat do not duplicate it", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Parrying", "Heightened Awareness"], AWAY_VOCAB);
  assert.strictEqual(out.priorities.filter((p) => p === "Armor Class").length, 1);
  assert.strictEqual(out.substitutions.length, 2, "both substitutions are still disclosed");
});

test("#169: an existing concrete priority is not duplicated by the expansion", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Armor Class", "Heightened Awareness"], AWAY_VOCAB);
  assert.deepStrictEqual(out.priorities, ["Armor Class"]);
});

test("#169: a character with no expanded-away priority is untouched", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Strength", "Dodge"], AWAY_VOCAB);
  assert.deepStrictEqual(out.priorities, ["Strength", "Dodge"]);
  assert.strictEqual(out.substitutions.length, 0, "no disclosure when nothing changed");
});

test("#169: migration is idempotent", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const once = migratePriorities(["Parrying"], AWAY_VOCAB).priorities;
  const twice = migratePriorities(once, AWAY_VOCAB);
  assert.deepStrictEqual(twice.priorities, once);
  assert.strictEqual(twice.substitutions.length, 0);
});

test("#169: matching is case-insensitive, because priorities were free-typeable", () => {
  const { migratePriorities } = require("../web/dataset.js");
  assert.strictEqual(migratePriorities(["parrying"], AWAY_VOCAB).substitutions.length, 1);
  assert.strictEqual(migratePriorities(["  PARRYING "], AWAY_VOCAB).substitutions.length, 1);
});

test("#169: empty and malformed priority lists do not throw", () => {
  const { migratePriorities } = require("../web/dataset.js");
  for (const input of [undefined, null, [], "nonsense"]) {
    assert.deepStrictEqual(migratePriorities(input, AWAY_VOCAB).priorities, []);
  }
});

test("#169: the disclosure names both the old target and its replacements", () => {
  const { migratePriorities, migrationMessage } = require("../web/dataset.js");
  const msg = migrationMessage(migratePriorities(["Parrying"], AWAY_VOCAB).substitutions);
  assert.ok(msg.includes("Parrying"), "names what the player had ranked");
  for (const s of ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]) {
    assert.ok(msg.includes(s), `names the replacement ${s}`);
  }
  assert.strictEqual(migrationMessage([]), null, "no message when nothing changed");
});

test("#169: the built dataset's real map drives the migration", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Parrying", "Heightened Awareness", "Speed"], v);
  assert.strictEqual(out.substitutions.length, 3,
    "all three expanded names migrate off the shipped metadata");
  for (const p of out.priorities) {
    assert.ok(v.suggestions.includes(p), `${p} is a real rankable target`);
  }
});


// --- review #169: prototype-chain hazard + bound-map cleanup --------------------

test("#169: a priority colliding with Object.prototype does not resolve or throw", () => {
  const { migratePriorities, expandedAwayFor } = require("../web/dataset.js");
  // `Object.length === 1`, so a bare `hit && hit.length` check let the inherited
  // `constructor` through and the caller threw on `.slice()` -- a saved or
  // imported character became permanently unloadable.
  for (const hostile of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
    assert.strictEqual(expandedAwayFor(AWAY_VOCAB, hostile), null, `${hostile} must not resolve`);
    const out = migratePriorities([hostile], AWAY_VOCAB);
    assert.deepStrictEqual(out.priorities, [hostile], `${hostile} passes through untouched`);
    assert.strictEqual(out.substitutions.length, 0);
  }
});

test("#169: a non-array map value is rejected rather than trusted", () => {
  const { expandedAwayFor } = require("../web/dataset.js");
  assert.strictEqual(expandedAwayFor({ expandedAway: { parrying: "Armor Class" } }, "Parrying"), null,
    "a bare string has .length and would have passed the old check");
});

test("#169: the disclosure names a dropped bound", () => {
  const { migratePriorities, migrationMessage } = require("../web/dataset.js");
  const subs = migratePriorities(["Parrying"], AWAY_VOCAB).substitutions;
  const msg = migrationMessage(subs, ["Parrying"]);
  assert.ok(/removed rather than copied/.test(msg), "the drop is disclosed, not silent");
  assert.ok(msg.includes('"Parrying"'));
  const quiet = migrationMessage(subs, []);
  assert.ok(!/removed rather than copied/.test(quiet), "no bound, no bound sentence");
});

// ---------------------------------------------------------------------------
// #228 — the presence word cap. `_isPresenceTargetable` hides any Bool name
// longer than four words, standing in for "is this a named effect or a
// sentence". It splits the wrong way on a named effect with a long name, which
// is how `Kick 'Em While They're Down` (five words, 12 wiki-confirmed items)
// became unfindable: a player searching "kick" got nothing back.

const KICK = "Kick 'Em While They're Down";

// Every Bool name that clears the noise filter and is hidden only by the word
// cap. PINNED: a rebuild that introduces a new named effect must fail here
// rather than hide it silently. When this list changes, rule on the new name --
// add it to PRESENCE_ALLOW in web/dataset.js if the DDO wiki names it as an
// effect, otherwise update this fixture with the sentence-shaped addition.
const WORD_CAP_CASUALTIES = [
  "1 Positive Healing every minute",
  "1 to 4 Light Damage",
  "1 to 6 Bane damage on hit vs Undead",
  "1 to 8 Cold Damage",
  "6 to 36 bonus Rust damage on hit vs Constructs",
  "Additional 2d8 Bane Damage to Fey creatures on hit",
  "Brilliance of the Shattered Sun",
  "Choco-Bacon-Berry Dream Bar (Lasting Bear's Endurance and Lasting Bear's Stamina, 1 hour)",
  "Dark Chocolate 'Magma' Truffle (Lasting Haste, 3 minutes)",
  "Embrace of the Spider Queen",
  "Epic Slice 'n Dice Set",
  "Final Litany of the Crimson Covenant",
  "First Litany of the Crimson Covenant",
  "Greater Bane of the Unnatural",
  "If equipped on a character with Follower of the Blood of Vol",
  "Inflicts a Negative Level on vorpal hits",
  "Item becomes a Spellcasting Implement",
  "Legendary Cooking By the Book",
  "Legendary Tet-zik, The Enlightened Change",
  "Legendary Vile Grip of the Hidden Hand",
  "Lifeblood of the Undead Prince",
  "Magnetism +108 (only from chest)",
  "Magnetism +66 (only from chest)",
  "Nut-hull Toffee Surprise (Lasting Stoneskin, CL 10, 10 minutes)",
  "Path of the Fire Dragon",
  "Path of the Guarding Stone",
  "Second Litany of the Crimson Covenant",
  "Third Litany of the Crimson Covenant",
  "Vile Grip of the Hidden Hand",
  "Vitality +20 (only from chain end reward)",
  "Way of the Sun Soul",
  "You also gain immunity to Mind-Altering Enchantments as if you were under the effects of the Protection from Evil spell",
  "item becomes a Spellcasting Implement",
  "ward against the Knockdowns and Slows of an Air Elemental",
];

test("#228: the reported effect is suggested, so searching for it finds it", () => {
  const v = buildPickerVocabulary(realData);
  assert.ok(v.suggestions.includes(KICK), "it is offered as a suggestion");
  assert.deepStrictEqual(v.suggestions.filter((s) => /kick/i.test(s)), [KICK],
    'searching "kick" returns it');
});

test("#228: it is flagged as presence, not as a magnitude", () => {
  const v = buildPickerVocabulary(realData);
  assert.ok(v.presence.has(KICK), "on/off, so the UI can badge it as a feature");
  assert.ok(!v.magnitude.has(KICK), "no rankable bucket, so no declared-credit control");
});

test("#228: the word-cap casualty set is pinned, so a new named effect surfaces", () => {
  const { presenceWordCapCasualties } = require("../web/dataset.js");
  assert.deepStrictEqual(presenceWordCapCasualties(realData), WORD_CAP_CASUALTIES);
});

test("#228: allowing a name removes it from the casualty set and the cap still holds", () => {
  const { presenceWordCapCasualties } = require("../web/dataset.js");
  const casualties = presenceWordCapCasualties(realData);
  assert.ok(!casualties.includes(KICK), "an adjudicated name is no longer a casualty");
  // The cap is still the default: the sentence-shaped names stay hidden.
  const v = buildPickerVocabulary(realData);
  for (const hidden of ["Inflicts a Negative Level on vorpal hits",
                        "ward against the Knockdowns and Slows of an Air Elemental"]) {
    assert.ok(!v.suggestions.includes(hidden), `${hidden} stays hidden`);
    assert.ok(v.known.has(hidden), `${hidden} stays free-typeable`);
  }
});

test("#228: a five-word Bool name that is not adjudicated shows up as a casualty", () => {
  const { presenceWordCapCasualties } = require("../web/dataset.js");
  const synthetic = { items: [{ affixes: [{ name: "Song Of The Silent Deep", type: "Bool", value: 1 }] }] };
  assert.deepStrictEqual(presenceWordCapCasualties(synthetic), ["Song Of The Silent Deep"]);
  // ...and it is genuinely hidden from the picker, which is what the report is for.
  assert.ok(!buildPickerVocabulary(synthetic).suggestions.includes("Song Of The Silent Deep"));
});

// ---------------------------------------------------------------------------
// #227 — the untyped worn-gear magnitude, reachable under its wiki name.

test("#227: Enhanced Ki is suggested under the wiki's name", () => {
  const v = buildPickerVocabulary(realData);
  assert.ok(v.suggestions.includes("Enhanced Ki"), "the wiki name is offered");
  assert.ok(!v.suggestions.includes("Ki"), "the upstream shorthand is not a separate offer");
});

test("#227: the gear-planner name still resolves through the alias", () => {
  const v = buildPickerVocabulary(realData);
  assert.strictEqual(v.canonical("Ki"), "Enhanced Ki");
  assert.ok(v.known.has(v.canonical("Ki")), "typing the upstream name is accepted");
});

test("#227: it carries a rankable magnitude, not a presence flag", () => {
  const v = buildPickerVocabulary(realData);
  assert.ok(v.magnitude.has("Enhanced Ki"), "it has a real bucket to rank");
  assert.ok(!v.presence.has("Enhanced Ki"));
});

test("#227: admitting one untyped name gives the proc population no rankable bucket", () => {
  const v = buildPickerVocabulary(realData);
  // These are offered as on/off PRESENCE effects and always have been -- Holy
  // ships `Bool 1` on 11 items alongside its untyped damage line on 95. What the
  // allow-list must not do is hand them a magnitude bucket to rank, which is the
  // failure mode the blanket untyped skip was protecting against.
  for (const proc of ["Holy", "Vampirism", "Maiming", "Chilling", "Undead Bane"]) {
    assert.ok(!v.magnitude.has(proc), `${proc} has no rankable magnitude bucket`);
  }
  assert.ok(v.magnitude.has("Enhanced Ki"), "the adjudicated name does");
});

// --- U10 (R13/R14): provenance labels enter the picker vocabulary -------------
// Every expansion family stamps the ORIGINATING enchantment name on each affix it
// emits, and the item surfaces DISPLAY that name. Until now the picker refused it:
// `expanded_away_names` carries only the BARE keys a family declares ("spell focus
// mastery"), while the results print the bonus-type PREFIXED name ("Sacred Spell
// Focus Mastery"). The app printed names its own picker would not accept.

const SCHOOLS = ["Abjuration Focus", "Conjuration Focus", "Enchantment Focus",
  "Evocation Focus", "Illusion Focus", "Necromancy Focus", "Transmutation Focus"];

test("U10: the vocabulary exposes the provenance labels the build emitted", () => {
  const v = buildPickerVocabulary(realData);
  assert.ok(v.provenanceLabels && typeof v.provenanceLabels === "object",
    "buildPickerVocabulary returns the label map");
  // Refuse to inspect zero records: an empty map would satisfy every "no
  // collision" assertion below while proving nothing.
  assert.ok(Object.keys(v.provenanceLabels).length >= 10,
    `only ${Object.keys(v.provenanceLabels).length} labels`);
});

test("U10/R14: a typed provenance label is SUGGESTED, not merely accepted when typed", () => {
  const v = buildPickerVocabulary(realData);
  for (const label of ["Sacred Spell Focus Mastery", "Quality Well Rounded",
                       "Insightful Spell Focus Mastery"]) {
    assert.ok(v.suggestions.includes(label), `${label} is offered in the picker`);
    assert.ok(v.known.has(label), `${label} is accepted when typed`);
  }
});

test("U10/R13: a label resolves to the stats it becomes, in the declared order", () => {
  const v = buildPickerVocabulary(realData);
  assert.deepStrictEqual(expandedAwayFor(v, "Sacred Spell Focus Mastery"), SCHOOLS);
  assert.deepStrictEqual(expandedAwayFor(v, "Parrying"),
    ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]);
  assert.deepStrictEqual(expandedAwayFor(v, "Speed"),
    ["Movement Speed", "Melee Alacrity", "Ranged Alacrity"]);
  assert.deepStrictEqual(expandedAwayFor(v, "  sacred SPELL focus mastery "), SCHOOLS,
    "matching is case- and padding-insensitive, like every other picker path");
});

test("U10: a BARE name that is also a shipped provenance label stays suggested", () => {
  // The collision the blanket removal rule got wrong. For an untyped or
  // Enhancement-carrier family the provenance label and the bare expanded-away
  // name are the SAME string, so stripping bare expanded-away names suppressed
  // exactly the names the results print.
  const v = buildPickerVocabulary(realData);
  for (const bare of ["Parrying", "Speed", "Spell Focus", "Spell Focus Mastery",
                      "Heightened Awareness"]) {
    assert.ok(v.provenanceLabels[bare.toLowerCase()], `${bare} is a shipped label`);
    assert.ok(v.suggestions.includes(bare), `${bare} is suggested rather than stripped`);
    assert.ok(expandedAwayFor(v, bare), `${bare} still resolves to its components`);
  }
});

test("U10: an expanded-away name NO surface displays keeps removal-and-redirect", () => {
  // `Well Rounded` and `All Ability Scores` are expanded away, but no affix is
  // ever stamped with them as its origin — the umbrella family prefixes even its
  // Enhancement variant ("Enhancement Well Rounded"). Nothing displays them, so
  // there is nothing to make rankable and the redirect survives.
  const v = buildPickerVocabulary(realData);
  for (const bare of ["Well Rounded", "All Ability Scores"]) {
    assert.ok(!v.provenanceLabels[bare.toLowerCase()], `${bare} is NOT a shipped label`);
    assert.ok(!v.suggestions.includes(bare), `${bare} stays out of suggestions`);
    const msg = expandedAwayMessage(v, bare);
    assert.ok(msg && /rank those instead/.test(msg), `${bare} still redirects: ${msg}`);
  }
});

test("U10: no label is aliased over a stat real affixes still supply", () => {
  // docs/solutions/logic-errors/bonus-type-vocabulary-collides-with-bare-stat.md:
  // adding a vocabulary entry that is also a live bare stat name DESTROYS the
  // stat, and the suite did not catch it — code review did. `Blurry`, `Lesser
  // Displacement` and `Crown of Summer` are boolean composites: their components
  // are ADDITIVE and the boolean itself stays targetable as presence, precisely so
  // the carrier item can still be forced in. Aliasing them away would substitute
  // that presence target into its components and silently drop the item.
  const v = buildPickerVocabulary(realData);
  const native = new Set();
  for (const it of realData.items || []) {
    for (const a of it.affixes || []) if (a && a.via == null && a.name) native.add(a.name);
    for (const t of it.parsed_set_bonuses || []) {
      for (const a of t.affixes || []) if (a && a.via == null && a.stat) native.add(a.stat);
    }
  }
  const destroyed = [...native].filter((n) => expandedAwayFor(v, n));
  assert.deepStrictEqual(destroyed, [],
    `these stats are still carried by real affixes but resolve as aliases: ${JSON.stringify(destroyed)}`);
  for (const composite of ["Blurry", "Lesser Displacement", "Crown of Summer"]) {
    assert.ok(v.suggestions.includes(composite), `${composite} stays selectable`);
    assert.strictEqual(expandedAwayFor(v, composite), null,
      `${composite} must resolve to ITSELF, not be substituted into its components`);
  }
});

test("U10: no label collides with a bare bonus-type token", () => {
  const v = buildPickerVocabulary(realData);
  const BONUS_TYPES = ["Alchemical", "Artifact", "Competence", "Deific", "Enhancement",
    "Equipment", "Exceptional", "Fatesinger", "Festive", "Insight", "Insightful",
    "Legendary", "Primal", "Profane", "Quality", "Resistance", "Sacred"];
  const hits = BONUS_TYPES.filter((t) => v.provenanceLabels[t.toLowerCase()]);
  assert.deepStrictEqual(hits, [], `bare bonus-type tokens admitted as labels: ${hits}`);
});

test("U10: every label resolves to at least one stat that is itself rankable", () => {
  // A label that substituted into a name nothing carries would trade a working
  // priority for a dead one.
  const v = buildPickerVocabulary(realData);
  for (const [key, stats] of Object.entries(v.provenanceLabels)) {
    assert.ok(stats.length, `${key} resolves to nothing`);
    assert.ok(stats.some((s) => v.known.has(s)), `${key} -> ${stats} — none are known affixes`);
  }
});

test("U10: the label set is derived from the dataset, not from a family list", () => {
  // An eighth expansion family must be picked up with no registration step. Stamp
  // a brand-new label onto a synthetic dataset and require the picker to learn it.
  const ds = {
    metadata: { rankable_affixes: ["Dodge", "Sneak Attack Dice"] },
    items: [{ affixes: [
      { name: "Dodge", type: "Enhancement", value: 5, via: "Eldritch Nimbleness" },
      { name: "Sneak Attack Dice", type: "Enhancement", value: 3, via: "Eldritch Nimbleness" },
    ] }],
  };
  const v = buildPickerVocabulary(ds);
  assert.deepStrictEqual(v.provenanceLabels["eldritch nimbleness"],
    ["Dodge", "Sneak Attack Dice"], "a never-registered family is learned by scanning");
  assert.ok(v.suggestions.includes("Eldritch Nimbleness"));
  assert.deepStrictEqual(expandedAwayFor(v, "Eldritch Nimbleness"), ["Dodge", "Sneak Attack Dice"]);
});

test("U10: the browser fallback carries the labels for a stale cached dataset", () => {
  // A dataset cached before `provenance_labels` existed still has to rank the names
  // the surfaces print, exactly as EXPANDED_AWAY_FALLBACK does for the bare names. It
  // is a real catalog, so it carries the school gear — it just has no metadata and no
  // `via` stamps. The constant is all that is left.
  const stale = {
    metadata: { rankable_affixes: [...SCHOOLS, "Dodge"] },
    items: [{ affixes: [...SCHOOLS.map((s) => ({ name: s, type: "Sacred", value: 3 })),
                        { name: "Dodge", type: "Enhancement", value: 5 }] }],
  };
  const v = buildPickerVocabulary(stale);
  assert.deepStrictEqual(expandedAwayFor(v, "Sacred Spell Focus Mastery"), SCHOOLS);
  assert.ok(v.suggestions.includes("Sacred Spell Focus Mastery"));
  // and the mirror does not leak names this catalog cannot satisfy
  assert.ok(!v.suggestions.includes("Parrying"),
    "no Parrying gear here, so offering it would be a dead entry");
});

test("U10: the shipped fallback agrees with what the build actually stamps", () => {
  // The fallback is a mirror, and a mirror drifts. Every entry it claims must
  // match the live build — being INCOMPLETE is fine (a newer family implies a
  // newer dataset, which carries the metadata), being WRONG is not.
  const { PROVENANCE_LABEL_FALLBACK } = require("../web/dataset.js");
  const live = realData.metadata.provenance_labels || {};
  assert.ok(Object.keys(PROVENANCE_LABEL_FALLBACK).length >= 10, "the mirror is not empty");
  for (const [label, stats] of Object.entries(PROVENANCE_LABEL_FALLBACK)) {
    assert.deepStrictEqual(stats, live[label], `fallback drifted for "${label}"`);
  }
});

// --- U11 (R15): the picker substitution reuses the saved-load machinery -------

test("U11: a label substitutes into consecutive priorities in declared order", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const out = migratePriorities(["Constitution", "Sacred Spell Focus Mastery"], v);
  assert.deepStrictEqual(out.priorities, ["Constitution", ...SCHOOLS]);
  assert.deepStrictEqual(out.substitutions, [{ from: "Sacred Spell Focus Mastery", to: SCHOOLS }]);
});

test("U11: a priority ranked BELOW the alias is displaced, not dropped", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const out = migratePriorities(["Constitution", "Parrying", "Dodge"], v);
  assert.deepStrictEqual(out.priorities,
    ["Constitution", "Armor Class", "Fortitude Save", "Reflex Save", "Will Save", "Dodge"]);
  assert.strictEqual(out.priorities.indexOf("Dodge"), 5, "Dodge moved down four ranks");
  assert.ok(out.priorities.includes("Dodge"), "and survived — displaced, never dropped");
});

test("U11: components occupy SEPARATE lexicographic tiers, never one combined term", () => {
  // Non-goal: weighted-sum trade-off modes. Folding seven schools into one
  // objective term would silently trade the player's top stat away.
  const { migratePriorities } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const out = migratePriorities(["Sacred Spell Focus Mastery"], v);
  assert.strictEqual(out.priorities.length, 7, "seven ranks, not one");
  for (const p of out.priorities) {
    assert.ok(!/[+,&]|\band\b/.test(p), `"${p}" reads like a combined term`);
    assert.ok(v.known.has(p), `"${p}" is a real rankable stat on its own`);
  }
});

test("U11: adding a label whose components are already ranked does not duplicate them", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const out = migratePriorities(["Armor Class", "Parrying"], v);
  assert.deepStrictEqual(out.priorities,
    ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"]);
  assert.strictEqual(out.priorities.filter((p) => p === "Armor Class").length, 1);
  assert.strictEqual(out.substitutions.length, 1, "the substitution is still disclosed");
});

test("U11: the picker disclosure names the substitution and its rank cost", () => {
  const { migratePriorities, migrationMessage } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const subs = migratePriorities(["Sacred Spell Focus Mastery"], v).substitutions;
  const msg = migrationMessage(subs, [], [], { lead: "picker" });
  assert.ok(msg, "a substitution is disclosed");
  assert.ok(/Sacred Spell Focus Mastery/.test(msg), "it names what was selected");
  assert.ok(/Necromancy Focus/.test(msg), "and what it became");
  assert.ok(/rank/i.test(msg), "and that each component costs a rank");
  assert.ok(!/This character ranked/.test(msg),
    "the picker wording is not the saved-character wording");
});

test("U11: the saved-character wording is unchanged when no lead is passed", () => {
  const { migrationMessage } = require("../web/dataset.js");
  const msg = migrationMessage([{ from: "Parrying", to: ["Armor Class"] }]);
  assert.ok(/This character ranked/.test(msg), msg);
});

test("U11: a bound and a credit dropped by a picker substitution are both disclosed", () => {
  const { migrationMessage } = require("../web/dataset.js");
  const subs = [{ from: "Parrying", to: ["Armor Class", "Fortitude Save"] }];
  const msg = migrationMessage(subs, ["Parrying"], ["Parrying"], { lead: "picker" });
  assert.ok(/min\/max/.test(msg), "the dropped bound is named");
  assert.ok(/already have/.test(msg), "and the dropped credit separately");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
