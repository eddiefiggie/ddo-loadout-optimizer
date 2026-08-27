// #500 — the version store and the diff engine. Pure logic; no DOM, no browser
// storage (a fake `Storage` stands in, which is also how the quota path is
// reachable at all).
// Run: node tests/versions.test.js
const assert = require("assert");
const V = require("../web/versions.js");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

/** A localStorage stand-in. `limit` makes the quota path reachable — without it
 *  the retention policy (grow, then warn) could only ever be tested on its happy
 *  half, and the warn half is the half that matters. */
function fakeStorage(limit) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (limit != null && String(v).length > limit) {
        const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
      }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

function build(items, effective, sets) {
  return {
    status: "optimal",
    chosen: items.map(([slot, id, ml, crafts]) => ({
      slot, variant: { variant_id: id, minimum_level: ml, affixes: [], set_bonus: (crafts && crafts.sets) || [] },
    })),
    effective: effective || {}, perTarget: {}, breakdown: {},
    setsActive: sets || [], augmentsPlaced: [],
  };
}
function rec(id, snapshot, targets) {
  return { id, name: id, kind: "auto", query: { targets: targets || [] },
    inputs: { priorities: targets || [] }, snapshot };
}

// ---- store -----------------------------------------------------------------

test("#500: ids are monotonic and never reuse a deleted one", () => {
  // Reusing an id would silently re-point a comparison the player already had
  // open at a different build. Derived from the highest suffix PRESENT rather
  // than from the count, so deleting the newest does not hand its id back out.
  assert.strictEqual(V.nextId([]), "v1");
  assert.strictEqual(V.nextId([{ id: "v1" }, { id: "v2" }]), "v3");
  assert.strictEqual(V.nextId([{ id: "v7" }, { id: "v2" }]), "v8", "highest wins, not last");
  assert.strictEqual(V.nextId([{ id: "junk" }, { id: "v4" }]), "v5", "a malformed id is skipped, not counted");
});

test("#500: a corrupt store reads as empty rather than taking the screen down", () => {
  const st = fakeStorage();
  st.setItem(V.STORE_KEY, "{not json");
  assert.deepStrictEqual(V.listVersions(st), [], "unparseable -> empty");
  st.setItem(V.STORE_KEY, '{"not":"an array"}');
  assert.deepStrictEqual(V.listVersions(st), [], "wrong shape -> empty");
  st.setItem(V.STORE_KEY, '[{"id":"v1"},{"no":"id"},null]');
  assert.deepStrictEqual(V.listVersions(st).map((r) => r.id), ["v1"], "unusable entries are dropped, usable ones kept");
});

test("#500: newest first, and re-saving an id replaces rather than duplicates", () => {
  const st = fakeStorage();
  V.saveVersion({ id: "v1", name: "one" }, st);
  V.saveVersion({ id: "v2", name: "two" }, st);
  assert.deepStrictEqual(V.listVersions(st).map((r) => r.id), ["v2", "v1"]);
  V.saveVersion({ id: "v1", name: "one again" }, st);
  const list = V.listVersions(st);
  assert.deepStrictEqual(list.map((r) => r.id), ["v1", "v2"], "the re-saved one moves to the front");
  assert.strictEqual(list.filter((r) => r.id === "v1").length, 1, "and does not appear twice");
});

test("#500: a full store reports `full`, and does NOT report it for other failures", () => {
  // A swallowed quota error would stop recording history while the tab kept
  // implying every solve was being snapshotted, so the failure must reach the
  // caller. #548 changed what happens BEFORE this point — a full store now
  // reclaims its own auto snapshots and retries — but this case has nothing
  // reclaimable (one record, and it is the one being written), so it still
  // arrives here. What this return value no longer is, is the whole retention
  // policy; see the #548 block below.
  const tiny = fakeStorage(10);
  const res = V.saveVersion({ id: "v1", name: "x".repeat(100) }, tiny);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.full, true, "quota is named, so the caller can say what to do about it");

  // A storage that fails for some OTHER reason must not be reported as full:
  // "delete a version to make room" is wrong advice for a disabled store.
  const broken = { getItem: () => null, setItem: () => { throw new Error("nope"); } };
  const other = V.saveVersion({ id: "v1" }, broken);
  assert.strictEqual(other.ok, false);
  assert.strictEqual(other.full, false, "an unrelated failure is not mislabelled as a full store");

  // …and no storage at all is a clean false, never a throw.
  assert.deepStrictEqual(V.saveVersion({ id: "v1" }, null).ok, false);
});

// ---- diff ------------------------------------------------------------------

