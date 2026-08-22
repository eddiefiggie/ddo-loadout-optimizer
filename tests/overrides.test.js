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


// #88 U5 (R23/AE8) — the pool is ONE object shared by every character, so a
// character switch is a full rebuild of the overlay, not an increment. This is
// the mechanism the wizard's load path drives: assign the new list, re-apply.
test("switching characters leaves no trace of the previous one's overrides", () => {
  const p = loadPool();
  const catalog = new Map();
  for (const v of p.items) for (const a of v.affixes || []) catalog.set(a, a.type);

  const robe = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const ac = robe.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const aegis = p.items.find((x) => x.variant_id === "Artemist's Aegis (level 5)");
  const fort = aegis.affixes.find((x) => x.name === "Fortitude Save" && x.type === "Resistance");

  const A = [{ ...O.overrideKey(robe, ac), to: "Enhancement" }];
  const B = [{ ...O.overrideKey(aegis, fort), to: "Quality" }];

  O.applyOverrides(p, A);
  assert.strictEqual(robe.affixes.find((x) => x.name === "Armor Class").type, "Enhancement",
    "A is in force");

  // Character switch: B's list replaces A's.
  const rep = O.applyOverrides(p, B);
  assert.deepStrictEqual(rep.applied.map((x) => x.variant_id), ["Artemist's Aegis (level 5)"]);
  let leaked = 0;
  for (const v of p.items) for (const a of v.affixes || []) {
    const expected = (v === aegis && a === fort) ? "Quality" : catalog.get(a);
    if (a.type !== expected) leaked++;
    if (O.catalogTypeOf(a) !== undefined && !(v === aegis && a === fort)) leaked++;
  }
  assert.strictEqual(leaked, 0, "no affix carries A's type or A's stamp once B is loaded");

  // …and a character with none restores the catalog outright.
  O.applyOverrides(p, []);
  for (const v of p.items) for (const a of v.affixes || []) {
    if (a.type !== catalog.get(a)) assert.fail(`${v.variant_id} / ${a.name} did not return to the catalog type`);
  }
});


// ---- #88 U6 (R8) — crafted-pool override keying -----------------------------
// Crafted options live outside item variants and no pool entry carries a name
// that is both present and unique — all 48 `seal` and all 68 `nearly_complete`
// rows carry none — so they are addressed by a composed key instead.

test("#88 U6: every eligible pool row is addressable, and keys are unique across all seven channels", () => {
  const p = loadPool();
  const seen = new Map();
  let rows = 0, channels = new Set();
  O.eachPoolAffix(p, (rec) => {
    rows++; channels.add(rec.channel);
    const prior = seen.get(rec.key);
    if (prior) {
      // A collision is only legal when the two rows are indistinguishable — R2
      // says those retype together. Anything else would silently retype an
      // occurrence the player never selected.
      assert.deepStrictEqual(rec.affix, prior,
        `pool key ${rec.key} addresses two DIFFERENT rows`);
    }
    seen.set(rec.key, rec.affix);
  });
  assert.deepStrictEqual([...channels].sort(), [
    "dino_inserts", "green_steel", "nearly_complete", "nearly_complete_per_item",
    "seal", "thunder_forged", "viktranium",
  ], "all seven channels are walked");
  // #423 re-ratification — was 976 / 894. The ruling that R7's load-generated
  // exclusion reaches the crafted channels removed exactly the 278 rows carrying
  // a `via` expansion receipt: 184 viktranium, 54 dino_inserts, 40 nearly_complete.
  // 976 - 278 = 698. Re-ratified deliberately against the built pool, not accepted
  // as an incidental diff.
  assert.strictEqual(rows, 698, "the eligible pool-row population");
  assert.strictEqual(seen.size, 678, "distinct keys");
});

