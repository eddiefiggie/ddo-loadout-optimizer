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

/** #335 (KD2) — rings a player may WEAR TWO OF, each confirmed on the item's own
 *  wiki page. This is an allowlist and not a set-membership test on purpose.
 *
 *  Duplicate-wearability is DDO's per-item Unique Equipped property, and the
 *  dataset carries nothing about it: `restrictions` is the literal string
 *  "unknown" on 426 of 427 rings, no ring carries a `unique_equipped` field, and
 *  the only such flag in the tree is on augments. The wiki line that motivated
 *  this feature — "2 rings, identical or not, can be used for the set bonus" —
 *  says how set bonuses COUNT when two rings are worn; it presupposes wearability
 *  rather than establishing it, and it is one item's page. Gating on set
 *  membership would infer a legality claim from a counting rule and trade an
 *  under-reporting bug for an over-reporting one.
 *
 *  Widening this to the whole set-member population needs the Unique Equipped
 *  harvest in #442, fail-closed where the wiki is silent. */
// #442 — the hard-coded name list this replaced held ONE ring, because #335 had
// no per-item evidence to widen it with. The evidence now lives in
// `data/seed/compendium/duplicable_rings.json`, is stamped onto the item as
// `duplicable_ring` at build time, and carries each ring's verbatim wiki citation.
//
// Kept as a name set purely so a caller holding a bare variant WITHOUT the stamp
// (a hand-built test fixture, a legacy saved snapshot) still resolves the two
// confirmed rings rather than silently losing them. The stamp is the source of
// truth; this is the fallback, and it is deliberately not somewhere new names get
// added — a new name belongs in the shard, with its citation.
const DUPLICABLE_RINGS = new Set([
  // https://ddowiki.com/page/Item:Legendary_Katra%27s_Razor_Wit — tips:
  // "2 rings, identical or not, can be used for the set bonus."
  "Legendary Katra's Razor Wit",
  // https://ddowiki.com/page/Item:Legendary_Katra%27s_Wit — tips:
  // "2 rings, identically or not, can be used for set bonus."
  "Legendary Katra's Wit",
]);

/** #335 (KTD2) — the twin's model-side identity. Distinct so the solver can give
 *  it its own binary, recoverable so display and pins can name the real item.
 *  Physical-host paths keep the twin id verbatim; only display labels and pin
 *  resolution map back. */
const TWIN_SUFFIX = "::twin";
function twinIdOf(id) { return String(id == null ? "" : id) + TWIN_SUFFIX; }
function isTwinId(id) { return String(id == null ? "" : id).endsWith(TWIN_SUFFIX); }
function originalIdOf(id) {
  const s = String(id == null ? "" : id);
  return s.endsWith(TWIN_SUFFIX) ? s.slice(0, -TWIN_SUFFIX.length) : s;
}

/** #335 U1 — may this candidate carry a second copy? Three conditions, all
 *  required: the Ring slot (the only worn slot with cardinality 2 where identical
 *  named items can coexist), a set membership (without one a second copy adds
 *  nothing, since same-name/same-type affixes collapse to max), and the
 *  wiki-confirmed allowlist above. */
function isTwinEligible(variant) {
  if (!variant || variant.slot !== "Ring") return false;
  if (!((variant.set_bonus || []).length)) return false;
  // #442 — the build-stamped field first. FAIL-CLOSED in both branches: an
  // unstamped ring falls back to the two confirmed names and is otherwise
  // refused, never allowed. Reading silence as permission would hand the player
  // a loadout with two rings they cannot equip, which is indistinguishable from
  // a correct one until they try to wear it.
  if (variant.duplicable_ring === true) return true;
  return DUPLICABLE_RINGS.has(variantKey(variant));
}

// #573 — `ARMOR_DODGE_CAP = { cloth: 25, light: 25, medium: 11, heavy: 4 }` used to
// live here and clamp a ranked Dodge stat by armor category. It is GONE, and it must
// not come back in that shape. Three findings retired it, all recorded in
// `docs/wiki-evidence/intrinsic-stat-caps.md` §4:
//
//   1. The four numbers traced to nothing, in shipped solver input. A wrong clamp is
//      indistinguishable from a right one in a finished loadout.
//   2. The wiki rules the granularity impossible: the reduction is keyed to the
//      Maximum Dexterity Bonus of the SPECIFIC equipped armor, not to its category,
//      so no four-number table can be right for every armor in a category. And 25 is
//      the value Maximum Dodge Bonus *begins* at and the player raises, not a ceiling.
//   3. #199 harvested the intrinsic cap table and REFUSED Dodge outright
//      ("the cap is itself player-built"), which the dataset stamps as
//      `metadata.intrinsic_stat_caps_refused`. The clamp contradicted our own ruling.
//
// It also ignored the gear that exists to defeat it: `Solar Gem of Dodge Cap`
// (+1/+3) and `Sapphire of Armored Agility` (+1/+2 Max Dex Bonus) are real slottable
// augments carrying rankable stats, and a constant lookup could never read them.
//
// Dodge is now uncapped from gear, and the gap is DISCLOSED rather than guessed —
// `dodgeMaxDexLine` in projection.js fires whenever an armor type is chosen and Dodge
// is ranked, and points the player at the per-priority Max they can set by hand.

// #91 (U3, KTD1) — the Utility tier's sentinel priority token. It rides
// `query.targets` / `state.priorities` like a stat name but is NOT a stat: the
// stage loop special-cases it (maximize the distinct-effect count), and it is
// never fed to effectiveExpr, visibleGateSet's stat universe, probeMax, the
// floors/caps machinery, or the tie-break fallback's objectiveStat. The display
// name IS the token — a dataset collision guard (tests/dataset.test.js) pins
// that no affix name, picker vocab entry, or alias key ever equals it.
// `var`, not `const`: solver.js resolves it cross-runtime via the documented
// `typeof X !== "undefined"` browser-global bridge (the const→var shared-scope
// fix), same as pinnedVariantIds/normalizeCredits above it in that file.
var UTILITY_SENTINEL = "Utility effects";

// #346 (U1, KTD1/KTD2) — the crafting-and-augment ladder. One ordered control
// replaced the #245 `excludeCraftingSystems` boolean: each rung removes strictly
// more than the one above it, so no combination of settings can contradict
// itself and the bottom rung finally reaches the printed-only outcome the old
// checkbox's own help text described but could not deliver.
//
// Stored as a STRING on the query, never an integer: saved characters and backup
// files are JSON a player can read, and `printed-only` survives inspection where
// `3` does not. The ordering lives in ONE rank table — callers ask the three
// predicates below, never compare the stored value directly, so inserting a rung
// later cannot silently re-order anyone's saved setting.
//
// `var`, not `const`: projection.js and wizard.js read these as browser globals
// via the documented cross-runtime bridge (model.js loads before both), the same
// mechanism UTILITY_SENTINEL uses above.
// The array IS the rank table — index is rank, so the two cannot drift and there
// is no lookup object to be poisoned. A plain `{}` rank map answered `true` for
// inherited keys (`normalizeRung("constructor")` returned "constructor", and the
// rank came back as a Function), so a hand-edited backup could persist a value
// that passed the sanitizer and then compared as neither excluded nor valid.
var CRAFTING_RUNGS = [
  "everything",          // today's default — nothing excluded
  "no-niche-crafting",   // exactly the old boolean's `true`
  "no-solar-lunar",      // + Sun/Moon augments (the Solar/Lunar Gem family)
  "printed-only",        // + every remaining augment
];

/** Normalize a raw rung value. An absent, unrecognized, or hand-edited value
 *  reads as `everything` rather than throwing — the same fail-open posture #245
 *  used for its absent boolean. This is the load-boundary sanitizer: the wizard
 *  state, a restored save, and a hand-edited backup all pass through it. */
function normalizeRung(value) {
  return (typeof value === "string" && CRAFTING_RUNGS.indexOf(value) !== -1) ? value : "everything";
}
/** THE one implementation of the rung-vs-legacy-boolean precedence: a stored rung
 *  always wins, and the `excludeCraftingSystems` boolean speaks only when no rung
 *  exists anywhere. Every reader goes through here — the model seam, the wizard's
 *  load path, and the projection notice — because writing the rule three times is
 *  what let the model seam drift out of agreement with the other two, solving a
 *  legacy-only query with the craftable option pools fully live.
 *
 *  Takes two sources so one function serves every caller's shape: `primary` is
 *  the query (model, projection) or the saved inputs (wizard load), and
 *  `fallback` is the second place a caller may find either field — projection
 *  reads a solved query AND the saved inputs, and whichever carries the rung
 *  wins over whichever carries only the boolean. */
