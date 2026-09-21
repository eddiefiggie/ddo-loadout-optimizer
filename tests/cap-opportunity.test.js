// #747 — the cap-opportunity notice. Run: node tests/cap-opportunity.test.js
//
// The MIRROR of tests/cap-surplus.test.js, and it inherits that file's correctness
// story. `docs/solutions/design-patterns/redundancy-under-a-shared-cap-must-be-
// judged-set-consistently.md` records the same judgment going wrong twice in one
// day at two aggregation levels: contributors each individually slack against the
// intact total can be jointly necessary. The sentence this notice prints is
// therefore purely DESCRIPTIVE — a total, a pick count, the largest contribution,
// and the sum of the rest — and never says a pick is droppable or what removing
// one would cost. Several tests below exist only to hold that line.
const assert = require("assert");
const P = require("../web/projection.js");

const { test } = require("./_harness");

const part = (source, value, bonus_type = "Enhancement") =>
  ({ source, sourceKind: "worn", bonus_type, value, slot: "Ring" });

/** A record with one uncapped ranked stat fed by `parts`. `shown` defaults to the
 *  sum, which is the shape the notice requires; pass it explicitly to break the
 *  arithmetic on purpose. */
function rec(parts, { stat = "Physical Sheltering", shown = null, capped = {}, targets = null } = {}) {
  const sum = parts.reduce((n, p) => n + p.value, 0);
  const t = targets || [stat];
  return {
    query: { targets: t },
    snapshot: {
      status: "optimal", chosen: [], setsActive: [], query: { targets: t },
      effective: { [stat]: shown == null ? sum : shown },
      capped, intrinsicCaps: {},
      breakdown: { [stat]: parts },
    },
  };
}

// ---- it fires, and says the right things ----------------------------------

test("#747: an uncapped stat spread across picks names the total, the top and the tail", () => {
  const lines = P.capOpportunityLines(rec([part("Boots", 41), part("Bracers", 45),
                                           part("Shield", 31), part("Ring", 13)]));
  assert.strictEqual(lines.length, 1);
  const l = lines[0];
  assert.ok(/reached 130/.test(l), "quotes the displayed total");
  assert.ok(/across 4 picks/.test(l), "quotes the pick count");
  assert.ok(/45 from Bracers/.test(l), "names the largest contribution and its source");
  assert.ok(/85 from the other 3/.test(l), "and the tail as ONE number over the set");
  assert.ok(/Max cap/.test(l), "names the control that answers it");
});

test("#747: the sentence never claims a pick is droppable", () => {
  // The load-bearing assertion, and the reason this notice is descriptive. A
  // per-pick verdict under a shared threshold is unsound whenever contributors are
  // jointly-but-not-individually load-bearing, which is exactly the shape here.
  const l = P.capOpportunityLines(rec([part("A", 41), part("B", 45), part("C", 31)]))[0];
  assert.ok(/Nothing here says any one pick is droppable/.test(l),
    "it says so outright, because a reader will otherwise infer it");
  assert.ok(!/\bdrop this\b|\bremove this\b|\bwasted\b|buys? (?:you )?(?:only|just)\b/i.test(l),
    "and never phrases a contribution as dispensable");
});

test("#747: it proposes no cap VALUE, only the control", () => {
  // Naming a number would be prescribing the trade — and the right number depends
  // on the player's build, which this tool does not know.
  const l = P.capOpportunityLines(rec([part("A", 41), part("B", 45), part("C", 31)]))[0];
  assert.ok(/If a lower number is enough/.test(l), "it defers the number to the player");
  assert.ok(!/set a Max cap (?:of|at) \d/.test(l), "it never proposes a value");
});

// ---- when it must stay silent ---------------------------------------------

test("#747: silent below the pick threshold — two picks is not a slot problem", () => {
  assert.deepStrictEqual(P.capOpportunityLines(rec([part("A", 41), part("B", 45)])), [],
    "two picks says nothing worth reading");
  assert.strictEqual(P.CAP_OPPORTUNITY_MIN_PICKS, 3, "the threshold is pinned, not incidental");
});

test("#747: silent on a stat the player has already capped", () => {
  // That is capSurplusLines' subject. Printing both would tell the player their cap
  // is wasting gear AND that they should set a cap, about the same stat.
  const r = rec([part("A", 41), part("B", 45), part("C", 31)],
    { capped: { "Physical Sheltering": 40 } });
  assert.deepStrictEqual(P.capOpportunityLines(r), []);
});

test("#747: silent when one pick carries the whole total", () => {
  // A cap frees no slot here: there is no tail to give up.
  const r = rec([part("A", 50), part("B", 0), part("C", 0)]);
  assert.deepStrictEqual(P.capOpportunityLines(r), []);
});

test("#747: withheld when the credited parts do not account for the total", () => {
  // The additivity guard. The sentence quotes a total and a tail, so its arithmetic
  // has to hold on screen; a shape where it does not is a shape this has not seen,
  // and silence beats printing a sum the player can see is wrong.
  const r = rec([part("A", 41), part("B", 45), part("C", 31)], { shown: 200 });
  assert.deepStrictEqual(P.capOpportunityLines(r), [],
    "a mismatch withholds the line rather than quoting bad arithmetic");
});

test("#747: an unranked stat is not inspected, however it was fed", () => {
  const r = rec([part("A", 41), part("B", 45), part("C", 31)], { targets: ["Doublestrike"] });
  assert.deepStrictEqual(P.capOpportunityLines(r), []);
});

// ---- fail-open, like every sibling in this module --------------------------

test("#747: a partial or hand-edited record returns [], never throws", () => {
  for (const bad of [null, undefined, {}, { query: {} }, { snapshot: {} },
                     { query: { targets: ["X"] }, snapshot: { chosen: null } }]) {
    assert.deepStrictEqual(P.capOpportunityLines(bad), [], `threw or spoke on ${JSON.stringify(bad)}`);
  }
});

// ---- the multi-stat shape --------------------------------------------------

test("#747: worst first, capped at three lines, with the rest named once", () => {
  const stats = ["S1", "S2", "S3", "S4"];
  const snapshot = {
    status: "optimal", chosen: [], setsActive: [], query: { targets: stats },
    effective: {}, capped: {}, intrinsicCaps: {}, breakdown: {},
  };
  // Descending pick counts so the ordering assertion has something to order.
  const counts = { S1: 6, S2: 5, S3: 4, S4: 3 };
  for (const s of stats) {
    const parts = [];
    for (let i = 0; i < counts[s]; i++) parts.push(part(`${s}-${i}`, 10 + i));
    snapshot.breakdown[s] = parts;
    snapshot.effective[s] = parts.reduce((n, p) => n + p.value, 0);
  }
  const lines = P.capOpportunityLines({ query: { targets: stats }, snapshot });
  assert.strictEqual(lines.length, 4, "three stat lines plus the roll-up");
  assert.ok(lines[0].startsWith("S1 reached"), "the stat spending the most picks leads");
  assert.ok(lines[1].startsWith("S2 reached"));
  assert.ok(lines[2].startsWith("S3 reached"));
  assert.ok(/The same is true of S4\./.test(lines[3]),
    "the overflow is named once rather than repeating the whole sentence");
});

