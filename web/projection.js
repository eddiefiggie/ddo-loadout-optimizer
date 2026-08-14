// Shared content projection (U1 of the universal-exports plan). The single source
// that turns a solved build — live (`build.*`) or a saved record's snapshot
// (`rec.snapshot.*`) — into the resolved content model every surface renders from:
// the loadout (worn affixes + assigned augments + crafting upgrades), the completed
// set bonuses, and the priority-stat attribution. `results.js` binds the pure
// primitives from here (so the live views and the exports can't drift); `exporters.js`
// calls `project(rec)` for all five outputs. Pure data — no HTML, no solve. IIFE with
// a namespaced global `Projection`, dual-exported for Node tests.
(function () {
  "use strict";

  // Crafting-system label registry (single source of truth for the membership fork).
  // Global in the browser (loaded before projection.js); require()'d in Node tests.
  const Craft = (typeof CraftingSystems !== "undefined") ? CraftingSystems
    : (typeof require !== "undefined" ? require("./crafting-systems.js") : null);

  // ---- pure primitives (moved verbatim from results.js so there is one definition) ----

  // The key each expansion family stamps on every affix it emits, naming the
  // enchantment the affix came from. Spelled once here and imported from
  // `src/spell_focus.py`'s `PROVENANCE_KEY` on the build side — a respelling on
  // either side would silently stop grouping and quietly restore the expanded shape.
  const PROVENANCE_KEY = "via";

  // Shared affix formatter. Reads NAME/TYPE native-first (`{name,type}`) with the
  // legacy `{stat,bonus_type}` fallback, because it formats native item affixes AND
  // the not-yet-native crafting-pool / set-bonus / Dino affixes (and any pre-overhaul
  // persisted item).
  function affixLabel(a) {
    if (!a) return "";
    const name = a.name != null ? a.name : a.stat;
    // A COLLAPSED expansion whose members do not share one magnitude (see
    // `collapseExpansions`). `parts` holds the member labels this same function
    // already produced, so the enchantment is named once and its members are
    // listed rather than reduced to a number the data does not have.
    if (Array.isArray(a.parts) && a.parts.length) return `${name}: ${a.parts.join(", ")}`;
    const bt = a.type != null ? a.type : a.bonus_type;
    if (bt === "boolean") return `✓ ${name}`;
    const type = bt && bt !== "Enhancement" ? ` ${bt}` : "";
    return `${name} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
  }

  /** U8 (R8) — collapse each EXPANSION back to the enchantment it came from.
   *
   *  One enchantment expands into several concrete affixes so the solver can match
   *  a ranked stat: a universal spell focus becomes seven schools, the ability
   *  umbrella becomes six abilities. That shape is a solver convenience, and it
   *  leaked — a Woeful Viktranium craft reported "+2 Enchantment" on one item and
   *  "+2 Necromancy" on the off-hand, which is ONE craft described by whichever
   *  school happened to be ranked. On an item-centric surface the player must read
   *  the name engraved on the item.
   *
   *  Members are grouped by `PROVENANCE_KEY`; an affix without one is a native
   *  effect already engraved under its own name and passes through BY IDENTITY.
   *  Each group collapses in place, at its first member's position, so unrelated
   *  affixes keep their order.
   *
   *  Two shapes come out, and the difference is deliberate. Where the members
   *  share one magnitude (spell focus, the ability umbrella) the entry carries
   *  that value. Where they do NOT — `Parrying` grants Armor Class at one
   *  magnitude and three saves at another; `Speed` and the boolean composites are
   *  the same — the entry lists its members via `parts` instead. Reducing those to
   *  a single number would publish a value the data never stated, which is the one
   *  thing this repo refuses to do.
   *
   *  NOT for Ranked Priorities (R11). That surface answers "where did this point
   *  come from" and must keep crediting the ranked stat individually; it names the
   *  enchantment through the attribution's own `via` field instead.
   */
  function collapseExpansions(affixes) {
    const out = [];
    const groupAt = new Map();
    for (const a of affixes || []) {
      const via = a && a[PROVENANCE_KEY];
      if (!via) { out.push(a); continue; }
      if (groupAt.has(via)) { out[groupAt.get(via)].members.push(a); continue; }
      groupAt.set(via, out.length);
      out.push({ via, members: [a] });
    }
    if (!groupAt.size) return out;
    // A group's magnitude is (value, unit, bonus type). Type is part of it on
    // purpose: two members at the same value but different bonus types are not
    // interchangeable, and naming one number for both would overclaim.
    const magnitude = (a) => `${a.value}||${a.unit || "flat"}||${a.type != null ? a.type : a.bonus_type}`;
    return out.map((e) => {
      if (!e || !e.members) return e;
      const ms = e.members;
      const uniform = ms.every((m) => magnitude(m) === magnitude(ms[0]));
      // `stat` as well as `name` so the legacy-shaped readers (craftValue and any
      // pre-overhaul persisted surface) resolve the enchantment name too. No
      // bonus type is emitted: it is already spoken by names like "Sacred Spell
      // Focus Mastery", and appending it would render the type twice.
      const base = { name: e.via, stat: e.via, [PROVENANCE_KEY]: e.via, collapsed: ms.length };
      return uniform
        ? { ...base, value: ms[0].value, unit: ms[0].unit || "flat" }
        : { ...base, parts: ms.map(affixLabel) };
    });
  }

  // Item-level ML read native-first (`ml`), legacy `minimum_level` fallback.
  function itemMl(v) { return (v && v.ml != null) ? v.ml : (v && v.minimum_level); }

  /** Which of a variant's affixes hit the query targets (for the "why" column). */
  function contributingAffixes(variant, targets) {
    const t = new Set(targets);
    return (variant.affixes || []).filter((a) => t.has(a.name != null ? a.name : a.stat));
  }

  /** Reconstruct a concrete augment->item assignment from the solver's aggregate
   *  per-color-capacity placements. Walk equipped items in order and drop each placed
   *  augment into the first item with remaining open capacity of the slot color it
   *  consumed. Returns { byIndex, unplaced, freeByIndex }. */
  /** Per-item open-slot counts by color — shared by assignAugments and the
   *  canonicalization feasibility check, so the two can never drift. */
  function slotCountsByItem(chosen) {
    return chosen.map((c) => {
      const m = new Map();
      for (const col of ((c.variant.augment_slots_norm || {}).colors) || []) m.set(col, (m.get(col) || 0) + 1);
      return m;
    });
  }

  function assignAugments(chosen, augmentsPlaced, setAugmentsPlaced) {
    const remaining = slotCountsByItem(chosen);
    // Reserve the slots the solver already filled with set-augment copies
    // (setAugmentsPlaced[].host is a variant_id) BEFORE greedily assigning ordinary
    // augments, or an item whose only compatible slot holds a set copy would be
    // double-booked (ordinary augment attributed to a full slot) and reported as
    // free. #316 — the reservation decrements the color the copy actually consumed
    // (slot_color); a placement saved before slot_color existed can only have been
    // Colorless, so that is the legacy default (an undefined lookup would silently
    // no-op the reservation and re-offer the slot).
    for (const sa of setAugmentsPlaced || []) {
      const i = chosen.findIndex((c) => c.variant && c.variant.variant_id === sa.host);
      const col = (sa && sa.slot_color) || "Colorless";
      if (i >= 0 && (remaining[i].get(col) || 0) > 0) remaining[i].set(col, remaining[i].get(col) - 1);
    }
    const byIndex = new Map();
    const unplaced = [];
    for (const aug of augmentsPlaced || []) {
      const want = aug.slot_color || aug.color;
      let placed = false;
      for (let i = 0; i < chosen.length; i++) {
        if ((remaining[i].get(want) || 0) > 0) {
          remaining[i].set(want, remaining[i].get(want) - 1);
          if (!byIndex.has(i)) byIndex.set(i, []);
          byIndex.get(i).push(aug);
          placed = true;
          break;
        }
      }
      if (!placed) unplaced.push(aug);
    }
    const freeByIndex = new Map();
    remaining.forEach((m, i) => {
      const cols = [];
      for (const [col, n] of m) for (let k = 0; k < n; k++) cols.push(col);
      if (cols.length) freeByIndex.set(i, cols);
    });
    return { byIndex, unplaced, freeByIndex };
  }

  /** #316 — the canonical set-augment placement list every consumer reads.
   *
   *  Returns a NEW list (the persisted snapshot is never mutated; persist.js
   *  stores `setAugmentsPlaced` verbatim) in which each copy carries a
   *  `slot_color` and, where a Colorless recolor is genuinely free, the copy is
   *  re-reported as Colorless. Runs unconditionally — projection has no
   *  solve-path flag, and on a tie-broken primary solve the pass is idempotent
   *  (the Colorless-first stage already landed every free copy Colorless).
   *
   *  The guard is a trial-assignment check, not a copy-only ledger: a candidate
   *  recolor is accepted only when (a) the host itself exposes a Colorless slot
   *  (never a color absent from the host, R2), (b) every copy's reservation
   *  still fits its host's physical slots, and (c) re-running the full ordinary-
   *  augment reconstruction does not grow `unplaced` — a pre-assignment ledger
   *  sees only other copies and would steal a Colorless slot ordinary demand
   *  needs. Legacy placements without `slot_color` default to Colorless (the
   *  only color a pre-#316 solve could consume). Memoized per build object.
   */
  const _canonSetAug = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
  function canonicalSetAugments(build) {
    if (!build) return [];
    if (_canonSetAug && _canonSetAug.has(build)) return _canonSetAug.get(build);
    const chosen = build.chosen || [];
    const list = (build.setAugmentsPlaced || [])
      .map((sa) => ({ ...sa, slot_color: (sa && sa.slot_color) || "Colorless" }));
    const idxByHost = new Map();
    chosen.forEach((c, i) => {
      const id = c.variant && c.variant.variant_id;
      if (id != null && !idxByHost.has(id)) idxByHost.set(id, i);
    });
    const hostIdx = (id) => (idxByHost.has(id) ? idxByHost.get(id) : -1);
    // Per-host physical feasibility of a candidate list: every copy must reserve
    // a real slot of its color on its own host.
    const reservationsFit = (l) => {
      const rem = slotCountsByItem(chosen);
      for (const s of l) {
        const i = hostIdx(s.host);
        if (i < 0) continue; // host not in chosen (partial snapshot) — nothing to reserve
        const have = rem[i].get(s.slot_color) || 0;
        if (!have) return false;
        rem[i].set(s.slot_color, have - 1);
      }
      return true;
    };
    if (list.length && reservationsFit(list)) {
      // The guard compares WHICH augments sit unplaced, not just how many: with
      // a drifted restored snapshot (base unplaced > 0) an equal COUNT can still
      // swap which augment lost its seat, and re-reporting a different eviction
      // than the saved build showed is a display lie.
      const unplacedIdsOf = (l) => assignAugments(chosen, build.augmentsPlaced, l).unplaced
        .map((a) => a.variant_id).sort();
      let base = unplacedIdsOf(list);
      for (let k = 0; k < list.length; k++) {
        if (list[k].slot_color === "Colorless") continue;
        const i = hostIdx(list[k].host);
        if (i < 0) continue;
        const cols = ((chosen[i].variant.augment_slots_norm || {}).colors) || [];
        if (!cols.includes("Colorless")) continue;               // host-bounded (R2)
        const trial = list.map((s, j) => (j === k ? { ...s, slot_color: "Colorless" } : s));
        if (!reservationsFit(trial)) continue;                   // no free Colorless on the host
        const u = unplacedIdsOf(trial);
        const sameSet = u.length === base.length && u.every((id, x) => id === base[x]);
        if (u.length < base.length || sameSet) { list[k] = trial[k]; base = u; }
      }
    }
    if (_canonSetAug) _canonSetAug.set(build, list);
    return list;
  }

  /** Dino-insert -> item assignment (mirrors assignAugments). Slots keyed by
   *  `dino_type||category`. */
  function dinoInsertKey(ins) {
    return `${ins.dino_type}||${ins.category || "Accessory"}`;
  }
  function assignDinoInserts(chosen, dinoPlaced) {
    const remaining = chosen.map((c) => {
      const m = new Map();
      for (const t of c.variant.dino_slots_norm || []) m.set(t, (m.get(t) || 0) + 1);
      return m;
    });
    const byIndex = new Map();
    const unplaced = [];
    for (const ins of dinoPlaced || []) {
      const key = dinoInsertKey(ins);
      let placed = false;
      for (let i = 0; i < chosen.length; i++) {
        if ((remaining[i].get(key) || 0) > 0) {
          remaining[i].set(key, remaining[i].get(key) - 1);
          if (!byIndex.has(i)) byIndex.set(i, []);
          byIndex.get(i).push(ins);
          placed = true;
          break;
        }
      }
      if (!placed) unplaced.push(ins);
    }
    return { byIndex, unplaced };
  }

  /** Per-target contributor attribution. Reads the solver's breakdown (host slot for
   *  worn + item-crafts, yielding slots for sets) and fills the augment host slot from
   *  the augment reconstruction. Returns { stat: [{ bonus_type, value, source,
   *  sourceKind, slots, hostIds, isSet }], ... } — presentation only. */
  function attributionByTarget(result, augAssign) {
    const breakdown = result.breakdown || {};
    augAssign = augAssign || assignAugments(result.chosen, result.augmentsPlaced, canonicalSetAugments(result));
    const augSlot = new Map(), augHost = new Map();
    for (const [idx, augs] of augAssign.byIndex) {
      const host = result.chosen[idx];
      for (const a of augs) {
        augSlot.set(a.variant_id, host && host.slot);
        augHost.set(a.variant_id, host && host.variant && host.variant.variant_id);
      }
    }
    // U4 (R9) — the runtime half of a set's sources. `setYieldingSlots` comes from
    // the solver's `realPieces`, which are x-var (intrinsic) pieces only: a wildcard
    // or chosen-membership pick has no x-var, so the very piece that completed the
    // set was missing from its source list and the player saw "via Ring" alone.
    // Union the resolver's non-intrinsic contributors in; the intrinsic ones the
    // solver already named are left to it, so an ordinary build is untouched.
    const runtimeBySet = new Map();
    const contributors = setContributors(result);
    for (const c of (result && result.chosen) || []) {
      for (const e of contributorsFor(contributors, c.slot, c.variant.variant_id)) {
        if (e.kind === "intrinsic") continue;
        if (!runtimeBySet.has(e.set)) runtimeBySet.set(e.set, []);
        runtimeBySet.get(e.set).push({ slot: c.slot, host: c.variant.variant_id });
      }
    }
    const out = {};
    for (const stat of Object.keys(breakdown)) {
      out[stat] = breakdown[stat].map((p) => {
        let slots = [];
        let hostIds = p.hostIds ? p.hostIds.slice() : [];
        if (p.setYieldingSlots && p.setYieldingSlots.length) slots = p.setYieldingSlots.slice();
        else if (p.slot) slots = [p.slot];
        else if (p.sourceKind === "augment" && augSlot.has(p.source)) slots = [augSlot.get(p.source)];
        if (!hostIds.length && p.sourceKind === "augment" && augHost.has(p.source)) hostIds = [augHost.get(p.source)];
        if (p.sourceKind === "set") {
          for (const r of runtimeBySet.get(p.source) || []) {
            if (hostIds.includes(r.host)) continue;   // already credited for this set
            slots.push(r.slot);
            hostIds.push(r.host);
          }
        }
        return {
          bonus_type: p.bonus_type, value: p.value, source: p.source,
          sourceKind: p.sourceKind, slots, hostIds, isSet: p.sourceKind === "set",
          // #205 — when this contribution came from a universal spell-DC
          // enchantment, the name the player will find on the item. Null for a
          // native affix, whose own stat name is already what is engraved.
          via: p.via || null,
          // U3 (#290/#291) — when this part was cross-added from a fully-
          // stacking universal stat (Universal Spell Power under an element
          // spellpower; Spell Lore / Universal Spell Lore under an element
          // lore), the SOURCE stat's name. Null on the target's own parts.
          // Stays FLAT beside them — never grouped the way via-expansions
          // collapse on the item surfaces: the source stat IS the name
          // engraved on the item. Renders as "from <source stat>".
          crossAdd: p.crossAdd || null,
        };
      });
    }
    return out;
  }

  /** Which ranked targets a specific equipped item wins, and by how much. `item` is
   *  { slot, variant_id }. Returns [{ stat, value, viaSet, boolean }], highest first;
   *  empty for a filler/tie-break pick. */
  function whyThis(result, item, attr) {
    attr = attr || attributionByTarget(result);
    const wins = [];
    for (const stat of Object.keys(attr)) {
      let val = 0, viaSet = false, boolean = false;
      for (const p of attr[stat]) {
        if ((p.hostIds || []).includes(item.variant_id)) {
          val += p.value;
          if (p.isSet) viaSet = true;
          if (p.bonus_type === "boolean") boolean = true;
        }
      }
      if (val > 0) wins.push({ stat, value: val, viaSet, boolean });
    }
    wins.sort((a, b) => b.value - a.value);
    return wins;
  }

  /** Per-item ranked contributions with the bonus type kept (plan 2026-08-12-001 U1).
   *
   *  `whyThis` sums per stat and drops `bonus_type`, so it cannot render
   *  "Intelligence +22 Insight". This walks the same attribution rows with the
   *  same host-variant_id match (the rings gotcha: never by slot), but keeps
   *  each contribution separate — a host and its slotted augment feeding the
   *  same stat are two entries, because merging them would erase the bonus-type
   *  fact the gear-box summary exists to show.
   *
   *  Order: the caller's ranked `targets` first, value-descending within a
   *  stat. Zero and negative values are dropped unless the row is a boolean
   *  presence affix, mirroring `whyThis`'s positive guard. */
  function itemContributions(result, item, attr, targets) {
    attr = attr || attributionByTarget(result);
    const order = (targets && targets.length) ? targets : Object.keys(attr);
    const out = [];
    for (const stat of order) {
      const rows = [];
      for (const p of attr[stat] || []) {
        if (!(p.hostIds || []).includes(item.variant_id)) continue;
        const boolean = p.bonus_type === "boolean";
        if (!boolean && !(p.value > 0)) continue;
        rows.push({ stat, value: p.value, bonus_type: p.bonus_type,
          viaSet: !!p.isSet, boolean, via: p.via || null,
          // U3 (#290/#291) — the cross-add source stat rides with the row so the
          // per-item why-this can label the credit "from <source stat>".
          crossAdd: p.crossAdd || null });
      }
      rows.sort((a, b) => b.value - a.value);
      for (const r of rows) out.push(r);
    }
    return out;
  }

  /** The stats whose every live bonus-type bucket is filled — membership in
   *  `saturationReport`. Reads plain JSON on the result (never the live
   *  program), so a restored character colors identically without re-solving;
   *  a pre-#239 snapshot with no report renders neutral, not broken. */
  function saturatedStats(result) {
    const s = new Set();
    for (const e of (result && result.saturationReport) || []) {
      if (e && e.stat) s.add(e.stat);
    }
    return s;
  }

  // #245 — the crafted-contribution channels, and what a player calls each one.
  // `worn` is the item's own printed affixes; `roll` is an intrinsic choice slot
  // (#257 ruled its options the item's own engraved enchantment), so both count
  // as native. `set` is neither: an item there to complete a set is not
  // craft-carried. `declared` has no host and never reaches this test.
  const CRAFT_FAMILY_LABEL = {
    augment: "augments", vik: "Viktranium", seal: "Ritual Table seal",
    nc: "Nearly Completed", dino: "Dino crafting",
    tf: "Thunder-Forged", gs: "Green Steel",
  };
  const NATIVE_KINDS = new Set(["worn", "roll"]);

  // #262 — the no-drop-source disclosure wording, EXACTLY this phrase everywhere
  // it renders (gear box, Deep Dive, browse/wizard rows, coverage note, all six
  // exports). The wiki proves its page records no source — that is the claim the
  // evidence supports, and nothing stronger is ever printed (R5). ONE spelling,
  // exported for every surface; a per-surface respelling is the drift this
  // constant exists to forbid.
  const NO_DROP_SOURCE_WORDING = "no known live drop source";

  /** #245 — is this equipped item picked ONLY for its craftable options?
   *
   *  A craftable option slot makes its host a wildcard for every rankable stat,
   *  so under strict lexicographic priority it can displace a genuinely richer
   *  item by a single crafted point. The math is correct; what was missing is
   *  the player being told. Returns the crafted contributions ([{stat, value,
   *  family}], highest first) when the item's native (worn/choice-slot) and set
   *  contributions to the RANKED targets are both zero and at least one crafted
   *  channel contributes — and null otherwise, including for a filler pick that
   *  contributes nothing at all (that is `whyThisLine`'s "included to complete
   *  the loadout", not a craft story). */
  function craftCarried(result, item, attr) {
    attr = attr || attributionByTarget(result);
    let native = 0, viaSet = 0;
    const parts = [];
    for (const stat of Object.keys(attr)) {
      for (const p of attr[stat]) {
        if (!(p.hostIds || []).includes(item.variant_id)) continue;
        if (NATIVE_KINDS.has(p.sourceKind)) native += p.value;
        else if (p.sourceKind === "set") viaSet += p.value;
        else if (CRAFT_FAMILY_LABEL[p.sourceKind]) {
          parts.push({ stat, value: p.value, family: CRAFT_FAMILY_LABEL[p.sourceKind] });
        }
      }
    }
    if (native > 0 || viaSet > 0 || !parts.length) return null;
    parts.sort((a, b) => b.value - a.value || (a.stat < b.stat ? -1 : 1));
    return parts;
  }

  /** #110 (U7) — the blocklist disclosure, as plain sentences. ONE source for
   *  the app notice and every export. Reads `blockReport` (plain JSON on the
   *  result, computed at model-build time against the PRE-dominance pool), never
   *  the live program, so a restored character discloses without re-solving.
   *
   *  KTD9 — attribution, never counterfactual: the sentences state what was
   *  excluded and, only where the comparator proved it against every survivor
   *  in the pool, that the blocked variant out-valued the rest. Nothing here
   *  claims what a block-free solve would have produced. */
  function blockNoticeLines(result) {
    const report = (result && result.blockReport) || [];
    if (!report.length) return [];
    const names = report.map((e) => e.name);
    const lines = [
      `Your blocklist excluded ${report.length === 1 ? "one candidate" : `${report.length} candidates`} `
      + `from this solve: ${names.join(", ")}. The result is optimal given those exclusions.`,
    ];
    for (const e of report) {
      if (e.bestAvailable) {
        lines.push(`${e.name} out-valued every remaining ${e.pool} candidate under your `
          + "priorities before it was excluded.");
      }
    }
    return lines;
  }

  /** #245 — the niche-crafting opt-out, as a plain sentence for the notice
   *  surface and every export. Reads the solved query's flag off the snapshot
   *  (and the saved inputs as the restore-path fallback), never the live
   *  program, so a restored character discloses identically without re-solving. */
  function craftingExcludedLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = snap.query || {};
    const inputs = (rec && rec.inputs) || {};
    if (!q.excludeCraftingSystems && !inputs.excludeCraftingSystems) return null;
    return "Niche crafting was excluded from this solve: Viktranium experiments, "
      + "Ritual Table seals, Nearly Completed, Dinosaur Bone crafting, and "
      + "set-bonus crafting were not considered. Regular augments still were.";
  }

  /** Variant_ids of host items that carry a solver-placed Set Augment. A Set Augment
   *  overrides ("suppresses") the host item's OWN named set(s) — the solver already
   *  dropped that set from setsActive/totals, so the set-satisfaction primitives must
   *  not re-count the suppressed host's intrinsic membership (U7). Hosts are read from
   *  `setAugmentsPlaced[].host` (solver-DECIDED, not greedily reconstructed, KTD-6). */
  function suppressedHostIds(build) {
    const s = new Set();
    for (const sa of (build && build.setAugmentsPlaced) || []) if (sa.host) s.add(sa.host);
    return s;
  }

  /** Sets actually complete in the equipped loadout — the glow signal. Union of
   *  (1) a static set whose equipped piece count meets its lowest piece-threshold tier
   *  and (2) `setsActive` (runtime joker/membership completions). A host carrying a
   *  placed Set Augment does not count toward its own intrinsic set (U7 suppression);
   *  pass `suppressed` (a Set of host variant_ids) to honor it. */
  function satisfiedSets(chosen, setsActive, suppressed) {
    suppressed = suppressed || new Set();
    const counts = new Map();
    const minReq = new Map();
    for (const c of chosen || []) {
      const isSuppressed = suppressed.has(c.variant.variant_id);
      for (const sb of c.variant.set_bonus || []) {
        if (sb.set && !isSuppressed) counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
      }
      for (const tier of c.variant.parsed_set_bonuses || []) {
        if (tier.pieces_required == null) continue;
        const cur = minReq.get(tier.set);
        if (cur == null || tier.pieces_required < cur) minReq.set(tier.set, tier.pieces_required);
      }
    }
    const out = new Set();
    for (const [set, need] of minReq) if ((counts.get(set) || 0) >= need) out.add(set);
    for (const s of setsActive || []) if (s.set) out.add(s.set);
    return out;
  }

  /** The set(s) an equipped piece belongs to. When `satisfied` is passed, only
   *  actually-complete sets are returned. */
  function slotSetNames(v, satisfied) {
    const names = [...new Set((v.set_bonus || []).map((s) => s.set).filter(Boolean))];
    return satisfied ? names.filter((n) => satisfied.has(n)) : names;
  }

  /** Every set each equipped slot contributes to — the SET CONTRIBUTOR resolver.
   *
   *  `CONCEPTS.md` names three kinds and only the first lives in item data: an
   *  intrinsic member (`set_bonus` at rest), a chosen-membership host (Vecna Lost
   *  Purpose, Cannith Repurposing Station, Dino Set-Bonus), and a wildcard piece
   *  (the Gem of Many Facets family). The latter two are solver decisions reported
   *  in `membershipPlaced` / `jokerPlaced` and appear nowhere in the catalog —
   *  deliberately, since writing a runtime pick into item data would make the
   *  catalog assert something untrue. A display that reads `set_bonus` alone omits
   *  a piece the solve counted.
   *
   *  Returns a Map keyed `${slot}||${variant_id}` -> [{set, kind}]. A LIST, because
   *  a Gem takes one membership from each of two independent pools, so one slot
   *  commonly feeds two sets at once.
   *
   *  Suppression applies to the INTRINSIC component only. A Set Augment slotted
   *  into an item suppresses that item's own sets, and the solver has already
   *  dropped them; re-adding them here would resurrect a piece the solve removed.
   *  A runtime pick on a suppressed host is a separate decision and survives.
   *
   *  Duplicate-variant caveat: runtime picks key on host variant_id, not slot, so
   *  when one variant occupies two slots the pick is attributed to the first of
   *  them. The pick exists once and is reported once — never on both slots. */
  function setContributors(build) {
    const suppressed = suppressedHostIds(build);
    const out = new Map();
    const keyOf = (c) => contributorKey(c.slot, c.variant.variant_id);
    for (const c of (build && build.chosen) || []) {
      const list = [];
      if (!suppressed.has(c.variant.variant_id)) {
        for (const sb of c.variant.set_bonus || []) {
          if (sb.set && !list.some((e) => e.set === sb.set)) list.push({ set: sb.set, kind: "intrinsic" });
        }
      }
      out.set(keyOf(c), list);
    }
    // Attach each runtime pick to the first equipped slot holding its host.
    const attach = (placed, kind) => {
      for (const pick of placed || []) {
        if (!pick || !pick.set || !pick.host) continue;
        const c = ((build && build.chosen) || []).find((x) => x.variant.variant_id === pick.host);
        if (!c) continue;
        const list = out.get(keyOf(c));
        if (list && !list.some((e) => e.set === pick.set && e.kind === kind)) list.push({ set: pick.set, kind });
      }
    };
    attach(build && build.membershipPlaced, "membership");
    attach(build && build.jokerPlaced, "wildcard");
    return out;
  }

  /** The `setContributors` map key. Private format, one definition: a display that
   *  hand-rolled `${slot}||${id}` would silently miss every lookup the day the key
   *  changes, and a missed lookup here reads as "this slot feeds no set". */
  function contributorKey(slot, variantId) { return `${slot}||${variantId}`; }

  /** The contributor entries for one equipped slot — `[{set, kind}]`, never null. */
  function contributorsFor(contributors, slot, variantId) {
    return (contributors && contributors.get(contributorKey(slot, variantId))) || [];
  }

  /** One Set-Bonuses member as plain text: the piece, the slot it occupies, and how
   *  it contributes (U4/R10). ONE definition so the app card and every export name a
   *  piece identically. Never escapes — each caller applies its own escaper.
   *
   *  A wildcard or chosen-membership pick is named as such (R8): it counts toward
   *  the set exactly as an intrinsic member does, but the two are not
   *  interchangeable and the text must not imply they are. An Augment Set has no
   *  worn member at all — its copies are named by the item each sits in. */
  function setMemberLabel(m) {
    const where = m.slot ? ` (${m.slot})` : "";
    if (m.kind === "augmentset") return `Set Augment in ${m.item}${where}`;
    if (m.kind === "wildcard") return `${m.item}${where} — wildcard`;
    if (m.kind === "membership") return `${m.item}${where} — set-bonus pick`;
    return `${m.item}${where}`;
  }

  /** Active set bonuses with the stats they grant and the slots that yield them.
   *
   *  U4 (R7, R9) — the yielding slots come from the SET-CONTRIBUTOR resolver, not
   *  from `set_bonus`. A wildcard/chosen-membership slot completes a set without
   *  carrying it in item data, so reading the static field alone dropped the piece
   *  that made the bonus happen out of every source list. */
  function activeSetDetail(result) {
    const contributors = setContributors(result);
    const yields = new Map();
    const tierAffixes = new Map();
    for (const c of (result && result.chosen) || []) {
      for (const e of contributorsFor(contributors, c.slot, c.variant.variant_id)) {
        if (!yields.has(e.set)) yields.set(e.set, []);
        yields.get(e.set).push(c.slot);
      }
      for (const t of c.variant.parsed_set_bonuses || []) {
        if (t.pieces_required == null) continue;
        const k = `${t.set}||${t.pieces_required}`;
        if (!tierAffixes.has(k) && (t.affixes || []).length) tierAffixes.set(k, t.affixes);
      }
    }
    return ((result && result.setsActive) || []).map((s) => ({
      set: s.set, pieces: s.pieces_required,
      slots: yields.get(s.set) || [],
      affixes: tierAffixes.get(`${s.set}||${s.pieces_required}`) || s.affixes || [],
    }));
  }

  /** Every set complete in the build: granted affixes + the pieces composing it.
   *
   *  U4 (R10) — a member is `{slot, item, kind}`, not a bare variant_id, and the
   *  list comes from the SET-CONTRIBUTOR resolver so a wildcard/chosen-membership
   *  piece is named alongside the intrinsic ones. An AUGMENT SET has no worn member
   *  whatsoever: it is named by its placed copies and the item each occupies, read
   *  verbatim from `setAugmentsPlaced[].host` (KTD-6). Without that, its card showed
   *  a tier number and named nothing at all.
   *
   *  `counts` stays STATIC-only on purpose: it selects which tier is satisfied, and
   *  the tab's "N pieces" is that tier THRESHOLD, not a count of equipped items.
   *  R10 adds the member list; it does not redefine that number. */
  function satisfiedSetDetail(build) {
    build = build || {};
    const contributors = setContributors(build);
    const counts = new Map();
    const members = new Map();
    const tiers = new Map();
    const suppressed = suppressedHostIds(build);   // U7 — a Set-Augment host doesn't count toward its own set
    const addMember = (set, m) => {
      if (!members.has(set)) members.set(set, []);
      members.get(set).push(m);
    };
    const countedRuntime = new Set();
    for (const c of build.chosen || []) {
      const isSuppressed = suppressed.has(c.variant.variant_id);
      for (const sb of c.variant.set_bonus || []) {
        if (!sb.set || isSuppressed) continue;
        counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
      }
      for (const e of contributorsFor(contributors, c.slot, c.variant.variant_id)) {
        addMember(e.set, { slot: c.slot, item: c.variant.variant_id, kind: e.kind });
        // A runtime pick counts toward the threshold exactly as an intrinsic piece
        // does — the solver already counted it. Leaving `counts` static-only made
        // the tier disagree with the member list it sits beside: a set completed BY
        // a wildcard reported the LOWER tier's grant while naming enough pieces for
        // the higher one, and every export printed that contradiction. Deduped per
        // (set, host) so one host holding two picks for the same set counts once.
        if (e.kind === "intrinsic") continue;
        const ck = `${e.set}||${c.variant.variant_id}`;
        if (countedRuntime.has(ck)) continue;
        countedRuntime.add(ck);
        counts.set(e.set, (counts.get(e.set) || 0) + 1);
      }
      for (const t of c.variant.parsed_set_bonuses || []) {
        if (t.pieces_required == null) continue;
        if (!tiers.has(t.set)) tiers.set(t.set, new Map());
        const byN = tiers.get(t.set);
        if (!byN.has(t.pieces_required)) byN.set(t.pieces_required, t.affixes || []);
      }
    }
    // Augment Set copies: the set's only "pieces". Host read verbatim from the
    // placement (KTD-6); the slot is the host's worn slot, or null when the host
    // isn't in `chosen` (never fabricated).
    const slotOfHost = new Map();
    for (const c of build.chosen || []) {
      const id = c.variant && c.variant.variant_id;
      if (id != null && !slotOfHost.has(id)) slotOfHost.set(id, c.slot);
    }
    for (const sa of build.setAugmentsPlaced || []) {
      if (!sa || !sa.set) continue;
      addMember(sa.set, { slot: slotOfHost.get(sa.host) || null, item: sa.host, kind: "augmentset" });
    }
    const bySet = new Map();
    for (const [set, byN] of tiers) {
      const have = counts.get(set) || 0;
      let best = null;
      for (const [n, affixes] of byN) if (n <= have && (best == null || n > best.pieces)) best = { pieces: n, affixes };
      if (best) bySet.set(set, { set, pieces: best.pieces, affixes: best.affixes, members: members.get(set) || [] });
    }
    for (const s of activeSetDetail(build)) {
      if (bySet.has(s.set)) continue;
      bySet.set(s.set, { set: s.set, pieces: s.pieces, affixes: s.affixes, members: members.get(s.set) || [] });
    }
    return [...bySet.values()];
  }

  // ---- craft maps + the single label function (KTD6) ----

  // Group placement lists by their host item, keyed by variant_id (nc/roll/vik/seal/
  // tf/gs) or host (joker/membership); dino/aug come pre-assigned by index. Extracted
  // verbatim from results.js buildViews so results.js and the exports share one builder.
  function buildCraftMaps(build, augAssign, dinoAssign) {
    augAssign = augAssign || assignAugments(build.chosen, build.augmentsPlaced, canonicalSetAugments(build));
    dinoAssign = dinoAssign || assignDinoInserts(build.chosen, build.dinoPlaced);
    const byItemMap = (list) => {
      const m = new Map();
      for (const n of list || []) { if (!m.has(n.item)) m.set(n.item, []); m.get(n.item).push(n); }
      return m;
    };
    const jokerByHost = new Map();
    for (const j of build.jokerPlaced || []) {
      if (!jokerByHost.has(j.host)) jokerByHost.set(j.host, []);
      jokerByHost.get(j.host).push(j);
    }
    const membershipByHost = new Map();
    for (const m of build.membershipPlaced || []) {
      if (!membershipByHost.has(m.host)) membershipByHost.set(m.host, []);
      membershipByHost.get(m.host).push(m);
    }
    // Placed Set Augments, grouped by their solver-DECIDED host variant_id (KTD-6:
    // read `setAugmentsPlaced[].host` verbatim — do NOT run them through the greedy
    // augment reconstruction, whose host could disagree with the item the solver
    // actually suppressed).
    const setAugByHost = new Map();
    for (const s of canonicalSetAugments(build)) {           // #316 — canonical colors
      if (!setAugByHost.has(s.host)) setAugByHost.set(s.host, []);
      setAugByHost.get(s.host).push(s);
    }
    // Viktranium crafts render in their in-game slot order (R16: Melancholic,
    // Dolorous, Miserable, Woeful) wherever more than one lands on the same host,
    // not the alphabetical order that falls out of solver-emission grouping. The
    // order is already declared on the registry entry — sort each host's list by it
    // rather than duplicating the sequence here.
    const vikByItem = byItemMap(build.vikPlaced);
    const vikOrder = Craft && Craft.get("viktranium") && Craft.get("viktranium").slot_types;
    if (vikOrder && vikOrder.length) {
      const rank = new Map(vikOrder.map((s, i) => [s, i]));
      const rankOf = (slot_type) => (rank.has(slot_type) ? rank.get(slot_type) : vikOrder.length);
      for (const list of vikByItem.values()) list.sort((a, b) => rankOf(a.slot_type) - rankOf(b.slot_type));
    }
    return {
      augAssign, dinoAssign,
      ncByItem: byItemMap(build.ncPlaced), rollByItem: byItemMap(build.rollPlaced),
      vikByItem, sealByItem: byItemMap(build.sealPlaced),
      tfByItem: byItemMap(build.tfPlaced), gsByItem: byItemMap(build.gsPlaced), jokerByHost,
      membershipByHost, setAugByHost,
    };
  }

  // One craft option's value label (e.g. "Constitution +15") — the unit inside a
  // family label. Mirrors results.js craftLbl minus its esc() wrapper (callers escape).
  function craftValue(o) {
    return affixLabel({ stat: o.stat, bonus_type: o.bonus_type, value: o.value, unit: o.unit || "flat" });
  }

  // U8 (R9) — the affixes a crafted option grants, collapsed so an option whose
  // affixes come from one expansion reads as the enchantment rather than as
  // whichever member the solve happened to rank. A crafted choice-slot option is a
  // DIFFERENT render path from a worn affix, and it is the one the bug was reported
  // from. `o.affixes || [o]` resolves the atomic multi-affix shape with the flat
  // single-affix record as the fallback; for a flat record with no provenance this
  // is `craftValue(o)` exactly, so every unexpanded craft label is byte-identical.
  function craftAffixes(o) {
    return collapseExpansions((o.affixes && o.affixes.length) ? o.affixes : [o]).map(affixLabel).join(", ");
  }

  // The single, unescaped label for one crafting placement (KTD6). Membership routes
  // through the CraftingSystems registry (Vecna "Awaken" vs Dino "Slot Set Bonus");
  // every other family keeps its literal template, moved verbatim from
  // results.js craftSlotChips so results.js stays byte-identical when it wraps this in
  // a single esc(). `results.js` re-applies esc(); each text exporter applies its own
  // escaper — this function never escapes.
  function craftLabel(o, family) {
    switch (family) {
      case "dino": return `${o.dino_type}: ${o.name ? o.name + ", " : ""}${craftAffixes(o)}`;
      // #211 — ATOMIC like vik/dino: a Skill-menu option grants six skills, so
      // the label renders the option's whole affix list (craftAffixes falls
      // back to the flat single-affix shape byte-identically).
      case "nc": return `Nearly Completed: ${o.name ? o.name + ", " : ""}${craftAffixes(o)}`;
      case "roll": return `Choice: ${craftValue(o)}`;
      case "vik": return `Slot ${o.slot_type} Viktranium augment: ${craftAffixes(o)}`;
      case "seal": return `Sealed in ${o.seal_type}: ${craftValue(o)}`;
      case "tf": return `Thunder-Forged T${o.tier}: ${craftValue(o)}`;
      case "gs": return `Green Steel: ${craftValue(o)}`;
      case "joker": return `Wildcard set: ${o.set}`;
      case "augmentset": {
        // A solver-placed Set Augment (host is solver-DECIDED, read from
        // setAugmentsPlaced — never greedily reconstructed, KTD-6). When the host
        // item is itself a member of a named set, that own set is suppressed while
        // the augment occupies it (the solver already dropped it from setsActive),
        // so name the suppression inline — carrying it into every text export.
        // #316 — the consumed slot color rides on the label the same way: copies
        // may land in colored slots now, and an unnamed color reads as Colorless.
        const where = o.slot_color ? ` — in ${o.slot_color} slot` : "";
        const supp = (o.suppresses && o.suppresses.length) ? ` (suppresses ${o.suppresses.join(", ")})` : "";
        return `Set Augment: ${o.set}${where}${supp}`;
      }
      case "membership": {
        const sysId = (Craft && Craft.systemForStation(o.station)) || "isle-of-dread-set-bonus";
        return Craft ? Craft.actionLabel(sysId, { set_name: o.set }) : `Slot Set Bonus augment: ${o.set}`;
      }
      default: return craftValue(o);
    }
  }

  /** #316/R8 — the set-augment placement rule, derived from the ACTUAL defs
   *  (never a hardcoded claim about the tool's own output): reports whether the
   *  baked matrix covers the seven standard colors on every def, and whether any
   *  def includes Lunar/Solar (Moon/Sun). The one predicate every disclosure
   *  surface reads, so the app notice and the exports cannot disagree. Returns
   *  null when the dataset carries no defs (nothing to disclose). */
  function setAugmentSlotRule(dataset) {
    const defs = (dataset && dataset.augment_set_defs) || {};
    const names = Object.keys(defs);
    if (!names.length) return null;
    const STANDARD = ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"];
    let anyStandardColor = true, moonSunIncluded = false;
    for (const n of names) {
      const f = new Set(defs[n].fits_slots || []);
      if (!STANDARD.every((c) => f.has(c))) anyStandardColor = false;
      if (f.has("Moon") || f.has("Sun")) moonSunIncluded = true;
    }
    return { anyStandardColor, moonSunIncluded };
  }

  // Is a placed augment a Lunar or Solar (Sun/Moon) augment? Presence-only, detected
  // from the augment's color/slot/name; returns null when no signal (no fabrication).
  function lunarSolar(aug) {
    const s = `${aug.slot_color || ""} ${aug.color || ""} ${aug.variant_id || ""}`;
    if (/\b(lunar|moon)\b/i.test(s)) return "Lunar";
    if (/\b(solar|sun)\b/i.test(s)) return "Solar";
    return null;
  }

  // ---- character-constraint helpers (moved from exporters.js; exporters delegates back) ----

  const ARMOR = { cloth: "Cloth", light: "Light", medium: "Medium", heavy: "Heavy" };
  const STYLE = { "one-hand": "One-hand / Dual-wield", thf: "Two Handed Fighting", ranged: "Bow", crossbow: "Crossbow + Rune Arm", unarmed: "Unarmed" };
  const OATH = { druid: "Druid — no metal (cloth/light approx.)" };
  const POOL = { all: "All gear", owned: "Only what I own" };

  function weaponLine(i) {
    const style = STYLE[i.style] || i.style || "";
    const types = Array.isArray(i.weaponTypes) ? i.weaponTypes : [];
    if (!style && !types.length) return "";
    if (style && types.length) return `${style}: ${types.join(", ")}`;
    return style || types.join(", ");
  }
  function offHandLine(i) {
    const set = Array.isArray(i.offHand) ? i.offHand : [];
    return set.map((t) => (t === "empty" ? "Empty" : t)).join(", ");
  }
  function offHandWeaponLine(i) {
    return (Array.isArray(i.offHandWeapons) ? i.offHandWeapons : []).join(", ");
  }

  // Name + character constraints as [label, value] pairs — the shared export header.
  /** U6 — the credits that ACTUALLY APPLIED, as one readable line, or "" when
   *  none did.
   *
   *  Reads `creditReport` — the solver's own output — deliberately, NOT the saved
   *  `inputs.declaredCredits` map. Those two disagree, and the disagreement is
   *  routine rather than exotic: the wizard keeps a half-typed credit row in state
   *  on purpose so it does not vanish under the cursor, `pickInputs` saves the raw
   *  map verbatim, and the query seam then drops anything blank, zero,
   *  non-integer, out-of-vocabulary, or on a presence stat. Rendering the input
   *  map published a credit the solve refused — with no accompanying qualifier,
   *  since U4's notice reads the report — so a recipient was told the sender holds
   *  a bonus that contributed nothing to the build they were handed. R12 exists so
   *  a recipient can REPRODUCE the solve; only the applied set can do that.
   *
   *  Sorted, so two exports of the same build compare byte-for-byte regardless of
   *  the order the player declared them in. */
  function declaredCreditsLine(creditReport) {
    const rows = (creditReport || []).filter(Boolean);
    if (!rows.length) return "";
    return rows
      .map((c) => `${c.stat} +${c.value} ${c.bonus_type}`)
      .sort()
      .join("; ");
  }

  function constraintPairs(rec) {
    const i = (rec && rec.inputs) || {};
    return [
      ["Character", rec && rec.name],
      ["ML", i.ml == null ? "" : String(i.ml)],
      ["Race", i.race || ""],
      ["Alignment", i.alignment || ""],
      ["Armor", i.armor ? (ARMOR[i.armor] || i.armor) : ""],
      ["Oath", OATH[i.oath] || ""],
      ["Weapon", weaponLine(i)],
      ["Off hand", offHandLine(i)],
      ["Off-hand weapon", offHandWeaponLine(i)],
      // plan 003 U1 (R9) — the Two Weapon Fighting declaration travels with a shared
      // loadout. Empty string when undeclared, so the trailing filter drops the line
      // rather than printing "Two Weapon Fighting: No" on every non-dual-wield build.
      ["Two Weapon Fighting", i.twoWeaponFighting ? "Declared" : ""],
      // U6 (R12) — the declared credits themselves, so a recipient can reproduce
      // the solve. Distinct from U4's qualifier, which says a number was declared
      // and unverified; this is the number. Same omit-when-unset idiom as the Two
      // Weapon Fighting line above — the trailing filter drops it when nothing is
      // declared, so an undeclared build's exports are unchanged (R3).
      ["Already have", declaredCreditsLine(((rec && rec.snapshot) || {}).creditReport)],
      ["Gear pool", POOL[i.pool] || i.pool || "all"],
      // #110 (U9/R6) — the exclusions travel with the shared build, beside the
      // priorities and pins, so a reader re-solving reaches the same answer.
      // Count-prefixed so a long list reads as a list, not an anonymous blob;
      // the omit-when-unset filter drops the line entirely when nothing is
      // blocked, so a blockless build's exports are unchanged.
      ["Blocked", (Array.isArray(i.blocklist) && i.blocklist.length)
        ? `${i.blocklist.length} — ${i.blocklist.join("; ")}` : ""],
      ["Priorities", (i.priorities || []).join(" > ")],
    ].filter(([, v]) => v !== "" && v != null);
  }
  function constraintLines(rec) {
    return constraintPairs(rec).map(([k, v]) => `${k}: ${v}`);
  }

  // ---- the resolved-view assembler ----

  // One placed augment as a resolved-view entry: its slot color, Lunar/Solar cue,
  // name, and granted affixes.
  function augView(aug) {
    return {
      color: aug.color || null,
      slotColor: aug.slot_color || null,
      lunarSolar: lunarSolar(aug),
      name: aug.variant_id,
      affixes: aug.affixes || [],
    };
  }

  // The crafting upgrades applied to one equipped item, each with its family + label.
  function craftingForItem(v, idx, maps) {
    const out = [];
    for (const d of maps.dinoAssign.byIndex.get(idx) || []) out.push({ family: "dino", label: craftLabel(d, "dino") });
    for (const n of maps.ncByItem.get(v.variant_id) || []) out.push({ family: "nc", label: craftLabel(n, "nc") });
    for (const r of maps.rollByItem.get(v.variant_id) || []) out.push({ family: "roll", label: craftLabel(r, "roll") });
    for (const n of maps.vikByItem.get(v.variant_id) || []) out.push({ family: "vik", label: craftLabel(n, "vik") });
    for (const n of maps.sealByItem.get(v.variant_id) || []) out.push({ family: "seal", label: craftLabel(n, "seal") });
    for (const n of maps.tfByItem.get(v.variant_id) || []) out.push({ family: "tf", label: craftLabel(n, "tf") });
    for (const n of maps.gsByItem.get(v.variant_id) || []) out.push({ family: "gs", label: craftLabel(n, "gs") });
    for (const j of maps.jokerByHost.get(v.variant_id) || []) out.push({ family: "joker", label: craftLabel(j, "joker") });
    for (const m of maps.membershipByHost.get(v.variant_id) || []) out.push({ family: "membership", label: craftLabel(m, "membership"), station: m.station || null });
    // Solver-placed Set Augments on this host (KTD-6: host read from the solve, not
    // reconstructed). Each of the (up to 3) copies lives on a different item, so a
    // host shows its one copy. The host's own named set is suppressed once — annotate
    // it on the first copy so the note isn't repeated when a host carries several.
    const setAugs = (maps.setAugByHost && maps.setAugByHost.get(v.variant_id)) || [];
    const suppresses = setAugs.length ? slotSetNames(v) : [];
    setAugs.forEach((s, i) => out.push({
      family: "augmentset",
      // #316 — slot_color rides into the label AND the entry, so every export
      // (which renders cr.label verbatim) carries the consumed-slot attribution
      // the app chip shows. R6: never solve-visible but share-invisible.
      label: craftLabel({ set: s.set, slot_color: s.slot_color, suppresses: i === 0 ? suppresses : [] }, "augmentset"),
      set: s.set, host: s.host, slot_color: s.slot_color || null, wiki_url: s.wiki_url || null,
      suppresses: i === 0 ? suppresses : [],
    }));
    return out;
  }

  /** Turn a saved record into the resolved content model every output renders from.
   *  Header from `rec.name`/`rec.inputs`; loadout/sets/attribution from `rec.snapshot`.
   *  Attribution covers the ranked priority stats only (in priority order). */
  function project(rec) {
    const snap = (rec && rec.snapshot) || {};
    const chosen = snap.chosen || [];
    const augAssign = assignAugments(chosen, snap.augmentsPlaced, canonicalSetAugments(snap));
    const dinoAssign = assignDinoInserts(chosen, snap.dinoPlaced);
    const maps = buildCraftMaps(snap, augAssign, dinoAssign);
    const attr = attributionByTarget(snap, augAssign);
    const priorities = (rec && rec.inputs && rec.inputs.priorities) || [];

    const suppressed = suppressedHostIds(snap);
    const loadout = chosen.map((c, idx) => {
      const v = c.variant || {};
      return {
        slot: c.slot,
        item: v.variant_id,
        ml: itemMl(v),
        // U8 (R10) — collapsed HERE, in the single content source every export
        // reads, so no export can print the expanded shape while the app prints
        // the collapsed one. `results.js` calls the same primitive on its own
        // live-result render paths (it has no `rec` to project).
        affixes: collapseExpansions(v.affixes || []),
        augments: (augAssign.byIndex.get(idx) || []).map(augView),
        crafting: craftingForItem(v, idx, maps),
        // The item's own named set(s) suppressed because it hosts a placed Set Augment
        // (empty otherwise). The placement + this suppression also ride in `crafting`
        // (family "augmentset") so every text export surfaces them without change.
        suppressedSets: suppressed.has(v.variant_id) ? slotSetNames(v) : [],
        // #245 — non-null when this item is here ONLY for its craftable options:
        // [{stat, value, family}], highest first. Rides the shared content model
        // so no export can show the pick without the reason (the standing
        // solve-visible-but-share-invisible invariant).
        craftCarried: craftCarried(snap, { slot: c.slot, variant_id: v.variant_id }, attr),
        // #262 — the wiki-confirmed no-drop-source flag, carried as the ONE
        // shared wording so every export prints the identical phrase (and the
        // portable JSON inherits it verbatim). Only-when-set, mirroring the
        // dataset field: an unverified item carries no key at all, so no
        // surface can render a note the wiki evidence lacks (R2/R5).
        ...(v.no_drop_source ? { noDropSource: NO_DROP_SOURCE_WORDING } : {}),
      };
    });

    // U5 (R11) — `members` rides along, so every export can name the pieces that
    // composed the set and the portable JSON inherits them for free. Dropping it
    // here made a wildcard/chosen-membership piece solve-visible but
    // share-invisible: the recipient of a Gem-completed set saw the bonus and no
    // way to learn which item produced it. Each renderer must still print it —
    // carrying it through the model is necessary, not sufficient.
    const sets = satisfiedSetDetail(snap).map((s) => ({ set: s.set, pieces: s.pieces, affixes: s.affixes, members: s.members || [] }));

    const attribution = {};
    for (const stat of priorities) {
      const total = (snap.effective && snap.effective[stat] != null) ? snap.effective[stat] : 0;
      const cap = (snap.capped && snap.capped[stat] != null) ? snap.capped[stat] : null;
      const sources = (attr[stat] || []).map((p) => ({
        source: p.source, kind: p.sourceKind, value: p.value,
        bonusType: p.bonus_type, slots: p.slots, viaSet: p.isSet,
        // #205 — carried into every export, not just the live panel: a shared
        // build must name the enchantment the reader will look for on the item.
        viaAffix: p.via || null,
        // U3 (#290/#291) — the cross-add source stat, RAW, so the portable JSON
        // inherits it unchanged and every text export can say "from <source>".
        // A cross-added credit that solves visibly but shares invisibly is the
        // standing failure this repo forbids.
        crossAdd: p.crossAdd || null,
      }));
      attribution[stat] = { total, cap, sources };
    }

    return {
      character: { name: rec && rec.name, constraints: constraintPairs(rec),
        // U4 (R9) — the declared-credit qualifier travels with the shared
        // content model, so every export renders it from the same source the
        // app's bound notice does. Empty array when nothing was declared.
        creditNotice: creditNoticeLines(snap),
        // #239 — the saturation and free-slot disclosures travel with the shared
        // content model for the same reason the credit qualifier does: a
        // recipient who cannot re-solve would otherwise get a build asserting an
        // optimal loadout with no way to learn that a stat was already at its
        // ceiling, or that slots were tie-broken rather than chosen.
        saturationNotice: saturationNoticeLines(snap),
        emptySlotNotice: emptySlotNoticeLines(snap),
        // U6/#249 — same channel, same reason: a recipient who cannot re-solve
        // would otherwise get a build asserting an optimal loadout with no way
        // to learn that an item's absorption enchantment was withheld from it.
        absorptionQuarantineNotice: absorptionQuarantineNoticeLines(snap),
        // #245 — the niche-crafting opt-out disclosure (null when off): a
        // recipient must not compare this build against a full-crafting one
        // without being told the pools differed.
        craftingExcludedNotice: craftingExcludedLine(rec),
        // #110 (U7/U9) — the blocklist disclosure: empty array when no block
        // touched the solve. A shared build asserting optimality with silent
        // exclusions is the solve-visible-but-share-invisible failure.
        blockNotice: blockNoticeLines(snap) },
      loadout, sets, attribution,
    };
  }

  /** U4 (R9, R10) — the declared-credit qualifier, as plain sentences.
   *
   *  ONE source for the app notice and every export. `boundNotice` returns HTML
   *  from results.js and is not part of this content model, so a qualifier written
   *  only there would be solve-visible but share-invisible: a recipient would see
   *  a build asserting an optimal loadout with a player-typed number folded into
   *  its totals and nothing saying the number was unverified. That is the failure
   *  mode this repo holds as a standing invariant.
   *
   *  Reads `creditReport` (plain JSON on the result), never the live program, so a
   *  restored character discloses identically without re-solving (KTD6).
   */
  /** #239 — the saturation disclosure as plain sentences.
   *
   *  The single WORDING source, the same contract `creditNoticeLines` holds:
   *  every export prints these sentences, and the app's per-stat tooltips reuse
   *  them verbatim via `saturationLineFor`. The app's notice line itself is the
   *  compact count/list in `results.js saturationNotice` (plan 2026-08-12-001)
   *  — a different SHAPE derived from the same `saturationReport` rows, never a
   *  second sentence corpus that can drift. Reads `saturationReport` (plain
   *  JSON on the result), never the live program, so a restored character
   *  discloses identically without re-solving.
   *
   *  KTD6 — facts only. It names which bonus types carry the stat and that they
   *  are filled. It attributes no cause: the pool is the product of the ML band,
   *  the gear pool, the character gates AND the dominance pre-filter, and naming
   *  one was already wrong once. The unused-source count is deliberately not
   *  spoken — it counts affix instances rather than items, so "56 unused
   *  sources" would read as alarming and mean something other than it says. It
   *  stays on the report for the portable export.
   */
  function saturationSentence(e) {
    const types = e.bonusTypes || [];
    const art = (t) => `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t} bonus`;
    const named = types.length === 1
      ? art(types[0])
      : `${types.slice(0, -1).map(art).join(", ")} and ${art(types[types.length - 1])}`;
    const verb = types.length === 1 ? "it is filled"
      : types.length === 2 ? "both are filled" : "all of them are filled";
    return `${e.stat} is at its ceiling of ${e.total} — it reaches you as ${named}, and ${verb}, `
      + `so no other item in your pool can raise it.`;
  }

  function saturationNoticeLines(result) {
    const report = (result && result.saturationReport) || [];
    return report.map(saturationSentence);
  }

  /** The one saturation sentence for a single stat — the per-span tooltip
   *  source. Keyed by stat, never by array index, so a future filtered report
   *  cannot misalign sentences to stats. Null when the stat is not saturated. */
  function saturationLineFor(result, stat) {
    const e = ((result && result.saturationReport) || []).find((r) => r && r.stat === stat);
    return e ? saturationSentence(e) : null;
  }

  /** #239 — the empty-slot disclosure as plain sentences.
   *
   *  Reads `emptySlots` (plain JSON on the result) rather than deriving it, for
   *  the same reason the saturation line does: the worn-slot list lives on the
   *  model, which a restored character no longer has.
   *
   *  States the fact only. The invitation to add priorities is app-side — a
   *  shared export has no Adjust & re-solve panel, and pointing a reader at a
   *  control that is not in front of them is worse than saying nothing.
   */
  function emptySlotNoticeLines(result) {
    const e = (result && result.emptySlots) || { count: 0, slots: [] };
    const lines = [];
    if (e.count) {
      const isOne = e.count === 1;
      lines.push(`${e.count} ${isOne ? "slot is" : "slots are"} empty (${(e.slots || []).join(", ")}) — `
        + `nothing available for ${isOne ? "it" : "them"} improves these priorities.`);
    }
    // #110 (U8/R10) — a slot the player's own exclusions emptied is a different
    // fact from a slot with nothing worth wearing, and reads as one.
    const b = e.blockedSlots || [];
    if (b.length) {
      lines.push(`${b.join(", ")} ${b.length === 1 ? "is" : "are"} empty because your blocklist `
        + `removed every eligible candidate — unblock something or the slot${b.length === 1 ? "" : "s"} will stay bare.`);
    }
    return lines;
  }

  /** U6/#249 — the compound-absorption quarantine as plain sentences.
   *
   *  ONE source for the app notice and every export, the contract
   *  `saturationNoticeLines` holds. Reads `absorptionQuarantine` (plain JSON on
   *  the result), never the pool, so a restored character discloses identically
   *  without re-solving.
   *
   *  Wording rule: `docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md`.
   *  Each sentence states three things, all verifiable from the data that
   *  produced it — which affix was removed, from which item, and which stats it
   *  was therefore not credited to. It says nothing about what the build WOULD
   *  have scored with the carrier included: that is a solve nobody ran, and for
   *  an unconfirmed carrier the element set is precisely what is unknown, so
   *  even the direction of the difference is unknowable.
   */
  function absorptionQuarantineNoticeLines(result) {
    const report = (result && result.absorptionQuarantine) || [];
    return report.map((e) => {
      // Branch on BOTH reasons by name, never on one with the other as an else.
      // A third reason shipping from `src/absorption_split.py` would otherwise be
      // silently rendered as "no wiki record", which is a different — and
      // possibly false — claim about why the affix was dropped. An unrecognized
      // reason says only what is certain.
      const why = e.reason === "unconfirmed"
        ? `the wiki record of which elements it covers is not confirmed`
        : e.reason === "absent"
          ? `there is no wiki record of which elements it covers`
          : `which elements it covers is not established`;
      const to = (e.components || []);
      const named = to.length > 1
        ? `${to.slice(0, -1).join(", ")} or ${to[to.length - 1]}`
        : (to[0] || "any element");
      return `${e.stat} on ${e.item} was excluded from this build because ${why}, `
        + `so it was not credited to ${named}.`;
    });
  }

  function creditNoticeLines(result) {
    const report = (result && result.creditReport) || [];
    if (!report.length) return [];
    const lines = [];
    const label = (c) => `${c.value} ${c.bonus_type} ${c.stat}`;

    lines.push(`You declared ${report.map(label).join(", ")} as already held. ` +
      `The optimizer did not verify ${report.length > 1 ? "those numbers" : "that number"} — ` +
      `${report.length > 1 ? "they are" : "it is"} yours, and the loadout below is optimal given ` +
      `${report.length > 1 ? "them" : "it"}.`);

    // R10, narrowed per A3: name the best gear the credit beat, read off the solve
    // already run rather than a second credit-free solve. "In your pool" rather
    // than "available" — the value is the best the build could field, and saying
    // more than that would overclaim.
    for (const c of report) {
      if (c.beatGear != null) {
        // No parentheses: markdown escapes them, so raw text people paste into
        // forums reads "your gear pool \(5\)". Same trap as DECLARED_LABEL.
        lines.push(`Your declared ${c.bonus_type} ${c.stat} of ${c.value} beat your best ` +
          `${c.bonus_type} ${c.stat} gear, which is ${c.beatGear}, so that slot went to another priority.`);
      }
    }
    // R9's floor half. Grouped by STAT, not per credit: two credits on one stat
    // each carry the same floor, and one sentence per credit would read as two
    // independent explanations of the same verdict.
    //
    // The claim is ATTRIBUTION, not necessity. Saying "your gear alone reaches N"
    // would assert what a credit-free solve produces, which A3 forbids computing —
    // and that solve is free to pick different gear entirely, so the assertion was
    // demonstrably false. What the data supports is what the shown loadout's gear
    // supplies, with the declaration counted alongside it.
    const byStat = new Map();
    for (const c of report) {
      if (c.floor == null) continue;
      if (!byStat.has(c.stat)) byStat.set(c.stat, []);
      byStat.get(c.stat).push(c);
    }
    for (const [stat, cs] of byStat) {
      const declared = cs.map((c) => `${c.value} ${c.bonus_type}`).join(" and ");
      lines.push(`Your floor of ${cs[0].floor} ${stat} counts the declared ${declared} — ` +
        `the gear in this loadout supplies ${cs[0].gearInLoadout}.`);
    }
    return lines;
  }

  const api = {
    // resolved-view assembler
    project, creditNoticeLines, saturationNoticeLines, emptySlotNoticeLines,
    absorptionQuarantineNoticeLines, declaredCreditsLine,
    // pure primitives (results.js binds these; single definition, no drift)
    affixLabel, collapseExpansions, itemMl, contributingAffixes, assignAugments, canonicalSetAugments, dinoInsertKey, assignDinoInserts,
    attributionByTarget, whyThis, itemContributions, saturatedStats, saturationLineFor,
    satisfiedSets, suppressedHostIds, slotSetNames,
    setContributors, contributorsFor, setMemberLabel, activeSetDetail, satisfiedSetDetail,
    // craft + cue helpers
    buildCraftMaps, craftLabel, craftValue, lunarSolar, setAugmentSlotRule,
    // #245 — craft-carried disclosure + the opt-out notice line
    craftCarried, craftingExcludedLine,
    // #262 — the one no-drop-source disclosure wording (results/browse/wizard
    // and every exporter read it from here; never respell it)
    NO_DROP_SOURCE_WORDING,
    // #110 — the blocklist disclosure sentences
    blockNoticeLines,
    // constraint header helpers (exporters delegates to these)
    constraintPairs, constraintLines,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Projection = api;
})();