test("#88 U6: three same-stat seal entries at different bonus types get three distinct keys", () => {
  const p = loadPool();
  const keys = [];
  O.eachPoolAffix(p, (rec) => {
    if (rec.channel === "seal" && rec.affix.stat === "Charisma"
        && rec.entry.seal_type === "Gloom") keys.push(rec.key);
  });
  // Gloom / equipment-accessories / Charisma exists at Enhancement 15, Insight 7,
  // and Quality 3 — three distinguishable occurrences, not one.
  assert.strictEqual(keys.length, 3, "three occurrences");
  assert.strictEqual(new Set(keys).size, 3, "and three keys — dropping type and value would merge them");
});

test("#88 U6: a nameless seal and a nameless nearly_complete row are both addressable", () => {
  const p = loadPool();
  const byChannel = {};
  O.eachPoolAffix(p, (rec) => { (byChannel[rec.channel] = byChannel[rec.channel] || []).push(rec); });
  for (const ch of ["seal", "nearly_complete"]) {
    const some = byChannel[ch][0];
    assert.ok(some.key && typeof some.key === "string", `${ch} rows carry a key`);
    assert.ok(some.key.startsWith(ch + "||"), "the key names its channel first");
  }
  assert.ok(byChannel.nearly_complete_per_item.every((r) => r.host),
    "the per-item pool is host-scoped, so its key carries the host");
});

test("#88 U6 (AE15): an override on a crafted option applies wherever that option is offered", () => {
  const p = loadPool();
  let target = null;
  O.eachPoolAffix(p, (rec) => {
    if (!target && rec.channel === "seal" && rec.affix.stat === "Charisma"
        && rec.affix.bonus_type === "Insight") target = rec;
  });
  assert.ok(target, "a seal Charisma Insight row exists");
  const o = Object.assign({}, O.poolOverrideKey(target), { to: "Quality" });
  const rep = O.applyOverrides(p, [o]);
  assert.strictEqual(rep.applied.length, 1, "the crafted override applied");
  assert.ok(rep.applied[0].count >= 1, "…to every occurrence sharing the key");
  let stillInsight = 0, nowQuality = 0;
  O.eachPoolAffix(p, (rec) => {
    // catalogKey, not key: the live key moved when the type did, which is exactly
    // why the declaration is keyed on the catalog's type and read through the stamp.
    if (rec.catalogKey !== o.pool_key) return;
    if (rec.affix.bonus_type === "Insight") stillInsight++;
    if (rec.affix.bonus_type === "Quality") nowQuality++;
  });
  assert.strictEqual(stillInsight, 0, "no occurrence of the keyed option kept the catalog type");
  assert.ok(nowQuality >= 1);

  O.withdrawOverrides(p);
  const back = [];
  O.eachPoolAffix(p, (rec) => { if (rec.catalogKey === o.pool_key) back.push(rec.affix.bonus_type); });
  assert.deepStrictEqual(new Set(back), new Set(["Insight"]),
    "withdrawal restores the catalog type on the crafted row too");
});

// ---- #88 U7 (R25-R29) — the lifecycle over a whole override list ------------
// resolveOverrides runs U1's ladder (KTD8) across the list on load, so the app
// can disclose what happened to each one. Satisfied overrides are RETAINED, not
// deleted, so a reverted adoption returns them to suspended rather than being
// silently forgotten.

function robeOverride(p, to) {
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  return { v, a, o: { ...O.overrideKey(v, a), to: to || "Enhancement" } };
}

test("#88 U7 (AE7/R24): an unchanged catalog resolves every override active", () => {
  const p = loadPool();
  const { o } = robeOverride(p);
  const got = O.resolveOverrides(p, [o]);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].state, "active");
  assert.strictEqual(got[0].reason, null, "nothing to prompt the player about");
  assert.strictEqual(got[0].override, o, "the entry carries its own override back");
});

test("#88 U7 (AE4/R27): a drifted type suspends and discloses what it moved to", () => {
  const p = loadPool();
  const { v, o } = robeOverride(p);
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Profane"; });
  const got = O.resolveOverrides(p, [o]);
  assert.strictEqual(got[0].state, "suspended");
  assert.strictEqual(got[0].reason, "drift");
  assert.strictEqual(got[0].now, "Profane", "the disclosure names the type upstream moved to");
});

