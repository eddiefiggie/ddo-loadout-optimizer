// U7 — staged lexicographic solve over the worn-item model, driven by HiGHS.
//
// Exactness scope: worn-item affixes with bonus-type stacking (only the highest
// value of each same-named type counts), the wiki-sourced intrinsic stat caps,
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

// #88 U8 — the override module, resolved PER CALL rather than captured at
// script-eval time (the same rule overrides.js applies to dataset.js): capturing
// binds to whatever the global happened to be when this file's script tag ran,
// and a load-order change would leave it null forever with every override label
// silently missing — in the browser only, where no Node test can see it.
function _overridesModule() {
  if (typeof Overrides !== "undefined") return Overrides;
  if (typeof require !== "undefined") { try { return require("./overrides.js"); } catch (e) { /* absent */ } }
  return null;
}

/** The catalog's own bonus type for an affix a player override is applied to, or
 *  null when none is. Read through the module rather than the sentinel's name, so
 *  this cannot drift from the code that writes it. */
function _overriddenFrom(affix) {
  const O = _overridesModule();
  if (!O || !affix) return null;
  const from = O.catalogTypeOf(affix);
  return from == null ? null : from;
}

/** #611 — the query's ML cap, from whichever field carries it. `buildModel`
 *  stamps BOTH `model.mlCap` and `model.query.mlCap`; hand-built models (the test
 *  suites, and `buildProgram` called directly) carry only the former. Reading one
 *  field would make the cap silently undefined for half the callers, and an
 *  undefined cap here does not throw — it quietly crafts at the host's own level,
 *  which is the pre-#611 behavior and would look like a passing test. */
function _mlCapOf(model) {
  if (!model) return undefined;
  if (model.mlCap != null) return model.mlCap;
  return model.query ? model.query.mlCap : undefined;
}

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
// #335 U1 — the duplicate-ring allowlist and id helpers live with the model's
// other slot policy. Same idiom as the lamordia lookups below: the global when
// loaded as a classic script, the module when required under node.
const _isTwinEligible = (typeof isTwinEligible !== "undefined")
  ? isTwinEligible
  // eslint-disable-next-line global-require
  : require("./model.js").isTwinEligible;
const _twinIdOf = (typeof twinIdOf !== "undefined")
  ? twinIdOf
  // eslint-disable-next-line global-require
  : require("./model.js").twinIdOf;

const _lamordiaTier = (typeof lamordiaTier !== "undefined")
  ? lamordiaTier
  // eslint-disable-next-line global-require
  : require("./model.js").lamordiaTier;
const _lamordiaWeaponVariant = (typeof lamordiaWeaponVariant !== "undefined")
  ? lamordiaWeaponVariant
  // eslint-disable-next-line global-require
  : require("./model.js").lamordiaWeaponVariant;
const _dinoWeaponVariant = (typeof dinoWeaponVariant !== "undefined")
  ? dinoWeaponVariant
  // eslint-disable-next-line global-require
  : require("./model.js").dinoWeaponVariant;

// U4b-i — stacking-equivalence: canonicalize an affix `type` to its stacking
// bucket token before it forms a bucket KEY, so equivalent-but-distinct native
// types (e.g. "Insight Natural" and "Insight") collapse to ONE bucket and cannot
// double-count. Shares model.js's single equivType (browser global; Node require)
// so the solver and the model/dominance guard can never disagree on a bucket key.
// #345 (U1, R5) — the outbid set is stamped on the result, not recomputed at
// render time, for the same reason creditReport is: a restored character has no
// model and cannot re-derive it, and every share export reads the stored record.
const _solverPoolStatNames = (typeof poolStatNames !== "undefined")
  ? poolStatNames
  // eslint-disable-next-line global-require
  : require("./model.js").poolStatNames;

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

// U1 (declared stat credits) — the SAME sanitizer buildModel uses. Resolved here
// rather than re-filtering inline so the two layers cannot disagree about what a
// valid credit is. They did: an inline `c.stat && c.value > 0` check admitted a
// missing bonus_type (keying a `stat||undefined` bucket no gear can join, so the
// credit stacked instead of competing) and a numeric STRING (which formats into
// valid LP, then concatenates in readSolution's accumulator and turns the headline
// total into "07"). A caller reaching buildProgram directly gets the same rules.
var _normalizeCredits = (typeof normalizeCredits !== "undefined")
  ? normalizeCredits
  // eslint-disable-next-line global-require
  : require("./model.js").normalizeCredits;

// R1/R3 — both-hands weapon classifier for the hand mutex, resolved across runtimes
// (browser global from model.js vs Node require), same as the helpers above.
var _isBothHandsWeapon = (typeof isBothHandsWeapon !== "undefined")
  ? isBothHandsWeapon
  // eslint-disable-next-line global-require
  : require("./model.js").isBothHandsWeapon;

// #91 (U3, KTD1) — the Utility tier's sentinel priority token, owned by
// model.js (single definition). Browser global; Node require — same bridge as
// the helpers above, so the stage loop's special-case and buildModel's widening
// condition can never compare against two different strings.
var _UTILITY_SENTINEL = (typeof UTILITY_SENTINEL !== "undefined")
  ? UTILITY_SENTINEL
  // eslint-disable-next-line global-require
  : require("./model.js").UTILITY_SENTINEL;

// U2 (#290/#291) — cross-add source reader ({target: [source stats]}, installed
// from metadata.cross_add by dataset.js). Resolved from cross-add.js — the
// module that OWNS the one _CROSS_ADD instance (#300) — like the helpers above,
// so the solver's crediting and buildModel's targetSet widening can never
// read two different maps.
var _crossAddSourcesFor = (typeof crossAddSourcesFor !== "undefined")
  ? crossAddSourcesFor
  // eslint-disable-next-line global-require
  : require("./cross-add.js").crossAddSourcesFor;

// U2 (#290/#291) — the SAME targetSet widening buildModel uses (cross-add.js),
// so the dominance pre-filter's stat set and the bucket-building stat set can
// never diverge. Resolved across runtimes like the helpers above.
var _widenWithCrossAddSources = (typeof widenWithCrossAddSources !== "undefined")
  ? widenWithCrossAddSources
  // eslint-disable-next-line global-require
  : require("./cross-add.js").widenWithCrossAddSources;

/** U2 (#290/#291) — does bucket `key` ("stat||type") count toward `stat`'s
 *  total? THE single consultation point for every bucket-prefix read — the
 *  objective/locks (rawExpr), the breakdown, the saturation report, and the
 *  credit report all route through here, because per-site hand-rolled prefix
 *  logic is the recorded drift failure mode. Returns:
 *    null               — the bucket does not count toward `stat`;
 *    { source: null }   — it is `stat`'s OWN bucket (counts; no provenance
 *                         marker);
 *    { source: "<stat>" } — it counts via cross-add, naming the SOURCE stat
 *                         (e.g. "Universal Spell Power") for breakdown
 *                         provenance.
 *  Object-or-null, so plain truthiness IS the membership test — a bare
 *  `if (!bucketCountsFor(...))` can never mistake an own bucket for a miss.
 *  Buckets stay per-(stat, bonus-type) max INTERNALLY; cross-add sums ACROSS
 *  buckets (the target's own plus each source stat's) and never merges them —
 *  so two USP Implement sources still collapse to the higher, while USP
 *  Implement + element Equipment add. Uninstalled/unmapped => own-bucket-only
 *  (byte-identical to the pre-cross-add solver). */
function bucketCountsFor(key, stat) {
  const bucketStat = key.split("||")[0];
  if (bucketStat === stat) return { source: null };
  for (const src of _crossAddSourcesFor(stat)) if (bucketStat === src) return { source: src };
  return null;
}

/** U6 — per-slot constraint bodies (pin / lock-empty) as raw LP strings, using
 *  the `extra` seam. Pin → the chosen variant's pick var = 1; lock-empty → the
 *  slot's pick vars sum to 0; free → nothing. Pure + exported for tests. A pin
 *  whose variant isn't in the pool is a silent no-op (the wizard drops an
 *  ineligible pin to free before solving, R17). */
/** U4 — the x-vars a slot constraint forces OFF, so a disclosure never names gear
 *  the player locked out. `slotConstraintBodies` emits these as `= 0` bodies; this
 *  reports the same set as names, because a notice claiming a credit "beat the best
 *  gear available" must not count an item this build can never equip. */
