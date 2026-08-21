// #88 U1/U2 — player bonus-type overrides: identity, eligibility, the match
// ladder, and the re-appliable overlay. Pure, dual-exported for Node tests.
// Namespaced global `Overrides`. Mirrors the no-DOM shape of weapon-taxonomy.js.
//
// An override is a player assertion that one affix on one item carries a
// different bonus type in game than the catalog recorded. It changes which
// `stat||type` bucket the affix contributes to; it never changes its value.
//
// Three things here are load-bearing and were each proven necessary before they
// were written:
//
//  - Eligibility is a POSITIVE classification, not a `via` presence test. The
//    provenance key has two producers (dataset.js expansions and
//    src/dr_qualifiers.py retype receipts), and the boolean-composite expansion
//    is deliberately unstamped — 161 generated affixes that would otherwise pass
//    as engraved.
//  - `applyOverrides` WITHDRAWS BEFORE MATCHING. The identity key includes the
//    recorded type and apply overwrites that type, so matching an already-stamped
//    pool finds nothing and reports a live override as unmatched. The pool stays
//    correct either way, so only the report catches it.
//  - The eligibility cache is NOT named `eligible`. `src/verify.py` already
//    writes that field on every affix in the dataset as the solver-eligibility
//    gate; reusing the name would overwrite it or read `true` for everything.
(function () {
  "use strict";

  // The stamp carrying the catalog's own type while an override is applied. This
  // is the ONLY route back — normalizeDataset mutates the fetched dataset in
  // place and nothing retains a pristine copy, so withdrawal reads this.
  // Deliberately not the expansion provenance key: the export layer groups by
  // that one, and folding overrides into expansion groups would corrupt both.
  var OVERRIDE_FROM = "override_from";
  // Non-enumerable so classification never widens what gets serialized into a
  // saved character or an export.
  var ELIGIBLE_CACHE = "_overrideEligible";
  // Written by dataset.js's composite expansion onto each affix it generates.
  var COMPOSITE_MARK = "_compositeOf";

  var INELIGIBLE_TYPES = { Bool: 1, Penalty: 1, "-": 1 };

  // Resolved per call, not captured at script-eval time. Capturing would bind to
  // whatever `window.DatasetNormalizer` happened to be when this file's script tag
  // ran: correct today, but a load-order change would leave it null forever, the
  // spec table empty, and all 161 composite components silently ELIGIBLE — in the
  // browser only, where no Node test can see it. Mirrors model.js's `_taxonomy()`.
  function _datasetModule() {
    if (typeof window !== "undefined" && window.DatasetNormalizer) return window.DatasetNormalizer;
    // eslint-disable-next-line global-require
    if (typeof require !== "undefined") { try { return require("./dataset.js"); } catch (e) { /* absent */ } }
    return null;
  }

  function compositeComponents() {
    var d = _datasetModule();
    return (d && d.COMPOSITE_COMPONENTS) || {};
  }

  function sameValue(a, b) {
    return String(a) === String(b);
  }

  /** Is this affix one the load pipeline generated from a boolean composite?
   *  Positive test: the variant carries a composite carrier, and this affix
   *  matches one of that carrier's component specs exactly. Those arrive
   *  unstamped on purpose (the expansion is additive, not replacing), so a
   *  provenance test cannot see them. */
  function isCompositeComponent(affix, variant) {
    if (!affix) return false;
    // The generator marks what it generated (dataset.js), so provenance is RECORDED
    // rather than inferred. The spec match below stays as a fallback for a pool
    // normalized by older code, but it is inference: an item that ENGRAVES a
    // component at exactly the spec's type and value is skipped by the generator
    // (`if (stated.has(c.name)) continue;`) yet still matches the spec. Zero such
    // collisions today, but Cloak of Sunlight already engraves Healing Amplification
    // beside a Crown of Summer carrier — only its type and value keep it eligible.
    if (affix[COMPOSITE_MARK] != null) return true;
    if (!variant) return false;
    var specs = compositeComponents();
    var affixes = variant.affixes || [];
    for (var i = 0; i < affixes.length; i++) {
      var comps = affixes[i] && specs[affixes[i].name];
      if (!comps) continue;
      for (var j = 0; j < comps.length; j++) {
        var c = comps[j];
        if (c.name === affix.name && c.type === affix.type && sameValue(c.value, affix.value)) return true;
      }
    }
    return false;
  }

  /** The five ineligible classes, in the order they are cheapest to test.
   *  `variant` is optional only for an affix already classified by
   *  `classifyPool`; without it the composite class cannot be seen. */
  function isEligible(affix, variant) {
    if (!affix) return false;
    if (Object.prototype.hasOwnProperty.call(affix, ELIGIBLE_CACHE)) return affix[ELIGIBLE_CACHE];
    return computeEligible(affix, variant);
  }

  function computeEligible(affix, variant) {
    if (!affix) return false;
    // 4 — an ABSENT type key. The explicit `Untyped` token stays eligible:
    // equivType (#235) keeps the two in separate buckets because real untyped
    // bonuses stack, and folding them once turned a legitimate sum into a max.
    if (affix.type == null) return false;
    // 1-3 — presence semantics, sign-preserving penalties, and the DR bypass
    // qualifier occupying the type field.
    if (INELIGIBLE_TYPES[affix.type]) return false;
    // 5 — generated by the load pipeline rather than engraved by the item.
    if (affix.via != null) return false;
    if (isCompositeComponent(affix, variant)) return false;
    return true;
  }

  /** Classify every affix in the pool once, caching non-enumerably. KTD4: this
   *  runs per pool load, because the composite class only exists after
   *  normalizeDataset has generated it. */
  function classifyPool(pool) {
    var items = (pool && pool.items) || [];
    for (var i = 0; i < items.length; i++) {
      var v = items[i], affixes = v.affixes || [];
      for (var j = 0; j < affixes.length; j++) {
        Object.defineProperty(affixes[j], ELIGIBLE_CACHE, {
          value: computeEligible(affixes[j], v),
          enumerable: false, configurable: true, writable: true,
        });
      }
    }
    return pool;
  }

  /** The affixes on this variant a player may override. */
  function eligibleAffixes(variant) {
    return (variant && variant.affixes || []).filter(function (a) { return isEligible(a, variant); });
  }

  /** The override's identity: variant, affix name, the type it was written
   *  against, and the value. Four fields, because 130 variants carry two
   *  eligible affixes sharing name and type — and the 52 that also share the
   *  value are genuinely indistinguishable and retype together (R2). */
  function overrideKey(variant, affix) {
    return {
      variant_id: variant && (variant.variant_id || variant.source_item),
      name: affix && affix.name,
      from: affix && affix.type,
      value: affix && String(affix.value),
    };
  }

  /** Is this a complete override declaration? Four things must be present: a
   *  target (an item variant, or a crafted pool entry addressed by its pool key —
   *  U6), the affix name, the type it was written against, and the replacement.
   *  The value may be any scalar, including 0, so it is tested for presence
   *  rather than truthiness — a required-field guard written as a truthiness test
   *  cannot express a legitimately-falsy value.
   *
   *  Used at the load boundary, where a hand-edited backup can carry entries no
   *  reader could act on: dropped there they are gone, kept they would render as
   *  ghost rows and re-persist on every save. */
  function isWellFormed(o) {
    if (!o || typeof o !== "object") return false;
    var target = (typeof o.variant_id === "string" && o.variant_id)
      || (typeof o.pool_key === "string" && o.pool_key);
    if (!target) return false;
    if (typeof o.name !== "string" || !o.name) return false;
    if (typeof o.from !== "string" || !o.from) return false;
    if (typeof o.to !== "string" || !o.to) return false;
    return o.value != null;
  }

  function variantOf(pool, variantId) {
    var items = (pool && pool.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].variant_id === variantId || items[i].source_item === variantId) return items[i];
    }
    return null;
  }

  /** Every affix on the override's variant matching all four key fields.
   *  Returns [] when the variant or the affix is gone. */
  function matchAffixes(pool, override) {
    var v = variantOf(pool, override && override.variant_id);
    if (!v) return [];
    return (v.affixes || []).filter(function (a) {
      return a.name === override.name
        && a.type === override.from
        && sameValue(a.value, override.value);
    });
  }

  /** KTD8's ladder. An exact four-field match cannot express the lifecycle,
   *  because every non-active branch is defined by one of those fields having
   *  changed — so drift, satisfaction, and a retired target would all collapse
   *  into "no match" while R35 gives them opposite action sets. */
  function resolveMatch(pool, override) {
    var v = variantOf(pool, override && override.variant_id);
    if (!v) return { state: "suspended", reason: "retired-target", affixes: [] };

    var byName = (v.affixes || []).filter(function (a) {
      return a.name === override.name && sameValue(a.value, override.value);
    });
    if (!byName.length) return { state: "suspended", reason: "retired-target", affixes: [] };

    // Read the CATALOG type, never the live one. applyOverrides deliberately leaves
    // the pool stamped — that is the steady state every solve, browse, and export
    // reads — so keying the ladder on `a.type` made a live override resolve
    // `satisfied`, i.e. "the catalog adopted this, drop it", about an override that
    // was actively doing the work. Reading through the stamp makes the ladder
    // independent of whether the pool is currently applied.
    var pick = byName;
    var atRecorded = pick.filter(function (a) { return catalogTypeOrLive(a) === override.from; });
    if (atRecorded.length) {
      if (!atRecorded.every(function (a) { return isEligible(a, v); })) {
        return { state: "suspended", reason: "ineligible", affixes: atRecorded };
      }
      return { state: "active", reason: null, affixes: atRecorded };
    }

    var atReplacement = pick.filter(function (a) { return catalogTypeOrLive(a) === override.to; });
    if (atReplacement.length) return { state: "satisfied", reason: null, affixes: atReplacement };

    return { state: "suspended", reason: "drift", affixes: pick, now: pick[0] && catalogTypeOrLive(pick[0]) };
  }

  /** The catalog's own type for an affix an override is currently applied to,
   *  or undefined when none is. */
  function catalogTypeOf(affix) {
    return affix ? affix[OVERRIDE_FROM] : undefined;
  }

  /** The catalog's type, falling back to the live type when unstamped. This is what
   *  the ladder reads so its answer does not change with the pool's applied state. */
  function catalogTypeOrLive(affix) {
    if (!affix) return undefined;
    return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : affix.type;
  }

  /** Remove every applied override, restoring each affix's catalog type. */
  function withdrawOverrides(pool) {
    var items = (pool && pool.items) || [];
    for (var i = 0; i < items.length; i++) {
      var affixes = items[i].affixes || [];
      for (var j = 0; j < affixes.length; j++) {
        var a = affixes[j];
        if (a[OVERRIDE_FROM] == null) continue;
        a.type = a[OVERRIDE_FROM];
        delete a[OVERRIDE_FROM];
      }
    }
    return pool;
  }

  /** Apply the overrides in force over the loaded pool.
   *
   *  Withdraws first, ALWAYS. Matching keys on the recorded type and applying
   *  overwrites it, so a second apply over a stamped pool would match nothing
   *  and report every live override as unmatched — with the pool still correct,
   *  so nothing that inspects pool state can catch it. Withdraw-then-match also
   *  makes the result independent of the order overrides were added in.
   *
   *  Returns the report the disclosure and export layers read (KTD6): what
   *  actually applied, never the caller's input list. */
  function applyOverrides(pool, overrides) {
    withdrawOverrides(pool);
    var applied = [], unmatched = [], ineligible = [];
    var list = overrides || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      // Exclude affixes an EARLIER override in this same pass already stamped.
      // Without this, two individually-legal overrides chain: A retypes X->Y, then
      // B (from: Y) matches the affix A just changed, captures it, and overwrites
      // the stamp with A's replacement instead of the catalog's type. Withdraw then
      // restores the wrong type permanently, since nothing keeps a pristine copy.
      // Reproduced on `Artemist's Aegis (level 5)`, whose Fortitude Save 4 exists
      // under both Resistance and Insight; 35 variants can produce the collision.
      // The withdraw-first call above guarantees zero stamps on entry, so this
      // filter only ever removes affixes this same pass just retyped.
      var hits = matchAffixes(pool, o).filter(function (a) { return a[OVERRIDE_FROM] == null; });
      if (!hits.length) { unmatched.push(o); continue; }
      var v = variantOf(pool, o.variant_id);
      if (!hits.every(function (a) { return isEligible(a, v); })) { ineligible.push(o); continue; }
      for (var j = 0; j < hits.length; j++) {
        // Non-enumerable, for the same reason as ELIGIBLE_CACHE: solver.js hands out
        // LIVE pool variant references, `chosen` is on persist.js's RESULT_KEEP, and
        // saveCharacter JSON.stringifies the record — so a plain assignment would
        // persist this stamp into every character saved while an override is applied,
        // undeclared and with no override list to explain it. `delete` still works on
        // a configurable property, and catalogTypeOf reads it by direct access.
        Object.defineProperty(hits[j], OVERRIDE_FROM, {
          value: hits[j].type, enumerable: false, configurable: true, writable: true,
        });
        hits[j].type = o.to;
      }
      applied.push({ variant_id: o.variant_id, name: o.name, from: o.from, to: o.to, count: hits.length });
    }
    return { applied: applied, unmatched: unmatched, ineligible: ineligible };
  }

  var api = {
    OVERRIDE_FROM, ELIGIBLE_CACHE,
    isEligible, classifyPool, eligibleAffixes, isCompositeComponent,
    overrideKey, isWellFormed, matchAffixes, resolveMatch, catalogTypeOrLive,
    applyOverrides, withdrawOverrides, catalogTypeOf,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Overrides = api;
})();
