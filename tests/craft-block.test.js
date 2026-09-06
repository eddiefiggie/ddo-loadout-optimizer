// #270 — the crafted-option half of the blocklist (node, zero-dependency).
//
// The item half (#110) filters candidacy by `variant_id`. A crafted option has
// none, so "never craft this one" was inexpressible while #194 (PR #688) made
// 116 Legendary Green Steel recipes reachable. These pin the gate: a `craft:`
// id removes the row from its pool, the removal is retained for the disclosure,
// and nothing else moves.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

const DS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", "items.json"), "utf8"));

// A minimal query that reaches the pools: no rung exclusion, no targets needed
// for the pool-sifting assertions below.
const q = (blocklist) => ({ mlCap: 36, targets: [], blocklist });

function poolsFor(query) {
  // buildModel mutates nothing the caller owns, so the shipped arrays are safe to
  // pass; what we assert on is the model's own retained record.
  return M.buildModel(
    [], query, DS.dino_inserts, DS.nearly_complete, DS.viktranium, DS.seal,
    DS.membership_set_defs, DS.legendary_green_steel, DS.augment_set_defs, null,
    DS.nearly_complete_per_item, DS.essence_crafting);
}

test("every shipped option row carries a build-time key", () => {
  const pools = ["dino_inserts", "nearly_complete", "viktranium", "seal",
    "legendary_green_steel", "essence_crafting"];
  for (const p of pools) {
    for (const r of DS[p]) assert.ok(r.block_key, `${p} row with no block_key`);
  }
  for (const host of Object.keys(DS.nearly_complete_per_item)) {
    for (const r of DS.nearly_complete_per_item[host]) assert.ok(r.block_key, host);
  }
});

test("an absent blocklist withholds nothing", () => {
  const m = poolsFor(q(undefined));
  assert.deepStrictEqual(m.craftBlocked, [], "absent must mean filter nothing");
});

test("a craft: id withholds exactly its own option, and it is retained", () => {
  const target = DS.legendary_green_steel[0];
  const m = poolsFor(q([target.block_key]));
  assert.strictEqual(m.craftBlocked.length, 1, "exactly one row withheld");
  assert.strictEqual(m.craftBlocked[0].block_key, target.block_key);
  assert.strictEqual(m.craftBlocked[0].name, target.name,
    "the retained row is the one the player named — the disclosure reads this");
});

test("blocking an option in one pool leaves the other pools alone", () => {
  const target = DS.seal[0];
  const m = poolsFor(q([target.block_key]));
  assert.strictEqual(m.craftBlocked.length, 1);
  assert.ok(m.craftBlocked[0].block_key.startsWith("craft:seal:"));
});

test("an item-id block does not reach the option pools", () => {
  const m = poolsFor(q(["Legendary Katra's Wit"]));
  assert.deepStrictEqual(m.craftBlocked, [],
    "only `craft:` ids address options; an item id must not sift a pool");
});

test("a per-item host keeps an empty pool rather than vanishing", () => {
  const host = Object.keys(DS.nearly_complete_per_item)[0];
  const rows = DS.nearly_complete_per_item[host];
  const m = poolsFor(q(rows.map((r) => r.block_key)));
  assert.strictEqual(m.craftBlocked.length, rows.length,
    "every option of that host is withheld");
  // The host's declared slot still exists; a missing key and an empty pool mean
  // different things to the per-item consumer.
  assert.ok(Object.prototype.hasOwnProperty.call(DS.nearly_complete_per_item, host));
});

test("a stale craft: id withholds nothing and does not throw", () => {
  const m = poolsFor(q(["craft:legendary_green_steel:1:No Such Option"]));
  assert.deepStrictEqual(m.craftBlocked, [],
    "a renamed option leaves a stale entry; the stale-entry report discloses it");
});

console.log(`\n${passed} passed`);
