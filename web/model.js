// U6 — solver model builder + dominance pre-filter.
//
// Turns (dataset variants, query) into an abstract MILP the LP encoder (U7)
// consumes. Pure JS, node-testable without HiGHS. The two exactness-preserving
// reductions here are the eligibility pre-filter and the per-slot dominance
// (Pareto) pre-filter keyed to the query targets (KTD7).

const WORN_SLOTS = [
  "Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak",
  "Belt", "Ring", "Gloves", "Boots", "Bracers", "Quiver",
];
const SLOT_CARDINALITY = { Ring: 2 }; // one of every other worn slot

// Approximate DDO max-dodge by armor type (configurable; the mechanism is what
// matters, not the exact cap). null = uncapped for this query.
const ARMOR_DODGE_CAP = { cloth: 25, light: 25, medium: 11, heavy: 4 };

/** Resolve an ML-scaling affix to its value at the query ML cap. */
function scaledValue(s, mlCap) {
  if (mlCap <= s.ml_lo) return s.val_lo;
  if (mlCap >= s.ml_hi) return s.val_hi;
  const t = (mlCap - s.ml_lo) / (s.ml_hi - s.ml_lo);
  return Math.round(s.val_lo + (s.val_hi - s.val_lo) * t);
}

/** Map of "stat||type" -> best value this variant provides for a target stat. */
function variantBuckets(variant, targetSet, mlCap) {
  const b = new Map();
  const put = (stat, type, val) => {
    if (!targetSet.has(stat)) return;
    const key = `${stat}||${type}`;
    if (!b.has(key) || b.get(key) < val) b.set(key, val);
  };
  for (const a of variant.affixes || []) put(a.stat, a.bonus_type, a.value);
  for (const s of variant.scaling || []) put(s.stat, s.bonus_type, scaledValue(s, mlCap));
  return b;
}

/** Set names this variant belongs to. */
function variantSets(variant) {
  return new Set((variant.set_bonus || []).map((s) => s.set).filter(Boolean));
}

/** Augment-slot colors this variant carries (worn items only). */
function variantAugColors(variant) {
  return (variant.augment_slots || []).filter(Boolean);
}

function eligible(variants, query) {
  const cap = query.mlCap;
  return variants.filter((v) => {
    if (v.verification !== "verified") return false;
    if (v.minimum_level != null && v.minimum_level > cap) return false;
    // class/race restrictions are fail-open until sourced (R18 / plan assumption)
    if (query.classRace && v.restrictions && v.restrictions !== "unknown") {
      // structured restrictions would be checked here; none exist in the seed yet
    }
    return true;
  });
}

/** Does A dominate B in the same slot? A must be >= on every bucket, superset
 *  of sets, and >= augment colors. Dominated variants are never optimal. */
