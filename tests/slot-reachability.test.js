// #743 — per-effect slot reachability. Run: node tests/slot-reachability.test.js
//
// The question this answers is the one the app could not: "the effect exists, I
// ranked it first, and I wanted it in a slot that can never supply it." Ranking
// `Assassinate` top does not fail — the solver satisfies it from Gloves or a Ring
// and reports optimal, which is correct and says nothing about the weapon the
// player asked about.
//
// Two disciplines are pinned here and both are easy to erode:
//
//   1. An AUGMENT route is named as an augment route, never folded into the worn
//      slot list. `Yellow` is not a gear slot, and the founding case turns on the
//      difference: 4 weapons declare a Yellow slot and 2 Yellow augments carry
//      Assassinate, so "no weapon route" — what a native-only scan reports — is
//      WRONG in exactly the case that prompted the issue.
//   2. The statement is DESCRIPTIVE. It never ranks slots, never calls a route
//      better, never proposes an action. See tests/cap-opportunity.test.js for the
//      same line held on the #747 notice.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../web/model.js");
const Proj = require("../web/projection.js");
const W = require("../web/wizard.js");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

// Driven against the REAL built catalog, not fixtures. The evidence table in
// docs/plans/2026-09-12-001-feat-slot-reachability-disclosure-plan.md was measured
// from this file, and these assertions reproduce it — a fixture could be made to
// agree with a wrong implementation.
const DATA = path.join(__dirname, "..", "web", "data", "items.json");
const dataset = JSON.parse(fs.readFileSync(DATA, "utf8"));
const POOLS = {
  dinoInserts: dataset.dino_inserts || [],
  viktranium: dataset.viktranium || [],
  seal: dataset.seal || [],
  legendaryGreenSteel: dataset.legendary_green_steel || [],
  essenceCrafting: dataset.essence_crafting || [],
  slavers: dataset.slavers || [],   // #766
};

/** Every route for `stat` over the whole catalog (no query filtering). */
function routes(stat, variants = dataset.items) {
  return M.slotReachabilityFor(stat, variants, POOLS);
}
const at = (rs, slot, route) => rs.filter((r) => r.slot === slot && r.route === route);
const slotsFor = (rs, route) => [...new Set(rs.filter((r) => r.route === route).map((r) => r.slot))];

// ---- the founding case: the augment route the issue itself missed -----------

test("#743: a Weapon reaches Assassinate through a Yellow augment", () => {
  const r = at(routes("Assassinate"), "Weapon", "augment");
  assert.ok(r.length, "expected a Weapon augment route for Assassinate");
  assert.ok(r.some((x) => x.via === "Yellow"), `expected the Yellow colour, got ${JSON.stringify(r.map((x) => x.via))}`);
});

test("#743: the four named weapons are reported as a NATIVE Enhancement route", () => {
  const r = at(routes("Assassinate"), "Weapon", "native");
  assert.ok(r.length, "expected a native Weapon route");
  assert.deepStrictEqual([...new Set(r.flatMap((x) => x.bonusTypes))], ["Enhancement"]);
});

test("#743: Off Hand is augment-reachable for Assassinate", () => {
  assert.ok(at(routes("Assassinate"), "Off Hand", "augment").length,
    "40 Off Hand items declare a Yellow slot; expected an Off Hand augment route");
});

// ---- the two boundaries the issue established, which must survive -----------

test("#743: NO weapon or off-hand route supplies Assassinate at Insight, by any channel", () => {
  const r = routes("Assassinate").filter((x) => (x.slot === "Weapon" || x.slot === "Off Hand")
    && x.bonusTypes.includes("Insight"));
  assert.deepStrictEqual(r, [], `expected no Insight weapon/off-hand route, got ${JSON.stringify(r)}`);
});

test("#743: no Weapon or Off Hand host declares a Miserable Viktranium slot", () => {
  const r = routes("Assassinate").filter((x) => x.route === "viktranium"
    && (x.slot === "Weapon" || x.slot === "Off Hand"));
  assert.deepStrictEqual(r, [], "the Viktranium Assassinate option sits in the Accessory pool");
});

// ---- an augment colour is never reported as a worn slot (R4 / KTD2) ---------

