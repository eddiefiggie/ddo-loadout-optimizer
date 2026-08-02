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

// U4b-i — stacking-equivalence. gear-planner's native affix `type` IS the
// stacking bucket, verbatim, EXCEPT curated pairs that do not stack independently
// in-game and must share ONE bucket (e.g. "Insight Natural" -> "Insight", "Primal
// Natural" -> "Primal"). The map is emitted into items.json `metadata.stacking_
// equivalence` and installed here (dataset.js calls setStackEquiv on load). The
// affix keeps its native `type` for DISPLAY; only the stacking BUCKET KEY formed
// from a `type` is canonicalized through equivType — so two items typed "Insight
// Natural" and "Insight" (same stat) land in one bucket and do NOT double-count.
let _STACK_EQUIV = Object.create(null);
function setStackEquiv(map) {
  _STACK_EQUIV = Object.create(null);
  if (map && typeof map === "object") {
    for (const k of Object.keys(map)) _STACK_EQUIV[k] = map[k];
  }
}
/** Canonicalize an affix `type` to its stacking bucket token (identity unless the
 *  curated equivalence table remaps it). Used ONLY to form bucket keys. */
function equivType(type) {
  return (type != null && _STACK_EQUIV[type] != null) ? _STACK_EQUIV[type] : type;
}

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
    const key = `${stat}||${equivType(type)}`;
    if (!b.has(key) || b.get(key) < val) b.set(key, val);
  };
  for (const a of variant.affixes || []) put(a.name, a.type, a.value);
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

// Warforged/Bladeforged wear a Docent in the body slot instead of armor.
const FORGED_RACES = new Set(["warforged", "bladeforged", "battleforged"]);
function isForgedRace(race) {
  return !!race && FORGED_RACES.has(String(race).toLowerCase());
}
/** Docent detection: the native schema's `type` is authoritative ("Docents"), with
 *  the name regex kept as a fallback for records that predate the type field. (A
 *  name-only check missed docents like "Legendary Scale-Stone of Avarice" that carry
 *  no "docent" in their name, leaking them past the R6 race gate to non-Forged
 *  characters and the druidic oath.) */
function isDocent(v) {
  return v.type === "Docents" ||
    /\bdocent\b/i.test(v.source_item || v.variant_id || v.name || "");
}

// U1/U2 — weapon/off-hand taxonomy, resolved across runtimes (browser global vs
// node require), mirroring dataset.js's installStackEquiv bridge.
function _taxonomy() {
  if (typeof WeaponTaxonomy !== "undefined") return WeaponTaxonomy;
  if (typeof require !== "undefined") {
    try { return require("./weapon-taxonomy.js"); } catch (e) { /* absent: no-op */ }
  }
  return null;
}
/** Allowed Main Hand weapon types for a query, or null (any). A picked
 *  `weaponTypes` set wins (already a subset of the chosen style); otherwise the
 *  style's whole handedness bucket constrains (so THF excludes one-handers even
 *  with no explicit type pick). */
function allowedWeaponTypes(query) {
  if (Array.isArray(query.weaponTypes) && query.weaponTypes.length) return query.weaponTypes;
  if (query.style) {
    const T = _taxonomy();
    if (T) return T.weaponTypesForStyle(query.style);
  }
  return null;
}
/** Allowed OFF-HAND weapon types (two-weapon fighting), or null when no off-hand
 *  weapon is permitted. TWF is one-hand-style only and OPT-IN: it turns on when the
 *  player picks at least one off-hand weapon type. */
function allowedOffHandWeaponTypes(query) {
  const T = _taxonomy();
  if (!T || !T.twfWeaponAllowedForStyle(query.style)) return null;
  const set = Array.isArray(query.offHandWeapons) ? query.offHandWeapons : [];
  return set.length ? set : null;
}
/** Can this weapon fill the Main Hand under the query's main-hand lock? Untyped
 *  hosts (Dino Bone Weapon) always can. */
function mainHandWeaponOk(v, weaponAllow) {
  return v.type == null || !weaponAllow || weaponAllow.includes(v.type);
}
/** Can this weapon fill the Off Hand as a TWF second weapon? Requires a concrete
 *  type match: an untyped host (unknown handedness — it could be crafted two-handed,
 *  which can't be dual-wielded) is NOT offered as an off-hand weapon. It stays a Main
 *  Hand option via the main-hand fail-open. */
