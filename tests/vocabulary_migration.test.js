// #374 (U6) — named behavioural assertions for the gear-planner canon migration.
//
// WHY THIS FILE EXISTS AND WHY IT RUNS BEFORE THE GOLDEN IS RE-RATIFIED
// --------------------------------------------------------------------
// The migration keeps DDO's in-game enchantment names (`Combustion`) where
// upstream gear-planner flipped to generic mechanic names (`Fire Spell Power`).
// That is a *named* behaviour: an affix imported under upstream's spelling has
// to score for our canon name, in every channel, or a player's ranked stat
// silently drops to zero.
//
// `tests/solver_golden.test.js` cannot be the witness for it. Per the 2026-08-17
// amendment to docs/solutions/workflow-issues/golden-solve-guard-missing-from-
// local-test-sweep.md, the two classic re-ratification clauses ("diff contained
// to expected fixtures" + "no priority target regressed") cannot adjudicate a
// `chosen`-only diff: an injected live regression satisfied both, and a
// legitimate re-ratification moved 18 of 23 fixtures with zero perTarget change.
// A snapshot is a change detector, not a behaviour specification, and its
// sanctioned remedy for a red is to overwrite the objection. So the behaviour
// gets named assertions here, and they are written and proven red BEFORE
// `tests/parity/golden.json` is regenerated.
//
// Run: node tests/vocabulary_migration.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeDataset, buildPickerVocabulary, migratePriorities } = require("../web/dataset.js");
const { solveEnv, solveFixture, resolveQuery } = require("./parity/capture_golden.js");

const ROOT = path.join(__dirname, "..");
const realData = normalizeDataset(JSON.parse(
  fs.readFileSync(path.join(ROOT, "web", "data", "items.json"), "utf8")));
const vocab = buildPickerVocabulary(realData);

// The DECLARATION, not a hand-list. `data/seed/compendium/affix_name_corrections.json`
// is the single place a canon-defence entry is minted; deriving the roster from it
// means an entry added or retired without a matching assertion cannot hide.
const CORRECTIONS = JSON.parse(fs.readFileSync(
  path.join(ROOT, "data", "seed", "compendium", "affix_name_corrections.json"), "utf8")).corrections;

// The stat name each canon name is CREDITED under in the solver's buckets.
// Twelve of the thirteen are credited under their own name. `Legendary
// Conditioning` is the one declared exception: #287 folds the five engraved
// `Legendary <stat>` display names into base stat + `Legendary` bonus type, so
// its carriers are credited as `Conditioning` and the engraved name survives as
// the provenance receipt (`via`) that the picker redirects through.
const CREDITED_AS = { "Legendary Conditioning": "Conditioning" };
const creditedAs = (canon) => CREDITED_AS[canon] || canon;

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Every solver-visible channel, as one walk. A rename that reaches the item
// roster but not the crafting pools or the set catalog splits ONE mechanic into
// two buckets, silently — which is the failure U2 exists to prevent, so the
// assertions below have to look everywhere the solver looks.
// ---------------------------------------------------------------------------
function* solverStatNames(ds) {
  for (const it of ds.items || []) {
    for (const a of it.affixes || []) yield ["item", it.variant_id, a.name, a.value];
    for (const t of it.parsed_set_bonuses || []) {
      for (const a of t.affixes || []) yield ["tier", `${it.variant_id}/${t.set}`, a.stat, a.value];
    }
  }
  for (const [chan, defs] of [["membership", ds.membership_set_defs],
                              ["augment-set", ds.augment_set_defs]]) {
    for (const [name, def] of Object.entries(defs || {})) {
      for (const t of def.tiers || []) {
        for (const a of t.affixes || []) yield [chan, name, a.stat, a.value];
      }
    }
  }
  for (const s of ds.dino_sets || []) {
    for (const a of s.affixes || []) yield ["dino-set", s.set, a.stat, a.value];
  }
  for (const key of ["dino_inserts", "nearly_complete", "viktranium", "seal",
                     "thunder_forged", "green_steel"]) {
    for (const rec of ds[key] || []) {
      if (Array.isArray(rec.affixes)) {
        for (const a of rec.affixes) yield [key, rec.name || rec.item || "", a.stat || a.name, a.value];
      } else {
        yield [key, rec.name || rec.item || "", rec.stat, rec.value];
      }
    }
  }
}

