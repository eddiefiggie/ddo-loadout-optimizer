// U3 — trade-off analysis, dedupe, and ranking for alternative loadouts. Pure data
// (no DOM); the card rendering lives in results.js (U4). Consumes the raw candidates
// from solver.js generateAlternatives.

// #321 — counts the seven grindable craft families, in lockstep with the
// craftVars/optCrafts/solCrafts sites in solver.js generateAlternatives. Roll
// groups and set-membership picks are excluded as intended (see the comment there).
function craftCount(sol) {
  return (sol.augmentsPlaced || []).length + (sol.dinoPlaced || []).length
    + (sol.ncPlaced || []).length + (sol.vikPlaced || []).length + (sol.sealPlaced || []).length
    + (sol.lgsPlaced || []).length;
}

function buildKey(sol) {
  return sol.chosen.map((c) => `${c.slot}:${c.variant.variant_id}`).sort().join("|");
}

/** Cost/benefit + gain tags for one candidate vs the optimum. A candidate may earn
 *  several tags (R8): its generator's axis, plus any derivable extra (a newly active
 *  set, fewer crafts, a rebalanced priority). Returns the candidate enriched with
 *  { cost, gains, tags, gainText, costText, key }. */
function analyzeAlternative(optimum, candidate, query) {
  const { sol, gainAxis, meta } = candidate;
  const targets = query.targets || [];
  const deltas = targets.map((s) => ({ stat: s, delta: (sol.effective[s] ?? 0) - (optimum.effective[s] ?? 0) }));
  const cost = deltas.filter((d) => d.delta < 0);
  const gains = deltas.filter((d) => d.delta > 0);
  // #91 review fix — utility loss joins the cost accounting whenever the tier
  // is ranked (results carry a utilityReport exactly then, both counts read
  // from the guarded z-backed report): a trade that sheds counted effects must
  // state that loss and can never claim "no priority cost". A positive delta
  // keeps its existing path (the utility family's gain tag/text below).
  // #348 (U4, R16/R17) — the tier is a COST here and nothing else; its gain axis is
  // deleted. A shed effect is named, never counted: "-2 utility effects" tells a
  // player who curated an ordered container nothing they can act on, while "gives up
  // Blunt Trauma" tells them exactly what the trade takes. Ordered by the optimum's
  // container order so the loss reads the way the player arranged it.
  const optEffectNames = ((optimum.utilityReport && optimum.utilityReport.effects) || []).map((e) => e.name);
  const solEffectNames = new Set(((sol.utilityReport && sol.utilityReport.effects) || []).map((e) => e.name));
  const optOrder = (optimum.utilityOrdered && optimum.utilityOrdered.secured) || optEffectNames;
  const shedEffects = optOrder.filter((n) => optEffectNames.includes(n) && !solEffectNames.has(n));
  const utilDelta = (sol.utilityReport || optimum.utilityReport) ? -shedEffects.length : 0;

  const tags = [];
  const addTag = (t) => { if (!tags.includes(t)) tags.push(t); };
  // primary tag from the generator
  if (gainAxis === "set") addTag("set bonus");
  if (gainAxis === "rebalance") addTag("rebalance");
  // #481 — a concession is a rebalance told from the other end: the player names
  // the priority they will give ground on, and the solve says what that buys.
  if (gainAxis === "concession") addTag("concession");
  if (gainAxis === "unranked") addTag(meta.zeroCost ? "free upgrade" : "unranked stat");
  if (gainAxis === "crafts") addTag("cheaper crafting");
  // derivable extra tags — only meaningful secondary gains, so a build does not pick up
  // a spurious "cheaper crafting" from a one-step difference or a "rebalance" from an
  // incidental point on another priority (every different build shuffles these a little).
  const optSets = new Set((optimum.setsActive || []).map((s) => s.set));
  const newSets = (sol.setsActive || []).filter((s) => !optSets.has(s.set)).map((s) => s.set);
  if (newSets.length) addTag("set bonus");
  if (gainAxis !== "crafts" && craftCount(optimum) - craftCount(sol) >= 2) addTag("cheaper crafting");

  // headline gain text
  let gainText;
  if (gainAxis === "set") gainText = `activates ${meta.set}`;
  else if (gainAxis === "rebalance") { const g = gains.find((x) => x.stat === meta.to) || gains[0]; gainText = g ? `+${g.delta} ${g.stat}` : `shifts toward ${meta.to}`; }
  // #481 — the headline is the biggest thing this buys; what it costs is already a
  // row in the cost section, losses beneath the conceded stat included (KTD3), so
  // the headline must not try to carry both halves of the trade.
  else if (gainAxis === "concession") {
    const g = gains.slice().sort((a, b) => b.delta - a.delta)[0];
    gainText = g ? `+${g.delta} ${g.stat}` : `${meta.stat} capped at ${meta.cap}`;
  }
  else if (gainAxis === "unranked") gainText = `${meta.zeroCost ? "free " : ""}+${meta.stat}`;
  else gainText = `${meta.optCrafts - craftCount(sol)} fewer crafting steps`;

  // Sets this candidate newly activates vs the optimum (U7): the render layer
  // expands these to their granted affixes so an alternative names the concrete
  // bonuses it adds, not just the set. Include the generator's own set for a set gain.
  const activatedSets = [...new Set([
    ...(gainAxis === "set" && meta.set ? [meta.set] : []),
    ...newSets,
  ])];

  // #91 review fix — a negative utility delta is a cost like any stat cost:
  // it joins costText and its magnitude joins totalCost (rankAlternatives
  // sorts on totalCost, so a shedding trade ranks behind a lossless one).
  const costParts = cost.map((c) => `${c.delta} ${c.stat}`);
  if (shedEffects.length) costParts.push(`gives up ${shedEffects.join(", ")}`);
  const costText = costParts.length ? costParts.join(", ") : "no priority cost";
  const gainMag = gainAxis === "set" ? (newSets.length ? 1 : 0.5)
    : (gainAxis === "rebalance" || gainAxis === "concession") ? gains.reduce((s, g) => s + g.delta, 0)
    : gainAxis === "unranked" ? 1
    : (meta.optCrafts - craftCount(sol));
  const totalCost = cost.reduce((s, c) => s - c.delta, 0) + (utilDelta < 0 ? -utilDelta : 0);
  // #481 (KTD5) — a concession candidate carries its own minimum distinctness.
  // `rankAlternatives` drops anything within K=2 differing slots on the reasoning
  // that a near-identical build is not a distinct option; that reasoning INVERTS
  // here, because a small concession that swaps a single item is the most valuable
  // thing the probe can find. Threaded per-candidate rather than by loosening the
  // shared K, which would let every other family through too.
  const minDistinct = gainAxis === "concession" ? 1 : null;
  return { ...candidate, cost, gains, tags, gainText, costText, gainMag, activatedSets,
    utilDelta, shedEffects, totalCost, minDistinct, key: buildKey(sol) };
}