test("#743: no route is keyed on an augment colour as if it were a gear slot", () => {
  const COLOURS = new Set(["Blue", "Colorless", "Green", "Moon", "Orange", "Purple", "Red", "Sun", "Yellow"]);
  for (const stat of ["Assassinate", "Concealment", "Sheltering"]) {
    const bad = routes(stat).filter((r) => COLOURS.has(r.slot));
    assert.deepStrictEqual(bad, [], `${stat} reported a colour as a slot: ${JSON.stringify(bad)}`);
  }
});

test("#743: every reported slot is a real worn slot", () => {
  const WORN = new Set(["Weapon", "Armor", "Off Hand", "Ring", "Gloves", "Trinket", "Cloak", "Goggles",
    "Bracers", "Necklace", "Belt", "Boots", "Helmet", "Quiver", "Main Hand", "Rune Arm"]);
  for (const r of routes("Assassinate")) assert.ok(WORN.has(r.slot), `not a worn slot: ${r.slot}`);
});

// ---- KTD5: a separate source pool must not be invisible ---------------------

test("#743: a dino-insert-only effect still returns a route", () => {
  // browse-visibility-for-separate-source-pools.md: 55 Dino inserts were once
  // invisible to a view that iterated items[] while the solver used them. An
  // items[]-only reachability scan is that defect again.
  const stats = new Set();
  for (const i of POOLS.dinoInserts) for (const a of (i.affixes || [])) stats.add(a.stat);
  const nativeNames = new Set();
  for (const x of dataset.items) for (const a of (x.affixes || [])) nativeNames.add(a.name);
  const only = [...stats].find((s) => !nativeNames.has(s));
  if (!only) return; // no such effect in this build; the guard below still holds
  assert.ok(routes(only).some((r) => r.route === "dino"),
    `${only} is carried only by a dino insert and returned no dino route`);
});

test("#743: at least one route is found in every crafting channel that carries one", () => {
  const seen = new Set();
  const probe = (list, get) => { for (const o of list) for (const s of get(o)) seen.add(s); };
  probe(POOLS.seal, (o) => (o.stat ? [o.stat] : []));
  const found = [...seen].some((s) => routes(s).some((r) => r.route === "seal"));
  assert.ok(found, "no seal route was ever produced, so the seal channel is unreachable");
});

// ---- shape and safety -------------------------------------------------------

test("#743: an effect nothing carries returns an empty route set, not a throw", () => {
  assert.deepStrictEqual(routes("Definitely Not A Real Affix Name"), []);
});

test("#743: one slot reachable at two bonus types reports both", () => {
  const gloves = at(routes("Assassinate"), "Gloves", "native");
  const types = new Set(gloves.flatMap((r) => r.bonusTypes));
  assert.ok(types.size >= 2, `expected Gloves to carry Assassinate at several types, got ${[...types]}`);
});

test("#743: routes carry no recommendation — data only, no prose", () => {
  for (const r of routes("Assassinate")) {
    assert.deepStrictEqual(Object.keys(r).sort(), ["bonusTypes", "route", "slot", "via"].sort());
    assert.ok(Array.isArray(r.bonusTypes));
  }
});


// ---- U2: "your filters closed this" vs "the catalog never had it" -----------
//
// R3. These are the two zero routes CONCEPTS.md already names, and the player can
// act on only one of them. The distinction is the whole reason the live pool is
// read twice: the unfiltered pass exists ONLY to classify, and its routes are
// never presented as available.

const report = (stat, query) => M.slotReachabilityReport(stat, dataset.items, query, POOLS);
const has = (list, slot, route) => list.some((r) => r.slot === slot && r.route === route);

test("#743 U2: at ML 34 the weapon augment route is open", () => {
  const r = report("Assassinate", { mlCap: 34, targets: ["Assassinate"] });
  assert.ok(has(r.open, "Weapon", "augment"), "Legendary Thirteen + Vol. 3 are both in range at 34");
});

test("#743 U2: at ML 30 the weapon augment route survives on the lower pair", () => {
  // Legendary Thirteen is ML 31 and Vol. 3 is ML 32, so both drop out — but
  // Thirteen (ML 16) and Vol. 1 (ML 18) still carry the route. The route stays
  // OPEN; only its value falls. A classifier keyed on the endgame pair alone
  // would wrongly report this closed.
  const r = report("Assassinate", { mlCap: 30, targets: ["Assassinate"] });
  assert.ok(has(r.open, "Weapon", "augment"), "Thirteen + Vol. 1 still reach it at ML 30");
});

