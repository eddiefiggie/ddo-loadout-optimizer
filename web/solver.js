// U7 — staged lexicographic solve over the worn-item model, driven by HiGHS.
//
// Exactness scope: worn-item affixes with bonus-type stacking (only the highest
// value of each same-named type counts), the armor-dependent dodge cap,
// lexicographic priority over the ranked targets, and a deterministic tie-break.
//
// Gated-contribution primitive (U1): every stat source — worn affix, augment,
// set bonus, crafting upgrade — is a "contribution": a (stat, bonus_type, value)
// carried by a select-one z var that is available only when ALL of its `gates`
// (a list of enabling binaries) are 1. A worn affix has a single gate (its item
// x_i); augment/set/crafting sources add more gates and, via `extraVars` /
// `extraConstraints`, the structural binaries and constraints that back them
// (placement capacity, set thresholds, per-track select-one). The bucket-max
// core is unchanged: sum(z) <= 1 per bucket, so raw(stat) = sum over types of
// the single highest selected value. A capped stat (dodge) gets a continuous var
// d clamped by d <= cap and d <= raw — a clamp, not a forbidding ceiling.

function scaleAt(s, mlCap) {
  if (mlCap <= s.ml_lo) return s.val_lo;
  if (mlCap >= s.ml_hi) return s.val_hi;
  return Math.round(s.val_lo + (s.val_hi - s.val_lo) * (mlCap - s.ml_lo) / (s.ml_hi - s.ml_lo));
}