const CHANNEL_INDEX = (() => {
  const byName = new Map();
  for (const [chan, where, name, value] of solverStatNames(realData)) {
    if (name == null || name === "") continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ chan, where, value });
  }
  return byName;
})();
const carriersOf = (name) => CHANNEL_INDEX.get(name) || [];

// ---------------------------------------------------------------------------
// 1. The thirteen armed variants
// ---------------------------------------------------------------------------

test("#374: the correction roster is the declaration, and every entry is armed", () => {
  assert.ok(CORRECTIONS.length > 0, "the declaration carries entries");
  // #632 — 15, not 13. The two additions are a different KIND of correction and
  // are declared as such: `Weighty Asset` and `Holding On` are not upstream
  // misspellings of our canon, they are separate enchantments the wiki says grant
  // ONE stat ("Extending unconsciousness range"), merged into `Undying` so they
  // share its bucket instead of summing beside it. They carry
  // `merge_into_existing` and cite the page; the ordinary #374 entries carry
  // neither. A 16th entry still needs its own line here rather than a silent pass.
  // #615 — 20, and the merge count is now the larger half. The five `Curse of X`
  // entries join `Weighty Asset` and `Holding On`: each is an enchantment the wiki
  // rules a "-1 Penalty" to a named ability, merged into that ability so the
  // solver subtracts it from the stat a player actually ranks.
  // #649 — 23, and the 23rd is a kind not seen before: `Undying` ->
  // `Unconsciousness Range` merges a name that WAS the canonical onto a new one.
  // Every merge above folds a subordinate spelling into an existing canon; this
  // one retires the canon itself, because naming the stat after one of the four
  // enchantments that feed it is what made a priority reading "Undying 225" sit
  // beside a card reading "Weighty Asset". The alias is what makes it safe — see
  // the per-entry resolution test below, which now covers `Undying` too.
  assert.strictEqual(CORRECTIONS.length, 23,
    "23 armed variants — 13 upstream-spelling corrections (#374) plus 10 " +
    "evidence-bound merges (#632, #615, #639, #649); a new entry needs its own " +
    "assertion, not a bump");
  assert.strictEqual(CORRECTIONS.filter((c) => c.merge_into_existing).length, 10,
    "ten entries are merges, and a merge must cite the wiki page that says the " +
    "two names are one stat");
  // The retired canonical, asserted by name: this is the entry a future refresh is
  // most likely to drop, because `Undying` still looks like a stat name.
  const retired = CORRECTIONS.find((c) => c.source_name === "Undying");
  assert.ok(retired, "the retired canonical `Undying` is still declared as a merge");
  assert.strictEqual(retired.canonical_name, "Unconsciousness Range");
  assert.ok(retired.merge_into_existing && retired.evidence,
    "it stamps `via` and cites the page — both, or the card stops saying what the item is");
  for (const c of CORRECTIONS) {
    assert.ok(!c.pending_upstream,
      `${c.source_name} still carries a pending_upstream marker — it is not armed`);
    assert.ok(c.source_name && c.canonical_name, "both names are stated");
  }
});

test("#374: each armed variant resolves upstream's spelling to our canon in the picker", () => {
  // The saved-character load path and the priority picker both read this map, so
  // a player who ranked upstream's spelling (or imported a build that carries it)
  // lands on our canon rather than on a name nothing scores.
  const aliases = realData.metadata.affix_aliases || {};
  for (const c of CORRECTIONS) {
    assert.strictEqual(aliases[c.source_name], c.canonical_name,
      `the built alias map redirects ${c.source_name} -> ${c.canonical_name}`);
    assert.strictEqual(vocab.canonical(c.source_name), c.canonical_name,
      `the picker vocabulary redirects ${c.source_name} -> ${c.canonical_name}`);
  }
});