test("#743 U2: below both Yellow augments the weapon route is FILTER-CLOSED, not absent", () => {
  const r = report("Assassinate", { mlCap: 10, targets: ["Assassinate"] });
  assert.ok(!has(r.open, "Weapon", "augment"), "no Yellow Assassinate augment is legal at ML 10");
  assert.ok(has(r.closedByFilters, "Weapon", "augment"),
    "the route exists in the catalog, so it must classify as closed by filters");
});

test("#743 U2: blocking the named weapons closes the NATIVE weapon route", () => {
  const named = dataset.items
    .filter((x) => x.slot === "Weapon" && (x.affixes || []).some((a) => a.name === "Assassinate"))
    .map((x) => x.variant_id || x.source_item);
  assert.ok(named.length, "expected named Assassinate weapons to block");
  const r = report("Assassinate", { mlCap: 34, targets: ["Assassinate"], blocklist: named });
  assert.ok(!has(r.open, "Weapon", "native"), "every native carrier was blocked");
  assert.ok(has(r.closedByFilters, "Weapon", "native"), "a block is a filter, so this is filter-closed");
});

test("#743 U2: the blocklist is honoured at all — the pool filter runs past eligible()", () => {
  // Guards the #721 shape directly: the blocklist lives in buildModel's chain,
  // DOWNSTREAM of eligible(). A reachability read that stopped at eligible()
  // would report a blocked item as reachable and quietly contradict the solve.
  const open = report("Assassinate", { mlCap: 34, targets: ["Assassinate"] }).open;
  const named = dataset.items
    .filter((x) => x.slot === "Weapon" && (x.affixes || []).some((a) => a.name === "Assassinate"))
    .map((x) => x.variant_id || x.source_item);
  const blockedOpen = report("Assassinate", { mlCap: 34, targets: ["Assassinate"], blocklist: named }).open;
  assert.ok(has(open, "Weapon", "native") && !has(blockedOpen, "Weapon", "native"),
    "blocking changed nothing, so the blocklist is not reaching this read");
});

test("#743 U2: an effect nothing carries is never-existed, not filter-closed", () => {
  const r = report("Definitely Not A Real Affix Name", { mlCap: 34 });
  assert.deepStrictEqual(r.open, []);
  assert.deepStrictEqual(r.closedByFilters, []);
  assert.strictEqual(r.anyCatalogRoute, false);
});

test("#743 U2: a route open under the query is not also reported as closed", () => {
  const r = report("Assassinate", { mlCap: 34, targets: ["Assassinate"] });
  for (const o of r.open) {
    assert.ok(!r.closedByFilters.some((c) => c.slot === o.slot && c.route === o.route && c.via === o.via),
      `${o.slot}/${o.route} appears in both lists`);
  }
});

test("#743 U2: the unfiltered pass never leaks into `open`", () => {
  // The safety property that makes the second pass legitimate: everything in
  // `open` must also be reachable under the query, or the disclosure would offer
  // the player a route their own settings removed.
  const q = { mlCap: 10, targets: ["Assassinate"] };
  const r = report("Assassinate", q);
  const live = M.slotReachabilityFor("Assassinate",
    M.filterEligiblePool(M.eligible(dataset.items, q), q).elig, POOLS);
  for (const o of r.open) {
    assert.ok(live.some((l) => l.slot === o.slot && l.route === o.route && l.via === o.via),
      `${o.slot}/${o.route} is in open but not in the live pool`);
  }
});


// ---- U3: wording. States facts, judges nothing (R7 / KTD6) ------------------

const lines = (stat, query) => Proj.slotReachabilityLines(stat, report(stat, query));
const joined = (stat, query) => lines(stat, query).join(" ");
const ML34 = { mlCap: 34, targets: ["Assassinate"] };

test("#743 U3: an augment route reads as an augment, never as a worn slot", () => {
  const t = joined("Assassinate", ML34);
  assert.ok(/Yellow augment/i.test(t), `expected the colour named as an augment: ${t}`);
  assert.ok(!/^\s*Yellow[,:]/m.test(t), "a colour must never head a slot list");
});

