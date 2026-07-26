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

// Share model.js's Viktranium tier derivation as the SINGLE source of truth, so
// the solver's option-match predicate can never diverge from the dominance
// guard's slot key (the documented fragmented-key trap). In the browser model.js
// loads first and lamordiaTier is a global; under Node/CommonJS (tests) it is not
// in scope, so pull it from the module.
const _lamordiaTier = (typeof lamordiaTier !== "undefined")
  ? lamordiaTier
  // eslint-disable-next-line global-require
  : require("./model.js").lamordiaTier;

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
  const augMeta = new Map(); // placement var -> {variant_id, color, wiki_url}
  const setMeta = new Map(); // set_active var -> {set, pieces_required, pieces_label, wiki_url}
  const dinoMeta = new Map(); // dino placement var -> {dino_type, stat, bonus_type, value, wiki_url}
  const ncMeta = new Map(); // nc placement var -> {item, category, stat, bonus_type, value, tier, wiki_url}
  const rollMeta = new Map(); // roll-group option var -> {item, stat, bonus_type, value, unit}
  const vikMeta = new Map(); // Viktranium placement var -> {item, slot_type, category, stat, bonus_type, value, unit, tier, wiki_url}
  const sealMeta = new Map(); // seal placement var -> {item, seal_type, category, stat, bonus_type, value, unit, wiki_url}

  // U3 — augment assignment as per-slot compatible choice-slots. Each OPEN augment
  // slot on an equipped item is a select-one over the augments COMPATIBLE with the
  // slot's color: the DDO wiki matrix, baked onto each augment as `fits_slots` at
  // build time, so here it is plain set-membership (slot color ∈ aug.fits_slots).
  // A Red augment fits Red/Purple/Orange slots; a Colorless augment fits every
  // colored slot; Moon/Sun fit only their own. Each option's affixes feed the
  // (stat, bonus_type) buckets, so typed non-stacking is automatic (the bucket-max)
  // and there is NO used-once constraint — the solver spreads bonus types across
  // slots on its own. Only Unique-Equipped augments are constrained to one placement.
  // Precompute each pool augment's best per-bucket value once.
  const augBest = new Map(); // aug variant -> Map("stat||type" -> best value)
  for (const aug of model.augments || []) {
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
    if (best.size) augBest.set(aug, best); // only augments advancing a target
  }
  let pc = 0;
  const augByUnique = new Map(); // Unique-Equipped aug id -> [placement vars across all slots]
  for (const xv of xVars) {
    const slotColors = ((xv.variant.augment_slots_norm || {}).colors) || [];
    for (const slotColor of slotColors) {
      const slotVars = [];
      for (const [aug, best] of augBest) {
        if (!(aug.fits_slots || []).includes(slotColor)) continue; // compatibility (baked matrix)
        const p = "p" + pc++;
        extraVars.push(p);
        augMeta.set(p, {
          variant_id: aug.variant_id, color: (aug.aug_color || {}).color,
          slot_color: slotColor, item: xv.variant.variant_id, wiki_url: aug.wiki_url,
        });
        slotVars.push(p);
        extraConstraints.push(`${p} - ${xv.name} <= 0`); // the slot exists only when its host is equipped
        for (const [k, val] of best) {
          if (!zByBucket.has(k)) zByBucket.set(k, []);
          zByBucket.get(k).push({ name: "z" + zc++, gates: [p], value: val });
        }
        if (aug.unique_equipped) {
          const id = aug.variant_id;
          if (!augByUnique.has(id)) augByUnique.set(id, []);
          augByUnique.get(id).push(p);
        }
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // one augment per slot
    }
  }
  // Unique-Equipped augments: at most one placement across all slots.
  for (const [, ps] of augByUnique) if (ps.length > 1) extraConstraints.push(`${ps.join(" + ")} <= 1`);

  // U4 (Dino) — Isle of Dread Dino crafting. Structurally the augment mechanic
  // with a typed-slot vocabulary, TWO-KEYED by (dino_type, category) (KTD1): a
  // "Scale (Weapon)" insert fits only a "Scale Slot (Weapon)". Each insert UNIT
  // gets ONE placement binary q; each of the unit's affixes is a contribution
  // gated by [q] into its own (stat, bonus_type) bucket — so a multi-affix insert
  // (KTD4) applies ALL its affixes together or none. Per (type, category) key,
  // total placements are bounded by the open typed slots across equipped items
  // (aggregate capacity, mirroring the augment color model). A blank host carries
  // dino_slots_norm — the list of `type||category` slots it exposes. A unit none
  // of whose affixes advances a ranked target is left out; a unit whose key has no
  // open slot on any equipped item is forced to 0 by an empty-capacity constraint.
  const dinoSlotKey = (ins) => `${ins.dino_type}||${ins.category || "Accessory"}`;
  const dinoByKey = new Map(); // "type||category" -> [placement var names]
  let qc = 0;
  for (const ins of model.dinoInserts || []) {
    const affixes = (ins.affixes && ins.affixes.length)
      ? ins.affixes
      // back-compat: a flat single-affix record (older shape)
      : (ins.stat ? [{ stat: ins.stat, bonus_type: ins.bonus_type, value: ins.value, unit: ins.unit }] : []);
    const onTarget = affixes.filter((a) => targetSet.has(a.stat) && a.value > 0);
    if (!ins.dino_type || onTarget.length === 0) continue;
    const q = "q" + qc++;
    extraVars.push(q);
    dinoMeta.set(q, {
      dino_type: ins.dino_type, category: ins.category || "Accessory",
      name: ins.name, affixes, wiki_url: ins.wiki_url,
    });
    const key = dinoSlotKey(ins);
    if (!dinoByKey.has(key)) dinoByKey.set(key, []);
    dinoByKey.get(key).push(q);
    // Gate ONLY the on-target affixes into buckets (off-target affixes of the same
    // unit ride along physically but add no objective terms); one shared gate [q]
    // keeps the multi-affix placement all-or-nothing.
    for (const a of onTarget) {
      const k = `${a.stat}||${a.bonus_type}`;
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push({ name: "z" + zc++, gates: [q], value: a.value });
    }
  }
  // capacity: sum(q of key) - sum(open_dino_slots_of_key(item) * x_item) <= 0
  for (const [key, qs] of dinoByKey) {
    const capTerms = [];
    for (const xv of xVars) {
      const slots = xv.variant.dino_slots_norm || [];
      const n = slots.filter((t) => t === key).length;
      if (n > 0) capTerms.push(`${n} ${xv.name}`);
    }
    const rhs = capTerms.length ? " - " + capTerms.join(" - ") : "";
    extraConstraints.push(`${qs.join(" + ")}${rhs} <= 0`);
  }

  // U81 Nearly Complete — a parametric choice-slot on an item. An item carrying
  // `nearly_complete: <category>` may craft one option from that category's pool
  // (at the item's tier): each candidate option gets a placement binary n, its
  // stat is a contribution gated [n], n is available only when the host item is
  // equipped (n - x_item <= 0), and Σ n <= 1 enforces the single (irreversible)
  // choice. Feeds the same (stat, bonus_type) buckets, so stacking is correct.
  let ncc = 0;
  for (const xv of xVars) {
    const category = xv.variant.nearly_complete;
    if (!category) continue;
    // Tier from the host's ML, not a fixed default — never grant the larger
    // (Legendary ML35) magnitude to a heroic item that omitted nc_tier.
    const tier = xv.variant.nc_tier || ((xv.variant.minimum_level || 0) >= 35 ? "legendary" : "heroic");
    const slotVars = [];
    for (const opt of model.nearlyComplete || []) {
      if (opt.category !== category || opt.tier !== tier) continue;
      if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
      const n = "n" + ncc++;
      extraVars.push(n);
      ncMeta.set(n, {
        item: xv.variant.variant_id, category, stat: opt.stat,
        bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat",
        tier, wiki_url: opt.wiki_url,
      });
      slotVars.push(n);
      extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
      const k = `${opt.stat}||${opt.bonus_type}`;
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
    }
    if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per slot
  }

  // Choice-slots (roll groups). An item's `roll_groups` each offer several
  // mutually-exclusive options ("Rolls one of: A / B / C"); the solver picks the
  // one that best advances the ranked targets. Same gated primitive as NC: a
  // per-option binary gated by the host item (n - x_item <= 0), the option's stat
  // fed into its (stat, bonus_type) bucket [n], and Sum(n) <= 1 per group.
  let rgc = 0;
  for (const xv of xVars) {
    for (const group of xv.variant.roll_groups || []) {
      const slotVars = [];
      for (const opt of group.options || []) {
        if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
        const n = "rg" + rgc++;
        extraVars.push(n);
        rollMeta.set(n, {
          item: xv.variant.variant_id, stat: opt.stat,
          bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat",
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        const k = `${opt.stat}||${opt.bonus_type}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per group
    }
  }

  // U81 Viktranium ("Lamordia") — a typed choice-slot on an item. Each entry in
  // `lamordia_slots` is an independent slot of a (type, category); it may craft
  // one option from the matching pool at the host's tier. Same gated select-one
  // primitive as Nearly Complete: a per-option binary n gated by the host item
  // (n - x_item <= 0), its stat fed into the (stat, bonus_type) bucket [n], and
  // Σ n <= 1 PER SLOT — so an item with two Lamordia slots gets two independent
  // choices. Tier from the host's ML (ML>=35 Legendary), matching lamordiaTier.
  let vkc = 0;
  for (const xv of xVars) {
    const slots = xv.variant.lamordia_slots || [];
    if (!slots.length) continue;
    const tier = _lamordiaTier(xv.variant);  // single source of truth (model.js)
    for (const slot of slots) {
      const slotVars = [];
      for (const opt of model.viktranium || []) {
        if (opt.slot_type !== slot.type || opt.category !== slot.category || opt.tier !== tier) continue;
        if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
        const n = "vk" + vkc++;
        extraVars.push(n);
        vikMeta.set(n, {
          item: xv.variant.variant_id, slot_type: slot.type, category: slot.category,
          stat: opt.stat, bonus_type: opt.bonus_type, value: opt.value,
          unit: opt.unit || "flat", tier, wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        const k = `${opt.stat}||${opt.bonus_type}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per slot
    }
  }

  // Seal slots ("Sealed in X") — a single-pick choice-slot on an item. Each entry
  // in `seal_slots` may unseal ONE option from its seal_type's pool at a crafting
  // table; picking another replaces the original (mutually exclusive). Same gated
  // select-one primitive as Nearly Complete / Viktranium: a per-option binary n
  // gated by the host item (n - x_item <= 0), its stat fed into the (stat,
  // bonus_type) bucket [n], and Σ n <= 1 PER SLOT. The pool is keyed by seal_type
  // ALONE — unlike Viktranium's (slot_type, category) key, a seal type is one flat
  // pool whose gear domain is implied by the type (Undeath=clothing/jewelry,
  // Fire=weapons). The host's `category` field is informational (carried for
  // display), never a pool filter.
  let slc = 0;
  for (const xv of xVars) {
    const slots = xv.variant.seal_slots || [];
    if (!slots.length) continue;
    for (const slot of slots) {
      const slotVars = [];
      for (const opt of model.seal || []) {
        if (opt.seal_type !== slot.seal_type) continue;
        if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
        const n = "sl" + slc++;
        extraVars.push(n);
        sealMeta.set(n, {
          item: xv.variant.variant_id, seal_type: slot.seal_type, category: slot.category,
          stat: opt.stat, bonus_type: opt.bonus_type, value: opt.value,
          unit: opt.unit || "flat", wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        const k = `${opt.stat}||${opt.bonus_type}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single unseal per slot
    }
  }

  // U5 — set thresholds. A set tier's parsed stats count only when >= N pieces
  // of the set are equipped. Per tier: a binary set_active with the linear
  // indicator  N*set_active - sum(equipped pieces of the set) <= 0  (so it can
  // only be 1 when the piece count reaches N), and each tier stat is a
  // contribution gated by [set_active]. The lexicographic solve then completes a
  // set only when its bonus advances a ranked target.
  const setPieces = new Map(); // set name -> [piece x-var names]
  const setTiers = new Map();  // set name -> Map(pieces_label -> tier)
  for (const xv of xVars) {
    for (const sb of xv.variant.set_bonus || []) {
      if (!sb.set) continue;
      if (!setPieces.has(sb.set)) setPieces.set(sb.set, []);
      setPieces.get(sb.set).push(xv.name);
    }
    for (const tier of xv.variant.parsed_set_bonuses || []) {
      if (tier.pieces_required == null || !(tier.affixes || []).length) continue;
      if (!setTiers.has(tier.set)) setTiers.set(tier.set, new Map());
      const byLabel = setTiers.get(tier.set);
      if (!byLabel.has(tier.pieces_label)) byLabel.set(tier.pieces_label, tier);
    }
  }
  let sc = 0;
  for (const [setName, byLabel] of setTiers) {
    const pieceVars = setPieces.get(setName) || [];
    if (!pieceVars.length) continue;
    for (const [, tier] of byLabel) {
      const best = new Map();
      for (const a of tier.affixes) {
        const k = `${a.stat}||${a.bonus_type}`;
        if (targetSet.has(a.stat) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
      }
      if (!best.size) continue; // this tier advances no target
      const sa = "s" + sc++;
      extraVars.push(sa);
      setMeta.set(sa, {
        set: setName, pieces_required: tier.pieces_required,
        pieces_label: tier.pieces_label, wiki_url: tier.wiki_url,
      });
      extraConstraints.push(`${tier.pieces_required} ${sa} - ${pieceVars.join(" - ")} <= 0`);
      for (const [k, val] of best) {
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [sa], value: val });
      }
    }
  }

  return {
    xVars, zByBucket, cappedStats, targetList: model.targets, model,
    extraVars, extraConstraints, augMeta, setMeta, dinoMeta, ncMeta, rollMeta, vikMeta, sealMeta, _zc: zc,
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
  const augmentsPlaced = [];
  for (const [p, meta] of program.augMeta || []) if (prim(p) > 0.5) augmentsPlaced.push(meta);
  const setsActive = [];
  for (const [s, meta] of program.setMeta || []) if (prim(s) > 0.5) setsActive.push(meta);
  const dinoPlaced = [];
  for (const [q, meta] of program.dinoMeta || []) if (prim(q) > 0.5) dinoPlaced.push(meta);
  const ncPlaced = [];
  for (const [n, meta] of program.ncMeta || []) if (prim(n) > 0.5) ncPlaced.push(meta);
  const rollPlaced = [];
  for (const [n, meta] of program.rollMeta || []) if (prim(n) > 0.5) rollPlaced.push(meta);
  const vikPlaced = [];
  for (const [n, meta] of program.vikMeta || []) if (prim(n) > 0.5) vikPlaced.push(meta);
  const sealPlaced = [];
  for (const [n, meta] of program.sealMeta || []) if (prim(n) > 0.5) sealPlaced.push(meta);
  return { chosen, effective, augmentsPlaced, setsActive, dinoPlaced, ncPlaced, rollPlaced, vikPlaced, sealPlaced };
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

  return {
    status: "optimal", perTarget, effective: sol.effective, chosen: sol.chosen,
    augmentsPlaced: sol.augmentsPlaced, setsActive: sol.setsActive,
    dinoPlaced: sol.dinoPlaced, ncPlaced: sol.ncPlaced, rollPlaced: sol.rollPlaced,
    vikPlaced: sol.vikPlaced, sealPlaced: sol.sealPlaced, program,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildProgram, encodeStage, effectiveExpr, rawExpr, solveLexicographic, scaleAt };
}