function dominates(A, B, targetSet, mlCap) {
  const ba = variantBuckets(A, targetSet, mlCap);
  const bb = variantBuckets(B, targetSet, mlCap);
  for (const [key, vb] of bb) {
    if ((ba.get(key) || 0) < vb) return false;
  }
  const sa = variantSets(A);
  for (const s of variantSets(B)) if (!sa.has(s)) return false;
  // augment-color multiset: A must have at least as many of each color
  const ca = countColors(variantAugColors(A));
  const cb = countColors(variantAugColors(B));
  for (const [color, n] of cb) if ((ca.get(color) || 0) < n) return false;
  // Dino-slot multiset: A must have at least as many typed Dino slots as B, or a
  // Dinosaur Bone blank (whose value is entirely its Dino slots) would be pruned
  // by any affix-bearing item in the same slot and its insert capacity lost.
  const da = countColors(A.dino_slots_norm || []);
  const db = countColors(B.dino_slots_norm || []);
  for (const [type, n] of db) if ((da.get(type) || 0) < n) return false;
  // Nearly-Complete choice-slot: B can craft an option A cannot unless A offers
  // the same category+tier slot, so an intrinsic win must not prune B's craft.
  if (B.nearly_complete && (A.nearly_complete !== B.nearly_complete
      || ncTier(A) !== ncTier(B))) return false;
  // Roll-group choice-slot: a roll option's value lives in roll_groups, NOT in
  // variantBuckets, so a choice-slot item looks value-less to the bucket check.
  // Keep B whenever it offers a target-relevant option A cannot also offer.
  const rb = rollOptionKeys(B, targetSet);
  if (rb.size) {
    const ra = rollOptionKeys(A, targetSet);
    for (const k of rb) if (!ra.has(k)) return false;
  }
  // Viktranium ("Lamordia") typed choice-slot: the craftable value lives in
  // lamordia_slots (a (type, category) pool at the host's tier), outside
  // variantBuckets — so a slotted host looks value-less to the bucket check.
  // A must offer at least as many of each (type, category, tier) slot as B, or
  // B's craft capacity would be wrongly pruned (the same trap as Dino blanks).
  const va = countColors(lamordiaSlotKeys(A));
  const vb = countColors(lamordiaSlotKeys(B));
  for (const [k, n] of vb) if ((va.get(k) || 0) < n) return false;
  // Seal ("Sealed in X") single-pick choice-slot: the unseal value lives in
  // seal_slots (keyed by seal_type), outside variantBuckets — so a sealed host
  // looks value-less to the bucket check. A must offer at least as many of each
  // seal_type slot as B, or B's unseal capacity would be wrongly pruned (the same
  // trap as Dino blanks / Lamordia hosts).
  const sealA = countColors((A.seal_slots || []).map((s) => s.seal_type));
  const sealB = countColors((B.seal_slots || []).map((s) => s.seal_type));
  for (const [k, n] of sealB) if ((sealA.get(k) || 0) < n) return false;
  // Thunder-Forged multi-tier choice-slot: the craftable value lives in
  // thunder_forged_tiers (a list of tier slots), outside variantBuckets — so a
  // slot-only TF host would be pruned by any affix rival. A must offer at least as
  // many of each tier slot as B (same trap as Viktranium/Seal hosts).
  const tfA = countColors((A.thunder_forged_tiers || []).map((s) => s.tier));
  const tfB = countColors((B.thunder_forged_tiers || []).map((s) => s.tier));
  for (const [k, n] of tfB) if ((tfA.get(k) || 0) < n) return false;
  // Green Steel single-pick choice-slot: its craftable value lives in green_steel_slot
  // (a presence marker), outside variantBuckets — a GS host must not be pruned by an
  // affix rival that lacks the slot.
  if (B.green_steel_slot && !A.green_steel_slot) return false;
  // Wildcard set-piece (Gem of Many Facets) joker: its set-completion value lives in
  // joker_set_groups (pools of sets it can complete toward a threshold), outside
  // variantBuckets AND outside set_bonus (the build clears the Gem's fixed set). So a
  // plain-affix item looks strictly better and would prune the Gem, silently killing
  // the wildcard. Keep B whenever it offers joker set-options A does not also offer.
  const jokerA = countColors((A.joker_set_groups || []).flat());
  const jokerB = countColors((B.joker_set_groups || []).flat());
  for (const [k, n] of jokerB) if ((jokerA.get(k) || 0) < n) return false;
  // Chosen set-membership slot (Vecna "Lost Purpose" / Dino Set-Bonus): the awaken
  // value lives in set_membership_slot.pool (which sets the host can join toward a
  // threshold), outside variantBuckets AND set_bonus — so a plain-affix item looks
  // strictly better and would prune a slot-only Lost Purpose host, silently losing its
  // awaken capacity (the same trap as Dino blanks / the Gem joker). Keep B whenever it
  // can awaken a set A cannot also awaken.
  const memA = countColors(((A.set_membership_slot || {}).pool) || []);
  const memB = countColors(((B.set_membership_slot || {}).pool) || []);
  for (const [k, n] of memB) if ((memA.get(k) || 0) < n) return false;
  // strictly better somewhere, OR keep A as the canonical of an equal pair
  return true;
}

/** Target-relevant options an item offers via its roll groups (choose-one
 *  slots). Keyed stat||type||value so an equal option counts as covered. */
