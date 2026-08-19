// U2 — load-time dataset normalizer. Run: node tests/dataset.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeItem, buildPickerVocabulary, expandedAwayFor, expandedAwayMessage, normalizeDataset } = require("../web/dataset.js");
const P = require("../web/projection.js");
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
// #253 — the BARE label is stamped again. 6316c11 withheld it while 283
// set-bonus tier affixes carried a bare `Sheltering` the expansion never
// reached (the name read as a live native stat, so the collision guard dropped
// the label from the picker and the stamp displayed a name the picker refused).
// The set-bonus channel now expands too, so no channel carries the bare name
// as a live stat and the label resolves like the typed ones.
test("R12/#253: bare Sheltering's halves are stamped with the engraved name", () => {
  const it = { affixes: [{ name: "Sheltering", value: 30, type: "Enhancement" }] };
  normalizeItem(it);
  assert.strictEqual(find(it, "Physical Sheltering").via, "Sheltering");
  assert.strictEqual(find(it, "Magical Sheltering").via, "Sheltering");
});

// Build the vocabulary from the SAME normalized data the stamps come from --
// browser-side expansions (the typed Shelterings) only exist after normalizeDataset,
// so a vocabulary built from the raw artifact would not carry their labels and the
// comparison would be meaningless in both directions.
test("R13 invariant: every stamped label is admitted by the picker", () => {
  const v = buildPickerVocabulary(realData);
  const stamped = new Set();
  for (const it of realData.items) for (const a of (it.affixes || [])) if (a.via) stamped.add(a.via);
  assert.ok(stamped.size > 0, "the scan found labels at all -- a vacuous pass would hide everything");
  const orphans = [...stamped].filter((l) => !v.suggestions.includes(l) && !expandedAwayMessage(v, l));
  assert.deepStrictEqual(orphans, [],
    "a name the item surfaces display must be one the picker offers or resolves");
});

// #253 — the set-bonus half of the same expansion. A tier's affixes are
// legacy-shaped ({stat, bonus_type}); the solver reads them via setTiers, so a
// bare `Sheltering` here named a stat no target matches and granted nothing.
test("#253: a set tier's bare Sheltering expands into both halves, stamped", () => {
  const it = { affixes: [], parsed_set_bonuses: [{ set: "S", pieces_required: 3,
    affixes: [{ stat: "Sheltering", bonus_type: "Artifact", value: 55 }] }] };
  normalizeItem(it);
  const affs = it.parsed_set_bonuses[0].affixes;
  const phys = affs.find((a) => a.stat === "Physical Sheltering");
  const mag = affs.find((a) => a.stat === "Magical Sheltering");
  assert.ok(phys && mag, "both halves emitted");
  assert.strictEqual(phys.value, 55);
  assert.strictEqual(phys.bonus_type, "Artifact", "bonus type carries through");
  assert.strictEqual(phys.via, "Artifact Sheltering", "stamped with the typed name");
  assert.ok(!affs.some((a) => a.stat === "Sheltering"), "the bare stat is gone");
});

test("#253: a tier half the set already states is not duplicated", () => {
  const it = { affixes: [], parsed_set_bonuses: [{ set: "S", pieces_required: 2,
    affixes: [
      { stat: "Sheltering", bonus_type: "Profane", value: 25 },
      { stat: "Physical Sheltering", bonus_type: "Profane", value: 30 },
    ] }] };
  normalizeItem(it);
  const affs = it.parsed_set_bonuses[0].affixes;
  assert.strictEqual(affs.filter((a) => a.stat === "Physical Sheltering").length, 1,
    "the explicit half wins");
  assert.strictEqual(affs.find((a) => a.stat === "Physical Sheltering").value, 30);
  assert.ok(affs.some((a) => a.stat === "Magical Sheltering" && a.value === 25),
    "the missing half is still expanded");
});

