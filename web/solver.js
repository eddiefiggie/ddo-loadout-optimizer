// U7 — staged lexicographic solve over the worn-item model, driven by HiGHS.
//
// Exactness scope (v1): worn-item affixes with bonus-type stacking (only the
// highest value of each same-named type counts), the armor-dependent dodge cap,
// lexicographic priority over the ranked targets, and a deterministic tie-break.
// Set-bonus and augment OPTIMIZATION are a surfaced follow-up (their bonuses are
// still free text in the dataset); set membership and augment slots are carried
// through for display but do not yet enter the objective.
//
// Encoding: binary pick var per worn variant (x_i); slot cardinality; a
// "select-one" group per (target stat, bonus_type) bucket (z vars, sum(z) <= 1,
// z <= x(source)) so raw(stat) = sum over types of the single highest selected
// value. A capped stat (dodge) gets a continuous var d clamped by d <= cap and
// d <= raw, and the objective uses d — a clamp, not a forbidding ceiling.

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

  const buckets = new Map(); // "stat||type" -> [{gate, value}]
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
      buckets.get(k).push({ gate: xv.name, value: val });
    }
  }

  let zc = 0;
  const zByBucket = new Map();
  for (const [key, sources] of buckets) {
    zByBucket.set(key, sources.map((src) => ({ name: "z" + zc++, gate: src.gate, value: src.value })));
  }

  return { xVars, zByBucket, cappedStats, targetList: model.targets, model };
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
    for (const z of zs) L.push(` c${c++}: ${z.name} - ${z.gate} <= 0`);
  }

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
