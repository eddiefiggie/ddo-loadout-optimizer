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
  // #235 — an absent bonus type is NOT folded into `Untyped`. A previous revision
  // did that to stop a declared "Untyped" credit double-counting against untyped
  // gear, and it was wrong on the wider rule: real untyped bonuses STACK
  // (`CONCEPTS.md` Bucket, and the equivalence audit's None-vs-Untyped ruling),
  // so collapsing the two turns a legitimate sum into a max. 30 stats carry both
  // an absent type and an explicit `Untyped` — an item's own effect beside an
  // augment's — and they are meant to add. The double-count is closed at its real
  // source instead: a stat with no bonus type is not offered a bonus-type credit.
  return (type != null && _STACK_EQUIV[type] != null) ? _STACK_EQUIV[type] : type;
}

// U1 (#290/#291) — cross-add map {target_stat: [source_stats]}: stats whose
// bucket totals flat-ADD into the target's total ACROSS buckets (the wiki's
// fully-stacking universal sources — Universal Spell Power into the ten element
// spellpowers, Spell Lore/Universal Spell Lore into the element lores). The
// OPPOSITE contract from _STACK_EQUIV above, which collapses same-bucket
// sources to the max. Emitted into items.json `metadata.cross_add` and
// installed here (dataset.js calls setCrossAdd on load, mirroring
// setStackEquiv). Data plumbing only for now — solver crediting reads
// crossAddSourcesFor in a later unit.
let _CROSS_ADD = Object.create(null);
function setCrossAdd(map) {
  _CROSS_ADD = Object.create(null);
  if (map && typeof map === "object") {
    for (const k of Object.keys(map)) {
      if (Array.isArray(map[k])) _CROSS_ADD[k] = map[k].slice();
    }
  }
}
/** Source stats whose totals cross-add into `stat` — [] for an unmapped stat
 *  and for the uninstalled state (never a crash). */