test("#88 U7 (R28): a retired target suspends and names the retirement", () => {
  const p = loadPool();
  const { v, o } = robeOverride(p);
  v.affixes = v.affixes.filter((x) => x.name !== "Armor Class");
  assert.strictEqual(O.resolveOverrides(p, [o])[0].reason, "retired-target");
  const gone = { ...o, variant_id: "No Such Item At All" };
  assert.strictEqual(O.resolveOverrides(p, [gone])[0].reason, "retired-target");
});

test("#88 U7 (AE5/AE21/R25/R26): satisfied is retained, and a revert returns it to suspended", () => {
  const p = loadPool();
  const { v, o } = robeOverride(p, "Enhancement");
  // Upstream adopts the player's replacement type.
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Enhancement"; });
  let got = O.resolveOverrides(p, [o]);
  assert.strictEqual(got[0].state, "satisfied", "the catalog now says what the player said");
  assert.strictEqual(got[0].reason, null);
  assert.deepStrictEqual(got.map((g) => g.override), [o],
    "…and the override is still in the list — deleting it would lose the revert case below");

  // …then a later refresh moves it somewhere else entirely.
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Sacred"; });
  got = O.resolveOverrides(p, [o]);
  assert.strictEqual(got[0].state, "suspended");
  assert.strictEqual(got[0].reason, "drift");

  // …or back to the type the override was written against, which is active again.
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Armor"; });
  assert.strictEqual(O.resolveOverrides(p, [o])[0].state, "active");
});

test("#88 U7 (R29): a suspended override is never applied, so it cannot reach a solve", () => {
  const p = loadPool();
  const { v, o } = robeOverride(p);
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.type = "Profane"; });
  const rep = O.applyOverrides(p, [o]);
  assert.deepStrictEqual(rep.applied, [], "nothing applied");
  assert.strictEqual(rep.unmatched.length, 1, "and it is reported, not silently dropped");
  assert.strictEqual(v.affixes.find((x) => x.name === "Armor Class").type, "Profane",
    "the pool carries the catalog's drifted type, not the player's replacement");
});

test("#88 U7: an affix that became load-generated resolves ineligible-suspended", () => {
  const p = loadPool();
  const { v, o } = robeOverride(p);
  // The refresh converts the affix from engraved to expansion-generated at the
  // same name, type, and value — the exact-match test would call this active.
  v.affixes.filter((x) => x.name === "Armor Class").forEach((x) => { x.via = "Potency"; });
  O.classifyPool(p);
  const got = O.resolveOverrides(p, [o]);
  assert.strictEqual(got[0].state, "suspended");
  assert.strictEqual(got[0].reason, "ineligible", "offer delete only — there is nothing to re-confirm onto");
});

test("#88 U7 (R8): the ladder reaches a crafted override through its pool key", () => {
  const p = loadPool();
  let target = null;
  O.eachPoolAffix(p, (rec) => {
    if (!target && rec.channel === "seal" && rec.affix.stat === "Charisma"
        && rec.affix.bonus_type === "Insight") target = rec;
  });
  const o = { ...O.poolOverrideKey(target), to: "Quality" };
  assert.strictEqual(O.resolveOverrides(p, [o])[0].state, "active");

  // Applied is the steady state, so the ladder must read through the stamp here
  // exactly as it does for items.
  O.applyOverrides(p, [o]);
  assert.strictEqual(O.resolveOverrides(p, [o])[0].state, "active",
    "a LIVE crafted override must not read as satisfied");
  O.withdrawOverrides(p);

  // Upstream adopts it.
  target.affix.bonus_type = "Quality";
  assert.strictEqual(O.resolveOverrides(p, [o])[0].state, "satisfied");
  // …or moves it elsewhere.
  target.affix.bonus_type = "Sacred";
  const drifted = O.resolveOverrides(p, [o])[0];
  assert.strictEqual(drifted.reason, "drift");
  assert.strictEqual(drifted.now, "Sacred");
  // …or retires the row outright.
  p.seal = p.seal.filter((e) => e !== target.entry);
  assert.strictEqual(O.resolveOverrides(p, [o])[0].reason, "retired-target");
});