test("#743 U3: a crafting route names its channel", () => {
  const t = joined("Assassinate", ML34);
  assert.ok(/Viktranium|Dino insert/i.test(t), `expected a named channel: ${t}`);
});

test("#743 U3: never over-claims a bonus type for a slot that lacks it", () => {
  // Weapon carries Assassinate at Enhancement only. A line that unions types
  // across slots would offer the player Quality on a weapon, which is false.
  for (const l of lines("Assassinate", ML34)) {
    if (!/Weapon/.test(l)) continue;
    if (/Quality|Insight/.test(l)) {
      assert.fail(`a Weapon line claims a type no weapon carries: ${l}`);
    }
  }
});

test("#743 U3: no recommendation words — the line describes, it does not advise", () => {
  const BANNED = /\b(best|better|optimal|should|recommend|prefer|try|instead|worth|ideal|good choice)\b/i;
  for (const stat of ["Assassinate", "Concealment"]) {
    for (const l of lines(stat, { mlCap: 34, targets: [stat] })) {
      assert.ok(!BANNED.test(l), `recommendation language leaked in: ${l}`);
    }
  }
});

test("#743 U3: makes no interchangeability claim about affix names (#746 stays shut)", () => {
  const BANNED = /\b(same as|equivalent|interchangeable|any one of these|instead of)\b/i;
  for (const l of lines("Ghostly", { mlCap: 34, targets: ["Ghostly"] })) {
    assert.ok(!BANNED.test(l), `an equivalence claim leaked in: ${l}`);
  }
});

test("#743 U3: filter-closed is stated distinctly from never-existed (R3)", () => {
  const closed = joined("Assassinate", { mlCap: 10, targets: ["Assassinate"] });
  assert.ok(/filter/i.test(closed), `expected the filters to be named: ${closed}`);
  const never = joined("Definitely Not A Real Affix Name", ML34);
  assert.ok(never && !/filter/i.test(never), `never-existed must not blame filters: ${never}`);
});

test("#743 U3: withheld when there is nothing to say (R8)", () => {
  assert.deepStrictEqual(Proj.slotReachabilityLines("", null), []);
  assert.deepStrictEqual(Proj.slotReachabilityLines("Assassinate", null), []);
});

test("#743 U3: every slot named in a line is a real worn slot", () => {
  const WORN = ["Weapon", "Armor", "Off Hand", "Ring", "Gloves", "Trinket", "Cloak", "Goggles",
    "Bracers", "Necklace", "Belt", "Boots", "Helmet", "Quiver", "Main Hand", "Rune Arm"];
  const COLOURS = ["Blue", "Colorless", "Green", "Moon", "Orange", "Purple", "Red", "Sun", "Yellow"];
  for (const l of lines("Assassinate", ML34)) {
    for (const c of COLOURS) {
      // a colour may appear ONLY immediately before the word "augment"
      const bare = new RegExp(`\\b${c}\\b(?!\\s+augment)`);
      assert.ok(!bare.test(l), `bare colour "${c}" outside an augment label: ${l}`);
    }
  }
  assert.ok(WORN.length);
});


// ---- U4: the panel render ---------------------------------------------------
//
// NO BROWSER PASS WAS AVAILABLE when this shipped, so these assert the markup and
// the source seams in node, and nothing here claims a visual check was done.

const WSRC = fs.readFileSync(path.join(__dirname, "..", "web", "wizard.js"), "utf8");
const CSS = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf8");

/** Slice between two markers, anchoring the close to the open (tests/wizard.test.js
 *  keeps the same helper, and for the same reason: the unanchored form silently
 *  returns "" when the closing marker also appears earlier in the file). */
function between(src, open, close, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `${label}: opening marker not found — ${open}`);
  const b = src.indexOf(close, a);
  assert.ok(b >= a, `${label}: closing marker not found after the opening — ${close}`);
  return src.slice(a, b);
}

test("#743 U4: the hint renders its lines, one element each", () => {
  const h = W.reachHintHTML("Assassinate",
    ["Native, Enhancement: Weapon.", "Closed by your current filters: Boots (Native)."]);
  assert.ok(/wz-adv-reach/.test(h));
  assert.strictEqual((h.match(/wz-adv-reach-row/g) || []).length, 2);
});