function rollOptionKeys(v, targetSet) {
  const s = new Set();
  for (const g of v.roll_groups || [])
    for (const o of g.options || [])
      if (targetSet.has(o.stat) && o.value > 0) s.add(`${o.stat}||${o.bonus_type}||${o.value}`);
  return s;
}

function countColors(colors) {
  const m = new Map();
  for (const c of colors) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

/** A Nearly-Complete host's tier: explicit nc_tier, else derived from ML
 *  (Legendary only at ML>=35). Matches the solver's derivation. */
function ncTier(v) {
  return v.nc_tier || ((v.minimum_level || 0) >= 35 ? "legendary" : "heroic");
}

/** A Viktranium ("Lamordia") host's tier, derived from host ML. Viktranium's two
 *  documented tiers are Heroic (recipe ML8/11) and Legendary (recipe ML34) — so
 *  the boundary sits at DDO's Heroic->Legendary split (ML30), NOT NC's ML35: a
 *  legendary Viktranium host is ML34, and gating legendary on ML>=35 would
 *  mis-tier every real host heroic and make the entire legendary pool
 *  unreachable. This is the SINGLE source of truth — the solver and browse layers
 *  derive tier from this function, never a re-inlined threshold. */
function lamordiaTier(v) {
  return (v.minimum_level || 0) >= 30 ? "legendary" : "heroic";
}

/** A host's typed Lamordia slots as a `type||category||tier` multiset key list,
 *  so the dominance guard and the solver agree on which pool a slot draws from. */
function lamordiaSlotKeys(v) {
  const tier = lamordiaTier(v);
  return (v.lamordia_slots || []).map((s) => `${s.type}||${s.category}||${tier}`);
}

/** Per-slot Pareto filter: keep only non-dominated variants for these targets.
 *  In a multi-pick slot (cardinality > 1, e.g. two Rings), a set-member variant
 *  can add a piece toward a set THRESHOLD even when another variant dominates it
 *  on the target buckets — set bonuses count pieces, so dominance (which is only
 *  sound for max-buckets) must never prune a set member there, or a piece-count
 *  tier can become silently unreachable. A chosen set-membership host (Lost Purpose /
 *  Dino Set-Bonus) is a set-piece contributor for the same reason, so it gets the same
 *  multi-pick exemption. */
function dominanceFilter(slotVariants, targetSet, mlCap, cardinality = 1) {
  const kept = [];
  for (let i = 0; i < slotVariants.length; i++) {
    const A = slotVariants[i];
    const isSetContributor = (A.set_bonus || []).length
      || ((A.set_membership_slot || {}).pool || []).length;
    if (cardinality > 1 && isSetContributor) { kept.push(A); continue; }
    let dominated = false;
    for (let j = 0; j < slotVariants.length; j++) {
      if (i === j) continue;
      const B = slotVariants[j];
      // B dominates A, and to break exact ties keep the lower index
      if (dominates(B, A, targetSet, mlCap) && !(dominates(A, B, targetSet, mlCap) && i < j)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(A);
  }
  return kept;
}

/** Build the abstract model. Returns worn slots (filtered + pruned), the
 *  augment source pool, the Dino insert pool, target list, and the dodge cap. */
function buildModel(variants, query, dinoInserts = [], nearlyComplete = [], viktranium = [], seal = [], membershipSetDefs = {}, thunderForged = [], greenSteel = []) {
  const targetSet = new Set(query.targets);
  const mlCap = query.mlCap;
  const elig = eligible(variants, query);

  const worn = [];
  for (const slotName of WORN_SLOTS) {
    const card = SLOT_CARDINALITY[slotName] || 1;
    let cands = elig.filter((v) => v.slot === slotName);
    cands = dominanceFilter(cands, targetSet, mlCap, card);
    if (cands.length) {
      worn.push({ slot: slotName, cardinality: card, variants: cands });
    }
  }

  // One main-hand weapon: all weapon-category variants compete for a single slot
  // so the solver can never equip several weapons at once. Rune-arm is a separate
  // off-hand slot.
  const mainHand = dominanceFilter(elig.filter((v) => v.category === "weapon"), targetSet, mlCap);
  if (mainHand.length) worn.push({ slot: "Main Hand", cardinality: 1, variants: mainHand });
  const runeArm = dominanceFilter(elig.filter((v) => v.category === "runearm"), targetSet, mlCap);
  if (runeArm.length) worn.push({ slot: "Rune Arm", cardinality: 1, variants: runeArm });

  // Augment pool: augments (category augment) as a compatible-color-capacity
  // source pool. The solver (U3) places each augment at most once, into one
  // COMPATIBLE slot color (the baked wiki matrix — multi-fit), with per-color
  // placements bounded by the open slots on equipped worn items. Dominance is per
  // intrinsic COLOR — different-colored augments are kept separate so one never
  // wrongly prunes the sole source in a color (conservative under multi-fit: it
  // may keep an extra host, never drop a color another slot needs).
  const augByColor = new Map();
  for (const a of elig.filter((v) => v.category === "augment")) {
    const color = (a.aug_color || {}).color;
    if (!color) continue; // quarantined color: no exact slot to place into
    if (!augByColor.has(color)) augByColor.set(color, []);
    augByColor.get(color).push(a);
  }
  const augments = [];
  for (const [, group] of augByColor) {
    augments.push(...dominanceFilter(group, targetSet, mlCap));
  }

  const dodgeCap = query.armorType && targetSet.has("Dodge")
    ? (ARMOR_DODGE_CAP[query.armorType] ?? null) : null;

  // Dino insert pool: each record is an insert UNIT keyed by (dino_type,
  // category) carrying one or more affixes (KTD4). Keep a unit when ANY of its
  // affixes advances a ranked target — the rest add solver vars with no benefit.
  // The solver caps total placements per (type, category) key by the open typed
  // slots on equipped items, and gates a multi-affix unit all-or-nothing.
  const dinoAdvances = (i) => {
    const affixes = (i.affixes && i.affixes.length)
      ? i.affixes
      : (i.stat ? [{ stat: i.stat, value: i.value }] : []);
    return affixes.some((a) => targetSet.has(a.stat) && a.value > 0);
  };
  const dinoPool = (dinoInserts || []).filter((i) => i && dinoAdvances(i));

  // U81 Nearly Complete: the parametric option pool. Keep only options that
  // advance a ranked target; the solver attaches them per item via the item's
  // `nearly_complete` category + tier.
  const ncPool = (nearlyComplete || []).filter((o) => o && targetSet.has(o.stat) && o.value > 0);

  // U81 Viktranium ("Lamordia"): the typed option pool keyed by (slot_type,
  // category, tier). Keep only options advancing a ranked target; the solver
  // attaches them per host via the item's `lamordia_slots` at the host's tier.
  const vikPool = (viktranium || []).filter((o) => o && targetSet.has(o.stat) && o.value > 0);

  // Seal slots ("Sealed in X"): the single-pick option pool keyed by seal_type.
  // Keep only options advancing a ranked target; the solver unseals one option
  // per host seal slot via the item's `seal_slots`.
  const sealPool = (seal || []).filter((o) => o && targetSet.has(o.stat) && o.value > 0);
  // Thunder-Forged (tier-keyed) + Green Steel (flat) choice-slot pools, kept to
  // target-advancing options only; the solver attaches them per host via the marker.
  const tfPool = (thunderForged || []).filter((o) => o && targetSet.has(o.stat) && o.value > 0);
  const gsPool = (greenSteel || []).filter((o) => o && targetSet.has(o.stat) && o.value > 0);

  return {
    query, targets: query.targets, worn, augments,
    dinoInserts: dinoPool, nearlyComplete: ncPool, viktranium: vikPool, seal: sealPool,
    thunderForged: tfPool, greenSteel: gsPool,
    membershipSetDefs: membershipSetDefs || {},
    dodgeCap, mlCap,
  };
}

// exports for node tests; harmless in the browser
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildModel, eligible, dominanceFilter, dominates,
    variantBuckets, variantSets, scaledValue, ncTier, lamordiaTier, lamordiaSlotKeys,
    WORN_SLOTS, SLOT_CARDINALITY, ARMOR_DODGE_CAP,
  };
}