test("#253: after normalize, NO channel carries bare Sheltering as a live stat", () => {
  // This is the fact that lets the bare label back onto the picker: the 283
  // set-tier affixes (and the 2 membership-def ones) are all expanded.
  const bare = [];
  for (const it of realData.items) {
    for (const a of it.affixes || []) if ((a.name != null ? a.name : a.stat) === "Sheltering") bare.push("item");
    for (const t of it.parsed_set_bonuses || []) for (const a of t.affixes || []) if (a.stat === "Sheltering") bare.push(`set:${t.set}`);
  }
  for (const defs of [realData.membership_set_defs, realData.augment_set_defs]) {
    for (const [name, def] of Object.entries(defs || {})) {
      for (const t of def.tiers || []) for (const a of t.affixes || []) if (a.stat === "Sheltering") bare.push(`def:${name}`);
    }
  }
  assert.deepStrictEqual(bare, []);
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

// #91 (U3, KTD1) — the Utility tier's sentinel rides the priority list as a
// token, so it must never collide with anything a priority can legitimately
// name: a dataset affix, a picker vocabulary entry, or an alias key (a
// collision would let real gear score against — or be rewritten into — the
// tier row). Checked against the BUILT catalog so a future harvest that ships
// an affix literally named "Utility effects" fails here, not in a solve.
test("#91 U3: the Utility sentinel collides with no affix name, vocab entry, or alias key", () => {
  const SENT = require("../web/model.js").UTILITY_SENTINEL;
  assert.strictEqual(typeof SENT, "string");
  assert.ok(SENT.length > 0);
  // (1) no affix NAME on any source: item affixes, scaling stats, set-tier stats.
  const affixNames = new Set();
  for (const it of realData.items || []) {
    for (const a of it.affixes || []) { affixNames.add(a.name); if (a.stat) affixNames.add(a.stat); }
    for (const s of it.scaling || []) affixNames.add(s.stat);
    for (const t of it.parsed_set_bonuses || []) for (const a of t.affixes || []) affixNames.add(a.stat);
  }
  assert.ok(!affixNames.has(SENT), "no dataset affix carries the sentinel as its name");
  // (2) no picker vocabulary entry — known is the unfiltered union of every
  // affix source plus the registry, so this covers the crafting pools too.
  const v = buildPickerVocabulary(realData);
  assert.ok(!v.known.has(SENT), "the sentinel is not a known/free-typeable affix name");
  assert.ok(!v.suggestions.includes(SENT), "the sentinel is not a picker suggestion");
  assert.ok(!v.utilityCounting.has(SENT), "the sentinel is not itself a counted effect");
  // (3) no alias key or alias target — canonicalization must be identity on it.
  const aliases = (realData.metadata || {}).affix_aliases || {};
  assert.ok(!Object.prototype.hasOwnProperty.call(aliases, SENT), "the sentinel is not an alias key");
  assert.ok(!Object.values(aliases).includes(SENT), "no alias resolves TO the sentinel");
  assert.strictEqual(v.canonical(SENT), SENT, "canonical() leaves the sentinel untouched");
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

// U5 expanded these away so no item carries the compound name; U10 then made the
// names the item surfaces DISPLAY rankable, and U8 displays exactly these three on
// the Crown of Ioun. So a compound is expanded away AND suggested — the earlier
// blanket "expanded-away is never suggested" rule would hide the very name the
// results print, which is the mismatch R13/R14 exist to close. What it must never
// be is a bucket of its own: ranking it substitutes its components.
test("U5/#249 + U10/R14: a compound absorption name is expanded away yet still rankable", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const [compound, components] of [
    ["Fire and Cold Absorption", ["Fire Absorption", "Cold Absorption"]],
    ["Electricity and Acid Absorption", ["Electric Absorption", "Acid Absorption"]],
    ["Elemental Absorption", ["Acid Absorption", "Cold Absorption", "Fire Absorption",
                              "Electric Absorption", "Sonic Absorption"]],
  ]) {
    assert.ok(v.suggestions.includes(compound),
      `${compound} is suggested — the item surfaces print it as the origin`);
    const msg = expandedAwayMessage(v, compound);
    assert.ok(msg, `${compound} still resolves rather than becoming a bucket`);
    for (const c of components) assert.ok(msg.includes(c), `${compound} resolves to ${c}`);
    assert.ok(v.suggestions.includes(components[0]),
      `${components[0]} remains independently rankable`);
  }
});

test("U5/#249: a stale dataset still drops the compound absorption names", () => {
  // The browser-side fallback. A cached dataset built before this family shipped
  // carries the compound names in `rankable_affixes` with no metadata entry to
  // remove them, so without the fallback the picker offers a name that — on the
  // freshly-built dataset the solve runs against — no item carries.
  const stale = buildPickerVocabulary({ metadata: { rankable_affixes: [
    "Fire and Cold Absorption", "Electricity and Acid Absorption",
    "Elemental Absorption", "Fire Absorption"] } });
  for (const compound of ["Fire and Cold Absorption", "Electricity and Acid Absorption",
                          "Elemental Absorption"]) {
    assert.ok(!stale.suggestions.includes(compound), `${compound} dropped via the fallback constant`);
    assert.ok(expandedAwayFor(stale, compound), `${compound} still redirects`);
  }
  assert.ok(stale.suggestions.includes("Fire Absorption"), "the component stat is untouched");
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
// A boolean composite is the ONE expansion family that must NOT carry the
// provenance stamp. Every other family REPLACES the affix it expands, so the
// engraved name would be lost and R8's collapse restores it. This one is
// ADDITIVE — the composite stays on the item — so the engraved name is already
// on screen. Stamping it made the collapse fold `Concealment +20 Enhancement`
// into a second line reading `Blurry +20` beside the item's own `Blurry +1
// Bool`: the same name twice, two unrelated numbers, the component's own stat
// gone, and a magnitude attached to an enchantment whose in-game cell states
// none. 140 items carried that shape.
test("R12: a boolean composite's derived component is NOT stamped", () => {
  const it = { affixes: [{ name: "Crown of Summer", type: "Bool", value: 1 }] };
  normalizeItem(it);
  for (const n of ["Healing Amplification", "Melee Power", "Ranged Power"]) {
    assert.ok(!("via" in find(it, n)),
      `${n} keeps its own stat name — the composite is still on the item beside it`);
  }
  assert.ok(!("via" in find(it, "Crown of Summer")), "the boolean itself is native, not derived");
});

test("R12: a composite and its component never render as the same name twice", () => {
  const it = { affixes: [{ name: "Blurry", type: "Bool", value: 1 }] };
  normalizeItem(it);
  const labels = P.collapseExpansions(it.affixes).map(P.affixLabel);
  // #353 — this asserted the literal "Blurry +1 Bool", which was the DEFECT: a
  // Bool-typed affix must render as a presence tick, not a magnitude. The test's
  // intent (the composite states its own presence, exactly once) is unchanged.
  assert.ok(labels.includes("✓ Blurry"), "the composite states its own presence");
  assert.ok(labels.some((l) => /^Concealment \+20/.test(l)),
    "the component keeps its stat name and magnitude");
  // #353 — match on MENTION, not prefix: the presence label is "✓ Blurry", so a
  // startsWith("Blurry") count reads 0 once the rendering is correct. The intent
  // is unchanged — exactly one line names Blurry.
  assert.strictEqual(labels.filter((l) => /Blurry/.test(l)).length, 1,
    "exactly one Blurry line — a stamped component would produce a second, `Blurry +20`");
});

test("when two composites contribute one stat, the higher magnitude survives", () => {
  const it = { affixes: [
    { name: "Blurry", type: "Bool", value: 1 },
    { name: "Lesser Displacement", type: "Bool", value: 1 },
  ] };
  normalizeItem(it);
  const conceal = it.affixes.filter((a) => a.name === "Concealment");
  assert.strictEqual(conceal.length, 1, "one line, not one per composite");
  assert.strictEqual(Number(conceal[0].value), 25, "the 25% source wins, not the 20% one");
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
  // #211 re-ratification: bare `Resistance` is BOTH a bonus-type word AND the
  // classic all-saves enchantment, now a registered expansion label — offering
  // it is deliberate, and picking it substitutes the three saves (the U11
  // machinery), never ranks the literal token. Any OTHER type-only name still
  // fails. The exemption is exactly the expanded-away registration.
  // Pinned to the one proven name (close-a-defect-at-the-narrow-control): a
  // future registered family whose key equals a bonus-type word argues its own
  // exemption here with evidence, never inherits this one.
  const exempt = new Set(["resistance"]);
  assert.deepStrictEqual(typeOnly.filter((s) => !exempt.has(s.trim().toLowerCase())), [],
    `a name that only ever appears as a bonus type is not rankable; offered: ${JSON.stringify(typeOnly)}`);
});


// --- #211: declared-credit migration through the expanded-away map ------------

test("#211: a credit on an expanded-away name splits into per-component credits", () => {
  const { migrateCredits } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const { credits, substitutions } = migrateCredits({
    "Combat Mastery||Insight": { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
    "Devotion||Sacred": { stat: "Devotion", bonus_type: "Sacred", value: 12 },
  }, v);
  // The Battle Trance credit becomes one credit per tactic, full magnitude —
  // the enchantment grants full value to every component.
  assert.deepStrictEqual(credits["Stunning||Insight"],
    { stat: "Stunning", bonus_type: "Insight", value: 7 });
  assert.deepStrictEqual(credits["Vertigo||Insight"],
    { stat: "Vertigo", bonus_type: "Insight", value: 7 });
  assert.deepStrictEqual(credits["Shatter||Insight"],
    { stat: "Shatter", bonus_type: "Insight", value: 7 });
  assert.ok(!credits["Combat Mastery||Insight"], "the expanded-away key is gone");
  // A credit on a live stat passes through untouched.
  assert.deepStrictEqual(credits["Devotion||Sacred"],
    { stat: "Devotion", bonus_type: "Sacred", value: 12 });
  assert.deepStrictEqual(substitutions,
    [{ from: "Combat Mastery", to: ["Stunning", "Vertigo", "Shatter"] }]);
});


test("#211: a credit on a NON-splittable expanded-away name stays untouched", () => {
  // `elemental resistance` redirects to the UNION of five (Sonic is per-item):
  // splitting a credit would fabricate a Sonic Resistance value for the
  // 52-of-58 carriers that grant none. Inert beats invented.
  const { migrateCredits } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const { credits, substitutions } = migrateCredits({
    "Elemental Resistance||Enhancement": { stat: "Elemental Resistance", bonus_type: "Enhancement", value: 40 },
  }, v);
  assert.deepStrictEqual(credits["Elemental Resistance||Enhancement"],
    { stat: "Elemental Resistance", bonus_type: "Enhancement", value: 40 });
  assert.ok(!credits["Sonic Resistance||Enhancement"], "no fabricated component credit");
  assert.deepStrictEqual(substitutions, []);
});

test("#211: colliding migrated credits keep the larger value, either order", () => {
  const { migrateCredits } = require("../web/dataset.js");
  const v = buildPickerVocabulary(realData);
  const umbrella = { stat: "Combat Mastery", bonus_type: "Insight", value: 7 };
  const component = { stat: "Stunning", bonus_type: "Insight", value: 9 };
  for (const m of [
    { a: umbrella, b: component },
    { a: component, b: umbrella },
  ]) {
    const { credits } = migrateCredits({ k1: m.a, k2: m.b }, v);
    assert.strictEqual(credits["Stunning||Insight"].value, 9,
      "highest-of-type wins regardless of insertion order");
    assert.strictEqual(credits["Vertigo||Insight"].value, 7,
      "non-colliding components keep the umbrella value");
  }
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

// --- helpless-fold review: saved priorities carrying a picker ALIAS ------------
// The helpless-damage fold re-pointed 11 picker aliases at one canonical stat.
// migratePriorities substituted only expanded-away names, so a character saved
// pre-fold with `Additional Damage to Helpless Targets` ranked restored to a
// priority matching nothing — scoring zero silently, the exact defect class the
// expanded-away migration exists to prevent. Aliased names now resolve through
// the same alias table the picker uses (`vocab.canonical`).

const ALIAS_VOCAB = {
  expandedAway: {
    "parrying": ["Armor Class", "Fortitude Save", "Reflex Save", "Will Save"],
  },
  known: new Set(["Strength", "Dodge", "Armor Class", "Fortitude Save",
                  "Reflex Save", "Will Save", "Damage to helpless enemies"]),
  canonical: (n) => {
    const aliases = { "Additional Damage to Helpless Targets": "Damage to helpless enemies" };
    const t = String(n == null ? "" : n).trim();
    return (aliases[t] != null) ? aliases[t] : t;
  },
};

test("alias-fold: a saved aliased priority migrates to its canonical, disclosed", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Strength", "Additional Damage to Helpless Targets"], ALIAS_VOCAB);
  assert.deepStrictEqual(out.priorities, ["Strength", "Damage to helpless enemies"]);
  assert.deepStrictEqual(out.substitutions,
    [{ from: "Additional Damage to Helpless Targets", to: ["Damage to helpless enemies"] }]);
});

test("alias-fold: an aliased name alongside its canonical dedupes, still disclosed", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(
    ["Damage to helpless enemies", "Additional Damage to Helpless Targets"], ALIAS_VOCAB);
  assert.deepStrictEqual(out.priorities, ["Damage to helpless enemies"]);
  assert.strictEqual(out.substitutions.length, 1, "the substitution is still disclosed");
});

test("alias-fold: a genuinely unknown non-aliased name keeps current behavior", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Totally Made Up Stat"], ALIAS_VOCAB);
  assert.deepStrictEqual(out.priorities, ["Totally Made Up Stat"], "passes through untouched");
  assert.strictEqual(out.substitutions.length, 0);
});

test("alias-fold: a known rankable name is untouched", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Strength", "Damage to helpless enemies"], ALIAS_VOCAB);
  assert.deepStrictEqual(out.priorities, ["Strength", "Damage to helpless enemies"]);
  assert.strictEqual(out.substitutions.length, 0, "no disclosure when nothing changed");
});

test("alias-fold: migration stays idempotent with a canonical-bearing vocab", () => {
  const { migratePriorities } = require("../web/dataset.js");
  const once = migratePriorities(["Additional Damage to Helpless Targets"], ALIAS_VOCAB).priorities;
  const twice = migratePriorities(once, ALIAS_VOCAB);
  assert.deepStrictEqual(twice.priorities, once);
  assert.strictEqual(twice.substitutions.length, 0);
});

test("alias-fold: a prototype-chain name does not resolve through the alias table", () => {
  const { migratePriorities } = require("../web/dataset.js");
  // `aliases[t] != null` walks the prototype chain, so `constructor` yields the
  // Object FUNCTION — the same hazard expandedAwayFor already defends against.
  for (const hostile of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    const out = migratePriorities([hostile], ALIAS_VOCAB);
    assert.deepStrictEqual(out.priorities, [hostile], `${hostile} passes through untouched`);
    assert.strictEqual(out.substitutions.length, 0);
  }
});

test("alias-fold: the built dataset's real alias table drives the migration", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  const { migratePriorities } = require("../web/dataset.js");
  const out = migratePriorities(["Additional Damage to Helpless Targets"], v);
  assert.deepStrictEqual(out.priorities, ["Damage to helpless enemies"]);
  assert.strictEqual(out.substitutions.length, 1, "the substitution is disclosed");
  assert.ok(v.suggestions.includes("Damage to helpless enemies"),
    "the replacement is a real rankable target");
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
// #231 (2026-08-12) — the named-looking candidates were adjudicated against the
// wiki. Eight moved to PRESENCE_ALLOW (see web/dataset.js for the per-name
// evidence). The ones below that LOOK named were checked and ruled OUT — do not
// re-raise them:
//   * `Greater Bane of the Unnatural`, all four `... Litany of the Crimson
//     Covenant`, `Legendary Cooking By the Book`, `Epic Slice 'n Dice Set` —
//     no wiki page exists under the name (404); each is described only on its
//     carrier's item page. (Bare `Cooking By the Book` is already suggested.)
//   * `Embrace of the Spider Queen` — the page under that name is the ARMOR
//     ITEM from Reclaiming the Rift, not an effect page; the Bool line on Holy
//     Symbol of Lolth has no effect page of its own.
const WORD_CAP_CASUALTIES = [
  "1 Positive Healing every minute",
  "1 to 4 Light Damage",
  "1 to 6 Bane damage on hit vs Undead",
  "1 to 8 Cold Damage",
  "6 to 36 bonus Rust damage on hit vs Constructs",
  "Additional 2d8 Bane Damage to Fey creatures on hit",
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
  "Magnetism +108 (only from chest)",
  "Magnetism +66 (only from chest)",
  "Nut-hull Toffee Surprise (Lasting Stoneskin, CL 10, 10 minutes)",
  "Second Litany of the Crimson Covenant",
  // Re-ratified 2026-08-18 (#374/U6, cause #380). The item is not new; its
  // ENCODING is. The previous dump stored it key-less with a numeric value
  // (`{name, value: "6"}`), so it sat in the untyped-magnitude population and
  // never reached the presence scan at all. The refresh re-encoded it as
  // `{type: "Bool", value: 1}` on all six carriers, which moves it into the
  // presence population — where its five words put it over the word cap, exactly
  // as the cap intends. The population moved; the cap did not.
  "The Dragging of the Depths",
  "Third Litany of the Crimson Covenant",
  "Vitality +20 (only from chain end reward)",
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

// #231 — the eight adjudicated names. Suggested + presence-flagged, same shape
// as the KICK assertions above; pinned here so a rebuild that drops a carrier
// (or a PRESENCE_ALLOW edit that loses one) fails loudly.
const ADJUDICATED_231 = [
  "Way of the Sun Soul",
  "Lifeblood of the Undead Prince",
  "Path of the Fire Dragon",
  "Path of the Guarding Stone",
  "Brilliance of the Shattered Sun",
  "Vile Grip of the Hidden Hand",
  "Legendary Vile Grip of the Hidden Hand",
  "Legendary Tet-zik, The Enlightened Change",
];

test("#231: every adjudicated named effect is suggested as a presence feature", () => {
  const v = buildPickerVocabulary(realData);
  for (const name of ADJUDICATED_231) {
    assert.ok(v.suggestions.includes(name), `${name} is offered as a suggestion`);
    assert.ok(v.presence.has(name), `${name} is flagged presence, not magnitude`);
    assert.ok(!v.magnitude.has(name), `${name} has no rankable bucket`);
  }
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
  // #211 re-ratification: bare `Resistance` is a registered expansion family
  // (the classic all-saves enchantment), so its label is a deliberate
  // registration — the accident this guard catches is a family emitting a
  // bare type PREFIX with no base name. Mirrors the Python guard in
  // tests/test_provenance.py.
  // Pinned to the one proven name (see the sibling picker gate above).
  const exempt = new Set(["resistance"]);
  const hits = BONUS_TYPES.filter((t) => v.provenanceLabels[t.toLowerCase()]
    && !exempt.has(t.toLowerCase()));
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

test("#255: the scan UNIONS into a declared expansion, never replaces it", () => {
  // The scan is a subset of the declaration by construction — an expansion skips a
  // component the item already carries explicitly. If every carrier of a family
  // shadows the same component, a scan that REPLACED the declared list would
  // substitute the label into fewer stats than the family declares, and the player
  // silently loses a rank they asked for. Declare two components, stamp only one.
  const ds = {
    metadata: {
      rankable_affixes: ["Dodge", "Sneak Attack Dice"],
      expanded_away_names: { "eldritch nimbleness": ["Dodge", "Sneak Attack Dice"] },
    },
    items: [{ affixes: [
      { name: "Dodge", type: "Enhancement", value: 5, via: "Eldritch Nimbleness" },
      { name: "Sneak Attack Dice", type: "Enhancement", value: 3 },
    ] }],
  };
  const v = buildPickerVocabulary(ds);
  assert.deepStrictEqual(v.provenanceLabels["eldritch nimbleness"], ["Dodge"],
    "the scan itself still reports only what the stamps show");
  assert.deepStrictEqual(expandedAwayFor(v, "Eldritch Nimbleness"),
    ["Dodge", "Sneak Attack Dice"],
    "the substitution map keeps the full declared component list");
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

test("#255: the expanded-away fallback agrees with what the build actually emits", () => {
  // Same mirror, same drift hazard as the provenance-label fallback above: renaming
  // a component in src/absorption_split.py (or any expanding family) must not leave
  // a stale-cache player redirected to a name the current build no longer carries.
  // Being INCOMPLETE is fine — a newer family implies a newer dataset, which carries
  // the metadata — being WRONG is not.
  const { EXPANDED_AWAY_FALLBACK } = require("../web/dataset.js");
  const live = realData.metadata.expanded_away_names || {};
  assert.ok(Object.keys(EXPANDED_AWAY_FALLBACK).length >= 8, "the mirror is not empty");
  for (const [key, stats] of Object.entries(EXPANDED_AWAY_FALLBACK)) {
    assert.deepStrictEqual(stats, live[key], `fallback drifted for "${key}"`);
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

// #289 — the Esoterica Set Augment's 3-piece bonus arrives expanded: seven
// rankable school stats at Artifact with a provenance receipt, and no def or
// dino-set channel still carries the unrankable universal name "Spell DCs".
test("#289: Esoterica def is school-creditable and no def channel carries Spell DCs", () => {
  const eso = (realData.augment_set_defs || {}).Esoterica;
  assert.ok(eso, "Esoterica def present");
  const affixes = eso.tiers[0].affixes;
  const schools = affixes.map((a) => a.stat).sort();
  assert.deepStrictEqual(schools, ["Abjuration Focus", "Conjuration Focus",
    "Enchantment Focus", "Evocation Focus", "Illusion Focus",
    "Necromancy Focus", "Transmutation Focus"]);
  for (const a of affixes) {
    assert.strictEqual(a.bonus_type, "Artifact");
    assert.strictEqual(a.value, 3);
    assert.strictEqual(a.via, "Artifact Spell DCs", "receipt names the source");
  }
  const leaks = [];
  for (const defs of [realData.membership_set_defs, realData.augment_set_defs]) {
    for (const [name, def] of Object.entries(defs || {})) {
      for (const t of def.tiers || []) for (const a of t.affixes || []) {
        if (a.stat === "Spell DCs") leaks.push(`def:${name}`);
      }
    }
  }
  for (const s of realData.dino_sets || []) {
    for (const a of s.affixes || []) if (a.stat === "Spell DCs") leaks.push(`dino:${s.set}`);
  }
  assert.deepStrictEqual(leaks, []);
  // Positive assertion for the dino channel: name-absence alone would also pass
  // if the affix were silently DROPPED — assert the seven schools actually landed.
  // Re-ratified under U4: the parse-time synonym fold now canonicalizes the
  // wiki's "Spell DCs" to "Spell Focus Mastery" BEFORE expansion, so the via
  // receipt names the folded source (the raw wiki text is preserved in s.raw).
  const curse = (realData.dino_sets || []).find((s) => s.set === "The Legendary Dread Isle's Curse");
  assert.ok(curse, "the Dread Isle's Curse dino set is present");
  const dcs = curse.affixes.filter((a) => a.via === "Profane Spell Focus Mastery");
  assert.deepStrictEqual(dcs.map((a) => a.stat).sort(), ["Abjuration Focus",
    "Conjuration Focus", "Enchantment Focus", "Evocation Focus",
    "Illusion Focus", "Necromancy Focus", "Transmutation Focus"]);
  for (const a of dcs) { assert.strictEqual(a.bonus_type, "Profane"); assert.strictEqual(a.value, 2); }
});

// U4 — the dino_sets channel spells Universal Spell Power canonically. The wiki
// tier text says "Universal Spellpower"; the parse-time synonym fold normalizes
// the `stat` field while `raw` keeps the verbatim wiki text. Positive assertion
// included so a silently-dropped affix cannot pass as name-absence.
test("U4: dino_sets carries canonical Universal Spell Power, raw stays verbatim", () => {
  const sets = realData.dino_sets || [];
  assert.ok(sets.length > 0, "dino_sets channel present and non-empty");
  const misspelled = [];
  for (const s of sets) {
    for (const a of s.affixes || []) {
      if (a.stat === "Universal Spellpower") misspelled.push(s.set);
    }
  }
  assert.deepStrictEqual(misspelled, []);
  const carriers = sets.filter((s) =>
    (s.affixes || []).some((a) => a.stat === "Universal Spell Power")).map((s) => s.set).sort();
  assert.deepStrictEqual(carriers, ["Deacon of the Auricular Sacrarium",
    "Defender of Tanaroa", "The Legendary Dread Isle's Curse"]);
  const rawCarriers = sets.filter((s) => (s.raw || "").includes("Universal Spellpower"));
  assert.strictEqual(rawCarriers.length, 3, "verbatim wiki raw text untouched");
});

// #305 — ONE wiki-verified helpless-damage mechanic (docs/wiki-evidence/
// helpless-damage.md) was fragmented across ~12 spellings, so a `Damage to
// helpless enemies` priority credited only the two Solar Gem of Cruelty
// affixes and ~19 sets scored zero. The pipeline now folds every set-channel
// spelling to the canonical (scoped family fold, never the full synonym
// registry); `raw` stays verbatim. Positive assertions included so a
// silently-dropped affix cannot pass as name-absence.
test("#305: every solver channel carries only 'Damage to helpless enemies'; raw verbatim", () => {
  const CANON = "Damage to helpless enemies";
  const away = new Set([
    "Additional Damage to Helpless Targets", "Damage vs the Helpless",
    "Damage vs. Helpless", "Damage vs. Helpless Opponents",
    "Damage vs. Helpless opponents", "Damage vs. the Helpless",
    "Helplessness Damage", "damage versus the Helpless",
    "damage vs the Helpless", "damage vs. helpless", "damage vs. the helpless",
  ]);
  const leaks = [];
  for (const v of realData.items) {
    for (const a of v.affixes || []) {
      if (away.has(a.name) || away.has(a.stat)) leaks.push(`item:${v.variant_id}`);
    }
    for (const t of v.parsed_set_bonuses || []) {
      for (const a of t.affixes || []) if (away.has(a.stat)) leaks.push(`tier:${t.set}`);
    }
  }
  for (const [chan, defs] of [["membership", realData.membership_set_defs],
                              ["augment", realData.augment_set_defs]]) {
    for (const [name, def] of Object.entries(defs || {})) {
      for (const t of def.tiers || []) {
        for (const a of t.affixes || []) if (away.has(a.stat)) leaks.push(`${chan}:${name}`);
      }
    }
  }
  for (const s of realData.dino_sets || []) {
    for (const a of s.affixes || []) if (away.has(a.stat)) leaks.push(`dino:${s.set}`);
  }
  assert.deepStrictEqual(leaks, [], "no fold-away helpless spelling in any solver channel");
  // item-attached tiers: Silent Avenger (Legendary) grants the canonical (Artifact)
  const saTiers = [];
  for (const v of realData.items) {
    for (const t of v.parsed_set_bonuses || []) {
      if (t.set !== "Silent Avenger (Legendary)") continue;
      for (const a of t.affixes || []) if (a.stat === CANON) saTiers.push(a);
    }
  }
  assert.ok(saTiers.length > 0, "Silent Avenger (Legendary) tiers carry the canonical");
  for (const a of saTiers) assert.strictEqual(a.bonus_type, "Artifact");
  // membership defs: Dread Stalker grants Artifact 15 under the canonical
  const ds = realData.membership_set_defs["Dread Stalker"];
  const dsHits = [];
  for (const t of ds.tiers || []) {
    for (const a of t.affixes || []) if (a.stat === CANON) dsHits.push(a);
  }
  assert.ok(dsHits.some((a) => a.bonus_type === "Artifact" && a.value === 15),
    "Dread Stalker membership def credits the canonical");
  // augment defs: Cruel Cut, value/type/unit untouched by the name fold
  const cc = realData.augment_set_defs["Cruel Cut"].tiers[0].affixes;
  assert.deepStrictEqual(cc.map((a) => [a.stat, a.bonus_type, a.value, a.unit]),
    [[CANON, "Artifact", 15, "pct"]]);
  // dino channel: Dread Stalker set augment folded via the shared registry
  const dino = (realData.dino_sets || []).find((s) => s.set === "Dread Stalker");
  assert.ok(dino.affixes.some((a) => a.stat === CANON), "dino Dread Stalker carries the canonical");
  assert.ok((dino.raw || "").includes("damage vs. the helpless"), "dino raw stays verbatim");
  // Tier raw, re-ratified 2026-08-18 (#374/U6). This used to assert that
  // `Damage vs. Helpless Opponents` (13 tier raws) and `Helplessness Damage`
  // (33) survived verbatim, proving the fold rewrote stats and not provenance
  // text. BOTH SPELLINGS LEFT UPSTREAM: the refreshed gearplanner_sets.json
  // consolidated every helpless wording onto `Damage vs. the Helpless` (1 -> 27
  // occurrences; the other two 2 -> 0 and 6 -> 0), and tier raw is synthesized
  // from the set catalog's own affix names. The one surviving upstream spelling
  // is the one our #305 rename maps, so the verbatim property is no longer
  // demonstrable in THIS channel — it is still demonstrated in the dino channel
  // above, whose raw is upstream free text the fold never touches.
  //
  // What replaces it is the stronger claim the fold actually owes: every
  // helpless mention in every tier raw reads as the canonical, so no surface
  // shows a player a wording the picker cannot resolve.
  const raws = [];
  for (const v of realData.items) for (const t of v.parsed_set_bonuses || []) raws.push(t.raw || "");
  const helplessRaws = raws.filter((r) => /helpless/i.test(r));
  assert.ok(helplessRaws.length > 0, "tier raws still describe the helpless mechanic");
  const offCanon = [...new Set(helplessRaws.filter((r) => !r.includes(CANON)))];
  assert.deepStrictEqual(offCanon, [],
    "every helpless tier raw reads as the canonical spelling");
  // the picker resolves every old spelling to the canonical rankable target
  for (const syn of away) {
    assert.strictEqual((realData.metadata.affix_aliases || {})[syn], CANON,
      `picker alias for ${syn}`);
  }
});

// #287 — the folded engraved names arrive as provenance labels: suggested,
// rankable, and resolving to their base stat, with the prefixed name gone from
// every built affix. No bespoke web code — the label scan picks up any family
// the moment it stamps its first affix.
//
// RE-RATIFIED 2026-08-18 (#374/U6). The 2026-08-18 gear-planner refresh ADOPTED
// this fold: `Legendary Accuracy`, `Legendary Armor-Piercing`, `Legendary Deadly`
// and `Legendary Spell Penetration` have zero occurrences left in the raw dump
// (14 / 22 / 3 / 12 before), and the same carrier counts now arrive as the base
// stat at bonus type `Legendary` — which is what the fold produced. With nothing
// left to fold, the fold stamps no provenance receipt and those four names stop
// being shipped labels. That is upstream's change, not a lost mechanism, and the
// split below is what makes it visible if upstream ever reverts.
//
// `Legendary Conditioning` is the survivor, and it is ours: upstream re-spelled
// its carriers `False Life (%)`, our #376 canon correction renames that to the
// engraved name, and the fold then folds it exactly as before (36 stamps).
const LEGENDARY_ADOPTED_UPSTREAM = {
  "Legendary Accuracy": "Accuracy",
  "Legendary Armor-Piercing": "Armor-Piercing",
  "Legendary Deadly": "Deadly",
  "Legendary Spell Penetration": "Spell Penetration",
};
const LEGENDARY_STILL_FOLDED = { "Legendary Conditioning": "Conditioning" };

test("#287: the locally folded Legendary name is a redirecting label, not a dead stat", () => {
  const v = buildPickerVocabulary(realData);
  for (const [engraved, base] of Object.entries(LEGENDARY_STILL_FOLDED)) {
    assert.ok(v.provenanceLabels[engraved.toLowerCase()], `${engraved} is a shipped label`);
    assert.deepStrictEqual(expandedAwayFor(v, engraved), [base],
      `${engraved} resolves to ${base}`);
    assert.ok(v.suggestions.includes(base), `${base} stays suggested`);
  }
});

test("#287: upstream adopted four of the folds — the base stat carries the Legendary type natively", () => {
  // Stated as the PREMISE of the retirement, not as an absence. If upstream
  // re-introduces a prefixed spelling, the fold fires again, the engraved name
  // becomes a label again, and the first assertion here goes red demanding a
  // fresh adjudication rather than silently drifting back.
  const v = buildPickerVocabulary(realData);
  for (const [engraved, base] of Object.entries(LEGENDARY_ADOPTED_UPSTREAM)) {
    assert.ok(!v.provenanceLabels[engraved.toLowerCase()],
      `${engraved} ships no label — upstream emits the base stat directly`);
    const carriers = realData.items.filter((it) => (it.affixes || []).some(
      (a) => a.name === base && a.type === "Legendary"));
    assert.ok(carriers.length > 0,
      `${base} is still carried at bonus type Legendary — the fold's purpose, served upstream`);
    assert.ok(v.suggestions.includes(base), `${base} stays suggested`);
  }
});

test("#287: no built affix keeps a prefixed Legendary stat name", () => {
  const prefixed = new Set(Object.keys(LEGENDARY_ADOPTED_UPSTREAM)
    .concat(Object.keys(LEGENDARY_STILL_FOLDED)).map((k) => k.toLowerCase()));
  for (const it of realData.items) {
    for (const a of it.affixes || []) {
      assert.ok(!prefixed.has(String(a.name || "").toLowerCase()),
        `no built affix keeps a prefixed stat name (${it.variant_id})`);
    }
    // #374/U6 — the set-tier channel too. Our own `False Life (%)` correction
    // mints the engraved name into the RAW set catalog, so without the fold
    // running there the tier credits a stat name no item affix carries.
    for (const t of it.parsed_set_bonuses || []) {
      for (const a of t.affixes || []) {
        assert.ok(!prefixed.has(String(a.stat || "").toLowerCase()),
          `no set tier credits a prefixed stat name (${it.variant_id}/${t.set})`);
      }
    }
  }
});

// #290 — Potency joins the bare-label family: no item carries the stat anymore,
// but every expanded affix is stamped via "Potency", so the name stays
// suggested, rankable, and resolves to the ten element spellpowers — the same
// path a saved build's priorities migrate through on load. Universal Spell
// Power is the deliberate non-expansion (fully stacking) and must stay a
// plain rankable stat.
test("#290: Potency is a redirecting label; Universal Spell Power stays native", () => {
  const v = buildPickerVocabulary(realData);
  assert.ok(v.provenanceLabels["potency"], "Potency is a shipped label");
  assert.deepStrictEqual(expandedAwayFor(v, "Potency"),
    ["Combustion", "Corrosion", "Devotion", "Glaciation", "Impulse",
     "Magnetism", "Nullification", "Radiance", "Reconstruction", "Resonance"]);
  assert.ok(v.suggestions.includes("Potency"), "Potency stays suggested");
  assert.ok(!expandedAwayFor(v, "Universal Spell Power"), "USP is not expanded away");
  assert.ok(v.known.has("Universal Spell Power"), "USP stays a rankable stat");
  for (const it of realData.items) {
    for (const a of it.affixes || []) {
      assert.notStrictEqual(a.name, "Potency", `no built affix keeps Potency (${it.variant_id})`);
    }
  }
});

// ---------------------------------------------------------------------------
// U1 (#290/#291) — cross-add data plumbing. normalizeDataset wires
// metadata.cross_add {target_stat: [source_stats]} into model.js
// (installCrossAdd mirrors the installStackEquiv bridge: browser global or
// node require). Plumbing only — solver crediting is a later unit.
test("U1: normalizeDataset installs metadata.cross_add into model.js", () => {
  const model = require("../web/model.js");
  try {
    const ds = normalizeDataset({
      metadata: { cross_add: { Combustion: ["Universal Spell Power"] } },
      items: [],
    });
    assert.deepStrictEqual(ds._crossAdd, { Combustion: ["Universal Spell Power"] });
    assert.deepStrictEqual(model.crossAddSourcesFor("Combustion"), ["Universal Spell Power"]);
    assert.deepStrictEqual(model.crossAddSourcesFor("Corrosion"), [], "unmapped stat stays []");
  } finally {
    model.setCrossAdd(realData._crossAdd); // restore the real catalog's map
  }
});

test("U1: the built catalog carries both cross-add families", () => {
  const ca = realData._crossAdd || {};
  for (const sp of ["Combustion", "Corrosion", "Devotion", "Glaciation", "Impulse",
                    "Magnetism", "Nullification", "Radiance", "Reconstruction", "Resonance"]) {
    assert.deepStrictEqual(ca[sp], ["Universal Spell Power"], sp);
  }
  // #366 — base `Spell Lore` left this family: it is a same-type umbrella and
  // now EXPANDS (highest-of-type), matching Potency in the spellpower channel.
  // Only the wiki-declared "separate and stacking" source cross-adds.
  assert.deepStrictEqual(ca["Fire Lore"], ["Universal Spell Lore"]);
  assert.ok(!(ca["Fire Lore"] || []).includes("Spell Lore"),
    "a same-type umbrella must never also cross-add — that would sum a source it competes with");
});

// #316 — the load normalizer must not strip the color matrix the build stamps
// onto each augment-set def (the issue #90 divergence shape: a Python stamp
// plus a JS normalizer touching the same record).
test("#316: normalizeDataset preserves fits_slots on augment_set_defs", () => {
  const seven = ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"];
  const ds = normalizeDataset({
    items: [],
    augment_set_defs: {
      SetX: { tiers: [{ pieces_required: 3, affixes: [] }], tier: "augment",
              fits_slots: seven.slice() },
    },
  });
  assert.deepStrictEqual(ds.augment_set_defs.SetX.fits_slots, seven,
    "the stamped matrix survives load normalization");
});

test("#316: every built augment_set_def carries the seven-color matrix", () => {
  const defs = realData.augment_set_defs || {};
  const names = Object.keys(defs);
  assert.ok(names.length >= 21, `expected the 21 defs, got ${names.length}`);
  for (const n of names) {
    assert.deepStrictEqual(defs[n].fits_slots,
      ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"], n);
  }
});

// ---------------------------------------------------------------------------
// #91 (U1) — the Utility tier's counting vocabulary, consumed from the build
// stamp. Admitted untyped procs join the picker on the PRESENCE path (suggest +
// on/off badge, no Advanced credit/bound controls — NOT rankable_affixes);
// vocab.utilityCounting exposes metadata.utility_counting_set as a Set for the
// counting predicate later units need.
// ---------------------------------------------------------------------------

test("#91: an admitted untyped proc enters presence + suggestions, never magnitude", () => {
  const vocab = buildPickerVocabulary({
    items: [
      { name: "Sword", slot: "Weapon",
        affixes: [{ name: "Holy", type: null, value: "6" }] },
      { name: "Boots", slot: "Boots",
        affixes: [{ name: "Dexterity", type: "Enhancement", value: 8 }] },
    ],
    metadata: {
      rankable_affixes: ["Dexterity"],
      utility_untyped_admitted: ["Holy"],
      utility_counting_set: ["Ghost Touch", "Holy"],
    },
  });
  assert.ok(vocab.presence.has("Holy"), "admitted proc is presence-flagged");
  assert.ok(vocab.suggestions.includes("Holy"), "admitted proc is suggested");
  assert.ok(!vocab.magnitude.has("Holy"),
    "admitted proc must NOT gain a magnitude bucket (the declared-credit defect)");
});

test("#91: vocab.utilityCounting is the stamped counting set, as a Set", () => {
  const vocab = buildPickerVocabulary({
    items: [
      { name: "A", slot: "Boots",
        affixes: [{ name: "Ghost Touch", type: "Bool", value: "1" },
                  { name: "Deception", type: "Enhancement", value: 3 }] },
    ],
    metadata: {
      rankable_affixes: ["Deception"],
      // The build's presence-minus-magnitude derivation: Ghost Touch in,
      // dual-nature Deception out.
      utility_counting_set: ["Ghost Touch"],
    },
  });
  assert.ok(vocab.utilityCounting instanceof Set, "a Set, ready for the counting predicate");
  assert.ok(vocab.utilityCounting.has("Ghost Touch"), "a Bool presence name counts");
  assert.ok(!vocab.utilityCounting.has("Deception"),
    "a dual-nature name is already rankable and must not double as utility");
});

test("#91: a pre-stamp cached dataset yields an empty counting set, not a crash", () => {
  const vocab = buildPickerVocabulary({ items: [], metadata: {} });
  assert.ok(vocab.utilityCounting instanceof Set);
  assert.strictEqual(vocab.utilityCounting.size, 0);
});

test("#91: the built catalog stamps a real counting set", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  assert.ok(v.utilityCounting.size > 0, "stamped and non-empty");
  assert.ok(v.utilityCounting.has("Ghost Touch"), "the canonical presence example counts");
  for (const n of ["Deception", "Smoke Screen", "Protection from Evil", "Underwater Action"]) {
    assert.ok(!v.utilityCounting.has(n), `dual-nature ${n} is excluded`);
    assert.ok(v.magnitude.has(n), `${n} stays a rankable magnitude`);
  }
});

// #91 (U3, KTD10) — the perf-gate fallback: the counting set is restricted to
// the curated tier-1 list; high-population tier-2 names are
// derivable-but-uncounted (widening happens in measured batches).
// #343 — the curation changed shape: the worn defensive toggles joined tier-1,
// and the admitted untyped procs left the count entirely.
test("#343: tier-2 names are OUT of the stamped counting set; tier-1 is IN and admitted procs are not", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  for (const n of ["Keen", "Adamantine", "Returning"]) {
    assert.ok(!v.utilityCounting.has(n), `tier-2 ${n} does not count`);
  }
  for (const n of ["Ghost Touch", "Whelming Shockwave", "Blunt Trauma", "Lesser Boneshatter", "Feather Falling"]) {
    assert.ok(v.utilityCounting.has(n), `tier-1 ${n} counts`);
  }
  // The worn defensive toggles are why #343 exists.
  for (const n of ["Ghostly", "True Seeing", "Blurry", "Freedom of Movement", "Blindness Immunity", "Deathblock"]) {
    assert.ok(v.utilityCounting.has(n), `worn toggle ${n} counts — this is the reported bug`);
  }
  // The admitted untyped procs are no longer counted, but stay picker-rankable.
  for (const n of ["Holy", "Vampirism", "Giant Bane"]) {
    assert.ok(!v.utilityCounting.has(n), `admitted untyped proc ${n} no longer counts`);
    assert.ok(v.suggestions.includes(n), `${n} is still offered in the picker`);
  }
});

// #91 (U3, KTD10) — parity guard for the mirrored tier-1 curation: the stamp
// (derived by src/utility_procs.py's mirror) must agree with web/dataset.js's
// UTILITY_TIER1_PRESENCE. If either copy gains or loses a name, the stamped
// set diverges from this constant and one direction below fails.
// RE-POINTED 2026-08-18 (#374/U6, tracked as #380). This asserted against real
// data that the admitted-proc set is non-empty and that `Undead Bane` is in it.
// The 2026-08-18 refresh typed every untyped weapon proc `Bool`, so all 104
// `utility_procs` adjudications were retired and the `allow` list — and with it
// `utilityAdmitted` — is EMPTY BY DESIGN. The property "an admitted proc exists"
// is therefore no longer expressible against real data, and #380 owns the
// decision about whether to re-derive the set from the `Bool` population.
//
// Rather than delete the marker or let it pass vacuously, it now pins the two
// things that ARE still true and states the collapse as an assertion, so this
// test goes red the moment #380 refills the set and demands the real-data
// distinction be re-pinned.
test("#332/#380: utilityAdmitted is exposed, disjoint from utilityCounting, and empty by design", () => {
  const v = builtVocab();
  if (!v) { console.log("  (skipped — web/data/items.json not built)"); return; }
  assert.ok(v.utilityAdmitted instanceof Set, "the admitted procs are exposed as a Set");
  assert.ok(v.utilityCounting.size > 0, "and the counting half still counts presence effects");
  // The split every surface renders: a name is counted, or rankable-only, never
  // both. An overlap would put two contradictory markers on one Browse chip.
  const both = [...v.utilityCounting].filter((n) => v.utilityAdmitted.has(n));
  assert.deepStrictEqual(both, [],
    `counted and admitted must be disjoint since #343; overlapping: ${both.join(", ")}`);
  // Anchored on the reported case: the tier seeks Ghostly, never Undead Bane.
  assert.ok(v.utilityCounting.has("Ghostly"), "Ghostly is counted");
  assert.ok(!v.utilityAdmitted.has("Ghostly"), "and is not an admitted proc");
  assert.ok(!v.utilityCounting.has("Undead Bane"), "Undead Bane is NOT counted");
  // #380 — the surviving property. The proc is no longer *admitted* (it is typed
  // `Bool` now, not untyped), but it must still reach the player through the
  // presence/suggestion path, which is what makes the empty allow list a DISPLAY
  // change and not a scoring one.
  assert.ok(v.presence.has("Undead Bane") || v.suggestions.includes("Undead Bane"),
    "Undead Bane still reaches the picker as a presence effect");
  assert.strictEqual(v.utilityAdmitted.size, 0,
    "the admitted set is empty by design (#380) — when it refills, re-pin the " +
    "real-data counted-vs-admitted distinction here and in browse.test.js");
});

test("#91/KTD10: the stamped counting set and UTILITY_TIER1_PRESENCE cannot drift", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  const { UTILITY_TIER1_PRESENCE } = require("../web/dataset.js");
  const fs = require("fs");
  const path = require("path");
  const meta = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "web", "data", "items.json"), "utf8")).metadata || {};
  const admitted = new Set((meta.utility_untyped_admitted || []).map((n) => v.canonical(n)));
  // Direction 1: every counted name is a tier-1 name (the Python mirror
  // admitted nothing the JS curation does not list). #343 dropped the admitted
  // procs from the counting set, so the old `if (admitted.has(n)) continue;`
  // exemption is not just dead — it would hide exactly the drift that
  // re-unioning them would cause. Counted and admitted are now disjoint.
  for (const n of v.utilityCounting) {
    assert.ok(!admitted.has(n),
      `counted name ${n} is an admitted untyped proc — #343 removed those from the count`);
    assert.ok(UTILITY_TIER1_PRESENCE.has(n),
      `stamped counting name ${n} is not in UTILITY_TIER1_PRESENCE — the mirrors drifted`);
  }
  // Direction 2: every tier-1 name carried as Bool presence (minus magnitude)
  // in the built catalog is counted (the Python mirror lost nothing).
  const boolCarried = new Set();
  for (const it of realData.items || []) {
    for (const a of it.affixes || []) {
      if (a.type === "Bool" || a.type === "boolean") boolCarried.add(v.canonical(a.name));
    }
  }
  for (const n of UTILITY_TIER1_PRESENCE) {
    const c = v.canonical(n);
    if (!boolCarried.has(c) || v.magnitude.has(c)) continue;
    assert.ok(v.utilityCounting.has(c),
      `tier-1 name ${n} is Bool-carried but missing from the stamp — the mirrors drifted`);
  }
});

test("#348 U3/KTD8: the declared container order covers the stamped counting set exactly", () => {
  const v = builtVocab();
  if (!v) return console.log("  (skipped — web/data/items.json not built)");
  const { UTILITY_CONTAINER_DEFAULT_ORDER, defaultUtilityOrder } = require("../web/dataset.js");

  // No duplicates: a name listed twice would be pursued twice and consume two
  // container slots for one effect.
  assert.strictEqual(new Set(UTILITY_CONTAINER_DEFAULT_ORDER).size, UTILITY_CONTAINER_DEFAULT_ORDER.length,
    "the declared order lists a name twice");

  // Direction 1: the order mentions nothing the dataset does not stamp. A name
  // here that is not counted would occupy a container position pursuing an effect
  // the solver has no indicator for.
  for (const n of UTILITY_CONTAINER_DEFAULT_ORDER) {
    assert.ok(v.utilityCounting.has(n),
      `declared order names ${n}, which the dataset does not stamp as counted`);
  }

  // Direction 2 — the one that matters for #349. defaultUtilityOrder appends any
  // stamped-but-unordered name in sorted order rather than dropping it, so a
  // widened roster still solves. That tail is a safety net, NOT a resting place:
  // it means a roster widened without an ordering decision would silently land at
  // the bottom alphabetically, which R9 says is not allowed to be how order is set.
  const ordered = defaultUtilityOrder(v.utilityCounting);
  const declared = new Set(UTILITY_CONTAINER_DEFAULT_ORDER);
  const tail = ordered.filter((n) => !declared.has(n));
  assert.deepStrictEqual(tail, [],
    `the stamped counting set gained ${JSON.stringify(tail)} with no position in the declared order — ` +
    "widening the roster is also an ordering decision (R9); place these in UTILITY_CONTAINER_DEFAULT_ORDER");

  assert.strictEqual(ordered.length, v.utilityCounting.size,
    "the default container must cover every counted name exactly once");
});

if (!process.exitCode) console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #345 — THE BROWSER SHARES ONE GLOBAL SCOPE. Node gives every file its own
// module scope, so two files can each declare the same top-level name and every
// Node test passes while the browser throws a SyntaxError on the SECOND file and
// discards it whole. That is exactly what happened here: a `_poolStatNames`
// bridge added to both solver.js and results.js killed the entire results panel,
// and 1000+ green Node tests could not see it.
//
// This compiles the scripts index.html loads the way the browser does — one
// concatenated program — so a redeclaration fails the build instead of the page.
// ---------------------------------------------------------------------------
test("#345: web scripts compile together in one shared global scope", () => {
  const fs = require("fs"); const path = require("path"); const vm = require("vm");
  const webDir = path.join(__dirname, "..", "web");
  const html = fs.readFileSync(path.join(webDir, "index.html"), "utf-8");
  const srcs = [...html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);
  const local = srcs.filter((s) => !/^https?:|vendor\//.test(s));
  assert.ok(local.length >= 5, `expected the app's own scripts; found ${local.length}`);
  const parts = [];
  for (const s of local) {
    const f = path.join(webDir, s);
    if (!fs.existsSync(f)) continue;
    parts.push(`// ===== ${s} =====\n` + fs.readFileSync(f, "utf-8"));
  }
  try {
    new vm.Script(parts.join("\n;\n"), { filename: "browser-shared-scope.js" });
  } catch (e) {
    assert.fail(`the scripts index.html loads do not compile together: ${e.message}\n` +
      "In the browser they share ONE global scope. Two files declaring the same " +
      "top-level name is a SyntaxError that discards the second file entirely.");
  }
});

// ---------------------------------------------------------------------------
// #364 — a synthesized body must inherit the item-quality fields of the record
// it replaces. The Dinosaur Bone blanks REPLACE same-named gear-planner records
// (their names are excluded from the reader), and the six native accessory
// blanks are flagged `artifact: true` upstream. The synthetic bodies were not,
// so the built catalog shipped 95 Artifacts where the dump has 101 — and an
// unflagged Artifact is invisible to the one-Artifact constraint, letting the
// solver equip it alongside a real one. Reported by a player.
// ---------------------------------------------------------------------------

test("#364: no Artifact is lost between the gear-planner dump and the built catalog", () => {
  if (!realData || !(realData.items || []).length) return console.log("  (skipped — dataset not built)");
  const fs = require("fs");
  const path = require("path");
  const rawPath = path.join(__dirname, "..", "data", "seed", "compendium", "raw", "gearplanner_items.json");
  if (!fs.existsSync(rawPath)) return console.log("  (skipped — raw dump absent)");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const rawItems = raw.items || raw;
  const rawCount = rawItems.filter((it) => it.artifact).length;
  const builtCount = (realData.items || []).filter((it) => it.artifact === true).length;
  assert.ok(rawCount > 0, "the dump must flag some Artifacts, or this test proves nothing");
  assert.strictEqual(builtCount, rawCount,
    `the built catalog must carry every Artifact the dump flags (${builtCount} vs ${rawCount}) — ` +
    "a synthesized body that replaces a native record has to inherit its item-quality fields");
});

test("#364: the six Dinosaur Bone accessory blanks are flagged Artifacts", () => {
  if (!realData || !(realData.items || []).length) return console.log("  (skipped — dataset not built)");
  const byName = new Map((realData.items || []).map((it) => [it.source_item, it]));
  // Exactly the set the dump flags, and the line the wiki draws:
  // "Minor Artifact accessory blanks are available from the raid ..." while
  // "Dinosaur Bone armors and shields are only available as loot from the raid".
  for (const n of ["Belt", "Boots", "Bracers", "Gloves", "Necklace", "Ring"]) {
    const it = byName.get(`Dinosaur Bone ${n}`);
    assert.ok(it, `Dinosaur Bone ${n} must exist`);
    assert.strictEqual(it.artifact, true, `Dinosaur Bone ${n} must be flagged an Artifact`);
  }
  // NOT extended to the armor/weapon bodies on family resemblance — the dump
  // does not flag them and the wiki puts them in a different acquisition class.
  for (const n of ["Armor", "Helmet", "Cloak", "Quarterstaff"]) {
    const it = byName.get(`Dinosaur Bone ${n}`);
    if (it) assert.notStrictEqual(it.artifact, true,
      `Dinosaur Bone ${n} is not flagged upstream — flagging it would be inference`);
  }
});
