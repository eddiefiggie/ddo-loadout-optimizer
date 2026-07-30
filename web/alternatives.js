// U3 — trade-off analysis, dedupe, and ranking for alternative loadouts. Pure data
// (no DOM); the card rendering lives in results.js (U4). Consumes the raw candidates
// from solver.js generateAlternatives.

function craftCount(sol) {
  return (sol.augmentsPlaced || []).length + (sol.dinoPlaced || []).length
    + (sol.ncPlaced || []).length + (sol.vikPlaced || []).length + (sol.sealPlaced || []).length;
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

  const tags = [];
  const addTag = (t) => { if (!tags.includes(t)) tags.push(t); };
  // primary tag from the generator
  if (gainAxis === "set") addTag("set bonus");
  if (gainAxis === "rebalance") addTag("rebalance");
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
  else if (gainAxis === "unranked") gainText = `${meta.zeroCost ? "free " : ""}+${meta.stat}`;
  else gainText = `${meta.optCrafts - craftCount(sol)} fewer crafting steps`;

  // Sets this candidate newly activates vs the optimum (U7): the render layer
  // expands these to their granted affixes so an alternative names the concrete
  // bonuses it adds, not just the set. Include the generator's own set for a set gain.
  const activatedSets = [...new Set([
    ...(gainAxis === "set" && meta.set ? [meta.set] : []),
    ...newSets,
  ])];

  const costText = cost.length ? cost.map((c) => `${c.delta} ${c.stat}`).join(", ") : "no priority cost";
  const gainMag = gainAxis === "set" ? (newSets.length ? 1 : 0.5)
    : gainAxis === "rebalance" ? gains.reduce((s, g) => s + g.delta, 0)
    : gainAxis === "unranked" ? 1
    : (meta.optCrafts - craftCount(sol));
  return { ...candidate, cost, gains, tags, gainText, costText, gainMag, activatedSets, totalCost: cost.reduce((s, c) => s - c.delta, 0), key: buildKey(sol) };
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
    if (distinctCount(a, optSlots) < K) continue;                       // too close to the optimum
    if (kept.some((b) => distinctCount(a, slotsOf(b.sol)) < K)) continue; // too close to a kept alt
    seen.add(a.key); kept.push(a);
  }

  const typeOrder = { set: 0, rebalance: 1, unranked: 2, crafts: 3 };
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
