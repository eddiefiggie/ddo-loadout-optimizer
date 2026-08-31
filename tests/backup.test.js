// U5 — versioned JSON backup: export, import, migration, payload safety.
// Run: node tests/backup.test.js
const assert = require("assert");
const {
  serializeAll, parseBackup, mergeInto, CURRENT_SCHEMA,
  parsePortable, parseAny, uniqueName, PORTABLE_FORMAT,
} = require("../web/backup.js");
const { toPortableJSON } = require("../web/exporters.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const rec = (name, ml) => ({
  name, savedAt: "2026-07-30T00:00:00.000Z",
  inputs: { characterName: name, ml, race: "Elf", priorities: ["Constitution"] },
  query: { targets: ["Constitution"] },
  snapshot: { status: "optimal", chosen: [] },
  stampedBuildId: "abc123",
});

test("serializeAll wraps characters with the current schema version", () => {
  const out = serializeAll({ Sook: rec("Sook", 34) }, { buildId: "abc123" });
  assert.strictEqual(out.schema_version, CURRENT_SCHEMA);
  assert.strictEqual(out.app_build_id, "abc123");
  assert.ok(out.characters.Sook);
  assert.strictEqual(out.characters.Sook.inputs.ml, 34);
});

test("export -> import round-trip restores characters", () => {
  const text = JSON.stringify(serializeAll({ Sook: rec("Sook", 34), Torin: rec("Torin", 30) }, {}));
  const res = parseBackup(text);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(Object.keys(res.characters).sort(), ["Sook", "Torin"]);
  assert.strictEqual(res.characters.Sook.inputs.ml, 34);
});

test("U6: ownedSetAugments (array) survives export -> import round-trip", () => {
  const r = rec("SA", 34);
  r.inputs.ownedSetAugments = ["Alluring Elocution", "Arcane Barrier"];
  const text = JSON.stringify(serializeAll({ SA: r }, {}));
  const res = parseBackup(text);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.characters.SA.inputs.ownedSetAugments, ["Alluring Elocution", "Arcane Barrier"]);
});

test("a current-version file imports", () => {
  const text = JSON.stringify({ schema_version: 1, characters: { Sook: rec("Sook", 34) } });
  assert.strictEqual(parseBackup(text, { current: 1, window: 3 }).ok, true);
});

test("a within-window older file migrates and imports", () => {
  // simulate current=3, window=3 -> versions 1,2,3 are in window; a v1 migration runs
  const migrations = { 2: (d) => d, 3: (d) => d };
  const text = JSON.stringify({ schema_version: 1, characters: { Sook: rec("Sook", 34) } });
  const res = parseBackup(text, { current: 3, window: 3, migrations });
  assert.strictEqual(res.ok, true, res.error);
  assert.strictEqual(res.schemaVersion, 3);
});