test("#743 U4: withheld entirely when there is nothing to say (R8)", () => {
  assert.strictEqual(W.reachHintHTML("Assassinate", []), "");
  assert.strictEqual(W.reachHintHTML("Assassinate", null), "");
  assert.strictEqual(W.reachHintHTML("", ["anything"]), "");
});

test("#743 U4: the stat name and the lines are escaped", () => {
  const h = W.reachHintHTML("Ass<i>x", ["<script>alert(1)</script>"]);
  assert.ok(!/<i>/.test(h), "unescaped markup leaked from the stat name");
  assert.ok(!/<script>/.test(h), "unescaped markup leaked from a line");
  assert.ok(/&lt;script&gt;/.test(h));
});

test("#743 U4: the hint is read-only — no input, no control", () => {
  const h = W.reachHintHTML("Assassinate", ["Native, Enhancement: Weapon."]);
  assert.ok(!/<input|<button|<select|contenteditable/i.test(h),
    "a disclosure must not look editable; nothing here is ever written to a bound");
});

test("#743 U4: the slot sits INSIDE .wz-adv-body (which keeps #744 step 2 clear)", () => {
  const panel = between(WSRC, "function advancedHTML(", "function bonusTypesHTML(", "advancedHTML");
  const body = panel.indexOf("wz-adv-body");
  const slot = panel.indexOf("reachPlaceholderHTML(stat)");
  // #744 step 2 — the panel closes with a plain </div> now: it was a <details>
  // and is a grid-placed sibling div. The invariant is unchanged — the slot must
  // render inside the panel BODY, which is what moves as a unit.
  const close = panel.indexOf("</div></div>");
  assert.ok(body >= 0, "the panel body marker is present");
  assert.ok(slot > body && close > slot,
    "the placeholder must render between the .wz-adv-body opening and the panel close");
});

test("#743 U4: it renders EMPTY and is filled on open, never eagerly", () => {
  // The performance contract, and it is load-bearing: resolving every row eagerly
  // cost ~129ms for twelve priorities, and renderRankedList rebuilds on every drag.
  const ph = between(WSRC, "function reachPlaceholderHTML(", "function fillReachability(", "placeholder");
  assert.ok(/data-reach-slot=/.test(ph), "the placeholder carries its stat");
  assert.ok(!/slotReachability/.test(ph), "the placeholder must not resolve reachability at render time");
  assert.ok(/\.wz-adv-panel:not\(\[hidden\]\)/.test(WSRC), "the fill only touches OPEN panels");
});

test("#743 U4: a panel restored open is filled too, not left blank", () => {
  // #744 step 2 — <details> reported its own state through `ontoggle`; a button
  // does not, so the click handler owns the transition and `open` is computed
  // there. Same two fills, same order, different write point.
  const bind = between(WSRC, "t.onclick = () =>", "// D1 ", "toggle binding");
  assert.ok(/if \(open\) fillReachability/.test(bind), "opening a panel fills it");
  assert.ok(/fillReachability\(ol\);/.test(bind), "a render also fills already-open panels");
});