function offHandWeaponOk(v, offWeaponAllow) {
  return offWeaponAllow != null && v.type != null && offWeaponAllow.includes(v.type);
}
/** Off-hand gate for a query: `{ blocked }` when no off-hand item may be equipped
 *  (THF/bow style, only "empty" chosen, or a style that permits none), else
 *  `{ allowed }` — the allowed off-hand `type` list, or null for any. The style's
 *  own restriction (e.g. crossbow => rune arm only) intersects the player's picks. */
function offHandGate(query) {
  const T = _taxonomy();
  const EMPTY = T ? T.OFF_HAND_EMPTY : "empty";
  if (query.style && T && !T.offHandEnabledForStyle(query.style)) return { blocked: true };
  const styleAllowed = (query.style && T && T.offHandTypesForStyle) ? T.offHandTypesForStyle(query.style) : null;
  const set = Array.isArray(query.offHand) ? query.offHand : [];
  const items = set.filter((t) => t !== EMPTY);
  if (set.length && !items.length) return { blocked: true }; // only "empty": no off-hand item
  // Player picks (if any) constrain within the style's allowance; otherwise the
  // style's allowance is the whole permitted set (null => any type).
  let allowed = items.length ? items : null;
  if (styleAllowed != null) allowed = allowed ? allowed.filter((t) => styleAllowed.includes(t)) : styleAllowed.slice();
  if (Array.isArray(allowed) && !allowed.length) return { blocked: true };
  return { blocked: false, allowed };
}

// Character gate (U2). Every branch below is ADDITIVE and backward-compatible:
// it only narrows the pool when the relevant query field is present AND the
// variant carries concrete data. With the current query (no race/alignment) and
// dataset (armor_type all "unknown", no alignment_req), every new branch is a
// no-op, so live behavior is unchanged until the wizard supplies the fields and
// the pipeline (U3) fills the data.
// U1 — Query-derived gate context, computed once per query so `eligible()` (which
// runs over thousands of variants) does not recompute the style/off-hand sets per
// item. `variantConflict` accepts it precomputed, or derives it on demand for the
// handful of calls `pinConflict` makes.
function queryGates(query) {
  return {
    cap: query.mlCap,
    floor: query.mlFloor,                                  // optional item-level floor
    forged: isForgedRace(query.race),
    weaponAllow: allowedWeaponTypes(query),                // main-hand set | null
    offWeaponAllow: allowedOffHandWeaponTypes(query),      // off-hand weapon set | null
    offHand: offHandGate(query),                           // { blocked } | { allowed }
  };
}

// U1/B4 — THE single per-variant gate list. Returns `null` when the variant is
// equippable under the query, else a short human reason. `eligible()` filters on
// `=== null`, so this is the one authority; `pinConflict` re-exports it, and the
// B4 inline flag therefore reports exactly the gates the solver enforces (alignment
// included) — no hand-mirrored copy that can drift. Order and predicates mirror the
// former inline `eligible()` body verbatim; behavior is preserved.
function variantConflict(v, query, gates) {
  const g = gates || queryGates(query);
  // Verification: a gate for the solver's filter. Never surfaces from a pin because
  // the picker only offers verified items (KTD3), but kept here for eligible() parity.
  if (v.verification !== "verified") return "this item isn't verified";
  if (v.ml != null && v.ml > g.cap) return `above your ML ${g.cap} cap`;
  if (g.floor != null && v.ml != null && v.ml < g.floor) return `below your ML ${g.floor} floor`;

  // R8 — Weapon-type / style lock. A weapon stays eligible if it can serve EITHER
  // hand: the main-hand lock, or (TWF) the off-hand-weapon lock. Untyped weapon
  // hosts (the Dino Bone Weapon, `type == null`) can't be matched, so they pass.
  if (v.category === "weapon" &&
      !mainHandWeaponOk(v, g.weaponAllow) && !offHandWeaponOk(v, g.offWeaponAllow))
    return "not equippable with your combat style";

  // R9/B5 — Off-hand configuration: block every off-hand item under a two-hand
  // style or an "empty"-only pick; otherwise keep only the allowed off-hand types.
  if (v.slot === "Off Hand") {
    if (g.offHand.blocked) return "can't be used in the off hand with this style";
    if (g.offHand.allowed && !g.offHand.allowed.includes(v.type))
      return "not a valid off-hand type for this style";
  }

  // R6/AE1 — Race → body slot: Forged races take docents; others cannot.
  if (v.slot === "Armor" && query.race) {
    const doc = isDocent(v);
    if (g.forged && !doc) return "Forged races equip a docent, not body armor";
    if (!g.forged && doc) return "docents are for Forged races";
  }

  // R7 — Armor-type proficiency: keep only body armor whose concrete armor_type
  // is in the character's proficiency set. Gated on the dedicated wizard field
  // `armorTypes` (an array of allowed types) — NOT on `query.armorType`, which
  // is the live dodge-cap input; decoupling avoids silently excluding armor if
  // the pipeline later stamps armor_type onto items[]. Fail-open on
  // "unknown"/absent, and a heavy-proficient character passes lighter types too.
  if (v.slot === "Armor" && !isDocent(v) &&
      Array.isArray(query.armorTypes) && query.armorTypes.length &&
      v.armor_type && v.armor_type !== "unknown" &&
      !query.armorTypes.includes(v.armor_type)) return "armor type not in your proficiency";

  // R7/AE2 — Alignment: exclude items whose alignment requirement the
  // character does not meet. Fail-open until alignment_req is sourced (U3).
  if (query.alignment && Array.isArray(v.alignment_req) && v.alignment_req.length &&
      !v.alignment_req.includes(query.alignment)) return "doesn't match your alignment";

  // R2/AE2 — Artifact opt-in: unless the player checked "Include an Artifact",
  // no Artifact-quality item is considered. Absent flag => non-Artifact (KTD5),
  // so this is a no-op until the seed is populated AND the box is checked.
  if (v.artifact && !query.includeArtifact) return 'needs the "Include an Artifact" option';

  return null;
}