/** Dedupe (by chosen-item set), drop candidates within K different slots of the optimum
 *  or of a kept alternative (KTD4), then rank per gain type and interleave by a fixed
 *  type order (KTD7, KTD9). Deterministic total order. `opts`: { n=5, k=2 }. */
function rankAlternatives(analyzed, optimum, opts = {}) {
  const N = opts.n ?? 5, K = opts.k ?? 2;
  const optKey = buildKey(optimum);
  const optSlots = new Set(optimum.chosen.map((c) => `${c.slot}:${c.variant.variant_id}`));
  const slotsOf = (sol) => new Set(sol.chosen.map((c) => `${c.slot}:${c.variant.variant_id}`));
  const distinctCount = (a, bSlots) => { let d = 0; for (const s of slotsOf(a.sol)) if (!bSlots.has(s)) d++; return d; };

  const seen = new Set(), kept = [];
  for (const a of analyzed) {
    if (a.key === optKey || seen.has(a.key)) continue;
    const k = a.minDistinct != null ? a.minDistinct : K;                // #481 (KTD5)
    if (distinctCount(a, optSlots) < k) continue;                       // too close to the optimum
    if (kept.some((b) => distinctCount(a, slotsOf(b.sol)) < k)) continue; // too close to a kept alt
    seen.add(a.key); kept.push(a);
  }

  // #348 (U4, KTD7) — the `utility` axis is gone: the tier is never a gain, only a
  // named cost, so it has no slot in this order.
  // #481 — `concession` sits beside `rebalance`: they are the same kind of trade
  // told from opposite ends, and separating them would scatter two descriptions of
  // one move across the list.
  const typeOrder = { set: 0, rebalance: 1, concession: 2, unranked: 3, crafts: 4 };
  kept.sort((a, b) =>
    (typeOrder[a.gainAxis] - typeOrder[b.gainAxis])
    || (b.gainMag - a.gainMag)
    || (a.totalCost - b.totalCost)
    || a.key.localeCompare(b.key));
  return kept.slice(0, N);
}