function craftingRung(primary, fallback) {
  const a = primary || {}, b = fallback || {};
  if (a.craftingRung != null) return normalizeRung(a.craftingRung);
  if (b.craftingRung != null) return normalizeRung(b.craftingRung);
  return (a.excludeCraftingSystems || b.excludeCraftingSystems) ? "no-niche-crafting" : "everything";
}

/** The Solar/Lunar Gem family by catalog colour. Named once so the eligibility
 *  gate, the results attribution, and the notice's gem count cannot disagree
 *  about what "Solar/Lunar" means. */
function isSolarLunarColor(color) {
  return color === "Sun" || color === "Moon";
}
function craftingRungRank(rung) {
  const i = CRAFTING_RUNGS.indexOf(rung);
  return i === -1 ? 0 : i;
}
/** The three questions the rest of the code asks. Rank comparisons live here and
 *  nowhere else, so the ladder's monotonicity is stated once. */
function rungExcludesNicheCrafting(rung) { return craftingRungRank(rung) >= 1; }
function rungExcludesSolarLunar(rung) { return craftingRungRank(rung) >= 2; }
function rungExcludesAllAugments(rung) { return craftingRungRank(rung) >= 3; }

// The Solar/Lunar Gem family IS the Sun and Moon colors — the one place a
// catalog color maps to a single named acquisition line (CONCEPTS.md, Multi-fit).
// Read from the normalized `aug_color.color`, the same field the augment pool
// groups by, so the exclusion and the color-capacity model cannot disagree.
function _isSolarLunar(v) {
  return isSolarLunarColor(((v && v.aug_color) || {}).color);
}

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
// #199 — wiki-sourced intrinsic in-game stat ceilings, emitted into items.json as
// `metadata.intrinsic_stat_caps` and installed here (dataset.js calls
// setIntrinsicCaps on load), same two-runtime bridge as the stacking table above.
// buildProgram merges these into cappedStats beside the player's own caps; the
// tighter of the two wins, which is the rule CONCEPTS.md "Stat cap" already states.
// (#573 removed a third source, the unsourced armor dodge clamp.)
//
// EXCLUDE-UNTIL-VERIFIED, and here the ABSENCE half is the load-bearing half: a
// stat missing from this table has NO ceiling in the game, not an unknown one.
// Four of the five stats harvested for #199 are absent deliberately — Doubleshot
// most sharply, which WRAPS past 100% into extra shots where its Doublestrike
// sibling stops dead, so capping it by analogy deletes real points. Never add a
// stat here without the verbatim wiki sentence stating its ceiling; the refusals
// and their quotes are in data/seed/compendium/intrinsic_stat_caps.json and
// docs/wiki-evidence/intrinsic-stat-caps.md.
let _INTRINSIC_CAPS = Object.create(null);
// #193/#599 — Essence Crafting coverage, same two-runtime bridge. The solver
// stamps it onto the result so the disclosure survives a restored snapshot: a
// shared build has to say it was solved over 25 of 170 options WITHOUT re-solving.
let _ESSENCE_COVERAGE = null;
function setEssenceCoverage(cov) { _ESSENCE_COVERAGE = cov || null; }
function essenceCoverage() { return _ESSENCE_COVERAGE; }

// #677 — ceilings the app KNOWS about, as one table both the pre-solve wizard and
// the post-solve projection read.
//
// Two kinds, and the distinction is the whole point:
//
//   * a CONFIRMED cap lives in `intrinsic_stat_caps.json`, is installed above, and
//     is applied by the solver whether or not the player types anything. There is
//     no entry here for those — `intrinsicCapFor` reads the installed table, so a
//     stat added by a future harvest gets the wizard line for free and nobody has
//     to remember to add it in two places.
//   * a DISCLOSED ceiling is one this repo deliberately REFUSED to clamp: #573's
//     armor Dodge limit (per item, not per category, and the wiki does not state
//     it) and #663's Jump soft cap (40 is height-only; Sneak, ACP and fall-damage
//     reduction each escape it). Those two get an entry, because there is no
//     number in the data to derive one from.
//
// NEVER PRE-FILL either kind into the Max box. Pre-filling a confirmed cap turns an
// unconditional guarantee into an editable preference (CONCEPTS.md: a user cap may
// only bind TIGHTER), and pre-filling a refused ceiling is inferring a value, which
// is the standing rule in AGENTS.md. These lines are read-only context.
//
// `ceiling` is the shared NUMBER. `tests/stat-ceilings.test.js` asserts that where
// one exists it also appears in the post-solve sentence in projection.js, so the
// two surfaces cannot come to quote different numbers at the player — the silent
// drift #677 asked to be designed out.
const CEILING_DISCLOSURES = {
  Dodge: {
    ceiling: null,               // per ARMOR, and the wiki does not state it per item
    line: "In game, your armor's Maximum Dexterity Bonus can reduce your Maximum Dodge "
        + "Bonus. That limit belongs to the individual armor, not to its category, and "
        + "the wiki does not state it per item — so this solve does not apply it, and "
        + "the Dodge total you get back will be the gear sum. If you know your armor's "
        + "limit, set it as the Max here.",
  },
  Jump: {
    ceiling: 40,
    line: "Jump HEIGHT stops improving at 40 — but Sneak applies \u221220, armor check "
        + "penalty is subtracted first, and falling-damage reduction keeps scaling past "
        + "40. Because those three escape the cap, this solve does not apply it. Set a "
        + "Max of 40 if none of them apply to you, and the slots above it go to your "
        + "next priority.",
  },
};

/** The read-only ceiling context for `stat`, or null when there is nothing to say.
 *
 *  Shape: `{ kind: "confirmed"|"disclosed", ceiling, line }`. A stat can never be
 *  both — a confirmed cap is applied and a disclosed one is refused, and rendering
 *  both would tell the player the same number is and is not in force. The confirmed
 *  branch is checked first and returns, which is that guarantee.
 *
 *  Returns null when no dataset is installed (an older cached items.json carries no
 *  `intrinsic_stat_caps` key), so the panel renders exactly as it did pre-#677
 *  rather than showing an empty or zero ceiling. */
function statCeilingHintFor(stat) {
  if (stat == null) return null;
  const cap = intrinsicCapFor(stat);
  if (typeof cap === "number") {
    return { kind: "confirmed", ceiling: cap,
      line: `Wiki-confirmed ceiling: ${cap}. It is already applied to this solve — `
          + "set a Max only if you want to stop BELOW it." };
  }
  const d = CEILING_DISCLOSURES[stat];
  return d ? { kind: "disclosed", ceiling: d.ceiling, line: d.line } : null;
}

/** #677 — the accessor the wizard reads, so nothing outside this file reaches into
 *  `_INTRINSIC_CAPS`. Returns null for an unknown stat AND for the uninstalled
 *  state, which the caller must treat as "no ceiling is known", never as zero. */
function intrinsicCapFor(stat) {
  if (stat == null) return null;
  const v = _INTRINSIC_CAPS[stat];
  return typeof v === "number" ? v : null;
}

// #683 — DISCLOSED name splits: one wiki mechanic under more than one spelling,
// with the stacking axis unsettled. Installed from dataset.js on load, same
// two-runtime bridge as the tables above.
//
// This is deliberately NOT `_STACK_EQUIV` and NOT `_CROSS_ADD`. Folding the
// spellings into one bucket takes the max, which asserts they do not stack;
// cross-adding them asserts they do. The wiki states both readings for this
// family on two different pages, so the app takes neither and tells the player
// instead. Nothing the solver reads may ever be derived from this table.
// docs/wiki-evidence/critical-multiplier-19-20.md.
let _SPLIT_MECHANICS = [];
function setSplitMechanics(list) {
  _SPLIT_MECHANICS = Array.isArray(list) ? list.slice() : [];
}
/** The disclosed family containing `stat`, or null. */
function splitMechanicFor(stat) {
  if (stat == null) return null;
  for (const fam of _SPLIT_MECHANICS) {
    if (Array.isArray(fam.spellings) && fam.spellings.includes(stat)) return fam;
  }
  return null;
}