function forcedOffSlotVars(xVars, slotConstraints) {
  const off = new Set();
  if (!slotConstraints) return off;
  for (const [slot, c] of Object.entries(slotConstraints)) {
    if (!c || c.type !== "empty") continue;
    for (const xv of xVars) if (xv.slot === slot) off.add(xv.name);
  }
  return off;
}

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
  // U1 — capped stats = the wiki-sourced intrinsic ceilings plus any user-set
  // per-stat caps. When both cap a stat, the tighter (min) wins. Each capped stat is
  // clamped in encodeStage (d <= raw, d <= cap) and read back as min(cap, raw).
  //
  // #573 — there used to be a THIRD source ahead of these two: `model.dodgeCap`, an
  // unsourced per-armor-category clamp on Dodge. It is gone; #199 refused a Dodge cap
  // outright and the numbers contradicted that ruling. See the note in model.js.
  const cappedStats = {};
  // #199 — the wiki-sourced intrinsic ceilings. Merged BEFORE the user's own caps so
  // a player who sets a tighter cap by hand still wins; a player who sets a LOOSER
  // one does not, because the game's ceiling is not something a preference can raise.
  for (const [stat, cap] of Object.entries(model.intrinsicCaps || {})) {
    if (cap == null) continue;
    cappedStats[stat] = cappedStats[stat] != null ? Math.min(cappedStats[stat], cap) : cap;
  }
  for (const [stat, cap] of Object.entries(model.userCaps || {})) {
    if (cap == null) continue;
    cappedStats[stat] = cappedStats[stat] != null ? Math.min(cappedStats[stat], cap) : cap;
  }
  // A capped OR floored stat must have its buckets built even if it is not a priority
  // target, so its raw expression exists for the clamp / floor constraint (KTD3).
  // U1 (declared stat credits) — a credit is a contribution the player already
  // holds, so its bucket must exist for the same reason a capped or floored
  // stat's does. `_equivType` on the type half is what keeps a credit in the
  // SAME bucket gear would land in (KTD2); forming the key any other way would
  // drift the moment the equivalence table changes.
  const credits = _normalizeCredits(model.credits);
  // The other half of the same player answer: bonus types NOT to use for a stat,
  // at any magnitude. Keyed exactly like a credit — `_equivType` on the type half
  // — so an exclusion names the bucket gear would actually land in rather than a
  // near-miss that silently excludes nothing. Applied far below, after every
  // contribution has been pushed; see the deletion loop for why it has to be late.
  const excludedBuckets = new Set((model.excludedTypes || [])
    .filter((e) => e && e.stat && e.bonus_type)
    .map((e) => `${e.stat}||${_equivType(e.bonus_type)}`));
  const targetSet = new Set([...model.targets, ...Object.keys(cappedStats), ...Object.keys(model.floors || {}),
    ...credits.map((c) => c.stat)]);
  // U2 (#290/#291) — widen with every tracked stat's cross-add SOURCE stats
  // (Universal Spell Power for the element spellpowers; Spell Lore/Universal
  // Spell Lore for the element lores), or the `targetSet.has(a.name)` gates
  // below would skip universal affixes and their buckets would never exist for
  // bucketCountsFor to collect. Shared with buildModel's widening
  // (widenWithCrossAddSources in cross-add.js), which keeps the same items alive
  // through the dominance pre-filter.
  _widenWithCrossAddSources(targetSet);
  // #91 (U3, KTD3) — CONDITIONAL utility widening, in LOCKSTEP with
  // buildModel's (model.js): when the Utility sentinel is ranked, every
  // counting-set name joins targetSet so the `targetSet.has(...)` gates below
  // build buckets for every channel a utility effect can arrive through —
  // worn affixes, augments, crafting picks, and set tiers. Conditional on the
  // sentinel being in the targets, so a tier-removed query builds a
  // byte-identical pre-feature program (the A/B fixture pins this).
  const utilityEnabled = (model.targets || []).includes(_UTILITY_SENTINEL);
  const utilityCountingSet = (utilityEnabled && model.utilityCountingSet
    && model.utilityCountingSet.size) ? model.utilityCountingSet : null;
  if (utilityCountingSet) for (const n of utilityCountingSet) targetSet.add(n);

  const xVars = [];
  model.worn.forEach((group) => {
    group.variants.forEach((variant) => {
      xVars.push({ name: "x" + xVars.length, variant, slot: group.slot, cardinality: group.cardinality });
    });
  });

  // #335 U1 (KTD4) — duplicate-ring twins are minted HERE, after every worn group
  // is flattened, and never inside a group's candidate list.
  //
  // The deterministic tie-break is Σ(i+1)·x_i over this flattened index
  // (`encodeStage`), so inserting a twin into the Ring group would shift the
  // coefficient of every candidate in every slot ordered after Ring, and ties
  // would resolve differently in builds involving no ring and no set. Appending
  // leaves every existing coefficient fixed, which is what lets a golden diff be
  // read as behavioral rather than as index drift.
  //
  // The twin is a shallow copy carrying `set_bonus`, so it registers as a set
  // piece (setPieces reads set_bonus per x-var) and survives dominanceFilter's
  // cardinality>1 set-contributor exemption, while its own affixes cost nothing:
  // bucket keys are `stat||equivType(type)` with no host component, so a
  // duplicate affix can never be co-selected.
  const twinOf = new Map();          // twin x-var name -> original x-var name
  for (const xv of xVars.slice()) {
    if (!_isTwinEligible(xv.variant)) continue;
    const copy = Object.assign({}, xv.variant,
      { variant_id: _twinIdOf(xv.variant.variant_id || xv.variant.source_item) });
    const tw = { name: "x" + xVars.length, variant: copy, slot: xv.slot, cardinality: xv.cardinality, twinOf: xv.name };
    xVars.push(tw);
    twinOf.set(tw.name, xv.name);
  }

  // "stat||type" -> [{gates, value}]. A worn affix is a contribution gated by
  // exactly one binary: its item's pick var. Later units push additional
  // contributions (augments, sets, crafting) into zByBucket with more gates,
  // alongside their backing extraVars/extraConstraints.
  const buckets = new Map();
  //: #614 — bucket keys whose contributions are penalties. These are excluded from
  //: the one-contributor-per-bucket cap (`Σz ≤ 1`) because penalties always stack,
  //: and their z's are FORCED to their gates rather than merely bounded by them.
  const penaltyKeys = new Set();
  for (const xv of xVars) {
    // Each entry is {value, via}. `via` (#205) names the enchantment an expanded
    // universal spell-DC affix came from ("Sacred Spell Focus Mastery") and rides
    // through to the breakdown so the receipts can show what is engraved on the
    // item rather than the school the value was credited to. Presentation only —
    // it never affects which contribution wins.
    const best = new Map();
    for (const a of xv.variant.affixes || []) {
      const k = `${a.name}||${_equivType(a.type)}`;
      if (targetSet.has(a.name) && a.value > 0 && (!best.has(k) || best.get(k).value < a.value)) {
        best.set(k, { value: a.value, via: a.via || null, affix: a });
      }
    }
    for (const s of xv.variant.scaling || []) {
      const val = scaleAt(s, mlCap);
      const k = `${s.stat}||${_equivType(s.bonus_type)}`;
      if (targetSet.has(s.stat) && val > 0 && (!best.has(k) || best.get(k).value < val)) {
        best.set(k, { value: val, via: null, affix: null });
      }
    }
    for (const [k, b] of best) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push({ gates: [xv.name], value: b.value, via: b.via, affix: b.affix,
        host: xv.variant.variant_id || xv.variant.source_item });
    }
    // #614 — PENALTIES, and they follow none of the rules above.
    //
    // The wiki's stacking page states the rule outright, in a list whose other
    // entries are the bucket rules this function implements:
    //
    //     * Bonuses of the same type do not stack ...
    //     * Penalties always stack.
    //
    // So a penalty is not a contribution competing for a bonus-type bucket, and
    // `best` is exactly the wrong shape for it: max-of-type would report ONE of a
    // player's penalties and silently drop the rest. Every one applies, additively.
    // They are collected separately, un-deduped, and each becomes its own forced
    // term — `encodeStage` skips the `Σz ≤ 1` cap for these keys and pins each z to
    // its gate instead.
    //
    // Forcing is the other half, and it is why removing the `value > 0` clauses
    // alone would have changed nothing: contributions are OPTIONAL by construction
    // (`z - gate <= 0`, no lower bound), so a maximising objective sets a negative
    // z to 0 and the penalty goes unpaid while the item stays equipped. A penalty
    // is a consequence of wearing the item, never a selection.
    for (const a of xv.variant.affixes || []) {
      if (!targetSet.has(a.name) || !(a.value < 0)) continue;
      const k = `${a.name}||${_equivType(a.type)}`;
      if (!buckets.has(k)) buckets.set(k, []);
      penaltyKeys.add(k);
      buckets.get(k).push({ gates: [xv.name], value: a.value, via: a.via || null, affix: a,
        host: xv.variant.variant_id || xv.variant.source_item, penalty: true });
    }
  }

  // A declared credit joins the bucket map as a contribution with an EMPTY gate
  // list — nothing has to be equipped for the player to have it. The existing
  // one-contributor-per-bucket cap then produces max-of-type for free (KTD1).
  const creditBuckets = new Map();
  for (const c of credits) {
    const k = `${c.stat}||${_equivType(c.bonus_type)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push({ gates: [], value: c.value, credit: c });
    creditBuckets.set(k, Math.max(creditBuckets.get(k) || 0, c.value));
  }

  let zc = 0;
  const zByBucket = new Map();
  const creditMeta = new Map();          // z name -> the credit it represents (U3 reads this)
  // #88 U8 (R13/R16) — z name -> the player override this contribution is carrying.
  // Same shape and the same reason as creditMeta directly above: a z entry holds a
  // value and its gates and nothing that identifies the affix behind it, so the
  // one place that knows is where the z is minted. `zOf` is that one place, which
  // is why every channel goes through it rather than building z entries inline.
  const overrideMeta = new Map();
  function zOf(gates, value, affix, host) {
    const z = { name: "z" + zc++, gates, value };
    const from = _overriddenFrom(affix);
    if (from != null) {
      const O = _overridesModule();
      overrideMeta.set(z.name, {
        stat: affix.name || affix.stat, from, to: O ? O.readType(affix) : (affix.type || affix.bonus_type),
        host: host || null,
      });
    }
    return z;
  }
  for (const [key, sources] of buckets) {
    zByBucket.set(key, sources.map((src) => {
      const z = zOf(src.gates, src.value, src.affix, src.host);
      if (src.via) z.via = src.via;
      if (src.credit) creditMeta.set(z.name, src.credit);
      return z;
    }));
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
  const augMeta = new Map(); // color-placement var -> {variant_id, color, slot_color, affixes, wiki_url}
  const placeMeta = new Map(); // augment place indicator (pu) -> {variant_id, color, wiki_url}
  const setMeta = new Map(); // set_active var -> {set, pieces_required, pieces_label, wiki_url}
  const jokerMeta = new Map(); // joker option var -> {host, group, set} (wildcard set piece)
  const dinoMeta = new Map(); // dino placement var -> {dino_type, stat, bonus_type, value, wiki_url}
  const ncMeta = new Map(); // nc placement var -> {item, category, stat, bonus_type, value, tier, wiki_url}
  const rollMeta = new Map(); // roll-group option var -> {item, stat, bonus_type, value, unit}
  const vikMeta = new Map(); // Viktranium placement var -> {item, slot_type, category, name, affixes, stat, bonus_type, value, unit, tier, wiki_url}
  const sealMeta = new Map(); // seal placement var -> {item, seal_type, category, stat, bonus_type, value, unit, wiki_url}
  const tfMeta = new Map();   // Thunder-Forged pick var -> {item, tier, stat, bonus_type, value, unit, wiki_url}
  const gsMeta = new Map();   // Green Steel pick var -> {item, name, stat, bonus_type, value, unit, wiki_url}
  const essMeta = new Map();  // Essence Crafting pick var -> {item, menu, effect, stat, bonus_type, value, unit, wiki_url}
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
      if (targetSet.has(a.name) && a.value > 0 && (!best.has(k) || best.get(k).value < a.value)) best.set(k, { value: a.value, affix: a });
    }
    for (const s of aug.scaling || []) {
      const val = scaleAt(s, mlCap);
      const k = `${s.stat}||${_equivType(s.bonus_type)}`;
      if (targetSet.has(s.stat) && val > 0 && (!best.has(k) || best.get(k).value < val)) best.set(k, { value: val, affix: null });
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
      // `affixes` rides along so the placement record is SELF-DESCRIBING. Every
      // downstream surface names what an augment grants, but only the paperdoll
      // had the catalog in hand to re-resolve it by variant_id — the Set Bonuses
      // set-like list and every text export read `.affixes` straight off this
      // record and silently rendered nothing. It also has to be here rather than
      // re-resolved per surface: `persist.js` keeps `augmentsPlaced` but drops
      // `model`, so a snapshot reloaded later has no catalog to resolve against.
      augMeta.set(p, {
        variant_id: aug.variant_id, color: (aug.aug_color || {}).color,
        slot_color: sc, affixes: aug.affixes || [], wiki_url: aug.wiki_url,
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
    for (const [k, ab] of best) {                                     // buckets gated by the placement
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push(zOf([place], ab.value, ab.affix, aug.variant_id));
    }
    if (aug.unique_equipped) {
      const id = aug.variant_id;
      if (!augByUnique.has(id)) augByUnique.set(id, []);
      augByUnique.get(id).push(place);
    }
  }

  // U3 — Set Augment source family (parallel to the aggregate-augment path above,
  // NOT folded into it). A Set Augment (model.augment_set_defs) carries NO stats of
  // its own; its value is a 3-piece Artifact bonus that fires ONLY when 3 COPIES are
  // slotted. The aggregate path can't model it — it values an augment solely by its
  // stat buckets (a stat-less augment is dropped) and caps every augment at one
  // placement. So model each set augment as its own family: a binary y[aug,i] per set
  // augment and per equipped host item i exposing a COMPATIBLE slot, with y <= x_i
  // (host equipped) and Σ_i y <= 3 (own at most three copies). #316 — eligibility
  // is the def's baked `fits_slots` matrix (forwarded from the variant by the build;
  // fail-closed: a def without it hosts no copies), the same single source ordinary
  // augments use — a Set Augment is a Colorless augment, so it fits any standard
  // color slot, not only literal Colorless. WHICH slot a copy consumes rides on a
  // per-copy color variable c[y,sc] over (host's slots ∩ def matrix) with Σ_sc c = y:
  // the c vars — never y itself — join placeByColor, so the per-color capacity
  // constraint below bounds ordinary + set-augment consumption together per color
  // (pushing y too would double-book a slot). Host-binding falls out of defining
  // c vars only over the host's own colors, and #312's one-copy-per-host cap keeps
  // per-host pinned demand at ≤1 so a copy's host attribution is always physically
  // realizable (the old per-host Colorless-count cap is subsumed and removed —
  // reverting eligibility to literal Colorless zeroes colored-only hosts, see the
  // AE1 deletion test). The c vars are deliberately kept OUT of setAugMeta /
  // setAugVars: those feed the tie-break objective and the settle-stage pin set,
  // and the Colorless-first post-stage needs the color choice left free (U3-stage).
  // The 3-piece tier is self-seeded into the set-threshold engine further down
  // (Part B), so the EXISTING threshold constraint fires the bonus at exactly 3
  // pieces. Only for the ~21 set augments (bounded), so the placement-var blowup
  // that forced the aggregate model for ordinary augments does not apply here.
  const augSetDefs = model.augment_set_defs || {};
  // #539 — read once here because two gates consult it: this set-augment mint and
  // the tier encoding further down. A pin that reached the program is one the
  // model already proved the eligible pool can supply.
  const pinnedSetsForMint = new Set(model.pinnedSets || []);
  // #539 — copy vars belonging to a PINNED set. The tie-break minimizes
  // set-augment copies so one is placed only when its tier is genuinely won; for
  // a pinned set the tier is won BY FIAT, so that rationale does not apply and
  // the minimization instead asks an expensive question with no meaningful
  // answer — which of ~500 eligible hosts should carry the copies, when the set
  // is delivered either way. The `<= pieces_required` cap below is what stops
  // them being placed gratuitously instead.
  const pinnedSetAugVars = new Set();
  const setAugToSeed = new Map();   // set name -> { tier, ys:[y names] } for the Part-B threshold self-seed
  const setAugMeta = new Map();     // y var -> { set, host, wiki_url } — U7 reads placed hosts from the solve
  const setAugColorMeta = new Map();// c var -> { y, slot_color } — #316 consumed-color extraction; NOT in setAugVars
  const yByHost = new Map();        // host x-var name -> [y names] — #312 cap; U4 suppression hook
  const hostsVar = new Map();       // host x-var name -> hosts_i binary (U4 suppression flag)
  let yc = 0, ycc = 0;
  {
    for (const [setName, def] of Object.entries(augSetDefs)) {
      // The 3-piece tier, kept only if it advances a ranked target — else its
      // placement vars would be free vars buying nothing (strict: never fabricate).
      const tier = (def.tiers || []).find((t) => t.pieces_required != null && (t.affixes || []).length);
      if (!tier) continue;
      // #539 — a PINNED set is minted whatever it grants. Without this a pin on a
      // set whose stats the player has not ranked mints no copies at all, so the
      // set has no pieces, the threshold has nothing to count, and the pin is
      // silently inert — the exact complaint the pin exists to answer. The copies
      // still buy nothing when the tier advances no target; they exist so the
      // player can be given the set they asked for.
      const advancesTarget = (tier.affixes || []).some((a) => targetSet.has(a.stat) && a.value > 0);
      if (!advancesTarget && !pinnedSetsForMint.has(setName)) continue;
      // #316 fail-closed: no baked matrix on the def -> the set hosts no copies.
      const defFits = (def.fits_slots || []).filter((c) => presentColors.has(c));
      if (!defFits.length) continue;
      const defFitsSet = new Set(defFits);
      const ys = [];
      for (const xv of xVars) {
        const usable = (((xv.variant.augment_slots_norm || {}).colors) || [])
          .filter((c) => defFitsSet.has(c));
        if (!usable.length) continue; // host exposes no compatible slot -> cannot hold a copy
        const y = "ya" + yc++;
        extraVars.push(y);
        ys.push(y);
        extraConstraints.push(`${y} - ${xv.name} <= 0`);        // a copy only if its host is equipped
        const cvars = [];
        for (const sc of new Set(usable)) {                     // one c per DISTINCT compatible color
          const cv = "yb" + ycc++;
          extraVars.push(cv);
          cvars.push(cv);
          if (!placeByColor.has(sc)) placeByColor.set(sc, []);
          placeByColor.get(sc).push(cv);                        // the c var consumes the physical slot
          setAugColorMeta.set(cv, { y, slot_color: sc });
        }
        extraConstraints.push(`${cvars.join(" + ")} - ${y} = 0`); // placed iff exactly one color consumed
        if (!yByHost.has(xv.name)) yByHost.set(xv.name, []);
        yByHost.get(xv.name).push(y);
        setAugMeta.set(y, { set: setName, host: xv.variant.variant_id, wiki_url: tier.wiki_url,
                            pieces_required: tier.pieces_required });
      }
      if (!ys.length) continue;                                 // no compatible host anywhere -> unplaceable
      extraConstraints.push(`${ys.join(" + ")} <= 3`);          // own at most three copies of this set augment
      setAugToSeed.set(setName, { tier, ys, advancesTarget });
    }
    // U4 — suppression flag hosts_i = "item i hosts at least one set-augment copy".
    // hosts_i >= y for each copy y on i (written y - hosts_i <= 0); hosts_i is Binary
    // so it is inherently clamped to {0,1} — an item hosting MULTIPLE copies (copies of
    // different set augments) still suppresses its own set(s) exactly ONCE. Since y <= x_i,
    // hosts_i <= x_i, so (x_i - hosts_i) in {0,1} = "equipped and not suppressed". The
    // threshold loop below subtracts hosts_i from item i's intrinsic (x_i) set-piece terms.
    // No spurious activation: hosts_i only ever RAISES a threshold constraint's LHS (harder
    // to fire the suppressed set), and suppressing a set never helps any target, so the solver
    // sets hosts_i to 1 only when forced up by a genuinely placed copy y.
    for (const [xname, ys] of yByHost) {
      const h = "hs" + hostsVar.size;
      extraVars.push(h);
      for (const y of ys) extraConstraints.push(`${y} - ${h} <= 0`); // hosts_i >= y
      hostsVar.set(xname, h);
      // #312 — an item's Set Bonus identity is SINGLE. Each set augment's own
      // description states the rule: "Slotting this Augment in any Augment
      // Slot will override its Set Bonus to the <X> set" — so a second copy on
      // the same item overrides the first, and only the last one counts
      // in-game. One copy per host, however many slots it exposes. (Also the
      // constraint that keeps per-host pinned color demand ≤ 1, standing in
      // for the removed per-host slot-count cap.)
      if (ys.length > 1) extraConstraints.push(`${ys.join(" + ")} <= 1`);
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

  // R1/R3 — HAND MUTEX: a both-hands main-hand weapon (two-handed melee, a bow, or an
  // unclassifiable host like the untyped Dino weapon) and any off-hand item are
  // mutually exclusive — a two-handed weapon occupies both hands. Cap the sum across
  // {both-hands mains, off-hands} at 1, so at most one is picked. A ONE-handed main is
  // not in the sum, so 1H main + off-hand stays legal. Off-hand pick vars include TWF
  // second weapons, which is correct: a 2H main also excludes a TWF off-hand weapon.
  // Classifier shared with dominanceFilter (KTD2).
  //
  // Feasibility guard (mirrors the Artifact `pinnedOnArtifacts <= 1` guard above): the
  // inequality is satisfiable at zero for the SOLVER's free picks, but a user who
  // force-pins BOTH a two-handed main AND an off-hand gets `x = 1` on each from
  // slotConstraintBodies, so the mutex would read `2 <= 1` and bail the ENTIRE solve to
  // no-build. Each pin is individually legal, so reconcilePinLegality never drops one.
  // When conflicting hand pins are present, relax the mutex and honor the user's
  // (illegal, wizard-warned via dualPinMutexConflict) pins rather than returning nothing.
  const bothHandsMainVars = [];
  const offHandVars = [];
  const pinnedHandIds = new Set();
  const handSlotConstraints = (model.query && model.query.slotConstraints) || {};
  for (const slot of ["Main Hand", "Off Hand"]) {
    const c = handSlotConstraints[slot];
    if (c && c.type === "pin") for (const vid of _pinnedVariantIds(c)) pinnedHandIds.add(vid);
  }
  const isPinned = (xv) => pinnedHandIds.has(xv.variant.variant_id || xv.variant.source_item);
  let pinnedBothHandsMain = false;
  let pinnedOffHand = false;
  for (const xv of xVars) {
    if (xv.slot === "Main Hand" && _isBothHandsWeapon(xv.variant)) {
      bothHandsMainVars.push(xv.name);
      if (isPinned(xv)) pinnedBothHandsMain = true;
    } else if (xv.slot === "Off Hand") {
      offHandVars.push(xv.name);
      if (isPinned(xv)) pinnedOffHand = true;
    }
  }
  if (bothHandsMainVars.length && offHandVars.length && !(pinnedBothHandsMain && pinnedOffHand)) {
    extraConstraints.push(`${[...bothHandsMainVars, ...offHandVars].join(" + ")} <= 1`);
  }

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
  const dinoByKey = new Map();     // "type||category" -> [every placement var]
  // #283 — the variant-restricted subsets of the same keys. A record marked
  // `quarterstaff: true` may only be placed on a quarterstaff host, `false` only
  // on a non-quarterstaff one, and an unmarked record (identical in both pools)
  // on either.
  const dinoQsOnly = new Map();    // -> placement vars needing a quarterstaff host
  const dinoBaseOnly = new Map();  // -> placement vars needing a NON-quarterstaff host
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
    if (ins.quarterstaff === true || ins.quarterstaff === false) {
      const side = ins.quarterstaff === true ? dinoQsOnly : dinoBaseOnly;
      if (!side.has(key)) side.set(key, []);
      side.get(key).push(q);
    }
    // Gate ONLY the on-target affixes into buckets (off-target affixes of the same
    // unit ride along physically but add no objective terms); one shared gate [q]
    // keeps the multi-affix placement all-or-nothing.
    for (const a of onTarget) {
      const k = `${a.stat}||${_equivType(a.bonus_type)}`;
      if (!zByBucket.has(k)) zByBucket.set(k, []);
      zByBucket.get(k).push(zOf([q], a.value, a, ins.name || ins.dino_type));
    }
  }
  // capacity: sum(q of key) - sum(open_dino_slots_of_key(item) * x_item) <= 0,
  // where the host sum is restricted to the hosts that placement is allowed on.
  const dinoCapacity = (qs, key, hostOk) => {
    const capTerms = [];
    for (const xv of xVars) {
      if (!hostOk(xv.variant)) continue;
      const slots = xv.variant.dino_slots_norm || [];
      const n = slots.filter((t) => t === key).length;
      if (n > 0) capTerms.push(`${n} ${xv.name}`);
    }
    const rhs = capTerms.length ? " - " + capTerms.join(" - ") : "";
    extraConstraints.push(`${qs.join(" + ")}${rhs} <= 0`);
  };
  const isQsHost = (v) => _dinoWeaponVariant(v) === "quarterstaff";
  // #283 — placements now come in three kinds (quarterstaff-only, base-only, and
  // unmarked-either) drawing on two kinds of host supply, so ONE aggregate
  // constraint per key is no longer enough: it would let a quarterstaff-only
  // insert consume a slot on an untyped blank. Three families express the
  // feasibility condition for that structure exactly — total demand within total
  // supply, and each restricted demand within the supply it is allowed to use.
  // Anything satisfying all three can be realised as an actual assignment, so
  // these are sufficient as well as necessary.
  for (const [key, qs] of dinoByKey) dinoCapacity(qs, key, () => true);
  for (const [key, qs] of dinoQsOnly) dinoCapacity(qs, key, isQsHost);
  for (const [key, qs] of dinoBaseOnly) dinoCapacity(qs, key, (v) => !isQsHost(v));

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
      // ATOMIC since #211 (the Viktranium correction, one channel over): an
      // option carries its own affix list, and one craft grants ALL of them —
      // a Skill-menu option is six skills on one binary. Flat single-affix
      // records still read, for back-compat with a cached dataset.
      const affixes = (opt.affixes && opt.affixes.length)
        ? opt.affixes
        : (opt.stat ? [{ stat: opt.stat, bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit }] : []);
      const onTarget = affixes.filter((a) => targetSet.has(a.stat) && a.value > 0);
      if (onTarget.length === 0) continue;
      const n = "n" + ncc++;
      extraVars.push(n);
      const lead = onTarget[0];
      ncMeta.set(n, {
        item: xv.variant.variant_id, category,
        ...(opt.name ? { name: opt.name } : {}),
        // The whole option rides along, so a placement is self-describing.
        affixes: affixes.map((a) => ({
          stat: a.stat, bonus_type: a.bonus_type, value: a.value, unit: a.unit || "flat",
          ...(a.via ? { via: a.via } : {}),
        })),
        // Legacy flat fields for renderers not yet reading `affixes`: the
        // option's leading ON-TARGET affix.
        stat: lead.stat, bonus_type: lead.bonus_type, value: lead.value,
        unit: lead.unit || "flat", tier, wiki_url: opt.wiki_url,
      });
      slotVars.push(n);
      extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
      for (const a of onTarget) {
        const k = `${a.stat}||${_equivType(a.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push(zOf([n], a.value, a, xv.variant.variant_id));
      }
    }
    if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per slot
  }

  // #371 per-item Nearly Complete ("Nearly Finished" / "Almost There"). Same
  // gated select-one primitive as the category path above, with ONE structural
  // difference: the option pool is keyed by the host's OWN NAME, so an item's
  // slot offers only that item's options — there is no shared menu and no tier
  // parameter (the pool already states the host's magnitudes; the ML18 and ML29
  // Alchemist's Crowns are separate entries, not two tiers of one).
  //
  // Each declared pool on a host is an INDEPENDENT slot: `Collective Sight`
  // declares both, so it gets two choices, one per pool — hence Σ n <= 1 per
  // pool, never one constraint across the item.
  //
  // Rides the SAME ncMeta channel as the category path so every downstream
  // surface (receipts, results chips, all six exports, alternatives) inherits it
  // with no new placement family; the `pool` field is what keeps the two apart
  // in the label, so a Nearly Finished craft is never reported as "Nearly
  // Completed".
  for (const xv of xVars) {
    const slots = xv.variant.nc_per_item_slots || [];
    if (!slots.length) continue;
    const host = xv.variant.source_item || xv.variant.variant_id;
    const hostPool = (model.nearlyCompletePerItem || {})[host] || [];
    if (!hostPool.length) continue;
    for (const slot of slots) {
      const slotVars = [];
      for (const opt of hostPool) {
        if (opt.pool !== slot.pool) continue;
        if (!(targetSet.has(opt.stat) && opt.value > 0)) continue;
        const n = "n" + ncc++;
        extraVars.push(n);
        ncMeta.set(n, {
          item: xv.variant.variant_id, category: opt.pool, pool: opt.pool,
          ...(opt.name ? { name: opt.name } : {}),
          affixes: [{ stat: opt.stat, bonus_type: opt.bonus_type,
                      value: opt.value, unit: opt.unit || "flat" }],
          stat: opt.stat, bonus_type: opt.bonus_type, value: opt.value,
          unit: opt.unit || "flat", tier: null, wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push(zOf([n], opt.value, opt, xv.variant.variant_id));
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per slot
    }
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
        zByBucket.get(k).push(zOf([n], opt.value, opt, xv.variant.variant_id));
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single choice per group
    }
  }

  // U81 Viktranium ("Lamordia") — a typed choice-slot on an item. Each entry in
  // `lamordia_slots` is an independent slot of a (type, category); it may craft
  // one option from the matching pool at the host's tier. Same gated select-one
  // primitive as Nearly Completed: a per-option binary n gated by the host item
  // (n - x_item <= 0), and Σ n <= 1 PER SLOT — so an item with two Lamordia slots
  // gets two independent choices. Tier from the host's ML (ML>=35 Legendary),
  // matching lamordiaTier.
  //
  // An option is ATOMIC (mirrors the Dino insert UNIT): ONE record per craftable
  // option, carrying an `affixes` list. The universal spell-DC option grants all
  // seven schools from a single craft, so a caster ranking two schools spends one
  // slot, not two. Each on-target affix becomes its own (stat, bonus_type) bucket
  // term gated by the SAME binary [n] — all of the option's affixes apply together
  // or none. Off-target affixes ride along physically with no objective term.
  let vkc = 0;
  for (const xv of xVars) {
    const slots = xv.variant.lamordia_slots || [];
    if (!slots.length) continue;
    const tier = _lamordiaTier(xv.variant);  // single source of truth (model.js)
    // #282 — which Weapon-pool variant this host draws (quarterstaff vs base).
    const hostQs = _lamordiaWeaponVariant(xv.variant) === "quarterstaff";
    for (const slot of slots) {
      const slotVars = [];
      for (const opt of model.viktranium || []) {
        if (opt.slot_type !== slot.type || opt.category !== slot.category || opt.tier !== tier) continue;
        // #282 — a variant-marked record is offered only to its matching host:
        // `quarterstaff: true` needs a quarterstaff, `false` forbids one, and an
        // unmarked record (identical in both pools) serves any host.
        if (opt.quarterstaff === true && !hostQs) continue;
        if (opt.quarterstaff === false && hostQs) continue;
        const affixes = (opt.affixes && opt.affixes.length)
          ? opt.affixes
          // back-compat: a flat single-affix record (pre-atomicity shape)
          : (opt.stat ? [{ stat: opt.stat, bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit }] : []);
        const onTarget = affixes.filter((a) => targetSet.has(a.stat) && a.value > 0);
        if (onTarget.length === 0) continue;
        const n = "vk" + vkc++;
        extraVars.push(n);
        const lead = onTarget[0];
        vikMeta.set(n, {
          item: xv.variant.variant_id, slot_type: slot.type, category: slot.category,
          name: opt.name,
          // The whole option rides along, so a placement is self-describing (a
          // multi-affix craft is findable by any affix it grants).
          affixes: affixes.map((a) => ({
            stat: a.stat, bonus_type: a.bonus_type, value: a.value, unit: a.unit || "flat",
            ...(a.via ? { via: a.via } : {}),
          })),
          // Legacy flat fields, kept for renderers not yet reading `affixes`:
          // the option's leading ON-TARGET affix.
          stat: lead.stat, bonus_type: lead.bonus_type, value: lead.value,
          unit: lead.unit || "flat", tier, wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        for (const a of onTarget) {
          const k = `${a.stat}||${_equivType(a.bonus_type)}`;
          if (!zByBucket.has(k)) zByBucket.set(k, []);
          zByBucket.get(k).push(zOf([n], a.value, a, xv.variant.variant_id));
        }
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
        zByBucket.get(k).push(zOf([n], opt.value, opt, xv.variant.variant_id));
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single unseal per slot
    }
  }

  // #194 — one craftable option's affixes, ATOMIC shape with the pre-atomicity
  // fallback, exactly as the Viktranium loop above reads its pool. Both pools now
  // emit one record per OPTION carrying an `affixes` list; before that they emitted
  // one record per AFFIX, and since each loop below takes at most one record per
  // slot, a player crafting a multi-affix effect would have received one part of
  // it. The fallback keeps a hand-built or older flat record working.
  const _craftAffixes = (opt) => ((opt.affixes && opt.affixes.length)
    ? opt.affixes
    : (opt.stat ? [{ stat: opt.stat, bonus_type: opt.bonus_type, value: opt.value, unit: opt.unit }] : []));

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
        const affixes = _craftAffixes(opt);
        const onTarget = affixes.filter((a) => targetSet.has(a.stat) && a.value > 0);
        if (!onTarget.length) continue;
        const n = "tf" + tfc++;
        extraVars.push(n);
        const lead = onTarget[0];
        tfMeta.set(n, {
          item: xv.variant.variant_id, tier: slot.tier, name: opt.name,
          // The whole option rides along, so a placement is self-describing and a
          // multi-affix craft is findable by any affix it grants (Viktranium's rule).
          affixes: affixes.map((a) => ({
            stat: a.stat, bonus_type: a.bonus_type, value: a.value, unit: a.unit || "flat",
            ...(a.via ? { via: a.via } : {}),
          })),
          // Legacy flat fields, kept for renderers not yet reading `affixes`: the
          // option's leading ON-TARGET affix.
          stat: lead.stat, bonus_type: lead.bonus_type, value: lead.value,
          unit: lead.unit || "flat", wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        for (const a of onTarget) {
          const k = `${a.stat}||${_equivType(a.bonus_type)}`;
          if (!zByBucket.has(k)) zByBucket.set(k, []);
          zByBucket.get(k).push(zOf([n], a.value, a, xv.variant.variant_id));
        }
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
      const affixes = _craftAffixes(opt);
      const onTarget = affixes.filter((a) => targetSet.has(a.stat) && a.value > 0);
      if (!onTarget.length) continue;
      const n = "gs" + gsc++;
      extraVars.push(n);
      const lead = onTarget[0];
      gsMeta.set(n, {
        item: xv.variant.variant_id, name: opt.name,
        affixes: affixes.map((a) => ({
          stat: a.stat, bonus_type: a.bonus_type, value: a.value, unit: a.unit || "flat",
          ...(a.via ? { via: a.via } : {}),
        })),
        // Legacy flat fields — the option's leading ON-TARGET affix.
        stat: lead.stat, bonus_type: lead.bonus_type, value: lead.value,
        unit: lead.unit || "flat", wiki_url: opt.wiki_url,
      });
      slotVars.push(n);
      extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
      for (const a of onTarget) {
        const k = `${a.stat}||${_equivType(a.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push(zOf([n], a.value, a, xv.variant.variant_id));
      }
    }
    if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // single craft per host
  }

  // Essence Crafting (#193/#599) — the Gem of Many Facets' three Trinket menus.
  // Three INDEPENDENT single-pick slots on one host, not one slot with three picks:
  // a Gem carries a Prefix, a Suffix and an Extra, and crafting into one does not
  // spend the others. So the `<= 1` is per MENU, inside the per-host loop.
  //
  // Two things differ from every pool above and both come from the wiki:
  //
  //   * The magnitude scales with the HOST's minimum level, so the value is read
  //     from the option's curve at bind time (`values_by_ml[ml - 1]`) rather than
  //     carried on the option. The same option on the heroic Gem (ML 5) and the
  //     legendary one (ML 30) is a different number.
  //   * Insight-bonus effects need ML >= 10 ("Effects that grant insight bonuses
  //     can be applied to items ML 10 and higher only, regardless of
  //     prefix/suffix/extra slot"). The heroic Gem is ML 5, so this is the
  //     difference between offering it nine Insight options and offering it none.
  //
  // Contributions bucket as (stat, equivType(bonus_type)) like everything else,
  // which is what makes crafting the same stat in two menus safe: they land in one
  // bucket and take the max instead of stacking. That is the whole reason the
  // bonus type had to be harvested before any of this could be wired.
  let essc = 0;
  for (const xv of xVars) {
    const menus = xv.variant.essence_slots || [];
    if (!menus.length) continue;
    // #611 — craft at min(host ML, the player's cap). The ML is the CRAFTER's
    // choice ("Search for the Minimum Level you wish to create"), so a host above
    // the cap is crafted DOWN to the cap and worn, at that level's values; a host
    // at or below the cap is crafted at its own ML, which is its ceiling. One
    // level per host, not a search: every offered curve is monotonic
    // non-decreasing and peaks at 36 (asserted in tests/test_essence_pool.py), so
    // the highest reachable ML is optimal and there is never a reason to go
    // lower. If a curve ever peaks mid-range that reasoning dies and this has to
    // become a search — which is exactly what that test is there to catch.
    const nativeMl = Number(xv.variant.ml);
    const _cap = Number(_mlCapOf(model));
    const hostMl = Number.isFinite(_cap) ? Math.min(nativeMl, _cap) : nativeMl;
    if (!Number.isFinite(hostMl) || hostMl < 1 || hostMl > 36) continue;
    for (const slot of menus) {
      const slotVars = [];
      for (const opt of model.essenceCrafting || []) {
        if (opt.menu !== slot.menu) continue;
        if (!targetSet.has(opt.stat)) continue;
        if (hostMl < (opt.min_ml || 1)) continue;
        const value = Number(opt.values_by_ml[hostMl - 1]);
        if (!Number.isFinite(value) || value <= 0) continue;
        const n = "ess" + essc++;
        extraVars.push(n);
        essMeta.set(n, {
          item: xv.variant.variant_id, menu: opt.menu, effect: opt.effect,
          name: opt.name, stat: opt.stat, bonus_type: opt.bonus_type,
          value, unit: opt.unit || "flat", wiki_url: opt.wiki_url,
        });
        slotVars.push(n);
        extraConstraints.push(`${n} - ${xv.name} <= 0`); // only when the host item is equipped
        const k = `${opt.stat}||${_equivType(opt.bonus_type)}`;
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        zByBucket.get(k).push(zOf([n], value, opt, xv.variant.variant_id));
      }
      if (slotVars.length) extraConstraints.push(`${slotVars.join(" + ")} <= 1`); // one craft per menu
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
    // #337 — the sets this host ALREADY belongs to intrinsically. Its x-var is
    // registered into setPieces for each of them above, so minting a pick var for
    // the same set would let one item count TWICE toward that set's threshold:
    // x_host and m are independently 1, and the single-identity constraint below
    // binds only the picks and a hosted set-augment copy — never the intrinsic
    // piece. A 3-piece set would then complete on two items.
    //
    // Skipping the pick is the whole fix: the host is already a piece of that set,
    // so the pick can only ever re-assert an identity it holds. Nothing optimal is
    // lost, because a pick that duplicates the intrinsic membership adds no
    // reachable state the intrinsic piece does not already give.
    //
    // Guarded HERE rather than in the producers. #334's KTD3 filter closed this
    // data-side for the Dino channel only; `attach_lost_purpose_slots` has no such
    // filter, and the first gear batch giving a Lost Purpose host an intrinsic
    // pool-set membership reopens the class silently (src/membership.py notes
    // Forbidden Knowledge carries intrinsic raid members). One guard at the mint
    // closes it for every producer and every future channel.
    const intrinsicSets = new Set();
    for (const sb of xv.variant.set_bonus || []) if (sb.set) intrinsicSets.add(sb.set);
    for (const setName of mslot.pool) {
      if (hostSets.has(setName)) continue;
      if (intrinsicSets.has(setName)) continue;   // #337 — already a piece of this set
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
    if (opts.length) {
      // #312 — a hosted set-augment copy overrides the host's Set Bonus, and an
      // AWAKENED membership is the host's Set Bonus too (the reported repro: a
      // Lost Purpose hat awakened into Forbidden Knowledge while hosting a
      // Perfect Silence copy counted toward both). Awakening is a choice, so
      // mutual exclusion loses no optimal solution — the solver simply keeps
      // the better of the two identities. `hostsVar` exists only for hosts
      // that can hold a copy; intrinsic members use the (x_i - hosts_i)
      // suppression rewrite instead because their membership is not optional.
      const h = hostsVar.get(xv.name);
      extraConstraints.push(`${opts.join(" + ")}${h ? ` + ${h}` : ""} <= 1`); // single set-bonus identity per host
    }
  }

  // U3 Part B — self-seed each Set Augment's 3-piece tier into the set-threshold
  // engine (mirrors the chosen-membership self-seed above) and register its placed
  // copies (the y vars built in Part A) as set pieces, so the EXISTING threshold
  // constraint below fires the Artifact bonus at exactly 3 copies. A set augment is
  // an awaken-only set — no intrinsic member exists — so the tier is reachable purely
  // from these copies; self-seeding is idempotent if a same-named set were ever
  // already registered.
  for (const [setName, { tier, ys, advancesTarget }] of setAugToSeed) {
    if (!setTiers.has(setName)) setTiers.set(setName, new Map());
    const byLabel = setTiers.get(setName);
    if (!byLabel.has(tier.pieces_label)) byLabel.set(tier.pieces_label, tier);
    if (!setPieces.has(setName)) setPieces.set(setName, []);
    for (const y of ys) setPieces.get(setName).push(y);
    // #539 — a symmetry cut, and it is why pinning stayed usable. A set minted
    // ONLY because it was pinned grants nothing the player ranked, so a copy
    // beyond the threshold can never improve the objective — it can only consume
    // a colour slot a real augment wanted. Capping the copies at exactly the
    // threshold removes an entire dimension of equivalent assignments from the
    // branch-and-bound.
    //
    // Sound precisely BECAUSE the set advances no target: for a set that does
    // advance one, extra copies can be load-bearing (a higher tier), so the cap
    // is not applied there.
    // A PINNED set augment has exactly one tier, and the pin already forces it, so
    // a copy beyond the threshold can never improve anything — it can only consume
    // a colour slot a real augment wanted. Capping at the threshold removes a
    // whole dimension of equivalent assignments. Applies to every pinned set, not
    // just one granting nothing ranked: the extra copies are worthless either way.
    if (pinnedSetsForMint.has(setName) && ys.length > tier.pieces_required) {
      extraConstraints.push(`${ys.join(" + ")} <= ${tier.pieces_required}`);
    }
    // …and a pinned set that grants nothing ranked has its copies kept OUT of the
    // tie-break minimization (see `pinnedSetAugVars` where it is consumed).
    //
    // MEASURED, on the reporter's own four-set case against a 6.5s unpinned
    // baseline: 62s with them in, 40s with them out. Widening the exclusion to
    // pinned sets that DO advance a target was tried and measured WORSE (45s) —
    // there the minimization is still doing useful work, so it stays.
    if (!advancesTarget) for (const y of ys) pinnedSetAugVars.add(y);
  }

  let sc = 0;
  // #539 — the sets the player pinned, already classified by the model (a pin that
  // reached here is one the eligible pool can supply). Two things change below:
  // the pinned set's LOWEST tier is encoded even when it advances no ranked
  // target, and that tier is forced to 1.
  const pinnedSetNames = pinnedSetsForMint;
  const pinnedTierOf = new Map();   // set name -> the lowest pieces_required it has
  for (const setName of pinnedSetNames) {
    const byLabel = setTiers.get(setName);
    if (!byLabel) continue;
    let low = null;
    for (const [, t] of byLabel) {
      if (t.pieces_required != null && (low == null || t.pieces_required < low)) low = t.pieces_required;
    }
    if (low != null) pinnedTierOf.set(setName, low);
  }
  const setPinsBound = [];   // {set, pieces_required, var} — what actually got forced

  for (const [setName, byLabel] of setTiers) {
    const pieceVars = setPieces.get(setName) || [];
    if (!pieceVars.length) continue;
    for (const [, tier] of byLabel) {
      const best = new Map();
      for (const a of tier.affixes) {
        const k = `${a.stat}||${_equivType(a.bonus_type)}`;
        if (targetSet.has(a.stat) && a.value > 0 && (!best.has(k) || best.get(k) < a.value)) best.set(k, a.value);
      }
      // #539 — a PINNED set's lowest tier is encoded whatever it grants. Without
      // this, pinning a set whose stats you have not ranked would silently do
      // nothing, which is the exact complaint the pin exists to answer. The tier
      // still contributes no `z` when it advances no target; it exists so the
      // `= 1` below has something to bind to.
      const isPinnedTier = pinnedTierOf.get(setName) === tier.pieces_required;
      if (!best.size && !isPinnedTier) continue; // this tier advances no target
      const sa = "s" + sc++;
      extraVars.push(sa);
      setMeta.set(sa, {
        set: setName, pieces_required: tier.pieces_required,
        pieces_label: tier.pieces_label, wiki_url: tier.wiki_url,
        // Full granted affix list for this tier, so the Set Bonuses tab can show a
        // craftable-membership set's affixes — its awaken hosts carry no static
        // parsed_set_bonuses, so the renderer can't derive them from equipped items.
        affixes: tier.affixes || [],
        realPieces: pieceVars.filter((p) => !p.startsWith("k")),  // non-joker pieces, for the joker load-bearing check
      });
      // U4 — suppression rewrite: for each piece term that is an INTRINSIC member x-var
      // (x_i, from set_bonus/parsed_set_bonuses) whose item hosts a set-augment copy,
      // replace x_i with (x_i - hosts_i) — "equipped and not suppressed". Only intrinsic
      // x_i pieces registered in hostsVar are rewritten; joker (k) / membership-pick (m) /
      // and the augment-set's OWN copy (ya) piece terms are NOT in hostsVar and pass through
      // unchanged (a copy must never suppress its own tier). In the `pr·sa - Σpieces <= 0`
      // form, -(x_i - hosts_i) contributes `- x_i + hosts_i`.
      let lhs = `${tier.pieces_required} ${sa}`;
      for (const p of pieceVars) {
        lhs += hostsVar.has(p) ? ` - ${p} + ${hostsVar.get(p)}` : ` - ${p}`;
      }
      extraConstraints.push(`${lhs} <= 0`);
      // #539 — the pin itself. `sa = 1` plus the indicator above forces
      // `Σ pieces >= pieces_required`: the set must be delivered, or the program
      // is infeasible and `solveLexicographic` names the pins as the cause.
      if (isPinnedTier) {
        extraConstraints.push(`${sa} = 1`);
        setPinsBound.push({ set: setName, pieces_required: tier.pieces_required, var: sa });
      }
      for (const [k, val] of best) {
        if (!zByBucket.has(k)) zByBucket.set(k, []);
        // No override marker: a set tier's bonus type is a catalog-level claim
        // shared by every member, which the plan's Scope Boundaries rule out as a
        // per-player override — a mistyped tier is a data correction.
        zByBucket.get(k).push(zOf([sa], val, null));
      }
    }
  }

  // The empty gate list makes a credit AVAILABLE; it does not make it TAKEN.
  // `encodeStage` bounds each z by the bucket cap plus one `z - gate <= 0` per
  // gate, so a gateless z is a free binary that only an objective pulls to 1.
  // That holds on the optimum path — every stage maximizes its stat and then
  // locks it exactly — but every alternatives generator runs `tieBreak:false`
  // with relaxed `>= value - give` locks, where a credited stat that is not the
  // current gain objective carries no objective coefficient and settles at its
  // lower bound. `readSolution` sums value*z, so that alternative would report a
  // total missing a bonus the player unconditionally holds. For gear, `z = 0`
  // truthfully means "not equipped"; for a credit it asserts something false
  // about the character — the one invariant a credit does NOT inherit from gear.
  // Pin each credited bucket at or above its credit. Always feasible (the
  // credit's own z satisfies it), one constraint per credited bucket.
  //
  // EMITTED LAST, and that placement is load-bearing — do not hoist it up to the
  // bucket build. Worn affixes are bucketed near the top of this function, but
  // augments, set tiers, crafting, and set augments push into `zByBucket`
  // throughout the body above. Emitted any earlier, this sums only the
  // contributions that existed at that point while `encodeStage`'s
  // `sum(z) <= 1` covers the whole bucket — so choosing a later-added
  // contribution drives the constrained subset to zero and violates the bound,
  // and the solver is forced onto the weaker credit. Shipped exactly that way
  // once: a credit of 7 against an Insight-10 augment resolved to 7 with the
  // augment unequipped, breaking R5. Worn-only tests cannot catch it; the
  // augment and set-tier regressions in tests/solver.test.js pin it.
  // Excluded bonus types, dropped HERE for exactly the reason the credit floors
  // below are emitted here: augments, set tiers, crafting and set augments push
  // into `zByBucket` throughout the body above, so anything earlier would delete
  // the contributions that existed at that point and silently keep every one
  // added afterwards — an exclusion that held for worn gear and leaked on
  // augments. Deleting the whole bucket is the whole mechanism: a bucket with no
  // contributions cannot be scored, so nothing is credited for it and nothing is
  // placed FOR it. Items are still free to be chosen for their other stats, which
  // is the correct reading — the player excluded a bonus type, not an item.
  for (const key of excludedBuckets) zByBucket.delete(key);

  for (const [key, floorValue] of creditBuckets) {
    // NOTE on the skip interaction: a bucket deleted just above is absent from
    // `zByBucket`, so `zs` is empty and the guard below already skips its floor.
    // That matters — a floor on a deleted bucket is unsatisfiable and would make
    // the whole solve infeasible, and a hand-edited backup can carry both answers
    // for one type even though the UI cannot. No separate exclusion check is
    // written here on purpose: it could not be made to fail, and a guard that
    // cannot fail reads as protection this code does not actually have.
    const zs = zByBucket.get(key) || [];
    if (!zs.length) continue;
    extraConstraints.push(`${zs.map((z) => `+ ${z.value} ${z.name}`).join(" ")} >= ${floorValue}`);
  }

  // #91 (U3, KTD2) — per-effect utility indicators. One binary u_e per
  // counting-set name with ANY contribution in the built buckets, ceilinged by
  // the CONTRIBUTION z vars in that effect's buckets: `u_e − Σz ≤ 0`. The z
  // vars — not raw gate binaries — because each z already ANDs its own gates
  // (item equipped, augment placed, craft chosen, set threshold fired), so
  // every channel counts under one uniform rule. The binary ceiling makes
  // duplicates free (R3): a second Ghost Touch raises Σz, not u_e. A name
  // absent from every eligible variant mints nothing. Emitted HERE — after the
  // last zByBucket push (set tiers above, mirroring the credit-floor placement
  // note) — or a later-added channel's contributions would be invisible to the
  // ceiling. Names are minted in sorted order so var numbering (and therefore
  // the encoded program) is deterministic.
  const utilityVars = [];
  const utilityMeta = new Map(); // u var -> { name, zNames } (the stage + receipts read this)
  if (utilityCountingSet) {
    // One grouping pass over zByBucket (stat -> z names, bucket order preserved)
    // instead of rescanning the whole map per counting-set name.
    const zNamesByStat = new Map();
    for (const [key, zs] of zByBucket) {
      const stat = key.split("||")[0];
      if (!utilityCountingSet.has(stat)) continue;
      let list = zNamesByStat.get(stat);
      if (!list) zNamesByStat.set(stat, (list = []));
      for (const z of zs) list.push(z.name);
    }
    let uc = 0;
    for (const name of [...utilityCountingSet].sort()) {
      const zNames = zNamesByStat.get(name) || [];
      if (!zNames.length) continue; // no carrier anywhere -> no indicator
      const u = "u" + uc++;
      extraVars.push(u);
      utilityVars.push(u);
      utilityMeta.set(u, { name, zNames });
      extraConstraints.push(`${u} - ${zNames.join(" - ")} <= 0`);
    }
  }
  // #348 (U3, R6) — the container as an ORDERED list of indicators. Var NAMES stay
  // sorted-minted above so the encoded program is byte-stable; this is the pursuit
  // order laid over them. A name the player ordered but no variant carries mints no
  // indicator, so it drops out here and is reported unsecured rather than silently
  // shifting every later position up.
  const utilityOrderVars = [];
  // Ordered container names with NO minted indicator: nothing in the eligible pool
  // carries them at all. They are unsecured for a different reason than "lost to a
  // ranked stat", and R14 has to be able to say which.
  const utilityUnreachable = [];
  if (utilityCountingSet) {
    const uByName = new Map();
    for (const [u, meta] of utilityMeta) uByName.set(meta.name, u);
    const order = Array.isArray(model.utilityOrder) && model.utilityOrder.length
      ? model.utilityOrder
      : [...utilityCountingSet].sort();
    const seen = new Set();
    for (const name of order) {
      if (seen.has(name)) continue;            // a duplicate would pursue one effect twice
      seen.add(name);
      const u = uByName.get(name);
      if (u) utilityOrderVars.push({ name, u });
      else utilityUnreachable.push(name);
    }
  }

  return {
    // creditBuckets (bucket key -> declared-credit floor) rides out for the
    // #322 visibility guard (visibleGateSet) rather than being re-derived.
    xVars, zByBucket, cappedStats, intrinsicCaps: { ...(model.intrinsicCaps || {}) },
    targetList: model.targets, model, creditMeta, creditBuckets, overrideMeta,
    // #539 — the set pins this program actually bound, so a solve can report what
    // it was holding rather than the caller re-deriving it from the query.
    setPinsBound,
    // #539 — excluded from the tie-break's minimization; see its declaration.
    pinnedSetAugVars,
    // #325 — floored stats (targets or not) join visibleGateSet's stat universe:
    // a contribution supporting a floored stat is load-bearing even when every
    // tracked stat it also feeds is capped and slack.
    flooredStats: Object.keys(model.floors || {}),
    forcedOffVars: forcedOffSlotVars(xVars, model.query && model.query.slotConstraints),
    extraVars, extraConstraints, penaltyKeys, augMeta, placeMeta, setMeta, dinoMeta, ncMeta, rollMeta, vikMeta, sealMeta, tfMeta, gsMeta, essMeta, jokerMeta, jokerVars, memberMeta, memberVars, setAugMeta, setAugVars: [...setAugMeta.keys()], setAugColorMeta, hostsVar, _zc: zc,
    // #91 (U3) — the Utility tier's stage state: whether the sentinel is
    // ranked, the per-effect indicator binaries, and their name/ceiling meta.
    utilityEnabled, utilityVars, utilityMeta,
    // #348 (U3) — [{ name, u }] in the player's pursuit order (see above), plus
    // the ordered names no eligible variant carries.
    utilityOrderVars, utilityUnreachable,
    // #332 — the ranked stats the tier will NOT count. Counting-set membership is
    // knowable HERE and nowhere downstream: a restored character's exports have no
    // dataset to re-derive it from, so it has to ride the result. This list is
    // deliberately unfiltered — every ranked non-counted stat, magnitude or
    // presence — because the type of an affix is the display layer's knowledge
    // (it reads the breakdown), not the solver's. Projection narrows it to the
    // presence ones, which are the only case a player could mistake for a
    // counted effect.
    // Narrowed to the NOT-COUNTED presence names when the host supplies them:
    // those are the names a player can rank while the tier never counts them,
    // i.e. the only ones the exclusion sentence should name. Without that set the
    // list stays empty rather than naming every ranked magnitude — an unhelpful
    // sentence is worse than none, and a host that has not threaded the set has
    // not opted in. #380 renamed the set; it went empty for a day when upstream
    // typed the untyped weapon procs `Bool`, which silenced this sentence
    // entirely without any assertion catching it — hence the real-data
    // non-emptiness pin in tests/dataset.test.js.
    utilityRankedNotCounted: (utilityEnabled && model.utilityNotCountedSet)
      ? (model.targets || []).filter((s) => s !== _UTILITY_SENTINEL
          && model.utilityNotCountedSet.has(s)
          && !(utilityCountingSet && utilityCountingSet.has(s)))
      : [],
  };
}

/** Raw stacked expression (terms) for a stat: sum over its buckets of value*z.
 *  U2 (#290/#291): "its buckets" = the stat's own PLUS its cross-add source
 *  stats' (bucketCountsFor), so the objective, stage locks, floors/probeMax,
 *  and readSolution's achieved values all count universal sources uniformly. */
function rawExpr(program, stat) {
  const terms = [];
  for (const [key, zs] of program.zByBucket) {
    if (!bucketCountsFor(key, stat)) continue;
    for (const z of zs) terms.push({ coef: z.value, name: z.name });
  }
  return terms;
}

/** The LP variable name for a capped stat's clamp var. LP-format tokens split on
 *  whitespace, so a multi-word stat ("Universal Spell Power", "Physical
 *  Sheltering") minted as a bare `d_<stat>` produced an unparseable model and
 *  HiGHS ABORTED the whole solve — a pre-existing crash for ANY multi-word
 *  user-capped stat, exposed by the U2 source-stat cap test. Non-alphanumerics
 *  map to "_"; single-word stats keep their exact historical names. */
function dVar(stat) {
  return "d_" + String(stat).replace(/[^A-Za-z0-9]/g, "_");
}

/** Objective/lock expression for a stat: the capped var if capped, else raw. */
function effectiveExpr(program, stat) {
  if (program.cappedStats[stat] != null) return [{ coef: 1, name: dVar(stat) }];
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
    // Set-augment copy vars (y) join jokers/members in the tie-break minimization so a copy
    // is placed ONLY when its 3-piece tier is genuinely won (a locked stat forces it) — never
    // gratuitously, which would suppress a host's own set (U4) for nothing.
    // #539 — a PINNED set's copies are excluded here. They
    // are load-bearing by construction (the pin forces the tier), so the
    // "placed only when genuinely won" rationale above does not apply to them,
    // and minimizing over them turns the tie-break into a 500-choose-3 assignment
    // problem per pinned set. Measured at 46.5s of a 62s solve before this.
    const _pinned = program.pinnedSetAugVars || new Set();
    const minVars = [...(program.jokerVars || []), ...(program.memberVars || []),
      ...(program.setAugVars || []).filter((v) => !_pinned.has(v))];
    const terms = program.xVars.map((xv, i) => `+ ${i + 1} ${xv.name}`)
      .concat(minVars.map((v, i) => `+ ${n + 1 + i} ${v}`));
    L.push(" obj: " + terms.join(" "));
  } else if (objTerms) {
    // Arbitrary linear objective. Two users: the alternatives generators (e.g.
    // the fewer-crafts generator minimizes the sum of the placement binaries)
    // and the optimum path's Utility stage (#91 U3), which maximizes the sum
    // of the per-effect indicator binaries when the sentinel priority solves.
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

  // #335 U2 (KTD3) — a duplicate-ring twin is takeable only alongside its
  // original. The slot capacity constraint above already bounds the pair (the
  // twin shares its original's slot and cardinality), so this adds only the
  // ordering. Without it the program has two identical solutions for every
  // doubled pick, and the solver could return the twin with its original absent —
  // a state no display path expects.
  for (const xv of program.xVars) {
    if (xv.twinOf) L.push(` c${c++}: ${xv.name} - ${xv.twinOf} <= 0`);
  }

  const _penaltyKeys = program.penaltyKeys || new Set();
  for (const [key, zs] of program.zByBucket) {
    // #614 — the `Σz ≤ 1` cap IS max-of-type, and penalties must not have it: the
    // wiki states "Penalties always stack", so every one applies additively. A
    // penalty bucket holding three -2s must contribute -6, not -2.
    const isPenalty = _penaltyKeys.has(key);
    if (zs.length && !isPenalty) L.push(` c${c++}: ${zs.map((z) => z.name).join(" + ")} <= 1`);
    // A contribution is available only when ALL of its gates are 1: emit one
    // z - gate <= 0 per gate. A worn affix has a single gate (identical to before).
    for (const z of zs) for (const gate of z.gates) L.push(` c${c++}: ${z.name} - ${gate} <= 0`);
    // #614 — and a penalty is FORCED on, not merely permitted. Without a lower
    // bound the maximising objective sets a negative z to 0 and the penalty goes
    // unpaid while the item stays equipped — which is why deleting the `value > 0`
    // gates alone would have looked like a fix and changed nothing.
    //
    // `z >= Σgates - (n-1)` is the standard AND lower bound: it binds only when
    // every gate is 1, and collapses to `z >= gate` for the single-gate worn case
    // that is the whole shipping population today.
    if (isPenalty) {
      for (const z of zs) {
        if (!z.gates.length) continue;
        const n = z.gates.length;
        L.push(` c${c++}: ${z.name} - ${z.gates.join(" - ")} >= ${1 - n}`);
      }
    }
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
    if (raw.length) L.push(` c${c++}: ${dVar(stat)} ${fmtExpr(raw.map((t) => ({ coef: -t.coef, name: t.name })), fb)} <= 0`);
    else L.push(` c${c++}: ${dVar(stat)} <= 0`);
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
  for (const [stat, cap] of Object.entries(program.cappedStats)) L.push(` 0 <= ${dVar(stat)} <= ${cap}`);

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
// U3 (R8) — how a declared credit names itself wherever contributors are listed.
// One string so the app and every export agree, and so a reader can tell a
// player-asserted number from a wiki-sourced one without consulting anything.
const DECLARED_LABEL = "declared, not from gear";

/** #206 — drop augments whose contribution is zero given the settled loadout.
 *
 *  An augment worth nothing is not a scoring error — the bucket already takes the
 *  max, so the reported total is right — but recommending it tells the player to
 *  farm and spend an augment that does nothing, and consumes a slot that could
 *  hold something useful. The reported case was a +8 Conjuration Topaz alongside
 *  a +13 same-type craft.
 *
 *  Nothing in the model forbade it. The tie-break minimizes item picks, jokers,
 *  members, and set-augment copies, so each of those is placed only when
 *  load-bearing; ordinary augment placements were left out, so whether a useless
 *  one got slotted was decided by HiGHS's branch order rather than by us.
 *
 *  This runs as its own stage rather than by adding the placement vars to that
 *  tie-break. Those vars carry coefficients larger than any item's, so folding
 *  them in makes "avoid one augment" outweigh "keep the item set small": measured
 *  across the golden fixtures it left every target value identical but reshuffled
 *  5 of 11 loadouts, one of them equipping two MORE items to shed one augment.
 *  Same score, different gear, for a defect that has never been observed — churn
 *  is a real cost and that trade is not worth making.
 *
 *  Here the whole loadout is pinned first — every item, joker, membership, and
 *  craft pick fixed at the value the tie-break chose — and only then are
 *  placements minimized. The result is identical items and identical totals by
 *  construction; the only thing that can move is an augment that was contributing
 *  nothing. Falls back to the tie-break solution if this stage does not solve.
 */
/** Pin each named binary at the value it holds in the prior stage's result —
 *  the pin-everything step every post-stage shares. */
function pinVarsAt(pin, at, names) {
  for (const v of names) pin.push(`${v} = ${at(v) > 0.5 ? 1 : 0}`);
}

/** The structural picks both post-stages pin: items, jokers, memberships, and
 *  set-augment copy vars. */
function structuralPinNames(program) {
  return [...program.xVars.map((xv) => xv.name), ...(program.jokerVars || []),
          ...(program.memberVars || []), ...(program.setAugVars || [])];
}

function dropNoOpAugments(program, highs, tbRes, locks, extraBase) {
  const placeVars = program.placeMeta ? [...program.placeMeta.keys()] : [];
  if (!placeVars.length || tbRes.Status !== "Optimal") return tbRes;
  const at = (name) => (tbRes.Columns[name] ? tbRes.Columns[name].Primal : 0);
  // Pin every structural pick. Augment placements are deliberately NOT pinned —
  // they are the only degree of freedom this stage has.
  // #91 (U3, KTD5) — `extraBase` carries the Utility count lock (when the tier
  // is ranked): stat locks say nothing about presence effects, so without it
  // this stage would happily strip a counted effect's only carrier augment as
  // a "no-op". Threaded per-call, never mutated onto the shared program.
  const pin = [...(extraBase || [])];
  pinVarsAt(pin, at, structuralPinNames(program));
  const res = highs.solve(encodeStage(program, {
    sense: "min", objTerms: placeVars.map((v) => ({ coef: 1, name: v })),
    locks, extra: pin,
  }));
  return res.Status === "Optimal" ? res : tbRes;
}

/** #316 — final stage: a set-augment copy prefers a Colorless slot on ties.
 *
 *  A Colorless slot is the least reusable slot on an item — only Colorless
 *  augments ever fit it — so when stat totals are identical either way, a copy
 *  should consume Colorless before a colored slot and leave the more broadly
 *  usable colored slots open. Like dropNoOpAugments (and per the #206 ruling),
 *  this is a pinned post-stage, never a tie-break coefficient: every item,
 *  joker, membership, copy (y), and ordinary-placement pick is pinned at the
 *  value the prior stages settled — pinning the ordinary placements is what
 *  stops this stage re-adding a no-op placement or displacing an ordinary
 *  augment to buy a preference — and only the set-augment color vars (which
 *  the tie-break objective and settle pins deliberately exclude) remain free.
 *  Minimizing the non-Colorless color vars then lands every copy Colorless
 *  exactly when capacity genuinely allows, with identical items, totals, and
 *  placement counts by construction. Falls back to the prior result if the
 *  stage does not solve.
 */
function preferColorlessSetAugments(program, highs, prevRes, locks, extraBase) {
  const colorMeta = program.setAugColorMeta;
  if (!colorMeta || !colorMeta.size || prevRes.Status !== "Optimal") return prevRes;
  const at = (name) => (prevRes.Columns[name] ? prevRes.Columns[name].Primal : 0);
  const nonColorless = [...colorMeta.entries()]
    .filter(([, m]) => m.slot_color !== "Colorless").map(([cv]) => cv);
  // Objective already 0 (no copy fired a colored slot) -> the solve is a
  // guaranteed no-op; skip it. Subsumes the no-copies-placed case.
  if (!nonColorless.some((v) => at(v) > 0.5)) return prevRes;
  // #91 (U3, KTD5) — the Utility count lock rides along (see dropNoOpAugments).
  const pin = [...(extraBase || [])];
  pinVarsAt(pin, at, structuralPinNames(program));
  // The settle stage's outcome, pinned at placement IDENTITY (the pu vars the
  // value gates ride on) — NOT at the per-color p vars: settle parks a
  // multi-fit augment's color arbitrarily, and freeing the colors is what lets
  // this stage move an ordinary augment out of a Colorless slot to seat a copy
  // there. Totals cannot move (value gates on pu), no augment can be displaced
  // (every pu stays 1), and capacity still binds the color shuffle.
  pinVarsAt(pin, at, program.placeMeta ? [...program.placeMeta.keys()] : []);
  // Hold every other reported family at its settled value: this stage's
  // objective is indifferent to them, so an alternate equally-optimal vertex
  // could otherwise flip reported sets, crafts, or suppression flags with
  // identical totals — display churn the settle stage exists to prevent.
  for (const meta of [program.setMeta, program.dinoMeta, program.ncMeta, program.rollMeta,
                      program.vikMeta, program.sealMeta, program.tfMeta, program.gsMeta,
                      program.essMeta]) {
    pinVarsAt(pin, at, meta ? [...meta.keys()] : []);
  }
  pinVarsAt(pin, at, program.hostsVar ? [...program.hostsVar.values()] : []);
  const res = highs.solve(encodeStage(program, {
    sense: "min", objTerms: nonColorless.map((v) => ({ coef: 1, name: v })),
    locks, extra: pin,
  }));
  return res.Status === "Optimal" ? res : prevRes;
}

// #322/#325 — is gate g a REPORT-HIDDEN placement? Scoped to the guarded
// placement families (ordinary augments' pu + the seven crafts) so worn/set
// display is untouched. Shared by breakdownByTarget and buildCreditReport so
// attribution and the credit notice can never disagree about which placements
// the report endorses.
function hiddenPlacementGateFn(program, visible) {
  const placementMetas = [program.placeMeta, program.dinoMeta, program.ncMeta, program.rollMeta,
                          program.vikMeta, program.sealMeta, program.tfMeta, program.gsMeta,
                          program.essMeta];
  return (g) => !visible.has(g) && placementMetas.some((m) => m && m.has(g));
}

function breakdownByTarget(program, prim, precomputedVisible) {
  const xByName = new Map(program.xVars.map((xv) => [xv.name, xv]));
  // #322 — a placement the report guards omit (fired but invisible: cap-clamped
  // or credit-substituted) must not be named by attribution either. Same
  // predicate readSolution's guards consume. Production call sites pass
  // readSolution's set to avoid computing it twice per solve; the 2-arg test
  // seam computes it here.
  const visible = precomputedVisible || visibleGateSet(program, prim);
  const hiddenPlacementGate = hiddenPlacementGateFn(program, visible);
  const creditFloors = program.creditBuckets || new Map();
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
    if (program.ncMeta && program.ncMeta.has(gate)) { const m = program.ncMeta.get(gate); return { kind: "nc", label: m.pool || "Nearly Completed", slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.rollMeta && program.rollMeta.has(gate)) { const m = program.rollMeta.get(gate); return { kind: "roll", label: "choice slot", slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.vikMeta && program.vikMeta.has(gate)) { const m = program.vikMeta.get(gate); return { kind: "vik", label: `Slot ${m.slot_type} Viktranium augment`, slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.tfMeta && program.tfMeta.has(gate)) { const m = program.tfMeta.get(gate); return { kind: "tf", label: `Thunder-Forged Tier ${m.tier}`, slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.essMeta && program.essMeta.has(gate)) { const m = program.essMeta.get(gate); return { kind: "essence", label: `Essence Crafting ${m.menu}: ${m.effect}`, slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.gsMeta && program.gsMeta.has(gate)) { const m = program.gsMeta.get(gate); return { kind: "gs", label: "Green Steel", slot: slotOfItem.get(m.item) || null, hostIds: [m.item] }; }
    if (program.placeMeta && program.placeMeta.has(gate)) return { kind: "augment", label: program.placeMeta.get(gate).variant_id };
    return { kind: "other", label: gate };
  };
  const out = {};
  for (const stat of program.targetList) {
    if (stat === _UTILITY_SENTINEL) continue; // #91 (KTD1) — not a stat; no per-stat parts
    const parts = [];
    for (const [key, zs] of program.zByBucket) {
      // U2 (#290/#291) — a cross-added bucket's parts appear under the target
      // with `crossAdd` naming the source stat (null on the target's own
      // parts). Mirrors `via`: provenance that rides through projection
      // untouched; a later unit renders it.
      const counts = bucketCountsFor(key, stat);
      if (!counts) continue;
      const crossAdd = counts.source;
      const bonusType = key.split("||")[1];
      // #626 (tie-break) — on a CAPPED stat the LP's choice inside a bucket is
      // free, and it picked arbitrarily.
      //
      // `Sum(z) <= 1` models max-of-type by letting the solver take at most one
      // contributor, and while the objective is the raw sum it always takes the
      // largest. A cap breaks that: the objective becomes `d`, with `d <= raw`
      // and `d <= cap`, so once raw clears the cap EVERY choice of contributor is
      // optimal and HiGHS returns whichever it happens to land on.
      //
      // Reported from a real build: Charisma capped at 15, with `Charisma |
      // Enhancement` available at 9 (a Gem essence craft), 9 (Epic Flameward) and
      // 10 (Epic Coalesced Coinage). The LP took the 9. Raw printed as 16 when
      // the player's own gear gives 17, the breakdown named a craft instead of
      // the worn item, and the +10 the player could see on their off hand read as
      // ignored. In game they have the 10 — max-of-type is over what is EQUIPPED,
      // not over what an LP found convenient.
      //
      // So on a capped stat the winner is recomputed as the largest contribution
      // whose gates all fired. Deliberately scoped to capped stats: everywhere
      // else the stage lock pins the sum, the LP already takes each bucket's
      // maximum, and this must not perturb a byte of it. Credits and
      // hidden-placement contributions are left alone on both sides — they carry
      // their own substitution rules (#322/#325) that this must not step on.
      const isCredit = (z) => !!(program.creditMeta && program.creditMeta.has(z.name));
      const capFree = program.cappedStats && program.cappedStats[stat] != null;
      let override = null;
      if (capFree) {
        // The best contribution this bucket can actually supply: equipped (every
        // gate fired), still reported (not behind a hidden placement), and not a
        // credit — credits carry their own substitution rules (#322/#325).
        let best = null;
        for (const z of zs) {
          if (isCredit(z) || !z.gates.length) continue;
          if (!z.gates.every((g) => prim(g) > 0.5)) continue;
          if (z.gates.some(hiddenPlacementGate)) continue;
          if (!best || z.value > best.value) best = z;
        }
        const sel = zs.find((z) => prim(z.name) > 0.5);
        if (best && sel && !isCredit(sel)) {
          // Two ways the LP's pick is not what the player has. It chose a smaller
          // contributor (pure cap degeneracy), OR its pick has since been ruled a
          // hidden placement — and then the bucket must fall back to what the
          // player still wears rather than vanishing from the receipts entirely.
          // Dropping it outright left raw at 7 against a displayed 15 on the
          // reported build, breaking the invariant that the parts sum back to the
          // effective total.
          if (sel.gates.some(hiddenPlacementGate) || best.value > sel.value) override = best;
        }
      }
      for (const z of (override ? [override] : zs)) {
        if (override || prim(z.name) > 0.5) {
          // #322 — skip contributions gated by a hidden placement (see above).
          // #325 — but in a CREDITED bucket, emit the DECLARED part (value =
          // floor) in the skipped part's place. Both hidden shapes assume the
          // credit backfills the floor once the placement is gone: an at-floor
          // craft merely substitutes for the credit (its whole value is the
          // floor), and a cap-hidden craft was judged on its value − floor
          // net. Without this part the proof panel and every export explain
          // the total short by the floor while creditReport says gear covers
          // it — the receipts must sum back to the displayed effective.
          if (z.gates.some(hiddenPlacementGate)) {
            const floor = creditFloors.get(key);
            if (floor != null && !(program.creditMeta && program.creditMeta.has(z.name))) {
              parts.push({
                bonus_type: bonusType, value: floor, source: DECLARED_LABEL,
                sourceKind: "declared", slot: null, setYieldingSlots: null,
                hostIds: null, via: null, crossAdd,
              });
            }
            continue;
          }
          // U3 — a declared credit is resolved from the CONTRIBUTION, not from a
          // gate. It has none, so `sourceOf(z.gates[0])` reads `undefined` and
          // falls through every branch to `{kind:"other", label: undefined}` —
          // which rendered as a bare "— ·" the moment U2 made credits reachable.
          // `creditMeta` is keyed by z name for exactly this lookup.
          const src = (program.creditMeta && program.creditMeta.has(z.name))
            ? { kind: "declared", label: DECLARED_LABEL }
            : sourceOf(z.gates[0]);
          parts.push({
            bonus_type: bonusType, value: z.value, source: src.label, sourceKind: src.kind,
            slot: src.slot != null ? src.slot : null,
            setYieldingSlots: src.setYieldingSlots || null,
            // host variant_id(s) driving this contribution — worn is its own item;
            // sets/crafts carry their hosts; augment/dino are resolved in results.js.
            hostIds: src.hostIds || (src.kind === "worn" ? [src.label] : null),
            // #205 — the enchantment this contribution is actually printed as.
            via: z.via || null,
            // #88 U8 (R13/R16) — the type the CATALOG recorded, when the player
            // overrode it. Present only on an overridden contribution, so every
            // surface can label it and name both types; null everywhere else.
            // Threaded here rather than re-derived downstream because this is the
            // only point where a selected z is still joined to its own source.
            overriddenFrom: (program.overrideMeta && program.overrideMeta.get(z.name))
              ? program.overrideMeta.get(z.name).from : null,
            // U2 (#290/#291) — the cross-add SOURCE stat this part came from,
            // or null for the target's own parts.
            crossAdd,
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
    + (program.tfMeta ? program.tfMeta.size : 0) + (program.gsMeta ? program.gsMeta.size : 0)
    + (program.essMeta ? program.essMeta.size : 0);
  return { variants: program.xVars.length, crafts, stages: (program.targetList || []).length + 1 };
}

// #326 — THE single definition of a per-stat total read off a primal. These
// used to be computed independently at four sites (visibleGateSet's raw cache,
// readSolution's effective loop, probeMax, and solveConstrained's gainVal); a
// contribution path added to only one of them would silently diverge the
// guard's arithmetic from the displayed totals. rawTotalOf sums every fired
// contribution across the stat's buckets; effectiveOf clamps to the stat's cap
// as min(cap, raw) — NOT the d_ variable, which an alternative's relaxed solve
// leaves floating at its lower bound (see the note in readSolution).
function rawTotalOf(program, prim, stat) {
  // #626 — on a CAPPED stat the LP's choice inside a bucket is free (the same
  // degeneracy `breakdownByTarget` corrects): once raw clears the cap, every
  // contributor is optimal, so summing the SELECTED z understates the raw the
  // player's gear actually gives. Take each bucket's largest AVAILABLE
  // contribution instead — the rule the game applies and the one the breakdown
  // now reports, so the two cannot disagree about the same number.
  //
  // Uncapped is byte-identical: the stage lock pins the sum and the LP already
  // took each bucket's maximum, so there is nothing to correct and this must not
  // touch it. An UNSELECTED credit (no gates) is still not counted — a credit is
  // held or it is not, and max-of-availability is about equipped gear.
  if (!(program.cappedStats && program.cappedStats[stat] != null)) {
    return rawExpr(program, stat).reduce((sum, t) => sum + (prim(t.name) > 0.5 ? t.coef : 0), 0);
  }
  let total = 0;
  for (const [key, zs] of program.zByBucket) {
    if (!bucketCountsFor(key, stat)) continue;
    let best = 0;
    for (const z of zs) {
      const available = prim(z.name) > 0.5
        || (z.gates.length > 0 && z.gates.every((g) => prim(g) > 0.5));
      if (available && z.value > best) best = z.value;
    }
    total += best;
  }
  return total;
}

/** #626 — what removing placement `g` would actually cost stat-side, inside one
 *  bucket: the z's value less whatever the bucket falls back to without it.
 *
 *  The old reckoning charged the z's WHOLE value, which is right only when it is
 *  the bucket's sole source. It usually is; where it is not, a redundant craft
 *  looked load-bearing and got recommended. Reported case: an Essence Crafting
 *  suffix granting `Charisma | Enhancement 9` on an item whose OFF HAND already
 *  carries the same bucket at 10. Removing the craft costs nothing — the bucket
 *  falls back to 10 — but it was charged 9, cleared the cap test, and the player
 *  was told to go craft it.
 *
 *  The declared-credit floor (#325) is the same idea and folds in as one more
 *  fallback: in a credited bucket the credit backfills the floor, so the loss is
 *  value − floor. `max(fallback, floor)` subsumes the old rule exactly. */
function bucketMarginalOf(zs, z, gate, prim, floor) {
  let fallback = floor != null ? floor : 0;
  for (const other of zs) {
    if (other === z || other.gates.includes(gate)) continue;
    const available = prim(other.name) > 0.5
      || (other.gates.length > 0 && other.gates.every((g) => prim(g) > 0.5));
    if (available && other.value > fallback) fallback = other.value;
  }
  return Math.max(0, z.value - fallback);
}
function effectiveOf(program, prim, stat) {
  const cap = program.cappedStats ? program.cappedStats[stat] : null;
  const raw = rawTotalOf(program, prim, stat);
  return cap != null ? Math.min(cap, raw) : raw;
}

// #319/#322 — the shared load-bearing test for every craft/placement family: a
// placement var is load-bearing iff some contribution it gates fired AND is
// VISIBLE in the displayed outcome. Two fired-but-invisible shapes exist:
//   (a) credit substitution — the z's bucket carries a declared-credit floor
//       and the z's value does not exceed it, so seating it grants nothing the
//       player does not already hold; such z's are dropped first.
//   (b) cap clamping — every tracked stat the z feeds is capped, and the
//       placement's surviving fired contributions are jointly slack under the
//       cap. In a credited bucket the contribution is counted NET of the
//       declared-credit floor (#325): removing the z lets the credit backfill
//       the floor, so the displayed total loses only value − floor. The test
//       is placement-level and summed, never per-contribution
//       (two contributions that jointly hold a stat at its cap keep their
//       placement reported), and SET-CONSISTENT across placements: pending
//       gates are judged greedily in a deterministic (sorted) order, and each
//       gate ruled hidden has its per-stat sums deducted from the raw before
//       the next gate is judged. Raw minus ALL hidden contributions therefore
//       still meets every cap — the displayed capped totals stay reachable
//       from the reported placements, so two placements each individually
//       slack but jointly holding a stat at cap can never hide each other
//       (the sorted order makes which jointly-saturating placement survives
//       stable). A z feeding ANY uncapped tracked stat (its own, or a
//       cross-add sibling per bucketCountsFor) is visible outright, and a
//       bucket feeding no capped tracked stat short-circuits to visible — so
//       behavior outside these two shapes is unchanged.
// Outcome-level invariant: a gate enters this set iff removing everything it
// gates would lower some displayed effective total or force a substitution the
// credit floor does not already cover — so a guarded report never claims a
// placement whose absence the displayed totals could not distinguish. The
// receipts stay whole: where a hidden placement sat in a credited bucket, the
// breakdown emits the DECLARED part at the floor in its place, so each stat's
// parts always sum back to at least its displayed effective.
//
// Settled scope (#325 ruling): the bespoke families — joker, set-membership,
// set-augment — judge on SET ACTIVITY, deliberately not on this visibility
// set. An active set is a composition fact about the equipped items: the tier
// fires in game whether or not a cap clamps its contributions, so hiding it
// would misreport what the player is wearing. A craft placement is different
// in kind — it prescribes farming, so a placement whose absence the displayed
// totals cannot distinguish must not be prescribed. Do not "unify" these.
function visibleGateSet(program, prim) {
  const capped = program.cappedStats || {};
  // #325 — floored non-target stats belong in the universe: a z feeding one
  // (directly or as a cross-add source) supports a displayed floor, so it must
  // count as feeding an uncapped tracked stat rather than being judged on its
  // capped siblings alone. (A floored stat that is also capped contributes via
  // the capped path unchanged.)
  // #91 (KTD1) — the Utility sentinel is excluded from the stat universe: it is
  // not a stat, owns no buckets, and must never enter the cap arithmetic.
  const statUniverse = [...new Set([...(program.targetList || []), ...Object.keys(capped),
    ...(program.flooredStats || [])])].filter((s) => s !== _UTILITY_SENTINEL);
  const creditFloors = program.creditBuckets || new Map();
  const visible = new Set();
  const pending = new Map(); // gate -> Map(capped stat -> sum of deferred contributions)
  for (const [key, zs] of program.zByBucket) {
    const floor = creditFloors.get(key);
    let fedCapped = null, feedsUncapped = false;
    for (const z of zs) {
      if (!z.gates.length || prim(z.name) <= 0.5) continue;
      // (a) credit substitution: drop before any cap reasoning.
      if (floor != null && z.value <= floor) continue;
      if (fedCapped === null) { // stats fed are a property of the bucket — compute once
        fedCapped = [];
        for (const s of statUniverse) {
          if (!bucketCountsFor(key, s)) continue;
          if (capped[s] != null) fedCapped.push(s); else feedsUncapped = true;
        }
        if (!fedCapped.length) feedsUncapped = true; // uncapped bucket: short-circuit
      }
      if (feedsUncapped) { for (const g of z.gates) visible.add(g); continue; }
      // (b) defer to the placement-level cap sum test below. #325 — in a
      // credited bucket the removal of this z lets the credit backfill the
      // floor (only strictly-below-floor seating is LP-infeasible), so the
      // displayed total loses z.value − floor, not z.value. Summing the gross
      // value slightly over-reported visibility in the credited∩capped corner.
      for (const g of z.gates) {
        // #626 — the MARGINAL loss, not the gross value: a bucket that falls back
        // to another equipped source loses nothing when this placement goes.
        const net = bucketMarginalOf(zs, z, g, prim, floor);
        let sums = pending.get(g);
        if (!sums) pending.set(g, (sums = new Map()));
        for (const s of fedCapped) sums.set(s, (sums.get(s) || 0) + net);
      }
    }
  }
  if (pending.size) {
    const rawCache = new Map();
    const rawOf = (s) => {
      if (!rawCache.has(s)) rawCache.set(s, rawTotalOf(program, prim, s));
      return rawCache.get(s);
    };
    // #322 set-consistency — judging every gate against the FULL raw lets two
    // placements each individually slack but jointly holding a stat at cap
    // hide each other, leaving the displayed capped total unreachable from the
    // reported build. Greedy fixpoint instead: judge gates in sorted order and
    // deduct each HIDDEN gate's sums from an adjusted raw before judging the
    // next, so the adjusted raw (raw minus all hidden contributions) always
    // still meets every cap.
    const adjustedRaw = new Map(); // stat -> raw minus contributions of gates already ruled hidden
    const adjRawOf = (s) => (adjustedRaw.has(s) ? adjustedRaw.get(s) : rawOf(s));
    for (const g of [...pending.keys()].sort()) {
      if (visible.has(g)) continue;
      const sums = pending.get(g);
      let isVisible = false;
      for (const [s, sum] of sums) {
        // Clamped out only if the displayed total survives losing the whole sum.
        if (adjRawOf(s) - sum < capped[s]) { isVisible = true; break; }
      }
      if (isVisible) { visible.add(g); continue; }
      for (const [s, sum] of sums) adjustedRaw.set(s, adjRawOf(s) - sum);
    }
  }
  return visible;
}

function readSolution(res, program, precomputedVisible) {
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  let chosen = program.xVars.filter((xv) => prim(xv.name) > 0.5).map((xv) => ({ slot: xv.slot, variant: xv.variant, _twinOf: xv.twinOf || null }));
  const effective = {};
  for (const stat of program.targetList) {
    if (stat === _UTILITY_SENTINEL) continue; // #91 (KTD1) — not a stat; the count rides result.utilityCount
    // For a capped stat, the achieved value is min(cap, raw) — NOT the d_ variable.
    // In the optimum solve d_ is maximized so d_ == min(cap, raw), but an alternative
    // relaxes the lock and leaves d_ floating at its lower bound, which would misreport
    // the true (capped) value and invent a phantom cost. min(cap, raw) is right for both.
    effective[stat] = effectiveOf(program, prim, stat);
  }
  // #319/#322 load-bearing guards — on any solve path that does not minimize a
  // family's placement vars (every tieBreak:false alternatives re-solve; the
  // seven craft families even on the optimum path, where only ordinary augments
  // are settled), HiGHS may float a var to 1 for free. A floated placement
  // grants nothing (its gated z stayed 0) — and a FIRED placement can still
  // grant nothing, when its contributions are clamped out by a stat cap or
  // merely substitute for a declared credit. Reporting either would prescribe
  // useless farming and skew the fewer-crafts counting. Report a placement only
  // when a contribution it gates fired AND is visible (visibleGateSet).
  const fired = precomputedVisible || visibleGateSet(program, prim);
  // Ordinary augments: value gates ride on the pu identity var (placeMeta), not
  // the reported per-color p var (augMeta); Σp = pu ties them, and the join key
  // is variant_id (at most one pu per unique-equipped id can be 1).
  const firedAugIds = new Set();
  for (const [pu, meta] of program.placeMeta || []) {
    if (fired.has(pu)) firedAugIds.add(meta.variant_id);
  }
  const augmentsPlaced = [];
  for (const [p, meta] of program.augMeta || []) {
    if (prim(p) > 0.5 && firedAugIds.has(meta.variant_id)) augmentsPlaced.push(meta);
  }
  const setsActive = [];
  for (const [s, meta] of program.setMeta || []) if (prim(s) > 0.5) setsActive.push(meta);
  const dinoPlaced = [];
  for (const [q, meta] of program.dinoMeta || []) if (prim(q) > 0.5 && fired.has(q)) dinoPlaced.push(meta);
  const ncPlaced = [];
  for (const [n, meta] of program.ncMeta || []) if (prim(n) > 0.5 && fired.has(n)) ncPlaced.push(meta);
  const rollPlaced = [];
  for (const [n, meta] of program.rollMeta || []) if (prim(n) > 0.5 && fired.has(n)) rollPlaced.push(meta);
  const vikPlaced = [];
  for (const [n, meta] of program.vikMeta || []) if (prim(n) > 0.5 && fired.has(n)) vikPlaced.push(meta);
  const sealPlaced = [];
  for (const [n, meta] of program.sealMeta || []) if (prim(n) > 0.5 && fired.has(n)) sealPlaced.push(meta);
  const tfPlaced = [];
  for (const [n, meta] of program.tfMeta || []) if (prim(n) > 0.5 && fired.has(n)) tfPlaced.push(meta);
  const gsPlaced = [];
  for (const [n, meta] of program.gsMeta || []) if (prim(n) > 0.5 && fired.has(n)) gsPlaced.push(meta);
  // Essence Crafting picks (#193/#599). Reported per menu so the player can read
  // the Gem as three separate crafts rather than one lump — it is three slots and
  // they are spent independently.
  const essPlaced = [];
  for (const [n, meta] of program.essMeta || []) if (prim(n) > 0.5 && fired.has(n)) essPlaced.push(meta);
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
  // #335 U2 (KTD6) — duplicate-ring twins get the same load-bearing guard, for the
  // same reason. A twin carries a tie-break coefficient by virtue of being an
  // x-var, so the OPTIMUM path already minimizes it — but every alternatives
  // generator re-solves with tieBreak:false, which returns from phase 1 with no
  // minimizing solve, and a twin can then float to 1 for free while consuming the
  // second Ring slot. Report a doubled pick only when one of its ring's sets is
  // actually active; otherwise the second copy buys nothing.
  chosen = chosen.filter((c) => {
    if (!c._twinOf) return true;
    return ((c.variant.set_bonus || []).some((sb) => sb && activeSetNames.has(sb.set)));
  }).map((c) => ({ slot: c.slot, variant: c.variant }));
  // U3 — placed Set Augment copies (each {set, host, slot_color, wiki_url}).
  // Load-bearing guard (mirrors jokers/memberships): the tie-break minimizes y
  // vars on the optimum path, but ALTERNATIVES re-solve with tieBreak:false, so
  // HiGHS may float 1-2 copies to 1 for free whenever spare compatible capacity
  // exists — and a copy below its set's threshold grants NOTHING in-game.
  // Reporting a floated copy would prescribe useless Cauldron farming and show
  // its host's own set suppressed for no benefit, so a set's copies are reported
  // only when enough are placed to fire the tier.
  const setAugmentsPlaced = [];
  const setAugCount = new Map();
  for (const [y, meta] of program.setAugMeta || []) {
    if (prim(y) > 0.5) setAugCount.set(meta.set, (setAugCount.get(meta.set) || 0) + 1);
  }
  // #316 — the consumed color lives on the fired c var, not on y. Push a CLONE
  // carrying slot_color: the meta object is shared across solves (alternatives
  // re-solves reuse the program), so mutating it would leak one solve's color
  // into another's already-returned result.
  const setAugColorByY = new Map();
  for (const [cv, cm] of program.setAugColorMeta || []) {
    if (prim(cv) > 0.5) setAugColorByY.set(cm.y, cm.slot_color);
  }
  for (const [y, meta] of program.setAugMeta || []) {
    if (prim(y) > 0.5 && setAugCount.get(meta.set) >= (meta.pieces_required || 3)) {
      setAugmentsPlaced.push({ ...meta, slot_color: setAugColorByY.get(y) || "Colorless" });
    }
  }
  const out = { chosen, effective, augmentsPlaced, setsActive, dinoPlaced, ncPlaced, rollPlaced, vikPlaced, sealPlaced, tfPlaced, gsPlaced, essPlaced, jokerPlaced, membershipPlaced, setAugmentsPlaced,
    // #449 U1 (KTD9) — the achieved/ceiling census, built HERE rather than in
    // solveLexicographic so the tieBreak:false alternatives path (solveConstrained,
    // which spreads this object) carries its OWN numbers. renderBuild is generic
    // over the optimum and any selected alternative; emitting only on the optimum
    // path would make the fraction vanish the moment a player inspects an
    // alternative — or, worse, invite rendering the optimum's numerator beside
    // the alternative's headline.
    ceilingReport: buildCeilingReport(program, prim) };
  // #91 (U3) — utility effects present in THIS primal, only when the tier is
  // ranked (a tier-removed solve returns the exact pre-feature shape). Load-
  // bearing check (review fix): an effect is present iff ANY backing z in its
  // buckets actually fired — the u primals are NOT consulted. After the utility
  // stage no objective pressures the u vars, so a later primal may satisfy the
  // `>= count` lock with an arbitrary count-sized subset of u's up; reading u
  // would under-report genuinely present effects nondeterministically. The
  // #319 rule (never claim an effect no fired contribution carries) is
  // preserved automatically: a floated u with no fired z still has no fired z,
  // so it stays omitted. The report count is the deterministic truth and MAY
  // exceed the stage-locked count (result.utilityCount is internal-only).
  if (program.utilityEnabled) {
    // #91 (U5, KTD6) — receipt attribution. Each reported effect credits ONE
    // carrier by a deterministic, stated rule (R9): the FIRST carrier in the
    // tie-break's item order — the lowest x-index among equipped items whose
    // fired contribution feeds the effect's bucket. An augment placement has no
    // solver-side host (color capacity is aggregate), so it credits its own
    // variant_id; a craft pick credits the host item its meta names (resolved
    // back to that host's x-index for ordering); a set tier credits the set.
    // Built HERE, in readSolution, so the tieBreak:false alternatives path
    // (solveConstrained) carries the identical guarded report for free.
    // zGates/xIndex depend only on the fixed program, not the primal — memoized
    // on the program so the 30-60 readSolution calls of an alternatives request
    // don't rebuild them (the per-primal equippedIdx stays per-call).
    if (!program._utilityStatic) {
      const zg = new Map();
      for (const [, zs] of program.zByBucket) for (const z of zs) zg.set(z.name, z.gates);
      const xi = new Map();   // x var name -> its position in the tie-break's item order
      program.xVars.forEach((xv, i) => xi.set(xv.name, i));
      program._utilityStatic = { zGates: zg, xIndex: xi };
    }
    const { zGates, xIndex } = program._utilityStatic;
    const equippedIdx = new Map(); // variant_id -> lowest equipped x-index (craft-host resolution)
    program.xVars.forEach((xv, i) => {
      if (prim(xv.name) > 0.5) {
        const id = xv.variant.variant_id || xv.variant.source_item;
        if (!equippedIdx.has(id)) equippedIdx.set(id, i);
      }
    });
    const craftMetas = [program.ncMeta, program.rollMeta, program.vikMeta,
      program.sealMeta, program.tfMeta, program.gsMeta, program.essMeta];
    const carrierOf = (gate) => {
      const xi = xIndex.get(gate);
      if (xi !== undefined) {
        const v = program.xVars[xi].variant;
        return { idx: xi, item: v.variant_id || v.source_item };
      }
      for (const mm of craftMetas) {
        const m = mm && mm.get(gate);
        if (m) return { idx: equippedIdx.has(m.item) ? equippedIdx.get(m.item) : Infinity, item: m.item };
      }
      const aug = program.placeMeta && program.placeMeta.get(gate);
      if (aug) return { idx: Infinity, item: aug.variant_id };
      const dino = program.dinoMeta && program.dinoMeta.get(gate);
      if (dino) return { idx: Infinity, item: dino.name || dino.dino_type };
      const set = program.setMeta && program.setMeta.get(gate);
      if (set) return { idx: Infinity, item: set.set };
      return null;
    };
    const utilityEffects = [];
    const reportEffects = [];
    for (const [, meta] of program.utilityMeta || []) {
      // The z-backed presence predicate (see the block comment above): a
      // backing contribution in the effect's buckets genuinely fired.
      if (!meta.zNames.some((z) => prim(z) > 0.5)) continue;
      utilityEffects.push({ name: meta.name, present: true });
      const candidates = [];
      for (const zn of meta.zNames) {
        if (prim(zn) <= 0.5) continue;
        for (const g of zGates.get(zn) || []) {
          const c = carrierOf(g);
          if (c) candidates.push(c);
        }
      }
      candidates.sort((a, b) => (a.idx - b.idx) || String(a.item).localeCompare(String(b.item)));
      reportEffects.push({ name: meta.name, item: candidates.length ? candidates[0].item : null });
    }
    out.utilityEffects = utilityEffects;
    out.utilityReport = { count: reportEffects.length, effects: reportEffects,
      // #332 — see the program field: the ranked stats this count excludes.
      rankedNotCounted: (program.utilityRankedNotCounted || []).slice() };
  }
  return out;
}

/** Achieved value of `stat` under a set of floor locks (0 if the solve is not
 *  Optimal or the stat has no sources). Computed directly from the primal — not via
 *  readSolution.effective, which only covers priority targets, so a non-priority
 *  floored stat would read undefined. Used by the U2 floor pre-pass. */
/** #345 (U1) — targets that came back zero while the pool can still supply
 *  them. A free rider is excluded by construction: it scored above zero. */
function outbidReportFor(model, targetList, perTarget, floorReport) {
  const reachable = _solverPoolStatNames(model);
  // #345 (U6, R11) — a stat carrying an UNMET floor is a requirement that
  // failed, and the shortfall disclosure already names it with the number it
  // could not reach. Reporting it as outbid too would put two explanations of
  // the same zero in front of the player, one of them the weaker.
  const unmet = new Set((floorReport || []).map((f) => f && f.stat));
  // A target ABSENT from perTarget is unknown, not zero. Claiming it was outbid
  // would be inventing a value the solve never reported — the same class of
  // error as naming an unproven binding priority.
  const scoredZero = (t) => Object.prototype.hasOwnProperty.call(perTarget, t) && Number(perTarget[t]) <= 0;
  return (targetList || []).filter((t) =>
    t !== _UTILITY_SENTINEL && reachable.has(t) && !unmet.has(t) && scoredZero(t));
}

function probeMax(program, highs, stat, locks) {
  const res = highs.solve(encodeStage(program, { objectiveStat: stat, sense: "max", locks }));
  if (res.Status !== "Optimal") return 0;
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  return effectiveOf(program, prim, stat);
}

/** #345 (U2, R2/R6) — which higher-ranked priority bound an outbid target, and
 *  what taking it back would cost. Returns null rather than guessing.
 *
 *  A PREFIX walk, not a leave-one-out. Locks accumulate in rank order and each
 *  one's value was achieved UNDER the locks above it, so relaxing a single lock
 *  while retaining the ones beneath it describes a state the solve never
 *  occupied — and is often infeasible. Instead: probe the target under the first
 *  k locks for increasing k. It holds while k is small and dies once k includes
 *  the lock that binds it. That boundary is the binding priority.
 *
 *  Each added lock only shrinks the feasible set, so reachability is monotone in
 *  k and the boundary is binary-searchable. `linear` forces the exhaustive walk
 *  so a test can prove the two agree rather than assuming monotonicity.
 *
 *  The price is a second probe: with the target floored at 1 and only the locks
 *  ABOVE the boundary held, how high can the binding stat still reach? The
 *  difference from what it actually achieved is what the trade costs. */
function attributeOutbid(program, highs, stat, targetList, perTarget, opts) {
  const higher = [];
  for (const s of targetList || []) {
    if (s === stat) break;
    // The sentinel's lock is an LP body (a count), not a stat lock, so it cannot
    // participate in a prefix of stat locks. A tier-bound target reports as
    // unattributable rather than being blamed on the nearest real stat.
    if (s === _UTILITY_SENTINEL) continue;
    higher.push({ stat: s, value: Number(perTarget[s]) || 0 });
  }
  if (!higher.length) return null;
  const at = (k) => probeMax(program, highs, stat, higher.slice(0, k));
  if (!(at(0) > 0)) return null;              // unreachable even unlocked — a different cause
  if (at(higher.length) > 0) return null;     // these locks did not bind it

  let boundary;
  if (opts && opts.linear) {
    boundary = 1;
    while (boundary <= higher.length && at(boundary) > 0) boundary++;
  } else {
    let lo = 0, hi = higher.length;           // at(lo) > 0, at(hi) === 0
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at(mid) > 0) lo = mid; else hi = mid;
    }
    boundary = hi;
  }
  const binding = higher[boundary - 1];
  const prefix = higher.slice(0, boundary - 1);
  const held = probeMax(program, highs, binding.stat, [...prefix, { stat, value: 1, floor: true }]);
  const cost = binding.value - held;
  // A non-positive cost contradicts the boundary: the target would be free. Do
  // not report a price the solve does not support.
  if (!(cost > 0)) return null;
  return { stat, binding: binding.stat, bindingValue: binding.value, bindingHeld: held, cost };
}

// #481 — how far below its achieved value a concession is searched. Wider than
// `alternativeGive` on purpose: that window has to stay narrow because the
// rebalance path reports whatever vertex it lands on, so a wide window inflates
// the printed price. The concession probe searches over the CAP, so its answer is
// minimal by construction and the window only bounds how far it looks. Binary
// search makes the cost logarithmic in this number, not linear.
function concessionWindow(value) { return Math.max(3, Math.round(0.25 * Math.abs(value))); }

/** #481 — the smallest concession on `stat` that changes anything ranked beneath
 *  it, expressed as the per-stat Max cap the player would set to take it.
 *
 *  The concession is a CAP, not a relaxed stage lock. A relaxed lock describes a
 *  state the player has no input for — they cannot ask the tool for "Strength
 *  within 2 of its max" — while a cap is an input that already exists, so the
 *  probed build is one they can reproduce by typing a number.
 *  `lexicographic-redundancy-is-not-a-bug.md` already ruled the cap is the honest
 *  lever for "enough of this stat": capping does not FORCE the stat down, it stops
 *  valuing it past the cap, and the freed slack falls through to the priorities
 *  below. Searching over the cap also collapses minimality — searching the cap IS
 *  searching the concession, so the answer needs no re-tightening stage.
 *
 *  Monotone, and therefore binary-searchable: a lower cap enlarges the set of
 *  stage-optimal solutions (every solution with raw >= cap attains the stage max),
 *  so each later stage's constraint set relaxes and what is reachable beneath can
 *  only grow. `opts.linear` forces the exhaustive walk so a test can PROVE the two
 *  agree rather than assuming the monotonicity — the same seam, for the same
 *  reason, as `attributeOutbid`.
 *
 *  What comes back is the WHOLE delta vector, gains and losses alike. Per
 *  `lexicographic-descent-bounds-the-vector-not-each-stat.md` read in the relaxing
 *  direction, the first priority beneath that changes must RISE, but ones after it
 *  are then locked against a different (higher) value and can genuinely FALL. A
 *  report carrying only the gain would advertise a trade while hiding its cost.
 *
 *  Returns null rather than guessing: null means "searched the window and nothing
 *  beneath moved", which the caller must keep distinct from "the probe could not
 *  run at all".
 */
/** #554 — what did the set pins COST?
 *
 *  #539 delivers a pinned set and says so, but a player cannot see the trade. In a
 *  synthetic case the cost was Intelligence 18 -> 2; in a real ML 34 query with
 *  four Set Augments pinned it was ZERO. Those two are indistinguishable today,
 *  and the difference is exactly what a player wants before accepting the pin.
 *
 *  The answer is one re-solve without the pins, diffing the ranked targets. Same
 *  shape as `probeConcession` above and the outbid pricing: the model is COPIED,
 *  never mutated, and this runs ON REQUEST rather than on the solve path — a
 *  pinned solve is already the slow arm (~41s for four Set Augments against a
 *  ~6.5s baseline), so pricing must never ride it.
 *
 *  Returns null when there is nothing to price (no pins bound). Otherwise
 *  `{ pins, deltas, free, sol }`, where `deltas` carries EVERY ranked target
 *  whose value moved and `free` says the pins cost nothing measurable. `free` is
 *  a real and common answer, not a failure — reporting it is the point.
 */
async function probeSetPinCost(model, highs, perTarget, opts = {}) {
  const pins = (model.pinnedSets || []).slice();
  if (!pins.length) return null;

  // Drop the pins and re-solve. `setPinReport` goes with them so the relaxed
  // solve carries no stale verdicts, and the escape-hatch retry in
  // solveLexicographic has nothing to fire on.
  const relaxed = await solveLexicographic(
    Object.assign({}, model, { pinnedSets: [], setPinReport: [] }), highs);
  if (!relaxed || relaxed.status !== "optimal") return { pins, deltas: [], free: false, sol: null,
    unavailable: "the build does not solve without the pins, so there is nothing to compare against" };

  const list = (model.targets || []).slice();
  const baseUtility = (opts.utilityCount != null) ? opts.utilityCount : null;
  const valueOf = (sol, s) => (s === _UTILITY_SENTINEL
    ? ((sol.utilityReport && sol.utilityReport.count) != null ? sol.utilityReport.count : null)
    : (sol.effective[s] ?? 0));

  const deltas = [];
  for (const stat of list) {
    const withPins = stat === _UTILITY_SENTINEL
      ? (baseUtility != null ? baseUtility : null)
      : Number(perTarget[stat] ?? 0);
    const without = valueOf(relaxed, stat);
    if (withPins == null || without == null) continue;
    if (Number(without) !== Number(withPins)) {
      deltas.push({ stat, withPins: Number(withPins), without: Number(without),
                    delta: Number(withPins) - Number(without) });
    }
  }
  return { pins, deltas, free: deltas.length === 0, sol: relaxed };
}

async function probeConcession(model, program, highs, stat, targetList, perTarget, opts = {}) {
  const list = targetList || [];
  const at = list.indexOf(stat);
  // Not a stat, not ranked, or nothing ranked beneath it to buy anything with.
  if (stat === _UTILITY_SENTINEL || at === -1 || at === list.length - 1) return null;
  const beneath = list.slice(at + 1);
  if (!beneath.length) return null;

  const base = Number(perTarget[stat]);
  if (!(base > 0)) return null;                 // nothing to concede
  const window = Math.min(concessionWindow(base), base);   // never search below zero
  if (window < 1) return null;

  const baseUtility = (opts.utilityCount != null) ? opts.utilityCount : null;
  // What the solve reports for a ranked entry, sentinel included — the sentinel is
  // not a stat and has no `effective` row, so its count is read from its own report.
  const valueOf = (sol, s) => (s === _UTILITY_SENTINEL
    ? ((sol.utilityReport && sol.utilityReport.count) != null ? sol.utilityReport.count : null)
    : (sol.effective[s] ?? 0));

  // The model is COPIED, never mutated: the search applies a different cap on
  // every step and a leaked cap would silently re-rank every later solve. The
  // dominance pre-filter is keyed to the targets, which do not change here, and a
  // variant dominated uncapped is still dominated capped (min(cap, .) is
  // monotone), so re-solving the already-filtered model stays sound.
  const solveAt = async (d) => {
    const capped = { ...(model.userCaps || {}), [stat]: base - d };
    return solveLexicographic({ ...model, userCaps: capped }, highs);
  };
  const cache = new Map();
  const resultAt = async (d) => {
    if (!cache.has(d)) cache.set(d, await solveAt(d));
    return cache.get(d);
  };
  const changedAt = async (d) => {
    const sol = await resultAt(d);
    if (!sol || sol.status !== "optimal") return false;
    if (baseUtility != null && beneath.includes(_UTILITY_SENTINEL)) {
      const u = valueOf(sol, _UTILITY_SENTINEL);
      if (u != null && u !== baseUtility) return true;
    }
    return beneath.some((s) => s !== _UTILITY_SENTINEL
      && valueOf(sol, s) !== (perTarget[s] ?? 0));
  };

  let found = null;
  if (opts.linear) {
    for (let d = 1; d <= window; d++) if (await changedAt(d)) { found = d; break; }
  } else {
    // changedAt is monotone non-decreasing in d, with changedAt(0) false by
    // construction (capping at the achieved value leaves the stage-optimal set
    // exactly as it was). Probe the far end first so a window that buys nothing
    // costs one solve instead of a full descent.
    if (await changedAt(window)) {
      let lo = 0, hi = window;                  // changedAt(lo) false, changedAt(hi) true
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (await changedAt(mid)) hi = mid; else lo = mid;
      }
      found = hi;
    }
  }
  if (found == null) return null;

  const sol = await resultAt(found);
  const deltas = list.map((s) => {
    const before = s === _UTILITY_SENTINEL ? baseUtility : (perTarget[s] ?? 0);
    const after = valueOf(sol, s);
    return (before == null || after == null) ? null
      : { stat: s, before, after, delta: after - before };
  }).filter(Boolean).filter((d) => d.delta !== 0);

  return { stat, cap: base - found, concession: found, window, deltas, sol };
}

async function solveLexicographic(model, highs, opts = {}) {
  let program = buildProgram(model);
  // #582 — ABANDON-AFTER-STAGE. Opt-in, and silent when nobody opts in.
  //
  // Every `highs.solve` below is SYNCHRONOUS. This function is `async` but has
  // historically contained no `await` at all, so a solve is one uninterrupted
  // block on the main thread: no event can be dispatched while it runs, which is
  // why a Stop button on the overlay could never have been clicked. The yields
  // here are what make the control clickable, not a nicety around it.
  //
  // Cancellation is therefore COOPERATIVE and bounded by one stage: a HiGHS call
  // in flight cannot be preempted, so the promise is "stops after the current
  // pass", never "stops now". The UI says exactly that.
  //
  // The whole seam is gated on `opts.abandon` being supplied. Without it no yield
  // is inserted and no predicate is called, so every existing caller — the golden
  // guard, the perf gate, alternatives, the concession probe — runs the identical
  // synchronous program it ran before, with identical timing. That is deliberate:
  // this is surgery on the most load-bearing function in the repo, and the safest
  // shape is one where not asking for the feature cannot pay for it.
  const abandonAsked = typeof opts.abandon === "function" ? opts.abandon : null;
  /** A stage boundary: yield the task queue so a queued click can land, then ask.
   *  A macrotask, not a microtask — microtasks drain without ever returning to the
   *  event loop, so input would still never be delivered (the same distinction
   *  `tests/wizard-yield.test.js` pins for the paint yield). */
  const stageBreak = async (where) => {
    if (!abandonAsked) return null;
    await new Promise((r) => setTimeout(r, 0));
    if (!abandonAsked()) return null;
    // NOT `status: "infeasible"`. #532 established that a non-optimal result is
    // several different facts and that collapsing them tells the player to go
    // rework a build over something the build never caused. "You stopped this"
    // is its own fact, and nothing about the constraints is implied by it.
    return { status: "abandoned", failure: "abandoned", abandonedAt: where,
      reason: `stopped by the player after ${where}` };
  };
  // #532 — a stage that did not return Optimal is TWO different facts, and the
  // difference is the whole advice the player gets.
  //
  //   Infeasible          no loadout satisfies these constraints. Loosening the
  //                       ML cap, the filters, or the targets is the fix.
  //   anything else       the SOLVER did not solve it — it hit a limit, or the
  //                       program was numerically beyond it (HiGHS reports this
  //                       as `Unknown`). Loosening constraints does nothing,
  //                       because the constraints were never the obstacle.
  //
  // Everything non-Optimal used to collapse into `status: "infeasible"`, so the
  // second case reached the player as "No set satisfies these constraints —
  // loosen the ML cap, armor/class filters, or targets." That sends them to
  // rework a build over a solver limit, and no amount of loosening will help.
  // Found via #532, where a k = 71 utility objective returns `Unknown` and was
  // reported as infeasible.
  //
  // `status` keeps its existing values so every caller that branches on
  // `status === "optimal"` is untouched; `failure` is additive and is what the
  // results view reads to choose its sentence.
  const _stageFailure = (stat, highsStatus) => ({
    status: "infeasible",
    failure: String(highsStatus) === "Infeasible" ? "infeasible" : "solver",
    highsStatus: String(highsStatus),
    reason: String(highsStatus) === "Infeasible"
      ? `stage ${stat}: no solution satisfies the constraints`
      : `stage ${stat}: the solver returned ${highsStatus}`,
  });

  if (!program.xVars.length) {
    return { status: "infeasible", failure: "infeasible", reason: "no eligible items for these constraints" };
  }

  // #539 — the set-pin escape hatch. The model already refused pins the pool
  // cannot supply, but individually-reachable pins can still be JOINTLY
  // impossible: four 3-piece Set Augments need twelve colour slots, and no
  // per-pin check sees that. Left alone it surfaces as a bare INFEASIBLE, which
  // tells the player nothing about which of their inputs to change — the shape
  // `auto-legality-constraints-need-a-pin-conflict-escape-hatch.md` is about.
  //
  // So: probe once with the pins, and if that fails, rebuild WITHOUT them and
  // probe again. If dropping the pins fixes it, the pins were the cause and are
  // named. If it is still infeasible the constraints were over-tight anyway, and
  // the pins are NOT blamed for someone else's problem — they are re-applied so
  // the real infeasibility is what gets reported.
  //
  // One extra solve, on the failure path only.
  let setPinReport = (model.setPinReport || []).slice();
  if (program.setPinsBound.length) {
    const probeStat = program.targetList.find((t) => t !== _UTILITY_SENTINEL) || program.targetList[0];
    const solves = (p) => highs.solve(encodeStage(p, { objectiveStat: probeStat, sense: "max", locks: [] })).Status === "Optimal";
    if (!solves(program)) {
      const relaxed = buildProgram(Object.assign({}, model, { pinnedSets: [], setPinReport: [] }));
      if (relaxed.xVars.length && solves(relaxed)) {
        const conflicted = new Set(program.setPinsBound.map((b) => b.set));
        setPinReport = setPinReport.map((e) => (conflicted.has(e.set) && e.verdict === "pinned"
          ? Object.assign({}, e, { verdict: "conflict",
            why: "these pinned sets cannot all be delivered together — there are not "
              + "enough slots for every piece. Remove one and solve again." })
          : e));
        program = relaxed;
      }
    }
  }

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
    // #91 (KTD1) — the sentinel is never fed to the floors machinery's probe
    // objective (effectiveExpr): use the first REAL ranked stat.
    const probeStat = program.targetList.find((s) => s !== _UTILITY_SENTINEL) || floors[0].stat;
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

  // #91 (U3, KTD1) — the Utility stage's state. `utilityExtra` carries the
  // achieved-count lock as a raw LP body threaded (per-call `extra`, never
  // mutated onto the shared program) into EVERY solve after the sentinel's
  // stage: later ranked stages, the tie-break, the fallback re-max, and both
  // settle stages (KTD5). `>=`, not `=`: the indicators have no downward
  // pressure (u_e ≤ Σz only), so a later solve is free to keep MORE effects
  // but never fewer.
  // #348 (U3, R6/KTD1) — the container is ONE stage with a weighted objective, not
  // a flat count and not one stage per effect. Weight 2^(k-1-i) makes effect i
  // outrank every lower-ordered effect combined, which is what turns a single
  // linear objective into strict lexicographic order over the indicators.
  // Sequential sub-ranking measured 3.94x median / 6.93x worst against a 2.0x
  // budget; this reproduces it exactly at 11.35x lower cost, proven across the 17
  // sentinel-ranking parity fixtures at sizes 4/8/12/16/20 by
  // tests/encoding_equivalence.js.
  const _uOrderVars = program.utilityOrderVars || [];
  // #532 — the weighting above is only lexicographic while the arithmetic that
  // carries it is exact, and IEEE doubles stop being exact well before the
  // solver complains.
  //
  // The property the weights encode is: effect i outranks every lower-ordered
  // effect COMBINED, i.e. 2^(k-1) > sum(2^0 .. 2^(k-2)). That sum is 2^(k-1) - 1,
  // so it holds in exact integers for every k. In doubles it holds up to k = 54
  // and fails from k = 55, where the sum rounds up to the top weight itself and
  // the strict inequality becomes a tie:
  //
  //   k = 54   top 9.007e15   sum 9.007e15   top > sum  -> true
  //   k = 55   top 1.801e16   sum 1.801e16   top > sum  -> FALSE
  //
  // Past that the objective no longer expresses the order the player arranged:
  // the container's #1 effect can be traded for a pile of lower-ranked ones at
  // an equal objective value, which is exactly the failure #348 introduced the
  // per-effect locks to prevent — arriving by a different route, and silently,
  // because HiGHS still returns Optimal.
  //
  // The loud failure is LATER and therefore not the dangerous one: at k = 71
  // (top weight 2^70) HiGHS gives up and returns `Unknown`. That window,
  // k = 55..70, is a wrong answer presented as a right one, so the refusal is
  // placed at the correctness boundary rather than the solvability one.
  //
  // Not reachable by a player today — the stamped counting set is 16 names, so
  // k = 16 — but it is precisely the wall KTD10's widening lever walks into, and
  // an unguarded widening would cross the silent window first. Exclude-until-
  // verified: refuse to answer rather than answer wrongly.
  const LEX_EXACT_MAX = 54;
  if (_uOrderVars.length > LEX_EXACT_MAX) {
    return {
      status: "infeasible",
      failure: "unrepresentable",
      reason: `the Utility container holds ${_uOrderVars.length} effects; ordering is exact only`
        + ` up to ${LEX_EXACT_MAX} (see #532)`,
    };
  }
  const utilityObjTerms = _uOrderVars.map((o, i) =>
    ({ coef: Math.pow(2, _uOrderVars.length - 1 - i), name: o.u }));
  // The weighted objective spans 2^0..2^(k-1) — at k=20 that is a range of ~5.2e5,
  // and HiGHS's default relative MIP gap would admit an absolute error larger than
  // the lowest-ordered weights, i.e. it could stop on a solution that is wrong in
  // exactly the effects the player ranked last. The gate measured no drift at k<=20,
  // so this is a reasoned precaution against the weight span rather than a fix for
  // an observed failure — cheap, and the failure it prevents is silent.
  const UTILITY_STAGE_OPTS = { mip_rel_gap: 0, mip_abs_gap: 0 };
  const utilityExtra = [];
  let utilityCount = null;
  // #348 (U3/R14) — ordered receipts: what the container secured, and what it did
  // not, each in container order with the reason it was missed.
  const utilitySecured = [];
  const utilityUnsecured = [];

  // #582 — the first boundary a player can reach: the set-pin escape probe and the
  // best-effort floors machinery above can each spend several solves before the
  // ranked stages begin.
  {
    const stop = await stageBreak("the pre-stage probes");
    if (stop) return stop;
  }

  let _stageNo = 0;
  for (const stat of program.targetList) {
    // #582 — one boundary per ranked stage. This is what bounds the wait: the
    // worst case a player sees after pressing Stop is the remainder of the pass
    // already in flight. Counted rather than read off `perTarget`, because the
    // sentinel's stage writes no entry there and would make two passes share a
    // number.
    _stageNo += 1;
    const stop = await stageBreak(`priority pass ${_stageNo}`);
    if (stop) return stop;
    if (stat === _UTILITY_SENTINEL) {
      // The Utility stage: maximize the distinct-effect count (Σ u_e) under
      // the locks accumulated so far. Stats ranked BELOW the sentinel still
      // get their stages after this one, solved with the count lock active —
      // that ordering is exactly what dragging the tier means (R2).
      const res = highs.solve(
        encodeStage(program, { objTerms: utilityObjTerms, sense: "max", locks, extra: utilityExtra }),
        UTILITY_STAGE_OPTS);
      if (res.Status !== "Optimal") return _stageFailure("utility", res.Status);
      const uprim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
      // The achieved count, read from the primal by the BACKING z vars (an
      // effect is present iff a contribution in its buckets fired) — at this
      // stage's optimum Σu equals this count, since the objective pulls every
      // ceilinged u_e up.
      // #348 (U2/R15) — one lock body per SECURED effect, never one summed count.
      // A count floor (`Σu >= count`, what shipped through #91) is satisfied by ANY
      // equal-size set, so every solve after this stage — the tie-break, both settle
      // stages, the colorless post-stage — was free to trade a secured effect for a
      // different one at the same total. Reproduced on a synthetic two-slot model:
      // the stage secured {Blunt Trauma, Ghost Touch} and the returned loadout
      // carried {Feather Falling, Ghost Touch}. Harmless while the tier was a flat
      // count; fatal once the player orders the container, because the effect traded
      // away can be the one they ranked first.
      //
      // KTD2 — the secured set is read z-backed and guarded (a contribution in the
      // effect's buckets actually fired), never from the u primal. The indicator is
      // ceilinged `u_e − Σz ≤ 0`, so `u_e >= 1` forces a real carrier rather than
      // merely floating the indicator.
      // Walked in CONTAINER ORDER, not indicator-mint order, so the receipts read
      // the way the player arranged them (R14) and the locks are a prefix-shaped
      // structure U4 can slice.
      for (const o of _uOrderVars) {
        const meta = program.utilityMeta.get(o.u);
        if (meta && meta.zNames.some((z) => uprim(z) > 0.5)) {
          utilitySecured.push(o.name);
          utilityExtra.push(`${o.u} >= 1`);
        } else {
          utilityUnsecured.push({ name: o.name, reason: "outbid" });
        }
      }
      // Nothing in the eligible pool carries these at all — a different fact from
      // losing the slot to a ranked stat, and one the player can act on differently
      // (there is no gear to farm).
      for (const name of program.utilityUnreachable || []) {
        utilityUnsecured.push({ name, reason: "unreachable" });
      }
      utilityCount = utilitySecured.length;
      continue;
    }
    const res = highs.solve(encodeStage(program, { objectiveStat: stat, sense: "max", locks, extra: utilityExtra }));
    if (res.Status !== "Optimal") return _stageFailure(stat, res.Status);
    // #326 — only this stage's achieved value is needed; effectiveOf reads it
    // without paying readSolution's placement-array + visibility construction.
    const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
    const val = effectiveOf(program, prim, stat);
    perTarget[stat] = val;
    locks.push({ stat, value: val });
  }

  // #348 (U5, R14/KTD5) — PRICE THE TOP MISS. Exactly one probe, for the
  // highest-ordered effect the container could not secure. Cost matters here: this
  // runs on every solve, so the budget is one MILP and no more.
  //
  // Only an `outbid` effect is priced. `unreachable` means no eligible variant
  // carries it under this query at all — there is no price to find, and probing it
  // would spend a full solve to learn nothing.
  //
  // The measurement (user-directed, 2026-08-18): the minimum give on PRIORITY 1.
  // Maximizing priority 1 subject to the effect being secured IS that minimum — no
  // slack variable needed, and one solve rather than the ranked chain. Lower
  // priorities are left free, so the number is a lower bound on the true cost and
  // the wording downstream must not present it as the whole bill.
  //
  // Effects ordered ABOVE the priced one keep their locks; everything below is
  // freed. Freeing everything would price "secure X having abandoned the rest of
  // the container", which is not the question the player is asking; locking
  // everything would price a trade the ordering says they should not want.
  let utilityPrice = null;
  const _priceRanked = program.targetList.filter((t) => t !== _UTILITY_SENTINEL);
  if (program.utilityEnabled && _priceRanked.length && utilityUnsecured.length) {
    const target = utilityUnsecured.find((u) => u.reason === "outbid");
    const ov = program.utilityOrderVars || [];
    const idx = target ? ov.findIndex((o) => o.name === target.name) : -1;
    if (target && idx >= 0) {
      const keepAbove = ov.slice(0, idx)
        .filter((o) => utilitySecured.includes(o.name))
        .map((o) => `${o.u} >= 1`);
      const stat = _priceRanked[0];
      const res = highs.solve(encodeStage(program, {
        objectiveStat: stat, sense: "max", locks: [],
        extra: keepAbove.concat([`${ov[idx].u} >= 1`]),
      }));
      if (res.Status === "Optimal") {
        const pp = (n) => (res.Columns[n] ? res.Columns[n].Primal : 0);
        const give = Math.max(0, (perTarget[stat] ?? 0) - effectiveOf(program, pp, stat));
        // Measured across the 17 sentinel-ranking parity fixtures: 6 priced, 7 zero,
        // 4 infeasible. A zero is NOT "free" — the container solves last, so an
        // unsecured effect is always blocked by something; a zero says only that the
        // block is not on priority 1. Rendering it as "costs 0 Strength" would tell a
        // player the effect is free and leave them wondering why it is not equipped,
        // so the three cases are distinguished HERE and worded separately downstream.
        utilityPrice = { name: target.name, stat, give, free: give === 0 };
      } else {
        // A carrier exists (an indicator was minted, so this is `outbid`, not
        // `unreachable`) but no solution secures it. With no ranked locks applied,
        // the only remaining constraints are structural (slots, conflicts) and the
        // locks on higher-ordered container effects — so when nothing is locked
        // above, the block is purely structural. Knowing which costs no extra solve.
        utilityPrice = { name: target.name, stat, give: null, infeasible: true,
          blockedByHigherOrder: keepAbove.length > 0 };
      }
    }
  }

  // #582 — the last boundary. Everything past here (tie-break, the no-op augment
  // drop, the colorless post-stage, readSolution and the report builders) is the
  // assembly tail; stopping inside it would throw away work that is already paid
  // for, so this is the final chance to bow out.
  {
    const stop = await stageBreak("the ranked passes");
    if (stop) return stop;
  }

  const tb = highs.solve(encodeStage(program, { sense: "min", tieBreak: true, locks, extra: utilityExtra }));
  // #91 (KTD1) — the tie-break fallback's objectiveStat must never be the
  // sentinel: re-max the LAST non-sentinel target, or — when the sentinel is
  // the only entry — re-max the utility objective itself.
  const tbFallback = () => {
    const lastStat = [...program.targetList].reverse().find((s) => s !== _UTILITY_SENTINEL);
    return lastStat != null
      ? highs.solve(encodeStage(program, { objectiveStat: lastStat, sense: "max", locks, extra: utilityExtra }))
      // #349 — the ONE other place the weighted utility objective is solved, and
      // it was running at HiGHS defaults. Same reasoning as UTILITY_STAGE_OPTS
      // above: this objective spans 2^0..2^(k-1), so a relative gap admits an
      // error larger than the lowest-ordered weight and the solve can be wrong in
      // exactly the effects the player ranked last. That was a precaution while
      // the roster was 20; the gate now measures non-zero unpinned drift from
      // k=26, which is this batch's size, so the pin is load-bearing here too.
      : highs.solve(encodeStage(program, { objTerms: utilityObjTerms, sense: "max", locks, extra: utilityExtra }),
                    UTILITY_STAGE_OPTS);
  };
  const tbRes = tb.Status === "Optimal" ? tb : tbFallback();
  const finalRes = preferColorlessSetAugments(
    program, highs, dropNoOpAugments(program, highs, tbRes, locks, utilityExtra), locks, utilityExtra);
  const prim = (name) => (finalRes.Columns[name] ? finalRes.Columns[name].Primal : 0);
  const visible = visibleGateSet(program, prim);
  const sol = readSolution(finalRes, program, visible);

  return {
    status: "optimal", perTarget, effective: sol.effective, chosen: sol.chosen,
    outbidReport: outbidReportFor(model, program.targetList, perTarget, floorReport),
    // #91 (U3) — present only when the tier is ranked: the achieved distinct-
    // effect count (a plain number, locked into every post-stage solve) and
    // the load-bearing-checked effect list (U5 builds the full report).
    ...(program.utilityEnabled
      ? { utilityCount, utilityEffects: sol.utilityEffects || [],
          // #348 (U3/R14) — the ordered secured/unsecured split. Plain JSON so
          // persist.js can keep it under RESULT_KEEP and a restored character
          // renders it without re-solving.
          utilityOrdered: { secured: utilitySecured.slice(), unsecured: utilityUnsecured.slice(),
            // #348 (U5) — the priced top miss, or null when nothing was outbid.
            price: utilityPrice },
          // #91 (U5, KTD6) — the render/persist report: count + per-effect
          // credited carriers, guarded and deterministic (built in readSolution).
          utilityReport: sol.utilityReport || { count: 0, effects: [] } } : {}),
    augmentsPlaced: sol.augmentsPlaced, setsActive: sol.setsActive,
    dinoPlaced: sol.dinoPlaced, ncPlaced: sol.ncPlaced, rollPlaced: sol.rollPlaced,
    vikPlaced: sol.vikPlaced, sealPlaced: sol.sealPlaced, jokerPlaced: sol.jokerPlaced,
    tfPlaced: sol.tfPlaced, gsPlaced: sol.gsPlaced, essPlaced: sol.essPlaced,
    // #193/#599 — stamped whenever the solve COULD craft, not only when it did.
    // A Gem that was offered 25 options and took none is exactly the player who
    // should be told the menu was short, and a build that crafted nothing still
    // has to disclose what it was choosing from.
    essenceReport: essenceReportFor(model, sol.essPlaced),
    membershipPlaced: sol.membershipPlaced, setAugmentsPlaced: sol.setAugmentsPlaced,
    breakdown: breakdownByTarget(program, prim, visible), computeScale: computeScale(program),
    capped: { ...program.cappedStats }, intrinsicCaps: { ...(program.intrinsicCaps || {}) }, floorReport, program,
    // #539 — every set pin's verdict, including the suppressed and conflicting
    // ones. Plain JSON so persist.js can keep it under RESULT_KEEP: a restored
    // character must still be able to say why a pin did not land, without
    // re-solving. Empty array when the player pinned nothing.
    setPinReport,
    creditReport: buildCreditReport(program, prim, model, floorReport, visible),
    // #88 U8 (R13/R14/R30) — what the player's bonus-type overrides did. Plain
    // JSON by construction so persist.js can keep it under RESULT_KEEP: a restored
    // character must disclose the asserted types without re-solving, because
    // `program` is dropped on save and KTD6 forbids re-solving on load.
    overrideReport: buildOverrideReport(program, prim, model, visible),
    saturationReport: buildSaturationReport(program, prim),
    // #449 U1 (KTD9) — built in readSolution so alternative candidates carry it
    // too; this return picks fields off `sol` by name rather than spreading it,
    // so the optimum needs the explicit hand-off or the census would reach only
    // the candidates shown by the upgrades search.
    ceilingReport: sol.ceilingReport,
    emptySlots: buildEmptySlotReport(model, sol),
    absorptionQuarantine: buildAbsorptionQuarantineReport(model, program),
    // #110 (U7) — the blocklist attribution, computed at model-build time (the
    // pre-dominance pool it compares against no longer exists here) and carried
    // as plain JSON so a restored character discloses without re-solving.
    blockReport: model.blockReport || [],
    // #246 — the ownership filter's own report, carried like the blocklist's so a
    // RESTORED snapshot discloses the narrowing without re-solving. A shared build
    // that silently omitted it would claim a full-roster optimum it never had.
    // Carried like every other narrowing, and for the reason #595 made expensive: a
    // disclosure that lives only on the live result renders once and goes silent on
    // reload, so a restored build claims a full-roster optimum it never had.
    setFilter: model.excludedSets
      ? { sets: model.excludedSets, excluded: (model.setExcluded || []).length }
      : null,
    packFilter: model.ownedPacks
      ? { owned: model.ownedPacks, excluded: (model.packExcluded || []).length,
          uncheckable: model.packUncheckable || 0,
          packsExcluded: [...new Set((model.packExcluded || [])
            .map((v) => v.location_pack).filter(Boolean))].sort() }
      : null,
  };
}

/** #88 U8 — the override disclosure, in two halves that answer two questions.
 *
 *  `inForce` is what the overlay applied for this solve, read off the query — the
 *  REPORT the overlay returned, never the player's saved declaration (KTD6). It is
 *  what qualifies the optimality claim (R14): the proof is about a model built
 *  from an overridden catalog, so it is qualified whenever one was in force,
 *  whether or not the overridden item won its slot. (#416 is open on the narrower
 *  reading; this is the conservative one — it can only over-disclose.)
 *
 *  `contributions` is the subset that actually reached the loadout, resolved the
 *  way buildCreditReport resolves credits: `overrideMeta` maps a z name back to
 *  the override behind it, because a z entry otherwise carries a value and its
 *  gates and nothing that identifies the affix. Those are what R13 labels and R16
 *  makes name both types.
 *
 *  Returns null when no override was in force, so every consumer can treat the
 *  absent key and a pre-feature save identically. */
function buildOverrideReport(program, prim, model, precomputedVisible) {
  const inForce = ((model && model.query && model.query.overrides) || []).slice();
  const meta = (program && program.overrideMeta) || new Map();
  const contributions = [];
  if (meta.size) {
    // #322 — a placement the report guards deliberately omit (fired, but hidden
    // because it was cap-clamped or credit-substituted) is not a contribution any
    // surface names. `hiddenPlacementGateFn` is shared precisely so the reports
    // cannot disagree about which placements they endorse; a report that fired
    // but is invisible everywhere else would be the only place a player sees it.
    const hiddenPlacementGate = hiddenPlacementGateFn(program,
      precomputedVisible || visibleGateSet(program, prim));
    for (const [, zs] of program.zByBucket) {
      for (const z of zs) {
        if (!meta.has(z.name)) continue;
        if (prim(z.name) <= 0.5) continue;
        if ((z.gates || []).some(hiddenPlacementGate)) continue;
        const m = meta.get(z.name);
        contributions.push({ stat: m.stat, from: m.from, to: m.to, host: m.host || null, value: z.value });
      }
    }
  }
  if (!inForce.length && !contributions.length) return null;
  // Sorted, so two exports of the same build compare byte-for-byte regardless of
  // the order the player declared their overrides in.
  contributions.sort((a, b) => (a.stat + a.to + (a.host || "")).localeCompare(b.stat + b.to + (b.host || "")));
  return { inForce, contributions };
}

/** U6/#249 — compound-absorption affixes the build excluded from this pool.
 *
 *  `Elemental Absorption` names four elements on some items and five on others,
 *  behind an identical visible cell. A carrier the wiki shard does not confirm
 *  has its affix REMOVED at build time rather than left in place, because
 *  registering the family strips the compound name from the picker dataset-wide
 *  — an unexpanded carrier would ship an affix no player can rank.
 *
 *  The exclusion is decided in Python against the seed shard, and neither this
 *  file nor `web/model.js` receives dataset metadata, so the build stamps it on
 *  the variant (the way `material` is stamped) and this reads it back. Built
 *  here rather than at render time for the reason `saturationReport` is:
 *  `model` is dropped from the saved snapshot and a restored character is never
 *  re-solved, so a render-time derivation would go quiet on load.
 *
 *  Gated on the ranked stats, following the saturation report's KTD3: a
 *  disclosure that fires regardless of what the player asked for is noise, and
 *  noise is how a real disclosure stops being read. `components` is what the
 *  compound COULD have become — a fact about the name, not a claim about the
 *  item, which is exactly why an unconfirmed carrier can be matched against the
 *  priority list at all.
 *
 *  Reads the whole worn POOL, not `chosen`: an excluded affix is why an item may
 *  not have been chosen, so reporting only chosen items would hide every case
 *  the disclosure exists for.
 */
function buildAbsorptionQuarantineReport(model, program) {
  const worn = (model && model.worn) || [];
  const ranked = new Set((program && program.targetList) || []);
  if (!worn.length || !ranked.size) return [];

  const out = [];
  const seen = new Set();
  for (const s of worn) {
    for (const v of s.variants || []) {
      for (const q of (v && v.absorption_quarantined) || []) {
        const components = (q.components || []).slice();
        if (!components.some((c) => ranked.has(c))) continue;
        const item = v.variant_id || v.source_item || null;
        // One excluded affix is one disclosure, however many slots could host
        // the item — the two ring slots offer the same variant twice.
        const key = `${item}||${q.stat}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ item, stat: q.stat, reason: q.reason, components });
      }
    }
  }
  // Deterministic, so a re-solve of the same pool discloses in the same order.
  out.sort((a, b) => String(a.item).localeCompare(String(b.item))
    || String(a.stat).localeCompare(String(b.stat)));
  return out;
}

/** #239 — the worn slots the solve left empty.
 *
 *  Corrects the premise this feature was planned on. A short priority list does
 *  NOT produce slots of arbitrary tie-broken gear: `chosen` carries only slots
 *  where an item actually contributes, so the rest come back EMPTY. A single
 *  `Kinetic Lore` priority at ML 34 fills 3 of 14. What a player is looking at
 *  is a nearly bare character sheet, which is what "no other force lore stuff"
 *  in the originating report was describing.
 *
 *  Slots the player locked empty are excluded — they chose that, and reporting
 *  it back as "nothing could improve your priorities" would be wrong as well as
 *  patronising.
 *
 *  Built here rather than in projection because it needs `model.worn`, and
 *  `model` is dropped from the saved snapshot; a restored character must
 *  disclose identically without re-solving.
 */
function buildEmptySlotReport(model, sol) {
  const worn = (model && model.worn) || [];
  // #110 (U8/KTD3) — slots the player's blocks emptied never reach `worn` at
  // all, so they ride the model's capture rather than this loop. Reported under
  // their own key: "you emptied this" and "nothing here helps" are different
  // sentences, and the player-locked-empty precedent already establishes that a
  // slot the player chose to empty is not an ordinary gap.
  const blockedSlots = (model && model.blockEmptiedSlots) || [];
  if (!worn.length) return { count: 0, slots: [], blockedSlots };
  const filled = new Set((sol.chosen || []).map((c) => c.slot));
  const constraints = (model.query && model.query.slotConstraints) || {};
  const slots = [];
  for (const s of worn) {
    if (filled.has(s.slot)) continue;
    if (constraints[s.slot] && constraints[s.slot].type === "empty") continue;
    slots.push(s.slot);
  }
  return { count: slots.length, slots, blockedSlots };
}

/** #239 U1 / #449 U1 — the per-target-stat census, in ONE pass: what the build
 *  holds in each ranked stat, and what its bonus-type buckets could have supplied.
 *
 *  Reads `program.zByBucket`, which already IS the census: the solver builds it
 *  only for target stats, keyed `${stat}||${equivType(type)}`, holding every
 *  candidate contribution in the LIVE pool with its gates and value. There is no
 *  second traversal of the pool here and there must not be — a parallel notion of
 *  "the pool" is free to drift from the one the solve actually used. Two reports
 *  are projected off this one pass rather than walking it twice.
 *
 *  Rows are internal: `total` (Σ taken) and `ceiling` (Σ best) are both RAW, so
 *  the notice's projection can stay byte-identical while the display's clamps to
 *  the stat's cap (KTD7). `sawBucket` is not carried — `bonusTypes.length > 0` is
 *  it, since a label is pushed exactly once per counted bucket.
 *
 *  KTD8 — `_UTILITY_SENTINEL` is a member of `targetList` but is not a stat, and
 *  a census row for it would render 0 / 0 with a NaN meter. Skipped explicitly,
 *  matching every other per-stat loop in this file.
 */
function buildCeilingCensus(program, prim) {
  const zByBucket = (program && program.zByBucket) || new Map();
  const forcedOff = (program && program.forcedOffVars) || new Set();
  const penaltyBuckets = (program && program.penaltyKeys) || new Set();
  const reachable = (z) => !(z.gates || []).some((g) => forcedOff.has(g));
  const out = [];

  for (const stat of (program && program.targetList) || []) {
    if (stat === _UTILITY_SENTINEL) continue; // #91 (KTD1) — not a stat; no per-stat parts
    const bonusTypes = [];
    let unusedSources = 0, total = 0, ceiling = 0, allFilled = true;

    // U2 (#290/#291) — a target's census spans its own buckets plus its
    // cross-add source stats' (bucketCountsFor), the same reach every other
    // prefix site has: an unused USP source is an unused source FOR the element.
    for (const [key, zs] of zByBucket) {
      if (!bucketCountsFor(key, stat)) continue;
      const live = zs.filter(reachable);
      if (!live.length) continue;

      // #645 — a PENALTY bucket contributes to `total` and to NOTHING
      // else. Every other line in this loop assumes a bucket is an opportunity,
      // and all three assumptions invert on a negative:
      //   `ceiling += best` would SUBTRACT the least-bad penalty from an upper
      //     bound, and an upper bound below the achieved value is not one. This
      //     shipped: a build reading 37 Intelligence against a ceiling of 36,
      //     because one avoidable -1 curse sat in the pool.
      //   `unusedSources` would count a curse the solver correctly declined as a
      //     source left on the table, inflating the saturation notice's headroom
      //     with gear no player wants.
      //   `bonusTypes` would list "Penalty" among a stat's bonus types, and
      //     `bonusTypes.length > 0` is this census's sawBucket flag, so a stat
      //     whose ONLY bucket is a penalty would report as a real row.
      // `total` is the exception because it is the achieved value, and a worn
      // penalty IS achieved — dropping it here would put the card's numerator
      // out of step with the headline the player reads beside it.
      // Summed, not assigned: penalty buckets carry no `Sigma z <= 1` (they are
      // forced ON with their host, #614), so several can be live at once.
      if (penaltyBuckets.has(key)) {
        for (const z of live) if (prim(z.name) > 0.5) total += z.value;
        continue;
      }

      let best = -Infinity, taken = 0;
      for (const z of live) {
        if (z.value > best) best = z.value;
        // A bucket caps at one contributor, so at most one z is on.
        if (prim(z.name) > 0.5) taken = z.value;
      }
      if (taken < best) allFilled = false;
      total += taken;
      ceiling += best;  // finite: the bucket was skipped above unless it holds a live z
      unusedSources += live.filter((z) => prim(z.name) <= 0.5).length;

      // The absent-bonus-type bucket keys as the string "null" (equivType returns
      // the type unchanged, and it is null). Render it as a word — a player must
      // never be shown the literal "null" as a bonus type.
      const type = key.split("||")[1];
      bonusTypes.push(type === "null" || type === "undefined" ? "untyped" : type);
    }

    out.push({ stat, total, ceiling, bonusTypes, unusedSources, allFilled });
  }
  return out;
}

/** #239 U1 — which ranked stats are at their ceiling with sources left over.
 *
 *  The projection the saturation NOTICE reads: the census subset satisfying the
 *  KTD3 gate, in the exact field shape and order every existing consumer already
 *  parses. Its firing condition has not moved and must not — see KTD3 below.
 *
 *  Plain JSON, built here rather than at render time for the same reason
 *  `creditReport` is: `program` is dropped from the saved snapshot, and a
 *  restored character is never re-solved, so a render-time computation would go
 *  quiet on load.
 *
 *  KTD3 — a stat is only reported when the pool still holds UNUSED sources for
 *  it. Priority 1 is at its global maximum on every solve, so an ungated report
 *  would fire constantly; the informative case is the one that generates the
 *  complaint, where other gear carrying the stat went unused because it would
 *  have shared a filled bucket. `buildCeilingReport` is deliberately ungated
 *  because it reports a fact rather than raising an alarm; this one is not.
 *
 *  KTD6 — facts only. No cause is attributed: the pool is the product of the ML
 *  band, the gear pool, the character gates AND the dominance pre-filter, and
 *  this cannot tell which one removed a source. Naming the ML band was already
 *  wrong once for an ML-29 item well inside a cap of 34.
 */
function buildSaturationReport(program, prim) {
  return buildCeilingCensus(program, prim)
    // `bonusTypes.length > 0` IS the old `sawBucket`: no bucket counted, no label.
    .filter((r) => r.bonusTypes.length > 0 && r.allFilled && r.unusedSources > 0)
    .map((r) => ({ stat: r.stat, total: r.total, bonusTypes: r.bonusTypes.slice(),
      unusedSources: r.unusedSources }));
}

/** #449 U1 — the achieved/ceiling fraction's source: one row per target stat,
 *  saturated or not, so a ranked-priority card can state what it holds against
 *  what its buckets could supply.
 *
 *  Plain JSON at solve time for the same reason `saturationReport` is (see above),
 *  and emitted from `readSolution` so every solve path — the optimum AND each
 *  alternatives re-solve — carries its OWN numbers. A card rendered for a selected
 *  alternative must never show the optimum's numerator beside the alternative's
 *  headline.
 *
 *  KTD7 — both sides are clamped to the stat's cap. The card's headline is
 *  `effectiveOf` = min(cap, raw), and the card already carries a capNote reading
 *  "capped at N · raw M"; an unclamped fraction would state a third total for one
 *  stat and advertise headroom the player cannot hold. The clamp is why this
 *  report and `saturationReport` can legitimately disagree on a capped stat —
 *  the latter is held byte-identical and stays raw.
 *
 *  `ceiling` is an UPPER BOUND, not a reachable target (KTD2): Σ best sums each
 *  bucket's best source independently, and those sources may be one item, may
 *  compete for one slot, or may contradict a chosen set. Nothing downstream may
 *  assert that the remainder is attainable.
 */
function buildCeilingReport(program, prim) {
  const capped = (program && program.cappedStats) || {};
  return buildCeilingCensus(program, prim).map((r) => {
    const cap = capped[r.stat];
    const clamp = (v) => (cap != null ? Math.min(cap, v) : v);
    return { stat: r.stat, achieved: clamp(r.total), ceiling: clamp(r.ceiling),
      bonusTypes: r.bonusTypes.slice(), unusedSources: r.unusedSources, allFilled: r.allFilled };
  });
}

/** U4 (R9, R10) — what each declared credit did, as plain JSON on the result.
 *
 *  Deliberately DATA, not a render-time read. Both facts the notice needs — the
 *  gear-only shortfall behind a floor and the best gear value the credit beat —
 *  live in `program.zByBucket`, and `program` is excluded from the saved snapshot
 *  as cyclic and non-JSON. KTD6 forbids re-solving a restored character, so a
 *  notice computed at render time would simply vanish on load, taking the honesty
 *  surface R9 exists to guarantee with it.
 *
 *  Per entry: the declaration, whether it won its bucket, the best eligible gear
 *  it beat (null when gear won or there was none), the floor it carried (null when
 *  gear alone already cleared it), and what gear alone reaches in that stat.
 */
function buildCreditReport(program, prim, model, floorReport, precomputedVisible) {
  const credits = (program && program.creditMeta) ? [...program.creditMeta.values()] : [];
  if (!credits.length) return [];
  const unmet = new Set((floorReport || []).map((f) => f.stat));
  const floors = (model && model.floors) || {};
  const forcedOff = program.forcedOffVars || new Set();
  const reachable = (z) => !(z.gates || []).some((g) => forcedOff.has(g));
  // #325 — the same substitution rule the breakdown applies: a seated placement
  // the report guards hide is not part of the endorsed build, so the credit —
  // not gear — supplies its bucket's floor. Production passes readSolution's
  // visible set; the 4-arg test seam computes it here.
  const visible = precomputedVisible || visibleGateSet(program, prim);
  const hiddenPlacementGate = hiddenPlacementGateFn(program, visible);
  const hiddenSeated = (z) => prim(z.name) > 0.5 && (z.gates || []).some(hiddenPlacementGate);

  return credits.map((c) => {
    const key = `${c.stat}||${_equivType(c.bonus_type)}`;
    const zs = program.zByBucket.get(key) || [];
    // R10 (narrowed per A3): the best gear in the credit's own bucket that this
    // build could actually field. A contribution gated on a slot the player locked
    // empty is not "available" to them, and naming it would be flatly false.
    let bestGearInBucket = 0;
    for (const z of zs) {
      if (program.creditMeta.has(z.name)) continue;
      if (!reachable(z)) continue;
      if (z.value > bestGearInBucket) bestGearInBucket = z.value;
    }
    const creditZ = zs.find((z) => program.creditMeta.get(z.name) === c);
    // #325 — the credit also "wins" when the bucket's seated non-credit z is a
    // hidden placement: the endorsed build omits that craft, the credit
    // backfills the floor, and the breakdown shows the declared part there.
    const won = (!!creditZ && prim(creditZ.name) > 0.5)
      || zs.some((z) => !program.creditMeta.has(z.name) && hiddenSeated(z));

    // What the GEAR IN THIS LOADOUT supplies for the stat: the selected non-credit
    // contribution in each of its buckets.
    //
    // This is deliberately NOT "what your gear alone would reach". That is a
    // counterfactual, and A3 forbids the second solve it would require. An earlier
    // cut approximated it by substituting the credit's bucket with its best gear
    // while reading every other bucket off the credit-enabled loadout, which was
    // wrong twice over: it mixed contributions that compete for one slot (adding a
    // 6 and a 5 the player cannot wear together), and it ignored that a credit-free
    // solve is free to pick different items entirely — a model where it reported
    // "gear alone reaches 5" actually reached 12 without the credit. A number that
    // describes the shown loadout is one the data supports; the counterfactual is not.
    let gearInLoadout = 0;
    for (const [k, list] of program.zByBucket) {
      // U2 (#290/#291) — the loadout's gear for a stat includes its cross-add
      // source buckets (bucketCountsFor), matching what the headline total counts.
      if (!bucketCountsFor(k, c.stat)) continue;
      let best = 0;
      for (const z of list) {
        if (program.creditMeta.has(z.name)) continue;
        // #325 — a hidden seated placement is not the endorsed build's gear.
        if (hiddenSeated(z)) continue;
        if (prim(z.name) > 0.5 && z.value > best) best = z.value;
      }
      gearInLoadout += best;
    }

    // A floor is ATTRIBUTED to the credit when the credit is counted in a floored
    // stat's total — not inferred to have been NECESSARY, which needs the solve A3
    // forbids. An unmet floor is disclosed by floorReport instead.
    const floor = Number(floors[c.stat]) || null;
    const countedTowardFloor = (floor && !unmet.has(c.stat) && won) ? floor : null;

    return {
      stat: c.stat, bonus_type: c.bonus_type, value: c.value,
      won, beatGear: (won && bestGearInBucket > 0) ? bestGearInBucket : null,
      floor: countedTowardFloor, gearInLoadout,
    };
  });
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
function solveConstrained(program, highs, { objectiveStat, objTerms, sense = "max", locks = [], extra = [], tieBreak = true, reTighten = null }) {
  const fb = program.xVars[0].name;
  // Phase 1: optimize the gain under the relaxed/forced constraints.
  const r1 = highs.solve(encodeStage(program, { objectiveStat, objTerms, sense, locks, extra }));
  if (r1.Status !== "Optimal") return { status: "infeasible" };

  // #480 — `reTighten`: after the gain is maximized, pin it and re-maximize the
  // stat the caller relaxed to buy it. Without this the relaxed stat is
  // unconstrained anywhere inside its give window among the solutions attaining
  // the gain, so the cost the caller reports is an incidental vertex rather than
  // the MINIMUM concession that buys it — a rebalance card read `-2 Strength`
  // while a `-1 Strength` build delivering the identical gain sat in the pool.
  //
  // This is an APPENDED LEXICOGRAPHIC STAGE, not a tie-break term and not a
  // member of the pinned post-stage chain (`CONCEPTS.md`, "Lexicographic
  // solve"). It is allowed to change which items are chosen — that is the whole
  // point — whereas a post-stage pins the loadout first and frees only the
  // variables its own preference is about. Do not fold it into either:
  // `add-a-solver-preference-as-a-pinned-post-stage.md` records what appending a
  // term to the shared tie-break objective cost last time (5 of 11 golden
  // loadouts reshuffled).
  let rGain = r1, gainLocks = locks;
  if (reTighten && objectiveStat && program.targetList.includes(objectiveStat)) {
    const prim0 = (name) => (r1.Columns[name] ? r1.Columns[name].Primal : 0);
    const pinned = [...locks, { stat: objectiveStat, value: effectiveOf(program, prim0, objectiveStat) }];
    const rT = highs.solve(encodeStage(program, { objectiveStat: reTighten, sense: "max", locks: pinned, extra }));
    // Infeasible cannot happen (r1's own solution satisfies the pin), but a
    // non-Optimal status is treated as "no re-tighten" rather than as a failure:
    // the phase-1 answer is still a legal trade, just not a minimal one.
    if (rT.Status === "Optimal") {
      rGain = rT;
      const primT = (name) => (rT.Columns[name] ? rT.Columns[name].Primal : 0);
      gainLocks = [...pinned, { stat: reTighten, value: effectiveOf(program, primT, reTighten) }];
    }
  }

  // The tie-break is a second full solve. It canonicalizes the build among equal-objective
  // vertices, but HiGHS is already deterministic for identical input, so the optimum path
  // keeps it (stable display) while on-demand alternatives skip it to halve solve count.
  if (!tieBreak) {
    const primG = (name) => (rGain.Columns[name] ? rGain.Columns[name].Primal : 0);
    const visibleG = visibleGateSet(program, primG);
    return { status: "optimal", ...readSolution(rGain, program, visibleG), breakdown: breakdownByTarget(program, primG, visibleG), capped: { ...program.cappedStats }, intrinsicCaps: { ...(program.intrinsicCaps || {}) } };
  }
  const prim1 = (name) => (rGain.Columns[name] ? rGain.Columns[name].Primal : 0);
  // Pin the achieved gain, then tie-break so the item set (not just the objective
  // value) is deterministic — mirroring solveLexicographic's final tie-break stage.
  let locks2 = gainLocks, pin = [];
  if (objTerms) {
    const gainVal = Math.round(objTerms.reduce((s, t) => s + t.coef * prim1(t.name), 0));
    pin = [`${fmtExpr(objTerms, fb)} = ${gainVal}`];
  } else {
    // #326 — effectiveOf replaces a full readSolution for one number. The
    // targetList guard preserves the prior domain exactly: readSolution's
    // effective covered only priority targets, so an unranked objective read
    // undefined and pinned at 0.
    const gainVal = program.targetList.includes(objectiveStat)
      ? effectiveOf(program, prim1, objectiveStat) : 0;
    locks2 = [...gainLocks, { stat: objectiveStat, value: gainVal }];
  }
  const r2 = highs.solve(encodeStage(program, { tieBreak: true, sense: "min", locks: locks2, extra: [...extra, ...pin] }));
  const res = r2.Status === "Optimal" ? r2 : rGain;
  const prim = (name) => (res.Columns[name] ? res.Columns[name].Primal : 0);
  const visible = visibleGateSet(program, prim);
  const sol = readSolution(res, program, visible);
  return { status: "optimal", ...sol, breakdown: breakdownByTarget(program, prim, visible), capped: { ...program.cappedStats }, intrinsicCaps: { ...(program.intrinsicCaps || {}) } };
}

/** #193/#599 — what the Essence Crafting menus offered and what was taken.
 *
 *  Present only when a host with `essence_slots` was actually a candidate, so a
 *  solve that never saw a Gem carries no report and renders no notice. Reads the
 *  dataset-stamped coverage rather than recomputing, because the numbers are a
 *  property of the BUILD (what was harvested) and not of this solve.
 */
function essenceReportFor(model, placed) {
  const hosts = [];
  for (const w of model.worn || []) {
    for (const v of w.variants || []) {
      if (v && (v.essence_slots || []).length) hosts.push(v);
    }
  }
  if (!hosts.length) return null;
  const cov = model.essenceCoverage || null;
  // #611 — every ML below is the level the build assumes the host is CRAFTED at,
  // never its printed one. The two differ whenever the cap is under the host's
  // own ML, and the difference is load-bearing twice over: it is the level whose
  // curve supplied the values, and it decides the Insight gate. Crafting a
  // Legendary Gem down to ML 8 to fit an ML-8 character costs it every Insight
  // effect, and a report reading the printed ML 30 would say the opposite.
  const _cap = Number(_mlCapOf(model));
  const craftedOf = (h) => {
    const n = Number(h.ml);
    return Number.isFinite(_cap) ? Math.min(n, _cap) : n;
  };
  const craftedDown = hosts
    .filter((h) => Number.isFinite(craftedOf(h)) && craftedOf(h) < Number(h.ml))
    .map((h) => ({ item: h.variant_id || h.source_item, nativeMl: Number(h.ml),
                   craftedMl: craftedOf(h) }));
  const minMl = Math.min(...hosts.map(craftedOf).filter(Number.isFinite));
  return {
    hosts: hosts.length,
    // The hosts this build can only use by crafting them BELOW their printed ML.
    // Empty on every solve whose cap clears its hosts, so the notice stays silent
    // in the ordinary case rather than explaining something that did not happen.
    craftedDown,
    placed: (placed || []).map((p) => ({ item: p.item, menu: p.menu, effect: p.effect,
                                         stat: p.stat, bonus_type: p.bonus_type, value: p.value })),
    offered: cov ? cov.offered_all : null,
    total: cov ? cov.total_all : null,
    insightMinMl: cov ? cov.insight_min_ml : null,
    // True when EVERY host is below the Insight gate, which is the heroic Gem's
    // situation and the reason its Extra menu looks empty.
    insightGated: cov && Number.isFinite(minMl) ? minMl < (cov.insight_min_ml || 10) : false,
  };
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
  const targets = program.targetList;              // ranked priorities, in order (may include the Utility sentinel)
  const per = optimum.perTarget || optimum.effective;
  // #91 (U7, KTD7) — the Utility sentinel is not a stat. It is excluded from
  // every generic family's target iteration AND from all four lock-construction
  // sites explicitly (a sentinel lock renders to empty terms and encodeStage
  // silently skips it — relying on that would hide the bug, not fix it).
  // Instead, each generic family threads the KTD1 count lock (give-relaxed,
  // see utilityLock below; via the per-call `extra` channel — never mutated
  // onto the shared program) into its re-solves whenever the sentinel ranks at
  // or above the positions that family's lock idiom protects, so a set/craft/
  // unranked trade can never silently shed a ranked-above utility effect.
  const sentinelIdx = targets.indexOf(_UTILITY_SENTINEL);
  const ranked = targets.filter((s) => s !== _UTILITY_SENTINEL);
  // Review fix — the baseline is the optimum's GUARDED report count (the number
  // the card/exports display), never the internal stage utilityCount: the two
  // can differ (the report is z-backed and deterministic; the stage count is a
  // lock-time value), and both the count lock and the more-utility family's
  // strict-gain claim must be measured against what the player actually sees.
  const optUtilityCount = program.utilityEnabled
    ? (optimum.utilityReport ? optimum.utilityReport.count
      : (optimum.utilityCount != null ? optimum.utilityCount : null))
    : null;
  // The count lock body against a given program's indicator vars (the unranked
  // family re-builds its program, so the u-var names must come from THAT build;
  // minting is name-sorted, so the names line up build-to-build). `>=`, not `=`:
  // indicators have no downward pressure, so more effects stay legal.
  // Review fix — the lock behaves like a RANKED STAT, not an ultra-priority:
  // exact (`>= baseline`) only when the sentinel is ranked FIRST (position 0);
  // otherwise the floor relaxes by alternativeGive, mirroring how ranked stats
  // are relaxed, so a legal trade that sheds a couple of effects can surface
  // (its loss is stated by alternatives.js cost accounting, never silent).
  // #348 (U4, R16/KTD6) — TAIL-ONLY shedding. The count floor this replaces let a
  // candidate shed a higher-ordered effect to gain two lower ones, which is exactly
  // what an ordered container forbids. The allowance is now expressed as a PREFIX of
  // per-effect locks: everything above the shed depth is pinned, the tail is free.
  // Same constraint class as U2's optimum-path locks, just a shorter prefix.
  //
  // Small containers: with two secured effects, alternativeGive is 2, so the whole
  // container is tail and a candidate may shed all of it. That is R16-compliant —
  // nothing is kept BELOW something shed — and the cost line names every effect
  // given up, so the trade is stated rather than silent. Recorded here because it
  // reads like an oversight and is not one.
  const optSecured = (optimum.utilityOrdered && optimum.utilityOrdered.secured) || [];
  const shedDepth = sentinelIdx === 0 ? 0 : alternativeGive(optSecured.length);
  const mustKeep = optSecured.slice(0, Math.max(0, optSecured.length - shedDepth));
  const utilityLock = (prog) => {
    if (!(prog.utilityEnabled && mustKeep.length)) return [];
    const uByName = new Map((prog.utilityOrderVars || []).map((o) => [o.name, o.u]));
    // The unranked family REBUILDS its program, so the u names must come from THAT
    // build; resolving by effect name rather than by var index is what makes the
    // lock survive a rebuild.
    return mustKeep.map((n) => uByName.get(n)).filter(Boolean).map((u) => `${u} >= 1`);
  };
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
  const setLocks = ranked.map((s) => ({ stat: s, value: per[s], give: setGive(per[s]) }));
  // Locks all targets → the count lock always rides when the tier is ranked.
  const setExtra = sentinelIdx !== -1 ? utilityLock(program) : [];
  // With the sentinel ranked FIRST the top priority to maximize is the first
  // real stat; with the sentinel as the ONLY entry, maximize the count itself.
  const setObjective = ranked.length
    ? { objectiveStat: ranked[0] }
    : { objTerms: (program.utilityVars || []).map((u) => ({ coef: 1, name: u })) };
  const seenSets = new Set();
  let sCount = 0, sTries = 0;
  for (const [setVar, meta] of program.setMeta || []) {
    if (sCount >= cap.sets || sTries >= cap.sets * 3) break;   // bound both hits and infeasible probes
    if (active.has(meta.set) || seenSets.has(meta.set)) continue;
    seenSets.add(meta.set);
    sTries++;
    const sol = solveConstrained(program, highs, { ...setObjective, locks: setLocks, extra: [`${setVar} = 1`, ...setExtra], tieBreak: false });
    if (sol.status === "optimal" && !sameChosen(sol, optimum)) { out.push({ sol, gainAxis: "set", meta: { set: meta.set } }); sCount++; }
  }

  // (b) rebalance — relax ONLY the higher priority being traded from (by its give),
  // keep the priorities ABOVE the maximized one pinned at optimum, and maximize a
  // lower priority (which must be left unlocked so it can rise). Bounded: the pair
  // space is C(n,2), so with many targets it is capped to keep generation interactive.
  let rCount = 0;
  outer:
  for (let i = 0; i < targets.length; i++) {
    if (targets[i] === _UTILITY_SENTINEL) continue;            // #91 (KTD7) — not a stat, never a pair member
    for (let j = i + 1; j < targets.length; j++) {
      if (targets[j] === _UTILITY_SENTINEL) continue;          // #91 (KTD7)
      if (rCount >= cap.rebalance) break outer;
      rCount++;
      const locks = targets.slice(0, j)
        .filter((s) => s !== _UTILITY_SENTINEL)                // #91 (KTD7) — no sentinel lock entry
        .map((s) => (s === targets[i]
          ? { stat: s, value: per[s], give: alternativeGive(per[s]) }
          : { stat: s, value: per[s] }));
      // This idiom locks the positions before the maximized stat, so the count
      // lock rides exactly when the sentinel ranks before targets[j]; a tier
      // ranked BELOW the maximized stat is fair game to re-rank, matching what
      // the lexicographic order means.
      const rebExtra = (sentinelIdx !== -1 && sentinelIdx < j) ? utilityLock(program) : [];
      // #480 — `reTighten` re-maximizes the traded-FROM priority once the gain is
      // pinned, so the card states the MINIMUM concession that buys it. Without
      // it targets[i] floats anywhere inside its give window and the printed cost
      // overstates the price by an arbitrary amount — the direction that kills a
      // trade the player would have taken.
      const sol = solveConstrained(program, highs, { objectiveStat: targets[j], locks, extra: rebExtra, tieBreak: false, reTighten: targets[i] });
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
  const originalExact = ranked.map((s) => ({ stat: s, value: per[s] }));   // #91 (KTD7) — no sentinel lock entry
  for (const u of unrankedCandidates) {
    const p2 = buildProgram({ ...model, targets: [...model.targets, u] });
    if (!p2.xVars.length) continue;
    // Locks all ranked targets → the count lock always rides when the tier is
    // ranked. Built against p2's OWN indicator vars (this family re-builds the
    // program; sorted minting keeps the names aligned with the count).
    const unrExtra = sentinelIdx !== -1 ? utilityLock(p2) : [];
    let sol = solveConstrained(p2, highs, { objectiveStat: u, locks: originalExact, extra: unrExtra, tieBreak: false });
    let zeroCost = true;
    if (sol.status === "optimal" && sameChosen(sol, optimum) && ranked.length) {
      zeroCost = false;
      const relaxLowest = originalExact.map((l, k) => (k === originalExact.length - 1 ? { ...l, give: alternativeGive(l.value) } : l));
      sol = solveConstrained(p2, highs, { objectiveStat: u, locks: relaxLowest, extra: unrExtra, tieBreak: false });
    }
    if (sol.status === "optimal" && !sameChosen(sol, optimum)) out.push({ sol, gainAxis: "unranked", meta: { stat: u, zeroCost } });
  }

  // (d) fewer-crafts — minimize the sum of craft-placement binaries, allowing a bounded
  // give on the priorities (only when the optimum actually uses crafts).
  // #321 — the seven grindable craft families count as crafting steps here and in
  // alternatives.js craftCount (the four sites move in lockstep). Deliberately
  // excluded as intended, not pending: roll groups (they select which random roll
  // a drop carries) and set-membership picks (a build-identity choice, not a
  // per-item grind step).
  const craftVars = [
    ...(program.augMeta ? program.augMeta.keys() : []), ...(program.dinoMeta ? program.dinoMeta.keys() : []),
    ...(program.ncMeta ? program.ncMeta.keys() : []), ...(program.vikMeta ? program.vikMeta.keys() : []),
    ...(program.sealMeta ? program.sealMeta.keys() : []), ...(program.tfMeta ? program.tfMeta.keys() : []),
    ...(program.gsMeta ? program.gsMeta.keys() : []),
    ...(program.essMeta ? program.essMeta.keys() : []),
  ];
  const optCrafts = (optimum.augmentsPlaced || []).length + (optimum.dinoPlaced || []).length
    + (optimum.ncPlaced || []).length + (optimum.vikPlaced || []).length + (optimum.sealPlaced || []).length
    + (optimum.tfPlaced || []).length + (optimum.gsPlaced || []).length
    + (optimum.essPlaced || []).length;
  if (craftVars.length && optCrafts > 0) {
    const relaxedAll = ranked.map((s) => ({ stat: s, value: per[s], give: alternativeGive(per[s]) }));   // #91 (KTD7) — no sentinel lock entry
    // Locks all targets → the count lock always rides when the tier is ranked
    // (a "fewer crafts" build that drops the counted effect's only carrier
    // would silently shed what the player ranked for).
    const craftExtra = sentinelIdx !== -1 ? utilityLock(program) : [];
    const objTerms = craftVars.map((name) => ({ coef: 1, name }));
    const sol = solveConstrained(program, highs, { objTerms, sense: "min", locks: relaxedAll, extra: craftExtra, tieBreak: false });
    const solCrafts = sol.status === "optimal"
      ? (sol.augmentsPlaced || []).length + (sol.dinoPlaced || []).length
        + (sol.ncPlaced || []).length + (sol.vikPlaced || []).length + (sol.sealPlaced || []).length
        + (sol.tfPlaced || []).length + (sol.gsPlaced || []).length
        + (sol.essPlaced || []).length
      : optCrafts;
    // Only surface when it genuinely uses fewer crafts (a same-count different build
    // would headline "0 fewer crafting steps").
    if (sol.status === "optimal" && !sameChosen(sol, optimum) && solCrafts < optCrafts) out.push({ sol, gainAxis: "crafts", meta: { optCrafts } });
  }

  // #348 (U4, KTD7) — the `more-utility` family (#91 U7/R11) is DELETED, not
  // redefined. With the container pinned last and solved lexicographically under
  // ranked-exact locks, its result is already lexicographically maximal at those
  // values, so the family's zero-cost probe could never strictly win; every
  // candidate it could surface costs a ranked stat. That trade is better stated
  // than offered, so R14's disclosure prices the top miss instead (U5). The tier
  // now appears in Alternatives only as a named cost.

  return out;
}

if (typeof module !== "undefined" && module.exports) {
  // readSolution is exported for TESTS ONLY — the deterministic guard tests
  // inject a synthetic primal (#319); app code goes through the solve entry points.
  module.exports = { buildProgram, encodeStage, effectiveExpr, rawExpr, bucketCountsFor, solveLexicographic, solveConstrained, generateAlternatives, alternativeGive, sameChosen, scaleAt, breakdownByTarget, readSolution, DECLARED_LABEL, computeScale, slotConstraintBodies, forcedOffSlotVars, rawTotalOf, effectiveOf, buildCreditReport, buildOverrideReport, outbidReportFor, attributeOutbid, probeConcession, probeSetPinCost, concessionWindow };
}
