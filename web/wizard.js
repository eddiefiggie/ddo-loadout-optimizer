// Guided-wizard flow controller (U1). Replaces the two-tab shell + the old
// query form: one linear flow (intro -> character -> gear pool -> priorities ->
// solve -> results) that drives the EXISTING engine (buildModel / solveLexicographic
// / renderResults) with the character gate (U2), Trove import (U5), and per-slot
// constraints (U6) wired in. Pure step helpers are exported for node tests; all
// DOM wiring is guarded so Node can require this file.

// ---- pure step machine (tested in tests/wizard.test.js) --------------------
const WIZARD_STEPS = ["intro", "character", "pool", "priorities", "results"];
const FORGED = new Set(["warforged", "bladeforged"]);

/** Can the flow advance FROM `stepId` given the collected state? Gates the
 *  Continue/Solve buttons. Unknown steps are permissive. */
function canAdvance(stepId, state) {
  if (stepId === "character") return !!state.race && Number(state.ml) > 0;
  if (stepId === "pool") return state.pool !== "owned" || !!state.ownedNames;
  if (stepId === "priorities") return (state.priorities || []).length > 0;
  return true;
}
/** Next step id after advancing from `stepId` (clamped at results). */
function nextStep(stepId, steps = WIZARD_STEPS) {
  const i = steps.indexOf(stepId);
  if (i < 0) return stepId;
  return steps[Math.min(i + 1, steps.length - 1)];
}
/** Previous step id (clamped at intro). */
function prevStep(stepId, steps = WIZARD_STEPS) {
  const i = steps.indexOf(stepId);
  if (i <= 0) return steps[0];
  return steps[i - 1];
}
const wizIsForged = (race) => FORGED.has(String(race || "").toLowerCase());

/** U1 (R1) — where loading a saved character lands. A snapshot that solved
 *  optimally goes straight to "results" (no pool/priorities detour); anything
 *  else (missing snapshot, or a non-optimal status) falls back to "priorities"
 *  so the user can re-solve, never a blank results view. Pure; unit-tested. */
function stepAfterLoad(snapshot) {
  return snapshot && snapshot.status === "optimal" ? "results" : "priorities";
}

/** Is this stat on/off ONLY — no magnitude to floor, cap, or declare?
 *
 *  `vocab.presence` alone is the wrong test. It means "appears as Bool on at
 *  least one item", and four stats are in it while also carrying a real typed
 *  magnitude elsewhere: Deception, Smoke Screen, Protection from Evil, and
 *  Underwater Action. Gating on `presence` alone hid the min/max control for
 *  those four AND stripped any floor already set on them — a bound the player
 *  could no longer see, clear, or re-enter, on a stat that genuinely has one.
 *
 *  A vocab without `magnitude` (hand-built test fixtures, older cached shape)
 *  falls back to the bare presence test, which is the prior behavior. */
function isPresenceOnly(stat, vocab) {
  if (!vocab || !vocab.presence || typeof vocab.presence.has !== "function") return false;
  if (!vocab.presence.has(stat)) return false;
  return !(vocab.magnitude && typeof vocab.magnitude.has === "function" && vocab.magnitude.has(stat));
}

/** Clean a stat->value bound map (caps/floors): keep only entries whose value is a
 *  finite number >= 0. Blank, null, negative, or non-numeric entries are dropped so
 *  a stray input never reaches the solver as a cap/floor.
 *
 *  `vocab` is optional and mirrors `cleanCreditMap`: given one, the stat is
 *  canonicalized and a PRESENCE stat is refused. R6 removes the min/max control
 *  from presence rows, but removing a control does not remove the value behind it
 *  — `targetCaps`/`targetFloors` persist through `INPUT_KEYS`, so a floor set on
 *  an on/off stat before this change would keep constraining every solve with no
 *  on-screen way to see or clear it. That is the orphaned-bound defect this repo
 *  already recorded. A bound on a binary stat is meaningless anyway: the stat's
 *  gear lands in a `stat||boolean` bucket with no magnitude to floor or cap.
 *  Callers without a vocab (unit tests supplying canonical names) get the prior
 *  behavior exactly. Pure; unit-tested. */