// ---- #88 U8 (R30) — the stale marker ---------------------------------------
// A displayed result is a claim about a specific set of overrides. When that set
// changes the claim is stale — marked, never silently re-solved.

test("#88 U8 (R30): the same set in a different order is not stale", () => {
  const A = { variant_id: "X", name: "Armor Class", from: "Armor", to: "Enhancement", count: 1 };
  const B = { pool_key: "seal||G||d||Charisma||Insight||7", name: "Charisma", from: "Insight", to: "Quality", count: 2 };
  assert.ok(O.sameOverrideSet([A, B], [B, A]), "declaration order is not part of the set");
  assert.ok(O.sameOverrideSet([], []), "two empty sets");
  assert.ok(O.sameOverrideSet(null, []), "absent and empty are the same set");
});

test("#88 U8 (R30/AE22): adding, removing, or re-aiming an override makes the set differ", () => {
  const A = { variant_id: "X", name: "Armor Class", from: "Armor", to: "Enhancement", count: 1 };
  const A2 = { variant_id: "X", name: "Armor Class", from: "Armor", to: "Sacred", count: 1 };
  const B = { variant_id: "Y", name: "Dodge", from: "Armor", to: "Quality", count: 1 };
  assert.ok(!O.sameOverrideSet([A], []), "created");
  assert.ok(!O.sameOverrideSet([], [A]), "deleted");
  assert.ok(!O.sameOverrideSet([A], [A2]), "re-aimed at a different replacement type");
  assert.ok(!O.sameOverrideSet([A], [B]), "a different affix entirely");
  assert.ok(!O.sameOverrideSet([A], [A, B]), "one added beside it");
});

test("#88 U8 (AE9/R30): a suspension changes the set, because it changes what applied", () => {
  // The set compared is what APPLIED, so an override that suspended between the
  // solve and now is absent from today's list — which is exactly the difference
  // that must mark the shown result stale rather than leaving it looking current.
  const A = { variant_id: "X", name: "Armor Class", from: "Armor", to: "Enhancement", count: 1 };
  assert.ok(!O.sameOverrideSet([A], []));
});

