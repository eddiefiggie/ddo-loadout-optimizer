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

  // ---- U6: the crafted pools -------------------------------------------------
  //
  // Crafted options are not item affixes. They live in seven sibling channels on
  // the dataset, they use `bonus_type` where an item affix uses `type`, and no
  // pool entry carries a name that is both present and unique — all 48 `seal` and
  // all 68 `nearly_complete` rows carry none. So an override on one is addressed
  // by a COMPOSED key: the channel, the entry's own discriminators, and then the
  // same stat/type/value triple an item override records.
  //
  // Type and value are in the key on purpose. Without them, `Gloom /
  // equipment/accessories / Charisma` is one key naming three genuinely different
  // offerings — Enhancement 15, Insight 7, and Quality 3 — and retyping one would
  // retype occurrences the player never selected. With them, the remaining
  // collisions are byte-identical duplicate rows, which R2 says retype together.
  //
  // Six channels are arrays. The seventh is structurally different: a dict keyed
  // by host item name, so its rows are host-scoped and their keys carry the host.
  var POOL_CHANNELS = [
    { channel: "seal", multi: false, disc: function (e) { return [e.seal_type, e.domain]; } },
    { channel: "thunder_forged", multi: false, disc: function (e) { return [e.tier]; } },
    { channel: "green_steel", multi: false, disc: function (e) { return [e.tier_key]; } },
    { channel: "nearly_complete", multi: true, disc: function (e) { return [e.category, e.tier]; } },
    { channel: "viktranium", multi: true, disc: function (e) { return [e.slot_type, e.category, e.tier]; } },
    { channel: "dino_inserts", multi: true, disc: function (e) { return [e.category, e.dino_type]; } },
  ];
  var PER_ITEM_CHANNEL = "nearly_complete_per_item";

  /** A crafted row records its type as `bonus_type`; an item affix records it as
   *  `type`. One accessor pair, so no caller has to know which it is holding. */
  function typeKeyOf(affix) {
    // `type` wins when both are present. In the built dataset they never are —
    // 0 of 42,088 item affixes carry `bonus_type` and 0 crafted rows carry `type`
    // — but a test fixture writing both is not exotic, and the solver reads `.type`
    // for a worn affix. Preferring `bonus_type` there wrote the override into a
    // field nothing reads: the overlay reported success, the pool looked changed,
    // and the solve was untouched.
    if (affix && Object.prototype.hasOwnProperty.call(affix, "type")) return "type";
    return (affix && Object.prototype.hasOwnProperty.call(affix, "bonus_type")) ? "bonus_type" : "type";
  }
  function readType(affix) { return affix ? affix[typeKeyOf(affix)] : undefined; }

  /** The composed key. `type` is passed in rather than read off the row, because
   *  every caller that identifies an override needs the CATALOG's type — which is
   *  the stamp when one is applied, exactly as `catalogTypeOrLive` does for items.
   *  Reading the live type here would make an applied override stop matching its
   *  own declaration, the same defect review found in the item ladder. */
  function keyOf(channel, parts, affix, type) {
    var out = [channel];
    for (var i = 0; i < parts.length; i++) out.push(part(parts[i]));
    out.push(part(affix.stat), part(type), part(affix.value));
    return out.join("||");
  }

  // A component carrying the separator would make the key ambiguous — and the
  // ladder below splits on it to ask "the same row under a different type?".
  function part(v) { return v == null ? "" : String(v).split("||").join("|"); }

  /** The key with its type component removed: the identity of the ROW, independent
   *  of what type it currently carries. The type is always second from last. */
  function keyMinusType(key) {
    var parts = String(key).split("||");
    if (parts.length < 3) return String(key);
    parts.splice(parts.length - 2, 1);
    return parts.join("||");
  }

  /** Walk every ELIGIBLE crafted pool row, calling back with the row and its key.
   *  Eligibility is the same five-class predicate items use, minus the two classes
   *  that cannot occur here: a crafted row is never load-generated and never an
   *  expansion component, so only the type-based classes can exclude it. */
  function eachPoolAffix(pool, cb, all) {
    if (!pool) return;
    for (var c = 0; c < POOL_CHANNELS.length; c++) {
      var spec = POOL_CHANNELS[c];
      var rows = pool[spec.channel] || [];
      for (var i = 0; i < rows.length; i++) {
        var entry = rows[i];
        var affixes = spec.multi ? (entry.affixes || []) : [entry];
        for (var j = 0; j < affixes.length; j++) {
          var a = affixes[j];
          if (!all && !poolAffixEligible(a)) continue;
          cb({ channel: spec.channel, host: null, entry: entry, affix: a,
               key: keyOf(spec.channel, spec.disc(entry), a, readType(a)),
               catalogKey: keyOf(spec.channel, spec.disc(entry), a, catalogTypeOrLive(a)) });
        }
      }
    }
    var perItem = pool[PER_ITEM_CHANNEL] || {};
    var hosts = Object.keys(perItem);
    for (var h = 0; h < hosts.length; h++) {
      var list = perItem[hosts[h]] || [];
      for (var k = 0; k < list.length; k++) {
        var pa = list[k];
        if (!all && !poolAffixEligible(pa)) continue;
        cb({ channel: PER_ITEM_CHANNEL, host: hosts[h], entry: perItem[hosts[h]], affix: pa,
             key: keyOf(PER_ITEM_CHANNEL, [hosts[h], pa.pool], pa, readType(pa)),
             catalogKey: keyOf(PER_ITEM_CHANNEL, [hosts[h], pa.pool], pa, catalogTypeOrLive(pa)) });
      }
    }
  }

  function poolAffixEligible(affix) {
    if (!affix) return false;
    var t = readType(affix);
    if (t == null) return false;
    return !INELIGIBLE_TYPES[t];
  }

  /** The identity of an override on a crafted row, from a record `eachPoolAffix`
   *  handed out. Same four fields an item override records, with `pool_key`
   *  standing in for `variant_id`. */
  function poolOverrideKey(rec) {
    return {
      pool_key: rec && rec.catalogKey,
      name: rec && rec.affix && rec.affix.stat,
      from: rec && catalogTypeOrLive(rec.affix),
      value: rec && rec.affix && String(rec.affix.value),
    };
  }

  /** Every crafted row an override addresses. Keyed on the composed key, which
   *  already carries the recorded type — so, exactly like the item ladder, this
   *  reads THROUGH any live stamp rather than off the current value. */
  function matchPoolAffixes(pool, override) {
    var hits = [];
    if (!override || !override.pool_key) return hits;
    eachPoolAffix(pool, function (rec) {
      if (rec.catalogKey === override.pool_key) hits.push(rec.affix);
    });
    return hits;
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

  /** U7 (R25-R29) — the ladder over a whole list, which is what the load path and
   *  every disclosure surface actually needs. Returns one entry per override, in
   *  the order declared, each carrying its own override back.
   *
   *  A SATISFIED override is retained rather than dropped (R26): if it were
   *  deleted the day upstream adopted it, a later refresh moving that type
   *  elsewhere would leave the player with no record that they ever disagreed. */
  function resolveOverrides(pool, overrides) {
    var list = overrides || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var m = (o && o.pool_key) ? resolvePoolMatch(pool, o) : resolveMatch(pool, o);
      out.push({
        override: o,
        state: m.state,
        reason: m.reason || null,
        now: m.now != null ? m.now : null,
        count: (m.affixes || []).length,
      });
    }
    return out;
  }

  /** KTD8's ladder for a crafted row, keyed on the pool key rather than a variant.
   *  Same five outcomes, same rule that every rung reads the CATALOG type. Walks
   *  the ineligible rows too, so a row upstream has re-typed to a presence or
   *  penalty token reports `ineligible` rather than looking retired. */
  function resolvePoolMatch(pool, override) {
    var wanted = keyMinusType(override && override.pool_key);
    var rows = [];
    eachPoolAffix(pool, function (rec) {
      if (keyMinusType(rec.catalogKey) === wanted) rows.push(rec.affix);
    }, true);
    if (!rows.length) return { state: "suspended", reason: "retired-target", affixes: [] };

    var atRecorded = rows.filter(function (a) { return catalogTypeOrLive(a) === override.from; });
    if (atRecorded.length) {
      if (!atRecorded.every(function (a) { return poolAffixEligible(a); })) {
        return { state: "suspended", reason: "ineligible", affixes: atRecorded };
      }
      return { state: "active", reason: null, affixes: atRecorded };
    }
    var atReplacement = rows.filter(function (a) { return catalogTypeOrLive(a) === override.to; });
    if (atReplacement.length) return { state: "satisfied", reason: null, affixes: atReplacement };
    return { state: "suspended", reason: "drift", affixes: rows, now: catalogTypeOrLive(rows[0]) };
  }

  /** U8 (R30) — do these two APPLIED lists describe the same set of corrections?
   *
   *  A displayed result is a claim about one specific set, so when the set changes
   *  the claim is stale. Order is not part of the set: the player's declaration
   *  order is not something a solve depends on, and treating a reorder as a change
   *  would offer a pointless re-solve.
   *
   *  Compared on the four fields that identify what a correction DID — the target,
   *  the affix, the type it replaced, and the type it replaced it with. `count` is
   *  deliberately excluded: it is a consequence of the catalog, not of the
   *  player's assertion, so a catalog change that alters it is caught by the
   *  lifecycle rather than by presenting the same correction as a new one. */
  function sameOverrideSet(a, b) {
    var sa = signatures(a), sb = signatures(b);
    if (sa.length !== sb.length) return false;
    for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  }

  function signatures(list) {
    return (list || []).filter(Boolean).map(function (o) {
      return [o.variant_id || o.pool_key || "", o.name, o.from, o.to].join("\u0000");
    }).sort();
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
    // U6 — through `readType`, not `affix.type`: a crafted pool row records its
    // type as `bonus_type`, and reading the item field here returned `undefined`
    // for every unstamped crafted row — which composed a pool key naming the type
    // "undefined" and matched nothing.
    return affix[OVERRIDE_FROM] != null ? affix[OVERRIDE_FROM] : readType(affix);
  }

  /** Remove every applied override, restoring each affix's catalog type. */
  function withdrawOverrides(pool) {
    var items = (pool && pool.items) || [];
    for (var i = 0; i < items.length; i++) {
      var affixes = items[i].affixes || [];
      for (var j = 0; j < affixes.length; j++) restoreOne(affixes[j]);
    }
    // U6 — crafted rows too, walked WITHOUT the eligibility filter. Withdrawal
    // must never be conditional on a predicate evaluated against the overridden
    // value: a filter that agreed at apply time and disagrees now would strand a
    // stamp on the shared pool with no route back.
    eachPoolAffix(pool, function (rec) { restoreOne(rec.affix); }, true);
    return pool;
  }

  function restoreOne(affix) {
    if (!affix || affix[OVERRIDE_FROM] == null) return;
    affix[typeKeyOf(affix)] = affix[OVERRIDE_FROM];
    delete affix[OVERRIDE_FROM];
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
      var isPool = !!(o && o.pool_key);
      var hits = (isPool ? matchPoolAffixes(pool, o) : matchAffixes(pool, o))
        .filter(function (a) { return a[OVERRIDE_FROM] == null; });
      if (!hits.length) { unmatched.push(o); continue; }
      var v = isPool ? null : variantOf(pool, o.variant_id);
      var ok = isPool
        ? hits.every(function (a) { return poolAffixEligible(a); })
        : hits.every(function (a) { return isEligible(a, v); });
      if (!ok) { ineligible.push(o); continue; }
      for (var j = 0; j < hits.length; j++) {
        // Non-enumerable, for the same reason as ELIGIBLE_CACHE: solver.js hands out
        // LIVE pool variant references, `chosen` is on persist.js's RESULT_KEEP, and
        // saveCharacter JSON.stringifies the record — so a plain assignment would
        // persist this stamp into every character saved while an override is applied,
        // undeclared and with no override list to explain it. `delete` still works on
        // a configurable property, and catalogTypeOf reads it by direct access.
        Object.defineProperty(hits[j], OVERRIDE_FROM, {
          value: readType(hits[j]), enumerable: false, configurable: true, writable: true,
        });
        hits[j][typeKeyOf(hits[j])] = o.to;
      }
      applied.push({ variant_id: o.variant_id || null, pool_key: o.pool_key || null,
        name: o.name, from: o.from, to: o.to, count: hits.length });
    }
    return { applied: applied, unmatched: unmatched, ineligible: ineligible };
  }

  var api = {
    OVERRIDE_FROM, ELIGIBLE_CACHE,
    isEligible, classifyPool, eligibleAffixes, isCompositeComponent,
    overrideKey, isWellFormed, matchAffixes, resolveMatch, catalogTypeOrLive,
    eachPoolAffix, poolOverrideKey, matchPoolAffixes, poolAffixEligible, readType,
    resolveOverrides, resolvePoolMatch, keyMinusType, sameOverrideSet,
    applyOverrides, withdrawOverrides, catalogTypeOf,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Overrides = api;
})();