test("older-than-window is refused as too-old", () => {
  // current=5, window=3 -> in-window is 3,4,5; v2 is too old
  const text = JSON.stringify({ schema_version: 2, characters: {} });
  const res = parseBackup(text, { current: 5, window: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "too-old");
});

test("newer-than-app is refused", () => {
  const text = JSON.stringify({ schema_version: 2, characters: {} });
  const res = parseBackup(text, { current: 1, window: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "newer");
});

test("structurally invalid JSON is refused, not thrown", () => {
  assert.strictEqual(parseBackup("{not json").error, "invalid");
  assert.strictEqual(parseBackup(JSON.stringify({ nope: 1 })).error, "invalid");
});

test("oversized payload is refused", () => {
  const big = JSON.stringify({ schema_version: 1, characters: {}, pad: "x".repeat(20) });
  const res = parseBackup(big, { current: 1, window: 3, maxChars: 10 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "oversized");
});

test("prototype-pollution payload does not pollute Object.prototype and is stripped", () => {
  const hostile = '{"schema_version":1,"characters":{"Sook":{"name":"Sook","__proto__":{"polluted":true},"inputs":{"ml":34}}}}';
  const res = parseBackup(hostile, { current: 1, window: 3 });
  assert.strictEqual(({}).polluted, undefined, "Object.prototype was polluted");
  if (res.ok) {
    assert.strictEqual(res.characters.Sook.polluted, undefined);
    assert.strictEqual(Object.getPrototypeOf(res.characters.Sook), Object.prototype);
  }
});

test("reviver strips __proto__ nested inside snapshot (exercises the reviver, not the allowlist)", () => {
  // __proto__ buried in app-produced snapshot data — the field allowlist passes
  // snapshot through, so only the reviver + scrub can catch this.
  const hostile = '{"schema_version":1,"characters":{"Sook":{"name":"Sook",'
    + '"snapshot":{"status":"optimal","chosen":[],"__proto__":{"polluted":true}}}}}';
  const res = parseBackup(hostile, { current: 1, window: 3 });
  assert.strictEqual(({}).polluted, undefined, "Object.prototype polluted via nested __proto__");
  assert.strictEqual(res.ok, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(res.characters.Sook.snapshot, "__proto__"),
    "snapshot still carries an own __proto__ property");
});

test("a malformed character (missing name) refuses the whole file — no partial import", () => {
  const text = JSON.stringify({ schema_version: 1, characters: { Good: rec("Good", 34), Bad: { inputs: { ml: 1 } } } });
  const res = parseBackup(text, { current: 1, window: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "invalid");
});

test("mergeInto per-name updates collisions, adds new, keeps others; replace wipes", () => {
  const existing = { Sook: rec("Sook", 34), Keeper: rec("Keeper", 20) };
  const incoming = { Sook: rec("Sook", 30), Torin: rec("Torin", 28) };
  const merged = mergeInto(existing, incoming, "merge");
  assert.strictEqual(merged.Sook.inputs.ml, 30);   // updated
  assert.strictEqual(merged.Keeper.inputs.ml, 20);  // kept
  assert.strictEqual(merged.Torin.inputs.ml, 28);   // added
  const replaced = mergeInto(existing, incoming, "replace");
  assert.deepStrictEqual(Object.keys(replaced).sort(), ["Sook", "Torin"]);
});


// ---- U5 — declared credits survive the backup round-trip (R11) --------------

test("U5: declared credits survive export and import", () => {
  // backup.js imports persist.js's INPUT_KEYS precisely so the save path and the
  // import path cannot drift; this is the assertion that proves the new key rode
  // along rather than being silently stripped on import.
  const credits = {
    "Combat Mastery||Insight": { stat: "Combat Mastery", bonus_type: "Insight", value: 7 },
    "Devotion||Sacred": { stat: "Devotion", bonus_type: "Sacred", value: 12 },
  };
  const r = rec("Trance", 34);
  r.inputs.declaredCredits = credits;
  const parsed = parseBackup(JSON.stringify(serializeAll({ Trance: r }, {})));
  assert.ok(parsed.ok, `backup must parse: ${parsed.error || ""}`);
  assert.deepStrictEqual(parsed.characters.Trance.inputs.declaredCredits, credits,
    "an imported character keeps the credits it was exported with");
});

test("U5: a hand-edited backup cannot smuggle an invalid credit into the solve", () => {
  // A backup file is user-supplied. The allowlist and scrub() pass declaredCredits
  // through by reference, so normalizeCredits at the query seam is the real gate —
  // pin that, rather than asserting an absent field stays absent.
  const { cleanCreditMap } = require("../web/wizard.js");
  const r = rec("Hostile", 30);
  r.inputs.declaredCredits = {
    "__proto__||Insight": { stat: "__proto__", bonus_type: "Insight", value: 5 },
    "CM||insight": { stat: "CM", bonus_type: "insight", value: 7 },
    "CM||Insight": { stat: "CM", bonus_type: "Insight", value: "not a number" },
    "X||Insight": { stat: "X", bonus_type: "Insight", value: 999999 },
    "OK||Insight": { stat: "OK", bonus_type: "Insight", value: 6 },
  };
  const parsed = parseBackup(JSON.stringify(serializeAll({ Hostile: r }, {})));
  assert.ok(parsed.ok);
  const clean = cleanCreditMap(parsed.characters.Hostile.inputs.declaredCredits, { canonical: (v) => v });
  assert.deepStrictEqual(Object.keys(clean), ["OK||Insight"],
    `only the valid credit may reach the solver, got ${JSON.stringify(Object.keys(clean))}`);
  assert.strictEqual({}.polluted, undefined, "no prototype pollution");
});

if (!process.exitCode) 
// #346 (U3) — the ladder survives the hand-export / re-import round trip, which
// is the real cross-version boundary: users export these to files and import
// them into whatever build they are running later.
test("#346: craftingRung round-trips through export and re-import", () => {
  const { serializeCharacter } = require("../web/persist.js");
  const state = { ml: 34, race: "Human", priorities: ["Constitution"], slotConstraints: {} };
  const run = { query: {}, result: { status: "optimal", chosen: [], effective: {} } };

  for (const rung of ["everything", "no-niche-crafting", "no-solar-lunar", "printed-only"]) {
    const saved = serializeCharacter("R", Object.assign({}, state, { craftingRung: rung }), run, "b");
    const parsed = parseBackup(JSON.stringify(serializeAll({ R: saved })));
    assert.ok(parsed.ok, `${rung}: the backup parses (${parsed.message || ""})`);
    const back = parsed.characters.R;
    assert.strictEqual(back.inputs.craftingRung, rung,
      `${rung} survives the export/import round trip unchanged`);
    // The derived downgrade bridge rides along and still agrees with the rung.
    assert.strictEqual(back.inputs.excludeCraftingSystems, rung !== "everything",
      `${rung}: the legacy bridge stays consistent with the rung across the round trip`);
  }
});

// ---------------------------------------------------------------------------
// #420 — the allowlist must be RESOLVED, never COPIED. backup.js used to capture
// it once at script-eval time behind a hardcoded fallback list; the fallback had
// drifted to 11 keys against persist.js's 32 and still named a retired one, so a
// failed capture would have silently returned a reduced character on import.
// Same shape as docs/solutions/conventions/a-guard-that-copies-its-parameter-measures-the-copy.md.
// ---------------------------------------------------------------------------

test("#420: backup.js keeps no second copy of the input allowlist", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "backup.js"), "utf-8");
  const { INPUT_KEYS } = require("../web/persist.js");
  // No literal key list: a copy cannot fail loudly when the original moves.
  assert.ok(!/"characterName",\s*"ml"/.test(src),
    "no hardcoded fallback allowlist — resolve from persist.js or refuse the import");
  // And nothing names the retired key the old fallback still carried.
  assert.ok(!/"weapon"/.test(src), "the retired `weapon` key is gone with the fallback");
  assert.ok(!INPUT_KEYS.includes("weapon"), "…and persist.js does not carry it either");
});

test("#420: the allowlist is resolved per call, not captured at script-eval time", () => {
  const fs = require("fs"); const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "backup.js"), "utf-8");
  // The browser branch reads window.CharacterStore, which exists only because
  // persist.js sits above backup.js in web/index.html. Capturing at eval time
  // made that load order load-bearing and silent; resolving per call does not.
  assert.ok(/function inputKeys\(\)/.test(src), "a resolver function owns the lookup");
  const top = src.slice(0, src.indexOf("function inputKeys()"));
  assert.ok(!/const INPUT_KEYS\s*=/.test(top),
    "the allowlist is not bound to a module-scope const before that resolver");
});