function setIntrinsicCaps(map) {
  _INTRINSIC_CAPS = Object.create(null);
  if (map && typeof map === "object") {
    for (const k of Object.keys(map)) {
      if (typeof map[k] === "number") _INTRINSIC_CAPS[k] = map[k];
    }
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

// U1/U2 (#290/#291, extracted by #300) — the cross-add primitive (_CROSS_ADD
// state, setCrossAdd, crossAddSourcesFor, widenWithCrossAddSources) lives in
// cross-add.js, which OWNS the single state instance. Browser: cross-add.js
// loads before this file (web/index.html), so its function declarations are
// already the globals this file previously provided — model.js must NOT
// redeclare them. Node: require the one shared module instance (dataset.js and
// solver.js require it directly too). model.js re-exports the API below so
// every existing consumer of model.setCrossAdd/... keeps working unchanged.
var _crossAddApi = (typeof widenWithCrossAddSources !== "undefined")
  ? { setCrossAdd, crossAddSourcesFor, widenWithCrossAddSources }
  // eslint-disable-next-line global-require
  : require("./cross-add.js");

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

/** #648 — the Essence Crafting options this host could ACTUALLY place, as
 *  `menu||stat||type` keys.
 *
 *  The craftable value of a Gem lives in this pool, not in `variantBuckets` — the
 *  `[Crafted]` records carry `affixes: []`, their whole worth being three menus —
 *  so a Gem's bucket set is EMPTY and an empty set is a subset of every other, i.e.
 *  any trinket with one ranked affix dominated it outright. Measured before the
 *  fix: at ML caps 30 and 34 all three Gems were eligible and all three were
 *  pruned, so Essence Crafting reached the solver on no endgame query at all.
 *
 *  Keyed by the OPTION rather than by the menu because the menu alone is not what
 *  a rival must match — a host whose crafted level is under an option's `min_ml`
 *  cannot place it, so the heroic Gem's Extra menu offers strictly less than the
 *  legendary one's despite both declaring "Extra".
 *
 *  Takes the LIVE pool, never the marker: `dominates` must not protect a host
 *  whose every option is off-target. #371 paid for that lesson — four golden
 *  fixtures swapped in a value-less host that then won or lost the tie-break
 *  arbitrarily. An empty or absent pool makes this inert, which is also what the
 *  niche-crafting rung produces, so that rung keeps its pre-#648 prune.
 */
function essenceOfferKeys(variant, mlCap, essencePool) {
  const out = new Set();
  if (!essencePool || !essencePool.length) return out;
  const menus = variant.essence_slots || [];
  if (!menus.length) return out;
  const ml = craftedEssenceMl(variant, mlCap);
  if (!Number.isFinite(ml)) return out;
  const declared = new Set(menus.map((m) => m.menu));
  for (const o of essencePool) {
    if (!declared.has(o.menu)) continue;
    if (ml < (o.min_ml || 1)) continue;
    out.add(`${o.menu}||${o.stat}||${o.bonus_type}`);
  }
  return out;
}

/** #648/#611 — the level an essence host would be crafted at under this cap, which
 *  is min(its own ML, the cap): the ceiling is the item's own level and the cap is
 *  what a lower-level character can wear. Bare here (no rung check) because every
 *  caller already gates on a non-empty pool, and the pool is what the rung empties. */
function craftedEssenceMl(variant, mlCap) {
  const n = Number(variant && variant.ml);
  const c = Number(mlCap);
  return Number.isFinite(c) ? Math.min(n, c) : n;
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

/** #508 — the declaration was made and the style cannot honour it, so the feat
 *  changed NOTHING: no off-hand item was excluded, and no second weapon was
 *  offered either. Returns `{ style }` (the non-permitting style id, or null when
 *  none is set), else null.
 *
 *  The exact complement of `offHandItemsExcluded` over "TWF is declared", and it
 *  lives beside it for the reason that function documents: this is advisory, two
 *  surfaces read it, and a re-derivation at either would let them drift. The
 *  wizard warns at the point of DECLARATION and the results notice fires at the
 *  point the wrong answer is DELIVERED — a player who missed the first got a
 *  shield in a build they asked to be dual-wielding, with nothing on the results
 *  page saying the declaration had been ignored.
 *
 *  Deliberately NOT "did the player make a mistake". A declared-but-inert build is
 *  a legal, reachable state the UI supports on purpose (declare first, pick the
 *  style later), so this reports a consequence, never a scolding. */
function twfDeclaredButInert(query) {
  const T = _taxonomy();
  if (!(query && query.twoWeaponFighting) || !T) return null;
  if (T.twfWeaponAllowedForStyle(query.style)) return null;
  const style = query.style || null;
  // The display label comes from the taxonomy's own STYLES list rather than the
  // raw id, so the notice says "Two Handed Fighting" and not "thf". Resolved here
  // because this function already holds the taxonomy — projection.js owns the
  // sentence and should not have to learn the style vocabulary to write it.
  const row = style ? (T.STYLES || []).find((x) => x.id === style) : null;
  return { style, styleLabel: (row && row.label) || style };
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
    // #611 — Essence Crafting sets the item's ML, so an essence host's ML is not
    // the number the cap should be compared against. Live only when the rung
    // still supplies the pool (see below).
    essenceLive: !rungExcludesNicheCrafting(craftingRung(query)),
    ceiling: query.augCeiling ?? null,                     // #339 — optional augment-only ML ceiling
    rung: craftingRung(query),                             // #346 — the crafting/augment ladder
    pinnedIds,                                             // R8 — pins bypass the floor
    forged: isForgedRace(query.race),
    weaponAllow: allowedWeaponTypes(query),                // main-hand set | null
    offWeaponAllow: allowedOffHandWeaponTypes(query),      // off-hand weapon set | null
    offHand: offHandGate(query),                           // { blocked } | { allowed }
  };
}

/** #611 — the minimum level an Essence Crafting host would actually be worn at.
 *
 *  For everything else this is just `v.ml`. For a host carrying Essence menus it
 *  is `min(v.ml, cap)`, because the ML of such an item is set during crafting and
 *  is not a property it arrives with:
 *
 *    "This shard determines the minimum level of the item, the power level of
 *     scaling effect shards crafted onto the item"        — Essence Crafting, Steps
 *    "Search for the Minimum Level you wish to create."   — Essence Crafting steps
 *    "Scaling effects vary their values when placed in LOWER or higher Minimum
 *     Level shard items"                                  — Essence Crafting, Notes
 *
 *  So a Legendary Gem of Many Facets (native ML 30) is wearable by a character
 *  capped at 20 — crafted at ML 20, with ML-20 effect values, which the solver
 *  reads from the same harvested curve it already uses. Excluding it outright was
 *  asking the wrong question of the cap.
 *
 *  The `min` is what preserves the CEILING in the same expression: an item is
 *  never credited above its own ML. That ceiling is a player observation with
 *  named provenance rather than a wiki rule (a Legendary Gem refuses an ML 36
 *  shard, maintainer 2026-08-30) — but note the only ML restriction the wiki does
 *  state runs the same way: "the Minimum Level cannot be RAISED after
 *  disjunction" (Rune Arms). Nothing found anywhere prohibits lowering it.
 *
 *  Gated on `essenceLive` because `buildModel` empties the essence pool on the
 *  niche-crafting rung. Without that check a player who turned crafting OFF would
 *  be handed an over-cap Gem carrying nothing at all — its `[Crafted]` record has
 *  no native affixes, so uncrafted it is a blank.
 *
 *  Applied to the FLOOR as well as the cap, and deliberately: if the only way to
 *  wear this Gem is at ML 25, it is ML-25 gear, and a player who asked to hide
 *  gear below 29 asked to hide it. That can only change the answer when
 *  `cap < v.ml`, which is the case this function exists to create, so no existing
 *  build moves.
 */
function craftedMlOf(v, g) {
  if (v == null || v.ml == null) return v == null ? null : v.ml;
  if (!g || !g.essenceLive || g.cap == null) return v.ml;
  if (!((v.essence_slots || []).length)) return v.ml;
  return Math.min(v.ml, g.cap);
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
  const _ml = craftedMlOf(v, g);   // #611 — a crafting choice for essence hosts
  if (_ml != null && _ml > g.cap) return `above your ML ${g.cap} cap`;
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
  if (g.floor != null && _ml != null && _ml < g.floor
      && v.category !== "augment"
      && !(g.pinnedIds && g.pinnedIds.has(variantKey(v)))) return `below your ML ${g.floor} floor`;

  // #339 — the augment-only ML ceiling, the floor's inverse: it hides augment
  // tiers the player can't realistically obtain yet (e.g. the ML36 sale tier)
  // without capping worn gear, so it fires ONLY on `category === "augment"`.
  // Living here means eligible() (the augment pool), placement, alternatives,
  // and the browse ineligibility reason all inherit it from one choke point.
  // The pinnedIds exemption mirrors the floor's: a pin is an explicit
  // instruction that overrides the filter (KD5). Inert today — augments cannot
  // be pinned — it records the rule for the day augment pinning exists, and
  // cannot misfire on Artifact-injected pinnedIds entries (those are worn
  // items, never augments).
  if (g.ceiling != null && v.ml != null && v.ml > g.ceiling
      && v.category === "augment"
      && !(g.pinnedIds && g.pinnedIds.has(variantKey(v)))) return `above your augment ML ${g.ceiling} ceiling`;

  // #346 (U1) — the ladder's augment rungs, living beside the ceiling for the
  // same reason it does: this is the one choke point every augment path reads,
  // so the augment pool, placement, alternatives re-solves, and the browse
  // ineligibility reason all inherit the rung without a second code path.
  // Deliberately NOT pin-exempt, unlike the floor and ceiling: those hide gear
  // the player probably can't get yet, and a pin says "I have this one." The
  // ladder says "I will not slot augments at all", which a pin cannot override
  // without contradicting the rung the player just chose.
  if (v.category === "augment") {
    if (rungExcludesAllAugments(g.rung)) return "excluded — you chose to solve without augments";
    if (rungExcludesSolarLunar(g.rung) && _isSolarLunar(v)) {
      return "excluded — you chose to solve without Solar/Lunar gems";
    }
  }

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
  // `armorTypes` (an array of allowed types) — NOT on `query.armorType`, which is
  // the single armor the player declared. They stay decoupled: it avoids silently
  // excluding armor if the pipeline later stamps armor_type onto items[], and
  // `armorType` now feeds only the #573 disclosure. Fail-open on
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
  //
  // #369 — the pinnedIds exemption, for the same reason the ML floor and the
  // augment ceiling carry one: a pin is an explicit instruction that overrides
  // the filter (KD5). The checkbox governs whether the solver may CHOOSE an
  // artifact on its own; pinning one is the player choosing it themselves, and
  // the more specific instruction wins.
  //
  // Without this the pin was not merely ignored, it was ignored SILENTLY: the
  // variant never entered the pool, so its pick var never existed, and
  // slotConstraintBodies' documented "a pinned id absent from the pool is a
  // silent no-op" swallowed the constraint. reconcilePinLegality did not catch
  // it either — it consults weapon/armor/slot legality, which knows nothing
  // about this opt-in. Reproduced: pinning Baphomet's Reign with the box
  // unchecked left the Ring slot EMPTY and dropped its Conditioning 15 -> 0.
  //
  // dominanceFilter already protects pins from the pre-filter for the identical
  // structural reason; this closes the earlier gate it could never reach.
  if (v.artifact && !query.includeArtifact
      && !(g.pinnedIds && g.pinnedIds.has(variantKey(v))))
    return 'needs the "Include an Artifact" option';

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

// ---------------------------------------------------------------------------
// #539 — the SET PIN. "Deliver this set, or tell me you cannot."
//
// The nearest thing a player had was ranking the stats a set grants, which does
// not bind: the solver takes those stats from wherever they are cheapest, which
// is usually a Sun/Moon augment. A pin is the player naming a constraint, which
// is why it is not the weighted-sum non-goal — the cost is theirs to see and the
// lexicographic guarantee still holds underneath it.
//
// Classified HERE rather than left to the solver. A pin the pool cannot satisfy
// would otherwise surface as a bare INFEASIBLE, which says nothing about which
// input caused it. Every suppressed pin is REPORTED, never erased: a set that is
// unreachable under an ML 30 cap is reachable at 34, and the pin must survive
// that round trip (suppress-dont-erase-user-constraints-on-transient-invalidity).

/** The lowest piece threshold a set has anywhere in this dataset, or null. */
function lowestSetTier(setName, elig, augmentSetDefs, membershipSetDefs) {
  let low = null;
  const take = (n) => { if (n != null && (low == null || n < low)) low = n; };
  for (const defs of [augmentSetDefs || {}, membershipSetDefs || {}]) {
    const def = defs[setName];
    for (const t of (def && def.tiers) || []) take(t.pieces_required);
  }
  for (const v of elig || []) {
    for (const t of v.parsed_set_bonuses || []) {
      if (t.set === setName && (t.affixes || []).length) take(t.pieces_required);
    }
  }
  return low;
}

/** Distinct worn slots in the eligible pool that can supply an intrinsic piece. */
function intrinsicPieceSlots(setName, elig) {
  const slots = new Set();
  for (const v of elig || []) {
    for (const sb of v.set_bonus || []) {
      if (sb && sb.set === setName) slots.add(v.slot || v.category || "?");
    }
  }
  return slots.size;
}

/** Classify each requested set pin against what this query can actually reach.
 *
 *  Returns `{ pinned: [names], report: [{ set, verdict, ... }] }`. Only `pinned`
 *  reaches the solver; everything else is suppressed with a stated reason.
 *
 *  The reachability test is deliberately CONSERVATIVE and cheap. It catches the
 *  two cases a player can hit by accident — a set this dataset does not have, and
 *  a Set Augment they have not marked owned — plus an intrinsic set whose carriers
 *  cannot fill enough distinct slots. It does NOT try to prove joint feasibility
 *  across several pins; four 3-piece augment sets needing twelve colour slots is a
 *  question about the whole program, and the solver answers it (see the
 *  drop-the-pins retry in solveLexicographic).
 */
function classifySetPins(query, elig, augmentSetDefs, membershipSetDefs) {
  const want = Array.isArray(query.pinnedSets) ? query.pinnedSets : [];
  if (!want.length) return { pinned: [], report: [] };

  const owned = query.ownedSetAugments;
  const isOwned = (k) => owned && (typeof owned.has === "function" ? owned.has(k)
    : Array.isArray(owned) ? owned.includes(k) : false);

  const pinned = [];
  const report = [];
  const seen = new Set();
  for (const raw of want) {
    const set = typeof raw === "string" ? raw : "";
    if (!set || seen.has(set)) continue;
    seen.add(set);

    const isAugmentSet = !!(augmentSetDefs && augmentSetDefs[set]);
    const tier = lowestSetTier(set, elig, augmentSetDefs, membershipSetDefs);

    if (tier == null) {
      report.push({ set, verdict: "unknown", pieces_required: null,
        why: "no set by that name carries a piece threshold in this dataset" });
      continue;
    }
    // A Set Augment the player has not ticked as owned. Suppressed rather than
    // implicitly widened: widening would silently assume they own an augment they
    // said nothing about, and not assuming that is what the ownership picker is for.
    if (isAugmentSet && !isOwned(set)) {
      report.push({ set, verdict: "not-owned", pieces_required: tier,
        why: "this is a Set Augment you have not marked as owned" });
      continue;
    }
    // Membership and augment sets are supplied by crafting slots rather than by
    // distinct worn carriers, so the slot count below does not describe them.
    const craftSupplied = isAugmentSet || !!(membershipSetDefs && membershipSetDefs[set]);
    if (!craftSupplied) {
      const slots = intrinsicPieceSlots(set, elig);
      if (slots < tier) {
        report.push({ set, verdict: "unreachable", pieces_required: tier, available: slots,
          why: `only ${slots} slot${slots === 1 ? "" : "s"} in this pool can carry a piece, `
            + `and the set needs ${tier}` });
        continue;
      }
    }
    pinned.push(set);
    report.push({ set, verdict: "pinned", pieces_required: tier });
  }
  return { pinned, report };
}

/** Does A dominate B in the same slot? A must be >= on every bucket, superset
 *  of sets, and >= augment colors. Dominated variants are never optimal. */
function dominates(A, B, targetSet, mlCap, ncPerItemLiveHosts = null, essencePool = null) {
  const ba = variantBuckets(A, targetSet, mlCap);
  const bb = variantBuckets(B, targetSet, mlCap);
  for (const [key, vb] of bb) {
    if ((ba.get(key) || 0) < vb) return false;
  }
  // #614 — the same test over A's OWN buckets, which the loop above never
  // reaches. Domination is `A[k] >= B[k]` for every k in A UNION B, and iterating
  // only B's keys is sound exactly while every value is >= 0: an extra positive
  // bucket on A can only help it. `variantBuckets` keeps the sign, so a `Penalty`
  // affix puts a NEGATIVE value in a bucket B does not carry at all — invisible
  // here, and the penalised item then dominated the clean one.
  //
  // Worse, it dominated MUTUALLY: B could not see A's penalty either, so the
  // `i < j` tie-break kept whichever came first in the list and deleted the
  // other. Measured on a two-item pool identical but for a `Constitution |
  // Penalty | -2`: both directions returned true and the filter kept only the
  // PENALISED item, removing the clean alternative from the pool before the
  // program was built — upstream of all twelve `value > 0` gates, so fixing
  // those alone could never have surfaced it.
  //
  // Only A-only keys need the extra check; a key in both was covered above.
  for (const [key, va] of ba) {
    if (va < 0 && !bb.has(key)) return false;
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
  // Keyed through dinoSlotKeys so a Weapon slot carries the host's pool variant
  // (#283) — the two Main Hand blanks are otherwise indistinguishable here.
  const da = countColors(dinoSlotKeys(A));
  const db = countColors(dinoSlotKeys(B));
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
  // #648 — Essence Crafting menus, the seventh member of this family and the one
  // that was missing. Same shape as the six above, same reason: the craftable
  // value is outside `variantBuckets`, so the host reads as value-less.
  //
  // Two conditions, because a menu is not generic the way an augment color is.
  // A must offer every option B can place — matching the menu COUNT is not enough
  // when `min_ml` decides which options a menu actually yields — and A must craft
  // at a level at least as high, because every curve is monotonic non-decreasing
  // (#611), so the same option on a lower-ML host is worth strictly less. Without
  // the second test two hosts with identical option sets dominate each other and
  // the `i < j` tie-break keeps whichever came first, which can be the weaker one.
  //
  // Protective only: it can return false, never true, so it removes prunes and
  // never creates them. A Gem still cannot dominate a trinket carrying real
  // affixes, because that comparison is decided by the bucket loop above.
  const essB = essenceOfferKeys(B, mlCap, essencePool);
  if (essB.size) {
    const essA = essenceOfferKeys(A, mlCap, essencePool);
    for (const k of essB) if (!essA.has(k)) return false;
    if (craftedEssenceMl(A, mlCap) < craftedEssenceMl(B, mlCap)) return false;
  }
  // #371 — per-item Nearly Complete ("Nearly Finished" / "Almost There"): the
  // craftable value lives in a pool keyed by the host's OWN NAME, outside
  // variantBuckets, so a slotted host looks value-less to the bucket check. It is
  // also the one choice-slot family no OTHER item can substitute for: two items
  // both declaring `Nearly Finished` offer different options, so matching the
  // slot count is not enough — A must be the same host. Anything less prunes a
  // craft nothing else in the pool can supply.
  //
  // Gated on `ncPerItemLiveHosts` — the hosts whose pool survived the
  // target-advancing filter for THIS query — and NOT on the marker alone. The
  // marker says "this item can craft something"; only the pool says whether that
  // something is on a ranked target. Protecting a host whose options are all
  // off-target keeps a value-less item in the pool, where it ties with the
  // incumbent and wins or loses the tie-break arbitrarily: four golden fixtures
  // swapped in a Celestial Topaz Ring (Enhancement Cha/Int/Str) on Constitution
  // and Dexterity builds, gaining exactly nothing. Absent (null) the guard is
  // inert, so a caller that does not thread the pool gets the pre-#371 prune.
  // #371 — a live per-item Nearly Complete host is never dominated by a DIFFERENT
  // item. This is deliberately blunter than the augment/dino slot rules a few
  // lines below, and the reason is the mechanism, not caution: an augment slot is
  // generic, so A owning a Red slot really does substitute for B's Red slot and a
  // slot-COUNT comparison is sound. A per-item pool is keyed by the host's own
  // name, so A owning a `Nearly Finished` slot says nothing about whether A's
  // options cover B's — they are different option lists that merely share a label.
  // Counting slots here would prune a host whose craftable stats no peer can
  // offer. Same-item variants still compare normally (they share the pool).
  //
  // Cost: the 43 live hosts stay in the candidate set. That is why re-ratifying
  // the golden after this landed showed strict gains — the pre-filter had been
  // pruning items whose craftable value was invisible to it.
  if (ncPerItemLiveHosts && ncPerItemLiveHosts.size
      && ncPerItemLiveHosts.has(B.source_item || B.variant_id)
      && (A.source_item || A.variant_id) !== (B.source_item || B.variant_id)) {
    return false;
  }
  // Legendary Green Steel multi-tier choice-slots (#194), both halves: the
  // craftable value lives in `thunder_forged_tiers` (the weapon pool's legacy
  // marker) / `green_steel_tiers` (accessories) — a list of tier slots — outside
  // variantBuckets, so a slot-only blank would be pruned by any affix rival. A must
  // offer at least as many of each tier slot as B (same trap as Viktranium/Seal
  // hosts, and the Blank-host trap CONCEPTS.md describes: the 8 accessory blanks
  // carry NO affix but a drawback, so this clause is the only thing keeping them).
  const tfA = countColors((A.thunder_forged_tiers || []).map((s) => s.tier));
  const tfB = countColors((B.thunder_forged_tiers || []).map((s) => s.tier));
  for (const [k, n] of tfB) if ((tfA.get(k) || 0) < n) return false;
  const gsA = countColors((A.green_steel_tiers || []).map((s) => s.tier));
  const gsB = countColors((B.green_steel_tiers || []).map((s) => s.tier));
  for (const [k, n] of gsB) if ((gsA.get(k) || 0) < n) return false;
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
  // Absorption-quarantine disclosure (#255): a quarantined affix lives in
  // absorption_quarantined, outside variantBuckets — and the quarantine is exactly
  // what can make its carrier look weaker than a slot rival. Pruning the carrier
  // would silence buildAbsorptionQuarantineReport (which reads the pruned pool)
  // for the one item the disclosure exists to explain.
  const aqA = countColors((A.absorption_quarantined || []).map((q) => q.stat));
  const aqB = countColors((B.absorption_quarantined || []).map((q) => q.stat));
  for (const [k, n] of aqB) if ((aqA.get(k) || 0) < n) return false;
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

/** #283 — which Dino Weapon-pool variant a host draws. gear-planner ships a
 *  `(quarterstaff)` sibling of the Fang and Scale Weapon pools holding the
 *  versions a quarterstaff receives in game (implement bonuses the base versions
 *  lack), so records variant-marked by the pipeline (`quarterstaff: true/false`)
 *  are matched against this. The same single-authority rule as
 *  `lamordiaWeaponVariant`: the solver's capacity encoding and the dominance
 *  slot keys both read this, so which pool a host draws and how hosts compare
 *  cannot drift apart. */
function dinoWeaponVariant(v) {
  return v && v.type === "Quarterstaffs" ? "quarterstaff" : "base";
}

/** A host's typed Dino slots as a multiset key list for the dominance guard.
 *  A WEAPON-category slot carries the host's pool variant (#283): the typed
 *  quarterstaff blank and the untyped Weapon blank expose the same four physical
 *  slots and the same (empty) buckets, so without the variant in the key one
 *  would dominate the other and its richer insert options would vanish — the
 *  same trap #282 hit on the Lamordia side. Non-Weapon slots draw no variant
 *  pool, so their keys stay bare and compare equal across hosts. */
function dinoSlotKeys(v) {
  const variant = dinoWeaponVariant(v);
  return ((v && v.dino_slots_norm) || []).map(
    (k) => (String(k).endsWith("||Weapon") ? `${k}||${variant}` : k));
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

function dominanceFilter(slotVariants, targetSet, mlCap, cardinality = 1, pinnedIds = null, includeArtifact = false, handMutex = false, ncPerItemLiveHosts = null, essencePool = null) {
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
      if (dominates(B, A, targetSet, mlCap, ncPerItemLiveHosts, essencePool)
          && !(dominates(A, B, targetSet, mlCap, ncPerItemLiveHosts, essencePool) && i < j)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(A);
  }
  return kept;
}

/** Build the abstract model. Returns worn slots (filtered + pruned), the
 *  augment source pool, the Dino insert pool, and the target list. */
function buildModel(variants, query, dinoInserts = [], nearlyComplete = [], viktranium = [], seal = [], membershipSetDefs = {}, thunderForged = [], greenSteel = [], augmentSetDefs = {}, utilityCountingSet = null, nearlyCompletePerItem = {}, essenceCrafting = []) {
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
  // #346 (U1) — the ladder's niche-crafting rung. Behaviorally identical to the
  // #245 boolean it replaces; the augment rungs below it are enforced in
  // eligible() instead, because augments flow through the per-variant gate while
  // these option pools are model-level collections.
  if (rungExcludesNicheCrafting(craftingRung(query))) {
    dinoInserts = []; nearlyComplete = []; viktranium = []; seal = [];
    thunderForged = []; greenSteel = []; essenceCrafting = [];
    nearlyCompletePerItem = {};   // #371 — Nearly Finished / Almost There
    membershipSetDefs = {};   // chosen set-membership (Lost Purpose / Dino Set Bonus)
    augmentSetDefs = {};      // set-bonus augments are Dino crafting too
  }
  // Note for U5's unavailability reporting: Augment Sets need no separate rung
  // handling. They are already cleared above as set-bonus crafting, and the
  // ladder nests — every rung that excludes augments also excludes niche
  // crafting — so a set is unreachable from the no-niche-crafting rung down.
  // The bottom rung additionally empties the augment pool that would carry the
  // Set Augment, which is belt-and-braces, not a second mechanism.
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
  // Shared with buildProgram (solver.js), which builds the buckets.
  _crossAddApi.widenWithCrossAddSources(targetSet);
  // #91 (U3, KTD3) — CONDITIONAL utility widening, in LOCKSTEP with
  // buildProgram's (solver.js). When the Utility sentinel is ranked, every
  // counting-set name joins targetSet so the dominance pre-filter keeps
  // utility-only items alive and the option pools keep utility-granting
  // options — without the model-side half, the solver would never SEE the
  // utility gear its stage exists to place. Conditional on the sentinel being
  // in the query's targets: a tier-removed (or pre-feature) query rebuilds the
  // exact pre-feature pool, byte-identical program included.
  const utilityEnabled = (query.targets || []).includes(UTILITY_SENTINEL);
  // Fail fast rather than silently solving with zero indicators: utilityCountingSet
  // is a defaulted 11th positional param, so a forgotten call site would otherwise
  // widen nothing and the utility stage would place no gear with no error anywhere.
  // The LIVE reference sites are web/wizard.js's two buildModel calls — web/query.js
  // exists but is NOT loaded by web/index.html, so citing it here sent a #332 change
  // to a file the app never runs. Thread from dataset metadata (vocab.utilityCounting).
  // #332 — the 11th argument accepts EITHER a bare Set (every existing call site)
  // or `{ counting, notCounted }`. The not-counted half is the names a player can
  // rank individually while the tier never counts them; the solve
  // stamps the ranked ones onto its report so a restored character's exports can
  // name them without a dataset to re-derive from. #380 renamed the key from
  // `admitted` (it meant "reviewed UNTYPED weapon proc", which stopped describing
  // the population when upstream typed them all `Bool`); the old key is still
  // accepted so a caller built against the earlier shape keeps working rather
  // than silently resolving to null and disclosing nothing. Widening this one argument
  // keeps KTD3 intact — the sets still ride as an argument, never on the
  // persisted query — and adds no 12th positional param.
  //
  // The shape is resolved BEFORE the fail-fast guard below, deliberately: an
  // earlier draft threw on the raw argument, so `{}` or `{ admitted: X }` — an
  // object with no `counting` half — sailed past the guard, resolved to a null
  // counting set, and silently solved with zero utility indicators. That is the
  // exact failure the guard exists to prevent, reachable through the shape this
  // change introduced. Resolve first, then validate what was resolved.
  const _uCounting = (utilityCountingSet && typeof utilityCountingSet.has === "function")
    ? utilityCountingSet
    : (utilityCountingSet && utilityCountingSet.counting) || null;
  const _uNotCounted = (utilityCountingSet && !(typeof utilityCountingSet.has === "function")
    && (utilityCountingSet.notCounted || utilityCountingSet.admitted)) || null;
  // #348 (U3, R6) — the container's ORDER. Optional on the object form; when it is
  // absent the solver falls back to the counting set in sorted order so there is
  // exactly ONE encoding path rather than an ordered one and a count-maximizing
  // one. Sorted is a deterministic default, not a product decision — the product
  // order is web/dataset.js's UTILITY_CONTAINER_DEFAULT_ORDER, which the app passes
  // through vocab.utilityOrder.
  const _uOrder = (utilityCountingSet && typeof utilityCountingSet.has !== "function"
    && Array.isArray(utilityCountingSet.order)) ? utilityCountingSet.order.slice() : null;
  // Fail fast rather than silently solving with zero indicators: utilityCountingSet
  // is a defaulted 11th positional param, so a forgotten call site would otherwise
  // widen nothing and the utility stage would place no gear with no error anywhere.
  // The LIVE reference sites are web/wizard.js's two buildModel calls — web/query.js
  // exists but is NOT loaded by web/index.html, so citing it here sent a #332 change
  // to a file the app never runs. Thread from dataset metadata (vocab.utilityCounting).
  if (utilityEnabled && _uCounting == null) {
    throw new Error(
      "buildModel: the Utility sentinel is ranked but no counting set was resolved from "
      + "utilityCountingSet (the 11th argument). Pass a Set, or { counting, notCounted } with "
      + "a real `counting` half — an object without it resolves to nothing. Thread it from "
      + "dataset metadata "
      + "(vocab.utilityCounting) — see web/wizard.js's buildModel calls, the LIVE reference "
      + "sites; web/query.js is not loaded by web/index.html."
    );
  }
  if (utilityEnabled && _uCounting && _uCounting.size) {
    for (const n of _uCounting) targetSet.add(n);
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
  // #246 — the content-ownership filter, applied at THIS seam and for the same
  // reasons #110 gives: it filters CANDIDACY, upstream of dominanceFilter, so an
  // excluded winner leaves the genuine runner-up as the pool's new best, and it
  // removes the variant from every worn slot, both hands and the augment pools at
  // once. Expressing it as a variantConflict would instead say "this character can
  // never equip this", which is false — the player could buy the pack tomorrow.
  //
  // ABSENT `ownedPacks` means "filter nothing", exactly as an absent blocklist does.
  // A truthiness slip here would empty the pool for every caller that does not set
  // the key, which is most of them.
  //
  // What it excludes is deliberately NARROW: only a variant whose `location_pack`
  // is a real, named adventure pack the player did not tick. Everything else stays:
  //
  //   * `Free to Play` is a pack value meaning NO pack is required.
  //   * Crafting, vendor, event and Store gear is not pack-gated at all — 1,711
  //     variants that no expansion purchase gates, so excluding them would be wrong
  //     rather than merely cautious.
  //   * A variant whose pack could not be sourced (#495 leaves 33 source values
  //     unknown) is KEPT and disclosed. Dropping it would silently narrow the pool
  //     on a guess, which is the failure this whole filter exists to make visible.
  //
  // So the filter removes only what it can POSITIVELY determine is behind content
  // the player says they do not have.
  // Excluded sets — gear the player does not want the solver to reach for, named by the
  // SET rather than one item at a time. A set is typically 3-5 variants, so the
  // blocklist could already express this and doing so was simply tedious.
  //
  // It removes the member items from CANDIDACY, exactly as #110 and #246 do, and for
  // the honesty reason those chose that seam: what is not in the pool cannot appear in
  // the build, so nothing the player is shown can rest on a set they excluded.
  //
  // Deliberately NOT "forbid completing the set while allowing its items". That reading
  // is the true inverse of a set pin and is coherent, but it is a different feature with
  // a different disclosure, and offering both behind one label would leave a player
  // unsure which one they picked.
  const excludedSets = Array.isArray(query.excludedSets) && query.excludedSets.length
    ? new Set(query.excludedSets) : null;
  const setExcluded = [];
  const ownedPacks = Array.isArray(query.ownedPacks) ? new Set(query.ownedPacks) : null;
  const packExcluded = [];
  const packUncheckable = { count: 0 };
  const blockedIds = new Set(Array.isArray(query.blocklist) ? query.blocklist : []);
  const blocked = [];
  let elig = eligAll;
  if (blockedIds.size) {
    // #547 — a block names an ITEM, not a catalog record. 45 items are carried as
    // two records, `X` and `X [Crafted]` (the same thing after its Essence
    // Crafting slots are used), and blocking one used to hand the player the
    // other: identical slot, identical numbers, and a disclosure truthfully
    // reporting an exclusion, so the block read as ignored.
    //
    // The gate is NOT wrong and does not move. What widens is what a blocked id
    // resolves to: `block_identity` (stamped in dataset.js from a build-time
    // DERIVED and asserted pairing, never a name-suffix test here). A first pass
    // collects the identity of every record the player actually named; the second
    // blocks anything sharing one.
    //
    // Deliberately still upstream of dominanceFilter, and this does not soften
    // that: blocking a winner must still leave the genuine runner-up standing.
    // The twin was never a runner-up — it is the same offer.
    const blockedIdentities = new Set();
    for (const cand of eligAll) {
      if (blockedIds.has(variantKey(cand)) && cand.block_identity) {
        blockedIdentities.add(cand.block_identity);
      }
    }
    elig = [];
    for (const cand of eligAll) {
      const hit = blockedIds.has(variantKey(cand))
        || (cand.block_identity && blockedIdentities.has(cand.block_identity));
      (hit ? blocked : elig).push(cand);
    }
  }

  // Applied BEFORE the pack filter and after the blocklist, so a variant that is both
  // blocked and in an excluded set is attributed to the block — the more specific act.
  if (excludedSets) {
    const kept = [];
    for (const cand of elig) {
      const sets = (cand.set_bonus || []).map((sb) => sb && sb.set).filter(Boolean);
      (sets.some((nm) => excludedSets.has(nm)) ? setExcluded : kept).push(cand);
    }
    elig = kept;
  }

  // #246 — applied AFTER the blocklist so a variant the player both blocked and
  // does not own is attributed to the block, which is the reason they chose.
  if (ownedPacks) {
    const kept = [];
    for (const cand of elig) {
      const pack = cand.location_pack || null;
      if (!pack || pack === "Free to Play") { packUncheckable.count += 1; kept.push(cand); continue; }
      if (ownedPacks.has(pack)) { kept.push(cand); continue; }
      packExcluded.push(cand);
    }
    elig = kept;
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

  // #371 Nearly Finished / Almost There: the per-item option pools, keyed by
  // HOST NAME rather than by a shared menu — each host's slot offers only that
  // host's own options. Filtered to target-advancing options, host by host, for
  // the same reason every other pool is: an off-target option adds a binary and
  // a constraint the objective can never use. A host left with no surviving
  // option is dropped, so `model.nearlyCompletePerItem` never carries an empty
  // list the solver would emit a vacuous `<= 1` for.
  //
  // Computed HERE — before the dominance pre-filter, not down with the other
  // pools — because `ncPerItemLive` is what tells `dominates` which hosts have
  // a craft worth protecting. Done after the prune it would be too late: the
  // host is already gone.
  const ncPerItemPool = {};
  for (const [host, opts] of Object.entries(nearlyCompletePerItem || {})) {
    const kept = (opts || []).filter((o) => o && targetSet.has(o.stat) && o.value > 0);
    if (kept.length) ncPerItemPool[host] = kept;
  }
  const ncPerItemLive = new Set(Object.keys(ncPerItemPool));

  // Essence Crafting (#193/#599) — the Gem of Many Facets' three Trinket menus.
  // Filtered to RANKED stats only, like every other pool: an option nobody asked
  // for is a variable the MILP carries and can never use. `values_by_ml` rides
  // along because the magnitude depends on the host's CRAFTED ML, which is not
  // known until the option is bound to an item in the solver.
  //
  // #648 — computed HERE rather than down with the other pools, for exactly the
  // reason `ncPerItemPool` is: it tells `dominates` which hosts have a craft worth
  // protecting, and after the prune it would be too late — the host is already
  // gone. That was not a hypothetical. Before this moved, every Gem was deleted by
  // the dominance filter at ML caps 30 and 34, so Essence Crafting reached the
  // solver on no endgame query at all.
  const essencePool = (essenceCrafting || []).filter((o) => o && targetSet.has(o.stat)
    && Array.isArray(o.values_by_ml) && o.values_by_ml.length === 36);

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
    cands = dominanceFilter(cands, targetSet, mlCap, card, pinnedIds, withArt, false, ncPerItemLive, essencePool);
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
    targetSet, mlCap, 1, pinnedIds, withArt, true,   // handMutex: a both-hands weapon must not prune a 1H peer (KTD2)
    ncPerItemLive, essencePool);
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
  const offHand = dominanceFilter(offHandPool, targetSet, mlCap, 1, pinnedIds, withArt, false, ncPerItemLive, essencePool);
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

  // #199 — the wiki-sourced intrinsic ceilings, narrowed to the stats this solve
  // actually tracks so the program does not mint buckets for stats nobody ranked.
  const intrinsicCaps = {};
  for (const stat of Object.keys(_INTRINSIC_CAPS)) {
    if (targetSet.has(stat)) intrinsicCaps[stat] = _INTRINSIC_CAPS[stat];
  }

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

  // U81 Nearly Completed: the parametric option pool. ATOMIC since #211 (one
  // record per option, affixes inside — a Skill-menu craft grants six skills
  // together): keep an option when ANY of its affixes advances a ranked
  // target. Flat single-affix records still read, for back-compat.
  const ncPool = (nearlyComplete || []).filter((o) => {
    if (!o) return false;
    const affs = (o.affixes && o.affixes.length) ? o.affixes
      : (o.stat ? [o] : []);
    return affs.some((a) => targetSet.has(a.stat) && a.value > 0);
  });

  // U81 Viktranium ("Lamordia"): the typed option pool keyed by (slot_type,
  // category, tier). Each record is an ATOMIC craftable OPTION carrying one or
  // more affixes (the same UNIT shape as a Dino insert) — crafting the universal
  // spell-DC option grants all seven schools at once, so a caster ranking two
  // schools spends ONE slot, not two. Keep an option when ANY of its affixes
  // advances a ranked target; the solver attaches them per host via the item's
  // `lamordia_slots` at the host's tier and gates the whole option on one binary.
  // #194 — also used by the Thunder-Forged and Green Steel pools below, which are
  // the same ATOMIC shape. Named for Viktranium because that is where it started.
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
  // Thunder-Forged (tier-keyed) + Green Steel choice-slot pools, kept to
  // target-advancing options only; the solver attaches them per host via the marker.
  // #194 — read through `vikAdvances`, not `o.stat`: both pools are ATOMIC now, one
  // record per craftable option carrying an `affixes` list, so a multi-affix option
  // advances a target through ANY of its affixes. Reading only `o.stat` would drop
  // an option whose first affix is off-target while a later one is exactly what the
  // player ranked. Shared with Viktranium deliberately — three containers now have
  // this shape and a fourth reading it differently is how they drift apart.
  const tfPool = (thunderForged || []).filter((o) => o && vikAdvances(o));
  const gsPool = (greenSteel || []).filter((o) => o && vikAdvances(o));
  // #539 — classify the set pins against the ELIGIBLE pool. Done here, with the
  // pool and both def dicts in scope, so a pin the query cannot satisfy is named
  // as such instead of reaching the solver and coming back as a bare INFEASIBLE.
  const _setPins = classifySetPins(query, elig, augmentSetDefs, membershipSetDefs);

  return {
    query, targets: query.targets, worn, augments,
    // #110 (U2) — eligible-but-blocked variants, retained for the disclosure's
    // attribution. Never re-enters any pool below.
    blocked,
    // #246 — variants excluded because their adventure pack was not ticked, and a
    // count of those no ownership answer could apply to. Both are needed: a filter
    // that reports what it removed and stays silent about what it could not check
    // reads as a complete answer when it is a partial one.
    // Variants removed because they belong to a set the player excluded, retained for
    // the disclosure's attribution. Never re-enters any pool below.
    setExcluded,
    excludedSets: excludedSets ? [...excludedSets].sort() : null,
    packExcluded,
    packUncheckable: packUncheckable.count,
    ownedPacks: ownedPacks ? [...ownedPacks].sort() : null,
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
    // #371 — `{host name: [option]}`, read per host via the item's `nc_per_item_slots`.
    nearlyCompletePerItem: ncPerItemPool,
    thunderForged: tfPool, greenSteel: gsPool, essenceCrafting: essencePool,
    essenceCoverage: _ESSENCE_COVERAGE,
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
    // #539 — the set pins that SURVIVED classification, and the full verdict
    // list. `pinnedSets` is what the solver constrains; `setPinReport` is what
    // the results page discloses, including suppressed pins and why. Classified
    // against the eligible pool (post-block, pre-dominance): dominance never
    // prunes a variant carrying a set its dominator lacks, so a piece counted
    // here survives into the program.
    pinnedSets: _setPins.pinned,
    setPinReport: _setPins.report,
    intrinsicCaps, mlCap,
    // #91 (U3, KTD3) — the counting set rides the MODEL, never the persisted
    // query: buildProgram reads it from here to widen its own targetSet and
    // mint the per-effect indicator binaries. `utilityEnabled` mirrors the
    // widening condition above (sentinel ranked), so the two layers cannot
    // disagree about whether the tier is live for this solve.
    utilityCountingSet: _uCounting || null,
    // #332/#380 — the rankable-but-not-counted names, for the report's exclusion
    // sentence.
    utilityNotCountedSet: _uNotCounted || null,
    // #348 (U3) — the container's order, or null when the caller passed only a set.
    utilityOrder: _uOrder,
    utilityEnabled,
    // U1 — user-set per-stat caps (clamp a stat's counted value); merged with the
    // #199 intrinsic ceilings in buildProgram. U2 — per-stat floors (best-effort).
    userCaps: query.targetCaps || {},
    floors: query.targetFloors || {},
    // U1 (declared stat credits) — what the player already holds from a non-gear
    // source. Normalized to an array here so the solver has one shape to read;
    // the query carries a `(stat, bonus type)`-keyed map so the UI can address a
    // single credit for edit and removal.
    credits: normalizeCredits(query.declaredCredits),
    // The other half of the same picker — see `normalizeExclusions`.
    excludedTypes: normalizeExclusions(query.excludedTypes),
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
  // #88 U3 — the real bonus types the dataset carries that this list lacked.
  // Overrides and declared credits share one list so the vocabulary and
  // `_STACK_EQUIV` stay maintained together. The `X Natural` family is
  // deliberately still absent: equivType collapses those to their plain type, so
  // offering both names would put two names on one bucket.
  //
  // `Sneak Attack` was here and is gone (#608). It is not a bonus type — it is the
  // STAT being bonused — and it was offered only because 20 affixes still RECORDED
  // it, so removing the name first would have taken away the player's ability to
  // name or correct a bucket that still existed. The data was fixed first: the
  // wiki renders those affixes through Template:Sneak Attack Bonus, whose second
  // parameter is the bonus type and whose documented default is Enhancement, and
  // every one of the 20 rendered tooltips says "Enhancement modifier" outright.
  // With the records retyped, nothing carries `Sneak Attack` and the name could
  // leave. `overrides.test.js` enforced that order.
  //
  // The list is checked against the wiki's own Category:Bonus types on every
  // build — see data/seed/compendium/bonus_type_vocabulary.json and
  // tests/test_bonus_type_vocabulary.py, which carry the reasoning for the three
  // members that are real but uncategorised (Untyped, Orb, Vitality).
  "Orb", "Determination",
];
const _CREDIT_TYPE_SET = new Set(CREDIT_BONUS_TYPES);

// A player-typed magnitude is the first number in this system that does not trace
// to the wiki, so it is bounded as well as validated. Above ~1e15 the value
// stringifies into LP text HiGHS refuses to parse, and `highs.solve` THROWS out of
// the solver rather than returning `{status:"infeasible"}` — a hard crash instead
// of a graceful failure. No real DDO bonus approaches four digits.
const MAX_CREDIT_VALUE = 9999;

/** Declared credits as a deduped array, from either the keyed map or an array. */
/** The bonus types the player told the solver NOT to use for a stat.
 *
 *  A declared CREDIT says "I already have N of this, so only beat it". An
 *  EXCLUSION says "do not use this bonus type for this stat at all" — the player
 *  has it covered from somewhere the tool cannot see and does not want a slot
 *  spent on it, at any magnitude. The two are different answers to the same
 *  question, which is why they share a picker in the UI and nothing else: a
 *  credit is a floor a contribution can clear, an exclusion is not.
 *
 *  Same shape and the same refusals as `normalizeCredits` — an unknown bonus type
 *  or a prototype-pollution stat name is dropped rather than minting an LP
 *  variable for something no gear can carry.
 */
function normalizeExclusions(declared) {
  if (!declared) return [];
  const rows = Array.isArray(declared) ? declared : Object.values(declared);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const stat = String(row.stat == null ? "" : row.stat).trim();
    const bonusType = String(row.bonus_type == null ? "" : row.bonus_type).trim();
    if (stat === "__proto__" || stat === "constructor" || stat === "prototype") continue;
    if (!stat) continue;
    if (!_CREDIT_TYPE_SET.has(bonusType)) continue;
    const key = `${stat}||${bonusType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ stat, bonus_type: bonusType });
  }
  return out;
}


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
function _collectStatNames(into, affixes) {
  for (const a of affixes || []) {
    const n = a && (a.name != null ? a.name : a.stat);
    if (n) into.add(n);
  }
}

/** Every stat name any source in the ACTIVE pool can contribute. */
function poolStatNames(model) {
  const out = new Set();
  for (const slot of (model && model.worn) || []) {
    for (const v of slot.variants || []) {
      _collectStatNames(out, v.affixes);
      for (const s of v.scaling || []) if (s && s.stat) out.add(s.stat);
      for (const t of v.parsed_set_bonuses || []) _collectStatNames(out, t.affixes);
    }
  }
  const pools = [model.augments, model.dinoInserts, model.nearlyComplete, model.viktranium,
                 model.seal, model.thunderForged, model.greenSteel, model.essenceCrafting];
  for (const pool of pools) {
    for (const o of pool || []) {
      if (o && o.stat) out.add(o.stat);
      _collectStatNames(out, o && o.affixes);
    }
  }
  // #371 — the per-item pools are a map of host -> options, not a flat list.
  for (const opts of Object.values((model && model.nearlyCompletePerItem) || {})) {
    for (const o of opts || []) {
      if (o && o.stat) out.add(o.stat);
      _collectStatNames(out, o && o.affixes);
    }
  }
  for (const defs of [model.membershipSetDefs, model.augment_set_defs]) {
    for (const def of Object.values(defs || {})) {
      for (const t of (def && def.tiers) || []) _collectStatNames(out, t.affixes);
    }
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { poolStatNames, setIntrinsicCaps, setSplitMechanics, splitMechanicFor,
    intrinsicCapFor, statCeilingHintFor, CEILING_DISCLOSURES, setEssenceCoverage, essenceCoverage, craftedMlOf, queryGates, DUPLICABLE_RINGS, twinIdOf, isTwinId, originalIdOf, isTwinEligible,
    buildModel, normalizeCredits, normalizeExclusions, CREDIT_BONUS_TYPES, MAX_CREDIT_VALUE, eligible, variantConflict,
    classifySetPins, lowestSetTier, intrinsicPieceSlots, pinConflict, pinnedVariantIds, dominanceFilter, dominates,
    offHandItemsExcluded, twfDeclaredButInert, allowedOffHandWeaponTypes, pinSlotConflict,
    variantBuckets, variantSets, scaledValue, ncTier, lamordiaTier, lamordiaSlotKeys, lamordiaWeaponVariant,
    dinoWeaponVariant, dinoSlotKeys,
    isForgedRace, isDocent, isBothHandsWeapon, variantKey, setStackEquiv, equivType,
    UTILITY_SENTINEL,
    CRAFTING_RUNGS, craftingRung, craftingRungRank, normalizeRung, isSolarLunarColor,
    rungExcludesNicheCrafting, rungExcludesSolarLunar, rungExcludesAllAugments,
    setCrossAdd: _crossAddApi.setCrossAdd, crossAddSourcesFor: _crossAddApi.crossAddSourcesFor,
    widenWithCrossAddSources: _crossAddApi.widenWithCrossAddSources,
    WORN_SLOTS, SLOT_CARDINALITY,
  };
}
