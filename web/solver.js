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

// U4b-i — stacking-equivalence: canonicalize an affix `type` to its stacking
// bucket token before it forms a bucket KEY, so equivalent-but-distinct native
// types (e.g. "Insight Natural" and "Insight") collapse to ONE bucket and cannot
// double-count. Shares model.js's single equivType (browser global; Node require)
// so the solver and the model/dominance guard can never disagree on a bucket key.
const _equivType = (typeof equivType !== "undefined")
  ? equivType
  // eslint-disable-next-line global-require
  : require("./model.js").equivType;

// U2 — the shared pin-normalize path (single `variant_id` or Ring `variant_ids`
// list). Browser global; Node require. So the solver and model can never read a
// list-shaped pin differently.
var _pinnedVariantIds = (typeof pinnedVariantIds !== "undefined")
  ? pinnedVariantIds
  // eslint-disable-next-line global-require
  : require("./model.js").pinnedVariantIds;

/** U6 — per-slot constraint bodies (pin / lock-empty) as raw LP strings, using
 *  the `extra` seam. Pin → the chosen variant's pick var = 1; lock-empty → the
 *  slot's pick vars sum to 0; free → nothing. Pure + exported for tests. A pin
 *  whose variant isn't in the pool is a silent no-op (the wizard drops an
 *  ineligible pin to free before solving, R17). */
function slotConstraintBodies(xVars, slotConstraints) {
  if (!slotConstraints) return [];
  const bySlot = new Map();
  xVars.forEach((xv) => {
    if (!bySlot.has(xv.slot)) bySlot.set(xv.slot, []);
    bySlot.get(xv.slot).push(xv);
  });
  const bodies = [];
  for (const [slot, c] of Object.entries(slotConstraints)) {
    if (!c || c.type === "free") continue;
    const group = bySlot.get(slot) || [];
    if (c.type === "empty") {
      if (group.length) bodies.push(`${group.map((x) => x.name).join(" + ")} = 0`);
    } else if (c.type === "pin") {
      // One `x = 1` per pinned variant present in the slot group. Single-cardinality
      // slots have one; the Ring slot may pin two different rings (B5). A pinned id
      // absent from the pool is a silent no-op (stale pin; R17 reconciles it).
      for (const vid of _pinnedVariantIds(c)) {
        const xv = group.find(
          (x) => (x.variant.variant_id || x.variant.source_item) === vid);
        if (xv) bodies.push(`${xv.name} = 1`);
      }
    }
  }
  return bodies;
}