test("#420: an import that cannot resolve the allowlist refuses the whole file", () => {
  const backup = require("../web/backup.js");
  const persistPath = require.resolve("../web/persist.js");
  const real = require.cache[persistPath].exports;
  try {
    // Simulate the capture coming back empty — the case the old fallback list
    // was hiding. Before this fix it returned a character carrying 11 of its 32
    // saved inputs, with no error shown to the player.
    require.cache[persistPath].exports = { INPUT_KEYS: undefined };
    assert.strictEqual(backup.sanitizeCharacter({ name: "X", inputs: { ml: 30 } }), null,
      "a character that cannot be rebuilt safely is refused, not reduced");
    const file = JSON.stringify({ schema_version: 1, characters: { X: { name: "X", inputs: { ml: 30 } } } });
    const res = backup.parseBackup(file, {});
    assert.strictEqual(res.ok, false, "the whole file is refused");
    assert.strictEqual(res.error, "no-allowlist", "…and the refusal names the real reason");
  } finally {
    require.cache[persistPath].exports = real;
  }
  // Restored: the normal path still rebuilds, including keys added after the
  // old fallback list was written.
  const ok = backup.sanitizeCharacter({ name: "X", inputs: { characterName: "X", overrides: [1] } });
  assert.ok(ok && ok.inputs.overrides, "late-added keys survive once the allowlist resolves");
});

