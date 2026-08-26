// Saved-bundle store (plan 2026-08-25-001, U2). Run: node tests/saved-bundles.test.js
//
// The store holds a player's own ranking — affixes, their order, and the floor
// and cap declared for each — independent of any character. These tests pin the
// write boundary hardest, because that is what keeps a bundle portable: a bundle
// that carried a declared credit would silently assert one character's
// enhancements on the next character it is applied to.
const assert = require("assert");
const B = require("../web/saved-bundles.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name} \n    ${e.message}`); failed++; }
}

/** A localStorage stand-in. `failOn` makes setItem throw, so the failure paths
 *  are exercised against a real throw rather than a stubbed return value. */
function fakeStorage(initial, failOn) {
  const map = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOn) { const e = new Error("nope"); e.name = failOn; throw e; }
      map.set(k, v);
    },
    _raw: () => map.get(B.STORE_KEY),
  };
}

const RANKING = ["Constitution", "Dodge", "Melee Power"];

console.log("\n-- saved bundles: round trip --");

test("U2: a saved bundle round-trips with its affix ORDER preserved", () => {
  const st = fakeStorage();
  B.saveBundle(B.makeBundle({ id: "b1", name: "Reaper Tank", affixes: RANKING }), st);
  const [got] = B.listBundles(st);
  assert.deepStrictEqual(got.affixes, RANKING,
    "order is the whole point — #1 is maximized first, so a reordered restore is a different build");
  assert.strictEqual(got.name, "Reaper Tank");
});

test("U2: floors and caps survive, keyed to the affixes they belong to", () => {
  const st = fakeStorage();
  B.saveBundle(B.makeBundle({
    id: "b1", name: "T", affixes: RANKING,
    floors: { Constitution: 40 }, caps: { Dodge: 60 },
  }), st);
  const [got] = B.listBundles(st);
  assert.deepStrictEqual(got.floors, { Constitution: 40 });
  assert.deepStrictEqual(got.caps, { Dodge: 60 });
});

console.log("\n-- saved bundles: the write boundary --");

test("U2: a character-level key is DROPPED, not stored", () => {
  // The load-bearing test for portability. Each of these describes one
  // character's setup, not the goal, so a bundle carrying one would assert it on
  // whatever character the bundle is applied to next.
  const rec = B.makeBundle({
    id: "b1", name: "T", affixes: RANKING,
    declaredCredits: { "Constitution||Insight": { stat: "Constitution", value: 6 } },
    craftingRung: "everything", ml: 36, race: "Dwarf", blocklist: ["Some Item"],
    ownedSetAugments: ["Arcane Barrier"], targetCaps: { Dodge: 99 },
  });
  assert.deepStrictEqual(Object.keys(rec).sort(), [...B.BUNDLE_KEYS].sort(),
    "the record carries the allowlisted keys and nothing else");
  for (const k of ["declaredCredits", "craftingRung", "ml", "race", "blocklist",
    "ownedSetAugments", "targetCaps"]) {
    assert.ok(!(k in rec), `${k} must not reach the store`);
  }
});

test("U2: a bound for an affix the bundle does not carry is dropped", () => {
  // An orphan bound looks live and can never take effect — nothing that reads
  // this bundle could apply it, because the affix is not in the ranking.
  const rec = B.makeBundle({
    id: "b1", name: "T", affixes: ["Constitution"],
    floors: { Constitution: 40, Dodge: 20 }, caps: { "Melee Power": 50 },
  });
  assert.deepStrictEqual(rec.floors, { Constitution: 40 }, "Dodge is not in the ranking");
  assert.deepStrictEqual(rec.caps, {}, "Melee Power is not in the ranking");
});