function crossAddSourcesFor(stat) {
  const srcs = stat != null ? _CROSS_ADD[stat] : undefined;
  return Array.isArray(srcs) ? srcs : [];
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
const FORGED_RACES = new Set(["warforged", "bladeforged"]);
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
 *  weapon is permitted. TWF is one-hand-style only.
 *
 *  plan 003 U2 (KTD3) — the DECLARATION is the switch. Dual-wield used to turn on
 *  when the player happened to pick an off-hand weapon type, which nothing
 *  signposted, so the feature was unreachable by default. The off-hand weapon-type
 *  picker survives as optional REFINEMENT: picks narrow the allowed list; with no
 *  picks every one-handed type competes. */
function allowedOffHandWeaponTypes(query) {
  const T = _taxonomy();
  if (!T || !T.twfWeaponAllowedForStyle(query.style)) return null;
  if (!query.twoWeaponFighting) return null;
  const set = Array.isArray(query.offHandWeapons) ? query.offHandWeapons : [];
  return set.length ? set : T.offHandWeaponTypes();
}

/** plan 003 U2 (R3) — does this query exclude off-hand ITEMS (shields, orbs, rune
 *  arms) from off-hand candidacy? True only when the feat is declared AND the style
 *  permits a second weapon, so no other style's allow-list is ever overridden (R5).
 *
 *  THE single advisory authority: U5's pin flag and U6's results disclosure both read
 *  this rather than re-deriving it, so what the pin list says and what the results
 *  notice says cannot drift apart. */
function offHandItemsExcluded(query) {
  const T = _taxonomy();
  return !!(query && query.twoWeaponFighting) && !!T && T.twfWeaponAllowedForStyle(query.style);
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
// variant carries concrete data. The armor-type and docent/race gates are LIVE:
// the wizard supplies query.race / query.armorTypes, and armor_type is concrete
// (stamped at build from native `type` and re-derived by dataset.js at load), so
// a Heavy character no longer sees cloth/robe body armor. The alignment gate is
// still a no-op until alignment_req is sourced (fail-open by design).
// U1 — Query-derived gate context, computed once per query so `eligible()` (which
// runs over thousands of variants) does not recompute the style/off-hand sets per
// item. `variantConflict` accepts it precomputed, or derives it on demand for the
// handful of calls `pinConflict` makes.
function queryGates(query) {
  // R8 — the set of pinned variant ids. A pin overrides the soft mlFloor (only), so
  // the floor check below skips a pinned variant. Matched via variantKey, same as the
  // dominance-filter pin exemption, so the two never drift.
  const pinnedIds = new Set();
  for (const c of Object.values(query.slotConstraints || {})) {
    for (const id of pinnedVariantIds(c)) pinnedIds.add(id);
  }
  return {
    cap: query.mlCap,
    floor: query.mlFloor,                                  // optional item-level floor
    pinnedIds,                                             // R8 — pins bypass the floor
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
  // R8 — the mlFloor is a soft "hide low-ML gear" filter, so an explicit pin overrides
  // it: a pinned variant skips ONLY this floor check (the cap above still applies, and
  // every other gate below still fires). Living in variantConflict means eligible()
  // (pool build), pinConflict (advisory), and reconcilePinLegality all honor a
  // below-floor pin consistently.
  //
  // An AUGMENT is likewise exempt from the floor. The floor hides OUTLEVELED worn gear;
  // an augment is a slotted insert, not worn gear — a low-ML augment (e.g. a ML-22
  // "Diamond of Festive <stat> +2") is still slottable at any level >= its ML, and its
  // bonus may stack uniquely (Festive is its own bonus type), so a "hide low-ML gear"
  // floor must not drop it. Only the cap (above) constrains an augment: an augment above
  // the ML cap genuinely can't be slotted.
  if (g.floor != null && v.ml != null && v.ml < g.floor
      && v.category !== "augment"
      && !(g.pinnedIds && g.pinnedIds.has(variantKey(v)))) return `below your ML ${g.floor} floor`;

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

  // #162 — Druidic oath. Sourced from https://ddowiki.com/page/Druid: "A druid who
  // wears metal armor, a metal shield or a rune arm is unable to cast Druid spells,
  // use any of his/her supernatural skills or class spell-like abilities." Their
  // proficiencies are Light armor, Medium armor, and non-Tower shields.
  //
  // This REPLACES the old cloth+light approximation, which was wrong in both
  // directions: it excluded all medium armor (a druid may wear non-metal medium such
  // as Darkwood or Densewood) and enforced nothing about metal, Tower shields, or
  // rune arms. Material is wiki-sourced per item; a variant whose material is absent
  // or unclassified FAILS OPEN — the dataset discloses that count rather than the
  // gate silently narrowing the pool on an unsourced guess.
  if (query.oath === "druid") {
    // `material_class` is derived at the load seam by dataset.js from
    // metadata.material_classification — absent means unsourced or unclassified.
    const cls = v.material_class;
    if (cls === "metal" && (v.slot === "Armor" || v.slot === "Off Hand"))
      return v.slot === "Armor"
        ? "a druidic oath forbids metal armor"
        : "a druidic oath forbids a metal shield";
    if (v.slot === "Off Hand" && v.type === "Tower shields")
      return "druids are not proficient with tower shields";
    if (v.slot === "Off Hand" && v.type === "Rune Arms")
      return "a druidic oath forbids a rune arm";
  }

  // R7/AE2 — Alignment: exclude items whose alignment requirement the
  // character does not meet. Fail-open until alignment_req is sourced (U3).
  if (query.alignment && Array.isArray(v.alignment_req) && v.alignment_req.length &&
      !v.alignment_req.includes(query.alignment)) return "doesn't match your alignment";

  // R2/AE2 — Artifact opt-in: unless the player checked "Include an Artifact",
  // no Artifact-quality item is considered. Absent flag => non-Artifact (KTD5),
  // so this is a no-op until the seed is populated AND the box is checked.
  if (v.artifact && !query.includeArtifact) return 'needs the "Include an Artifact" option';

  // U6/AE — Set-augment ownership gate (v1): a Set Augment insert is only
  // considered when the player has marked it available. `ownedSetAugments` is a
  // Set of set-augment `set` names (array tolerated for robustness); empty or
  // undefined => none of the 21 are eligible (default off), mirroring the Artifact
  // opt-in above so the family is inert until a set is explicitly owned.
  if (v.set_augment) {
    const owned = query.ownedSetAugments;
    const key = v.set || v.name || v.variant_id;
    const has = owned && (typeof owned.has === "function" ? owned.has(key)
      : Array.isArray(owned) ? owned.includes(key) : false);
    if (!has) return "mark this Set Augment as available to consider it";
  }

  return null;
}

// U1 — advisory per-item flag for pre-solve pinning (B4). Same gate list the solver
// enforces; returns null (equippable) or a reason string. Thin wrapper so the UI has
// a stable name distinct from the solver-facing helper.
function pinConflict(v, query) {
  return variantConflict(v, query);
}

/** plan 003 U5 (KTD6, R7) — SLOT-AWARE pin legality, layered ON TOP of
 *  variantConflict rather than inside it. Returns null (the pin is legal in that
 *  slot) or a short human reason.
 *
 *  Why a second predicate rather than a new gate in variantConflict:
 *
 *  - variantConflict is per-VARIANT and slot-blind. An off-hand weapon pin made
 *    without the declaration is a one-handed weapon that passes the main-hand gate,
 *    so variantConflict returns null and nothing suppresses the pin — while the
 *    weapon is absent from the off-hand pool. The pin then constrains a variant that
 *    is not in its own slot: a NO-BUILD, not R7's graceful suppression.
 *  - The exclusion of shields/orbs/rune arms from a declared build must NOT live in
 *    variantConflict (KTD1) — reconcilePinLegality drops any pin whose
 *    variantConflict is non-null, so it would sweep the pinned-shield escape hatch.
 *    This predicate deliberately returns null for a pinned SHIELD on a declared
 *    build: it is honored, and the UI flags it as overriding the exclusion (R8). */
function pinSlotConflict(v, slotKey, query) {
  if (!v || slotKey !== "Off Hand" || v.category !== "weapon") return null;
  const allow = allowedOffHandWeaponTypes(query || {});
  if (allow == null) return "your character hasn't declared Two Weapon Fighting";
  if (!offHandWeaponOk(v, allow)) return "this weapon type isn't in your off-hand weapon picks";
  return null;
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

/** #282 — which Weapon-pool VARIANT a host's Lamordia Weapon slots draw. A
 *  quarterstaff receives the `(quarterstaff)` versions of Weapon-pool crafts
 *  (implement bonuses the base versions lack), so records variant-marked by the
 *  pipeline (`quarterstaff: true/false`) are matched against this. THE single
 *  authority — the solver's option gate and the dominance slot keys both read
 *  this, so which pool a host draws and how hosts compare cannot drift apart. */
function lamordiaWeaponVariant(v) {
  return v && v.type === "Quarterstaffs" ? "quarterstaff" : "base";
}

/** A host's typed Lamordia slots as a `type||category||tier` multiset key list,
 *  so the dominance guard and the solver agree on which pool a slot draws from.
 *  A Weapon-category key also carries the host's weapon-pool variant (#282):
 *  a quarterstaff's Weapon slot draws a different pool than a sword's, so the
 *  two keys must not compare as equal or dominance could prune the quarterstaff
 *  host while its richer craft options are invisible to the bucket check. */
function lamordiaSlotKeys(v) {
  const tier = lamordiaTier(v);
  return (v.lamordia_slots || []).map((s) => s.category === "Weapon"
    ? `${s.type}||${s.category}||${tier}||${lamordiaWeaponVariant(v)}`
    : `${s.type}||${s.category}||${tier}`);
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

// R1/R3 — a main-hand weapon that occupies BOTH hands: two-handed melee (THF),
// bows (RANGED), or a weapon whose handedness can't be classified (the untyped Dino
// Bone weapon host, `styleOfType` undefined). Defined by off-hand ENABLEMENT of the
// weapon's own inherent style, so THF + RANGED + undefined all count while crossbows
// (a rune-arm off-hand is legal) and one-handed/unarmed do not. Shared by the solver
// hand-mutex (solver.js) and the dominance re-audit below so the two never drift.
function isBothHandsWeapon(v) {
  if (!v || v.category !== "weapon") return false;
  const T = _taxonomy();
  if (!T) return false;
  return !T.offHandEnabledForStyle(T.styleOfType(v.type));
}

// U1 (issue #107) — the canonical SHIELD off-hand types. Reused verbatim from the
// taxonomy's Sword & Board off-hand allow-list (the four shield types) so shield
// identity here can never drift from the picker. Empty if the taxonomy is absent.
function shieldTypes() {
  const T = _taxonomy();
  return (T && T.offHandTypesForStyle && T.offHandTypesForStyle("sword-board")) || [];
}

// U1 (issue #107) — is the Off Hand constrained to hold a SHIELD? True when the
// player's off-hand pick names a shield type, OR a shield variant is pinned to the
// Off Hand slot. A shield occupies a hand, so a two-handed Main Hand weapon becomes
// illegal — the symmetric partner of the R9/B5 block that forbids an off-hand item
// under a two-hand style. `variants` is the full pool (needed to resolve a pinned
// variant's type). Additive: returns false unless a shield is actually in the off hand.
function offHandHasShield(query, variants) {
  const shields = shieldTypes();
  if (!shields.length) return false;
  const set = new Set(shields);
  // (a) explicit off-hand pick names a shield type (e.g. offHand: ["Tower shields"]).
  const picks = Array.isArray(query.offHand) ? query.offHand : [];
  if (picks.some((t) => set.has(t))) return true;
  // (b) a shield variant is pinned to the Off Hand slot.
  const pinned = pinnedVariantIds((query.slotConstraints || {})["Off Hand"]);
  if (pinned.length && Array.isArray(variants)) {
    const ids = new Set(pinned);
    for (const v of variants) if (ids.has(variantKey(v)) && set.has(v.type)) return true;
  }
  return false;
}

function dominanceFilter(slotVariants, targetSet, mlCap, cardinality = 1, pinnedIds = null, includeArtifact = false, handMutex = false) {
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
      // KTD2 soundness: the hand mutex is a mutual exclusion — a both-hands weapon B
      // (2H/bow/unclassifiable) is forced off whenever an off-hand is equipped, so it
      // must not prune a one-handed peer A: once B is forced off, A may be the true
      // best-available main hand. Mirrors the Artifact exemption above. Only fires for
      // the Main Hand slot (handMutex passed true there).
      if (handMutex && isBothHandsWeapon(B) && !isBothHandsWeapon(A)) continue;
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
function buildModel(variants, query, dinoInserts = [], nearlyComplete = [], viktranium = [], seal = [], membershipSetDefs = {}, thunderForged = [], greenSteel = [], augmentSetDefs = {}) {
  // #245 — the niche-crafting opt-out. A craftable option slot makes its host a
  // wildcard for every rankable stat (the Viktranium pool alone reaches 126), so
  // under strict lexicographic priority a Lamordia base is never worse and
  // usually +1 better than the item it displaces — regardless of the priority
  // list. When the player opts out, the option-pool families are emptied HERE,
  // at the model seam, so items compete on their printed affixes: the solver
  // below needs no second code path, and every consumer (alternatives re-solves,
  // saved queries, exports) inherits the flag from the query it already carries.
  // Augments and intrinsic choice slots (roll groups) are deliberately NOT
  // gated — one is on nearly every item, the other is the item's own identity.
  if (query.excludeCraftingSystems) {
    dinoInserts = []; nearlyComplete = []; viktranium = []; seal = [];
    thunderForged = []; greenSteel = [];
    membershipSetDefs = {};   // chosen set-membership (Lost Purpose / Dino Set Bonus)
    augmentSetDefs = {};      // set-bonus augments are Dino crafting too
  }
  // U1/U2 (KTD3) — a user cap or floor can name a stat outside the priority list;
  // union those into targetSet so the dominance pre-filter and pools keep items
  // competitive on them and their buckets get built. model.targets (the strict
  // lexicographic order) stays the priority list only.
  const targetSet = new Set([
    ...query.targets,
    ...Object.keys(query.targetCaps || {}),
    ...Object.keys(query.targetFloors || {}),
  ]);
  // U2 (#290/#291) — widen with every tracked stat's cross-add SOURCE stats
  // (an element spellpower pulls in Universal Spell Power; an element lore
  // pulls in Spell Lore + Universal Spell Lore), so the dominance pre-filter
  // keeps universal-only items competitive and the option pools keep universal
  // crafting options. Widening the stat set is the whole lever: the shared
  // dominance comparator (dominates/variantBuckets) is deliberately untouched —
  // with the sources in targetSet, a universal item's buckets are compared like
  // any other stat's, so a USP-only item survives unless genuinely dominated.
  // Mirrors buildProgram's widening (solver.js), which builds the buckets.
  for (const stat of [...targetSet]) {
    for (const src of crossAddSourcesFor(stat)) targetSet.add(src);
  }
  const mlCap = query.mlCap;
  const eligAll = eligible(variants, query);
  // #110 (U2/KTD1) — the blocklist filters CANDIDACY, here and not in
  // variantConflict: variantConflict means "this character can never equip
  // this", and reconcilePinLegality deletes any pin whose conflict is non-null,
  // so a block expressed there would let a corrupted import silently destroy a
  // pin. Filtering the eligible pool once removes the variant from every worn
  // slot, both hands, and the augment colour pools at once — and it runs
  // upstream of dominanceFilter, so a blocked winner simply leaves the
  // runner-up as the pool's new best (KTD2: the comparator is untouched).
  // An ABSENT blocklist means "filter nothing" — the legacy Solver tab's query
  // never carries the key, and a truthiness slip here would empty its pools.
  // The removed set is retained on the model so the disclosure (U7) can
  // attribute without recomputing.
  const blockedIds = new Set(Array.isArray(query.blocklist) ? query.blocklist : []);
  const blocked = [];
  let elig = eligAll;
  if (blockedIds.size) {
    elig = [];
    for (const cand of eligAll) {
      (blockedIds.has(variantKey(cand)) ? blocked : elig).push(cand);
    }
  }

  // Pinned variant ids (U6): kept through the dominance pre-filter so a pinned
  // item's pick var always exists for its `= 1` constraint. Empty when absent.
  const pinnedIds = new Set();
  for (const c of Object.values(query.slotConstraints || {})) {
    for (const id of pinnedVariantIds(c)) pinnedIds.add(id);
  }
  // plan 003 U2 — the player's EXPLICIT pins, snapshotted before the Artifact
  // exemption below widens `pinnedIds`. R3's off-hand escape hatch is "unless the
  // player pins one", so it must read this narrow set: reusing the widened one would
  // let every eligible Artifact shield sit in a declared build's off hand with nobody
  // having pinned it.
  const explicitPins = new Set(pinnedIds);

  // KTD2 — Artifact exemption: when the box is on, "exactly one Artifact" makes
  // Artifact-ness a value dimension, so a non-Artifact beating an Artifact on
  // stats must NOT prune it (the solver could then be unable to place one). Reuse
  // the pin-exemption seam: keep every eligible Artifact through the pre-filter.
  if (query.includeArtifact) {
    for (const v of elig) if (v.artifact) pinnedIds.add(variantKey(v));
  }

  const withArt = !!query.includeArtifact;
  const worn = [];
  // #110 (U8/KTD3) — a worn slot whose candidate list empties is OMITTED from
  // `worn`, and the empty-slot report iterates `worn` — so a fully-blocked slot
  // would be reported as neither filled nor empty. Capture the omission where
  // it happens: `elig` and `eligAll` differ only by the blocked ids, so a pool
  // that is empty while a BLOCKED variant would have filled it was emptied by
  // the player's own exclusions, and nothing else can claim the credit.
  const blockEmptiedSlots = [];
  // review fix — a slot the player LOCKED empty is excluded from the capture:
  // its emptiness is the player's own instruction, and "unblock something or the
  // slot will stay bare" would be false advice (the empty-slot report's existing
  // locked-slot exclusion is the precedent).
  const lockedEmpty = (slotName) => {
    const c = (query.slotConstraints || {})[slotName];
    return !!(c && c.type === "empty");
  };
  for (const slotName of WORN_SLOTS) {
    const card = SLOT_CARDINALITY[slotName] || 1;
    let cands = elig.filter((v) => v.slot === slotName);
    if (!cands.length && !lockedEmpty(slotName) && blocked.some((b) => b.slot === slotName)) {
      blockEmptiedSlots.push(slotName);
    }
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
  // U1 (issue #107) — a SHIELD in the off hand forbids a two-handed Main Hand weapon
  // (quarterstaff, greatsword, maul, THF bow, ...). Symmetric partner of the R9/B5
  // off-hand block. Crossbows are NOT both-hands (a rune arm pairs with them), so the
  // rune-arm style stays unaffected. Only narrows when a shield is actually locked in.
  const shieldOffHand = offHandHasShield(query, variants);
  let mainHandPool = elig.filter((v) => v.category === "weapon" && mainHandWeaponOk(v, weaponAllow));
  if (shieldOffHand) mainHandPool = mainHandPool.filter((v) => !isBothHandsWeapon(v));
  // #110 (U8) — the hands get the same emptied-by-blocks capture, against the
  // same type/style filters this pool applies, so a weapon-type lock can never
  // be mis-attributed to a block.
  if (!mainHandPool.length && !lockedEmpty("Main Hand") && blocked.some((b) => b.category === "weapon"
      && mainHandWeaponOk(b, weaponAllow) && !(shieldOffHand && isBothHandsWeapon(b)))) {
    blockEmptiedSlots.push("Main Hand");
  }
  const mainHand = dominanceFilter(
    mainHandPool,
    targetSet, mlCap, 1, pinnedIds, withArt, true);   // handMutex: a both-hands weapon must not prune a 1H peer (KTD2)
  if (mainHand.length) worn.push({ slot: "Main Hand", cardinality: 1, variants: mainHand });

  // U2/B1 — Off Hand slot (at-most-one): orbs, shields (buckler/small/large/tower),
  // and rune arms live here (slot "Off Hand"; the one legacy rune-arm host is
  // normalized into this pool at load). eligible() has applied the off-hand/style
  // constraints, so a two-hand/ranged style or an "empty"-only pick yields nothing.
  // TWF: when the one-hand style has an off-hand-weapon lock, one-handed WEAPONS
  // also compete here (the hand-mutex in solver.js stops the same item filling both
  // hands). The Off Hand slot then optimizes the best second weapon vs shield/orb.
  let offHandPool = elig.filter((v) => v.slot === "Off Hand");
  // plan 003 U2 (R3) — a DECLARED build's off hand holds a weapon. Shields, orbs, and
  // rune arms leave candidacy unless the player pinned one (R8's escape hatch).
  //
  // Why here and NOT in variantConflict (KTD1): reconcilePinLegality drops any pin
  // whose variantConflict is non-null, so expressing the exclusion there would sweep
  // the very pins the escape hatch exists to protect — the feature would delete its
  // own override. Candidacy is a pool question, not an equippability question.
  if (offHandItemsExcluded(query)) {
    offHandPool = offHandPool.filter((v) => explicitPins.has(variantKey(v)));
  }
  if (offWeaponAllow != null) {
    offHandPool = offHandPool.concat(
      elig.filter((v) => v.category === "weapon" && offHandWeaponOk(v, offWeaponAllow)));
  }
  // #110 (U8, review fix) — the capture mirrors the pool's own feeds: off-hand
  // ITEMS count only when the declaration has not excluded them, and off-hand
  // WEAPONS (slot "Weapon", fed under TWF) count when the weapon feed is open —
  // otherwise a fully-blocked TWF off hand vanishes reported as neither filled
  // nor empty, the exact KTD3 state this capture exists to close.
  if (!offHandPool.length && !lockedEmpty("Off Hand") && blocked.some((b) =>
      (b.slot === "Off Hand" && !offHandItemsExcluded(query))
      || (offWeaponAllow != null && b.category === "weapon" && offHandWeaponOk(b, offWeaponAllow)))) {
    blockEmptiedSlots.push("Off Hand");
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
  // category, tier). Each record is an ATOMIC craftable OPTION carrying one or
  // more affixes (the same UNIT shape as a Dino insert) — crafting the universal
  // spell-DC option grants all seven schools at once, so a caster ranking two
  // schools spends ONE slot, not two. Keep an option when ANY of its affixes
  // advances a ranked target; the solver attaches them per host via the item's
  // `lamordia_slots` at the host's tier and gates the whole option on one binary.
  const vikAdvances = (o) => {
    const affixes = (o.affixes && o.affixes.length)
      ? o.affixes
      // back-compat: a flat single-affix record (pre-atomicity shape)
      : (o.stat ? [{ stat: o.stat, value: o.value }] : []);
    return affixes.some((a) => targetSet.has(a.stat) && a.value > 0);
  };
  const vikPool = (viktranium || []).filter((o) => o && vikAdvances(o));

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
    // #110 (U2) — eligible-but-blocked variants, retained for the disclosure's
    // attribution. Never re-enters any pool below.
    blocked,
    // #110 (U8) — worn slots whose every candidate the player blocked, captured
    // at pool assembly because the omitted slot never reaches `worn`.
    blockEmptiedSlots,
    // #110 (U7/KTD9) — the attribution report, computed HERE because it compares
    // against the pre-dominance eligible pool (`elig` as the block filter left
    // it), which no longer exists after buildModel returns. That is deliberately
    // NOT the list the solve finally saw: dominanceFilter shrinks it, and
    // "best available" may only be asserted on the STRONGER claim — the blocked
    // variant dominates EVERY surviving candidate in its pool, per the project's
    // one value comparator. When domination does not hold against all survivors,
    // `bestAvailable` is false and the sentence carries no superlative. Never a
    // counterfactual: nothing here says what a block-free solve would have done.
    blockReport: blocked.map((b) => {
      const isAug = b.category === "augment";
      const pool = isAug
        ? elig.filter((s) => s.category === "augment"
            && ((s.aug_color || {}).color || null) === ((b.aug_color || {}).color || null))
        : b.category === "weapon"
          ? elig.filter((s) => s.category === "weapon")
          : elig.filter((s) => s.slot === b.slot && s.category !== "augment");
      return {
        id: variantKey(b),
        name: b.source_item || b.variant_id,
        pool: isAug ? `${(b.aug_color || {}).color || "unknown"}-augment` : (b.category === "weapon" ? "weapon" : b.slot),
        // review fix — STRICT domination: dominates() keeps A as the canonical
        // of an equal pair, so a tie satisfies the weak predicate and would
        // print "out-valued" for a mere match (the never-infer overclaim). The
        // second clause demotes exact equals to the no-superlative sentence.
        bestAvailable: pool.length > 0 && pool.every((s) =>
          dominates(b, s, targetSet, mlCap) && !dominates(s, b, targetSet, mlCap)),
      };
    }),
    dinoInserts: dinoPool, nearlyComplete: ncPool, viktranium: vikPool, seal: sealPool,
    thunderForged: tfPool, greenSteel: gsPool,
    membershipSetDefs: membershipSetDefs || {},
    // U6 — set-augment definitions (piece thresholds + affixes), forwarded like
    // membershipSetDefs so the solver's set-augment family reads model.augment_set_defs.
    // Ownership gate on the VALUE path: the solver's set-augment y-family reads
    // model.augment_set_defs directly (not the worn/augment pool), so filtering the
    // stat-less variants in variantConflict is not enough — the defs dict itself must
    // be gated, or the solver would place & score set augments the player never marked
    // owned. Mirror the variantConflict ownership key (`set` name); empty/undefined
    // ownedSetAugments => no defs => family inert (default off).
    augment_set_defs: (() => {
      const owned = query.ownedSetAugments;
      const has = (k) => owned && (typeof owned.has === "function" ? owned.has(k)
        : Array.isArray(owned) ? owned.includes(k) : false);
      const out = {};
      for (const [name, def] of Object.entries(augmentSetDefs || {})) if (has(name)) out[name] = def;
      return out;
    })(),
    dodgeCap, mlCap,
    // U1 — user-set per-stat caps (clamp a stat's counted value); merged with the
    // armor dodge cap in buildProgram. U2 — user-set per-stat floors (best-effort).
    userCaps: query.targetCaps || {},
    floors: query.targetFloors || {},
    // U1 (declared stat credits) — what the player already holds from a non-gear
    // source. Normalized to an array here so the solver has one shape to read;
    // the query carries a `(stat, bonus type)`-keyed map so the UI can address a
    // single credit for edit and removal.
    credits: normalizeCredits(query.declaredCredits),
  };
}

// KTD3 — the closed bonus-type vocabulary a declared credit may name. Curated,
// NOT derived from the dataset: the dataset's `type` column carries `Bool`,
// `Penalty`, `-`, and damage/material tokens, and omits types no gear happens to
// carry (`Morale`) — and a credit in a bucket no gear occupies is precisely the
// additive case AE4 exists for. Kept beside `_STACK_EQUIV` so the vocabulary and
// the equivalence table are maintained together.
//
// This list is the choke point, not the UI. A near-miss string is wrong-HIGH and
// silent: `insight` forms its own bucket key, so the credit stops competing with
// Insight gear and ADDS to it — a credit of 7 beside an Insight-5 ring reported
// 12 with the ring still equipped, violating R5 and R6 in one solve. Case-folding
// is not the fix, because an unrecognized type stacking additively is CORRECT for
// a real type no gear carries; only membership separates "Morale, legitimately
// additive" from "insight, a typo". U2's selector renders from this same list.
const CREDIT_BONUS_TYPES = [
  "Enhancement", "Insight", "Quality", "Competence", "Exceptional", "Profane",
  "Sacred", "Morale", "Luck", "Resistance", "Deflection", "Armor", "Shield",
  "Natural", "Artifact", "Vitality", "Equipment", "Untyped", "Implement",
  "Legendary", "Alchemical", "Primal", "Festive",
];
const _CREDIT_TYPE_SET = new Set(CREDIT_BONUS_TYPES);

// A player-typed magnitude is the first number in this system that does not trace
// to the wiki, so it is bounded as well as validated. Above ~1e15 the value
// stringifies into LP text HiGHS refuses to parse, and `highs.solve` THROWS out of
// the solver rather than returning `{status:"infeasible"}` — a hard crash instead
// of a graceful failure. No real DDO bonus approaches four digits.
const MAX_CREDIT_VALUE = 9999;

/** Declared credits as a deduped array, from either the keyed map or an array. */
function normalizeCredits(declared) {
  if (!declared) return [];
  const rows = Array.isArray(declared) ? declared : Object.values(declared);
  const byKey = new Map();
  for (const row of rows) {
    if (!row) continue;
    const stat = String(row.stat == null ? "" : row.stat).trim();
    const bonusType = String(row.bonus_type == null ? "" : row.bonus_type).trim();
    const value = Number(row.value);
    // A non-positive or unreadable credit is dropped rather than entering a
    // bucket, mirroring the `value > 0` filter gear affixes already pass through
    // — a zero contribution would occupy the one-contributor-per-bucket slot and
    // suppress real gear. A2 also makes a credit an integer.
    // A backup file is user-supplied, so a stat name can be anything. A pollution
    // key is inert here — `creditKey` makes it the ordinary own property
    // `__proto__||Insight`, never a bare `__proto__` — but it would still mint an
    // LP variable for a stat no gear can carry, so refuse it at the same gate
    // backup.js's isPollutionKey refuses it structurally.
    if (stat === "__proto__" || stat === "constructor" || stat === "prototype") continue;
    if (!stat || !Number.isFinite(value) || value <= 0) continue;
    if (!Number.isInteger(value) || value > MAX_CREDIT_VALUE) continue;
    if (!_CREDIT_TYPE_SET.has(bonusType)) continue;
    // Keep the LARGER of two rows on one key rather than last-wins: the bucket
    // resolves max-of-type, so silently dropping the bigger declaration would
    // contradict the very rule the credit participates under.
    const key = `${stat}||${bonusType}`;
    const prev = byKey.get(key);
    if (!prev || prev.value < value) byKey.set(key, { stat, bonus_type: bonusType, value });
  }
  return [...byKey.values()];
}

// exports for node tests; harmless in the browser
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildModel, normalizeCredits, CREDIT_BONUS_TYPES, MAX_CREDIT_VALUE, eligible, variantConflict, pinConflict, pinnedVariantIds, dominanceFilter, dominates,
    offHandItemsExcluded, allowedOffHandWeaponTypes, pinSlotConflict,
    variantBuckets, variantSets, scaledValue, ncTier, lamordiaTier, lamordiaSlotKeys, lamordiaWeaponVariant,
    isForgedRace, isDocent, isBothHandsWeapon, variantKey, setStackEquiv, equivType,
    setCrossAdd, crossAddSourcesFor,
    WORN_SLOTS, SLOT_CARDINALITY, ARMOR_DODGE_CAP,
  };
}