// U1 — advisory per-item flag for pre-solve pinning (B4). Same gate list the solver
// enforces; returns null (equippable) or a reason string. Thin wrapper so the UI has
// a stable name distinct from the solver-facing helper.
function pinConflict(v, query) {
  return variantConflict(v, query);
}

// U2 — THE single normalize path for a slot's pin(s). A slot constraint pins ONE
// item via `variant_id` (single-cardinality slots) OR several via `variant_ids`
// (the Ring slot, cardinality 2 — two different rings). Returns the list of pinned
// variant ids (empty for non-pin/empty/free). Every slotConstraints reader routes
// through this so single- and list-shaped pins can never be read inconsistently.
function pinnedVariantIds(c) {
  if (!c || c.type !== "pin") return [];
  if (Array.isArray(c.variant_ids)) return c.variant_ids.filter((id) => id != null);
  if (c.variant_id != null) return [c.variant_id];
  return [];
}

function eligible(variants, query) {
  const gates = queryGates(query);
  return variants.filter((v) => variantConflict(v, query, gates) === null);
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
  // Chosen set-membership slot (Vecna Lost Purpose / Dinosaur Bone Set Bonus): the
  // set-membership value lives in set_membership_slot.pool (which sets the host can
  // join toward a threshold), outside variantBuckets AND set_bonus — so a plain-affix
  // item looks strictly better and would prune a slot-only host, silently losing its
  // set-membership capacity (the same trap as Dino blanks / the Gem joker). Keep B
  // whenever it can join a set A cannot also join.
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
      if (targetSet.has(o.stat) && o.value > 0) s.add(`${o.stat}||${equivType(o.bonus_type)}||${o.value}`);
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
  return v.nc_tier || ((v.ml || 0) >= 35 ? "legendary" : "heroic");
}

/** A Viktranium ("Lamordia") host's tier, derived from host ML. Viktranium's two
 *  documented tiers are Heroic (recipe ML8/11) and Legendary (recipe ML34) — so
 *  the boundary sits at DDO's Heroic->Legendary split (ML30), NOT NC's ML35: a
 *  legendary Viktranium host is ML34, and gating legendary on ML>=35 would
 *  mis-tier every real host heroic and make the entire legendary pool
 *  unreachable. This is the SINGLE source of truth — the solver and browse layers
 *  derive tier from this function, never a re-inlined threshold. */