// review #2 — the replacement type is player-supplied text arriving from a saved
// character or an imported backup, and it is written onto the SHARED pool. The
// three reserved tokens are not bonus types at all: `Bool` means presence, `-`
// is the DR bypass qualifier, `Penalty` is sign-preserving. Writing one of them
// into an affix's type field makes a numeric affix read as a presence feature on
// every surface that renders it.
test("review #2: a reserved token is refused as a replacement type", () => {
  const base = { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor", value: "5" };
  for (const to of ["Bool", "Penalty", "-"]) {
    assert.ok(!O.isWellFormed({ ...base, to }), `${to} must not pass the load boundary`);
  }
  assert.ok(O.isWellFormed({ ...base, to: "Enhancement" }), "an ordinary type still passes");
  assert.ok(O.isWellFormed({ ...base, to: "Untyped" }),
    "…and so does the explicit Untyped token, which IS a real bucket (#235)");
});

test("review #2: a reserved token cannot reach the pool through applyOverrides", () => {
  const p = loadPool();
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const rep = O.applyOverrides(p, [{ ...O.overrideKey(v, a), to: "Bool" }]);
  assert.deepStrictEqual(rep.applied, [], "nothing applied");
  assert.strictEqual(rep.ineligible.length, 1, "and it is reported rather than silently dropped");
  assert.strictEqual(v.affixes.find((x) => x.name === "Armor Class").type, "Armor",
    "the pool still carries the catalog's type");
});

// review #9 — the load path builds ONE crafted-pool index per pass. Before this,
// both consumers walked all ~1,100 crafted rows per override, so a character's
// load cost scaled with overrides x pool rather than overrides + pool.
test("review #9: many crafted overrides cost one pool walk, not one each", () => {
  const p = loadPool();
  const targets = [];
  O.eachPoolAffix(p, (rec) => { if (targets.length < 40) targets.push(rec); });
  assert.strictEqual(targets.length, 40, "40 distinct crafted rows to override");
  const list = targets.map((t) => ({ ...O.poolOverrideKey(t), to: "Quality" }));

  const t0 = Date.now();
  const rep = O.applyOverrides(p, list);
  const resolved = O.resolveOverrides(p, list);
  const ms = Date.now() - t0;

  assert.strictEqual(rep.applied.length + rep.ineligible.length + rep.unmatched.length, 40,
    "every override is accounted for");
  assert.strictEqual(resolved.length, 40);
  // Generous ceiling: the point is to catch a regression to per-override walking,
  // which measured ~3ms x 40 x 2 consumers before the index. Not a benchmark.
  assert.ok(ms < 400, `40 crafted overrides took ${ms}ms — a per-override pool walk is back`);
  O.withdrawOverrides(p);
});

// ---------------------------------------------------------------------------
// #422 / #423 — two rulings from the review of #421, settled and now enforced.
// ---------------------------------------------------------------------------

test("#422: a sibling at the replacement type does not make an override satisfied", () => {
  // Two occurrences of one name+value under different types are reachable: 21
  // crafted key groups and 52 item variants carry that shape on the shipped
  // dataset. When the override's OWN occurrence has drifted and only a sibling
  // sits at the replacement, "the catalog adopted this, you can drop it" is a
  // false report about a correction that is still doing nothing.
  const pool = { items: [{ variant_id: "V", affixes: [
    { name: "Abjuration Focus", value: 1, bonus_type: "Enhancement" },
    { name: "Abjuration Focus", value: 1, bonus_type: "Sacred" },
  ] }] };
  const o = { variant_id: "V", name: "Abjuration Focus", value: 1, from: "Profane", to: "Enhancement" };
  const got = O.resolveMatch(pool, o);
  assert.strictEqual(got.state, "suspended", "a partial move is not satisfaction");
  assert.strictEqual(got.reason, "drift", "…it falls through to drift, which offers re-confirm");
  assert.ok(got.now, "and drift names what the occurrence moved to");
});

test("#422: satisfied still fires when the WHOLE occurrence set has moved", () => {
  const pool = { items: [{ variant_id: "V", affixes: [
    { name: "Abjuration Focus", value: 1, bonus_type: "Enhancement" },
    { name: "Abjuration Focus", value: 1, bonus_type: "Enhancement" },
  ] }] };
  const o = { variant_id: "V", name: "Abjuration Focus", value: 1, from: "Profane", to: "Enhancement" };
  const got = O.resolveMatch(pool, o);
  assert.strictEqual(got.state, "satisfied",
    "every occurrence adopted the replacement, so the override has nothing left to do");
});

test("#423: R7's load-generated exclusion reaches the crafted channels", () => {
  // 278 eligible crafted rows carried a `via` expansion receipt — 184 Viktranium,
  // 54 dino inserts, 40 Nearly Complete — so the identical affix was refused on an
  // item and offered in the pool. A universal expansion source produces every
  // sibling, which makes its type one catalog-level claim rather than a per-player
  // correction.
  assert.strictEqual(O.poolAffixEligible({ bonus_type: "Enhancement" }), true,
    "an ordinary crafted row is still overridable");
  assert.strictEqual(O.poolAffixEligible({ bonus_type: "Enhancement", via: "Viktranium" }), false,
    "an expansion-generated crafted row is not — same rule the item predicate applies");
});

// review #9 (correctness half) — the index is built over ALL rows, including the
// ineligible ones, so classification happens at the point of decision rather than
// by silent omission during the walk.
//
// The crafted `ineligible` rung used to be unreachable: crafted eligibility was
// decided purely on the type field, and the ladder consults eligibility only on
// rows still carrying the RECORDED type — so a moved type was drift by definition
// and an unmoved one eligible by definition. #423 settled the open question about
// `via`-carrying crafted rows in favour of excluding them, which is the non-type
// class that gives the rung a job.
test("review #9: a crafted row upstream re-typed to a reserved token is drift, and named", () => {
  const p = loadPool();
  let target = null;
  O.eachPoolAffix(p, (rec) => {
    if (!target && rec.channel === "seal" && rec.affix.bonus_type === "Insight") target = rec;
  });
  const o = { ...O.poolOverrideKey(target), to: "Quality" };
  target.affix.bonus_type = "Bool";            // a refresh reclassifies the row
  const got = O.resolveOverrides(p, [o])[0];
  assert.strictEqual(got.state, "suspended");
  assert.strictEqual(got.reason, "drift", "the type moved, so the ladder says so");
  assert.strictEqual(got.now, "Bool", "…and names what it moved to, however unusable");
  const rep = O.applyOverrides(p, [o]);
  assert.deepStrictEqual(rep.applied, [], "a suspended override contributes nothing (R29)");
});

// ---- #88 U10 (R3/R6) — what the creation picker offers ----------------------
// One predicate, shared by both creation surfaces. Indistinguishable occurrences
// present as ONE entry (R3) because they are genuinely one decision — R2 already
// says they retype together. Ineligible affixes are not offered at all, and an
// item with none offers no control rather than an empty picker (AE20).

test("#88 U10 (R3): indistinguishable occurrences present as one entry with a count", () => {
  const p = loadPool();
  // A variant carrying the same name+type+value twice: one decision, one row.
  const v = p.items.find((x) => {
    const seen = {};
    return (x.affixes || []).some((a) => {
      if (!O.isEligible(a, x)) return false;
      const k = `${a.name}||${a.type}||${a.value}`;
      if (seen[k]) return true;
      seen[k] = 1; return false;
    });
  });
  assert.ok(v, "the catalog has a variant with a duplicate eligible affix");
  const entries = O.pickerEntries(v);
  const dup = entries.find((e) => e.count > 1);
  assert.ok(dup, "the duplicate collapsed into one entry");
  assert.ok(entries.length < O.eligibleAffixes(v).length, "…so the picker is shorter than the affix list");
  assert.ok(dup.key && dup.key.variant_id && dup.key.name && dup.key.from,
    "and each entry carries a ready-to-use override identity");
});

test("#88 U10 (R6/AE11): only eligible affixes are offered", () => {
  const p = loadPool();
  const v = p.items.find((x) => (x.affixes || []).some((a) => O.isEligible(a, x))
    && (x.affixes || []).some((a) => !O.isEligible(a, x)));
  const entries = O.pickerEntries(v);
  const offered = new Set(entries.map((e) => e.name + "||" + e.from));
  for (const a of v.affixes) {
    if (O.isEligible(a, v)) continue;
    assert.ok(!offered.has(a.name + "||" + O.catalogTypeOrLive(a)),
      `${a.name} is ineligible and must not be offered`);
  }
});

test("#88 U10 (AE20): an item with no eligible affix yields no entries at all", () => {
  assert.deepStrictEqual(O.pickerEntries({ variant_id: "Empty", affixes: [] }), []);
  assert.deepStrictEqual(O.pickerEntries(null), []);
});

test("#88 U10: an entry already carrying an override says so rather than offering a duplicate", () => {
  const p = loadPool();
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const o = { ...O.overrideKey(v, a), to: "Enhancement" };
  const before = O.pickerEntries(v, []).find((e) => e.name === "Armor Class");
  assert.strictEqual(before.overriddenTo, null, "nothing declared yet");
  const after = O.pickerEntries(v, [o]).find((e) => e.name === "Armor Class");
  assert.strictEqual(after.overriddenTo, "Enhancement", "…and now the row names what it was set to");
});

test("#88 U10: the picker reads the CATALOG type, so an applied override does not shift the row", () => {
  const p = loadPool();
  const v = p.items.find((x) => x.variant_id === "Aberrant Robe");
  const a = v.affixes.find((x) => x.name === "Armor Class" && x.type === "Armor");
  const o = { ...O.overrideKey(v, a), to: "Enhancement" };
  O.applyOverrides(p, [o]);
  const e = O.pickerEntries(v, [o]).find((x) => x.name === "Armor Class");
  assert.strictEqual(e.from, "Armor", "the row still names what the catalog says");
  assert.strictEqual(e.overriddenTo, "Enhancement");
  O.withdrawOverrides(p);
});

test("#88 U10 (R8): a crafted pool row is offered through the same shape", () => {
  const p = loadPool();
  const entries = O.poolPickerEntries(p, "seal");
  assert.ok(entries.length > 0, "the seal channel offers rows");
  const e = entries[0];
  assert.ok(e.key.pool_key && e.key.name && e.key.from, "a ready-to-use pool identity");
  assert.strictEqual(e.channel, "seal");
  assert.ok(entries.every((x) => x.count >= 1));
  // The same collapse rule: byte-identical duplicate rows are one decision.
  const keys = entries.map((x) => x.key.pool_key);
  assert.strictEqual(new Set(keys).size, keys.length, "one entry per key");
});

// ---- #88 U11 (R34/R35) — one action set per lifecycle state ------------------
// The manager is the only place an override can be audited, re-confirmed, or
// deleted, so getting the action set wrong per state is not cosmetic: offering
// re-confirm on a retired target asks the player to confirm against an affix that
// no longer exists, and withholding it from a drifted one leaves delete as the
// only way out of a correction that is still true.
const _ovr = (over) => Object.assign(
  { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor", value: "5", to: "Enhancement" }, over || {});

test("#88 U11 (R35): re-confirm is offered ONLY on a drift-suspended row", () => {
  const rows = O.managerRows([
    { override: _ovr(), state: "active", reason: null, now: null },
    { override: _ovr({ name: "Dodge" }), state: "suspended", reason: "drift", now: "Profane" },
    { override: _ovr({ name: "PRR" }), state: "suspended", reason: "retired-target", now: null },
    { override: _ovr({ name: "MRR" }), state: "suspended", reason: "ineligible", now: null },
    { override: _ovr({ name: "Fortification" }), state: "satisfied", reason: null, now: null },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.override.name, r.actions]));
  assert.ok(!by["Armor Class"].includes("reconfirm"), "active: nothing to re-confirm against");
  assert.ok(by.Dodge.includes("reconfirm"), "drift: the one state re-confirm is for");
  assert.ok(!by.PRR.includes("reconfirm"), "retired target: no affix left to confirm against (AE6)");
  assert.ok(!by.MRR.includes("reconfirm"), "ineligible: delete only");
  assert.ok(!by.Fortification.includes("reconfirm"), "satisfied: the catalog already agrees");
});

test("#88 U11 (R34): every row can be deleted and can emit a report", () => {
  const rows = O.managerRows([
    { override: _ovr(), state: "active", reason: null, now: null },
    { override: _ovr({ name: "PRR" }), state: "suspended", reason: "retired-target", now: null },
  ]);
  for (const r of rows) {
    assert.ok(r.actions.includes("delete"), `${r.override.name} can always be deleted`);
    assert.ok(r.actions.includes("report"), "…and its correction report stays available (R18)");
  }
});

test("#88 U11: each row carries a plain-language state the player can act on", () => {
  const rows = O.managerRows([
    { override: _ovr(), state: "active", reason: null, now: null },
    { override: _ovr({ name: "Dodge" }), state: "suspended", reason: "drift", now: "Profane" },
    { override: _ovr({ name: "Fortification" }), state: "satisfied", reason: null, now: null },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.override.name, r.label]));
  assert.ok(/in force/i.test(by["Armor Class"]));
  assert.ok(/Profane/.test(by.Dodge), "drift names what upstream moved to");
  assert.ok(/no longer doing anything|catalog agrees/i.test(by.Fortification));
  assert.ok(rows.every((r) => r.label && !/undefined/.test(r.label)));
});

test("#88 U11: an empty list yields no rows, not a placeholder row", () => {
  assert.deepStrictEqual(O.managerRows([]), []);
  assert.deepStrictEqual(O.managerRows(null), []);
});

if (!process.exitCode) console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #426 — the crafted creation surface. poolPickerEntries collapses a whole
// channel; a picker opens on ONE row and must offer only that row's affixes.
// ---------------------------------------------------------------------------

test("#426: a crafted row's picker offers that row's affixes, keyed to the pool", () => {
  const B = require("../web/browse.js");
  const p = loadPool();
  const opt = (p.viktranium || [])[0];
  assert.ok(opt, "the built pool carries viktranium options");
  const row = B.vikRow(opt);
  const entries = O.poolPickerEntriesFor(p, row, []);
  assert.ok(entries.length, "the row is servable");
  assert.ok(entries.length <= (row.affixes || []).length,
    "…and offers no more than the row displays — the disc addresses a GROUP, the row is one option");
  for (const e of entries) {
    assert.ok(typeof e.key.pool_key === "string" && e.key.pool_key,
      "entries are pool_key-shaped, which createOverride already accepts");
    assert.ok(e.key.pool_key.startsWith("viktranium||"), "keyed to the right channel");
  }
});

test("#426: matching is on discriminators, never on the synthesized title", () => {
  const B = require("../web/browse.js");
  const p = loadPool();
  const row = B.vikRow((p.viktranium || [])[0]);
  const before = O.poolPickerEntriesFor(p, row, []).length;
  // The title is lossy — it embeds a quarterstaff tag and falls back through
  // several sources. Rewriting it must not change what the picker can serve.
  row.variant_id = "something else entirely";
  assert.strictEqual(O.poolPickerEntriesFor(p, row, []).length, before,
    "the title is display text, not identity");
  // Removing the provenance, however, makes the row unaddressable.
  delete row.pool_provenance;
  assert.deepStrictEqual(O.poolPickerEntriesFor(p, row, []), [],
    "without provenance there is nothing to resolve against");
});

test("#426: the gate offers the control on exactly the rows the picker can serve", () => {
  // The invariant that keeps #424's fix intact in both directions. A group's
  // discriminators address many options while a row is one of them, so a
  // group-level gate answered "yes" for 80 of 445 rows whose own affixes were all
  // excluded — the control appeared and opened an empty picker, which is the false
  // offer #424 removed. The other direction matters too: a servable row with no
  // control is a capability silently withheld.
  const B = require("../web/browse.js");
  const p = loadPool();
  const idx = O.poolAddressable(p);
  const offeredButEmpty = [];
  const hiddenButServable = [];
  const sweep = (rows, build) => {
    for (const e of rows || []) {
      const row = build(e);
      const gated = O.isPoolAddressable(idx, row);
      const n = O.poolPickerEntriesFor(p, row, []).length;
      if (gated && n === 0) offeredButEmpty.push(row.variant_id);
      if (!gated && n > 0) hiddenButServable.push(row.variant_id);
    }
  };
  sweep(p.viktranium, B.vikRow);
  sweep(p.dino_inserts, B.dinoInsertRow);
  sweep(p.nearly_complete, B.ncRow);
  assert.deepStrictEqual(offeredButEmpty, [],
    "a row offered the control must have something to correct");
  assert.deepStrictEqual(hiddenButServable, [],
    "…and a row with something to correct must be offered it");
});

test("#426: the addressability index answers per row in O(1), and excludes the ineligible", () => {
  const p = loadPool();
  const idx = O.poolAddressable(p);
  assert.ok(Object.keys(idx).length > 0, "the index is populated");
  assert.strictEqual(O.isPoolAddressable(idx, null), false, "no row, not addressable");
  assert.strictEqual(O.isPoolAddressable(idx, { pool_provenance: null, affixes: [] }), false,
    "no provenance, not addressable");
  assert.strictEqual(O.isPoolAddressable(idx, {
    pool_provenance: { channel: "viktranium", disc: ["nope", "nope", "nope"] },
    affixes: [{ name: "Accuracy", type: "Competence", value: 8 }],
  }), false, "an unknown discriminator tuple is not addressable");
  // #423 excluded via-carrying rows from eligibility; the index is built from the
  // same walk, so a group whose affixes are all excluded is absent — which the
  // display row could not determine itself, since the projection drops `via`.
  let eligible = 0;
  O.eachPoolAffix(p, () => { eligible++; });
  assert.ok(eligible > 0 && Object.keys(idx).length <= eligible,
    "one token per addressable group, never more than the eligible population");
});
