// #721 — the owned-gear pool's pin escape hatch (node, zero-dependency).
//
// A pin is an explicit instruction that overrides a filter (KD5). That rule was
// already shipped for the ML floor (R8), the augment ceiling (#339) and the
// Artifact opt-in (#369) — but all three exemptions live inside
// `variantConflict`, and the owned-gear pool filters `dataset.items` BEFORE
// `buildModel` ever runs. A pinned unowned variant was therefore removed
// upstream of every one of them, its pick var never created, and
// `slotConstraintBodies`' documented "a pinned id absent from the pool is a
// silent no-op" swallowed the constraint without a word.
//
// Reported by a player: owned-only pool, pinned a Legendary Light Crossbow of
// the Oozing Hunger they could craft but did not own, and kept being handed the
// Dinosaur Bone Heavy Crossbow instead.
const assert = require("assert");
const W = require("../web/wizard.js");
const P = require("../web/projection.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e.message); process.exitCode = 1; }
}

const OWNED = "Dinosaur Bone Heavy Crossbow";
const PINNED = "Legendary Light Crossbow of the Oozing Hunger";

function v(name, opts = {}) {
  return { source_item: name, variant_id: opts.variant_id || name,
    slot: opts.slot || "Weapon", category: opts.category || "item",
    acquirable: opts.acquirable };
}

// The ownership predicate the wizard injects, reduced to its essence: a name set.
const ownsFrom = (names) => (x) => names.has(x.source_item || x.variant_id);

test("the reported case: a pinned unowned item survives the owned pool", () => {
  const owns = ownsFrom(new Set([OWNED]));
  const pinned = new Set([PINNED]);
  assert.strictEqual(W.ownedPoolAdmits(v(PINNED), owns, pinned, false), true,
    "the pin must override the owned filter");
  assert.strictEqual(W.ownedPoolAdmits(v(OWNED), owns, pinned, false), true,
    "an owned item is admitted as before");
});

test("the exemption is per-variant: unpinned unowned gear stays out", () => {
  const owns = ownsFrom(new Set([OWNED]));
  const pinned = new Set([PINNED]);
  assert.strictEqual(W.ownedPoolAdmits(v("Some Other Crossbow"), owns, pinned, false), false,
    "a pin must exempt itself, never open the gate");
});

test("with no pins at all the pool is exactly what it was", () => {
  const owns = ownsFrom(new Set([OWNED]));
  for (const pins of [new Set(), null, undefined]) {
    assert.strictEqual(W.ownedPoolAdmits(v(PINNED), owns, pins, false), false);
    assert.strictEqual(W.ownedPoolAdmits(v(OWNED), owns, pins, false), true);
  }
});

test("a list-shaped Ring pin is read through the shared authority", () => {
  const ids = W.pinnedIdSet({
    Ring: { type: "pin", variant_ids: ["R1", "R2"] },
    Trinket: { type: "pin", variant_id: "T1" },
    Belt: { type: "empty" },
  });
  assert.deepStrictEqual([...ids].sort(), ["R1", "R2", "T1"]);
});

test("augments keep the #359 branch and take no pin exemption", () => {
  const owns = ownsFrom(new Set([]));
  const pinned = new Set(["A1"]);
  const aug = v("Topaz", { variant_id: "A1", category: "augment", acquirable: false });
  // ownedAugments off => full catalog, as before.
  assert.strictEqual(W.ownedPoolAdmits(aug, owns, pinned, false), true);
  // ownedAugments on => owned-union-acquirable decides, NOT the pin.
  assert.strictEqual(W.ownedPoolAdmits(aug, owns, pinned, true), false,
    "augments cannot be pinned; the pin set must not smuggle one in");
});

// ---- the disclosure: an override that is silent is the mirror of #369 --------

test("pinnedUnownedNames names only the pinned items the import lacks", () => {
  const items = [v(OWNED), v(PINNED), v("Unpinned Unowned")];
  const owns = ownsFrom(new Set([OWNED]));
  const cons = { "Main Hand": { type: "pin", variant_id: PINNED } };
  assert.deepStrictEqual(
    W.pinnedUnownedNames("owned", new Set([OWNED]), cons, items, owns), [PINNED]);
});

test("the fact is empty off the owned pool, and when the pin IS owned", () => {
  const items = [v(OWNED), v(PINNED)];
  const owns = ownsFrom(new Set([OWNED]));
  const cons = { "Main Hand": { type: "pin", variant_id: PINNED } };
  assert.deepStrictEqual(
    W.pinnedUnownedNames("full", new Set([OWNED]), cons, items, owns), [],
    "a full-catalog solve filters nothing, so there is nothing to disclose");
  const ownsBoth = ownsFrom(new Set([OWNED, PINNED]));
  assert.deepStrictEqual(
    W.pinnedUnownedNames("owned", new Set([OWNED, PINNED]), cons, items, ownsBoth), [],
    "the player owns it — the pin overrode nothing");
});

test("the notice says what was included and how to undo it", () => {
  const entries = P.pinnedUnownedNoticeEntries({ pinnedUnowned: [PINNED] });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].id, "pinned-not-owned");
  assert.match(entries[0].sentence, /not in your owned-gear import/);
  assert.match(entries[0].sentence, /because you pinned it/);
  assert.match(entries[0].sentence, /Unpin/);
  assert.deepStrictEqual(P.pinnedUnownedNoticeEntries({ pinnedUnowned: [] }), [],
    "no notice when nothing was overridden");
});

console.log(`\n${passed} passed`);