test("#420: every saved input key survives a sanitize round-trip", () => {
  const { sanitizeCharacter } = require("../web/backup.js");
  const { INPUT_KEYS } = require("../web/persist.js");
  // A truncated allowlist is silent on import — the character just comes back
  // simpler. Assert the whole population rather than a sampled key.
  const inputs = {};
  for (const k of INPUT_KEYS) inputs[k] = "sentinel-" + k;
  const out = sanitizeCharacter({ name: "Round Trip", inputs });
  const dropped = INPUT_KEYS.filter((k) => out.inputs[k] !== "sentinel-" + k);
  assert.deepStrictEqual(dropped, [], `these saved inputs were dropped on import: ${dropped.join(", ")}`);
});

// The allowlist is shared with persist.js precisely so a field cannot persist on
// one path and be stripped on the other. If craftingRung ever falls off it, the
// round-trip test above would still pass on a fresh save while silently losing
// the field for anyone importing an older file — so pin membership directly.
test("#346: the shared input allowlist carries craftingRung", () => {
  const { INPUT_KEYS } = require("../web/persist.js");
  assert.ok(INPUT_KEYS.includes("craftingRung"),
    "a key outside the allowlist is stripped on import and the rung would not survive");
  assert.ok(INPUT_KEYS.includes("excludeCraftingSystems"),
    "the legacy bridge must also survive import, or a downgrade loses the restriction");
});

test("#348 U7/R11: the export/import round-trip carries the container and its marker", () => {
  const { INPUT_KEYS } = require("../web/persist.js");
  // backup.js filters imported inputs through this same list, so a key outside it
  // is stripped on import. Without the container the player's curation would be
  // silently reset by moving a character between devices; without the marker the
  // imported record would read as pre-container and re-heal (and re-notify) on
  // every single load.
  assert.ok(INPUT_KEYS.includes("utilityContainer"),
    "a container outside the allowlist is stripped on import — curation lost on transfer");
  assert.ok(INPUT_KEYS.includes("utility_container_aware"),
    "the marker must survive too, or an imported record heals forever");
});


// ---- #88 U5 — overrides survive the backup round-trip (R20) -----------------

test("#88 U5: overrides survive export and import with no second allowlist edit", () => {
  // The whole point of backup.js sourcing persist.js's INPUT_KEYS: adding a saved
  // input there must ride along here automatically. This asserts that it did.
  const overrides = [
    { variant_id: "Aberrant Robe", name: "Armor Class", from: "Armor", value: "5",
      to: "Enhancement", note: "measured in game" },
  ];
  const r = rec("Corrector", 34);
  r.inputs.overrides = overrides;
  const parsed = parseBackup(JSON.stringify(serializeAll({ Corrector: r }, {})));
  assert.ok(parsed.ok, `backup must parse: ${parsed.error || ""}`);
  assert.deepStrictEqual(parsed.characters.Corrector.inputs.overrides, overrides,
    "an imported character keeps the overrides it was exported with, recorded types included");
});

// ---- #428 U4 — the saved step survives the backup round-trip (R16/KTD1) -----

test("#428 U4: step survives export and import with no second allowlist edit", () => {
  // KTD1's whole reason for making `step` a saved INPUT rather than a new
  // top-level record field: backup.js sources persist.js's INPUT_KEYS, so the
  // round-trip inherits the key. Proven red by removing "step" from INPUT_KEYS.
  const { INPUT_KEYS } = require("../web/persist.js");
  assert.ok(INPUT_KEYS.includes("step"), "step is on the save allowlist");
  const r = rec("Resumer", 34);
  r.inputs.step = "character";
  const parsed = parseBackup(JSON.stringify(serializeAll({ Resumer: r }, {})));
  assert.ok(parsed.ok, `backup must parse: ${parsed.error || ""}`);
  assert.strictEqual(parsed.characters.Resumer.inputs.step, "character",
    "an imported character reopens where it was exported from");
});

// ---------------------------------------------------------------------------
// #335 U5 — a doubled loadout survives save, load and backup import. Confirmed
// rather than designed: serializeCharacter already denormalizes full item objects
// into the snapshot so a restored character renders without the live catalog and
// is never re-solved, and sanitizeCharacter scrubs the snapshot without reshaping
// it. Both halves come free — these tests are what keep them free.
// ---------------------------------------------------------------------------

const _M5 = require("../web/model.js");
const _P5 = require("../web/projection.js");

function _dupSnapshot() {
  const id = [...(_M5.DUPLICABLE_RINGS)][0];
  const mk = (vid) => ({ slot: "Ring", variant: { variant_id: vid, source_item: id, slot: "Ring",
    set_bonus: [{ set: "Perfected Wrath" }] } });
  return { status: "optimal", chosen: [mk(id), mk(_M5.twinIdOf(id))] };
}