test("#500: an unranked stat that moved is reported — the point of comparing", () => {
  // The reason to diff two builds is to find what you did NOT ask about. A swap
  // that trades 2 Dodge for 40 HP is invisible to every other surface in the
  // app, because the solver was never told HP mattered.
  const a = rec("a", build([["Ring", "Ring of Power", 30]], { Constitution: 20, Dodge: 10, HP: 400 }), ["Constitution", "Dodge"]);
  const b = rec("b", build([["Ring", "Ring of Might", 28]], { Constitution: 20, Dodge: 8, HP: 440 }), ["Constitution", "Dodge"]);
  const d = V.diffVersions(a, b);
  const hp = d.stats.find((s) => s.stat === "HP");
  assert.ok(hp, "the unranked stat is in the diff at all");
  assert.strictEqual(hp.delta, -40);
  assert.strictEqual(hp.ranked, false, "…and is marked unranked, so the view can say why nothing protected it");
  assert.ok(!d.stats.some((s) => s.stat === "Constitution"), "a stat that did not move is not listed");
  // Ranked first: what the player asked to be protected is the headline.
  assert.strictEqual(d.stats[0].stat, "Dodge");
});

test("#500: two rings are two slots, not one slot changed twice", () => {
  // Comparing by slot NAME would call a swap of one ring a change of both,
  // because a build can wear two.
  const a = rec("a", build([["Ring", "R1", 30], ["Ring", "R2", 30]], {}), []);
  const b = rec("b", build([["Ring", "R1", 30], ["Ring", "R9", 30]], {}), []);
  const d = V.diffVersions(a, b);
  assert.strictEqual(d.slots.length, 2, "two ring slots");
  assert.strictEqual(d.slots.filter((s) => s.changed).length, 1, "exactly one of them changed");
});

test("#500: identical builds say so, rather than rendering an empty diff", () => {
  const snap = build([["Ring", "R1", 30]], { Constitution: 20 });
  const d = V.diffVersions(rec("a", snap, ["Constitution"]), rec("b", snap, ["Constitution"]));
  assert.strictEqual(d.identical, true);
  assert.ok(/identical/.test(R.versionDiffView(d, { a: "A", b: "B" })),
    "and the view states it in words");
});

test("#500: an empty slot on one side is a difference, not a missing row", () => {
  const a = rec("a", build([["Ring", "R1", 30], ["Cloak", "C1", 30]], {}), []);
  const b = rec("b", build([["Ring", "R1", 30]], {}), []);
  const d = V.diffVersions(a, b);
  const cloak = d.slots.find((s) => s.slot === "Cloak");
  assert.ok(cloak && cloak.changed, "the slot only one side fills is reported as changed");
  assert.strictEqual(cloak.b, null, "…with the empty side stated as empty");
  assert.ok(/empty/.test(R.versionDiffView(d, { a: "A", b: "B" })), "and the view prints it");
});

// ---- view ------------------------------------------------------------------

test("#500: the panel offers no picker it cannot fill", () => {
  // Same rule the outbid pricing (#345), the concession probe (#481) and the
  // upgrades search (#499) follow: a control that cannot work is not offered and
  // then failed, it is not offered.
  const empty = R.versionsPanel([], {});
  assert.ok(!/<select/.test(empty), "nothing saved -> no picker");
  // The empty state must say WHY there is nothing and WHAT to do about it, not
  // just render a blank. Matched on the instruction rather than the whole
  // sentence, so a copy edit does not fail a test about behaviour.
  assert.ok(/Nothing to compare against yet/.test(empty), "…it says why there is nothing");
  assert.ok(/re-solve/.test(empty), "…and what to do to get a comparison");
  const full = R.versionsPanel([{ id: "ver:v1", label: "Melee Power, Doublestrike", group: "Automatic snapshots" }], {});
  assert.ok(/<select/.test(full) && /Melee Power, Doublestrike/.test(full), "with candidates -> a picker");
  assert.ok(/optgroup label="Automatic snapshots"/.test(full), "grouped by where the candidate came from");
});

test("#500: the ranked and unranked deltas are rendered as separate claims", () => {
  const a = rec("a", build([["Ring", "R1", 30]], { Dodge: 10, HP: 400 }), ["Dodge"]);
  const b = rec("b", build([["Ring", "R2", 30]], { Dodge: 8, HP: 440 }), ["Dodge"]);
  const html = R.versionDiffView(V.diffVersions(a, b), { a: "This build", b: "Old" });
  assert.ok(/Your ranked priorities/.test(html) && /Everything else that moved/.test(html),
    "two sections, because the two are different kinds of fact");
  assert.ok(/is-ranked/.test(html), "the ranked row is marked as such");
  assert.ok(/never protected/.test(html) || /did not rank these/.test(html),
    "and the unranked section says why the solver let them move");
});

console.log(`\n${passed} passed`);