test("#374: each armed variant, present on an item, CREDITS the corresponding canon target", () => {
  // The whole point of the canon defence: an affix imported under upstream's
  // spelling has to score for our name. Asserted per entry against the real
  // built dataset, across every channel the solver reads — a rename that lands
  // on the item roster but misses the crafting pools or the set catalog leaves
  // one mechanic in two buckets and nothing else goes red.
  const dead = [];
  for (const c of CORRECTIONS) {
    const target = creditedAs(c.canonical_name);
    const carriers = carriersOf(target);
    if (!carriers.length) { dead.push(`${c.canonical_name} -> ${target}: no carrier`); continue; }
    const magnitudes = carriers.filter((x) => Number.isFinite(Number(x.value)) && Number(x.value) !== 0);
    if (!magnitudes.length) dead.push(`${c.canonical_name} -> ${target}: carried but never with a magnitude`);
  }
  assert.deepStrictEqual(dead, [],
    "every armed correction's canon target is carried, with a magnitude, in a solver channel");
});

test("#374: upstream's spelling survives in NO solver channel", () => {
  // U2's coverage, stated as a property rather than as a count: if a channel was
  // missed, its records still carry the generic name and the mechanic is split.
  const survivors = [];
  for (const c of CORRECTIONS) {
    const carriers = carriersOf(c.source_name);
    if (carriers.length) {
      survivors.push(`${c.source_name}: ${carriers.length} (${carriers[0].chan} ${carriers[0].where})`);
    }
  }
  assert.deepStrictEqual(survivors, [],
    "no solver channel still carries an upstream spelling our canon replaces");
});

test("#374: the canon names are pickable — suggested and known, not free-text-only", () => {
  for (const c of CORRECTIONS) {
    const target = creditedAs(c.canonical_name);
    assert.ok(vocab.known.has(target) || vocab.suggestions.includes(target),
      `${target} is reachable in the picker`);
  }
});

// ---------------------------------------------------------------------------
// 2. The #287 fold, in the SET channel too
// ---------------------------------------------------------------------------

test("#287/#376: no solver channel credits the engraved `Legendary Conditioning`", () => {
  // The engraved name is a DISPLAY label; every carrier is credited as
  // `Conditioning` at bonus type `Legendary`. This is the assertion the sets
  // channel needs: U2 renames the raw set catalog, so `False Life (%)` becomes
  // the engraved name there as well, and without the fold running on that
  // channel the set tier credits a stat name no item affix carries — a bucket
  // disjoint from the worn carriers, which is exactly the split #376 closed.
  const engraved = carriersOf("Legendary Conditioning");
  assert.deepStrictEqual(engraved.map((x) => `${x.chan}:${x.where}`), [],
    "the engraved name is never a credited stat");
  const base = carriersOf("Conditioning");
  assert.ok(base.length > 0, "the base stat IS credited");
  assert.ok(base.some((x) => x.chan === "item"), "worn carriers credit it");
  assert.ok(base.some((x) => x.chan === "tier" || x.chan === "membership"),
    "and so do the set tiers — one bucket, not two");
});

test("#287: the engraved `Legendary Conditioning` stays a redirecting picker label", () => {
  // A player who ranked the engraved name (it is what the item prints) must be
  // redirected to the stat that scores, not left ranking a dead name.
  const label = vocab.provenanceLabels["legendary conditioning"];
  assert.ok(label, "Legendary Conditioning is a shipped provenance label");
  assert.deepStrictEqual(label, ["Conditioning"], "and it resolves to the base stat");
  const { priorities, substitutions } = migratePriorities(["Legendary Conditioning"], vocab);
  assert.deepStrictEqual(priorities, ["Conditioning"], "the load path substitutes it");
  assert.strictEqual(substitutions.length, 1, "and says so");
});

// ---------------------------------------------------------------------------
// 2b. The four labels upstream ADOPTED (#381)
//
// Same refresh, opposite outcome. Upstream took over four of the five folds:
// `Legendary Accuracy` now arrives as `Accuracy` at type `Legendary`, which is
// what the fold was producing anyway. Nothing is left to fold, so no affix
// carries the receipt, so the engraved name left the vocabulary — and a
// character saved before the refresh ranked a name nothing carries and nothing
// redirected. Scoring never moved; the saved priority stopped pointing at it.
// ---------------------------------------------------------------------------