// ---------------------------------------------------------------------------
// #499 — THE BAR: what counts as an upgrade worth putting in front of a player.
//
// The Alternatives tab this replaced generated candidates on five axes and
// showed the best five, whatever they cost. That produced the suggestion that
// killed trust in the whole feature: **+1 of a low-ranked affix at a cost of 5
// or more points of a higher-ranked one**. Under strict lexicographic priority
// nobody who ranked those stats would take that trade, so offering it is not a
// generous extra — it is the tool contradicting its own core promise.
//
// A candidate must now clear TWO independent tests. Neither alone is enough:
//
//   * PROPORTIONAL — the loss on any ranked priority as a percentage of that
//     priority's current total. Points are not comparable across stats: 5 Melee
//     Power out of 300 and 5 Constitution out of 60 are not the same size of
//     loss, and nothing in the solve knows which stats are "big". A percentage
//     self-scales without needing per-stat knowledge we do not have.
//
//   * RANK-WEIGHTED — a point lost on priority 1 counts for far more than a
//     point gained on priority 5. This is the lexicographic ordering the player
//     gave us, applied to the trade rather than to the solve.
//
// Each covers the other's blind spot. The proportional test alone waves through
// a large absolute loss sitting on a large total; the rank-weighted test alone
// waves through a proportionally huge loss on a small one. The failure case
// above is rejected by EITHER, which is why it can never come back.
//
// The default is `DEFAULT_LOSS_PCT = 0` — free upgrades only. Out of the box a
// candidate must cost nothing at all: no ranked priority loses a point and no
// utility effect is shed. Open augment slots, set completions, cheaper crafting
// and unranked-stat gains all still qualify, because none of them takes
// anything away. The player raises the bar deliberately when they want to see
// trades, and the concession probe (#481) remains available at any bar for the
// one trade they ask about by name.

// Weight base per rank step. 3 means a point on priority 1 is worth 3 points on
// priority 2, 9 on priority 3, and so on. Not a tunable: it encodes the SHAPE of
// lexicographic priority (each rank dominates the next), and a player who wants
// a different shape wants a different priority order, which they already have.
const RANK_BASE = 3;
// Rank-weighted gain must be at least this multiple of rank-weighted loss.
const MIN_GAIN_RATIO = 3;
// Ships free-only. See the block comment above.
const DEFAULT_LOSS_PCT = 0;

/** Rank weight per target stat: first priority heaviest, descending by
 *  RANK_BASE. A stat absent from `targets` weighs 1 — it is unranked, so a
 *  point of it is worth the least a point can be worth, never zero (a gain on
 *  an unranked stat is still a gain, which is the whole `unranked` axis). */
