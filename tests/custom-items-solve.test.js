// #773 — the reported scenario, end to end through the REAL solver.
// Run: node tests/custom-items-solve.test.js
//
// The unit tests in custom-items.test.js prove the record is well formed. This
// file proves the thing the player actually asked for:
//
//   "I acquired a blank Cannith Crafted dagger, put it at level 36 with
//    Assassinate and Insightful Assassinate and Armor Piercing. Is there a way to
//    select it as an Offhand weapon, so the builder can see it has the highest
//    Assassinate on it and just look for Quality Assassinate instead?"
//
// Three claims, each a separate assertion below, because each could fail alone:
//
//   1. The described dagger reaches the pool and can be PINNED to the off hand.
//   2. It is PLACED there, and the solve is optimal rather than infeasible.
//   3. The solver then spends the rest of the build on what the dagger does NOT
//      cover — the Quality bucket the player asked it to go and find — instead of
//      re-buying Enhancement or Insight Assassinate it already has.
//
// Claim 3 is the one worth the machinery. It is the reason a custom ITEM is not
// the same as a declared credit: a credit is slot-agnostic, so it can free a
// bucket but can never occupy the off hand. The A/B pair below measures exactly
// that difference against the same query with no custom item at all.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { normalizeDataset, buildPickerVocabulary } = require(path.join(ROOT, "web/dataset.js"));
const { buildQuery } = require(path.join(ROOT, "web/wizard.js"));
const { buildModel } = require(path.join(ROOT, "web/model.js"));
const { solveLexicographic } = require(path.join(ROOT, "web/solver.js"));
const C = require(path.join(ROOT, "web/custom-items.js"));
const Proj = require(path.join(ROOT, "web/projection.js"));
const Exporters = require(path.join(ROOT, "web/exporters.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log("  PASS", name); }
  catch (e) { console.log("  FAIL", name, "\n   ", e && e.message); failed++; process.exitCode = 1; }
}

const DAGGER = {
  uid: 1, name: "My Cannith dagger", slot: "Weapon", type: "Daggers", ml: 36,
  augments: ["Red"],
  affixes: [
    // #795 — built on the bench now. The three effects the reporter described land
    // in the three menus a Melee weapon actually has, and "Insightful Assassinate"
    // is the game's OWN name for the Extra one rather than something the player
    // has to decompose into Assassinate + Insight by hand. Underneath it is still
    // one stat in two buckets, which is why the report's "just look for Quality
    // Assassinate" is the right description of what should happen next.
    { menu: "Prefix", effect: "Armor-Piercing", bonus_type: "Enhancement", value: 25 },
    { menu: "Suffix", effect: "Assassinate", bonus_type: "Enhancement", value: 8 },
    { menu: "Extra", effect: "Insightful Assassinate", bonus_type: "Insight", value: 4 },
  ],
};

function baseState(over) {
  return Object.assign({
    ml: 36, mlFloor: 1, priorities: ["Assassinate", "Armor-Piercing"],
    style: "one-hand", weaponTypes: ["Daggers"], offHandWeapons: ["Daggers"], offHand: [],
    twoWeaponFighting: true, craftingRung: "everything",
    slotConstraints: {}, blocklist: [], pinnedSets: [], pinnedAugments: [], excludedSets: [],
    ownedSetAugments: new Set(), targetCaps: {}, targetFloors: {},
    declaredCredits: {}, excludedTypes: {}, overrideApplied: [],
    armor: "", oath: "", race: "", alignment: "", pool: "all",
  }, over || {});
}

(async () => {
  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });
  const rawDataset = JSON.parse(
    fs.readFileSync(path.join(ROOT, "web/data/items.json"), "utf8"));
  const dataset = normalizeDataset(rawDataset);
  // #795 — the placement table travels on ctx, exactly as the browser passes it.
  const placements = rawDataset.essence_placements;
  const vocab = buildPickerVocabulary(dataset);
  const catalogNames = new Set(dataset.items.map((v) => v.source_item || v.variant_id));

  const minted = C.customPool([DAGGER], { vocab, catalogNames, placements });
  const pool = dataset.items.concat(minted.variants);

  async function solve(state, items) {
    const query = buildQuery(state, vocab, items);
    const model = buildModel(items, query,
      dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium, dataset.seal,
      dataset.membership_set_defs, dataset.legendary_green_steel, dataset.augment_set_defs,
      vocab.utilityCounting && vocab.utilityCounting.size
        ? { counting: vocab.utilityCounting, notCounted: vocab.utilityNotCounted || new Set(),
            order: vocab.utilityOrder || null }
        : null,
      dataset.nearly_complete_per_item, dataset.essence_crafting, dataset.slavers);
    return { query, result: await solveLexicographic(model, highs) };
  }

  test("the described dagger mints cleanly — nothing was silently rejected", () => {
    assert.deepStrictEqual(minted.rejected, [], "the reported item must validate as described");
    assert.strictEqual(minted.variants.length, 1);
    assert.strictEqual(minted.variants[0].variant_id, "My Cannith dagger (yours)");
  });

  // --- Claim 1 + 2: pinned to the off hand, and placed there ---------------
  const pinned = await solve(baseState({
    slotConstraints: { "Off Hand": { type: "pin", variant_id: "My Cannith dagger (yours)" } },
  }), pool);

  test("#773: a described weapon can be pinned to the Off Hand and the solve stays optimal", () => {
    assert.strictEqual(pinned.result.status, "optimal",
      "an infeasible solve here would mean the pin cannot be honoured at all");
  });

  test("#773: the pinned item is actually PLACED in the off hand", () => {
    // `slotConstraintBodies` documents that a pinned id ABSENT from the pool is a
    // silent no-op — the solve succeeds and simply ignores the pin. So asserting
    // "optimal" is not enough; the placement is the claim.
    const off = (pinned.result.chosen || []).find((c) => c.slot === "Off Hand");
    assert.ok(off, "nothing was placed in the off hand");
    assert.strictEqual(off.variant.variant_id, "My Cannith dagger (yours)");
    assert.strictEqual(off.variant.player_authored, true);
  });

  // --- Claim 3: the solver goes looking for what the dagger lacks ----------
  const noCustom = await solve(baseState(), dataset.items);

  test("#773: the dagger's own buckets are counted, so the build does not re-buy them", () => {
    // The player's ask, stated as a measurement: with the dagger in hand the
    // solver must reach AT LEAST the Assassinate it could reach without it —
    // the dagger's Enhancement 8 and Insight 4 are contributions, not a tax on a
    // slot. A lower total would mean the pin cost more than it gave.
    const withCustom = pinned.result.effective.Assassinate;
    assert.ok(withCustom >= noCustom.result.effective.Assassinate,
      `pinning the dagger lost Assassinate: ${withCustom} < ${noCustom.result.effective.Assassinate}`);
  });

  test("#773: the rest of the loadout supplies the buckets the dagger does not", () => {
    // The concrete form of "just look for Quality Assassinate instead of the
    // other two". The dagger holds the Enhancement and Insight buckets; the
    // Quality one is still open, so the solved total must exceed the dagger's own
    // 8 + 4 — i.e. something else in the build is contributing Assassinate.
    const dagger = 8 + 4;
    assert.ok(pinned.result.effective.Assassinate > dagger,
      `nothing outside the dagger contributed Assassinate (total ${pinned.result.effective.Assassinate}, `
      + `dagger alone ${dagger})`);
    // And the off hand is spent on the dagger, so the gain came from elsewhere.
    const others = (pinned.result.chosen || []).filter((c) => c.slot !== "Off Hand");
    assert.ok(others.length > 1, "the rest of the build was still filled");
  });

  test("#773: a custom item in an owned-gear solve is NOT reported as pinned-but-unowned", () => {
    // The player typed it in because they have it. The owned-pool disclosure
    // exists for a catalog item a Trove export does not list; firing it here
    // would warn about the one item in the build that needs no warning.
    const q = buildQuery(baseState({
      pool: "owned", ownedNames: new Set(["Legendary Sunburst"]),
      slotConstraints: { "Off Hand": { type: "pin", variant_id: "My Cannith dagger (yours)" } },
    }), vocab, pool);
    assert.ok(!(q.pinnedUnowned || []).some((n) => /Cannith dagger/.test(n)),
      `the custom item was reported as unowned: ${(q.pinnedUnowned || []).join(", ")}`);
  });

  // --- The disclosure, on every surface -----------------------------------
  test("#773: the solved result carries the player-authored disclosure", () => {
    const entries = Proj.playerAuthoredNoticeEntries(
      { playerAuthored: (pinned.result.chosen || [])
        .filter((c) => c.variant && c.variant.player_authored === true)
        .map((c) => c.variant.source_item) }, (s) => s);
    assert.strictEqual(entries.length, 1, "exactly one disclosure card");
    assert.ok(entries[0].sentence.includes("My Cannith dagger"));
    assert.ok(/not wiki-sourced/i.test(entries[0].sentence));
  });

  test("#773: every text export labels the described item", () => {
    // The standing solve-visible-but-share-invisible invariant, applied to the
    // one case where the recipient has no other way to know: they are reading
    // numbers the SENDER typed. Each format is checked, because the projection
    // carrying the phrase is necessary and not sufficient.
    const rec = { name: "Assassin", inputs: { characterName: "Assassin" },
      query: pinned.query, snapshot: pinned.result };
    const view = Proj.project(rec);
    const row = view.loadout.find((it) => it.item === "My Cannith dagger (yours)");
    assert.ok(row, "the described item is in the projected loadout");
    assert.ok(row.playerAuthored, "…and carries the shared wording");

    // All six, named from the module's own surface rather than guessed: a typo'd
    // export name would make this test pass by checking nothing.
    const SIX = ["toMarkdown", "toBBCode", "toCsv", "toPrintHtml", "toGearset", "toPortableJSON"];
    for (const fn of SIX) {
      assert.strictEqual(typeof Exporters[fn], "function", `exporters.js has no ${fn}`);
    }
    for (const fn of SIX) {
      const out = Exporters[fn](rec);
      const text = typeof out === "string" ? out : JSON.stringify(out);
      assert.ok(/not wiki-sourced/.test(text),
        `the ${fn} export does not disclose the player-authored item`);
      // And the name it prints carries the provenance too, on every surface.
      // Backslashes are stripped first: `mdEsc` escapes the parentheses, so the
      // Markdown export legitimately reads `My Cannith dagger \(yours\)` and a
      // literal match would fail on correct output.
      assert.ok(/My Cannith dagger \(yours\)/.test(text.replace(/\\/g, "")),
        `the ${fn} export does not print the item under its marked name`);
    }
  });

  // --- #774: an on/off effect on a described item ------------------------
  //
  // The claim the whole issue turned on: does a player-supplied flag reach the
  // Utility tier, and does the tier's receipt say whose it is? Both are measured
  // here rather than reasoned about, because both were the open design questions
  // and the answer decided how much code #774 needed (almost none).
  // #795 — `Ghost Touch` is a WEAPON placement (Melee/Ranged Prefix) and cannot be
  // crafted onto a ring, so the fixture uses a flag a ring can actually host. The
  // claim under test is unchanged and the three properties it needs still hold:
  // `Blindness Immunity` is presence-only, it is on the Utility counting roster,
  // and the catalog carries it as `Bool` — all asserted below rather than assumed.
  //
  // The typed half moves to `Dexterity` because it has to be in a DIFFERENT menu
  // from the flag, and it is SOURCED: the wiki publishes its bonus type and its
  // magnitude at ML 30, so the form fills both and the player supplies neither.
  // That makes this the end-to-end case for the sourced branch as well.
  const FLAG = "Blindness Immunity";
  const ghostRing = {
    uid: 2, name: "My ghostly ring", slot: "Ring", ml: 30, augments: [],
    affixes: [
      { menu: "Prefix", effect: FLAG },
      { menu: "Suffix", effect: "Dexterity" },
    ],
  };
  const flagMinted = C.customPool([ghostRing], { vocab, catalogNames, placements });
  const flagPool = dataset.items.concat(flagMinted.variants);

  const withFlag = await solve(baseState({
    ml: 30, priorities: ["Dexterity", "Utility effects"],
    style: "one-hand", weaponTypes: [], offHandWeapons: [], twoWeaponFighting: false,
    slotConstraints: { Ring: { type: "pin", variant_id: "My ghostly ring (yours)" } },
  }), flagPool);

  test("#774: a described item's on/off effect mints and the solve stays optimal", () => {
    assert.deepStrictEqual(flagMinted.rejected, []);
    const bool = flagMinted.variants[0].affixes.find((a) => a.name === FLAG);
    assert.ok(bool, `${FLAG} is not on the minted record`);
    assert.strictEqual(bool.type, "Bool");
    assert.strictEqual(withFlag.result.status, "optimal");
  });

  test("#774: the Utility tier COUNTS a flag the player supplied", () => {
    // Counted through the ordinary bucket machinery — the tier mints one
    // indicator per counting-set name with any contribution, and a player's
    // `Bool` is a contribution like the catalog's. No special case exists, and
    // this is the assertion that says none is needed.
    assert.ok(vocab.utilityCounting.has(FLAG), `${FLAG} must be on the counting roster`);
    const effects = ((withFlag.result.utilityReport || {}).effects) || [];
    const hit = effects.find((e) => e.name === FLAG);
    assert.ok(hit, `the tier did not count ${FLAG}; counted: ${effects.map((e) => e.name).join(", ")}`);
  });

  test("#774: the tier's receipt credits the player's item, under its marked name", () => {
    // The disclosure obligation the issue raised, and it is already met: the
    // receipt names the carrier, and a described item's name carries `(yours)`.
    // That is the structural half of #773's disclosure doing the work here for
    // free — which is why #774 needed no new reporting.
    const ring = (withFlag.result.chosen || []).find((c) => c.slot === "Ring"
      && c.variant.variant_id === "My ghostly ring (yours)");
    assert.ok(ring, "the described ring was not placed, so the receipt proves nothing");
    const hit = (((withFlag.result.utilityReport || {}).effects) || [])
      .find((e) => e.name === FLAG);
    assert.strictEqual(hit.item, "My ghostly ring (yours)",
      "the credited carrier must be the player's item, named as theirs");
  });

  console.log(`\n  ${passed} passed, ${failed} failed`);
})().catch((e) => { console.error("ERR", (e && e.stack) || e); process.exit(1); });