const ADOPTED = {
  "Legendary Accuracy": "Accuracy",
  "Legendary Armor-Piercing": "Armor-Piercing",
  "Legendary Deadly": "Deadly",
  "Legendary Spell Penetration": "Spell Penetration",
};

test("#381: the adopted labels are retired to their base stats, and Conditioning is not", () => {
  const retired = (realData.metadata || {}).retired_labels || {};
  assert.deepStrictEqual(
    Object.fromEntries(Object.entries(retired).map(([k, v]) => [k, v.join(",")])),
    Object.fromEntries(Object.entries(ADOPTED).map(([k, v]) => [k.toLowerCase(), v])),
    "exactly the four adopted labels, each mapped to the stat that now carries it");
  assert.ok(!("legendary conditioning" in retired),
    "the survivor is NOT retired — the condition is whether the fold FIRED, not " +
    "whether the name occurs. All five have zero raw occurrences; this one is " +
    "minted by a rename upstream of the fold, so it fires and keeps its receipt");
});

test("#381: each retired label's base stat is what the solver actually credits", () => {
  for (const [label, base] of Object.entries(ADOPTED)) {
    assert.deepStrictEqual(carriersOf(label).map((x) => x.chan), [],
      `${label} is credited by no channel — that is why it needed retiring`);
    assert.ok(carriersOf(base).length > 0, `${base} is credited, so the migration lands somewhere`);
    assert.ok(vocab.suggestions.includes(base), `${base} is still pickable`);
  }
});

test("#381: a saved character ranking an adopted label loads with the base stat in its place", () => {
  // The reported defect, end to end, on the shipped dataset.
  const saved = ["Constitution", "Legendary Accuracy", "Dodge"];
  const out = migratePriorities(saved, vocab);
  assert.deepStrictEqual(out.priorities, ["Constitution", "Accuracy", "Dodge"],
    "substituted IN PLACE — rank order is the product, so it cannot shift");
  assert.deepStrictEqual(out.substitutions, [],
    "not reported as an expansion: nothing was shorthand for anything");
  assert.deepStrictEqual(out.retired, [{ from: "Legendary Accuracy", to: ["Accuracy"] }],
    "reported as a retirement, so the disclosure can say what actually happened");
  assert.deepStrictEqual(migratePriorities(out.priorities, vocab).priorities, out.priorities,
    "idempotent — a second load is a no-op");
});

test("#381: all four adopted labels migrate, and a duplicate collapses", () => {
  const out = migratePriorities([...Object.keys(ADOPTED), "Accuracy"], vocab);
  assert.deepStrictEqual(out.priorities, Object.values(ADOPTED),
    "each becomes its base stat, and the already-ranked Accuracy does not repeat");
  assert.strictEqual(out.retired.length, 4, "every one of them is disclosed");
});

test("#381: a retired label never re-enters the pickable vocabulary", () => {
  for (const label of Object.keys(ADOPTED)) {
    assert.ok(!vocab.suggestions.includes(label), `${label} is not suggested`);
    assert.ok(!vocab.known.has(label), `${label} is not known — it cannot be free-typed either`);
    assert.ok(!vocab.provenanceLabels[label.toLowerCase()],
      `${label} is not a provenance label — nothing stamps it anymore`);
  }
});

// ---------------------------------------------------------------------------
// 3. The untyped predicate, after upstream re-encoded the type field (#380)
// ---------------------------------------------------------------------------

test("#380/#235: the untyped predicate reads upstream's literal `Untyped`", () => {
  // The 2026-08-18 refresh stopped omitting the `type` key and started emitting
  // the literal string `"Untyped"` (key-less 5709 -> 90, `"Untyped"` 148 -> 886).
  // Three PYTHON predicates were widened for it in U4. `buildPickerVocabulary`'s
  // #235 untyped-only predicate is the fourth of the same shape: if it only
  // recognises an absent type, every untyped-only stat reads as typed and the
  // declared-credit gate goes globally inert without a sound.
  const types = new Set();
  for (const it of realData.items || []) {
    for (const a of it.affixes || []) if (a.name === "Enhanced Ki") types.add(String(a.type));
  }
  assert.deepStrictEqual([...types], ["Untyped"],
    "Enhanced Ki's carriers are typed with upstream's literal spelling — the premise of this test");
  assert.ok(vocab.untypedOnly.has("Enhanced Ki"),
    "so the vocabulary must still classify it untyped-only");
});