test("#743 U4: the fill cannot take the priorities step down", () => {
  const fill = between(WSRC, "function fillReachability(", "function advancedHTML(", "fillReachability");
  assert.ok(/try \{/.test(fill) && /catch/.test(fill),
    "a disclosure must fail silent-and-empty, never throw into the priorities step");
});

test("#743 U4: the CSS gives the slot a full line inside the wrapping flex body", () => {
  assert.ok(/\.wz-adv-reach-slot\s*\{[^}]*flex-basis:\s*100%/.test(CSS),
    "an auto-width block in .wz-adv-body renders as a narrow column");
});


// ---- #753: the one-line form, at the moment of the ADD -----------------------
//
// #743 answers "where can this come from" in a panel the player must open. This
// is the same answer, compressed, arriving without them opening anything.
//
// The issue's own framing was wrong and these tests encode the corrected one: it
// claimed the panel arrives "one step later than the moment the question occurs"
// because the panel needs a RANKED row. Adding IS ranking — `addPriority` appends
// to `state.priorities` — so the row exists immediately. The real gap is that the
// disclosure needed a click nothing advertised, which is #747's failure mode.

test("#753: a narrowly-carried effect NAMES its slots, a widely-carried one counts", () => {
  // The split is the whole value, not a length trim: thirteen slot names tell a
  // player nothing they will read, and "Weapon only" is the case the reporter was
  // actually in — they wanted an effect in a slot that can never supply it.
  const narrow = { open: [{ slot: "Weapon", route: "native", bonusTypes: ["Enhancement"] }],
                   closedByFilters: [], anyCatalogRoute: true };
  assert.strictEqual(Proj.slotReachabilitySummary("Acid", narrow),
    "Acid can come from Weapon only.");
  const two = { open: [{ slot: "Off Hand", route: "native", bonusTypes: ["Bool"] },
                       { slot: "Weapon", route: "native", bonusTypes: ["Bool"] }],
                closedByFilters: [], anyCatalogRoute: true };
  assert.strictEqual(Proj.slotReachabilitySummary("Vorpal", two),
    "Vorpal can come from Off Hand and Weapon only.");
  // Over the limit: a count, plus the pointer to where the routes actually are.
  const wide = { open: "Armor Belt Boots Bracers Cloak".split(" ")
                   .map((slot) => ({ slot, route: "native", bonusTypes: ["Enhancement"] })),
                 closedByFilters: [], anyCatalogRoute: true };
  assert.strictEqual(Proj.slotReachabilitySummary("Constitution", wide),
    "Constitution can come from 5 slots. Open Advanced on its row for the routes.");
});

test("#753: only slots with NO open route count as closed", () => {
  // The same narrowing the full form applies, and for the same reason: a slot the
  // player can already reach another way is answered, so naming a second shut
  // route to it adds a sentence and no decision. Weapon is open natively here, so
  // its shut augment route must NOT be counted.
  const rep = { open: [{ slot: "Weapon", route: "native", bonusTypes: ["Enhancement"] }],
                closedByFilters: [{ slot: "Weapon", route: "augment", via: "Yellow", bonusTypes: ["Enhancement"] },
                                  { slot: "Boots", route: "native", bonusTypes: ["Enhancement"] }],
                anyCatalogRoute: true };
  assert.strictEqual(Proj.slotReachabilitySummary("Acid", rep),
    "Acid can come from Weapon only. Your filters closed 1 other. Open Advanced on its row for the routes.");
});

test("#753: every route shut, and never-existed, are DIFFERENT sentences", () => {
  // #743's founding discipline: blaming a gate that was never shut sends the
  // player hunting for a setting to change, so the never-existed case must not
  // mention filters. That distinction is the one most easily lost in a rewording.
  const allShut = { open: [], closedByFilters: [{ slot: "Weapon", route: "native", bonusTypes: ["Enhancement"] }],
                    anyCatalogRoute: true };
  const s = Proj.slotReachabilitySummary("Acid", allShut);
  assert.ok(/filters closed every route/.test(s), "a shut-out effect blames the filters");
  const never = { open: [], closedByFilters: [], anyCatalogRoute: false };
  const n = Proj.slotReachabilitySummary("Nonesuch", never);
  assert.ok(!/filter/i.test(n), "never-existed must NOT mention filters");
  assert.strictEqual(n, "No item, augment or crafting option in the catalog carries Nonesuch.");
  // Verbatim the full form's sentence for the same fact — two wordings would drift.
  assert.ok(Proj.slotReachabilityLines("Nonesuch", never).includes(n),
    "the never-existed sentence is shared with the full form, not re-written");
});

test("#753: withheld entirely when there is nothing to say", () => {
  assert.strictEqual(Proj.slotReachabilitySummary("X", { open: [], closedByFilters: [], anyCatalogRoute: true }), "");
  assert.strictEqual(Proj.slotReachabilitySummary(null, null), "");
  assert.strictEqual(Proj.slotReachabilitySummary("", { open: [] }), "");
});

test("#753: the summary stays DESCRIPTIVE — it ranks nothing and proposes no pick", () => {
  // Same line held on the full form and on #747's notice. A summary is where this
  // erodes first, because compressing invites a verb.
  const rep = { open: [{ slot: "Weapon", route: "native", bonusTypes: ["Enhancement"] },
                       { slot: "Off Hand", route: "augment", via: "Yellow", bonusTypes: ["Enhancement"] }],
                closedByFilters: [], anyCatalogRoute: true };
  const s = Proj.slotReachabilitySummary("Acid", rep);
  assert.ok(!/\b(best|better|should|recommend|instead|prefer|optimal|try)\b/i.test(s),
    `the summary must not advise: ${s}`);
});

test("#753: the fill is async, token-guarded, and cannot throw into the add path", () => {
  // Three quick adds start three ~65ms reports. Without the token the line ends up
  // describing whichever FINISHED last rather than the stat last added, and that
  // is invisible in any single-add test.
  const fn = between(WSRC, "function fillPickerReach(", "function addPriority(", "fillPickerReach");
  assert.ok(/yieldToPaint\(\)/.test(fn), "the report is computed off the paint path");
  assert.ok(/const seq = \+\+_reachSeq/.test(fn), "each fill takes a sequence token");
  assert.ok(/seq !== _reachSeq/.test(fn), "and a superseded fill declines to write");
  assert.ok(/try \{/.test(fn) && /catch/.test(fn),
    "a disclosure must fail silent-and-empty, never throw into the add path");
  // The element is re-read after the await: the list re-renders between the add
  // and the write, and on the Adjust panel that rebuild replaces the node.
  assert.ok(/const now = pickerReachEl\(\)/.test(fn), "the element is re-read after the yield");
});

test("#753: the reach line is its OWN element, not an append to the status line", () => {
  // #753 asked for exactly this, in those words. `.wz-status` is
  // `color: var(--quarantined)` and everything it carries is a warning, a refusal
  // or a substitution; reachability is a plain description and must not read as a
  // problem. It also needs aria-live, which the status line does not carry.
  assert.ok(/id="wz-reach" class="wz-reach-note"/.test(WSRC), "the priorities step hosts a reach line");
  assert.ok(/id="wz-radd-reach" class="wz-reach-note"/.test(WSRC), "and so does the Adjust panel");
  assert.ok(/wz-reach-note[^>]*aria-live="polite"/.test(WSRC),
    "a line filled a frame after the add needs aria-live or a screen reader never hears it");
  const add = between(WSRC, "function addPriority(", "// ---- solve (real engine)", "addPriority");
  assert.ok(/fillPickerReach\(/.test(add), "the add path fills it");
  assert.ok(!/status\.textContent = \[res\.companionHint, res\.familyHint, /.test(add),
    "and does NOT append reachability onto the status line");
  const css = between(CSS, ".wz-reach-note {", "}", "reach-note rule");
  assert.ok(!/--quarantined/.test(css), "the reach line is not tinted as a warning");
});

test("#753: a refused add clears the line, and a multi-name expansion reports nothing", () => {
  // A stale line after a refusal reads as a statement about the name just
  // refused. An alias that expands into several adds them all, and describing one
  // of those would be arbitrary.
  const add = between(WSRC, "function addPriority(", "// ---- solve (real engine)", "addPriority");
  assert.ok(/if \(status && res\.message != null\) status\.textContent = res\.message;\s*\n[\s\S]{0,220}?fillPickerReach\(null\);/.test(add),
    "the refusal path clears the reach line");
  assert.ok(/landed\.length === 1 && landed\[0\] !== _utilitySentinel \? landed\[0\] : null/.test(add),
    "exactly one landed name is described; an expansion or the Utility tier is not");
});

test("#766: a Slaver's host's typed slots are a route, keyed by the host's own (slot, tier)", () => {
  const belt = at(routes("Charisma"), "Belt", "slavers");
  assert.strictEqual(belt.length, 1, "Belt reaches Charisma through Slaver's crafting (Chains / Legendary Chains)");
  assert.ok(belt[0].bonusTypes.includes("Enhancement") && belt[0].bonusTypes.includes("Quality"),
    "Prefix (Enhancement) and Bonus (Quality) both supply it");
  assert.strictEqual(at(routes("Charisma"), "Helmet", "slavers").length, 0,
    "a Set Bonus carrier with no typed slot is not a route");
  assert.strictEqual(at(routes("Will Save"), "Boots", "slavers").length, 1,
    "Shackles reach a save through the Suffix Resistance umbrella, expanded inside the option");
});

console.log(`\n${passed} passed`);