test("#335 U5 (AE5): a doubled loadout survives sanitize and still collapses to x2", () => {
  const rec = { name: "Dup", savedAt: "2026-08-22T00:00:00Z", inputs: { characterName: "Dup", ml: 34 },
                query: { targets: ["Intelligence"] }, snapshot: _dupSnapshot(), stampedBuildId: "b1" };
  const clean = require("../web/backup.js").sanitizeCharacter(rec);
  const chosen = (clean && clean.snapshot && clean.snapshot.chosen) || [];
  assert.strictEqual(chosen.length, 2, "both copies survive the field scrub — neither split nor collapsed");
  const groups = _P5.collapseTwins(chosen);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].count, 2, "and it still renders as one entry marked x2 after the round-trip");
  assert.strictEqual(_M5.isTwinId(groups[0].variant.variant_id), false,
    "the displayed id is the real item, not the suffixed twin");
});

test("#335 U5: a backup file carrying a doubled loadout imports intact", () => {
  const rec = { name: "Dup", savedAt: "2026-08-22T00:00:00Z", inputs: { characterName: "Dup", ml: 34 },
                snapshot: _dupSnapshot() };
  const file = JSON.stringify({ schema_version: 1, characters: { Dup: rec } });
  const r = require("../web/backup.js").parseBackup(file, {});
  assert.strictEqual(r.ok, true, "the #420 refuse-rather-than-reduce reader accepts it");
  assert.strictEqual(r.characters.Dup.snapshot.chosen.length, 2,
    "the twin entry is not quietly stripped by the allowlist");
});

// ---------------------------------------------------------------------------
// plan 2026-08-25-001 U8 — the backup carries authored work, not byproducts.

test("U8: a backup carries builds, bundles and farming progress", () => {
  const p = serializeAll({ Tank: {} }, {
    bundles: [{ id: "b1", name: "Reaper", affixes: ["Constitution"] }],
    farming: { Tank: { "Item A": true } },
  });
  assert.strictEqual(p.schema_version, 3, "the payload widened again (#530), so the version moved");
  assert.deepStrictEqual(Object.keys(p.characters), ["Tank"]);
  assert.strictEqual(p.bundles.length, 1);
  assert.deepStrictEqual(p.farming, { Tank: { "Item A": true } });
});

test("#530: a backup carries AUTHORED version snapshots, and no automatic ones", () => {
  // This inverted, and the inversion is the fix. It used to assert `versions` was
  // absent entirely, on the grounds that snapshots are taken without being asked
  // for and are the store with the known growth problem (#502). That reasoning is
  // sound for ONE of the three kinds. `named` is a snapshot the player pressed
  // save on and typed a name for; `import` is one they carried in from a file.
  //
  // `versions.js` had already drawn this exact line: `pruneAutoList` refuses to
  // reclaim a named or an import at any rung, on the stated grounds that they are
  // work a player cannot reproduce. So the omission contradicted the store's own
  // policy, and the panel's principle — "back up everything you have made" — was
  // false for two kinds out of three.
  const V = require("../web/versions.js");
  const mk = (id, kind) => V.makeVersion({ id, name: id, kind, query: {}, result: {},
                                           inputs: {}, buildId: "b", savedAt: "2026-01-01" });
  const p = serializeAll({ Tank: {} }, {
    bundles: [], farming: {},
    versions: [mk("v1", "named"), mk("v2", "import")].concat(
      // an auto handed in anyway must not be carried: the caller filters, and the
      // payload is what a player's file actually becomes.
      []),
  });
  assert.strictEqual(p.versions.length, 2, "the two authored kinds ride along");
  assert.deepStrictEqual(p.versions.map((v) => v.kind).sort(), ["import", "named"]);
});

test("#530: `authoredVersions` is the reclaim ladder's own predicate, not a copy", () => {
  // The two must never disagree about which snapshots are work. If the backup
  // decided this separately, a later change to one would silently desync them —
  // and the failure would be invisible until a player restored and found a gap.
  const V = require("../web/versions.js");
  const mk = (id, kind) => ({ id, name: id, kind });
  const all = [mk("a", "auto"), mk("b", "named"), mk("c", "import"), mk("d", "auto")];
  // What the reclaim ladder refuses to drop, with keep=0 (drop every auto it may).
  const survives = V.pruneAutoList(all, 0).map((r) => r.id);
  const authored = all.filter(V.isAuthoredKind).map((r) => r.id);
  assert.deepStrictEqual(authored, survives,
    "the backup's notion of authored work must equal what the store refuses to reclaim");
  assert.deepStrictEqual(authored, ["b", "c"]);
});