test("U2: junk bounds are dropped on the same predicate the wizard applies", () => {
  const rec = B.makeBundle({
    id: "b1", name: "T", affixes: RANKING,
    floors: { Constitution: -5, Dodge: "", "Melee Power": "abc" },
    caps: { Constitution: null, Dodge: 0 },
  });
  assert.deepStrictEqual(rec.floors, {}, "negative, empty and non-numeric all drop");
  assert.deepStrictEqual(rec.caps, { Dodge: 0 }, "zero is a real bound and survives");
});

test("U2: non-string and duplicate affixes are sanitized away", () => {
  const rec = B.makeBundle({
    id: "b1", name: "  T  ",
    affixes: ["Constitution", null, 42, "  Dodge  ", "Constitution", "", { x: 1 }],
  });
  assert.deepStrictEqual(rec.affixes, ["Constitution", "Dodge"],
    "a hand-edited backup can carry anything; a stored non-string is a ghost row");
  assert.strictEqual(rec.name, "T", "the name is trimmed");
});

test("U2: saveBundle re-makes the record, so a raw object cannot bypass the boundary", () => {
  const st = fakeStorage();
  B.saveBundle({ id: "b1", name: "T", affixes: RANKING, craftingRung: "everything" }, st);
  const [got] = B.listBundles(st);
  assert.ok(!("craftingRung" in got), "the write boundary holds even when makeBundle was skipped");
});

console.log("\n-- saved bundles: failure and corruption --");

test("U2: a failed write REPORTS failure rather than a save that did not land", () => {
  const st = fakeStorage(null, "QuotaExceededError");
  const r = B.saveBundle(B.makeBundle({ id: "b1", name: "T", affixes: RANKING }), st);
  assert.strictEqual(r.ok, false, "not ok");
  assert.strictEqual(r.full, true, "and named as a quota failure, which is the actionable one");
});

test("U2: a non-quota write failure is not mislabelled as full", () => {
  const st = fakeStorage(null, "SecurityError");
  const r = B.writeAll([], st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.full, false, "only a quota error may claim the store is full");
});

test("U2: absent, malformed, and wrong-shaped stores all read as empty", () => {
  assert.deepStrictEqual(B.listBundles(fakeStorage()), [], "absent");
  assert.deepStrictEqual(B.listBundles(fakeStorage({ [B.STORE_KEY]: "{" })), [], "malformed JSON");
  assert.deepStrictEqual(B.listBundles(fakeStorage({ [B.STORE_KEY]: '{"a":1}' })), [], "object, not a list");
  assert.deepStrictEqual(B.listBundles(fakeStorage({ [B.STORE_KEY]: '[null,{"no":"id"}]' })), [],
    "entries without an id are not bundles");
  assert.deepStrictEqual(B.listBundles(null), [], "no storage at all");
});

console.log("\n-- saved bundles: ids, rename, delete --");

test("U2: ids are monotonic and never reuse a deleted number", () => {
  const list = [{ id: "b3" }, { id: "b1" }];
  assert.strictEqual(B.nextId(list), "b4", "one past the highest, not a gap-filler");
  assert.strictEqual(B.nextId([]), "b1");
  assert.strictEqual(B.nextId([{ id: "junk" }]), "b1", "an unparseable id does not poison the counter");
});

test("U2: rename preserves affixes, order, bounds, and position", () => {
  const st = fakeStorage();
  B.saveBundle(B.makeBundle({ id: "b1", name: "Old", affixes: RANKING, floors: { Dodge: 5 } }), st);
  B.saveBundle(B.makeBundle({ id: "b2", name: "Other", affixes: ["Strength"] }), st);
  assert.strictEqual(B.renameBundle("b1", "New", st).ok, true);
  const list = B.listBundles(st);
  const one = list.find((r) => r.id === "b1");
  assert.strictEqual(one.name, "New");
  assert.deepStrictEqual(one.affixes, RANKING, "the ranking is untouched by a rename");
  assert.deepStrictEqual(one.floors, { Dodge: 5 });
  assert.deepStrictEqual(list.map((r) => r.id), ["b2", "b1"], "position is preserved");
});