function buildProgram(model) {
  const mlCap = model.mlCap;
  // U1 — capped stats = the armor dodge cap plus any user-set per-stat caps. When a
  // user caps Dodge and armor also caps it, the tighter (min) cap wins. Each capped
  // stat is clamped in encodeStage (d <= raw, d <= cap) and read back as min(cap, raw).
  const cappedStats = {};
  if (model.dodgeCap != null) cappedStats.Dodge = model.dodgeCap;
  for (const [stat, cap] of Object.entries(model.userCaps || {})) {
    if (cap == null) continue;
    cappedStats[stat] = cappedStats[stat] != null ? Math.min(cappedStats[stat], cap) : cap;
  }
  // A capped OR floored stat must have its buckets built even if it is not a priority
  // target, so its raw expression exists for the clamp / floor constraint (KTD3).
  const targetSet = new Set([...model.targets, ...Object.keys(cappedStats), ...Object.keys(model.floors || {})]);

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
      const k = `${a.name}||${_equivType(a.type)}`;
      if (targetSet.has(a.name) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
    }
    for (const s of xv.variant.scaling || []) {
      const val = scaleAt(s, mlCap);
      const k = `${s.stat}||${_equivType(s.bonus_type)}`;
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

  // U6 — per-slot pin/lock constraints hold across every lexicographic stage.
  // No-op when the query carries no slotConstraints (current live behavior).
  for (const body of slotConstraintBodies(xVars, model.query && model.query.slotConstraints)) {
    extraConstraints.push(body);
  }

  // KTD3 / R6 — "exactly one Artifact" when the opt-in box is on. Sum ALL Artifact
  // pick vars = 1, but ONLY when at least one of them is still selectable under the
  // active slot constraints. A forced-to-0 Artifact (its slot locked empty, or a
  // single-cardinality slot pinned to a different item) contributes 0 to the sum
  // harmlessly; but if EVERY Artifact is forced to 0 (or the seed is empty, so
  // there are none), a blanket `= 1` would be infeasible — so we add nothing and
  // let R6 fire (best non-Artifact build + disclosure). This keeps the model
  // feasible for both the empty-data case (AE3) and the locked/pinned-slot case.
  if (model.query && model.query.includeArtifact) {
    const arts = xVars.filter((xv) => xv.variant && xv.variant.artifact);
    const sc = model.query.slotConstraints || {};
    const idOf = (xv) => xv.variant.variant_id || xv.variant.source_item;
    // Resolve a pin against the actual pick vars in its slot: a pin whose id
    // matches no eligible var is a STALE/ghost pin (R17 reconciles it post-solve)
    // and consumes nothing — `slotConstraintBodies` likewise emits no body for it.
    const bySlot = new Map();
    for (const xv of xVars) {
      if (!bySlot.has(xv.slot)) bySlot.set(xv.slot, []);
      bySlot.get(xv.slot).push(xv);
    }
    const pinResolves = (slot, variantId) =>
      (bySlot.get(slot) || []).some((x) => idOf(x) === variantId);
    const forcedToZero = (xv) => {
      const c = sc[xv.slot];
      if (!c || c.type === "free") return false;
      if (c.type === "empty") return true;
      if (c.type === "pin") {
        const resolving = _pinnedVariantIds(c).filter((vid) => pinResolves(xv.slot, vid));
        if (!resolving.length) return false;            // all pins stale -> slot still free
        if (resolving.includes(idOf(xv))) return false; // this Artifact IS one of the pins (forced on)
        return resolving.length >= (xv.cardinality || 1); // slot capacity fully taken by other pins
      }
      return false;
    };
    // Artifacts the user force-pinned ON (a resolving pin to the Artifact itself).
    // `slotConstraintBodies` already emits `x=1` for each. If TWO or more are
    // pinned on, the pins themselves assert >1 Artifact (the user's explicit
    // choice), so adding `sum(artifacts)=1` would make the model infeasible
    // (e.g. xA=1 AND xB=1 AND xA+xB=1). Skip the constraint in that case — let
    // the pins stand rather than wiping the build with a generic 'no set' error.
    const pinnedOnArtifacts = arts.filter((xv) => {
      const c = sc[xv.slot];
      return c && c.type === "pin" && _pinnedVariantIds(c).includes(idOf(xv)) && pinResolves(xv.slot, idOf(xv));
    }).length;
    if (pinnedOnArtifacts <= 1 && arts.some((xv) => !forcedToZero(xv))) {
      extraConstraints.push(`${arts.map((xv) => xv.name).join(" + ")} = 1`);
    }
  }
  const augMeta = new Map(); // color-placement var -> {variant_id, color, slot_color, wiki_url}
  const placeMeta = new Map(); // augment place indicator (pu) -> {variant_id, color, wiki_url}
  const setMeta = new Map(); // set_active var -> {set, pieces_required, pieces_label, wiki_url}
  const jokerMeta = new Map(); // joker option var -> {host, group, set} (wildcard set piece)
  const dinoMeta = new Map(); // dino placement var -> {dino_type, stat, bonus_type, value, wiki_url}
  const ncMeta = new Map(); // nc placement var -> {item, category, stat, bonus_type, value, tier, wiki_url}
  const rollMeta = new Map(); // roll-group option var -> {item, stat, bonus_type, value, unit}
  const vikMeta = new Map(); // Viktranium placement var -> {item, slot_type, category, stat, bonus_type, value, unit, tier, wiki_url}
  const sealMeta = new Map(); // seal placement var -> {item, seal_type, category, stat, bonus_type, value, unit, wiki_url}
  const tfMeta = new Map();   // Thunder-Forged pick var -> {item, tier, stat, bonus_type, value, unit, wiki_url}
  const gsMeta = new Map();   // Green Steel pick var -> {item, name, stat, bonus_type, value, unit, wiki_url}
  const memberMeta = new Map(); // membership pick var -> {host, set, station} (chosen set-membership: Cannith / Dino Set-Bonus)

  // U3 — augment assignment (aggregate compatible-color capacity). Correctness
  // rests on the bucket-max core: every (stat, bonus_type) bucket is capped at
  // Σz ≤ 1, so an augment's value is fully realized by placing it in ANY one
  // compatible slot — extra placements of the same augment add nothing. So rather
  // than a variable per physical slot (which scaled with the candidate-item count
  // and blew the program up ~100×), model each augment as: AT MOST ONE placement,
  // consuming one compatible slot COLOR, with per-color placements bounded by that
  // color's open-slot supply across equipped items. Slots of a given color are
  // interchangeable, so this per-color b-matching is exactly the physical-slot
  // matching, but O(pool) and independent of the candidate count. Multi-fit is the
  // wiki matrix baked as `fits_slots` (a Red augment fits Red/Purple/Orange slots;
  // Colorless fits every colored slot; Moon/Sun only their own). The single-
  // placement cap also means every augment is used at most once — the "own one
  // copy" invariant — for unique and ordinary augments alike (a second copy would
  // be objective-neutral under bucket-max anyway). Host attribution (which item
  // gets which augment) is reconstructed deterministically in results.js, off the
  // solver's critical path. Precompute each pool augment's best per-bucket value.
  const augBest = new Map(); // aug variant -> Map("stat||type" -> best value)
  for (const aug of model.augments || []) {
    const best = new Map();
    for (const a of aug.affixes || []) {
      const k = `${a.name}||${_equivType(a.type)}`;
      if (targetSet.has(a.name) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
    }
    for (const s of aug.scaling || []) {
      const val = scaleAt(s, mlCap);
      const k = `${s.stat}||${_equivType(s.bonus_type)}`;
      if (targetSet.has(s.stat) && val > 0 && (!best.has(k) || best.get(k) < val)) best.set(k, val);
    }
    if (best.size) augBest.set(aug, best); // only augments advancing a target
  }
  // Open-slot supply per color: Σ over candidate items of (open slots of that
  // color on the item) · x_item. A color's placements can't exceed its supply.
  const supplyTerms = new Map(); // slot color -> ["n xName", ...]
  for (const xv of xVars) {
    const counts = new Map();
    for (const c of ((xv.variant.augment_slots_norm || {}).colors) || []) counts.set(c, (counts.get(c) || 0) + 1);
    for (const [c, n] of counts) {
      if (!supplyTerms.has(c)) supplyTerms.set(c, []);
      supplyTerms.get(c).push(`${n} ${xv.name}`);
    }
  }
  const presentColors = new Set(supplyTerms.keys());
  let pc = 0;
  const placeByColor = new Map(); // slot color -> [color-placement vars consuming it]
  const augByUnique = new Map();  // Unique-Equipped id -> [place indicators]
  for (const [aug, best] of augBest) {
    const fits = (aug.fits_slots || []).filter((c) => presentColors.has(c));
    if (!fits.length) continue; // no compatible open slot anywhere -> unplaceable
    const colorVars = [];       // one placement binary per compatible present color
    for (const sc of fits) {
      const p = "p" + pc++;
      extraVars.push(p);
      augMeta.set(p, {
        variant_id: aug.variant_id, color: (aug.aug_color || {}).color,
        slot_color: sc, wiki_url: aug.wiki_url,
      });
      colorVars.push(p);
      if (!placeByColor.has(sc)) placeByColor.set(sc, []);
      placeByColor.get(sc).push(p);
    }
    // place[aug] = Σ colorVars ∈ {0,1}: consumed in exactly one color when placed.
    const place = "pu" + pc++;
    extraVars.push(place);
    placeMeta.set(place, { variant_id: aug.variant_id, color: (aug.aug_color || {}).color, wiki_url: aug.wiki_url });
    extraConstraints.push(`${colorVars.join(" + ")} - ${place} = 0`); // placed iff one color fires
    extraConstraints.push(`${place} <= 1`);                           // at most one slot consumed
    for (const [k, val] of best) {                                    // buckets gated by the placement
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push({ name: "z" + zc++, gates: [place], value: val });
    }
    if (aug.unique_equipped) {
      const id = aug.variant_id;
      if (!augByUnique.has(id)) augByUnique.set(id, []);
      augByUnique.get(id).push(place);
    }
  }
  // Per-color capacity: Σ placements of a color ≤ that color's open slots equipped.
  for (const [sc, ps] of placeByColor) {
    extraConstraints.push(`${ps.join(" + ")} - ${supplyTerms.get(sc).join(" - ")} <= 0`);
  }
  // Unique-Equipped augments sharing a variant_id across records: one placement total.
  for (const [, pls] of augByUnique) if (pls.length > 1) extraConstraints.push(`${pls.join(" + ")} <= 1`);

  // TWF — a one-handed weapon variant is a candidate in BOTH Main Hand and Off Hand
  // (two-weapon fighting). The same physical item can't fill both hands, so cap the
  // sum of its pick vars across the two hands at 1. This is LOAD-BEARING correctness,
  // not cosmetic: plain affixes dedupe per bucket, but set-piece count, augment color
  // supply, and Dino slot capacity all accumulate PER equipped x-var — so a
  // double-equipped weapon would double those and could illegitimately RAISE the
  // optimum. Do not remove.
  const handVars = new Map(); // variant id -> pick-var names in Main/Off Hand
  for (const xv of xVars) {
    if (xv.slot !== "Main Hand" && xv.slot !== "Off Hand") continue;
    const id = xv.variant.variant_id || xv.variant.source_item || xv.variant.name;
    if (id == null) continue;
    if (!handVars.has(id)) handVars.set(id, []);
    handVars.get(id).push(xv.name);
  }
  for (const [, names] of handVars) if (names.length > 1) extraConstraints.push(`${names.join(" + ")} <= 1`);

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
      const k = `${a.stat}||${_equivType(a.bonus_type)}`;
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

  // U81 Nearly Completed — a parametric choice-slot on an item. An item carrying
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
    const tier = xv.variant.nc_tier || ((xv.variant.ml || 0) >= 35 ? "legendary" : "heroic");
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
      const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
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
        const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per group
    }
  }

  // U81 Viktranium ("Lamordia") — a typed choice-slot on an item. Each entry in
  // `lamordia_slots` is an independent slot of a (type, category); it may craft
  // one option from the matching pool at the host's tier. Same gated select-one
  // primitive as Nearly Completed: a per-option binary n gated by the host item
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
        const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per slot
    }
  }

  // Seal slots ("Sealed in X") — a single-pick choice-slot on an item. Each entry
  // in `seal_slots` may unseal ONE option from its seal_type's pool at a crafting
  // table; picking another replaces the original (mutually exclusive). Same gated
  // select-one primitive as Nearly Completed / Viktranium: a per-option binary n
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
        const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single unseal per slot
    }
  }

  // Legendary Thunder-Forged — a multi-tier choice-slot. `thunder_forged_tiers` is a
  // list of tier slots [{tier}]; each may craft one option from that tier's pool, an
  // independent Σ n <= 1 per tier (mirrors Viktranium's per-`lamordia_slot` loop). Pool
  // keyed by `tier` alone (the Legendary tier is fixed for these hosts).
  let tfc = 0;
  for (const xv of xVars) {
    const tiers = xv.variant.thunder_forged_tiers || [];
    if (!tiers.length) continue;
    for (const slot of tiers) {
      const slotVars = [];
      for (const opt of model.thunderForged || []) {
        if (opt.tier !== slot.tier) continue;
        if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
        const n = "tf" + tfc++;
        extraVars.push(n);
        tfMeta.set(n, {
          item: xv.variant.variant_id, tier: slot.tier, stat: opt.stat,
          bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat", wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single pick per tier
    }
  }

  // Legendary Green Steel — a single-pick choice-slot over a flat endgame pool. A host
  // with `green_steel_slot` may craft ONE option from model.greenSteel (mirrors Seal,
  // but the pool has no key — every GS host draws from the one endgame-relevant pool).
  let gsc = 0;
  for (const xv of xVars) {
    if (!xv.variant.green_steel_slot) continue;
    const slotVars = [];
    for (const opt of model.greenSteel || []) {
      if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
      const n = "gs" + gsc++;
      extraVars.push(n);
      gsMeta.set(n, {
        item: xv.variant.variant_id, name: opt.name, stat: opt.stat,
        bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat", wiki_url: opt.wiki_url,
      });
      slotVars.push(n);
      extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
      const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push({ name: "z" + zc++, gates: [n], value: opt.value });
    }
    if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single craft per host
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
  // Wildcard set piece (Gem of Many Facets) — a joker that rolls one set from each of
  // its pools (rerollable, so theoretical-BiS picks the best per group). Per group, one
  // select-one option binary per pool set that HAS a threshold this loadout can reach
  // (setTiers): j <= x(Gem) (only when the Gem is equipped), sum(group) <= 1 (one pick
  // per group), and each j is appended to setPieces[set] so the existing threshold
  // constraint counts it. Options for sets with no threshold are skipped — they would be
  // free vars the solver could set arbitrarily, fabricating an assignment. The tie-break
  // (encodeStage) minimizes joker vars so one is set to 1 only when it is load-bearing.
  let jc = 0;
  const jokerVars = [];
  for (const xv of xVars) {
    const hostSets = new Set();  // a wildcard contributes at most one piece to a given set,
                                 // even if the pools ever overlap (guard the disjoint-pool invariant)
    (xv.variant.joker_set_groups || []).forEach((group, gi) => {
      const opts = [];
      for (const setName of group) {
        if (!setTiers.has(setName) || !setPieces.has(setName)) continue; // no reachable threshold
        if (hostSets.has(setName)) continue;                   // already fed by another group — no double-count
        hostSets.add(setName);
        const j = "k" + jc++;
        extraVars.push(j);
        jokerVars.push(j);
        opts.push(j);
        extraConstraints.push(`${j} - ${xv.name} <= 0`);       // only if the Gem is equipped
        setPieces.get(setName).push(j);                        // counts toward the set's threshold
        jokerMeta.set(j, { host: xv.variant.variant_id, group: gi, set: setName });
      }
      if (opts.length) extraConstraints.push(`${opts.join(" + ")} <= 1`); // at most one per group
    });
  }

  // Chosen set-membership slot (Vecna "Lost Purpose" / Cannith Repurposing Station,
  // and Dino Set-Bonus). A host with `set_membership_slot: {pool:[...sets], station}`
  // may JOIN exactly one set from its pool. Unlike the joker — which only feeds a set
  // already registered by an equipped FIXED member (the set/joker blocks above) — a
  // membership slot SELF-SEEDS the set threshold from the runtime membershipSetDefs
  // table, so an awaken-only set (no intrinsic member equipped, e.g. every Vecna Lost
  // Purpose set) is reachable purely from chosen-membership pieces. Per host: one pick binary
  // per pool set that has a def, gated by the host (m - x_host <= 0), appended to
  // setPieces[set]; Σ m <= 1 per host (single, mutually-exclusive membership pick). The tie-break
  // minimizes member vars (like jokers) so a pick is 1 only when it is a load-bearing
  // piece. For an intrinsic-anchored set (Dino, Forbidden Knowledge) the fixed pieces
  // still register and sum in normally — self-seeding is idempotent with fixed members.
  const membershipDefs = model.membershipSetDefs || {};
  let mmc = 0;
  const memberVars = [];
  for (const xv of xVars) {
    const mslot = xv.variant.set_membership_slot;
    if (!mslot || !(mslot.pool || []).length) continue;
    const opts = [];
    const hostSets = new Set(); // one membership pick per host, even if a set repeats in the pool
    for (const setName of mslot.pool) {
      if (hostSets.has(setName)) continue;
      // self-seed: register the set's tiers from the def even with no fixed member.
      if (!setTiers.has(setName)) {
        const def = membershipDefs[setName];
        if (!def) continue; // no runtime def -> cannot value this membership pick (strict: never fabricate)
        const byLabel = new Map();
        for (const tier of def.tiers || []) {
          if (tier.pieces_required == null || !(tier.affixes || []).length) continue;
          if (!byLabel.has(tier.pieces_label)) byLabel.set(tier.pieces_label, tier);
        }
        if (!byLabel.size) continue;
        setTiers.set(setName, byLabel);
      }
      hostSets.add(setName);
      if (!setPieces.has(setName)) setPieces.set(setName, []);
      const m = "m" + mmc++;
      extraVars.push(m);
      memberVars.push(m);
      opts.push(m);
      extraConstraints.push(`${m} - ${xv.name} <= 0`);   // only when the host item is equipped
      setPieces.get(setName).push(m);                     // counts toward the set's threshold
      memberMeta.set(m, { host: xv.variant.variant_id, set: setName, station: mslot.station || null });
    }
    if (opts.length) extraConstraints.push(`${opts.join(" + ")} <= 1`); // single membership pick per host
  }

  let sc = 0;
  for (const [setName, byLabel] of setTiers) {
    const pieceVars = setPieces.get(setName) || [];
    if (!pieceVars.length) continue;
    for (const [, tier] of byLabel) {
      const best = new Map();
      for (const a of tier.affixes) {
        const k = `${a.stat}||${_equivType(a.bonus_type)}`;
        if (targetSet.has(a.stat) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
      }
      if (!best.size) continue; // this tier advances no target
      const sa = "s" + sc++;
      extraVars.push(sa);
      setMeta.set(sa, {
        set: setName, pieces_required: tier.pieces_required,
        pieces_label: tier.pieces_label, wiki_url: tier.wiki_url,
        realPieces: pieceVars.filter((p) => !p.startsWith("k")),  // non-joker pieces, for the joker load-bearing check
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
    extraVars, extraConstraints, augMeta, placeMeta, setMeta, dinoMeta, ncMeta, rollMeta, vikMeta, sealMeta, tfMeta, gsMeta, jokerMeta, jokerVars, memberMeta, memberVars, _zc: zc,
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

function encodeStage(program, { objectiveStat, objTerms, sense, locks, tieBreak, extra }) {
  const fb = program.xVars[0].name;
  const L = [sense === "min" ? "Minimize" : "Maximize"];
  if (tieBreak) {
    // Minimize (sense === "min"): summing (i+1)*x deterministically breaks ties among
    // equal-value loadouts. Joker option vars are appended with continuing positive
    // coefficients so a joker is set to 1 only when a locked constraint forces it (it
    // is the load-bearing Nth piece of a completed set), and ties among equally-good
    // pool sets resolve deterministically by option order.
    const n = program.xVars.length;
    // Joker AND membership vars are both minimized here so a wildcard pick or
    // a Cannith/Dino membership pick is set to 1 only when a locked constraint forces it (it is
    // the load-bearing Nth piece of a completed set), resolving ties deterministically.
    const minVars = [...(program.jokerVars || []), ...(program.memberVars || [])];
    const terms = program.xVars.map((xv, i) => `+ ${i + 1} ${xv.name}`)
      .concat(minVars.map((v, i) => `+ ${n + 1 + i} ${v}`));
    L.push(" obj: " + terms.join(" "));
  } else if (objTerms) {
    // Arbitrary linear objective (e.g. the fewer-crafts generator minimizes the sum
    // of the placement binaries). Alternatives-only; the optimum path never sets this.
    L.push(" obj: " + fmtExpr(objTerms, fb));
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
  // Per-solve forced constraints (alternatives: a forced set-active binary, a
  // pinned gain value). Raw LP bodies, injected verbatim; empty for the optimum.
  for (const body of extra || []) L.push(` c${c++}: ${body}`);

  // capped stats: d <= raw (bound d <= cap is in Bounds). With no sources, pin
  // d <= 0 so the cap var cannot float up to its bound under the maximizing objective.
  for (const stat of Object.keys(program.cappedStats)) {
    const raw = rawExpr(program, stat);
    if (raw.length) L.push(` c${c++}: d_${stat} ${fmtExpr(raw.map((t) => ({ coef: -t.coef, name: t.name })), fb)} <= 0`);
    else L.push(` c${c++}: d_${stat} <= 0`);
  }

  for (const lock of locks || []) {
    const terms = effectiveExpr(program, lock.stat);
    // A floor lock (U2, `floor` set) requires at least `value` (`>= value`); a relaxed
    // lock (`give` set, alternatives-only) allows the value to fall by up to `give`
    // (`>= value - give`); an exact lock (the optimum path) pins `= value`.
    if (terms.length) {
      if (lock.floor) L.push(` c${c++}: ${fmtExpr(terms, fb)} >= ${lock.value}`);
      else if (lock.give != null) L.push(` c${c++}: ${fmtExpr(terms, fb)} >= ${lock.value - lock.give}`);
      else L.push(` c${c++}: ${fmtExpr(terms, fb)} = ${lock.value}`);
    }
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

/** Per-target contribution breakdown, derived from the final solution — which
 *  bonus-type stack and which source (worn item / set / augment / craft) produced
 *  each target's achieved value. Reads already-computed internal state (the active
 *  z per bucket + its gate's source meta); it does NOT change the optimization, so
 *  the "presentation only" contract holds. Returns { stat: [{bonus_type, value,
 *  source, sourceKind}], ... }, each list highest-value first. */
function breakdownByTarget(program, prim) {
  const xByName = new Map(program.xVars.map((xv) => [xv.name, xv]));
  // Equipped item identity -> its worn slot, so an item-craft (nc/roll/vik/seal)
  // whose meta carries `item` can be attributed back to the slot it sits in (KTD6).
  const slotOfItem = new Map();
  for (const xv of program.xVars) {
    if (prim(xv.name) > 0.5) {
      const v = xv.variant || {};
      if (v.variant_id != null) slotOfItem.set(v.variant_id, xv.slot);
      if (v.source_item != null && !slotOfItem.has(v.source_item)) slotOfItem.set(v.source_item, xv.slot);
    }
  }
  const sourceOf = (gate) => {
    if (xByName.has(gate)) { const xv = xByName.get(gate); return { kind: "worn", label: xv.variant.variant_id, slot: xv.slot }; }
    const meta = program.setMeta;
    if (meta && meta.has(gate)) {
      const m = meta.get(gate);
      // The equipped pieces currently yielding this set (real, non-joker, worn).
      // Carry both the slot names (for display) AND the host variant_ids (so the
      // per-item "why this" can tell the two Rings apart — they share a slot name).
      const pieces = (m.realPieces || [])
        .filter((pn) => prim(pn) > 0.5)
        .map((pn) => xByName.get(pn))
        .filter(Boolean);
      return {
        kind: "set", label: m.set,
        setYieldingSlots: pieces.map((x) => x.slot),
        hostIds: pieces.map((x) => x.variant.variant_id),
      };
    }
    if (program.sealMeta && program.sealMeta.has(gate)) { const m = program.sealMeta.get(gate); return { kind: "seal", label: `Sealed in ${m.seal_type}`, slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.dinoMeta && program.dinoMeta.has(gate)) return { kind: "dino", label: `${program.dinoMeta.get(gate).dino_type} insert` };
    if (program.ncMeta && program.ncMeta.has(gate)) { const m = program.ncMeta.get(gate); return { kind: "nc", label: "Nearly Completed", slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.rollMeta && program.rollMeta.has(gate)) { const m = program.rollMeta.get(gate); return { kind: "roll", label: "choice slot", slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.vikMeta && program.vikMeta.has(gate)) { const m = program.vikMeta.get(gate); return { kind: "vik", label: `Slot ${m.slot_type} Viktranium augment`, slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.tfMeta && program.tfMeta.has(gate)) { const m = program.tfMeta.get(gate); return { kind: "tf", label: `Thunder-Forged Tier ${m.tier}`, slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.gsMeta && program.gsMeta.has(gate)) { const m = program.gsMeta.get(gate); return { kind: "gs", label: "Green Steel", slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.placeMeta && program.placeMeta.has(gate)) return { kind: "augment", label: program.placeMeta.get(gate).variant_id };
    return { kind: "other", label: gate };
  };
  const out = {};
  for (const stat of program.targetList) {
    const parts = [];
    for (const [key, zs] of program.zByBucket) {
      if (key.split("||")[0] !== stat) continue;
      const bonusType = key.split("||")[1];
      for (const z of zs) {
        if (prim(z.name) > 0.5) {
          const src = sourceOf(z.gates[0]);
          parts.push({
            bonus_type: bonusType, value: z.value, source: src.label, sourceKind: src.kind,
            slot: src.slot != null ? src.slot : null,
            setYieldingSlots: src.setYieldingSlots || null,
            // host variant_id(s) driving this contribution — worn is its own item;
            // sets/crafts carry their hosts; augment/dino are resolved in results.js.
            hostIds: src.hostIds || (src.kind === "worn" ? [src.label] : null),
          });
        }
      }
    }
    parts.sort((a, b) => b.value - a.value);
    out[stat] = parts;
  }
  return out;
}

/** Compute-scale stats for the "what the engine did" readout (R3). */
function computeScale(program) {
  const crafts = (program.augMeta ? program.augMeta.size : 0)
    + (program.dinoMeta ? program.dinoMeta.size : 0) + (program.ncMeta ? program.ncMeta.size : 0)
    + (program.rollMeta ? program.rollMeta.size : 0) + (program.vikMeta ? program.vikMeta.size : 0)
    + (program.sealMeta ? program.sealMeta.size : 0) + (program.memberMeta ? program.memberMeta.size : 0)
    + (program.tfMeta ? program.tfMeta.size : 0) + (program.gsMeta ? program.gsMeta.size : 0);
  return { variants: program.xVars.length, crafts, stages: (program.targetList || []).length + 1 };
}

function readSolution(res, program) {
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  const chosen = program.xVars.filter((xv) => prim(xv.name) > 0.5).map((xv) => ({ slot: xv.slot, variant: xv.variant }));
  const effective = {};
  for (const stat of program.targetList) {
    const raw = rawExpr(program, stat).reduce((sum, t) => sum + (prim(t.name) > 0.5 ? t.coef : 0), 0);
    // For a capped stat, the achieved value is min(cap, raw) — NOT the d_ variable.
    // In the optimum solve d_ is maximized so d_ == min(cap, raw), but an alternative
    // relaxes the lock and leaves d_ floating at its lower bound, which would misreport
    // the true (capped) value and invent a phantom cost. min(cap, raw) is right for both.
    effective[stat] = program.cappedStats[stat] != null ? Math.min(program.cappedStats[stat], raw) : raw;
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
  const tfPlaced = [];
  for (const [n, meta] of program.tfMeta || []) if (prim(n) > 0.5) tfPlaced.push(meta);
  const gsPlaced = [];
  for (const [n, meta] of program.gsMeta || []) if (prim(n) > 0.5) gsPlaced.push(meta);
  // Wildcard joker picks — report a group's chosen set only when the joker is truly
  // load-bearing: the set is active AND its real (non-joker) equipped pieces fall short
  // of the threshold, so the Gem is the completing piece. This holds regardless of solve
  // path (not only the tie-break), so the Gem never claims a set it did not complete.
  const realShort = new Map();  // set name -> was it short on real pieces for some active tier
  for (const [s, meta] of program.setMeta || []) {
    if (prim(s) <= 0.5) continue;
    const realCount = (meta.realPieces || []).reduce((n, p) => n + (prim(p) > 0.5 ? 1 : 0), 0);
    if (realCount < meta.pieces_required) realShort.set(meta.set, true);
  }
  const jokerPlaced = [];
  for (const [j, meta] of program.jokerMeta || []) {
    if (prim(j) > 0.5 && realShort.has(meta.set)) jokerPlaced.push(meta);
  }
  // Set-membership picks (Cannith Repurposing Station / Dino Set-Bonus).
  // Guard on the set being ACTIVE, mirroring the joker's load-bearing guard: on a
  // tieBreak:false solve (every alternatives re-solve) a member var can float to 1
  // for free even when its set never activates, which would prescribe a membership pick that
  // buys nothing. The optimum path minimizes member vars, but the guard must hold on
  // all solve paths — report a membership pick only when its set is actually active.
  const activeSetNames = new Set(setsActive.map((m) => m.set));
  const membershipPlaced = [];
  for (const [m, meta] of program.memberMeta || []) {
    if (prim(m) > 0.5 && activeSetNames.has(meta.set)) membershipPlaced.push(meta);
  }
  return { chosen, effective, augmentsPlaced, setsActive, dinoPlaced, ncPlaced, rollPlaced, vikPlaced, sealPlaced, tfPlaced, gsPlaced, jokerPlaced, membershipPlaced };
}

/** Achieved value of `stat` under a set of floor locks (0 if the solve is not
 *  Optimal or the stat has no sources). Computed directly from the primal — not via
 *  readSolution.effective, which only covers priority targets, so a non-priority
 *  floored stat would read undefined. Used by the U2 floor pre-pass. */
function probeMax(program, highs, stat, locks) {
  const res = highs.solve(encodeStage(program, { objectiveStat: stat, sense: "max", locks }));
  if (res.Status !== "Optimal") return 0;
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  const raw = rawExpr(program, stat).reduce((s, t) => s + (prim(t.name) > 0.5 ? t.coef : 0), 0);
  const cap = program.cappedStats[stat];
  return cap != null ? Math.min(cap, raw) : raw;
}

async function solveLexicographic(model, highs) {
  const program = buildProgram(model);
  if (!program.xVars.length) return { status: "infeasible", reason: "no eligible items for these constraints" };

  const locks = [];
  const perTarget = {};

  // U2 / KTD2 — best-effort per-stat floors. Each floored stat is probed in
  // isolation (max the stat alone); a reachable floor becomes a `>= floor` lock,
  // an unreachable one locks at its achieved max and is reported as a shortfall.
  // Because two individually-reachable floors can be JOINTLY infeasible (they
  // compete for the same slots), after assembling the locks we verify the whole
  // set solves and, if not, relax floors in reverse-priority order until it does —
  // so the solve never bails to infeasible while eligible items exist.
  const floorReport = [];
  const floorEntries = Object.entries(model.floors || {}).filter(([, f]) => f != null && Number(f) > 0);
  if (floorEntries.length) {
    const rankOf = (s) => { const i = program.targetList.indexOf(s); return i === -1 ? Infinity : i; };
    const floors = floorEntries
      .map(([stat, f]) => ({ stat, floor: Number(f), value: 0 }))
      .sort((a, b) => rankOf(a.stat) - rankOf(b.stat)); // highest priority first
    for (const fl of floors) {
      const achieved = probeMax(program, highs, fl.stat, []);
      fl.value = achieved >= fl.floor ? fl.floor : achieved;
    }
    const floorLocks = (list) => list.map((fl) => ({ stat: fl.stat, value: fl.value, floor: true }));
    const probeStat = program.targetList[0] || floors[0].stat;
    const jointOk = () => highs.solve(encodeStage(program, { objectiveStat: probeStat, sense: "max", locks: floorLocks(floors) })).Status === "Optimal";
    for (let i = floors.length - 1; i >= 0 && !jointOk(); i--) {
      // Relax the lowest-priority floor to what is reachable under the others.
      const others = floors.filter((_, j) => j !== i);
      floors[i].value = probeMax(program, highs, floors[i].stat, floorLocks(others));
    }
    const useFloors = jointOk() ? floors : []; // last-resort: drop floors rather than bail
    for (const fl of floors) if (fl.value < fl.floor) floorReport.push({ stat: fl.stat, floor: fl.floor, achieved: fl.value });
    locks.push(...floorLocks(useFloors));
  }

  for (const stat of program.targetList) {
    const res = highs.solve(encodeStage(program, { objectiveStat: stat, sense: "max", locks }));
    if (res.Status !== "Optimal") return { status: "infeasible", reason: `stage ${stat}: ${res.Status}` };
    const { effective } = readSolution(res, program);
    perTarget[stat] = effective[stat];
    locks.push({ stat, value: effective[stat] });
  }

  const tb = highs.solve(encodeStage(program, { sense: "min", tieBreak: true, locks }));
  const finalRes = tb.Status === "Optimal" ? tb : highs.solve(encodeStage(program, { objectiveStat: program.targetList.at(-1), sense: "max", locks }));
  const sol = readSolution(finalRes, program);
  const prim = (name) => (finalRes.Columns[name] ? finalRes.Columns[name].Primal : 0);

  return {
    status: "optimal", perTarget, effective: sol.effective, chosen: sol.chosen,
    augmentsPlaced: sol.augmentsPlaced, setsActive: sol.setsActive,
    dinoPlaced: sol.dinoPlaced, ncPlaced: sol.ncPlaced, rollPlaced: sol.rollPlaced,
    vikPlaced: sol.vikPlaced, sealPlaced: sol.sealPlaced, jokerPlaced: sol.jokerPlaced,
    tfPlaced: sol.tfPlaced, gsPlaced: sol.gsPlaced,
    membershipPlaced: sol.membershipPlaced,
    breakdown: breakdownByTarget(program, prim), computeScale: computeScale(program),
    capped: { ...program.cappedStats }, floorReport, program,
  };
}

// U1 (alternatives) — solve the existing program with relaxed locks + forced
// constraints + a chosen gain objective, then a second tie-break minimize to pin
// the chosen build deterministically (the gain optimize alone is degenerate). Returns
// the same enriched shape solveLexicographic produces (readSolution fields + breakdown
// + capped) so a selected alternative drives the shared renderers unchanged.
// `locks` entries may carry `give` (relaxed: `>= value - give`); `extra` are raw LP
// constraint bodies (e.g. a forced `set_active = 1`); the gain is `objectiveStat`
// (a stat, maximized) or `objTerms` (an arbitrary linear expression, e.g. minimized
// craft-placement binaries).
function solveConstrained(program, highs, { objectiveStat, objTerms, sense = "max", locks = [], extra = [], tieBreak = true }) {
  const fb = program.xVars[0].name;
  // Phase 1: optimize the gain under the relaxed/forced constraints.
  const r1 = highs.solve(encodeStage(program, { objectiveStat, objTerms, sense, locks, extra }));
  if (r1.Status !== "Optimal") return { status: "infeasible" };
  // The tie-break is a second full solve. It canonicalizes the build among equal-objective
  // vertices, but HiGHS is already deterministic for identical input, so the optimum path
  // keeps it (stable display) while on-demand alternatives skip it to halve solve count.
  if (!tieBreak) {
    const prim1 = (name) => (r1.Columns[name] ? r1.Columns[name].Primal : 0);
    return { status: "optimal", ...readSolution(r1, program), breakdown: breakdownByTarget(program, prim1), capped: { ...program.cappedStats } };
  }
  const prim1 = (name) => (r1.Columns[name] ? r1.Columns[name].Primal : 0);
  // Pin the achieved gain, then tie-break so the item set (not just the objective
  // value) is deterministic — mirroring solveLexicographic's final tie-break stage.
  let locks2 = locks, pin = [];
  if (objTerms) {
    const gainVal = Math.round(objTerms.reduce((s, t) => s + t.coef * prim1(t.name), 0));
    pin = [`${fmtExpr(objTerms, fb)} = ${gainVal}`];
  } else {
    const gainVal = readSolution(r1, program).effective[objectiveStat] ?? 0;
    locks2 = [...locks, { stat: objectiveStat, value: gainVal }];
  }
  const r2 = highs.solve(encodeStage(program, { tieBreak: true, sense: "min", locks: locks2, extra: [...extra, ...pin] }));
  const res = r2.Status === "Optimal" ? r2 : r1;
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  const sol = readSolution(res, program);
  return { status: "optimal", ...sol, breakdown: breakdownByTarget(program, prim), capped: { ...program.cappedStats } };
}

// The bounded give allowed on a priority for an alternative: 10% or at least 2, so
// the tolerance scales with the stat (Constitution ~40 vs Physical Sheltering ~150).
function alternativeGive(value) { return Math.max(2, Math.round(0.10 * Math.abs(value))); }
// Set activation is a categorical, high-value gain worth a more generous give, but
// still bounded so it doesn't crater the other priorities (an unbounded set trade
// produced -144 builds). 50% keeps it a real trade and drops the garbage ones fast.
function setGive(value) { return Math.max(3, Math.round(0.50 * Math.abs(value))); }

// Do two solutions equip the same item set? (build-equality for the zero-cost check.)
function sameChosen(a, b) {
  const key = (s) => s.chosen.map((c) => `${c.slot}:${c.variant.variant_id}`).sort().join("|");
  return key(a) === key(b);
}

// Distinct affix/scaling stats an item can carry (for unranked-stat candidates).
function modelStats(model) {
  const s = new Set();
  const add = (v) => {
    for (const a of v.affixes || []) if (a.value > 0) s.add(a.name);
    for (const sc of v.scaling || []) s.add(sc.stat);
  };
  for (const slot of model.worn || []) for (const v of slot.variants || []) add(v);
  for (const a of model.augments || []) add(a);
  return s;
}

// U2 (alternatives) — produce candidate trade-off builds, one family per gain axis,
// each a re-solve over the optimum's program (or, for unranked stats, a program
// rebuilt to model that stat, since `buildProgram` only tracks the ranked targets).
// Returns raw candidates `{ sol, gainAxis, meta }`; dedupe/analysis/ranking is U3.
// `opts.cap` bounds the per-axis re-solve budget so on-demand generation stays fast.
function generateAlternatives(optimum, model, highs, opts = {}) {
  const program = optimum.program;
  const targets = program.targetList;              // ranked priorities, in order
  const per = optimum.perTarget || optimum.effective;
  // Caps bound the on-demand generation latency: each candidate is a full MILP solve
  // (~1s cold on a real dataset), so the generators are capped and skip the tie-break
  // second solve (tieBreak:false) — HiGHS is deterministic without it.
  const cap = { sets: 2, unranked: 2, rebalance: 6, ...(opts.cap || {}) };
  const out = [];

  // (a) set-activation — force each not-yet-active set active and maximize the top
  // priority, but keep the other priorities within a generous-yet-bounded give
  // (setGive) so completing a set stays a real trade instead of cratering the build.
  // A set that cannot fit inside that give is proven infeasible fast and dropped.
  const active = new Set((optimum.setsActive || []).map((s) => s.set));
  const setLocks = targets.map((s) => ({ stat: s, value: per[s], give: setGive(per[s]) }));
  const seenSets = new Set();
  let sCount = 0, sTries = 0;
  for (const [setVar, meta] of program.setMeta || []) {
    if (sCount >= cap.sets || sTries >= cap.sets * 3) break;   // bound both hits and infeasible probes
    if (active.has(meta.set) || seenSets.has(meta.set)) continue;
    seenSets.add(meta.set);
    sTries++;
    const sol = solveConstrained(program, highs, { objectiveStat: targets[0], locks: setLocks, extra: [`${setVar} = 1`], tieBreak: false });
    if (sol.status === "optimal" && !sameChosen(sol, optimum)) { out.push({ sol, gainAxis: "set", meta: { set: meta.set } }); sCount++; }
  }

  // (b) rebalance — relax ONLY the higher priority being traded from (by its give),
  // keep the priorities ABOVE the maximized one pinned at optimum, and maximize a
  // lower priority (which must be left unlocked so it can rise). Bounded: the pair
  // space is C(n,2), so with many targets it is capped to keep generation interactive.
  let rCount = 0;
  outer:
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      if (rCount >= cap.rebalance) break outer;
      rCount++;
      const locks = targets.slice(0, j).map((s, k) => (k === i
        ? { stat: s, value: per[s], give: alternativeGive(per[s]) }
        : { stat: s, value: per[s] }));
      const sol = solveConstrained(program, highs, { objectiveStat: targets[j], locks, tieBreak: false });
      // Only a real trade: the traded-to priority must actually rise above the optimum.
      if (sol.status === "optimal" && !sameChosen(sol, optimum) && (sol.effective[targets[j]] ?? 0) > (per[targets[j]] ?? 0))
        out.push({ sol, gainAxis: "rebalance", meta: { from: targets[i], to: targets[j] } });
    }
  }

  // (c) unranked-stat — the program does not model non-target stats, so rebuild it with
  // the candidate stat appended as a target, lock the original targets at optimum, and
  // maximize the stat (a zero-cost strict improvement); if that just re-finds the
  // optimum, relax the lowest priority and try once more.
  const targetSet = new Set(targets);
  const unrankedCandidates = [...modelStats(model)].filter((s) => !targetSet.has(s)).slice(0, cap.unranked);
  const originalExact = targets.map((s) => ({ stat: s, value: per[s] }));
  for (const u of unrankedCandidates) {
    const p2 = buildProgram({ ...model, targets: [...model.targets, u] });
    if (!p2.xVars.length) continue;
    let sol = solveConstrained(p2, highs, { objectiveStat: u, locks: originalExact, tieBreak: false });
    let zeroCost = true;
    if (sol.status === "optimal" && sameChosen(sol, optimum) && targets.length) {
      zeroCost = false;
      const relaxLowest = originalExact.map((l, k) => (k === originalExact.length - 1 ? { ...l, give: alternativeGive(l.value) } : l));
      sol = solveConstrained(p2, highs, { objectiveStat: u, locks: relaxLowest, tieBreak: false });
    }
    if (sol.status === "optimal" && !sameChosen(sol, optimum)) out.push({ sol, gainAxis: "unranked", meta: { stat: u, zeroCost } });
  }

  // (d) fewer-crafts — minimize the sum of craft-placement binaries, allowing a bounded
  // give on the priorities (only when the optimum actually uses crafts).
  const craftVars = [
    ...(program.augMeta ? program.augMeta.keys() : []), ...(program.dinoMeta ? program.dinoMeta.keys() : []),
    ...(program.ncMeta ? program.ncMeta.keys() : []), ...(program.vikMeta ? program.vikMeta.keys() : []),
    ...(program.sealMeta ? program.sealMeta.keys() : []),
  ];
  const optCrafts = (optimum.augmentsPlaced || []).length + (optimum.dinoPlaced || []).length
    + (optimum.ncPlaced || []).length + (optimum.vikPlaced || []).length + (optimum.sealPlaced || []).length;
  if (craftVars.length && optCrafts > 0) {
    const relaxedAll = targets.map((s) => ({ stat: s, value: per[s], give: alternativeGive(per[s]) }));
    const objTerms = craftVars.map((name) => ({ coef: 1, name }));
    const sol = solveConstrained(program, highs, { objTerms, sense: "min", locks: relaxedAll, tieBreak: false });
    const solCrafts = sol.status === "optimal"
      ? (sol.augmentsPlaced || []).length + (sol.dinoPlaced || []).length
        + (sol.ncPlaced || []).length + (sol.vikPlaced || []).length + (sol.sealPlaced || []).length
      : optCrafts;
    // Only surface when it genuinely uses fewer crafts (a same-count different build
    // would headline "0 fewer crafting steps").
    if (sol.status === "optimal" && !sameChosen(sol, optimum) && solCrafts < optCrafts) out.push({ sol, gainAxis: "crafts", meta: { optCrafts } });
  }

  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildProgram, encodeStage, effectiveExpr, rawExpr, solveLexicographic, solveConstrained, generateAlternatives, alternativeGive, sameChosen, scaleAt, breakdownByTarget, computeScale, slotConstraintBodies };
}
