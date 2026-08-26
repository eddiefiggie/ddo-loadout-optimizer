// #501 — the farming list: grouping, the gaps it must state rather than hide,
// and per-character progress. Pure logic; a fake Storage stands in for the
// browser's.
// Run: node tests/farming.test.js
const assert = require("assert");
const F = require("../web/farming.js");
const R = require("../web/results.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

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
  };
}

const it = (id, slot, loc, ml, extra) => ({
  slot, variant: Object.assign({ variant_id: id, minimum_level: ml, location_quest: loc,
    affixes: [], set_bonus: [] }, extra || {}),
});
function rec(chosen) {
  return { name: "T", inputs: { priorities: [] },
    snapshot: { status: "optimal", chosen, effective: {}, perTarget: {}, breakdown: {},
      setsActive: [], augmentsPlaced: [] } };
}

test("#501: sources are ordered by how much each one gives you", () => {
  // The ordering IS the feature. "Three of your items drop here" turns thirteen
  // lookups into one run, and it is the only thing this list tells a player that
  // the Loadout tab does not.
  const plan = F.farmingPlan(rec([
    it("Lone Boots", "Feet", "Blue Water Inn", 30),
    it("Tor Ring", "Ring", "Gianthold Tor", 30),
    it("Tor Cloak", "Cloak", "Gianthold Tor", 30),
  ]));
  assert.deepStrictEqual(plan.sources.map((s) => s.name), ["Gianthold Tor", "Blue Water Inn"],
    "the richest run leads, whatever order the slots came in");
});

test("#501: two of the same item is TWO, not one", () => {
  // A build wearing two of the same ring needs two of them. A list that says
  // "1" has told the player to stop farming too early.
  const plan = F.farmingPlan(rec([
    it("Twin Ring", "Ring", "Gianthold Tor", 30),
    it("Twin Ring", "Ring", "Gianthold Tor", 30),
  ]));
  const entry = plan.sources[0].items[0];
  assert.strictEqual(entry.copies, 2, "both copies counted");
  assert.deepStrictEqual(entry.slots, ["Ring", "Ring"], "and both slots named");
  assert.strictEqual(plan.counts.items, 2, "the headline count is copies, not distinct names");
  assert.strictEqual(plan.counts.distinctItems, 1, "…and the distinct count is kept separately");
  assert.ok(/×2/.test(R.farmingPanel(plan, {}, {})), "the view prints the multiplier");
});

test("#501: an item with no recorded source is a visible group, never dropped", () => {
  // 211 of 8,047 gear variants carry no location. Filtering them out would give
  // the cleanest possible list and silently omit items the player must still go
  // and get — the exclude-until-verified rule cuts the other way here: disclose
  // the gap, do not hide the item.
  const plan = F.farmingPlan(rec([
    it("Tor Ring", "Ring", "Gianthold Tor", 30),
    it("Mystery Belt", "Belt", null, 30),
  ]));
  assert.deepStrictEqual(plan.unsourced.map((u) => u.item), ["Mystery Belt"]);
  const html = R.farmingPanel(plan, {}, {});
  assert.ok(/Source not recorded/.test(html), "it has its own heading");
  assert.ok(/Mystery Belt/.test(html), "…and the item is listed under it");
  assert.ok(/gap in the data, not a claim/.test(html),
    "and the heading does not overclaim — no location is a gap, not proof of unobtainability");
});

test("#501: the no-known-source flag survives onto the farming list", () => {
  // #262's disclosure matters MORE here than anywhere else in the app: this is
  // the surface that sends a player out to hunt for the thing.
  const Pj = require("../web/projection.js");
  const plan = F.farmingPlan(rec([
    it("Ghost Gloves", "Gloves", "Special event items", 30, { no_drop_source: true }),
  ]));
  assert.strictEqual(plan.sources[0].items[0].noDropSource, true);
  const html = R.farmingPanel(plan, {}, {});
  assert.ok(html.includes(Pj.NO_DROP_SOURCE_WORDING), "the ONE shared wording, not a respelling");
  assert.ok(F.farmingMarkdown(plan, {}).includes(Pj.NO_DROP_SOURCE_WORDING),
    "and the export carries it too — a shared list must not drop the warning");
});