test("U2: renaming an unknown id reports missing rather than inventing a record", () => {
  const st = fakeStorage();
  const r = B.renameBundle("nope", "X", st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.missing, true);
  assert.deepStrictEqual(B.listBundles(st), [], "nothing was created");
});

test("U2: delete removes one bundle and leaves its siblings", () => {
  const st = fakeStorage();
  B.saveBundle(B.makeBundle({ id: "b1", name: "A", affixes: ["Strength"] }), st);
  B.saveBundle(B.makeBundle({ id: "b2", name: "B", affixes: ["Dodge"] }), st);
  assert.strictEqual(B.deleteBundle("b1", st).ok, true);
  assert.deepStrictEqual(B.listBundles(st).map((r) => r.id), ["b2"]);
});

test("U2: name collision is case-insensitive and never collides with itself", () => {
  const list = [{ id: "b1", name: "Reaper Tank" }, { id: "b2", name: "Caster" }];
  assert.strictEqual(B.nameCollides("reaper tank", list), true, "case-insensitive");
  assert.strictEqual(B.nameCollides("Reaper Tank", list, "b1"), false,
    "renaming a bundle to the name it already has is not a collision");
  assert.strictEqual(B.nameCollides("New", list), false);
  assert.strictEqual(B.nameCollides("   ", list), false, "an empty name is not a collision");
});

console.log("\n-- merge on restore (doc-review round 1) --");

test("MERGE: a restore does not destroy bundles made since the export", () => {
  // The shipped bug. writeAll replaced the store, so importing a backup deleted
  // every bundle the player had made since that export — authored work that
  // exists nowhere else, on the one path they reach because something already
  // went wrong.
  const st = fakeStorage();
  B.saveBundle(B.makeBundle({ id: "b1", name: "Local", affixes: ["Constitution"] }), st);
  B.mergeIn([{ id: "b9", name: "FromFile", affixes: ["Dodge"] }], st);
  assert.deepStrictEqual(B.listBundles(st).map((r) => r.name).sort(), ["FromFile", "Local"],
    "both survive — the local one is not overwritten");
});

test("MERGE: a colliding id from another browser is re-issued, not overwritten", () => {
  // nextId is per-store monotonic, so two browsers independently produce "b1".
  const st = fakeStorage();
  B.saveBundle(B.makeBundle({ id: "b1", name: "Local", affixes: ["Constitution"] }), st);
  B.mergeIn([{ id: "b1", name: "Different", affixes: ["Dodge"] }], st);
  const list = B.listBundles(st);
  assert.strictEqual(list.length, 2, "nothing was lost to the id clash");
  const local = list.find((r) => r.name === "Local");
  const incoming = list.find((r) => r.name === "Different");
  assert.strictEqual(local.id, "b1", "the local record keeps its id");
  assert.notStrictEqual(incoming.id, "b1", "and the incoming one is re-issued");
});

test("MERGE: re-importing the same backup is idempotent", () => {
  // Same id AND same name is the same bundle coming home; it must not duplicate
  // on every import.
  const st = fakeStorage();
  const rec = { id: "b1", name: "Same", affixes: ["Constitution"] };
  B.mergeIn([rec], st);
  B.mergeIn([rec], st);
  assert.strictEqual(B.listBundles(st).length, 1, "one record, not two");
});

test("MERGE: the incoming copy still passes the write boundary", () => {
  const st = fakeStorage();
  B.mergeIn([{ id: "b1", name: "X", affixes: ["Constitution"], craftingRung: "everything" }], st);
  assert.ok(!("craftingRung" in B.listBundles(st)[0]),
    "a restore cannot smuggle a character-level key past the allowlist");
});

test("MERGE: a failed write reports failure rather than a silent loss", () => {
  const st = fakeStorage(null, "QuotaExceededError");
  const r = B.mergeIn([{ id: "b1", name: "X", affixes: ["Constitution"] }], st);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.full, true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