// ---------------------------------------------------------------------------
// #548 — auto snapshots grow unbidden and share one origin budget with the three
// stores that hold deliberate work. A full store now reclaims its OWN history
// and retries, instead of failing and having the player told to delete builds.

const auto = (id, pad) => ({ id, kind: "auto", name: id, pad: "x".repeat(pad || 200) });
const named = (id, pad) => ({ id, kind: "named", name: id, pad: "x".repeat(pad || 200) });

test("#548: pruning keeps the newest autos and never touches named or import", () => {
  const list = [auto("v9"), named("v8"), auto("v7"), { id: "v6", kind: "import" }, auto("v5")];
  assert.deepStrictEqual(V.pruneAutoList(list, 2).map((r) => r.id), ["v9", "v8", "v7", "v6"]);
  assert.deepStrictEqual(V.pruneAutoList(list, 1).map((r) => r.id), ["v9", "v8", "v6"]);
  // Even at zero — the rung that gives up ALL history — authored work survives.
  assert.deepStrictEqual(V.pruneAutoList(list, 0).map((r) => r.id), ["v8", "v6"],
    "named and import are authored work; #530 is the standing reminder");
  // A record with no kind is treated as auto (the default `makeVersion` applies),
  // never as unreclaimable — otherwise a legacy store could never be reclaimed.
  assert.deepStrictEqual(V.pruneAutoList([{ id: "x" }], 0), []);
});

test("#548: a full store reclaims its own autos and the save succeeds", () => {
  // A limit that admits ten records but not the eleventh.
  const ten = JSON.stringify(Array.from({ length: 10 }, (_, i) => auto("v" + i)));
  const st = fakeStorage(ten.length);
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(V.saveVersion(auto("v" + i), st).ok, true, "seeding must fit");
  }
  const res = V.saveVersion(auto("v10"), st);
  assert.strictEqual(res.ok, true, "the eleventh save must succeed by making room");
  assert.ok(res.reclaimed > 0, "and must report what it cost");
  const kept = V.listVersions(st);
  assert.strictEqual(kept[0].id, "v10", "the record being written survives");
  assert.ok(kept.length < 11, "history really was shortened");
});

test("#548: reclaim never deletes named versions to make room", () => {
  const four = JSON.stringify(Array.from({ length: 4 }, (_, i) => named("n" + i)));
  const st = fakeStorage(four.length);
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(V.saveVersion(named("n" + i), st).ok, true, "seeding must fit");
  }
  const before = V.listVersions(st).map((r) => r.id);
  const res = V.saveVersion(auto("a1"), st);
  assert.strictEqual(res.ok, false, "a store full of authored work cannot be reclaimed");
  assert.strictEqual(res.full, true, "and says so, so the player can prune deliberately");
  assert.strictEqual(res.reclaimed, 0);
  assert.deepStrictEqual(V.listVersions(st).map((r) => r.id), before,
    "every named version is still there — the store must not eat authored work");
});

test("#548: a successful save reports zero reclaimed, not undefined", () => {
  const st = fakeStorage();
  const res = V.saveVersion(auto("v1"), st);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.reclaimed, 0, "callers branch on this; undefined would read as falsy by luck");
});

test("#548: usage is billed in UTF-16 code units, as browsers bill it", () => {
  const st = fakeStorage();
  assert.strictEqual(V.usageBytes(st), 0, "an empty store is zero, not a throw");
  V.saveVersion(auto("v1", 100), st);
  const raw = st.getItem(V.STORE_KEY);
  assert.strictEqual(V.usageBytes(st), raw.length * 2,
    "reporting `length` would understate the store by half, and the whole point " +
    "of the number is to say what filled the budget");
  assert.strictEqual(V.usageBytes(null), 0);
});

test("#548: countByKind separates the reclaimable from the authored", () => {
  const st = fakeStorage();
  V.saveVersion(auto("v1"), st);
  V.saveVersion(named("v2"), st);
  V.saveVersion({ id: "v3", kind: "import" }, st);
  V.saveVersion({ id: "v4" }, st);   // no kind -> auto
  assert.deepStrictEqual(V.countByKind(st), { auto: 2, named: 1, import: 1 });
});

test("#548: the reclaim ladder ends at one, never at zero", () => {
  // Zero would drop the record being written, so the save would "succeed" having
  // stored nothing. One is the floor for that reason, not by accident.
  assert.ok(V.RECLAIM_LADDER.length > 0);
  assert.strictEqual(V.RECLAIM_LADDER[V.RECLAIM_LADDER.length - 1], 1);
  const desc = V.RECLAIM_LADDER.slice().sort((a, b) => b - a);
  assert.deepStrictEqual(V.RECLAIM_LADDER, desc, "each rung gives up strictly more");
});