// ---------------------------------------------------------------------------
// 4. The saved-character load path
// ---------------------------------------------------------------------------

test("#374: saved priorities in OUR canon still resolve through the load path", () => {
  // A character saved before the refresh ranks `Combustion`. Loading it must
  // pass the name through untouched — not substitute it, not drop it.
  // #632 — DEDUPED. Two entries now share one canonical (`Weighty Asset` and
  // `Holding On` both merge into `Undying`), and a saved priority list holds each
  // stat once. Comparing against a list with `Undying` twice would fail on the
  // load path's correct de-duplication rather than on anything about migration.
  const canon = [...new Set(CORRECTIONS.map((c) => creditedAs(c.canonical_name)))];
  const { priorities, substitutions } = migratePriorities(canon, vocab);
  assert.deepStrictEqual(priorities, canon, "every canon name survives the load path verbatim");
  assert.deepStrictEqual(substitutions, [], "and none of them is redirected away");
});

test("#374: saved priorities in UPSTREAM's spelling migrate onto our canon", () => {
  // The mirror case: a build imported from a gear-planner-shaped export.
  const sources = CORRECTIONS.map((c) => c.source_name);
  const { priorities, substitutions } = migratePriorities(sources, vocab);
  assert.strictEqual(substitutions.length, sources.length,
    "every upstream spelling is redirected, and the redirect is disclosed");
  for (const p of priorities) {
    assert.ok(vocab.known.has(p) || vocab.suggestions.includes(p),
      `${p} is a name the picker knows`);
  }
});

// ---------------------------------------------------------------------------
// 5. Bool-typed procs still reach the picker (#380: the empty allow list is
//    display-only, not a scoring change)
// ---------------------------------------------------------------------------

test("#380: the retired untyped-proc adjudications still reach the presence path", () => {
  // U4 retired 104 `utility_procs` adjudications because upstream typed those
  // procs `Bool`, leaving `allow` empty and `utilityAdmitted` collapsed to an
  // empty set. That is only tolerable if the PICKER path survived — the names
  // must still be offered as presence effects via `PRESENCE_TYPES`, or the
  // retirement quietly removed 104 build-around effects from the product.
  const shard = JSON.parse(fs.readFileSync(
    path.join(ROOT, "data", "seed", "compendium", "utility_procs.json"), "utf8"));
  const retired = Object.keys((shard._retired_2026_08_18 || {}).entries || {});
  assert.ok(retired.length > 100, `the retirement is the population under test (${retired.length})`);
  const unreachable = retired.filter(
    (n) => !vocab.presence.has(n) && !vocab.suggestions.includes(n)).sort();
  // The only two that do not reach it are word-cap casualties, hidden by the
  // presence-name shape filter and not by the retirement: a full sentence and a
  // five-word named effect. Both are pinned by dataset.test.js's #228 casualty set.
  assert.deepStrictEqual(unreachable,
    ["Hidden Effect: Increases all threat generated by", "The Dragging of the Depths"],
    "every retired proc but the two word-cap casualties is still a presence effect");
});

test("#380: `utilityNotCounted` is the build stamp, both halves of it", () => {
  // The set is the union of two stamps: the DERIVED presence-minus-counting
  // population (#380), and the shard's reviewed untyped procs, which stay armed
  // for their own population should upstream ever emit an untyped weapon proc
  // again. Nothing is re-derived in the web layer — a drift between the two
  // would mean the picker disagrees with the build about what is counted.
  const meta = realData.metadata || {};
  const derived = meta.utility_presence_not_counted || [];
  const untyped = meta.utility_untyped_admitted || [];
  assert.ok(vocab.utilityNotCounted instanceof Set, "exposed as a Set");
  assert.ok(derived.length > 100,
    `the derived half is the population that replaced the retired adjudications (${derived.length})`);
  assert.strictEqual(vocab.utilityNotCounted.size, new Set([...derived, ...untyped]).size,
    "the vocabulary's not-counted set is exactly the union of the two stamps");
  // The retirement emptied the untyped half and that is still true — the fix was
  // to stop depending on it, not to refill it.
  assert.strictEqual(untyped.length, 0,
    "the untyped-proc allow list is still empty; upstream types them all Bool");
  assert.ok(vocab.utilityCounting.size > 0,
    "and the COUNTING set — the scoring half — is untouched by the retirement");
});