function lamordiaTier(v) {
  return (v.ml || 0) >= 30 ? "legendary" : "heroic";
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
/** The stable id a slot-constraint pin refers to (matches the wizard's pin). */
function variantKey(v) {
  return (v && (v.variant_id || v.source_item)) || "";
}

function dominanceFilter(slotVariants, targetSet, mlCap, cardinality = 1, pinnedIds = null, includeArtifact = false) {
  const kept = [];
  for (let i = 0; i < slotVariants.length; i++) {
    const A = slotVariants[i];
    // A pinned variant is force-equipped by a slot constraint (U6), so it must
    // survive the pre-filter even if a same-slot peer dominates it — otherwise
    // its pick var wouldn't exist for the `= 1` constraint to reference.
    if (pinnedIds && pinnedIds.has(variantKey(A))) { kept.push(A); continue; }
    const isSetContributor = (A.set_bonus || []).length
      || ((A.set_membership_slot || {}).pool || []).length;
    if (cardinality > 1 && isSetContributor) { kept.push(A); continue; }
    let dominated = false;
    for (let j = 0; j < slotVariants.length; j++) {
      if (i === j) continue;
      const B = slotVariants[j];
      // KTD2 soundness: when the box is on, an Artifact is only *conditionally*
      // available — the `= 1` exactly-one constraint can force it off if a
      // different Artifact wins elsewhere. So an Artifact must not prune a
      // non-Artifact peer: the non-Artifact could be the true best-available
      // item once its Artifact "dominator" is forced off. (Artifacts themselves
      // are already exempt via pinnedIds and never reach this loop when on.)
      if (includeArtifact && B.artifact && !A.artifact) continue;
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

  // Pinned variant ids (U6): kept through the dominance pre-filter so a pinned
  // item's pick var always exists for its `= 1` constraint. Empty when absent.
  const pinnedIds = new Set();
  for (const c of Object.values(query.slotConstraints || {})) {
    for (const id of pinnedVariantIds(c)) pinnedIds.add(id);
  }

  // KTD2 — Artifact exemption: when the box is on, "exactly one Artifact" makes
  // Artifact-ness a value dimension, so a non-Artifact beating an Artifact on
  // stats must NOT prune it (the solver could then be unable to place one). Reuse
  // the pin-exemption seam: keep every eligible Artifact through the pre-filter.
  if (query.includeArtifact) {
    for (const v of elig) if (v.artifact) pinnedIds.add(variantKey(v));
  }

  const withArt = !!query.includeArtifact;
  const worn = [];
  for (const slotName of WORN_SLOTS) {
    const card = SLOT_CARDINALITY[slotName] || 1;
    let cands = elig.filter((v) => v.slot === slotName);
    cands = dominanceFilter(cands, targetSet, mlCap, card, pinnedIds, withArt);
    if (cands.length) {
      worn.push({ slot: slotName, cardinality: card, variants: cands });
    }
  }

  // One main-hand weapon: weapon-category variants that match the main-hand lock
  // compete for a single slot, so the solver can never equip several main weapons.
  // (elig now holds weapons eligible for EITHER hand, so re-apply the main-hand lock.)
  const weaponAllow = allowedWeaponTypes(query);
  const offWeaponAllow = allowedOffHandWeaponTypes(query);
  const mainHand = dominanceFilter(
    elig.filter((v) => v.category === "weapon" && mainHandWeaponOk(v, weaponAllow)),
    targetSet, mlCap, 1, pinnedIds, withArt);
  if (mainHand.length) worn.push({ slot: "Main Hand", cardinality: 1, variants: mainHand });

  // U2/B1 — Off Hand slot (at-most-one): orbs, shields (buckler/small/large/tower),
  // and rune arms live here (slot "Off Hand"; the one legacy rune-arm host is
  // normalized into this pool at load). eligible() has applied the off-hand/style
  // constraints, so a two-hand/ranged style or an "empty"-only pick yields nothing.
  // TWF: when the one-hand style has an off-hand-weapon lock, one-handed WEAPONS
  // also compete here (the hand-mutex in solver.js stops the same item filling both
  // hands). The Off Hand slot then optimizes the best second weapon vs shield/orb.
  let offHandPool = elig.filter((v) => v.slot === "Off Hand");
  if (offWeaponAllow != null) {
    offHandPool = offHandPool.concat(
      elig.filter((v) => v.category === "weapon" && offHandWeaponOk(v, offWeaponAllow)));
  }
  const offHand = dominanceFilter(offHandPool, targetSet, mlCap, 1, pinnedIds, withArt);
  if (offHand.length) worn.push({ slot: "Off Hand", cardinality: 1, variants: offHand });

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

  // U81 Nearly Completed: the parametric option pool. Keep only options that
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
    buildModel, eligible, variantConflict, pinConflict, pinnedVariantIds, dominanceFilter, dominates,
    variantBuckets, variantSets, scaledValue, ncTier, lamordiaTier, lamordiaSlotKeys,
    isForgedRace, isDocent, variantKey, setStackEquiv, equivType,
    WORN_SLOTS, SLOT_CARDINALITY, ARMOR_DODGE_CAP,
  };
}