function buildProgram(model) {
  const targetSet = new Set(model.targets);
  const mlCap = model.mlCap;
  const cappedStats = model.dodgeCap != null ? { Dodge: model.dodgeCap } : {};

  const xVars = [];
  model.worn.forEach((group) => {
    group.variants.forEach((variant) => {
      xVars.push({ name: "x" + xVars.length, variant, slot: group.slot, cardinality: group.cardinality });
    });
  });

  // "stat||type" -> [{gates, value}]. A worn affix is a contribution gated by
  // exactly one binary: its item's pick var. Later units push additional
  // contributions (augments, sets, crafting) into zByBucket with more gates,
  // alongside their backing extraVars/extraConstraints.
  const buckets = new Map();
  for (const xv of xVars) {
    const best = new Map();
    for (const a of xv.variant.affixes || []) {
      const k = `${a.stat}||${a.bonus_type}`;
      if (targetSet.has(a.stat) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
    }
    for (const s of xv.variant.scaling || []) {
      const val = scaleAt(s, mlCap);
      const k = `${s.stat}||${s.bonus_type}`;
      if (targetSet.has(s.stat) && val > 0 && (!best.has(k) || best.get(k) < val)) best.set(k, val);
    }
    for (const [k, val] of best) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push({ gates: [xv.name], value: val });
    }
  }

  let zc = 0;
  const zByBucket = new Map();
  for (const [key, sources] of buckets) {
    zByBucket.set(key, sources.map((src) => ({ name: "z" + zc++, gates: src.gates, value: src.value })));
  }

  // Extension seam (U1): extraVars are structural binaries; extraConstraints are
  // raw LP constraint bodies that encodeStage injects verbatim.
  const extraVars = [];
  const extraConstraints = [];

  // U3 — augment assignment. Each augment gets a placement binary p_i; its stat
  // is a contribution gated by [p_i]. Per color, total placements are bounded by
  // the open slots of that color across equipped worn items (aggregate capacity,
  // not per-physical-slot — KTD2). A quarantined-color augment has no exact slot
  // and is skipped in the pool (see model.js).
  const augByColor = new Map(); // canonical color -> [placement var names]
  let pc = 0;
  for (const aug of model.augments || []) {
    const color = (aug.aug_color || {}).color;
    if (!color) continue;
    const best = new Map();
    for (const a of aug.affixes || []) {
      const k = `${a.stat}||${a.bonus_type}`;
      if (targetSet.has(a.stat) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
    }
    for (const s of aug.scaling || []) {
      const val = scaleAt(s, mlCap);
      const k = `${s.stat}||${s.bonus_type}`;
      if (targetSet.has(s.stat) && val > 0 && (!best.has(k) || best.get(k) < val)) best.set(k, val);
    }
    if (!best.size) continue; // augment advances no target — leave it out
    const p = "p" + pc++;
    extraVars.push(p);
    if (!augByColor.has(color)) augByColor.set(color, []);
    augByColor.get(color).push(p);
    for (const [k, val] of best) {
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push({ name: "z" + zc++, gates: [p], value: val });
    }
  }
  // capacity: sum(p of color) - sum(open_slots_of_color(item) * x_item) <= 0
  for (const [color, ps] of augByColor) {
    const capTerms = [];
    for (const xv of xVars) {
      const slotColors = ((xv.variant.augment_slots_norm || {}).colors) || [];
      const n = slotColors.filter((c) => c === color).length;
      if (n > 0) capTerms.push(`${n} ${xv.name}`);
    }
    const rhs = capTerms.length ? " - " + capTerms.join(" - ") : "";
    extraConstraints.push(`${ps.join(" + ")}${rhs} <= 0`);
  }

  return {
    xVars, zByBucket, cappedStats, targetList: model.targets, model,
    extraVars, extraConstraints, _zc: zc,
  };
}

/** Raw stacked expression (terms) for a stat: sum over its buckets of value*z. */
function rawExpr(program, stat) {
  const terms = [];
  for (const [key, zs] of program.zByBucket) {
    if (key.split("||")[0] !== stat) continue;
    for (const z of zs) terms.push({ coef: z.value, name: z.name });
  }
  return terms;
}

/** Objective/lock expression for a stat: the capped var if capped, else raw. */
function effectiveExpr(program, stat) {
  if (program.cappedStats[stat] != null) return [{ coef: 1, name: "d_" + stat }];
  return rawExpr(program, stat);
}

function fmtExpr(terms, fallbackVar) {
  if (!terms.length) return `0 ${fallbackVar}`;
  return terms.map((t) => `${t.coef >= 0 ? "+" : "-"} ${Math.abs(t.coef)} ${t.name}`).join(" ");
}

function encodeStage(program, { objectiveStat, sense, locks, tieBreak }) {
  const fb = program.xVars[0].name;
  const L = [sense === "min" ? "Minimize" : "Maximize"];
  if (tieBreak) {
    L.push(" obj: " + program.xVars.map((xv, i) => `+ ${i + 1} ${xv.name}`).join(" "));
  } else {
    L.push(" obj: " + fmtExpr(effectiveExpr(program, objectiveStat), fb));
  }
  L.push("Subject To");
  let c = 0;

  const bySlot = new Map();
  program.xVars.forEach((xv) => {
    if (!bySlot.has(xv.slot)) bySlot.set(xv.slot, { card: xv.cardinality, names: [] });
    bySlot.get(xv.slot).names.push(xv.name);
  });
  for (const [, g] of bySlot) L.push(` c${c++}: ${g.names.join(" + ")} <= ${g.card}`);

  for (const [, zs] of program.zByBucket) {
    if (zs.length) L.push(` c${c++}: ${zs.map((z) => z.name).join(" + ")} <= 1`);
    // A contribution is available only when ALL of its gates are 1: emit one
    // z - gate <= 0 per gate. A worn affix has a single gate (identical to before).
    for (const z of zs) for (const gate of z.gates) L.push(` c${c++}: ${z.name} - ${gate} <= 0`);
  }

  // Structural constraints backing extra binaries (U3 capacity, U5 thresholds,
  // U7 per-track select-one). Raw LP bodies, injected verbatim.
  for (const body of program.extraConstraints || []) L.push(` c${c++}: ${body}`);

  // capped stats: d <= raw (bound d <= cap is in Bounds). With no sources, pin
  // d <= 0 so the cap var cannot float up to its bound under the maximizing objective.
  for (const stat of Object.keys(program.cappedStats)) {
    const raw = rawExpr(program, stat);
    if (raw.length) L.push(` c${c++}: d_${stat} ${fmtExpr(raw.map((t) => ({ coef: -t.coef, name: t.name })), fb)} <= 0`);
    else L.push(` c${c++}: d_${stat} <= 0`);
  }

  for (const lock of locks || []) {
    const terms = effectiveExpr(program, lock.stat);
    if (terms.length) L.push(` c${c++}: ${fmtExpr(terms, fb)} = ${lock.value}`);
  }

  L.push("Bounds");
  for (const [stat, cap] of Object.entries(program.cappedStats)) L.push(` 0 <= d_${stat} <= ${cap}`);

  L.push("Binary");
  program.xVars.forEach((xv) => L.push(" " + xv.name));
  for (const [, zs] of program.zByBucket) zs.forEach((z) => L.push(" " + z.name));
  (program.extraVars || []).forEach((v) => L.push(" " + v));
  L.push("End");
  return L.join("\n");
}

function readSolution(res, program) {
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  const chosen = program.xVars.filter((xv) => prim(xv.name) > 0.5).map((xv) => ({ slot: xv.slot, variant: xv.variant }));
  const effective = {};
  for (const stat of program.targetList) {
    if (program.cappedStats[stat] != null) effective[stat] = Math.round(prim("d_" + stat));
    else effective[stat] = rawExpr(program, stat).reduce((sum, t) => sum + (prim(t.name) > 0.5 ? t.coef : 0), 0);
  }
  return { chosen, effective };
}

async function solveLexicographic(model, highs) {
  const program = buildProgram(model);
  if (!program.xVars.length) return { status: "infeasible", reason: "no eligible items for these constraints" };

  const locks = [];
  const perTarget = {};
  for (const stat of program.targetList) {
    const res = highs.solve(encodeStage(program, { objectiveStat: stat, sense: "max", locks }));
    if (res.Status !== "Optimal") return { status: "infeasible", reason: `stage ${stat}: ${res.Status}` };
    const { effective } = readSolution(res, program);
    perTarget[stat] = effective[stat];
    locks.push({ stat, value: effective[stat] });
  }

  const tb = highs.solve(encodeStage(program, { sense: "min", tieBreak: true, locks }));
  const finalRes = tb.Status === "Optimal" ? tb : null;
  const sol = readSolution(finalRes || highs.solve(encodeStage(program, { objectiveStat: program.targetList.at(-1), sense: "max", locks })), program);

  return { status: "optimal", perTarget, effective: sol.effective, chosen: sol.chosen, program };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildProgram, encodeStage, effectiveExpr, rawExpr, solveLexicographic, scaleAt };
}