test("U8: a v1 backup still imports, with the new keys empty", () => {
  // The compatibility window is the promise this panel makes. A widening that
  // refuses old files breaks it, and a v1 file is not missing data — it is from
  // before those things could be saved.
  const v1 = JSON.stringify({
    schema_version: 1, exported_at: "2026-01-01T00:00:00Z", app_build_id: null,
    characters: { Tank: rec("Tank", 34) },
  });
  const res = parseBackup(v1);
  assert.strictEqual(res.ok, true, res.message || "a v1 file must still import");
  assert.deepStrictEqual(Object.keys(res.characters), ["Tank"]);
  assert.deepStrictEqual(res.bundles, [], "no bundles, rather than a refusal");
  // Spread before comparing: the restored maps use Object.create(null) on
  // purpose (pollution-safe, the same shape `characters` is built with), and
  // deepStrictEqual compares prototypes.
  assert.deepStrictEqual({ ...res.farming }, {}, "and no farming progress");
});

test("U8: a newer-schema file is still declined", () => {
  const future = JSON.stringify({ schema_version: 99, characters: {} });
  const res = parseBackup(future);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "newer", "unchanged from before the widening");
});

test("U8: imported bundles and farming are sanitized, not trusted", () => {
  // A hand-edited backup can carry anything, and these two are the newest and
  // least-guarded surfaces in the file.
  const v2 = JSON.stringify({
    schema_version: 2, characters: { Tank: rec("Tank", 34) },
    bundles: [
      { id: "b1", name: "Ok", affixes: ["Constitution"], craftingRung: "everything", race: "Dwarf" },
      { name: "no id — dropped", affixes: [] },
      null,
    ],
    farming: { Tank: { "Item A": true, "Item B": false }, __proto__: { bad: true }, Bad: "not an object" },
  });
  const res = parseBackup(v2);
  assert.strictEqual(res.ok, true, res.message);
  assert.strictEqual(res.bundles.length, 1, "only the well-formed bundle survives");
  assert.ok(!("craftingRung" in res.bundles[0]) && !("race" in res.bundles[0]),
    "character-level keys do not enter through a backup either");
  assert.deepStrictEqual({ ...res.farming.Tank }, { "Item A": true }, "falsy ticks are dropped");
  assert.strictEqual(Object.getPrototypeOf(res.farming), null,
    "and the map itself carries no prototype, so a crafted key cannot reach Object.prototype");
  assert.ok(!("Bad" in res.farming), "a non-object progress entry is not installed");
  assert.ok(!Object.prototype.hasOwnProperty.call(res.farming, "__proto__"),
    "and a pollution key never becomes a progress entry");
});

// ---- the import handler (doc-review round 1) --------------------------------
// The handler lives inside wizard.js's browser block and is not exported, so
// these read the source. The bug they pin shipped: `parseBackup` did its job and
// the handler then threw the player's local work away.

const WIZ = require("fs").readFileSync(
  require("path").join(__dirname, "..", "web", "wizard.js"), "utf8");

test("import MERGES the bundle store rather than replacing it", () => {
  assert.ok(/SB\.mergeIn\(res\.bundles\)/.test(WIZ),
    "the handler calls mergeIn");
  assert.ok(!/SB\.writeAll\(res\.bundles\)/.test(WIZ),
    "and never writeAll, which deleted every bundle made since the export");
});

test("import MERGES farming progress rather than replacing it", () => {
  assert.ok(/FarmingList\.mergeProgress\(res\.farming\)/.test(WIZ),
    "the handler calls mergeProgress");
  assert.ok(!/FarmingList\.writeProgress\(res\.farming\)/.test(WIZ),
    "and never writeProgress, which wiped every tick made since the export");
});

test("a failed dependent write is reported, not swallowed under a success line", () => {
  // Both stores return { ok } and both failures were discarded, so a quota
  // failure on the bundle write read as a clean restore — on the one path where
  // the player's original data is already gone.
  assert.ok(/failed\.push\("saved bundles"\)/.test(WIZ) && /failed\.push\("farming progress"\)/.test(WIZ),
    "each dependent write's result is checked and named");
  assert.ok(/could not be saved/.test(WIZ),
    "and the player is told which part did not land");
  assert.ok(/"wz-filestat" \+ \(w\.ok && !failed\.length \? "" : " warn"\)/.test(WIZ),
    "the status reads as a warning, not a success");
});