test("#501: the adventure-pack gap is stated on every surface, and never guessed", () => {
  // Pack is in neither the dataset nor gear-planner. Guessing it from the quest
  // name is not available: "The Twilight Forge" is a quest and "Ritual Table" is
  // a crafting station, and no pattern separates them. So the tab says so.
  const plan = F.farmingPlan(rec([it("Tor Ring", "Ring", "Gianthold Tor", 30)]));
  assert.strictEqual(plan.sources[0].adventurePack, null,
    "explicitly null, so a view renders the gap rather than nothing");
  assert.ok(/Adventure pack not recorded/.test(R.farmingPanel(plan, {}, {})), "stated per source");
  assert.ok(/not recorded in the dataset/.test(F.farmingMarkdown(plan, {})), "and in the export");
});

test("#501: augments are listed to slot, not to find", () => {
  // Zero of 1,063 augment records carry acquisition data. Listing them beside
  // the quests would imply a source this list does not have.
  const plan = F.farmingPlan(rec([it("Host Ring", "Ring", "Gianthold Tor", 30)]));
  plan.augments = [{ host: "Host Ring", name: "Topaz of Doublestrike", color: "Yellow" }];
  const html = R.farmingPanel(plan, {}, {});
  assert.ok(/Augments to slot/.test(html), "their own section, named for what it can tell you");
  assert.ok(/not where to find it/.test(html), "with the limit said out loud");
});

test("#501: progress is per character, and a failed write does not look saved", () => {
  const st = fakeStorage();
  assert.deepStrictEqual(F.loadProgress("Sook", st), {}, "nothing ticked to begin with");
  const on = F.toggleAcquired("Sook", "Tor Ring", st);
  assert.strictEqual(on.ok, true);
  assert.deepStrictEqual(F.loadProgress("Sook", st), { "Tor Ring": true });
  // A second character farming the same item has NOT got it because the first did.
  assert.deepStrictEqual(F.loadProgress("Other", st), {}, "progress does not leak between characters");
  const off = F.toggleAcquired("Sook", "Tor Ring", st);
  assert.deepStrictEqual(off.acquired, {}, "toggling again clears it");

  // A store that cannot take the write must report failure, so the caller can
  // put the tick back rather than leave a box looking saved that never was.
  const tiny = fakeStorage(5);
  const res = F.toggleAcquired("Sook", "Tor Ring", tiny);
  assert.strictEqual(res.ok, false, "the failure is reported, not swallowed");
});

test("#501: a ticked item stays on the list", () => {
  // Struck through, not removed. A farming plan you can no longer read is not a
  // record of what you did.
  const plan = F.farmingPlan(rec([it("Tor Ring", "Ring", "Gianthold Tor", 30)]));
  const html = R.farmingPanel(plan, { "Tor Ring": true }, {});
  assert.ok(/is-got/.test(html), "it is marked collected");
  assert.ok(/Tor Ring/.test(html), "…and still listed");
  assert.ok(/checked/.test(html), "with its box checked, so a re-render keeps the state");
});

test("#501: the character name reaches the panel as its own input, not via the query", () => {
  // `query` does not carry the character name, so reading it from there filed
  // every tick under "" — the panel would tell a player with a perfectly good
  // build name to go and name their build. Source-text, because the wiring is
  // not observable from either function's output.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "results.js"), "utf8");
  assert.ok(/function renderResults\(container, \{[^}]*characterName[^}]*\}\)/.test(src),
    "renderResults takes it as an option of its own");
  assert.ok(/const farmCharacter = String\(characterName \|\| ""\)\.trim\(\)/.test(src),
    "…and the farming list reads THAT, not query.characterName");
  const wiz = require("fs").readFileSync(require("path").join(__dirname, "..", "web", "wizard.js"), "utf8");
  const passes = (wiz.match(/characterName: state\.characterName/g) || []).length;
  const renders = (wiz.match(/renderResults\(box, \{/g) || []).length;
  assert.strictEqual(passes, renders,
    "every renderResults call site passes it — a missed one silently stops saving ticks on that path");
});

console.log("\n-- merge on restore (doc-review round 1) --");

test("MERGE: a restore keeps ticks recorded since the export", () => {
  // The shipped bug. writeProgress replaced the whole store, so importing a
  // backup wiped every acquisition the player had ticked since that export.
  const st = fakeStorage();
  F.toggleAcquired("LocalBuild", "Local Item", st);
  F.mergeProgress({ FileBuild: { "File Item": true } }, st);
  const got = F.readProgress(st);
  assert.deepStrictEqual(Object.keys(got).sort(), ["FileBuild", "LocalBuild"],
    "both characters survive the restore");
  assert.strictEqual(got.LocalBuild["Local Item"], true, "the local tick is not lost");
});

