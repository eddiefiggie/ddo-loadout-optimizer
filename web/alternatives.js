// U3 — trade-off analysis, dedupe, and ranking for alternative loadouts. Pure data
// (no DOM); the card rendering lives in results.js (U4). Consumes the raw candidates
// from solver.js generateAlternatives.

// #321 — counts the seven grindable craft families, in lockstep with the
// craftVars/optCrafts/solCrafts sites in solver.js generateAlternatives. Roll
// groups and set-membership picks are excluded as intended (see the comment there).
function craftCount(sol) {
  return (sol.augmentsPlaced || []).length + (sol.dinoPlaced || []).length
    + (sol.ncPlaced || []).length + (sol.vikPlaced || []).length + (sol.sealPlaced || []).length
    + (sol.tfPlaced || []).length + (sol.gsPlaced || []).length;
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { analyzeAlternative, rankAlternatives, craftCount, buildKey };
}