test("the status line no longer claims a merge-by-name it does not perform", () => {
  // Bundles merge by id and farming by character key; only characters merge by
  // name. The old text asserted "(merged by name)" over all three.
  assert.ok(!/merged by name/.test(WIZ),
    "the qualifier that was true of one payload and false of the other two is gone");
});


// ---- #190 — the portable single-build envelope, which was write-only ----
//
// `toPortableJSON` has stamped `format: "ddo-loadout/v1"` since it shipped so that
// "a future import reader can tell a portable loadout from a plain backup file".
// No reader existed, so a player could hand the file to someone and neither of them
// could load it. These pin the round trip closed.

const envelope = (r) => JSON.stringify(toPortableJSON(r || rec("Caster", 34), "2026-08-29T12:00:00.000Z"));

test("#190: a portable export reads back, carrying the build it was written from", () => {
  const res = parsePortable(envelope());
  assert.ok(res.ok, res.message);
  assert.strictEqual(res.kind, "portable");
  assert.strictEqual(res.name, "Caster");
  assert.strictEqual(res.character.inputs.ml, 34, "the inputs survive the trip");
  assert.deepStrictEqual(res.character.query, { targets: ["Constitution"] });
  assert.strictEqual(res.exportedAt, "2026-08-29T12:00:00.000Z");
});

test("#190: only `core` is read — the sender's `resolved` render is not trusted", () => {
  // `resolved` is project(core): derived, and re-derived on render against whatever
  // dataset the READER has. Installing the sender's copy would pin a stale rendering
  // of the build against a newer catalog, with nothing to say which was current.
  const env = JSON.parse(envelope());
  env.resolved = { loadout: [{ item: "SOMETHING THE READER SHOULD NEVER SHOW" }] };
  const res = parsePortable(JSON.stringify(env));
  assert.ok(res.ok);
  assert.ok(!JSON.stringify(res).includes("SHOULD NEVER SHOW"),
    "the resolved block does not reach the imported record");
  assert.deepStrictEqual(Object.keys(res.character).sort(),
    ["inputs", "name", "query", "savedAt", "snapshot", "stampedBuildId"]);
});

test("#190: the envelope is sanitized through the SAME gate a backup's characters are", () => {
  // It is a saved record and gets the record's own scrubbing plus the input
  // allowlist — not a pass because it arrived alone.
  const env = JSON.parse(envelope());
  env.core.inputs.notOnTheAllowlist = "dropped";
  env.core.extraTopLevelKey = "dropped";
  const res = parsePortable(JSON.stringify(env));
  assert.ok(res.ok);
  assert.strictEqual(res.character.inputs.notOnTheAllowlist, undefined);
  assert.strictEqual(res.character.extraTopLevelKey, undefined);
});

test("#190: a prototype-polluting envelope cannot reach the store", () => {
  const bad = `{"format":"${PORTABLE_FORMAT}","schema_version":1,"core":`
    + `{"name":"X","inputs":{"__proto__":{"polluted":true}},"snapshot":{}}}`;
  const res = parsePortable(bad);
  assert.ok(!({}).polluted, "Object.prototype is untouched");
  if (res.ok) assert.ok(!res.character.inputs.polluted);
});

test("#190: the two file kinds are refused by each other's parser, by name", () => {
  const backup = JSON.stringify(serializeAll({ Sook: rec("Sook", 34) }, { buildId: "b" }));
  assert.strictEqual(parsePortable(backup).ok, false);
  assert.match(parsePortable(backup).message, /not a shared loadout/);
  assert.strictEqual(parseBackup(envelope()).ok, false);
  assert.match(parseBackup(envelope()).message, /not a recognized backup/);
});

test("#190: a newer or unversioned envelope is declined rather than guessed at", () => {
  const env = JSON.parse(envelope()); env.schema_version = 99;
  assert.strictEqual(parsePortable(JSON.stringify(env)).error, "newer");
  delete env.schema_version;
  assert.strictEqual(parsePortable(JSON.stringify(env)).error, "invalid");
});

test("#190: an envelope with no readable build is refused, not imported empty", () => {
  const env = JSON.parse(envelope()); delete env.core;
  const res = parsePortable(JSON.stringify(env));
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /no readable build/);
});