function cleanBoundMap(m, vocab) {
  const out = {};
  if (m && typeof m === "object") {
    for (const [stat, v] of Object.entries(m)) {
      if (v === "" || v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      // Deliberately NOT canonicalized, unlike cleanCreditMap. Bound keys come
      // from `state.priorities`, which addPriority already canonicalized, so a
      // rewrite here buys nothing — and it is not free: buildModel derives solver
      // targets from bound-map keys, so rewriting a stale non-canonical key
      // would resurrect a dead orphan bound AND mint a target the player never
      // ranked. Credits have no such path, which is why they canonicalize.
      if (isPresenceOnly(stat, vocab)) continue;
      out[stat] = n;
    }
  }
  return out;
}

// U2 (declared stat credits) — the curated bonus-type vocabulary and the shared
// sanitizer, resolved across runtimes (browser global from model.js; Node
// require) exactly as the pin helpers below are. The wizard must offer and accept
// precisely what the solver will honor: a selector built from a second list would
// drift, and a near-miss type is silently WRONG rather than rejected — it forms
// its own bucket, so the credit stops competing with gear and adds to it instead.
var _creditBonusTypes = (typeof CREDIT_BONUS_TYPES !== "undefined")
  ? CREDIT_BONUS_TYPES
  // eslint-disable-next-line global-require
  : require("./model.js").CREDIT_BONUS_TYPES;
var _maxCreditValue = (typeof MAX_CREDIT_VALUE !== "undefined")
  ? MAX_CREDIT_VALUE
  // eslint-disable-next-line global-require
  : require("./model.js").MAX_CREDIT_VALUE;
var _normalizeCreditsW = (typeof normalizeCredits !== "undefined")
  ? normalizeCredits
  // eslint-disable-next-line global-require
  : require("./model.js").normalizeCredits;

/** The state key for a credit. `(stat, bonus type)` is the uniqueness key (A2),
 *  so a stat-keyed map cannot express R2's "more than one credit on one stat". */
function creditKey(stat, bonusType) {
  return `${String(stat == null ? "" : stat).trim()}||${String(bonusType == null ? "" : bonusType).trim()}`;
}

/** Clean a declared-credit map on the way to the query, mirroring `cleanBoundMap`.
 *
 *  Canonicalizes the stat through the picker vocabulary first (KTD4): the solver
 *  matches a bucket's stat half by EXACT string and applies no aliasing, so a
 *  non-canonical name does not error — it forms an orphan bucket that silently
 *  contributes nothing. Validation itself is delegated to the same
 *  `normalizeCredits` the solver uses, so the wizard cannot accept a credit the
 *  solver would drop, or vice versa. Pure; unit-tested. */
function cleanCreditMap(m, vocab) {
  const canonical = vocab && typeof vocab.canonical === "function" ? vocab.canonical : (s) => s;
  const rows = [];
  if (m && typeof m === "object") {
    for (const row of Object.values(m)) {
      if (!row) continue;
      const stat = canonical(String(row.stat == null ? "" : row.stat).trim()) || row.stat;
      // A presence (on/off) stat has no magnitude to declare. Its gear lands in a
      // `stat||boolean` bucket, and the curated vocabulary has no boolean member,
      // so a magnitude credit would occupy a SEPARATE bucket and stack additively:
      // a declared Insight 3 on Blurry reported Blurry 4, and with a floor set the
      // meaningless magnitude satisfied it, so the solver stopped securing the item
      // that actually grants the feature. The UI does not offer the control here;
      // this is the second gate, for a credit that predates it or arrives restored.
      // Presence-ONLY, not merely presence-flagged: a stat with a real magnitude
      // bucket can carry a credit that competes in that bucket correctly. The
      // defect above is specific to a stat whose ONLY bucket is `stat||boolean`.
      if (isPresenceOnly(stat, vocab)) continue;
      rows.push({ stat, bonus_type: row.bonus_type, value: row.value });
    }
  }
  const out = {};
  for (const c of _normalizeCreditsW(rows)) out[creditKey(c.stat, c.bonus_type)] = c;
  return out;
}

/** The count phrase on a collapsed row's Advanced summary — "" when nothing is
 *  set. Pure and exported so the initial render and the in-place refresh below
 *  cannot word it differently, and so R5's pluralization is unit-tested. */
function advancedBadgeText(n) {
  if (!n) return "";
  return `· ${n} ${n === 1 ? "setting" : "settings"}`;
}

/** Is a declared credit's typed value one the solver will actually honor?
 *
 *  Hoisted to module scope so the row model below and the row markup share ONE
 *  predicate. They must agree: the badge counts a credit as an applied setting
 *  and the markup dims it as incomplete, and a row reading "1" whose only credit
 *  the solver drops is exactly the kind of claim this repo refuses to make. Lives
 *  beside `_maxCreditValue`, which is already resolved at module scope. Pure. */
function creditIsUsable(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= _maxCreditValue;
}

/** What one ranked row's Advanced panel holds, as plain data (no DOM).
 *
 *  Exists so R5's collapsed badge and R6's presence-row rule are unit-testable:
 *  `rankedHTML` and `renderRankedList` live inside the wizard's DOM closure and
 *  are not exported, and this suite has no jsdom, so behavior asserted only
 *  through them cannot be tested at all. The markup renders FROM this; it does
 *  not re-derive any of it.
 *
 *  `badgeCount` counts applied settings — a floor, a cap, and each USABLE credit
 *  — so a half-typed credit row does not inflate the badge. Pure; unit-tested. */
function advancedRowModel(stat, state, vocab) {
  const s = state || {};
  // R6 — an on/off-ONLY stat has no magnitude to floor or cap, and suppresses
  // declared credits too, so its panel would be empty. No control at all. A stat
  // that is Bool on some items but carries a real magnitude on others keeps its
  // panel: it has something to bound.
  if (isPresenceOnly(stat, vocab)) {
    return { hasAdvanced: false, floor: null, cap: null, credits: [], badgeCount: 0 };
  }
  const pick = (map) => {
    if (!map || typeof map !== "object") return null;
    // hasOwnProperty, not `map[stat] != null`: a stat named "__proto__" would
    // otherwise resolve to Object.prototype and read as a set bound.
    if (!Object.prototype.hasOwnProperty.call(map, stat)) return null;
    const v = map[stat];
    return (v == null || v === "") ? null : v;
  };
  const floor = pick(s.targetFloors);
  const cap = pick(s.targetCaps);
  const all = (s.declaredCredits && typeof s.declaredCredits === "object") ? s.declaredCredits : {};
  const credits = Object.entries(all)
    .filter(([, c]) => c && c.stat === stat)
    .map(([key, c]) => ({
      key, stat: c.stat, bonus_type: c.bonus_type, value: c.value, usable: creditIsUsable(c.value),
    }));
  const badgeCount = (floor != null ? 1 : 0) + (cap != null ? 1 : 0)
    + credits.filter((c) => c.usable).length;
  return { hasAdvanced: true, floor, cap, credits, badgeCount };
}

// U3 — the Advanced panel's prose, defined ONCE here and interpolated per row.
//
// It renders once per magnitude row by design: the panel is closed by default and
// a player opens one at a time, so the explanation lands next to the inputs it
// describes instead of stranded at the bottom of the list. "Appears exactly once"
// is therefore a claim about this source, not about the rendered DOM — a twelve-
// row list has twelve copies in the markup and one definition here.
//
// `lead` states the default first (R4). Most solves want neither bound, and an
// empty box reads as unfinished, which invites players to constrain a solve they
// had no reason to constrain.
const ADVANCED_PANEL_HELP = {
  lead: "<strong>Nothing set is the default.</strong> With no min and no max, the solver takes as much of this stat as it can fit without giving up anything ranked above it. Leave both blank unless you have a specific number in mind.",
  min: "<strong>Min is a hard floor.</strong> The solver sacrifices your lower priorities to reach it, and if it can't, it chases that stat above everything else. Use it only for a number you truly must hit (e.g. a survivability threshold like PRR).",
  max: "<strong>Max is a cap.</strong> Stop valuing a stat past a breakpoint you know is real (e.g. 100% doublestrike). The tool can't verify in-game caps for you — set one only when you know the breakpoint.",
  // R7 — the sources this covers, on screen rather than only in a tooltip. The
  // feature exists because these bonuses are invisible to the tool, so a label
  // that does not name them cannot be found by the player who needs it.
  credit: "<strong>Already have some of this?</strong> Character effects the tool can't see — trances, enhancements, epic destinies, past lives, filigrees, ship buffs — won't be found in your gear. Declare the amount and the solver stops spending a slot to beat it.",
};

// U2/KTD1 — which rows currently have their Advanced panel open.
//
// `renderRankedList` rebuilds the whole list with `ol.innerHTML = rankedHTML()`,
// and every credit mutation (add, remove, retype) plus reorder and drop calls
// `rerender()`. A `<details open>` would therefore snap shut the instant the
// player clicks "+ already have" INSIDE the panel they just opened — the single
// most likely interaction. So the open set lives out here, survives the rebuild,
// and the markup sets `open` from it.
//
// Keyed by STAT NAME, not row index: reordering changes indices, and a panel
// should follow its stat up and down the list rather than staying at position 3.
//
// Ephemeral by design — never enters `state`, `INPUT_KEYS`, or the query. Module
// scope (not the DOM closure) so the sweep semantics are unit-testable at all;
// the Priorities step and the in-results Adjust panel share one set, which is
// correct because the same stat in both is the same stat and they are never
// visible at once.
const openPanels = new Set();
/** Record a panel's open state. Pure w.r.t. everything but the module set. */
function openPanelToggle(stat, isOpen) {
  if (isOpen) openPanels.add(stat); else openPanels.delete(stat);
  return openPanels;
}
/** Drop one stat's entry — called when its priority is removed, so a deleted
 *  stat leaves nothing behind (mirrors the bounds/credits cleanup beside it). */
function openPanelSweep(stat) {
  openPanels.delete(stat);
  return openPanels;
}
/** Reset every entry — called on character load, where the whole priority list
 *  is replaced and any carried-over open row would belong to the old build. */
function openPanelClear() {
  openPanels.clear();
  return openPanels;
}

/** Pure state -> solver query mapping (no DOM). Exported for unit tests.
 *  `vocab` is the picker vocabulary; callers inside the wizard closure pass it so
 *  a declared credit's stat is canonicalized to the ONE name gear carries (KTD4)
 *  and a presence stat is refused. Omitted in unit tests that supply already-
 *  canonical stats. */
function buildQuery(state, vocab) {
  const forged = wizIsForged(state.race);
  return {
    mlCap: Number(state.ml) || 36,
    mlFloor: Number(state.mlFloor) || null,   // optional item-level floor (hide low-ML gear)
    targets: state.priorities.slice(),
    armorType: forged ? null : (state.armor || null),   // dodge-cap input
    // U4 — armor eligibility gate (R7). A druidic oath now drives TWO independent
    // things (#162): proficiency (light + medium body armor, non-Tower shields) via
    // armorTypes here, and a metal restriction via `oath` + the wiki-sourced material
    // map below. This replaces the old cloth+light approximation, which wrongly
    // excluded every medium armor including non-metal ones. Forged wear docents, so
    // the gate is moot for them (docent handling lives in the R6 branch).
    armorTypes: forged ? undefined
      : (state.oath === "druid" ? ["cloth", "light", "medium"]
        : (state.armor ? [state.armor] : undefined)),
    oath: forged ? null : (state.oath || null),
    // U3 — combat-style / weapon-type / off-hand constraints (replaces the inert
    // coarse `weaponSetup`). Empty arrays / unset style => unconstrained.
    style: state.style || null,
    weaponTypes: Array.isArray(state.weaponTypes) ? state.weaponTypes.slice() : [],
    offHand: Array.isArray(state.offHand) ? state.offHand.slice() : [],
    offHandWeapons: Array.isArray(state.offHandWeapons) ? state.offHandWeapons.slice() : [],
    // plan 003 U1 — the Two Weapon Fighting declaration (R1). Dual-wield used to
    // switch on as a side effect of picking an off-hand weapon type, which nothing
    // signposted; it is now an explicit character-level feat declaration. Always a
    // boolean, never undefined, so a pre-U1 state resolves to undeclared rather
    // than to a stray truthy value downstream.
    twoWeaponFighting: !!state.twoWeaponFighting,
    race: state.race || null,
    alignment: state.alignment || null,
    includeArtifact: !!state.includeArtifact,           // U4 — Artifact opt-in
    // U6 — set-augment ownership gate. A Set of owned set-augment `set` names;
    // empty => none of the 21 set augments are considered (default off).
    ownedSetAugments: state.ownedSetAugments instanceof Set
      ? new Set(state.ownedSetAugments)
      : new Set(Array.isArray(state.ownedSetAugments) ? state.ownedSetAugments : []),
    slotConstraints: state.slotConstraints,
    // U1/U4 — per-priority stat caps (max) and floors (min), stat-keyed. Only clean,
    // non-negative entries are emitted; empty maps mean "no caps/floors" (default).
    // `vocab` is passed for the same reason cleanCreditMap gets it: canonicalize
    // the stat, and refuse a bound on a presence stat now that R6 has removed the
    // control that set it (see cleanBoundMap).
    targetCaps: cleanBoundMap(state.targetCaps, vocab),
    targetFloors: cleanBoundMap(state.targetFloors, vocab),
    // U2 — declared stat credits, `(stat, bonus type)`-keyed. Always emitted; an
    // empty map is inert, because buildModel normalizes it to no credits — so an
    // undeclared build solves exactly as it did before this feature (R3). The key
    // is present either way, so the query object is not byte-identical to a
    // pre-feature one; nothing hashes or diffs it.
    declaredCredits: cleanCreditMap(state.declaredCredits, vocab),
  };
}

// U3 — the shared pin-normalize path, resolved once across runtimes (browser
// global from model.js; Node require). So the wizard reads a list-shaped Ring pin
// exactly as the solver does.
var _pinnedVariantIds = (typeof pinnedVariantIds !== "undefined")
  ? pinnedVariantIds
  // eslint-disable-next-line global-require
  : require("./model.js").pinnedVariantIds;

// R4a — same cross-runtime resolve for the legality gate (browser global vs Node
// require), so reconcilePinLegality works in tests and in the app.
var _pinConflict = (typeof pinConflict !== "undefined")
  ? pinConflict
  // eslint-disable-next-line global-require
  : require("./model.js").pinConflict;

// R12 — the both-hands classifier, for the dual-pin aggregate warning.
var _isBothHandsWeapon = (typeof isBothHandsWeapon !== "undefined")
  ? isBothHandsWeapon
  // eslint-disable-next-line global-require
  : require("./model.js").isBothHandsWeapon;

// plan 003 U5/KTD6 — the SLOT-AWARE pin predicate, resolved the same way. Layered on
// top of _pinConflict rather than folded into it: see model.js for why the shield
// exclusion must stay out of variantConflict.
var _pinSlotConflict = (typeof pinSlotConflict !== "undefined")
  ? pinSlotConflict
  // eslint-disable-next-line global-require
  : require("./model.js").pinSlotConflict;
// plan 003 U5 — U2's exported advisory predicate, so the R8 override flag and the
// U6 results notice read ONE authority and cannot drift.
var _offHandItemsExcluded = (typeof offHandItemsExcluded !== "undefined")
  ? offHandItemsExcluded
  // eslint-disable-next-line global-require
  : require("./model.js").offHandItemsExcluded;
// plan 003 U5 — handedness, for the pin flow's hand target.
function _weaponTaxonomy() {
  if (typeof WeaponTaxonomy !== "undefined") return WeaponTaxonomy;
  if (typeof require !== "undefined") {
    try { return require("./weapon-taxonomy.js"); } catch (e) { /* absent */ }
  }
  return null;
}

// U3 — pure pin-mutation core (exported for tests; the wizard closure wraps these
// with its live cardinality lookup). A pin forces an item into its WORN-slot label
// (KTD4): a weapon's `variant.slot` is "Weapon", but the solver groups pick-vars by
// "Main Hand", so pinning by the raw slot would silently no-op. `cardOf(slot)` gives
// the slot cardinality (Ring = 2, else 1): a full single slot replaces, a full Ring
// keeps the newest two; a duplicate variant is ignored.
//
// plan 003 U5 (R6, KTD5) — the hand target. This line used to send EVERY weapon to
// "Main Hand" unconditionally, so an off-hand weapon pin could not be expressed at
// all: a longsword pinned as a second weapon silently landed in the main hand. That
// is the second, independent half of the reported bug (U2 fixed the first). `hand`
// is honored only for weapons; a shield or a ring keeps its own worn slot whatever
// is passed. Absent `hand` => Main Hand, so every existing call site is unchanged.
function pinWornSlotOf(v, hand) {
  if (v.category !== "weapon") return v.slot;
  return hand === "Off Hand" ? "Off Hand" : "Main Hand";
}
/** The worn slots a pinnable item can be pinned to, in offer order. Only a
 *  ONE-HANDED weapon offers a choice; everything else has exactly one home.
 *  An untyped weapon host has unknown handedness — it could be crafted two-handed,
 *  which cannot be dual-wielded — so it is not offered as an off-hand pin, matching
 *  offHandWeaponOk's "concrete type match required" rule in model.js. */
function pinHandsFor(v) {
  if (!v || v.category !== "weapon") return [v ? v.slot : null];
  const T = _weaponTaxonomy();
  const oneHanded = !!T && v.type != null && T.styleOfType(v.type) === T.ONE_HAND;
  return oneHanded ? ["Main Hand", "Off Hand"] : ["Main Hand"];
}
/** plan 003 U4 (R9) — does this saved character need the Two Weapon Fighting
 *  migration? True only for a save written BEFORE U1: no `twoWeaponFighting` field
 *  at all, but a non-empty `offHandWeapons` list, which was the old opt-in trigger.
 *  Those characters had dual-wield ON; leaving them undeclared would silently put a
 *  shield back in their off hand on the next solve.
 *
 *  Idempotent by construction: persist.js coerces the field to a boolean on every
 *  save, so its PRESENCE means the player has a stored choice — including an explicit
 *  `false`, which is honored rather than overwritten. */
function twfMigrationNeeded(inputs) {
  const i = inputs || {};
  if (i.twoWeaponFighting !== undefined) return false;
  return Array.isArray(i.offHandWeapons) && i.offHandWeapons.length > 0;
}
function pinIdOf(v) { return v.variant_id || v.source_item; }
// Pin one variant id into a known worn slot (used both by the Gear-pool search,
// via applyPin, and by the results Deep-Dive per-row pin action). A full single
// slot replaces; a full Ring keeps the newest two; a duplicate is ignored.
function applyPinId(slotConstraints, slot, id, cardOf) {
  const card = (cardOf && cardOf(slot)) || 1;
  const c = slotConstraints[slot];
  const existing = (c && c.type === "pin") ? _pinnedVariantIds(c) : [];
  if (existing.includes(id)) return slotConstraints;              // no duplicate variant
  let next = existing.concat(id);
  if (next.length > card) next = next.slice(next.length - card);  // single replaces; Ring keeps newest 2
  slotConstraints[slot] = card > 1 ? { type: "pin", variant_ids: next } : { type: "pin", variant_id: next[0] };
  return slotConstraints;
}
function applyPin(slotConstraints, v, cardOf, hand) {
  return applyPinId(slotConstraints, pinWornSlotOf(v, hand), pinIdOf(v), cardOf);
}
function removePinFrom(slotConstraints, slot, id, cardOf) {
  const c = slotConstraints[slot];
  if (!c || c.type !== "pin") return slotConstraints;
  const remaining = _pinnedVariantIds(c).filter((x) => x !== id);
  const card = (cardOf && cardOf(slot)) || 1;
  if (!remaining.length) delete slotConstraints[slot];
  else if (card > 1) slotConstraints[slot] = { type: "pin", variant_ids: remaining };
  else slotConstraints[slot] = { type: "pin", variant_id: remaining[0] };
  return slotConstraints;
}

// R12 — a pinned two-handed (both-hands) main-hand weapon and a pinned off-hand item
// are mutually exclusive under the hand mutex: each passes its own per-item legality,
// so the conflict is the COMBINATION and needs an aggregate check. `pins` is the
// [{slot, id}] list from currentPins; `itemByPinId` resolves an id to its variant.
// Exported so the aggregate warning is unit-tested (renderPinList is DOM-bound).
function dualPinMutexConflict(pins, itemByPinId) {
  let bothHandsMain = false, offHand = false;
  for (const p of pins) {
    const it = itemByPinId(p.id);
    if (!it) continue;
    if (p.slot === "Main Hand" && _isBothHandsWeapon(it)) bothHandsMain = true;
    if (p.slot === "Off Hand") offHand = true;
  }
  return bothHandsMain && offHand;
}

// R4a — pre-solve pin-legality reconciliation. The post-solve "landed" sweep can't
// catch a forced-in illegal pin: a pinned item is forced to x=1, so it always lands.
// Drop any pin illegal for the current character config BEFORE building the model,
// mirroring the pin-list advisory (pinConflict) but acting on it so R1 holds under
// pinning. Mutates slotConstraints through the tested removePinFrom core; returns
// the dropped {slot, id} entries for disclosure. `itemByPinId` resolves a pin id to
// its variant. Not a solver constraint (KTD1) — the pool is reconciled instead.
function reconcilePinLegality(slotConstraints, itemByPinId, query, cardOf) {
  const dropped = [];
  Object.entries(slotConstraints).forEach(([slot, c]) => {
    if (!c || c.type !== "pin") return;
    _pinnedVariantIds(c).forEach((vid) => {
      const it = itemByPinId(vid);
      // plan 003 U5/KTD6 — two authorities, both consulted. `_pinConflict` is the
      // per-variant gate list; `_pinSlotConflict` adds the slot-aware layer, which is
      // what makes R7 real: an off-hand weapon pin without the declaration is dropped
      // here instead of surviving into the solve as a constraint on a variant that is
      // absent from its own pool (a no-build). It deliberately returns null for a
      // pinned shield on a declared build, so the escape hatch is never swept.
      if (it && (_pinConflict(it, query) !== null || _pinSlotConflict(it, slot, query) !== null)) {
        removePinFrom(slotConstraints, slot, vid, cardOf);
        dropped.push({ slot, id: vid });
      }
    });
  });
  return dropped;
}

// Resolve the shared picker-vocabulary builder across both runtimes: Node (require
// the dataset module the tests use) and browser (the global the scripts share).
function _datasetNormalizer() {
  if (typeof require !== "undefined") { try { return require("./dataset.js"); } catch (e) { /* absent */ } }
  return (typeof window !== "undefined") ? window.DatasetNormalizer : null;
}

/** Priority-picker affix vocabulary (U5): the UNION of every affix source (gear,
 * augments, set bonuses, and ALL crafting pools), canonicalized through the alias
 * table and filtered to the rankable ones — so a crafting-only affix is selectable
 * and one target matches gear/augments/crafting by one canonical name. Returns
 * { suggestions, known, canonical }. Falls back to a present-affix scan only when
 * the shared builder is unavailable. Gates *suggestions* only — free-typed input
 * (validated against `known`, canonicalized) still accepts any real affix. */
function pickerVocabulary(dataset) {
  const N = _datasetNormalizer();
  if (N && N.buildPickerVocabulary) return N.buildPickerVocabulary(dataset);
  const set = new Set();
  (dataset.items || []).forEach((v) => {
    (v.affixes || []).forEach((a) => set.add(a.name != null ? a.name : a.stat));
    (v.scaling || []).forEach((s) => set.add(s.stat));
    (v.parsed_set_bonuses || []).forEach((t) => (t.affixes || []).forEach((a) => set.add(a.stat)));
  });
  return { suggestions: [...set].sort(), known: set, canonical: (n) => String(n == null ? "" : n).trim() };
}

/** Back-compat: the sorted suggestion list (used by the datalist + tests). */
function curatedStats(dataset) {
  return pickerVocabulary(dataset).suggestions;
}

// Composable affix BUNDLES — modelled on the DDO gear planner's "packages" (its
// "pick a bundle of affixes to save time"). Picking a bundle APPENDS its affixes
// to the priority list (deduped, in the bundle's order); the user then reorders /
// adds / removes. Additive + layered, NOT one-shot archetype templates:
//   * top packages: Basic / Melee / Ranged / Caster / Trapping
//   * Melee reveals TACTICS; Caster reveals SPELL SCHOOLS + damage-type SPELL POWER
// Affix lists are the gear planner's, verbatim; resolveBundle canonicalizes +
// drops any our dataset doesn't carry, so a bundle can never inject a dead target.
const PRESET_BUNDLES = {
  // Order within a bundle is the order it lands in the priority list, and #1 is
  // maximized first — so a bundle's lead affixes are a real recommendation, not
  // cosmetics. Basic and Ranged lead with what players actually want first.
  Basic: ["Constitution", "Healing Amplification", "Physical Sheltering", "Magical Sheltering", "Dodge", "Fortification", "False Life", "Resistance", "Freedom of Movement", "Blurry", "Ghostly", "Blindness Immunity"],
  Melee: ["Melee Power", "Doublestrike", "Melee Alacrity", "Accuracy", "Deadly", "Seeker", "Armor-Piercing", "Armor Class"],
  Ranged: ["Ranged Power", "Doubleshot", "Deadly", "Armor-Piercing", "Ranged Alacrity", "Accuracy"],
  Caster: ["Universal Spell Power", "Universal Spell Lore", "Spell Penetration", "Spell Focus Mastery", "Wizardry", "Spellcraft"],
  Trapping: ["Open Lock", "Disable Device", "Spot", "Search"],
  // Warlock is the one class-named package: its damage identity is pact dice and
  // eldritch blast rather than a role the other packages already cover. Blast
  // damage type is set by pact, so all three families ship together and the
  // player drops the two that don't apply.
  Warlock: ["Power in Pact", "Eldritch Blast Dice", "Charisma", "Spell Focus Mastery", "Spell Penetration", "Potency", "Universal Spell Power", "Constitution", "Nullification", "Void Lore", "Radiance", "Radiance Lore", "Impulse", "Kinetic Lore"],
  // The six ability scores, as one click. Its own row above Tactics — always
  // visible, revealed by nothing, since every build wants some of these.
  Attributes: ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  // tactics (revealed by Melee) — each is a single presence affix
  Stunning: ["Stunning"], Sundering: ["Sundering"], Vertigo: ["Vertigo"],
  // spell schools (revealed by Caster) — the button label is the school, the affix is "<School> Focus"
  Evocation: ["Evocation Focus"], Transmutation: ["Transmutation Focus"], Abjuration: ["Abjuration Focus"],
  Conjuration: ["Conjuration Focus"], Enchantment: ["Enchantment Focus"], Illusion: ["Illusion Focus"], Necromancy: ["Necromancy Focus"],
  // damage-type spell power (revealed by Caster) — power + lore + intensity per element
  Healing: ["Devotion", "Healing Lore", "Healing Intensity", "Heal"],
  Kinetic: ["Impulse", "Kinetic Lore", "Kinetic Intensity"],
  Fire: ["Combustion", "Fire Lore", "Fire Intensity"],
  Cold: ["Glaciation", "Ice Lore", "Ice Intensity"],
  Electric: ["Magnetism", "Lightning Lore", "Lightning Intensity"],
  Acid: ["Corrosion", "Acid Lore", "Acid Intensity"],
  Sonic: ["Resonance", "Sonic Lore", "Sonic Intensity"],
  Negative: ["Nullification", "Void Lore", "Void Intensity"],
  Light: ["Radiance", "Radiance Lore", "Radiance Intensity"],
  Repair: ["Repair Spell Power", "Repair Lore", "Repair Intensity", "Repair"],
  Poison: ["Poison Spell Power", "Poison Lore", "Void Intensity"],
};
// UI groupings + progressive disclosure (which top package reveals which extra row).
const BUNDLE_GROUPS = {
  packages: ["Basic", "Melee", "Ranged", "Caster", "Trapping", "Warlock"],
  attributes: ["Attributes"],
  tactics: ["Stunning", "Sundering", "Vertigo"],
  schools: ["Evocation", "Transmutation", "Abjuration", "Conjuration", "Enchantment", "Illusion", "Necromancy"],
  spellpower: ["Healing", "Kinetic", "Fire", "Cold", "Electric", "Acid", "Sonic", "Negative", "Light", "Repair", "Poison"],
};
const BUNDLE_REVEALS = { Melee: ["tactics"], Caster: ["schools", "spellpower"] };

/** Resolve a bundle key to a canonicalized, dataset-filtered, deduped affix list.
 *  Each affix is canonicalized through the alias table and dropped if the dataset
 *  doesn't carry it (`vocab.known`). Unknown key -> []. Pure. */
function resolveBundle(key, vocab) {
  const affixes = PRESET_BUNDLES[key];
  if (!affixes) return [];
  const out = [];
  for (const name of affixes) {
    const c = vocab && vocab.canonical ? vocab.canonical(name) : name;
    if (c && (!vocab || !vocab.known || vocab.known.has(c)) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Append a bundle's resolved affixes to an existing priority list, skipping any
 *  already present (order preserved: existing first, then the bundle's new ones).
 *  Pure — returns a new array. This is the "place the picked selection into the
 *  priority order, then let the user adjust" step. */
function addBundle(key, current, vocab) {
  const next = (current || []).slice();
  for (const affix of resolveBundle(key, vocab)) if (!next.includes(affix)) next.push(affix);
  return next;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery, cleanBoundMap, cleanCreditMap, creditKey, creditIsUsable, isPresenceOnly, advancedRowModel, advancedBadgeText, openPanels, openPanelToggle, openPanelSweep, openPanelClear, stepAfterLoad, curatedStats, pickerVocabulary, PRESET_BUNDLES, BUNDLE_GROUPS, BUNDLE_REVEALS, resolveBundle, addBundle, twfMigrationNeeded, pinWornSlotOf, pinHandsFor, pinIdOf, applyPin, applyPinId, removePinFrom, reconcilePinLegality, dualPinMutexConflict };
}

// ---- browser flow ----------------------------------------------------------
if (typeof window !== "undefined" && window.App) {
  // Race lists sourced from the DDO wiki (ddowiki.com/page/Races): 30 playable
  // races = 18 basic + 12 Iconic Heroes. Do not add unlisted races (there is no
  // "Battleforged" race — Warforged and its Iconic, Bladeforged, are the two Forged).
  const RACES_BASIC = ["Aasimar", "Dhampir", "Dragonborn", "Drow", "Duergar", "Dwarf",
    "Eladrin", "Elf", "Gnome", "Halfling", "Half-Elf", "Half-Orc", "Human",
    "Shifter", "Tabaxi", "Tiefling", "Warforged", "Wood Elf"];
  const RACES_ICONIC = ["Aasimar Scourge", "Bladeforged", "Deep Gnome", "Dhampir Dark Bargainer",
    "Duergar Mindcleaver", "Eladrin Chaosmancer", "Sun Elf (Morninglord)", "Purple Dragon Knight",
    "Razorclaw Shifter", "Shadar-kai", "Tabaxi Trailblazer", "Tiefling Scoundrel"];
  const ALIGNMENTS = ["Lawful Good", "Neutral Good", "Chaotic Good",
    "Lawful Neutral", "True Neutral", "Chaotic Neutral"];
  const ARMOR = [["cloth", "Cloth"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]];
  const WT = (typeof window !== "undefined" && window.WeaponTaxonomy) || null; // U1 taxonomy
  const STEP_LABELS = { intro: "Start", character: "Character", pool: "Gear pool", priorities: "Priorities", results: "Results" };

  // U7 / KTD6: standardize output-encoding on the global esc from results.js
  // (escapes & < > " ' — the apostrophe the old local helper missed). Fall back
  // to a full 5-char escape if results.js somehow hasn't loaded, so a saved or
  // imported character name can never inject markup.
  const esc = (typeof window !== "undefined" && typeof window.esc === "function")
    ? window.esc
    : (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.App.ready((dataset) => {
    const root = document.getElementById("wizard");
    if (!root) return;

    // Targetable affix stats for the priority picker (U5): the shared picker
    // vocabulary — the UNION of every affix source (gear, augments, set bonuses, and
    // ALL crafting pools), canonicalized through the alias table and filtered to the
    // rankable ones (so a crafting-only affix is selectable). `known` validates
    // free-typed input; `canonical` maps a typed value to the name gear carries. The
    // solver still accepts any typed affix — this gates suggestions, not input.
    const vocab = pickerVocabulary(dataset);
    const allStats = vocab.suggestions;

    // U3 — distinct weapon `type` values the dataset actually carries, so the
    // handedness-gated chip list never offers a type with no items (KTD6).
    const weaponTypesInData = [...new Set((dataset.items || [])
      .filter((v) => v.slot === "Weapon" && v.type).map((v) => v.type))];

    const state = { step: "intro", ml: 36, mlFloor: 31, mlFloorManual: false, race: "", alignment: "", armor: "", oath: "",
      style: "", weaponTypes: [], offHand: [], offHandWeapons: [],
      // plan 003 U1 — the Two Weapon Fighting declaration. Character state, not gear
      // state: the combat-style handler clears weaponTypes/offHand/offHandWeapons but
      // must never clear this (R2).
      twoWeaponFighting: false,
      includeArtifact: false,
      // U6 — set-augment availability. A Set of owned set-augment `set` names;
      // empty by default so the set-augment family stays inert until opted in.
      ownedSetAugments: new Set(),
      // U1/U4 — per-priority stat caps (max) and floors (min), keyed by stat name so
      // they survive priority reordering.
      targetCaps: {}, targetFloors: {},
      // U2 — declared stat credits, keyed `stat||bonusType` so a stat can carry
      // more than one and reordering priorities cannot mis-associate them.
      declaredCredits: {},
      pool: "all", ownedNames: null, priorities: [], slotConstraints: {}, constraintsDirty: false, lastRun: null,
      characterName: "", loadedStale: false,
      // plan 003 U4 — set on load when a pre-U1 save is migrated to declared.
      twfMigrated: false,
      // #169 — set on load when a saved character ranked an expanded-away name;
      // holds the disclosure sentence, or null when nothing was substituted.
      expandedAwayMigrated: null };

    let highs = null;
    async function getHighs() {
      if (highs) return highs;
      // eslint-disable-next-line no-undef
      highs = await Module({ locateFile: (f) => "vendor/" + f });
      return highs;
    }

    // ---- stepper -----------------------------------------------------------
    function renderStepper() {
      const done = (id) => WIZARD_STEPS.indexOf(id) < WIZARD_STEPS.indexOf(state.step);
      return `<ol class="wz-steps">${WIZARD_STEPS.map((id) => {
        const cls = done(id) ? "done" : (id === state.step ? "on" : "");
        const n = WIZARD_STEPS.indexOf(id) + 1;
        return `<li class="wz-step ${cls}"><button class="wz-dot" data-goto="${id}" ${done(id) ? "" : "disabled"}>${done(id) ? "✓" : n}</button><span>${STEP_LABELS[id]}</span></li>`;
      }).join("")}</ol>`;
    }

    // ---- steps -------------------------------------------------------------
    function stepIntro() {
      const n = (dataset.items || []).length;
      return `<section class="wz-card">
        <p class="wz-eyebrow">What this does</p>
        <h2>Find your provably-best gear — not a guess.</h2>
        <p class="wz-lead">Tell us about your character and rank the stats you care about. We search every
          wiki-sourced item, augment, set bonus, and crafting option (${n.toLocaleString()} indexed) and return the
          <strong>single loadout that is mathematically optimal</strong> for your priorities — slot by slot,
          with the exact crafting steps to build it.</p>
        <p class="wz-lead">Four short steps, then the answer. No account; it runs entirely in your browser.</p>
        <div class="wz-actions"><span class="wz-spacer"></span><button class="btn primary" data-next>Get started →</button></div>
      </section>`;
    }

    function stepCharacter() {
      const forged = wizIsForged(state.race);
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 1 of 4 · Your character</p>
        <h2>A few basics so we only show gear you can use</h2>
        <p class="wz-lead">These filter out anything you can't equip before we optimize — no wasted results.</p>
        <div class="wz-form">
          <div class="wz-pair">
            <label class="wz-field"><span class="wz-label">Minimum level (ML) cap</span>
              <span class="wz-help">Highest item level you can equip. Gear above this is excluded.</span>
              <input id="wz-ml" class="wz-ml" type="number" min="1" max="40" value="${esc(state.ml)}"></label>
            <label class="wz-field"><span class="wz-label">Only items ML ≥ <span id="wz-mlfloor-auto" class="wz-sub"${state.mlFloorManual ? " hidden" : ""}>· auto (cap − 5)</span></span>
              <span class="wz-help">Hide low-level gear — the solver ignores items below this. Defaults to your ML cap − 5 and follows the cap until you set it yourself; lower it to consider more gear.</span>
              <input id="wz-mlfloor" class="wz-ml" type="number" min="1" max="40" value="${state.mlFloor ? esc(state.mlFloor) : ""}"></label>
          </div>
          <div class="wz-pair">
            <label class="wz-field"><span class="wz-label">Race</span>
              <span class="wz-help">Determines body-slot and race-locked gear.</span>
              <select id="wz-race"><option value="">Select a race…</option>
                <optgroup label="Basic races">${RACES_BASIC.map((r) => `<option ${state.race === r ? "selected" : ""}>${r}</option>`).join("")}</optgroup>
                <optgroup label="Iconic heroes">${RACES_ICONIC.map((r) => `<option ${state.race === r ? "selected" : ""}>${r}</option>`).join("")}</optgroup></select></label>
            <label class="wz-field"><span class="wz-label">Alignment <span class="wz-sub">· optional</span></span>
              <span class="wz-help">No alignment-gated gear is in the verified dataset yet, so this won't change results.</span>
              <select id="wz-align"><option value="">Select an alignment…</option>
                ${ALIGNMENTS.map((a) => `<option ${state.alignment === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
          </div>
          <div class="wz-field"><span class="wz-label">Armor type ${forged ? '<span class="wz-sub">· docent (Forged race)</span>' : ""}</span>
            <span class="wz-help">Your proficiency — sets the dodge cap and eligible body armor.</span>
            <div class="wz-seg" id="wz-armor">${ARMOR.map(([v, l]) => `<button class="wz-chip ${state.armor === v ? "on" : ""}" data-armor="${v}" ${forged ? "disabled" : ""}>${l}</button>`).join("")}</div></div>
          <div class="wz-field"><span class="wz-label">Oath / anathema <span class="wz-sub">· optional</span></span>
            <span class="wz-help">A class oath that forbids certain armor. Approximated by armor type — see the note when on.</span>
            <div class="wz-seg" id="wz-oath"><button class="wz-chip ${state.oath === "druid" ? "on" : ""}" data-oath="druid" ${forged ? "disabled" : ""}>Druid — no metal</button></div>
            ${state.oath === "druid" && !forged ? `<p class="wz-help wz-note">Druidic oath: no metal body armor, no metal shield, no rune arm — matched against each item's wiki-sourced material. Proficiency also limits you to light and medium armor and non-tower shields. A few items whose material the wiki doesn't state are left available rather than excluded on a guess.</p>` : ""}</div>
          ${(() => {
            // plan 003 U3 (R4) — three style states, and the control ACCEPTS INPUT in
            // all three. "Inert" here means the declaration currently has no effect and
            // says so; it is deliberately NOT `disabled`, for two reasons: a player must
            // be able to declare before choosing a style or while on another one (AE3
            // declares, then switches), and a disabled control reads as "your character
            // can't have this feat" rather than "this style doesn't use it".
            //
            // Which styles permit a second weapon is the shipped taxonomy's call, not a
            // new list here (KTD2) — twfWeaponAllowedForStyle is true for `one-hand` only.
            const twfActive = !!(WT && WT.twfWeaponAllowedForStyle(state.style));
            const styleLabel = (WT && state.style)
              ? ((WT.STYLES.find((s) => s.id === state.style) || {}).label || state.style) : "";
            const inert = state.twoWeaponFighting && !twfActive
              ? (state.style
                ? `<p class="wz-help wz-note wz-twf-inert">Declared, but it has no effect under <strong>${esc(styleLabel)}</strong> — that style doesn't wield a second weapon. Your declaration is kept; switch to One-hand / Dual-wield to use it.</p>`
                : `<p class="wz-help wz-note wz-twf-inert">Declared. It has no effect until you pick a combat style that wields a second weapon.</p>`)
              : "";
            return `<div class="wz-field"><span class="wz-label">Two Weapon Fighting <span class="wz-sub">· optional</span></span>
            <span class="wz-help">Declare the feat if your character fights with a weapon in each hand. Dual-wielding used to switch on only when you added a second weapon type below — declaring it here is the explicit way.</span>
            <div class="wz-seg" id="wz-twf"><button class="wz-chip ${state.twoWeaponFighting ? "on" : ""}" data-twf="1" aria-pressed="${state.twoWeaponFighting ? "true" : "false"}">Two Weapon Fighting</button></div>
            ${inert}</div>`;
          })()}
          ${(() => {
            const styles = WT ? WT.STYLES : [];
            const wtypes = (WT && state.style) ? WT.weaponTypesForStyle(state.style, weaponTypesInData) : [];
            const ohOn = WT ? WT.offHandEnabledForStyle(state.style) : false;
            const twfOn = WT ? WT.twfWeaponAllowedForStyle(state.style) : false;
            const ohTypes = WT ? ((state.style && WT.offHandTypesForStyle(state.style)) || WT.OFF_HAND_TYPES) : [];
            const offWeaponTypes = twfOn ? WT.offHandWeaponTypes(weaponTypesInData) : [];
            // A dropdown pick-list: choose an option to add; picked options show as
            // removable tags. The dropdown offers only the not-yet-picked ones. `o.lbl`
            // maps a value to its display label; `o.add` is the placeholder.
            const pickList = (id, opts, sel, o = {}) => {
              const lbl = o.lbl || ((t) => t), add = o.add || "Add a type…";
              const avail = opts.filter((t) => !sel.includes(t));
              return `<div class="wz-picklist">
              <select class="wz-pl-select" data-plsel="${id}"${avail.length ? "" : " disabled"}>
                <option value="">${avail.length ? esc(add) : "All added"}</option>
                ${avail.map((t) => `<option value="${esc(t)}">${esc(lbl(t))}</option>`).join("")}
              </select>
              <div class="wz-pl-tags" data-pltags="${id}">${sel.map((t) => `<button class="wz-tag" data-pltag="${id}" data-val="${esc(t)}">${esc(lbl(t))}<span class="wz-tag-x" aria-hidden="true">×</span></button>`).join("")}</div></div>`;
            };
            return `<div class="wz-field"><span class="wz-label">Combat style <span class="wz-sub">· optional</span></span>
            <span class="wz-help">Pick a style to narrow the weapon and off-hand. Click the selected style again to switch. Each list below is optional — add types to narrow it; add nothing and any is allowed.</span>
            <div class="wz-seg" id="wz-style">${(state.style ? styles.filter((s) => s.id === state.style) : styles).map((s) => `<button class="wz-chip ${state.style === s.id ? "on" : ""}" data-style="${s.id}">${esc(s.label)}</button>`).join("")}</div>
            ${state.style ? `<div class="wz-subseg">
              <span class="wz-sublabel">Weapon type <span class="wz-sub">· optional — add none for any</span></span>
              ${pickList("weptypes", wtypes, state.weaponTypes)}
              ${ohOn ? (() => {
                // One "Off hand" dropdown holding both off-hand ITEMS and (dual-wield)
                // a second WEAPON. Selections route to state.offHand vs state.offHandWeapons.
                const ohLbl = (t) => t === "empty" ? "Empty (no off-hand)" : t;
                const itemAvail = ["empty", ...ohTypes].filter((t) => !state.offHand.includes(t));
                const wpnAvail = twfOn ? offWeaponTypes.filter((t) => !state.offHandWeapons.includes(t)) : [];
                const any = itemAvail.length + wpnAvail.length;
                return `<span class="wz-sublabel">Off hand <span class="wz-sub">· optional — add none for any${twfOn ? "; a shield, orb, rune arm, or a second weapon (dual-wield)" : ""}</span></span>
              <div class="wz-picklist">
                <select class="wz-pl-select" data-plsel="offhand"${any ? "" : " disabled"}>
                  <option value="">${any ? "Add…" : "All added"}</option>
                  ${itemAvail.length ? `<optgroup label="Off-hand item">${itemAvail.map((t) => `<option value="${esc(t)}">${esc(ohLbl(t))}</option>`).join("")}</optgroup>` : ""}
                  ${wpnAvail.length ? `<optgroup label="Second weapon (dual-wield)">${wpnAvail.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>` : ""}
                </select>
                <div class="wz-pl-tags" data-pltags="offhand">${state.offHand.map((t) => `<button class="wz-tag" data-pltag="offhand" data-arr="offHand" data-val="${esc(t)}">${esc(ohLbl(t))}<span class="wz-tag-x" aria-hidden="true">×</span></button>`).join("")}${state.offHandWeapons.map((t) => `<button class="wz-tag" data-pltag="offhand" data-arr="offHandWeapons" data-val="${esc(t)}">${esc(t)}<span class="wz-tag-x" aria-hidden="true">×</span></button>`).join("")}</div>
              </div>`;
              })() : `<p class="wz-help wz-note">${state.style === "ranged" ? "Bows use both hands — no off-hand item." : "Two-handed weapons use both hands — no off-hand item."}</p>`}
            </div>` : ""}</div>`;
          })()}
          <label class="wz-check"><input type="checkbox" id="wz-artifact"${state.includeArtifact ? " checked" : ""}>
            <span class="wz-check-body"><span class="wz-label">Include an Artifact</span>
            <span class="wz-help">Build around your one equippable Artifact — the optimizer picks the best-scoring one and tags its slot. Off by default.</span></span></label>
          ${(() => {
            // U6 — Set Augment availability. The 21 set-augment names come from the
            // dataset's augment_set_defs (single source of truth). A checked name is
            // added to state.ownedSetAugments; only owned set augments are considered
            // by the solver. Collapsed by default so it stays out of the way.
            const setNames = Object.keys(dataset.augment_set_defs || {}).sort();
            if (!setNames.length) return "";
            const owned = state.ownedSetAugments instanceof Set ? state.ownedSetAugments : new Set();
            const n = owned.size;
            return `<details class="wz-data" id="wz-setaug">
              <summary>Set Augments I own${n ? ` · ${n} selected` : ""}</summary>
              <div class="wz-data-body">
                <p class="wz-help">Check the <strong>Set Augments</strong> you own. Only checked ones are considered — each grants
                  its bonus once 3 pieces of its set are equipped. None are considered by default.</p>
                <div class="wz-seg wz-setaug-list" id="wz-setaug-list">${setNames.map((s) =>
                  `<label class="wz-check wz-check-inline"><input type="checkbox" data-setaug="${esc(s)}"${owned.has(s) ? " checked" : ""}>
                    <span class="wz-check-body"><span class="wz-label">${esc(s)}</span></span></label>`).join("")}</div>
              </div>
            </details>`;
          })()}
          <label class="wz-field"><span class="wz-label">Character name <span class="wz-sub">· optional</span></span>
            <span class="wz-help">Name this character to save its build and reload it later. Saved only in this browser
              (no account, cleared if you clear browser data) — use Export &amp; Data Management to move a copy between devices.</span>
            <input id="wz-charname" type="text" value="${esc(state.characterName)}" placeholder="e.g. Sook - Reaper"></label>
        </div>
        <div class="wz-saved" id="wz-saved"></div>
        <details class="wz-data" id="wz-data">
          <summary>Export &amp; Data Management</summary>
          <div class="wz-data-body">
            <p class="wz-help">Manage <strong>your own saved builds</strong> (master records). Back up every saved character to a
              file, or restore from one — the way to move your builds to another device. Backups stay compatible across the last
              3 data versions; a file that's older than that, or made by a newer version of the app, is declined so a bad import
              can't corrupt your saves. To share a single loadout with others, use the <strong>Share</strong> tab on a solved build.</p>
            <div class="wz-data-row">
              <button class="btn ghost" id="wz-export" type="button">Export all (.json)</button>
              <input id="wz-import-label" type="text" readonly placeholder="Import a backup (.json)…" class="wz-file">
              <input id="wz-import" type="file" accept=".json,application/json" class="wz-hidden">
            </div>
            <div id="wz-data-stat" class="wz-filestat"></div>
          </div>
        </details>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          <button class="btn primary" data-next>Continue →</button></div>
      </section>`;
    }

    function stepPool() {
      const owned = state.pool === "owned";
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 2 of 4 · Which gear should we search?</p>
        <h2>Optimize over everything, or only what you own</h2>
        <p class="wz-lead">Augments and crafting options always come from the full catalog — owned mode only
          restricts the base gear.</p>
        <div class="wz-seg wz-pool">
          <button class="wz-chip big ${!owned ? "on" : ""}" data-pool="all"><strong>All gear in the game</strong><small>Every wiki-sourced named item — theoretical best-in-slot.</small></button>
          <button class="wz-chip big ${owned ? "on" : ""}" data-pool="owned"><strong>Only what I own</strong><small>Upload your Trove inventory export.</small></button>
        </div>
        <div id="wz-upload" class="${owned ? "" : "wz-hidden"}">
          <label class="wz-field"><span class="wz-label">Import your inventory (CSV)</span>
            <span class="wz-help">Export from Trove. Your file never leaves your browser; account columns are ignored.</span>
            <input id="wz-file-label" type="text" readonly placeholder="Click to choose a .csv file…" class="wz-file">
            <input id="wz-file" type="file" accept=".csv" class="wz-hidden"></label>
          <div id="wz-file-stat" class="wz-filestat"></div>
        </div>
        <div class="wz-pinbox">
          <span class="wz-label">Pin specific items <span class="wz-sub">· optional · force gear you've already decided on into the build</span></span>
          <div class="wz-addrow">
            <input id="wz-pin-search" type="text" placeholder="Search an item by name — e.g. Hydra's Heart…" autocomplete="off">
          </div>
          <div id="wz-pin-results" class="wz-pin-results"></div>
          <div id="wz-pin-list" class="wz-pin-list"></div>
        </div>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          <button class="btn primary" data-next>Continue →</button></div>
      </section>`;
    }

    // U3 — pre-solve item pinning helpers. A pin forces an item into its WORN slot
    // (the label the solver groups pick-vars by — model.js builds Main/Off Hand
    // dynamically, so those aren't in WORN_SLOTS). Ring is cardinality 2 (two rings);
    // every other slot holds one pin. All state.slotConstraints reads route through
    // the shared pinnedVariantIds so single- and list-shaped pins stay consistent.
    // eslint-disable-next-line no-undef
    const _WORN = (typeof WORN_SLOTS !== "undefined") ? WORN_SLOTS
      : ["Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak", "Belt", "Ring", "Gloves", "Boots", "Bracers", "Quiver"];
    // eslint-disable-next-line no-undef
    const _CARD = (typeof SLOT_CARDINALITY !== "undefined") ? SLOT_CARDINALITY : { Ring: 2 };
    const PIN_WORN_LABELS = new Set([..._WORN, "Main Hand", "Off Hand"]);
    const PIN_CAP = 30;
    const isPinnable = (v) => PIN_WORN_LABELS.has(pinWornSlotOf(v)) && v.category !== "augment";
    const slotCardOf = (slot) => _CARD[slot] || 1;
    const itemByPinId = (id) => dataset.items.find((v) => pinIdOf(v) === id) || null;

    function currentPins() {
      const out = [];
      Object.entries(state.slotConstraints || {}).forEach(([slot, c]) => {
        if (!c || c.type !== "pin") return;
        _pinnedVariantIds(c).forEach((id) => out.push({ slot, id }));
      });
      return out;
    }

    // Thin wrappers over the exported pure core; they add the live cardinality
    // lookup and the constraintsDirty flag (so a re-solve is offered).
    function addPin(v, hand) { applyPin(state.slotConstraints, v, slotCardOf, hand); state.constraintsDirty = true; }
    function removePin(slot, id) { removePinFrom(state.slotConstraints, slot, id, slotCardOf); state.constraintsDirty = true; }

    // KTD3 — name-only match (filterVariants also matches stats/ids, so post-filter
    // to a name substring), verified + pinnable only, exact/prefix first, capped
    // with a truncation notice so a target ranked past the cap isn't silently absent.
    function renderPinResults() {
      const box = document.getElementById("wz-pin-results");
      const input = document.getElementById("wz-pin-search");
      if (!box || !input) return;
      const q = (input.value || "").trim();
      if (!q) { box.innerHTML = `<p class="wz-pin-hint">Type an item name to search the catalog.</p>`; return; }
      const ql = q.toLowerCase();
      // eslint-disable-next-line no-undef
      const verified = filterVariants(dataset.items, { verification: "verified" });
      const matches = verified.filter((v) => isPinnable(v)
        && `${v.source_item || ""} ${v.variant_id || ""}`.toLowerCase().includes(ql));
      const rank = (v) => { const n = (v.source_item || v.variant_id || "").toLowerCase(); return n === ql ? 0 : n.startsWith(ql) ? 1 : 2; };
      matches.sort((a, b) => rank(a) - rank(b) || (a.source_item || "").localeCompare(b.source_item || ""));
      if (!matches.length) { box.innerHTML = `<p class="wz-pin-hint">No items match “${esc(q)}”.</p>`; return; }
      const pinned = new Set(currentPins().map((p) => p.id));
      const shown = matches.slice(0, PIN_CAP);
      box.innerHTML = shown.map((v) => {
        const id = pinIdOf(v), already = pinned.has(id), name = v.source_item || v.variant_id;
        // plan 003 U5 (R6) — one action per hand the item can go to. For every item
        // but a one-handed weapon that is still exactly one action labelled with its
        // worn slot, so nothing changes; a one-handed weapon gets Main hand FIRST
        // (the default, preserving existing muscle memory) plus an Off hand action.
        const hands = pinHandsFor(v);
        const acts = hands.map((h, i) => `<button type="button" class="wz-pin-hit${i ? " wz-pin-hit-alt" : ""}"
            data-pin-id="${esc(id)}" data-pin-hand="${esc(h)}"${already ? " disabled" : ""}
            aria-label="Pin ${esc(name)} to ${esc(h)}">
            ${i ? "" : `<span class="wz-pin-hit-name">${esc(name)}</span>`}
            <span class="wz-pin-hit-slot">${esc(h)}${already && !i ? " · pinned" : ""}</span></button>`).join("");
        return hands.length > 1 ? `<div class="wz-pin-hit-pair">${acts}</div>` : acts;
      }).join("")
        + (matches.length > PIN_CAP ? `<p class="wz-pin-more">Showing top ${PIN_CAP} of ${matches.length.toLocaleString()} — refine your search.</p>` : "");
      box.querySelectorAll(".wz-pin-hit[data-pin-id]").forEach((b) => b.onclick = () => {
        const it = itemByPinId(b.dataset.pinId);
        if (it) { addPin(it, b.dataset.pinHand); renderPinList(); renderPinResults(); }
      });
    }

    // Pinned-items list: name + worn slot + inline conflict reason (B4) + remove.
    function renderPinList() {
      const box = document.getElementById("wz-pin-list");
      if (!box) return;
      const pins = currentPins();
      if (!pins.length) { box.innerHTML = `<p class="wz-pin-empty">No pinned items yet — search above to force a specific item into the build.</p>`; return; }
      const query = buildQuery(state, vocab);
      // Aggregate guard: a character equips at most ONE Artifact, but each pin is
      // honored, so pinning 2+ Artifacts with the opt-in on would force an illegal
      // multi-Artifact build. Warn (don't block — the pins are the player's choice).
      const artCount = pins.map((p) => itemByPinId(p.id)).filter((it) => it && it.artifact).length;
      const artWarn = (query.includeArtifact && artCount > 1)
        ? `<p class="wz-pin-artwarn">⚠ You've pinned ${artCount} Artifacts, but a character can equip only one — the solver honors every pin, so this forces an illegal build. Remove all but one.</p>`
        : "";
      // R12 — dual-pin hand-mutex guard. Detection is the exported dualPinMutexConflict
      // core (unit-tested); renderPinList only renders the warning.
      const mutexWarn = dualPinMutexConflict(pins, itemByPinId)
        ? `<p class="wz-pin-mutexwarn">⚠ You've pinned a two-handed weapon and an off-hand item, but a two-handed weapon uses both hands — the solver can't equip both. Unpin one.</p>`
        : "";
      box.innerHTML = mutexWarn + artWarn + pins.map(({ slot, id }) => {
        const it = itemByPinId(id);
        const name = it ? (it.source_item || it.variant_id) : id;
        // plan 003 U5 — three states, in precedence order. The per-variant gate list
        // first, then the slot-aware layer (R7: this pin will be dropped from the
        // solve), then the R8 note that an honored pin overrode the declaration's
        // off-hand rule. The override reads U2's exported predicate, not a copy.
        // eslint-disable-next-line no-undef
        const why = it ? (pinConflict(it, query) || _pinSlotConflict(it, slot, query)) : "not in the current catalog";
        const overrides = !why && it && slot === "Off Hand" && it.category !== "weapon"
          && _offHandItemsExcluded(query);
        const flag = why
          ? `<span class="wz-pin-warn">⚠ ${esc(why)} — this pin is dropped from the solve</span>`
          : (overrides
            ? `<span class="wz-pin-note">Overrides your Two Weapon Fighting off-hand rule — equipped because you pinned it</span>`
            : "");
        return `<div class="wz-pin-row"><span class="wz-pin-name">${esc(name)}</span><span class="wz-pin-slot">${esc(slot)}</span>${flag}<button type="button" class="wz-pin-x" data-unpin-slot="${esc(slot)}" data-unpin-id="${esc(id)}" aria-label="Remove ${esc(name)}">×</button></div>`;
      }).join("");
      box.querySelectorAll(".wz-pin-x").forEach((b) => b.onclick = () => {
        removePin(b.dataset.unpinSlot, b.dataset.unpinId); renderPinList(); renderPinResults();
      });
    }

    function stepPriorities() {
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 3 of 4 · What matters most?</p>
        <h2>Rank the stats you care about</h2>
        <p class="wz-lead">Add stats and order them — #1 is maximized first, then #2 without giving up any of #1,
          and so on. This ordering <em>is</em> the objective the solver optimizes.</p>
        <div class="wz-bundles">
          <span class="wz-label">Start from a bundle <span class="wz-sub">· optional · adds to your list — reorder or edit after</span></span>
          <div class="wz-bundle-row">
            ${BUNDLE_GROUPS.packages.map((k) => `<button type="button" class="wz-bundle" data-bundle="${esc(k)}">${esc(k)}</button>`).join("")}
          </div>
          <div class="wz-bundle-row wz-bundle-sub" data-group="attributes">
            <span class="wz-bundle-tag">Ability scores</span>
            ${BUNDLE_GROUPS.attributes.map((k) => `<button type="button" class="wz-bundle" data-bundle="${esc(k)}">${esc(k)}</button>`).join("")}
          </div>
          <div class="wz-bundle-row wz-bundle-sub" data-group="tactics" hidden>
            <span class="wz-bundle-tag">Tactics</span>
            ${BUNDLE_GROUPS.tactics.map((k) => `<button type="button" class="wz-bundle" data-bundle="${esc(k)}">${esc(k)}</button>`).join("")}
          </div>
          <div class="wz-bundle-row wz-bundle-sub" data-group="spellpower" hidden>
            <span class="wz-bundle-tag">Spell power</span>
            ${BUNDLE_GROUPS.spellpower.map((k) => `<button type="button" class="wz-bundle" data-bundle="${esc(k)}">${esc(k)}</button>`).join("")}
          </div>
          <div class="wz-bundle-row wz-bundle-sub" data-group="schools" hidden>
            <span class="wz-bundle-tag">Spell schools (DC)</span>
            ${BUNDLE_GROUPS.schools.map((k) => `<button type="button" class="wz-bundle" data-bundle="${esc(k)}">${esc(k)}</button>`).join("")}
          </div>
        </div>
        <div class="wz-addrow">
          <input id="wz-add" list="wz-stats" placeholder="Add a stat — e.g. Constitution, Dodge, Melee Power…">
          <datalist id="wz-stats">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
          <button class="btn ghost" id="wz-add-btn">Add</button>
        </div>
        <ol class="wz-ranked" id="wz-ranked"></ol>
        <p class="wz-draghelp">Drag the ⋮⋮ handle to reorder, or use the ↑ ↓ buttons (they work on touch and keyboard).</p>
        <p id="wz-status" class="wz-status"></p>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          <button class="btn primary" data-solve>Solve ⚡</button></div>
      </section>`;
    }

    function stepResults() {
      return `<section class="wz-card wz-results">
        <div class="wz-results-head">
          <div><p class="wz-eyebrow">Your optimal loadout</p></div>
        </div>
        <div class="wz-save" id="wz-save">
          <input id="wz-savename" type="text" value="${esc(state.characterName)}" placeholder="Name this character…">
          <button class="btn primary" id="wz-savebtn">Save character</button>
          <span class="wz-savestat" id="wz-savestat" aria-live="polite"></span>
        </div>
        <div id="wz-stale" class="wz-cbar wz-hidden">
          This saved build predates the current gear catalog. <button class="btn primary" id="wz-staleresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-twfmig" class="wz-cbar${state.twfMigrated ? "" : " wz-hidden"}">
          This character had off-hand weapon types picked, which is how dual-wielding used to switch on — so
          <strong>Two Weapon Fighting</strong> is now declared on the character step. The build below was solved
          under the old rules; re-solve to apply it, or turn the declaration off.
          <button class="btn primary" id="wz-twfmigresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-cbar" class="wz-cbar${state.constraintsDirty ? "" : " wz-hidden"}">
          Slot constraints changed. <button class="btn primary" id="wz-cresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-results"></div>
        <div class="wz-actions"><button class="btn ghost" data-goto="priorities">← Adjust priorities</button><span class="wz-spacer"></span>
          <button class="btn ghost" data-goto="character">Edit character</button></div>
      </section>`;
    }

    // U3/R6 — the Adjust & re-solve fold-up. Emitted by renderResults into the
    // #wz-adjust-slot directly under the tab bar (so it shows on every tab and is
    // never buried), then populated + wired by the KTD3 post-render callback
    // (fillAdjustSlot) on every render. Collapsed by default.
    function adjustPanelHTML() {
      return `<details class="wz-adjust" id="wz-adjust">
          <summary>Adjust &amp; re-solve</summary>
          <div class="wz-adjust-body">
            <p class="wz-help" style="margin:0 0 var(--sp-3)">Refine priorities, flip the gear pool, then re-solve — no need to step back.</p>
            <div class="wz-addrow">
              <input id="wz-radd" list="wz-stats2" placeholder="Add a stat…">
              <datalist id="wz-stats2">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
              <button class="btn ghost" id="wz-radd-btn">Add</button>
            </div>
            <ol class="wz-ranked" id="wz-rranked"></ol>
            <div class="wz-adjust-row">
              <span class="wz-help" style="margin:0">Gear pool:</span>
              <span class="wz-toggle">
                <button data-rpool="all" class="${state.pool === "all" ? "on" : ""}">All gear</button>
                <button data-rpool="owned" class="${state.pool === "owned" ? "on" : ""}">What I own</button>
              </span>
              <button class="btn primary" id="wz-radjust-solve">Re-solve ⚡</button>
            </div>
          </div>
        </details>`;
    }

    // KTD3 post-render callback — runs after every renderResults (solve, load,
    // per-slot constraint change) to (re)populate + (re)wire the Adjust panel in
    // its renderer-emitted slot. The priorities drag/reorder + button handlers are
    // direct (not delegable), so they must be re-bound on each render.
    function fillAdjustSlot() {
      const slot = document.getElementById("wz-adjust-slot");
      if (!slot) return;
      slot.innerHTML = adjustPanelHTML();
      renderAdjustRanked();
      const radd = document.getElementById("wz-radd");
      if (radd) {
        document.getElementById("wz-radd-btn").onclick = () => { if (addPriority(radd.value)) renderAdjustRanked(); radd.value = ""; radd.focus(); };
        radd.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (addPriority(radd.value)) renderAdjustRanked(); radd.value = ""; } };
      }
      slot.querySelectorAll(".wz-toggle button[data-rpool]").forEach((b) => b.onclick = () => {
        if (b.dataset.rpool === "owned" && !state.ownedNames) { go("pool"); return; } // route to upload
        state.pool = b.dataset.rpool;
        slot.querySelectorAll(".wz-toggle button[data-rpool]").forEach((x) => x.classList.toggle("on", x.dataset.rpool === state.pool));
      });
      const rsolve = document.getElementById("wz-radjust-solve");
      if (rsolve) rsolve.onclick = () => { if (state.priorities.length) solve(false); };
    }

    // U5/R9-R11 — the Share tab's content: pick a saved loadout, export it as a
    // forum-ready Markdown post / CSV / print page. Copy states this is for
    // sharing with OTHERS, distinct from the Character step's personal-build
    // management (KD3). Lives inside #wz-results, so it is (re)wired by the
    // post-render callback like the Adjust panel.
    function sharePanelHTML() {
      return `<div class="wz-share">
          <p class="wz-help">Share <strong>this loadout with others</strong> — a forum-ready Markdown or BBCode post, a clean
            CSV of the full detail, a print-friendly page, or a <strong>portable JSON</strong> file built to be re-imported and
            compared later. Each carries the character name, constraints, the equipped items with their augments and crafting
            upgrades, the active set bonuses with the affixes they grant, and a stat-by-stat breakdown of where each point comes
            from. (Backing up all your saved builds lives in the Character step's Export &amp; Data Management.)</p>
          <div class="wz-share-pick">
            <label class="wz-label" for="wz-share-sel">Loadout</label>
            <select id="wz-share-sel"></select>
          </div>
          <div class="wz-share-btns">
            <button class="btn ghost" id="wz-share-md" type="button">Markdown</button>
            <button class="btn ghost" id="wz-share-bb" type="button">BBCode</button>
            <button class="btn ghost" id="wz-share-csv" type="button">CSV</button>
            <button class="btn ghost" id="wz-share-print" type="button">Print</button>
            <button class="btn ghost" id="wz-share-json" type="button" title="A portable file that captures this build exactly — designed to be re-imported and compared later.">Portable JSON</button>
            <button class="btn ghost" id="wz-share-gearset" type="button" title="A .gearset file DDOBuilderV2 can import directly (Gear → Import). Crafting and your solve inputs ride below the import, as notes.">DDOBuilderV2</button>
          </div>
          <div id="wz-share-stat" class="wz-filestat"></div>
        </div>`;
    }

    // Wire the Share tab's picker + MD/CSV/print buttons (U5). Reuses the global
    // LoadoutExport + downloadFile/printLoadout, and guards a record with no
    // solved loadout so a share never produces a misleading empty file.
    function wireShareExports() {
      const shareSel = document.getElementById("wz-share-sel");
      if (!shareSel) return;
      renderSharePicker();
      const selected = () => {
        const n = shareSel.value;
        let rec;
        if (n === "__current__") {
          // Serialize the just-solved build on the fly (no save required).
          if (!(state.lastRun && state.lastRun.result && state.lastRun.result.status === "optimal")) {
            const s = document.getElementById("wz-share-stat");
            if (s) { s.className = "wz-filestat warn"; s.textContent = "Solve a build first, then export it here."; }
            return null;
          }
          const nm = ((state.characterName || "").trim()) || "Loadout";
          // eslint-disable-next-line no-undef
          rec = CharacterStore.serializeCharacter(nm, state, state.lastRun, currentBuildId());
        } else {
          // eslint-disable-next-line no-undef
          rec = n ? CharacterStore.loadCharacter(n) : null;
        }
        if (rec && !(rec.snapshot && (rec.snapshot.chosen || []).length)) {
          const s = document.getElementById("wz-share-stat");
          if (s) { s.className = "wz-filestat warn"; s.textContent = `“${rec.name}” has no solved loadout to share.`; }
          return null;
        }
        return rec;
      };
      const mdBtn = document.getElementById("wz-share-md");
      const bbBtn = document.getElementById("wz-share-bb");
      const csvBtn = document.getElementById("wz-share-csv");
      const printBtn = document.getElementById("wz-share-print");
      const jsonBtn = document.getElementById("wz-share-json");
      const gearsetBtn = document.getElementById("wz-share-gearset");
      if (mdBtn) mdBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.md`, LoadoutExport.toMarkdown(rec), "text/markdown"); };
      if (csvBtn) csvBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.csv`, LoadoutExport.toCsv(rec), "text/csv"); };
      if (printBtn) printBtn.onclick = () => { const rec = selected(); if (rec) printLoadout(rec); };
      // Portable JSON (U5): the versioned ddo-loadout/v1 envelope — the proven save
      // snapshot as an opaque `core` plus the resolved view — designed to be
      // re-imported and compared later. Pretty-printed for readability.
      if (jsonBtn) jsonBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.json`, JSON.stringify(LoadoutExport.toPortableJSON(rec), null, 2), "application/json"); };
      // DDOBuilderV2: the `.gearset` extension is what its file picker filters on
      // (Gear Planner Files (*.gearset)), so the download must carry it or the user
      // has to switch the dialog to "All files" to see their own export.
      if (gearsetBtn) gearsetBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.gearset`, LoadoutExport.toGearset(rec), "text/plain"); };
      // BBCode is meant to be pasted into a forum post — copy to clipboard (with a
      // .txt download fallback if the clipboard API is blocked), and confirm.
      if (bbBtn) bbBtn.onclick = () => {
        const rec = selected(); if (!rec) return;
        const bb = LoadoutExport.toBBCode(rec);
        const s = document.getElementById("wz-share-stat");
        const ok = () => { if (s) { s.className = "wz-filestat"; s.textContent = "BBCode copied — paste it into your forum post."; } };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(bb).then(ok, () => downloadFile(`${slug(rec.name)}.bbcode.txt`, bb, "text/plain"));
        } else {
          downloadFile(`${slug(rec.name)}.bbcode.txt`, bb, "text/plain");
        }
      };
    }

    // Populate + wire the Share tab panel (inside #wz-results, rebuilt every render).
    function fillSharePanel() {
      const panel = document.getElementById("rp-sharepanel");
      if (!panel) return;
      panel.innerHTML = sharePanelHTML();
      wireShareExports();
    }

    // The KTD3 post-render callback: (re)populate + (re)wire every wizard-owned
    // panel that lives inside #wz-results (Adjust — U3, Share — U5) on each render.
    function afterResultsRender() {
      fillAdjustSlot();
      fillSharePanel();
    }

    // ---- priorities editor (pure array ops + drag/buttons) -----------------
    function rankedHTML() {
      if (!state.priorities.length) return `<li class="wz-hint">Add at least one stat to optimize for.</li>`;
      return state.priorities.map((p, i) => {
        // U1 — the row's optional settings as data. The markup renders FROM this
        // and re-derives none of it, so the badge and the presence rule are the
        // same decision the unit tests assert.
        const adv = advancedRowModel(p, state, vocab);
        return `<li data-i="${i}" draggable="true">
        <span class="wz-grip" title="drag to reorder">⋮⋮</span>
        <span class="wz-rk">${i + 1}</span><span class="wz-nm">${esc(p)}${adv.hasAdvanced ? "" : ` <span class="rank-tag" title="On/off effect — the solver secures an item that has it, in priority order (no magnitude to maximize).">on/off</span>`}</span>
        ${adv.hasAdvanced ? advancedHTML(p, i, adv) : `<span class="wz-adv-none"></span>`}
        <span class="wz-ctl"><button data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="move up">↑</button>
          <button data-down="${i}" ${i === state.priorities.length - 1 ? "disabled" : ""} aria-label="move down">↓</button>
          <button data-del="${i}" aria-label="remove">✕</button></span></li>`;
      }).join("");
    }

    // U2/U3 — one row's Advanced panel: everything optional, behind one closed
    // disclosure, so the default row is just rank, name, and reorder (R1).
    //
    // `<details>`/`<summary>` rather than a button plus a hidden div: keyboard
    // operation and AT semantics come free, and `toggle` is the write point for
    // the open set (KTD1). A presence row renders `.wz-adv-none` instead — R6
    // gives it no control, but R2 keeps the column so every row lines up (KTD5).
    //
    // The badge is part of the summary's TEXT, not a visual-only chip: R5 is
    // about not losing a setting when the panel closes, and a purely visual mark
    // would lose it for screen-reader users instead of for everyone.
    // One definition of the summary's contents, used by the initial render AND by
    // the in-place refresh in renderRankedList. Two copies would drift, and the
    // drift is silent: a badge that words the same state differently depending on
    // whether the list was rebuilt or patched.
    function advSummaryHTML(adv) {
      const t = advancedBadgeText(adv.badgeCount);
      return `Advanced${t ? ` <span class="wz-adv-badge">${esc(t)}</span>` : ""}`;
    }

    function advancedHTML(stat, i, adv) {
      return `<details class="wz-adv" data-adv="${esc(stat)}"${openPanels.has(stat) ? " open" : ""}>
        <summary>${advSummaryHTML(adv)}</summary>
        <div class="wz-adv-body">
          <p class="wz-adv-lead">${ADVANCED_PANEL_HELP.lead}</p>
          <span class="wz-bounds">
            <input class="wz-bound" type="number" min="0" step="1" inputmode="numeric" data-min="${i}" value="${esc(adv.floor == null ? "" : adv.floor)}" placeholder="min" aria-label="${esc(stat)} minimum (floor)" draggable="false">
            <input class="wz-bound" type="number" min="0" step="1" inputmode="numeric" data-max="${i}" value="${esc(adv.cap == null ? "" : adv.cap)}" placeholder="max" aria-label="${esc(stat)} maximum (cap)" draggable="false"></span>
          <p class="wz-adv-note">${ADVANCED_PANEL_HELP.min}</p>
          <p class="wz-adv-note">${ADVANCED_PANEL_HELP.max}</p>
          <p class="wz-adv-note">${ADVANCED_PANEL_HELP.credit}</p>
          ${creditsHTML(stat, adv)}
        </div></details>`;
    }

    // U2 — the declared-credit sub-rows for one priority. Repeatable, unlike the
    // fixed min/max pair: R2 allows more than one credit on a stat when the bonus
    // types differ, and A2 makes `(stat, bonus type)` the uniqueness key. Each row
    // carries its own key so editing the TYPE is a rekey rather than an edit in
    // place; a rekey onto an existing pair replaces it rather than duplicating.
    function creditsHTML(stat, adv) {
      // A row whose value the solver would drop must not READ as declared, and must
      // not reserve its bonus type against its siblings — otherwise a "have: 0" or
      // an over-range magnitude looks like a live declaration, silently contributes
      // nothing, and blocks the type it is occupying. `creditIsUsable` is the same
      // module-scope predicate the badge counts with, so the two cannot disagree.
      const mine = (adv || advancedRowModel(stat, state, vocab)).credits;
      const usedTypes = new Set(mine.filter((c) => c.usable).map((c) => c.bonus_type));
      const rows = mine.map(({ key, ...c }) => {
        const opts = _creditBonusTypes.map((t) =>
          `<option value="${esc(t)}"${t === c.bonus_type ? " selected" : ""}${(t !== c.bonus_type && usedTypes.has(t)) ? " disabled" : ""}>${esc(t)}</option>`).join("");
        return `<span class="wz-credit${c.usable ? "" : " is-incomplete"}">
          <input class="wz-credit-val" type="number" min="1" step="1" max="${esc(_maxCreditValue)}" inputmode="numeric" data-cval="${esc(key)}"
            value="${esc(c.value)}" placeholder="have" aria-label="${esc(stat)} ${esc(c.bonus_type)} bonus you already have" draggable="false">
          <select class="wz-credit-type" data-ctype="${esc(key)}" aria-label="${esc(stat)} credit bonus type" draggable="false">${opts}</select>
          <button type="button" data-crem="${esc(key)}" aria-label="remove ${esc(stat)} ${esc(c.bonus_type)} credit">✕</button></span>`;
      }).join("");
      // Offer the add affordance only while an unused bonus type remains, so the
      // UI cannot produce the duplicate `(stat, type)` pair A2 forbids.
      const free = _creditBonusTypes.find((t) => !usedTypes.has(t));
      const add = free
        ? `<button type="button" class="wz-credit-add" data-cadd="${esc(stat)}"
             aria-label="add a non-gear bonus you already have for ${esc(stat)}"
             title="Already have this from a trance, enhancement, epic destiny, past life, filigree, or ship buff? Declare it and the solver stops spending a slot on gear that cannot beat it.">+ already have</button>`
        : "";
      return `<span class="wz-credits">${rows}${add}</span>`;
    }
    // Generic ranked-list renderer: reused by the priorities step and the
    // in-results "Adjust & re-solve" panel (U3). `rerender` re-renders that
    // same list after a mutation.
    function renderRankedList(ol, rerender) {
      if (!ol) return;
      ol.innerHTML = rankedHTML();
      // U2/KTD1 — the open set is the only thing that carries panel state across
      // the `innerHTML` rebuild above, so bind the write point on every render.
      ol.querySelectorAll("details.wz-adv").forEach((d) => {
        d.ontoggle = () => openPanelToggle(d.dataset.adv, d.open);
      });
      // D1 — the rebuild destroys the focused element. Without restoring focus, a
      // player who clicks "+ already have" gets the panel they expect but a caret
      // nowhere: focus falls to <body> and they must re-find the field by mouse or
      // tab from the top of the list. Re-query AFTER the rebuild, by data
      // attribute rather than a built selector, so a stat name never needs escaping.
      const focusCreditValue = (key) => ol.querySelectorAll("input.wz-credit-val")
        .forEach((el) => { if (el.dataset.cval === key) el.focus(); });
      const focusSummary = (stat) => ol.querySelectorAll("details.wz-adv")
        .forEach((d) => { if (d.dataset.adv === stat) { const s = d.querySelector("summary"); if (s) s.focus(); } });
      // R5 — the bound and credit-value inputs deliberately do NOT rerender: a
      // rebuild mid-keystroke would destroy the field under the caret. But the
      // badge is computed during the rebuild, so without this it stays one render
      // behind — a player types a floor, collapses the row, and sees nothing.
      // Patch just the summary instead, from the same model the render uses.
      const refreshBadge = (stat) => ol.querySelectorAll("details.wz-adv").forEach((d) => {
        if (d.dataset.adv !== stat) return;
        const s = d.querySelector("summary");
        if (s) s.innerHTML = advSummaryHTML(advancedRowModel(stat, state, vocab));
      });

      ol.querySelectorAll("button").forEach((b) => b.onclick = () => {
        let after = null;
        if (b.dataset.up != null) { const i = +b.dataset.up;[state.priorities[i - 1], state.priorities[i]] = [state.priorities[i], state.priorities[i - 1]]; }
        else if (b.dataset.down != null) { const i = +b.dataset.down;[state.priorities[i + 1], state.priorities[i]] = [state.priorities[i], state.priorities[i + 1]]; }
        else if (b.dataset.del != null) {
          const p = state.priorities[+b.dataset.del];
          state.priorities.splice(+b.dataset.del, 1);
          if (state.targetCaps) delete state.targetCaps[p];   // drop the removed stat's bounds
          if (state.targetFloors) delete state.targetFloors[p];
          // U2 / AE5 — drop EVERY credit on that stat, not one: a stat can carry
          // several, and a keyed input that outlives its row is the orphaned-bound
          // defect this repo already recorded. A1 resolves "a credit on an unranked
          // stat" by removal, which is exactly this branch.
          if (state.declaredCredits) {
            for (const [k, c] of Object.entries(state.declaredCredits)) {
              if (c && c.stat === p) delete state.declaredCredits[k];
            }
          }
          openPanelSweep(p);   // KTD1 — and its open-panel entry, for the same reason
        }
        else if (b.dataset.cadd != null) {
          const stat = b.dataset.cadd;
          const map = state.declaredCredits || (state.declaredCredits = {});
          const used = new Set(Object.values(map).filter((c) => c && c.stat === stat).map((c) => c.bonus_type));
          const type = _creditBonusTypes.find((t) => !used.has(t));
          if (type) {
            const key = creditKey(stat, type);
            map[key] = { stat, bonus_type: type, value: "" };
            after = () => focusCreditValue(key);   // land the caret in the new field
          }
        }
        else if (b.dataset.crem != null) {
          const gone = (state.declaredCredits || {})[b.dataset.crem];
          const stat = gone && gone.stat;
          if (state.declaredCredits) delete state.declaredCredits[b.dataset.crem];
          if (stat) after = () => focusSummary(stat);   // the removed control is gone; go up a level
        }
        rerender();
        if (after) after();
      });
      // U4 — min/max bound inputs. Write to the stat-keyed maps (clamped to a
      // non-negative integer); a blank clears the bound. Stop pointer propagation so
      // focusing/typing never starts a row drag.
      ol.querySelectorAll("input.wz-bound").forEach((inp) => {
        inp.onpointerdown = (e) => e.stopPropagation();
        inp.oninput = () => {
          const isMax = inp.dataset.max != null;
          const i = +(isMax ? inp.dataset.max : inp.dataset.min);
          const p = state.priorities[i];
          if (!p) return;
          const map = isMax ? (state.targetCaps || (state.targetCaps = {})) : (state.targetFloors || (state.targetFloors = {}));
          if (inp.value === "") { delete map[p]; refreshBadge(p); return; }
          const num = Number(inp.value);
          if (!Number.isFinite(num)) { delete map[p]; refreshBadge(p); return; }
          map[p] = Math.max(0, Math.floor(num));
          refreshBadge(p);
        };
      });
      // U2 — the credit value field. Blank or unusable clears the VALUE but keeps
      // the row, so a half-typed entry does not vanish under the cursor; the
      // shared normalizeCredits then drops it on the way to the query.
      ol.querySelectorAll("input.wz-credit-val").forEach((inp) => {
        inp.onpointerdown = (e) => e.stopPropagation();
        inp.oninput = () => {
          const c = (state.declaredCredits || {})[inp.dataset.cval];
          if (!c) return;
          if (inp.value === "") { c.value = ""; refreshBadge(c.stat); return; }
          const num = Number(inp.value);
          c.value = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : "";
          refreshBadge(c.stat);
        };
      });
      // U2 — changing the bonus type REKEYS the entry, because the key is
      // `(stat, bonus type)`. Landing on a pair that already exists replaces it
      // rather than duplicating (A2). The add affordance disables used types, so
      // this is reachable only via keyboard on a stale render.
      ol.querySelectorAll("select.wz-credit-type").forEach((sel) => {
        sel.onpointerdown = (e) => e.stopPropagation();
        sel.onchange = () => {
          const map = state.declaredCredits || {};
          const oldKey = sel.dataset.ctype;
          const c = map[oldKey];
          if (!c) return;
          const next = creditKey(c.stat, sel.value);
          delete map[oldKey];
          map[next] = { stat: c.stat, bonus_type: sel.value, value: c.value };
          rerender();
          // D1 — the rekey rebuilds the list too; put focus back on the selector
          // the player just changed rather than dropping it to <body>.
          ol.querySelectorAll("select.wz-credit-type")
            .forEach((el) => { if (el.dataset.ctype === next) el.focus(); });
        };
      });
      let from = null;
      ol.querySelectorAll("li[draggable]").forEach((li) => {
        // The tagName test is the part that actually suppresses the drag —
        // `draggable="false"` on a child does not stop the nearest draggable
        // ancestor from becoming the drag source, and stopPropagation on
        // pointerdown does not suppress the native drag either. U2 adds a
        // <select>, which `tagName === "INPUT"` does not match, so match both.
        // U2/KTD6 adds a subtree clause. The tagName test alone is not enough once
        // the panel exists: a click on the count badge inside the <summary> has
        // `tagName === "SPAN"`, and a drag on the relocated explainer prose has
        // "P", so both would start a row reorder instead of toggling or selecting.
        // Anything inside the panel is panel interaction, never a drag handle.
        li.ondragstart = (e) => { const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || (t.closest && t.closest("details.wz-adv")))) { e.preventDefault(); return; } from = +li.dataset.i; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); };
        li.ondragend = () => { li.classList.remove("dragging"); from = null; };
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => { e.preventDefault(); const to = +li.dataset.i; if (from === null || to === from) return; const m = state.priorities.splice(from, 1)[0]; state.priorities.splice(to, 0, m); from = null; rerender(); };
      });
    }
    function renderRanked() { renderRankedList(document.getElementById("wz-ranked"), renderRanked); }
    function renderAdjustRanked() { renderRankedList(document.getElementById("wz-rranked"), renderAdjustRanked); }
    /** Add a target affix; returns true if it landed (caller re-renders the list). */
    function addPriority(v) {
      // Canonicalize the typed value through the alias table so it matches the ONE
      // name gear/augments/crafting carry, then validate against the unfiltered
      // known set (U5; also fixes the prior undefined-`statSet` reference).
      v = vocab.canonical((v || "").trim()); const status = document.getElementById("wz-status");
      if (!v) return false;
      // U1 (#136) — an expanded-away name (Well Rounded, All Ability Scores) is still
      // in `known` via the affix registry, so the known-check below would accept it and
      // the player would rank a priority no item can ever satisfy. Refuse it here and
      // point at the concrete stats it becomes. Must precede the `known` check.
      const _dn = _datasetNormalizer();
      const awayMsg = (_dn && _dn.expandedAwayMessage) ? _dn.expandedAwayMessage(vocab, v) : null;
      if (awayMsg) { if (status) status.textContent = awayMsg; return false; }
      if (!vocab.known.has(v)) { if (status) status.textContent = `"${v}" isn't a known affix in the dataset.`; return false; }
      if (state.priorities.includes(v)) return false;
      state.priorities.push(v); if (status) status.textContent = ""; return true;
    }

    // ---- solve (real engine) ----------------------------------------------
    function candidateItems() {
      if (state.pool === "owned" && state.ownedNames) {
        // owned base items + full-catalog augments (KTD4/R13)
        return dataset.items.filter((v) => v.category === "augment"
          || state.ownedNames.has(v.source_item || v.variant_id));
      }
      return dataset.items;
    }
    function overlay(on, title, sub) {
      let el = document.getElementById("wz-solve-overlay");
      if (!el && on) {
        el = document.createElement("div"); el.id = "wz-solve-overlay"; el.className = "wz-overlay";
        el.innerHTML = `<div class="wz-overlay-box"><div class="wz-ring"></div><h3 id="wz-ov-title"></h3><p id="wz-ov-sub" class="wz-ov-sub"></p><p class="wz-ov-foot">Exact optimization — the provably best answer, not a guess.</p></div>`;
        document.body.appendChild(el);
      }
      if (el) {
        if (on) { el.querySelector("#wz-ov-title").textContent = title; el.querySelector("#wz-ov-sub").textContent = sub || ""; el.classList.add("on"); }
        else el.classList.remove("on");
      }
    }

    let solving = false;
    async function solve(firstRun) {
      if (solving) return;
      if (!state.priorities.length) return;
      solving = true;
      const n = candidateItems().length;
      overlay(true, "Solving your loadout…", firstRun ? `searching ${n.toLocaleString()} eligible items · exact MILP` : "re-solving…");
      try {
        const h = await getHighs();
        const query = buildQuery(state, vocab);
        // R4a — suppress pins illegal for THIS config from the solve WITHOUT mutating
        // persistent state: reconcile a COPY, so an illegal pin is only dropped for the
        // current (illegal) solve and is honored again once the config makes it legal
        // (a race/alignment/floor toggle-and-revert must never silently erase a pin).
        // The pin-list advisory already shows the conflict via pinConflict.
        query.slotConstraints = { ...state.slotConstraints };
        reconcilePinLegality(query.slotConstraints, itemByPinId, query, slotCardOf);
        // U6/U7 — owned-mode signal for the empty-slot note + recommended-augment
        // marking (view layer). Which worn slots the owned base pool covers, so an empty
        // slot can distinguish "you own no item for this slot" from "owned items don't
        // improve it". A weapon can serve either hand (TWF off-hand), so it covers BOTH
        // "Main Hand" and "Off Hand" — never collapse it to main-hand-only (that's right
        // for pinning, wrong for coverage), else an owned dual-wield weapon would falsely
        // read "you own no item" on an empty Off Hand. Plain/serializable (no Set saved).
        query.ownedMode = state.pool === "owned" && !!state.ownedNames;
        query.ownedSlotsCovered = query.ownedMode
          ? [...new Set(dataset.items
              .filter((v) => v.category !== "augment" && state.ownedNames.has(v.source_item || v.variant_id))
              .flatMap((v) => v.category === "weapon" ? ["Main Hand", "Off Hand"] : [v.slot]))]
          : [];
        // eslint-disable-next-line no-undef
        const model = buildModel(candidateItems(), query, dataset.dino_inserts, dataset.nearly_complete,
          dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel, dataset.augment_set_defs);
        const t0 = performance.now();
        // eslint-disable-next-line no-undef
        const result = await solveLexicographic(model, h);
        if (result.status === "optimal") result.solveMs = Math.round(performance.now() - t0);
        // R17 pin-invalidation: prune a pin that didn't land ONLY when its item is
        // genuinely gone from the catalog (itemByPinId === null) — a stale reference
        // whose badge would otherwise lie. A pin merely illegal for the current config
        // (item present, suppressed pre-solve by R4a) is KEPT: its conflict shows in the
        // pin list, and it is honored again once the config makes it legal, so a
        // transient illegal config never silently erases a legal pin. For a list-shaped
        // Ring pin, prune only the missing members; drop the whole slot only when none
        // survive. Id resolution matches the solver (variant_id || source_item).
        Object.entries(state.slotConstraints).forEach(([slot, c]) => {
          if (!c || c.type !== "pin") return;
          const landed = (vid) => (result.chosen || []).some(
            (ch) => ch.slot === slot && (ch.variant.variant_id || ch.variant.source_item) === vid);
          const stale = _pinnedVariantIds(c).filter((vid) => !landed(vid) && !itemByPinId(vid));
          if (!stale.length) return;                               // all landed -> unchanged
          // Prune each stale member through the tested pin-mutation core (one
          // shape-writer, cardinality-based predicate) — drops the slot when none survive.
          stale.forEach((vid) => removePinFrom(state.slotConstraints, slot, vid, slotCardOf));
          query.slotConstraints = { ...state.slotConstraints };
        });
        state.constraintsDirty = false;
        // fresh:true — this build was solved against the current catalog, so a
        // subsequent Save stamps the current build id (see saveCurrentCharacter).
        state.lastRun = { model, result, query, fresh: true };
        state.step = "results";
        render();
        const box = document.getElementById("wz-results");
        // eslint-disable-next-line no-undef
        if (box) renderResults(box, { model, result, query, dataset, highs: h, onAfterRender: afterResultsRender });
      } catch (err) {
        state.step = "results"; render();
        const box = document.getElementById("wz-results");
        if (box) box.innerHTML = `<p class="wz-status">Solver error: ${esc(err.message)}</p>`;
        console.error(err);
      } finally {
        overlay(false); solving = false;
      }
    }

    // ---- character persistence (U3/U4) ------------------------------------
    function currentBuildId() {
      return (dataset && dataset.metadata && dataset.metadata.build_id) || null;
    }

    function downloadFile(filename, text, mime) {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }

    function slug(s) {
      return String(s || "loadout").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "loadout";
    }

    // Print a single loadout via a body-level print container isolated by the
    // @media print rules — avoids popup-blocked window.open and needs no new tab.
    function printLoadout(rec) {
      let area = document.getElementById("wz-printarea");
      if (!area) { area = document.createElement("div"); area.id = "wz-printarea"; document.body.appendChild(area); }
      // eslint-disable-next-line no-undef
      area.innerHTML = LoadoutExport.toPrintHtml(rec);
      document.body.classList.add("printing");
      const cleanup = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", cleanup); };
      window.addEventListener("afterprint", cleanup);
      window.print();
    }

    function saveCurrentCharacter(name) {
      const nm = (name || "").trim();
      if (!nm) return { ok: false, error: "no-name" };
      if (!state.lastRun || !state.lastRun.result || state.lastRun.result.status !== "optimal") {
        return { ok: false, error: "no-build" };
      }
      state.characterName = nm;
      // Stamp with the current build only for a freshly-solved run. Saving a
      // LOADED-but-not-resolved build (e.g. after a rename) must preserve its
      // original stamp, or a stale build would re-stamp itself current and the
      // staleness warning would be silenced forever.
      const stamp = (state.lastRun.fresh === false && state.lastRun.stampedBuildId)
        ? state.lastRun.stampedBuildId : currentBuildId();
      // eslint-disable-next-line no-undef
      const rec = CharacterStore.serializeCharacter(nm, state, state.lastRun, stamp);
      // eslint-disable-next-line no-undef
      return CharacterStore.saveCharacter(rec);
    }

    // Load a saved character: restore inputs, rebuild the model scaffold WITHOUT
    // solving (KTD2), and render Results from the stored snapshot. renderResults
    // only needs `highs` for the Alternatives tab, which degrades gracefully when
    // absent, so a loaded build shows instantly.
    function loadCharacter(name) {
      // eslint-disable-next-line no-undef
      const rec = CharacterStore.loadCharacter(name);
      if (!rec) return;
      const i = rec.inputs || {};
      state.characterName = rec.name;
      state.ml = i.ml;
      // U3 — restore the ML floor + its manual/auto flag. A pre-U3 save has no
      // mlFloor: default to cap − 5 in auto mode. A saved explicit floor loads as manual.
      var savedFloor = (i.mlFloor != null && i.mlFloor !== "") ? i.mlFloor : Math.max(1, (Number(i.ml) || 36) - 5);
      state.mlFloor = savedFloor;
      state.mlFloorManual = i.mlFloorManual != null ? !!i.mlFloorManual : (i.mlFloor != null && i.mlFloor !== "");
      state.race = i.race; state.alignment = i.alignment;
      state.armor = i.armor; state.oath = i.oath || "";
      // U5 — combat constraints. A pre-migration save carries the inert `weapon`
      // flag and none of these; it loads unconstrained (Settled Decision 5), so an
      // old build re-solves identically. The stale `weapon` value is simply dropped.
      state.style = i.style || "";
      state.weaponTypes = Array.isArray(i.weaponTypes) ? i.weaponTypes.slice() : [];
      state.offHand = Array.isArray(i.offHand) ? i.offHand.slice() : [];
      state.offHandWeapons = Array.isArray(i.offHandWeapons) ? i.offHandWeapons.slice() : [];
      // plan 003 U1 — the Two Weapon Fighting declaration (R9). A pre-U1 save has no
      // field; `!!` loads it as undeclared.
      // plan 003 U4 — …unless the save used the OLD opt-in (off-hand weapon types
      // picked, no declaration field), in which case dual-wield was already on for
      // that character and staying undeclared would silently put a shield back in
      // their off hand. Migrate, and record it so the load discloses it: a feat must
      // never appear on a character sheet without the player being told.
      state.twfMigrated = twfMigrationNeeded(i);
      state.twoWeaponFighting = state.twfMigrated || !!i.twoWeaponFighting;
      state.includeArtifact = !!i.includeArtifact;
      // U6 — restore owned set augments (stored as an array; rebuilt as a Set).
      state.ownedSetAugments = Array.isArray(i.ownedSetAugments) ? new Set(i.ownedSetAugments) : new Set();
      state.pool = i.pool || "all";
      state.ownedNames = Array.isArray(i.ownedNames) ? new Set(i.ownedNames) : null;
      state.priorities = Array.isArray(i.priorities) ? i.priorities.slice() : [];
      // U4 — restore per-priority caps/floors (absent on pre-U4 saves -> empty).
      state.targetCaps = (i.targetCaps && typeof i.targetCaps === "object") ? { ...i.targetCaps } : {};
      state.targetFloors = (i.targetFloors && typeof i.targetFloors === "object") ? { ...i.targetFloors } : {};
      // U2 — declared credits are per-character state and must be reset here like
      // every sibling map above. `state` is long-lived, so without this a credit
      // declared on the previous character stays live: the initial render uses the
      // stored query and looks right, then the first Re-solve reads live state and
      // silently solves the loaded character with a bonus nobody declared for it.
      // (U5 will populate this from the save; the RESET is what makes it safe, and
      // is correct now because nothing writes declaredCredits into `inputs` yet.)
      state.declaredCredits = (i.declaredCredits && typeof i.declaredCredits === "object") ? { ...i.declaredCredits } : {};
      // KTD1 — the whole priority list is being replaced, so any row left open
      // belongs to the build being discarded. Ephemeral state, cleared not restored.
      openPanelClear();
      // Drop bounds on on/off-only stats from STATE, not just from the query.
      // cleanBoundMap refuses them at the solver seam, but the share exports read
      // the raw saved inputs (exporters.js reads rec.inputs.targetFloors), so a
      // legacy floor on a presence-only stat would print "[min 3]" on a loadout
      // the solve produced while ignoring it — a constraint the math never
      // applied. Same rule the #169 migration below follows: clean the state.
      for (const map of [state.targetCaps, state.targetFloors]) {
        if (!map) continue;
        for (const stat of Object.keys(map)) if (isPresenceOnly(stat, vocab)) delete map[stat];
      }
      // #169 — a saved character may rank a name that has since been EXPANDED
      // AWAY (`Speed`, `Parrying`, `Heightened Awareness`, the umbrella ability
      // names). The add-a-priority paths refuse those, but this one restored them
      // verbatim: the priority would load looking normal and score zero forever,
      // indistinguishable from a target no item happens to carry. Substitute the
      // stats it actually became, and disclose it — a silent rewrite of someone's
      // saved character is the same defect in a different coat.
      //
      // Runs AFTER the bound maps are restored, because it has to clean them: a
      // cap or floor keyed to the old name is stranded once that name leaves the
      // priority list. `model.js` still unions it into the target set and the
      // solver reports a floor it can never satisfy, while the UI offers no row
      // to delete it — bounds are only removable through their priority row.
      // They are DROPPED rather than remapped: "min 4 Parrying" is not
      // "min 4 Armor Class", and copying it onto four stats would invent four
      // constraints the player never set.
      const _dnMig = _datasetNormalizer();
      state.expandedAwayMigrated = null;
      if (_dnMig && _dnMig.migratePriorities) {
        const migrated = _dnMig.migratePriorities(state.priorities, pickerVocabulary(dataset));
        if (migrated.substitutions.length) {
          state.priorities = migrated.priorities;
          const droppedBounds = [];
          const droppedCredits = [];
          for (const sub of migrated.substitutions) {
            for (const map of [state.targetCaps, state.targetFloors]) {
              if (map && map[sub.from] != null) { droppedBounds.push(sub.from); delete map[sub.from]; }
            }
            // U5 — credits are keyed `stat||bonusType`, not by stat, so the
            // stat-keyed loop above cannot reach them. A credit whose priority the
            // migration substitutes away would otherwise survive as an orphan:
            // still in the query, still competing in a bucket, for a stat the
            // player can no longer see or remove. Match on the entry's own stat.
            if (state.declaredCredits) {
              for (const [k, c] of Object.entries(state.declaredCredits)) {
                if (c && c.stat === sub.from) { droppedCredits.push(sub.from); delete state.declaredCredits[k]; }
              }
            }
          }
          state.expandedAwayMigrated = _dnMig.migrationMessage(migrated.substitutions, droppedBounds, droppedCredits);
        }
      }
      state.slotConstraints = i.slotConstraints || {};
      state.constraintsDirty = false;   // loaded constraints are the saved state, not a pending change
      // U5, Part C — one-time load migration: a PRE-OVERHAUL saved snapshot embedded
      // its chosen items with only the legacy `stat`/`bonus_type`/`minimum_level`
      // fields; upgrade them so the native-first readers (affixLabel/itemMl) render.
      const _norm = _datasetNormalizer();
      const snap = (_norm && _norm.migrateLoadout) ? _norm.migrateLoadout(rec.snapshot) : rec.snapshot;
      // U1/R1 — an optimal snapshot lands directly on Results; anything else
      // routes to priorities to re-solve (never a blank results view).
      if (stepAfterLoad(snap) === "results") {
        const query = rec.query || buildQuery(state, vocab);
        // eslint-disable-next-line no-undef
        const model = buildModel(candidateItems(), query, dataset.dino_inserts, dataset.nearly_complete,
          dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel, dataset.augment_set_defs);
        // fresh:false + the original stamp so a later Save preserves staleness (see saveCurrentCharacter).
        state.lastRun = { model, result: snap, query, fresh: false, stampedBuildId: rec.stampedBuildId || null };
        state.loadedStale = !!(rec.stampedBuildId && currentBuildId() && rec.stampedBuildId !== currentBuildId());
        state.step = "results";
        render();
        const box = document.getElementById("wz-results");
        // eslint-disable-next-line no-undef
        if (box) renderResults(box, { model, result: snap, query, dataset, highs: null, onAfterRender: afterResultsRender });
        const stale = document.getElementById("wz-stale");
        if (stale) stale.classList.toggle("wz-hidden", !state.loadedStale);
      } else {
        // No optimal snapshot saved — land on priorities so the user can re-solve,
        // with a reason rather than a silent jump.
        go("priorities");
        const s = document.getElementById("wz-status");
        if (s) s.textContent = `"${rec.name}" has no solved build saved — adjust priorities and re-solve.`;
      }
    }

    function renderSavedPicker() {
      const host = document.getElementById("wz-saved");
      if (!host) return;
      // eslint-disable-next-line no-undef
      const chars = CharacterStore.listCharacters();
      if (!chars.length) {
        host.innerHTML = `<p class="wz-help wz-saved-empty">No saved characters yet — solve a build, name it, and Save it from the results.</p>`;
        return;
      }
      host.innerHTML = `<p class="wz-label">Saved characters</p><ul class="wz-charlist">` +
        chars.map((c) => `<li><span class="wz-charnm">${esc(c.name)}</span>
          <span class="wz-ctl"><button type="button" data-load="${esc(c.name)}">Load →</button>
          <button type="button" data-del="${esc(c.name)}" aria-label="delete ${esc(c.name)}">✕</button></span></li>`).join("") +
        `</ul>`;
    }

    // Keep the share dropdown (U5) in sync with the store — called on render and
    // after any in-panel save/delete/import so it never lists a stale name.
    function renderSharePicker() {
      const shareSel = document.getElementById("wz-share-sel");
      if (!shareSel) return;
      // The build the user just solved is exportable WITHOUT saving it first — list
      // it as the default option; saved characters follow. (The prior version only
      // listed saved characters, so a fresh unsaved solve had nothing to export.)
      const hasCurrent = !!(state.lastRun && state.lastRun.result && state.lastRun.result.status === "optimal");
      // eslint-disable-next-line no-undef
      const names = CharacterStore.listCharacters().map((c) => c.name);
      const prev = shareSel.value;
      const opts = [];
      if (hasCurrent) {
        const nm = (state.characterName || "").trim();
        opts.push(`<option value="__current__">${esc(nm ? `${nm} (current build)` : "Current build")}</option>`);
      }
      for (const n of names) opts.push(`<option value="${esc(n)}">${esc(n)}</option>`);
      shareSel.innerHTML = opts.length ? opts.join("") : `<option value="">No solved or saved loadout</option>`;
      if (prev && [...shareSel.options].some((o) => o.value === prev)) shareSel.value = prev;
      else if (hasCurrent) shareSel.value = "__current__";
    }

    // Export & Data Management (U6): backup export/import, reachable pre-solve
    // from the Character step so a first-time restore works on an empty store.
    function wireDataManagement() {
      const exportBtn = document.getElementById("wz-export");
      if (exportBtn) exportBtn.onclick = () => {
        // eslint-disable-next-line no-undef
        const payload = BackupIO.serializeAll(CharacterStore.allCharacters(), { buildId: currentBuildId() });
        downloadFile(`ddo-characters-${new Date().toISOString().slice(0, 10)}.json`,
          JSON.stringify(payload, null, 2), "application/json");
      };

      const impLabel = document.getElementById("wz-import-label");
      const impFile = document.getElementById("wz-import");
      const stat = () => document.getElementById("wz-data-stat");
      if (impLabel && impFile) {
        impLabel.onclick = () => impFile.click();
        impFile.onchange = (e) => {
          const f = e.target.files[0]; if (!f) return;
          impLabel.value = f.name;
          const reader = new FileReader();
          reader.onload = () => {
            const s = stat();
            // eslint-disable-next-line no-undef
            const res = BackupIO.parseBackup(reader.result);
            if (!res.ok) { s.className = "wz-filestat warn"; s.textContent = res.message || "Import failed."; return; }
            // saveMany already merges by name into the existing store, so pass the
            // imported set directly — no separate mergeInto pass needed for "merge".
            // eslint-disable-next-line no-undef
            const w = CharacterStore.saveMany(res.characters);
            const n = Object.keys(res.characters).length;
            s.className = "wz-filestat" + (w.ok ? "" : " warn");
            s.textContent = w.ok
              ? `Imported ${n} character${n === 1 ? "" : "s"} (merged by name).`
              : (w.error === "quota" ? "Storage full — remove some saves and try again." : "Could not save the import.");
            renderSavedPicker();
          };
          reader.readAsText(f);
        };
      }
    }

    // ---- on-demand Item Browser (U9) --------------------------------------
    // Reference-only roster search; not a competing top-level tab (R23). Reuses
    // browse.js's initBrowse over a panel this opens on demand.
    function openBrowser() {
      let ov = document.getElementById("wz-browse-overlay");
      if (!ov) {
        ov = document.createElement("div"); ov.id = "wz-browse-overlay"; ov.className = "wz-browse-overlay";
        ov.innerHTML = `<div class="wz-browse-panel">
          <div class="wz-browse-head"><h2>Item Browser</h2><button class="btn ghost" id="wz-browse-close">Close ✕</button></div>
          <p class="wz-help">Search and filter the full indexed roster — reference only; it doesn't change your solve.</p>
          <div id="browse-controls" class="controls"></div>
          <p id="browse-status" class="status"></p>
          <div id="browse-results"></div>
        </div>`;
        document.body.appendChild(ov);
        ov.querySelector("#wz-browse-close").onclick = () => ov.classList.remove("on");
        ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("on"); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.classList.remove("on"); });
        // eslint-disable-next-line no-undef
        if (window.ItemBrowser) window.ItemBrowser.initBrowse(dataset);
      }
      ov.classList.add("on");
    }

    // ---- master render + wiring -------------------------------------------
    // #169 — the load-time priority substitution notice. Rendered ABOVE the step
    // body rather than inside the results card, because a loaded character routes
    // to either results or priorities depending on its snapshot, and the player
    // needs to be told their ranking changed on both paths.
    function migrationBanner() {
      if (!state.expandedAwayMigrated) return "";
      return `<div id="wz-awaymig" class="wz-cbar">${esc(state.expandedAwayMigrated)}
        <button class="btn ghost" id="wz-awaymig-ok" type="button">Got it</button></div>`;
    }

    function render() {
      const bodies = { intro: stepIntro, character: stepCharacter, pool: stepPool, priorities: stepPriorities, results: stepResults };
      root.innerHTML = `<div class="wz-topbar">${renderStepper()}<button class="btn ghost wz-browse-btn" data-browse type="button">Browse items</button></div>`
        + migrationBanner()
        + (bodies[state.step] || stepIntro)();
      wire();
    }
    function go(step) { state.step = step; render(); }

    function wire() {
      const awayOk = document.getElementById("wz-awaymig-ok");
      if (awayOk) awayOk.onclick = () => {
        state.expandedAwayMigrated = null;
        const bar = document.getElementById("wz-awaymig");
        if (bar) bar.remove();
      };
      root.querySelectorAll("[data-browse]").forEach((b) => b.onclick = openBrowser);
      root.querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => { if (!b.disabled) go(b.dataset.goto); });
      root.querySelectorAll("[data-back]").forEach((b) => b.onclick = () => go(prevStep(state.step)));
      root.querySelectorAll("[data-next]").forEach((b) => b.onclick = () => {
        if (!canAdvance(state.step, state)) { flashBlock(); return; }
        go(nextStep(state.step));
      });
      root.querySelectorAll("[data-solve]").forEach((b) => b.onclick = () => {
        if (!canAdvance("priorities", state)) { const s = document.getElementById("wz-status"); if (s) s.textContent = "Add at least one stat to optimize for."; return; }
        solve(true);
      });

      if (state.step === "character") {
        // U3/R7 — the ML floor defaults to cap − 5 and follows the cap until the
        // user edits it. Clearing the floor re-enables auto-follow. Updates are made
        // directly (no re-render) so typing keeps focus.
        var floorAutoHint = () => { var h = document.getElementById("wz-mlfloor-auto"); if (h) h.hidden = !!state.mlFloorManual; };
        document.getElementById("wz-ml").oninput = (e) => {
          state.ml = e.target.value;
          if (!state.mlFloorManual) {
            state.mlFloor = Math.max(1, (Number(e.target.value) || 0) - 5);
            var fi = document.getElementById("wz-mlfloor"); if (fi) fi.value = state.mlFloor;
          }
        };
        document.getElementById("wz-mlfloor").oninput = (e) => {
          if (e.target.value === "") {
            state.mlFloorManual = false;
            state.mlFloor = Math.max(1, (Number(state.ml) || 0) - 5);
            e.target.value = state.mlFloor;
          } else {
            state.mlFloor = e.target.value;
            state.mlFloorManual = true;
          }
          floorAutoHint();
        };
        document.getElementById("wz-race").onchange = (e) => { state.race = e.target.value; if (wizIsForged(state.race)) { state.armor = ""; state.oath = ""; } render(); };
        document.getElementById("wz-align").onchange = (e) => state.alignment = e.target.value;
        document.getElementById("wz-artifact").onchange = (e) => state.includeArtifact = e.target.checked;
        // U6 — set-augment availability checkboxes write into state.ownedSetAugments (a Set).
        root.querySelectorAll("#wz-setaug-list input[data-setaug]").forEach((cb) => cb.onchange = (e) => {
          if (!(state.ownedSetAugments instanceof Set)) state.ownedSetAugments = new Set();
          const name = e.target.getAttribute("data-setaug");
          if (e.target.checked) state.ownedSetAugments.add(name);
          else state.ownedSetAugments.delete(name);
          // Refresh the summary count without re-rendering the whole step.
          const sum = document.querySelector("#wz-setaug > summary");
          if (sum) sum.textContent = `Set Augments I own${state.ownedSetAugments.size ? ` · ${state.ownedSetAugments.size} selected` : ""}`;
        });
        root.querySelectorAll("#wz-armor .wz-chip").forEach((c) => c.onclick = () => {
          if (c.disabled) return; state.armor = state.armor === c.dataset.armor ? "" : c.dataset.armor;
          root.querySelectorAll("#wz-armor .wz-chip").forEach((x) => x.classList.toggle("on", x.dataset.armor === state.armor));
        });
        // plan 003 U1 — the Two Weapon Fighting declaration: a plain toggle. It is
        // character state, so nothing else resets it (R2) — in particular the style
        // handler above clears the gear picks and deliberately leaves this alone.
        root.querySelectorAll("#wz-twf .wz-chip").forEach((c) => c.onclick = () => {
          state.twoWeaponFighting = !state.twoWeaponFighting;
          render();
        });
        // U4 — oath: single-select; toggling shows/hides the approximation note.
        root.querySelectorAll("#wz-oath .wz-chip").forEach((c) => c.onclick = () => {
          if (c.disabled) return;
          state.oath = state.oath === c.dataset.oath ? "" : c.dataset.oath;
          render();
        });
        // Combat style: single-select; changing it swaps which weapon-type / off-hand
        // chips are shown and resets any prior sub-picks, so a full re-render.
        root.querySelectorAll("#wz-style .wz-chip").forEach((c) => c.onclick = () => {
          const next = state.style === c.dataset.style ? "" : c.dataset.style;
          state.style = next; state.weaponTypes = []; state.offHand = []; state.offHandWeapons = [];
          render();
        });
        // Dropdown pick-lists. `data-plsel` names the list -> backing state array.
        // The "offhand" dropdown is combined: an off-hand ITEM goes to state.offHand,
        // a second WEAPON (dual-wield) to state.offHandWeapons — routed by whether the
        // value is a one-handed weapon type. Tags carry `data-arr` naming their array.
        const PL = { weptypes: "weaponTypes" };
        const offWeaponSet = (WT && WT.twfWeaponAllowedForStyle(state.style)) ? WT.offHandWeaponTypes(weaponTypesInData) : [];
        root.querySelectorAll(".wz-pl-select").forEach((sel) => sel.onchange = () => {
          const id = sel.dataset.plsel, val = sel.value;
          if (!val) return;
          const key = id === "offhand" ? (offWeaponSet.includes(val) ? "offHandWeapons" : "offHand") : PL[id];
          if (!key) return;
          if (!state[key].includes(val)) state[key] = [...state[key], val];
          render();
        });
        root.querySelectorAll(".wz-pl-tags .wz-tag").forEach((tag) => tag.onclick = () => {
          const key = tag.dataset.arr || PL[tag.dataset.pltag]; if (!key) return;
          state[key] = state[key].filter((x) => x !== tag.dataset.val);
          render();
        });
        const cn = document.getElementById("wz-charname");
        if (cn) cn.oninput = (e) => state.characterName = e.target.value;
        renderSavedPicker();
        const saved = document.getElementById("wz-saved");
        if (saved) saved.onclick = (e) => {
          const b = e.target.closest("button"); if (!b) return;
          if (b.dataset.load != null) loadCharacter(b.dataset.load);
          else if (b.dataset.del != null && window.confirm(`Delete saved character "${b.dataset.del}"?`)) {
            // eslint-disable-next-line no-undef
            CharacterStore.deleteCharacter(b.dataset.del);
            renderSavedPicker();
          }
        };
        wireDataManagement();
      }
      if (state.step === "pool") {
        root.querySelectorAll(".wz-chip[data-pool]").forEach((c) => c.onclick = () => {
          state.pool = c.dataset.pool;
          document.getElementById("wz-upload").classList.toggle("wz-hidden", state.pool !== "owned");
          root.querySelectorAll(".wz-chip[data-pool]").forEach((x) => x.classList.toggle("on", x.dataset.pool === state.pool));
        });
        const disp = document.getElementById("wz-file-label"), real = document.getElementById("wz-file");
        if (disp) {
          disp.onclick = () => real.click();
          real.onchange = (e) => {
            const f = e.target.files[0]; if (!f) return; disp.value = f.name;
            const reader = new FileReader();
            reader.onload = () => {
              const stat = document.getElementById("wz-file-stat");
              try {
                // eslint-disable-next-line no-undef
                const { ownedNames, rowCount } = TroveImport.parseTroveCsv(reader.result);
                state.ownedNames = ownedNames;
                // eslint-disable-next-line no-undef
                const m = TroveImport.ownedMatch(ownedNames, dataset.items);
                stat.className = "wz-filestat" + (m.matched ? "" : " warn");
                stat.innerHTML = `✓ Parsed <strong>${rowCount.toLocaleString()}</strong> entries · <strong>${m.ownedCount}</strong> distinct names · matched <strong>${m.matched}</strong> in the dataset (${m.unrecognized} unrecognized).`;
              } catch (err) {
                state.ownedNames = null;
                stat.className = "wz-filestat warn";
                stat.textContent = `Couldn't read that file: ${err.message}`;
              }
            };
            reader.readAsText(f);
          };
        }
        // U3 — pre-solve item pinning: search + pinned list live under the pool pick.
        const psearch = document.getElementById("wz-pin-search");
        if (psearch) {
          psearch.oninput = () => renderPinResults();
          renderPinResults();
          renderPinList();
        }
      }
      if (state.step === "priorities") {
        const add = document.getElementById("wz-add");
        // Composable bundle buttons: append the bundle's affixes to the priority
        // list (deduped), then reveal any layered rows (Melee -> tactics, Caster ->
        // spell power + schools) — the picked selection lands in the priority order,
        // editable after.
        root.querySelectorAll(".wz-bundle").forEach((btn) => {
          btn.onclick = () => {
            const key = btn.dataset.bundle;
            state.priorities = addBundle(key, state.priorities, vocab);
            for (const group of (BUNDLE_REVEALS[key] || [])) {
              const row = root.querySelector(`.wz-bundle-row[data-group="${group}"]`);
              if (row) row.hidden = false;
            }
            renderRanked();
          };
        });
        document.getElementById("wz-add-btn").onclick = () => { if (addPriority(add.value)) renderRanked(); add.value = ""; add.focus(); };
        add.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (addPriority(add.value)) renderRanked(); add.value = ""; } };
        renderRanked();
      }
      if (state.step === "results") {
        const box = document.getElementById("wz-results");
        const cbar = document.getElementById("wz-cbar");
        // Save the current character (U3): inputs + solved snapshot.
        const savename = document.getElementById("wz-savename");
        const savebtn = document.getElementById("wz-savebtn");
        const savestat = document.getElementById("wz-savestat");
        if (savename) savename.oninput = (e) => state.characterName = e.target.value;
        if (savebtn) savebtn.onclick = () => {
          const nm = ((savename ? savename.value : state.characterName) || "").trim();
          // Confirm before overwriting an existing character (R3/KD5), mirroring
          // the delete confirm.
          // eslint-disable-next-line no-undef
          if (nm && CharacterStore.loadCharacter(nm) && !window.confirm(`Update saved character "${nm}"?`)) return;
          const res = saveCurrentCharacter(nm);
          if (!savestat) return;
          if (res.ok) savestat.textContent = `Saved “${state.characterName}”.`;
          else if (res.error === "no-name") savestat.textContent = "Enter a name to save.";
          else if (res.error === "no-build") savestat.textContent = "Solve a build first.";
          else if (res.error === "quota") savestat.textContent = "Storage full — export and remove old saves.";
          else savestat.textContent = "Could not save.";
        };
        // Staleness note (U4): re-solve is view-only — it refreshes the shown
        // build but does not overwrite the saved snapshot until an explicit Save.
        const staleBtn = document.getElementById("wz-staleresolve");
        if (staleBtn) staleBtn.onclick = () => {
          state.loadedStale = false;
          const stale = document.getElementById("wz-stale");
          if (stale) stale.classList.add("wz-hidden");
          solve(false);
        };
        // plan 003 U4 — same view-only re-solve for the TWF migration notice. The
        // restored snapshot was solved under the OLD rules, so its off hand may still
        // hold a shield the declaration would now exclude; re-solving is what makes the
        // shown build agree with the declaration the load just turned on.
        const migBtn = document.getElementById("wz-twfmigresolve");
        if (migBtn) migBtn.onclick = () => {
          state.twfMigrated = false;
          const bar = document.getElementById("wz-twfmig");
          if (bar) bar.classList.add("wz-hidden");
          solve(false);
        };
        // Per-slot constraint controls (U6), wired by delegation so they survive
        // renderResults re-rendering the box contents.
        if (box) box.addEventListener("click", (e) => {
          const ctl = e.target.closest(".pd-ctl");
          if (ctl) {
            const menu = ctl.closest(".pd-row").querySelector(".pd-menu");
            const willOpen = menu.hidden;
            box.querySelectorAll(".pd-menu").forEach((m) => { m.hidden = true; });
            menu.hidden = !willOpen;
            return;
          }
          const act = e.target.closest(".pd-menu button");
          if (!act || act.disabled) return;
          const slot = act.dataset.slot, variant = act.dataset.variant;
          const cur = state.slotConstraints[slot];
          if (act.dataset.act === "free") {
            // Free THIS row: for a list-shaped Ring pin, prune only this row's
            // member (the other ring survives); otherwise clear the whole slot.
            if (cur && cur.type === "pin" && variant) removePin(slot, variant);
            else delete state.slotConstraints[slot];
          } else if (act.dataset.act === "empty") {
            state.slotConstraints[slot] = { type: "empty" };   // slot-level lock clears any pins
          } else if (act.dataset.act === "pin" && variant) {
            applyPinId(state.slotConstraints, slot, variant, slotCardOf); // append (Ring) / replace (single)
          }
          state.constraintsDirty = true;
          // refresh the equipped-list badges in place (no re-solve yet)
          if (state.lastRun) {
            state.lastRun.query.slotConstraints = { ...state.slotConstraints };
            // eslint-disable-next-line no-undef
            renderResults(box, { model: state.lastRun.model, result: state.lastRun.result, query: state.lastRun.query, dataset, highs, onAfterRender: afterResultsRender });
          }
          if (cbar) cbar.classList.remove("wz-hidden");
        });
        const cres = document.getElementById("wz-cresolve");
        if (cres) cres.onclick = () => { if (state.priorities.length) solve(false); };
        // The Adjust & re-solve panel (U3/R6) now lives inside #wz-results, under
        // the tab bar, so it is populated + wired by fillAdjustSlot on every
        // renderResults call — not once here (it would not exist yet).
      }
    }
    function flashBlock() {
      const btn = root.querySelector("[data-next]"); if (!btn) return;
      btn.classList.remove("wz-nudge"); void btn.offsetWidth; btn.classList.add("wz-nudge");
    }

    render();
  });
}