function rankWeights(targets) {
  const list = targets || [];
  const n = list.length;
  const w = new Map();
  list.forEach((stat, i) => w.set(stat, Math.pow(RANK_BASE, n - 1 - i)));
  return { weight: (stat) => w.get(stat) ?? 1 };
}

/** Judge ONE analyzed candidate against the bar.
 *
 *  Returns `{ free, passes, lossPct, ratio }`, all four always present so a
 *  caller can explain a rejection rather than merely drop it.
 *
 *  `lossPct` measures against the OPTIMUM's total for the stat, floored at 1 so
 *  a priority the build scores zero on cannot divide by zero. A stat sitting at
 *  0 that loses points is a nonsense trade anyway, and the floor makes it read
 *  as a huge percentage rather than as `Infinity` or `NaN`.
 *
 *  A shed utility effect counts as a loss on the utility tier, weighted at the
 *  tier's own rank. It is deliberately NOT free: `#348` settled that the tier is
 *  a cost and never a gain, and a "free upgrade" that quietly drops Ghostly is
 *  the exact kind of hidden price this bar exists to stop.
 *
 *  GAIN IS MEASURED ON RANKED PRIORITIES ONLY, and that has a consequence worth
 *  stating outright: a candidate whose gain lies outside the ranked list — the
 *  `unranked` axis, or a set whose affixes touch nothing the player asked for —
 *  scores a weighted gain of zero, so it can pass ONLY by being free. That is
 *  the intended reading, not an oversight. Paying a ranked priority to buy a
 *  stat the player did not rank is the same trade as the one that started this,
 *  one rung further down: they told us what they wanted, and an unranked stat is
 *  by definition not it. Such a candidate is welcome when it costs nothing, and
 *  refused the moment it costs something. */
function tradeVerdict(cand, optimum, query, opts) {
  const targets = (query && query.targets) || [];
  const { weight } = rankWeights(targets);
  const barPct = Math.max(0, Number((opts && opts.lossPct) ?? DEFAULT_LOSS_PCT) || 0);
  const eff = optimum.effective || {};

  const cost = cand.cost || [];
  const shed = cand.shedEffects || [];
  const free = cost.length === 0 && shed.length === 0;

  let lossPct = 0, weightedLoss = 0;
  for (const c of cost) {
    const mag = Math.abs(c.delta);
    lossPct = Math.max(lossPct, (mag / Math.max(1, Number(eff[c.stat]) || 0)) * 100);
    weightedLoss += mag * weight(c.stat);
  }
  if (shed.length) {
    // The tier has no numeric total to take a percentage of, so a shed effect is
    // scored as a whole-unit loss on its own rank. `utilitySentinel` is threaded
    // in by the caller because only it knows the sentinel's spelling.
    const sentinel = opts && opts.utilitySentinel;
    lossPct = Math.max(lossPct, 100);          // losing an effect is losing all of it
    weightedLoss += shed.length * (sentinel ? weight(sentinel) : 1);
  }

  let weightedGain = 0;
  for (const g of cand.gains || []) weightedGain += Math.abs(g.delta) * weight(g.stat);

  const ratio = weightedLoss === 0 ? Infinity : weightedGain / weightedLoss;
  const passes = free || (lossPct <= barPct && ratio >= MIN_GAIN_RATIO);
  return { free, passes, lossPct, ratio };
}

/** Every candidate that clears the bar, each carrying its `verdict`. Order is
 *  the caller's; `rankAlternatives` has already imposed one. */
function filterUpgrades(analyzed, optimum, query, opts) {
  return (analyzed || [])
    .map((c) => Object.assign({}, c, { verdict: tradeVerdict(c, optimum, query, opts) }))
    .filter((c) => c.verdict.passes);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { analyzeAlternative, rankAlternatives, craftCount, buildKey,
    rankWeights, tradeVerdict, filterUpgrades, RANK_BASE, MIN_GAIN_RATIO, DEFAULT_LOSS_PCT };
}