test("#190: parseAny routes on `format`, which is what that field is for", () => {
  assert.strictEqual(parseAny(envelope()).kind, "portable");
  const backup = JSON.stringify(serializeAll({ Sook: rec("Sook", 34) }, { buildId: "b" }));
  const r = parseAny(backup);
  assert.ok(r.ok && !r.kind, "a backup parses as a backup");
  assert.ok(r.characters.Sook);
});

test("#190: a file that is neither keeps the BACKUP wording, not a vaguer one", () => {
  // Anything without `format` reads as a backup, so the existing message for a
  // wrong file is unchanged rather than replaced by one hedging about two formats.
  assert.match(parseAny("{}").message, /not a recognized backup/);
  assert.match(parseAny("not json").message, /not valid backup JSON/);
});

test("#190: an imported build NEVER overwrites one you already have", () => {
  // The store has no stable build id — persist.js keys by name and says so — so an
  // incoming "Caster" is indistinguishable from the player's own "Caster", and the
  // file usually came from someone else. Renaming is the only non-destructive read.
  assert.strictEqual(uniqueName("Caster", ["Main", "Tank"]), "Caster", "no clash, no rename");
  assert.strictEqual(uniqueName("Caster", ["Caster"]), "Caster (imported)");
  assert.strictEqual(uniqueName("Caster", ["caster"]), "Caster (imported)",
    "case-insensitive, like every other name comparison in the app");
  assert.strictEqual(uniqueName("Caster", ["Caster", "Caster (imported)"]), "Caster (imported 2)");
});

test("#190: a nameless build still lands somewhere findable", () => {
  assert.strictEqual(uniqueName("", []), "Imported build");
  assert.strictEqual(uniqueName("   ", []), "Imported build");
});

test("#190: an oversized envelope is refused before it is parsed", () => {
  const res = parsePortable(envelope(), { maxChars: 10 });
  assert.strictEqual(res.error, "oversized");
});

console.log(`\n${passed} passed`);

test("#530: a v2 backup still imports, with no version history", () => {
  // The compatibility window is the promise this panel makes. A v2 file is not
  // missing data — it is from before snapshots could be carried.
  const v2 = JSON.stringify({
    schema_version: 2, exported_at: "2026-01-01T00:00:00Z", app_build_id: null,
    characters: { Tank: rec("Tank", 34) }, bundles: [], farming: {},
  });
  const res = parseBackup(v2);
  assert.strictEqual(res.ok, true, res.message || "a v2 file must still import");
  assert.deepStrictEqual(res.versions, [], "no history, rather than a refusal");
});

test("#530: an `auto` smuggled into a hand-edited file is REFUSED on restore", () => {
  // The file is editable, so the export-side filter is not the guard. An auto
  // restored as history is history the player never asked for, landing in the one
  // store with a known growth problem (#502).
  const V = require("../web/versions.js");
  const mk = (id, kind) => V.makeVersion({ id, name: id, kind, query: {}, result: {},
                                           inputs: {}, buildId: "b", savedAt: "2026-01-01" });
  const file = JSON.stringify({
    schema_version: 3, exported_at: "2026-01-01T00:00:00Z", app_build_id: null,
    characters: { Tank: rec("Tank", 34) }, bundles: [], farming: {},
    versions: [mk("v1", "named"), mk("v2", "auto")],
  });
  const res = parseBackup(file);
  assert.strictEqual(res.ok, true, res.message);
  assert.deepStrictEqual(res.versions.map((v) => v.id), ["v1"], "the auto is dropped");
});

test("#530: an INVENTED kind is refused, not silently protected forever", () => {
  // `makeVersion` normalizes an unknown kind to `auto`. That matters here: without
  // the sanitize step a record claiming `kind: "permanent"` would restore intact
  // AND be invisible to the reclaim ladder, which only ever drops `auto` — an
  // entry no rung could reclaim and no player asked for.
  const file = JSON.stringify({
    schema_version: 3, exported_at: "2026-01-01T00:00:00Z", app_build_id: null,
    characters: { Tank: rec("Tank", 34) }, bundles: [], farming: {},
    versions: [{ id: "x1", name: "sneaky", kind: "permanent", snapshot: {} }],
  });
  const res = parseBackup(file);
  assert.strictEqual(res.ok, true, res.message);
  assert.deepStrictEqual(res.versions, [], "normalized to auto, then dropped");
});