// ---------------------------------------------------------------------------
// 6. Fixture-level detector: a ranked migrated stat must never solve to zero
// ---------------------------------------------------------------------------

const MIGRATED = new Set([
  ...CORRECTIONS.map((c) => creditedAs(c.canonical_name)),
  // Kinetic Lore is the lore family's SURVIVOR — upstream kept our spelling for
  // it while flipping Ice Lore and Void Lore. It rides along here because a fold
  // that over-reached would take it out with its two siblings.
  "Kinetic Lore",
]);

(async () => {
  const env = await solveEnv();
  const fixtures = JSON.parse(fs.readFileSync(
    path.join(__dirname, "parity", "fixtures.json"), "utf8"));

  // Derived, never hand-listed: a fixture is "affected" when its RESOLVED query
  // (aliases expanded exactly as a saved build's would be) ranks a migrated name.
  const affected = [];
  for (const fx of fixtures) {
    const { query } = resolveQuery(fx, env.vocab);
    const ranked = (query.targets || []).filter((t) => MIGRATED.has(t));
    if (ranked.length) affected.push({ fx, ranked });
  }

  test("#374: the affected-fixture set is derived and non-empty", () => {
    assert.ok(affected.length >= 5,
      `at least the five raw-target fixtures rank a migrated name (got ${affected.length}: ` +
      `${affected.map((a) => a.fx.name).join(", ")})`);
  });

  for (const { fx, ranked } of affected) {
    const { solve } = await solveFixture(fx, env);
    test(`#374: ${fx.name} credits its ranked migrated stat non-zero`, () => {
      // A ranked stat sitting at ZERO is the tell that a rename or a fold was
      // missed — the fixture keeps solving, deterministically, while pinning a
      // query no player can produce. This is the fixture-level detector for U2's
      // coverage, and it does NOT read golden.json: re-capturing the golden
      // cannot silence it.
      //
      // SCOPE LIMIT, measured 2026-08-18 rather than assumed. Reverting the ten
      // spell-power/lore renames in the built dataset does NOT take these to
      // zero, because the cross-add families leave a residue: `Combustion` fell
      // 464 -> 128 and `Ice Lore` 46 -> 11, both still non-zero, since
      // `Universal Spell Power` and the lore roster cross-add into those buckets
      // independently of the affix name. So this detector catches a name that
      // vanishes ENTIRELY; a partial miss inside a cross-add family is caught by
      // the data-layer assertions above ("CREDITS the corresponding canon
      // target" / "survives in NO solver channel"), which is where the teeth are.
      const pt = solve.perTarget || {};
      for (const stat of ranked) {
        assert.ok(Object.prototype.hasOwnProperty.call(pt, stat),
          `${stat} is a solved target of ${fx.name}`);
        assert.ok(pt[stat] > 0,
          `${fx.name} ranks ${stat} and must credit it (got ${pt[stat]})`);
      }
    });
  }

  // The brief's own example, as its own solve: a player who ranks `Combustion`
  // against the REFRESHED catalog gets a real total. Independent of the parity
  // fixtures, so a fixture edit cannot take this cover away.
  const combustion = await solveFixture(
    { name: "ad-hoc: a player ranks Combustion", query: { mlCap: 32, targets: ["Combustion"] } },
    env);
  test("#374: a player ranking Combustion gets a non-zero total on the refreshed catalog", () => {
    assert.strictEqual(combustion.solve.status, "optimal", "the solve succeeds");
    assert.ok((combustion.solve.perTarget || {}).Combustion > 0,
      `Combustion must score (got ${(combustion.solve.perTarget || {}).Combustion})`);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
