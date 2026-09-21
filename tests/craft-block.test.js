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

const { test } = require("./_harness");

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

// ---- #270 half two: the picker index -----------------------------------------
const W = require("../web/wizard.js");

test("the index covers every stamped option row and nothing else", () => {
  const idx = W.craftOptionIndex(DS);
  // #764 — 1007 not 996: +11, the Essence options the three newly-served host
  // families add (Rune Arm 2, Ring 7, Melee 2). The second assertion is the one
  // that matters and is why the same change had to widen the craft-identity
  // discriminator to (family, menu): `Insightful Constitution` is a Trinket Prefix
  // AND a Ring Prefix, so under the old `menu`-only key the two collapsed and
  // blocking one would have silently blocked the other.
  // #844 — 1406 not 1327: +79, the compound Essence shards now served whole (one
  // record each: Sheltering, Combat Mastery, …); nothing else moved.
  // #843 — 1327 not 1009: +318, the Essence pool read from the yourddo catalog
  // instead of the wiki shards (356 options over 38; every one of the 38 kept).
  // #817 — 1009 not 1007: +2, the two `Dodge` Essence options (Trinket Prefix and
  // Suffix) that became offerable once the BONUS-TYPE page sweep supplied the type
  // the effect page never carried. The solver's own Essence menu grew, not just
  // the player-authored bench.
  assert.strictEqual(idx.length, 1406, "index size is the stamped population");
  assert.strictEqual(new Set(idx.map((r) => r.id)).size, 1406, "ids stay unique through the index");
  for (const r of idx) {
    assert.ok(r.id.startsWith("craft:"), r.id);
    assert.ok(r.name, `row with no display name: ${r.id}`);
    assert.ok(r.family, `row with no family label: ${r.id}`);
  }
});

test("an unstamped row is not offerable", () => {
  const idx = W.craftOptionIndex({ seal: [{ name: "No Key" }] });
  assert.deepStrictEqual(idx, [], "a row with no block_key must not reach the picker");
});

test("the two nameless pools get a name a player would recognise", () => {
  const idx = W.craftOptionIndex(DS);
  const nc = idx.find((r) => r.id.startsWith("craft:nearly_complete:"));
  assert.ok(/\+\d/.test(nc.name) || nc.name.length > 2,
    `nearly_complete row should name its affix, got ${nc.name}`);
  assert.ok(!nc.name.includes("|"), "a key fragment is not a name");
});

test("search finds by option name, by family, and by host", () => {
  const idx = W.craftOptionIndex(DS);
  assert.ok(W.filterCraftOptions(idx, "Acid Guard").length, "by option name");
  assert.ok(W.filterCraftOptions(idx, "green steel").length, "by family label");
  const host = Object.keys(DS.nearly_complete_per_item)[0];
  assert.ok(W.filterCraftOptions(idx, host).length, "by host name");
  assert.deepStrictEqual(W.filterCraftOptions(idx, ""), [], "empty query matches nothing");
});

test("exact name outranks a substring match", () => {
  const idx = W.craftOptionIndex(DS);
  const hits = W.filterCraftOptions(idx, "Acid Guard");
  assert.strictEqual(hits[0].name.toLowerCase(), "acid guard");
});

test("a craft: id is resolved against the index, not the item roster", () => {
  const idx = W.craftOptionIndex(DS);
  const live = DS.legendary_green_steel[0].block_key;
  // Without the index a crafted block would be reported stale on every load.
  assert.deepStrictEqual(W.blockStale([live], DS.items, idx), [],
    "a live crafted block is not stale");
  assert.deepStrictEqual(W.blockStale([live], DS.items), [],
    "with no index supplied, a craft: id is left alone rather than guessed at");
  assert.deepStrictEqual(W.blockStale(["craft:legendary_green_steel:1:Gone"], DS.items, idx),
    ["craft:legendary_green_steel:1:Gone"], "a renamed option IS reported stale");
});

test("the load message names a stale craft the same way it names an item", () => {
  const idx = W.craftOptionIndex(DS);
  const msg = W.blockLoadMessage(["craft:seal:Fire:No Such Seal"], {}, DS.items, idx);
  assert.ok(msg && /no longer/.test(msg), msg);
  assert.strictEqual(W.blockLoadMessage([DS.seal[0].block_key], {}, DS.items, idx), null,
    "a live crafted block says nothing on load");
});