test("MERGE: an incoming character REPLACES that character's own ticks", () => {
  // Per-character, the backup is the record: a tick is a boolean with no
  // timestamp, so an untick made before the export cannot be told apart from a
  // tick made after it. Merging within one character would resurrect unticked
  // items forever; merging BETWEEN characters is unambiguous and is what this
  // does.
  const st = fakeStorage();
  F.toggleAcquired("Build", "Old Item", st);
  F.mergeProgress({ Build: { "New Item": true } }, st);
  assert.deepStrictEqual(F.readProgress(st).Build, { "New Item": true });
});

test("MERGE: falsy and malformed entries are sanitized at the boundary", () => {
  const st = fakeStorage();
  F.mergeProgress({ A: { keep: true, drop: false, gone: 0 }, B: null, C: "nope" }, st);
  const got = F.readProgress(st);
  assert.deepStrictEqual(got.A, { keep: true }, "only true survives");
  assert.ok(!("B" in got) && !("C" in got), "a non-object character entry is not stored");
});

test("MERGE: a failed write reports failure rather than a silent loss", () => {
  const st = fakeStorage(1);
  assert.strictEqual(F.mergeProgress({ A: { x: true } }, st).ok, false,
    "the caller must be able to tell the player the restore did not land");
});

// ---- #518: moving a character's progress to a new name --------------------

test("#518: renameProgress moves every tick to the new key and leaves nothing behind", () => {
  const st = fakeStorage();
  F.toggleAcquired("Aurelia", "Bloodrage Crystal", st);
  F.toggleAcquired("Aurelia", "Legendary Ring", st);
  F.toggleAcquired("Aurelia", "Epic Cloak", st);
  assert.strictEqual(F.renameProgress("Aurelia", "Aurelia Mk2", st).ok, true);
  const got = F.readProgress(st);
  assert.deepStrictEqual(got["Aurelia Mk2"],
    { "Bloodrage Crystal": true, "Legendary Ring": true, "Epic Cloak": true });
  assert.ok(!("Aurelia" in got), "the old key is gone, not merely emptied");
});

test("#518: renaming a character with no progress succeeds with nothing to do", () => {
  // A build with no ticks is renamed like any other. Reporting failure here
  // would abort the rename for the commonest case.
  const st = fakeStorage();
  F.toggleAcquired("Someone Else", "Item", st);
  const r = F.renameProgress("Bare", "Bare Mk2", st);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.missing, true, "the caller can still tell nothing moved");
  assert.ok(!("Bare Mk2" in F.readProgress(st)), "and no empty entry is invented");
});

test("#518: every other character's progress is untouched by a move", () => {
  const st = fakeStorage();
  F.toggleAcquired("Aurelia", "A", st);
  F.toggleAcquired("Bram", "B", st);
  F.toggleAcquired("Kestrel", "C", st);
  F.renameProgress("Aurelia", "Aurelia Mk2", st);
  const got = F.readProgress(st);
  assert.deepStrictEqual(got.Bram, { B: true });
  assert.deepStrictEqual(got.Kestrel, { C: true });
});

test("#518: a failed write reports failure and leaves the stored blob as it was", () => {
  const st = fakeStorage();
  F.toggleAcquired("Aurelia", "A", st);
  const before = st.getItem(F.PROGRESS_KEY);
  const tiny = {
    getItem: st.getItem,
    setItem: () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; },
    removeItem: st.removeItem,
  };
  assert.strictEqual(F.renameProgress("Aurelia", "Aurelia Mk2", tiny).ok, false);
  assert.strictEqual(st.getItem(F.PROGRESS_KEY), before,
    "a failed rename must not half-move the entry");
});

test("#518: a move onto an occupied key REPLACES rather than merges", () => {
  // Pinned so the coordinator's collision refusal stays the only thing standing
  // between the two entries. A later caller must not assume a merge that does
  // not happen here.
  const st = fakeStorage();
  F.toggleAcquired("Aurelia", "From Aurelia", st);
  F.toggleAcquired("Bram", "From Bram", st);
  F.renameProgress("Aurelia", "Bram", st);
  assert.deepStrictEqual(F.readProgress(st).Bram, { "From Aurelia": true },
    "the destination's own ticks do not survive a move onto it");
});

test("#518: renaming a character to its own name is a no-op success", () => {
  const st = fakeStorage();
  F.toggleAcquired("Aurelia", "A", st);
  assert.strictEqual(F.renameProgress("Aurelia", "Aurelia", st).ok, true);
  assert.deepStrictEqual(F.readProgress(st).Aurelia, { A: true });
});

console.log(`\n${passed} passed`);
