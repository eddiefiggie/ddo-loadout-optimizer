// #88 U1/U2/U3 — player bonus-type overrides: identity, eligibility, the match
// ladder, and the re-appliable overlay. Run: node tests/overrides.test.js
//
// The population assertions live here rather than in a Python guard on purpose
// (U3): eligibility is classified over the pool AFTER normalizeDataset, which
// generates the 161 boolean-composite components that carry no provenance stamp.
// A Python test reading only the pre-normalize build artifact cannot see them,
// and cannot call the real predicate — which would leave two hand-kept
// implementations of the five ineligible classes free to drift apart.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const O = require("../web/overrides.js");
const DN = require("../web/dataset.js");
const Model = require("../web/model.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const DATA = path.join(__dirname, "..", "web", "data", "items.json");
function loadPool() {
  // Classification is a pool-load pass (KTD4): the composite class only exists
  // after normalizeDataset has generated it.
  return O.classifyPool(DN.normalizeDataset(JSON.parse(fs.readFileSync(DATA, "utf-8"))));
}
const pool = loadPool();
const byId = new Map(pool.items.map((v) => [v.variant_id, v]));

const affix = (variantId, pred) => (byId.get(variantId).affixes || []).find(pred);
const ov = (variant, a, to) => ({ ...O.overrideKey(variant, a), to });

// ---------------------------------------------------------------- U1: identity

test("AE13 — byte-identical occurrences share one key and match together", () => {
  const robe = byId.get("Aberrant Robe");
  const ac = (robe.affixes || []).filter((a) => a.name === "Armor Class" && a.type === "Armor");
  assert.strictEqual(ac.length, 2, "Aberrant Robe carries Armor Class|Armor twice");
  assert.strictEqual(ac[0].value, ac[1].value, "and at the same value");
  const keys = new Set(ac.map((a) => JSON.stringify(O.overrideKey(robe, a))));
  assert.strictEqual(keys.size, 1, "one key for both occurrences");
  assert.strictEqual(O.matchAffixes(pool, ov(robe, ac[0], "Enhancement")).length, 2,
    "matchAffixes returns both, so they retype together (R2)");
});

test("AE2 — one stat under two types resolves to exactly one affix per key", () => {
  let found = null;
  for (const v of pool.items) {
    const seen = new Map();
    for (const a of v.affixes || []) {
      if (!O.isEligible(a)) continue;
      const k = `${a.name}`;
      if (seen.has(k) && seen.get(k).type !== a.type) { found = [v, seen.get(k), a]; break; }
      seen.set(k, a);
    }
    if (found) break;
  }
  assert.ok(found, "the dataset has a variant carrying one stat under two types");
  const [v, a1, a2] = found;
  assert.strictEqual(O.matchAffixes(pool, ov(v, a1, "Quality")).length, 1);
  assert.strictEqual(O.matchAffixes(pool, ov(v, a2, "Quality")).length, 1);
});

// ------------------------------------------------------------- U1: eligibility

test("the five ineligible classes are refused", () => {
  const find = (pred) => {
    for (const v of pool.items) for (const a of v.affixes || []) if (pred(a)) return a;
    return null;
  };
  assert.strictEqual(O.isEligible(find((a) => a.type === "Bool")), false, "Bool");
  assert.strictEqual(O.isEligible(find((a) => a.type === "Penalty")), false, "Penalty");
  assert.strictEqual(O.isEligible(find((a) => a.type === "-")), false, "dash-typed DR");
  assert.strictEqual(O.isEligible(find((a) => !("type" in a) || a.type == null)), false, "absent type");
  assert.strictEqual(O.isEligible(find((a) => a.via != null)), false, "expansion-derived");
});

test("absent type is ineligible but the explicit Untyped token is eligible", () => {
  let untyped = null, absent = null;
  for (const v of pool.items) for (const a of v.affixes || []) {
    if (a.type === "Untyped" && !a.via && !untyped) untyped = a;
    if (a.type == null && !absent) absent = a;
  }
  assert.ok(untyped && absent, "the dataset carries both");
  assert.strictEqual(O.isEligible(untyped), true, "explicit Untyped stays eligible");
  assert.strictEqual(O.isEligible(absent), false, "absent type does not");
});

test("the 161 unstamped boolean-composite components are ineligible", () => {
  const rawItems = JSON.parse(fs.readFileSync(DATA, "utf-8")).items;
  const key = (vid, a) => `${vid}|${a.name || a.stat}|${a.type}|${a.value}`;
  const before = new Map();
  for (const v of rawItems) for (const a of v.affixes || []) {
    const k = key(v.variant_id, a); before.set(k, (before.get(k) || 0) + 1);
  }
  const derived = [];
  for (const v of pool.items) for (const a of v.affixes || []) {
    const k = key(v.variant_id, a), n = before.get(k) || 0;
    if (n > 0) { before.set(k, n - 1); continue; }
    if (!a.via) derived.push(a);
  }
  assert.strictEqual(derived.length, 161,
    "normalizeDataset generates 161 composite components carrying no provenance stamp");
  assert.ok(derived.every((a) => !O.isEligible(a)),
    "and the predicate refuses every one of them, so it cannot be a `via` presence test");
});

test("a single-member rename receipt is not excluded merely for carrying a stamp", () => {
  const speed = [];
  for (const v of pool.items) for (const a of v.affixes || []) if (a.via === "Speed") speed.push(a);
  assert.ok(speed.length > 0, "Speed rename receipts exist");
  assert.ok(speed.every((a) => a.via === "Speed"),
    "they carry the provenance key though they are renames, not sibling expansions");
});

test("AE20 — an item with no eligible affix yields an empty list", () => {
  const barren = pool.items.find((v) => (v.affixes || []).length > 0
    && (v.affixes || []).every((a) => !O.isEligible(a)));
  assert.ok(barren, "such an item exists");
  assert.deepStrictEqual(O.eligibleAffixes(barren), [], "no control should be offered");
});

test("eligibility is not cached under the field name `eligible`", () => {
  const a = pool.items.flatMap((v) => v.affixes || []).find((x) => O.isEligible(x));
  assert.strictEqual(a.eligible, true,
    "src/verify.py writes `eligible` on every affix as the solver gate — it must survive untouched");
  assert.ok(Object.getOwnPropertyNames(a).some((k) => k !== "eligible" && /eligib/i.test(k)),
    "the override predicate caches under its own field");
  assert.ok(!Object.keys(a).includes(O.ELIGIBLE_CACHE),
    "and non-enumerably, so it never widens what a save or export serializes");
});

// ------------------------------------------------------------ U1: match ladder

test("the ladder reaches all five outcomes", () => {
  const robe = byId.get("Aberrant Robe");
  const a = (robe.affixes || []).find((x) => x.name === "Armor Class" && x.type === "Armor");

  assert.strictEqual(O.resolveMatch(pool, ov(robe, a, "Enhancement")).state, "active");

  const drifted = loadPool();
  drifted.items.find((v) => v.variant_id === "Aberrant Robe").affixes
    .filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Insight"; });
  assert.deepStrictEqual(
    (({ state, reason }) => ({ state, reason }))(O.resolveMatch(drifted, ov(robe, a, "Enhancement"))),
    { state: "suspended", reason: "drift" });

  const adopted = loadPool();
  adopted.items.find((v) => v.variant_id === "Aberrant Robe").affixes
    .filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Enhancement"; });
  assert.strictEqual(O.resolveMatch(adopted, ov(robe, a, "Enhancement")).state, "satisfied");

  const ineligible = loadPool();
  ineligible.items.find((v) => v.variant_id === "Aberrant Robe").affixes
    .filter((x) => x.name === "Armor Class").forEach((x) => { x.via = "Potency"; });
  O.classifyPool(ineligible); // a refresh re-classifies; the cache is per pool load
  assert.deepStrictEqual(
    (({ state, reason }) => ({ state, reason }))(O.resolveMatch(ineligible, ov(robe, a, "Enhancement"))),
    { state: "suspended", reason: "ineligible" });

  const retired = loadPool();
  const r = retired.items.find((v) => v.variant_id === "Aberrant Robe");
  r.affixes = r.affixes.filter((x) => x.name !== "Armor Class");
  assert.deepStrictEqual(
    (({ state, reason }) => ({ state, reason }))(O.resolveMatch(retired, ov(robe, a, "Enhancement"))),
    { state: "suspended", reason: "retired-target" });
});

// ------------------------------------------------------------- U2: the overlay

test("apply then withdraw restores the pool byte-identically", () => {
  const p = loadPool();
  const before = JSON.stringify(p.items);
  const robe = p.items.find((v) => v.variant_id === "Aberrant Robe");
  const a = robe.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  O.applyOverrides(p, [ov(robe, a, "Enhancement")]);
  assert.notStrictEqual(JSON.stringify(p.items), before, "apply changed something");
  O.withdrawOverrides(p);
  assert.strictEqual(JSON.stringify(p.items), before, "withdraw restored it exactly");
});

test("re-applying still reports both overrides as applied (report, not pool state)", () => {
  const p = loadPool();
  const robe = p.items.find((v) => v.variant_id === "Aberrant Robe");
  const a = robe.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const b = robe.affixes.find((x) => x.name === "Spell Resistance");
  const set = [ov(robe, a, "Enhancement"), ov(robe, b, "Quality")];

  const first = O.applyOverrides(p, set);
  const poolAfterFirst = JSON.stringify(p.items);
  const second = O.applyOverrides(p, set);

  assert.strictEqual(second.applied.length, 2,
    "matching must run against catalog types — a stamped pool would report these unmatched");
  assert.deepStrictEqual(second.unmatched, []);
  assert.deepStrictEqual(first.applied.length, second.applied.length);
  assert.strictEqual(JSON.stringify(p.items), poolAfterFirst, "and the pool is unchanged");
});

test("application is independent of the order overrides were added in", () => {
  const robe = "Aberrant Robe";
  const build = (order) => {
    const p = loadPool();
    const v = p.items.find((x) => x.variant_id === robe);
    const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
    const b = v.affixes.find((x) => x.name === "Spell Resistance");
    const set = [ov(v, a, "Enhancement"), ov(v, b, "Quality")];
    O.applyOverrides(p, order === "fwd" ? set : set.slice().reverse());
    return JSON.stringify(p.items.find((x) => x.variant_id === robe));
  };
  assert.strictEqual(build("fwd"), build("rev"));
});

test("an override matching nothing is inert and reported unmatched", () => {
  const p = loadPool();
  const before = JSON.stringify(p.items);
  const res = O.applyOverrides(p, [{ variant_id: "No Such Item", name: "Nope", from: "Quality", value: "5", to: "Enhancement" }]);
  assert.deepStrictEqual(res.applied, []);
  assert.strictEqual(res.unmatched.length, 1);
  assert.strictEqual(JSON.stringify(p.items), before, "the pool is untouched");
});

test("a stamped affix keeps the catalog type retrievable for labelling", () => {
  const p = loadPool();
  const robe = p.items.find((v) => v.variant_id === "Aberrant Robe");
  const a = robe.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  O.applyOverrides(p, [ov(robe, a, "Enhancement")]);
  const stamped = robe.affixes.find((x) => x.name === "Armor Class");
  assert.strictEqual(stamped.type, "Enhancement", "the player's type is live");
  assert.strictEqual(O.catalogTypeOf(stamped), "Armor", "the catalog's type is still readable");
});

test("an override never changes an affix's value", () => {
  const p = loadPool();
  const robe = p.items.find((v) => v.variant_id === "Aberrant Robe");
  const a = robe.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const value = a.value;
  O.applyOverrides(p, [ov(robe, a, "Enhancement")]);
  assert.strictEqual(robe.affixes.find((x) => x.name === "Armor Class").value, value);
});

// ------------------------------------------------------- U3: vocabulary + guard

test("AE14 — the replacement vocabulary is closed and carries the three additions", () => {
  const vocab = Model.CREDIT_BONUS_TYPES;
  for (const t of ["Orb", "Sneak Attack", "Determination"]) {
    assert.ok(vocab.includes(t), `${t} is offered`);
  }
  assert.ok(!vocab.includes("insight"), "a near-miss string is not a member");
  assert.ok(!vocab.some((t) => /Natural$/.test(t) && t !== "Natural"),
    "the X Natural family is excluded — the equivalence map collapses those");
});

test("every eligible affix's recorded type is expressible or equivalence-mapped", () => {
  const vocab = new Set(Model.CREDIT_BONUS_TYPES);
  // Read the curated map normalizeDataset installed on this very pool, never a
  // hand-copied set: a guard that keeps its own copy of a production constant
  // measures the copy, and cannot fail when the original moves.
  const equiv = new Set(Object.keys(pool._stackEquiv || {}));
  assert.ok(equiv.size > 0, "the pool carries the live stacking-equivalence map");
  const stray = new Map();
  for (const v of pool.items) for (const a of v.affixes || []) {
    if (!O.isEligible(a)) continue;
    if (vocab.has(a.type) || equiv.has(a.type)) continue;
    stray.set(a.type, (stray.get(a.type) || 0) + 1);
  }
  assert.deepStrictEqual([...stray.entries()], [],
    "recorded types and offered replacement types are different sets, but every recorded " +
    "type must be one the solver can bucket");
});

test("the X Natural family is still overridable, just not offered as a replacement", () => {
  const xn = [];
  for (const v of pool.items) for (const a of v.affixes || []) {
    if (/ Natural$/.test(String(a.type || "")) && O.isEligible(a)) xn.push(a);
  }
  assert.strictEqual(xn.length, 50, "50 eligible X Natural affixes today");
  assert.ok(xn.every((a) => O.isEligible(a)), "each may be overridden");
});

test("the classified population is 20,613 eligible of 42,088", () => {
  let total = 0, eligible = 0;
  const byCat = {};
  for (const v of pool.items) for (const a of v.affixes || []) {
    total++;
    if (O.isEligible(a)) { eligible++; byCat[v.category] = (byCat[v.category] || 0) + 1; }
  }
  assert.strictEqual(total, 42088, "post-normalize pool size");
  // 20,613 not 20,774: the earlier figure was derived with a `via`-only test,
  // which counts the 161 unstamped composite components as engraved. Applying all
  // five classes through the real predicate is what produces this number.
  assert.strictEqual(eligible, 20613, "engraved, eligible affixes");
  assert.deepStrictEqual(byCat, { item: 13573, weapon: 6121, augment: 919 });
});

test("chained overrides do not clobber the catalog type", () => {
  // Two individually-legal overrides where one's `to` is the other's `from`.
  // Artemist's Aegis carries Fortitude Save 4 under both Resistance and Insight.
  const run = (order) => {
    const p = loadPool();
    const v = p.items.find((x) => x.variant_id === "Artemist's Aegis (level 5)");
    const at = (t) => v.affixes.find((x) => x.name === "Fortitude Save" && x.type === t);
    const A = { ...O.overrideKey(v, at("Resistance")), to: "Insight" };
    const B = { ...O.overrideKey(v, at("Insight")), to: "Quality" };
    const rep = O.applyOverrides(p, order === "fwd" ? [A, B] : [B, A]);
    const after = v.affixes.filter((x) => x.name === "Fortitude Save").map((x) => x.type);
    O.withdrawOverrides(p);
    const restored = v.affixes.filter((x) => x.name === "Fortitude Save").map((x) => x.type);
    return { counts: rep.applied.map((x) => x.count), after, restored };
  };
  const fwd = run("fwd"), rev = run("rev");
  assert.deepStrictEqual(fwd.counts, [1, 1], "neither override captures the other's affix");
  assert.deepStrictEqual(fwd.restored, ["Resistance", "Insight"],
    "withdraw restores the CATALOG types, not an intermediate override's");
  assert.deepStrictEqual(fwd, rev, "and the result is independent of the order added");
});

test("resolveMatch is independent of whether the pool is currently applied", () => {
  const p = loadPool();
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const o = { ...O.overrideKey(v, a), to: "Enhancement" };
  assert.strictEqual(O.resolveMatch(p, o).state, "active", "before apply");
  O.applyOverrides(p, [o]);
  assert.strictEqual(O.resolveMatch(p, o).state, "active",
    "a LIVE override must not read as `satisfied` — that would tell the player to " +
    "discard the override that is doing the work");
});

test("the override stamp never widens what an affix serializes", () => {
  const p = loadPool();
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const keysBefore = Object.keys(a).join(",");
  O.applyOverrides(p, [{ ...O.overrideKey(v, a), to: "Enhancement" }]);
  const stamped = v.affixes.find((x) => x.name === "Armor Class");
  assert.strictEqual(Object.keys(stamped).join(","), keysBefore,
    "solver.js hands out live pool references and `chosen` is persisted, so a " +
    "stamped affix must not carry the stamp into a saved character");
  assert.ok(!JSON.stringify(stamped).includes(O.OVERRIDE_FROM));
  assert.strictEqual(O.catalogTypeOf(stamped), "Armor", "still readable by direct access");
});

test("applyOverrides refuses an override whose target became ineligible", () => {
  const p = loadPool();
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const o = { ...O.overrideKey(v, a), to: "Enhancement" };
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.via = "Potency"; });
  O.classifyPool(p);
  const rep = O.applyOverrides(p, [o]);
  assert.deepStrictEqual(rep.applied, [], "nothing applied");
  assert.strictEqual(rep.ineligible.length, 1, "and it is reported as ineligible");
  assert.strictEqual(v.affixes.find((x) => x.name === "Armor Class").type, "Armor",
    "the pool is untouched");
});

test("eligibleAffixes returns the correct non-empty subset", () => {
  const v = pool.items.find((x) => (x.affixes || []).some((a) => O.isEligible(a))
    && (x.affixes || []).some((a) => !O.isEligible(a)));
  assert.ok(v, "an item mixing eligible and ineligible affixes exists");
  const got = O.eligibleAffixes(v);
  assert.ok(got.length > 0 && got.length < v.affixes.length, "a proper subset");
  assert.ok(got.every((a) => O.isEligible(a)));
});

test("the generator marks composite components, so provenance is read not inferred", () => {
  let marked = 0;
  for (const v of pool.items) for (const a of v.affixes || []) {
    if (a._compositeOf) { marked++; assert.strictEqual(O.isEligible(a), false); }
  }
  assert.strictEqual(marked, 161, "every generated composite component carries the mark");
  const one = pool.items.flatMap((v) => v.affixes || []).find((a) => a._compositeOf);
  assert.ok(!Object.keys(one).includes("_compositeOf"), "and the mark is non-enumerable");
});

if (!process.exitCode) console.log(`\n${passed} passed`);
